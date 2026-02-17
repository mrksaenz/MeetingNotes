-- Migration: Add speaker_labels to meetings table
-- Purpose: Allow users to rename speakers (e.g., "A" → "Mark Saenz")
-- The speaker_labels column stores a JSON mapping like: {"A": "Mark Saenz", "B": "Jane Doe"}

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS speaker_labels JSONB DEFAULT '{}';

-- Add a comment for documentation
COMMENT ON COLUMN meetings.speaker_labels IS 'JSON mapping of speaker identifiers to display names, e.g. {"A": "Mark Saenz", "B": "Jane Doe"}';
