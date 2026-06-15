-- Migration 005: Agenda reference + manual transcript uploads
--
-- Adds an optional agenda/reference text to meetings. The agenda is fed to
-- Claude as cached context during summarization so the executive summary,
-- key points, decisions, and action items are organized around the agenda.
--
-- Manual transcript uploads reuse the existing transcriptions table with
-- provider = 'manual'. No schema change is required for that beyond allowing
-- recording_parts to exist with an empty audio_file_path (already allowed).

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS agenda_text TEXT;

-- Helpful for the "process" pipeline: lets us look up the most recent
-- transcription for a recording part quickly when re-summarizing without
-- re-transcribing.
CREATE INDEX IF NOT EXISTS idx_transcriptions_part_created
  ON transcriptions (recording_part_id, created_at DESC);
