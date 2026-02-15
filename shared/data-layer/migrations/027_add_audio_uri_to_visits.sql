-- Add audio upload tracking columns to visits table
ALTER TABLE visits ADD COLUMN IF NOT EXISTS audio_uri VARCHAR(1000);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS audio_uploaded_at TIMESTAMP WITH TIME ZONE;

-- Index for finding visits with audio
CREATE INDEX IF NOT EXISTS idx_visits_audio_uri ON visits(audio_uri) WHERE audio_uri IS NOT NULL;
