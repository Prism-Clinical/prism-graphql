/**
 * An in-memory session table, run table and environment registry, so resolver
 * tests run the REAL pipeline — evaluate(), commitEvaluation(), composeRun(),
 * commitRun(), the resolvers — over fixture graphs. Only the database and the
 * snapshot loaders are replaced.
 *
 * Wire it into a test file (paths from src/__tests__/; add one '../' from a
 * subdirectory):
 *
 *   jest.mock('../services/resolution/session-store', () =>
 *     require('./fixtures/resolver-harness').sessionStoreMock());
 *   jest.mock('../services/resolution/pipeline/load-env', () =>
 *     require('./fixtures/resolver-harness').loadEnvMock());
 *
 * For multi-pathway runs, also:
 *
 *   jest.mock('../services/resolution/multi-pathway-session-store', () =>
 *     require('./fixtures/resolver-harness').runStoreMock());
 *   jest.mock('../services/resolution/lattice-collapse', () =>
 *     require('./fixtures/resolver-harness').latticeMock());
 *
 * and call `harness.reset()` in `beforeEach`.
 *
 * Rows are the real column builders' output after a JSON round trip, read back
 * through the real row readers, so the JSONB column shapes are exercised
 * rather than bypassed. `BEGIN` / `ROLLBACK` on a client from `harness.pool()`
 * snapshot and restore every table.
 */
import type { Pool } from 'pg';
import type { EvaluationEnv } from '../../services/resolution/pipeline/load-env';
import type { MultiPathwayResolutionSession } from '../../services/resolution/multi-pathway-session-store';
import type { MatchedPathway, ResolutionSession } from '../../services/resolution/types';

export type Row = Record<string, unknown> & { id: string; revision: number; status: string };
type StatusChange = { nodeId: string; from: string; to: string };
type TableName = 'rows' | 'runs';

interface Tables {
  rows: Map<string, Row>;
  runs: Map<string, Row>;
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
  matches: string[];
  /** The next statement matching this throws, once (`harness.failNext`). */
  failing: RegExp | null;
  nextId: number;
  beforeWrite: ((row: Row) => void) | null;
  /** What `beforeWrite` changed during the open transaction: another writer's COMMITTED work. */
  externalPatches: Array<{ table: TableName; id: string; patch: Record<string, unknown> }>;
  engineArgs: unknown[][];
}

const emptyTables = (): Tables => ({
  rows: new Map(), runs: new Map(), events: [], nodeOverrides: [], gateAnswers: [], audits: [], carePlanInserts: [],
});
const freshState = (): State => ({
  tables: emptyTables(), envs: new Map(), pathways: new Map(), matches: [], failing: null, nextId: 1,
  beforeWrite: null, externalPatches: [], engineArgs: [],
});
let state = freshState();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actualStore = (): any => jest.requireActual('../../services/resolution/session-store');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actualRunStore = (): any => jest.requireActual('../../services/resolution/multi-pathway-session-store');
const jsonCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

async function poolQuery(sql: string, params: unknown[] = []) {
  if (state.failing?.test(sql)) {
    state.failing = null;
    throw new Error(`resolver-harness: injected failure on ${sql.trim().split('\n')[0]}`);
  }
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
        for (const { table, id, patch } of state.externalPatches) Object.assign(state.tables[table].get(id) ?? {}, patch);
        snapshot = null;
        state.externalPatches = [];
        return { rows: [], rowCount: 0 };
      }
      return poolQuery(sql, params);
    }),
    release: jest.fn(),
  };
}

/** A compare-and-set target: runs `beforeWrite` first (a concurrent writer), then checks revision and status. */
function casRow(table: TableName, id: string, expectedRevision: number, statuses: string[]): Row | null {
  const row = state.tables[table].get(id);
  if (row && state.beforeWrite) {
    const before = structuredClone(row);
    state.beforeWrite(row);
    const patch = Object.fromEntries(
      Object.entries(row).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])),
    );
    state.externalPatches.push({ table, id, patch });
  }
  if (!row || row.revision !== expectedRevision || !statuses.includes(row.status)) return null;
  return row;
}

function envFor(pathwayId: string): EvaluationEnv {
  const env = state.envs.get(pathwayId);
  if (!env) throw new Error(`resolver-harness: no environment registered for pathway "${pathwayId}"`);
  return env;
}

function matchedPathway(id: string): MatchedPathway {
  const p = state.pathways.get(id);
  if (!p) throw new Error(`resolver-harness: no pathway "${id}"`);
  return {
    pathway: { id, logicalId: p.logical_id, title: p.title, version: p.version, category: 'CHRONIC_DISEASE', status: p.status, conditionCodes: [] },
    matched: true,
    matchedSets: [],
    mostSpecificMatchedSet: { setId: `set-${id}`, scope: 'EXACT', members: [], memberCount: 0 },
    specificityDepth: 1,
    patientCodesAddressed: [],
    patientCodesUnaddressed: [],
    matchScore: 1,
    matchedConditionCodes: [],
  } as never;
}

/** The session-store module, with its database functions backed by the harness. */
export function sessionStoreMock() {
  const actual = actualStore();
  const t = () => state.tables;
  return {
    ...actual,
    insertSession: jest.fn(async (_db: unknown, s: { inputs: { temporalContext?: unknown; additionalContext?: object }; parentSessionId?: string }) => {
      if (!s.inputs.temporalContext) throw new Error('insertSession requires temporalContext');
      if (s.parentSessionId && Object.keys(s.inputs.additionalContext ?? {}).length > 0) {
        throw new Error('insertSession: a child of a run holds no patient facts — the parent owns them (D5)');
      }
      const id = `session-${state.nextId++}`;
      t().rows.set(id, { ...jsonCopy(actual.insertColumns(s)), id, revision: 0, created_at: new Date(), updated_at: new Date() });
      return id;
    }),
    getSession: jest.fn(async (_db: unknown, id: string) => {
      const row = t().rows.get(id);
      return row ? actual.rowToSession(structuredClone(row), t().events.filter((e) => e.sessionId === id)) : null;
    }),
    writeEvaluation: jest.fn(async (_db: unknown, args: { sessionId: string; expectedRevision: number }) => {
      const row = casRow('rows', args.sessionId, args.expectedRevision, ['ACTIVE', 'DEGRADED']);
      if (!row) return false;
      Object.assign(row, jsonCopy(actual.evaluationColumns(args)), { revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    writeLifecycleStatus: jest.fn(async (_db: unknown, args: { sessionId: string; expectedRevision: number; status: string }) => {
      const row = casRow('rows', args.sessionId, args.expectedRevision, ['ACTIVE', 'DEGRADED']);
      if (!row) return false;
      Object.assign(row, { status: args.status, revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    writeChildEvaluation: jest.fn(async (_db: unknown, args: { sessionId: string; inputs: Record<string, unknown> }) => {
      const row = t().rows.get(args.sessionId);
      if (!row || !row.parent_session_id) throw new Error(`writeChildEvaluation: session ${args.sessionId} is not the child of a run`);
      Object.assign(
        row,
        jsonCopy(actual.evaluationColumns({ ...args, inputs: { ...args.inputs, additionalContext: {} } })),
        { revision: row.revision + 1, updated_at: new Date() },
      );
    }),
    writeChildrenLifecycle: jest.fn(async (_db: unknown, parentId: string, status: string, carePlanId?: string) => {
      for (const row of t().rows.values()) {
        if (row.parent_session_id !== parentId) continue;
        Object.assign(row, { status, revision: row.revision + 1, ...(carePlanId ? { care_plan_id: carePlanId } : {}) });
      }
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
    getMatchedPathways: jest.fn(async () => state.matches.map(matchedPathway)),
  };
}

/** The multi-pathway store, with its database functions backed by the harness's runs table. */
export function runStoreMock() {
  const actual = actualRunStore();
  const runs = () => state.tables.runs;
  return {
    ...actual,
    insertRun: jest.fn(async (_db: unknown, r: { temporalContext?: unknown }) => {
      if (!r.temporalContext) throw new Error('insertRun requires temporalContext');
      const id = `run-${state.nextId++}`;
      runs().set(id, {
        ...jsonCopy(actual.insertRunColumns(r)), id, revision: 0,
        contributing_session_ids: [], contributing_pathway_ids: [], care_plan_id: null,
        created_at: new Date(), updated_at: new Date(),
      });
      return id;
    }),
    getMultiPathwaySession: jest.fn(async (_db: unknown, id: string) => {
      const row = runs().get(id);
      return row ? actual.runRowToSession(structuredClone(row)) : null;
    }),
    setContributingSessions: jest.fn(async (_db: unknown, id: string, sessionIds: string[], pathwayIds: string[]) => {
      Object.assign(runs().get(id)!, { contributing_session_ids: [...sessionIds], contributing_pathway_ids: [...pathwayIds] });
    }),
    writeRunEvaluation: jest.fn(async (_db: unknown, args: { runId: string; expectedRevision: number }) => {
      const row = casRow('runs', args.runId, args.expectedRevision, ['ACTIVE']);
      if (!row) return false;
      Object.assign(row, jsonCopy(actual.runColumns(args)), { revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    writeRunLifecycle: jest.fn(async (_db: unknown, args: { runId: string; expectedRevision: number; status: string }) => {
      const row = casRow('runs', args.runId, args.expectedRevision, ['ACTIVE']);
      if (!row) return false;
      Object.assign(row, { status: args.status, revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    setRunCarePlanId: jest.fn(async (_db: unknown, id: string, carePlanId: string) => {
      runs().get(id)!.care_plan_id = carePlanId;
    }),
  };
}

/** The load-env module, with the snapshot replaced by the environments registered for the pathways. */
export function loadEnvMock() {
  const actual = jest.requireActual('../../services/resolution/pipeline/load-env');
  return {
    ...actual,
    loadEvaluationEnv: jest.fn(async (_pool: unknown, pathwayId: string) => envFor(pathwayId)),
    loadRunEnv: jest.fn(async (_pool: unknown, pathwayIds: string[]) => actual.runEnvOf(
      new Map(pathwayIds.map((id) => [id, envFor(id)])),
      new Map(pathwayIds.map((id) => {
        const p = state.pathways.get(id)!;
        return [id, { logicalId: p.logical_id, title: p.title, version: p.version }];
      })),
    )),
  };
}

/** Lattice collapse keeps every match (it would read the pathway index). */
export const latticeMock = () => ({ collapseLattice: jest.fn(async (_pool: unknown, matched: unknown[]) => matched) });

export const harness = {
  reset(): void {
    state = freshState();
  },
  /** Register a pathway row (for the resolvers' status check) and its evaluation environment. */
  addPathway(id: string, env: EvaluationEnv, opts: { status?: string } = {}): void {
    state.envs.set(id, env);
    state.pathways.set(id, { id, version: '1', status: opts.status ?? 'ACTIVE', title: `Pathway ${id}`, logical_id: `lp-${id}` });
  },
  /** The pathways `getMatchedPathways` returns next, in order. Each must be registered. */
  matchPathways(...ids: string[]): void {
    state.matches = ids;
  },
  /** The next query matching `pattern` throws, once — a failure inside a transaction. */
  failNext(pattern: RegExp): void {
    state.failing = pattern;
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
  run(id: string): MultiPathwayResolutionSession {
    const row = state.tables.runs.get(id);
    if (!row) throw new Error(`resolver-harness: no run "${id}"`);
    return actualRunStore().runRowToSession(structuredClone(row));
  },
  runRow(id: string): Row {
    const row = state.tables.runs.get(id);
    if (!row) throw new Error(`resolver-harness: no run "${id}"`);
    return row;
  },
  runIds(): string[] {
    return [...state.tables.runs.keys()];
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
  /** For a TraversalEngine subclass installed by a test's jest.mock. */
  recordEngine(args: unknown[]): void {
    state.engineArgs.push(args);
  },
  get engineArgs(): unknown[][] {
    return state.engineArgs;
  },
};
