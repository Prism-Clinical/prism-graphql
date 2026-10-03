/**
 * Multi-pathway runs through the REAL pipeline: fixture graphs, the real
 * evaluate(), composeRun(), commitRun() and resolvers; only the tables, the
 * snapshot loaders and lattice collapse are in memory (fixtures/resolver-harness).
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/multi-pathway-session-store', () => require('./fixtures/resolver-harness').runStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/lattice-collapse', () => require('./fixtures/resolver-harness').latticeMock());

import {
  formatMergedForGraphQL,
  multiPathwayResolutionMutations,
  multiPathwayResolutionQueries,
} from '../resolvers/mutations/multi-pathway-resolution';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import type { MergedCarePlan } from '../services/resolution/care-plan-merge';
import { evaluateRun, newRunRequest, runInputsOf } from '../services/resolution/pipeline/run';
import { loadRun } from '../services/resolution/pipeline/run-commit';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction } from '../services/resolution/types';
import type { GraphNode } from '../services/confidence/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const norm = (rxcui: string, name: string, atc: string) => ({ ingredientRxcui: rxcui, ingredientName: name, atcClasses: [atc] });
const SAFETY = {
  normalized: new Map([
    ['amoxicillin||', norm('723', 'amoxicillin', 'J01CA04')],
    ['metoprolol||', norm('6918', 'metoprolol', 'C07AB02')],
    ['carvedilol||', norm('20352', 'carvedilol', 'C07AG02')],
  ]),
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};
const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };
const med = (id: string, name: string, extra: Record<string, unknown> = {}) => node(id, 'Medication', { name, role: 'first_line', ...extra });
const plain = (meds: GraphNode[]) =>
  makeEnv([node('root', 'Pathway'), node('step', 'Step'), ...meds], [edge('root', 'step'), ...meds.map((m) => edge('step', m.nodeIdentifier))], SAFETY);

/** "Symptomatic?" yes → Metoprolol, in the beta-blocker lane. */
const PW_Q = makeEnv(
  [
    node('root', 'Pathway'),
    node('q', 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'Symptomatic?' }),
    node('step', 'Step'), med('meto', 'Metoprolol', { clinical_role: 'beta_blocker' }),
  ],
  [edge('root', 'q', 'HAS_GATE'), edge('q', 'step', 'BRANCHES_TO', { when: { equals: true } }), edge('step', 'meto')],
  SAFETY,
);
/** Carvedilol in the same lane: a conflict once Metoprolol is in. */
const carvEnv = () => plain([med('carv', 'Carvedilol', { clinical_role: 'beta_blocker' })]);
/** One gate on ONE haemoglobin (v1 escalates it when absent). */
const hbPathway = (gateId: string) => makeEnv(
  [
    node('root', 'Pathway'),
    node(gateId, 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
      condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 } }),
    node('step', 'Step'),
  ],
  [edge('root', gateId), edge(gateId, 'step')],
);
/** A NODE-level ENCOUNTER horizon: evaluation refuses a run with no encounterStart. */
const PW_ANCHOR = makeEnv(
  [node('root', 'Pathway'), node('g-1', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE,
    condition: { field: 'labs', operator: 'exists', value: '718-7', horizon: 'ENCOUNTER' } })],
  [edge('root', 'g-1')],
);

const ctx = (version = 'legacy-v0') => harness.context({ temporalPolicyVersion: version });
async function startRun(
  pathways: string[],
  patient: Record<string, unknown> = {},
  opts: { version?: string; syntheticPatient?: boolean } = {},
): Promise<{ id: string; isPreview: boolean }> {
  harness.matchPathways(...pathways);
  return multiPathwayResolutionMutations.startMultiPathwayResolution(null as never, {
    patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED, syntheticPatient: opts.syntheticPatient ?? true,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
  } as never, ctx(opts.version)) as never;
}
const childOf = (runId: string, pathwayId: string) => {
  const r = harness.run(runId);
  return r.contributingSessionIds[r.contributingPathwayIds.indexOf(pathwayId)];
};
const medsOf = (runId: string) => harness.run(runId).mergedPlan.medications.map((m) => m.recommendation.name).sort();
const answerQ = (runId: string, value = true) =>
  resolutionMutations.answerPendingDecision(null, { sessionId: childOf(runId, 'pw-q'), nodeId: 'q', answer: { booleanValue: value } }, ctx());

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-q', PW_Q);
  harness.addPathway('pw-carv', carvEnv());
  harness.addPathway('pw-amox', plain([med('amox', 'Amoxicillin')]));
  harness.addPathway('pw-hb1', hbPathway('hb-1'));
  harness.addPathway('pw-hb2', hbPathway('hb-2'));
  harness.addPathway('pw-empty', makeEnv([], []));
  harness.addPathway('pw-anchor', PW_ANCHOR);
});

describe('startMultiPathwayResolution', () => {
  it('creates the parent and one child per matched pathway, in one transaction', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-amox']);
    const run = harness.run(runId);
    expect(run).toMatchObject({ revision: 0, status: 'ACTIVE', contributingPathwayIds: ['pw-q', 'pw-amox'] });
    expect(run.resultHash).toMatch(/^[0-9a-f]{64}$/);
    for (const id of run.contributingSessionIds) {
      expect(harness.row(id)).toMatchObject({ parent_session_id: runId, additional_context: {} });
      expect(harness.session(id).initialPatientContext).toEqual(run.initialPatientContext);
      expect(harness.session(id).temporalContext).toEqual(run.temporalContext); // one clock for the run
    }
    expect(harness.tables.events.map((e) => e.eventType)).toEqual(['traversal_complete', 'traversal_complete']);
    expect(medsOf(runId)).toEqual(['Amoxicillin']);
  });

  it('stores isPreview from syntheticPatient, and the formatted run exposes it', async () => {
    const preview = await startRun(['pw-amox']);
    expect(preview.isPreview).toBe(true);
    expect(harness.run(preview.id).isPreview).toBe(true);
    const real = await startRun(['pw-amox'], {}, { syntheticPatient: false });
    expect(real.isPreview).toBe(false);
    expect(harness.run(real.id).isPreview).toBe(false);
  });

  it('a zero-match run is stored with EMPTY_PLAN at its root, stamped with the injected policy version', async () => {
    const run = harness.run((await startRun([], {}, { version: 'legacy-v0' })).id);
    expect(run.contributingSessionIds).toEqual([]);
    expect(run.readiness.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'EMPTY_PLAN' })]);
    // legacy-v0 differs from DEFAULT_TEMPORAL_POLICY_VERSION (v1): injection, not the default.
    expect(run.temporalContext.temporalPolicyVersion).toBe('legacy-v0');
    expect(harness.rowCount()).toBe(0);
  });

  it('a pathway whose graph is empty contributes no child', async () => {
    const run = harness.run((await startRun(['pw-empty', 'pw-amox'])).id);
    expect(run.contributingPathwayIds).toEqual(['pw-amox']);
    expect(harness.rowCount()).toBe(1);
  });

  it('a pathway that fails evaluation writes nothing: no parent, no child, no event', async () => {
    await expect(startRun(['pw-amox', 'pw-anchor'])).rejects.toThrow(/encounterStart/);
    expect(harness.runIds()).toEqual([]);
    expect(harness.rowCount()).toBe(0);
    expect(harness.tables.events).toEqual([]);
  });

  it.each([[[]], [['pw-empty']]])('refuses an unknown policy version before writing anything (matches: %j)', async (pathways) => {
    await expect(startRun(pathways, {}, { version: 'v99' })).rejects.toThrow(/unknown temporalPolicyVersion/);
    expect(harness.runIds()).toEqual([]);
  });
});

describe('a child of a run changes through its run', () => {
  it('answering a child’s gate re-evaluates the whole run — no re-merge (review #2)', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-carv']);
    expect(medsOf(runId)).toEqual(['Carvedilol']);
    const qChild = childOf(runId, 'pw-q');

    const returned = await answerQ(runId);

    expect((returned as { id: string }).id).toBe(qChild);
    const run = harness.run(runId);
    expect(run.revision).toBe(1);
    // Metoprolol entered Carvedilol's lane; the merged plan shows it with no re-merge call.
    expect(run.mergedPlan.conflicts.map((c) => c.conflictId)).toEqual(['beta_blocker']);
    expect(harness.row(qChild).revision).toBe(1);
    expect(harness.row(childOf(runId, 'pw-carv')).revision).toBe(1); // re-evaluated too (D13)
    expect(harness.session(qChild).gateAnswers.get('q')).toEqual({ booleanValue: true });
    expect(harness.tables.gateAnswers).toEqual([expect.objectContaining({ gateId: 'q', sessionId: qChild })]);
  });

  it('an override on a child is stored on the child and recomposes the run', async () => {
    const { id: runId } = await startRun(['pw-carv']);
    const child = childOf(runId, 'pw-carv');
    await resolutionMutations.overrideNode(null, { sessionId: child, nodeId: 'carv', action: OverrideAction.EXCLUDE }, ctx());
    expect(harness.session(child).providerOverrides.get('carv')).toMatchObject({ action: 'EXCLUDE' });
    expect(medsOf(runId)).toEqual([]);
    expect(harness.tables.nodeOverrides).toEqual([expect.objectContaining({ sessionId: child, nodeId: 'carv' })]);
  });

  it('a fact supplied on child A reaches child B, and is stored on the parent (D5)', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-amox']);
    await resolutionMutations.addPatientContext(null, { sessionId: childOf(runId, 'pw-q'), additionalContext: { allergies: [PENICILLIN] } }, ctx());

    expect(harness.session(childOf(runId, 'pw-amox')).resolutionState.get('amox')!.disposition).toMatchObject({ withheldBy: 'safety' });
    expect(harness.runRow(runId).additional_context).toEqual({ allergies: [PENICILLIN] });
    expect(harness.row(childOf(runId, 'pw-q')).additional_context).toEqual({});
    const logged = harness.tables.events.filter((e) => e.eventType === 'context_update').map((e) => e.sessionId).sort();
    expect(logged).toEqual([...harness.run(runId).contributingSessionIds].sort());
  });

  it('an escalated datum answered in one pathway resolves another pathway’s gate (D5)', async () => {
    const { id: runId } = await startRun(['pw-hb1', 'pw-hb2'], {}, { version: 'v1' });
    const c1 = childOf(runId, 'pw-hb1');
    const c2 = childOf(runId, 'pw-hb2');
    expect(harness.session(c2).resolutionState.get('hb-2')!.status).toBe(NodeStatus.PENDING_QUESTION);
    const [asked] = harness.session(c1).pendingQuestions;

    await resolutionMutations.answerPendingDecision(null, { sessionId: c1, nodeId: asked.gateId, answer: { numericValue: 9.1 } }, ctx('v1'));

    expect(harness.session(c2).resolutionState.get('hb-2')!.status).toBe(NodeStatus.INCLUDED);
    expect(harness.runRow(runId).additional_context).toMatchObject({ labResults: [expect.objectContaining({ code: '718-7', value: 9.1 })] });
  });

  it('refuses child-level generation and abandonment (CHILD_OF_MULTI_PATHWAY_SESSION)', async () => {
    const child = childOf((await startRun(['pw-amox'])).id, 'pw-amox');
    const code = { extensions: { code: 'CHILD_OF_MULTI_PATHWAY_SESSION' } };
    await expect(resolutionMutations.generateCarePlanFromResolution(null, { sessionId: child, reviewedResultHash: 'x' }, ctx())).rejects.toMatchObject(code);
    await expect(resolutionMutations.abandonSession(null, { sessionId: child }, ctx())).rejects.toMatchObject(code);
  });
});

describe('resolveConflict', () => {
  const choose = (runId: string, choice: Record<string, unknown>, conflictId = 'beta_blocker') =>
    multiPathwayResolutionMutations.resolveConflict(null, { sessionId: runId, conflictId, choice } as never, ctx());

  it('a changed choice replaces the previous one (review #6)', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-carv']);
    await answerQ(runId);

    await choose(runId, { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-q' });
    expect(medsOf(runId)).toEqual(['Metoprolol']);
    await choose(runId, { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-carv' });
    expect(medsOf(runId)).toEqual(['Carvedilol']);

    expect(harness.session(childOf(runId, 'pw-q')).resolutionState.get('meto')!.disposition).toMatchObject({ withheldBy: 'conflict' });
    expect(harness.run(runId).conflictResolutions.beta_blocker).toMatchObject({ kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-carv', resolvedBy: 'provider-1' });
  });

  it('a write-in is safety-checked against the patient (review #7)', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-carv'], { allergies: [PENICILLIN] });
    await answerQ(runId);
    await choose(runId, { kind: 'CUSTOM_OVERRIDE', customMedication: { name: 'Amoxicillin' } });

    expect(medsOf(runId)).toEqual([]);
    expect(harness.run(runId).mergedPlan.suppressed).toContainEqual(expect.objectContaining({ name: 'Amoxicillin', reason: 'allergy' }));
  });

  it('refuses a conflict the run does not have, and a pathway that is not a candidate', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-carv']);
    await answerQ(runId);
    await expect(choose(runId, { kind: 'REJECT_BOTH' }, 'nope')).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
    await expect(choose(runId, { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-amox' })).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    expect(harness.run(runId).revision).toBe(1);
  });
});

describe('abandonMultiPathwaySession (lifecycle only)', () => {
  it('abandons the run and every child, without evaluating', async () => {
    const { id: runId } = await startRun(['pw-amox', 'pw-carv']);
    const hash = harness.runRow(runId).result_hash;
    await multiPathwayResolutionMutations.abandonMultiPathwaySession(null, { sessionId: runId, reason: 'duplicate' }, ctx());

    expect(harness.runRow(runId)).toMatchObject({ status: 'ABANDONED', revision: 1, result_hash: hash });
    for (const id of harness.run(runId).contributingSessionIds) expect(harness.row(id).status).toBe('ABANDONED');
    expect(harness.tables.events.filter((e) => e.eventType === 'abandoned')).toHaveLength(2);
  });

  it('refuses to abandon a COMPLETED run', async () => {
    const { id: runId } = await startRun(['pw-amox']);
    harness.runRow(runId).status = 'COMPLETED';
    await expect(multiPathwayResolutionMutations.abandonMultiPathwaySession(null, { sessionId: runId }, ctx())).rejects.toThrow(/COMPLETED/);
  });
});

describe('A4 — configuration changes between mutations (C4, D13)', () => {
  it('the next answer yields the run a fresh evaluation gives under the new snapshot, with a new envFingerprint', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-carv']);
    const before = harness.run(runId).envFingerprint;
    // Stricter thresholds on one pathway: Carvedilol (0.9) is no longer auto-included.
    const stricter = carvEnv();
    stricter.resolution.thresholds = { autoResolveThreshold: 0.95, suggestThreshold: 0.95 };
    stricter.envFingerprint = 'env-stricter';
    harness.addPathway('pw-carv', stricter);

    await answerQ(runId);

    const run = harness.run(runId);
    expect(run.envFingerprint).not.toBe(before);
    const fresh = await evaluateRun(harness.pool(), newRunRequest(), runInputsOf(await loadRun(harness.pool(), runId)));
    expect(run.resultHash).toBe(fresh.result.resultHash);
    expect(medsOf(runId)).toEqual(['Metoprolol']);
  });
});

describe('formatting', () => {
  const EMPTY: MergedCarePlan = {
    sourcePathwayIds: [], medications: [], labs: [], imaging: [], procedures: [], guidance: [], schedules: [],
    qualityMetrics: [], suppressed: [], conflicts: [], catchUpItems: [], evidenceTrail: [], dataGapHints: [],
  };

  it('formats a conflict with no resolution as resolution=null', () => {
    const out = formatMergedForGraphQL({
      ...EMPTY,
      conflicts: [{
        conflictId: 'role_x', type: 'medication', clinicalRole: 'role_x', resolution: null,
        candidates: [{ recommendation: { name: 'A', role: 'first_line', sourcePathwayId: 'p1', evidenceGateIds: [] }, sourcePathwayId: 'p1', sourcePathwayTitle: 'P1' }],
      }],
    });
    expect(out.conflicts[0]).toMatchObject({ conflictId: 'role_x', type: 'MEDICATION', resolution: null });
  });

  it('maps state strings to GraphQL enum names', () => {
    const rec = (name: string) => ({ name, role: 'first_line' as const, sourcePathwayId: 'p', evidenceGateIds: [] });
    const out = formatMergedForGraphQL({
      ...EMPTY,
      medications: [
        { recommendation: rec('A'), sourcePathwayIds: ['p'], state: 'auto-included' },
        { recommendation: rec('B'), sourcePathwayIds: ['p'], state: 'provider-confirmed' },
        { recommendation: rec('C'), sourcePathwayIds: ['p'], state: 'provider-override' },
      ],
    });
    expect(out.medications.map((m) => m.state)).toEqual(['AUTO_INCLUDED', 'PROVIDER_CONFIRMED', 'PROVIDER_OVERRIDE']);
  });

  it('a run exposes revision, resultHash and envFingerprint, and a suppression its source pathway', async () => {
    const { id: runId } = await startRun(['pw-amox'], { allergies: [PENICILLIN] });
    const formatted = await multiPathwayResolutionQueries.multiPathwayResolutionSession(null, { sessionId: runId }, ctx());
    const run = harness.run(runId);
    expect(formatted).toMatchObject({ revision: 0, resultHash: run.resultHash, envFingerprint: run.envFingerprint });
    expect(formatted!.mergedPlan.suppressed[0]).toMatchObject({
      name: 'Amoxicillin', reason: 'ALLERGY', sourcePathwayId: 'pw-amox', suppressedByRecommendationName: null,
    });
  });
});
