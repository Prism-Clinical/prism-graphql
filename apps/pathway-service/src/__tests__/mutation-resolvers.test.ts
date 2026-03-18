import { Mutation } from '../resolvers/Mutation';
import { MINIMAL_PATHWAY } from './fixtures/reference-pathway';

// Mock the import module
jest.mock('../services/import/import-orchestrator', () => ({
  importPathway: jest.fn(),
}));

import { importPathway as mockImportPathway } from '../services/import/import-orchestrator';

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
    it('should activate a DRAFT pathway using single atomic CTE', async () => {
      const ctx = createMockContext();
      // Single query returns both the activated pathway and previousStatus
      ctx.pool.query = jest.fn().mockResolvedValueOnce({
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
      // Should only need one query for the happy path
      expect(ctx.pool.query).toHaveBeenCalledTimes(1);
    });

    it('should reject activating a non-DRAFT pathway', async () => {
      const ctx = createMockContext();
      // CTE returns empty (status wasn't DRAFT), fallback SELECT returns ACTIVE
      ctx.pool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ status: 'ACTIVE' }] });

      await expect(
        Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot activate');
    });

    it('should throw NOT_FOUND for nonexistent pathway', async () => {
      const ctx = createMockContext();
      // CTE returns empty, fallback SELECT also returns empty
      ctx.pool.query = jest.fn()
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
      ctx.pool.query = jest.fn().mockResolvedValueOnce({
        rows: [{ status: 'DRAFT', logicalId: 'CP-Test' }],
      });

      await expect(
        Mutation.Mutation.archivePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot archive');
    });
  });

  describe('reactivatePathway', () => {
    it('should reject reactivating a DRAFT pathway', async () => {
      const ctx = createMockContext();
      // CTE returns empty (status wasn't SUPERSEDED/ARCHIVED), fallback SELECT returns DRAFT
      ctx.pool.query = jest.fn()
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
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ status: 'ACTIVE' }] });

      await expect(
        Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot reactivate');
    });
  });
});
