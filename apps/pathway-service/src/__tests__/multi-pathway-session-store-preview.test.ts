/**
 * Store-level tests for the is_preview column + deletePreviewSession.
 *
 * Separated from the resolver tests so we can exercise the real store
 * functions (the resolver test file has to `jest.mock` the store module,
 * which would otherwise erase the functions under test here).
 *
 * Two flavors of pool mock:
 *   - makeSpyPool: single-query functions (createMultiPathwaySession,
 *     getPatientMultiPathwaySessions) run against `pool.query` directly.
 *   - makeTxnPool: transaction-based function (deletePreviewSession) uses
 *     `pool.connect()` → client.query / BEGIN / COMMIT / ROLLBACK. Control
 *     statements auto-return empty rows; canned results feed data queries
 *     in order.
 */

import {
  createMultiPathwaySession,
  getPatientMultiPathwaySessions,
  deletePreviewSession,
} from '../services/resolution/multi-pathway-session-store';

function makeSpyPool(canned: Array<{ rows: unknown[]; rowCount?: number }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return canned.shift() ?? { rows: [], rowCount: 0 };
  });
  return { pool: { query } as never, calls };
}

function makeTxnPool(canned: Array<{ rows: unknown[]; rowCount?: number }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const control = /^(BEGIN|COMMIT|ROLLBACK)/i.test(sql.trim().slice(0, 10));
      if (control) return { rows: [], rowCount: 0 };
      return canned.shift() ?? { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(async () => client) };
  return { pool: pool as never, client, calls };
}

const EMPTY_MERGED_PLAN = {
  sourcePathwayIds: [],
  medications: [],
  labs: [],
  imaging: [],
  procedures: [],
  guidance: [],
  schedules: [],
  qualityMetrics: [],
  suppressed: [],
  conflicts: [],
  catchUpItems: [],
};

describe('createMultiPathwaySession: is_preview persistence', () => {
  it('defaults isPreview to false and includes it in the INSERT', async () => {
    const { pool, calls } = makeSpyPool([{ rows: [{ id: 'sess-1' }] }]);
    await createMultiPathwaySession(pool, {
      patientId: 'pt-1',
      providerId: 'prov-1',
      initialPatientContext: {},
      contributingSessionIds: [],
      contributingPathwayIds: [],
      mergedPlan: EMPTY_MERGED_PLAN,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/is_preview/);
    // Positional: (patient_id, provider_id, status, is_preview, ...) — since
    // status is a literal in the SQL, is_preview is param $3 (index 2).
    expect(calls[0].params[2]).toBe(false);
  });

  it('threads isPreview=true when supplied', async () => {
    const { pool, calls } = makeSpyPool([{ rows: [{ id: 'sess-2' }] }]);
    await createMultiPathwaySession(pool, {
      patientId: 'pt-1',
      providerId: 'prov-1',
      initialPatientContext: {},
      contributingSessionIds: [],
      contributingPathwayIds: [],
      mergedPlan: EMPTY_MERGED_PLAN,
      isPreview: true,
    });
    expect(calls[0].params[2]).toBe(true);
  });
});

describe('getPatientMultiPathwaySessions: preview filtering', () => {
  it('excludes preview sessions by default', async () => {
    const { pool, calls } = makeSpyPool([{ rows: [] }]);
    await getPatientMultiPathwaySessions(pool, 'pt-1');
    expect(calls[0].sql).toMatch(/is_preview = false/);
  });

  it('includes preview sessions when includePreview=true', async () => {
    const { pool, calls } = makeSpyPool([{ rows: [] }]);
    await getPatientMultiPathwaySessions(pool, 'pt-1', undefined, true);
    expect(calls[0].sql).not.toMatch(/is_preview = false/);
  });

  it('maps is_preview from the row into isPreview on the summary', async () => {
    const { pool } = makeSpyPool([
      {
        rows: [
          {
            id: 's-a',
            patient_id: 'pt-1',
            provider_id: 'prov-1',
            status: 'ACTIVE',
            is_preview: true,
            contributing_pathway_count: 2,
            merged_plan: { conflicts: [] },
            care_plan_id: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      },
    ]);
    const [summary] = await getPatientMultiPathwaySessions(
      pool,
      'pt-1',
      undefined,
      true,
    );
    expect(summary.isPreview).toBe(true);
  });

  it('defaults isPreview to false when column value is null (defensive)', async () => {
    const { pool } = makeSpyPool([
      {
        rows: [
          {
            id: 's-a',
            patient_id: 'pt-1',
            provider_id: 'prov-1',
            status: 'ACTIVE',
            is_preview: null,
            contributing_pathway_count: 0,
            merged_plan: { conflicts: [] },
            care_plan_id: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      },
    ]);
    const [summary] = await getPatientMultiPathwaySessions(
      pool,
      'pt-1',
      undefined,
      true,
    );
    expect(summary.isPreview).toBe(false);
  });
});

describe('deletePreviewSession: transaction behavior', () => {
  it('returns not-found when the session id is unknown', async () => {
    const { pool, calls } = makeTxnPool([{ rows: [] }]); // SELECT returns 0 rows
    const result = await deletePreviewSession(pool, 'missing');
    expect(result.kind).toBe('not-found');
    expect(calls.some((c) => /ROLLBACK/i.test(c.sql))).toBe(true);
    expect(calls.some((c) => /^DELETE/i.test(c.sql.trim().slice(0, 10)))).toBe(false);
  });

  it('refuses to delete a real (non-preview) session', async () => {
    const { pool, calls } = makeTxnPool([
      { rows: [{ is_preview: false, contributing_session_ids: [] }] },
    ]);
    const result = await deletePreviewSession(pool, 'sess-real');
    expect(result.kind).toBe('not-preview');
    expect(calls.some((c) => /ROLLBACK/i.test(c.sql))).toBe(true);
    expect(calls.some((c) => /^DELETE/i.test(c.sql.trim().slice(0, 10)))).toBe(false);
  });

  it('deletes preview session + cascade-deletes contributing per-pathway sessions', async () => {
    // Canned results feed data queries in order: SELECT (preview row),
    // DELETE FROM pathway_resolution_sessions (rowCount 3), DELETE FROM
    // multi_pathway_resolution_sessions (rowCount 1). Control statements
    // (BEGIN/COMMIT/ROLLBACK) are handled by the mock.
    const { pool, calls } = makeTxnPool([
      {
        rows: [
          {
            is_preview: true,
            contributing_session_ids: ['p-1', 'p-2', 'p-3'],
          },
        ],
      },
      { rows: [], rowCount: 3 },
      { rows: [], rowCount: 1 },
    ]);
    const result = await deletePreviewSession(pool, 'sess-preview');
    expect(result).toEqual({ kind: 'deleted', contributingSessionsDeleted: 3 });

    const deleteSqls = calls
      .map((c) => c.sql)
      .filter((s) => /^DELETE/i.test(s.trim().slice(0, 10)));
    expect(deleteSqls).toHaveLength(2);
    expect(deleteSqls[0]).toMatch(/pathway_resolution_sessions/);
    expect(deleteSqls[1]).toMatch(/multi_pathway_resolution_sessions/);
    expect(calls.some((c) => /COMMIT/i.test(c.sql))).toBe(true);
    expect(calls.some((c) => /ROLLBACK/i.test(c.sql))).toBe(false);
  });

  it('skips the per-pathway DELETE when there are no contributing sessions', async () => {
    // pg's ANY($1) with an empty array is fine, but skipping the round-trip
    // is a nice quiet optimization. Guards against the "no children" path.
    const { pool, calls } = makeTxnPool([
      { rows: [{ is_preview: true, contributing_session_ids: [] }] },
      { rows: [], rowCount: 1 },
    ]);
    const result = await deletePreviewSession(pool, 'sess-preview');
    expect(result).toEqual({ kind: 'deleted', contributingSessionsDeleted: 0 });

    const deleteSqls = calls
      .map((c) => c.sql)
      .filter((s) => /^DELETE/i.test(s.trim().slice(0, 10)));
    expect(deleteSqls).toHaveLength(1);
    expect(deleteSqls[0]).toMatch(/multi_pathway_resolution_sessions/);
  });

  it('releases the client even on rollback', async () => {
    const { pool, client } = makeTxnPool([{ rows: [] }]); // triggers not-found → rollback
    await deletePreviewSession(pool, 'missing');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
