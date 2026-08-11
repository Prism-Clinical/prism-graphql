import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import {
  ResolutionInput,
  SyntheticCodeEntry,
  SyntheticPatientContext,
} from '../../services/resolution/temporal/trust-mode';
import {
  EvaluationTemporalContext,
  TemporalContextError,
  makeEvaluationTemporalContext,
} from '../../services/resolution/temporal/evaluation-context';
import { StatefulFact, NormalizedFact } from '../../services/resolution/temporal/fact-model';

const AS_OF = '2026-06-01T12:00:00.000Z';

const ctx = (): EvaluationTemporalContext =>
  makeEvaluationTemporalContext({ evaluationAsOf: AS_OF });

const pc = (over: Partial<SyntheticPatientContext> = {}): SyntheticPatientContext => ({
  patientId: 'p1',
  conditionCodes: [],
  medications: [],
  labResults: [],
  allergies: [],
  ...over,
});

const synthetic = (over: Partial<SyntheticPatientContext> = {}): ResolutionInput => ({
  mode: 'SYNTHETIC',
  patientContext: pc(over),
});

const only = (store: readonly NormalizedFact[]): StatefulFact => {
  expect(store).toHaveLength(1);
  return store[0] as StatefulFact;
};

describe('assembleContext — mode gating', () => {
  it('refuses LIVE, naming the plan that will implement it', () => {
    const input: ResolutionInput = { mode: 'LIVE', snapshotId: 'snap-1' };
    expect(() => assembleContext(input, ctx())).toThrow(/plan 07|snapshot mapper/i);
  });

  it('refuses REPLAY, naming the plan that will implement it', () => {
    const input: ResolutionInput = { mode: 'REPLAY', sessionId: 'sess-1' };
    expect(() => assembleContext(input, ctx())).toThrow(/plan 05b|persisted/i);
  });

  it('uses the resolution-input error code for both', () => {
    for (const input of [
      { mode: 'LIVE', snapshotId: 's' },
      { mode: 'REPLAY', sessionId: 's' },
    ] as ResolutionInput[]) {
      try {
        assembleContext(input, ctx());
        throw new Error('expected a throw');
      } catch (e) {
        expect((e as TemporalContextError).code).toBe('INVALID_RESOLUTION_INPUT');
      }
    }
  });
});

describe('assembleContext — kind mapping', () => {
  it('maps each stateful bucket to its fact kind', () => {
    const store = assembleContext(
      synthetic({
        conditionCodes: [{ code: 'E11.9', system: 'icd10' }],
        medications: [{ code: 'm1', system: 'rxnorm' }],
        allergies: [{ code: 'a1', system: 'snomed' }],
      }),
      ctx(),
    );
    expect(store.map((f) => f.kind).sort()).toEqual(['allergy', 'condition', 'medication_order']);
  });

  it('carries code, system and display through unchanged', () => {
    const store = assembleContext(
      synthetic({ conditionCodes: [{ code: 'E11.9', system: 'icd10', display: 'T2DM' }] }),
      ctx(),
    );
    const f = only(store);
    expect(f.code).toBe('E11.9');
    expect(f.system).toBe('icd10');
    expect(f.display).toBe('T2DM');
    expect(f.provenance.sourceType).toBe('SYNTHETIC');
  });
});

describe('assembleContext — defaults when nothing is asserted', () => {
  it('defaults to ACTIVE by failing open, and records that basis', () => {
    const f = only(
      assembleContext(synthetic({ conditionCodes: [{ code: 'c', system: 's' }] }), ctx()),
    );
    expect(f.clinicalState).toBe('ACTIVE');
    expect(f.stateBasis).toBe('MISSING_STATUS_FAIL_OPEN');
  });

  it('defaults recordValidity to VALID', () => {
    const f = only(
      assembleContext(synthetic({ conditionCodes: [{ code: 'c', system: 's' }] }), ctx()),
    );
    expect(f.recordValidity).toBe('VALID');
  });

  it('models an undated active fact as OPEN at the evaluation clock', () => {
    const f = only(
      assembleContext(synthetic({ conditionCodes: [{ code: 'c', system: 's' }] }), ctx()),
    );
    expect(f.interval.start).toBeUndefined();
    expect(f.interval.end).toEqual({ kind: 'OPEN', assertedCurrentAt: AS_OF });
  });
});

describe('assembleContext — interval construction', () => {
  it('parses a supplied date into a precision-carrying start bound', () => {
    const f = only(
      assembleContext(
        synthetic({ conditionCodes: [{ code: 'c', system: 's', date: '2026-01-15' }] }),
        ctx(),
      ),
    );
    expect(f.interval.start).toEqual({ value: '2026-01-15', precision: 'day' });
    expect(f.interval.end).toEqual({ kind: 'OPEN', assertedCurrentAt: AS_OF });
  });

  it('turns endDate into a KNOWN end rather than ignoring it', () => {
    const f = only(
      assembleContext(
        synthetic({
          conditionCodes: [
            { code: 'c', system: 's', date: '2026-01-15', endDate: '2026-03-01' },
          ],
        }),
        ctx(),
      ),
    );
    expect(f.interval.end).toEqual({
      kind: 'KNOWN',
      bound: { value: '2026-03-01', precision: 'day' },
    });
  });

  it('gives an INACTIVE fact with no endDate an UNKNOWN end, never OPEN', () => {
    // Asserting an inactive condition is current AT the evaluation instant is
    // false, and OPEN(asOf) would let it match an arbitrarily narrow horizon.
    const f = only(
      assembleContext(
        synthetic({
          conditionCodes: [{ code: 'c', system: 's', clinicalState: 'INACTIVE' }],
        }),
        ctx(),
      ),
    );
    expect(f.clinicalState).toBe('INACTIVE');
    expect(f.interval.end).toEqual({ kind: 'UNKNOWN' });
  });

  it('gives a CONFLICT fact with no endDate an UNKNOWN end too', () => {
    const f = only(
      assembleContext(
        synthetic({
          conditionCodes: [{ code: 'c', system: 's', clinicalState: 'CONFLICT' }],
        }),
        ctx(),
      ),
    );
    expect(f.interval.end).toEqual({ kind: 'UNKNOWN' });
  });

  it('still honors an explicit endDate on an INACTIVE fact', () => {
    const f = only(
      assembleContext(
        synthetic({
          conditionCodes: [
            { code: 'c', system: 's', clinicalState: 'INACTIVE', endDate: '2026-02-02' },
          ],
        }),
        ctx(),
      ),
    );
    expect(f.interval.end).toEqual({
      kind: 'KNOWN',
      bound: { value: '2026-02-02', precision: 'day' },
    });
  });
});

describe('assembleContext — asserted values are honored', () => {
  it('honors a supplied clinicalState and records the SYNTHETIC basis', () => {
    const f = only(
      assembleContext(
        synthetic({ medications: [{ code: 'm', system: 's', clinicalState: 'ON_HOLD' }] }),
        ctx(),
      ),
    );
    expect(f.clinicalState).toBe('ON_HOLD');
    expect(f.stateBasis).toBe('SYNTHETIC');
  });

  it('carries recordValidity: INVALID onto the fact instead of admitting it as VALID', () => {
    const f = only(
      assembleContext(
        synthetic({ conditionCodes: [{ code: 'c', system: 's', recordValidity: 'INVALID' }] }),
        ctx(),
      ),
    );
    expect(f.recordValidity).toBe('INVALID');
  });

  it('lands sourceId in provenance', () => {
    const f = only(
      assembleContext(
        synthetic({ conditionCodes: [{ code: 'c', system: 's', sourceId: 'enc-9' }] }),
        ctx(),
      ),
    );
    expect(f.provenance.sourceId).toBe('enc-9');
  });

  it('rejects an unknown clinicalState naming the field path', () => {
    expect(() =>
      assembleContext(
        synthetic({ medications: [{ code: 'm', system: 's', clinicalState: 'banana' }] }),
        ctx(),
      ),
    ).toThrow(/medications\[0\]/);
  });

  it('rejects an unparseable date naming the field path', () => {
    expect(() =>
      assembleContext(
        synthetic({
          allergies: [{ code: 'a', system: 's', date: 'last tuesday' } as SyntheticCodeEntry],
        }),
        ctx(),
      ),
    ).toThrow(/allergies\[0\]\.date/);
  });
});

describe('assembleContext — fact identity', () => {
  it('scopes ordinals per kind so ids are unique and kind-tagged', () => {
    const store = assembleContext(
      synthetic({
        conditionCodes: [
          { code: 'c1', system: 's' },
          { code: 'c2', system: 's' },
        ],
        medications: [{ code: 'm1', system: 's' }],
      }),
      ctx(),
    );
    const ids = store.map((f) => f.factId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((i) => i.startsWith('condition:'))).toHaveLength(2);
    expect(ids.filter((i) => i.startsWith('medication_order:'))).toHaveLength(1);
  });
});
