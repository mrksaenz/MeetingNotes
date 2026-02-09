-- Meeting Notes & Transcription App - Initial Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Workspaces
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meetings (parent)
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users NOT NULL,
  title TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  attendees TEXT[],
  tags TEXT[],
  user_notes TEXT,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_favorite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recording Parts (children of meetings)
CREATE TABLE recording_parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID REFERENCES meetings ON DELETE CASCADE NOT NULL,
  part_number INTEGER NOT NULL,
  audio_file_path TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  processing_status TEXT DEFAULT 'unprocessed'
    CHECK (processing_status IN ('unprocessed', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transcriptions
CREATE TABLE transcriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recording_part_id UUID REFERENCES recording_parts ON DELETE CASCADE NOT NULL,
  full_text TEXT NOT NULL,
  speakers JSONB,
  confidence_score DECIMAL,
  provider TEXT DEFAULT 'assemblyai',
  processing_level TEXT
    CHECK (processing_level IN ('transcription_only', 'summary', 'full_analysis')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Summaries
CREATE TABLE summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transcription_id UUID REFERENCES transcriptions ON DELETE CASCADE NOT NULL,
  executive_summary TEXT,
  key_points TEXT[],
  decisions TEXT[],
  action_items JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shared Links
CREATE TABLE shared_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID REFERENCES meetings ON DELETE CASCADE NOT NULL,
  share_token TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Usage Tracking
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL,
  recording_part_id UUID REFERENCES recording_parts ON DELETE SET NULL,
  action_type TEXT,
  duration_minutes DECIMAL,
  cost_usd DECIMAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_workspaces_user_id ON workspaces(user_id);
CREATE INDEX idx_meetings_workspace_id ON meetings(workspace_id);
CREATE INDEX idx_meetings_user_id ON meetings(user_id);
CREATE INDEX idx_recording_parts_meeting_id ON recording_parts(meeting_id);
CREATE INDEX idx_transcriptions_recording_part_id ON transcriptions(recording_part_id);
CREATE INDEX idx_summaries_transcription_id ON summaries(transcription_id);
CREATE INDEX idx_shared_links_share_token ON shared_links(share_token);
CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);

-- Row Level Security (RLS)
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- Policies: Users can only access their own data

-- Workspaces
CREATE POLICY "Users can view own workspaces"
  ON workspaces FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own workspaces"
  ON workspaces FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workspaces"
  ON workspaces FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own workspaces"
  ON workspaces FOR DELETE USING (auth.uid() = user_id);

-- Meetings
CREATE POLICY "Users can view own meetings"
  ON meetings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own meetings"
  ON meetings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own meetings"
  ON meetings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own meetings"
  ON meetings FOR DELETE USING (auth.uid() = user_id);

-- Recording Parts (through meeting ownership)
CREATE POLICY "Users can view own recording parts"
  ON recording_parts FOR SELECT
  USING (EXISTS (SELECT 1 FROM meetings WHERE meetings.id = recording_parts.meeting_id AND meetings.user_id = auth.uid()));
CREATE POLICY "Users can create own recording parts"
  ON recording_parts FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM meetings WHERE meetings.id = recording_parts.meeting_id AND meetings.user_id = auth.uid()));
CREATE POLICY "Users can update own recording parts"
  ON recording_parts FOR UPDATE
  USING (EXISTS (SELECT 1 FROM meetings WHERE meetings.id = recording_parts.meeting_id AND meetings.user_id = auth.uid()));
CREATE POLICY "Users can delete own recording parts"
  ON recording_parts FOR DELETE
  USING (EXISTS (SELECT 1 FROM meetings WHERE meetings.id = recording_parts.meeting_id AND meetings.user_id = auth.uid()));

-- Transcriptions (through recording part → meeting ownership)
CREATE POLICY "Users can view own transcriptions"
  ON transcriptions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM recording_parts rp
    JOIN meetings m ON m.id = rp.meeting_id
    WHERE rp.id = transcriptions.recording_part_id AND m.user_id = auth.uid()
  ));
CREATE POLICY "Users can create own transcriptions"
  ON transcriptions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM recording_parts rp
    JOIN meetings m ON m.id = rp.meeting_id
    WHERE rp.id = transcriptions.recording_part_id AND m.user_id = auth.uid()
  ));

-- Summaries (through transcription → recording part → meeting ownership)
CREATE POLICY "Users can view own summaries"
  ON summaries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM transcriptions t
    JOIN recording_parts rp ON rp.id = t.recording_part_id
    JOIN meetings m ON m.id = rp.meeting_id
    WHERE t.id = summaries.transcription_id AND m.user_id = auth.uid()
  ));
CREATE POLICY "Users can create own summaries"
  ON summaries FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM transcriptions t
    JOIN recording_parts rp ON rp.id = t.recording_part_id
    JOIN meetings m ON m.id = rp.meeting_id
    WHERE t.id = summaries.transcription_id AND m.user_id = auth.uid()
  ));

-- Shared Links
CREATE POLICY "Users can view own shared links"
  ON shared_links FOR SELECT
  USING (EXISTS (SELECT 1 FROM meetings WHERE meetings.id = shared_links.meeting_id AND meetings.user_id = auth.uid()));
CREATE POLICY "Users can create own shared links"
  ON shared_links FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM meetings WHERE meetings.id = shared_links.meeting_id AND meetings.user_id = auth.uid()));
CREATE POLICY "Users can update own shared links"
  ON shared_links FOR UPDATE
  USING (EXISTS (SELECT 1 FROM meetings WHERE meetings.id = shared_links.meeting_id AND meetings.user_id = auth.uid()));
CREATE POLICY "Users can delete own shared links"
  ON shared_links FOR DELETE
  USING (EXISTS (SELECT 1 FROM meetings WHERE meetings.id = shared_links.meeting_id AND meetings.user_id = auth.uid()));

-- Usage Logs
CREATE POLICY "Users can view own usage logs"
  ON usage_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own usage logs"
  ON usage_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Storage bucket for audio files
INSERT INTO storage.buckets (id, name, public)
VALUES ('recordings', 'recordings', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: users can upload to their own folder
CREATE POLICY "Users can upload own recordings"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'recordings' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can view own recordings"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'recordings' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can delete own recordings"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'recordings' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
