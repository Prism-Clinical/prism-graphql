-- Create recommendations table
CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    provider_id UUID,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50), -- medication, lifestyle, follow-up, etc.
    priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high, urgent
    status VARCHAR(20) DEFAULT 'active', -- active, completed, dismissed, expired
    due_date DATE,
    evidence_level VARCHAR(20), -- A, B, C, etc.
    source VARCHAR(100), -- clinical_guidelines, ai_analysis, provider_notes
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
);

-- Create recommendation_items table for detailed action items
CREATE TABLE IF NOT EXISTS recommendation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    action_type VARCHAR(50), -- medication, test, appointment, lifestyle
    dosage VARCHAR(100),
    frequency VARCHAR(50),
    duration VARCHAR(50),
    instructions TEXT,
    completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_recommendations_patient ON recommendations(patient_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_provider ON recommendations(provider_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_status ON recommendations(status);
CREATE INDEX IF NOT EXISTS idx_recommendations_category ON recommendations(category);
CREATE INDEX IF NOT EXISTS idx_recommendation_items_recommendation ON recommendation_items(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_items_completed ON recommendation_items(completed);