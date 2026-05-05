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
  /**
   * Optional author-supplied tag identifying the clinical lane this medication
   * occupies (e.g. "first_line_beta_blocker_for_chf"). Two pathways tagging
   * different drugs with the same role surfaces as a soft conflict in the
   * merge — Phase 3 commit 4. Untagged drugs do not participate in conflict
   * detection.
   */
  clinicalRole?: string;
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

export type RecommendationState =
  | 'auto-included'
  | 'pending-provider-choice'
  | 'provider-confirmed'
  | 'provider-override';

export interface MergedRecommendation<T> {
  recommendation: T;
  /** All pathway IDs whose resolution contributed this recommendation. */
  sourcePathwayIds: string[];
  state: RecommendationState;
}

// ─── Conflict shapes (Phase 3 commit 4) ──────────────────────────────

export type ConflictResolutionKind =
  | 'CONFIRM_PATHWAY'
  | 'ACCEPT_BOTH'
  | 'REJECT_BOTH'
  | 'CUSTOM_OVERRIDE';

export interface ConflictResolutionMeta {
  resolvedBy: string;
  resolvedAt: string;
  reason?: string;
}

export interface CustomMedicationOverride {
  name: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  route?: string;
  note?: string;
}

export type ConflictResolution =
  | ({ kind: 'CONFIRM_PATHWAY'; chosenPathwayId: string } & ConflictResolutionMeta)
  | ({ kind: 'ACCEPT_BOTH' } & ConflictResolutionMeta)
  | ({ kind: 'REJECT_BOTH' } & ConflictResolutionMeta)
  | ({ kind: 'CUSTOM_OVERRIDE'; customMedication: CustomMedicationOverride } & ConflictResolutionMeta);

export interface ConflictCandidate {
  recommendation: ResolvedMedication;
  sourcePathwayId: string;
  sourcePathwayTitle: string;
}

export interface MergedConflict {
  /** Stable id within the session — equals the clinical_role tag value. */
  conflictId: string;
  type: 'medication';
  clinicalRole: string;
  candidates: ConflictCandidate[];
  resolution: ConflictResolution | null;
}

export type SuppressedRecommendationType =
  | 'medication'
  | 'lab'
  | 'procedure'
  | 'schedule'
  | 'qualityMetric';

export type SuppressionReason =
  | 'contraindicated'
  | 'avoid'
  | 'ddi_contraindicated'
  | 'ddi_severe'
  | 'allergy';

export type SuppressionSource =
  | { kind: 'PATHWAY'; pathwayId: string; pathwayTitle: string }
  | { kind: 'PATIENT_MEDICATION'; rxcui: string; name: string }
  | { kind: 'PATIENT_ALLERGY'; snomedCode: string; snomedDisplay: string }
  | { kind: 'OTHER_RECOMMENDATION'; recommendationId: string; drugName: string };

export interface SuppressedRecommendation {
  type: SuppressedRecommendationType;
  name: string;
  reason: SuppressionReason;
  source: SuppressionSource;
  /**
   * Legacy pathway-source convenience field. Populated for PATHWAY-source
   * suppressions (the original Phase 3 contraindicated/avoid flow). DDI
   * suppressions leave this undefined and use `source` instead.
   */
  suppressedBy?: { pathwayId: string; pathwayTitle: string };
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
  /**
   * Cross-pathway soft conflicts (medications-only in v1). Each entry has
   * candidates from ≥2 pathways and an optional resolution. While any
   * conflict has `resolution: null`, the session is not ready for care-plan
   * generation. Resolved conflicts stay in this list for audit/UX.
   */
  conflicts: MergedConflict[];
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
          source: { kind: 'PATHWAY', pathwayId: plan.pathwayId, pathwayTitle: plan.pathwayTitle },
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
          source: { kind: 'PATHWAY', pathwayId: flagger.pathwayId, pathwayTitle: flagger.pathwayTitle },
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

  const namedMedications = mapMergeBucket(medsByKey);

  // Detect cross-pathway soft conflicts on clinical_role. A name-group's
  // canonical recommendation contributes its role to the pool; if ≥2 distinct
  // name-groups share a role, all of them migrate from `medications` into a
  // single `MergedConflict` entry.
  const titleByPathwayId = new Map<string, string>();
  for (const p of plans) titleByPathwayId.set(p.pathwayId, p.pathwayTitle);

  const { medications, conflicts } = detectConflicts(
    namedMedications,
    titleByPathwayId,
  );

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
    conflicts,
  };
}

/**
 * After name-grouping, look for cases where two distinct drug-groups share a
 * clinical_role. Those become a `MergedConflict`; non-conflicting groups pass
 * through as auto-included recommendations.
 *
 * A drug-group's role is the first non-empty `clinicalRole` among its members
 * — name-groups are stable across pathways so the first canonical wins.
 */
function detectConflicts(
  namedMedications: MergedRecommendation<ResolvedMedication>[],
  titleByPathwayId: Map<string, string>,
): {
  medications: MergedRecommendation<ResolvedMedication>[];
  conflicts: MergedConflict[];
} {
  // role → list of (drug-group canonical recommendation + sourcePathwayIds)
  const groupsByRole = new Map<string, MergedRecommendation<ResolvedMedication>[]>();
  for (const group of namedMedications) {
    const role = group.recommendation.clinicalRole;
    if (!role) continue;
    if (!groupsByRole.has(role)) groupsByRole.set(role, []);
    groupsByRole.get(role)!.push(group);
  }

  const conflictingGroupIds = new Set<MergedRecommendation<ResolvedMedication>>();
  const conflicts: MergedConflict[] = [];

  for (const [role, groups] of groupsByRole) {
    const distinctNames = new Set(groups.map((g) => drugKey(g.recommendation.name)));
    if (distinctNames.size < 2) continue;

    for (const g of groups) conflictingGroupIds.add(g);

    const candidates: ConflictCandidate[] = groups.map((g) => ({
      recommendation: g.recommendation,
      sourcePathwayId: g.sourcePathwayIds[0],
      sourcePathwayTitle:
        titleByPathwayId.get(g.sourcePathwayIds[0]) ?? g.sourcePathwayIds[0],
    }));

    conflicts.push({
      conflictId: role,
      type: 'medication',
      clinicalRole: role,
      candidates,
      resolution: null,
    });
  }

  // Mark conflict-group entries with the pending state and surface them as
  // both (a) absent from the active medications list (they're not auto-included)
  // and (b) inside a MergedConflict entry. Non-conflict groups pass through
  // unchanged.
  const medications = namedMedications.filter((g) => !conflictingGroupIds.has(g));
  return { medications, conflicts };
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
    conflicts: [],
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
