/**
 * Phase 4 commit 6 — admin queue tests.
 */

jest.mock('../services/medications/rxnav-client', () => ({
  getIngredientRxcui: jest.fn(),
  getAtcClasses: jest.fn(),
}));

import {
  listUnnormalizedMedications,
  manuallyResolveMedicationNormalization,
} from '../services/medications/admin-queue';
import { getIngredientRxcui, getAtcClasses } from '../services/medications/rxnav-client';

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
  const key = (text: string, system: string, code: string) => `${text}|${system}|${code}`;

  return {
    pool: {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (/SELECT.*FROM medication_normalization_cache.*WHERE ingredient_rxcui IS NULL/is.test(sql)) {
          const rows = [...cache.values()].filter((r) => r.ingredient_rxcui === null);
          return { rows, rowCount: rows.length };
        }
        if (/INSERT INTO medication_normalization_cache/i.test(sql)) {
          const [text, system, code, rxcui, name, atc] = params as [
            string, string, string, string | null, string | null, string[],
          ];
          cache.set(key(text, system, code), {
            input_text: text, input_system: system, input_code: code,
            ingredient_rxcui: rxcui, ingredient_name: name,
            atc_classes: atc ?? [], normalized_at: new Date(),
          });
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unmocked SQL: ${sql.slice(0, 60)}`);
      }),
    } as never,
    cache,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── listUnnormalizedMedications ─────────────────────────────────────

describe('listUnnormalizedMedications', () => {
  it('returns only NULL-ingredient cache rows', async () => {
    const { pool, cache } = makeFakePool();
    cache.set('mysterydrug||', {
      input_text: 'mysterydrug', input_system: '', input_code: '',
      ingredient_rxcui: null, ingredient_name: null, atc_classes: [],
      normalized_at: new Date('2026-04-01'),
    });
    cache.set('metoprolol||', {
      input_text: 'metoprolol', input_system: '', input_code: '',
      ingredient_rxcui: '6918', ingredient_name: 'metoprolol', atc_classes: ['C07AB02'],
      normalized_at: new Date('2026-04-01'),
    });

    const result = await listUnnormalizedMedications(pool);
    expect(result).toHaveLength(1);
    expect(result[0].inputText).toBe('mysterydrug');
  });

  it('returns empty input_system/input_code as null', async () => {
    const { pool, cache } = makeFakePool();
    cache.set('drug||', {
      input_text: 'drug', input_system: '', input_code: '',
      ingredient_rxcui: null, ingredient_name: null, atc_classes: [],
      normalized_at: new Date(),
    });
    const result = await listUnnormalizedMedications(pool);
    expect(result[0].inputSystem).toBeNull();
    expect(result[0].inputCode).toBeNull();
  });
});

// ── manuallyResolveMedicationNormalization ──────────────────────────

describe('manuallyResolveMedicationNormalization', () => {
  it('resolves a free-text drug to ingredient RxCUI + ATC classes and rewrites cache', async () => {
    const { pool, cache } = makeFakePool();
    cache.set('mysterydrug||', {
      input_text: 'mysterydrug', input_system: '', input_code: '',
      ingredient_rxcui: null, ingredient_name: null, atc_classes: [],
      normalized_at: new Date(),
    });

    (getIngredientRxcui as jest.Mock).mockResolvedValue({ rxcui: '6918', name: 'metoprolol' });
    (getAtcClasses as jest.Mock).mockResolvedValue(['C07AB02']);

    const result = await manuallyResolveMedicationNormalization(pool, {
      inputText: 'MysteryDrug', // case + whitespace
      rxcui: '6918',
    });

    expect(result.ingredientRxcui).toBe('6918');
    expect(result.ingredientName).toBe('metoprolol');
    expect(result.atcClasses).toEqual(['C07AB02']);

    // Cache row got rewritten with non-null values
    const cached = cache.get('mysterydrug||');
    expect(cached?.ingredient_rxcui).toBe('6918');
    expect(cached?.atc_classes).toEqual(['C07AB02']);
  });

  it('throws when the supplied RxCUI does not resolve to an ingredient', async () => {
    const { pool } = makeFakePool();
    (getIngredientRxcui as jest.Mock).mockResolvedValue(null);

    await expect(
      manuallyResolveMedicationNormalization(pool, {
        inputText: 'X', rxcui: 'invalid',
      }),
    ).rejects.toThrow(/did not resolve to an ingredient/);
  });

  it('handles a fresh resolution (no prior cache row)', async () => {
    const { pool, cache } = makeFakePool();
    (getIngredientRxcui as jest.Mock).mockResolvedValue({ rxcui: '6918', name: 'metoprolol' });
    (getAtcClasses as jest.Mock).mockResolvedValue([]);

    const result = await manuallyResolveMedicationNormalization(pool, {
      inputText: 'metoprolol',
      rxcui: '6918',
    });
    expect(result.ingredientRxcui).toBe('6918');
    expect(cache.size).toBe(1);
  });

  it('canonicalizes input keys (lowercase + trim)', async () => {
    const { pool, cache } = makeFakePool();
    (getIngredientRxcui as jest.Mock).mockResolvedValue({ rxcui: '6918', name: 'metoprolol' });
    (getAtcClasses as jest.Mock).mockResolvedValue([]);

    await manuallyResolveMedicationNormalization(pool, {
      inputText: '  Metoprolol  ',
      rxcui: '6918',
    });

    expect(cache.has('metoprolol||')).toBe(true);
  });

  it('preserves system + code in the cache key when supplied', async () => {
    const { pool, cache } = makeFakePool();
    (getIngredientRxcui as jest.Mock).mockResolvedValue({ rxcui: '6918', name: 'metoprolol' });
    (getAtcClasses as jest.Mock).mockResolvedValue([]);

    await manuallyResolveMedicationNormalization(pool, {
      inputText: 'Toprol XL',
      inputSystem: 'RxNorm',
      inputCode: '866924',
      rxcui: '6918',
    });

    expect(cache.has('toprol xl|RxNorm|866924')).toBe(true);
  });
});
