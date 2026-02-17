'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import ProcessModal from './ProcessModal';
import { exportToPdf, exportToDocx } from '@/lib/exportMeeting';
import type { Meeting, RecordingPart, Transcription, Summary, ProcessingLevel } from '@/types/database';

interface MeetingWithParts extends Meeting {
  recording_parts: RecordingPart[];
}

interface TranscriptionWithSummary extends Transcription {
  summaries: Summary[];
}

interface MeetingDetailProps {
  meeting: MeetingWithParts;
  onBack: () => void;
  onRefresh: () => void;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function MeetingDetail({ meeting, onBack, onRefresh }: MeetingDetailProps) {
  const [transcriptions, setTranscriptions] = useState<Map<string, TranscriptionWithSummary>>(new Map());
  const [loadingTranscriptions, setLoadingTranscriptions] = useState(true);
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);

  // Speaker rename state
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>(
    meeting.speaker_labels || {}
  );
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Export dropdown state
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Collect unique speakers across all transcriptions
  const allSpeakers = useMemo(() => {
    const speakers = new Set<string>();
    transcriptions.forEach((t) => {
      if (t.speakers) {
        t.speakers.forEach((u) => speakers.add(u.speaker));
      }
    });
    return Array.from(speakers).sort();
  }, [transcriptions]);

  function getSpeakerName(speaker: string): string {
    return speakerLabels[speaker] || `Speaker ${speaker}`;
  }

  const fetchTranscriptions = useCallback(async () => {
    const supabase = createClient();
    const partIds = meeting.recording_parts.map((p) => p.id);
    if (partIds.length === 0) {
      setLoadingTranscriptions(false);
      return;
    }

    const { data, error } = await supabase
      .from('transcriptions')
      .select('*, summaries(*)')
      .in('recording_part_id', partIds);

    if (!error && data) {
      const map = new Map<string, TranscriptionWithSummary>();
      data.forEach((t: TranscriptionWithSummary) => {
        map.set(t.recording_part_id, t);
      });
      setTranscriptions(map);
    }
    setLoadingTranscriptions(false);
  }, [meeting.recording_parts]);

  useEffect(() => {
    fetchTranscriptions();
  }, [fetchTranscriptions]);

  // Poll for updates while any part is processing
  useEffect(() => {
    const hasProcessing = meeting.recording_parts.some(
      (p) => p.processing_status === 'processing'
    );
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      onRefresh();
      fetchTranscriptions();
    }, 5000);

    return () => clearInterval(interval);
  }, [meeting.recording_parts, onRefresh, fetchTranscriptions]);

  // Focus input when editing a speaker
  useEffect(() => {
    if (editingSpeaker && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSpeaker]);

  // Close export menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    }
    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showExportMenu]);

  // ─── Speaker Rename ──────────────────────────────────────────────────

  function startEditingSpeaker(speaker: string) {
    setEditingSpeaker(speaker);
    setEditValue(speakerLabels[speaker] || '');
  }

  async function saveSpeakerLabel() {
    if (!editingSpeaker) return;
    const trimmed = editValue.trim();
    const newLabels = { ...speakerLabels };

    if (trimmed) {
      newLabels[editingSpeaker] = trimmed;
    } else {
      delete newLabels[editingSpeaker];
    }

    setSpeakerLabels(newLabels);
    setEditingSpeaker(null);

    // Persist to database
    const supabase = createClient();
    await supabase
      .from('meetings')
      .update({ speaker_labels: newLabels })
      .eq('id', meeting.id);
  }

  function cancelEditingSpeaker() {
    setEditingSpeaker(null);
    setEditValue('');
  }

  // ─── Processing ──────────────────────────────────────────────────────

  async function handleProcess(partIds: string[], level: ProcessingLevel) {
    setProcessing(true);
    setProcessingError(null);

    for (const partId of partIds) {
      try {
        const response = await fetch('/api/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recordingPartId: partId,
            processingLevel: level,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Processing failed');
        }
      } catch (err) {
        setProcessingError(err instanceof Error ? err.message : 'Processing failed');
        break;
      }
    }

    setProcessing(false);
    setShowProcessModal(false);
    onRefresh();
    fetchTranscriptions();
  }

  // ─── Export ──────────────────────────────────────────────────────────

  function handleExport(format: 'pdf' | 'docx') {
    setShowExportMenu(false);
    const exportData = {
      meeting,
      transcriptions,
      speakerLabels,
    };
    if (format === 'pdf') {
      exportToPdf(exportData);
    } else {
      exportToDocx(exportData);
    }
  }

  const parts = meeting.recording_parts;
  const totalDuration = parts.reduce((sum, p) => sum + p.duration_seconds, 0);
  const hasUnprocessed = parts.some(
    (p) => p.processing_status === 'unprocessed' || p.processing_status === 'failed'
  );
  const hasProcessingInProgress = parts.some((p) => p.processing_status === 'processing');
  const hasTranscriptions = transcriptions.size > 0;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to meetings
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{meeting.title}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted">
              <span>
                {new Date(meeting.recorded_at).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              <span>{parts.length} part{parts.length !== 1 ? 's' : ''}</span>
              {totalDuration > 0 && <span>{formatDuration(totalDuration)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Export button */}
            {hasTranscriptions && (
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-surface transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Export
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 top-full mt-1 z-10 w-44 rounded-lg border border-border bg-background shadow-lg">
                    <button
                      onClick={() => handleExport('pdf')}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-surface transition-colors rounded-t-lg"
                    >
                      <svg className="h-4 w-4 text-accent-rose" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      Download PDF
                    </button>
                    <button
                      onClick={() => handleExport('docx')}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-surface transition-colors rounded-b-lg"
                    >
                      <svg className="h-4 w-4 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      Download DOCX
                    </button>
                  </div>
                )}
              </div>
            )}
            {hasUnprocessed && !hasProcessingInProgress && (
              <button
                onClick={() => setShowProcessModal(true)}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
              >
                Process
              </button>
            )}
            {hasProcessingInProgress && (
              <div className="flex items-center gap-2 rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-700">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing...
              </div>
            )}
          </div>
        </div>
      </div>

      {processingError && (
        <div className="mb-4 rounded-lg bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
          {processingError}
        </div>
      )}

      {/* Speaker Labels Panel */}
      {allSpeakers.length > 1 && (
        <div className="mb-6 rounded-xl border border-border bg-background px-4 py-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted mb-2">
            Speakers
            <span className="ml-2 font-normal normal-case tracking-normal">— click to rename</span>
          </h4>
          <div className="flex flex-wrap gap-2">
            {allSpeakers.map((speaker) => (
              <div key={speaker}>
                {editingSpeaker === speaker ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveSpeakerLabel();
                    }}
                  >
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-medium text-primary-700">
                      {speaker}
                    </span>
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={saveSpeakerLabel}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') cancelEditingSpeaker();
                      }}
                      placeholder={`Speaker ${speaker}`}
                      className="w-36 rounded-md border border-primary-300 bg-background px-2 py-1 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </form>
                ) : (
                  <button
                    onClick={() => startEditingSpeaker(speaker)}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-sm text-foreground hover:border-primary-300 hover:bg-primary-50 transition-colors"
                  >
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-xs font-medium text-primary-700">
                      {speaker}
                    </span>
                    {getSpeakerName(speaker)}
                    <svg className="h-3 w-3 text-muted" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Parts with transcriptions */}
      {loadingTranscriptions ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-muted">
            <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading...
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {parts.map((part) => {
            const transcription = transcriptions.get(part.id);
            const summary = transcription?.summaries?.[0];

            return (
              <div key={part.id} className="rounded-xl border border-border bg-background">
                {/* Part header */}
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-foreground">
                      Part {part.part_number}
                    </span>
                    <span className="text-xs text-muted">
                      {formatDuration(part.duration_seconds)}
                    </span>
                  </div>
                  <StatusBadge status={part.processing_status} />
                </div>

                {/* Summary section */}
                {summary && (
                  <div className="border-b border-border px-4 py-4">
                    {summary.executive_summary && (
                      <div className="mb-3">
                        <h4 className="text-xs font-medium uppercase tracking-wider text-muted mb-1">Summary</h4>
                        <p className="text-sm text-foreground leading-relaxed">{summary.executive_summary}</p>
                      </div>
                    )}

                    {summary.key_points && summary.key_points.length > 0 && (
                      <div className="mb-3">
                        <h4 className="text-xs font-medium uppercase tracking-wider text-muted mb-1">Key Points</h4>
                        <ul className="space-y-1">
                          {summary.key_points.map((point, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary-400 shrink-0" />
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {summary.decisions && summary.decisions.length > 0 && (
                      <div className="mb-3">
                        <h4 className="text-xs font-medium uppercase tracking-wider text-muted mb-1">Decisions</h4>
                        <ul className="space-y-1">
                          {summary.decisions.map((decision, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent-emerald shrink-0" />
                              {decision}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {summary.action_items && summary.action_items.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium uppercase tracking-wider text-muted mb-1">Action Items</h4>
                        <ul className="space-y-2">
                          {summary.action_items.map((item, i) => (
                            <li key={i} className="rounded-lg bg-surface px-3 py-2">
                              <p className="text-sm font-medium text-foreground">
                                {typeof item === 'string' ? item : item.action}
                              </p>
                              {typeof item !== 'string' && (item.owner || item.deadline) && (
                                <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                                  {item.owner && <span>Owner: {item.owner}</span>}
                                  {item.deadline && <span>Due: {item.deadline}</span>}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Transcription text */}
                {transcription && (
                  <div className="px-4 py-4">
                    <h4 className="text-xs font-medium uppercase tracking-wider text-muted mb-2">Transcription</h4>
                    {transcription.speakers && transcription.speakers.length > 0 ? (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {transcription.speakers.map((utterance, i) => (
                          <div key={i} className="flex gap-3">
                            <div className="shrink-0">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-medium text-primary-700">
                                {utterance.speaker}
                              </span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-medium text-foreground">
                                  {getSpeakerName(utterance.speaker)}
                                </span>
                                {'start' in utterance && typeof utterance.start === 'number' && (
                                  <span className="text-xs text-muted">
                                    {formatTimestamp(utterance.start)}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-foreground leading-relaxed">
                                {utterance.text}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                        {transcription.full_text}
                      </p>
                    )}
                  </div>
                )}

                {/* Unprocessed state */}
                {!transcription && part.processing_status === 'unprocessed' && (
                  <div className="px-4 py-8 text-center text-sm text-muted">
                    Recording not yet processed. Click &quot;Process&quot; to transcribe.
                  </div>
                )}

                {/* Processing state */}
                {part.processing_status === 'processing' && !transcription && (
                  <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing transcription...
                  </div>
                )}

                {/* Failed state */}
                {part.processing_status === 'failed' && !transcription && (
                  <div className="px-4 py-8 text-center text-sm text-accent-rose">
                    Processing failed. Try again.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Process modal */}
      <ProcessModal
        open={showProcessModal}
        parts={parts}
        onClose={() => setShowProcessModal(false)}
        onProcess={handleProcess}
        processing={processing}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    unprocessed: 'bg-surface text-muted',
    processing: 'bg-primary-50 text-primary-600',
    completed: 'bg-accent-emerald/10 text-accent-emerald',
    failed: 'bg-accent-rose/10 text-accent-rose',
  };

  const labels: Record<string, string> = {
    unprocessed: 'Unprocessed',
    processing: 'Processing',
    completed: 'Processed',
    failed: 'Failed',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || styles.unprocessed}`}>
      {status === 'processing' && (
        <svg className="mr-1 h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {labels[status] || 'Unknown'}
    </span>
  );
}
