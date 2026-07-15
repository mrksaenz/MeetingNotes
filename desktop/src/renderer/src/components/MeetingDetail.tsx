import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Meeting, ProcessingLevel, ProcessingProgress } from '@shared/types';
import { useToast } from '../lib/toast';
import ProcessModal from './ProcessModal';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function progressLabel(p: ProcessingProgress): string {
  switch (p.stage) {
    case 'uploading':
      return `Uploading part ${p.partNumber}${p.partCount ? ` of ${p.partCount}` : ''}…`;
    case 'transcribing':
      return `Transcribing part ${p.partNumber}${p.partCount ? ` of ${p.partCount}` : ''}… (long recordings take a while)`;
    case 'summarizing':
      return 'Summarizing with Claude…';
    default:
      return '';
  }
}

export default function MeetingDetail({
  meetingId,
  onBack,
  onRecordPart,
}: {
  meetingId: string;
  onBack: () => void;
  onRecordPart: (meetingId: string, meetingTitle: string) => void;
}) {
  const toast = useToast();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMeeting(await window.api.getMeeting(meetingId));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to load meeting');
    }
  }, [meetingId, toast]);

  useEffect(() => {
    refresh();
    window.api.isProcessing(meetingId).then((running) => {
      if (running) setProgress({ meetingId, stage: 'transcribing' });
    });
  }, [refresh, meetingId]);

  useEffect(() => {
    return window.api.onProcessingProgress((p) => {
      if (p.meetingId !== meetingId) return;
      if (p.stage === 'done') {
        setProgress(null);
        toast('success', 'Processing complete');
        refresh();
      } else if (p.stage === 'error') {
        setProgress(null);
        toast('error', p.message || 'Processing failed');
        refresh();
      } else {
        setProgress(p);
      }
    });
  }, [meetingId, refresh, toast]);

  const speakers = useMemo(() => {
    if (!meeting) return [];
    const set = new Set<string>();
    for (const part of meeting.parts) {
      for (const u of part.transcription?.utterances ?? []) set.add(u.speaker);
    }
    return Array.from(set).sort();
  }, [meeting]);

  if (!meeting) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Loading meeting…
      </div>
    );
  }

  const speakerName = (s: string) => meeting.speakerLabels[s] || `Speaker ${s}`;
  const hasTranscription = meeting.parts.some((p) => p.transcription);
  const hasUntranscribedAudio = meeting.parts.some((p) => !p.transcription && p.audioFile);
  const isBusy = progress !== null;

  async function startProcessing(level: ProcessingLevel) {
    setShowProcessModal(false);
    setProgress({ meetingId, stage: 'uploading' });
    try {
      await window.api.processMeeting(meetingId, level);
    } catch {
      // The error toast is raised by the progress listener.
    }
  }

  async function saveSpeakerLabel(speaker: string) {
    setEditingSpeaker(null);
    const name = speakerDraft.trim();
    const labels = { ...meeting!.speakerLabels };
    if (name) labels[speaker] = name;
    else delete labels[speaker];
    try {
      setMeeting(await window.api.updateMeeting(meetingId, { speakerLabels: labels }));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save speaker name');
    }
  }

  async function runExport(format: 'pdf' | 'docx') {
    setExporting(format);
    try {
      const result = await window.api.exportMeeting(meetingId, format);
      toast('success', `Saved ${result.fileName} to the meeting's exports folder`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  }

  async function handleDelete() {
    if (!confirm(`Move "${meeting!.title}" to the Trash?\n\nThe whole meeting folder (audio, transcripts, exports) will be moved to the Trash.`)) return;
    try {
      await window.api.deleteMeeting(meetingId);
      toast('success', 'Meeting moved to the Trash');
      onBack();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to delete meeting');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="titlebar-drag flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white pr-5 pl-24">
        <button onClick={onBack} className="text-sm font-medium text-blue-600 hover:text-blue-700">
          ← Meetings
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.api.revealMeeting(meetingId)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
            title="Show the meeting folder in Finder"
          >
            Show in Finder
          </button>
          {hasTranscription && (
            <>
              <button
                onClick={() => runExport('pdf')}
                disabled={exporting !== null}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
              </button>
              <button
                onClick={() => runExport('docx')}
                disabled={exporting !== null}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {exporting === 'docx' ? 'Exporting…' : 'Export Word'}
              </button>
            </>
          )}
          <button
            onClick={() => setShowProcessModal(true)}
            disabled={isBusy || meeting.parts.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isBusy ? 'Processing…' : 'Process'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{meeting.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {formatDate(meeting.recordedAt)} · {meeting.parts.length} part
              {meeting.parts.length !== 1 ? 's' : ''}
            </p>
          </div>

          {progress && progress.stage !== 'done' && progress.stage !== 'error' && (
            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <p className="text-sm font-medium text-blue-800">{progressLabel(progress)}</p>
            </div>
          )}

          {meeting.agendaText && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-xs font-bold tracking-wide text-slate-400 uppercase">Agenda</h2>
              <p className="selectable text-sm whitespace-pre-wrap text-slate-700">{meeting.agendaText}</p>
            </div>
          )}

          {meeting.summary && (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <div>
                <h2 className="mb-2 text-xs font-bold tracking-wide text-slate-400 uppercase">
                  Executive summary
                </h2>
                <p className="selectable text-sm leading-relaxed text-slate-800">
                  {meeting.summary.executiveSummary}
                </p>
              </div>
              {meeting.summary.keyPoints.length > 0 && (
                <div>
                  <h2 className="mb-2 text-xs font-bold tracking-wide text-slate-400 uppercase">Key points</h2>
                  <ul className="selectable list-disc space-y-1 pl-5 text-sm text-slate-800">
                    {meeting.summary.keyPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {meeting.summary.decisions && meeting.summary.decisions.length > 0 && (
                <div>
                  <h2 className="mb-2 text-xs font-bold tracking-wide text-slate-400 uppercase">Decisions</h2>
                  <ul className="selectable list-disc space-y-1 pl-5 text-sm text-slate-800">
                    {meeting.summary.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {meeting.summary.actionItems && meeting.summary.actionItems.length > 0 && (
                <div>
                  <h2 className="mb-2 text-xs font-bold tracking-wide text-slate-400 uppercase">Action items</h2>
                  <ul className="selectable space-y-2 text-sm text-slate-800">
                    {meeting.summary.actionItems.map((item, i) => (
                      <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
                        <span className="font-medium">{item.action}</span>
                        {(item.owner || item.deadline) && (
                          <span className="ml-2 text-xs text-slate-500">
                            {[item.owner && `Owner: ${item.owner}`, item.deadline && `Due: ${item.deadline}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {speakers.length > 1 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-xs font-bold tracking-wide text-slate-400 uppercase">
                Speakers <span className="font-normal normal-case">— click to rename</span>
              </h2>
              <div className="flex flex-wrap gap-2">
                {speakers.map((s) =>
                  editingSpeaker === s ? (
                    <input
                      key={s}
                      autoFocus
                      value={speakerDraft}
                      onChange={(e) => setSpeakerDraft(e.target.value)}
                      onBlur={() => saveSpeakerLabel(s)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveSpeakerLabel(s);
                        if (e.key === 'Escape') setEditingSpeaker(null);
                      }}
                      className="rounded-full border border-blue-400 px-3 py-1 text-sm focus:outline-none"
                    />
                  ) : (
                    <button
                      key={s}
                      onClick={() => {
                        setEditingSpeaker(s);
                        setSpeakerDraft(meeting.speakerLabels[s] || '');
                      }}
                      className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 hover:bg-blue-200"
                    >
                      {speakerName(s)}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {meeting.parts.map((part) => (
              <div key={part.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">
                    Part {part.partNumber}
                    {part.durationSeconds
                      ? ` · ${Math.round(part.durationSeconds / 60)} min`
                      : ''}
                  </h2>
                  {part.transcription ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      {part.transcription.source === 'manual' ? 'Manual transcript' : 'Transcribed'}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      Not transcribed
                    </span>
                  )}
                </div>

                {part.transcription?.utterances ? (
                  <div className="selectable max-h-96 space-y-3 overflow-y-auto pr-2">
                    {part.transcription.utterances.map((u, i) => (
                      <div key={i}>
                        <p className="text-xs font-semibold text-blue-600">
                          {speakerName(u.speaker)}
                          {u.start > 0 && (
                            <span className="ml-1.5 font-normal text-slate-400">
                              {formatTimestamp(u.start)}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-sm leading-relaxed text-slate-800">{u.text}</p>
                      </div>
                    ))}
                  </div>
                ) : part.transcription ? (
                  <p className="selectable max-h-96 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-slate-800">
                    {part.transcription.fullText}
                  </p>
                ) : (
                  <p className="text-sm text-slate-400">
                    Audio saved ({part.audioFile}). Click Process to transcribe.
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 pb-8">
            <div className="flex gap-2">
              <button
                onClick={() => onRecordPart(meetingId, meeting.title)}
                disabled={isBusy}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                ● Record another part
              </button>
            </div>
            <button
              onClick={handleDelete}
              disabled={isBusy}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
            >
              Move to Trash
            </button>
          </div>
        </div>
      </div>

      {showProcessModal && (
        <ProcessModal
          hasUntranscribedAudio={hasUntranscribedAudio}
          onClose={() => setShowProcessModal(false)}
          onStart={startProcessing}
        />
      )}
    </div>
  );
}
