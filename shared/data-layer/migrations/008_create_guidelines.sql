-- Create guidelines table for CISS RAG service
CREATE TABLE IF NOT EXISTS guidelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(20) NOT NULL,
    source_id VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    category VARCHAR(20) NOT NULL,

    -- Evidence
    evidence_grade VARCHAR(5),
    recommendation_strength VARCHAR(20),

    -- Applicability criteria
    applicable_conditions TEXT[] DEFAULT '{}',
    applicable_medications TEXT[] DEFAULT '{}',
    age_range_min INTEGER,
    age_range_max INTEGER,
    applicable_sex VARCHAR(10),

    -- Content
    summary_text TEXT NOT NULL,
    full_text TEXT,

    -- Dates
    published_date DATE,
    last_reviewed_date DATE,
    expiration_date DATE,
    version VARCHAR(20),

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT valid_guideline_source CHECK (
        source IN ('USPSTF', 'AHA', 'ADA', 'ACOG', 'AAP', 'CDC', 'WHO', 'CUSTOM')
    ),
    CONSTRAINT valid_guideline_category CHECK (
        category IN ('SCREENING', 'PREVENTION', 'TREATMENT', 'MONITORING', 'LIFESTYLE', 'IMMUNIZATION')
    ),
    CONSTRAINT valid_evidence_grade CHECK (
        evidence_grade IS NULL OR evidence_grade IN ('A', 'B', 'C', 'D', 'I')
    ),

    -- Unique constraint on source + source_id
    UNIQUE (source, source_id)
);

-- Create guideline citations table
CREATE TABLE IF NOT EXISTS guideline_citations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guideline_id UUID NOT NULL,
    reference TEXT NOT NULL,
    url VARCHAR(1000),
    pubmed_id VARCHAR(20),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (guideline_id) REFERENCES guidelines(id) ON DELETE CASCADE
);

-- Create RAG syntheses table
CREATE TABLE IF NOT EXISTS rag_syntheses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,

    -- Query context
    query_type VARCHAR(20) NOT NULL,
    query_condition_codes TEXT[] DEFAULT '{}',
    query_medication_codes TEXT[] DEFAULT '{}',

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',

    -- Processing metadata
    processing_time_ms INTEGER,
    guidelines_consulted INTEGER,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,

    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,

    CONSTRAINT valid_rag_query_type CHECK (
        query_type IN ('BY_CONDITION', 'BY_MEDICATION', 'BY_DEMOGRAPHICS', 'BY_GUIDELINE_ID')
    ),
    CONSTRAINT valid_synthesis_status CHECK (
        status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
    )
);

-- Create synthesized recommendations table
CREATE TABLE IF NOT EXISTS synthesized_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rag_synthesis_id UUID NOT NULL,
    guideline_id UUID NOT NULL,

    recommendation_text TEXT NOT NULL,
    rationale TEXT NOT NULL,
    evidence_grade VARCHAR(5),

    applicability_score DECIMAL(3,2) NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (rag_synthesis_id) REFERENCES rag_syntheses(id) ON DELETE CASCADE,
    FOREIGN KEY (guideline_id) REFERENCES guidelines(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_guidelines_source ON guidelines(source);
CREATE INDEX IF NOT EXISTS idx_guidelines_category ON guidelines(category);
CREATE INDEX IF NOT EXISTS idx_guidelines_conditions ON guidelines USING GIN(applicable_conditions);
CREATE INDEX IF NOT EXISTS idx_guidelines_medications ON guidelines USING GIN(applicable_medications);

CREATE INDEX IF NOT EXISTS idx_guideline_citations_guideline ON guideline_citations(guideline_id);

CREATE INDEX IF NOT EXISTS idx_rag_syntheses_patient ON rag_syntheses(patient_id);
CREATE INDEX IF NOT EXISTS idx_rag_syntheses_status ON rag_syntheses(status);
CREATE INDEX IF NOT EXISTS idx_rag_syntheses_created_at ON rag_syntheses(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synthesized_recommendations_synthesis ON synthesized_recommendations(rag_synthesis_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_guideline_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_guidelines_updated_at
    BEFORE UPDATE ON guidelines
    FOR EACH ROW
    EXECUTE FUNCTION update_guideline_updated_at();
