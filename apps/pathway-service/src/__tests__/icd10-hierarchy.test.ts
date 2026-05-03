import {
  findDescendants,
  findAncestors,
  expandWithDescendants,
  expandWithAncestors,
  ensureIcd10Codes,
  derivedParent,
  labelize,
} from '../services/codes/icd10-hierarchy';

function mockPool() {
  return { query: jest.fn() } as unknown as { query: jest.Mock };
}

describe('icd10-hierarchy', () => {
  describe('findDescendants', () => {
    it('returns descendant codes for a parent code', async () => {
      const pool = mockPool();
      pool.query.mockResolvedValueOnce({
        rows: [{ code: 'E11.0' }, { code: 'E11.65' }, { code: 'E11.9' }],
      });

      const result = await findDescendants(pool as any, 'E11');

      expect(result).toEqual(['E11.0', 'E11.65', 'E11.9']);
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('child.path <@ parent.path');
      expect(sql).toContain('child.code != $1');
      expect(pool.query.mock.calls[0][1]).toEqual(['E11']);
    });

    it('returns empty array for a leaf code', async () => {
      const pool = mockPool();
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await findDescendants(pool as any, 'E11.65');

      expect(result).toEqual([]);
    });
  });

  describe('findAncestors', () => {
    it('returns ancestor codes ordered by ancestry', async () => {
      const pool = mockPool();
      pool.query.mockResolvedValueOnce({
        rows: [{ code: 'E11' }, { code: 'E11.6' }],
      });

      const result = await findAncestors(pool as any, 'E11.65');

      expect(result).toEqual(['E11', 'E11.6']);
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('leaf.path <@ ancestor.path');
      expect(sql).toContain('ancestor.code != $1');
      expect(pool.query.mock.calls[0][1]).toEqual(['E11.65']);
    });

    it('returns empty array for a root code', async () => {
      const pool = mockPool();
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await findAncestors(pool as any, 'E11');

      expect(result).toEqual([]);
    });
  });

  describe('expandWithDescendants', () => {
    it('returns empty array for empty input without hitting the DB', async () => {
      const pool = mockPool();

      const result = await expandWithDescendants(pool as any, []);

      expect(result).toEqual([]);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('expands single code to itself plus descendants', async () => {
      const pool = mockPool();
      pool.query.mockResolvedValueOnce({
        rows: [{ code: 'E11' }, { code: 'E11.65' }, { code: 'E11.9' }],
      });

      const result = await expandWithDescendants(pool as any, ['E11']);

      expect(new Set(result)).toEqual(new Set(['E11', 'E11.65', 'E11.9']));
      expect(pool.query.mock.calls[0][1]).toEqual([['E11']]);
    });

    it('expands multiple codes and deduplicates results', async () => {
      const pool = mockPool();
      pool.query.mockResolvedValueOnce({
        rows: [
          { code: 'E11' },
          { code: 'E11.65' },
          { code: 'I10' },
          { code: 'I10.9' },
        ],
      });

      const result = await expandWithDescendants(pool as any, ['E11', 'I10']);

      expect(new Set(result)).toEqual(new Set(['E11', 'E11.65', 'I10', 'I10.9']));
      expect(result).toHaveLength(4);
    });

    it('passes through input codes not present in the hierarchy', async () => {
      const pool = mockPool();
      // Only one of the two input codes is found in the hierarchy
      pool.query.mockResolvedValueOnce({
        rows: [{ code: 'E11' }, { code: 'E11.65' }],
      });

      const result = await expandWithDescendants(pool as any, [
        'E11',
        'UNKNOWN-CODE',
      ]);

      expect(new Set(result)).toEqual(new Set(['E11', 'E11.65', 'UNKNOWN-CODE']));
    });

    it('uses the ANY array operator to handle multiple codes in one query', async () => {
      const pool = mockPool();
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expandWithDescendants(pool as any, ['A', 'B', 'C']);

      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('parent.code = ANY($1::text[])');
      expect(pool.query.mock.calls[0][1]).toEqual([['A', 'B', 'C']]);
    });
  });

  describe('expandWithAncestors', () => {
    it('returns empty array for empty input without hitting the DB', async () => {
      const pool = mockPool();

      const result = await expandWithAncestors(pool as any, []);

      expect(result).toEqual([]);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('expands single code to itself plus ancestors', async () => {
      const pool = mockPool();
      pool.query.mockResolvedValueOnce({
        rows: [{ code: 'E11' }, { code: 'E11.6' }, { code: 'E11.65' }],
      });

      const result = await expandWithAncestors(pool as any, ['E11.65']);

      expect(new Set(result)).toEqual(new Set(['E11', 'E11.6', 'E11.65']));
    });

    it('passes through codes not in the hierarchy', async () => {
      const pool = mockPool();
      pool.query.mockResolvedValueOnce({
        rows: [{ code: 'E11' }, { code: 'E11.65' }],
      });

      const result = await expandWithAncestors(pool as any, [
        'E11.65',
        'NEW-CODE-2027',
      ]);

      expect(new Set(result)).toEqual(new Set(['E11', 'E11.65', 'NEW-CODE-2027']));
    });

    it('uses leaf.path <@ ancestor.path predicate', async () => {
      const pool = mockPool();
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expandWithAncestors(pool as any, ['E11.65']);

      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('leaf.path <@ ancestor.path');
      expect(sql).toContain('leaf.code = ANY($1::text[])');
    });
  });
});

describe('icd10-hierarchy — derivedParent', () => {
  it('returns null for 3-char roots', () => {
    expect(derivedParent('E11')).toBeNull();
    expect(derivedParent('I10')).toBeNull();
  });
  it('returns 3-char root for 5-char codes', () => {
    expect(derivedParent('E11.6')).toBe('E11');
    expect(derivedParent('I10.9')).toBe('I10');
  });
  it('drops the last char for 6+ char codes', () => {
    expect(derivedParent('E11.65')).toBe('E11.6');
    expect(derivedParent('E11.651')).toBe('E11.65');
    expect(derivedParent('E11.6510')).toBe('E11.651');
  });
});

describe('icd10-hierarchy — labelize', () => {
  it('replaces dots with underscores', () => {
    expect(labelize('E11')).toBe('E11');
    expect(labelize('E11.6')).toBe('E11_6');
    expect(labelize('E11.65')).toBe('E11_65');
  });
});

describe('icd10-hierarchy — ensureIcd10Codes', () => {
  function mockClient() {
    return { query: jest.fn() } as unknown as { query: jest.Mock };
  }

  it('does nothing for empty input', async () => {
    const client = mockClient();
    await ensureIcd10Codes(client as any, []);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('ignores non-ICD-10 codes silently', async () => {
    const client = mockClient();
    await ensureIcd10Codes(client as any, [
      { code: '38341003', system: 'SNOMED', description: 'Hypertension' },
      { code: '7052', system: 'RXNORM' },
    ]);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('skips inserting when code already exists', async () => {
    const client = mockClient();
    // Existence check returns 1 row → already present
    client.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });

    await ensureIcd10Codes(client as any, [
      { code: 'E11', system: 'ICD-10', description: 'Type 2 diabetes' },
    ]);

    // Only the SELECT — no INSERT
    expect(client.query).toHaveBeenCalledTimes(1);
    const sql = client.query.mock.calls[0][0];
    expect(sql).toContain('SELECT 1 FROM icd10_codes');
  });

  it('inserts a new root code with NULL parent and bare label path', async () => {
    const client = mockClient();
    client.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // E11 missing
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT

    await ensureIcd10Codes(client as any, [
      { code: 'E11', system: 'ICD-10', description: 'Type 2 diabetes' },
    ]);

    expect(client.query).toHaveBeenCalledTimes(2);
    const insertCall = client.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO icd10_codes');
    // Args: [code, desc, cat, cat_desc, is_billable, parent, path]
    expect(insertCall[1]).toEqual(['E11', 'Type 2 diabetes', 'E11', 'E11', true, null, 'E11']);
  });

  it('backfills missing parent ancestors top-down with synthetic descriptions', async () => {
    const client = mockClient();
    // Walk: check E11.65 (missing) -> check E11.6 (missing) -> check E11 (present)
    // Then insert E11.6 (parent E11 needs DB path lookup since pre-existing) and
    // E11.65 (parent E11.6 was just inserted — uses cached path, no DB lookup).
    client.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // E11.65 missing
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // E11.6 missing
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // E11 present (chain stops)
      // Insert E11.6: parent path lookup (DB), then INSERT
      .mockResolvedValueOnce({ rows: [{ path: 'E11' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      // Insert E11.65: parent E11.6 in insertedPaths cache, no DB lookup, just INSERT
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await ensureIcd10Codes(client as any, [
      { code: 'E11.65', system: 'ICD-10', description: 'T2DM with hyperglycemia' },
    ]);

    // 3 existence checks + 1 path lookup (for pre-existing E11) + 2 inserts = 6 queries
    expect(client.query).toHaveBeenCalledTimes(6);

    // First insert: E11.6 (synthetic parent)
    const insertParent = client.query.mock.calls[4];
    expect(insertParent[1][0]).toBe('E11.6');
    expect(insertParent[1][1]).toBe('<auto-added parent of E11.65>');
    expect(insertParent[1][4]).toBe(false); // is_billable = false for synthetic
    expect(insertParent[1][5]).toBe('E11'); // parent_code
    expect(insertParent[1][6]).toBe('E11.E11_6'); // path

    // Second insert: E11.65 (the original) — uses cached parent path
    const insertOriginal = client.query.mock.calls[5];
    expect(insertOriginal[1][0]).toBe('E11.65');
    expect(insertOriginal[1][1]).toBe('T2DM with hyperglycemia');
    expect(insertOriginal[1][4]).toBe(true);
    expect(insertOriginal[1][5]).toBe('E11.6');
    expect(insertOriginal[1][6]).toBe('E11.E11_6.E11_65');
  });

  it('backfills the entire chain when no ancestors exist', async () => {
    const client = mockClient();
    // All three missing — chain walks to root. Inserts go top-down with all
    // parent paths cached from prior inserts (no DB path lookups needed).
    client.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // E11.65 missing
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // E11.6 missing
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // E11 missing
      // Insert E11 (root): no path lookup
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      // Insert E11.6: parent E11 in cache, no DB lookup
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      // Insert E11.65: parent E11.6 in cache, no DB lookup
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await ensureIcd10Codes(client as any, [
      { code: 'E11.65', system: 'ICD-10' },
    ]);

    // 3 existence checks + 3 inserts (no DB path lookups since all parents were cached) = 6 queries
    expect(client.query).toHaveBeenCalledTimes(6);

    // First insert is root E11 with NULL parent
    const insertRoot = client.query.mock.calls[3];
    expect(insertRoot[1][0]).toBe('E11');
    expect(insertRoot[1][5]).toBeNull(); // parent_code
    expect(insertRoot[1][6]).toBe('E11'); // path is just the label
    // is_billable=false because the input was E11.65 (not E11) — E11 is synthetic here
    expect(insertRoot[1][4]).toBe(false);

    // Subsequent inserts use cached paths
    expect(client.query.mock.calls[4][1][6]).toBe('E11.E11_6');
    expect(client.query.mock.calls[5][1][6]).toBe('E11.E11_6.E11_65');
  });

  it('uses default description when none provided for original code', async () => {
    const client = mockClient();
    client.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // E99 missing (root)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT

    await ensureIcd10Codes(client as any, [
      { code: 'E99', system: 'ICD-10' }, // no description
    ]);

    const insertCall = client.query.mock.calls[1];
    expect(insertCall[1][1]).toBe('<auto-added from pathway upload>');
  });

  it('throws if a parent path lookup unexpectedly returns nothing', async () => {
    const client = mockClient();
    // E11.65 missing, then chain check returns "exists" for E11.6 (lying here)
    // but path lookup returns empty — this simulates a corrupted state
    client.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // E11.65 missing
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // E11.6 reportedly exists
      // Path lookup returns no rows — corrupted
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      ensureIcd10Codes(client as any, [{ code: 'E11.65', system: 'ICD-10' }]),
    ).rejects.toThrow(/parent path missing/);
  });
});
