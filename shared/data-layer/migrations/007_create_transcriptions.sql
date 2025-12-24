-- Create transcriptions table for CISS audio transcription management
CREATE TABLE IF NOT EXISTS transcriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    encounter_id UUID,

    -- Audio metadata
    audio_uri VARCHAR(1000) NOT NULL,
    audio_duration_seconds INTEGER,

    -- Processing state
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,

    -- Transcript results (denormalized for performance)
    transcript_full_text TEXT,
    transcript_confidence_score DECIMAL(5,4),
    transcript_word_error_rate DECIMAL(5,4),

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,

    -- Enforce valid status values
    CONSTRAINT valid_transcription_status CHECK (
        status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')
    )
);

-- Create transcript_segments table for diarized segments
CREATE TABLE IF NOT EXISTS transcript_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcription_id UUID NOT NULL,
    speaker VARCHAR(20) NOT NULL,
    speaker_label VARCHAR(100),
    text TEXT NOT NULL,
    start_time_ms INTEGER NOT NULL,
    end_time_ms INTEGER NOT NULL,
    confidence DECIMAL(5,4) NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (transcription_id) REFERENCES transcriptions(id) ON DELETE CASCADE,

    -- Enforce valid speaker roles
    CONSTRAINT valid_speaker_role CHECK (
        speaker IN ('CLINICIAN', 'PATIENT', 'FAMILY_MEMBER', 'OTHER')
    )
);

-- Create extracted_entities table for NER results
CREATE TABLE IF NOT EXISTS extracted_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcription_id UUID NOT NULL,
    entity_type VARCHAR(20) NOT NULL,
    text VARCHAR(500) NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    confidence DECIMAL(5,4) NOT NULL,

    -- Normalized codes (RxNorm, SNOMED, ICD-10, etc.)
    normalized_code VARCHAR(50),
    normalized_system VARCHAR(50),
    normalized_display VARCHAR(500),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (transcription_id) REFERENCES transcriptions(id) ON DELETE CASCADE,

    -- Enforce valid entity types
    CONSTRAINT valid_entity_type CHECK (
        entity_type IN ('MEDICATION', 'SYMPTOM', 'VITAL_SIGN', 'ALLERGY', 'PROCEDURE', 'CONDITION', 'TEMPORAL')
    )
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_transcriptions_patient ON transcriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_transcriptions_encounter ON transcriptions(encounter_id);
CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);
CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcriptions_patient_status ON transcriptions(patient_id, status);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_transcription ON transcript_segments(transcription_id);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_time ON transcript_segments(transcription_id, start_time_ms);

CREATE INDEX IF NOT EXISTS idx_extracted_entities_transcription ON extracted_entities(transcription_id);
CREATE INDEX IF NOT EXISTS idx_extracted_entities_type ON extracted_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_extracted_entities_normalized ON extracted_entities(normalized_system, normalized_code);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_transcription_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_transcriptions_updated_at
    BEFORE UPDATE ON transcriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_transcription_updated_at();
