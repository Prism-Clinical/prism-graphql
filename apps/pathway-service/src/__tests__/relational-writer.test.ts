import {
  writePathwayIndex,
  writeCodeSets,
  deleteCodeSets,
  writeVersionDiff,
} from '../services/import/relational-writer';
import { REFERENCE_PATHWAY, MINIMAL_PATHWAY, clonePathway } from './fixtures/reference-pathway';
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

describe('Phase 1b writers', () => {
  function createCodeSetsMockClient() {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    let setIdCounter = 0;
    return {
      query: jest.fn(async (text: string, values: unknown[] = []) => {
        queries.push({ text, values });
        // For RETURNING id queries, give back a synthetic UUID
        if (text.includes('RETURNING id')) {
          setIdCounter++;
          return {
            rows: [{ id: `00000000-0000-4000-a000-${String(setIdCounter).padStart(12, '0')}` }],
          };
        }
        return { rows: [] };
      }),
      queries,
    };
  }

  describe('writeCodeSets', () => {
    it('synthesizes one single-element set per condition_code when code_sets absent', async () => {
      const client = createCodeSetsMockClient();
      const meta = clonePathway(MINIMAL_PATHWAY).pathway;
      meta.condition_codes = [
        { code: 'I10', system: 'ICD-10', description: 'Hypertension' },
        { code: 'E11', system: 'ICD-10' },
      ];
      delete (meta as any).code_sets;

      await writeCodeSets(client as any, 'pw-1', meta);

      // 2 sets + 2 member inserts (one row per set's INSERT)
      expect(client.queries).toHaveLength(4);
      expect(client.queries[0].text).toContain('INSERT INTO pathway_code_sets');
      expect(client.queries[0].values).toEqual([
        'pw-1', 'EXACT', null, 'Hypertension',
      ]);
      expect(client.queries[1].text).toContain('INSERT INTO pathway_code_set_members');
      expect(client.queries[1].values).toEqual([
        '00000000-0000-4000-a000-000000000001', 'I10', 'ICD-10', null, null,
      ]);
    });

    it('writes explicit code_sets when provided, ignoring condition_codes for set shape', async () => {
      const client = createCodeSetsMockClient();
      const meta = clonePathway(MINIMAL_PATHWAY).pathway;
      meta.condition_codes = [
        { code: 'E11', system: 'ICD-10' },
        { code: 'I10', system: 'ICD-10' },
      ];
      meta.code_sets = [
        {
          description: 'T2DM with HTN',
          scope: 'EXACT',
          entry_node_id: 'stage-1-comorbid',
          required_codes: [
            { code: 'E11', system: 'ICD-10' },
            { code: 'I10', system: 'ICD-10' },
          ],
        },
      ];

      await writeCodeSets(client as any, 'pw-1', meta);

      // 1 set + 1 multi-member insert
      expect(client.queries).toHaveLength(2);
      expect(client.queries[0].values).toEqual([
        'pw-1', 'EXACT', 'stage-1-comorbid', 'T2DM with HTN',
      ]);
      // The member INSERT has 2 rows (10 values total: 5 cols × 2 members)
      expect(client.queries[1].values).toHaveLength(10);
      expect(client.queries[1].values).toContain('E11');
      expect(client.queries[1].values).toContain('I10');
    });

    it('handles cross-system members in one set', async () => {
      const client = createCodeSetsMockClient();
      const meta = clonePathway(MINIMAL_PATHWAY).pathway;
      meta.code_sets = [
        {
          required_codes: [
            { code: 'I48.91', system: 'ICD-10' },
            { code: '11289', system: 'RXNORM' },
          ],
        },
      ];
      await writeCodeSets(client as any, 'pw-1', meta);
      expect(client.queries[1].values).toContain('ICD-10');
      expect(client.queries[1].values).toContain('RXNORM');
    });

    it('uses ON CONFLICT DO NOTHING on member inserts for idempotency', async () => {
      const client = createCodeSetsMockClient();
      const meta = clonePathway(MINIMAL_PATHWAY).pathway;
      meta.code_sets = [
        { required_codes: [{ code: 'E11', system: 'ICD-10' }] },
      ];
      await writeCodeSets(client as any, 'pw-1', meta);
      expect(client.queries[1].text).toContain('ON CONFLICT (code_set_id, code, system) DO NOTHING');
    });

    it('does nothing when both condition_codes and code_sets are empty', async () => {
      const client = createCodeSetsMockClient();
      const meta = clonePathway(MINIMAL_PATHWAY).pathway;
      meta.condition_codes = [];
      meta.code_sets = [];
      await writeCodeSets(client as any, 'pw-1', meta);
      expect(client.queries).toHaveLength(0);
    });
  });

  describe('deleteCodeSets', () => {
    it('deletes pathway_code_sets rows for the given pathway', async () => {
      const client = createCodeSetsMockClient();
      await deleteCodeSets(client as any, 'pw-1');
      expect(client.queries).toHaveLength(1);
      expect(client.queries[0].text).toContain('DELETE FROM pathway_code_sets');
      expect(client.queries[0].values).toEqual(['pw-1']);
    });
  });
});
