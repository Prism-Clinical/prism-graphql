// apps/pathway-service/src/__tests__/compiler-stored-input.test.ts
import { COMPILE_CACHE_CAPACITY, compileCached, compileCacheSize } from '../services/compiler/cache';
import { compileInputFrom } from '../services/compiler/stored-input';
import { compilePathway } from '../services/compiler/compile';
import { pathwayJsonFromStoredGraph } from '../services/import/stored-graph';

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
