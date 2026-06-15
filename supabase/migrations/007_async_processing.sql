-- Migration 007: Asynchronous transcription support
--
-- Long (multi-hour) single-file uploads can't be transcribed synchronously
-- inside a Vercel function (300s cap). Instead we submit the job to AssemblyAI,
-- return immediately, and poll /api/process/status until it completes.
--
-- These columns let the poll route track the in-flight job and finalize it
-- exactly once.

ALTER TABLE recording_parts
  ADD COLUMN IF NOT EXISTS transcript_job_id TEXT,        -- AssemblyAI transcript id while in flight
  ADD COLUMN IF NOT EXISTS requested_level   TEXT,        -- processing level to apply on completion
  ADD COLUMN IF NOT EXISTS finalizing_at     TIMESTAMPTZ; -- claim lock so overlapping polls finalize once
