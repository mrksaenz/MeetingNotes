'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { createClient } from '@/lib/supabase/client';
import { uploadAudio } from '@/lib/uploadAudio';
import {
  getPendingRecordings,
  getPendingRecordingsForWorkspace,
  getRecordingById,
  updateRecordingStatus,
  deleteLocalRecording,
  type PendingRecording,
} from '@/lib/recordingStore';

interface UsePendingUploadsReturn {
  pendingCount: number;
  pendingRecordings: PendingRecording[];
  isRetrying: boolean;
  retryAll: () => Promise<void>;
  retryOne: (id: string) => Promise<boolean>;
  discardOne: (id: string) => Promise<void>;
  refreshPending: () => Promise<void>;
  getPendingForWorkspace: (workspaceId: string) => Promise<PendingRecording[]>;
}

export function usePendingUploads(): UsePendingUploadsReturn {
  const { showToast } = useToast();
  const [pendingRecordings, setPendingRecordings] = useState<PendingRecording[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryingRef = useRef(false);

  const refreshPending = useCallback(async () => {
    const pending = await getPendingRecordings();
    setPendingRecordings(pending);
  }, []);

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

      // Upload audio
      const filePath = await uploadAudio(
        recording.userId,
        meetingId,
        recording.partNumber,
        recording.audioBlob
      );
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
      await updateRecordingStatus(id, {
        status: 'pending',
        uploadAttempts: recording.uploadAttempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: err instanceof Error ? err.message : 'Unknown error',
      });
      return false;
    }
  }, []);

  const retryAll = useCallback(async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setIsRetrying(true);

    const pending = await getPendingRecordings();
    let anySucceeded = false;

    for (const recording of pending) {
      if (recording.status !== 'pending') continue;

      // Exponential backoff: skip if not enough time has passed
      const backoffMs = Math.min(
        1000 * Math.pow(2, recording.uploadAttempts),
        5 * 60 * 1000 // Cap at 5 minutes
      );
      if (recording.lastAttemptAt) {
        const elapsed = Date.now() - new Date(recording.lastAttemptAt).getTime();
        if (elapsed < backoffMs) continue;
      }

      const success = await retryOne(recording.id);
      if (success) {
        anySucceeded = true;
      }
    }

    if (anySucceeded) {
      showToast({ message: 'Pending recording synced successfully', type: 'success' });
    }

    await refreshPending();
    setIsRetrying(false);
    retryingRef.current = false;
  }, [retryOne, refreshPending, showToast]);

  const discardOne = useCallback(async (id: string) => {
    await deleteLocalRecording(id);
    await refreshPending();
  }, [refreshPending]);

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

  return {
    pendingCount: pendingRecordings.length,
    pendingRecordings,
    isRetrying,
    retryAll,
    retryOne,
    discardOne,
    refreshPending,
    getPendingForWorkspace,
  };
}
