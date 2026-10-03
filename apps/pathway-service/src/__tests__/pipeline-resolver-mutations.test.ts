/**
 * The single-pathway mutations over the REAL pipeline: fixture graphs, the
 * real evaluate(), commitEvaluation() and resolvers; only the table and the
 * snapshot loader are in memory (fixtures/resolver-harness).
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());

import { resolutionMutations } from '../resolvers/mutations/resolution';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const AMOX = { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] };
const WARFARIN = { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] };
const SAFETY = {
  normalized: new Map([['amoxicillin||', AMOX], ['warfarin||', WARFARIN]]),
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};
const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };

/** "Symptomatic?" routes yes → Treat (amoxicillin, and a weak warfarin), no → Reassure (a lab). */
const ROUTING = makeEnv(
  [
    node('root', 'Pathway'), node('stage', 'Stage'),
    node('gate-b', 'Gate', { title: 'Symptomatic?', gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'Symptomatic?' }),
    node('step-yes', 'Step', { title: 'Treat' }), node('step-no', 'Step', { title: 'Reassure' }),
    node('med-amox', 'Medication', { name: 'Amoxicillin' }),
    node('med-weak', 'Medication', { name: 'Warfarin', score: 0.1 }),
    node('lab', 'LabTest'),
  ],
  [
    edge('root', 'stage'), edge('stage', 'gate-b', 'HAS_GATE'),
    edge('gate-b', 'step-yes', 'BRANCHES_TO', { when: { equals: true } }),
    edge('gate-b', 'step-no', 'BRANCHES_TO', { when: { equals: false } }),
    edge('step-yes', 'med-amox'), edge('step-yes', 'med-weak'), edge('step-no', 'lab'),
  ],
  SAFETY,
);

/** A one_of fork where step-a and step-b both qualify, so the fork pends. */
const FORK = makeEnv(
  [
    node('root', 'Pathway'),
    node('dp-1', 'DecisionPoint', { title: 'Which treatment?', branch_mode: 'one_of' }),
    node('step-a', 'Step', { title: 'Treat A' }), node('step-b', 'Step', { title: 'Treat B' }),
    node('step-c', 'Step', { title: 'Treat C', score: 0.2 }),
  ],
  [
    edge('root', 'dp-1', 'HAS_DECISION_POINT'),
    edge('dp-1', 'step-a', 'BRANCHES_TO'), edge('dp-1', 'step-b', 'BRANCHES_TO'), edge('dp-1', 'step-c', 'BRANCHES_TO'),
  ],
);

/** Two gates on ONE haemoglobin, at different thresholds; with no lab both escalate (v1). */
const HAEMOGLOBIN = makeEnv(
  [
    node('root', 'Pathway'),
    node('gate-anaemic', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
      condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 } }),
    node('gate-severe', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
      condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 } }),
    node('step-oral-iron', 'Step'), node('step-transfuse', 'Step'),
  ],
  [edge('root', 'gate-anaemic'), edge('root', 'gate-severe'), edge('gate-anaemic', 'step-oral-iron'), edge('gate-severe', 'step-transfuse')],
);

async function start(pathwayId: string, patient: Record<string, unknown> = {}, version = 'legacy-v0'): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId, patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
  } as never, harness.context({ temporalPolicyVersion: version }));
  return (s as { id: string }).id;
}
const ctx = (version = 'legacy-v0') => harness.context({ temporalPolicyVersion: version });
const answer = (sessionId: string, nodeId: string, a: Record<string, unknown>, version?: string) =>
  resolutionMutations.answerPendingDecision(null, { sessionId, nodeId, answer: a }, ctx(version));
const status = (id: string, nodeId: string) => harness.session(id).resolutionState.get(nodeId)?.status;

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-route', ROUTING);
  harness.addPathway('pw-fork', FORK);
  harness.addPathway('pw-hb', HAEMOGLOBIN);
});

describe('startResolution', () => {
  it('stores the inputs, the graph fingerprint and the evaluated cache', async () => {
    const id = await start('pw-route');
    const s = harness.session(id);
    expect(s.revision).toBe(0);
    expect(s.graphFingerprint).toBe(ROUTING.graphFingerprint);
    expect(s.envFingerprint).toBe('env-test');
    expect(s.resultHash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.pendingQuestions.map((q) => q.gateId)).toEqual(['gate-b']);
    expect(s.readiness.blockers).toContainEqual(expect.objectContaining({ type: 'PENDING_GATE', relatedNodeIds: ['gate-b'] }));
    expect(harness.tables.events).toEqual([expect.objectContaining({ sessionId: id, eventType: 'traversal_complete' })]);
  });

  it('refuses an empty graph without storing a session', async () => {
    harness.addPathway('pw-empty', makeEnv([], []));
    await expect(start('pw-empty')).rejects.toThrow('Pathway graph is empty');
    expect(harness.rowCount()).toBe(0);
  });

  it('refuses a pathway that is not ACTIVE', async () => {
    harness.addPathway('pw-draft', ROUTING, { status: 'DRAFT' });
    await expect(start('pw-draft')).rejects.toThrow(/not ACTIVE/);
  });
});

describe('answerPendingDecision — a question gate', () => {
  it.each([
    [true, 'step-yes', 'step-no'],
    [false, 'step-no', 'step-yes'],
  ])('routes %s to its branch and clears the question', async (value, taken, closed) => {
    const id = await start('pw-route');
    await answer(id, 'gate-b', { booleanValue: value });

    expect(status(id, taken)).toBe(NodeStatus.INCLUDED);
    expect(status(id, closed)).not.toBe(NodeStatus.INCLUDED);
    expect(harness.session(id).pendingQuestions).toEqual([]);
    expect(harness.session(id).gateAnswers.get('gate-b')).toEqual({ booleanValue: value });
    expect(harness.tables.gateAnswers).toEqual([expect.objectContaining({ gateId: 'gate-b' })]);
  });

  it.each([
    [{ selectedOption: 'true' }],
    [{}],
    [{ booleanValue: true, numericValue: 1 }],
  ])('rejects an answer the gate does not accept: %j', async (a) => {
    const id = await start('pw-route');
    await expect(answer(id, 'gate-b', a)).rejects.toThrow(/Gate "gate-b"/);
    expect(harness.row(id).revision).toBe(0);
  });

  it('records statusChanges as the diff against the previous cache, in nodeId order', async () => {
    const id = await start('pw-route');
    await answer(id, 'gate-b', { booleanValue: true });
    const changes = harness.tables.events.find((e) => e.eventType === 'gate_answer')!.statusChanges;
    expect(changes).toContainEqual(expect.objectContaining({ nodeId: 'step-yes', to: 'INCLUDED' }));
    const ids = changes.map((c) => c.nodeId);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('overrideNode', () => {
  it('an INCLUDE override brings a below-threshold medication in, and holds on every later evaluation', async () => {
    const id = await start('pw-route');
    await answer(id, 'gate-b', { booleanValue: true });
    expect(status(id, 'med-weak')).toBe(NodeStatus.EXCLUDED);

    await resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'med-weak', action: OverrideAction.INCLUDE, reason: 'clinician' }, ctx());
    expect(status(id, 'med-weak')).toBe(NodeStatus.INCLUDED);
    expect(harness.session(id).resolutionState.get('med-weak')!.eligibility).toMatchObject({ decidedBy: 'override' });

    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { conditionCodes: [{ code: 'I10', system: 'ICD-10' }] } }, ctx());
    expect(status(id, 'med-weak')).toBe(NodeStatus.INCLUDED);
    expect(harness.tables.nodeOverrides).toEqual([expect.objectContaining({ nodeId: 'med-weak', originalStatus: 'EXCLUDED' })]);
  });

  it('keeps the pathway’s original decision across re-overrides', async () => {
    const id = await start('pw-route');
    await answer(id, 'gate-b', { booleanValue: true });
    await resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'med-weak', action: OverrideAction.INCLUDE }, ctx());
    await resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'med-weak', action: OverrideAction.EXCLUDE }, ctx());
    expect(harness.session(id).providerOverrides.get('med-weak')).toMatchObject({ action: 'EXCLUDE', originalStatus: 'EXCLUDED' });
  });

  it('an overridden medication is still suppressed by a patient allergy (D4)', async () => {
    const id = await start('pw-route', { allergies: [PENICILLIN] });
    await answer(id, 'gate-b', { booleanValue: true });
    await resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'med-amox', action: OverrideAction.INCLUDE }, ctx());

    const med = harness.session(id).resolutionState.get('med-amox')!;
    expect(med.eligibility).toMatchObject({ status: NodeStatus.INCLUDED, decidedBy: 'override' });
    expect(med.disposition).toMatchObject({ status: NodeStatus.EXCLUDED, withheldBy: 'safety' });
  });

  it('refuses a node the session does not hold', async () => {
    const id = await start('pw-route');
    await expect(resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'nope', action: OverrideAction.INCLUDE }, ctx()))
      .rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
  });
});

describe('answerPendingDecision — a branch choice at a DecisionPoint', () => {
  it('takes the chosen branch and excludes the others', async () => {
    const id = await start('pw-fork');
    expect(status(id, 'dp-1')).toBe(NodeStatus.PENDING_QUESTION);
    expect(harness.session(id).pendingQuestions[0].options).toEqual(expect.arrayContaining(['step-a', 'step-b']));

    await answer(id, 'dp-1', { selectedOption: 'step-b' });

    expect(status(id, 'step-b')).toBe(NodeStatus.INCLUDED);
    expect(status(id, 'step-a')).toBe(NodeStatus.EXCLUDED);
    // …and says why the unchosen branch is absent.
    expect(harness.session(id).resolutionState.get('step-a')!.excludeReason ?? '').toMatch(/step-b|Treat B|not selected/i);
    expect(harness.tables.events.at(-1)).toMatchObject({ eventType: 'BRANCH_CHOSEN' });
  });

  it('rejects a choice that is not a candidate', async () => {
    const id = await start('pw-fork');
    await expect(answer(id, 'dp-1', { selectedOption: 'step-zzz' })).rejects.toThrow(/not among the candidate branches/);
  });
});

describe('answerPendingDecision — an escalated datum request', () => {
  it('becomes a FACT every gate reading that datum sees, not a gate answer', async () => {
    const id = await start('pw-hb', {}, 'v1');
    // Both gates escalate, and the haemoglobin is asked for once.
    expect(harness.session(id).resolutionState.get('gate-anaemic')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(harness.session(id).resolutionState.get('gate-severe')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(harness.session(id).pendingQuestions).toHaveLength(1);
    const [asked] = harness.session(id).pendingQuestions;
    expect(asked.datumKey).toBe('LOINC:718-7');

    await answer(id, asked.gateId, { numericValue: 9.1 }, 'v1');

    const s = harness.session(id);
    expect(s.resolutionState.get('gate-anaemic')!.status).toBe(NodeStatus.INCLUDED);
    expect(s.resolutionState.get('gate-severe')!.status).toBe(NodeStatus.GATED_OUT);
    expect(s.gateAnswers.size).toBe(0);
    expect((s.additionalContext as { labResults: unknown[] }).labResults).toEqual([expect.objectContaining({ code: '718-7', value: 9.1 })]);
    expect(harness.tables.events.at(-1)).toMatchObject({ eventType: 'PROVIDER_ASSERTED_DATUM', triggerData: expect.objectContaining({ datumKey: 'LOINC:718-7', value: 9.1 }) });
  });

  it('is not dropped as a duplicate of a valueless, undated entry for the same lab (live smoke test, 2026-09-25)', async () => {
    // The composer can send a lab selected without a value or a date.
    const id = await start('pw-hb', { labResults: [{ code: '718-7', system: 'LOINC', display: 'Hemoglobin' }] }, 'v1');
    const [asked] = harness.session(id).pendingQuestions;
    expect(asked.datumKey).toBe('LOINC:718-7');

    await answer(id, asked.gateId, { numericValue: 9.1 }, 'v1');

    const s = harness.session(id);
    expect(s.pendingQuestions).toHaveLength(0);
    expect(s.resolutionState.get('gate-anaemic')!.status).toBe(NodeStatus.INCLUDED);
    expect(s.resolutionState.get('gate-severe')!.status).toBe(NodeStatus.GATED_OUT);
  });

  it('refuses a non-numeric answer', async () => {
    const id = await start('pw-hb', {}, 'v1');
    await expect(answer(id, harness.session(id).pendingQuestions[0].gateId, { booleanValue: true }, 'v1')).rejects.toThrow(/numericValue/);
  });
});

describe('addPatientContext', () => {
  it('an added allergy reaches the safety check', async () => {
    const id = await start('pw-route');
    await answer(id, 'gate-b', { booleanValue: true });
    expect(status(id, 'med-amox')).toBe(NodeStatus.INCLUDED);

    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { allergies: [PENICILLIN] } }, ctx());
    expect(harness.session(id).resolutionState.get('med-amox')!.disposition).toMatchObject({ withheldBy: 'safety' });
  });

  it('an added medication that cannot be normalised blocks readiness (D14)', async () => {
    const id = await start('pw-route');
    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { medications: [{ code: '999', system: 'RxNorm', display: 'Mysterydrug' }] } }, ctx());
    expect(harness.session(id).readiness.blockers).toContainEqual(expect.objectContaining({ type: 'SAFETY_DATA_UNAVAILABLE' }));
  });

  it('accumulates: adding one fact and then another keeps both', async () => {
    const id = await start('pw-route');
    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { allergies: [PENICILLIN] } }, ctx());
    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { conditionCodes: [{ code: 'I10', system: 'ICD-10' }] } }, ctx());
    expect(harness.session(id).additionalContext).toMatchObject({
      allergies: [PENICILLIN], conditionCodes: [{ code: 'I10', system: 'ICD-10' }],
    });
  });

  it('refuses a caller-asserted clinical assertion before loading anything', async () => {
    const id = await start('pw-route');
    await expect(resolutionMutations.addPatientContext(null, {
      sessionId: id,
      additionalContext: { labResults: [{ code: '718-7', system: 'LOINC', value: 9, recordValidity: 'INVALID' }] },
    } as never, ctx())).rejects.toMatchObject({ extensions: { code: 'INVALID_RESOLUTION_INPUT' } });
    expect(harness.row(id).revision).toBe(0);
  });

  it('a DEGRADED session that evaluates cleanly is stored ACTIVE again', async () => {
    const id = await start('pw-route');
    harness.row(id).status = 'DEGRADED';
    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { conditionCodes: [{ code: 'I10', system: 'ICD-10' }] } }, ctx());
    expect(harness.row(id).status).toBe('ACTIVE');
  });
});

describe('abandonSession (lifecycle only)', () => {
  it('abandons an ACTIVE session without evaluating, and logs it', async () => {
    const id = await start('pw-route');
    const before = harness.row(id).result_hash;
    await resolutionMutations.abandonSession(null, { sessionId: id, reason: 'duplicate' }, ctx());
    expect(harness.row(id)).toMatchObject({ status: 'ABANDONED', revision: 1, result_hash: before });
    expect(harness.tables.events.at(-1)).toMatchObject({ eventType: 'abandoned', triggerData: { reason: 'duplicate' } });
  });

  it('refuses to abandon a COMPLETED session', async () => {
    const id = await start('pw-route');
    harness.row(id).status = 'COMPLETED';
    await expect(resolutionMutations.abandonSession(null, { sessionId: id }, ctx())).rejects.toThrow(/COMPLETED/);
  });
});
