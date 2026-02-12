'use client';

import { useState } from 'react';
import type { PendingRecording } from '@/lib/recordingStore';
import type { UploadProgressMap } from '@/hooks/usePendingUploads';
import UploadProgressBar from '@/components/ui/UploadProgressBar';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PendingRecordingsBanner({
  pendingRecordings,
  pendingSegmentCount = 0,
  isRetrying,
  uploadProgress,
  onRetryAll,
  onRetryOne,
  onDiscardOne,
  onSaveToDevice,
}: {
  pendingRecordings: PendingRecording[];
  pendingSegmentCount?: number;
  isRetrying: boolean;
  uploadProgress?: UploadProgressMap;
  onRetryAll: () => Promise<void>;
  onRetryOne: (id: string) => Promise<boolean>;
  onDiscardOne: (id: string) => Promise<void>;
  onSaveToDevice: (id: string) => Promise<boolean>;
}) {
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const totalPending = pendingRecordings.length + (pendingSegmentCount > 0 ? 1 : 0);

  async function handleRetryOne(id: string) {
    setRetryingId(id);
    await onRetryOne(id);
    setRetryingId(null);
  }

  async function handleSaveToDevice(id: string) {
    setSavingId(id);
    await onSaveToDevice(id);
    setSavingId(null);
  }

  if (totalPending === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-accent-amber/30 bg-accent-amber/5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* Cloud-off icon */}
          <svg className="h-5 w-5 shrink-0 text-accent-amber" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-foreground">
              {pendingRecordings.length > 0 && (
                <>{pendingRecordings.length} recording{pendingRecordings.length > 1 ? 's' : ''} saved locally</>
              )}
              {pendingRecordings.length > 0 && pendingSegmentCount > 0 && ' + '}
              {pendingSegmentCount > 0 && (
                <>{pendingSegmentCount} segment{pendingSegmentCount > 1 ? 's' : ''} pending</>
              )}
            </p>
            <p className="text-xs text-muted">
              {isRetrying ? 'Syncing...' : 'Waiting for connection to sync'}
            </p>
          </div>
        </div>
        <button
          onClick={onRetryAll}
          disabled={isRetrying}
          className="rounded-lg bg-accent-amber/10 px-3 py-1.5 text-xs font-medium text-accent-amber hover:bg-accent-amber/20 transition-colors disabled:opacity-50"
        >
          {isRetrying ? 'Syncing...' : 'Retry all'}
        </button>
      </div>

      {/* Legacy full-recording items */}
      {pendingRecordings.length > 0 && (
        <div className="mt-3 space-y-2">
          {pendingRecordings.map((rec) => {
            const progress = uploadProgress?.[rec.id];
            const isUploading = retryingId === rec.id || !!progress;
            const isSaving = savingId === rec.id;

            return (
              <div key={rec.id} className="rounded-lg bg-background px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{rec.meetingTitle}</p>
                    <p className="text-xs text-muted">
                      Part {rec.partNumber} &middot; {formatDuration(rec.durationSeconds)}
                      {rec.audioBlob?.size ? (
                        <> &middot; {formatFileSize(rec.audioBlob.size)}</>
                      ) : null}
                    </p>
                    {!progress && rec.lastError && (
                      <p className="mt-0.5 text-xs text-accent-rose break-words">
                        {rec.lastError}
                      </p>
                    )}
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => handleSaveToDevice(rec.id)}
                      disabled={isSaving}
                      className="text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors disabled:opacity-50"
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => handleRetryOne(rec.id)}
                      disabled={isUploading || isRetrying}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors disabled:opacity-50"
                    >
                      {isUploading ? 'Syncing...' : 'Retry'}
                    </button>
                    <button
                      onClick={() => onDiscardOne(rec.id)}
                      disabled={isUploading}
                      className="text-xs text-muted hover:text-accent-rose transition-colors disabled:opacity-50"
                    >
                      Discard
                    </button>
                  </div>
                </div>
                {progress && (
                  <div className="mt-2">
                    <UploadProgressBar
                      bytesUploaded={progress.bytesUploaded}
                      bytesTotal={progress.bytesTotal}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pending segments indicator */}
      {pendingSegmentCount > 0 && (
        <div className="mt-3 rounded-lg bg-background px-3 py-2">
          <p className="text-xs text-muted">
            {pendingSegmentCount} recording segment{pendingSegmentCount > 1 ? 's' : ''} will auto-sync when connection improves
          </p>
        </div>
      )}
    </div>
  );
}
