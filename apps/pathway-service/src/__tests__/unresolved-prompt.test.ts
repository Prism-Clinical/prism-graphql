/**
 * What to ask for, when a gate could not evaluate a condition.
 *
 * The negatives matter as much as the positives here: asking about a condition
 * that ANSWERED, or one whose answer cannot honestly be stored as a fact, is
 * worse than staying quiet.
 */

import { askFor } from '../services/resolution/unresolved-prompt';
import { AnswerType } from '../services/resolution/types';
import type { GateCondition } from '../services/resolution/types';

const cond = (c: Record<string, unknown>) => c as unknown as GateCondition;

describe('askFor', () => {
  it('asks for a lab value by code and system', () => {
    const ask = askFor(cond({
      field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11,
    }))!;
    expect(ask.datumKey).toBe('LOINC:718-7');
    expect(ask.answerType).toBe(AnswerType.NUMERIC);
    expect(ask.target).toEqual({ kind: 'lab', code: '718-7', system: 'LOINC' });
    // Names the datum. Says nothing about what answer the pathway expects —
    // a prompt that leaks the threshold is a prompt that leads the clinician.
    expect(ask.prompt).toContain('718-7');
    expect(ask.prompt).not.toContain('11');
    expect(ask.prompt).not.toMatch(/anaemi|anemi|low|below|abnormal|should/i);
  });

  it('prefers an authored display over the bare code in the prompt', () => {
    const ask = askFor(cond({
      field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC',
      threshold: 11, display: 'Haemoglobin',
    }))!;
    expect(ask.prompt).toContain('Haemoglobin');
    expect(ask.datumKey).toBe('LOINC:718-7');
  });

  it('asks for a vital by its dotted path', () => {
    const ask = askFor(cond({
      field: 'vitals', operator: 'greater_than', value: 'systolic_bp', threshold: 130,
    }))!;
    expect(ask.datumKey).toBe('vitals.systolic_bp');
    expect(ask.answerType).toBe(AnswerType.NUMERIC);
    expect(ask.target).toEqual({ kind: 'vital', path: 'systolic_bp' });
  });

  it('asks for an attribute by its dotted path', () => {
    const ask = askFor(cond({
      attribute: 'patient.trimester', operator: 'equals', value: 2,
    }))!;
    expect(ask.datumKey).toBe('patient.trimester');
    expect(ask.target).toEqual({ kind: 'attribute', path: 'patient.trimester' });
  });

  // ─── The classes this cannot honestly ask about ──────────────────────

  it('refuses a membership condition — no code found is a real answer', () => {
    expect(askFor(cond({
      field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10',
    }))).toBeNull();
  });

  it('refuses an aggregate condition — the answer is a series, not a value', () => {
    expect(askFor(cond({
      field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC', window_days: 180,
    }))).toBeNull();
    expect(askFor(cond({
      field: 'labs', operator: 'trend_up', value: '718-7', system: 'LOINC',
    }))).toBeNull();
  });

  it('refuses an operator it does not recognise rather than guessing', () => {
    expect(askFor(cond({ field: 'labs', operator: 'nonsense', value: '718-7' }))).toBeNull();
  });

  // ─── Dedup ───────────────────────────────────────────────────────────

  it('gives two gates on the same datum the same key', () => {
    const a = askFor(cond({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 }))!;
    const b = askFor(cond({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 }))!;
    expect(a.datumKey).toBe(b.datumKey);
  });

  it('gives different labs different keys', () => {
    const hb = askFor(cond({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 }))!;
    const ft = askFor(cond({ field: 'labs', operator: 'less_than', value: '2276-4', system: 'LOINC', threshold: 30 }))!;
    expect(hb.datumKey).not.toBe(ft.datumKey);
  });
});

/**
 * An answer must land where the gate will READ it.
 *
 * Every attribute answer went to `patientAttributes`. But `lab.hemoglobin` is
 * a LAB — the gate resolves it through the attribute vocabulary to a LOINC
 * code and reads the lab series — so the injected fact went somewhere the gate
 * never looks, and the question stayed pending however many times it was
 * answered.
 */
describe('askFor resolves the attribute namespace', () => {
  const codeMap = new Map([
    ['lab.hemoglobin', {
      attributeName: 'lab.hemoglobin', namespace: 'lab',
      system: 'LOINC', code: '718-7', valueType: 'number' as const,
    }],
  ]);

  const labCondition = {
    attribute: 'lab.hemoglobin', operator: 'less_than', value: '11',
  } as never;

  it('sends a lab attribute to the LAB context, with its code', () => {
    const ask = askFor(labCondition, codeMap)!;
    expect(ask.target).toEqual({ kind: 'lab', code: '718-7', system: 'LOINC' });
  });

  // Without the vocabulary there is no code to inject against, so the honest
  // fallback is the old behaviour rather than a guess.
  it('falls back to an attribute target when the vocabulary has no row', () => {
    const ask = askFor(labCondition, new Map())!;
    expect(ask.target).toEqual({ kind: 'attribute', path: 'lab.hemoglobin' });
  });

  it('sends a vitals attribute to the vitals context', () => {
    const ask = askFor(
      { attribute: 'vitals.systolic', operator: 'greater_than', value: '140' } as never,
      codeMap,
    )!;
    expect(ask.target).toEqual({ kind: 'vital', path: 'vitals.systolic' });
  });

  // Demographics genuinely live in patientAttributes.
  it('leaves a patient attribute where it was', () => {
    const ask = askFor(
      { attribute: 'patient.trimester', operator: 'equals', value: '2' } as never,
      codeMap,
    )!;
    expect(ask.target).toEqual({ kind: 'attribute', path: 'patient.trimester' });
  });

  // The datum key is the gate's own wording either way, so two gates reading
  // one haemoglobin still share a prompt.
  it('keys the datum by the attribute path regardless of target', () => {
    expect(askFor(labCondition, codeMap)!.datumKey).toBe('lab.hemoglobin');
  });
});

/**
 * A `patient.*` datum is asked in the type its comparand is compared in —
 * the answer is stored where the gate reads it and compared with `===`.
 */
describe('askFor — the answer type of a patient.* datum', () => {
  const ask = (c: Record<string, unknown>, map?: Map<string, never>) => askFor(cond(c), map)!;

  it('a numeric operator asks NUMERIC', () => {
    const a = ask({ attribute: 'patient.gestational_age_weeks', operator: 'greater_or_equal', value: 18 });
    expect(a.answerType).toBe(AnswerType.NUMERIC);
    expect(a.options).toBeUndefined();
  });

  it('equality on a number asks NUMERIC', () => {
    expect(ask({ attribute: 'patient.trimester', operator: 'equals', value: 2 }).answerType)
      .toBe(AnswerType.NUMERIC);
  });

  it('a numeric `in` list asks NUMERIC, not SELECT — the value can lie outside the list', () => {
    const a = ask({ attribute: 'patient.parity', operator: 'in', value: [0, 1] });
    expect(a.answerType).toBe(AnswerType.NUMERIC);
    expect(a.options).toBeUndefined();
  });

  it('a boolean comparand asks BOOLEAN', () => {
    for (const operator of ['equals', 'not_equals']) {
      const a = ask({ attribute: 'patient.prior_cesarean', operator, value: false });
      expect(a.answerType).toBe(AnswerType.BOOLEAN);
      expect(a.options).toBeUndefined();
    }
  });

  it('string equality asks SELECT, the comparand as the option', () => {
    const a = ask({ attribute: 'patient.rh_factor', operator: 'equals', value: 'negative' });
    expect(a.answerType).toBe(AnswerType.SELECT);
    expect(a.options).toEqual(['negative']);
  });

  it('a string `in` list asks SELECT with the list, deduplicated, in authored order', () => {
    const a = ask({ attribute: 'patient.blood_type', operator: 'in', value: ['O-', 'A-', 'O-'] });
    expect(a.answerType).toBe(AnswerType.SELECT);
    expect(a.options).toEqual(['O-', 'A-']);
  });

  it('a string comparand under a NUMERIC operator still asks NUMERIC', () => {
    expect(ask({ attribute: 'patient.gestational_age_weeks', operator: 'greater_than', value: '18' }).answerType)
      .toBe(AnswerType.NUMERIC);
  });

  it('a mixed list falls back to NUMERIC rather than guessing', () => {
    expect(ask({ attribute: 'patient.x', operator: 'in', value: ['a', 1] }).answerType)
      .toBe(AnswerType.NUMERIC);
  });

  // Only a patient.* datum is typed. Everything else is injected as a lab or
  // vital, which takes a number.
  it('a mapped allergy.* with a boolean comparand stays NUMERIC (it is injected as a lab)', () => {
    const map = new Map([[
      'allergy.penicillin',
      { attributeName: 'allergy.penicillin', namespace: 'allergy', system: 'RXNORM', code: '7980', valueType: 'boolean' },
    ]]) as unknown as Map<string, never>;
    const a = ask({ attribute: 'allergy.penicillin', operator: 'equals', value: true }, map);
    expect(a.target.kind).toBe('lab');
    expect(a.answerType).toBe(AnswerType.NUMERIC);
  });

  it('an UNMAPPED lab.* with a string comparand stays NUMERIC', () => {
    const a = ask({ attribute: 'lab.hemoglobin', operator: 'equals', value: 'low' }, new Map());
    expect(a.target.kind).toBe('attribute');
    expect(a.answerType).toBe(AnswerType.NUMERIC);
  });

  it('a vitals.* attribute stays NUMERIC', () => {
    expect(ask({ attribute: 'vitals.position', operator: 'equals', value: 'supine' }).answerType)
      .toBe(AnswerType.NUMERIC);
  });
});
