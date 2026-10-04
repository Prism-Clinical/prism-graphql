/**
 * The provider's own changes to the recommended plan — a run input, like the
 * conflict decisions (Josh, 2026-10-04: "orders need remove, add order, edit";
 * "ability to edit guidance as free text").
 *
 * Stored on the run and applied every time the run is composed, so a change
 * survives every later answer and re-evaluation, is part of the result hash
 * the provider signs, and reaches the care plan rows through the merged plan.
 *
 *   - EDIT overlays text fields onto a line the pathways produced. It is keyed
 *     to the NODES the line stands for, not to the merged line's key (the
 *     guidance key contains the very text being edited): the edit applies to
 *     the line that carries any of its target nodes. If the pathways stop
 *     producing the line, the edit does not bring it back — it is reported as
 *     not applying, never silently dropped.
 *   - ADD appends a line no pathway produced. Its provenance is the write-in
 *     pathway id, with the edit id as its node, so it is removed and edited
 *     through the same references as any other line. An added medication is a
 *     write-in: it goes through the root's patient and pair safety checks.
 *
 * Removal is not here: it is an EXCLUDE override on the owning session.
 */

import type {
  MergedCarePlan,
  MergedRecommendation,
  ResolvedGuidance,
  ResolvedImaging,
  ResolvedLab,
  ResolvedMedication,
  ResolvedProcedure,
  ResolvedSchedule,
} from '../care-plan-merge';

/** The pathway id the merge has always given a provider's write-in. */
export const WRITE_IN = 'provider-override';

export const PLAN_ITEM_KINDS = ['medication', 'lab', 'imaging', 'procedure', 'guidance', 'schedule'] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];

export interface PlanNodeRef {
  pathwayId: string;
  nodeId: string;
}

export interface PlanEdit {
  id: string;
  action: 'EDIT' | 'ADD';
  itemKind: PlanItemKind;
  /** EDIT only: the nodes of the line being edited. */
  target?: PlanNodeRef[];
  /** Text fields, by the names in `EDITABLE` / `ADDABLE`. */
  fields: Record<string, string>;
  by?: string;
  at: string;
}

export type PlanEdits = Record<string, PlanEdit>;

/** What an EDIT may change. A lab, an image or a procedure is not edited: changing the order is remove + add. */
export const EDITABLE: Record<PlanItemKind, readonly string[]> = {
  medication: ['dose', 'frequency', 'route', 'duration'],
  guidance: ['topic', 'instructions'],
  schedule: ['interval', 'description'],
  lab: [],
  imaging: [],
  procedure: [],
};

/** What an ADD carries; the first field is required. */
export const ADDABLE: Record<PlanItemKind, readonly string[]> = {
  medication: ['name', 'dose', 'frequency', 'route', 'duration'],
  lab: ['name', 'code', 'system', 'specimen'],
  imaging: ['name', 'modality', 'bodyRegion', 'code', 'system'],
  procedure: ['name', 'code', 'system'],
  guidance: ['topic', 'instructions'],
  schedule: ['interval', 'description'],
};

/** The problem with an edit's fields, or null. Empty strings are dropped by `cleanFields`, so "" clears nothing. */
export function planEditProblem(action: 'EDIT' | 'ADD', kind: PlanItemKind, fields: Record<string, unknown>): string | null {
  const allowed = action === 'EDIT' ? EDITABLE[kind] : ADDABLE[kind];
  if (allowed.length === 0) return `A ${kind} line cannot be edited — remove it and add the order you want`;
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) return `"${k}" is not a field of a ${kind} ${action === 'EDIT' ? 'edit' : 'addition'} (allowed: ${allowed.join(', ')})`;
    if (typeof v !== 'string') return `"${k}" must be text`;
    if (v.length > 4000) return `"${k}" is too long`;
  }
  const cleaned = cleanFields(fields);
  if (Object.keys(cleaned).length === 0) return 'Nothing to change — every field is empty';
  if (action === 'ADD' && !cleaned[allowed[0]]) return `"${allowed[0]}" is required`;
  return null;
}

export function cleanFields(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

const inOrder = (edits: PlanEdits): PlanEdit[] =>
  Object.values(edits).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));

/** The nodes a merged line stands for; a line merged before `sourceNodes` existed has its canonical node. */
function nodesOf(m: MergedRecommendation<{ sourcePathwayId: string; sourceNodeId?: string }>): PlanNodeRef[] {
  if (m.sourceNodes?.length) return m.sourceNodes;
  const { sourcePathwayId, sourceNodeId } = m.recommendation;
  return sourceNodeId ? [{ pathwayId: sourcePathwayId, nodeId: sourceNodeId }] : [];
}

const targets = (edit: PlanEdit, m: MergedRecommendation<{ sourcePathwayId: string; sourceNodeId?: string }>): boolean =>
  (edit.target ?? []).some((t) => nodesOf(m).some((n) => n.pathwayId === t.pathwayId && n.nodeId === t.nodeId));

const provenance = (edit: PlanEdit) => ({
  sourcePathwayId: WRITE_IN,
  sourceNodeId: edit.id,
  evidenceGateIds: [] as string[],
});

function added<T extends { sourcePathwayId: string }>(edit: PlanEdit, recommendation: T): MergedRecommendation<T> {
  return {
    recommendation,
    sourcePathwayIds: [WRITE_IN],
    sourceNodes: [{ pathwayId: WRITE_IN, nodeId: edit.id }],
    state: 'provider-override',
  };
}

/**
 * An order is one line: an addition the pathways already order (same code, or
 * same name) is not appended a second time. It still counts as applying — the
 * order is in the plan — and comes back by itself if the pathway's line goes.
 */
function notAlreadyOrdered<T extends { name: string; code?: string; system?: string }>(
  existing: MergedRecommendation<T>[],
  additions: MergedRecommendation<T>[],
): MergedRecommendation<T>[] {
  // By code AND by name: the pathway's line may carry a different code for
  // the same test, or none.
  const keys = (r: { name: string; code?: string; system?: string }) => [
    ...(r.code && r.system ? [`${r.system}|${r.code}`] : []),
    `name|${r.name.toLowerCase().trim()}`,
  ];
  const seen = new Set(existing.flatMap((m) => keys(m.recommendation)));
  return additions.filter((m) => {
    const mine = keys(m.recommendation);
    if (mine.some((k) => seen.has(k))) return false;
    for (const k of mine) seen.add(k);
    return true;
  });
}

/** The medications a provider added — write-ins, to be safety-checked with the rest. */
export function addedMedications(edits: PlanEdits): MergedRecommendation<ResolvedMedication>[] {
  return inOrder(edits)
    .filter((e) => e.action === 'ADD' && e.itemKind === 'medication')
    .map((e) => added(e, {
      name: e.fields.name,
      role: 'first_line', // as a conflict write-in is
      dose: e.fields.dose,
      frequency: e.fields.frequency,
      duration: e.fields.duration,
      route: e.fields.route,
      ...provenance(e),
    } as ResolvedMedication));
}

/** Names of the added medications, for normalisation before safety. */
export const addedMedicationNames = (edits: PlanEdits): string[] =>
  addedMedications(edits).map((m) => m.recommendation.name);

function overlay<T extends { sourcePathwayId: string; sourceNodeId?: string }>(
  lines: MergedRecommendation<T>[],
  edits: PlanEdit[],
  applied: Set<string>,
): MergedRecommendation<T>[] {
  return lines.map((m) => {
    const mine = edits.filter((e) => targets(e, m));
    if (mine.length === 0) return m;
    let recommendation = m.recommendation;
    for (const e of mine) {
      applied.add(e.id);
      recommendation = { ...recommendation, ...e.fields };
    }
    return { ...m, recommendation, state: 'provider-override' };
  });
}

/**
 * The plan with the provider's edits and additions. Medications passed in are
 * the FINAL set (added ones included, after safety): only their text is
 * edited here. Returns the ids of the edits that found their line.
 */
export function applyPlanEdits(plan: MergedCarePlan, edits: PlanEdits): { plan: MergedCarePlan; applied: string[] } {
  const all = inOrder(edits);
  if (all.length === 0) return { plan, applied: [] };
  const applied = new Set<string>();
  const editsOf = (kind: PlanItemKind) => all.filter((e) => e.action === 'EDIT' && e.itemKind === kind);
  const addsOf = (kind: PlanItemKind) => all.filter((e) => e.action === 'ADD' && e.itemKind === kind);
  for (const e of all) if (e.action === 'ADD') applied.add(e.id);

  const out: MergedCarePlan = {
    ...plan,
    medications: overlay(plan.medications, editsOf('medication'), applied),
    guidance: [
      ...overlay(plan.guidance ?? [], editsOf('guidance'), applied),
      ...addsOf('guidance').map((e) => added(e, {
        topic: e.fields.topic, instructions: e.fields.instructions ?? '', ...provenance(e),
      } as ResolvedGuidance)),
    ],
    schedules: [
      ...overlay(plan.schedules, editsOf('schedule'), applied),
      ...addsOf('schedule').map((e) => added(e, {
        interval: e.fields.interval, description: e.fields.description ?? '', ...provenance(e),
      } as ResolvedSchedule)),
    ],
    labs: [
      ...plan.labs,
      ...notAlreadyOrdered(plan.labs, addsOf('lab').map((e) => added(e, {
        name: e.fields.name, code: e.fields.code, system: e.fields.system, specimen: e.fields.specimen, ...provenance(e),
      } as ResolvedLab))),
    ],
    imaging: [
      ...(plan.imaging ?? []),
      ...notAlreadyOrdered((plan.imaging ?? []), addsOf('imaging').map((e) => added(e, {
        name: e.fields.name, modality: e.fields.modality ?? '', bodyRegion: e.fields.bodyRegion,
        code: e.fields.code, system: e.fields.system, ...provenance(e),
      } as ResolvedImaging))),
    ],
    procedures: [
      ...plan.procedures,
      ...notAlreadyOrdered(plan.procedures, addsOf('procedure').map((e) => added(e, {
        name: e.fields.name, code: e.fields.code, system: e.fields.system, ...provenance(e),
      } as ResolvedProcedure))),
    ],
  };
  return { plan: out, applied: [...applied].sort() };
}
