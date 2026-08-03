/**
 * buildResolutionContext must load the PATHWAY cascade level alongside the
 * graph. Today it selects only age_node_id (design §7.5).
 *
 * fetchGraphFromAGE, the signal query, thresholds and the code map are all
 * stubbed — this test is about the pathway row and nothing else.
 */
jest.mock('../../services/age-client', () => ({
  executeCypher: jest.fn().mockResolvedValue({ rows: [] }),
}));
// resolution-context imports hydrateSignalDefinition from the Query resolver,
// which pulls in most of the service at module load. Stub it — this test must
// not depend on anything Query.ts touches on import.
jest.mock('../../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));
jest.mock('../../services/resolution/attribute-code-map', () => ({
  loadAttributeCodeMap: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../../services/confidence/weight-cascade-resolver', () => ({
  WeightCascadeResolver: class {
    resolveThresholds = jest
      .fn()
      .mockResolvedValue({ autoResolveThreshold: 0.8, suggestThreshold: 0.5 });
  },
}));

import { buildResolutionContext } from '../../resolvers/helpers/resolution-context';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';

function poolReturning(temporalDefaults: unknown) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('pathway_graph_index')) {
      return { rows: [{ age_node_id: '123', temporal_defaults: temporalDefaults }] };
    }
    return { rows: [] };
  });
  return { query } as unknown as import('pg').Pool & { query: jest.Mock };
}

describe('buildResolutionContext — temporal defaults', () => {
  it('selects temporal_defaults from the pathway row', async () => {
    const pool = poolReturning(null);
    await buildResolutionContext(pool, 'pathway-1');
    const sql = (pool.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('temporal_defaults');
    expect(sql).toContain('pathway_graph_index');
  });

  it('exposes an empty PATHWAY level when the column is NULL', async () => {
    const ctx = await buildResolutionContext(poolReturning(null), 'pathway-1');
    expect(ctx.temporalDefaults).toEqual({});
  });

  it('parses a stored value into the cascade shape', async () => {
    const ctx = await buildResolutionContext(
      poolReturning({ default_horizons: { labs: 'YEAR' } }),
      'pathway-1',
    );
    expect(ctx.temporalDefaults).toEqual({ horizons: { labs: 'YEAR' } });
  });

  it('refuses to resolve a pathway whose stored defaults are corrupt', async () => {
    await expect(
      buildResolutionContext(
        poolReturning({ default_horizons: { labs: 'FORTNIGHT' } }),
        'pathway-1',
      ),
    ).rejects.toThrow(TemporalContextError);
  });
});
