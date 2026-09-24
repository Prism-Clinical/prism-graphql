-- Migration 067: allow the two event types answerPendingDecision writes
--
-- 042 created pathway_resolution_events with a CHECK listing every event type
-- then in use. answerPendingDecision (commit 37c831e) added two more — a
-- branch choice at a DecisionPoint and a provider-supplied datum for an
-- escalated gate — without extending the constraint, so every such write was
-- refused:
--
--   * branch choice: the session update had already committed, so the choice
--     took effect while the caller was told it failed.
--   * provider datum: the event was written first, so the answer failed
--     outright and nothing persisted.
--
-- The service now writes them lowercase (`branch_chosen`,
-- `provider_asserted_datum`) to match the rest of this vocabulary. No row
-- was ever stored under the uppercase spellings — the constraint refused
-- them — so there is nothing to backfill.
--
-- The constraint name is the one Postgres generated for 042's inline CHECK,
-- verified against a live database. DROP ... IF EXISTS keeps a re-run safe.

BEGIN;

ALTER TABLE pathway_resolution_events
  DROP CONSTRAINT IF EXISTS pathway_resolution_events_event_type_check;

ALTER TABLE pathway_resolution_events
  ADD CONSTRAINT pathway_resolution_events_event_type_check
  CHECK (event_type IN (
    'traversal_complete', 'override', 'gate_answer',
    'context_update', 'care_plan_generated', 'abandoned',
    'branch_chosen', 'provider_asserted_datum'
  ));

COMMIT;
