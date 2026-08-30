import { Mutation } from '../resolvers/Mutation';
import { MINIMAL_PATHWAY } from './fixtures/reference-pathway';

// Mock the import module
jest.mock('../services/import/import-orchestrator', () => ({
  importPathway: jest.fn(),
}));

import { importPathway as mockImportPathway } from '../services/import/import-orchestrator';

// activate / reactivate re-validate the STORED graph before flipping status,
// which means reading it out of AGE. Stub that boundary so these stay unit
// tests; the reconstruction itself is covered in stored-graph.test.ts.
jest.mock('../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../resolvers/helpers/resolution-context'),
  fetchGraphFromAGE: jest.fn(
    async (): Promise<{ nodes: unknown[]; edges: unknown[] }> => ({ nodes: [], edges: [] }),
  ),
}));

import { fetchGraphFromAGE } from '../resolvers/helpers/resolution-context';

const mockFetchGraph = fetchGraphFromAGE as jest.Mock;

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

  // activatePathway / reactivatePathway now lead with a SELECT of the target
  // row so the stored graph can be strictly re-validated before the status
  // flip (a DRAFT is validated leniently on import, and nothing re-checked it
  // on the way out). Every mock sequence below therefore starts one query
  // earlier than it used to; the assertions are unchanged.
  describe('activatePathway', () => {
    it('should activate a DRAFT pathway using single atomic CTE', async () => {
      const ctx = createMockContext();
      ctx.pool.query = jest.fn()
        // 1. target lookup for the pre-activation validation. ageNodeId null =
        //    no graph to validate, so it short-circuits without querying more.
        .mockResolvedValueOnce({ rows: [{ id: 'test-id', status: 'DRAFT', ageNodeId: null }] })
        // 2. the atomic CTE that actually flips status
        .mockResolvedValueOnce({
          rows: [{
            id: 'test-id', status: 'ACTIVE', logicalId: 'CP-Test',
            ageNodeId: null, title: 'Test', version: '1.0', category: 'ACUTE_CARE',
            conditionCodes: [], scope: null, targetPopulation: null,
            isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            previousStatus: 'DRAFT',
          }],
        });

      const result = await Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx);
      expect(result).toBeDefined();
      expect(result.previousStatus).toBe('DRAFT');
      // Target lookup + CTE. Still no fallback SELECT on the happy path.
      expect(ctx.pool.query).toHaveBeenCalledTimes(2);
    });

    it('should refuse to activate a DRAFT whose stored graph fails strict validation', async () => {
      const ctx = createMockContext();
      // A graph carrying the orphaned, property-less Gate that draft-mode
      // import lets through — exactly the shape that reached a published
      // version of vaginitis-in-pregnancy-v1.
      mockFetchGraph.mockResolvedValueOnce({
        nodes: [
          { nodeIdentifier: 'root', nodeType: 'Pathway', properties: {} },
          { nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { stage_number: 1, title: 'S' } },
          { nodeIdentifier: 'gate-new-1', nodeType: 'Gate', properties: { gate_type: 'question' } },
        ],
        edges: [{ sourceId: 'root', targetId: 'stage-1', edgeType: 'HAS_STAGE' }],
      });
      ctx.pool.query = jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'test-id', status: 'DRAFT', ageNodeId: '123',
            logicalId: 'CP-Test', title: 'Test', version: '1.0', category: 'ACUTE_CARE',
          }],
        })
        // condition-code members for the reconstructed JSON
        .mockResolvedValueOnce({ rows: [{ code: 'J06.9', system: 'ICD-10' }] });

      await expect(
        Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot activate');

      // The status flip must never have been attempted.
      expect(ctx.pool.query).toHaveBeenCalledTimes(2);
    });

    it('should reject activating a non-DRAFT pathway', async () => {
      const ctx = createMockContext();
      // Target is ACTIVE, so validation is skipped; CTE returns empty (status
      // wasn't DRAFT), fallback SELECT returns ACTIVE
      ctx.pool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'test-id', status: 'ACTIVE', ageNodeId: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ status: 'ACTIVE' }] });

      await expect(
        Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot activate');
    });

    it('should throw NOT_FOUND for nonexistent pathway', async () => {
      const ctx = createMockContext();
      // Target lookup empty, CTE empty, fallback SELECT also empty
      ctx.pool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        Mutation.Mutation.activatePathway({}, { id: 'nonexistent' }, ctx)
      ).rejects.toThrow('not found');
    });
  });

  describe('archivePathway', () => {
    it('should reject archiving a non-ACTIVE pathway', async () => {
      const ctx = createMockContext();
      // CTE returns empty (status wasn't ACTIVE), fallback SELECT returns DRAFT
      ctx.pool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ status: 'DRAFT' }] });

      await expect(
        Mutation.Mutation.archivePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot archive');
    });
  });

  describe('reactivatePathway', () => {
    it('should reject reactivating a DRAFT pathway', async () => {
      const ctx = createMockContext();
      // Target is DRAFT, so validation is skipped; CTE returns empty (status
      // wasn't SUPERSEDED/ARCHIVED), fallback SELECT returns DRAFT
      ctx.pool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'test-id', status: 'DRAFT', ageNodeId: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ status: 'DRAFT' }] });

      await expect(
        Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot reactivate');
    });

    it('should reject reactivating an ACTIVE pathway', async () => {
      const ctx = createMockContext();
      // CTE returns empty (status wasn't SUPERSEDED/ARCHIVED), fallback SELECT returns ACTIVE
      ctx.pool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'test-id', status: 'ACTIVE', ageNodeId: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ status: 'ACTIVE' }] });

      await expect(
        Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot reactivate');
    });

    it('should refuse to reactivate an ARCHIVED pathway whose graph is invalid', async () => {
      const ctx = createMockContext();
      mockFetchGraph.mockResolvedValueOnce({
        nodes: [
          { nodeIdentifier: 'root', nodeType: 'Pathway', properties: {} },
          { nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { stage_number: 1, title: 'S' } },
          { nodeIdentifier: 'guidance-new-1', nodeType: 'Guidance', properties: {} },
        ],
        edges: [{ sourceId: 'root', targetId: 'stage-1', edgeType: 'HAS_STAGE' }],
      });
      ctx.pool.query = jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'test-id', status: 'ARCHIVED', ageNodeId: '123',
            logicalId: 'CP-Test', title: 'Test', version: '1.0', category: 'ACUTE_CARE',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ code: 'J06.9', system: 'ICD-10' }] });

      await expect(
        Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot reactivate');
      expect(ctx.pool.query).toHaveBeenCalledTimes(2);
    });
  });
});
