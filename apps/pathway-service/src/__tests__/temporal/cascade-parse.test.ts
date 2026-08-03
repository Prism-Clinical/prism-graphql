import {
  parsePathwayTemporalDefaults,
  parseHorizonValue,
} from '../../services/resolution/temporal/cascade';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';

describe('parsePathwayTemporalDefaults', () => {
  it('treats an absent column as no pathway-level opinion', () => {
    expect(parsePathwayTemporalDefaults(null)).toEqual({});
    expect(parsePathwayTemporalDefaults(undefined)).toEqual({});
    expect(parsePathwayTemporalDefaults({})).toEqual({});
  });

  it('reads the pathway JSON header key names', () => {
    expect(
      parsePathwayTemporalDefaults({
        default_horizons: { labs: 'YEAR', conditions: { days: 45 } },
        default_statuses: { conditions: 'any' },
      }),
    ).toEqual({
      horizons: { labs: 'YEAR', conditions: { days: 45 } },
      statuses: { conditions: 'any' },
    });
  });

  it('accepts a JSON string, as node-postgres may hand back either', () => {
    expect(parsePathwayTemporalDefaults('{"default_horizons":{"labs":"WEEK"}}')).toEqual({
      horizons: { labs: 'WEEK' },
    });
  });

  it('rejects an unknown gate field rather than silently dropping it', () => {
    expect(() => parsePathwayTemporalDefaults({ default_horizons: { labz: 'YEAR' } })).toThrow(
      TemporalContextError,
    );
  });

  it('rejects a status on a field that has no clinical state', () => {
    expect(() => parsePathwayTemporalDefaults({ default_statuses: { labs: 'active' } })).toThrow(
      /labs/,
    );
    expect(() => parsePathwayTemporalDefaults({ default_statuses: { vitals: 'active' } })).toThrow(
      /vitals/,
    );
  });

  it('rejects a bad status value', () => {
    expect(() =>
      parsePathwayTemporalDefaults({ default_statuses: { conditions: 'ACTIVE' } }),
    ).toThrow(TemporalContextError);
  });

  it('rejects an unknown root key — a typo must not silently erase the override', () => {
    // The singular typo is the realistic one, and it is the dangerous one:
    // ignoring it resolves every gate against system defaults while the
    // author believes their pathway-level horizon is in force.
    expect(() => parsePathwayTemporalDefaults({ default_horizon: { labs: 'YEAR' } })).toThrow(
      /default_horizon\b/,
    );
    expect(() =>
      parsePathwayTemporalDefaults({ default_horizons: { labs: 'YEAR' }, extra: 1 }),
    ).toThrow(/extra/);
  });

  it('rejects a present-but-null section — only an ABSENT section means inherit', () => {
    // {"default_horizons": null} looks like a document that states an opinion.
    // Treating it as inherit would silently resolve every gate against system
    // defaults. Only SQL NULL or an absent key is "inherit".
    expect(() => parsePathwayTemporalDefaults({ default_horizons: null })).toThrow(
      TemporalContextError,
    );
    expect(() => parsePathwayTemporalDefaults({ default_statuses: null })).toThrow(
      TemporalContextError,
    );
  });

  it('rejects a non-object column value', () => {
    expect(() => parsePathwayTemporalDefaults(42)).toThrow(TemporalContextError);
    expect(() => parsePathwayTemporalDefaults([])).toThrow(TemporalContextError);
    expect(() => parsePathwayTemporalDefaults('not json')).toThrow(TemporalContextError);
  });

  it('names the offending key in the message — this fires on a live pathway', () => {
    try {
      parsePathwayTemporalDefaults({ default_horizons: { labs: 'FORTNIGHT' } });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as Error).message).toContain('default_horizons.labs');
    }
  });
});

describe('parseHorizonValue', () => {
  it('accepts every named tier', () => {
    for (const h of ['LIFETIME', 'YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY', 'ENCOUNTER']) {
      expect(parseHorizonValue(h, 'x')).toBe(h);
    }
  });

  it('accepts a custom day count and normalizes away extra keys', () => {
    expect(parseHorizonValue({ days: 45 }, 'x')).toEqual({ days: 45 });
    expect(parseHorizonValue({ days: 45, note: 'hi' }, 'x')).toEqual({ days: 45 });
  });

  it('rejects a day count that resolveHorizon would reject at evaluation time', () => {
    expect(() => parseHorizonValue({ days: 0 }, 'x')).toThrow(TemporalContextError);
    expect(() => parseHorizonValue({ days: -1 }, 'x')).toThrow(TemporalContextError);
    expect(() => parseHorizonValue({ days: 1.5 }, 'x')).toThrow(TemporalContextError);
    expect(() => parseHorizonValue({ days: 36_526 }, 'x')).toThrow(TemporalContextError);
  });

  it('rejects garbage', () => {
    expect(() => parseHorizonValue('lifetime', 'x')).toThrow(TemporalContextError);
    expect(() => parseHorizonValue(null, 'x')).toThrow(TemporalContextError);
    expect(() => parseHorizonValue(90, 'x')).toThrow(TemporalContextError);
  });
});
