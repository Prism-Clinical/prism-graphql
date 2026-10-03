jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/multi-pathway-session-store', () => require('./fixtures/resolver-harness').runStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/lattice-collapse', () => require('./fixtures/resolver-harness').latticeMock());

import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { loadRunEnv } from '../services/resolution/pipeline/load-env';
import { AnswerType, DefaultBehavior, GateType } from '../services/resolution/types';
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
    ['warfarin||', norm('11289', 'warfarin', 'B01AA03')],
    ['aspirin||', norm('1191', 'aspirin', 'B01AC06')],
  ]),
  pairs: new Map([['11289|1191', { severity: 'MODERATE' as const, mechanism: 'bleeding', clinicalAdvice: 'monitor INR', matchType: 'PAIR' as const, matchedClasses: null }]]),
};
const med = (id: string, name: string, extra: Record<string, unknown> = {}) => node(id, 'Medication', { name, role: 'first_line', ...extra });
const plain = (meds: GraphNode[]) =>
  makeEnv([node('root', 'Pathway'), node('step', 'Step'), ...meds], [edge('root', 'step'), ...meds.map((m) => edge('step', m.nodeIdentifier))], SAFETY);
const PW_Q = makeEnv(
  [
    node('root', 'Pathway'),
    node('q', 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'Symptomatic?' }),
    node('step', 'Step'), med('meto', 'Metoprolol', { clinical_role: 'beta_blocker' }),
  ],
  [edge('root', 'q', 'HAS_GATE'), edge('q', 'step', 'BRANCHES_TO', { when: { equals: true } }), edge('step', 'meto')],
  SAFETY,
);

const ctx = () => harness.context({ temporalPolicyVersion: 'legacy-v0' });
async function startRun(pathways: string[]): Promise<string> {
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
const answerQ = (runId: string) =>
  resolutionMutations.answerPendingDecision(null, { sessionId: childOf(runId, 'pw-q'), nodeId: 'q', answer: { booleanValue: true } }, ctx());
const generate = (runId: string, reviewedResultHash: string) =>
  multiPathwayResolutionMutations.generateMergedCarePlan(null, { sessionId: runId, reviewedResultHash }, ctx());
const reviewed = (runId: string) => harness.run(runId).resultHash;
const carePlanInsertCount = () => harness.tables.carePlanInserts.filter((sql) => /INSERT INTO patient_care_plans\b/.test(sql)).length;

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-q', PW_Q);
  harness.addPathway('pw-amox', plain([med('amox', 'Amoxicillin')]));
  harness.addPathway('pw-carv', plain([med('carv', 'Carvedilol', { clinical_role: 'beta_blocker' })]));
  harness.addPathway('pw-warf', plain([med('warf', 'Warfarin')]));
  harness.addPathway('pw-asa', plain([med('asa', 'Aspirin')]));
});

describe('generateMergedCarePlan', () => {
  it('generates when the reviewed hash matches and the run is ready: the run and every child complete', async () => {
    const runId = await startRun(['pw-amox', 'pw-carv']);
    const r = await generate(runId, reviewed(runId));

    expect(r).toMatchObject({ success: true, blockers: [] });
    expect(r.carePlanId).toMatch(/^care-plan-/);
    expect(harness.runRow(runId)).toMatchObject({ status: 'COMPLETED', care_plan_id: r.carePlanId });
    for (const id of harness.run(runId).contributingSessionIds) {
      expect(harness.row(id)).toMatchObject({ status: 'COMPLETED', care_plan_id: r.carePlanId });
    }
    expect(carePlanInsertCount()).toBe(1);
    expect(harness.tables.events.filter((e) => e.eventType === 'care_plan_generated')).toHaveLength(2);
  });

  it('returns PLAN_CHANGED_SINCE_REVIEW when a child changed after review (review #2, D7)', async () => {
    const runId = await startRun(['pw-q', 'pw-amox']);
    const hash = reviewed(runId);
    await answerQ(runId); // lands after the review; nothing needs re-merging

    const r = await generate(runId, hash);

    expect(r).toMatchObject({ success: false, carePlanId: null });
    expect(r.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'PLAN_CHANGED_SINCE_REVIEW' })]);
    expect(harness.runRow(runId)).toMatchObject({ status: 'ACTIVE' });
    expect(harness.runRow(runId).result_hash).not.toBe(hash);
    expect(carePlanInsertCount()).toBe(0);
  });

  it('returns PLAN_CHANGED_SINCE_REVIEW when only a root warning appeared after review; generates once it is reviewed', async () => {
    const quiet = (id: string, name: string) =>
      makeEnv([node('root', 'Pathway'), node('step', 'Step'), med(id, name)], [edge('root', 'step'), edge('step', id)], { ...SAFETY, pairs: new Map() });
    harness.addPathway('pw-warf', quiet('warf', 'Warfarin'));
    harness.addPathway('pw-asa', quiet('asa', 'Aspirin'));
    const runId = await startRun(['pw-warf', 'pw-asa']);
    const hash = reviewed(runId);
    // The reference gains the moderate pair: no medication, blocker or child hash moves.
    harness.addPathway('pw-warf', plain([med('warf', 'Warfarin')]));
    harness.addPathway('pw-asa', plain([med('asa', 'Aspirin')]));

    const stale = await generate(runId, hash);
    expect(stale).toMatchObject({ success: false, carePlanId: null });
    expect(stale.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'PLAN_CHANGED_SINCE_REVIEW' })]);
    expect(carePlanInsertCount()).toBe(0);

    const r = await generate(runId, reviewed(runId));
    expect(r.success).toBe(true);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^DDI_MODERATE: /)]));
    expect(carePlanInsertCount()).toBe(1);
  });

  it('a child’s unanswered question blocks generation, tagged with its pathway (review #2)', async () => {
    const runId = await startRun(['pw-q', 'pw-amox']);
    const r = await generate(runId, reviewed(runId));

    expect(r.success).toBe(false);
    expect(r.blockers).toContainEqual(expect.objectContaining({ scope: 'COMPLETENESS', type: 'PENDING_GATE', relatedNodeIds: ['q'], pathwayId: 'pw-q' }));
    expect(carePlanInsertCount()).toBe(0);
  });

  it('an unresolved conflict blocks generation at the root', async () => {
    const runId = await startRun(['pw-q', 'pw-carv']);
    await answerQ(runId);
    const r = await generate(runId, reviewed(runId));
    expect(r.blockers).toContainEqual(expect.objectContaining({ scope: 'OUTPUT', type: 'UNRESOLVED_CONFLICT', pathwayId: null }));
  });

  it('returns a moderate interaction across pathways as a text warning (P3-9)', async () => {
    const runId = await startRun(['pw-warf', 'pw-asa']);
    const r = await generate(runId, reviewed(runId));
    expect(r.success).toBe(true);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^DDI_MODERATE: (Warfarin|Aspirin) — monitor INR$/)]));
  });

  it('returns the existing care plan for a COMPLETED run without evaluating (P3-7)', async () => {
    const runId = await startRun(['pw-amox']);
    const first = await generate(runId, reviewed(runId));
    (loadRunEnv as jest.Mock).mockClear();

    const again = await generate(runId, 'stale-hash');

    expect(again).toEqual({ success: true, carePlanId: first.carePlanId, warnings: [], blockers: [] });
    expect(loadRunEnv).not.toHaveBeenCalled();
    expect(carePlanInsertCount()).toBe(1);
  });

  it('claims before inserting: a lost race inserts nothing, and the retry succeeds (#8)', async () => {
    const runId = await startRun(['pw-amox']);
    const hash = reviewed(runId);
    harness.loseNextRaces(1);

    const r = await generate(runId, hash);

    expect(r.success).toBe(true);
    expect(carePlanInsertCount()).toBe(1);
  });

  it('a failure after the claim rolls everything back, and a retry generates once', async () => {
    const runId = await startRun(['pw-amox']);
    const hash = reviewed(runId);
    harness.failNext(/INSERT INTO patient_care_plan_interventions/);

    await expect(generate(runId, hash)).rejects.toMatchObject({ extensions: { code: 'INTERNAL_SERVER_ERROR' } });
    expect(harness.runRow(runId)).toMatchObject({ status: 'ACTIVE', revision: 0, care_plan_id: null });
    expect(harness.row(childOf(runId, 'pw-amox')).status).toBe('ACTIVE');
    expect(carePlanInsertCount()).toBe(0);
    expect(harness.tables.events.filter((e) => e.eventType === 'care_plan_generated')).toEqual([]);

    expect((await generate(runId, hash)).success).toBe(true);
    expect(carePlanInsertCount()).toBe(1);
  });

  it('refuses an ABANDONED run', async () => {
    const runId = await startRun(['pw-amox']);
    await multiPathwayResolutionMutations.abandonMultiPathwaySession(null, { sessionId: runId }, ctx());
    await expect(generate(runId, reviewed(runId))).rejects.toThrow(/abandoned/);
  });
});
