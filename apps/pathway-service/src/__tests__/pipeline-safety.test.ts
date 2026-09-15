jest.mock('../services/medications/rxnav-client', () => ({
  findRxcuiByString: jest.fn(),
  getAtcClasses: jest.fn(),
  getIngredientRxcui: jest.fn(),
  getRxcuiByNdc: jest.fn(),
}));

import * as rxnav from '../services/medications/rxnav-client';
import { interactionBetween, loadSafetyReference } from '../services/medications/safety-reference';
import { pairSafety, patientSafety } from '../services/resolution/pipeline/safety';
import type { PatientContext } from '../services/confidence/types';

// The cache key is text + system + code (canonicalKey), so a coded patient
// medication needs its own row.
const cacheRow = (text: string, rxcui: string, atc: string[], system = '', code = '') => ({
  input_text: text, input_system: system, input_code: code,
  ingredient_rxcui: rxcui, ingredient_name: text, atc_classes: atc,
});

function fakeDb(rows: { cache?: unknown[]; pairs?: unknown[]; classes?: unknown[]; allergies?: unknown[] }) {
  return {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('medication_normalization_cache')) return { rows: rows.cache ?? [] };
      if (sql.includes('FROM drug_interactions')) return { rows: rows.pairs ?? [] };
      if (sql.includes('FROM drug_class_interactions')) return { rows: rows.classes ?? [] };
      if (sql.includes('allergy_class_mappings')) return { rows: rows.allergies ?? [] };
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
}

const CACHE = [
  cacheRow('amoxicillin', '723', ['J01CA04']),
  cacheRow('warfarin', '11289', ['B01AA03']),
  cacheRow('warfarin', '11289', ['B01AA03'], 'RxNorm', '11289'),
  cacheRow('aspirin', '1191', ['B01AC06', 'N02BA01']),
];
const patient = (p: Partial<PatientContext> = {}): PatientContext =>
  ({ patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [], ...p });
const candidate = (id: string, drugName: string) => ({ recommendationId: id, drugName, meta: { nodeType: 'Medication' } });
const universe = {
  medications: [{ text: 'Amoxicillin' }, { text: 'Warfarin' }, { text: 'Warfarin', system: 'RxNorm', code: '11289' }, { text: 'Aspirin' }, { text: 'Unobtainium' }],
  allergySnomedCodes: ['91936005'],
};

describe('safety reference', () => {
  it('loads every row once and never calls RxNav', async () => {
    const db = fakeDb({
      cache: CACHE,
      pairs: [{ rxcui_a: '11289', rxcui_b: '1191', severity: 'SEVERE', mechanism: 'bleeding', clinical_advice: 'avoid' }],
      classes: [{ atc_class_a: 'B01A', atc_class_b: 'J01C', severity: 'MODERATE', mechanism: 'm', clinical_advice: 'c' }],
      allergies: [{ snomed_code: '91936005', snomed_display: 'Allergy to penicillin', atc_class: 'J01C' }],
    });
    const ref = await loadSafetyReference(db as never, universe);

    expect(db.query).toHaveBeenCalledTimes(4);
    expect(ref.normalized.size).toBe(4);
    expect(ref.pairs.size).toBe(1);
    expect(ref.classRules).toHaveLength(1);
    expect(ref.allergyMappings).toHaveLength(1);
    // Named, not Object.values(rxnav): esModuleInterop adds a `default` key holding the module object.
    for (const fn of [rxnav.findRxcuiByString, rxnav.getAtcClasses, rxnav.getIngredientRxcui, rxnav.getRxcuiByNdc]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('interactionBetween: pair wins, class matches both orientations, most severe class, no self', async () => {
    const ref = await loadSafetyReference(fakeDb({
      cache: CACHE,
      pairs: [{ rxcui_a: '11289', rxcui_b: '1191', severity: 'SEVERE', mechanism: 'pair', clinical_advice: null }],
      classes: [
        { atc_class_a: 'B01A', atc_class_b: 'B01A', severity: 'CONTRAINDICATED', mechanism: 'class', clinical_advice: null },
        { atc_class_a: 'J01C', atc_class_b: 'B01AA', severity: 'MODERATE', mechanism: 'mod', clinical_advice: null },
        { atc_class_a: 'B01AA', atc_class_b: 'J01CA', severity: 'SEVERE', mechanism: 'sev', clinical_advice: null },
      ],
    }) as never, universe);
    const drug = (text: string) => { const n = ref.normalized.get(`${text}||`)!; return { rxcui: n.ingredientRxcui, atcClasses: n.atcClasses }; };

    expect(interactionBetween(ref, drug('warfarin'), drug('aspirin'))).toMatchObject({ matchType: 'PAIR', severity: 'SEVERE' });
    expect(interactionBetween(ref, drug('aspirin'), drug('warfarin'))).toMatchObject({ matchType: 'PAIR', severity: 'SEVERE' });
    expect(interactionBetween(ref, drug('amoxicillin'), drug('warfarin'))).toMatchObject({ matchType: 'CLASS', severity: 'SEVERE' });
    expect(interactionBetween(ref, drug('warfarin'), drug('amoxicillin'))).toMatchObject({ matchType: 'CLASS', severity: 'SEVERE' });
    expect(interactionBetween(ref, drug('warfarin'), drug('warfarin'))).toBeNull();
  });
});

describe('patientSafety / pairSafety', () => {
  async function ref() {
    return loadSafetyReference(fakeDb({
      cache: CACHE,
      pairs: [{ rxcui_a: '11289', rxcui_b: '1191', severity: 'SEVERE', mechanism: 'bleeding', clinical_advice: 'avoid' }],
      allergies: [{ snomed_code: '91936005', snomed_display: 'Allergy to penicillin', atc_class: 'J01C' }],
    }) as never, universe);
  }

  it('suppresses on patient allergy and patient medication, scoped PATIENT', async () => {
    const out = patientSafety(await ref(), [candidate('med-amox', 'Amoxicillin'), candidate('med-asa', 'Aspirin')], patient({
      allergies: [{ code: '91936005', system: 'SNOMED' }],
      medications: [{ code: '11289', system: 'RxNorm', display: 'Warfarin' }],
    }));

    expect([...out.suppressed].sort()).toEqual(['med-amox', 'med-asa']);
    expect(out.findings.map((f) => [f.recommendationId, f.category, f.scope])).toEqual(
      expect.arrayContaining([['med-amox', 'ALLERGY', 'PATIENT'], ['med-asa', 'DDI_SEVERE', 'PATIENT']]),
    );
    expect(out.unavailable).toEqual([]);
  });

  it('reports unnormalised candidates and patient medications instead of skipping them (D14)', async () => {
    const out = patientSafety(await ref(), [candidate('med-x', 'Unobtainium'), candidate('med-amox', 'Amoxicillin')], patient({
      medications: [{ code: '999', system: 'RxNorm', display: 'Mysterydrug' }],
    }));

    expect(out.unavailable).toEqual([
      { drugName: 'Mysterydrug', source: 'PATIENT_MEDICATION' },
      { nodeId: 'med-x', drugName: 'Unobtainium', source: 'CANDIDATE' },
    ]);
  });

  it('pairSafety checks every pair and suppresses both sides, scoped SET', async () => {
    const out = pairSafety(await ref(), [candidate('a', 'Warfarin'), candidate('b', 'Aspirin'), candidate('c', 'Amoxicillin')]);

    expect([...out.suppressed].sort()).toEqual(['a', 'b']);
    expect(out.findings).toHaveLength(2);
    expect(out.findings.every((f) => f.scope === 'SET')).toBe(true);
  });
});
