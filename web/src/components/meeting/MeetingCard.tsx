'use client';

import type { Meeting, RecordingPart } from '@/types/database';

interface MeetingWithParts extends Meeting {
  recording_parts: RecordingPart[];
}

interface MeetingCardProps {
  meeting: MeetingWithParts;
  onContinue: (meeting: MeetingWithParts) => void;
  onSelect: (meeting: MeetingWithParts) => void;
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

export default function MeetingCard({ meeting, onContinue, onSelect }: MeetingCardProps) {
  const parts = meeting.recording_parts;
  const totalDuration = parts.reduce((sum, p) => sum + p.duration_seconds, 0);

  return (
    <div
      className="rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary-200 cursor-pointer"
      onClick={() => onSelect(meeting)}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-foreground truncate">{meeting.title}</h3>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted">
            <span>{formatDate(meeting.recorded_at)}</span>
            <span>{formatTime(meeting.recorded_at)}</span>
            {totalDuration > 0 && <span>{formatDuration(totalDuration)}</span>}
          </div>
        </div>
        {getStatusBadge(parts)}
      </div>

      {/* Parts */}
      {parts.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {parts.map((part) => (
            <div
              key={part.id}
              className="flex items-center justify-between rounded-lg bg-surface px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 text-muted" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
                <span className="text-xs text-foreground">Part {part.part_number}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">
                  {formatDuration(part.duration_seconds)}
                </span>
                <StatusDot status={part.processing_status} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
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
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    unprocessed: 'bg-border',
    processing: 'bg-primary-400 animate-pulse',
    completed: 'bg-accent-emerald',
    failed: 'bg-accent-rose',
  };

  return <span className={`h-2 w-2 rounded-full ${colors[status] || 'bg-border'}`} />;
}
