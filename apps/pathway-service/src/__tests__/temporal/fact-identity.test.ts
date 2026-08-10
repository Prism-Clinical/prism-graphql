import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import { ResolutionInput, SyntheticPatientContext } from '../../services/resolution/temporal/trust-mode';
import {
  EvaluationTemporalContext,
  makeEvaluationTemporalContext,
} from '../../services/resolution/temporal/evaluation-context';
import { NormalizedFact } from '../../services/resolution/temporal/fact-model';
import {
  buildEffectivePatientContext,
  mergeAdditionalContext,
} from '../../services/resolution/effective-context';
import type { PatientContext } from '../../services/confidence/types';

const AS_OF = '2026-06-01T12:00:00.000Z';
const ctx = (): EvaluationTemporalContext =>
  makeEvaluationTemporalContext({ evaluationAsOf: AS_OF });

const synthetic = (over: Partial<SyntheticPatientContext> = {}): ResolutionInput => ({
  mode: 'SYNTHETIC',
  patientContext: {
    patientId: 'p1',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
    ...over,
  },
});

const pc = (over: Partial<PatientContext> = {}): PatientContext => ({
  patientId: 'p1',
  conditionCodes: [],
  medications: [],
  labResults: [],
  allergies: [],
  ...over,
});

const idOf = (store: readonly NormalizedFact[], kind: string): string[] =>
  store.filter((f) => f.kind === kind).map((f) => f.factId);

describe('factId stability', () => {
  it('does not renumber other kinds when a condition is added', () => {
    // A shared ordinal counter meant inserting one condition shifted every
    // medication, allergy and lab id — so nothing downstream could reference
    // a fact across two assemblies of nearly-identical input.
    const base = {
      medications: [{ code: 'm1', system: 's' }],
      labResults: [{ code: 'l1', system: 's' }],
    };
    const before = assembleContext(synthetic(base), ctx());
    const after = assembleContext(
      synthetic({ ...base, conditionCodes: [{ code: 'c1', system: 's' }] }),
      ctx(),
    );
    expect(idOf(after, 'medication_order')).toEqual(idOf(before, 'medication_order'));
    expect(idOf(after, 'lab')).toEqual(idOf(before, 'lab'));
  });

  it('assigns identical ids to identical input, which is what retraversal relies on', () => {
    const input = () =>
      synthetic({
        conditionCodes: [{ code: 'c1', system: 's' }],
        vitalSigns: { heart_rate: 80 },
      });
    expect(assembleContext(input(), ctx()).map((f) => f.factId)).toEqual(
      assembleContext(input(), ctx()).map((f) => f.factId),
    );
  });
});

describe('buildEffectivePatientContext — distinct occurrences survive', () => {
  it('keeps the same code on a DIFFERENT date', () => {
    // Deduplicating on code|system alone discarded recurrence entirely, so
    // count_in_window counted 1 no matter how many events occurred. This is
    // upstream of the assembler: no amount of fact-model correctness fixes it.
    const merged = buildEffectivePatientContext(
      pc({ conditionCodes: [{ code: 'N39.0', system: 'icd10', date: '2026-01-15' }] }),
      { conditionCodes: [{ code: 'N39.0', system: 'icd10', date: '2026-06-02' }] },
    );
    expect(merged.conditionCodes).toHaveLength(2);
  });

  it('keeps the same code and date under a different sourceId', () => {
    const merged = buildEffectivePatientContext(
      pc({
        conditionCodes: [
          { code: 'N39.0', system: 'icd10', date: '2026-01-15', sourceId: 'a' },
        ],
      }),
      {
        conditionCodes: [
          { code: 'N39.0', system: 'icd10', date: '2026-01-15', sourceId: 'b' },
        ],
      },
    );
    expect(merged.conditionCodes).toHaveLength(2);
  });

  it('STILL collapses a genuine duplicate — same code, system, date and source', () => {
    const entry = { code: 'N39.0', system: 'icd10', date: '2026-01-15' };
    const merged = buildEffectivePatientContext(pc({ conditionCodes: [entry] }), {
      conditionCodes: [{ ...entry }],
    });
    expect(merged.conditionCodes).toHaveLength(1);
  });

  it('collapses undated duplicates, preserving today for the no-date case', () => {
    const entry = { code: 'E11.9', system: 'icd10' };
    const merged = buildEffectivePatientContext(pc({ conditionCodes: [entry] }), {
      conditionCodes: [{ ...entry }],
    });
    expect(merged.conditionCodes).toHaveLength(1);
  });

  it('applies the same rule to labs, medications and allergies', () => {
    const merged = buildEffectivePatientContext(
      pc({
        labResults: [{ code: 'l', system: 'loinc', value: 1, date: '2026-01-01' }],
        medications: [{ code: 'm', system: 'rx', date: '2026-01-01' }],
        allergies: [{ code: 'a', system: 'sn', date: '2026-01-01' }],
      }),
      {
        labResults: [{ code: 'l', system: 'loinc', value: 2, date: '2026-05-01' }],
        medications: [{ code: 'm', system: 'rx', date: '2026-05-01' }],
        allergies: [{ code: 'a', system: 'sn', date: '2026-05-01' }],
      },
    );
    expect(merged.labResults).toHaveLength(2);
    expect(merged.medications).toHaveLength(2);
    expect(merged.allergies).toHaveLength(2);
  });
});

describe('mergeAdditionalContext — a session accumulates across calls', () => {
  // This bag IS the session's memory of mid-session additions: it is persisted
  // on the session and replayed by every retraversal entry point. A shallow
  // spread meant adding condition A and then condition B stored only B, so A
  // vanished from every later retraversal — silently removing evidence a gate
  // had already counted.
  const A = { code: 'A', system: 'icd10' };
  const B = { code: 'B', system: 'icd10' };

  it('keeps the first condition when a second is added later', () => {
    const afterFirst = mergeAdditionalContext(undefined, { conditionCodes: [A] });
    const afterSecond = mergeAdditionalContext(afterFirst, { conditionCodes: [B] });
    expect(afterSecond.conditionCodes?.map((c) => c.code)).toEqual(['A', 'B']);
  });

  it('accumulates across three calls, not just two', () => {
    let bag = mergeAdditionalContext(undefined, { conditionCodes: [A] });
    bag = mergeAdditionalContext(bag, { conditionCodes: [B] });
    bag = mergeAdditionalContext(bag, { conditionCodes: [{ code: 'C', system: 'icd10' }] });
    expect(bag.conditionCodes?.map((c) => c.code)).toEqual(['A', 'B', 'C']);
  });

  it('applies to labs, medications and allergies too', () => {
    let bag = mergeAdditionalContext(undefined, {
      labResults: [{ code: 'l1', system: 'loinc', value: 1 }],
      medications: [{ code: 'm1', system: 'rx' }],
      allergies: [{ code: 'a1', system: 'sn' }],
    });
    bag = mergeAdditionalContext(bag, {
      labResults: [{ code: 'l2', system: 'loinc', value: 2 }],
      medications: [{ code: 'm2', system: 'rx' }],
      allergies: [{ code: 'a2', system: 'sn' }],
    });
    expect(bag.labResults).toHaveLength(2);
    expect(bag.medications).toHaveLength(2);
    expect(bag.allergies).toHaveLength(2);
  });

  it('keeps the same code re-reported on a later date — recurrence is evidence', () => {
    let bag = mergeAdditionalContext(undefined, {
      conditionCodes: [{ ...A, date: '2026-01-15' }],
    });
    bag = mergeAdditionalContext(bag, { conditionCodes: [{ ...A, date: '2026-06-02' }] });
    expect(bag.conditionCodes).toHaveLength(2);
  });

  it('still collapses a genuine re-send of the same occurrence', () => {
    let bag = mergeAdditionalContext(undefined, { conditionCodes: [A] });
    bag = mergeAdditionalContext(bag, { conditionCodes: [{ ...A }] });
    expect(bag.conditionCodes).toHaveLength(1);
  });

  it('deep-merges the vitals bag instead of replacing it wholesale', () => {
    let bag = mergeAdditionalContext(undefined, { vitalSigns: { heart_rate: 80 } });
    bag = mergeAdditionalContext(bag, { vitalSigns: { systolic_bp: 148 } });
    expect(bag.vitalSigns).toEqual({ heart_rate: 80, systolic_bp: 148 });
  });

  it('deep-merges nested vitals, keeping siblings under custom', () => {
    let bag = mergeAdditionalContext(undefined, { vitalSigns: { custom: { pain_score: 7 } } });
    bag = mergeAdditionalContext(bag, { vitalSigns: { custom: { mood: 3 } } });
    expect(bag.vitalSigns).toEqual({ custom: { pain_score: 7, mood: 3 } });
  });

  it('lets a newer reading overwrite the same vital key', () => {
    let bag = mergeAdditionalContext(undefined, { vitalSigns: { heart_rate: 80 } });
    bag = mergeAdditionalContext(bag, { vitalSigns: { heart_rate: 96 } });
    expect(bag.vitalSigns).toEqual({ heart_rate: 96 });
  });

  it('deep-merges freeformData and patientAttributes on the same rule', () => {
    let bag = mergeAdditionalContext(undefined, {
      freeformData: { narrative: { chief_complaint: 'cough' } },
      patientAttributes: { trimester: 2 },
    });
    bag = mergeAdditionalContext(bag, {
      freeformData: { narrative: { hpi: 'three days' } },
      patientAttributes: { rh_factor: 'positive' },
    });
    expect(bag.freeformData).toEqual({
      narrative: { chief_complaint: 'cough', hpi: 'three days' },
    });
    expect(bag.patientAttributes).toEqual({ trimester: 2, rh_factor: 'positive' });
  });

  it('leaves keys absent when neither call supplied them', () => {
    const bag = mergeAdditionalContext(undefined, { conditionCodes: [A] });
    expect('vitalSigns' in bag).toBe(false);
    expect('labResults' in bag).toBe(false);
  });

  it('does not mutate either input', () => {
    const prev = { conditionCodes: [A], vitalSigns: { heart_rate: 80 } };
    const next = { conditionCodes: [B], vitalSigns: { systolic_bp: 148 } };
    mergeAdditionalContext(prev, next);
    expect(prev.conditionCodes).toHaveLength(1);
    expect(prev.vitalSigns).toEqual({ heart_rate: 80 });
    expect(next.conditionCodes).toHaveLength(1);
  });

  it('feeds the accumulated bag through to the effective context', () => {
    // The end-to-end shape retraversal actually sees.
    let bag = mergeAdditionalContext(undefined, { conditionCodes: [A] });
    bag = mergeAdditionalContext(bag, { conditionCodes: [B] });
    const effective = buildEffectivePatientContext(pc(), bag);
    expect(effective.conditionCodes.map((c) => c.code)).toEqual(['A', 'B']);
  });
});

describe('vital factIds survive a JSONB round trip', () => {
  // Postgres jsonb reorders object keys by (length, bytewise) — verified
  // directly: '{"z_long_key":1,"a":2,"mm":3}'::jsonb reads back as
  // '{"a":2,"mm":3,"z_long_key":1}'. initial_patient_context IS a jsonb
  // column, so the bag a retraversal assembles has a different key order than
  // the one session creation assembled. Assigning ordinals from
  // Object.entries order therefore broke the very determinism that lets plan
  // 05 defer persisting normalized facts.
  const idsFor = (bag: Record<string, unknown>) => {
    const store = assembleContext(synthetic({ vitalSigns: bag }), ctx());
    return store
      .filter((f) => f.kind === 'vital')
      .map((f) => `${f.factId}=${f.code}`);
  };

  it('assigns the same ids however the bag keys are ordered', () => {
    expect(idsFor({ z_long_key: 1, a: 2, mm: 3 })).toEqual(idsFor({ a: 2, mm: 3, z_long_key: 1 }));
  });

  it('maps a given id to the same code under the jsonb ordering', () => {
    // The exact reordering Postgres applies to this bag.
    expect(idsFor({ z_long_key: 1, a: 2, mm: 3 })).toEqual([
      'vital:0=a',
      'vital:1=mm',
      'vital:2=z_long_key',
    ]);
  });

  it('holds for nested paths too', () => {
    const a = idsFor({ custom: { pain: 1, mood: 2 }, heart_rate: 3 });
    const b = idsFor({ heart_rate: 3, custom: { mood: 2, pain: 1 } });
    expect(a).toEqual(b);
  });
});

describe('buildEffectivePatientContext — nested initial context survives', () => {
  it('keeps a sibling custom vital when another is updated mid-session', () => {
    // The additions bag deep-merges with itself, but this merge — the one
    // every retraversal runs — was still a spread, so the initial context's
    // siblings were dropped.
    const merged = buildEffectivePatientContext(
      pc({ vitalSigns: { custom: { pain: 3, mood: 5 } } }),
      { vitalSigns: { custom: { pain: 8 } } },
    );
    expect(merged.vitalSigns).toEqual({ custom: { pain: 8, mood: 5 } });
  });

  it('keeps a sibling narrative key when another is updated', () => {
    const merged = buildEffectivePatientContext(
      pc({ freeformData: { narrative: { chief: 'cough', hpi: 'three days' } } }),
      { freeformData: { narrative: { chief: 'fever' } } },
    );
    expect(merged.freeformData).toEqual({ narrative: { chief: 'fever', hpi: 'three days' } });
  });

  it('still lets an addition win at the leaf', () => {
    const merged = buildEffectivePatientContext(pc({ vitalSigns: { heart_rate: 80 } }), {
      vitalSigns: { heart_rate: 96 },
    });
    expect(merged.vitalSigns).toEqual({ heart_rate: 96 });
  });
});
