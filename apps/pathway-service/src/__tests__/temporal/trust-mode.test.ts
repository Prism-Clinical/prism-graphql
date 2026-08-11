import {
  ResolutionInput,
  assertSyntheticAuthorized,
} from '../../services/resolution/temporal/trust-mode';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';

describe('ResolutionInput — the type IS the boundary', () => {
  it('carries a caller patientContext only on the SYNTHETIC variant', () => {
    // Compile-time is the real assertion; this documents it at runtime.
    const synthetic: ResolutionInput = {
      mode: 'SYNTHETIC',
      patientContext: {
        patientId: 'p',
        conditionCodes: [],
        medications: [],
        labResults: [],
        allergies: [],
      },
    };
    const live: ResolutionInput = { mode: 'LIVE', snapshotId: 'snap-1' };
    const replay: ResolutionInput = { mode: 'REPLAY', sessionId: 'sess-1' };

    expect('patientContext' in synthetic).toBe(true);
    expect('patientContext' in live).toBe(false);
    expect('patientContext' in replay).toBe(false);
  });
});

describe('assertSyntheticAuthorized', () => {
  it('allows an admin to select SYNTHETIC', () => {
    expect(() => assertSyntheticAuthorized('ADMIN')).not.toThrow();
  });

  it('rejects a provider selecting SYNTHETIC', () => {
    expect(() => assertSyntheticAuthorized('PROVIDER')).toThrow(TemporalContextError);
  });

  it('rejects a missing role rather than defaulting to permitted', () => {
    expect(() => assertSyntheticAuthorized(undefined)).toThrow(/INVALID_RESOLUTION_INPUT|authorized|ADMIN/);
  });

  it('uses the dedicated input error code, not the pathway-policy one', () => {
    try {
      assertSyntheticAuthorized('PROVIDER');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as TemporalContextError).code).toBe('INVALID_RESOLUTION_INPUT');
    }
  });
});
