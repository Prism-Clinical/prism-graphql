import {
  parseClinicalState,
  parseRecordValidity,
  parseSyntheticDate,
  CLINICAL_STATES,
  RECORD_VALIDITIES,
} from '../../services/resolution/temporal/synthetic-values';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';

describe('parseClinicalState', () => {
  it('accepts every member of the closed union', () => {
    for (const s of CLINICAL_STATES) expect(parseClinicalState(s, 'conditions[0]')).toBe(s);
  });
  it('rejects an unknown string instead of casting it in', () => {
    expect(() => parseClinicalState('banana', 'conditions[0]')).toThrow(TemporalContextError);
  });
  it('names the field path and the allowed values', () => {
    try {
      parseClinicalState('banana', 'medications[2]');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as Error).message).toContain('medications[2]');
      expect((e as Error).message).toContain('ACTIVE');
    }
  });
  it('is case sensitive — "active" is not ACTIVE', () => {
    expect(() => parseClinicalState('active', 'conditions[0]')).toThrow(TemporalContextError);
  });
});

describe('parseRecordValidity', () => {
  it('accepts every member', () => {
    for (const v of RECORD_VALIDITIES) expect(parseRecordValidity(v, 'labs[0]')).toBe(v);
  });
  it('rejects anything else', () => {
    expect(() => parseRecordValidity('MAYBE', 'labs[0]')).toThrow(TemporalContextError);
  });
});

describe('parseSyntheticDate', () => {
  it('returns a precision-carrying bound', () => {
    expect(parseSyntheticDate('2026-01-15', 'conditions[0].date')).toEqual({
      value: '2026-01-15',
      precision: 'day',
    });
  });
  it('rejects an unparseable date rather than dropping it', () => {
    expect(() => parseSyntheticDate('last tuesday', 'conditions[0].date')).toThrow(
      /conditions\[0\]\.date/,
    );
  });
  it('uses the resolution-input error code', () => {
    try {
      parseSyntheticDate('nope', 'x');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as TemporalContextError).code).toBe('INVALID_RESOLUTION_INPUT');
    }
  });
});
