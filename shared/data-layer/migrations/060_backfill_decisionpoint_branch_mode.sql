-- Migration 060: heuristic backfill of DecisionPoint.branch_mode.
--
-- We just added a `branch_mode` property to DecisionPoint so authors can
-- distinguish forks (`one_of` — patient takes one of the branches based on
-- criteria), concurrent fan-outs (`all_of` — every branch happens), and
-- optional add-ons (`any_of` — provider's choice).
--
-- Existing pathways have plenty of DecisionPoints that semantically mean
-- `all_of` (e.g. "after assessment, start workup AND prophylaxis"). The
-- heuristic: a true clinical decision needs criteria to choose between
-- branches — a DecisionPoint with NO HAS_CRITERION children isn't really
-- making a choice, so it's almost certainly `all_of`. Decisions WITH
-- criteria stay at the default `one_of`.
--
-- AGE stores pathway nodes / edges in graph form; we use a Cypher
-- statement inside SELECT * FROM cypher(...) to do the backfill. Idempotent:
-- only writes the property to nodes that don't already have one set.

BEGIN;

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- DecisionPoints that already declare a branch_mode are left untouched.
-- DecisionPoints with NO outgoing HAS_CRITERION → branch_mode = 'all_of'.
-- DecisionPoints WITH outgoing HAS_CRITERION → branch_mode = 'one_of'.
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
