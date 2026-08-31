-- Migration 066: backfill the DecisionPoints migration 060 did not reach.
--
-- 060 applied a heuristic backfill of `branch_mode`, but three DecisionPoints
-- still carry NULL — they belong to pathways imported after 060 ran:
--
--   vaginal-discharge-pregnancy-v1 v1.0  dp-1
--   routine-prenatal-care-v1       v1.0  dp-1
--   anemia-pregnancy-v1            v1.0  dp-1
--
-- All three are on ARCHIVED pathways; no ACTIVE or DRAFT pathway is affected.
--
-- This matters now because `branch_mode` stopped being decorative. The
-- resolution engine reads it, and the import validator is about to require it,
-- so a NULL would make these pathways non-importable — and, since activation
-- re-validates the stored graph, non-reactivatable.
--
-- The heuristic is 060's, reused verbatim rather than reinvented: a
-- DecisionPoint with no HAS_CRITERION children is not really choosing between
-- branches, so `all_of`; one with criteria is making a choice, so `one_of`.
-- Keeping the two migrations in agreement matters more than a cleverer rule —
-- a pathway backfilled by 060 and one backfilled here must mean the same thing.
--
-- Idempotent: the WHERE guard matches nothing on a second run.

BEGIN;

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

SELECT * FROM cypher('clinical_pathways', $$
    MATCH (dp:DecisionPoint)
    WHERE dp.branch_mode IS NULL
    OPTIONAL MATCH (dp)-[r:HAS_CRITERION]->()
    WITH dp, count(r) AS criterion_count
    SET dp.branch_mode = CASE
      WHEN criterion_count = 0 THEN 'all_of'
      ELSE 'one_of'
    END
    RETURN count(dp) AS updated
$$) AS (updated agtype);

COMMIT;
