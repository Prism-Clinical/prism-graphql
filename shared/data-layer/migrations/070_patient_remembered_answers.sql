-- Migration 070: answers a pathway remembers for a patient across encounters.
--
-- A gate may mark its answer as one to remember (`remember_answer`): "already
-- taking a prenatal vitamin: yes" should not be asked again at every visit of
-- the same pregnancy. One row per patient and attribute; the newest answer
-- replaces the last. Read at encounter start and supplied as a
-- `patient.<attribute>` value when the chart does not carry one. See
-- apps/pathway-service/src/services/resolution/remembered-answers.ts.
--
-- Additive.

BEGIN;

CREATE TABLE IF NOT EXISTS patient_remembered_answers (
  patient_id        UUID        NOT NULL,
  attribute         TEXT        NOT NULL,
  value             JSONB       NOT NULL,
  scope             TEXT        NOT NULL,
  answered_on       DATE        NOT NULL,
  answered_by       TEXT,
  source_pathway_id UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (patient_id, attribute)
);

COMMIT;
