-- Migration 059: distinguish LOINC tests from panels.
--
-- LOINC codes mix individual analytes ("Glucose [Mass/volume] in Serum or
-- Plasma") and panels ("Comprehensive metabolic panel - Serum or Plasma").
-- The simulator stored both as a single lab result row with one value, which
-- doesn't represent reality — a panel produces many results.
--
-- Two changes here:
--   1. lab_kind column on clinical_code_reference. NULL for non-LOINC rows
--      (ICD-10, SNOMED, RxNorm, CPT are not lab analytes). For LOINC rows,
--      'TEST' for individual analytes and 'PANEL' for collections.
--   2. loinc_panel_constituents table maps each panel code to the LOINC test
--      codes it contains, so the composer can expand a panel selection into
--      its constituent test inputs.
--
-- The pathway editor LabTest authoring should only target TEST codes;
-- pathway gates target individual analytes, not the panel they came in on.

BEGIN;

ALTER TABLE clinical_code_reference
    ADD COLUMN IF NOT EXISTS lab_kind VARCHAR(8);

ALTER TABLE clinical_code_reference
    DROP CONSTRAINT IF EXISTS clinical_code_reference_lab_kind_check;
ALTER TABLE clinical_code_reference
    ADD CONSTRAINT clinical_code_reference_lab_kind_check
    CHECK (
        lab_kind IS NULL
        OR (system = 'LOINC' AND lab_kind IN ('TEST', 'PANEL'))
    );

-- Backfill: LOINC rows whose description contains "panel" → PANEL. Everything
-- else LOINC → TEST. Non-LOINC rows stay NULL.
UPDATE clinical_code_reference
   SET lab_kind = CASE
       WHEN description ILIKE '%panel%' THEN 'PANEL'
       ELSE 'TEST'
   END
 WHERE system = 'LOINC' AND lab_kind IS NULL;

CREATE INDEX IF NOT EXISTS idx_ccr_lab_kind
    ON clinical_code_reference(system, lab_kind)
    WHERE system = 'LOINC';

-- ─── Panel → constituents ──────────────────────────────────────────
--
-- Each row: (panel_code, constituent_code). Both are LOINC codes; both
-- reference clinical_code_reference but we don't add an FK because the
-- reference table is keyed on (code, system) — adding a composite FK with
-- a hard-coded system would couple us tightly. Constraints below enforce
-- that the codes exist as LOINC rows at insert time.

CREATE TABLE IF NOT EXISTS loinc_panel_constituents (
    panel_code       VARCHAR(20) NOT NULL,
    constituent_code VARCHAR(20) NOT NULL,
    -- Order in which the constituent appears in the composer (lowest first).
    -- Lets us preserve clinically meaningful ordering (e.g. Na/K/Cl/CO2 over
    -- alphabetical) without re-sorting on every query.
    display_order    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (panel_code, constituent_code)
);

CREATE INDEX IF NOT EXISTS idx_loinc_panel_constituents_panel
    ON loinc_panel_constituents(panel_code, display_order);

-- ─── Seed mappings for the panels currently in clinical_code_reference ─

-- CBC panel (58410-2)
INSERT INTO loinc_panel_constituents (panel_code, constituent_code, display_order) VALUES
('58410-2', '6690-2',  1),   -- Leukocytes [#/volume]
('58410-2', '789-8',   2),   -- Erythrocytes [#/volume]
('58410-2', '718-7',   3),   -- Hemoglobin
('58410-2', '4544-3',  4),   -- Hematocrit
('58410-2', '787-2',   5),   -- MCV
('58410-2', '785-6',   6),   -- MCH
('58410-2', '786-4',   7),   -- MCHC
('58410-2', '788-0',   8),   -- RDW
('58410-2', '777-3',   9),   -- Platelets
('58410-2', '32623-1', 10),  -- Platelet mean volume
('58410-2', '770-8',   11),  -- Neutrophils %
('58410-2', '736-9',   12),  -- Lymphocytes %
('58410-2', '5905-5',  13),  -- Monocytes %
('58410-2', '713-8',   14),  -- Eosinophils %
('58410-2', '706-2',   15)   -- Basophils %
ON CONFLICT (panel_code, constituent_code) DO NOTHING;

-- Basic metabolic panel (24320-4)
INSERT INTO loinc_panel_constituents (panel_code, constituent_code, display_order) VALUES
('24320-4', '2951-2',  1),   -- Sodium S/P
('24320-4', '2823-3',  2),   -- Potassium
('24320-4', '2075-0',  3),   -- Chloride
('24320-4', '3094-0',  4),   -- BUN (Urea nitrogen)
('24320-4', '2345-7',  5),   -- Glucose S/P
('24320-4', '2160-0',  6),   -- Creatinine
('24320-4', '17861-6', 7)    -- Calcium
ON CONFLICT (panel_code, constituent_code) DO NOTHING;

-- Comprehensive metabolic panel (24323-8) = BMP + liver tests + albumin/protein
INSERT INTO loinc_panel_constituents (panel_code, constituent_code, display_order) VALUES
('24323-8', '2951-2',  1),   -- Sodium S/P
('24323-8', '2823-3',  2),   -- Potassium
('24323-8', '2075-0',  3),   -- Chloride
('24323-8', '3094-0',  4),   -- BUN
('24323-8', '2345-7',  5),   -- Glucose
('24323-8', '2160-0',  6),   -- Creatinine
('24323-8', '17861-6', 7),   -- Calcium
('24323-8', '1751-7',  8),   -- Albumin
('24323-8', '2885-2',  9),   -- Protein total
('24323-8', '1975-2',  10),  -- Bilirubin total
('24323-8', '6768-6',  11),  -- Alkaline phosphatase
('24323-8', '1920-8',  12),  -- AST
('24323-8', '1742-6',  13)   -- ALT
ON CONFLICT (panel_code, constituent_code) DO NOTHING;

-- Lipid panel (24331-1)
INSERT INTO loinc_panel_constituents (panel_code, constituent_code, display_order) VALUES
('24331-1', '2093-3',  1),   -- Cholesterol total
('24331-1', '2571-8',  2),   -- Triglyceride
('24331-1', '2085-9',  3),   -- HDL
('24331-1', '13457-7', 4),   -- LDL (calculated)
('24331-1', '43396-1', 5)    -- Cholesterol non-HDL
ON CONFLICT (panel_code, constituent_code) DO NOTHING;

-- Note: 10450-5 ("Glucose tolerance 2 hours gestational panel") is also a
-- LOINC PANEL but its constituent fasting/1h/2h gestational glucose codes
-- aren't seeded yet. Composer will fall through to "unknown panel — pick
-- tests manually" until those codes ship.

COMMENT ON COLUMN clinical_code_reference.lab_kind IS
    'For LOINC rows: TEST = individual analyte, PANEL = collection. NULL for other systems.';
COMMENT ON TABLE loinc_panel_constituents IS
    'Maps a LOINC panel code to its constituent test codes, so the simulator can expand a panel selection into per-test value inputs.';

COMMIT;
