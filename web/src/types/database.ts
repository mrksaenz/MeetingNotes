export type ProcessingStatus = 'unprocessed' | 'processing' | 'completed' | 'failed';
export type ProcessingLevel = 'transcription_only' | 'summary' | 'full_analysis';

export interface Workspace {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  icon: string | null;
  created_at: string;
  updated_at: string;
}

export interface Meeting {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  recorded_at: string;
  attendees: string[] | null;
  tags: string[] | null;
  user_notes: string | null;
  agenda_text: string | null;
  is_pinned: boolean;
  is_favorite: boolean;
  is_archived: boolean;
  speaker_labels: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

export interface RecordingPart {
  id: string;
  meeting_id: string;
  part_number: number;
  audio_file_path: string;
  duration_seconds: number;
  recorded_at: string;
  processing_status: ProcessingStatus;
  segment_count: number | null;
  created_at: string;
}

export interface RecordingSegment {
  id: string;
  recording_part_id: string;
  segment_number: number;
  audio_file_path: string;
  duration_seconds: number;
  byte_size: number | null;
  upload_status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  uploaded_at: string | null;
  created_at: string;
}

export interface Transcription {
  id: string;
  recording_part_id: string;
  full_text: string;
  speakers: SpeakerSegment[] | null;
  confidence_score: number | null;
  provider: string;
  processing_level: ProcessingLevel | null;
  created_at: string;
}

export interface SpeakerSegment {
  speaker: string;
  timestamp: string;
  text: string;
}

export interface Summary {
  id: string;
  transcription_id: string;
  executive_summary: string | null;
  key_points: string[] | null;
  decisions: string[] | null;
  action_items: ActionItem[] | null;
  created_at: string;
}

export interface ActionItem {
  action: string;
  owner: string | null;
  deadline: string | null;
}

export interface SharedLink {
  id: string;
  meeting_id: string;
  share_token: string;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
}

export interface UsageLog {
  id: string;
  user_id: string;
  recording_part_id: string | null;
  action_type: string;
  duration_minutes: number | null;
  cost_usd: number | null;
  created_at: string;
}
