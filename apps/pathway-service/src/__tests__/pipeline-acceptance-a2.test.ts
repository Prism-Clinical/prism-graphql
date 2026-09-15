import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import { DefaultBehavior, GateType, NodeStatus } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const nodes = [
  node('root', 'Pathway'), node('stage', 'Stage'), node('step', 'Step'),
  node('med-amox', 'Medication', { name: 'Amoxicillin' }),
  node('gate-dep', 'Gate', { gate_type: GateType.PRIOR_NODE_RESULT, default_behavior: DefaultBehavior.SKIP, depends_on: [{ node_id: 'step', status: 'INCLUDED' }] }),
  node('lab', 'LabTest'),
];
const edges = [edge('root', 'stage'), edge('stage', 'step'), edge('step', 'med-amox'), edge('step', 'gate-dep'), edge('gate-dep', 'lab')];
const AMOX = { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] };
const penicillinAllergy = { allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }] };
const patient = (allergic: boolean) => ({
  patientId: 'p', conditionCodes: [], medications: [], labResults: [],
  allergies: allergic ? [{ code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' }] : [],
});
const run = async (allergic: boolean, normalized = new Map([['amoxicillin||', AMOX]]), scope: 'ROOT' | 'CONTRIBUTION' = 'ROOT') => {
  const env = makeEnv(nodes, edges, { normalized, ...penicillinAllergy });
  return evaluate(makeInputs(env, { initialPatientContext: patient(allergic) }), env, replayObservations(new Map(), 'test-model'), scope);
};

describe('A2 — eligibility versus disposition (C2)', () => {
  it('a medication suppressed by allergy keeps its eligibility and both explanations', async () => {
    const control = (await run(false)).resolutionState.get('med-amox')!;
    expect(control.disposition!.status).toBe(NodeStatus.INCLUDED);

    const med = (await run(true)).resolutionState.get('med-amox')!;
    expect(med.eligibility).toEqual({ status: NodeStatus.INCLUDED, reason: undefined, decidedBy: 'traversal' });
    expect(med.disposition).toMatchObject({ status: NodeStatus.EXCLUDED, withheldBy: 'safety' });
    expect(med.status).toBe(NodeStatus.EXCLUDED);
    expect(med.excludeReason).toContain('ALLERGY');
  });

  it('a prior_node_result gate on a Step is unaffected by suppression', async () => {
    for (const allergic of [false, true]) {
      const r = await run(allergic);
      expect(r.resolutionState.get('gate-dep')!.status).toBe(NodeStatus.INCLUDED);
      expect(r.resolutionState.get('lab')!.status).toBe(NodeStatus.INCLUDED);
    }
  });

  it('an unnormalised medication blocks with SAFETY_DATA_UNAVAILABLE; normalising it clears the blocker (D14)', async () => {
    const blocked = await run(false, new Map());
    expect(blocked.readiness.blockers).toContainEqual(expect.objectContaining({ type: 'SAFETY_DATA_UNAVAILABLE', relatedNodeIds: ['med-amox'] }));
    expect((await run(false)).readiness.blockers.map((b) => b.type)).not.toContain('SAFETY_DATA_UNAVAILABLE');
  });
});

describe('scope (C3)', () => {
  const pairNodes = [node('root', 'Pathway'), node('step', 'Step'), node('w', 'Medication', { name: 'Warfarin' }), node('a', 'Medication', { name: 'Aspirin' })];
  const pairEdges = [edge('root', 'step'), edge('step', 'w'), edge('step', 'a')];
  const safety = {
    normalized: new Map([
      ['warfarin||', { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
      ['aspirin||', { ingredientRxcui: '1191', ingredientName: 'aspirin', atcClasses: ['B01AC06'] }],
    ]),
    pairs: new Map([['11289|1191', { severity: 'SEVERE' as const, mechanism: 'bleeding', clinicalAdvice: null, matchType: 'PAIR' as const, matchedClasses: null }]]),
  };

  it('pair safety runs at ROOT only', async () => {
    const env = makeEnv(pairNodes, pairEdges, safety);
    const root = await evaluate(makeInputs(env), env, replayObservations(new Map(), 'test-model'), 'ROOT');
    const child = await evaluate(makeInputs(env), env, replayObservations(new Map(), 'test-model'), 'CONTRIBUTION');

    expect(root.resolutionState.get('w')!.disposition!.withheldBy).toBe('safety');
    expect(root.readiness.blockers.map((b) => b.type)).toContain('EMPTY_PLAN');
    expect(child.resolutionState.get('w')!.disposition!.status).toBe(NodeStatus.INCLUDED);
    expect(child.readiness.blockers.map((b) => b.type)).not.toContain('EMPTY_PLAN');
  });
});
