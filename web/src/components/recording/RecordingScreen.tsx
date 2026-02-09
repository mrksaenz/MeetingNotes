'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useWakeLock } from '@/hooks/useWakeLock';
import { uploadAudio } from '@/lib/uploadAudio';
import { createClient } from '@/lib/supabase/client';
import Waveform from './Waveform';
import ConsentReminder from './ConsentReminder';
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
  const [showConsent, setShowConsent] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState(
    existingMeeting?.title || ''
  );

  const {
    state,
    duration,
    waveformData,
    audioBlob,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    resetRecording,
    error,
  } = useAudioRecorder();

  const wakeLock = useWakeLock();

  const handleConsentAccept = useCallback(async () => {
    setShowConsent(false);
    await wakeLock.request();
    await startRecording();
  }, [wakeLock, startRecording]);

  const handleStop = useCallback(() => {
    stopRecording();
    wakeLock.release();
  }, [stopRecording, wakeLock]);

  const handleDiscard = useCallback(() => {
    resetRecording();
    wakeLock.release();
    onCancel();
  }, [resetRecording, wakeLock, onCancel]);

  // Save the recording when we have the blob
  const handleSave = useCallback(async () => {
    if (!audioBlob) return;
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    let meetingId: string | undefined = existingMeeting?.id;
    const partNumber = existingPartCount + 1;

    // Create new meeting if needed
    if (!meetingId) {
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
        console.error('Failed to create meeting:', meetingError);
        setSaving(false);
        return;
      }
      meetingId = data.id;
    }

    if (!meetingId) {
      console.error('No meeting ID available');
      setSaving(false);
      return;
    }

    // Upload audio
    const filePath = await uploadAudio(user.id, meetingId, partNumber, audioBlob);
    if (!filePath) {
      console.error('Failed to upload audio');
      setSaving(false);
      return;
    }

    // Create recording part
    const { error: partError } = await supabase
      .from('recording_parts')
      .insert({
        meeting_id: meetingId,
        part_number: partNumber,
        audio_file_path: filePath,
        duration_seconds: duration,
        recorded_at: new Date().toISOString(),
      });

    if (partError) {
      console.error('Failed to save recording part:', partError);
      setSaving(false);
      return;
    }

    setSaving(false);
    onComplete(meetingId);
  }, [audioBlob, existingMeeting, existingPartCount, meetingTitle, workspaceId, duration, onComplete]);

  // Handle cancel when consent is declined
  useEffect(() => {
    if (error) {
      wakeLock.release();
    }
  }, [error, wakeLock]);

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
            Part {existingPartCount + 1}
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
        <div className="mb-8 w-full max-w-lg">
          <Waveform
            data={waveformData}
            isRecording={isRecording}
            color={workspaceColor}
          />
        </div>

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
                {saving ? 'Saving...' : 'Save recording'}
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
