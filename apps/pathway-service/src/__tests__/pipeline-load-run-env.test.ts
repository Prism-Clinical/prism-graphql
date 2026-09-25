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
import { loadRunEnv, runEnvOf } from '../services/resolution/pipeline/load-env';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const SCORING = {
  adminEvidenceEntries: [], weightMatrix: {}, nodeWeightMap: new Map(), propagationOverrides: new Map(),
  thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6, scope: 'SYSTEM_DEFAULT' },
};
const med = (id: string, name: string) => ({ id, nodeIdentifier: id, nodeType: 'Medication', properties: { name } });
const rctx = (meds: unknown[], suggestThreshold = 0.6) => ({
  graphContext: buildGraphContext([{ id: 'r', nodeIdentifier: 'root', nodeType: 'Pathway', properties: {} }, ...meds] as never, []),
  edges: [], signals: [],
  thresholds: { autoResolveThreshold: 0.85, suggestThreshold },
  confidenceEngine: { loadScoringConfig: jest.fn().mockResolvedValue(SCORING) },
  codeMap: new Map(), temporalDefaults: {},
});
const norm = (rxcui: string, name: string) => ({ ingredientRxcui: rxcui, ingredientName: name, atcClasses: [] });
const SAFETY = { normalized: new Map([['labetalol||', norm('6185', 'labetalol')]]), pairs: new Map(), classRules: [], allergyMappings: [] };
const PATIENT = {
  patientId: 'p', conditionCodes: [], labResults: [],
  medications: [{ code: '999', system: 'RxNorm', display: 'Mysterydrug' }],
  allergies: [{ code: '91936005', system: 'SNOMED' }],
} as never;
const META = [
  { id: 'a', logical_id: 'lp-a', title: 'A', version: '1.0' },
  { id: 'b', logical_id: 'lp-b', title: 'B', version: '2.0' },
];

function db() {
  const client = {
    query: jest.fn(async (sql: string) => ({ rows: String(sql).includes('pathway_graph_index') ? META : [] })),
    release: jest.fn(),
  };
  return { client, pool: { connect: jest.fn().mockResolvedValue(client) } };
}
const graphs = (bThreshold = 0.6) => async (_db: unknown, id: string) =>
  (id === 'a' ? rctx([med('m1', 'Labetalol')]) : rctx([med('m2', 'Nifedipine')], bThreshold));

beforeEach(() => {
  (buildResolutionContext as jest.Mock).mockReset().mockImplementation(graphs());
  (loadSafetyReference as jest.Mock).mockReset().mockResolvedValue(SAFETY);
});

describe('loadRunEnv (C4, D13)', () => {
  it('reads every child graph, the pathway metadata and ONE safety reference in one snapshot', async () => {
    const { client, pool } = db();
    const env = await loadRunEnv(pool as never, ['a', 'b'], { patient: PATIENT, writeIns: ['Tinidazole'] });

    expect(pool.connect).toHaveBeenCalledTimes(1);
    const sql = client.query.mock.calls.map((c) => String(c[0]));
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.filter((s) => s.includes('FROM pathway_graph_index'))).toHaveLength(1);
    expect(buildResolutionContext).toHaveBeenCalledTimes(2);
    expect(loadSafetyReference).toHaveBeenCalledTimes(1);
    const { medications, allergySnomedCodes } = (loadSafetyReference as jest.Mock).mock.calls[0][1];
    expect(medications.map((m: { text: string }) => m.text)).toEqual(['Labetalol', 'Nifedipine', 'Mysterydrug', 'Tinidazole']);
    expect(allergySnomedCodes).toEqual(['91936005']);

    expect(env.children.get('a')!.safety).toBe(env.safety);
    expect(env.children.get('b')!.safety).toBe(env.safety);
    expect(env.meta.get('b')).toEqual({ logicalId: 'lp-b', title: 'B', version: '2.0' });
    expect(env.unnormalized.map((m) => m.text)).toEqual(['Nifedipine', 'Mysterydrug', 'Tinidazole']);
    expect(client.release).toHaveBeenCalled();
  });

  it('the run fingerprint moves when one child’s configuration moves; the other child’s does not', async () => {
    const first = await loadRunEnv(db().pool as never, ['a', 'b'], { patient: PATIENT });
    (buildResolutionContext as jest.Mock).mockImplementation(graphs(0.7));
    const second = await loadRunEnv(db().pool as never, ['a', 'b'], { patient: PATIENT });

    expect(second.children.get('a')!.envFingerprint).toBe(first.children.get('a')!.envFingerprint);
    expect(second.children.get('b')!.envFingerprint).not.toBe(first.children.get('b')!.envFingerprint);
    expect(second.envFingerprint).not.toBe(first.envFingerprint);
  });

  it('rolls back and releases on failure', async () => {
    (buildResolutionContext as jest.Mock).mockRejectedValue(new Error('age down'));
    const { client, pool } = db();
    await expect(loadRunEnv(pool as never, ['a'], { patient: PATIENT })).rejects.toThrow('age down');
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('a run with no pathways reads no graph and no metadata, and still loads the patient’s safety data', async () => {
    const { client, pool } = db();
    const env = await loadRunEnv(pool as never, [], { patient: PATIENT });
    expect(buildResolutionContext).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some((c) => String(c[0]).includes('pathway_graph_index'))).toBe(false);
    expect(loadSafetyReference).toHaveBeenCalledTimes(1);
    expect(env.children.size).toBe(0);
  });
});

describe('runEnvOf', () => {
  it('points every child at one merged safety reference and fingerprints independently of order', () => {
    const a = makeEnv([node('root', 'Pathway')], [], { normalized: new Map([['x||', norm('1', 'x')]]) });
    const b = { ...makeEnv([node('root', 'Pathway'), node('s', 'Step')], [edge('root', 's')], { normalized: new Map([['y||', norm('2', 'y')]]) }), envFingerprint: 'env-b' };
    const meta = new Map();
    const ab = runEnvOf(new Map([['a', a], ['b', b]]), meta);
    const ba = runEnvOf(new Map([['b', b], ['a', a]]), meta);

    expect([...ab.safety.normalized.keys()].sort()).toEqual(['x||', 'y||']);
    expect(ab.children.get('a')!.safety).toBe(ab.safety);
    expect(ab.envFingerprint).toBe(ba.envFingerprint);
    expect(runEnvOf(new Map([['a', a]]), meta).envFingerprint).not.toBe(ab.envFingerprint);
  });
});
