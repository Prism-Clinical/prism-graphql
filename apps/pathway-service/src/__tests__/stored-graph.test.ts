import { pathwayJsonFromStoredGraph } from '../services/import/stored-graph';

// The stored graph always carries the system-internal props the graph writer
// stamps on every node, plus a synthetic `root` Pathway node. Both have to be
// handled before the JSON can be handed to validatePathwayJson.
const STORED_NODES = [
  { id: 'root', type: 'Pathway', properties: { node_id: 'root', logical_id: 'test-v1', version: '1.0' } },
  {
    id: 'stage-1',
    type: 'Stage',
    properties: {
      node_id: 'stage-1',
      node_type: 'Stage',
      pathway_logical_id: 'test-v1',
      pathway_version: '1.0',
      stage_number: 1,
      title: 'Assessment',
    },
  },
];

const STORED_EDGES = [
  { from: 'root', to: 'stage-1', type: 'HAS_STAGE' },
];

const INDEX_ROW = {
  logicalId: 'test-v1',
  title: 'Test Pathway',
  version: '1.0',
  category: 'OBSTETRIC',
};

describe('pathwayJsonFromStoredGraph', () => {
  it('reconstructs a PathwayJson the validator accepts', () => {
    const pw = pathwayJsonFromStoredGraph({
      pathway: INDEX_ROW,
      conditionCodes: [{ code: 'N76.0', system: 'ICD-10' }],
      nodes: STORED_NODES,
      edges: STORED_EDGES,
    });

    expect(pw.schema_version).toBe('1.0');
    expect(pw.pathway.logical_id).toBe('test-v1');
    expect(pw.pathway.category).toBe('OBSTETRIC');
    expect(pw.pathway.condition_codes).toEqual([{ code: 'N76.0', system: 'ICD-10' }]);
  });

  // The Pathway root is synthetic — `root` is not a member of the node list in
  // authored JSON, and leaving it in makes the validator reject the graph on a
  // node type it does not recognise.
  it('drops the synthetic Pathway root from nodes but keeps root edges', () => {
    const pw = pathwayJsonFromStoredGraph({
      pathway: INDEX_ROW,
      conditionCodes: [{ code: 'N76.0', system: 'ICD-10' }],
      nodes: STORED_NODES,
      edges: STORED_EDGES,
    });

    expect(pw.nodes.map((n) => n.id)).toEqual(['stage-1']);
    expect(pw.edges).toEqual([{ from: 'root', to: 'stage-1', type: 'HAS_STAGE' }]);
  });

  it('keeps authored properties and strips the graph writer stamps', () => {
    const pw = pathwayJsonFromStoredGraph({
      pathway: INDEX_ROW,
      conditionCodes: [{ code: 'N76.0', system: 'ICD-10' }],
      nodes: STORED_NODES,
      edges: STORED_EDGES,
    });

    expect(pw.nodes[0].properties).toEqual({ stage_number: 1, title: 'Assessment' });
  });

  it('tolerates a pathway with no condition codes rather than throwing', () => {
    const pw = pathwayJsonFromStoredGraph({
      pathway: INDEX_ROW,
      conditionCodes: [],
      nodes: STORED_NODES,
      edges: STORED_EDGES,
    });
    expect(pw.pathway.condition_codes).toEqual([]);
  });
});
