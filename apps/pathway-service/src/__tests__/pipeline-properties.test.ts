import * as fc from 'fast-check';
import { canonicalJson } from '../services/resolution/pipeline/canonical';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import { AnswerType, DefaultBehavior, GateAnswer, GateType, NodeStatus, OverrideAction, ProviderOverride } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

type Step = {
  medScore: number; gated: boolean; answer: string; override: string;
  /** Which node the override pins: the medication, or its Step. */
  target: string;
  /** Adds `step REQUIRES prereq`, a prerequisite shared by every step that sets it. */
  requiresShared: boolean;
  drug: string;
};
type Scenario = { steps: Step[]; allergic: boolean };

const arbScenario: fc.Arbitrary<Scenario> = fc.record({
  steps: fc.array(
    fc.record({
      medScore: fc.double({ min: 0, max: 1, noNaN: true }),
      gated: fc.boolean(),
      answer: fc.constantFrom('yes', 'no', 'none'),
      override: fc.constantFrom('none', 'include', 'exclude'),
      target: fc.constantFrom('med', 'step'),
      requiresShared: fc.boolean(),
      // Warfarin interacts SEVERE with both Aspirin and Ibuprofen: a tie in
      // category, so the suppression reason must not depend on partner order.
      drug: fc.constantFrom('Amoxicillin', 'Warfarin', 'Aspirin', 'Ibuprofen', 'Unobtainium'),
    }),
    { minLength: 1, maxLength: 6 },
  ),
  allergic: fc.boolean(),
});

function build(s: Scenario) {
  const nodes = [node('root', 'Pathway'), node('stage', 'Stage')];
  const edges = [edge('root', 'stage')];
  const answers: [string, GateAnswer][] = [];
  const overrides: [string, ProviderOverride][] = [];
  if (s.steps.some((st) => st.requiresShared)) nodes.push(node('prereq', 'LabTest'));
  s.steps.forEach((st, i) => {
    const step = `step-${i}`;
    const med = `med-${i}`;
    nodes.push(node(step, 'Step'), node(med, 'Medication', { name: st.drug, score: st.medScore }));
    edges.push(edge('stage', step));
    if (st.requiresShared) edges.push(edge(step, 'prereq', 'REQUIRES'));
    if (st.gated) {
      const gate = `gate-${i}`;
      nodes.push(node(gate, 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: `q${i}` }));
      edges.push(edge(step, gate), edge(gate, med));
      if (st.answer !== 'none') answers.push([gate, { booleanValue: st.answer === 'yes' }]);
    } else {
      edges.push(edge(step, med));
    }
    if (st.override !== 'none') {
      overrides.push([st.target === 'step' ? step : med, { action: st.override === 'include' ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: st.medScore }]);
    }
  });
  const severe = (mechanism: string) => ({ severity: 'SEVERE' as const, mechanism, clinicalAdvice: null, matchType: 'PAIR' as const, matchedClasses: null });
  const env = makeEnv(nodes, edges, {
    normalized: new Map([
      ['amoxicillin||', { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] }],
      ['warfarin||', { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
      ['aspirin||', { ingredientRxcui: '1191', ingredientName: 'aspirin', atcClasses: ['B01AC06'] }],
      ['ibuprofen||', { ingredientRxcui: '5640', ingredientName: 'ibuprofen', atcClasses: ['M01AE01'] }],
    ]),
    pairs: new Map([['11289|1191', severe('antiplatelet bleeding')], ['11289|5640', severe('NSAID bleeding')]]),
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
const plain: Omit<Step, 'drug'> = { medScore: 0.9, gated: false, answer: 'none', override: 'none', target: 'med', requiresShared: false };

/** Review P2: two overridden Steps share a prerequisite; catch-up provenance must not follow override order. */
const SHARED_PREREQ: Scenario = {
  steps: [0, 1].map(() => ({ ...plain, override: 'include', target: 'step', requiresShared: true, drug: 'Amoxicillin' })),
  allergic: false,
};
/** Sibling of P2: Warfarin is suppressed by two SEVERE partners; the reason must not follow override order. */
const TIED_REASON: Scenario = {
  steps: [
    { ...plain, medScore: 0.1, override: 'include', drug: 'Aspirin' },
    { ...plain, medScore: 0.1, override: 'include', drug: 'Ibuprofen' },
    { ...plain, drug: 'Warfarin' },
  ],
  allergic: false,
};

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
    }), { numRuns: 100, examples: [[SHARED_PREREQ], [TIED_REASON]] });
  });

  it('positive control: an override is actually honoured', async () => {
    const { env, inputsFor } = build({ steps: [{ ...plain, medScore: 0.1, override: 'include', drug: 'Amoxicillin' }], allergic: false });
    const r = await evaluate(inputsFor('forward'), env, replay(), 'ROOT');
    expect(r.resolutionState.get('med-0')!.eligibility).toMatchObject({ status: NodeStatus.INCLUDED, decidedBy: 'override' });
  });

  it('positive control: the pinned examples reach the paths they pin', async () => {
    const shared = await evaluate(build(SHARED_PREREQ).inputsFor('forward'), build(SHARED_PREREQ).env, replay(), 'ROOT');
    expect(shared.catchUpItems).toEqual([expect.objectContaining({ nodeId: 'prereq' })]);

    const tied = build(TIED_REASON);
    const warfarin = (await evaluate(tied.inputsFor('forward'), tied.env, replay(), 'ROOT')).resolutionState.get('med-2')!;
    expect(warfarin.disposition).toMatchObject({ withheldBy: 'safety' });
    expect(warfarin.disposition!.findingIds).toHaveLength(2);
    expect(warfarin.excludeReason).toMatch(/^DDI_SEVERE: recommendation "(Aspirin|Ibuprofen)"/);
  });
});
