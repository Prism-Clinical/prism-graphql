-- Migration 065: purge resolution sessions created before the temporal kernel.
--
-- Every stored session has temporal_context NULL: all 41 per-pathway rows and
-- all 14 multi-pathway rows predate migration 063, so they carry neither a
-- pinned evaluation clock nor a policy version. Under the v1 default they
-- cannot be retraversed reproducibly — a retraversal would resolve against a
-- different instant AND a different evaluator than the traversal it repeats.
--
-- The platform has no users; these are stale test rows (newest 2026-07-13).
-- Deleted rather than backfilled because there is no honest value to backfill:
-- we do not know what "now" was for these traversals.
--
-- pathway_resolution_events, pathway_resolution_decisions, pathway_gate_answers
-- and pathway_node_overrides all reference pathway_resolution_sessions(id) with
-- ON DELETE CASCADE, so they are removed by the parent delete and need no
-- statements of their own. (They are empty here regardless.)
--
-- Idempotent: re-running matches no rows.

BEGIN;

-- Per-pathway sessions. Children cascade.
DELETE FROM pathway_resolution_sessions
 WHERE temporal_context IS NULL
    OR temporal_context->>'temporalPolicyVersion' IS NULL;

-- Multi-pathway parents. The link is an array column on THIS side
-- (contributing_session_ids uuid[]), not a FK on the child, so there is no
-- cascade to rely on. A parent whose contributing sessions have all gone
-- describes nothing, and one carrying no temporal context is unusable for the
-- same reason its children were.
DELETE FROM multi_pathway_resolution_sessions
 WHERE temporal_context IS NULL
    OR temporal_context->>'temporalPolicyVersion' IS NULL
    OR NOT EXISTS (
         SELECT 1
           FROM pathway_resolution_sessions s
          WHERE s.id = ANY (multi_pathway_resolution_sessions.contributing_session_ids));

COMMIT;
