/**
 * Phase 4 commit 3 — DDI engine tests.
 *
 * Tests run against a synthetic Pool seeded with table-shaped data per case.
 * Real Postgres canonicalization (LEAST/GREATEST) is replicated in the fake
 * so the engine's queries return what real Postgres would return.
 */

import {
  checkDrugDrugInteraction,
  checkDrugAllergy,
  moreSevere,
  InteractionResult,
} from '../services/medications/ddi-engine';

interface PairRow {
  rxcui_a: string;
  rxcui_b: string;
  severity: string;
  mechanism: string | null;
  clinical_advice: string | null;
}

interface ClassRow {
  atc_class_a: string;
  atc_class_b: string;
  severity: string;
  mechanism: string | null;
  clinical_advice: string | null;
}

interface AllergyRow {
  snomed_code: string;
  snomed_display: string;
  atc_class: string;
}

const SEVERITY_RANK: Record<string, number> = {
  CONTRAINDICATED: 1, SEVERE: 2, MODERATE: 3, MINOR: 4,
};

function makePool(opts: {
  pairs?: PairRow[];
  classRules?: ClassRow[];
  allergyMappings?: AllergyRow[];
}) {
  const pairs = opts.pairs ?? [];
  const classRules = opts.classRules ?? [];
  const allergyMappings = opts.allergyMappings ?? [];

  return {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      // ── pair lookup ──
      if (/FROM drug_interactions/.test(sql)) {
        const [a, b] = params as [string, string];
        const lo = a < b ? a : b;
        const hi = a < b ? b : a;
        const hits = pairs.filter((p) => p.rxcui_a === lo && p.rxcui_b === hi);
        return { rows: hits, rowCount: hits.length };
      }

      // ── class lookup (prefix-match in both orientations) ──
      if (/FROM drug_class_interactions/.test(sql)) {
        const [classesA, classesB] = params as [string[], string[]];
        const drugAHasPrefix = (p: string) => classesA.some((c) => c.startsWith(p));
        const drugBHasPrefix = (p: string) => classesB.some((c) => c.startsWith(p));
        const hits = classRules
          .filter((r) =>
            (drugAHasPrefix(r.atc_class_a) && drugBHasPrefix(r.atc_class_b)) ||
            (drugAHasPrefix(r.atc_class_b) && drugBHasPrefix(r.atc_class_a))
          )
          .sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity])
          .slice(0, 1);
        return { rows: hits, rowCount: hits.length };
      }

      // ── allergy mappings ──
      if (/FROM allergy_class_mappings/.test(sql)) {
        const [snomedCodes] = params as [string[]];
        const hits = allergyMappings.filter((a) => snomedCodes.includes(a.snomed_code));
        return { rows: hits, rowCount: hits.length };
      }

      throw new Error(`Unmocked SQL: ${sql.slice(0, 80)}`);
    }),
  } as never;
}

// ── Drug ↔ drug ─────────────────────────────────────────────────────

describe('checkDrugDrugInteraction — pair table', () => {
  it('returns a pair-level hit', async () => {
    const pool = makePool({
      pairs: [{
        rxcui_a: '11289', rxcui_b: '703', severity: 'SEVERE',
        mechanism: 'CYP2C9', clinical_advice: 'Reduce warfarin',
      }],
    });
    const result = await checkDrugDrugInteraction(
      pool,
      { rxcui: '11289', atcClasses: ['B01AA03'] },
      { rxcui: '703', atcClasses: ['C01BD01'] },
    );
    expect(result?.severity).toBe('SEVERE');
    expect(result?.matchType).toBe('PAIR');
    expect(result?.mechanism).toBe('CYP2C9');
  });

  it('canonicalizes drug order before query (a/b interchangeable)', async () => {
    const pool = makePool({
      pairs: [{
        rxcui_a: '11289', rxcui_b: '703', severity: 'SEVERE',
        mechanism: null, clinical_advice: null,
      }],
    });
    const r1 = await checkDrugDrugInteraction(
      pool, { rxcui: '11289', atcClasses: [] }, { rxcui: '703', atcClasses: [] },
    );
    const r2 = await checkDrugDrugInteraction(
      pool, { rxcui: '703', atcClasses: [] }, { rxcui: '11289', atcClasses: [] },
    );
    expect(r1?.severity).toBe('SEVERE');
    expect(r2?.severity).toBe('SEVERE');
  });

  it('returns null for same-drug self-comparison without querying', async () => {
    const pool = makePool({});
    const result = await checkDrugDrugInteraction(
      pool, { rxcui: '6918', atcClasses: ['C07AB02'] }, { rxcui: '6918', atcClasses: ['C07AB02'] },
    );
    expect(result).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('checkDrugDrugInteraction — class fallback', () => {
  it('falls back to class table when pair has no entry', async () => {
    const pool = makePool({
      classRules: [{
        atc_class_a: 'C03DA', atc_class_b: 'C09AA', severity: 'SEVERE',
        mechanism: 'Hyperkalemia', clinical_advice: 'Monitor K+',
      }],
    });
    const result = await checkDrugDrugInteraction(
      pool,
      { rxcui: '38454', atcClasses: ['C09AA02'] },
      { rxcui: '8629', atcClasses: ['C03DA01'] },
    );
    expect(result?.matchType).toBe('CLASS');
    expect(result?.severity).toBe('SEVERE');
    expect(result?.matchedClasses).toEqual({ atcClassA: 'C03DA', atcClassB: 'C09AA' });
  });

  it('does not fall through to class when pair hit exists (pair beats class)', async () => {
    // Pair says MODERATE; class would say CONTRAINDICATED. Pair wins.
    const pool = makePool({
      pairs: [{
        rxcui_a: '11289', rxcui_b: '703', severity: 'MODERATE',
        mechanism: null, clinical_advice: null,
      }],
      classRules: [{
        atc_class_a: 'B01AA', atc_class_b: 'C01BD', severity: 'CONTRAINDICATED',
        mechanism: null, clinical_advice: null,
      }],
    });
    const result = await checkDrugDrugInteraction(
      pool,
      { rxcui: '11289', atcClasses: ['B01AA03'] },
      { rxcui: '703', atcClasses: ['C01BD01'] },
    );
    expect(result?.severity).toBe('MODERATE');
    expect(result?.matchType).toBe('PAIR');
  });

  it('returns the most severe class match when multiple class pairs fire', async () => {
    const pool = makePool({
      classRules: [
        {
          atc_class_a: 'AAA', atc_class_b: 'BBB', severity: 'MINOR',
          mechanism: null, clinical_advice: null,
        },
        {
          atc_class_a: 'AAA', atc_class_b: 'CCC', severity: 'SEVERE',
          mechanism: null, clinical_advice: null,
        },
      ],
    });
    const result = await checkDrugDrugInteraction(
      pool,
      { rxcui: 'd1', atcClasses: ['AAA'] },
      { rxcui: 'd2', atcClasses: ['BBB', 'CCC'] },
    );
    expect(result?.severity).toBe('SEVERE');
  });

  it('returns null when neither pair nor class hits', async () => {
    const pool = makePool({});
    const result = await checkDrugDrugInteraction(
      pool, { rxcui: 'x', atcClasses: ['Z01'] }, { rxcui: 'y', atcClasses: ['Z02'] },
    );
    expect(result).toBeNull();
  });

  it('skips class lookup when either drug has no ATC classes', async () => {
    const pool = makePool({});
    const result = await checkDrugDrugInteraction(
      pool, { rxcui: 'x', atcClasses: [] }, { rxcui: 'y', atcClasses: ['Z02'] },
    );
    expect(result).toBeNull();
    // pair query was made (returned no rows); class query was NOT made
    const calls = pool.query.mock.calls;
    expect(calls.some((c) => /drug_class_interactions/.test(c[0]))).toBe(false);
  });
});

// ── Drug ↔ allergy ──────────────────────────────────────────────────

describe('checkDrugAllergy', () => {
  it('returns a hit when drug ATC class is a descendant of allergy ATC class', async () => {
    const pool = makePool({
      allergyMappings: [{
        snomed_code: '91936005',
        snomed_display: 'Penicillin allergy',
        atc_class: 'J01C',
      }],
    });
    // amoxicillin: J01CA04
    const result = await checkDrugAllergy(
      pool,
      { rxcui: '723', atcClasses: ['J01CA04'] },
      [{ snomedCode: '91936005' }],
    );
    expect(result).toHaveLength(1);
    expect(result[0].snomedCode).toBe('91936005');
    expect(result[0].matchedDrugAtcClass).toBe('J01CA04');
    expect(result[0].allergyAtcClass).toBe('J01C');
  });

  it('returns no hit when drug class does not prefix the allergy class', async () => {
    const pool = makePool({
      allergyMappings: [{
        snomed_code: '91936005',
        snomed_display: 'Penicillin allergy',
        atc_class: 'J01C',
      }],
    });
    // metoprolol: C07AB02 — not a penicillin
    const result = await checkDrugAllergy(
      pool,
      { rxcui: '6918', atcClasses: ['C07AB02'] },
      [{ snomedCode: '91936005' }],
    );
    expect(result).toEqual([]);
  });

  it('returns no hit when patient has no allergies', async () => {
    const pool = makePool({});
    const result = await checkDrugAllergy(
      pool, { rxcui: '723', atcClasses: ['J01CA04'] }, [],
    );
    expect(result).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns no hit when drug has no ATC classes', async () => {
    const pool = makePool({});
    const result = await checkDrugAllergy(
      pool, { rxcui: '999', atcClasses: [] }, [{ snomedCode: '91936005' }],
    );
    expect(result).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('produces multiple results when one drug has multiple matching ATC classes', async () => {
    // Drug in two penicillin-adjacent ATC classes; both prefix-match J01C.
    const pool = makePool({
      allergyMappings: [{
        snomed_code: '91936005',
        snomed_display: 'Penicillin allergy',
        atc_class: 'J01C',
      }],
    });
    const result = await checkDrugAllergy(
      pool,
      { rxcui: 'multi', atcClasses: ['J01CA04', 'J01CR02'] },
      [{ snomedCode: '91936005' }],
    );
    expect(result).toHaveLength(2);
    const matched = result.map((r) => r.matchedDrugAtcClass).sort();
    expect(matched).toEqual(['J01CA04', 'J01CR02']);
  });

  it('ignores allergies whose SNOMED code is not in the mapping table', async () => {
    const pool = makePool({
      allergyMappings: [{
        snomed_code: '91936005', snomed_display: 'Penicillin', atc_class: 'J01C',
      }],
    });
    const result = await checkDrugAllergy(
      pool,
      { rxcui: '723', atcClasses: ['J01CA04'] },
      [{ snomedCode: 'unknown-snomed' }],
    );
    expect(result).toEqual([]);
  });
});

// ── moreSevere helper ──────────────────────────────────────────────

describe('moreSevere', () => {
  const cases: Array<[InteractionResult, InteractionResult, string]> = [
    [
      { severity: 'CONTRAINDICATED', mechanism: null, clinicalAdvice: null, matchType: 'PAIR', matchedClasses: null },
      { severity: 'SEVERE', mechanism: null, clinicalAdvice: null, matchType: 'PAIR', matchedClasses: null },
      'CONTRAINDICATED',
    ],
    [
      { severity: 'MODERATE', mechanism: null, clinicalAdvice: null, matchType: 'PAIR', matchedClasses: null },
      { severity: 'MINOR', mechanism: null, clinicalAdvice: null, matchType: 'PAIR', matchedClasses: null },
      'MODERATE',
    ],
  ];
  test.each(cases)('picks the more severe of (%s, %s)', (a, b, expected) => {
    expect(moreSevere(a, b)?.severity).toBe(expected);
  });

  it('handles a null on either side', () => {
    const r: InteractionResult = {
      severity: 'MODERATE', mechanism: null, clinicalAdvice: null,
      matchType: 'PAIR', matchedClasses: null,
    };
    expect(moreSevere(null, r)).toBe(r);
    expect(moreSevere(r, null)).toBe(r);
    expect(moreSevere(null, null)).toBeNull();
  });
});
