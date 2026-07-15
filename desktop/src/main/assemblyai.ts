import type { Utterance } from '@shared/types';

/**
 * AssemblyAI client, ported from web/src/lib/assemblyai.ts. The desktop app
 * has no server and no public storage URLs, so audio bytes are uploaded
 * directly to AssemblyAI's upload endpoint before transcription.
 */

export interface TranscriptionResult {
  text: string;
  utterances: Utterance[] | null;
  confidence: number;
}

const ASSEMBLYAI_BASE_URL = 'https://api.assemblyai.com/v2';

export async function uploadToAssemblyAI(apiKey: string, audioData: Buffer): Promise<string> {
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(audioData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AssemblyAI upload failed: ${errorText}`);
  }

  const { upload_url } = (await response.json()) as { upload_url: string };
  return upload_url;
}

export async function transcribeAudio(apiKey: string, audioUrl: string): Promise<TranscriptionResult> {
  const submitResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: ['universal-2'],
      speaker_labels: true,
      language_code: 'en',
    }),
  });

  if (!submitResponse.ok) {
    const error = await submitResponse.text();
    throw new Error(`AssemblyAI submit failed: ${error}`);
  }

  const { id: transcriptId } = (await submitResponse.json()) as { id: string };

  interface PollResult {
    status: string;
    error?: string;
    text?: string;
    confidence?: number;
    utterances?: Array<{ speaker: string; text: string; start: number; end: number; confidence: number }>;
  }

  // Poll for completion. Long board meetings can take a while to transcribe,
  // so allow up to 60 minutes (5s intervals).
  let result: PollResult | undefined;
  const maxAttempts = 720;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const pollResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${transcriptId}`, {
      headers: { 'Authorization': apiKey },
    });

    if (!pollResponse.ok) {
      throw new Error('AssemblyAI poll failed');
    }

    result = (await pollResponse.json()) as PollResult;

    if (result.status === 'completed') break;
    if (result.status === 'error') {
      throw new Error(`AssemblyAI error: ${result.error}`);
    }
  }

  if (!result || result.status !== 'completed') {
    throw new Error('Transcription timed out');
  }

  const utterances: Utterance[] | null = result.utterances
    ? result.utterances.map((u: { speaker: string; text: string; start: number; end: number; confidence: number }) => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start,
        end: u.end,
        confidence: u.confidence,
      }))
    : null;

  return {
    text: result.text || '',
    utterances,
    confidence: result.confidence || 0,
  };
}
