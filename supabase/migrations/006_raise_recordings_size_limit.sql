-- Migration 006: Raise the recordings bucket file size limit
--
-- Large voice-memo uploads (e.g. a 5-hour board meeting recorded on a phone)
-- were failing with HTTP 413 "Maximum allowed file size exceeded" because the
-- `recordings` bucket inherited the project's small default upload limit.
--
-- This raises the per-file limit on the bucket to 5 GB.
--
-- IMPORTANT: the bucket limit cannot exceed the PROJECT-WIDE upload limit, which
-- is NOT set here. On a Pro (or higher) plan, also raise it in the dashboard:
--   Project Settings → Storage → "Upload file size limit"  (set to >= 5 GB)
-- Otherwise uploads will still be capped at the lower global value.

UPDATE storage.buckets
SET file_size_limit = 5368709120  -- 5 GB, in bytes
WHERE id = 'recordings';
