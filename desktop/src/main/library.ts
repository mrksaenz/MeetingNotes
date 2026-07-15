import { promises as fs } from 'fs';
import path from 'path';
import { shell } from 'electron';
import { randomUUID } from 'crypto';
import type { Meeting, MeetingListItem, RecordingPart } from '@shared/types';
import { parseTranscript } from '@shared/parseTranscript';
import { getLibraryPath } from './settings';

/**
 * The meeting "library" is just a folder of folders — no database. Each
 * meeting folder contains meeting.json (all metadata, transcripts, and the
 * summary), an audio/ folder, and an exports/ folder for PDFs/Word docs.
 * Pointing the library at a Google Drive for Desktop folder makes Drive
 * the sync + handoff mechanism between secretaries.
 */

const MEETING_FILE = 'meeting.json';

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Untitled Meeting';
}

async function meetingDir(id: string): Promise<string> {
  const lib = await getLibraryPath();
  const dir = path.resolve(lib, id);
  // Guard against path escape via a crafted id.
  if (path.dirname(dir) !== path.resolve(lib)) throw new Error('Invalid meeting id');
  return dir;
}

async function writeMeetingFile(dir: string, meeting: Meeting): Promise<void> {
  meeting.updatedAt = new Date().toISOString();
  const file = path.join(dir, MEETING_FILE);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(meeting, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}

export async function getMeeting(id: string): Promise<Meeting> {
  const dir = await meetingDir(id);
  const raw = await fs.readFile(path.join(dir, MEETING_FILE), 'utf-8');
  const meeting = JSON.parse(raw) as Meeting;
  meeting.id = id; // folder name is authoritative (user may rename in Finder)
  return meeting;
}

export async function saveMeeting(meeting: Meeting): Promise<Meeting> {
  const dir = await meetingDir(meeting.id);
  await writeMeetingFile(dir, meeting);
  return meeting;
}

export async function listMeetings(): Promise<MeetingListItem[]> {
  const lib = await getLibraryPath();
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(lib, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const items: MeetingListItem[] = [];
  for (const name of entries) {
    try {
      const meeting = await getMeeting(name);
      let exportCount = 0;
      try {
        exportCount = (await fs.readdir(path.join(lib, name, 'exports'))).length;
      } catch {
        // no exports yet
      }
      items.push({
        id: name,
        title: meeting.title,
        recordedAt: meeting.recordedAt,
        partCount: meeting.parts.length,
        totalDurationSeconds: meeting.parts.reduce((s, p) => s + (p.durationSeconds || 0), 0),
        hasTranscription: meeting.parts.some((p) => p.transcription),
        hasSummary: !!meeting.summary,
        exportCount,
      });
    } catch {
      // Not a meeting folder (or corrupted) — skip it silently so stray
      // folders inside the Drive directory don't break the app.
    }
  }

  return items.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export async function createMeeting(input: {
  title: string;
  recordedAt: string;
  agendaText: string | null;
}): Promise<Meeting> {
  const lib = await getLibraryPath();
  const date = input.recordedAt.slice(0, 10);
  const base = sanitizeFolderName(`${date} ${input.title}`);

  let id = base;
  for (let n = 2; ; n++) {
    try {
      await fs.access(path.join(lib, id));
      id = `${base} (${n})`;
    } catch {
      break;
    }
  }

  const dir = path.join(lib, id);
  await fs.mkdir(path.join(dir, 'audio'), { recursive: true });
  await fs.mkdir(path.join(dir, 'exports'), { recursive: true });

  const now = new Date().toISOString();
  const meeting: Meeting = {
    id,
    title: input.title.trim() || 'Untitled Meeting',
    recordedAt: input.recordedAt,
    agendaText: input.agendaText,
    parts: [],
    summary: null,
    speakerLabels: {},
    createdAt: now,
    updatedAt: now,
  };
  await writeMeetingFile(dir, meeting);
  return meeting;
}

export async function updateMeeting(
  id: string,
  patch: Partial<Pick<Meeting, 'title' | 'agendaText' | 'speakerLabels' | 'recordedAt'>>
): Promise<Meeting> {
  const meeting = await getMeeting(id);
  Object.assign(meeting, patch);
  return saveMeeting(meeting);
}

export async function deleteMeeting(id: string): Promise<void> {
  const dir = await meetingDir(id);
  await shell.trashItem(dir); // recoverable from the Trash, never a hard delete
}

function newPart(meeting: Meeting): RecordingPart {
  return {
    id: randomUUID(),
    partNumber: meeting.parts.length + 1,
    audioFile: null,
    durationSeconds: null,
    transcription: null,
  };
}

export async function addAudioFromPath(
  id: string,
  sourcePath: string,
  durationSeconds: number | null
): Promise<Meeting> {
  const meeting = await getMeeting(id);
  const dir = await meetingDir(id);
  const part = newPart(meeting);
  const ext = path.extname(sourcePath).replace('.', '') || 'm4a';
  const fileName = `part-${String(part.partNumber).padStart(2, '0')}.${ext}`;
  await fs.mkdir(path.join(dir, 'audio'), { recursive: true });
  await fs.copyFile(sourcePath, path.join(dir, 'audio', fileName));
  part.audioFile = fileName;
  part.durationSeconds = durationSeconds;
  meeting.parts.push(part);
  return saveMeeting(meeting);
}

export async function addRecordedAudio(
  id: string,
  data: ArrayBuffer,
  mimeType: string,
  durationSeconds: number
): Promise<Meeting> {
  const meeting = await getMeeting(id);
  const dir = await meetingDir(id);
  const part = newPart(meeting);
  const ext = mimeType.includes('mp4') || mimeType.includes('aac') ? 'm4a'
    : mimeType.includes('mpeg') ? 'mp3'
    : 'webm';
  const fileName = `part-${String(part.partNumber).padStart(2, '0')}.${ext}`;
  await fs.mkdir(path.join(dir, 'audio'), { recursive: true });
  await fs.writeFile(path.join(dir, 'audio', fileName), Buffer.from(data));
  part.audioFile = fileName;
  part.durationSeconds = durationSeconds;
  meeting.parts.push(part);
  return saveMeeting(meeting);
}

export async function addManualTranscript(id: string, raw: string): Promise<Meeting> {
  const meeting = await getMeeting(id);
  const parsed = parseTranscript(raw);
  if (!parsed.fullText) throw new Error('The transcript appears to be empty');
  const part = newPart(meeting);
  part.transcription = {
    fullText: parsed.fullText,
    utterances: parsed.utterances,
    source: 'manual',
    createdAt: new Date().toISOString(),
  };
  meeting.parts.push(part);
  return saveMeeting(meeting);
}

export async function getAudioPath(id: string, partId: string): Promise<string> {
  const meeting = await getMeeting(id);
  const part = meeting.parts.find((p) => p.id === partId);
  if (!part?.audioFile) throw new Error('Part has no audio file');
  return path.join(await meetingDir(id), 'audio', part.audioFile);
}

export async function exportsDir(id: string): Promise<string> {
  const dir = path.join(await meetingDir(id), 'exports');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function revealMeeting(id: string): Promise<void> {
  shell.showItemInFolder(path.join(await meetingDir(id), MEETING_FILE));
}
