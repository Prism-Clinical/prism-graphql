/**
 * Phase 3 commit 3: multi-pathway resolution mutation.
 *
 * Orchestrates the full pipeline that produces ONE merged care plan from a
 * patient's matched pathways:
 *   1. matchedPathways(patient)            → set-based matcher, Phase 1b
 *   2. collapseLattice(matched)            → drop dominated scenarios
 *   3. for each survivor: TraversalEngine  → per-pathway ResolutionState
 *   4. projectResolutionToCarePlan         → role-typed shapes
 *   5. mergeResolvedCarePlans              → dedup + hard-constraint suppress
 *   6. format for GraphQL
 *
 * v1 does NOT persist anything — no ResolutionSession rows. Provider-conflict
 * UX (commit 4) will introduce a multi-pathway session table when state needs
 * to survive across requests.
 */

import { Pool } from 'pg';
import { DataSourceContext } from '../../types';
import { PatientContext } from '../../services/confidence/types';
import { TraversalEngine } from '../../services/resolution/traversal-engine';
import { GateAnswer, MatchedPathway } from '../../services/resolution/types';
import { getMatchedPathways } from '../../services/resolution/session-store';
import { collapseLattice } from '../../services/resolution/lattice-collapse';
import {
  mergeResolvedCarePlans,
  ResolvedCarePlan,
  MergedCarePlan as MergedCarePlanInternal,
  SuppressedRecommendation as SuppressedInternal,
} from '../../services/resolution/care-plan-merge';
import { projectResolutionToCarePlan } from '../../services/resolution/care-plan-projection';
import {
  buildResolutionContext,
  makeTraversalAdapter,
} from '../helpers/resolution-context';

// ─── Public entry point ──────────────────────────────────────────────

export interface MultiPathwayResolutionArgs {
  patientId: string;
  patientContext?: {
    patientId: string;
    conditionCodes?: Array<{ code: string; system: string; display?: string }>;
    medications?: Array<{ code: string; system: string; display?: string }>;
    labResults?: Array<{
      code: string;
      system: string;
      value?: number;
      unit?: string;
      date?: string;
      display?: string;
    }>;
    allergies?: Array<{ code: string; system: string; display?: string }>;
    vitalSigns?: Record<string, unknown>;
  };
}

export const multiPathwayResolutionMutations = {
  async startMultiPathwayResolution(
    _parent: unknown,
    args: MultiPathwayResolutionArgs,
    context: DataSourceContext,
  ) {
    const { pool } = context;

    // 1. Find matched pathways
    const matched = await getMatchedPathways(pool, args.patientId);
    if (matched.length === 0) {
      return formatMergedForGraphQL(emptyMergedCarePlan());
    }

    // 2. Collapse lattice (drop dominated scenarios)
    const surviving = await collapseLattice(pool, matched);

    // 3. Build patient context (same shape startResolution uses)
    const patientContext = buildPatientContext(args);

    // 4-5. Per-pathway resolution + projection
    const resolvedPlans: ResolvedCarePlan[] = await resolveAndProjectAll(
      pool,
      surviving,
      patientContext,
    );

    // 6. Merge
    const merged = mergeResolvedCarePlans(resolvedPlans);

    return formatMergedForGraphQL(merged);
  },
};

// ─── Internals ───────────────────────────────────────────────────────

function buildPatientContext(args: MultiPathwayResolutionArgs): PatientContext {
  const pc = args.patientContext;
  return {
    patientId: args.patientId,
    conditionCodes: pc?.conditionCodes ?? [],
    medications: pc?.medications ?? [],
    labResults: pc?.labResults ?? [],
    allergies: pc?.allergies ?? [],
    vitalSigns: pc?.vitalSigns,
  };
}

/**
 * Run TraversalEngine for each surviving pathway and project the resolution
 * state into a ResolvedCarePlan. Pathways with empty graphs are skipped
 * silently (consistent with how startResolution treats them — it errors,
 * but here a single broken pathway shouldn't kill the whole merge).
 */
export async function resolveAndProjectAll(
  pool: Pool,
  pathways: MatchedPathway[],
  patientContext: PatientContext,
): Promise<ResolvedCarePlan[]> {
  const out: ResolvedCarePlan[] = [];
  for (const m of pathways) {
    const rctx = await buildResolutionContext(pool, m.pathway.id);
    if (rctx.graphContext.allNodes.length === 0) continue;

    const engine = new TraversalEngine(
      makeTraversalAdapter(rctx, pool, m.pathway.id, patientContext),
      rctx.thresholds,
    );
    const result = await engine.traverse(
      rctx.graphContext,
      patientContext,
      new Map<string, GateAnswer>(),
    );

    const projected = projectResolutionToCarePlan(result.resolutionState, {
      pathwayId: m.pathway.id,
      pathwayLogicalId: m.pathway.logicalId,
      pathwayTitle: m.pathway.title,
    });
    out.push(projected);
  }
  return out;
}

function emptyMergedCarePlan(): MergedCarePlanInternal {
  return {
    sourcePathwayIds: [],
    medications: [],
    labs: [],
    procedures: [],
    schedules: [],
    qualityMetrics: [],
    suppressed: [],
  };
}

// ─── GraphQL formatting ──────────────────────────────────────────────

/**
 * Convert the internal merge result into the GraphQL-shaped object.
 * SuppressedRecommendation flattens the nested `suppressedBy` for the wire
 * format, and reasons/types are upper-cased to match the enum values.
 */
export function formatMergedForGraphQL(merged: MergedCarePlanInternal) {
  return {
    sourcePathwayIds: merged.sourcePathwayIds,
    medications: merged.medications.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: 'AUTO_INCLUDED' as const,
    })),
    labs: merged.labs.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: 'AUTO_INCLUDED' as const,
    })),
    procedures: merged.procedures.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: 'AUTO_INCLUDED' as const,
    })),
    schedules: merged.schedules.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: 'AUTO_INCLUDED' as const,
    })),
    qualityMetrics: merged.qualityMetrics.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: 'AUTO_INCLUDED' as const,
    })),
    suppressed: merged.suppressed.map(formatSuppressedForGraphQL),
  };
}

function formatSuppressedForGraphQL(s: SuppressedInternal) {
  const typeMap = {
    medication: 'MEDICATION',
    lab: 'LAB',
    procedure: 'PROCEDURE',
    schedule: 'SCHEDULE',
    qualityMetric: 'QUALITY_METRIC',
  } as const;
  return {
    type: typeMap[s.type],
    name: s.name,
    reason: s.reason === 'contraindicated' ? 'CONTRAINDICATED' : 'AVOID',
    suppressedByPathwayId: s.suppressedBy.pathwayId,
    suppressedByPathwayTitle: s.suppressedBy.pathwayTitle,
  };
}
