-- Add is_archived column to meetings table
ALTER TABLE meetings ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for filtering archived meetings efficiently
CREATE INDEX idx_meetings_archived ON meetings (workspace_id, is_archived) WHERE is_archived = FALSE;
