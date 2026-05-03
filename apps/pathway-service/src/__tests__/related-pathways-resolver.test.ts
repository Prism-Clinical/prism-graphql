import { Query } from '../resolvers/Query';
import { GraphQLError } from 'graphql';

function createMockContext() {
  return {
    pool: { query: jest.fn() },
    redis: {},
    userId: 'test-user',
    userRole: 'PROVIDER',
  };
}

function makeCandidateRow(overrides: {
  id: string;
  conditionCodes: string[];
  relationship_type: 'IDENTICAL' | 'SUBSET' | 'SUPERSET' | 'PARTIAL_OVERLAP';
  shared_codes: string[];
  unique_to_candidate: string[];
  unique_to_input: string[];
}) {
  return {
    id: overrides.id,
    ageNodeId: '12345',
    logicalId: `lp-${overrides.id}`,
    title: `Pathway ${overrides.id}`,
    version: '1.0',
    category: 'CHRONIC_DISEASE',
    status: 'ACTIVE',
    conditionCodes: overrides.conditionCodes,
    scope: null,
    targetPopulation: null,
    isActive: true,
    createdAt: '2026-04-01',
    updatedAt: '2026-04-01',
    relationship_type: overrides.relationship_type,
    shared_codes: overrides.shared_codes,
    unique_to_candidate: overrides.unique_to_candidate,
    unique_to_input: overrides.unique_to_input,
  };
}

describe('relatedPathways resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws NOT_FOUND when input pathway does not exist', async () => {
    const ctx = createMockContext();
    (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [] });

    let caught: unknown;
    try {
      await Query.Query.relatedPathways({}, { pathwayId: 'missing' }, ctx as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GraphQLError);
    expect((caught as GraphQLError).extensions.code).toBe('NOT_FOUND');
  });

  it('returns empty array when input pathway has no condition codes', async () => {
    const ctx = createMockContext();
    (ctx.pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ condition_codes: [] }],
    });

    const result = await Query.Query.relatedPathways(
      {},
      { pathwayId: 'p1' },
      ctx as any,
    );
    expect(result).toEqual([]);
    // Should not have hit the bulk query
    expect((ctx.pool.query as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('returns related pathways with all four classification types', async () => {
    const ctx = createMockContext();
    (ctx.pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ condition_codes: ['I10', 'E11'] }] })
      .mockResolvedValueOnce({
        rows: [
          makeCandidateRow({
            id: 'identical',
            conditionCodes: ['I10', 'E11'],
            relationship_type: 'IDENTICAL',
            shared_codes: ['I10', 'E11'],
            unique_to_candidate: [],
            unique_to_input: [],
          }),
          makeCandidateRow({
            id: 'subset',
            conditionCodes: ['I10'],
            relationship_type: 'SUBSET',
            shared_codes: ['I10'],
            unique_to_candidate: [],
            unique_to_input: ['E11'],
          }),
          makeCandidateRow({
            id: 'superset',
            conditionCodes: ['I10', 'E11', 'N18.3'],
            relationship_type: 'SUPERSET',
            shared_codes: ['I10', 'E11'],
            unique_to_candidate: ['N18.3'],
            unique_to_input: [],
          }),
          makeCandidateRow({
            id: 'overlap',
            conditionCodes: ['I10', 'I50.9'],
            relationship_type: 'PARTIAL_OVERLAP',
            shared_codes: ['I10'],
            unique_to_candidate: ['I50.9'],
            unique_to_input: ['E11'],
          }),
        ],
      });

    const result = await Query.Query.relatedPathways(
      {},
      { pathwayId: 'input-p' },
      ctx as any,
    );

    expect(result).toHaveLength(4);
    expect(result.map((r: any) => r.relationshipType)).toEqual([
      'IDENTICAL',
      'SUBSET',
      'SUPERSET',
      'PARTIAL_OVERLAP',
    ]);
    expect(result[0].pathway.id).toBe('identical');
    expect(result[2].uniqueToCandidate).toEqual(['N18.3']);
    expect(result[3].uniqueToInput).toEqual(['E11']);
  });

  it('excludes the input pathway itself and filters to ACTIVE only via SQL', async () => {
    const ctx = createMockContext();
    (ctx.pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ condition_codes: ['I10'] }] })
      .mockResolvedValueOnce({ rows: [] });

    await Query.Query.relatedPathways({}, { pathwayId: 'input-p' }, ctx as any);

    const bulkCall = (ctx.pool.query as jest.Mock).mock.calls[1];
    expect(bulkCall[0]).toContain(`pgi.id != $1`);
    expect(bulkCall[0]).toContain(`pgi.status = 'ACTIVE'`);
    expect(bulkCall[0]).toContain(`pgi.is_active = true`);
    // Flat overlap fallback retained for non-ICD-10 codes
    expect(bulkCall[0]).toContain(`condition_codes && $2`);
    expect(bulkCall[1]).toEqual(['input-p', ['I10']]);
  });

  it('SQL classification uses ltree path operators for ontology-aware SUBSET/SUPERSET', async () => {
    const ctx = createMockContext();
    (ctx.pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ condition_codes: ['E11'] }] })
      .mockResolvedValueOnce({ rows: [] });

    await Query.Query.relatedPathways({}, { pathwayId: 'input-p' }, ctx as any);

    const sql = (ctx.pool.query as jest.Mock).mock.calls[1][0];

    // SUBSET classification: every candidate code in input's territory (descendant or equal)
    // SUPERSET: every input code in candidate's territory
    // Both use ltree's <@ descendant-of operator joined through icd10_codes
    expect(sql).toContain('icd10_codes ucn');
    expect(sql).toContain('icd10_codes uin');
    expect(sql).toContain('ucn.path <@ uin.path');
    expect(sql).toContain('uin.path <@ ucn.path');

    // The classification CASE references both directions
    expect(sql).toContain("THEN 'IDENTICAL'");
    expect(sql).toContain("THEN 'SUBSET'");
    expect(sql).toContain("THEN 'SUPERSET'");
    expect(sql).toContain("ELSE 'PARTIAL_OVERLAP'");
  });

  it('SQL WHERE clause includes ltree path relationship as fallback to flat overlap', async () => {
    const ctx = createMockContext();
    (ctx.pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ condition_codes: ['E11'] }] })
      .mockResolvedValueOnce({ rows: [] });

    await Query.Query.relatedPathways({}, { pathwayId: 'input-p' }, ctx as any);

    const sql = (ctx.pool.query as jest.Mock).mock.calls[1][0];

    // The WHERE filter is `flat_overlap OR ltree_path_relationship`. Without the
    // OR branch, candidates whose only relationship is ancestor/descendant
    // (no flat code overlap) would be filtered out.
    const whereSection = sql.substring(sql.indexOf('WHERE pgi.id'));
    expect(whereSection).toContain('condition_codes && $2');
    expect(whereSection).toContain('OR EXISTS');
    expect(whereSection).toMatch(/ucn\.path <@ uin\.path OR uin\.path <@ ucn\.path/);
  });

  it('handles candidates with null/missing array fields defensively', async () => {
    const ctx = createMockContext();
    (ctx.pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ condition_codes: ['I10'] }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'p',
            ageNodeId: '99',
            logicalId: 'lp-p',
            title: 'P',
            version: '1.0',
            category: 'CHRONIC_DISEASE',
            status: 'ACTIVE',
            conditionCodes: ['I10'],
            scope: null,
            targetPopulation: null,
            isActive: true,
            createdAt: '',
            updatedAt: '',
            relationship_type: 'IDENTICAL',
            shared_codes: null,
            unique_to_candidate: null,
            unique_to_input: null,
          },
        ],
      });

    const result = await Query.Query.relatedPathways(
      {},
      { pathwayId: 'input-p' },
      ctx as any,
    );
    expect(result[0].sharedCodes).toEqual([]);
    expect(result[0].uniqueToCandidate).toEqual([]);
    expect(result[0].uniqueToInput).toEqual([]);
  });

  it('returns empty result set when no candidates overlap', async () => {
    const ctx = createMockContext();
    (ctx.pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ condition_codes: ['Z99.999'] }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await Query.Query.relatedPathways(
      {},
      { pathwayId: 'input-p' },
      ctx as any,
    );
    expect(result).toEqual([]);
  });
});
