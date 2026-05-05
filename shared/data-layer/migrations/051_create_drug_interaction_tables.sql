-- Migration 051: drug interaction tables (Phase 4 commit 1)
--
-- Three tables that power platform-level drug↔drug + drug↔allergy checking:
--   drug_interactions          — pair-level (highest precision)
--   drug_class_interactions    — ATC class fallback (catch-all)
--   allergy_class_mappings     — SNOMED allergen → ATC class for allergy match
--
-- Plus a normalization cache so we never hit RxNav at resolution time:
--   medication_normalization_cache — input string/code → ingredient RxCUI + ATC classes
--
-- Seeding the actual interaction data is a separate clinician-driven effort;
-- this migration only creates the empty containers + loader scaffolding.
-- Until the curated set lands, lookups will be no-ops by design.

BEGIN;

-- =============================================================================
-- 1. DRUG_INTERACTIONS — RxCUI pair-level (highest precision)
-- =============================================================================

CREATE TABLE drug_interactions (
    rxcui_a          TEXT NOT NULL,
    rxcui_b          TEXT NOT NULL,
    severity         TEXT NOT NULL,
    mechanism        TEXT,
    clinical_advice  TEXT,
    source           TEXT NOT NULL,
    source_reference TEXT,
    reviewed_by      UUID,
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (rxcui_a, rxcui_b),

    CONSTRAINT drug_interactions_severity_check CHECK (
        severity IN ('CONTRAINDICATED', 'SEVERE', 'MODERATE', 'MINOR')
    ),
    -- Canonical ordering: every pair stored exactly once. Lookups must
    -- canonicalize before querying.
    CONSTRAINT drug_interactions_canonical_order CHECK (rxcui_a < rxcui_b),
    CONSTRAINT drug_interactions_source_check CHECK (
        source IN ('fda_label', 'rxnav_archive', 'drugbank_academic', 'clinician_review', 'fdb', 'lexicomp')
    )
);

COMMENT ON TABLE drug_interactions IS
    'Pair-level RxCUI interactions. Phase 4: curated subset; planned licensed source pre-clinical-launch.';
COMMENT ON COLUMN drug_interactions.rxcui_a IS
    'Canonically smaller RxCUI in the pair (string-compare).';

-- =============================================================================
-- 2. DRUG_CLASS_INTERACTIONS — ATC class fallback
-- =============================================================================

CREATE TABLE drug_class_interactions (
    atc_class_a      TEXT NOT NULL,
    atc_class_b      TEXT NOT NULL,
    severity         TEXT NOT NULL,
    mechanism        TEXT,
    clinical_advice  TEXT,
    source           TEXT NOT NULL,
    source_reference TEXT,
    reviewed_by      UUID,
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (atc_class_a, atc_class_b),

    CONSTRAINT drug_class_interactions_severity_check CHECK (
        severity IN ('CONTRAINDICATED', 'SEVERE', 'MODERATE', 'MINOR')
    ),
    CONSTRAINT drug_class_interactions_canonical_order CHECK (atc_class_a < atc_class_b),
    CONSTRAINT drug_class_interactions_source_check CHECK (
        source IN ('fda_label', 'rxnav_archive', 'drugbank_academic', 'clinician_review', 'fdb', 'lexicomp')
    )
);

COMMENT ON TABLE drug_class_interactions IS
    'ATC class-pair interactions. Pair-level rules in drug_interactions take precedence.';

-- =============================================================================
-- 3. ALLERGY_CLASS_MAPPINGS — SNOMED → ATC class for allergy matching
-- =============================================================================

CREATE TABLE allergy_class_mappings (
    snomed_code      TEXT PRIMARY KEY,
    snomed_display   TEXT NOT NULL,
    atc_class        TEXT NOT NULL,
    notes            TEXT,
    source           TEXT NOT NULL DEFAULT 'clinician_review',
    source_reference TEXT,
    reviewed_by      UUID,
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_allergy_class_mappings_atc
    ON allergy_class_mappings(atc_class);

COMMENT ON TABLE allergy_class_mappings IS
    'Curated SNOMED allergen → ATC class (level 4) mappings. ~50 entries covers the common allergies.';

-- =============================================================================
-- 4. MEDICATION_NORMALIZATION_CACHE — pre-warmed RxNav lookups
-- =============================================================================
--
-- Normalization runs at pathway-import time and at patient-snapshot ingestion.
-- Resolution-time DDI checks NEVER call RxNav directly — they read this table.
-- A row with ingredient_rxcui IS NULL means "tried, RxNav couldn't resolve" —
-- still cached so we don't re-hammer.

CREATE TABLE medication_normalization_cache (
    input_text       TEXT NOT NULL,    -- lowercased + trimmed
    input_system     TEXT NOT NULL DEFAULT '',  -- 'RxNorm' | 'NDC' | '' for free-text
    input_code       TEXT NOT NULL DEFAULT '',  -- empty for free-text
    ingredient_rxcui TEXT,
    ingredient_name  TEXT,
    atc_classes      TEXT[],           -- ATC level-5 codes; class lookups slice prefixes
    normalized_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (input_text, input_system, input_code)
);

CREATE INDEX idx_medication_normalization_cache_rxcui
    ON medication_normalization_cache(ingredient_rxcui)
    WHERE ingredient_rxcui IS NOT NULL;

CREATE INDEX idx_medication_normalization_cache_unresolved
    ON medication_normalization_cache(normalized_at)
    WHERE ingredient_rxcui IS NULL;

COMMENT ON TABLE medication_normalization_cache IS
    'Pre-warmed cache of RxNav normalization results. NULL ingredient_rxcui = "tried, failed" — surfaced via the unnormalized-medications admin queue.';

COMMIT;
