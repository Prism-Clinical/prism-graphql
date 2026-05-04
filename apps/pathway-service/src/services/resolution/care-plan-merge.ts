/**
 * Phase 3 commit 2: care-plan output merge.
 *
 * Takes N per-pathway resolved care plans and produces ONE merged care plan
 * with provenance, hard-constraint suppression, and dedup by recommendation
 * type. Pure function — no DB, no GraphQL — so it's fully testable with
 * synthetic fixtures.
 *
 * Pipeline position: lattice collapse (commit 1) → per-pathway resolution
 * (existing flow) → THIS merge → provider-conflict UX (commit 4).
 *
 * v1 scope:
 *   - Hard constraints (role=contraindicated|avoid) suppress same-drug
 *     recommendations across all pathways. Suppressed entries are kept in a
 *     side list for transparency.
 *   - Same-name dedup for medications; same-code dedup for labs/procedures;
 *     same-interval dedup for schedules; same-name dedup for quality metrics.
 *   - Provenance: every merged recommendation carries the IDs of all pathways
 *     that contributed it.
 *   - Soft conflict detection (different drugs, same indication) is OUT of
 *     scope; that lands in commit 4 alongside the provider-resolution UX.
 */

import { MedicationRole } from '../import/types';

// ─── Resolved (per-pathway) shapes ────────────────────────────────────

export interface ResolvedMedication {
  name: string;
  role: MedicationRole;
  dose?: string;
  frequency?: string;
  duration?: string;
  route?: string;
  sourcePathwayId: string;
  sourceNodeId?: string;
}

export interface ResolvedLab {
  name: string;
  code?: string;
  system?: string;
  specimen?: string;
  sourcePathwayId: string;
  sourceNodeId?: string;
}

export interface ResolvedProcedure {
  name: string;
  code?: string;
  system?: string;
  sourcePathwayId: string;
  sourceNodeId?: string;
}

export interface ResolvedSchedule {
  interval: string;
  description: string;
  sourcePathwayId: string;
  sourceNodeId?: string;
}

export interface ResolvedQualityMetric {
  name: string;
  measure: string;
  sourcePathwayId: string;
  sourceNodeId?: string;
}

export interface ResolvedCarePlan {
  pathwayId: string;
  pathwayLogicalId: string;
  pathwayTitle: string;
  medications: ResolvedMedication[];
  labs: ResolvedLab[];
  procedures: ResolvedProcedure[];
  schedules: ResolvedSchedule[];
  qualityMetrics: ResolvedQualityMetric[];
}

// ─── Merged (output) shapes ───────────────────────────────────────────

export type RecommendationState = 'auto-included';

export interface MergedRecommendation<T> {
  recommendation: T;
  /** All pathway IDs whose resolution contributed this recommendation. */
  sourcePathwayIds: string[];
  /** v1: always 'auto-included'. Commit 4 adds 'pending-provider-choice'. */
  state: RecommendationState;
}

export type SuppressedRecommendationType =
  | 'medication'
  | 'lab'
  | 'procedure'
  | 'schedule'
  | 'qualityMetric';

export interface SuppressedRecommendation {
  type: SuppressedRecommendationType;
  name: string;
  reason: 'contraindicated' | 'avoid';
  suppressedBy: { pathwayId: string; pathwayTitle: string };
  original:
    | ResolvedMedication
    | ResolvedLab
    | ResolvedProcedure
    | ResolvedSchedule
    | ResolvedQualityMetric;
}

export interface MergedCarePlan {
  sourcePathwayIds: string[];
  medications: MergedRecommendation<ResolvedMedication>[];
  labs: MergedRecommendation<ResolvedLab>[];
  procedures: MergedRecommendation<ResolvedProcedure>[];
  schedules: MergedRecommendation<ResolvedSchedule>[];
  qualityMetrics: MergedRecommendation<ResolvedQualityMetric>[];
  suppressed: SuppressedRecommendation[];
}

// ─── Public API ───────────────────────────────────────────────────────

export function mergeResolvedCarePlans(
  plans: ResolvedCarePlan[],
): MergedCarePlan {
  if (plans.length === 0) {
    return emptyMergedPlan();
  }

  const suppressed: SuppressedRecommendation[] = [];

  // Build the hard-constraint set: every (drug-name) flagged contraindicated
  // or avoid by ANY pathway. The first pathway to flag a drug gets recorded
  // as the "suppressedBy" source so consumers know who to attribute it to.
  const hardSuppressed = new Map<
    string,
    {
      reason: 'contraindicated' | 'avoid';
      pathwayId: string;
      pathwayTitle: string;
    }
  >();

  for (const plan of plans) {
    for (const med of plan.medications) {
      if (med.role === 'contraindicated' || med.role === 'avoid') {
        const key = drugKey(med.name);
        if (!hardSuppressed.has(key)) {
          hardSuppressed.set(key, {
            reason: med.role,
            pathwayId: plan.pathwayId,
            pathwayTitle: plan.pathwayTitle,
          });
        }
      }
    }
  }

  // Merge medications: drop hard-constrained ones into `suppressed`, dedup
  // the rest by drug name.
  const medsByKey = new Map<string, ResolvedMedication[]>();
  for (const plan of plans) {
    for (const med of plan.medications) {
      const key = drugKey(med.name);

      if (med.role === 'contraindicated' || med.role === 'avoid') {
        // The pathway authoring this drug as contraindicated/avoid → not
        // active; record once for transparency.
        suppressed.push({
          type: 'medication',
          name: med.name,
          reason: med.role,
          suppressedBy: { pathwayId: plan.pathwayId, pathwayTitle: plan.pathwayTitle },
          original: med,
        });
        continue;
      }

      if (hardSuppressed.has(key)) {
        // A different pathway flagged this drug; suppress this active
        // recommendation in favor of the contraindication.
        const flagger = hardSuppressed.get(key)!;
        suppressed.push({
          type: 'medication',
          name: med.name,
          reason: flagger.reason,
          suppressedBy: {
            pathwayId: flagger.pathwayId,
            pathwayTitle: flagger.pathwayTitle,
          },
          original: med,
        });
        continue;
      }

      if (!medsByKey.has(key)) medsByKey.set(key, []);
      medsByKey.get(key)!.push(med);
    }
  }

  const medications = mapMergeBucket(medsByKey);

  // Labs/procedures/schedules/quality metrics: pure dedup by appropriate key.
  // Hard constraints don't apply (only medications carry contraindication
  // semantics in the existing schema).
  const labs = mergeByKey(plans, (p) => p.labs, labKey);
  const procedures = mergeByKey(plans, (p) => p.procedures, procedureKey);
  const schedules = mergeByKey(plans, (p) => p.schedules, scheduleKey);
  const qualityMetrics = mergeByKey(
    plans,
    (p) => p.qualityMetrics,
    (q) => q.name.toLowerCase().trim(),
  );

  return {
    sourcePathwayIds: plans.map((p) => p.pathwayId),
    medications,
    labs,
    procedures,
    schedules,
    qualityMetrics,
    suppressed,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────

function emptyMergedPlan(): MergedCarePlan {
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

function drugKey(name: string): string {
  return name.toLowerCase().trim();
}

function labKey(l: ResolvedLab): string {
  if (l.code && l.system) return `${l.system}|${l.code}`;
  return l.name.toLowerCase().trim();
}

function procedureKey(p: ResolvedProcedure): string {
  if (p.code && p.system) return `${p.system}|${p.code}`;
  return p.name.toLowerCase().trim();
}

function scheduleKey(s: ResolvedSchedule): string {
  return `${s.interval.toLowerCase().trim()}|${s.description.toLowerCase().trim()}`;
}

function mergeByKey<T extends { sourcePathwayId: string }>(
  plans: ResolvedCarePlan[],
  selector: (p: ResolvedCarePlan) => T[],
  keyer: (item: T) => string,
): MergedRecommendation<T>[] {
  const buckets = new Map<string, T[]>();
  for (const plan of plans) {
    for (const item of selector(plan)) {
      const key = keyer(item);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(item);
    }
  }
  return mapMergeBucket(buckets);
}

function mapMergeBucket<T extends { sourcePathwayId: string }>(
  buckets: Map<string, T[]>,
): MergedRecommendation<T>[] {
  const out: MergedRecommendation<T>[] = [];
  for (const items of buckets.values()) {
    out.push({
      recommendation: items[0], // canonical = first encountered
      sourcePathwayIds: dedupStringArray(items.map((i) => i.sourcePathwayId)),
      state: 'auto-included',
    });
  }
  return out;
}

function dedupStringArray(arr: string[]): string[] {
  return [...new Set(arr)];
}
