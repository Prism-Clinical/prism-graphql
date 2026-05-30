-- Migration 056: persist vitals on saved simulator scenarios so
-- regression-tested scenarios reload with their numeric uncoded data
-- (blood pressure, HR, SpO2, etc.) intact.
--
-- Shape: { systolic_bp, diastolic_bp, heart_rate, respiratory_rate,
--          spo2, temperature_f, weight_kg, height_cm, bmi,
--          custom: { <key>: number } }
--
-- See PatientComposer.VitalsSnapshot on the FE side for the canonical
-- TypeScript shape; the backend just stores the JSON blob and passes
-- it through to the resolution mutation's vitalSigns input.

BEGIN;

ALTER TABLE simulator_scenarios
  ADD COLUMN IF NOT EXISTS vitals JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
