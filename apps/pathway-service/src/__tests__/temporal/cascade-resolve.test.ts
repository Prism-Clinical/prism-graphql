import {
  resolveEffectivePolicy,
  toEffectivePolicy,
  PathwayTemporalDefaults,
} from '../../services/resolution/temporal/cascade';
import {
  EvaluationTemporalContext,
  TemporalContextError,
} from '../../services/resolution/temporal/evaluation-context';
import { GateField } from '../../services/resolution/temporal/contract';

const AS_OF = '2026-08-03T12:00:00.000Z';

function ctx(over: Partial<EvaluationTemporalContext> = {}): EvaluationTemporalContext {
  return { evaluationAsOf: AS_OF, timezone: 'UTC', temporalPolicyVersion: 'v1', ...over };
}

describe('resolveEffectivePolicy — precedence', () => {
  const defaults: PathwayTemporalDefaults = {
    horizons: { labs: 'YEAR' },
    statuses: { conditions: 'any' },
  };

  it('falls back to the system default when nothing overrides', () => {
    expect(resolveEffectivePolicy('conditions', 'v1', {})).toEqual({
      horizon: 'LIFETIME',
      status: 'active',
      horizonLevel: 'SYSTEM_DEFAULT',
      statusLevel: 'SYSTEM_DEFAULT',
    });
  });

  it('pathway beats system', () => {
    expect(resolveEffectivePolicy('labs', 'v1', defaults).horizon).toBe('YEAR');
    expect(resolveEffectivePolicy('labs', 'v1', defaults).horizonLevel).toBe('PATHWAY');
  });

  it('node beats pathway', () => {
    const r = resolveEffectivePolicy('labs', 'v1', defaults, { horizon: 'WEEK' });
    expect(r.horizon).toBe('WEEK');
    expect(r.horizonLevel).toBe('NODE');
  });

  it('resolves the two axes independently — a status override keeps the inherited horizon', () => {
    const r = resolveEffectivePolicy('conditions', 'v1', defaults, { status: 'inactive' });
    expect(r).toEqual({
      horizon: 'LIFETIME',
      status: 'inactive',
      horizonLevel: 'SYSTEM_DEFAULT',
      statusLevel: 'NODE',
    });
  });

  it('a horizon override does not disturb an inherited pathway status', () => {
    const r = resolveEffectivePolicy('conditions', 'v1', defaults, { horizon: 'MONTH' });
    expect(r.status).toBe('any');
    expect(r.statusLevel).toBe('PATHWAY');
  });

  it('version selects the system default it falls back to', () => {
    expect(resolveEffectivePolicy('labs', 'legacy-v0', {}).horizon).toBe('LIFETIME');
    expect(resolveEffectivePolicy('labs', 'v1', {}).horizon).toBe('QUARTER');
    expect(resolveEffectivePolicy('vitals', 'legacy-v0', {}).horizon).toBe('LIFETIME');
    expect(resolveEffectivePolicy('vitals', 'v1', {}).horizon).toBe('ENCOUNTER');
  });

  it('propagates an unknown version instead of defaulting', () => {
    expect(() => resolveEffectivePolicy('labs', 'v99', {})).toThrow(TemporalContextError);
  });
});

describe('resolveEffectivePolicy — status applicability', () => {
  it('never returns a status for an observation field', () => {
    for (const field of ['labs', 'vitals'] as GateField[]) {
      const r = resolveEffectivePolicy(field, 'v1', {});
      expect(r.status).toBeUndefined();
      expect(r.statusLevel).toBeUndefined();
    }
  });

  it('rejects a node-level status on an observation field', () => {
    expect(() => resolveEffectivePolicy('labs', 'v1', {}, { status: 'active' })).toThrow(/labs/);
  });

  it('validates a node-level horizon with the same rules as storage', () => {
    expect(() => resolveEffectivePolicy('labs', 'v1', {}, { horizon: { days: 0 } })).toThrow(
      TemporalContextError,
    );
    expect(() =>
      resolveEffectivePolicy('labs', 'v1', {}, { horizon: 'FORTNIGHT' as never }),
    ).toThrow(TemporalContextError);
  });

  it('normalizes a node-level custom horizon down to days', () => {
    const r = resolveEffectivePolicy('labs', 'v1', {}, {
      horizon: { days: 30, note: 'author scratch' } as never,
    });
    expect(r.horizon).toEqual({ days: 30 });
  });
});

describe('toEffectivePolicy', () => {
  it('resolves the tier against the pinned clock and carries the status through', () => {
    const tier = resolveEffectivePolicy('conditions', 'v1', {}, { status: 'any' });
    expect(toEffectivePolicy(tier, ctx())).toEqual({
      horizon: { lowerBound: null, upperBound: AS_OF },
      status: 'any',
    });
  });

  it('omits status entirely for an observation field', () => {
    const tier = resolveEffectivePolicy('labs', 'v1', {});
    const policy = toEffectivePolicy(tier, ctx());
    expect(policy.status).toBeUndefined();
    expect(policy.horizon.lowerBound).toBe('2026-05-05T12:00:00.000Z'); // 90 days back
  });

  it('reads the clock only from the context it is given', () => {
    const tier = resolveEffectivePolicy('labs', 'v1', {});
    const other = toEffectivePolicy(tier, ctx({ evaluationAsOf: '2020-01-01T00:00:00.000Z' }));
    expect(other.horizon.upperBound).toBe('2020-01-01T00:00:00.000Z');
  });

  it('surfaces a missing encounter anchor as MISSING_ENCOUNTER_ANCHOR', () => {
    const tier = resolveEffectivePolicy('vitals', 'v1', {});
    try {
      toEffectivePolicy(tier, ctx());
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as TemporalContextError).code).toBe('MISSING_ENCOUNTER_ANCHOR');
    }
  });

  it('resolves ENCOUNTER when the anchor is present', () => {
    const tier = resolveEffectivePolicy('vitals', 'v1', {});
    const policy = toEffectivePolicy(tier, ctx({ encounterStart: '2026-08-03T09:00:00.000Z' }));
    expect(policy.horizon).toEqual({
      lowerBound: '2026-08-03T09:00:00.000Z',
      upperBound: AS_OF,
    });
  });
});
