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
 *   - Same-regimen dedup for medications (drug + dose + frequency + route +
 *     duration); same-code dedup for labs/procedures;
 *     same-(interval, description) dedup for schedules; same-(name, measure)
 *     dedup for quality metrics; same-(topic, instructions) dedup for
 *     guidance. A key must cover every field a reader acts on, or the merge
 *     silently keeps the first pathway's text and drops the rest.
 *   - Provenance: every merged recommendation carries the IDs of all pathways
 *     that contributed it.
 *   - Soft conflicts go to the provider rather than being decided here:
 *     different drugs in one clinical_role lane, and one drug asked for at
 *     different regimens by different pathways. See `detectConflicts`.
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
  /**
   * True when candidate facts existed but could not be ordered or trusted, so
   * the gate refused to decide. Distinct from `dataUnavailable`.
   */
  indeterminate?: boolean;
  /** Why it could not decide, when `indeterminate` is true. */
  uncertaintyReason?: string;
  /**
   * True when a scalar comparison had no usable value at all. The common half
   * of "the gate did not answer" — and the only half that is honestly an "add
   * this data" prompt.
   *
   * Neither flag set on a non-firing gate means the gate ANSWERED "no". That
   * is not a gap, and rendering it as one tells a clinician to go find data
   * that would not change anything.
   */
  dataUnavailable?: boolean;
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
  /**
   * True when candidate facts existed but could not be ordered or trusted, so
   * the gate refused to decide. Distinct from `dataUnavailable`.
   */
  indeterminate?: boolean;
  /** Why it could not decide, when `indeterminate` is true. */
  uncertaintyReason?: string;
  /**
   * True when a scalar comparison had no usable value at all. The common half
   * of "the gate did not answer" — and the only half that is honestly an "add
   * this data" prompt.
   *
   * Neither flag set on a non-firing gate means the gate ANSWERED "no". That
   * is not a gap, and rendering it as one tells a clinician to go find data
   * that would not change anything.
   */
  dataUnavailable?: boolean;
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
  /** The first pathway that asked for this exact recommendation. */
  sourcePathwayId: string;
  /**
   * Every pathway that asked for this exact recommendation (same drug AND
   * regimen), first-seen order. Optional only because conflicts stored before
   * it existed lack it — read it through `candidatePathwayIds`.
   */
  sourcePathwayIds?: string[];
  sourcePathwayTitle: string;
}

/**
 * - `medication`: two or more DIFFERENT drugs share a clinical_role lane.
 * - `medication_regimen`: ONE drug is asked for at different regimens (dose,
 *   frequency, route or duration) by different pathways.
 */
export type MergedConflictType = 'medication' | 'medication_regimen';

export interface MergedConflict {
  /**
   * Stable id within the session. A `medication` conflict's id is its
   * clinical_role tag; a `medication_regimen` conflict's is
   * `regimen:<normalised drug name>`.
   */
  conflictId: string;
  type: MergedConflictType;
  /**
   * What the conflict is about, for display. For `medication` it is the
   * shared clinical_role. For `medication_regimen` it is the drug's
   * clinical_role when the drug carries one, else the drug's name.
   */
  clinicalRole: string;
  candidates: ConflictCandidate[];
  resolution: ConflictResolution | null;
}

/** Every pathway behind a candidate, tolerating rows stored before the field existed. */
export function candidatePathwayIds(c: ConflictCandidate): string[] {
  return c.sourcePathwayIds && c.sourcePathwayIds.length > 0
    ? c.sourcePathwayIds
    : [c.sourcePathwayId];
}

/**
 * What makes two medication recommendations the SAME recommendation: the drug
 * and every field of the regimen a prescriber acts on. Case and whitespace are
 * folded; an unstated field is distinct from any stated value, because two
 * entries are recoverable and a silently dropped regimen is not. The
 * recommendation `role` and `clinicalRole` are deliberately NOT part of it —
 * they describe why a pathway wants the drug, not what gets ordered.
 */
export function medicationRegimenKey(m: ResolvedMedication): string {
  return [
    drugKey(m.name),
    norm(m.dose ?? ''),
    norm(m.frequency ?? ''),
    norm(m.route ?? ''),
    norm(m.duration ?? ''),
  ].join('|');
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

/**
 * A matched pathway that was left out of the merge because it could not be
 * resolved for this session — today, only because it needs an encounter
 * anchor the session does not have. Recorded so the omission is visible
 * rather than looking like the pathway never matched.
 */
export interface SkippedPathway {
  pathwayId: string;
  logicalId: string;
  pathwayTitle: string;
  /** The error code that excluded it, e.g. MISSING_ENCOUNTER_ANCHOR. */
  code: string;
  reason: string;
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
  /**
   * Matched pathways left out of this merge, and why. Optional because rows
   * stored before it existed lack it; the GraphQL formatter reads it as [].
   */
  skippedPathways?: SkippedPathway[];
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
  // the rest by drug AND regimen. Suppression is keyed on the drug alone — an
  // AVOID/CONTRAINDICATED flag covers every regimen of that drug.
  const medsByRegimen = new Map<string, ResolvedMedication[]>();
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

      const regimenKey = medicationRegimenKey(med);
      if (!medsByRegimen.has(regimenKey)) medsByRegimen.set(regimenKey, []);
      medsByRegimen.get(regimenKey)!.push(med);
    }
  }

  const regimenGroups = mapMergeBucket(medsByRegimen);

  // Anything the pathways disagree on goes to the provider: different drugs
  // in one clinical_role lane, and one drug at different regimens.
  const titleByPathwayId = new Map<string, string>();
  for (const p of plans) titleByPathwayId.set(p.pathwayId, p.pathwayTitle);

  const { medications, conflicts } = detectConflicts(
    regimenGroups,
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
  const qualityMetrics = mergeByKey(plans, (p) => p.qualityMetrics, qualityMetricKey);

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
 * Decide which merged medications the provider has to choose between.
 *
 * Input is one entry per distinct (drug, regimen). Those are clustered by
 * drug, then:
 *
 *   1. clinical_role lanes — if two or more DIFFERENT drugs share a role, one
 *      `medication` conflict takes every regimen of every drug in the lane.
 *      All regimens, not only the tagged one: otherwise an untagged second
 *      regimen of a lane drug would be auto-included beside the open conflict.
 *   2. regimens — a drug left over with two or more regimens that between
 *      them come from two or more pathways becomes a `medication_regimen`
 *      conflict. Before this, medications were keyed by name alone and the
 *      second pathway's regimen was silently dropped.
 *   3. everything else is auto-included. That includes ONE pathway asking for
 *      one drug at two regimens (a titration step, a loading dose): there is
 *      no cross-pathway disagreement to decide, and CONFIRM_PATHWAY could not
 *      tell the two apart anyway.
 *
 * A drug's clinical_role is the first non-empty one among its regimens.
 */
function detectConflicts(
  regimenGroups: MergedRecommendation<ResolvedMedication>[],
  titleByPathwayId: Map<string, string>,
): {
  medications: MergedRecommendation<ResolvedMedication>[];
  conflicts: MergedConflict[];
} {
  // drug → its regimen groups, first-seen order.
  const byDrug = new Map<string, MergedRecommendation<ResolvedMedication>[]>();
  for (const group of regimenGroups) {
    const key = drugKey(group.recommendation.name);
    if (!byDrug.has(key)) byDrug.set(key, []);
    byDrug.get(key)!.push(group);
  }

  const roleOf = (groups: MergedRecommendation<ResolvedMedication>[]) =>
    groups.map((g) => g.recommendation.clinicalRole).find((r) => !!r);

  const toCandidate = (g: MergedRecommendation<ResolvedMedication>): ConflictCandidate => ({
    recommendation: g.recommendation,
    sourcePathwayId: g.sourcePathwayIds[0],
    sourcePathwayIds: g.sourcePathwayIds,
    sourcePathwayTitle:
      titleByPathwayId.get(g.sourcePathwayIds[0]) ?? g.sourcePathwayIds[0],
  });

  const inConflict = new Set<MergedRecommendation<ResolvedMedication>>();
  const conflicts: MergedConflict[] = [];

  // 1. clinical_role lanes: two or more different drugs in one role.
  const drugsByRole = new Map<string, string[]>();
  for (const [drug, groups] of byDrug) {
    const role = roleOf(groups);
    if (!role) continue;
    if (!drugsByRole.has(role)) drugsByRole.set(role, []);
    drugsByRole.get(role)!.push(drug);
  }
  for (const [role, drugs] of drugsByRole) {
    if (drugs.length < 2) continue;
    const groups = drugs.flatMap((d) => byDrug.get(d)!);
    for (const g of groups) inConflict.add(g);
    conflicts.push({
      conflictId: role,
      type: 'medication',
      clinicalRole: role,
      candidates: groups.map(toCandidate),
      resolution: null,
    });
  }

  // 2. one drug, several regimens, more than one pathway behind them.
  for (const [drug, groups] of byDrug) {
    if (groups.length < 2 || groups.some((g) => inConflict.has(g))) continue;
    const pathways = new Set(groups.flatMap((g) => g.sourcePathwayIds));
    if (pathways.size < 2) continue;
    for (const g of groups) inConflict.add(g);
    conflicts.push({
      conflictId: `regimen:${drug}`,
      type: 'medication_regimen',
      clinicalRole: roleOf(groups) ?? groups[0].recommendation.name.trim(),
      candidates: groups.map(toCandidate),
      resolution: null,
    });
  }

  // Conflicting entries are withheld from the active list; they reach it only
  // through a provider resolution (see applyResolution in the resolver).
  const medications = regimenGroups.filter((g) => !inConflict.has(g));
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

/** A drug's identity for suppression and clustering — its name, case-folded and trimmed. */
export function drugKey(name: string): string {
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
  // Modality + name + body region + contrast identifies an order in the
  // absence of a code. Contrast is part of it: "MRI head" with and without
  // contrast are different orders, and keying without it kept only the first
  // pathway's. An unstated contrast stays distinct from an explicit `false` —
  // two entries is recoverable, a silently dropped order is not.
  const contrast = i.contrast === undefined ? '' : String(i.contrast);
  return `${norm(i.modality)}|${norm(i.name)}|${norm(i.bodyRegion ?? '')}|${contrast}`;
}

function guidanceKey(g: ResolvedGuidance): string {
  // Topic AND instructions. Topic alone collapsed two pathways' different
  // instructions under a shared heading — anaemia-in-pregnancy and
  // asymptomatic-bacteriuria-in-pregnancy both ship "When to call us right
  // away", and the second pathway's safety-netting text vanished. Only an
  // identical instruction is a duplicate; distinct text under one topic is
  // kept, each entry with its own provenance.
  return `${norm(g.topic)}|${norm(g.instructions)}`;
}

function qualityMetricKey(q: ResolvedQualityMetric): string {
  // Name AND measure, for the same reason as guidance: name alone kept the
  // first pathway's measure definition and dropped any other.
  return `${norm(q.name)}|${norm(q.measure)}`;
}

/** Case-folded, trimmed, internal whitespace collapsed — for key equality only. */
function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
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
