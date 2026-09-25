/**
 * `pathwayGraph.codeSets` round-trip: what the admin editor reads back is
 * enough to write the same code sets again.
 *
 * The editor rebuilds pathway metadata from `pathwayGraph` and autosaves it as
 * a DRAFT_UPDATE, which REPLACES the stored code sets (deleteCodeSets +
 * writeCodeSets). Before `codeSets` existed it could only send condition_codes,
 * so every save rewrote the sets as one single-code set per condition code —
 * an ALL_OF set ("these codes together") silently became OR. Each shape below
 * is imported, read through the real resolver, mapped back to import JSON the
 * way the editor must, re-imported as a DRAFT_UPDATE, and the stored rows
 * compared.
 */
jest.mock('../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../resolvers/helpers/resolution-context'),
  fetchGraphFromAGE: jest.fn(async () => ({ nodes: [] as unknown[], edges: [] as unknown[] })),
}));

import { importPathway } from '../services/import/import-orchestrator';
import { Query } from '../resolvers/Query';
import { CodeSetDefinition, ImportMode, PathwayJson } from '../services/import/types';
import { MINIMAL_PATHWAY, clonePathway } from './fixtures/reference-pathway';
import { FakePathwayStore } from './fixtures/fake-pathway-store';

type GraphCodeSet = {
  id: string;
  description: string | null;
  scope: string;
  entryNodeId: string | null;
  requiredCodes: Array<{ code: string; system: string; scopeOverride: string | null; description: string | null }>;
};

/**
 * The mapping the editor needs: camelCase → import keys, nulls omitted (the
 * validator rejects `scope_override: null`), storage id dropped.
 */
function toImportCodeSets(codeSets: GraphCodeSet[]): CodeSetDefinition[] {
  return codeSets.map((s) => {
    const out: CodeSetDefinition = {
      scope: s.scope as CodeSetDefinition['scope'],
      required_codes: s.requiredCodes.map((m) => {
        const member: CodeSetDefinition['required_codes'][number] = { code: m.code, system: m.system };
        if (m.scopeOverride != null) member.scope_override = m.scopeOverride as CodeSetDefinition['scope'];
        if (m.description != null) member.description = m.description;
        return member;
      }),
    };
    if (s.description != null) out.description = s.description;
    if (s.entryNodeId != null) out.entry_node_id = s.entryNodeId;
    return out;
  });
}

async function readGraph(store: FakePathwayStore, pathwayId: string) {
  const graph = await Query.Query.pathwayGraph({}, { id: pathwayId }, { pool: store.pool } as any);
  if (!graph) throw new Error('pathwayGraph returned null');
  return graph as unknown as {
    pathway: { logicalId: string; title: string; version: string; category: string; conditionCodes: string[]; scope: string | null; targetPopulation: string | null };
    conditionCodeDetails: Array<{ code: string; system: string; description: string | null; usage: string | null; grouping: null }>;
    codeSets: GraphCodeSet[];
  };
}

/** The editor's save: header rebuilt from pathwayGraph, graph body unchanged. */
function jsonFromGraph(
  graph: Awaited<ReturnType<typeof readGraph>>,
  body: PathwayJson,
  opts: { withCodeSets: boolean },
): PathwayJson {
  const systemOf = new Map(graph.conditionCodeDetails.map((r) => [r.code, r.system]));
  return {
    schema_version: '1.0',
    pathway: {
      logical_id: graph.pathway.logicalId,
      title: graph.pathway.title,
      version: graph.pathway.version,
      category: graph.pathway.category,
      ...(graph.pathway.scope != null ? { scope: graph.pathway.scope } : {}),
      ...(graph.pathway.targetPopulation != null ? { target_population: graph.pathway.targetPopulation } : {}),
      condition_codes: graph.pathway.conditionCodes.map((code) => ({ code, system: systemOf.get(code) ?? 'ICD-10' })),
      ...(opts.withCodeSets ? { code_sets: toImportCodeSets(graph.codeSets) } : {}),
    },
    nodes: body.nodes,
    edges: body.edges,
  };
}

async function importInto(store: FakePathwayStore, json: PathwayJson, mode: 'NEW_PATHWAY' | 'DRAFT_UPDATE' | 'NEW_VERSION') {
  store.expectEdgesOf(json);
  const result = await importPathway(store.pool, json, mode as ImportMode, 'user-1');
  if (!result.validation.valid) throw new Error(`${mode} rejected: ${result.validation.errors.join('; ')}`);
  return result;
}

function pathwayWith(header: Partial<PathwayJson['pathway']>): PathwayJson {
  const pw = clonePathway(MINIMAL_PATHWAY);
  pw.pathway = { ...pw.pathway, ...header };
  return pw;
}

const T2DM = { code: 'E11.9', system: 'ICD-10' };
const HTN = { code: 'I10', system: 'ICD-10' };
const CKD = { code: 'N18.3', system: 'ICD-10' };
const T2DM_SNOMED = { code: '44054006', system: 'SNOMED' };

const SHAPES: Array<[string, PathwayJson]> = [
  [
    'one AND set equal to the condition codes',
    pathwayWith({
      condition_codes: [T2DM, HTN],
      code_sets: [{ description: 'T2DM with hypertension', required_codes: [T2DM, HTN] }],
    }),
  ],
  [
    'OR sets (one single-code set per code, described)',
    pathwayWith({
      condition_codes: [T2DM, HTN],
      code_sets: [
        { description: 'Diabetes', required_codes: [{ ...T2DM, description: 'primary' }] },
        { description: 'Hypertension', required_codes: [HTN] },
      ],
    }),
  ],
  [
    'a scoped set with a per-member scope override',
    pathwayWith({
      condition_codes: [T2DM, CKD],
      code_sets: [{
        description: 'Diabetic CKD',
        scope: 'EXACT_AND_DESCENDANTS',
        required_codes: [{ ...T2DM, scope_override: 'EXACT', description: 'literal only' }, CKD],
      }],
    }),
  ],
  [
    'single-code sets adding only scope / entry_node_id',
    pathwayWith({
      condition_codes: [T2DM, HTN],
      code_sets: [
        { scope: 'DESCENDANTS_OK', required_codes: [T2DM] },
        { entry_node_id: 'stage-1', required_codes: [HTN] },
      ],
    }),
  ],
  [
    'mixed: cross-system AND set, nested broader set, entry node',
    pathwayWith({
      condition_codes: [T2DM, HTN, CKD],
      code_sets: [
        { description: 'Broad', required_codes: [T2DM] },
        { description: 'T2DM + HTN + CKD', entry_node_id: 'step-1-1', required_codes: [T2DM, HTN, CKD] },
        { description: 'Cross-system', required_codes: [T2DM_SNOMED, HTN] },
      ],
    }),
  ],
  [
    'no code_sets (importer synthesizes one set per condition code)',
    pathwayWith({
      condition_codes: [
        { ...T2DM, description: 'Type 2 diabetes', usage: 'entry diagnosis' },
        { ...HTN, description: 'Hypertension' },
      ],
    }),
  ],
];

describe('pathwayGraph.codeSets round-trip through a DRAFT_UPDATE', () => {
  it.each(SHAPES)('%s: re-importing what pathwayGraph returns stores identical code sets', async (_label, json) => {
    const store = new FakePathwayStore();
    const created = await importInto(store, json, 'NEW_PATHWAY');
    const before = store.storedCodeSets(created.pathwayId);
    const idsBefore = store.tables.sets.map((s) => s.id);
    expect(before.length).toBeGreaterThan(0);

    const graph = await readGraph(store, created.pathwayId);
    await importInto(store, jsonFromGraph(graph, json, { withCodeSets: true }), 'DRAFT_UPDATE');

    expect(store.storedCodeSets(created.pathwayId)).toEqual(before);
    // Not vacuous: the sets really were deleted and rewritten.
    const idsAfter = store.tables.sets.map((s) => s.id);
    expect(idsAfter.some((id) => idsBefore.includes(id))).toBe(false);
  });

  it('the legacy save (condition_codes only) turns the AND set into OR — the bug codeSets closes', async () => {
    const store = new FakePathwayStore();
    const json = SHAPES[0][1];
    const created = await importInto(store, json, 'NEW_PATHWAY');
    const graph = await readGraph(store, created.pathwayId);

    // The legacy fields cannot tell this pathway from plain condition codes.
    expect(graph.pathway.conditionCodes).toEqual(['E11.9', 'I10']);
    expect(graph.conditionCodeDetails.map((r) => r.code)).toEqual(['E11.9', 'I10']);

    await importInto(store, jsonFromGraph(graph, json, { withCodeSets: false }), 'DRAFT_UPDATE');
    const after = store.storedCodeSets(created.pathwayId);
    expect(after).toHaveLength(2);
    expect(after.every((s) => s.members.length === 1)).toBe(true);
  });
});

describe('pathwayGraph.codeSets shape and ordering', () => {
  const json = SHAPES[4][1];

  it('returns every set in import vocabulary, members sorted by (code, system)', async () => {
    const store = new FakePathwayStore();
    const { pathwayId } = await importInto(store, json, 'NEW_PATHWAY');
    const graph = await readGraph(store, pathwayId);

    expect(graph.codeSets.map(({ id: _id, ...rest }) => rest)).toEqual([
      {
        description: 'Cross-system', scope: 'EXACT', entryNodeId: null,
        requiredCodes: [
          { code: '44054006', system: 'SNOMED', scopeOverride: null, description: null },
          { code: 'I10', system: 'ICD-10', scopeOverride: null, description: null },
        ],
      },
      {
        description: 'Broad', scope: 'EXACT', entryNodeId: null,
        requiredCodes: [{ code: 'E11.9', system: 'ICD-10', scopeOverride: null, description: null }],
      },
      {
        description: 'T2DM + HTN + CKD', scope: 'EXACT', entryNodeId: 'step-1-1',
        requiredCodes: [
          { code: 'E11.9', system: 'ICD-10', scopeOverride: null, description: null },
          { code: 'I10', system: 'ICD-10', scopeOverride: null, description: null },
          { code: 'N18.3', system: 'ICD-10', scopeOverride: null, description: null },
        ],
      },
    ]);
    for (const s of graph.codeSets) expect(typeof s.id).toBe('string');
  });

  it('is independent of storage order, and conditionCodeDetails follows the same order', async () => {
    const store = new FakePathwayStore();
    const { pathwayId } = await importInto(store, json, 'NEW_PATHWAY');
    const forward = await readGraph(store, pathwayId);
    store.reverseSetRows = true;
    const reversed = await readGraph(store, pathwayId);

    expect(reversed.codeSets).toEqual(forward.codeSets);
    expect(reversed.conditionCodeDetails).toEqual(forward.conditionCodeDetails);
    expect(forward.conditionCodeDetails).toEqual(
      forward.codeSets.flatMap((s) => s.requiredCodes.map((m) => ({
        code: m.code, system: m.system, description: s.description, usage: m.description, grouping: null as null,
      }))),
    );
  });

  it('a synthesized pathway reads back its condition-code description / usage on the sets', async () => {
    const store = new FakePathwayStore();
    const { pathwayId } = await importInto(store, SHAPES[5][1], 'NEW_PATHWAY');
    const graph = await readGraph(store, pathwayId);
    expect(toImportCodeSets(graph.codeSets)).toEqual([
      { scope: 'EXACT', description: 'Type 2 diabetes', required_codes: [{ code: 'E11.9', system: 'ICD-10', description: 'entry diagnosis' }] },
      { scope: 'EXACT', description: 'Hypertension', required_codes: [{ code: 'I10', system: 'ICD-10' }] },
    ]);
  });
});
