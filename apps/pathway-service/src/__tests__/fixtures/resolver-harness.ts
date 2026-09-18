/**
 * An in-memory session table and environment registry, so resolver tests run
 * the REAL pipeline — evaluate(), commitEvaluation(), the resolvers — over
 * fixture graphs. Only the database and the snapshot loader are replaced.
 *
 * Wire it into a test file (paths from src/__tests__/; add one '../' from a
 * subdirectory):
 *
 *   jest.mock('../services/resolution/session-store', () =>
 *     require('./fixtures/resolver-harness').sessionStoreMock());
 *   jest.mock('../services/resolution/pipeline/load-env', () =>
 *     require('./fixtures/resolver-harness').loadEnvMock());
 *
 * and call `harness.reset()` in `beforeEach`.
 *
 * Rows are the real `insertColumns` / `evaluationColumns` output after a JSON
 * round trip, read back through the real `rowToSession`, so the JSONB column
 * shapes are exercised rather than bypassed. `BEGIN` / `ROLLBACK` on a client
 * from `harness.pool()` snapshot and restore every table.
 */
import type { Pool } from 'pg';
import type { EvaluationEnv } from '../../services/resolution/pipeline/load-env';
import type { ResolutionSession } from '../../services/resolution/types';

export type Row = Record<string, unknown> & { id: string; revision: number; status: string };
type StatusChange = { nodeId: string; from: string; to: string };

interface Tables {
  rows: Map<string, Row>;
  events: Array<{ sessionId: string; eventType: string; triggerData: unknown; nodesRecomputed: number; statusChanges: StatusChange[] }>;
  nodeOverrides: Array<Record<string, unknown>>;
  gateAnswers: Array<Record<string, unknown>>;
  audits: Array<{ sessionId: string; gateId: string; errorMessage: string | null }>;
  carePlanInserts: string[];
}

interface State {
  tables: Tables;
  envs: Map<string, EvaluationEnv>;
  pathways: Map<string, { id: string; version: string; status: string; title: string; logical_id: string }>;
  nextId: number;
  beforeWrite: ((row: Row) => void) | null;
  /** What `beforeWrite` changed during the open transaction: another writer's COMMITTED work. */
  externalPatches: Array<{ sessionId: string; patch: Record<string, unknown> }>;
  engineArgs: unknown[][];
}

const emptyTables = (): Tables => ({ rows: new Map(), events: [], nodeOverrides: [], gateAnswers: [], audits: [], carePlanInserts: [] });
const freshState = (): State => ({
  tables: emptyTables(), envs: new Map(), pathways: new Map(), nextId: 1, beforeWrite: null, externalPatches: [], engineArgs: [],
});
let state = freshState();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actualStore = (): any => jest.requireActual('../../services/resolution/session-store');
const jsonCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

async function poolQuery(sql: string, params: unknown[] = []) {
  if (/FROM pathway_graph_index WHERE id = \$1/.test(sql)) {
    const p = state.pathways.get(String(params[0]));
    return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
  }
  if (/INSERT INTO patient_care_plans\b/.test(sql)) {
    state.tables.carePlanInserts.push(sql);
    return { rows: [{ id: `care-plan-${state.nextId++}` }], rowCount: 1 };
  }
  if (/INSERT INTO (patients\b|patient_care_plan_)/.test(sql)) {
    state.tables.carePlanInserts.push(sql);
    return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

function makeClient() {
  let snapshot: Tables | null = null;
  return {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      const s = sql.trim();
      if (s.startsWith('BEGIN')) { snapshot = structuredClone(state.tables); return { rows: [], rowCount: 0 }; }
      if (s === 'COMMIT') { snapshot = null; state.externalPatches = []; return { rows: [], rowCount: 0 }; }
      if (s === 'ROLLBACK') {
        if (snapshot) state.tables = snapshot;
        // Our rollback must not undo a concurrent writer's committed change.
        for (const { sessionId, patch } of state.externalPatches) Object.assign(state.tables.rows.get(sessionId) ?? {}, patch);
        snapshot = null;
        state.externalPatches = [];
        return { rows: [], rowCount: 0 };
      }
      return poolQuery(sql, params);
    }),
    release: jest.fn(),
  };
}

function casTarget(sessionId: string, expectedRevision: number): Row | null {
  const row = state.tables.rows.get(sessionId);
  if (row && state.beforeWrite) {
    const before = structuredClone(row);
    state.beforeWrite(row);
    const patch = Object.fromEntries(
      Object.entries(row).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])),
    );
    state.externalPatches.push({ sessionId, patch });
  }
  if (!row || row.revision !== expectedRevision || !['ACTIVE', 'DEGRADED'].includes(row.status)) return null;
  return row;
}

/** The session-store module, with its database functions backed by the harness. */
export function sessionStoreMock() {
  const actual = actualStore();
  const t = () => state.tables;
  return {
    ...actual,
    insertSession: jest.fn(async (_db: unknown, s: { inputs: { temporalContext?: unknown } }) => {
      if (!s.inputs.temporalContext) throw new Error('insertSession requires temporalContext');
      const id = `session-${state.nextId++}`;
      t().rows.set(id, { ...jsonCopy(actual.insertColumns(s)), id, revision: 0, created_at: new Date(), updated_at: new Date() });
      return id;
    }),
    getSession: jest.fn(async (_db: unknown, id: string) => {
      const row = t().rows.get(id);
      return row ? actual.rowToSession(structuredClone(row), t().events.filter((e) => e.sessionId === id)) : null;
    }),
    writeEvaluation: jest.fn(async (_db: unknown, args: { sessionId: string; expectedRevision: number }) => {
      const row = casTarget(args.sessionId, args.expectedRevision);
      if (!row) return false;
      Object.assign(row, jsonCopy(actual.evaluationColumns(args)), { revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    writeLifecycleStatus: jest.fn(async (_db: unknown, args: { sessionId: string; expectedRevision: number; status: string }) => {
      const row = casTarget(args.sessionId, args.expectedRevision);
      if (!row) return false;
      Object.assign(row, { status: args.status, revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    setCarePlanId: jest.fn(async (_db: unknown, sessionId: string, carePlanId: string) => {
      const row = t().rows.get(sessionId);
      if (row) row.care_plan_id = carePlanId;
    }),
    logEvent: jest.fn(async (_db: unknown, sessionId: string, e: Omit<Tables['events'][number], 'sessionId'>) => {
      t().events.push({ sessionId, ...e });
    }),
    logNodeOverride: jest.fn(async (_db: unknown, d: Record<string, unknown>) => { t().nodeOverrides.push(d); }),
    logGateAnswer: jest.fn(async (_db: unknown, d: Record<string, unknown>) => { t().gateAnswers.push(d); }),
    writeLlmAudits: jest.fn(async (_db: unknown, sessionId: string, rows: Array<{ gateId: string; errorMessage: string | null }>) => {
      for (const r of rows) t().audits.push({ sessionId, gateId: r.gateId, errorMessage: r.errorMessage });
    }),
    getMatchedPathways: jest.fn(async () => []),
  };
}

/** The load-env module, with the snapshot replaced by the environment registered for the pathway. */
export function loadEnvMock() {
  return {
    ...jest.requireActual('../../services/resolution/pipeline/load-env'),
    loadEvaluationEnv: jest.fn(async (_pool: unknown, pathwayId: string) => {
      const env = state.envs.get(pathwayId);
      if (!env) throw new Error(`resolver-harness: no environment registered for pathway "${pathwayId}"`);
      return env;
    }),
  };
}

export const harness = {
  reset(): void {
    state = freshState();
  },
  /** Register a pathway row (for the resolvers' status check) and its evaluation environment. */
  addPathway(id: string, env: EvaluationEnv, opts: { status?: string } = {}): void {
    state.envs.set(id, env);
    state.pathways.set(id, { id, version: '1', status: opts.status ?? 'ACTIVE', title: `Pathway ${id}`, logical_id: `lp-${id}` });
  },
  pool(): Pool {
    return { query: jest.fn(poolQuery), connect: jest.fn(async () => makeClient()) } as unknown as Pool;
  },
  context(opts: { userRole?: string; temporalPolicyVersion?: string } = {}): never {
    return {
      pool: harness.pool(),
      redis: {},
      userId: 'provider-1',
      userRole: opts.userRole ?? 'ADMIN',
      ...(opts.temporalPolicyVersion ? { temporalPolicyVersion: opts.temporalPolicyVersion } : {}),
    } as never;
  },
  session(id: string): ResolutionSession {
    const row = state.tables.rows.get(id);
    if (!row) throw new Error(`resolver-harness: no session "${id}"`);
    return actualStore().rowToSession(structuredClone(row), state.tables.events.filter((e) => e.sessionId === id));
  },
  row(id: string): Row {
    const row = state.tables.rows.get(id);
    if (!row) throw new Error(`resolver-harness: no session "${id}"`);
    return row;
  },
  rowCount(): number {
    return state.tables.rows.size;
  },
  sessionIds(): string[] {
    return [...state.tables.rows.keys()];
  },
  get tables(): Tables {
    return state.tables;
  },
  /**
   * Runs before every revision check; mutate the row to simulate a concurrent
   * writer. Its changes count as already committed, so a ROLLBACK keeps them.
   */
  onBeforeWrite(fn: ((row: Row) => void) | null): void {
    state.beforeWrite = fn;
  },
  /** The next `n` revision checks find the row already moved by someone else. */
  loseNextRaces(n: number): void {
    let left = n;
    state.beforeWrite = (row) => {
      if (left > 0) { left -= 1; row.revision += 1; }
    };
  },
  /** For a TraversalEngine subclass installed by a test's jest.mock (see Task 6). */
  recordEngine(args: unknown[]): void {
    state.engineArgs.push(args);
  },
  get engineArgs(): unknown[][] {
    return state.engineArgs;
  },
};
