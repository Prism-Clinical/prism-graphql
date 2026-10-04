/**
 * Answers remembered for a patient across encounters
 * (Josh, 2026-10-04: the prenatal-vitamin "yes" is sticky for this pregnancy).
 */
import { parseRememberAnswer, shouldRemember, stillHolds, loadRememberedAttributes } from '../services/resolution/remembered-answers';

describe('remember_answer grammar', () => {
  it('accepts a scope, with or without values', () => {
    expect(parseRememberAnswer({ scope: 'PREGNANCY', values: [true] })).toEqual({ scope: 'PREGNANCY', values: [true] });
    expect(parseRememberAnswer({ scope: 'PATIENT' })).toEqual({ scope: 'PATIENT' });
  });
  it.each([
    [null, /must be an object/],
    [{ scope: 'FOREVER' }, /scope must be one of/],
    [{ scope: 'PREGNANCY', values: [] }, /non-empty list/],
    [{ scope: 'PREGNANCY', when: true }, /unknown key "when"/],
  ])('refuses %j', (raw, message) => {
    expect((parseRememberAnswer(raw) as { problem: string }).problem).toMatch(message);
  });
  it('remembers only the answers it names', () => {
    expect(shouldRemember({ scope: 'PREGNANCY', values: [true] }, true)).toBe(true);
    expect(shouldRemember({ scope: 'PREGNANCY', values: [true] }, false)).toBe(false);
    expect(shouldRemember({ scope: 'PATIENT' }, 'anything')).toBe(true);
  });
});

describe('stillHolds', () => {
  const asOf = '2026-10-04T13:00:00.000Z';
  it('PREGNANCY: an answer given during this pregnancy holds; one from before it does not', () => {
    // 28 weeks on 2026-10-04 → LMP 2026-03-22.
    expect(stillHolds('PREGNANCY', '2026-06-01', asOf, 28)).toBe(true);
    expect(stillHolds('PREGNANCY', '2026-03-22', asOf, 28)).toBe(true);
    expect(stillHolds('PREGNANCY', '2026-03-21', asOf, 28)).toBe(false);
    expect(stillHolds('PREGNANCY', '2025-01-10', asOf, 28)).toBe(false);
  });
  it('PREGNANCY with no gestational age: within the last 300 days', () => {
    expect(stillHolds('PREGNANCY', '2026-03-01', asOf, undefined)).toBe(true);
    expect(stillHolds('PREGNANCY', '2025-10-01', asOf, undefined)).toBe(false);
  });
  it('an answer dated after the clock never holds; PATIENT always does', () => {
    expect(stillHolds('PREGNANCY', '2026-11-01', asOf, 28)).toBe(false);
    expect(stillHolds('PATIENT', '2019-01-01', asOf, undefined)).toBe(true);
  });
});

describe('loadRememberedAttributes', () => {
  const db = (rows: unknown[]) => ({ query: jest.fn().mockResolvedValue({ rows }) }) as never;
  const row = { attribute: 'on_prenatal_vitamin', value: true, scope: 'PREGNANCY', answered_on: '2026-06-01' };
  const asOf = '2026-10-04T13:00:00.000Z';

  it('supplies a remembered answer the chart does not carry', async () => {
    expect(await loadRememberedAttributes(db([row]), { patientId: 'p', asOf, suppliedAttributes: { gestational_age_weeks: 28 } }))
      .toEqual({ on_prenatal_vitamin: true });
  });
  it('the chart wins over what was remembered', async () => {
    expect(await loadRememberedAttributes(db([row]), { patientId: 'p', asOf, suppliedAttributes: { gestational_age_weeks: 28, on_prenatal_vitamin: false } }))
      .toEqual({});
  });
  it('an answer from a previous pregnancy is not supplied', async () => {
    expect(await loadRememberedAttributes(db([{ ...row, answered_on: '2025-02-01' }]), { patientId: 'p', asOf, suppliedAttributes: { gestational_age_weeks: 10 } }))
      .toEqual({});
  });
});
