import type { PatientContext } from '../../confidence/types';
import type { DdiCandidate, DdiFinding } from '../../medications/ddi-pass';
import type { SafetyReference } from '../../medications/safety-reference';
import {
  ConflictCandidate,
  ConflictResolution,
  CustomMedicationOverride,
  MergedCarePlan,
  MergedConflict,
  MergedRecommendation,
  ResolvedMedication,
  SuppressedRecommendation,
  SuppressionSource,
  mergeResolvedCarePlans,
} from '../care-plan-merge';
import { projectMedication, projectResolutionToCarePlan } from '../care-plan-projection';
import { NodeStatus, ResolutionState } from '../types';
import { canonicalJson, hashOf } from './canonical';
import { ddiSuppressionReason, findingId } from './disposition';
import type { PathwayMeta } from './load-env';
import { pairSafety, patientSafety } from './safety';
import type { EvaluationResult, RunBlocker, RunChildResult, RunResult } from './types';

/** One child of a run, evaluated at CONTRIBUTION scope. */
export interface Contribution {
  pathwayId: string;
  /** '' before the child row exists (start). */
  sessionId: string;
  result: EvaluationResult;
}

export interface ComposeContext {
  /** The run's effective patient: the parent's initial context plus its additions (D5). */
  patient: PatientContext;
  conflictResolutions: Record<string, ConflictResolution>;
  /** The run's one safety reference (C4). */
  safety: SafetyReference;
  meta: Map<string, PathwayMeta>;
  envFingerprint: string;
}

/** The pathway id the merge has always given a provider's write-in. */
export const WRITE_IN = 'provider-override';

/**
 * A recommendation's identity across a run. Node ids are local to a pathway —
 * two pathways can both have a `med-1` (review #5) — so the pair check, every
 * suppression and every withholding use this qualified form (P4-3).
 */
export const recommendationKey = (r: { sourcePathwayId: string; sourceNodeId?: string; name: string }): string =>
  `${r.sourcePathwayId}|${r.sourceNodeId ?? r.name}`;

/** The projection reads gateContextFields as sets; the pipeline stores sorted arrays. */
export const setsOf = (m: Map<string, string[]>): Map<string, Set<string>> =>
  new Map([...m].map(([k, v]) => [k, new Set(v)] as [string, Set<string>]));

const drugKey = (name: string): string => name.toLowerCase().trim();
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A state in nodeId order. Projection and merge keep first-seen entries, and state order follows input order (P4-4). */
const inNodeOrder = (s: ResolutionState): ResolutionState => new Map([...s].sort(([a], [b]) => byString(a, b)));

interface Withholding {
  withheldBy: 'conflict' | 'safety';
  findingIds: string[];
  reason: string;
}

export interface Selection {
  medications: MergedRecommendation<ResolvedMedication>[];
  conflicts: MergedConflict[];
  blockers: RunBlocker[];
  losers: Array<{ candidate: ConflictCandidate; conflict: MergedConflict; reason: string }>;
}

/**
 * Spec §3 — compose a run from its contributions. Pure: every input is an
 * argument, and the result, `resultHash` included, depends on nothing else.
 */
export function composeRun(contributions: Contribution[], ctx: ComposeContext): RunResult {
  // 1. Project each contribution. Its dispositions already reflect patient-scope safety (stage 5).
  const plans = contributions.map((c) => {
    const meta = ctx.meta.get(c.pathwayId);
    return projectResolutionToCarePlan(
      inNodeOrder(c.result.resolutionState),
      { pathwayId: c.pathwayId, pathwayLogicalId: meta?.logicalId ?? c.pathwayId, pathwayTitle: meta?.title ?? c.pathwayId },
      c.result.catchUpItems,
      { gateContextFields: setsOf(c.result.gateContextFields) },
    );
  });

  // Every Medication node that proposes each drug, with its clinical lane, so
  // the root can withhold each node it rules out (P4-2).
  const proposers = new Map<string, Array<{ pathwayId: string; nodeId: string; clinicalRole?: string }>>();
  for (const c of contributions) {
    for (const n of inNodeOrder(c.result.resolutionState).values()) {
      if (n.nodeType !== 'Medication') continue;
      const med = projectMedication(n, c.pathwayId);
      if (!med) continue;
      const k = drugKey(med.name);
      proposers.set(k, [...(proposers.get(k) ?? []), { pathwayId: c.pathwayId, nodeId: n.nodeId, clinicalRole: med.clinicalRole }]);
    }
  }

  // The suppressions each contribution applied, recorded on the plan (a
  // multi-start child used to lose them without a trace).
  const contributionSuppressed: SuppressedRecommendation[] = [];
  for (const c of contributions) {
    for (const f of c.result.safetyFindings) {
      if (f.action !== 'SUPPRESS') continue;
      const n = c.result.resolutionState.get(f.recommendationId);
      const med = n ? projectMedication(n, c.pathwayId) : null;
      if (med) contributionSuppressed.push(suppressionOf(med, f));
    }
  }

  // 2. Merge. 3. Select, from the base merge — never appended (review #6).
  const base = mergeResolvedCarePlans(plans);
  const selection = selectConflicts(base, ctx.conflictResolutions);
  const candidateOf = (m: MergedRecommendation<ResolvedMedication>): DdiCandidate =>
    ({ recommendationId: recommendationKey(m.recommendation), drugName: m.recommendation.name });
  const byKey = new Map(selection.medications.map((m) => [recommendationKey(m.recommendation), m]));

  // 4. Patient safety for the candidates the root introduces: write-ins (C3).
  const writeIns = selection.medications.filter((m) => m.recommendation.sourcePathwayId === WRITE_IN);
  const rootPatient = patientSafety(ctx.safety, writeIns.map(candidateOf), ctx.patient);
  const afterPatient = selection.medications.filter((m) => !rootPatient.suppressed.has(recommendationKey(m.recommendation)));

  // 5. Set safety over the final candidate set — root only (stage 6, review #7).
  const set = pairSafety(ctx.safety, afterPatient.map(candidateOf));
  const medications = afterPatient.filter((m) => !set.suppressed.has(recommendationKey(m.recommendation)));
  const rootFindings = [...rootPatient.findings, ...set.findings];
  const rootSuppressed = rootFindings
    .filter((f) => f.action === 'SUPPRESS')
    .map((f) => suppressionOf(byKey.get(f.recommendationId)!.recommendation, f));

  // 6. Readiness at the root.
  const blockers: RunBlocker[] = [
    ...contributions.flatMap((c) => c.result.readiness.blockers.map((b) => ({ ...b, pathwayId: c.pathwayId }))),
    ...selection.blockers,
    // Patient medications are reported by every contribution (P4-15); the root adds only its write-ins.
    ...rootPatient.unavailable.filter((u) => u.source === 'CANDIDATE').map((u): RunBlocker => ({
      scope: 'COMPLETENESS',
      type: 'SAFETY_DATA_UNAVAILABLE',
      description: `"${u.drugName}" cannot be safety-checked: no normalised medication`,
      relatedNodeIds: [],
    })),
  ];
  const mergedPlan: MergedCarePlan = {
    ...base,
    medications,
    conflicts: selection.conflicts,
    suppressed: [
      ...base.suppressed,
      ...[...contributionSuppressed, ...rootSuppressed].sort((a, b) => byString(canonicalJson(a), canonicalJson(b))),
    ],
  };
  if (mergedPlan.medications.length + mergedPlan.labs.length + mergedPlan.procedures.length === 0) {
    blockers.push({
      scope: 'OUTPUT',
      type: 'EMPTY_PLAN',
      description: 'Merged plan has no medications, labs or procedures — the care plan would be empty',
      relatedNodeIds: [],
    });
  }

  // The root's dispositions, onto the nodes that proposed what it withheld (C2, P4-2).
  const withheld = new Map<string, Withholding>();
  for (const { candidate, conflict, reason } of selection.losers) {
    for (const p of proposers.get(drugKey(candidate.recommendation.name)) ?? []) {
      if (p.clinicalRole !== conflict.clinicalRole) continue;
      withheld.set(`${p.pathwayId}|${p.nodeId}`, { withheldBy: 'conflict', findingIds: [conflict.conflictId], reason });
    }
  }
  const suppressing = set.findings.filter((f) => f.action === 'SUPPRESS');
  for (const key of new Set(suppressing.map((f) => f.recommendationId))) {
    const m = byKey.get(key)!;
    if (m.recommendation.sourcePathwayId === WRITE_IN) continue; // a write-in has no node
    const mine = suppressing.filter((f) => f.recommendationId === key);
    for (const p of proposers.get(drugKey(m.recommendation.name)) ?? []) {
      if (!m.sourcePathwayIds.includes(p.pathwayId)) continue;
      withheld.set(`${p.pathwayId}|${p.nodeId}`, {
        withheldBy: 'safety',
        findingIds: mine.map(findingId).sort(),
        reason: ddiSuppressionReason(mine, key) ?? 'Withheld by a safety check',
      });
    }
  }

  // A pathway's contraindicated/avoid constraint removes the drug every other
  // pathway proposes (the merge). Each proposer carries that withholding too,
  // keyed by its own provenance; the node that states the constraint is not a
  // proposal and keeps its status. 'conflict': one pathway overruling another
  // at the root, not a patient finding — WithheldBy stays SAFETY | CONFLICT.
  for (const sup of base.suppressed) {
    if (sup.type !== 'medication' || sup.source.kind !== 'PATHWAY') continue;
    const m = sup.original as ResolvedMedication;
    if (m.role === 'contraindicated' || m.role === 'avoid' || !m.sourceNodeId) continue;
    withheld.set(`${m.sourcePathwayId}|${m.sourceNodeId}`, {
      withheldBy: 'conflict',
      findingIds: [],
      reason: `${sup.reason === 'avoid' ? 'Avoided' : 'Contraindicated'} by "${sup.source.pathwayTitle}"`,
    });
  }

  const children: RunChildResult[] = contributions.map((c) => ({
    pathwayId: c.pathwayId,
    sessionId: c.sessionId,
    result: { ...c.result, resolutionState: withholdAt(c.pathwayId, c.result.resolutionState, withheld) },
  }));
  const run: Omit<RunResult, 'resultHash'> = {
    mergedPlan,
    safetyFindings: rootFindings,
    ddiWarnings: [
      ...contributions.flatMap((c) => c.result.safetyFindings.filter((f) => f.action === 'WARN')),
      ...rootFindings.filter((f) => f.action === 'WARN'),
    ],
    readiness: { ready: blockers.length === 0, blockers },
    children,
    envFingerprint: ctx.envFingerprint,
  };
  return { ...run, resultHash: runHashOf(run) };
}

/**
 * Stage 3: apply each decision to the base merge's conflict. The medications
 * are rebuilt every time, so a changed choice REPLACES the previous one and a
 * repeated choice changes nothing (review #6). A decision whose chosen pathway
 * is no longer a candidate is a blocker, not a crash; a decision for a
 * conflict that no longer exists is inert.
 */
export function selectConflicts(base: MergedCarePlan, decisions: Record<string, ConflictResolution>): Selection {
  const medications = [...base.medications];
  const conflicts: MergedConflict[] = [];
  const blockers: RunBlocker[] = [];
  const losers: Selection['losers'] = [];

  for (const conflict of base.conflicts) {
    const related = conflict.candidates.map((c) => c.recommendation.sourceNodeId ?? c.sourcePathwayId);
    const decision = decisions[conflict.conflictId];
    if (!decision) {
      conflicts.push(conflict);
      blockers.push({
        scope: 'OUTPUT', type: 'UNRESOLVED_CONFLICT', relatedNodeIds: related,
        description: `Conflict "${conflict.conflictId}" is unresolved — choose before generating the care plan`,
      });
      continue;
    }
    if (decision.kind === 'CONFIRM_PATHWAY' && !conflict.candidates.some((c) => c.sourcePathwayId === decision.chosenPathwayId)) {
      conflicts.push(conflict);
      blockers.push({
        scope: 'OUTPUT', type: 'STALE_CONFLICT_DECISION', relatedNodeIds: related,
        description: `The choice recorded for "${conflict.conflictId}" names a pathway that no longer proposes a candidate — choose again`,
      });
      continue;
    }

    conflicts.push({ ...conflict, resolution: decision });
    const lose = (candidate: ConflictCandidate, reason: string) => losers.push({ candidate, conflict, reason });
    switch (decision.kind) {
      case 'CONFIRM_PATHWAY':
        for (const c of conflict.candidates) {
          if (c.sourcePathwayId === decision.chosenPathwayId) {
            medications.push({ recommendation: c.recommendation, sourcePathwayIds: [c.sourcePathwayId], state: 'provider-confirmed' });
          } else {
            lose(c, `Not chosen for "${conflict.clinicalRole}"`);
          }
        }
        break;
      case 'ACCEPT_BOTH':
        for (const c of conflict.candidates) {
          medications.push({ recommendation: c.recommendation, sourcePathwayIds: [c.sourcePathwayId], state: 'auto-included' });
        }
        break;
      case 'REJECT_BOTH':
        for (const c of conflict.candidates) lose(c, `Rejected for "${conflict.clinicalRole}"`);
        break;
      case 'CUSTOM_OVERRIDE':
        for (const c of conflict.candidates) lose(c, `Replaced by a write-in for "${conflict.clinicalRole}"`);
        medications.push({ recommendation: writeInOf(decision.customMedication), sourcePathwayIds: [WRITE_IN], state: 'provider-override' });
        break;
    }
  }
  return { medications, conflicts, blockers, losers };
}

/**
 * Spec §1 rule 8, for a run: the merged plan with its dispositions, the
 * suppressions, the conflicts with their derived decisions, the root's
 * safety findings, the root's blockers and every child's hash in contributing
 * order. A contribution's own findings are inside its child hash, so every
 * warning a provider sees is covered. Evidence, data-gap hints, the
 * environment fingerprint and who decided when are not part of what a
 * provider reviews.
 */
export function runHashOf(r: Omit<RunResult, 'resultHash'>): string {
  const blockerKey = (b: RunBlocker) => `${b.scope}|${b.type}|${b.pathwayId ?? ''}|${b.relatedNodeIds.join(',')}|${b.description}`;
  return hashOf({
    plan: { ...r.mergedPlan, evidenceTrail: undefined, dataGapHints: undefined, conflicts: undefined },
    conflicts: r.mergedPlan.conflicts.map((c) => ({
      conflictId: c.conflictId,
      candidates: c.candidates.map((x) => recommendationKey(x.recommendation)),
      decision: c.resolution
        ? {
          kind: c.resolution.kind,
          chosenPathwayId: c.resolution.kind === 'CONFIRM_PATHWAY' ? c.resolution.chosenPathwayId : null,
          customMedication: c.resolution.kind === 'CUSTOM_OVERRIDE' ? c.resolution.customMedication : null,
        }
        : null,
    })),
    // A root-only warning (a moderate pair, a write-in against a patient
    // medication) changes no medication, blocker or child hash — only this.
    safetyFindings: r.safetyFindings
      .map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'meta')))
      .sort((a, b) => byString(canonicalJson(a), canonicalJson(b))),
    blockers: [...r.readiness.blockers].sort((a, b) => byString(blockerKey(a), blockerKey(b))),
    children: r.children.map((c) => c.result.resultHash),
  });
}

function withholdAt(pathwayId: string, state: ResolutionState, withheld: Map<string, Withholding>): ResolutionState {
  const out: ResolutionState = new Map();
  for (const [id, n] of state) {
    // Only an INCLUDED node can be withheld; its eligibility keeps the pathway's reason (C2).
    const w = n.status === NodeStatus.INCLUDED ? withheld.get(`${pathwayId}|${id}`) : undefined;
    out.set(id, w
      ? { ...n, status: NodeStatus.EXCLUDED, excludeReason: w.reason, disposition: { status: NodeStatus.EXCLUDED, withheldBy: w.withheldBy, findingIds: w.findingIds, reason: w.reason } }
      : n);
  }
  return out;
}

function writeInOf(custom: CustomMedicationOverride): ResolvedMedication {
  return {
    name: custom.name,
    role: 'first_line', // a provider's write-in is treated as first-line, as it always was
    dose: custom.dose,
    frequency: custom.frequency,
    duration: custom.duration,
    route: custom.route,
    sourcePathwayId: WRITE_IN,
    evidenceGateIds: [],
  };
}

function suppressionOf(med: ResolvedMedication, f: DdiFinding): SuppressedRecommendation {
  const reason = f.category === 'ALLERGY' ? 'allergy' : f.category === 'DDI_CONTRAINDICATED' ? 'ddi_contraindicated' : 'ddi_severe';
  const s = f.source;
  const source: SuppressionSource =
    s.kind === 'PATIENT_MEDICATION' ? { kind: s.kind, rxcui: s.rxcui, name: s.name }
      : s.kind === 'PATIENT_ALLERGY' ? { kind: s.kind, snomedCode: s.snomedCode, snomedDisplay: s.snomedDisplay }
        : { kind: s.kind, recommendationId: s.recommendationId, drugName: s.drugName };
  return { type: 'medication', name: med.name, reason, source, original: med };
}
