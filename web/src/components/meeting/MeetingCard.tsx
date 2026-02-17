'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import MeetingNotesIcon from '@/components/icons/MeetingNotesIcon';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ProcessModal from './ProcessModal';
import type { Meeting, RecordingPart, Transcription, Summary, ProcessingLevel } from '@/types/database';

interface MeetingWithParts extends Meeting {
  recording_parts: RecordingPart[];
}

interface TranscriptionWithSummary extends Transcription {
  summaries: Summary[];
}

interface MeetingCardProps {
  meeting: MeetingWithParts;
  onContinue: (meeting: MeetingWithParts) => void;
  onRefresh: () => void;
  onDelete: (meetingId: string) => Promise<void>;
  onArchive: (meetingId: string) => Promise<void>;
  onViewDetail: (meeting: MeetingWithParts) => void;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
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

function getStatusBadge(parts: RecordingPart[]) {
  if (parts.length === 0) return null;

  const allCompleted = parts.every((p) => p.processing_status === 'completed');
  const anyProcessing = parts.some((p) => p.processing_status === 'processing');
  const anyFailed = parts.some((p) => p.processing_status === 'failed');

  if (allCompleted) {
    return (
      <span className="inline-flex items-center rounded-full bg-accent-emerald/10 px-2 py-0.5 text-xs font-medium text-accent-emerald">
        Processed
      </span>
    );
  }
  if (anyProcessing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600">
        <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Processing
      </span>
    );
  }
  if (anyFailed) {
    return (
      <span className="inline-flex items-center rounded-full bg-accent-rose/10 px-2 py-0.5 text-xs font-medium text-accent-rose">
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted">
      Unprocessed
    </span>
  );
}

function getPreviewText(transcription: TranscriptionWithSummary | undefined): string | null {
  if (!transcription) return null;
  const summary = transcription.summaries?.[0];
  if (summary?.executive_summary) {
    return summary.executive_summary;
  }
  if (transcription.full_text) {
    return transcription.full_text;
  }
  return null;
}

function truncateText(text: string, maxLength: number = 120): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
}

export default function MeetingCard({ meeting, onContinue, onRefresh, onDelete, onArchive, onViewDetail }: MeetingCardProps) {
  const parts = meeting.recording_parts;
  const totalDuration = parts.reduce((sum, p) => sum + p.duration_seconds, 0);

  // Track which parts are expanded
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());

  // Delete/Archive confirmation
  const [confirmAction, setConfirmAction] = useState<'delete' | 'archive' | null>(null);

  // Transcription data (lazy-loaded)
  const [transcriptions, setTranscriptions] = useState<Map<string, TranscriptionWithSummary>>(new Map());
  const [loadedParts, setLoadedParts] = useState<Set<string>>(new Set());
  const [loadingParts, setLoadingParts] = useState<Set<string>>(new Set());

  // Process modal
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [processingPartIds, setProcessingPartIds] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);

  const supabase = createClient();

  const fetchTranscriptionForPart = useCallback(async (partId: string) => {
    if (loadedParts.has(partId) || loadingParts.has(partId)) return;

    setLoadingParts((prev) => new Set(prev).add(partId));

    const { data, error } = await supabase
      .from('transcriptions')
      .select('*, summaries(*)')
      .eq('recording_part_id', partId);

    if (!error && data && data.length > 0) {
      setTranscriptions((prev) => {
        const next = new Map(prev);
        next.set(partId, data[0] as TranscriptionWithSummary);
        return next;
      });
    }

    setLoadedParts((prev) => new Set(prev).add(partId));
    setLoadingParts((prev) => {
      const next = new Set(prev);
      next.delete(partId);
      return next;
    });
  }, [loadedParts, loadingParts, supabase]);

  // Fetch preview data for all completed parts (just the first line)
  useEffect(() => {
    const completedPartIds = parts
      .filter((p) => p.processing_status === 'completed')
      .map((p) => p.id)
      .filter((id) => !loadedParts.has(id) && !loadingParts.has(id));

    if (completedPartIds.length === 0) return;

    async function fetchAll() {
      const { data, error } = await supabase
        .from('transcriptions')
        .select('*, summaries(*)')
        .in('recording_part_id', completedPartIds);

      if (!error && data) {
        setTranscriptions((prev) => {
          const next = new Map(prev);
          data.forEach((t: TranscriptionWithSummary) => {
            next.set(t.recording_part_id, t);
          });
          return next;
        });
        setLoadedParts((prev) => {
          const next = new Set(prev);
          completedPartIds.forEach((id) => next.add(id));
          return next;
        });
      }
    }

    fetchAll();
  }, [parts, supabase, loadedParts, loadingParts]);

  // Poll for updates while any part is processing
  useEffect(() => {
    const hasProcessing = parts.some((p) => p.processing_status === 'processing');
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      onRefresh();
      // Re-fetch transcriptions for processing parts
      const processingIds = parts
        .filter((p) => p.processing_status === 'processing')
        .map((p) => p.id);
      processingIds.forEach((id) => {
        setLoadedParts((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [parts, onRefresh]);

  function togglePart(partId: string) {
    setExpandedParts((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) {
        next.delete(partId);
      } else {
        next.add(partId);
        // Lazy-load transcription data when expanding
        fetchTranscriptionForPart(partId);
      }
      return next;
    });
  }

  function handleProcessPart(partId: string) {
    setProcessingPartIds([partId]);
    setShowProcessModal(true);
  }

  function handleProcessAll() {
    const unprocessedIds = parts
      .filter((p) => p.processing_status === 'unprocessed' || p.processing_status === 'failed')
      .map((p) => p.id);
    setProcessingPartIds(unprocessedIds);
    setShowProcessModal(true);
  }

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
    // Clear loaded cache so data refreshes
    setLoadedParts(new Set());
  }

  const hasUnprocessed = parts.some(
    (p) => p.processing_status === 'unprocessed' || p.processing_status === 'failed'
  );
  const hasProcessingInProgress = parts.some((p) => p.processing_status === 'processing');

  return (
    <>
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        {/* Meeting header */}
        <div className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <button
                onClick={() => onViewDetail(meeting)}
                className="flex items-center gap-1.5 text-left font-medium text-primary-600 hover:text-primary-700 transition-colors"
              >
                <span className="truncate">{meeting.title}</span>
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                <span>{formatDate(meeting.recorded_at)}</span>
                <span>{formatTime(meeting.recorded_at)}</span>
                {totalDuration > 0 && <span>{formatDuration(totalDuration)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasUnprocessed && !hasProcessingInProgress && parts.length > 1 && (
                <button
                  onClick={handleProcessAll}
                  className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 transition-colors"
                >
                  Process all
                </button>
              )}
              {getStatusBadge(parts)}
              {/* Archive button */}
              <button
                onClick={() => setConfirmAction('archive')}
                className="rounded-md p-1.5 text-muted hover:text-primary-600 hover:bg-primary-50 transition-colors"
                title="Archive meeting"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
              </button>
              {/* Delete button */}
              <button
                onClick={() => setConfirmAction('delete')}
                className="rounded-md p-1.5 text-muted hover:text-accent-rose hover:bg-accent-rose/10 transition-colors"
                title="Delete meeting"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>
          </div>

          {processingError && (
            <div className="mt-3 rounded-lg bg-accent-rose/10 px-3 py-2 text-xs text-accent-rose">
              {processingError}
            </div>
          )}
        </div>

        {/* Parts */}
        {parts.length > 0 && (
          <div className="border-t border-border">
            {parts.map((part, index) => {
              const isExpanded = expandedParts.has(part.id);
              const transcription = transcriptions.get(part.id);
              const isLoading = loadingParts.has(part.id);
              const previewText = getPreviewText(transcription);
              const isUnprocessed = part.processing_status === 'unprocessed' || part.processing_status === 'failed';
              const isProcessing = part.processing_status === 'processing';

              return (
                <div
                  key={part.id}
                  className={index < parts.length - 1 ? 'border-b border-border' : ''}
                >
                  {/* Part row */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <MeetingNotesIcon className="h-4 w-4 text-primary-500" />
                      <span className="text-sm font-medium text-foreground">
                        Part {part.part_number}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isUnprocessed && !hasProcessingInProgress && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleProcessPart(part.id);
                          }}
                          className="rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700 transition-colors"
                        >
                          Process
                        </button>
                      )}
                      {isProcessing && (
                        <span className="flex items-center gap-1.5 text-xs text-primary-600">
                          <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Processing
                        </span>
                      )}
                      <span className="text-xs text-muted">
                        {formatDuration(part.duration_seconds)}
                      </span>
                    </div>
                  </div>

                  {/* Preview / Expandable card */}
                  {(previewText || isUnprocessed || isProcessing) && (
                    <div className="px-4 pb-3">
                      <button
                        onClick={() => previewText && togglePart(part.id)}
                        disabled={!previewText}
                        className={`w-full rounded-lg bg-surface px-3 py-2.5 text-left transition-colors ${
                          previewText ? 'hover:bg-primary-50/50 cursor-pointer' : 'cursor-default'
                        }`}
                      >
                        {isProcessing && !previewText && (
                          <div className="flex items-center gap-2 text-xs text-muted">
                            <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Processing transcription...
                          </div>
                        )}

                        {isUnprocessed && !previewText && (
                          <p className="text-xs text-muted">
                            {part.processing_status === 'failed'
                              ? 'Processing failed. Tap Process to retry.'
                              : 'Not yet processed. Tap Process to transcribe.'}
                          </p>
                        )}

                        {previewText && (
                          <div>
                            {/* Preview line + chevron */}
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm text-foreground leading-relaxed flex-1">
                                {isExpanded ? '' : truncateText(previewText)}
                              </p>
                              {!isExpanded && (
                                <svg className="h-4 w-4 text-muted shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                                </svg>
                              )}
                            </div>

                            {/* Expanded content */}
                            {isExpanded && transcription && (
                              <ExpandedPartContent
                                transcription={transcription}
                                isLoading={isLoading}
                                onCollapse={() => togglePart(part.id)}
                              />
                            )}
                          </div>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Card footer actions */}
        <div className="border-t border-border px-4 py-3 flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onContinue(meeting);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Continue meeting
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewDetail(meeting);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            View Notes &amp; Export
          </button>
        </div>
      </div>

      {/* Process modal */}
      <ProcessModal
        open={showProcessModal}
        parts={parts.filter((p) => processingPartIds.includes(p.id))}
        onClose={() => setShowProcessModal(false)}
        onProcess={handleProcess}
        processing={processing}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmAction === 'delete'}
        title="Delete meeting"
        message={`Are you sure you want to delete "${meeting.title}"? This will permanently remove the meeting, all recordings, transcriptions, and summaries. This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={async () => {
          setConfirmAction(null);
          await onDelete(meeting.id);
        }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Archive confirmation */}
      <ConfirmDialog
        open={confirmAction === 'archive'}
        title="Archive meeting"
        message={`Are you sure you want to archive "${meeting.title}"? It will be hidden from the main view but can be restored later.`}
        confirmLabel="Archive"
        confirmVariant="primary"
        onConfirm={async () => {
          setConfirmAction(null);
          await onArchive(meeting.id);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
}

/** Expanded content for a part — shows collapsible sections */
function ExpandedPartContent({
  transcription,
  isLoading,
  onCollapse,
}: {
  transcription: TranscriptionWithSummary;
  isLoading: boolean;
  onCollapse: () => void;
}) {
  const summary = transcription.summaries?.[0];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted">
        <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading...
      </div>
    );
  }

  return (
    <div className="mt-1">
      {/* Collapse button */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">Notes</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCollapse();
          }}
          className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* Collapsible summary sections */}
      {summary?.executive_summary && (
        <CollapsibleSection title="Executive Summary" defaultOpen>
          <p className="text-sm text-foreground leading-relaxed">
            {summary.executive_summary}
          </p>
        </CollapsibleSection>
      )}

      {summary?.key_points && summary.key_points.length > 0 && (
        <CollapsibleSection title="Key Points">
          <ul className="space-y-1.5">
            {summary.key_points.map((point, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary-400 shrink-0" />
                {point}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {summary?.decisions && summary.decisions.length > 0 && (
        <CollapsibleSection title="Decisions">
          <ul className="space-y-1.5">
            {summary.decisions.map((decision, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent-emerald shrink-0" />
                {decision}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {summary?.action_items && summary.action_items.length > 0 && (
        <CollapsibleSection title="Action Items">
          <ul className="space-y-2">
            {summary.action_items.map((item, i) => (
              <li key={i} className="rounded-md bg-background px-2.5 py-2">
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
        </CollapsibleSection>
      )}

      {/* Full Transcript */}
      <CollapsibleSection title="Full Transcript">
        {transcription.speakers && transcription.speakers.length > 0 ? (
          <div className="space-y-2.5 max-h-72 overflow-y-auto">
            {transcription.speakers.map((utterance, i) => (
              <div key={i} className="flex gap-2.5">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-[10px] font-medium text-primary-700 shrink-0">
                  {utterance.speaker}
                </span>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-foreground">
                      Speaker {utterance.speaker}
                    </span>
                    {'start' in utterance && typeof (utterance as Record<string, unknown>).start === 'number' && (
                      <span className="text-xs text-muted">
                        {formatTimestamp((utterance as Record<string, unknown>).start as number)}
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
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">
            {transcription.full_text}
          </p>
        )}
      </CollapsibleSection>
    </div>
  );
}

/** Collapsible accordion section */
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-border/50 first:border-t-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="flex w-full items-center justify-between py-2.5 text-left"
      >
        <span className="text-xs font-medium text-muted uppercase tracking-wider">{title}</span>
        <svg
          className={`h-3.5 w-3.5 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {isOpen && <div className="pb-3">{children}</div>}
    </div>
  );
}
