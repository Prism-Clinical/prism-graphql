-- Migration 072: a patient's immunization record.
--
-- Josh, 2026-10-05: "for vaccines, we need a way to mark as given previously
-- and to add a date. this needs to be stored in a way that can potentially be
-- transferred." One row is one dose, in the shape of a FHIR R4 `Immunization`
-- resource, so a row can be sent to an EHR or a state registry as it stands:
--
--   vaccine_cvx / vaccine_display   vaccineCode (CVX — what registries exchange)
--   rxnorm_ingredient               vaccineCode, second coding; also how a
--                                   pathway gate recognises the dose
--   occurrence_date + precision     occurrenceDateTime (a day, a month, or
--                                   unknown -> occurrenceString "unknown")
--   status                          completed | entered-in-error
--   primary_source                  FALSE = reported (history), not given here
--   report_origin                   who reported it (provider | record | patient)
--   recorded_at / recorded_by       recorded / performer of the record
--
-- A MONTH-precision date is stored as the first of the month.
-- Rows are never deleted: a mistake is marked `entered-in-error`.
-- See apps/pathway-service/src/services/resolution/immunizations.ts.
--
-- Additive.

BEGIN;

CREATE TABLE IF NOT EXISTS patient_immunizations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id           UUID        NOT NULL,
  vaccine_cvx          TEXT        NOT NULL,
  vaccine_display      TEXT        NOT NULL,
  rxnorm_ingredient    TEXT,
  occurrence_date      DATE,
  occurrence_precision TEXT        NOT NULL CHECK (occurrence_precision IN ('DAY', 'MONTH', 'UNKNOWN')),
  status               TEXT        NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'entered-in-error')),
  primary_source       BOOLEAN     NOT NULL DEFAULT FALSE,
  report_origin        TEXT        NOT NULL DEFAULT 'provider',
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by          TEXT,
  source_session_id    UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((occurrence_precision = 'UNKNOWN') = (occurrence_date IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_patient_immunizations_patient ON patient_immunizations (patient_id);

COMMIT;
