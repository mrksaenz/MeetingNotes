import { useState } from 'react';
import { useToast } from '../lib/toast';

type Tab = 'record' | 'audio' | 'transcript';

/** Read a media file's duration client-side (same trick as the web UploadModal). */
function getAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    audio.src = url;
  });
}

export default function NewMeetingModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (meetingId: string, options?: { record?: boolean; title: string }) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('record');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [agenda, setAgenda] = useState('');
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [transcriptText, setTranscriptText] = useState('');
  const [busy, setBusy] = useState(false);

  async function readTranscriptFile(file: File) {
    setTranscriptText(await file.text());
  }

  async function create() {
    if (!title.trim()) {
      toast('error', 'Give the meeting a title');
      return;
    }
    if (tab === 'audio' && audioFiles.length === 0) {
      toast('error', 'Add at least one audio file');
      return;
    }
    if (tab === 'transcript' && !transcriptText.trim()) {
      toast('error', 'Paste or upload a transcript');
      return;
    }

    setBusy(true);
    try {
      const meeting = await window.api.createMeeting({
        title: title.trim(),
        recordedAt: new Date(`${date}T12:00:00`).toISOString(),
        agendaText: agenda.trim() || null,
      });

      if (tab === 'audio') {
        const items = [];
        for (const file of audioFiles) {
          items.push({
            path: window.api.getFilePath(file),
            durationSeconds: await getAudioDuration(file),
          });
        }
        await window.api.addAudioPaths(meeting.id, items);
        toast('success', `Meeting created with ${items.length} audio file${items.length !== 1 ? 's' : ''}`);
        onCreated(meeting.id, { title: meeting.title });
      } else if (tab === 'transcript') {
        await window.api.addManualTranscript(meeting.id, transcriptText);
        toast('success', 'Transcript saved — no transcription credits needed');
        onCreated(meeting.id, { title: meeting.title });
      } else {
        onCreated(meeting.id, { record: true, title: meeting.title });
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to create meeting');
      setBusy(false);
    }
  }

  const tabClass = (t: Tab) =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
      tab === t ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-6">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">New Meeting</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold text-slate-600">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. TBA Board Meeting"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Agenda <span className="font-normal text-slate-400">(optional — improves the AI notes)</span>
            </label>
            <textarea
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={3}
              placeholder="Paste the meeting agenda here"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <button className={tabClass('record')} onClick={() => setTab('record')}>
              Record now
            </button>
            <button className={tabClass('audio')} onClick={() => setTab('audio')}>
              Audio files
            </button>
            <button className={tabClass('transcript')} onClick={() => setTab('transcript')}>
              Transcript
            </button>
          </div>

          {tab === 'record' && (
            <p className="rounded-lg bg-blue-50 px-3 py-2.5 text-xs text-blue-800">
              Records with this Mac's microphone. You'll see a consent reminder before
              recording starts.
            </p>
          )}

          {tab === 'audio' && (
            <div>
              <input
                type="file"
                accept="audio/*,.m4a,.mp3,.wav,.aac,.webm,.ogg"
                multiple
                onChange={(e) => setAudioFiles(Array.from(e.target.files ?? []))}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
              />
              {audioFiles.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {audioFiles.map((f) => (
                    <li key={f.name} className="truncate">🎙 {f.name}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-slate-400">
                Voice memos from your phone work great — multiple files become parts of one
                meeting.
              </p>
            </div>
          )}

          {tab === 'transcript' && (
            <div>
              <textarea
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                rows={6}
                placeholder={'Paste the transcript here…\nSupports plain text, "Speaker: text" lines, WebVTT, and SRT.'}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <span>or upload a file:</span>
                <input
                  type="file"
                  accept=".txt,.vtt,.srt,text/plain"
                  onChange={(e) => e.target.files?.[0] && readTranscriptFile(e.target.files[0])}
                  className="text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs"
                />
              </div>
              <p className="mt-2 text-xs text-emerald-600">
                Transcripts skip AI transcription entirely — you can go straight to a summary.
              </p>
            </div>
          )}

          <button
            onClick={create}
            disabled={busy}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Creating…' : tab === 'record' ? 'Create & start recording' : 'Create meeting'}
          </button>
        </div>
      </div>
    </div>
  );
}
