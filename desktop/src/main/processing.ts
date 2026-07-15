import { promises as fs } from 'fs';
import type { Meeting, ProcessingLevel, ProcessingProgress } from '@shared/types';
import { getMeeting, saveMeeting, getAudioPath } from './library';
import { getApiKeys } from './settings';
import { uploadToAssemblyAI, transcribeAudio } from './assemblyai';
import { summarizeTranscription } from './anthropic';

/**
 * The processing pipeline: transcribe any parts that still need it, then
 * (for summary/full-analysis tiers) summarize the whole meeting in one pass
 * across all parts. The meeting is saved to disk after every step so a crash
 * or quit mid-way never loses completed work — already-transcribed parts are
 * skipped on re-run (manual transcripts skip AssemblyAI entirely).
 */

const running = new Set<string>();

export function isProcessing(meetingId: string): boolean {
  return running.has(meetingId);
}

export async function runProcessing(
  meetingId: string,
  level: ProcessingLevel,
  onProgress: (p: ProcessingProgress) => void
): Promise<Meeting> {
  if (running.has(meetingId)) throw new Error('This meeting is already being processed');
  running.add(meetingId);
  try {
    const keys = await getApiKeys();
    let meeting = await getMeeting(meetingId);

    const needsTranscription = meeting.parts.filter((p) => !p.transcription && p.audioFile);
    if (needsTranscription.length > 0 && !keys.assemblyAiKey) {
      throw new Error('AssemblyAI API key is not set — add it in Settings');
    }
    if (level !== 'transcription_only' && !keys.anthropicKey) {
      throw new Error('Anthropic API key is not set — add it in Settings');
    }

    const partCount = meeting.parts.length;

    for (const part of needsTranscription) {
      onProgress({ meetingId, stage: 'uploading', partNumber: part.partNumber, partCount });
      const audioPath = await getAudioPath(meetingId, part.id);
      const audioData = await fs.readFile(audioPath);
      const uploadUrl = await uploadToAssemblyAI(keys.assemblyAiKey!, audioData);

      onProgress({ meetingId, stage: 'transcribing', partNumber: part.partNumber, partCount });
      const result = await transcribeAudio(keys.assemblyAiKey!, uploadUrl);

      // Re-read before writing in case metadata changed while transcribing.
      meeting = await getMeeting(meetingId);
      const target = meeting.parts.find((p) => p.id === part.id);
      if (target) {
        target.transcription = {
          fullText: result.text,
          utterances: result.utterances,
          source: 'assemblyai',
          createdAt: new Date().toISOString(),
        };
      }
      meeting = await saveMeeting(meeting);
    }

    if (level !== 'transcription_only') {
      const transcribedParts = meeting.parts.filter((p) => p.transcription);
      if (transcribedParts.length === 0) throw new Error('Nothing to summarize yet');

      onProgress({ meetingId, stage: 'summarizing' });
      const fullText = transcribedParts
        .map((p) =>
          transcribedParts.length > 1
            ? `[Part ${p.partNumber}]\n${p.transcription!.fullText}`
            : p.transcription!.fullText
        )
        .join('\n\n');

      const summary = await summarizeTranscription(
        keys.anthropicKey!,
        fullText,
        level,
        meeting.agendaText
      );

      meeting = await getMeeting(meetingId);
      meeting.summary = {
        ...summary,
        processingLevel: level,
        createdAt: new Date().toISOString(),
      };
      meeting = await saveMeeting(meeting);
    }

    onProgress({ meetingId, stage: 'done' });
    return meeting;
  } catch (err) {
    onProgress({
      meetingId,
      stage: 'error',
      message: err instanceof Error ? err.message : 'Processing failed',
    });
    throw err;
  } finally {
    running.delete(meetingId);
  }
}
