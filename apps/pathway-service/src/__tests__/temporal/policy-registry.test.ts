import {
  TEMPORAL_POLICIES,
  KNOWN_TEMPORAL_POLICY_VERSIONS,
  getTemporalPolicy,
  assertKnownPolicyVersion,
  systemDefaultFor,
  fieldHasClinicalState,
} from '../../services/resolution/temporal/policy-registry';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';
import { GateField, FIELD_TO_KIND } from '../../services/resolution/temporal/contract';

const ALL_FIELDS = Object.keys(FIELD_TO_KIND) as GateField[];

describe('TEMPORAL_POLICIES', () => {
  it('legacy-v0 reproduces today: every field is LIFETIME', () => {
    const p = getTemporalPolicy('legacy-v0');
    for (const field of ALL_FIELDS) {
      expect(p[field].horizon).toBe('LIFETIME');
    }
  });

  it('v1 narrows labs to QUARTER and pins vitals to ENCOUNTER', () => {
    const p = getTemporalPolicy('v1');
    expect(p.labs.horizon).toBe('QUARTER');
    expect(p.vitals.horizon).toBe('ENCOUNTER');
  });

  it('v1 leaves conditions, medications and allergies at LIFETIME/active', () => {
    const p = getTemporalPolicy('v1');
    for (const field of ['conditions', 'medications', 'allergies'] as GateField[]) {
      expect(p[field]).toEqual({ horizon: 'LIFETIME', status: 'active' });
    }
  });

  it('covers every GateField in every version — a missing field is an undefined policy', () => {
    for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
      for (const field of ALL_FIELDS) {
        expect(TEMPORAL_POLICIES[version][field]).toBeDefined();
      }
    }
  });

  it('gives no status to observation fields in any version', () => {
    for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
      expect(TEMPORAL_POLICIES[version].labs.status).toBeUndefined();
      expect(TEMPORAL_POLICIES[version].vitals.status).toBeUndefined();
    }
  });

  it('is frozen at every level — a version must never be mutated in place', () => {
    expect(() => {
      (TEMPORAL_POLICIES as Record<string, unknown>).v2 = {};
    }).toThrow(TypeError);
    expect(() => {
      (TEMPORAL_POLICIES.v1 as Record<string, unknown>).labs = { horizon: 'DAY' };
    }).toThrow(TypeError);
    expect(() => {
      (TEMPORAL_POLICIES.v1.labs as { horizon: string }).horizon = 'DAY';
    }).toThrow(TypeError);
  });

  it('is frozen ALL the way down, not just two levels', () => {
    // Object.freeze is shallow. Every horizon is a string today, so this
    // walks a tree with no third level — but the moment someone adds a
    // custom-horizon default like { horizon: { days: 30 } }, an unfrozen
    // inner object would let an existing version's meaning be mutated.
    const unfrozen: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value !== 'object') return;
      if (!Object.isFrozen(value)) unfrozen.push(path);
      for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    walk(TEMPORAL_POLICIES, 'TEMPORAL_POLICIES');
    expect(unfrozen).toEqual([]);
  });
});

describe('getTemporalPolicy', () => {
  it('rejects an unknown version instead of falling back to latest', () => {
    expect(() => getTemporalPolicy('v99')).toThrow(TemporalContextError);
    try {
      getTemporalPolicy('v99');
    } catch (e) {
      expect((e as TemporalContextError).code).toBe('UNKNOWN_POLICY_VERSION');
      expect((e as Error).message).toContain('legacy-v0');
    }
  });

  it('rejects a prototype key that is not a real version', () => {
    expect(() => getTemporalPolicy('constructor')).toThrow(TemporalContextError);
    expect(() => getTemporalPolicy('toString')).toThrow(TemporalContextError);
  });
});

describe('assertKnownPolicyVersion', () => {
  it('passes for a known version and throws for an unknown one', () => {
    expect(() => assertKnownPolicyVersion('legacy-v0')).not.toThrow();
    expect(() => assertKnownPolicyVersion('v1')).not.toThrow();
    expect(() => assertKnownPolicyVersion('v99')).toThrow(TemporalContextError);
  });
});

describe('systemDefaultFor', () => {
  it('returns the per-field policy for the given version', () => {
    expect(systemDefaultFor('labs', 'legacy-v0')).toEqual({ horizon: 'LIFETIME' });
    expect(systemDefaultFor('labs', 'v1')).toEqual({ horizon: 'QUARTER' });
  });

  it('rejects an unknown field', () => {
    expect(() => systemDefaultFor('labz' as GateField, 'v1')).toThrow(TemporalContextError);
  });
});

describe('fieldHasClinicalState', () => {
  it('is derived from the fact kind, not a second hardcoded list', () => {
    expect(fieldHasClinicalState('conditions')).toBe(true);
    expect(fieldHasClinicalState('medications')).toBe(true);
    expect(fieldHasClinicalState('allergies')).toBe(true);
    expect(fieldHasClinicalState('labs')).toBe(false);
    expect(fieldHasClinicalState('vitals')).toBe(false);
  });

  it('agrees with the registry: exactly the stateful fields carry a status', () => {
    for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
      for (const field of ALL_FIELDS) {
        const hasStatus = TEMPORAL_POLICIES[version][field].status !== undefined;
        expect(hasStatus).toBe(fieldHasClinicalState(field));
      }
    }
  });
});
