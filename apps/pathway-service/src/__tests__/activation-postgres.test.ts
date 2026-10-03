// apps/pathway-service/src/__tests__/activation-postgres.test.ts
jest.mock('../services/compiler/stored-input', () => ({ loadStoredCompileInput: jest.fn() }));
jest.mock('../services/medications/prewarm-pathway', () => ({ prewarmPathwayInBackground: jest.fn() }));

import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { Mutation } from '../resolvers/Mutation';
import { loadStoredCompileInput } from '../services/compiler/stored-input';
import { MINIMAL_PATHWAY } from './fixtures/reference-pathway';

const describePg = process.env.RUN_PIPELINE_PG_TESTS === '1' ? describe : describe.skip;
const BROKEN = { ...MINIMAL_PATHWAY, nodes: [...MINIMAL_PATHWAY.nodes, { id: 'orphan', type: 'Step', properties: { stage_number: 9, step_number: 9, display_number: '9.9', title: 'Unreachable' } }] };

describePg('activation and draft saves serialize on the pathway row lock (scratch database)', () => {
  const database = process.env.PIPELINE_PG_DATABASE ?? '';
  let pool: Pool;
  let logical: string;
  let activeId: string;
  let draftId: string;
  const statusOf = async (id: string) => (await pool.query('SELECT status FROM pathway_graph_index WHERE id = $1', [id])).rows[0].status;
  /** Resolves once some session in this database is waiting on a row lock: observed state, not elapsed time. */
  async function lockWaiterSeen(): Promise<void> {
    for (let i = 0; i < 250; i += 1) {
      const r = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
      if (r.rows[0].n > 0) return;
      await new Promise((res) => setTimeout(res, 20));
    }
    throw new Error('no session ever waited on the pathway row lock');
  }

  beforeAll(() => {
    if (!database.includes('scratch') || database === 'prism_db') throw new Error(`refusing database "${database}": set PIPELINE_PG_DATABASE to a scratch database`);
    pool = new Pool({ host: process.env.POSTGRES_HOST ?? 'localhost', user: process.env.POSTGRES_USER ?? 'prism', password: process.env.POSTGRES_PASSWORD, database });
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    logical = `lp-lock-${randomUUID().slice(0, 8)}`;
    activeId = randomUUID();
    draftId = randomUUID();
    await pool.query(`INSERT INTO pathway_graph_index (id, logical_id, title, version, category, status, is_active) VALUES ($1, $2, 'v1', '1.0', 'ACUTE_CARE', 'ACTIVE', true)`, [activeId, logical]);
    await pool.query(`INSERT INTO pathway_graph_index (id, logical_id, title, version, category, status, is_active) VALUES ($1, $2, 'v2', '2.0', 'ACUTE_CARE', 'DRAFT', false)`, [draftId, logical]);
    // The mocked loader reads the title on the transaction's own client: 'broken' stands for a non-compiling graph.
    (loadStoredCompileInput as jest.Mock).mockReset().mockImplementation(async (db: Pool, id: string) => {
      const title = (await db.query('SELECT title FROM pathway_graph_index WHERE id = $1', [id])).rows[0].title;
      return { pathway: title === 'broken' ? BROKEN : MINIMAL_PATHWAY, codeMap: new Map(), temporalDefaults: {} };
    });
  });

  it('a draft save already holding the lock is what activation compiles, and a failure leaves v1 ACTIVE', async () => {
    const saver = await pool.connect();
    await saver.query('BEGIN');
    await saver.query('SELECT id, status FROM pathway_graph_index WHERE logical_id = $1 AND version = $2 FOR UPDATE', [logical, '2.0']);
    const activation = Mutation.Mutation.activatePathway({}, { id: draftId }, { pool } as never);
    await lockWaiterSeen();                                             // activation is blocked on the saver's lock
    await saver.query(`UPDATE pathway_graph_index SET title = 'broken' WHERE id = $1`, [draftId]);
    await saver.query('COMMIT');
    saver.release();
    await expect(activation).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    expect(await statusOf(activeId)).toBe('ACTIVE');
    expect(await statusOf(draftId)).toBe('DRAFT');
  });

  it('a draft save that arrives while activation holds the lock waits, then finds no DRAFT and is refused', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const inCompile = new Promise<void>((r) => { entered = r; });
    (loadStoredCompileInput as jest.Mock).mockImplementation(async () => { entered(); await gate; return { pathway: MINIMAL_PATHWAY, codeMap: new Map(), temporalDefaults: {} }; });
    const activation = Mutation.Mutation.activatePathway({}, { id: draftId }, { pool } as never);
    // Compile is entered only after the lock is held; fail fast if activation ends without getting there.
    await Promise.race([inCompile, activation.then(() => { throw new Error('activation finished before compiling'); })]);
    const saver = await pool.connect();
    await saver.query('BEGIN');
    const save = saver.query('SELECT id, status FROM pathway_graph_index WHERE logical_id = $1 AND version = $2 FOR UPDATE', [logical, '2.0']);
    await lockWaiterSeen();                                             // the save is queued behind activation's lock
    release();
    await activation;
    const seen = await save;
    await saver.query('ROLLBACK');
    saver.release();
    expect(seen.rows[0].status).toBe('ACTIVE');                         // DRAFT_UPDATE's existing check refuses this
    expect(await statusOf(activeId)).toBe('SUPERSEDED');
  });
});
