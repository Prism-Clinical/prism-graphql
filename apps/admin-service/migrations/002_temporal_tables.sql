-- Temporal Tables Migration
-- Adds version history tracking to all main data tables
-- Each UPDATE or DELETE automatically archives the previous version

BEGIN;

-- ============================================================================
-- STEP 1: Add temporal columns to main tables
-- ============================================================================

-- Add valid_from to track when each row version became active
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE medications ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE drug_interactions ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE safety_rules ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update existing rows to have valid_from = created_at
UPDATE admin_users SET valid_from = created_at WHERE valid_from IS NULL OR valid_from = NOW();
UPDATE medications SET valid_from = created_at WHERE valid_from IS NULL OR valid_from = NOW();
UPDATE drug_interactions SET valid_from = created_at WHERE valid_from IS NULL OR valid_from = NOW();
UPDATE safety_rules SET valid_from = created_at WHERE valid_from IS NULL OR valid_from = NOW();

-- ============================================================================
-- STEP 2: Create history tables (mirrors of main tables + valid_to)
-- ============================================================================

-- Admin Users History
CREATE TABLE IF NOT EXISTS admin_users_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Original columns
    id UUID NOT NULL,
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    -- Temporal columns
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_to TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Metadata
    changed_by UUID,
    change_type VARCHAR(10) NOT NULL DEFAULT 'UPDATE'
);

-- Medications History
CREATE TABLE IF NOT EXISTS medications_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Original columns
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    generic_name VARCHAR(255),
    drug_class VARCHAR(100),
    description TEXT,
    contraindications TEXT[],
    is_active BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    -- Temporal columns
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_to TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Metadata
    changed_by UUID,
    change_type VARCHAR(10) NOT NULL DEFAULT 'UPDATE'
);

-- Drug Interactions History
CREATE TABLE IF NOT EXISTS drug_interactions_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Original columns
    id UUID NOT NULL,
    medication_code VARCHAR(50) NOT NULL,
    interacting_drug_code VARCHAR(50) NOT NULL,
    interacting_drug_name VARCHAR(255) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    clinical_effect TEXT,
    management_recommendation TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    -- Temporal columns
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_to TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Metadata
    changed_by UUID,
    change_type VARCHAR(10) NOT NULL DEFAULT 'UPDATE'
);

-- Safety Rules History
CREATE TABLE IF NOT EXISTS safety_rules_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Original columns
    id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    rule_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    alert_message TEXT NOT NULL,
    trigger_conditions TEXT NOT NULL,
    is_active BOOLEAN,
    version VARCHAR(20),
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    -- Temporal columns
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_to TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Metadata
    changed_by UUID,
    change_type VARCHAR(10) NOT NULL DEFAULT 'UPDATE'
);

-- ============================================================================
-- STEP 3: Create indexes on history tables for efficient queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_admin_users_history_id ON admin_users_history(id);
CREATE INDEX IF NOT EXISTS idx_admin_users_history_valid_range ON admin_users_history(id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_admin_users_history_valid_to ON admin_users_history(valid_to DESC);

CREATE INDEX IF NOT EXISTS idx_medications_history_code ON medications_history(code);
CREATE INDEX IF NOT EXISTS idx_medications_history_valid_range ON medications_history(code, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_medications_history_valid_to ON medications_history(valid_to DESC);

CREATE INDEX IF NOT EXISTS idx_drug_interactions_history_id ON drug_interactions_history(id);
CREATE INDEX IF NOT EXISTS idx_drug_interactions_history_valid_range ON drug_interactions_history(id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_drug_interactions_history_valid_to ON drug_interactions_history(valid_to DESC);

CREATE INDEX IF NOT EXISTS idx_safety_rules_history_id ON safety_rules_history(id);
CREATE INDEX IF NOT EXISTS idx_safety_rules_history_valid_range ON safety_rules_history(id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_safety_rules_history_valid_to ON safety_rules_history(valid_to DESC);

-- ============================================================================
-- STEP 4: Create trigger functions for automatic versioning
-- ============================================================================

-- Generic function to archive admin_users before update/delete
CREATE OR REPLACE FUNCTION archive_admin_users()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        INSERT INTO admin_users_history (
            id, email, first_name, last_name, role, status,
            last_login_at, created_at, updated_at, valid_from, valid_to, change_type
        ) VALUES (
            OLD.id, OLD.email, OLD.first_name, OLD.last_name, OLD.role, OLD.status,
            OLD.last_login_at, OLD.created_at, OLD.updated_at, OLD.valid_from, NOW(),
            CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END
        );
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        NEW.valid_from = NOW();
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Generic function to archive medications before update/delete
CREATE OR REPLACE FUNCTION archive_medications()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        INSERT INTO medications_history (
            code, name, generic_name, drug_class, description,
            contraindications, is_active, created_at, updated_at, valid_from, valid_to, change_type
        ) VALUES (
            OLD.code, OLD.name, OLD.generic_name, OLD.drug_class, OLD.description,
            OLD.contraindications, OLD.is_active, OLD.created_at, OLD.updated_at, OLD.valid_from, NOW(),
            CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END
        );
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        NEW.valid_from = NOW();
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Generic function to archive drug_interactions before update/delete
CREATE OR REPLACE FUNCTION archive_drug_interactions()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        INSERT INTO drug_interactions_history (
            id, medication_code, interacting_drug_code, interacting_drug_name,
            severity, description, clinical_effect, management_recommendation,
            created_at, valid_from, valid_to, change_type
        ) VALUES (
            OLD.id, OLD.medication_code, OLD.interacting_drug_code, OLD.interacting_drug_name,
            OLD.severity, OLD.description, OLD.clinical_effect, OLD.management_recommendation,
            OLD.created_at, OLD.valid_from, NOW(),
            CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END
        );
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        NEW.valid_from = NOW();
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Generic function to archive safety_rules before update/delete
CREATE OR REPLACE FUNCTION archive_safety_rules()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        INSERT INTO safety_rules_history (
            id, name, rule_type, severity, description, alert_message,
            trigger_conditions, is_active, version, created_by, created_at, updated_at,
            valid_from, valid_to, change_type
        ) VALUES (
            OLD.id, OLD.name, OLD.rule_type, OLD.severity, OLD.description, OLD.alert_message,
            OLD.trigger_conditions, OLD.is_active, OLD.version, OLD.created_by, OLD.created_at, OLD.updated_at,
            OLD.valid_from, NOW(),
            CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END
        );
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        NEW.valid_from = NOW();
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 5: Create triggers on main tables
-- ============================================================================

DROP TRIGGER IF EXISTS archive_admin_users_trigger ON admin_users;
CREATE TRIGGER archive_admin_users_trigger
    BEFORE UPDATE OR DELETE ON admin_users
    FOR EACH ROW
    EXECUTE FUNCTION archive_admin_users();

DROP TRIGGER IF EXISTS archive_medications_trigger ON medications;
CREATE TRIGGER archive_medications_trigger
    BEFORE UPDATE OR DELETE ON medications
    FOR EACH ROW
    EXECUTE FUNCTION archive_medications();

DROP TRIGGER IF EXISTS archive_drug_interactions_trigger ON drug_interactions;
CREATE TRIGGER archive_drug_interactions_trigger
    BEFORE UPDATE OR DELETE ON drug_interactions
    FOR EACH ROW
    EXECUTE FUNCTION archive_drug_interactions();

DROP TRIGGER IF EXISTS archive_safety_rules_trigger ON safety_rules;
CREATE TRIGGER archive_safety_rules_trigger
    BEFORE UPDATE OR DELETE ON safety_rules
    FOR EACH ROW
    EXECUTE FUNCTION archive_safety_rules();

-- ============================================================================
-- STEP 6: Create helper views for querying history
-- ============================================================================

-- View: All versions of admin_users (current + history)
CREATE OR REPLACE VIEW admin_users_all_versions AS
SELECT
    id, email, first_name, last_name, role, status,
    last_login_at, created_at, updated_at, valid_from,
    NULL::TIMESTAMP WITH TIME ZONE as valid_to,
    'CURRENT' as version_status
FROM admin_users
UNION ALL
SELECT
    id, email, first_name, last_name, role, status,
    last_login_at, created_at, updated_at, valid_from, valid_to,
    change_type as version_status
FROM admin_users_history
ORDER BY id, valid_from DESC;

-- View: All versions of medications (current + history)
CREATE OR REPLACE VIEW medications_all_versions AS
SELECT
    code, name, generic_name, drug_class, description,
    contraindications, is_active, created_at, updated_at, valid_from,
    NULL::TIMESTAMP WITH TIME ZONE as valid_to,
    'CURRENT' as version_status
FROM medications
UNION ALL
SELECT
    code, name, generic_name, drug_class, description,
    contraindications, is_active, created_at, updated_at, valid_from, valid_to,
    change_type as version_status
FROM medications_history
ORDER BY code, valid_from DESC;

-- View: All versions of drug_interactions (current + history)
CREATE OR REPLACE VIEW drug_interactions_all_versions AS
SELECT
    id, medication_code, interacting_drug_code, interacting_drug_name,
    severity, description, clinical_effect, management_recommendation,
    created_at, valid_from,
    NULL::TIMESTAMP WITH TIME ZONE as valid_to,
    'CURRENT' as version_status
FROM drug_interactions
UNION ALL
SELECT
    id, medication_code, interacting_drug_code, interacting_drug_name,
    severity, description, clinical_effect, management_recommendation,
    created_at, valid_from, valid_to,
    change_type as version_status
FROM drug_interactions_history
ORDER BY id, valid_from DESC;

-- View: All versions of safety_rules (current + history)
CREATE OR REPLACE VIEW safety_rules_all_versions AS
SELECT
    id, name, rule_type, severity, description, alert_message,
    trigger_conditions, is_active, version, created_by, created_at, updated_at,
    valid_from,
    NULL::TIMESTAMP WITH TIME ZONE as valid_to,
    'CURRENT' as version_status
FROM safety_rules
UNION ALL
SELECT
    id, name, rule_type, severity, description, alert_message,
    trigger_conditions, is_active, version, created_by, created_at, updated_at,
    valid_from, valid_to,
    change_type as version_status
FROM safety_rules_history
ORDER BY id, valid_from DESC;

-- ============================================================================
-- STEP 7: Create helper functions for point-in-time queries
-- ============================================================================

-- Function: Get safety rule as it existed at a specific point in time
CREATE OR REPLACE FUNCTION get_safety_rule_at_time(
    p_id UUID,
    p_timestamp TIMESTAMP WITH TIME ZONE
) RETURNS TABLE (
    id UUID,
    name VARCHAR(255),
    rule_type VARCHAR(50),
    severity VARCHAR(20),
    description TEXT,
    alert_message TEXT,
    trigger_conditions TEXT,
    is_active BOOLEAN,
    version VARCHAR(20),
    valid_from TIMESTAMP WITH TIME ZONE,
    valid_to TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    -- First check if current version was valid at that time
    RETURN QUERY
    SELECT
        sr.id, sr.name, sr.rule_type, sr.severity, sr.description,
        sr.alert_message, sr.trigger_conditions, sr.is_active, sr.version,
        sr.valid_from, NULL::TIMESTAMP WITH TIME ZONE
    FROM safety_rules sr
    WHERE sr.id = p_id AND sr.valid_from <= p_timestamp;

    IF NOT FOUND THEN
        -- Check history
        RETURN QUERY
        SELECT
            srh.id, srh.name, srh.rule_type, srh.severity, srh.description,
            srh.alert_message, srh.trigger_conditions, srh.is_active, srh.version,
            srh.valid_from, srh.valid_to
        FROM safety_rules_history srh
        WHERE srh.id = p_id
            AND srh.valid_from <= p_timestamp
            AND srh.valid_to > p_timestamp;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function: Get version count for a safety rule
CREATE OR REPLACE FUNCTION get_safety_rule_version_count(p_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) + 1 INTO v_count
    FROM safety_rules_history
    WHERE id = p_id;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================================================
-- Usage Examples (commented out, for reference)
-- ============================================================================

-- Get all versions of a specific safety rule:
-- SELECT * FROM safety_rules_all_versions WHERE id = 'some-uuid' ORDER BY valid_from DESC;

-- Get a safety rule as it was on a specific date:
-- SELECT * FROM get_safety_rule_at_time('some-uuid', '2024-01-15 10:00:00+00');

-- Get version count for a safety rule:
-- SELECT get_safety_rule_version_count('some-uuid');

-- Get all changes made today:
-- SELECT * FROM safety_rules_history WHERE valid_to >= CURRENT_DATE ORDER BY valid_to DESC;
