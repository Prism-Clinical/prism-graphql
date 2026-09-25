jest.mock('../resolvers/helpers/resolution-context', () => {
  const actual = jest.requireActual('../resolvers/helpers/resolution-context');
  return { ...actual, buildResolutionContext: jest.fn() };
});
jest.mock('../services/medications/safety-reference', () => {
  const actual = jest.requireActual('../services/medications/safety-reference');
  return { ...actual, loadSafetyReference: jest.fn() };
});
jest.mock('../services/llm/llm-gate-client', () => ({ loadLLMGateConfig: () => ({ model: 'm1' }) }));

import { buildGraphContext, buildResolutionContext } from '../resolvers/helpers/resolution-context';
import { loadSafetyReference } from '../services/medications/safety-reference';
import { graphFingerprintOf, loadEvaluationEnv } from '../services/resolution/pipeline/load-env';

const nodes = [
  { id: '1', nodeIdentifier: 'root', nodeType: 'Pathway', properties: {} },
  { id: '2', nodeIdentifier: 'med', nodeType: 'Medication', properties: { name: 'Labetalol' } },
];
const edges = [{ id: 'e', edgeType: 'HAS_CHILD', sourceId: 'root', targetId: 'med', properties: {} }];
const scoring = { adminEvidenceEntries: [], weightMatrix: {}, nodeWeightMap: new Map(), propagationOverrides: new Map(), thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6, scope: 'SYSTEM_DEFAULT' } };
const rctx = (threshold = 0.6, order = nodes) => ({
  graphContext: buildGraphContext(order as never, edges as never), edges, signals: [],
  thresholds: { autoResolveThreshold: 0.85, suggestThreshold: threshold },
  confidenceEngine: { loadScoringConfig: jest.fn().mockResolvedValue(scoring) },
  codeMap: new Map(), temporalDefaults: {},
});
const safety = { normalized: new Map([['labetalol||', { ingredientRxcui: '6185', ingredientName: 'labetalol', atcClasses: ['C07AG01'] }]]), pairs: new Map(), classRules: [], allergyMappings: [] };
const patient = { patientId: 'p', conditionCodes: [], labResults: [],
  medications: [{ code: '999', system: 'RxNorm', display: 'Mysterydrug' }],
  allergies: [{ code: '91936005', system: 'SNOMED' }, { code: '7980', system: 'RXNORM' }] };

function db() {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  return { client, pool: { connect: jest.fn().mockResolvedValue(client) } };
}

beforeEach(() => {
  (buildResolutionContext as jest.Mock).mockReset().mockResolvedValue(rctx());
  (loadSafetyReference as jest.Mock).mockReset().mockResolvedValue(safety);
});

describe('loadEvaluationEnv', () => {
  it('reads everything on one client inside a read-only repeatable-read snapshot', async () => {
    const { client, pool } = db();
    const env = await loadEvaluationEnv(pool as never, 'pw', { patient: patient as never, writeIns: ['Tinidazole'] });

    expect(client.query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(client.query.mock.calls.at(-1)![0]).toBe('COMMIT');
    expect((buildResolutionContext as jest.Mock).mock.calls[0][0]).toBe(client);
    expect((loadSafetyReference as jest.Mock).mock.calls[0]).toEqual([client, {
      medications: [{ text: 'Labetalol' }, { text: 'Mysterydrug', system: 'RxNorm', code: '999' }, { text: 'Tinidazole' }],
      allergySnomedCodes: ['91936005'],
    }]);
    expect(client.release).toHaveBeenCalled();
    expect(env.llmModel).toBe('m1');
    expect(env.unnormalized).toEqual([
      { text: 'Mysterydrug', system: 'RxNorm', code: '999' },
      { text: 'Tinidazole' },
    ]);
  });

  it('rolls back and releases on failure', async () => {
    const { client, pool } = db();
    (buildResolutionContext as jest.Mock).mockRejectedValue(new Error('age down'));

    await expect(loadEvaluationEnv(pool as never, 'pw', { patient: patient as never })).rejects.toThrow('age down');
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('graph fingerprint ignores node order; env fingerprint tracks configuration', async () => {
    expect(graphFingerprintOf(rctx(0.6, [...nodes].reverse()) as never)).toBe(graphFingerprintOf(rctx() as never));

    const a = await loadEvaluationEnv(db().pool as never, 'pw', { patient: patient as never });
    (buildResolutionContext as jest.Mock).mockResolvedValue(rctx(0.7));
    const b = await loadEvaluationEnv(db().pool as never, 'pw', { patient: patient as never });
    expect(b.graphFingerprint).toBe(a.graphFingerprint);
    expect(b.envFingerprint).not.toBe(a.envFingerprint);
  });
});
