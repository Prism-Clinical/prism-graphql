import { importPathway } from '../services/import/import-orchestrator';
import { MINIMAL_PATHWAY, clonePathway } from './fixtures/reference-pathway';

// Mock the pool and client
function createMockPool() {
  const client = {
    query: jest.fn(async (text: string, values?: unknown[]) => {
      // Handle BEGIN/COMMIT/ROLLBACK
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) {
        return { rows: [] };
      }
      // Handle LOAD/SET for AGE
      if (text.includes('LOAD') || text.includes('search_path')) {
        return { rows: [] };
      }
      // Handle Cypher queries (SELECT * FROM cypher...)
      if (text.includes('cypher(')) {
        return { rows: [{ v: JSON.stringify({ id: 123456 }) }] };
      }
      // Handle SELECT for existing pathway lookup
      if (text.includes('SELECT') && text.includes('pathway_graph_index')) {
        return { rows: [] }; // No existing pathway
      }
      // Handle INSERT ... RETURNING
      if (text.includes('INSERT INTO pathway_graph_index')) {
        return {
          rows: [{
            id: '00000000-0000-4000-a000-000000000099',
            age_node_id: null,
            logical_id: values?.[1] || 'test',
            title: values?.[2] || 'test',
            version: values?.[3] || '1.0',
            category: values?.[4] || 'OBSTETRIC',
            status: 'DRAFT',
            condition_codes: [],
            is_active: false,
            created_at: new Date(),
            updated_at: new Date(),
          }],
        };
      }
      // Handle pathway_code_sets INSERT (returns id for the new row)
      if (text.includes('INSERT INTO pathway_code_sets')) {
        return {
          rows: [{ id: '00000000-0000-4000-a000-00000000aaaa' }],
        };
      }
      // Handle other INSERTs
      if (text.includes('INSERT')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };

  const pool = {
    connect: jest.fn(async () => client),
  };

  return { pool, client };
}

describe('importPathway', () => {
  it('should succeed for a valid NEW_PATHWAY import', async () => {
    const { pool } = createMockPool();
    const result = await importPathway(pool as any, MINIMAL_PATHWAY, 'NEW_PATHWAY', 'user-1');

    expect(result.validation.valid).toBe(true);
    expect(result.pathwayId).toBeDefined();
    expect(result.importType).toBe('NEW_PATHWAY');
    // NEW_PATHWAY diff is synthetic (creation summary, no previous version to compare)
    expect(result.diff).toBeDefined();
    expect(result.diff!.synthetic).toBe(true);
  });

  it('should return validation errors without writing to DB', async () => {
    const { pool, client } = createMockPool();
    const pw = clonePathway(MINIMAL_PATHWAY);
    delete (pw as any).schema_version;
    delete (pw.pathway as any).logical_id;

    const result = await importPathway(pool as any, pw, 'NEW_PATHWAY', 'user-1');

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
    expect(result.pathwayId).toBe('');
    // Should not have started a transaction
    expect(client.query).not.toHaveBeenCalledWith('BEGIN');
  });

  it('should execute graph and relational writes within BEGIN/COMMIT', async () => {
    const { pool, client } = createMockPool();
    await importPathway(pool as any, MINIMAL_PATHWAY, 'NEW_PATHWAY', 'user-1');

    const calls = client.query.mock.calls.map((c: any[]) => c[0]);
    const beginIdx = calls.indexOf('BEGIN');
    const commitIdx = calls.indexOf('COMMIT');
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThan(beginIdx);
  });

  it('should ROLLBACK on error during graph construction', async () => {
    const { pool, client } = createMockPool();
    // Make Cypher execution fail
    let callCount = 0;
    client.query.mockImplementation(async (text: string) => {
      if (text.includes('cypher(')) {
        callCount++;
        if (callCount > 1) throw new Error('AGE error');
        return { rows: [{ v: JSON.stringify({ id: 123456 }) }] };
      }
      if (text.includes('INSERT INTO pathway_graph_index')) {
        return { rows: [{ id: 'test-id' }] };
      }
      if (text.includes('INSERT INTO pathway_code_sets')) {
        return { rows: [{ id: '00000000-0000-4000-a000-00000000bbbb' }] };
      }
      return { rows: [] };
    });

    await expect(
      importPathway(pool as any, MINIMAL_PATHWAY, 'NEW_PATHWAY', 'user-1')
    ).rejects.toThrow();

    const calls = client.query.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain('ROLLBACK');
  });

  it('should reject DRAFT_UPDATE when no existing DRAFT pathway found', async () => {
    const { pool } = createMockPool();
    const result = await importPathway(pool as any, MINIMAL_PATHWAY, 'DRAFT_UPDATE', 'user-1');

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toContainEqual(
      expect.stringContaining('DRAFT')
    );
  });

  it('should release client on success', async () => {
    const { pool, client } = createMockPool();
    await importPathway(pool as any, MINIMAL_PATHWAY, 'NEW_PATHWAY', 'user-1');
    expect(client.release).toHaveBeenCalled();
  });

  it('should not acquire a DB client when validation fails', async () => {
    const { pool } = createMockPool();
    const pw = clonePathway(MINIMAL_PATHWAY);
    delete (pw as any).schema_version;

    await importPathway(pool as any, pw, 'NEW_PATHWAY', 'user-1');
    // Validation fails before pool.connect(), so client is never acquired
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
