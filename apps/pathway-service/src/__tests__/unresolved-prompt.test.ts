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
