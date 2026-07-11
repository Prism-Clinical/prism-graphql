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

/**
 * Per-recommendation attribution: the Gate / DecisionPoint node ids
 * whose evaluation gated the path to this recommendation. Set by the
 * projection from the parentNodeId-chain walk. Consumers cross-
 * reference these ids against ResolvedCarePlan.evidenceTrail to render
 * per-rec evidence chips ("this fired because of A, B, C").
 *
 * Empty array means no scoped gates / DPs influenced this rec (it
 * lives outside the gated subtree).
 */
type WithEvidence = { evidenceGateIds: string[] };

export interface ResolvedMedication extends WithEvidence {
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

export interface ResolvedLab extends WithEvidence {
  name: string;
  code?: string;
  system?: string;
  specimen?: string;
  sourcePathwayId: string;
  sourceNodeId?: string;
}

export interface ResolvedProcedure extends WithEvidence {
  name: string;
  code?: string;
  system?: string;
  sourcePathwayId: string;
  sourceNodeId?: string;
}

export interface ResolvedImaging extends WithEvidence {
  name: string;
  /**
   * Imaging modality (X-ray, CT, MRI, Ultrasound, etc.). Kept as a free-form
   * string at the data layer — the editor enforces a select list, but other
   * import sources (manual JSON, future migrations) may carry modalities not
   * in the canonical enum.
   */
  modality: string;
  bodyRegion?: string;
  contrast?: boolean;
  code?: string;
  system?: string;
  sourcePathwayId: string;
  sourceNodeId?: string;
}

export interface ResolvedGuidance extends WithEvidence {
  /** Short title shown in the care plan section. */
  topic: string;
  /** Longer narrative — the actual instruction the provider gives the patient. */
  instructions: string;
  /**
   * Free-form category tag (counseling, lifestyle, medication_adherence,
   * self_monitoring, other). Editor uses a select; persisted as a string
   * for forward-compat with future categories.
   */
  category?: string;
  sourcePathwayId: string;
  sourceNodeId?: string;
}

export interface ResolvedSchedule extends WithEvidence {
  interval: string;
  description: string;
  sourcePathwayId: string;
  sourceNodeId?: string;
}

export interface ResolvedQualityMetric extends WithEvidence {
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
  imaging: ResolvedImaging[];
  procedures: ResolvedProcedure[];
  guidance: ResolvedGuidance[];
  schedules: ResolvedSchedule[];
  qualityMetrics: ResolvedQualityMetric[];
  /**
   * Unmet prerequisites surfaced by the REQUIRES backtracking pass.
   * Each entry names a node the patient hasn't satisfied (per the
   * node's `satisfaction_check` property) but that was required by an
   * included downstream node — i.e. "catch-up" work the encounter
   * should also cover. Lineage is carried via `dependentNodeId`.
   */
  catchUpItems: CatchUpItem[];
  /**
   * Every gate / decision-point in this pathway that fired during
   * resolution, with the patient-context fields it read and the reason
   * it satisfied. Lets downstream UI render "this pathway considered
   * the patient's HbA1c, BP series, recurrent UTI count, etc." — the
   * provenance behind the recommendations.
   *
   * Pathway-level for v1: every recommendation in this plan is
   * influenced by these gates collectively. Per-recommendation
   * attribution (which gate caused which recommendation) is a follow-up
   * slice that requires walking the gate-to-recommendation lineage in
   * the dependency map.
   */
  evidenceTrail: GateEvidence[];
  /**
   * Gates that DIDN'T fire (gated out, pending answer, or unevaluable
   * for lack of data) and the recommendations their subtree would
   * potentially have unlocked. Lets the dashboard surface "Add HbA1c
   * series → unlocks Metformin titration" prompts so the author can
   * see which patient inputs would shift the care plan.
   */
  dataGapHints: DataGapHint[];
}

/**
 * One closed-off branch — a gate that didn't fire and the action nodes
 * it would otherwise have led to. Authors and providers read this as
 * "the system was prepared to recommend X, but needed Y data first."
 */
export interface DataGapHint {
  /** Gate node id. */
  gateNodeId: string;
  gateTitle: string;
  /** Gate kind — same vocabulary as GateEvidence.kind. */
  kind: string;
  /** Why the gate didn't fire (GATED_OUT / PENDING_QUESTION / UNKNOWN). */
  status: string;
  /** Evaluator's reason string, when available. */
  reason?: string;
  /** Patient-context field paths the gate would have read. */
  fieldsRead: string[];
  /** Action-node recommendations downstream of this gate. */
  unlockedRecommendations: UnlockedRecommendation[];
}

export interface UnlockedRecommendation {
  nodeId: string;
  nodeType: string;
  title: string;
}

/**
 * One gate's contribution to the pathway's resolution. Surfaced for
 * provider transparency — clinicians can see what patient data the
 * pathway looked at, not just the final care plan.
 */
export interface GateEvidence {
  /** Pathway node id of the gate / decision point. */
  nodeId: string;
  /** Display title (e.g. "BP > 130", "HbA1c trending up over 6mo"). */
  title: string;
  /**
   * Gate type — 'patient_attribute' | 'compound' | 'question' |
   * 'llm_text_analysis' | 'prior_node_result' | 'decision_point'.
   * Lets the dashboard render different chips per source kind.
   */
  kind: string;
  /** INCLUDED / GATED_OUT / PENDING_QUESTION / etc. */
  status: string;
  /**
   * Human-readable explanation of how the gate evaluated, written by
   * the gate evaluator (e.g. "labs value 8.1 > 7.0", "Found 3 matching
   * N39.0 in conditions within last 180 days (≥2)").
   */
  reason?: string;
  /**
   * Patient-context field paths the gate read (e.g. "labs",
   * "conditions", "vitals.systolic_bp"). Lets the dashboard render
   * which signals drove the gate.
   */
  fieldsRead: string[];
}

/** REQUIRES backtracking — see services/resolution/prerequisites.ts. */
export interface CatchUpItem {
  /** The unmet prerequisite node. */
  nodeId: string;
  nodeType: string;
  title: string;
  /** The downstream node that REQUIRES this prereq. */
  dependentNodeId: string;
  /** Why it was flagged: 'no-satisfaction-check' | 'code-not-in-snapshot' | 'attestation-required'. */
  reason: string;
  /** Pathway this catch-up item belongs to (filled at merge time when aggregating across plans). */
  sourcePathwayId: string;
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
  | 'imaging'
  | 'procedure'
  | 'guidance'
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
    | ResolvedImaging
    | ResolvedProcedure
    | ResolvedGuidance
    | ResolvedSchedule
    | ResolvedQualityMetric;
}

export interface MergedCarePlan {
  sourcePathwayIds: string[];
  medications: MergedRecommendation<ResolvedMedication>[];
  labs: MergedRecommendation<ResolvedLab>[];
  imaging: MergedRecommendation<ResolvedImaging>[];
  procedures: MergedRecommendation<ResolvedProcedure>[];
  guidance: MergedRecommendation<ResolvedGuidance>[];
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
  /**
   * Unmet prerequisites surfaced by the REQUIRES backtracking pass,
   * aggregated across every contributing pathway. Each entry's
   * `sourcePathwayId` names the pathway that flagged the catch-up.
   */
  catchUpItems: CatchUpItem[];
  /**
   * Evidence aggregated across every contributing pathway. Each entry
   * carries `sourcePathwayId` so the dashboard can group by pathway or
   * surface a flat "everything the system looked at" view.
   */
  evidenceTrail: (GateEvidence & { sourcePathwayId: string })[];
  /**
   * Data-gap hints aggregated across contributing pathways. Each entry
   * has `sourcePathwayId` so the dashboard can attribute "this pathway
   * would have recommended X if you had Y."
   */
  dataGapHints: (DataGapHint & { sourcePathwayId: string })[];
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

  // Labs/imaging/procedures/guidance/schedules/quality metrics: pure dedup
  // by appropriate key. Hard constraints don't apply (only medications carry
  // contraindication semantics in the existing schema).
  const labs = mergeByKey(plans, (p) => p.labs, labKey);
  const imaging = mergeByKey(plans, (p) => p.imaging, imagingKey);
  const procedures = mergeByKey(plans, (p) => p.procedures, procedureKey);
  const guidance = mergeByKey(plans, (p) => p.guidance, guidanceKey);
  const schedules = mergeByKey(plans, (p) => p.schedules, scheduleKey);
  const qualityMetrics = mergeByKey(
    plans,
    (p) => p.qualityMetrics,
    (q) => q.name.toLowerCase().trim(),
  );

  // Aggregate catch-up items across pathways. Dedup by (nodeId,
  // sourcePathwayId) so the same prereq surfaced by two siblings within
  // one pathway only appears once; cross-pathway prereqs against the
  // same patient gap (rare) still surface independently so the lineage
  // makes sense.
  const seenCatchUp = new Set<string>();
  const catchUpItems: CatchUpItem[] = [];
  for (const plan of plans) {
    for (const item of plan.catchUpItems ?? []) {
      const key = `${item.sourcePathwayId}::${item.nodeId}`;
      if (seenCatchUp.has(key)) continue;
      seenCatchUp.add(key);
      catchUpItems.push(item);
    }
  }

  // Aggregate gate evidence across pathways. Nested pathways commonly
  // walk the same DP node (e.g. "BP ≥ 140/90?"), so if we concatenated
  // naively the merged trail would show the same gate N times — once
  // per contributing pathway. Dedup by nodeId, first-seen wins, keep
  // the winning entry's sourcePathwayId for attribution. If two
  // pathways evaluate the same node to different statuses that would
  // be a resolver bug worth surfacing separately; here we treat the
  // gate as a merged decision and emit it once.
  const evidenceTrail: (GateEvidence & { sourcePathwayId: string })[] = [];
  const seenGateNodes = new Set<string>();
  for (const plan of plans) {
    for (const ev of plan.evidenceTrail ?? []) {
      if (seenGateNodes.has(ev.nodeId)) continue;
      seenGateNodes.add(ev.nodeId);
      evidenceTrail.push({ ...ev, sourcePathwayId: plan.pathwayId });
    }
  }

  // Same dedup logic for data-gap hints — same gateNodeId across
  // pathways would otherwise show the same "add X → unlocks N recs"
  // card twice.
  const dataGapHints: (DataGapHint & { sourcePathwayId: string })[] = [];
  const seenGapNodes = new Set<string>();
  for (const plan of plans) {
    for (const hint of plan.dataGapHints ?? []) {
      if (seenGapNodes.has(hint.gateNodeId)) continue;
      seenGapNodes.add(hint.gateNodeId);
      dataGapHints.push({ ...hint, sourcePathwayId: plan.pathwayId });
    }
  }

  return {
    sourcePathwayIds: plans.map((p) => p.pathwayId),
    medications,
    labs,
    imaging,
    procedures,
    guidance,
    schedules,
    qualityMetrics,
    suppressed,
    conflicts,
    catchUpItems,
    evidenceTrail,
    dataGapHints,
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
    imaging: [],
    procedures: [],
    guidance: [],
    schedules: [],
    qualityMetrics: [],
    suppressed: [],
    conflicts: [],
    catchUpItems: [],
    evidenceTrail: [],
    dataGapHints: [],
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

function imagingKey(i: ResolvedImaging): string {
  if (i.code && i.system) return `${i.system}|${i.code}`;
  // Modality + name + body region uniquely identifies an order in the
  // absence of a code (e.g. "MRI head without contrast").
  return `${i.modality.toLowerCase().trim()}|${i.name.toLowerCase().trim()}|${(i.bodyRegion ?? '').toLowerCase().trim()}`;
}

function guidanceKey(g: ResolvedGuidance): string {
  // Topic alone — two pathways shipping the same counseling topic should
  // dedupe even if the instruction text differs slightly. The first plan's
  // text wins (mergeByKey takes the first occurrence).
  return g.topic.toLowerCase().trim();
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
