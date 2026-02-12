'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { createClient } from '@/lib/supabase/client';
import { uploadAudio, uploadSegment } from '@/lib/uploadAudio';
import {
  getPendingRecordings,
  getPendingRecordingsForWorkspace,
  getRecordingById,
  getRecordingBlob,
  updateRecordingStatus,
  deleteLocalRecording,
  getPendingSegments,
  getSegmentById,
  updateSegmentStatus,
  deleteSegmentLocally,
  type PendingRecording,
  type PendingSegment,
} from '@/lib/recordingStore';

export interface UploadProgressMap {
  [recordingId: string]: { bytesUploaded: number; bytesTotal: number };
}

interface UsePendingUploadsReturn {
  pendingCount: number;
  pendingRecordings: PendingRecording[];
  pendingSegmentCount: number;
  isRetrying: boolean;
  uploadProgress: UploadProgressMap;
  retryAll: () => Promise<void>;
  retryOne: (id: string) => Promise<boolean>;
  discardOne: (id: string) => Promise<void>;
  saveToDevice: (id: string) => Promise<boolean>;
  refreshPending: () => Promise<void>;
  getPendingForWorkspace: (workspaceId: string) => Promise<PendingRecording[]>;
}

export function usePendingUploads(): UsePendingUploadsReturn {
  const { showToast } = useToast();
  const [pendingRecordings, setPendingRecordings] = useState<PendingRecording[]>([]);
  const [pendingSegmentCount, setPendingSegmentCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressMap>({});
  const retryingRef = useRef(false);

  const refreshPending = useCallback(async () => {
    const pending = await getPendingRecordings();
    setPendingRecordings(pending);
    const pendingSegs = await getPendingSegments();
    setPendingSegmentCount(pendingSegs.length);
  }, []);

  // Retry a single legacy full-recording upload
  const retryOne = useCallback(async (id: string): Promise<boolean> => {
    const recording = await getRecordingById(id);
    if (!recording) return false;

    await updateRecordingStatus(id, { status: 'uploading' });

    try {
      const supabase = createClient();
      let meetingId = recording.meetingId;

      // Create meeting if it wasn't created before
      if (!meetingId) {
        const { data, error } = await supabase
          .from('meetings')
          .insert({
            workspace_id: recording.workspaceId,
            user_id: recording.userId,
            title: recording.meetingTitle,
            recorded_at: recording.createdAt,
          })
          .select()
          .single();

        if (error || !data) {
          throw new Error(error?.message || 'Meeting creation failed');
        }
        meetingId = data.id;
        await updateRecordingStatus(id, { meetingId });
      }

      if (!meetingId) {
        throw new Error('No meeting ID available');
      }

      // Upload audio with progress tracking
      const upload = uploadAudio(
        recording.userId,
        meetingId,
        recording.partNumber,
        recording.audioBlob,
        {
          onProgress: (bytesUploaded, bytesTotal) => {
            setUploadProgress((prev) => ({
              ...prev,
              [id]: { bytesUploaded, bytesTotal },
            }));
          },
        }
      );
      const filePath = await upload.promise;
      setUploadProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (!filePath) throw new Error('Upload failed');

      // Check for existing recording_parts to prevent duplicates
      const { data: existingParts } = await supabase
        .from('recording_parts')
        .select('id')
        .eq('meeting_id', meetingId)
        .eq('part_number', recording.partNumber)
        .limit(1);

      if (!existingParts || existingParts.length === 0) {
        const { error: partError } = await supabase
          .from('recording_parts')
          .insert({
            meeting_id: meetingId,
            part_number: recording.partNumber,
            audio_file_path: filePath,
            duration_seconds: recording.durationSeconds,
            recorded_at: recording.createdAt,
          });

        if (partError) throw new Error(partError.message);
      }

      // Success — delete from IndexedDB
      await deleteLocalRecording(id);
      return true;
    } catch (err) {
      setUploadProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await updateRecordingStatus(id, {
        status: 'pending',
        uploadAttempts: recording.uploadAttempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: err instanceof Error ? err.message : 'Unknown error',
      });
      return false;
    }
  }, []);

  // Retry a single pending segment
  const retrySegment = useCallback(async (segment: PendingSegment): Promise<boolean> => {
    await updateSegmentStatus(segment.id, { status: 'uploading' });

    try {
      const upload = uploadSegment(
        segment.userId,
        segment.meetingId,
        segment.partNumber,
        segment.segmentNumber,
        segment.segmentBlob,
        {
          onProgress: (bytesUploaded, bytesTotal) => {
            setUploadProgress((prev) => ({
              ...prev,
              [segment.id]: { bytesUploaded, bytesTotal },
            }));
          },
        }
      );

      const filePath = await upload.promise;
      setUploadProgress((prev) => {
        const next = { ...prev };
        delete next[segment.id];
        return next;
      });

      if (!filePath) throw new Error('Segment upload failed');

      // Create recording_segments row if it doesn't exist
      const supabase = createClient();
      await supabase.from('recording_segments').upsert({
        recording_part_id: segment.recordingPartId,
        segment_number: segment.segmentNumber,
        audio_file_path: filePath,
        duration_seconds: segment.durationSeconds,
        byte_size: segment.segmentBlob.size,
        upload_status: 'uploaded',
        uploaded_at: new Date().toISOString(),
      }, { onConflict: 'recording_part_id,segment_number' });

      // Delete from IndexedDB
      await deleteSegmentLocally(segment.id);
      return true;
    } catch (err) {
      setUploadProgress((prev) => {
        const next = { ...prev };
        delete next[segment.id];
        return next;
      });
      await updateSegmentStatus(segment.id, {
        status: 'pending',
        uploadAttempts: segment.uploadAttempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: err instanceof Error ? err.message : 'Unknown error',
      });
      return false;
    }
  }, []);

  // Retry all pending recordings and segments
  const retryAll = useCallback(async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setIsRetrying(true);

    let anySucceeded = false;

    // Retry legacy full-recording uploads
    const pending = await getPendingRecordings();
    for (const recording of pending) {
      if (recording.status !== 'pending') continue;

      const backoffMs = Math.min(
        1000 * Math.pow(2, recording.uploadAttempts),
        5 * 60 * 1000
      );
      if (recording.lastAttemptAt) {
        const elapsed = Date.now() - new Date(recording.lastAttemptAt).getTime();
        if (elapsed < backoffMs) continue;
      }

      const success = await retryOne(recording.id);
      if (success) anySucceeded = true;
    }

    // Retry pending segments
    const pendingSegs = await getPendingSegments();
    for (const segment of pendingSegs) {
      if (segment.status !== 'pending') continue;

      const backoffMs = Math.min(
        1000 * Math.pow(2, segment.uploadAttempts),
        5 * 60 * 1000
      );
      if (segment.lastAttemptAt) {
        const elapsed = Date.now() - new Date(segment.lastAttemptAt).getTime();
        if (elapsed < backoffMs) continue;
      }

      const success = await retrySegment(segment);
      if (success) anySucceeded = true;
    }

    if (anySucceeded) {
      showToast({ message: 'Pending recordings synced successfully', type: 'success' });
    }

    await refreshPending();
    setIsRetrying(false);
    retryingRef.current = false;
  }, [retryOne, retrySegment, refreshPending, showToast]);

  const discardOne = useCallback(async (id: string) => {
    await deleteLocalRecording(id);
    await refreshPending();
  }, [refreshPending]);

  const saveToDevice = useCallback(async (id: string): Promise<boolean> => {
    try {
      const result = await getRecordingBlob(id);
      if (!result) {
        showToast({ message: 'Recording not found in local storage', type: 'error' });
        return false;
      }

      const { blob, fileName } = result;
      const file = new File([blob], fileName, { type: blob.type });

      // iOS Safari: use native share sheet so user can "Save to Files"
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: fileName });
          showToast({ message: 'Recording saved successfully', type: 'success' });
          return true;
        } catch (shareErr) {
          // User cancelled share sheet — not an error
          if (shareErr instanceof Error && shareErr.name === 'AbortError') {
            return false;
          }
          console.warn('Share failed, falling back to download:', shareErr);
        }
      }

      // Fallback: trigger download via <a> element
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast({ message: 'Download started', type: 'success' });
      return true;
    } catch (err) {
      console.error('Save to device failed:', err);
      showToast({
        message: err instanceof Error ? err.message : 'Failed to save recording',
        type: 'error',
      });
      return false;
    }
  }, [showToast]);

  const getPendingForWorkspace = useCallback(async (workspaceId: string) => {
    return getPendingRecordingsForWorkspace(workspaceId);
  }, []);

  // On mount: load pending recordings and attempt retry
  useEffect(() => {
    refreshPending();
    // Small delay before auto-retry to let the page settle
    const timer = setTimeout(() => {
      retryAll();
    }, 2000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Retry when browser comes back online
  useEffect(() => {
    const handleOnline = () => {
      retryAll();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [retryAll]);

  // Periodic retry every 2 minutes for pending uploads
  useEffect(() => {
    const interval = setInterval(() => {
      retryAll();
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [retryAll]);

  return {
    pendingCount: pendingRecordings.length,
    pendingRecordings,
    pendingSegmentCount,
    isRetrying,
    uploadProgress,
    retryAll,
    retryOne,
    discardOne,
    saveToDevice,
    refreshPending,
    getPendingForWorkspace,
  };
}
