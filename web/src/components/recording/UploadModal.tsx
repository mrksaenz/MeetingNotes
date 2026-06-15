'use client';

import { useState, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { uploadAudio } from '@/lib/uploadAudio';
import { parseTranscript } from '@/lib/parseTranscript';
import { extractPdfText } from '@/lib/extractPdfText';
import { useToast } from '@/contexts/ToastContext';
import UploadProgressBar from '@/components/ui/UploadProgressBar';
import type { Workspace } from '@/types/database';

type Tab = 'audio' | 'transcript';
type Step = 'form' | 'importing' | 'done';

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onUploadComplete: () => void;
  workspaces: Workspace[];
  selectedWorkspaceId?: string;
}

const AUDIO_EXT = ['.m4a', '.mp3', '.wav', '.aac', '.webm', '.mp4', '.ogg', '.flac'];
const TRANSCRIPT_EXT = ['.txt', '.vtt', '.srt', '.md', '.pdf'];

function isPdf(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
}

/** Read a text/PDF file's contents as plain text. */
async function readFileText(file: File): Promise<string> {
  if (isPdf(file)) return extractPdfText(file);
  return file.text();
}

/** Read an audio file's duration (seconds) via a temporary <audio> element. */
function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      audio.src = url;
    } catch {
      resolve(0);
    }
  });
}

export default function UploadModal({
  open,
  onClose,
  onUploadComplete,
  workspaces,
  selectedWorkspaceId,
}: UploadModalProps) {
  const { showToast } = useToast();
  const audioInputRef = useRef<HTMLInputElement>(null);
  const transcriptInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('audio');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [workspaceId, setWorkspaceId] = useState(selectedWorkspaceId || workspaces[0]?.id || '');
  const [agenda, setAgenda] = useState('');
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [transcriptText, setTranscriptText] = useState('');

  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState({ bytesUploaded: 0, bytesTotal: 0 });
  const [fileLoading, setFileLoading] = useState<null | 'transcript' | 'agenda'>(null);

  function reset() {
    setTab('audio');
    setStep('form');
    setError(null);
    setTitle('');
    setWorkspaceId(selectedWorkspaceId || workspaces[0]?.id || '');
    setAgenda('');
    setAudioFiles([]);
    setTranscriptText('');
    setStatus('');
    setProgress({ bytesUploaded: 0, bytesTotal: 0 });
  }

  function handleClose() {
    reset();
    onClose();
  }

  function addAudioFiles(files: FileList | null) {
    if (!files) return;
    const valid = Array.from(files).filter((f) =>
      AUDIO_EXT.some((ext) => f.name.toLowerCase().endsWith(ext)) || f.type.startsWith('audio/')
    );
    if (valid.length === 0) {
      setError('Please choose an audio file (m4a, mp3, wav, …)');
      return;
    }
    setError(null);
    setAudioFiles((prev) => [...prev, ...valid]);
    if (!title && valid[0]) {
      setTitle(valid[0].name.replace(/\.[^.]+$/, ''));
    }
  }

  async function loadTranscriptFile(file: File) {
    const ok = TRANSCRIPT_EXT.some((ext) => file.name.toLowerCase().endsWith(ext)) ||
      file.type.startsWith('text/') || isPdf(file);
    if (!ok) {
      setError('Please choose a .txt, .vtt, .srt, or .pdf transcript file');
      return;
    }
    setError(null);
    setFileLoading('transcript');
    try {
      const text = await readFileText(file);
      if (!text.trim()) {
        setError('Could not read any text from that file (a scanned PDF has no text layer).');
        return;
      }
      setTranscriptText(text);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setError(err instanceof Error ? `Could not read file: ${err.message}` : 'Could not read file');
    } finally {
      setFileLoading(null);
    }
  }

  async function loadAgendaFile(file: File) {
    setError(null);
    setFileLoading('agenda');
    try {
      const text = await readFileText(file);
      if (!text.trim()) {
        setError('Could not read any text from that agenda file (a scanned PDF has no text layer).');
        return;
      }
      setAgenda((prev) => (prev ? prev + '\n' + text : text));
    } catch (err) {
      setError(err instanceof Error ? `Could not read file: ${err.message}` : 'Could not read file');
    } finally {
      setFileLoading(null);
    }
  }

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!workspaceId) {
      setError('Please choose a workspace');
      return;
    }
    if (!title.trim()) {
      setError('Please enter a meeting title');
      return;
    }
    if (tab === 'audio' && audioFiles.length === 0) {
      setError('Please add at least one audio file');
      return;
    }
    if (tab === 'transcript' && !transcriptText.trim()) {
      setError('Please paste or upload a transcript');
      return;
    }

    setStep('importing');

    try {
      const supabase = createClient();
      setStatus('Verifying account...');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated — please log in');

      setStatus('Creating meeting...');
      const { data: meeting, error: meetingErr } = await supabase
        .from('meetings')
        .insert({
          workspace_id: workspaceId,
          user_id: user.id,
          title: title.trim(),
          recorded_at: new Date().toISOString(),
          agenda_text: agenda.trim() || null,
        })
        .select()
        .single();
      if (meetingErr || !meeting) throw new Error(meetingErr?.message || 'Failed to create meeting');

      if (tab === 'audio') {
        // Read durations up front so totals/cost are accurate.
        const durations = await Promise.all(audioFiles.map(readAudioDuration));
        const totalBytes = audioFiles.reduce((s, f) => s + f.size, 0);
        let uploadedBytes = 0;

        for (let i = 0; i < audioFiles.length; i++) {
          const file = audioFiles[i];
          const partNumber = i + 1;
          setStatus(`Uploading audio ${i + 1} of ${audioFiles.length}...`);

          const { data: part, error: partErr } = await supabase
            .from('recording_parts')
            .insert({
              meeting_id: meeting.id,
              part_number: partNumber,
              audio_file_path: '',
              duration_seconds: durations[i],
              recorded_at: new Date().toISOString(),
            })
            .select()
            .single();
          if (partErr || !part) throw new Error(partErr?.message || 'Failed to create recording part');

          const upload = uploadAudio(user.id, meeting.id, partNumber, file, {
            onProgress: (bytesUp) => {
              setProgress({ bytesUploaded: uploadedBytes + bytesUp, bytesTotal: totalBytes });
            },
          });
          const filePath = await upload.promise;
          uploadedBytes += file.size;
          setProgress({ bytesUploaded: uploadedBytes, bytesTotal: totalBytes });

          await supabase
            .from('recording_parts')
            .update({ audio_file_path: filePath })
            .eq('id', part.id);
        }
      } else {
        // Transcript — store directly, no AssemblyAI needed.
        setStatus('Saving transcript...');
        const parsed = parseTranscript(transcriptText);

        const { data: part, error: partErr } = await supabase
          .from('recording_parts')
          .insert({
            meeting_id: meeting.id,
            part_number: 1,
            audio_file_path: '',
            duration_seconds: 0,
            recorded_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (partErr || !part) throw new Error(partErr?.message || 'Failed to create recording part');

        const { error: transErr } = await supabase.from('transcriptions').insert({
          recording_part_id: part.id,
          full_text: parsed.fullText,
          speakers: parsed.utterances,
          confidence_score: null,
          provider: 'manual',
          processing_level: 'transcription_only',
        });
        if (transErr) throw new Error(transErr.message || 'Failed to save transcript');
      }

      setStatus('Done!');
      setStep('done');
      showToast({ message: 'Upload complete', type: 'success' });
      setTimeout(() => {
        onUploadComplete();
        handleClose();
      }, 1200);
    } catch (err) {
      console.error('Upload failed:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
      setStep('form');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, title, workspaceId, agenda, audioFiles, transcriptText]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={handleClose} />

      <div className="relative w-full max-w-lg rounded-xl border border-border bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {step === 'done' ? 'Upload Complete' : 'Upload Meeting'}
          </h2>
          <button onClick={handleClose} className="rounded-lg p-1 text-muted hover:text-foreground transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-accent-rose/10 border border-accent-rose/20 px-3 py-2 text-sm text-accent-rose">
            {error}
          </div>
        )}

        {step === 'form' && (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex rounded-lg border border-border p-1 bg-surface">
              {(['audio', 'transcript'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted hover:text-foreground'
                  }`}
                >
                  {t === 'audio' ? 'Audio file' : 'Transcript'}
                </button>
              ))}
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Meeting title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. TBA Board Meeting — June"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            {/* Workspace */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Workspace</label>
              <select
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>{ws.name}</option>
                ))}
              </select>
            </div>

            {/* Audio tab */}
            {tab === 'audio' && (
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Audio file(s)</label>
                <div
                  onClick={() => audioInputRef.current?.click()}
                  onDrop={(e) => { e.preventDefault(); addAudioFiles(e.dataTransfer.files); }}
                  onDragOver={(e) => e.preventDefault()}
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border p-6 hover:border-primary-300 hover:bg-primary-50/50 transition-colors"
                >
                  <svg className="mb-2 h-8 w-8 text-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-sm font-medium text-foreground">Drop voice memo / audio here</p>
                  <p className="mt-0.5 text-xs text-muted">m4a, mp3, wav — multiple files become parts</p>
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*,.m4a,.mp3,.wav,.aac,.webm,.ogg,.flac"
                    multiple
                    onChange={(e) => addAudioFiles(e.target.files)}
                    className="hidden"
                  />
                </div>
                {audioFiles.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {audioFiles.map((f, i) => (
                      <li key={i} className="flex items-center justify-between rounded-lg bg-surface px-3 py-1.5 text-sm">
                        <span className="truncate text-foreground">Part {i + 1}: {f.name}</span>
                        <button
                          onClick={() => setAudioFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="ml-2 text-muted hover:text-accent-rose"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Transcript tab */}
            {tab === 'transcript' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-muted">Transcript</label>
                  <button
                    onClick={() => transcriptInputRef.current?.click()}
                    disabled={fileLoading !== null}
                    className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50"
                  >
                    {fileLoading === 'transcript' ? 'Reading…' : 'Load from file (.txt, .pdf, …)'}
                  </button>
                  <input
                    ref={transcriptInputRef}
                    type="file"
                    accept=".txt,.vtt,.srt,.md,.pdf,application/pdf,text/*"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) loadTranscriptFile(f); e.target.value = ''; }}
                    className="hidden"
                  />
                </div>
                <textarea
                  value={transcriptText}
                  onChange={(e) => setTranscriptText(e.target.value)}
                  placeholder={'Paste your transcript here.\n\nSupports plain text, "Speaker A: ..." lines, or .vtt/.srt with timestamps.'}
                  rows={6}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <p className="mt-1 text-xs text-muted">No transcription needed — go straight to summary &amp; analysis.</p>
              </div>
            )}

            {/* Agenda (shared, optional) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-muted">Agenda / reference <span className="font-normal">(optional)</span></label>
                <button
                  onClick={() => { const el = document.getElementById('agenda-file') as HTMLInputElement; el?.click(); }}
                  disabled={fileLoading !== null}
                  className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50"
                >
                  {fileLoading === 'agenda' ? 'Reading…' : 'Load from file (.txt, .pdf, …)'}
                </button>
                <input
                  id="agenda-file"
                  type="file"
                  accept=".txt,.md,.pdf,application/pdf,text/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) loadAgendaFile(f); e.target.value = ''; }}
                  className="hidden"
                />
              </div>
              <textarea
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                placeholder="Paste the agenda so the summary, decisions, and action items are organized around it."
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={handleClose}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
              >
                Upload
              </button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="py-4">
            <div className="mb-4 flex items-center gap-3">
              <svg className="h-5 w-5 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-foreground">{status}</p>
            </div>
            {progress.bytesTotal > 0 && (
              <UploadProgressBar
                bytesUploaded={progress.bytesUploaded}
                bytesTotal={progress.bytesTotal}
                label="Uploading audio..."
              />
            )}
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center py-6">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">Uploaded</p>
            <p className="mt-1 text-xs text-muted">Open the meeting and click Process to analyze it.</p>
          </div>
        )}
      </div>
    </div>
  );
}
