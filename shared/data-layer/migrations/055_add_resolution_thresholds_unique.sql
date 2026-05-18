-- Migration 055: add the missing uniqueness constraint on
-- `confidence_resolution_thresholds`.
--
-- Background: `setResolutionThresholds` in
-- apps/pathway-service/src/resolvers/mutations/confidence.ts:212 does an
-- upsert keyed on (scope, pathway_id, node_identifier, institution_id) via
--   ON CONFLICT ON CONSTRAINT confidence_resolution_thresholds_unique
-- but no such constraint exists on the live table — calling the mutation
-- would raise "constraint does not exist" at runtime. Live table only has
-- the PK, a few non-unique indexes, the scope CHECK, and an FK to
-- pathway_graph_index.
--
-- NULLS NOT DISTINCT is required because pathway_id / node_identifier /
-- institution_id are all nullable: SYSTEM_DEFAULT-scope rows have all
-- three NULL, and two such rows should still collide. NULLS NOT DISTINCT
-- (Postgres 15+) treats NULL = NULL for uniqueness, which is the upsert
-- semantics the resolver assumes.
--
-- Discovered in the schema audit on 2026-05-11.

BEGIN;

ALTER TABLE confidence_resolution_thresholds
  ADD CONSTRAINT confidence_resolution_thresholds_unique
  UNIQUE NULLS NOT DISTINCT (scope, pathway_id, node_identifier, institution_id);

COMMIT;
