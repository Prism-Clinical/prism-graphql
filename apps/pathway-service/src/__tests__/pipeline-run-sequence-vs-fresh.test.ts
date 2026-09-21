/**
 * Spec §5.3 for runs:
 *   (a) edits applied one mutation at a time equal evaluateRun(final inputs);
 *   (b) independent edits in any order give the same run.
 * Plus the multi-pathway reproductions of the 2026-09-13 engine review
 * (§5.2; P3-3): #2, #5, #6 and #7, through the resolvers.
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/multi-pathway-session-store', () => require('./fixtures/resolver-harness').runStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/lattice-collapse', () => require('./fixtures/resolver-harness').latticeMock());

import * as fc from 'fast-check';
import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import type { GraphNode } from '../services/confidence/types';
import { normalizedKey } from '../services/medications/safety-reference';
import { mergeAdditionalContext } from '../services/resolution/effective-context';
import { evaluateRun, newRunRequest, runInputsOf } from '../services/resolution/pipeline/run';
import type { RunInputs } from '../services/resolution/pipeline/run';
import { loadRun } from '../services/resolution/pipeline/run-commit';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const norm = (rxcui: string, name: string, atc: string) => ({ ingredientRxcui: rxcui, ingredientName: name, atcClasses: [atc] });
const WARFARIN_RX = { code: '11289', system: 'RxNorm', display: 'Warfarin' };
const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };
const SAFETY = {
  normalized: new Map([
    ['warfarin||', norm('11289', 'warfarin', 'B01AA03')],
    ['aspirin||', norm('1191', 'aspirin', 'B01AC06')],
    ['amoxicillin||', norm('723', 'amoxicillin', 'J01CA04')],
    ['metoprolol||', norm('6918', 'metoprolol', 'C07AB02')],
    [normalizedKey({ text: 'Warfarin', system: 'RxNorm', code: '11289' }), norm('11289', 'warfarin', 'B01AA03')],
  ]),
  pairs: new Map([['11289|1191', { severity: 'SEVERE' as const, mechanism: 'bleeding', clinicalAdvice: null, matchType: 'PAIR' as const, matchedClasses: null }]]),
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};
const med = (id: string, name: string, extra: Record<string, unknown> = {}) => node(id, 'Medication', { name, role: 'first_line', ...extra });
const question = (id: string) =>
  node(id, 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: `${id}?` });
/** root → gate → step → medications. */
const gated = (gateId: string, meds: GraphNode[]) => makeEnv(
  [node('root', 'Pathway'), question(gateId), node('step', 'Step'), ...meds],
  [edge('root', gateId, 'HAS_GATE'), edge(gateId, 'step', 'BRANCHES_TO', { when: { equals: true } }), ...meds.map((m) => edge('step', m.nodeIdentifier))],
  SAFETY,
);
const plain = (meds: GraphNode[]) =>
  makeEnv([node('root', 'Pathway'), node('step', 'Step'), ...meds], [edge('root', 'step'), ...meds.map((m) => edge('step', m.nodeIdentifier))], SAFETY);

/** Warfarin (behind qa) and Aspirin share a lane and interact; pw-c holds two unrelated drugs behind qc. */
function register(): void {
  harness.addPathway('pw-a', gated('qa', [med('warf', 'Warfarin', { clinical_role: 'anticoag' })]));
  harness.addPathway('pw-b', plain([med('asa', 'Aspirin', { clinical_role: 'anticoag' })]));
  harness.addPathway('pw-c', gated('qc', [med('amox', 'Amoxicillin'), med('meto', 'Metoprolol')]));
}
const PATHWAYS = ['pw-a', 'pw-b', 'pw-c'];
const GATE = { qa: 'pw-a', qc: 'pw-c' } as const;
const TARGET = { warf: 'pw-a', asa: 'pw-b', amox: 'pw-c', meto: 'pw-c' } as const;
const FACT = { allergy: { allergies: [PENICILLIN] }, patientMed: { medications: [WARFARIN_RX] } } as const;
const CHOICE = {
  CONFIRM_A: { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-a' },
  CONFIRM_B: { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-b' },
  ACCEPT_BOTH: { kind: 'ACCEPT_BOTH' },
  REJECT_BOTH: { kind: 'REJECT_BOTH' },
  WRITE_IN: { kind: 'CUSTOM_OVERRIDE', customMedication: { name: 'Amoxicillin' } },
} as const;

const ctx = () => harness.context({ temporalPolicyVersion: 'legacy-v0' });
async function startRun(pathways = PATHWAYS): Promise<string> {
  harness.matchPathways(...pathways);
  const run = await multiPathwayResolutionMutations.startMultiPathwayResolution(null as never, {
    patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED, syntheticPatient: true,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [] },
  } as never, ctx());
  return (run as { id: string }).id;
}
const childOf = (runId: string, pathwayId: string) => {
  const r = harness.run(runId);
  return r.contributingSessionIds[r.contributingPathwayIds.indexOf(pathwayId)];
};
const medsOf = (runId: string) => harness.run(runId).mergedPlan.medications.map((m) => m.recommendation.name).sort();

type Edit =
  | { kind: 'answer'; gate: keyof typeof GATE; value: boolean }
  | { kind: 'override'; node: keyof typeof TARGET; include: boolean }
  | { kind: 'fact'; fact: keyof typeof FACT }
  | { kind: 'choose'; decision: keyof typeof CHOICE };

const answerArb = fc.record({ kind: fc.constant('answer' as const), gate: fc.constantFrom('qa' as const, 'qc' as const), value: fc.boolean() });
const overrideArb = fc.record({ kind: fc.constant('override' as const), node: fc.constantFrom('warf' as const, 'asa' as const, 'amox' as const, 'meto' as const), include: fc.boolean() });
const factArb = fc.record({ kind: fc.constant('fact' as const), fact: fc.constantFrom('allergy' as const, 'patientMed' as const) });
const chooseArb = fc.record({ kind: fc.constant('choose' as const), decision: fc.constantFrom(...(Object.keys(CHOICE) as Array<keyof typeof CHOICE>)) });

/** Apply one edit through its mutation. False when it does not apply (no conflict to decide); skipped on both sides. */
async function applyEdit(runId: string, e: Edit): Promise<boolean> {
  switch (e.kind) {
    case 'answer':
      await resolutionMutations.answerPendingDecision(null, { sessionId: childOf(runId, GATE[e.gate]), nodeId: e.gate, answer: { booleanValue: e.value } }, ctx());
      return true;
    case 'override':
      await resolutionMutations.overrideNode(null, {
        sessionId: childOf(runId, TARGET[e.node]), nodeId: e.node, action: e.include ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE,
      }, ctx());
      return true;
    case 'fact':
      // A fact given on ANY child is the run's (D5); give it on pw-b.
      await resolutionMutations.addPatientContext(null, { sessionId: childOf(runId, 'pw-b'), additionalContext: FACT[e.fact] as never }, ctx());
      return true;
    case 'choose':
      if (!harness.run(runId).mergedPlan.conflicts.some((c) => c.conflictId === 'anticoag')) return false;
      await multiPathwayResolutionMutations.resolveConflict(null, { sessionId: runId, conflictId: 'anticoag', choice: CHOICE[e.decision] } as never, ctx());
      return true;
  }
}

/** The final run inputs, built from the applied edits alone — not from anything a mutation stored. */
function finalInputs(start: RunInputs, applied: Edit[]): RunInputs {
  const inputs: RunInputs = {
    ...start,
    additionalContext: {},
    conflictResolutions: {},
    children: start.children.map((c) => ({ ...c, inputs: { ...c.inputs, gateAnswers: new Map(), providerOverrides: new Map() } })),
  };
  const child = (pathwayId: string) => inputs.children.find((c) => c.pathwayId === pathwayId)!.inputs;
  for (const e of applied) {
    if (e.kind === 'answer') child(GATE[e.gate]).gateAnswers.set(e.gate, { booleanValue: e.value });
    if (e.kind === 'override') {
      child(TARGET[e.node]).providerOverrides.set(e.node, {
        action: e.include ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE,
        // Not part of any hash (spec §1 rule 8); any value will do.
        originalStatus: NodeStatus.UNKNOWN, originalConfidence: 0,
      });
    }
    if (e.kind === 'fact') inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, FACT[e.fact] as never);
    if (e.kind === 'choose') {
      // Who decided and when are not part of the run (spec §1 rule 8).
      inputs.conflictResolutions = { ...inputs.conflictResolutions, anticoag: { ...CHOICE[e.decision], resolvedBy: 'x', resolvedAt: 'y' } as never };
    }
  }
  return inputs;
}

const freshHash = async (inputs: RunInputs) => (await evaluateRun(harness.pool(), newRunRequest(), inputs)).result.resultHash;

beforeEach(() => {
  harness.reset();
  register();
});

describe('property (a) for runs: edits one at a time equal a fresh evaluation of the final inputs (spec §5.3)', () => {
  it('holds for any sequence of answers, overrides, facts and conflict decisions across children', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.oneof(answerArb, overrideArb, factArb, chooseArb), { maxLength: 8 }), async (edits) => {
      harness.reset();
      register();
      const runId = await startRun();
      const start = runInputsOf(await loadRun(harness.pool(), runId));

      const applied: Edit[] = [];
      for (const e of edits) if (await applyEdit(runId, e)) applied.push(e);

      const stored = harness.run(runId).resultHash;
      expect(await freshHash(finalInputs(start, applied))).toBe(stored);
      expect(await freshHash(runInputsOf(await loadRun(harness.pool(), runId)))).toBe(stored);
    }), { numRuns: 30 });
  });

  it('positive control: the edits change the run, so the property is not vacuous', async () => {
    const runId = await startRun();
    const before = harness.run(runId).resultHash;
    await applyEdit(runId, { kind: 'answer', gate: 'qa', value: true });
    expect(harness.run(runId).resultHash).not.toBe(before);
    expect(harness.run(runId).mergedPlan.conflicts.map((c) => c.conflictId)).toEqual(['anticoag']);
    await applyEdit(runId, { kind: 'choose', decision: 'CONFIRM_B' });
    expect(medsOf(runId)).toEqual(['Aspirin']);
  });
});

describe('property (b) for runs: independent edits in any order give the same run (spec §5.3)', () => {
  const keyOf = (e: Edit) => (e.kind === 'answer' ? `a:${e.gate}` : e.kind === 'override' ? `o:${e.node}` : e.kind === 'fact' ? `f:${e.fact}` : 'c');
  const independent = fc.uniqueArray(fc.oneof(answerArb, overrideArb, factArb), { selector: keyOf, maxLength: 6 });
  const twoOrders = independent.chain((edits) =>
    fc.tuple(fc.constant(edits as Edit[]), fc.shuffledSubarray(edits as Edit[], { minLength: edits.length, maxLength: edits.length })));
  const overrideAmox: Edit = { kind: 'override', node: 'amox', include: true };
  const overrideMeto: Edit = { kind: 'override', node: 'meto', include: true };

  it('holds, including two overrides in one pathway recorded in either order (P4-4)', async () => {
    await fc.assert(fc.asyncProperty(twoOrders, async ([one, two]) => {
      harness.reset();
      register();
      const a = await startRun();
      for (const e of one) await applyEdit(a, e);
      const b = await startRun();
      for (const e of two) await applyEdit(b, e);
      expect(harness.run(b).resultHash).toBe(harness.run(a).resultHash);
    }), { numRuns: 25, examples: [[[[overrideAmox, overrideMeto], [overrideMeto, overrideAmox]]]] });
  });
});

describe('review reproductions, end to end (spec §5.2)', () => {
  it('#2 — generation refuses a pending child, and needs no re-merge once it is answered', async () => {
    const runId = await startRun(['pw-c']);
    const blocked = await multiPathwayResolutionMutations.generateMergedCarePlan(null, { sessionId: runId, reviewedResultHash: harness.run(runId).resultHash }, ctx());
    expect(blocked.blockers).toContainEqual(expect.objectContaining({ type: 'PENDING_GATE', pathwayId: 'pw-c' }));

    await applyEdit(runId, { kind: 'answer', gate: 'qc', value: true });
    expect(medsOf(runId)).toEqual(['Amoxicillin', 'Metoprolol']);
    const generated = await multiPathwayResolutionMutations.generateMergedCarePlan(null, { sessionId: runId, reviewedResultHash: harness.run(runId).resultHash }, ctx());
    expect(generated.success).toBe(true);
  });

  it('#5 — two pathways’ `med-1` are different drugs, and only the interacting one is withheld', async () => {
    harness.addPathway('pw-x', plain([med('med-1', 'Warfarin')]));
    harness.addPathway('pw-y', plain([med('med-1', 'Amoxicillin')]));
    harness.addPathway('pw-z', plain([med('med-2', 'Aspirin')]));
    const runId = await startRun(['pw-x', 'pw-y', 'pw-z']);
    expect(medsOf(runId)).toEqual(['Amoxicillin']);
  });

  it('#6 — choosing A, then B, leaves only B', async () => {
    const runId = await startRun();
    await applyEdit(runId, { kind: 'answer', gate: 'qa', value: true });
    await applyEdit(runId, { kind: 'choose', decision: 'CONFIRM_A' });
    await applyEdit(runId, { kind: 'choose', decision: 'CONFIRM_B' });
    expect(medsOf(runId)).toEqual(['Aspirin']);
  });

  it('#7 — accepting both conflict candidates checks them together; a write-in is checked too', async () => {
    const runId = await startRun();
    await applyEdit(runId, { kind: 'answer', gate: 'qa', value: true });
    await applyEdit(runId, { kind: 'choose', decision: 'ACCEPT_BOTH' });
    expect(medsOf(runId)).toEqual([]);
    expect(harness.run(runId).mergedPlan.suppressed.map((s) => s.name).sort()).toEqual(['Aspirin', 'Warfarin']);

    await applyEdit(runId, { kind: 'fact', fact: 'allergy' });
    await applyEdit(runId, { kind: 'choose', decision: 'WRITE_IN' });
    expect(harness.run(runId).mergedPlan.suppressed).toContainEqual(expect.objectContaining({ name: 'Amoxicillin', reason: 'allergy' }));
  });
});
