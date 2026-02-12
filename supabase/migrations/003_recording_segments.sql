-- Recording segments: individual time-based chunks of a recording part.
-- Enables "upload as you record" — segments upload in the background during recording
-- instead of uploading one large file after the recording stops.

CREATE TABLE recording_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recording_part_id UUID REFERENCES recording_parts ON DELETE CASCADE NOT NULL,
  segment_number INTEGER NOT NULL,
  audio_file_path TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  byte_size BIGINT,
  upload_status TEXT DEFAULT 'pending'
    CHECK (upload_status IN ('pending', 'uploading', 'uploaded', 'failed')),
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (recording_part_id, segment_number)
);

CREATE INDEX idx_recording_segments_part_id ON recording_segments(recording_part_id);

-- RLS: access through meeting ownership (same pattern as recording_parts)
ALTER TABLE recording_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recording segments"
  ON recording_segments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM recording_parts rp
    JOIN meetings m ON m.id = rp.meeting_id
    WHERE rp.id = recording_segments.recording_part_id AND m.user_id = auth.uid()
  ));

CREATE POLICY "Users can create own recording segments"
  ON recording_segments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM recording_parts rp
    JOIN meetings m ON m.id = rp.meeting_id
    WHERE rp.id = recording_segments.recording_part_id AND m.user_id = auth.uid()
  ));

CREATE POLICY "Users can update own recording segments"
  ON recording_segments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM recording_parts rp
    JOIN meetings m ON m.id = rp.meeting_id
    WHERE rp.id = recording_segments.recording_part_id AND m.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete own recording segments"
  ON recording_segments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM recording_parts rp
    JOIN meetings m ON m.id = rp.meeting_id
    WHERE rp.id = recording_segments.recording_part_id AND m.user_id = auth.uid()
  ));

-- Add segment_count to recording_parts for quick lookups.
-- NULL means legacy single-file recording (backward compatible).
ALTER TABLE recording_parts ADD COLUMN IF NOT EXISTS segment_count INTEGER;
