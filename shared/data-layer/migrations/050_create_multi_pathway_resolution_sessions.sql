-- Migration 050: multi_pathway_resolution_sessions
--
-- Phase 3 commit 4. When a provider runs resolution against every pathway
-- that matches a patient (`startMultiPathwayResolution`), the result is a
-- single merged care plan that may contain soft conflicts — places where two
-- non-comparable pathways recommend different drugs in the same clinical lane
-- (e.g. AF wants metoprolol, HFrEF wants carvedilol). The provider has to
-- resolve those conflicts before the merged plan can be turned into a real
-- care plan, so the merge result has to live somewhere durable. That's this
-- table.
--
-- Conceptually distinct from pathway_resolution_sessions: those track per-
-- pathway BFS state; this tracks the cross-pathway merge. A multi-pathway
-- session points at the per-pathway sessions that fed it via
-- contributing_session_ids.

BEGIN;

CREATE TABLE multi_pathway_resolution_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    provider_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',

    -- Patient context the merge was run against, snapshotted at session start.
    initial_patient_context JSONB NOT NULL DEFAULT '{}',

    -- Per-pathway sessions that fed the merge (one row each in
    -- pathway_resolution_sessions). Order is significant: matches the
    -- post-lattice-collapse order returned by collapseLattice.
    contributing_session_ids UUID[] NOT NULL DEFAULT '{}',
    contributing_pathway_ids UUID[] NOT NULL DEFAULT '{}',

    -- The merged plan (medications/labs/procedures/schedules/qualityMetrics +
    -- suppressed + conflicts). Conflicts inline carry their candidates so a
    -- single fetch hydrates the full state.
    merged_plan JSONB NOT NULL DEFAULT '{}',

    -- Provider resolutions keyed by conflict id (= clinical_role tag value).
    -- Format: { [clinical_role]: { kind, ...payload, resolvedBy, resolvedAt } }.
    -- Empty until the provider starts answering.
    conflict_resolutions JSONB NOT NULL DEFAULT '{}',

    -- Set when generateMergedCarePlan succeeds. Until then NULL.
    care_plan_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT multi_pathway_resolution_sessions_status_check CHECK (
        status IN ('ACTIVE', 'COMPLETED', 'ABANDONED')
    )
);

CREATE INDEX idx_mp_resolution_sessions_patient
    ON multi_pathway_resolution_sessions(patient_id);
CREATE INDEX idx_mp_resolution_sessions_status
    ON multi_pathway_resolution_sessions(status);
CREATE INDEX idx_mp_resolution_sessions_patient_status
    ON multi_pathway_resolution_sessions(patient_id, status);
CREATE INDEX idx_mp_resolution_sessions_care_plan
    ON multi_pathway_resolution_sessions(care_plan_id)
    WHERE care_plan_id IS NOT NULL;

COMMIT;
