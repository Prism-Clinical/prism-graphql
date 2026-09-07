/**
 * Generating a care plan is a read / compute / write, and the write must be
 * guarded and complete.
 *
 * Three defects, all in the same transaction:
 *
 * 1. It loaded the session, computed a plan, then wrote COMPLETED with no
 *    optimistic-lock predicate. A concurrent answer or context update between
 *    the load and the write was silently lost, and the committed plan was
 *    built from a patient picture that no longer held.
 *
 * 2. The pre-generation DDI pass MUTATES the resolution state — a suppression
 *    excludes a Medication node — and the transaction wrote only
 *    `care_plan_id` and `status`. The completed session therefore disagreed
 *    with the plan generated from it.
 *
 * 3. The response's `warnings` was a hardcoded empty array, so a plan carrying
 *    a moderate-interaction warning reported none.
 *
 * Only the database seams are mocked; the resolver is real.
 */

jest.mock('../resolvers/Query', () => ({
  PATHWAY_COLUMNS: 'id, version, status',
  formatSessionForGraphQL: (s: unknown) => s,
  hydrateSignalDefinition: (row: unknown) => row,
}));

jest.mock('../services/resolution/session-store', () => ({
  ...jest.requireActual('../services/resolution/session-store'),
  getSession: jest.fn(),
  updateSession: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/medications/ddi-pass-single-pathway', () => ({
  applyDdiToResolutionState: jest.fn(),
}));

import { getSession } from '../services/resolution/session-store';
import { applyDdiToResolutionState } from '../services/medications/ddi-pass-single-pathway';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { NodeStatus, SessionStatus } from '../services/resolution/types';
import type { NodeResult } from '../services/resolution/types';

const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const mockedDdi = applyDdiToResolutionState as jest.MockedFunction<
  typeof applyDdiToResolutionState
>;

const STORED_AT = new Date('2026-09-03T12:00:00.000Z');

function med(status = NodeStatus.INCLUDED): NodeResult {
  return {
    nodeId: 'med-1', nodeType: 'Medication', title: 'Ferrous sulfate',
    status, confidence: 0.9, confidenceBreakdown: [], depth: 1,
    properties: { name: 'Ferrous sulfate', role: 'first_line' },
  } as NodeResult;
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1', pathwayId: 'pw-1', pathwayVersion: '1',
    patientId: 'pt-1', providerId: 'u-1', status: SessionStatus.ACTIVE,
    resolutionState: new Map([['med-1', med()]]),
    dependencyMap: { influences: new Map(), influencedBy: new Map(),
      gateContextFields: new Map(), scorerInputs: new Map() },
    initialPatientContext: {
      patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [],
    },
    additionalContext: {},
    pendingQuestions: [], redFlags: [], resolutionEvents: [],
    gateAnswers: new Map(), totalNodesEvaluated: 1, traversalDurationMs: 1,
    ddiWarnings: [], createdAt: STORED_AT, updatedAt: STORED_AT,
    ...overrides,
  } as never;
}

/** Records every statement, and lets a test choose what the UPDATE returns. */
function makePool(completedRowCount = 1) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (/^UPDATE pathway_resolution_sessions/.test(sql.trim())) {
        return { rows: [], rowCount: completedRowCount };
      }
      if (/RETURNING id/.test(sql)) return { rows: [{ id: 'cp-1' }], rowCount: 1 };
      if (/SELECT title FROM pathway_graph_index/.test(sql)) {
        return { rows: [{ title: 'Anaemia' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  return {
    statements,
    client,
    pool: { connect: jest.fn(async () => client), query: jest.fn(async () => ({ rows: [] })) },
  };
}

const ctxWith = (pool: unknown) =>
  ({ pool, redis: {}, userId: 'u-1', userRole: 'ADMIN' }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockedDdi.mockResolvedValue({ findings: [], suppressedNodeCount: 0 } as never);
});

describe('care plan generation transaction', () => {
  it('guards the completing write with the session it read', async () => {
    const { pool, statements } = makePool();
    mockedGetSession.mockResolvedValue(session());

    await resolutionMutations.generateCarePlanFromResolution(
      null as never, { sessionId: 'session-1' } as never, ctxWith(pool),
    );

    const update = statements.find(s => /^UPDATE pathway_resolution_sessions/.test(s.sql.trim()))!;
    // Without `updated_at = $n` a concurrent write between load and commit is
    // silently overwritten.
    expect(update.sql).toMatch(/updated_at\s*=\s*\$\d/);
    expect(update.params).toContain(STORED_AT);
  });

  it('rolls back and reports a conflict when the session moved underneath it', async () => {
    const { pool, client } = makePool(0); // the guarded UPDATE matches nothing
    mockedGetSession.mockResolvedValue(session());

    await expect(
      resolutionMutations.generateCarePlanFromResolution(
        null as never, { sessionId: 'session-1' } as never, ctxWith(pool),
      ),
    ).rejects.toThrow(/changed while/i);

    const ran = client.query.mock.calls.map(c => String(c[0]).trim());
    expect(ran).toContain('ROLLBACK');
    expect(ran).not.toContain('COMMIT');
  });

  /**
   * The DDI pass excludes a Medication node in memory. If that is not written,
   * the stored session still shows it INCLUDED while the plan omits it.
   */
  it('persists the state the pre-generation DDI pass mutated', async () => {
    const { pool, statements } = makePool();
    // A SECOND action survives the suppression: with only one, the plan is
    // empty and EMPTY_PLAN blocks before any write — correct, but it would
    // leave this assertion testing nothing.
    mockedGetSession.mockResolvedValue(session({
      resolutionState: new Map([
        ['med-1', med()],
        ['med-2', { ...med(), nodeId: 'med-2', title: 'Folic acid' }],
      ]),
    }));
    mockedDdi.mockImplementation(async (_p, state) => {
      state.get('med-1')!.status = NodeStatus.EXCLUDED;
      state.get('med-1')!.excludeReason = 'DDI: contraindicated';
      return { findings: [], suppressedNodeCount: 1 } as never;
    });

    await resolutionMutations.generateCarePlanFromResolution(
      null as never, { sessionId: 'session-1' } as never, ctxWith(pool),
    );

    const update = statements.find(s => /^UPDATE pathway_resolution_sessions/.test(s.sql.trim()))!;
    expect(update.sql).toMatch(/resolution_state\s*=/);
    expect(JSON.stringify(update.params)).toContain('EXCLUDED');
  });

  it('returns the DDI warnings the plan was generated under', async () => {
    const { pool } = makePool();
    mockedGetSession.mockResolvedValue(session());
    mockedDdi.mockResolvedValue({
      findings: [{ action: 'WARN', description: 'Moderate interaction: iron + levothyroxine' }],
      suppressedNodeCount: 0,
    } as never);

    const result = await resolutionMutations.generateCarePlanFromResolution(
      null as never, { sessionId: 'session-1' } as never, ctxWith(pool),
    ) as { warnings: string[] };

    expect(result.warnings.join(' ')).toContain('levothyroxine');
  });

  // A degraded session's traversal did not finish, so the pathway was never
  // fully evaluated.
  it('refuses to generate from a DEGRADED session', async () => {
    const { pool } = makePool();
    mockedGetSession.mockResolvedValue(session({ status: SessionStatus.DEGRADED }));

    const result = await resolutionMutations.generateCarePlanFromResolution(
      null as never, { sessionId: 'session-1' } as never, ctxWith(pool),
    ) as { success: boolean; blockers: Array<{ type: string }> };

    expect(result.success).toBe(false);
    expect(result.blockers.map(b => b.type)).toContain('INCOMPLETE_RESOLUTION');
  });
});
