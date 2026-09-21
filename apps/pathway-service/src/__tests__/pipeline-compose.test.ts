import { normalizedKey } from '../services/medications/safety-reference';
import { composeRun, runHashOf } from '../services/resolution/pipeline/compose';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import type { SessionInputs } from '../services/resolution/pipeline/types';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction } from '../services/resolution/types';
import type { GraphNode } from '../services/confidence/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const norm = (rxcui: string, name: string, atc: string) => ({ ingredientRxcui: rxcui, ingredientName: name, atcClasses: [atc] });
const SAFETY = {
  normalized: new Map([
    ['amoxicillin||', norm('723', 'amoxicillin', 'J01CA04')],
    ['azithromycin||', norm('18631', 'azithromycin', 'J01FA10')],
    ['warfarin||', norm('11289', 'warfarin', 'B01AA03')],
    ['aspirin||', norm('1191', 'aspirin', 'B01AC06')],
    ['metoprolol||', norm('6918', 'metoprolol', 'C07AB02')],
    ['carvedilol||', norm('20352', 'carvedilol', 'C07AG02')],
    [normalizedKey({ text: 'Warfarin', system: 'RxNorm', code: '11289' }), norm('11289', 'warfarin', 'B01AA03')],
  ]),
  pairs: new Map([['11289|1191', { severity: 'SEVERE' as const, mechanism: 'bleeding', clinicalAdvice: null, matchType: 'PAIR' as const, matchedClasses: null }]]),
  classRules: [],
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};
const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };
const WARFARIN_RX = { code: '11289', system: 'RxNorm', display: 'Warfarin' };
/** The run's reference with the Warfarin–Aspirin pair at another severity, or absent. */
const pairAt = (severity: 'MODERATE' | null) => ({
  ...SAFETY,
  pairs: new Map(severity ? [['11289|1191', { ...SAFETY.pairs.get('11289|1191')!, severity }]] : []),
});
const PATIENT = (extra: Record<string, unknown> = {}) =>
  ({ patientId: 'pt', conditionCodes: [], medications: [], labResults: [], allergies: [], ...extra }) as never;

/** A medication the merge projects: it needs a `role`. */
const med = (id: string, name: string, extra: Record<string, unknown> = {}) => node(id, 'Medication', { name, role: 'first_line', ...extra });
/** root → step → each medication. */
const pathway = (meds: GraphNode[]) =>
  makeEnv([node('root', 'Pathway'), node('step', 'Step'), ...meds], [edge('root', 'step'), ...meds.map((m) => edge('step', m.nodeIdentifier))], SAFETY);
/** An unanswered question in front of a medication. */
const GATED = makeEnv(
  [
    node('root', 'Pathway'),
    node('q', 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'Symptomatic?' }),
    node('step', 'Step'), med('m', 'Amoxicillin'),
  ],
  [edge('root', 'q', 'HAS_GATE'), edge('q', 'step', 'BRANCHES_TO', { when: { equals: true } }), edge('step', 'm')],
  SAFETY,
);

async function contribution(pathwayId: string, env: ReturnType<typeof makeEnv>, patch: Partial<SessionInputs> = {}, patient = PATIENT()) {
  const inputs = makeInputs(env, { pathwayId, initialPatientContext: patient, ...patch });
  const result = await evaluate(inputs, env, replayObservations(new Map(), 'test-model'), 'CONTRIBUTION');
  return { pathwayId, sessionId: `s-${pathwayId}`, result };
}
type C = Awaited<ReturnType<typeof contribution>>;
const compose = (cs: C[], decisions: Record<string, unknown> = {}, patient = PATIENT(), safety: unknown = SAFETY) =>
  composeRun(cs, {
    patient,
    conflictResolutions: decisions as never,
    safety: safety as never,
    meta: new Map(cs.map((c) => [c.pathwayId, { logicalId: `lp-${c.pathwayId}`, title: `Pathway ${c.pathwayId}`, version: '1' }])),
    envFingerprint: 'env-run',
  });
const decide = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, resolvedBy: 'pr', resolvedAt: '2026-09-19T00:00:00.000Z', ...extra });
const names = (r: ReturnType<typeof compose>) => r.mergedPlan.medications.map((m) => m.recommendation.name).sort();
const node0 = (r: ReturnType<typeof compose>, child: number, id: string) => r.children[child].result.resolutionState.get(id)!;

describe('A3 — composition (C3)', () => {
  it('a child with nothing to recommend does not block a child with a plan', async () => {
    const empty = await contribution('pw-x', pathway([]));
    const useful = await contribution('pw-y', pathway([med('m', 'Amoxicillin')]));
    const r = compose([empty, useful]);
    expect(r.readiness).toEqual({ ready: true, blockers: [] });
    expect(names(r)).toEqual(['Amoxicillin']);
    // Control: the root does check emptiness.
    expect(compose([empty]).readiness.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'EMPTY_PLAN' })]);
  });

  it('a child’s pending gate blocks the run, tagged with its pathway', async () => {
    const r = compose([await contribution('pw-g', GATED), await contribution('pw-y', pathway([med('m', 'Aspirin')]))]);
    expect(r.readiness.ready).toBe(false);
    expect(r.readiness.blockers).toEqual([
      expect.objectContaining({ scope: 'COMPLETENESS', type: 'PENDING_GATE', relatedNodeIds: ['q'], pathwayId: 'pw-g' }),
    ]);
  });

  describe('A and B from different children interact', () => {
    const A = () => contribution('pw-a', pathway([med('a', 'Warfarin', { clinical_role: 'anticoagulant' })]));
    const B = () => contribution('pw-b', pathway([med('b', 'Aspirin', { clinical_role: 'anticoagulant' })]));

    it('undecided, the conflict blocks and neither drug reaches the plan', async () => {
      const r = compose([await A(), await B()]);
      expect(names(r)).toEqual([]);
      expect(r.readiness.blockers).toContainEqual(expect.objectContaining({ scope: 'OUTPUT', type: 'UNRESOLVED_CONFLICT', relatedNodeIds: ['a', 'b'] }));
      expect(r.safetyFindings).toEqual([]);
    });

    it('choosing B withholds A and produces no pair finding', async () => {
      const r = compose([await A(), await B()], { anticoagulant: decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-b' }) });
      expect(names(r)).toEqual(['Aspirin']);
      expect(r.mergedPlan.medications[0].state).toBe('provider-confirmed');
      expect(r.safetyFindings.filter((f) => f.scope === 'SET')).toEqual([]);
      expect(node0(r, 0, 'a').eligibility).toMatchObject({ status: NodeStatus.INCLUDED });
      expect(node0(r, 0, 'a').disposition).toMatchObject({ status: NodeStatus.EXCLUDED, withheldBy: 'conflict', findingIds: ['anticoagulant'] });
      expect(r.readiness.ready).toBe(true);
    });

    it('accepting both surfaces the pair at the root and withholds both (control)', async () => {
      const r = compose([await A(), await B()], { anticoagulant: decide('ACCEPT_BOTH') });
      expect(names(r)).toEqual([]);
      expect(r.safetyFindings.filter((f) => f.scope === 'SET').map((f) => f.recommendationId).sort()).toEqual(['pw-a|a', 'pw-b|b']);
      expect(node0(r, 1, 'b').disposition).toMatchObject({ withheldBy: 'safety' });
    });
  });

  it('a patient-allergy suppression of A persists whatever is chosen', async () => {
    const patient = PATIENT({ allergies: [PENICILLIN] });
    const amox = await contribution('pw-a', pathway([med('a', 'Amoxicillin', { clinical_role: 'antibiotic' })]), {}, patient);
    const azith = await contribution('pw-b', pathway([med('b', 'Azithromycin', { clinical_role: 'antibiotic' })]), {}, patient);
    for (const decisions of [{}, { antibiotic: decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-a' }) }]) {
      const r = compose([amox, azith], decisions, patient);
      expect(names(r)).toEqual(['Azithromycin']);
      expect(r.mergedPlan.suppressed).toContainEqual(expect.objectContaining({ name: 'Amoxicillin', reason: 'allergy' }));
      expect(node0(r, 0, 'a').disposition).toMatchObject({ withheldBy: 'safety' });
    }
  });
});

it('pathway-local node ids do not alias across children (review #5)', async () => {
  const r = compose([
    await contribution('pw-a', pathway([med('med-1', 'Warfarin')])),
    await contribution('pw-b', pathway([med('med-1', 'Amoxicillin')])),
    await contribution('pw-c', pathway([med('med-2', 'Aspirin')])),
  ]);
  expect(names(r)).toEqual(['Amoxicillin']);
  expect(r.safetyFindings.map((f) => f.recommendationId).sort()).toEqual(['pw-a|med-1', 'pw-c|med-2']);
  expect(node0(r, 1, 'med-1').status).toBe(NodeStatus.INCLUDED);
  expect(node0(r, 0, 'med-1').disposition).toMatchObject({ withheldBy: 'safety' });
});

describe('conflict decisions (review #6)', () => {
  const lane = async (patient = PATIENT()) => [
    await contribution('pw-a', pathway([med('a', 'Metoprolol', { clinical_role: 'beta_blocker' })]), {}, patient),
    await contribution('pw-b', pathway([med('b', 'Carvedilol', { clinical_role: 'beta_blocker' })]), {}, patient),
  ];

  it('A, then B, then both, then neither: each choice replaces the last', async () => {
    const cs = await lane();
    const pick = (d: unknown) => names(compose(cs, { beta_blocker: d }));
    expect(pick(decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-a' }))).toEqual(['Metoprolol']);
    expect(pick(decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-b' }))).toEqual(['Carvedilol']);
    expect(pick(decide('ACCEPT_BOTH'))).toEqual(['Carvedilol', 'Metoprolol']);
    expect(pick(decide('REJECT_BOTH'))).toEqual([]);
  });

  it('the same decision twice gives the same run', async () => {
    const cs = await lane();
    const d = { beta_blocker: decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-a' }) };
    expect(compose(cs, d).resultHash).toBe(compose(cs, d).resultHash);
    expect(compose(cs, d).mergedPlan.medications).toHaveLength(1);
  });

  it('who decided, and when, is not part of the reviewed plan', async () => {
    const cs = await lane();
    const at = (resolvedAt: string) =>
      compose(cs, { beta_blocker: { ...decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-a' }), resolvedAt } }).resultHash;
    expect(at('2026-01-01T00:00:00.000Z')).toBe(at('2026-02-02T00:00:00.000Z'));
  });

  it('a decision naming a pathway that no longer proposes a candidate is a blocker, not a crash', async () => {
    const r = compose(await lane(), { beta_blocker: decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-gone' }) });
    expect(r.readiness.blockers).toContainEqual(expect.objectContaining({ scope: 'OUTPUT', type: 'STALE_CONFLICT_DECISION' }));
    expect(r.mergedPlan.conflicts[0].resolution).toBeNull();
    expect(names(r)).toEqual([]);
  });

  it('a decision for a conflict that no longer exists is inert', async () => {
    const cs = [await contribution('pw-y', pathway([med('m', 'Aspirin')]))];
    expect(compose(cs, { gone: decide('REJECT_BOTH') }).resultHash).toBe(compose(cs).resultHash);
  });

  describe('safety runs over the final set (review #7)', () => {
    const writeIn = (name: string) => ({ beta_blocker: decide('CUSTOM_OVERRIDE', { customMedication: { name } }) });

    it('a write-in is checked against the patient', async () => {
      const patient = PATIENT({ allergies: [PENICILLIN] });
      const r = compose(await lane(patient), writeIn('Amoxicillin'), patient);
      expect(names(r)).toEqual([]);
      expect(r.safetyFindings).toContainEqual(expect.objectContaining({
        scope: 'PATIENT', category: 'ALLERGY', recommendationId: 'provider-override|Amoxicillin',
      }));
      expect(r.mergedPlan.suppressed).toContainEqual(expect.objectContaining({ name: 'Amoxicillin', reason: 'allergy' }));
    });

    it('a write-in is checked against every other candidate', async () => {
      const r = compose([...(await lane()), await contribution('pw-c', pathway([med('c', 'Aspirin')]))], writeIn('Warfarin'));
      expect(names(r)).toEqual([]);
      expect(r.safetyFindings.filter((f) => f.scope === 'SET').map((f) => f.recommendationId).sort())
        .toEqual(['provider-override|Warfarin', 'pw-c|c']);
    });

    it('a write-in that cannot be normalised stays in the plan and blocks the run (D14)', async () => {
      const r = compose(await lane(), writeIn('Unobtainium'));
      expect(r.mergedPlan.medications).toEqual([expect.objectContaining({
        state: 'provider-override', recommendation: expect.objectContaining({ name: 'Unobtainium', sourcePathwayId: 'provider-override' }),
      })]);
      expect(r.readiness.blockers).toContainEqual(expect.objectContaining({ scope: 'COMPLETENESS', type: 'SAFETY_DATA_UNAVAILABLE' }));
    });
  });
});

describe('the run as a whole', () => {
  it('an empty run is not ready: EMPTY_PLAN at the root', () => {
    expect(compose([]).readiness).toEqual({ ready: false, blockers: [expect.objectContaining({ scope: 'OUTPUT', type: 'EMPTY_PLAN' })] });
  });

  it('the run hash does not depend on the order overrides were recorded in (P4-4)', async () => {
    const env = pathway([med('m1', 'Metoprolol', { score: 0.1 }), med('m2', 'Aspirin', { score: 0.1 })]);
    const o = (id: string) => [id, { action: OverrideAction.INCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: 0.1 }] as const;
    const one = await contribution('pw-a', env, { providerOverrides: new Map([o('m1'), o('m2')]) });
    const two = await contribution('pw-a', env, { providerOverrides: new Map([o('m2'), o('m1')]) });
    expect(names(compose([one]))).toEqual(['Aspirin', 'Metoprolol']);
    expect(compose([one]).resultHash).toBe(compose([two]).resultHash);
  });

  it('the run hash moves when a child’s own result moves', async () => {
    const before = await contribution('pw-g', GATED);
    const after = await contribution('pw-g', GATED, { gateAnswers: new Map([['q', { booleanValue: true }]]) });
    expect(compose([before]).resultHash).not.toBe(compose([after]).resultHash);
  });

  it('a pair warning only the root sees moves the run hash; the order findings are listed in does not', async () => {
    const cs = [await contribution('pw-a', pathway([med('a', 'Warfarin')])), await contribution('pw-b', pathway([med('b', 'Aspirin')]))];
    const quiet = compose(cs, {}, PATIENT(), pairAt(null));
    const warned = compose(cs, {}, PATIENT(), pairAt('MODERATE'));
    // Nothing else moves: same plan, no suppression, still ready, same child hashes.
    expect(names(warned)).toEqual(['Aspirin', 'Warfarin']);
    expect(names(quiet)).toEqual(names(warned));
    expect(warned.mergedPlan.suppressed).toEqual(quiet.mergedPlan.suppressed);
    expect(warned.readiness).toEqual({ ready: true, blockers: [] });
    expect(warned.children.map((c) => c.result.resultHash)).toEqual(quiet.children.map((c) => c.result.resultHash));
    expect(warned.ddiWarnings.map((f) => f.recommendationId).sort()).toEqual(['pw-a|a', 'pw-b|b']);
    expect(warned.resultHash).not.toBe(quiet.resultHash);
    const { resultHash, ...rest } = warned;
    expect(runHashOf({ ...rest, safetyFindings: [...rest.safetyFindings].reverse() })).toBe(resultHash);
  });

  it('a write-in’s warning against a patient medication moves the run hash', async () => {
    const patient = PATIENT({ medications: [WARFARIN_RX] });
    const cs = [
      await contribution('pw-a', pathway([med('a', 'Metoprolol', { clinical_role: 'beta_blocker' })]), {}, patient),
      await contribution('pw-b', pathway([med('b', 'Carvedilol', { clinical_role: 'beta_blocker' })]), {}, patient),
    ];
    const d = { beta_blocker: decide('CUSTOM_OVERRIDE', { customMedication: { name: 'Aspirin' } }) };
    const quiet = compose(cs, d, patient, pairAt(null));
    const warned = compose(cs, d, patient, pairAt('MODERATE'));
    expect(names(warned)).toEqual(['Aspirin']);
    expect(warned.ddiWarnings).toEqual([expect.objectContaining({ scope: 'PATIENT', recommendationId: 'provider-override|Aspirin' })]);
    expect(warned.readiness.ready).toBe(quiet.readiness.ready);
    expect(warned.resultHash).not.toBe(quiet.resultHash);
  });
});

describe('a pathway’s contraindicated/avoid constraint withholds every proposer (P4-2)', () => {
  it.each(['contraindicated', 'avoid'] as const)('%s', async (role) => {
    const a = await contribution('pw-a', pathway([med('a', 'Amoxicillin')]));
    const b = await contribution('pw-b', pathway([med('b', 'Amoxicillin', { role })]));
    const c = await contribution('pw-c', pathway([med('c', 'Amoxicillin')]));
    const r = compose([a, b, c]);
    expect(names(r)).toEqual([]);
    expect(r.mergedPlan.suppressed).toContainEqual(expect.objectContaining({
      name: 'Amoxicillin', reason: role, source: expect.objectContaining({ kind: 'PATHWAY', pathwayId: 'pw-b' }),
    }));
    // Both proposers: eligible by their own pathway, withheld by the root, with a reason naming the constraint.
    for (const [child, id] of [[0, 'a'], [2, 'c']] as const) {
      expect(node0(r, child, id).eligibility).toMatchObject({ status: NodeStatus.INCLUDED });
      expect(node0(r, child, id).status).toBe(NodeStatus.EXCLUDED);
      expect(node0(r, child, id).disposition).toMatchObject({
        status: NodeStatus.EXCLUDED, withheldBy: 'conflict', reason: expect.stringContaining('"Pathway pw-b"'),
      });
    }
    // The node that states the constraint is not a proposal.
    expect(node0(r, 1, 'b').status).toBe(NodeStatus.INCLUDED);
    // Without the constraint, a fresh composition of the SAME contributions restores the drug:
    // withholding is derived every time, never written into the contribution.
    const again = compose([a, c]);
    expect(names(again)).toEqual(['Amoxicillin']);
    expect(node0(again, 0, 'a').status).toBe(NodeStatus.INCLUDED);
    expect(node0(again, 1, 'c').status).toBe(NodeStatus.INCLUDED);
  });
});
