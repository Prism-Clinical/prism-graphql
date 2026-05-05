/**
 * Phase 4 commit 2 — medication normalizer tests.
 *
 * The DB layer is mocked via a fake Pool that records queries and answers
 * from a synthetic cache. RxNav HTTP calls are mocked at the rxnav-client
 * boundary so we never actually hit NLM.
 */

jest.mock('../services/medications/rxnav-client', () => ({
  findRxcuiByString: jest.fn(),
  getIngredientRxcui: jest.fn(),
  getAtcClasses: jest.fn(),
  getRxcuiByNdc: jest.fn(),
}));

import {
  lookupNormalizedMedication,
  prewarmMedication,
  prewarmMedications,
} from '../services/medications/normalizer';
import {
  findRxcuiByString,
  getIngredientRxcui,
  getAtcClasses,
  getRxcuiByNdc,
} from '../services/medications/rxnav-client';

// ── Fake Pool ───────────────────────────────────────────────────────

interface CacheRow {
  input_text: string;
  input_system: string;
  input_code: string;
  ingredient_rxcui: string | null;
  ingredient_name: string | null;
  atc_classes: string[];
  normalized_at: Date;
}

function makeFakePool() {
  const cache = new Map<string, CacheRow>();
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  const key = (text: string, system: string, code: string) => `${text}|${system}|${code}`;

  const pool = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });

      if (/SELECT.*FROM medication_normalization_cache/is.test(sql)) {
        const [text, system, code] = params as [string, string, string];
        const row = cache.get(key(text, system, code));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (/INSERT INTO medication_normalization_cache/i.test(sql)) {
        const [text, system, code, rxcui, name, atc] = params as [
          string, string, string, string | null, string | null, string[],
        ];
        cache.set(key(text, system, code), {
          input_text: text,
          input_system: system,
          input_code: code,
          ingredient_rxcui: rxcui,
          ingredient_name: name,
          atc_classes: atc ?? [],
          normalized_at: new Date(),
        });
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unmocked SQL: ${sql.slice(0, 60)}`);
    }),
  };

  return { pool: pool as never, cache, queries };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── lookupNormalizedMedication ──────────────────────────────────────

describe('lookupNormalizedMedication', () => {
  it('returns null when nothing is cached', async () => {
    const { pool } = makeFakePool();
    const result = await lookupNormalizedMedication(pool, { text: 'Metoprolol' });
    expect(result).toBeNull();
    expect(findRxcuiByString).not.toHaveBeenCalled();
  });

  it('returns the cached normalized medication when one exists', async () => {
    const { pool, cache } = makeFakePool();
    cache.set('metoprolol||', {
      input_text: 'metoprolol',
      input_system: '',
      input_code: '',
      ingredient_rxcui: '6918',
      ingredient_name: 'metoprolol',
      atc_classes: ['C07AB02'],
      normalized_at: new Date(),
    });
    const result = await lookupNormalizedMedication(pool, { text: 'Metoprolol' });
    expect(result).toEqual({
      ingredientRxcui: '6918',
      ingredientName: 'metoprolol',
      atcClasses: ['C07AB02'],
    });
  });

  it('returns null when cache has a NULL row (tried-and-failed)', async () => {
    const { pool, cache } = makeFakePool();
    cache.set('madeupdrug||', {
      input_text: 'madeupdrug',
      input_system: '',
      input_code: '',
      ingredient_rxcui: null,
      ingredient_name: null,
      atc_classes: [],
      normalized_at: new Date(),
    });
    const result = await lookupNormalizedMedication(pool, { text: 'MadeUpDrug' });
    expect(result).toBeNull();
  });

  it('canonicalizes input — case-insensitive, whitespace-trimmed', async () => {
    const { pool, cache } = makeFakePool();
    cache.set('metoprolol||', {
      input_text: 'metoprolol',
      input_system: '',
      input_code: '',
      ingredient_rxcui: '6918',
      ingredient_name: 'metoprolol',
      atc_classes: [],
      normalized_at: new Date(),
    });
    const a = await lookupNormalizedMedication(pool, { text: '  Metoprolol  ' });
    const b = await lookupNormalizedMedication(pool, { text: 'METOPROLOL' });
    expect(a?.ingredientRxcui).toBe('6918');
    expect(b?.ingredientRxcui).toBe('6918');
  });

  it('keys cache by (text, system, code) so coded inputs cache separately', async () => {
    const { pool, cache } = makeFakePool();
    cache.set('toprol xl|RxNorm|866924', {
      input_text: 'toprol xl',
      input_system: 'RxNorm',
      input_code: '866924',
      ingredient_rxcui: '6918',
      ingredient_name: 'metoprolol',
      atc_classes: [],
      normalized_at: new Date(),
    });
    // Same text, no system → cache miss (different cache key).
    const free = await lookupNormalizedMedication(pool, { text: 'Toprol XL' });
    const coded = await lookupNormalizedMedication(pool, { text: 'Toprol XL', system: 'RxNorm', code: '866924' });
    expect(free).toBeNull();
    expect(coded?.ingredientRxcui).toBe('6918');
  });
});

// ── prewarmMedication ───────────────────────────────────────────────

describe('prewarmMedication', () => {
  it('hits the cache on second call (no second RxNav round-trip)', async () => {
    const { pool } = makeFakePool();
    (findRxcuiByString as jest.Mock).mockResolvedValue('6918');
    (getIngredientRxcui as jest.Mock).mockResolvedValue({ rxcui: '6918', name: 'metoprolol' });
    (getAtcClasses as jest.Mock).mockResolvedValue(['C07AB02']);

    const first = await prewarmMedication(pool, { text: 'Metoprolol' });
    const second = await prewarmMedication(pool, { text: 'Metoprolol' });

    expect(first).toEqual(second);
    expect(findRxcuiByString).toHaveBeenCalledTimes(1);
    expect(getAtcClasses).toHaveBeenCalledTimes(1);
  });

  it('persists null when RxNav has no exact match', async () => {
    const { pool } = makeFakePool();
    (findRxcuiByString as jest.Mock).mockResolvedValue(null);

    const result = await prewarmMedication(pool, { text: 'NotARealDrug' });
    expect(result).toBeNull();

    // Second call hits cache, doesn't re-query RxNav
    const result2 = await prewarmMedication(pool, { text: 'NotARealDrug' });
    expect(result2).toBeNull();
    expect(findRxcuiByString).toHaveBeenCalledTimes(1);
  });

  it('persists null when starting RxCUI exists but has no ingredient', async () => {
    const { pool } = makeFakePool();
    (findRxcuiByString as jest.Mock).mockResolvedValue('99999');
    (getIngredientRxcui as jest.Mock).mockResolvedValue(null);

    const result = await prewarmMedication(pool, { text: 'WeirdDrug' });
    expect(result).toBeNull();
    expect(getAtcClasses).not.toHaveBeenCalled();
  });

  it('uses NDC path when input.system=NDC', async () => {
    const { pool } = makeFakePool();
    (getRxcuiByNdc as jest.Mock).mockResolvedValue('6918');
    (getIngredientRxcui as jest.Mock).mockResolvedValue({ rxcui: '6918', name: 'metoprolol' });
    (getAtcClasses as jest.Mock).mockResolvedValue(['C07AB02']);

    const result = await prewarmMedication(pool, {
      text: '00378-0024-01',
      system: 'NDC',
      code: '00378-0024-01',
    });
    expect(result?.ingredientRxcui).toBe('6918');
    expect(getRxcuiByNdc).toHaveBeenCalledWith('00378-0024-01');
    expect(findRxcuiByString).not.toHaveBeenCalled();
  });

  it('skips findRxcuiByString when input.system=RxNorm + code provided', async () => {
    const { pool } = makeFakePool();
    (getIngredientRxcui as jest.Mock).mockResolvedValue({ rxcui: '6918', name: 'metoprolol' });
    (getAtcClasses as jest.Mock).mockResolvedValue(['C07AB02']);

    const result = await prewarmMedication(pool, {
      text: 'metoprolol succinate',
      system: 'RxNorm',
      code: '866924',
    });
    expect(result?.ingredientRxcui).toBe('6918');
    expect(findRxcuiByString).not.toHaveBeenCalled();
    expect(getRxcuiByNdc).not.toHaveBeenCalled();
    expect(getIngredientRxcui).toHaveBeenCalledWith('866924');
  });

  it('returns empty atcClasses when RxNav has no ATC mapping', async () => {
    const { pool } = makeFakePool();
    (findRxcuiByString as jest.Mock).mockResolvedValue('6918');
    (getIngredientRxcui as jest.Mock).mockResolvedValue({ rxcui: '6918', name: 'metoprolol' });
    (getAtcClasses as jest.Mock).mockResolvedValue([]);

    const result = await prewarmMedication(pool, { text: 'Metoprolol' });
    expect(result?.atcClasses).toEqual([]);
  });
});

// ── prewarmMedications (batch) ──────────────────────────────────────

describe('prewarmMedications', () => {
  it('counts succeeded vs failed across a batch', async () => {
    const { pool } = makeFakePool();
    (findRxcuiByString as jest.Mock).mockImplementation(async (name: string) => {
      if (name === 'Metoprolol') return '6918';
      if (name === 'Lisinopril') return '29046';
      return null; // unknown drug
    });
    (getIngredientRxcui as jest.Mock).mockImplementation(async (rxcui: string) => ({
      rxcui,
      name: rxcui === '6918' ? 'metoprolol' : 'lisinopril',
    }));
    (getAtcClasses as jest.Mock).mockResolvedValue([]);

    const result = await prewarmMedications(pool, [
      { text: 'Metoprolol' },
      { text: 'Lisinopril' },
      { text: 'NotADrug' },
    ]);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('survives an HTTP error mid-batch (counts as failed but does not throw)', async () => {
    const { pool } = makeFakePool();
    (findRxcuiByString as jest.Mock)
      .mockImplementationOnce(async () => { throw new Error('rxnav 503'); })
      .mockImplementationOnce(async () => '29046');
    (getIngredientRxcui as jest.Mock).mockResolvedValue({ rxcui: '29046', name: 'lisinopril' });
    (getAtcClasses as jest.Mock).mockResolvedValue([]);

    const result = await prewarmMedications(pool, [
      { text: 'Metoprolol' },
      { text: 'Lisinopril' },
    ]);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });
});
