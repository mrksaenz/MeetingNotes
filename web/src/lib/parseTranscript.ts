/**
 * Parse an existing transcript (pasted text or an uploaded .txt / .vtt / .srt
 * file) into the same shape AssemblyAI produces, so it can be stored in the
 * `transcriptions` table and summarized without spending any transcription
 * tokens/credits.
 *
 * Supported inputs:
 *  - WebVTT  (starts with "WEBVTT")
 *  - SubRip  (.srt — numbered cues with "00:00:00,000 --> ..." timing)
 *  - Speaker-labelled plain text ("Mark Saenz: ..." or "Speaker A: ...")
 *  - Free-form plain text (stored as full_text only)
 */

export interface ParsedUtterance {
  speaker: string;
  text: string;
  start: number; // ms
  end: number; // ms
  confidence: number;
}

export interface ParsedTranscript {
  fullText: string;
  utterances: ParsedUtterance[] | null;
}

// "00:01:23.456" or "00:01:23,456" or "01:23" -> milliseconds
function timecodeToMs(tc: string): number {
  const cleaned = tc.trim().replace(',', '.');
  const parts = cleaned.split(':').map((p) => parseFloat(p));
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else {
    seconds = parts[0] || 0;
  }
  return Math.round(seconds * 1000);
}

// Map a free-form speaker name to a short, stable label letter.
class SpeakerMap {
  private map = new Map<string, string>();
  private next = 0;
  /** Returns the original name as the speaker key (we keep real names if given). */
  label(name: string): string {
    const key = name.trim();
    if (!this.map.has(key)) {
      this.map.set(key, key);
      this.next += 1;
    }
    return this.map.get(key)!;
  }
}

const CUE_TIME_RE = /(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)/;
// Leading "<v Speaker Name>" (WebVTT) or "Speaker Name:" prefix
const VOICE_TAG_RE = /^<v\s+([^>]+)>\s*/i;
const SPEAKER_PREFIX_RE = /^([A-Za-z][\w .'\-]{0,40}?):\s+/;

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

function parseCueBlocks(raw: string): ParsedUtterance[] {
  const blocks = raw.split(/\r?\n\r?\n/);
  const speakers = new SpeakerMap();
  const utterances: ParsedUtterance[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const timeLine = lines.find((l) => CUE_TIME_RE.test(l));
    if (!timeLine) continue;
    const match = timeLine.match(CUE_TIME_RE)!;
    const start = timecodeToMs(match[1]);
    const end = timecodeToMs(match[2]);

    // Everything after the timing line is the cue text (skip numeric cue index)
    const timeIdx = lines.indexOf(timeLine);
    const textLines = lines.slice(timeIdx + 1);
    let text = textLines.join(' ').trim();
    if (!text) continue;

    let speaker = 'A';
    const voiceMatch = text.match(VOICE_TAG_RE);
    if (voiceMatch) {
      speaker = speakers.label(voiceMatch[1]);
      text = text.replace(VOICE_TAG_RE, '');
    } else {
      const prefixMatch = text.match(SPEAKER_PREFIX_RE);
      if (prefixMatch) {
        speaker = speakers.label(prefixMatch[1]);
        text = text.replace(SPEAKER_PREFIX_RE, '');
      }
    }

    text = stripHtml(text);
    if (text) utterances.push({ speaker, text, start, end, confidence: 1 });
  }

  return utterances;
}

function parseSpeakerLines(raw: string): ParsedUtterance[] {
  const speakers = new SpeakerMap();
  const utterances: ParsedUtterance[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(SPEAKER_PREFIX_RE);
    if (match) {
      const speaker = speakers.label(match[1]);
      const text = trimmed.replace(SPEAKER_PREFIX_RE, '').trim();
      if (text) utterances.push({ speaker, text, start: 0, end: 0, confidence: 1 });
    } else if (utterances.length > 0) {
      // Continuation of the previous speaker's turn
      utterances[utterances.length - 1].text += ' ' + trimmed;
    }
  }

  return utterances;
}

export function parseTranscript(raw: string): ParsedTranscript {
  const text = raw.replace(/﻿/g, '').trim();
  if (!text) return { fullText: '', utterances: null };

  const isVtt = /^WEBVTT/i.test(text);
  const hasCueTiming = CUE_TIME_RE.test(text);

  let utterances: ParsedUtterance[] = [];

  if (isVtt || hasCueTiming) {
    utterances = parseCueBlocks(text);
  }

  // Fall back to speaker-labelled plain text if no timed cues were found.
  if (utterances.length === 0) {
    const speakerLines = parseSpeakerLines(text);
    // Only treat as speaker-labelled if at least two distinct turns were found.
    if (speakerLines.length >= 2) {
      utterances = speakerLines;
    }
  }

  const fullText =
    utterances.length > 0 ? utterances.map((u) => u.text).join(' ') : text;

  return {
    fullText,
    utterances: utterances.length > 0 ? utterances : null,
  };
}
