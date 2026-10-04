/**
 * The provider's edits and additions to a run's plan (Josh, 2026-10-04).
 * Pure: `applyPlanEdits` over a merged plan. The run-level behaviour (stored,
 * re-applied on every evaluation, safety for an added medication) is covered
 * end to end through the API.
 */

import {
  WRITE_IN,
  addedMedications,
  applyPlanEdits,
  planEditProblem,
  type PlanEdit,
  type PlanEdits,
} from '../services/resolution/pipeline/plan-edits';
import type { MergedCarePlan } from '../services/resolution/care-plan-merge';

const PW = 'pw-anemia';
const line = <T extends object>(recommendation: T, nodeIds: string[]) => ({
  recommendation: { sourcePathwayId: PW, sourceNodeId: nodeIds[0], evidenceGateIds: [], ...recommendation },
  sourcePathwayIds: [PW],
  sourceNodes: nodeIds.map((nodeId) => ({ pathwayId: PW, nodeId })),
  state: 'auto-included' as const,
});

const plan = (): MergedCarePlan => ({
  sourcePathwayIds: [PW],
  medications: [line({ name: 'Ferrous sulfate 325 mg', role: 'first_line', dose: '325 mg', frequency: 'daily' }, ['med-1'])],
  labs: [line({ name: 'CBC with indices', code: '58410-2', system: 'LOINC' }, ['lab-1', 'lab-25'])],
  imaging: [],
  procedures: [],
  guidance: [line({ topic: 'What the response recheck decides', instructions: 'A rise of at least 1 g/dL is a response.' }, ['guid-9'])],
  schedules: [line({ interval: '2–4 weeks', description: 'Repeat hemoglobin.' }, ['sched-10'])],
  qualityMetrics: [],
  suppressed: [],
  conflicts: [],
} as unknown as MergedCarePlan);

const edit = (e: Partial<PlanEdit> & Pick<PlanEdit, 'id' | 'action' | 'itemKind' | 'fields'>): PlanEdit =>
  ({ at: `2026-10-04T15:00:0${e.id.length % 10}.000Z`, ...e });
const edits = (...list: PlanEdit[]): PlanEdits => Object.fromEntries(list.map((e) => [e.id, e]));

describe('applyPlanEdits', () => {
  it('no edits: the plan is returned untouched', () => {
    const p = plan();
    expect(applyPlanEdits(p, {}).plan).toBe(p);
  });

  it('guidance is edited as free text, and the line becomes the provider\'s', () => {
    const { plan: out, applied } = applyPlanEdits(plan(), edits(edit({
      id: 'e1', action: 'EDIT', itemKind: 'guidance', target: [{ pathwayId: PW, nodeId: 'guid-9' }],
      fields: { instructions: 'Discussed the recheck; she prefers to return in 3 weeks.' },
    })));
    expect(out.guidance![0].recommendation.instructions).toBe('Discussed the recheck; she prefers to return in 3 weeks.');
    expect(out.guidance![0].recommendation.topic).toBe('What the response recheck decides');
    expect(out.guidance![0].state).toBe('provider-override');
    expect(applied).toEqual(['e1']);
  });

  it('a dose edit changes the dose and nothing else about the medication', () => {
    const { plan: out } = applyPlanEdits(plan(), edits(edit({
      id: 'e1', action: 'EDIT', itemKind: 'medication', target: [{ pathwayId: PW, nodeId: 'med-1' }],
      fields: { frequency: 'every other day' },
    })));
    expect(out.medications[0].recommendation).toMatchObject({ name: 'Ferrous sulfate 325 mg', dose: '325 mg', frequency: 'every other day' });
  });

  it('an edit follows ANY of its nodes: the line still carries it after the merge changes which node is canonical', () => {
    const p = plan();
    p.schedules[0].sourceNodes = [{ pathwayId: PW, nodeId: 'sched-99' }, { pathwayId: PW, nodeId: 'sched-10' }];
    const { applied } = applyPlanEdits(p, edits(edit({
      id: 'e1', action: 'EDIT', itemKind: 'schedule', target: [{ pathwayId: PW, nodeId: 'sched-10' }], fields: { interval: '3 weeks' },
    })));
    expect(applied).toEqual(['e1']);
  });

  it('an edit whose line is gone does not bring it back, and is reported as not applied', () => {
    const p = plan();
    p.guidance = [];
    const { plan: out, applied } = applyPlanEdits(p, edits(edit({
      id: 'e1', action: 'EDIT', itemKind: 'guidance', target: [{ pathwayId: PW, nodeId: 'guid-9' }], fields: { instructions: 'x' },
    })));
    expect(out.guidance).toEqual([]);
    expect(applied).toEqual([]);
  });

  it('an added lab is a line of its own, referenced by the write-in pathway and the edit id', () => {
    const { plan: out, applied } = applyPlanEdits(plan(), edits(edit({
      id: 'a1', action: 'ADD', itemKind: 'lab', fields: { name: 'Reticulocyte count', code: '17849-1', system: 'LOINC' },
    })));
    expect(out.labs).toHaveLength(2);
    expect(out.labs[1]).toMatchObject({
      recommendation: { name: 'Reticulocyte count', code: '17849-1', sourcePathwayId: WRITE_IN, sourceNodeId: 'a1' },
      sourceNodes: [{ pathwayId: WRITE_IN, nodeId: 'a1' }],
      state: 'provider-override',
    });
    expect(applied).toEqual(['a1']);
  });

  it('an addition the pathways already order is not listed twice, and still counts as applying', () => {
    const { plan: out, applied } = applyPlanEdits(plan(), edits(edit({
      id: 'a1', action: 'ADD', itemKind: 'lab', fields: { name: 'CBC', code: '58410-2', system: 'LOINC' },
    })));
    expect(out.labs).toHaveLength(1);
    expect(applied).toEqual(['a1']);
  });

  it('an added medication is NOT appended here — it enters through the write-in safety path', () => {
    const e = edits(edit({ id: 'a1', action: 'ADD', itemKind: 'medication', fields: { name: 'Polyethylene glycol 3350', dose: '17 g' } }));
    expect(applyPlanEdits(plan(), e).plan.medications).toHaveLength(1);
    expect(addedMedications(e)).toEqual([
      expect.objectContaining({
        recommendation: expect.objectContaining({ name: 'Polyethylene glycol 3350', dose: '17 g', sourcePathwayId: WRITE_IN, sourceNodeId: 'a1' }),
        sourcePathwayIds: [WRITE_IN],
      }),
    ]);
  });
});

describe('planEditProblem', () => {
  it('refuses fields the kind does not have, and an edit of a lab', () => {
    expect(planEditProblem('EDIT', 'medication', { name: 'Something else' })).toMatch(/"name" is not a field/);
    expect(planEditProblem('EDIT', 'lab', { name: 'x' })).toMatch(/cannot be edited — remove it and add/);
    expect(planEditProblem('ADD', 'lab', { specimen: 'Serum' })).toMatch(/"name" is required/);
    expect(planEditProblem('EDIT', 'guidance', { instructions: '   ' })).toMatch(/Nothing to change/);
    expect(planEditProblem('EDIT', 'guidance', { instructions: 'ok' })).toBeNull();
  });
});
