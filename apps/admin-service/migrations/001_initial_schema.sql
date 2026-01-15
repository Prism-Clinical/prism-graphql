-- Admin Service Database Schema
-- Run this migration to set up the required tables

-- Admin Users table
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'READ_ONLY',
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT admin_users_role_check CHECK (role IN ('ADMIN', 'CLINICIAN', 'REVIEWER', 'AUDITOR', 'READ_ONLY')),
    CONSTRAINT admin_users_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING'))
);

-- Medications table
CREATE TABLE IF NOT EXISTS medications (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    generic_name VARCHAR(255),
    drug_class VARCHAR(100),
    description TEXT,
    contraindications TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Drug Interactions table
CREATE TABLE IF NOT EXISTS drug_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medication_code VARCHAR(50) NOT NULL REFERENCES medications(code) ON DELETE CASCADE,
    interacting_drug_code VARCHAR(50) NOT NULL,
    interacting_drug_name VARCHAR(255) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    clinical_effect TEXT,
    management_recommendation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT drug_interactions_severity_check CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')),
    UNIQUE(medication_code, interacting_drug_code)
);

-- Safety Rules table
CREATE TABLE IF NOT EXISTS safety_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    rule_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    alert_message TEXT NOT NULL,
    trigger_conditions TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    version VARCHAR(20) DEFAULT '1.0',
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT safety_rules_type_check CHECK (rule_type IN ('DRUG_INTERACTION', 'ALLERGY_ALERT', 'CONTRAINDICATION', 'DOSAGE_CHECK', 'AGE_RESTRICTION', 'LAB_VALUE_CHECK')),
    CONSTRAINT safety_rules_severity_check CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'))
);

-- Audit Logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    user_id UUID,
    user_name VARCHAR(255),
    changes JSONB,
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT audit_logs_action_check CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'IMPORT', 'EXPORT', 'LOGIN', 'LOGOUT', 'VIEW')),
    CONSTRAINT audit_logs_entity_type_check CHECK (entity_type IN ('USER', 'CARE_PLAN_TEMPLATE', 'SAFETY_RULE', 'MEDICATION', 'PATIENT', 'CARE_PLAN', 'IMPORT_JOB'))
);

-- Import Jobs table
CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    file_name VARCHAR(255) NOT NULL,
    total_rows INTEGER DEFAULT 0,
    processed_rows INTEGER DEFAULT 0,
    success_rows INTEGER DEFAULT 0,
    error_rows INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]'::jsonb,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT import_jobs_type_check CHECK (type IN ('PATIENTS', 'CARE_PLAN_TEMPLATES', 'SAFETY_RULES', 'MEDICATIONS')),
    CONSTRAINT import_jobs_status_check CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_users_status ON admin_users(status);

CREATE INDEX IF NOT EXISTS idx_medications_name ON medications(name);
CREATE INDEX IF NOT EXISTS idx_medications_drug_class ON medications(drug_class);
CREATE INDEX IF NOT EXISTS idx_medications_is_active ON medications(is_active);

CREATE INDEX IF NOT EXISTS idx_drug_interactions_medication_code ON drug_interactions(medication_code);
CREATE INDEX IF NOT EXISTS idx_drug_interactions_interacting_drug_code ON drug_interactions(interacting_drug_code);

CREATE INDEX IF NOT EXISTS idx_safety_rules_rule_type ON safety_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_safety_rules_severity ON safety_rules(severity);
CREATE INDEX IF NOT EXISTS idx_safety_rules_is_active ON safety_rules(is_active);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_import_jobs_type ON import_jobs(type);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at
DROP TRIGGER IF EXISTS update_admin_users_updated_at ON admin_users;
CREATE TRIGGER update_admin_users_updated_at
    BEFORE UPDATE ON admin_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_medications_updated_at ON medications;
CREATE TRIGGER update_medications_updated_at
    BEFORE UPDATE ON medications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_safety_rules_updated_at ON safety_rules;
CREATE TRIGGER update_safety_rules_updated_at
    BEFORE UPDATE ON safety_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert sample data for testing
INSERT INTO admin_users (email, first_name, last_name, role, status) VALUES
    ('admin@prism.health', 'System', 'Administrator', 'ADMIN', 'ACTIVE'),
    ('john.smith@prism.health', 'John', 'Smith', 'CLINICIAN', 'ACTIVE'),
    ('sarah.johnson@prism.health', 'Sarah', 'Johnson', 'REVIEWER', 'ACTIVE')
ON CONFLICT (email) DO NOTHING;

INSERT INTO medications (code, name, generic_name, drug_class, description) VALUES
    ('RX001', 'Metformin', 'Metformin HCl', 'Biguanides', 'Oral diabetes medicine that helps control blood sugar levels'),
    ('RX002', 'Lisinopril', 'Lisinopril', 'ACE Inhibitors', 'Used to treat high blood pressure and heart failure'),
    ('RX003', 'Warfarin', 'Warfarin Sodium', 'Anticoagulants', 'Blood thinner used to prevent blood clots'),
    ('RX004', 'Atorvastatin', 'Atorvastatin Calcium', 'Statins', 'Used to lower cholesterol and triglyceride levels'),
    ('RX005', 'Omeprazole', 'Omeprazole', 'Proton Pump Inhibitors', 'Used to treat gastroesophageal reflux disease (GERD)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO drug_interactions (medication_code, interacting_drug_code, interacting_drug_name, severity, description) VALUES
    ('RX003', 'RX004', 'Atorvastatin', 'HIGH', 'Warfarin and statins may increase bleeding risk'),
    ('RX002', 'RX001', 'Metformin', 'MEDIUM', 'ACE inhibitors may increase the hypoglycemic effect of metformin'),
    ('RX003', 'ASPIRIN', 'Aspirin', 'CRITICAL', 'Concurrent use significantly increases bleeding risk')
ON CONFLICT (medication_code, interacting_drug_code) DO NOTHING;

INSERT INTO safety_rules (name, rule_type, severity, description, alert_message, trigger_conditions) VALUES
    ('Warfarin-NSAID Interaction', 'DRUG_INTERACTION', 'CRITICAL', 'Warfarin combined with NSAIDs increases bleeding risk', 'CRITICAL: Patient is on Warfarin. NSAIDs significantly increase bleeding risk.', '{"drug1": "WARFARIN", "drugClass2": "NSAID"}'),
    ('ACE Inhibitor in Pregnancy', 'CONTRAINDICATION', 'CRITICAL', 'ACE inhibitors are contraindicated in pregnancy', 'CRITICAL: ACE inhibitors are contraindicated during pregnancy - risk of fetal harm.', '{"drugClass": "ACE_INHIBITOR", "condition": "PREGNANCY"}'),
    ('Metformin Renal Function Check', 'LAB_VALUE_CHECK', 'HIGH', 'Monitor renal function in patients on metformin', 'Check eGFR before prescribing metformin. Contraindicated if eGFR < 30.', '{"drug": "METFORMIN", "labValue": "eGFR", "threshold": "<30"}')
ON CONFLICT DO NOTHING;

COMMIT;
