import { useCallback, useEffect, useState } from 'react';
import type { MeetingListItem } from '@shared/types';
import { useToast } from '../lib/toast';
import NewMeetingModal from './NewMeetingModal';

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function MeetingList({
  onOpenMeeting,
  onOpenSettings,
  onRecordMeeting,
}: {
  onOpenMeeting: (id: string) => void;
  onOpenSettings: () => void;
  onRecordMeeting: (meetingId: string, meetingTitle: string) => void;
}) {
  const toast = useToast();
  const [meetings, setMeetings] = useState<MeetingListItem[] | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMeetings(await window.api.listMeetings());
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to load meetings');
      setMeetings([]);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <div className="titlebar-drag flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white pr-5 pl-24">
        <h1 className="text-base font-bold text-slate-900">MeetingNotes</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSettings}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            Settings
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + New Meeting
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl">
          {meetings === null ? (
            <p className="py-16 text-center text-sm text-slate-400">Loading meetings…</p>
          ) : meetings.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-lg font-semibold text-slate-700">No meetings yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                Create your first meeting to record audio, upload voice memos, or paste an
                existing transcript.
              </p>
              <button
                onClick={() => setShowNewModal(true)}
                className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                + New Meeting
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {meetings.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => onOpenMeeting(m.id)}
                    className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{m.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatDate(m.recordedAt)}
                          {' · '}
                          {m.partCount} part{m.partCount !== 1 ? 's' : ''}
                          {m.totalDurationSeconds > 0 && ` · ${formatDuration(m.totalDurationSeconds)}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        {m.hasSummary ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            Summarized
                          </span>
                        ) : m.hasTranscription ? (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                            Transcribed
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            Not processed
                          </span>
                        )}
                        {m.exportCount > 0 && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            {m.exportCount} export{m.exportCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showNewModal && (
        <NewMeetingModal
          onClose={() => setShowNewModal(false)}
          onCreated={(meetingId, options) => {
            setShowNewModal(false);
            refresh();
            if (options?.record) {
              onRecordMeeting(meetingId, options.title);
            } else {
              onOpenMeeting(meetingId);
            }
          }}
        />
      )}
    </div>
  );
}
