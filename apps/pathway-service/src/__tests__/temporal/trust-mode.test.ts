import {
  ResolutionInput,
  assertSyntheticAuthorized,
  firstTrustAssertion,
} from '../../services/resolution/temporal/trust-mode';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';

/**
 * D10 — ONE predicate, two callers. `parseResolutionInput` applies it at
 * `startResolution` and `addPatientContext` applies it directly, so the two
 * doors into the fact assembler cannot disagree about which fields are
 * privileged. Testing it here, on its own, is what stops a second spelling
 * appearing at the second door (locked decision #7).
 */
describe('firstTrustAssertion — the shared rule (D10)', () => {
  it('names the coded assertion fields, with the bucket and index', () => {
    for (const field of ['endDate', 'clinicalState', 'recordValidity', 'sourceId']) {
      expect(
        firstTrustAssertion({
          conditionCodes: [{ code: 'A' }, { code: 'B', [field]: 'x' } as never],
        }),
      ).toBe(`conditionCodes[1].${field}`);
    }
  });

  it('covers medications and allergies, not conditions alone', () => {
    expect(firstTrustAssertion({ medications: [{ code: 'M', sourceId: 's' } as never] }))
      .toBe('medications[0].sourceId');
    expect(firstTrustAssertion({ allergies: [{ code: 'A', clinicalState: 'INACTIVE' } as never] }))
      .toBe('allergies[0].clinicalState');
  });

  it('applies the NARROWER lab rule — labs have no clinical state to assert', () => {
    expect(firstTrustAssertion({ labResults: [{ code: 'L', recordValidity: 'INVALID' } as never] }))
      .toBe('labResults[0].recordValidity');
    // `endDate`/`clinicalState` are not lab fields at all, so a lab carrying one
    // is not a trust assertion — it is a shape the assembler ignores.
    expect(firstTrustAssertion({ labResults: [{ code: 'L', clinicalState: 'ACTIVE' } as never] }))
      .toBeUndefined();
  });

  it('treats `date` as observational data, never as an assertion', () => {
    expect(firstTrustAssertion({ labResults: [{ code: 'L', date: '2026-01-10' } as never] }))
      .toBeUndefined();
    expect(firstTrustAssertion({ conditionCodes: [{ code: 'C', date: '2026-01-10' } as never] }))
      .toBeUndefined();
  });

  it('treats an explicit null exactly as omission', () => {
    expect(
      firstTrustAssertion({ conditionCodes: [{ code: 'C', clinicalState: null } as never] }),
    ).toBeUndefined();
  });

  it('returns undefined for a clean payload, an empty one, and no payload', () => {
    expect(firstTrustAssertion({ conditionCodes: [{ code: 'C', system: 'ICD-10' }] })).toBeUndefined();
    expect(firstTrustAssertion({})).toBeUndefined();
    expect(firstTrustAssertion(undefined)).toBeUndefined();
    expect(firstTrustAssertion(null)).toBeUndefined();
  });
});

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
