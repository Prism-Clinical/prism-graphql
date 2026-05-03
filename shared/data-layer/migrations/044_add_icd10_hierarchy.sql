-- Migration 044: Add ICD-10 hierarchy schema (additive, seed-order-independent)
--
-- Phase 0 of ontology-aware pathway matching. Adds parent_code and path
-- columns to icd10_codes, enables ltree, and creates the supporting helper
-- functions and indexes. NULL constraints + FK live in migration 046, after
-- the seed (migration 045) has loaded its rows.
--
-- This split is what makes `make migrate` work as a single pass on fresh
-- installs: 044 adds columns nullable → 045 loads seed → 046 finalizes.
-- Existing environments where the older monolithic 044 already ran are
-- unaffected; 046 is idempotent and skips work that's already done.

CREATE EXTENSION IF NOT EXISTS ltree;

-- =============================================================================
-- 1. SQL helper functions
-- =============================================================================

CREATE OR REPLACE FUNCTION icd10_parent(code VARCHAR) RETURNS VARCHAR AS $$
BEGIN
  IF length(code) <= 3 THEN
    RETURN NULL;
  ELSIF length(code) = 5 THEN
    RETURN substring(code FROM 1 FOR 3);
  ELSE
    RETURN substring(code FROM 1 FOR length(code) - 1);
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION icd10_label(code VARCHAR) RETURNS VARCHAR AS $$
BEGIN
  RETURN replace(code, '.', '_');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================================================
-- 2. Add columns (nullable; constraints in 046)
-- =============================================================================

ALTER TABLE icd10_codes ADD COLUMN IF NOT EXISTS parent_code VARCHAR(10);
ALTER TABLE icd10_codes ADD COLUMN IF NOT EXISTS path ltree;

-- =============================================================================
-- 3. Indexes (safe to create on empty/sparse data)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_icd10_path_gist ON icd10_codes USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_icd10_parent_btree ON icd10_codes (parent_code);

-- =============================================================================
-- 4. Comments
-- =============================================================================

COMMENT ON COLUMN icd10_codes.parent_code IS 'Parent code in the ICD-10 dot-notation hierarchy. NULL for 3-char roots. Populated by migration 046.';
COMMENT ON COLUMN icd10_codes.path IS 'ltree path representing this code''s position in the hierarchy. Populated by migration 046.';
COMMENT ON FUNCTION icd10_parent(VARCHAR) IS 'Derive parent ICD-10 code from a child via dot-notation length rule.';
COMMENT ON FUNCTION icd10_label(VARCHAR) IS 'Convert an ICD-10 code into a valid ltree label (dots → underscores).';
