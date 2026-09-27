import { Mutation } from '../resolvers/Mutation';
import { MINIMAL_PATHWAY } from './fixtures/reference-pathway';

// Mock the import module
jest.mock('../services/import/import-orchestrator', () => ({
  importPathway: jest.fn(),
}));

// Import and activation start a background medication pre-warm (D14) whose graph
// read would land on this suite's mocked pool; prewarm-pathway-medications.test.ts
// covers that wiring, so here the resolvers' own queries are counted alone.
jest.mock('../services/medications/prewarm-pathway', () => ({
  prewarmPathwayInBackground: jest.fn(),
}));

import { importPathway as mockImportPathway } from '../services/import/import-orchestrator';
import { loadStoredCompileInput } from '../services/compiler/stored-input';
import { prewarmPathwayInBackground } from '../services/medications/prewarm-pathway';

jest.mock('../services/compiler/stored-input', () => ({ loadStoredCompileInput: jest.fn() }));

type Route = (sql: string) => { rows: unknown[] } | undefined;
function txContext(route: Route) {
  const query = jest.fn(async (sql: string) => route(String(sql)) ?? { rows: [] });
  const client = { query, release: jest.fn() };
  return { ctx: { pool: { query, connect: jest.fn(async () => client) }, redis: {}, userId: 'test-user', userRole: 'PROVIDER' } as never, query, client };
}
const sqlOf = (query: jest.Mock) => query.mock.calls.map(([s]) => String(s));
const row = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'test-id', status, logicalId: 'CP-Test', ageNodeId: '7', title: 'Test', version: '1.0', category: 'ACUTE_CARE', ...extra });
const LEGACY = {
  ...MINIMAL_PATHWAY,
  nodes: [
    ...MINIMAL_PATHWAY.nodes,
    { id: 'gate-legacy', type: 'Gate', properties: { title: 'Severe', gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'lab.hemoglobin', operator: 'LT', value: 7 } } },
    { id: 'step-1-2', type: 'Step', properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'Transfusion' } },
  ],
  edges: [...MINIMAL_PATHWAY.edges, { from: 'stage-1', to: 'gate-legacy', type: 'HAS_GATE' }, { from: 'gate-legacy', to: 'step-1-2', type: 'BRANCHES_TO' }],
} as never;
const compileInput = (pathway: unknown) => ({ pathway, codeMap: new Map(), temporalDefaults: {} });

function createMockContext() {
  return {
    pool: {
      query: jest.fn(async () => ({
        rows: [{
          id: '00000000-0000-4000-a000-000000000099',
          ageNodeId: null,
          logicalId: 'CP-Minimal',
          title: 'Minimal Test Pathway',
          version: '1.0',
          category: 'ACUTE_CARE',
          status: 'DRAFT',
          conditionCodes: ['J06.9'],
          scope: null,
          targetPopulation: null,
          isActive: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      })),
    },
    redis: {},
    userId: 'test-user',
    userRole: 'PROVIDER',
  };
}

describe('Mutation resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('importPathway', () => {
    it('should call importPathway with parsed JSON and return result', async () => {
      const ctx = createMockContext();
      (mockImportPathway as jest.Mock).mockResolvedValue({
        pathwayId: '00000000-0000-4000-a000-000000000099',
        ageNodeId: null,
        logicalId: 'CP-Minimal',
        version: '1.0',
        status: 'DRAFT',
        validation: { valid: true, errors: [], warnings: [] },
        diff: { summary: { nodesAdded: 3, nodesRemoved: 0, nodesModified: 0, edgesAdded: 2, edgesRemoved: 0, edgesModified: 0 }, details: [] },
        importType: 'NEW_PATHWAY',
      });

      const result = await Mutation.Mutation.importPathway(
        {},
        { pathwayJson: JSON.stringify(MINIMAL_PATHWAY), importMode: 'NEW_PATHWAY' },
        ctx
      );

      expect(mockImportPathway).toHaveBeenCalledWith(ctx.pool, MINIMAL_PATHWAY, 'NEW_PATHWAY', 'test-user');
      expect(result.validation.valid).toBe(true);
      expect(result.importType).toBe('NEW_PATHWAY');
    });

    it('should return validation error for invalid JSON string', async () => {
      const ctx = createMockContext();

      const result = await Mutation.Mutation.importPathway(
        {},
        { pathwayJson: 'not valid json', importMode: 'NEW_PATHWAY' },
        ctx
      );

      expect(result.validation.valid).toBe(false);
      expect(result.validation.errors).toContainEqual(expect.stringContaining('JSON'));
    });
  });

  describe('activatePathway', () => {
    beforeEach(() => (loadStoredCompileInput as jest.Mock).mockReset());

    it('locks the logical pathway, compiles the stored graph under the lock, then activates, in one transaction', async () => {
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(compileInput(MINIMAL_PATHWAY));
      const { ctx, query, client } = txContext((sql) =>
        sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'DRAFT' }] }
          : sql.startsWith('WITH') ? { rows: [{ ...row('ACTIVE'), previousStatus: 'DRAFT' }] } : undefined);

      const result = await Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx);

      expect(result.previousStatus).toBe('DRAFT');
      const sqls = sqlOf(query);
      const at = (p: (s: string) => boolean) => sqls.findIndex(p);
      expect(sqls[0]).toBe('BEGIN');
      expect(at((s) => s.includes('FOR UPDATE') && s.includes('ORDER BY id'))).toBeLessThan(at((s) => s.startsWith('WITH')));
      expect(sqls.at(-1)).toBe('COMMIT');
      expect((loadStoredCompileInput as jest.Mock).mock.calls[0][0]).toBe(client);   // read on the locked client
      expect(client.release).toHaveBeenCalled();
    });

    it('refuses a DRAFT that does not compile, lists the errors, updates nothing, and rolls back', async () => {
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(compileInput(LEGACY));
      const { ctx, query } = txContext((sql) => (sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'DRAFT' }] } : undefined));

      await expect(Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)).rejects.toMatchObject({
        extensions: { code: 'BAD_USER_INPUT', compileErrors: expect.arrayContaining([expect.objectContaining({ code: 'VALIDATION' })]) },
      });
      const sqls = sqlOf(query);
      expect(sqls.some((s) => s.startsWith('WITH') || /^\s*UPDATE/.test(s))).toBe(false);   // the lock query says FOR UPDATE; no status write may run
      expect(sqls.at(-1)).toBe('ROLLBACK');
    });

    it.each([
      ['patient_attribute with no condition', { gate_type: 'patient_attribute', default_behavior: 'skip' }],
      ['SELECT question with no options', { gate_type: 'question', default_behavior: 'skip', answer_type: 'SELECT' }],
      ['trimester comparison with no value', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'patient.trimester', operator: 'less_than' } }],
    ])('refuses to activate an unusable gate payload: %s', async (_label, props) => {
      const pathway = {
        ...MINIMAL_PATHWAY,
        nodes: [...MINIMAL_PATHWAY.nodes, { id: 'gate-x', type: 'Gate', properties: { title: 'X', ...props } }, { id: 'step-1-2', type: 'Step', properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'Guarded' } }],
        edges: [...MINIMAL_PATHWAY.edges, { from: 'stage-1', to: 'gate-x', type: 'HAS_GATE' }, { from: 'gate-x', to: 'step-1-2', type: 'BRANCHES_TO' }],
      };
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(compileInput(pathway));
      const { ctx } = txContext((sql) => (sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'DRAFT' }] } : undefined));
      await expect(Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)).rejects.toMatchObject({
        extensions: { compileErrors: expect.arrayContaining([expect.objectContaining({ code: 'PAYLOAD' })]) },
      });
    });

    it('does not block a metadata-only pathway (no stored graph to compile)', async () => {
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(null);
      const { ctx } = txContext((sql) =>
        sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'DRAFT' }] }
          : sql.startsWith('WITH') ? { rows: [{ ...row('ACTIVE'), previousStatus: 'DRAFT' }] } : undefined);
      await expect(Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)).resolves.toMatchObject({ previousStatus: 'DRAFT' });
    });

    it('rejects activating a non-DRAFT pathway without compiling it', async () => {
      const { ctx } = txContext((sql) =>
        sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'ACTIVE' }] }
          : sql.startsWith('SELECT status') ? { rows: [{ status: 'ACTIVE' }] } : undefined);
      await expect(Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)).rejects.toThrow('Cannot activate');
      expect(loadStoredCompileInput).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND for a nonexistent pathway', async () => {
      const { ctx } = txContext(() => undefined);
      await expect(Mutation.Mutation.activatePathway({}, { id: 'nonexistent' }, ctx)).rejects.toThrow('not found');
    });
  });

  describe('archivePathway', () => {
    it('should reject archiving a non-ACTIVE pathway', async () => {
      const ctx = createMockContext();
      // CTE returns empty (status wasn't ACTIVE), fallback SELECT returns SUPERSEDED
      ctx.pool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ status: 'SUPERSEDED' }] });

      await expect(
        Mutation.Mutation.archivePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot archive');
    });

    it('archives a DRAFT', async () => {
      const ctx = createMockContext();
      await Mutation.Mutation.archivePathway({}, { id: 'test-id' }, ctx);
      expect((ctx.pool.query as jest.Mock).mock.calls.some(([sql]) => /status IN \('ACTIVE', 'DRAFT'\)/.test(String(sql)))).toBe(true);
    });
  });

  describe('reactivatePathway', () => {
    beforeEach(() => (loadStoredCompileInput as jest.Mock).mockReset());

    it('pre-warms a reactivated pathway, which may be an archived draft that was never activated (D14)', async () => {
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(compileInput(MINIMAL_PATHWAY));
      const { ctx } = txContext((sql) =>
        sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'ARCHIVED' }] }
          : sql.startsWith('WITH') ? { rows: [{ ...row('ACTIVE'), previousStatus: 'ARCHIVED' }] } : undefined);
      await Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx);
      expect(prewarmPathwayInBackground).toHaveBeenCalledWith((ctx as { pool: unknown }).pool, 'test-id', 'activate');
    });

    it('refuses to reactivate an ARCHIVED pathway that does not compile', async () => {
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(compileInput(LEGACY));
      const { ctx } = txContext((sql) => (sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'ARCHIVED' }] } : undefined));
      await expect(Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx)).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    });

    it.each(['DRAFT', 'ACTIVE'])('rejects reactivating a %s pathway', async (status) => {
      const { ctx } = txContext((sql) =>
        sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status }] }
          : sql.startsWith('SELECT status') ? { rows: [{ status }] } : undefined);
      await expect(Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx)).rejects.toThrow('Cannot reactivate');
    });
  });
});
