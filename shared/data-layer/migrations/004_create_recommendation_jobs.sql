-- Migration: Create recommendation jobs table
-- Created at: 2024-12-27T18:33:00.000Z

-- UP
CREATE TABLE recommendation_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES patient_sessions(session_id) ON DELETE CASCADE,
    patient_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    job_type VARCHAR(100) NOT NULL,
    priority INTEGER NOT NULL DEFAULT 2,
    input_data JSONB,
    results JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    
    CONSTRAINT valid_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT valid_job_type CHECK (job_type IN (
        'initial_assessment', 'data_update_trigger', 'periodic_review', 
        'emergency_alert'
    )),
    CONSTRAINT valid_priority CHECK (priority BETWEEN 1 AND 5)
);

CREATE INDEX idx_recommendation_jobs_session_id ON recommendation_jobs(session_id);
CREATE INDEX idx_recommendation_jobs_patient_id ON recommendation_jobs(patient_id);
CREATE INDEX idx_recommendation_jobs_status ON recommendation_jobs(status);
CREATE INDEX idx_recommendation_jobs_type ON recommendation_jobs(job_type);
CREATE INDEX idx_recommendation_jobs_priority ON recommendation_jobs(priority);
CREATE INDEX idx_recommendation_jobs_created_at ON recommendation_jobs(created_at);

-- Index for job queue processing (pending jobs by priority)
CREATE INDEX idx_recommendation_jobs_queue ON recommendation_jobs(status, priority DESC, created_at ASC) 
WHERE status = 'pending';

-- DOWN
DROP TABLE IF EXISTS recommendation_jobs;