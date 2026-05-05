/**
 * MultiPathwayResolutionSession.contributingPathways field resolver.
 *
 * The session row stores bare `contributingPathwayIds: string[]`; this
 * resolver hydrates them into Pathway objects so the FE has condition codes
 * + titles available for provenance display in one query.
 */

import { multiPathwayResolutionTypeResolvers } from '../resolvers/mutations/multi-pathway-resolution';

const resolver = multiPathwayResolutionTypeResolvers.MultiPathwayResolutionSession.contributingPathways;

function fakeContext(rows: Array<Record<string, unknown>>) {
  const query = jest.fn().mockResolvedValue({ rows, rowCount: rows.length });
  return { pool: { query } } as never;
}

describe('MultiPathwayResolutionSession.contributingPathways', () => {
  it('returns [] when the session has no contributing pathways', async () => {
    const ctx = fakeContext([]);
    const result = await resolver(
      { contributingPathwayIds: [] },
      undefined,
      ctx,
    );
    expect(result).toEqual([]);
    expect((ctx as { pool: { query: jest.Mock } }).pool.query).not.toHaveBeenCalled();
  });

  it('issues one batched SELECT for all contributing IDs', async () => {
    const ctx = fakeContext([
      { id: 'p1', title: 'HTN', conditionCodes: ['I10'] },
      { id: 'p2', title: 'HFrEF', conditionCodes: ['I50.20', 'I50.21'] },
    ]);
    await resolver(
      { contributingPathwayIds: ['p1', 'p2'] },
      undefined,
      ctx,
    );
    const queryMock = (ctx as { pool: { query: jest.Mock } }).pool.query;
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/WHERE id = ANY/);
    expect(params).toEqual([['p1', 'p2']]);
  });

  it('preserves the order of contributingPathwayIds in the output', async () => {
    // DB returns rows in arbitrary order — we re-sort to match input.
    const ctx = fakeContext([
      { id: 'p2', title: 'HFrEF', conditionCodes: ['I50.20'] },
      { id: 'p1', title: 'HTN', conditionCodes: ['I10'] },
      { id: 'p3', title: 'T2DM', conditionCodes: ['E11'] },
    ]);
    const result = await resolver(
      { contributingPathwayIds: ['p1', 'p2', 'p3'] },
      undefined,
      ctx,
    );
    expect((result as Array<{ id: string }>).map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('drops IDs with no matching row (e.g. pathway was deleted post-session)', async () => {
    const ctx = fakeContext([
      { id: 'p1', title: 'HTN', conditionCodes: ['I10'] },
      // p2 is missing
    ]);
    const result = await resolver(
      { contributingPathwayIds: ['p1', 'p2'] },
      undefined,
      ctx,
    );
    expect(result).toHaveLength(1);
    expect((result as Array<{ id: string }>)[0].id).toBe('p1');
  });
});
