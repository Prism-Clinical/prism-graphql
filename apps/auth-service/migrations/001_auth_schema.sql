-- Auth Service Schema Migration
-- Adds authentication tables for Admin and Provider users

-- =============================================================================
-- MODIFY ADMIN_USERS TABLE
-- =============================================================================

-- Add password and auth fields to admin_users if they don't exist
ALTER TABLE admin_users
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- =============================================================================
-- INSTITUTIONS TABLE - Add auth columns to existing table
-- =============================================================================

-- Add code and domain columns if they don't exist (table already exists from institutions service)
ALTER TABLE institutions
ADD COLUMN IF NOT EXISTS code VARCHAR(50) UNIQUE,
ADD COLUMN IF NOT EXISTS domain VARCHAR(255),
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_institutions_code ON institutions(code);
CREATE INDEX IF NOT EXISTS idx_institutions_domain ON institutions(domain);

-- =============================================================================
-- APPROVED DOMAINS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS approved_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(255) UNIQUE NOT NULL,
    organization_name VARCHAR(255) NOT NULL,
    domain_type VARCHAR(50) NOT NULL CHECK (domain_type IN ('HOSPITAL', 'ACADEMIC', 'RESEARCH', 'CLINIC', 'INTERNAL')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approved_domains_domain ON approved_domains(domain);

-- =============================================================================
-- PROVIDER USERS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS provider_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    npi VARCHAR(10) UNIQUE NOT NULL,
    institution_id UUID REFERENCES institutions(id),
    role VARCHAR(50) NOT NULL CHECK (role IN ('PHYSICIAN', 'NURSE', 'PHARMACIST', 'CARE_COORDINATOR')),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'SUSPENDED')),
    email_verified BOOLEAN DEFAULT FALSE,
    npi_verified BOOLEAN DEFAULT FALSE,
    admin_approved BOOLEAN DEFAULT FALSE,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_users_email ON provider_users(email);
CREATE INDEX IF NOT EXISTS idx_provider_users_npi ON provider_users(npi);
CREATE INDEX IF NOT EXISTS idx_provider_users_status ON provider_users(status);
CREATE INDEX IF NOT EXISTS idx_provider_users_institution ON provider_users(institution_id);

-- =============================================================================
-- EMAIL VERIFICATION TOKENS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('ADMIN', 'PROVIDER')),
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user ON email_verification_tokens(user_id, user_type);

-- =============================================================================
-- REFRESH TOKENS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('ADMIN', 'PROVIDER')),
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, user_type);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- =============================================================================
-- PASSWORD RESET TOKENS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('ADMIN', 'PROVIDER')),
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);

-- =============================================================================
-- PROVIDER APPROVAL REQUESTS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS provider_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_user_id UUID NOT NULL REFERENCES provider_users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by UUID REFERENCES admin_users(id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_approval_requests_status ON provider_approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_provider_approval_requests_provider ON provider_approval_requests(provider_user_id);

-- =============================================================================
-- SEED DATA: APPROVED DOMAINS
-- =============================================================================

INSERT INTO approved_domains (domain, organization_name, domain_type) VALUES
    ('stanford.edu', 'Stanford University Medical Center', 'ACADEMIC'),
    ('mayo.edu', 'Mayo Clinic', 'HOSPITAL'),
    ('jhmi.edu', 'Johns Hopkins Medicine', 'ACADEMIC'),
    ('clevelandclinic.org', 'Cleveland Clinic', 'HOSPITAL'),
    ('massgeneral.org', 'Massachusetts General Hospital', 'HOSPITAL'),
    ('ucsf.edu', 'UCSF Medical Center', 'ACADEMIC'),
    ('upenn.edu', 'University of Pennsylvania Health System', 'ACADEMIC'),
    ('mountsinai.org', 'Mount Sinai Health System', 'HOSPITAL'),
    ('prism-clinical.com', 'Prism Clinical (Internal)', 'INTERNAL')
ON CONFLICT (domain) DO NOTHING;

-- =============================================================================
-- SEED DATA: SAMPLE INSTITUTIONS (update existing or insert new)
-- =============================================================================

-- Update existing institutions with codes, or insert new ones
INSERT INTO institutions (name, code, domain, is_active) VALUES
    ('Stanford University Medical Center', 'STANFORD', 'stanford.edu', TRUE),
    ('Mayo Clinic', 'MAYO', 'mayo.edu', TRUE),
    ('Johns Hopkins Hospital', 'JHH', 'jhmi.edu', TRUE),
    ('Cleveland Clinic', 'CCLINIC', 'clevelandclinic.org', TRUE),
    ('Massachusetts General Hospital', 'MGH', 'massgeneral.org', TRUE),
    ('UCSF Medical Center', 'UCSF', 'ucsf.edu', TRUE),
    ('Penn Medicine', 'UPENN', 'upenn.edu', TRUE),
    ('Mount Sinai Hospital', 'MSINAI', 'mountsinai.org', TRUE)
ON CONFLICT (code) DO UPDATE SET
    domain = EXCLUDED.domain,
    is_active = EXCLUDED.is_active;
