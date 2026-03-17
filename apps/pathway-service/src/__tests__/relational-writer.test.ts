import {
  writePathwayIndex,
  writeConditionCodes,
  writeVersionDiff,
} from '../services/import/relational-writer';
import { REFERENCE_PATHWAY } from './fixtures/reference-pathway';
import { ImportDiffSummary, DiffDetail } from '../services/import/types';

// Mock PG client
function createMockClient() {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  return {
    query: jest.fn(async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      // Return a fake row for INSERT ... RETURNING
      return {
        rows: [{
          id: '00000000-0000-4000-a000-000000000099',
          age_node_id: null,
          logical_id: 'CP-PriorUterineSurgery',
          title: 'Prior Uterine Surgery Management',
          version: '1.0',
          category: 'OBSTETRIC',
          status: 'DRAFT',
          condition_codes: ['O34.211', 'O34.29'],
          is_active: false,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      };
    }),
    queries,
  };
}

describe('writePathwayIndex', () => {
  it('should INSERT into pathway_graph_index with correct values', async () => {
    const client = createMockClient();
    const meta = REFERENCE_PATHWAY.pathway;
    await writePathwayIndex(client as any, meta, 'age-node-123', 'user-1');

    expect(client.query).toHaveBeenCalledTimes(1);
    const call = client.queries[0];
    expect(call.text).toContain('INSERT INTO pathway_graph_index');
    expect(call.values).toContain('CP-PriorUterineSurgery');
    expect(call.values).toContain('Prior Uterine Surgery Management');
    expect(call.values).toContain('1.0');
    expect(call.values).toContain('OBSTETRIC');
    expect(call.values).toContain('age-node-123');
  });
});

describe('writeConditionCodes', () => {
  it('should INSERT one row per condition code', async () => {
    const client = createMockClient();
    const pathwayId = '00000000-0000-4000-a000-000000000099';
    await writeConditionCodes(client as any, pathwayId, REFERENCE_PATHWAY.pathway.condition_codes);

    expect(client.query).toHaveBeenCalledTimes(2); // 2 condition codes
    for (const q of client.queries) {
      expect(q.text).toContain('INSERT INTO pathway_condition_codes');
    }
  });

  it('should skip if no condition codes', async () => {
    const client = createMockClient();
    await writeConditionCodes(client as any, 'pid', []);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('writeVersionDiff', () => {
  it('should INSERT into pathway_version_diffs', async () => {
    const client = createMockClient();
    const summary: ImportDiffSummary = { nodesAdded: 5, nodesRemoved: 0, nodesModified: 0, edgesAdded: 3, edgesRemoved: 0, edgesModified: 0 };
    const details: DiffDetail[] = [{ entityType: 'node', action: 'added', entityId: 'stage-1', entityLabel: 'Stage' }];

    await writeVersionDiff(client as any, 'pw-id', null, 'NEW_PATHWAY', summary, details, 'user-1');

    expect(client.query).toHaveBeenCalledTimes(1);
    const call = client.queries[0];
    expect(call.text).toContain('INSERT INTO pathway_version_diffs');
    expect(call.values).toContain('NEW_PATHWAY');
  });
});
