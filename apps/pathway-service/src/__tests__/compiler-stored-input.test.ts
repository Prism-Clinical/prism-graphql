// apps/pathway-service/src/__tests__/compiler-stored-input.test.ts
import { COMPILE_CACHE_CAPACITY, compileCached, compileCacheSize } from '../services/compiler/cache';
import { compileInputFrom, loadStoredCompileInput } from '../services/compiler/stored-input';
import { compilePathway } from '../services/compiler/compile';
import { pathwayJsonFromStoredGraph } from '../services/import/stored-graph';
import { buildResolutionContext, fetchGraphFromAGE } from '../resolvers/helpers/resolution-context';
import { Mutation } from '../resolvers/Mutation';

jest.mock('../services/medications/prewarm-pathway', () => ({ prewarmPathwayInBackground: jest.fn() }));

const index = {
  row: { id: 'pw', ageNodeId: '42', logicalId: 'CP-Minimal', title: 'Minimal Test Pathway', version: '1.0', category: 'ACUTE_CARE', scope: null, targetPopulation: null, temporalDefaults: null },
  conditionCodes: [{ code: 'J06.9', system: 'ICD-10' }],
};
const node = (id: string, nodeType: string, properties: Record<string, unknown>) => ({ id: `age-${id}`, nodeIdentifier: id, nodeType, properties });
const edge = (sourceId: string, targetId: string, edgeType: string) => ({ id: `${sourceId}-${targetId}`, sourceId, targetId, edgeType, properties: null as never });
const nodes = [
  node('root', 'Pathway', { title: 'Minimal Test Pathway', node_id: 'root' }),
  node('stage-1', 'Stage', { stage_number: 1, title: 'Assessment', node_id: 'stage-1', pathway_version: '1.0' }),
  node('step-1-1', 'Step', { stage_number: 1, step_number: 1, display_number: '1.1', title: 'Initial Evaluation' }),
];
const edges = [edge('root', 'stage-1', 'HAS_STAGE'), edge('stage-1', 'step-1-1', 'HAS_STEP')];

describe('compileInputFrom', () => {
  it('keeps exactly one root and strips the graph writer stamps', () => {
    const input = compileInputFrom(index, nodes, edges, new Map());
    expect(input.pathway.nodes.map((n) => n.id)).toEqual(['stage-1', 'step-1-1']);
    expect(input.pathway.nodes[0].properties).toEqual({ stage_number: 1, title: 'Assessment' });
    expect(input.temporalDefaults).toEqual({});
    const r = compileCached(input);
    expect(r.ok && r.model.order).toEqual(['root', 'stage-1', 'step-1-1']);
  });
});

describe('compileCached', () => {
  it('returns the same result object for the same content, and recompiles when the code map changes', () => {
    const input = compileInputFrom(index, nodes, edges, new Map());
    const a = compileCached(input);
    expect(compileCached(compileInputFrom(index, nodes, edges, new Map()))).toBe(a);
    const other = compileCached(compileInputFrom(index, nodes, edges, new Map([['lab.x', { attributeName: 'lab.x', namespace: 'lab', system: 'LOINC', code: '1-1', valueType: 'number' }]])));
    expect(other).not.toBe(a);
  });

  it('a cache hit and a fresh compile agree even when the code map was built in another order', () => {
    const rows = [
      { attributeName: 'lab.a', namespace: 'lab', system: 'LOINC', code: '1-1', valueType: 'string' as const },
      { attributeName: 'lab.b', namespace: 'lab', system: 'LOINC', code: '1-1', valueType: 'number' as const },
    ];
    const one = compileInputFrom(index, nodes, edges, new Map(rows.map((r) => [r.attributeName, r])));
    const two = compileInputFrom(index, nodes, edges, new Map([...rows].reverse().map((r) => [r.attributeName, r])));
    expect(compileCached(two)).toEqual(compilePathway(two));
    expect(compileCached(one)).toEqual(compilePathway(one));
  });

  it('shares an entry for a reordered copy and stays within capacity', () => {
    const input = compileInputFrom(index, nodes, edges, new Map());
    const a = compileCached(input);
    expect(compileCached({ ...input, pathway: { ...input.pathway, nodes: [...input.pathway.nodes].reverse(), edges: [...input.pathway.edges].reverse() } })).toBe(a);
    for (let i = 0; i <= COMPILE_CACHE_CAPACITY; i += 1) {
      compileCached({ ...input, pathway: { ...input.pathway, pathway: { ...input.pathway.pathway, title: `t${i}` } } });
    }
    expect(compileCacheSize()).toBe(COMPILE_CACHE_CAPACITY);
  });
});

describe('pathwayJsonFromStoredGraph', () => {
  it('drops the stored Pathway root node but keeps root-anchored edges', () => {
    const pw = pathwayJsonFromStoredGraph({
      pathway: index.row, conditionCodes: index.conditionCodes,
      nodes: nodes.map((n) => ({ id: n.nodeIdentifier, type: n.nodeType, properties: n.properties })),
      edges: edges.map((e) => ({ from: e.sourceId, to: e.targetId, type: e.edgeType, properties: {} })),
    });
    expect(pw.nodes.some((n) => n.id === 'root')).toBe(false);
    expect(pw.edges[0].from).toBe('root');
  });

  it('keeps a stored non-Pathway node that uses the id "root", so the compiler can refuse it', () => {
    const shadow = { id: 'root', type: 'Stage', properties: { stage_number: 2, title: 'Shadow' } };
    const pw = pathwayJsonFromStoredGraph({
      pathway: index.row, conditionCodes: index.conditionCodes,
      nodes: [...nodes.map((n) => ({ id: n.nodeIdentifier, type: n.nodeType, properties: n.properties })), shadow],
      edges: [],
    });
    expect(pw.nodes.filter((n) => n.id === 'root')).toEqual([shadow]);
  });
});

/**
 * The real stored-read path: rows as AGE returns them, through fetchGraphFromAGE's
 * node_id dedup. A disconnected Stage stored with node_id "root" shares its identity
 * with the Pathway root; whichever vertex AGE returns first, compilation must see it.
 */
describe('stored reads keep identity conflicts visible to the compiler', () => {
  const tags = { pathway_logical_id: 'CP-Minimal', pathway_version: '1.0' };
  const vertex = (id: number, label: string, properties: Record<string, unknown>) => ({ v: `${JSON.stringify({ id, label, properties })}::vertex` });
  const ROOT = vertex(42, 'Pathway', { node_id: 'root', logical_id: 'CP-Minimal', version: '1.0', title: 'Minimal Test Pathway' });
  const SHADOW = vertex(49, 'Stage', { node_id: 'root', node_type: 'Stage', stage_number: 2, title: 'Shadow', ...tags });
  const rest = [
    vertex(43, 'Stage', { node_id: 'stage-1', node_type: 'Stage', stage_number: 1, title: 'Assessment', ...tags }),
    vertex(44, 'Step', { node_id: 'step-1-1', node_type: 'Step', stage_number: 1, step_number: 1, display_number: '1.1', title: 'Initial Evaluation', ...tags }),
  ];
  const ageEdge = (id: number, label: string, a: { v: string }, b: { v: string }) => ({ a: a.v, r: `${JSON.stringify({ id, label, start_id: 0, end_id: 0, properties: {} })}::edge`, b: b.v });
  const EDGES = [ageEdge(90, 'HAS_STAGE', ROOT, rest[0]), ageEdge(91, 'HAS_STEP', rest[0], rest[1])];

  /** One client answering the index, code-set, AGE and code-map reads (and, for activation, the lock). */
  function ageClient(vertices: { v: string }[], status = 'DRAFT') {
    const query = jest.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes('FOR UPDATE')) return { rows: [{ id: 'pw', status }] };
      if (s.startsWith('WITH')) return { rows: [{ id: 'pw', status: 'ACTIVE', previousStatus: status }] };
      if (s.includes('SELECT age_node_id')) return { rows: [{ age_node_id: '42', temporal_defaults: null }] };
      if (s.includes('age_node_id AS')) return { rows: [index.row] };
      if (s.includes('pathway_code_set_members')) return { rows: index.conditionCodes };
      if (s.includes('RETURN p.logical_id')) return { rows: [{ lid: '"CP-Minimal"', ver: '"1.0"' }] };
      if (s.includes('RETURN a, r, b')) return { rows: EDGES };
      if (s.includes('RETURN n')) return { rows: vertices };
      return { rows: [] };
    });
    const client = { query, release: jest.fn() };
    return { client, query, ctx: { pool: { query, connect: jest.fn(async () => client) }, redis: {}, userId: 'u', userRole: 'PROVIDER' } as never };
  }
  const orders: [string, { v: string }[]][] = [
    ['Pathway root first', [ROOT, ...rest, SHADOW]],
    ['shadow Stage first', [SHADOW, ROOT, ...rest]],
  ];
  const codesOf = (r: ReturnType<typeof compilePathway>) => (r.ok ? [] : r.errors.map((e) => e.code));

  it('a clean stored graph still compiles through the real reader', async () => {
    const input = await loadStoredCompileInput(ageClient([ROOT, ...rest]).client as never, 'pw');
    expect(compilePathway(input!).ok).toBe(true);
  });

  it.each(orders)('refuses the shadow (%s)', async (_label, vertices) => {
    const input = await loadStoredCompileInput(ageClient(vertices).client as never, 'pw');
    expect(codesOf(compilePathway(input!))).toContain('RESERVED_ROOT');
  });

  it.each(orders)('the rendering read still returns one logical node per node_id (%s)', async (_label, vertices) => {
    const { nodes } = await fetchGraphFromAGE(ageClient(vertices).client as never, '42');
    expect(nodes.map((n) => n.nodeIdentifier).sort()).toEqual(['root', 'stage-1', 'step-1-1']);
  });

  it.each(orders)('the evaluation snapshot compiles the shadow too (%s)', async (_label, vertices) => {
    const resolution = await buildResolutionContext(ageClient(vertices).client as never, 'pw');
    const input = compileInputFrom(index, [...resolution.graphContext.allNodes, ...(resolution.shadowedNodes ?? [])], resolution.edges, resolution.codeMap);
    expect(codesOf(compilePathway(input))).toContain('RESERVED_ROOT');
  });

  it.each([
    ['activatePathway', 'DRAFT', 'Cannot activate'],
    ['reactivatePathway', 'ARCHIVED', 'Cannot reactivate'],
  ] as const)('%s refuses it in either order and writes no status', async (mutation, status, message) => {
    for (const [, vertices] of orders) {
      const { ctx, query } = ageClient(vertices, status);
      await expect(Mutation.Mutation[mutation]({}, { id: 'pw' }, ctx)).rejects.toMatchObject({
        message: expect.stringContaining(message),
        extensions: { code: 'BAD_USER_INPUT', compileErrors: expect.arrayContaining([expect.objectContaining({ code: 'RESERVED_ROOT' })]) },
      });
      const sqls = query.mock.calls.map(([s]) => String(s));
      // Neither the target's status nor the current ACTIVE version is touched: the status CTE never runs.
      expect(sqls.some((s) => s.startsWith('WITH') || /^\s*UPDATE/.test(s))).toBe(false);
      expect(sqls.at(-1)).toBe('ROLLBACK');
    }
  });
});
