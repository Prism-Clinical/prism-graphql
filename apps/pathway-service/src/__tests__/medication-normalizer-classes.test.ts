/**
 * Migration 071: the normaliser keeps EVERY ingredient and the product-level
 * classes, refreshes rows cached in the old shape, and can make a chart's
 * medications available — awaited, bounded — before an evaluation reads the
 * cache. RxNav is mocked at the client boundary; nothing here touches NLM.
 */
jest.mock('../services/medications/rxnav-client', () => ({
  findRxcuiByString: jest.fn(),
  getIngredientRxcui: jest.fn(),
  getIngredients: jest.fn(),
  getAtcClasses: jest.fn(),
  getTermType: jest.fn(),
  getProductAtcClasses: jest.fn(),
  getRxcuiByNdc: jest.fn(),
}));
jest.mock('../resolvers/helpers/resolution-context', () => {
  const actual = jest.requireActual('../resolvers/helpers/resolution-context');
  return { ...actual, buildResolutionContext: jest.fn() };
});
jest.mock('../services/llm/llm-gate-client', () => ({ loadLLMGateConfig: () => ({ model: 'm1' }) }));

import {
  ensureChartMedicationsNormalized,
  isStaleRow,
  lookupNormalizedMedication,
  prewarmMedication,
} from '../services/medications/normalizer';
import { loadSafetyReference, normalizedFor } from '../services/medications/safety-reference';
import * as rxnav from '../services/medications/rxnav-client';
import { buildGraphContext, buildResolutionContext } from '../resolvers/helpers/resolution-context';
import { loadEvaluationEnv } from '../services/resolution/pipeline/load-env';

const rx = rxnav as jest.Mocked<typeof rxnav>;

type Row = Record<string, unknown>;
/** A cache table: answers the single-key read, the batch (unnest) reads, and the upsert. */
function fakeDb(seed: Row[] = []) {
  const rows = new Map<string, Row>(seed.map((r) => [`${r.input_text}|${r.input_system}|${r.input_code}`, r]));
  const log: string[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (/^BEGIN|^COMMIT|^ROLLBACK/.test(sql)) { log.push(sql.split(' ')[0]); return { rows: [] }; }
    if (/INSERT INTO medication_normalization_cache/.test(sql)) {
      const [t, s, c, rxcui, name, atc, rxcuis, names, product, tty, productAtc] = params as unknown[];
      rows.set(`${t}|${s}|${c}`, {
        input_text: t, input_system: s, input_code: c, ingredient_rxcui: rxcui, ingredient_name: name, atc_classes: atc,
        ingredient_rxcuis: rxcuis, ingredient_names: names, product_rxcui: product, product_tty: tty, product_atc_classes: productAtc,
      });
      log.push(`INSERT ${t}`);
      return { rows: [] };
    }
    if (/FROM medication_normalization_cache/.test(sql)) {
      log.push(/unnest/.test(sql) ? 'SELECT batch' : 'SELECT one');
      if (/unnest/.test(sql)) {
        const [ts, ss, cs] = params as string[][];
        return { rows: ts.map((t, i) => rows.get(`${t}|${ss[i]}|${cs[i]}`)).filter(Boolean) };
      }
      const [t, s, c] = params as string[];
      const row = rows.get(`${t}|${s}|${c}`);
      return { rows: row ? [row] : [] };
    }
    return { rows: [] };
  });
  return { rows, log, query, pool: { query, connect: jest.fn(async () => ({ query, release: jest.fn() })) } };
}

const PRENATAL = { text: 'Prenatal multivitamin', system: 'RXNORM', code: '1116183' };
const PRENATAL_KEY = 'prenatal multivitamin|RXNORM|1116183';
function rxnavKnowsPrenatal() {
  rx.getIngredientRxcui.mockResolvedValue({ rxcui: '10454', name: 'thiamine' });
  rx.getIngredients.mockResolvedValue([
    { rxcui: '10454', name: 'thiamine' }, { rxcui: '24941', name: 'ferrous fumarate' }, { rxcui: '4511', name: 'folic acid' },
  ]);
  rx.getAtcClasses.mockResolvedValue(['A11DA']);
  rx.getTermType.mockResolvedValue('SBD');
  rx.getProductAtcClasses.mockResolvedValue(['B03AE']);
}

beforeEach(() => jest.resetAllMocks());

describe('what is stored', () => {
  it('every ingredient and the product classes — and the first ingredient exactly as before, for drug safety', async () => {
    rxnavKnowsPrenatal();
    const db = fakeDb();
    const norm = await prewarmMedication(db.pool as never, PRENATAL);

    // What the drug-interaction checks read is unchanged: the first ingredient and ITS classes.
    expect(norm).toMatchObject({ ingredientRxcui: '10454', ingredientName: 'thiamine', atcClasses: ['A11DA'] });
    // What a pathway gate matches on is new.
    expect(norm!.classification).toEqual({
      ingredientRxcuis: ['10454', '24941', '4511'],
      ingredientNames: ['thiamine', 'ferrous fumarate', 'folic acid'],
      productAtcClasses: ['B03AE'],
    });
    expect(db.rows.get(PRENATAL_KEY)).toMatchObject({
      ingredient_rxcui: '10454', atc_classes: ['A11DA'],
      ingredient_rxcuis: ['10454', '24941', '4511'], product_rxcui: '1116183', product_tty: 'SBD', product_atc_classes: ['B03AE'],
    });
    // The coded RxCUI is used directly, and the product's own classes are asked for with its term type.
    expect(rx.findRxcuiByString).not.toHaveBeenCalled();
    expect(rx.getProductAtcClasses).toHaveBeenCalledWith('1116183', 'SBD');
    expect(await lookupNormalizedMedication(db.pool as never, PRENATAL)).toEqual(norm);
  });

  it('an unmappable medication is cached as before: no ingredient, no classification', async () => {
    rx.getIngredientRxcui.mockResolvedValue(null);
    const db = fakeDb();
    expect(await prewarmMedication(db.pool as never, PRENATAL)).toBeNull();
    expect(db.rows.get(PRENATAL_KEY)).toMatchObject({ ingredient_rxcui: null, ingredient_rxcuis: null, product_atc_classes: null });
  });
});

describe('rows cached before migration 071', () => {
  const OLD_ROW = {
    input_text: 'prenatal multivitamin', input_system: 'RXNORM', input_code: '1116183',
    ingredient_rxcui: '10454', ingredient_name: 'thiamine', atc_classes: ['A11DA'],
    ingredient_rxcuis: null, ingredient_names: null, product_atc_classes: null,
  };

  it('are stale — and read as NOT CLASSIFIED, never as "contains only thiamine"', async () => {
    expect(isStaleRow({ ingredientRxcui: '10454', ingredientRxcuis: null })).toBe(true);
    expect(isStaleRow({ ingredientRxcui: '10454', ingredientRxcuis: ['10454'] })).toBe(false);
    expect(isStaleRow({ ingredientRxcui: null, ingredientRxcuis: null })).toBe(false); // unmappable: final
    const db = fakeDb([OLD_ROW]);
    const norm = await lookupNormalizedMedication(db.pool as never, PRENATAL);
    expect(norm).toEqual({ ingredientRxcui: '10454', ingredientName: 'thiamine', atcClasses: ['A11DA'] });
    expect(norm!.classification).toBeUndefined();
    // The safety reference carries it the same way: usable for interactions, unclassified for gates.
    const ref = await loadSafetyReference(db.pool as never, { medications: [PRENATAL], allergySnomedCodes: [] });
    expect(normalizedFor(ref, PRENATAL)).toEqual(norm);
  });

  it('are re-resolved the next time the medication is pre-warmed', async () => {
    rxnavKnowsPrenatal();
    const db = fakeDb([OLD_ROW]);
    const norm = await prewarmMedication(db.pool as never, PRENATAL);
    expect(norm!.classification!.ingredientRxcuis).toEqual(['10454', '24941', '4511']);
    expect(db.rows.get(PRENATAL_KEY)!.ingredient_rxcuis).toEqual(['10454', '24941', '4511']);
    // And then never again.
    jest.clearAllMocks();
    await prewarmMedication(db.pool as never, PRENATAL);
    expect(rx.getIngredients).not.toHaveBeenCalled();
  });

  it('are KEPT when RxNav cannot resolve the input (a row a clinician resolved by hand), or is down', async () => {
    const db = fakeDb([OLD_ROW]);
    rx.getIngredientRxcui.mockResolvedValue(null);
    expect(await prewarmMedication(db.pool as never, PRENATAL)).toMatchObject({ ingredientRxcui: '10454' });
    expect(db.rows.get(PRENATAL_KEY)).toEqual(OLD_ROW);
    rx.getIngredientRxcui.mockRejectedValue(new Error('RxNav 503'));
    await expect(prewarmMedication(db.pool as never, PRENATAL)).rejects.toThrow('RxNav 503');
    expect(db.rows.get(PRENATAL_KEY)).toEqual(OLD_ROW);
  });
});

describe('ensureChartMedicationsNormalized — before an evaluation', () => {
  it('a medication first seen this request is normalised and cached before it returns', async () => {
    rxnavKnowsPrenatal();
    const db = fakeDb();
    const out = await ensureChartMedicationsNormalized(db.pool as never, [PRENATAL]);
    expect(out).toEqual({ attempted: 1, timedOut: false });
    expect(db.rows.get(PRENATAL_KEY)!.ingredient_rxcuis).toEqual(['10454', '24941', '4511']);
  });

  it('medications the cache already holds — classified or unmappable — cost one read and no RxNav call', async () => {
    rxnavKnowsPrenatal();
    const db = fakeDb();
    await ensureChartMedicationsNormalized(db.pool as never, [PRENATAL]);
    jest.clearAllMocks();
    const again = await ensureChartMedicationsNormalized(db.pool as never, [PRENATAL, PRENATAL]);
    expect(again).toEqual({ attempted: 0, timedOut: false });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(rx.getIngredientRxcui).not.toHaveBeenCalled();
  });

  it('RxNav slower than the deadline: returns without the row, and the lookup still finishes and is cached', async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    rxnavKnowsPrenatal();
    rx.getIngredientRxcui.mockImplementation(async () => { await slow; return { rxcui: '10454', name: 'thiamine' }; });
    const db = fakeDb();
    const out = await ensureChartMedicationsNormalized(db.pool as never, [PRENATAL], 20);
    expect(out).toEqual({ attempted: 1, timedOut: true });
    expect(db.rows.has(PRENATAL_KEY)).toBe(false);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(db.rows.get(PRENATAL_KEY)!.ingredient_rxcuis).toEqual(['10454', '24941', '4511']);
  });

  it('RxNav down: nothing is cached (so it is retried), and it does not throw', async () => {
    rx.getIngredientRxcui.mockRejectedValue(new Error('ECONNREFUSED'));
    const db = fakeDb();
    await expect(ensureChartMedicationsNormalized(db.pool as never, [PRENATAL])).resolves.toEqual({ attempted: 1, timedOut: false });
    expect(db.rows.has(PRENATAL_KEY)).toBe(false);
  });

  it('a database error does not fail the evaluation either', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pool = { query: jest.fn().mockRejectedValue(new Error('pool exhausted')) };
    await expect(ensureChartMedicationsNormalized(pool as never, [PRENATAL])).resolves.toEqual({ attempted: 0, timedOut: false });
    warn.mockRestore();
  });
});

describe('loadEvaluationEnv', () => {
  it('normalises the chart medication BEFORE the snapshot opens, so the snapshot reads the new row', async () => {
    rxnavKnowsPrenatal();
    const nodes = [{ id: '1', nodeIdentifier: 'root', nodeType: 'Pathway', properties: {} }];
    (buildResolutionContext as jest.Mock).mockResolvedValue({
      graphContext: buildGraphContext(nodes as never, [] as never), edges: [], signals: [],
      thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
      confidenceEngine: { loadScoringConfig: jest.fn().mockResolvedValue({}) },
      codeMap: new Map(), temporalDefaults: {},
    });
    const db = fakeDb();
    const patient = {
      patientId: 'p', conditionCodes: [], labResults: [], allergies: [],
      medications: [{ code: '1116183', system: 'RXNORM', display: 'Prenatal multivitamin' }],
    };
    const env = await loadEvaluationEnv(db.pool as never, 'pw', { patient: patient as never });

    // Pre-check, RxNav, write — and only then the read-only snapshot.
    expect(db.log.slice(0, 4)).toEqual(['SELECT batch', 'SELECT one', `INSERT prenatal multivitamin`, 'BEGIN']);
    expect(normalizedFor(env.safety, PRENATAL)!.classification).toEqual({
      ingredientRxcuis: ['10454', '24941', '4511'],
      ingredientNames: ['thiamine', 'ferrous fumarate', 'folic acid'],
      productAtcClasses: ['B03AE'],
    });
    expect(env.unnormalized).toEqual([]);
  });
});
