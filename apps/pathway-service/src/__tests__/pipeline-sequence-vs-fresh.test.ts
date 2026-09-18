/**
 * Spec §5.3 property (a): applying edits one mutation at a time equals
 * evaluate(final inputs). Plus the single-pathway reproductions of the
 * 2026-09-13 engine review (§5.2; P3-3): #1 and #3 must pass, #9 and #10 are
 * pinned as documented defects.
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());

import * as fc from 'fast-check';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { ScorerRegistry } from '../services/confidence/scorer-registry';
import { GraphNode, ScoringType, SignalDefinition } from '../services/confidence/types';
import { normalizedKey } from '../services/medications/safety-reference';
import { mergeAdditionalContext } from '../services/resolution/effective-context';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import type { SessionInputs } from '../services/resolution/pipeline/types';
import { inputsOf } from '../services/resolution/session-store';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const replay = () => replayObservations(new Map(), 'test-model');
const ctx = (version = 'legacy-v0') => harness.context({ temporalPolicyVersion: version });

async function start(pathwayId: string, patient: Record<string, unknown> = {}, version = 'legacy-v0', extra: Record<string, unknown> = {}) {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId, patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
    ...extra,
  } as never, ctx(version));
  return (s as { id: string }).id;
}

/** Re-evaluating what the session stores must give what the session cached. */
async function freshHashOfStored(id: string, env: ReturnType<typeof makeEnv>) {
  return (await evaluate(inputsOf(harness.session(id)), env, replay(), 'ROOT')).resultHash;
}

// ─── Property (a) ──────────────────────────────────────────────────────

const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };
const WARFARIN_RX = { code: '11289', system: 'RxNorm', display: 'Warfarin' };
const MYSTERY_RX = { code: '999', system: 'RxNorm', display: 'Mysterydrug' };
const DRUGS = ['Amoxicillin', 'Warfarin', 'Aspirin'];

/** stage → step-i → gate-i (question) → med-i, for three steps. */
const PROPERTY_ENV = makeEnv(
  [
    node('root', 'Pathway'), node('stage', 'Stage'),
    ...DRUGS.flatMap((drug, i) => [
      node(`step-${i}`, 'Step'),
      node(`gate-${i}`, 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: `q${i}` }),
      node(`med-${i}`, 'Medication', { name: drug }),
    ]),
  ],
  [
    edge('root', 'stage'),
    ...DRUGS.flatMap((_, i) => [edge('stage', `step-${i}`), edge(`step-${i}`, `gate-${i}`), edge(`gate-${i}`, `med-${i}`)]),
  ],
  {
    normalized: new Map([
      ['amoxicillin||', { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] }],
      ['warfarin||', { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
      ['aspirin||', { ingredientRxcui: '1191', ingredientName: 'aspirin', atcClasses: ['B01AC06'] }],
      [normalizedKey({ text: 'Warfarin', system: 'RxNorm', code: '11289' }), { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
    ]),
    pairs: new Map([['11289|1191', { severity: 'SEVERE' as const, mechanism: 'bleeding', clinicalAdvice: null, matchType: 'PAIR' as const, matchedClasses: null }]]),
    allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
  },
);

type Edit =
  | { kind: 'answer'; i: number; value: boolean }
  | { kind: 'override'; i: number; onStep: boolean; include: boolean }
  | { kind: 'allergy' }
  | { kind: 'patientMed'; unmapped: boolean };

const arbEdit: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant('answer' as const), i: fc.nat(2), value: fc.boolean() }),
  fc.record({ kind: fc.constant('override' as const), i: fc.nat(2), onStep: fc.boolean(), include: fc.boolean() }),
  fc.record({ kind: fc.constant('allergy' as const) }),
  fc.record({ kind: fc.constant('patientMed' as const), unmapped: fc.boolean() }),
);

/** Apply one edit through its mutation. Returns false when the target is not in the cached state (skipped on both sides). */
async function applyEdit(id: string, e: Edit): Promise<boolean> {
  switch (e.kind) {
    case 'answer':
      await resolutionMutations.answerPendingDecision(null, { sessionId: id, nodeId: `gate-${e.i}`, answer: { booleanValue: e.value } }, ctx());
      return true;
    case 'override': {
      const target = e.onStep ? `step-${e.i}` : `med-${e.i}`;
      if (!harness.session(id).resolutionState.has(target)) return false;
      await resolutionMutations.overrideNode(null, { sessionId: id, nodeId: target, action: e.include ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE }, ctx());
      return true;
    }
    case 'allergy':
      await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { allergies: [PENICILLIN] } }, ctx());
      return true;
    case 'patientMed':
      await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { medications: [e.unmapped ? MYSTERY_RX : WARFARIN_RX] } }, ctx());
      return true;
  }
}

/** The final inputs, built from the applied edits alone — not from anything a mutation stored. */
function finalInputs(start: SessionInputs, applied: Edit[]): SessionInputs {
  const inputs: SessionInputs = { ...start, gateAnswers: new Map(), providerOverrides: new Map(), additionalContext: {} };
  for (const e of applied) {
    if (e.kind === 'answer') inputs.gateAnswers.set(`gate-${e.i}`, { booleanValue: e.value });
    if (e.kind === 'override') {
      inputs.providerOverrides.set(e.onStep ? `step-${e.i}` : `med-${e.i}`, {
        action: e.include ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE,
        // Not part of resultHash (spec §1 rule 8); any value will do.
        originalStatus: NodeStatus.UNKNOWN, originalConfidence: 0,
      });
    }
    if (e.kind === 'allergy') inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, { allergies: [PENICILLIN] });
    if (e.kind === 'patientMed') inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, { medications: [e.unmapped ? MYSTERY_RX : WARFARIN_RX] });
  }
  return inputs;
}

beforeEach(() => harness.reset());

describe('property (a): edits one at a time equal a fresh evaluation of the final inputs (spec §5.3)', () => {
  it('holds for any sequence of answers, re-answers, overrides, facts', async () => {
    await fc.assert(fc.asyncProperty(fc.array(arbEdit, { maxLength: 8 }), async (edits) => {
      harness.reset();
      harness.addPathway('pw-prop', PROPERTY_ENV);
      const id = await start('pw-prop');
      const startInputs = inputsOf(harness.session(id));

      const applied: Edit[] = [];
      for (const e of edits) if (await applyEdit(id, e)) applied.push(e);

      const stored = harness.session(id).resultHash;
      const fresh = await evaluate(finalInputs(startInputs, applied), PROPERTY_ENV, replay(), 'ROOT');
      expect(stored).toBe(fresh.resultHash);
      expect(await freshHashOfStored(id, PROPERTY_ENV)).toBe(stored);
    }), { numRuns: 30 });
  });

  it('positive control: the edits change the plan, so the property is not vacuous', async () => {
    harness.addPathway('pw-prop', PROPERTY_ENV);
    const id = await start('pw-prop');
    const before = harness.session(id).resultHash;
    await applyEdit(id, { kind: 'answer', i: 0, value: true });
    expect(harness.session(id).resultHash).not.toBe(before);
    await applyEdit(id, { kind: 'allergy' });
    expect(harness.session(id).resolutionState.get('med-0')!.disposition).toMatchObject({ withheldBy: 'safety' });
  });
});

// ─── Review reproductions (spec §5.2) ──────────────────────────────────

describe('review #1 — a nested gate cannot reopen under a closed ancestor (must pass)', () => {
  const NESTED = makeEnv(
    [
      node('root', 'Pathway'),
      node('outer', 'Gate', { gate_type: GateType.QUESTION, answer_type: AnswerType.BOOLEAN, default_behavior: DefaultBehavior.SKIP, prompt: 'Outer?' }),
      node('step', 'Step'),
      node('inner', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 } }),
      node('med', 'Medication', { name: 'Amoxicillin' }),
    ],
    [edge('root', 'outer'), edge('outer', 'step'), edge('step', 'inner'), edge('inner', 'med')],
    { normalized: new Map([['amoxicillin||', { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] }]]) },
  );

  it('outer yes, then no, then a context update: the medication stays out, and equals a fresh evaluation', async () => {
    harness.addPathway('pw-nested', NESTED);
    const id = await start('pw-nested', { labResults: [{ code: '718-7', system: 'LOINC', value: 6 }] });

    await resolutionMutations.answerPendingDecision(null, { sessionId: id, nodeId: 'outer', answer: { booleanValue: true } }, ctx());
    expect(harness.session(id).resolutionState.get('med')!.status).toBe(NodeStatus.INCLUDED);

    await resolutionMutations.answerPendingDecision(null, { sessionId: id, nodeId: 'outer', answer: { booleanValue: false } }, ctx());
    // The context update is what re-seeded the inner gate on main and reopened the medication.
    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { labResults: [{ code: '718-7', system: 'LOINC', value: 6.5, date: '2026-08-29' }] } }, ctx());

    expect(harness.session(id).resolutionState.get('outer')!.status).toBe(NodeStatus.GATED_OUT);
    expect(harness.session(id).resolutionState.get('med')!.status).not.toBe(NodeStatus.INCLUDED);
    expect(await freshHashOfStored(id, NESTED)).toBe(harness.session(id).resultHash);
  });
});

describe('review #3 — traversal uses whole-graph confidence propagation (must pass)', () => {
  it('a Step fed by a weak lab scores 0.3 × 0.8 = 0.24, not its own 0.9', async () => {
    const signal: SignalDefinition = {
      id: '00000000-0000-4000-a000-000000000001', name: 'data_completeness', displayName: 'Data Completeness', description: '',
      scoringType: ScoringType.DATA_PRESENCE, scoringRules: {},
      propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
      scope: 'SYSTEM', defaultWeight: 1, isActive: true,
    };
    const registry = new ScorerRegistry();
    registry.register({
      scoringType: ScoringType.DATA_PRESENCE,
      declareRequiredInputs: () => [],
      score: ({ node: n }: { node: GraphNode }) =>
        n.nodeIdentifier === 'lab-1' ? { score: 0.3, missingInputs: ['result_value'] } : { score: 0.9, missingInputs: [] },
      propagate: ({ sourceScore, hopDistance, propagationConfig }: { sourceScore: number; hopDistance: number; propagationConfig: { decayFactor?: number } }) => ({
        propagatedScore: sourceScore * Math.pow(propagationConfig.decayFactor ?? 0.8, hopDistance),
        shouldPropagate: true,
      }),
    } as never);
    // lab-1 is not on the walk; it is scored because scoring is whole-graph (spec §2 stage 2).
    const env = makeEnv(
      [node('root', 'Pathway'), node('lab-1', 'LabTest'), node('step-1', 'Step')],
      [edge('root', 'step-1'), edge('lab-1', 'step-1', 'HAS_LAB_TEST')],
      {},
      { signals: [signal], registry },
    );

    const r = await evaluate(makeInputs(env), env, replay(), 'ROOT');
    expect(r.resolutionState.get('step-1')!.confidence).toBeCloseTo(0.24, 2);
  });
});

describe('review #9 — a shared downstream action through the selected arm (PINNED DEFECT)', () => {
  // Out of scope (spec, Out of scope): first-writer-wins across reconverging
  // branches stays, now deterministic. This pins today's behaviour so a change
  // is noticed. If it starts failing because `shared` is INCLUDED, #9 has been
  // fixed: flip the assertion and say so in the commit.
  it('excluding arm b sweeps the shared medication before arm a reaches it', async () => {
    const env = makeEnv(
      [
        node('root', 'Pathway'),
        node('q', 'Gate', { gate_type: GateType.QUESTION, answer_type: AnswerType.SELECT, options: ['a', 'b'], default_behavior: DefaultBehavior.SKIP, prompt: 'Which?' }),
        node('a', 'Step'), node('b', 'Step'), node('shared', 'Medication', { name: 'Amoxicillin' }),
      ],
      [
        edge('root', 'q'),
        edge('q', 'a', 'BRANCHES_TO', { when: { equals: 'a' } }), edge('q', 'b', 'BRANCHES_TO', { when: { equals: 'b' } }),
        edge('a', 'shared'), edge('b', 'shared'),
      ],
    );
    const r = await evaluate(makeInputs(env, { gateAnswers: new Map([['q', { selectedOption: 'a' }]]) }), env, replay(), 'ROOT');
    expect(r.resolutionState.get('a')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('shared')!.status).toBe(NodeStatus.EXCLUDED);
  });
});

describe('review #10 — a vital answer does not reach the gate that asked (PINNED DEFECT)', () => {
  // Out of scope (spec, Out of scope #10): the answer is stored under the flat
  // key "vitals.systolic_bp" while evaluation reads "systolic_bp". Pinned so a
  // fix is noticed; flip both assertions when it lands.
  it('stores the answer under the namespaced key and leaves the gate pending', async () => {
    harness.addPathway('pw-bp', makeEnv(
      [
        node('root', 'Pathway'),
        node('bp', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
          condition: { attribute: 'vitals.systolic_bp', operator: 'greater_than', value: 160 } }),
        node('step', 'Step'),
      ],
      [edge('root', 'bp'), edge('bp', 'step')],
    ));
    const id = await start('pw-bp', {}, 'v1', { encounterStart: '2026-08-30T08:00:00.000Z' });
    expect(harness.session(id).pendingQuestions[0].gateId).toBe('bp');

    await resolutionMutations.answerPendingDecision(null, { sessionId: id, nodeId: 'bp', answer: { numericValue: 180 } }, ctx('v1'));

    const s = harness.session(id);
    expect((s.additionalContext as { vitalSigns: Record<string, unknown> }).vitalSigns).toEqual({ 'vitals.systolic_bp': 180 });
    expect(s.resolutionState.get('bp')!.status).toBe(NodeStatus.PENDING_QUESTION);
  });
});
