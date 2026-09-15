import * as fc from 'fast-check';
import { canonicalJson } from '../services/resolution/pipeline/canonical';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import { AnswerType, DefaultBehavior, GateAnswer, GateType, NodeStatus, OverrideAction, ProviderOverride } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const arbScenario = fc.record({
  steps: fc.array(
    fc.record({
      medScore: fc.double({ min: 0, max: 1, noNaN: true }),
      gated: fc.boolean(),
      answer: fc.constantFrom('yes', 'no', 'none'),
      override: fc.constantFrom('none', 'include', 'exclude'),
      drug: fc.constantFrom('Amoxicillin', 'Warfarin', 'Unobtainium'),
    }),
    { minLength: 1, maxLength: 6 },
  ),
  allergic: fc.boolean(),
});

type Scenario = { steps: { medScore: number; gated: boolean; answer: string; override: string; drug: string }[]; allergic: boolean };

function build(s: Scenario) {
  const nodes = [node('root', 'Pathway'), node('stage', 'Stage')];
  const edges = [edge('root', 'stage')];
  const answers: [string, GateAnswer][] = [];
  const overrides: [string, ProviderOverride][] = [];
  s.steps.forEach((st, i) => {
    const step = `step-${i}`;
    const med = `med-${i}`;
    nodes.push(node(step, 'Step'), node(med, 'Medication', { name: st.drug, score: st.medScore }));
    edges.push(edge('stage', step));
    if (st.gated) {
      const gate = `gate-${i}`;
      nodes.push(node(gate, 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: `q${i}` }));
      edges.push(edge(step, gate), edge(gate, med));
      if (st.answer !== 'none') answers.push([gate, { booleanValue: st.answer === 'yes' }]);
    } else {
      edges.push(edge(step, med));
    }
    if (st.override !== 'none') {
      overrides.push([med, { action: st.override === 'include' ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: st.medScore }]);
    }
  });
  const env = makeEnv(nodes, edges, {
    normalized: new Map([
      ['amoxicillin||', { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] }],
      ['warfarin||', { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
    ]),
    allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
  });
  const patient = {
    patientId: 'p', conditionCodes: [], medications: [], labResults: [],
    allergies: s.allergic ? [{ code: '91936005', system: 'SNOMED' }] : [],
  };
  const inputsFor = (order: 'forward' | 'reverse') => {
    const o = <T>(xs: T[]) => (order === 'forward' ? xs : [...xs].reverse());
    return makeInputs(env, { initialPatientContext: patient, gateAnswers: new Map(o(answers)), providerOverrides: new Map(o(overrides)) });
  };
  return { env, inputsFor };
}

const replay = () => replayObservations(new Map(), 'test-model');

describe('pipeline properties (spec §5.3)', () => {
  it('(c) determinism: evaluating the same inputs twice is identical', async () => {
    await fc.assert(fc.asyncProperty(arbScenario, async (s) => {
      const { env, inputsFor } = build(s);
      const a = await evaluate(inputsFor('forward'), env, replay(), 'ROOT');
      const b = await evaluate(inputsFor('forward'), env, replay(), 'ROOT');
      expect(canonicalJson(b)).toBe(canonicalJson(a));
      expect(b.resultHash).toBe(a.resultHash);
    }), { numRuns: 100 });
  });

  it('(b) order independence: input map insertion order does not change the result', async () => {
    await fc.assert(fc.asyncProperty(arbScenario, async (s) => {
      const { env, inputsFor } = build(s);
      const a = await evaluate(inputsFor('forward'), env, replay(), 'ROOT');
      const b = await evaluate(inputsFor('reverse'), env, replay(), 'ROOT');
      expect(b.resultHash).toBe(a.resultHash);
    }), { numRuns: 100 });
  });

  it('positive control: an override is actually honoured', async () => {
    const { env, inputsFor } = build({ steps: [{ medScore: 0.1, gated: false, answer: 'none', override: 'include', drug: 'Amoxicillin' }], allergic: false });
    const r = await evaluate(inputsFor('forward'), env, replay(), 'ROOT');
    expect(r.resolutionState.get('med-0')!.eligibility).toMatchObject({ status: NodeStatus.INCLUDED, decidedBy: 'override' });
  });
});
