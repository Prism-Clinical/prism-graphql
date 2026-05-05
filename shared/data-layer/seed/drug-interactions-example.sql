-- Phase 4 Example Drug Interaction Seed
--
-- ⚠️  NOT AUTHORITATIVE. This file exists only to prove the DDI pipeline
-- works end-to-end with a non-empty table. It is a tiny illustrative set,
-- not a clinical database. The full curated v1 set (target ~200-500 pairs
-- covering our condition territories) is a separate clinician-driven effort
-- tracked elsewhere; before any production clinical use, this entire seed
-- should be replaced with the curated set or — preferably — a feed from a
-- licensed CDS source (FDB / Lexicomp / Micromedex).
--
-- All entries below carry source='clinician_review' with source_reference
-- 'phase-4-example-seed' to make it obvious in queries that they're examples.

-- =============================================================================
-- DRUG_INTERACTIONS (pair-level)
-- =============================================================================
-- RxCUI values are real ingredient-level codes from RxNorm. Canonical order
-- (rxcui_a < rxcui_b string-compare) is enforced by check constraint.

INSERT INTO drug_interactions (rxcui_a, rxcui_b, severity, mechanism, clinical_advice, source, source_reference) VALUES
  -- Warfarin + Amiodarone: amiodarone inhibits warfarin metabolism (CYP2C9)
  ('11289', '703', 'SEVERE',
   'Amiodarone inhibits CYP2C9 metabolism of warfarin, raising INR markedly.',
   'Reduce warfarin dose by ~30-50% and monitor INR closely on initiation.',
   'clinician_review', 'phase-4-example-seed'),

  -- Sertraline + Phenelzine: serotonin syndrome risk (SSRI + MAOI)
  ('36437', '8123', 'CONTRAINDICATED',
   'SSRI + non-selective MAOI causes serotonin syndrome.',
   'Do not co-administer. Allow 2-week washout between MAOI discontinuation and SSRI start.',
   'clinician_review', 'phase-4-example-seed'),

  -- Simvastatin + Clarithromycin: CYP3A4 inhibition → rhabdomyolysis risk
  ('21212', '36567', 'SEVERE',
   'Clarithromycin inhibits CYP3A4 metabolism of simvastatin, raising rhabdomyolysis risk.',
   'Hold simvastatin during clarithromycin course. Resume after antibiotic course completes.',
   'clinician_review', 'phase-4-example-seed'),

  -- Aspirin + Warfarin: additive bleeding risk
  -- (Canonical order: '11289' < '1191' string-compare since '11289'[2]='2' < '1191'[2]='9'.)
  ('11289', '1191', 'SEVERE',
   'Additive antiplatelet + anticoagulation effects.',
   'Avoid combination unless cardiology has documented indication; consider PPI for GI protection.',
   'clinician_review', 'phase-4-example-seed'),

  -- Metformin + Iohexol contrast: contrast-induced lactic acidosis risk
  ('1727', '6809', 'SEVERE',
   'Iodinated contrast risks acute kidney injury → metformin-associated lactic acidosis.',
   'Hold metformin at the time of contrast and for 48h post-procedure; resume after eGFR confirmed stable.',
   'clinician_review', 'phase-4-example-seed')
ON CONFLICT (rxcui_a, rxcui_b) DO NOTHING;

-- =============================================================================
-- DRUG_CLASS_INTERACTIONS (ATC class fallback)
-- =============================================================================
-- ATC codes from WHO Collaborating Centre for Drug Statistics Methodology.

INSERT INTO drug_class_interactions (atc_class_a, atc_class_b, severity, mechanism, clinical_advice, source, source_reference) VALUES
  -- ACE inhibitors + potassium-sparing diuretics → hyperkalemia
  ('C03DA', 'C09AA', 'SEVERE',
   'ACE-I + potassium-sparing diuretic raises serum potassium.',
   'Monitor K+ within 1-2 weeks of initiation; avoid in K+ > 5.0 or eGFR < 30.',
   'clinician_review', 'phase-4-example-seed'),

  -- Non-selective MAOIs + SSRIs (broad class fallback covering all SSRIs)
  ('N06AB', 'N06AF', 'CONTRAINDICATED',
   'Class-wide serotonin syndrome risk.',
   'Do not co-administer; allow 2-week washout.',
   'clinician_review', 'phase-4-example-seed')
ON CONFLICT (atc_class_a, atc_class_b) DO NOTHING;

-- =============================================================================
-- ALLERGY_CLASS_MAPPINGS
-- =============================================================================
-- SNOMED allergy codes → ATC class. ATC level 3 ('J01C') catches all
-- penicillin sub-classes via prefix match.

INSERT INTO allergy_class_mappings (snomed_code, snomed_display, atc_class, notes, source, source_reference) VALUES
  ('91936005',  'Penicillin allergy',           'J01C',   'Covers all penicillin sub-classes (J01CA/CE/CF/CG/CR).', 'clinician_review', 'phase-4-example-seed'),
  ('418689008', 'Sulfonamide allergy',          'J01E',   'Sulfonamide antibiotics; non-antibiotic sulfa cross-reactivity is debated and not modeled here.', 'clinician_review', 'phase-4-example-seed'),
  ('294505008', 'HMG-CoA reductase inhibitor allergy', 'C10AA', 'Statin allergy.', 'clinician_review', 'phase-4-example-seed'),
  ('293584003', 'NSAID allergy',                'M01A',   'Non-steroidal anti-inflammatory drugs.', 'clinician_review', 'phase-4-example-seed'),
  ('300916003', 'Local anaesthetic allergy',    'N01B',   'Local anesthetics; ester vs amide cross-reactivity not modeled here.', 'clinician_review', 'phase-4-example-seed')
ON CONFLICT (snomed_code) DO NOTHING;
