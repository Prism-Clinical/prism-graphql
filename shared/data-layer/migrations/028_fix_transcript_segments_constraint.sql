-- Add unique constraints on (transcription_id, id) for ON CONFLICT upsert support
-- The transcription worker uses ON CONFLICT (transcription_id, id) for idempotent segment/entity inserts,
-- but PostgreSQL requires an exact matching unique index for ON CONFLICT targets.

-- transcript_segments: id is already a PK (unique alone), add composite unique constraint
ALTER TABLE transcript_segments
    ADD CONSTRAINT uq_transcript_segments_transcription_id
    UNIQUE (transcription_id, id);

-- extracted_entities: same pattern
ALTER TABLE extracted_entities
    ADD CONSTRAINT uq_extracted_entities_transcription_id
    UNIQUE (transcription_id, id);
