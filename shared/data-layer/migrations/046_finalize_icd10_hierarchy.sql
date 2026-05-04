-- Migration 046: Finalize ICD-10 hierarchy after seed
--
-- Runs the parent_code derivation, recursive path build, synthetic-parent
-- backfill, NOT NULL on path, and FK on parent_code. Designed to run after
-- migration 045 (seed) so it has rows to operate on.
--
-- Fully idempotent — safe to re-run on environments where the older
-- monolithic 044 already populated paths and added constraints. Each step
-- only touches rows that don't yet match the target state.

-- =============================================================================
-- 1. Populate parent_code for any rows that don't have one yet
-- =============================================================================

UPDATE icd10_codes
SET parent_code = icd10_parent(code)
WHERE parent_code IS NULL
  AND length(code) > 3;

-- =============================================================================
-- 2. Backfill missing intermediate parents
-- =============================================================================
-- A child code may reference a parent that wasn't itself in the seed
-- (e.g. M15.0 present but M15 missing). Insert synthetic stubs for those so
-- the tree is complete; iterate until quiescent.

DO $$
DECLARE
  inserted_count INTEGER;
BEGIN
  LOOP
    INSERT INTO icd10_codes (code, description, category, category_description, is_billable, parent_code)
    SELECT DISTINCT
      child.parent_code,
      '<synthetic parent of ' || child.code || '>',
      substring(child.parent_code FROM 1 FOR 3),
      substring(child.parent_code FROM 1 FOR 3),
      false,
      icd10_parent(child.parent_code)
    FROM icd10_codes child
    LEFT JOIN icd10_codes existing ON child.parent_code = existing.code
    WHERE child.parent_code IS NOT NULL
      AND existing.code IS NULL
    ON CONFLICT (code) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    EXIT WHEN inserted_count = 0;
  END LOOP;
END $$;

-- =============================================================================
-- 3. Build ltree path via recursive CTE for any rows still missing one
-- =============================================================================

WITH RECURSIVE hierarchy AS (
  SELECT
    code,
    icd10_label(code)::ltree AS path
  FROM icd10_codes
  WHERE parent_code IS NULL

  UNION ALL

  SELECT
    child.code,
    parent.path || icd10_label(child.code)::ltree AS path
  FROM icd10_codes child
  JOIN hierarchy parent ON parent.code = child.parent_code
)
UPDATE icd10_codes
SET path = h.path
FROM hierarchy h
WHERE icd10_codes.code = h.code
  AND icd10_codes.path IS DISTINCT FROM h.path;

-- =============================================================================
-- 4. Enforce NOT NULL on path (idempotent — no-op if already set)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'icd10_codes'::regclass
      AND attname = 'path'
      AND NOT attnotnull
  ) THEN
    ALTER TABLE icd10_codes ALTER COLUMN path SET NOT NULL;
  END IF;
END $$;

-- =============================================================================
-- 5. Add FK on parent_code (idempotent — skipped if already present)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'icd10_parent_fk'
      AND conrelid = 'icd10_codes'::regclass
  ) THEN
    ALTER TABLE icd10_codes
      ADD CONSTRAINT icd10_parent_fk
      FOREIGN KEY (parent_code) REFERENCES icd10_codes(code)
      ON DELETE RESTRICT;
  END IF;
END $$;
