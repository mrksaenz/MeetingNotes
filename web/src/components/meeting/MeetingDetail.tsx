'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import ProcessModal from './ProcessModal';
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

  const supabase = createClient();

  const fetchTranscriptions = useCallback(async () => {
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
  }, [meeting.recording_parts, supabase]);

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

  const parts = meeting.recording_parts;
  const totalDuration = parts.reduce((sum, p) => sum + p.duration_seconds, 0);
  const hasUnprocessed = parts.some(
    (p) => p.processing_status === 'unprocessed' || p.processing_status === 'failed'
  );
  const hasProcessingInProgress = parts.some((p) => p.processing_status === 'processing');

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

      {processingError && (
        <div className="mb-4 rounded-lg bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
          {processingError}
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
                                  Speaker {utterance.speaker}
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
