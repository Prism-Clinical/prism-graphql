-- Migration 048: Backfill pathway_code_sets from pathway_condition_codes
--
-- For each existing row in pathway_condition_codes, create:
--   1. one row in pathway_code_sets (single-element set, EXACT scope)
--   2. one row in pathway_code_set_members (the code + system)
--
-- This preserves the legacy "any code matches" disjunction semantics: each
-- old code becomes its own set, and a pathway matches if ANY of its sets
-- matches. Authors who want explicit conjunctions upload the new code_sets
-- JSON shape going forward.
--
-- Idempotent: guarded against re-run via "if already migrated" check up front.
-- The unique constraint on (code_set_id, code, system) protects member-level
-- duplicates if anything goes sideways.

DO $$
DECLARE
  rec RECORD;
  set_id UUID;
  already_migrated BOOLEAN;
BEGIN
  -- Idempotency guard: if any pathway already has code sets and at least one
  -- pathway has condition codes, we assume the backfill already ran and skip.
  -- (If you need to re-run for testing, TRUNCATE pathway_code_sets first.)
  SELECT EXISTS (
    SELECT 1 FROM pathway_code_sets LIMIT 1
  ) INTO already_migrated;

  IF already_migrated THEN
    RAISE NOTICE 'Migration 048: pathway_code_sets already populated, skipping backfill';
    RETURN;
  END IF;

  FOR rec IN
    SELECT id, pathway_id, code, system, description, usage, grouping
    FROM pathway_condition_codes
    ORDER BY pathway_id, code, system
  LOOP
    set_id := gen_random_uuid();

    INSERT INTO pathway_code_sets
      (id, pathway_id, scope, semantics, entry_node_id, description)
    VALUES (
      set_id,
      rec.pathway_id,
      'EXACT',
      'ALL_OF',
      NULL,
      COALESCE(rec.description, 'Migrated from pathway_condition_codes')
    );

    INSERT INTO pathway_code_set_members
      (code_set_id, code, system, scope_override, description)
    VALUES (
      set_id,
      rec.code,
      rec.system,
      NULL,
      rec.usage
    )
    ON CONFLICT (code_set_id, code, system) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Migration 048: backfilled % code sets from pathway_condition_codes',
    (SELECT count(*) FROM pathway_code_sets);
END $$;
