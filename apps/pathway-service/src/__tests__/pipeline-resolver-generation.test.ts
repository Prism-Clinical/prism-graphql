jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/llm/llm-gate-client', () => ({
  ...jest.requireActual('../services/llm/llm-gate-client'),
  loadLLMGateConfig: jest.fn(),
  evaluateGateWithLLM: jest.fn(),
}));

import { resolutionMutations } from '../resolvers/mutations/resolution';
import { evaluateGateWithLLM, loadLLMGateConfig } from '../services/llm/llm-gate-client';
import { loadEvaluationEnv } from '../services/resolution/pipeline/load-env';
import { DefaultBehavior, GateType } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const AMOX = { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] };
const nodes = (medName = 'Amoxicillin') => [
  node('root', 'Pathway'), node('stage', 'Stage'), node('step', 'Step'),
  node('med', 'Medication', { name: medName }),
];
const edges = [edge('root', 'stage'), edge('stage', 'step'), edge('step', 'med')];
const SAFETY = {
  normalized: new Map([['amoxicillin||', AMOX]]),
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};

async function start(pathwayId = 'pw-gen', allergies: unknown[] = []): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId, patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies, labResults: [] },
  } as never, harness.context({ temporalPolicyVersion: 'legacy-v0' }));
  return (s as { id: string }).id;
}
const generate = (sessionId: string, reviewedResultHash: string) =>
  resolutionMutations.generateCarePlanFromResolution(null, { sessionId, reviewedResultHash }, harness.context());
const carePlanInsertCount = () => harness.tables.carePlanInserts.filter((sql) => /INSERT INTO patient_care_plans\b/.test(sql)).length;

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-gen', makeEnv(nodes(), edges, SAFETY));
  (loadLLMGateConfig as jest.Mock).mockReset().mockReturnValue(null);
  (evaluateGateWithLLM as jest.Mock).mockReset();
});

describe('generateCarePlanFromResolution', () => {
  it('generates when the reviewed hash matches and the plan is ready', async () => {
    const id = await start();
    const r = await generate(id, harness.session(id).resultHash);

    expect(r).toMatchObject({ success: true, blockers: [] });
    expect(r.carePlanId).toMatch(/^care-plan-/);
    expect(harness.row(id)).toMatchObject({ status: 'COMPLETED', care_plan_id: r.carePlanId });
    expect(carePlanInsertCount()).toBe(1);
    expect(harness.tables.events.at(-1)).toMatchObject({ eventType: 'care_plan_generated' });
  });

  it('returns PLAN_CHANGED_SINCE_REVIEW and stores the fresh cache when the plan moved (D7)', async () => {
    const id = await start();
    const reviewed = harness.session(id).resultHash;
    // Configuration changes between mutations (spec Constraints): stricter thresholds
    // exclude the medication. The graph, and so its fingerprint, is unchanged.
    const stricter = makeEnv(nodes(), edges, SAFETY);
    stricter.resolution.thresholds = { autoResolveThreshold: 0.95, suggestThreshold: 0.95 };
    harness.addPathway('pw-gen', stricter);

    const r = await generate(id, reviewed);

    expect(r).toMatchObject({ success: false, carePlanId: null });
    expect(r.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'PLAN_CHANGED_SINCE_REVIEW' })]);
    expect(harness.row(id).result_hash).not.toBe(reviewed);
    expect(harness.row(id).status).toBe('ACTIVE');
    expect(carePlanInsertCount()).toBe(0);
  });

  it('returns the readiness blockers, and inserts nothing, when the plan is not ready', async () => {
    harness.addPathway('pw-unmapped', makeEnv(nodes('Unobtainium'), edges, SAFETY));
    const id = await start('pw-unmapped');
    const r = await generate(id, harness.session(id).resultHash);

    expect(r.success).toBe(false);
    expect(r.blockers).toContainEqual(expect.objectContaining({ scope: 'COMPLETENESS', type: 'SAFETY_DATA_UNAVAILABLE', relatedNodeIds: ['med'] }));
    expect(carePlanInsertCount()).toBe(0);
  });

  it('a safety suppression that empties the plan blocks with EMPTY_PLAN', async () => {
    const id = await start('pw-gen', [{ code: '91936005', system: 'SNOMED' }]);
    const r = await generate(id, harness.session(id).resultHash);
    expect(r.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'EMPTY_PLAN' })]);
    // The suppression that caused the blocker is what the session stores.
    expect(harness.session(id).resolutionState.get('med')!.disposition).toMatchObject({ status: 'EXCLUDED', withheldBy: 'safety' });
  });

  it('returns a moderate interaction as a text warning on a successful plan (P3-9)', async () => {
    harness.addPathway('pw-warn', makeEnv(
      [node('root', 'Pathway'), node('step', 'Step'), node('w', 'Medication', { name: 'Warfarin' }), node('a', 'Medication', { name: 'Aspirin' })],
      [edge('root', 'step'), edge('step', 'w'), edge('step', 'a')],
      {
        normalized: new Map([
          ['warfarin||', { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
          ['aspirin||', { ingredientRxcui: '1191', ingredientName: 'aspirin', atcClasses: ['B01AC06'] }],
        ]),
        pairs: new Map([['11289|1191', { severity: 'MODERATE' as const, mechanism: 'bleeding', clinicalAdvice: 'monitor INR', matchType: 'PAIR' as const, matchedClasses: null }]]),
      },
    ));
    const id = await start('pw-warn');
    const r = await generate(id, harness.session(id).resultHash);

    expect(r.success).toBe(true);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^DDI_MODERATE: (Warfarin|Aspirin) — monitor INR$/)]));
  });

  it('returns the existing care plan for a COMPLETED session without evaluating (P3-7)', async () => {
    const id = await start();
    const first = await generate(id, harness.session(id).resultHash);
    (loadEvaluationEnv as jest.Mock).mockClear();

    const again = await generate(id, 'stale-hash');

    expect(again).toEqual({ success: true, carePlanId: first.carePlanId, warnings: [], blockers: [] });
    expect(loadEvaluationEnv).not.toHaveBeenCalled();
    expect(carePlanInsertCount()).toBe(1);
  });

  it('claims before inserting: a lost race inserts no care plan rows, and the retry succeeds (#8)', async () => {
    const id = await start();
    harness.loseNextRaces(1);

    const r = await generate(id, harness.session(id).resultHash);

    expect(r.success).toBe(true);
    expect(carePlanInsertCount()).toBe(1);
  });

  it('reloads and re-evaluates when its cache write loses a race, instead of returning stale blockers (review P2)', async () => {
    harness.addPathway('pw-unmapped', makeEnv(nodes('Unobtainium'), edges, SAFETY));
    const id = await start('pw-unmapped');
    const reviewed = harness.session(id).resultHash;
    let raced = false;
    harness.onBeforeWrite((row) => {
      if (raced) return;
      raced = true;
      row.revision += 1; // another writer added a fact first
      row.additional_context = { medications: [{ code: '999', system: 'RxNorm', display: 'Mysterydrug' }] };
    });
    (loadEvaluationEnv as jest.Mock).mockClear();

    const r = await generate(id, reviewed);

    expect(loadEvaluationEnv).toHaveBeenCalledTimes(2);
    // Stale would be attempt 1's SAFETY_DATA_UNAVAILABLE for `med` alone. The state that won
    // has a new fact, so the plan the provider reviewed no longer exists.
    expect(r.blockers).toEqual([expect.objectContaining({ type: 'PLAN_CHANGED_SINCE_REVIEW' })]);
    expect(harness.row(id).result_hash).not.toBe(reviewed);
    expect(harness.row(id).revision).toBe(2);
  });

  it('writes the audit rows of its LLM calls when a concurrent generation completes the session first (review P2)', async () => {
    harness.addPathway('pw-llm', makeEnv(
      [
        node('root', 'Pathway'), node('stage', 'Stage'),
        node('gate-llm', 'Gate', {
          gate_type: GateType.LLM_TEXT_ANALYSIS, default_behavior: DefaultBehavior.SKIP, prompt: 'Urgent?',
          input_attribute: 'freeformData.narrative', confidence_threshold: 0.75,
          branches: [{ name: 'urgent', description: 'same day' }, { name: 'routine', description: 'can wait', is_safe_default: true }],
        }),
        node('step', 'Step'), node('med', 'Medication', { name: 'Amoxicillin' }),
      ],
      [edge('root', 'stage'), edge('stage', 'gate-llm'), edge('gate-llm', 'step'), edge('step', 'med')],
      SAFETY,
    ));
    (loadLLMGateConfig as jest.Mock).mockReturnValue({ baseUrl: 'http://llm', apiKey: 'k', model: 'test-model', timeoutMs: 1000 });
    (evaluateGateWithLLM as jest.Mock)
      .mockRejectedValueOnce(new Error('timeout')) // at start: UNAVAILABLE, so nothing is stored to reuse
      .mockResolvedValue({ chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', rawResponse: {}, model: 'test-model', latencyMs: 1 });
    const id = await start('pw-llm');
    const reviewed = harness.session(id).resultHash;
    harness.onBeforeWrite((row) => {
      if (row.status !== 'ACTIVE') return;
      Object.assign(row, { status: 'COMPLETED', care_plan_id: 'care-plan-x', revision: row.revision + 1 });
    });

    const r = await generate(id, reviewed);

    expect(r).toEqual({ success: true, carePlanId: 'care-plan-x', warnings: [], blockers: [] });
    expect(harness.tables.audits).toEqual([
      { sessionId: id, gateId: 'gate-llm', errorMessage: 'timeout' }, // written with the session at start
      { sessionId: id, gateId: 'gate-llm', errorMessage: null },      // generation's call, written on the COMPLETED exit
    ]);
  });

  it('refuses an ABANDONED session', async () => {
    const id = await start();
    await resolutionMutations.abandonSession(null, { sessionId: id }, harness.context());
    await expect(generate(id, harness.session(id).resultHash)).rejects.toThrow(/abandoned/);
  });
});
