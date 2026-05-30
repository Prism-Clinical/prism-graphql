-- Migration 058: add narrative bag to simulator_scenarios so saved scenarios
-- carry the chief_complaint / HPI / social_history etc. that `llm_text_analysis`
-- Gate nodes will read. Mirrors the freeformData.narrative.* JSON path that
-- the gate-evaluator's dotted-path walker expects at resolution time.

BEGIN;

ALTER TABLE simulator_scenarios
    ADD COLUMN IF NOT EXISTS narrative JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
