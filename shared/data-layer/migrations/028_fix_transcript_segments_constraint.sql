-- Required for ON CONFLICT (transcription_id, id) in transcription worker upserts.
-- id is already a PK (unique alone), but PostgreSQL requires an exact matching
-- composite index for ON CONFLICT targets — a superset won't match.

-- transcript_segments
ALTER TABLE transcript_segments
    ADD CONSTRAINT uq_transcript_segments_transcription_id
    UNIQUE (transcription_id, id);

-- extracted_entities
ALTER TABLE extracted_entities
    ADD CONSTRAINT uq_extracted_entities_transcription_id
    UNIQUE (transcription_id, id);
