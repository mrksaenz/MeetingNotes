/**
 * Shared types for the MeetingNotes desktop app.
 *
 * There is no database. Each meeting is a folder inside the library folder
 * (typically inside Google Drive for Desktop so it syncs automatically):
 *
 *   <library>/
 *     2026-07-15 TBA Board Meeting/
 *       meeting.json      <- everything below except audio bytes
 *       audio/part-01.m4a
 *       exports/TBA_Board_Meeting_notes.pdf
 */

export type ProcessingLevel = 'transcription_only' | 'summary' | 'full_analysis';

export interface Utterance {
  speaker: string;
  text: string;
  start: number; // ms
  end: number; // ms
  confidence: number;
}

export interface Transcription {
  fullText: string;
  utterances: Utterance[] | null;
  source: 'assemblyai' | 'manual';
  createdAt: string;
}

export interface ActionItem {
  action: string;
  owner: string | null;
  deadline: string | null;
}

export interface MeetingSummary {
  executiveSummary: string;
  keyPoints: string[];
  decisions: string[] | null;
  actionItems: ActionItem[] | null;
  processingLevel: ProcessingLevel;
  createdAt: string;
}

export interface RecordingPart {
  id: string;
  partNumber: number;
  /** File name inside the meeting's audio/ folder; null for pasted transcripts. */
  audioFile: string | null;
  durationSeconds: number | null;
  transcription: Transcription | null;
}

export interface Meeting {
  id: string; // folder name
  title: string;
  recordedAt: string; // ISO date
  agendaText: string | null;
  parts: RecordingPart[];
  summary: MeetingSummary | null;
  speakerLabels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight row for the library list (no transcripts). */
export interface MeetingListItem {
  id: string;
  title: string;
  recordedAt: string;
  partCount: number;
  totalDurationSeconds: number;
  hasTranscription: boolean;
  hasSummary: boolean;
  exportCount: number;
}

export interface AppSettings {
  libraryPath: string | null;
  hasAssemblyAiKey: boolean;
  hasAnthropicKey: boolean;
}

export interface ProcessingProgress {
  meetingId: string;
  stage: 'uploading' | 'transcribing' | 'summarizing' | 'done' | 'error';
  /** 1-based part number for per-part stages. */
  partNumber?: number;
  partCount?: number;
  message?: string;
}

export type ExportFormat = 'pdf' | 'docx';

export interface ExportResult {
  path: string;
  fileName: string;
}
