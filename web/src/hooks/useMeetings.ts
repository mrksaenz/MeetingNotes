'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Meeting, RecordingPart } from '@/types/database';

interface MeetingWithParts extends Meeting {
  recording_parts: RecordingPart[];
}

export function useMeetings(workspaceId: string | undefined) {
  const [meetings, setMeetings] = useState<MeetingWithParts[]>([]);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const fetchMeetings = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('meetings')
      .select('*, recording_parts(*)')
      .eq('workspace_id', workspaceId)
      .order('recorded_at', { ascending: false });

    if (!error && data) {
      // Sort recording parts by part_number within each meeting
      const sorted = data.map((meeting: MeetingWithParts) => ({
        ...meeting,
        recording_parts: (meeting.recording_parts || []).sort(
          (a: RecordingPart, b: RecordingPart) => a.part_number - b.part_number
        ),
      }));
      setMeetings(sorted);
    }
    setLoading(false);
  }, [workspaceId, supabase]);

  const createMeeting = useCallback(async (title: string): Promise<Meeting | null> => {
    if (!workspaceId) return null;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('meetings')
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        title,
        recorded_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (!error && data) {
      setMeetings((prev) => [{ ...data, recording_parts: [] }, ...prev]);
      return data;
    }
    return null;
  }, [workspaceId, supabase]);

  const addRecordingPart = useCallback(async (
    meetingId: string,
    audioFilePath: string,
    durationSeconds: number,
  ): Promise<RecordingPart | null> => {
    // Get current part count
    const meeting = meetings.find((m) => m.id === meetingId);
    const partNumber = meeting ? meeting.recording_parts.length + 1 : 1;

    const { data, error } = await supabase
      .from('recording_parts')
      .insert({
        meeting_id: meetingId,
        part_number: partNumber,
        audio_file_path: audioFilePath,
        duration_seconds: durationSeconds,
        recorded_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (!error && data) {
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === meetingId
            ? { ...m, recording_parts: [...m.recording_parts, data] }
            : m
        )
      );
      return data;
    }
    return null;
  }, [meetings, supabase]);

  return { meetings, loading, fetchMeetings, createMeeting, addRecordingPart };
}
