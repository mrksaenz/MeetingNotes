'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useToast } from '@/contexts/ToastContext';
import { uploadSegment } from '@/lib/uploadAudio';
import { createClient } from '@/lib/supabase/client';
import {
  saveSegmentLocally,
  updateSegmentStatus,
  deleteSegmentLocally,
  saveRecordingLocally,
  updateRecordingStatus,
  deleteLocalRecording,
} from '@/lib/recordingStore';
import Waveform from './Waveform';
import ConsentReminder from './ConsentReminder';
import UploadProgressBar from '@/components/ui/UploadProgressBar';
import type { Meeting } from '@/types/database';

interface RecordingScreenProps {
  workspaceId: string;
  workspaceName: string;
  workspaceColor: string;
  /** If provided, this is a "Continue Meeting" recording */
  existingMeeting?: Meeting;
  existingPartCount?: number;
  onComplete: (meetingId: string) => void;
  onCancel: () => void;
}

type SegmentUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

const SEGMENT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function RecordingScreen({
  workspaceId,
  workspaceName,
  workspaceColor,
  existingMeeting,
  existingPartCount = 0,
  onComplete,
  onCancel,
}: RecordingScreenProps) {
  const { showToast } = useToast();
  const [showConsent, setShowConsent] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ bytesUploaded: number; bytesTotal: number } | null>(null);
  const [meetingTitle, setMeetingTitle] = useState(
    existingMeeting?.title || ''
  );

  // Segment upload tracking
  const [segmentStatuses, setSegmentStatuses] = useState<Map<number, SegmentUploadStatus>>(new Map());
  const [activeSegmentProgress, setActiveSegmentProgress] = useState<{ bytesUploaded: number; bytesTotal: number } | null>(null);

  // IDs created eagerly on consent
  const [meetingId, setMeetingId] = useState<string | null>(existingMeeting?.id || null);
  const [recordingPartId, setRecordingPartId] = useState<string | null>(null);
  const partNumber = existingPartCount + 1;

  // Segment upload queue (sequential to avoid overwhelming mobile bandwidth)
  const uploadQueueRef = useRef<Array<{ blob: Blob; segmentNumber: number }>>([]);
  const isProcessingQueueRef = useRef(false);
  const uploadAbortRef = useRef<(() => void) | null>(null);
  const userIdRef = useRef<string>('');

  // Process the segment upload queue one at a time
  const processUploadQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    while (uploadQueueRef.current.length > 0) {
      const item = uploadQueueRef.current[0];
      if (!item || !meetingId || !recordingPartId) break;

      setSegmentStatuses(prev => new Map(prev).set(item.segmentNumber, 'uploading'));

      try {
        const upload = uploadSegment(
          userIdRef.current,
          meetingId,
          partNumber,
          item.segmentNumber,
          item.blob,
          {
            onProgress: (bytesUploaded, bytesTotal) => {
              setActiveSegmentProgress({ bytesUploaded, bytesTotal });
            },
          }
        );
        uploadAbortRef.current = upload.abort;
        const filePath = await upload.promise;
        uploadAbortRef.current = null;
        setActiveSegmentProgress(null);

        if (filePath) {
          // Create recording_segments row
          const supabase = createClient();
          await supabase.from('recording_segments').upsert({
            recording_part_id: recordingPartId,
            segment_number: item.segmentNumber,
            audio_file_path: filePath,
            duration_seconds: SEGMENT_DURATION_MS / 1000,
            byte_size: item.blob.size,
            upload_status: 'uploaded',
            uploaded_at: new Date().toISOString(),
          }, { onConflict: 'recording_part_id,segment_number' });

          setSegmentStatuses(prev => new Map(prev).set(item.segmentNumber, 'uploaded'));

          // Delete from IndexedDB
          const segId = `${recordingPartId}_seg_${item.segmentNumber}`;
          await deleteSegmentLocally(segId);
        } else {
          throw new Error('Upload returned null');
        }
      } catch (err) {
        setActiveSegmentProgress(null);
        uploadAbortRef.current = null;
        setSegmentStatuses(prev => new Map(prev).set(item.segmentNumber, 'failed'));

        // Update IndexedDB with failure
        const segId = `${recordingPartId}_seg_${item.segmentNumber}`;
        await updateSegmentStatus(segId, {
          status: 'pending',
          lastError: err instanceof Error ? err.message : 'Upload failed',
          lastAttemptAt: new Date().toISOString(),
          uploadAttempts: 1,
        });
      }

      // Remove processed item from queue
      uploadQueueRef.current.shift();
    }

    isProcessingQueueRef.current = false;
  }, [meetingId, recordingPartId, partNumber]);

  // Callback when a segment is ready from the recorder
  const handleSegmentReady = useCallback(async (blob: Blob, segmentNumber: number) => {
    if (!meetingId || !recordingPartId) return;

    // Save to IndexedDB first (local backup)
    await saveSegmentLocally({
      segmentBlob: blob,
      segmentNumber,
      recordingPartId,
      meetingId,
      partNumber,
      userId: userIdRef.current,
      mimeType: blob.type,
      durationSeconds: SEGMENT_DURATION_MS / 1000,
    });

    setSegmentStatuses(prev => new Map(prev).set(segmentNumber, 'pending'));

    // Add to upload queue
    uploadQueueRef.current.push({ blob, segmentNumber });
    processUploadQueue();
  }, [meetingId, recordingPartId, partNumber, processUploadQueue]);

  const {
    state,
    duration,
    waveformData,
    audioBlob,
    segmentsCompleted,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    resetRecording,
    error,
  } = useAudioRecorder({
    segmentDurationMs: SEGMENT_DURATION_MS,
    onSegmentReady: handleSegmentReady,
  });

  const wakeLock = useWakeLock();

  const handleConsentAccept = useCallback(async () => {
    setShowConsent(false);
    await wakeLock.request();

    // Eagerly create meeting and recording_part so we have IDs for segment uploads
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      showToast({ message: 'Authentication error. Please log in again.', type: 'error' });
      onCancel();
      return;
    }
    userIdRef.current = user.id;

    let mid: string | null = existingMeeting?.id || null;

    if (!mid) {
      const title = meetingTitle.trim() || `Meeting - ${new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`;

      const { data, error: meetingError } = await supabase
        .from('meetings')
        .insert({
          workspace_id: workspaceId,
          user_id: user.id,
          title,
          recorded_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (meetingError || !data) {
        showToast({ message: 'Failed to create meeting. Please try again.', type: 'error' });
        onCancel();
        return;
      }
      mid = data.id;
      if (!meetingTitle.trim()) {
        setMeetingTitle(title);
      }
    }
    setMeetingId(mid);

    // Create recording_part row (will be updated with segment_count and duration on stop)
    const { data: partData, error: partError } = await supabase
      .from('recording_parts')
      .insert({
        meeting_id: mid,
        part_number: partNumber,
        audio_file_path: '', // Will be updated or segments used directly
        duration_seconds: 0, // Updated on stop
        recorded_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (partError || !partData) {
      showToast({ message: 'Failed to create recording part. Please try again.', type: 'error' });
      onCancel();
      return;
    }
    setRecordingPartId(partData.id);

    await startRecording();
  }, [wakeLock, startRecording, existingMeeting, meetingTitle, workspaceId, partNumber, showToast, onCancel]);

  const handleStop = useCallback(() => {
    stopRecording();
    wakeLock.release();
  }, [stopRecording, wakeLock]);

  const handleDiscard = useCallback(async () => {
    resetRecording();
    wakeLock.release();

    // Clean up eagerly created meeting/part if no segments were recorded
    if (recordingPartId && segmentsCompleted === 0 && !audioBlob) {
      const supabase = createClient();
      await supabase.from('recording_parts').delete().eq('id', recordingPartId);
      if (meetingId && !existingMeeting) {
        await supabase.from('meetings').delete().eq('id', meetingId);
      }
    }

    onCancel();
  }, [resetRecording, wakeLock, onCancel, recordingPartId, meetingId, existingMeeting, segmentsCompleted, audioBlob]);

  // Save the final segment when recording stops
  const handleSave = useCallback(async () => {
    if (!audioBlob || !meetingId || !recordingPartId) return;
    setSaving(true);

    const supabase = createClient();
    const totalSegmentNumber = segmentsCompleted;
    const totalSegments = totalSegmentNumber + 1; // completed segments + this final one

    // Calculate final segment duration (total duration minus segments already completed)
    const finalSegmentDuration = duration - (segmentsCompleted * (SEGMENT_DURATION_MS / 1000));

    // Save final segment to IndexedDB first
    let localId: string | null = null;
    try {
      localId = await saveSegmentLocally({
        segmentBlob: audioBlob,
        segmentNumber: totalSegmentNumber,
        recordingPartId,
        meetingId,
        partNumber,
        userId: userIdRef.current,
        mimeType: audioBlob.type,
        durationSeconds: Math.max(0, finalSegmentDuration),
      });
    } catch (err) {
      console.error('IndexedDB save failed for final segment:', err);
    }

    // Upload final segment
    let uploadSucceeded = false;
    try {
      setUploadProgress({ bytesUploaded: 0, bytesTotal: audioBlob.size });
      const upload = uploadSegment(
        userIdRef.current,
        meetingId,
        partNumber,
        totalSegmentNumber,
        audioBlob,
        {
          onProgress: (bytesUploaded, bytesTotal) => {
            setUploadProgress({ bytesUploaded, bytesTotal });
          },
        }
      );
      uploadAbortRef.current = upload.abort;
      const filePath = await upload.promise;
      uploadAbortRef.current = null;
      setUploadProgress(null);

      if (!filePath) {
        throw new Error('Final segment upload failed');
      }

      // Create recording_segments row for final segment
      await supabase.from('recording_segments').upsert({
        recording_part_id: recordingPartId,
        segment_number: totalSegmentNumber,
        audio_file_path: filePath,
        duration_seconds: Math.max(0, finalSegmentDuration),
        byte_size: audioBlob.size,
        upload_status: 'uploaded',
        uploaded_at: new Date().toISOString(),
      }, { onConflict: 'recording_part_id,segment_number' });

      // Update recording_part with segment_count and total duration
      await supabase
        .from('recording_parts')
        .update({
          segment_count: totalSegments,
          duration_seconds: duration,
        })
        .eq('id', recordingPartId);

      uploadSucceeded = true;
    } catch (err) {
      console.error('Final segment upload failed:', err);
      setUploadProgress(null);
      uploadAbortRef.current = null;

      if (localId) {
        await updateSegmentStatus(localId, {
          status: 'pending',
          lastError: err instanceof Error ? err.message : 'Upload failed',
          lastAttemptAt: new Date().toISOString(),
          uploadAttempts: 1,
        });
      }

      // Still update recording_part with what we know
      await supabase
        .from('recording_parts')
        .update({
          segment_count: totalSegments,
          duration_seconds: duration,
        })
        .eq('id', recordingPartId);
    }

    // Show result
    if (uploadSucceeded) {
      if (localId) await deleteSegmentLocally(localId);
      showToast({ message: 'Recording saved successfully', type: 'success' });
    } else if (localId) {
      showToast({
        message: 'Final segment upload pending \u2014 saved locally. Will sync when connection improves.',
        type: 'error',
        duration: 10000,
      });
    } else {
      showToast({
        message: 'Upload failed. Please try again.',
        type: 'error',
      });
    }

    setSaving(false);
    onComplete(meetingId);
  }, [audioBlob, meetingId, recordingPartId, segmentsCompleted, duration, partNumber, onComplete, showToast]);

  // Handle error state
  useEffect(() => {
    if (error) {
      wakeLock.release();
    }
  }, [error, wakeLock]);

  // Compute segment status summary
  const uploadedCount = Array.from(segmentStatuses.values()).filter(s => s === 'uploaded').length;
  const failedCount = Array.from(segmentStatuses.values()).filter(s => s === 'failed').length;
  const uploadingCount = Array.from(segmentStatuses.values()).filter(s => s === 'uploading').length;
  const totalTracked = segmentStatuses.size;

  if (showConsent) {
    return <ConsentReminder onAccept={handleConsentAccept} onCancel={onCancel} />;
  }

  const isRecording = state === 'recording';
  const isPaused = state === 'paused';
  const isStopped = state === 'stopped';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: workspaceColor }}
          />
          <span className="text-sm font-medium text-muted">{workspaceName}</span>
        </div>
        {existingMeeting && (
          <span className="text-xs text-muted">
            Part {partNumber}
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        {/* Recording indicator */}
        <div className="mb-2 flex items-center gap-2">
          {isRecording && (
            <span className="h-2.5 w-2.5 rounded-full bg-accent-rose animate-pulse" />
          )}
          {isPaused && (
            <span className="h-2.5 w-2.5 rounded-full bg-accent-amber" />
          )}
          <span className="text-sm font-medium text-muted">
            {isRecording ? 'Recording' : isPaused ? 'Paused' : isStopped ? 'Recording stopped' : ''}
          </span>
        </div>

        {/* Timer */}
        <div className="mb-8 tabular-nums text-5xl font-light text-foreground md:text-6xl">
          {formatDuration(duration)}
        </div>

        {/* Waveform */}
        <div className="mb-4 w-full max-w-lg">
          <Waveform
            data={waveformData}
            isRecording={isRecording}
            color={workspaceColor}
          />
        </div>

        {/* Segment upload status during recording */}
        {(isRecording || isPaused) && totalTracked > 0 && (
          <div className="mb-8 flex items-center gap-2 text-xs">
            {uploadingCount > 0 && activeSegmentProgress ? (
              <>
                <span className="h-2 w-2 rounded-full bg-primary-500 animate-pulse" />
                <span className="text-muted">
                  Uploading segment {uploadedCount + 1}...
                  <span className="ml-1 tabular-nums">
                    {activeSegmentProgress.bytesTotal > 0
                      ? `${Math.round((activeSegmentProgress.bytesUploaded / activeSegmentProgress.bytesTotal) * 100)}%`
                      : ''}
                  </span>
                </span>
              </>
            ) : failedCount > 0 ? (
              <>
                <span className="h-2 w-2 rounded-full bg-accent-amber" />
                <span className="text-accent-amber">
                  {failedCount} segment{failedCount > 1 ? 's' : ''} waiting to upload
                </span>
              </>
            ) : uploadedCount > 0 ? (
              <>
                <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="text-emerald-600">
                  {uploadedCount} segment{uploadedCount > 1 ? 's' : ''} uploaded
                </span>
              </>
            ) : null}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mb-4 rounded-lg bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
            {error}
          </div>
        )}

        {/* Stopped state: save or discard */}
        {isStopped && (
          <div className="w-full max-w-sm space-y-4">
            {/* Meeting title input (only for new meetings) */}
            {!existingMeeting && (
              <div>
                <label htmlFor="meeting-title" className="block text-sm font-medium text-foreground mb-1">
                  Meeting title
                </label>
                <input
                  id="meeting-title"
                  type="text"
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  placeholder={`Meeting - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
                />
              </div>
            )}

            {/* Segments already uploaded indicator */}
            {segmentsCompleted > 0 && (
              <div className="flex items-center gap-2 text-xs text-emerald-600">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span>{uploadedCount} of {segmentsCompleted} segments already uploaded</span>
              </div>
            )}

            {/* Upload progress bar for final segment */}
            {saving && uploadProgress && (
              <div className="mb-2">
                <UploadProgressBar
                  bytesUploaded={uploadProgress.bytesUploaded}
                  bytesTotal={uploadProgress.bytesTotal}
                  label={
                    uploadProgress.bytesTotal > 0 &&
                    uploadProgress.bytesUploaded >= uploadProgress.bytesTotal
                      ? 'Finishing up...'
                      : 'Uploading final segment...'
                  }
                />
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleDiscard}
                disabled={saving}
                className="flex-1 rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-surface transition-colors disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-lg bg-primary-600 px-4 py-3 text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {saving
                  ? uploadProgress
                    ? `Uploading... ${uploadProgress.bytesTotal > 0 ? Math.min(Math.round((uploadProgress.bytesUploaded / uploadProgress.bytesTotal) * 100), 100) : 0}%`
                    : 'Saving...'
                  : 'Save recording'}
              </button>
            </div>
          </div>
        )}

        {/* Recording controls */}
        {!isStopped && !error && (
          <div className="flex items-center gap-6">
            {/* Cancel button */}
            <button
              onClick={handleDiscard}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-border text-muted hover:bg-surface hover:text-foreground transition-colors"
              title="Cancel"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Pause/Resume button */}
            <button
              onClick={isPaused ? resumeRecording : pauseRecording}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary-700 hover:bg-primary-200 transition-colors"
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? (
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                </svg>
              )}
            </button>

            {/* Stop button */}
            <button
              onClick={handleStop}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-rose text-white shadow-lg hover:bg-accent-rose/90 transition-all active:scale-95"
              title="Stop recording"
            >
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="border-t border-border px-4 py-3 text-center">
        <p className="text-xs text-muted">
          {isRecording || isPaused
            ? 'Keep this screen open while recording'
            : isStopped
              ? 'Review your recording above'
              : ''}
        </p>
      </div>
    </div>
  );
}
