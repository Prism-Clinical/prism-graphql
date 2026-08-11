import {
  assembleContext,
  VITALS_SYSTEM,
} from '../../services/resolution/temporal/context-assembler';
import {
  ResolutionInput,
  SyntheticLabResult,
  SyntheticPatientContext,
} from '../../services/resolution/temporal/trust-mode';
import {
  EvaluationTemporalContext,
  makeEvaluationTemporalContext,
} from '../../services/resolution/temporal/evaluation-context';
import { ObservationFact, NormalizedFact } from '../../services/resolution/temporal/fact-model';

const AS_OF = '2026-06-01T12:00:00.000Z';

const ctx = (): EvaluationTemporalContext =>
  makeEvaluationTemporalContext({ evaluationAsOf: AS_OF });

const synthetic = (over: Partial<SyntheticPatientContext> = {}): ResolutionInput => ({
  mode: 'SYNTHETIC',
  patientContext: {
    patientId: 'p1',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
    ...over,
  },
});

const obs = (store: readonly NormalizedFact[], kind: 'lab' | 'vital'): ObservationFact[] =>
  store.filter((f) => f.kind === kind) as ObservationFact[];

describe('assembleContext — labs', () => {
  it('maps a lab to the lab kind carrying value and unit', () => {
    const [f] = obs(
      assembleContext(
        synthetic({ labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, unit: '%' }] }),
        ctx(),
      ),
      'lab',
    );
    expect(f.kind).toBe('lab');
    expect(f.code).toBe('4548-4');
    expect(f.system).toBe('loinc');
    expect(f.value).toBe(9.1);
    expect(f.unit).toBe('%');
  });

  it('models a dated lab as a point fact — start and KNOWN end on the same bound', () => {
    // overlap() only takes its point-fact branch when the KNOWN end equals the
    // start bound. Modeling a dated lab as OPEN(asOf) instead would make a
    // two-year-old result overlap QUARTER forever.
    const [f] = obs(
      assembleContext(
        synthetic({ labResults: [{ code: 'l', system: 'loinc', value: 1, date: '2026-05-20' }] }),
        ctx(),
      ),
      'lab',
    );
    expect(f.interval.start).toEqual({ value: '2026-05-20', precision: 'day' });
    expect(f.interval.end).toEqual({
      kind: 'KNOWN',
      bound: { value: '2026-05-20', precision: 'day' },
    });
  });

  it('models an undated lab as OPEN at the evaluation clock', () => {
    const [f] = obs(
      assembleContext(synthetic({ labResults: [{ code: 'l', system: 'loinc', value: 1 }] }), ctx()),
      'lab',
    );
    expect(f.interval.start).toBeUndefined();
    expect(f.interval.end).toEqual({ kind: 'OPEN', assertedCurrentAt: AS_OF });
  });

  it('retains a value-less lab so `exists` can still find it', () => {
    const facts = obs(
      assembleContext(synthetic({ labResults: [{ code: 'l', system: 'loinc' }] }), ctx()),
      'lab',
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBeUndefined();
  });

  it('carries recordValidity: INVALID onto the fact instead of admitting it', () => {
    const [f] = obs(
      assembleContext(
        synthetic({
          labResults: [{ code: 'l', system: 'loinc', value: 1, recordValidity: 'INVALID' }],
        }),
        ctx(),
      ),
      'lab',
    );
    expect(f.recordValidity).toBe('INVALID');
  });

  it('defaults recordValidity to VALID', () => {
    const [f] = obs(
      assembleContext(synthetic({ labResults: [{ code: 'l', system: 'loinc' }] }), ctx()),
      'lab',
    );
    expect(f.recordValidity).toBe('VALID');
  });

  it('lands sourceId in provenance', () => {
    const [f] = obs(
      assembleContext(
        synthetic({ labResults: [{ code: 'l', system: 'loinc', sourceId: 'obs-3' }] }),
        ctx(),
      ),
      'lab',
    );
    expect(f.provenance.sourceId).toBe('obs-3');
    expect(f.provenance.sourceType).toBe('SYNTHETIC');
  });

  it('rejects a clinicalState on a lab rather than silently ignoring it', () => {
    // Observations carry no clinical state. Ignoring the field would hide an
    // authoring error that produces a fact the author did not intend.
    const bad = { code: 'l', system: 'loinc', clinicalState: 'ACTIVE' } as unknown as SyntheticLabResult;
    expect(() => assembleContext(synthetic({ labResults: [bad] }), ctx())).toThrow(
      /labResults\[0\].*clinicalState|clinicalState.*labResults\[0\]/,
    );
  });

  it('rejects an unparseable lab date naming the field path', () => {
    expect(() =>
      assembleContext(
        synthetic({ labResults: [{ code: 'l', system: 'loinc', date: 'whenever' }] }),
        ctx(),
      ),
    ).toThrow(/labResults\[0\]\.date/);
  });
});

describe('assembleContext — vitals', () => {
  it('emits one fact per numeric root key', () => {
    const facts = obs(
      assembleContext(synthetic({ vitalSigns: { systolic_bp: 148, heart_rate: 92 } }), ctx()),
      'vital',
    );
    expect(facts.map((f) => f.code).sort()).toEqual(['heart_rate', 'systolic_bp']);
    expect(facts.find((f) => f.code === 'systolic_bp')?.value).toBe(148);
  });

  it('flattens custom vitals to the dotted key the evaluator resolves', () => {
    const facts = obs(
      assembleContext(synthetic({ vitalSigns: { custom: { pain_score: 7 } } }), ctx()),
      'vital',
    );
    expect(facts.map((f) => f.code)).toEqual(['custom.pain_score']);
    expect(facts[0].value).toBe(7);
  });

  it('models every vital as OPEN at the evaluation clock with no start', () => {
    const [f] = obs(assembleContext(synthetic({ vitalSigns: { heart_rate: 80 } }), ctx()), 'vital');
    expect(f.interval.start).toBeUndefined();
    expect(f.interval.end).toEqual({ kind: 'OPEN', assertedCurrentAt: AS_OF });
  });

  it('skips non-numeric entries rather than emitting a value-less vital', () => {
    const facts = obs(
      assembleContext(
        synthetic({
          vitalSigns: { heart_rate: 80, note: 'looks well', bad: NaN, missing: null },
        }),
        ctx(),
      ),
      'vital',
    );
    expect(facts.map((f) => f.code)).toEqual(['heart_rate']);
  });

  it('produces observation facts with no clinicalState property', () => {
    const [f] = obs(assembleContext(synthetic({ vitalSigns: { heart_rate: 80 } }), ctx()), 'vital');
    expect('clinicalState' in f).toBe(false);
  });

  it('stamps the local vitals system so a gate with no system still matches', () => {
    const [f] = obs(assembleContext(synthetic({ vitalSigns: { heart_rate: 80 } }), ctx()), 'vital');
    expect(f.system).toBe(VITALS_SYSTEM);
  });
});

describe('assembleContext — vitals path parity with resolveNumericPath', () => {
  // resolveNumericPath (gate-evaluator.ts:169) splits the condition value on
  // '.' and walks arbitrary depth. Anything it can reach must become a fact,
  // or plan 04 turns a working gate into a silent NO_MATCH.
  it('reaches a numeric leaf nested deeper than one custom level', () => {
    const facts = obs(
      assembleContext(
        synthetic({ vitalSigns: { custom: { nested: { deeper: 42 } } } }),
        ctx(),
      ),
      'vital',
    );
    expect(facts.map((f) => f.code)).toEqual(['custom.nested.deeper']);
    expect(facts[0].value).toBe(42);
  });

  it('emits every leaf across mixed depths in one bag', () => {
    const facts = obs(
      assembleContext(
        synthetic({
          vitalSigns: {
            heart_rate: 80,
            custom: { pain_score: 7, nested: { deeper: 42 } },
            bp: { systolic: 148, diastolic: 92 },
          },
        }),
        ctx(),
      ),
      'vital',
    );
    expect(facts.map((f) => f.code).sort()).toEqual([
      'bp.diastolic',
      'bp.systolic',
      'custom.nested.deeper',
      'custom.pain_score',
      'heart_rate',
    ]);
  });

  it('indexes arrays by string key, matching how resolveNumericPath walks them', () => {
    const facts = obs(
      assembleContext(synthetic({ vitalSigns: { readings: [10, 20] } }), ctx()),
      'vital',
    );
    expect(facts.map((f) => f.code)).toEqual(['readings.0', 'readings.1']);
  });

  it('still skips non-numeric leaves at depth', () => {
    const facts = obs(
      assembleContext(
        synthetic({ vitalSigns: { custom: { note: 'fine', score: 3, bad: NaN } } }),
        ctx(),
      ),
      'vital',
    );
    expect(facts.map((f) => f.code)).toEqual(['custom.score']);
  });

  it('terminates on a cyclic bag instead of recursing forever', () => {
    const bag: Record<string, unknown> = { heart_rate: 80 };
    bag.self = bag;
    expect(() => assembleContext(synthetic({ vitalSigns: bag }), ctx())).not.toThrow();
  });
});

describe('assembleContext — inverted intervals are input errors', () => {
  it('rejects an endDate before the date rather than deferring to overlap()', () => {
    // overlap() throws a bare Error on this (overlap.ts:42) — no code, and
    // mid-traversal, after LLM gates have already run.
    expect(() =>
      assembleContext(
        synthetic({
          conditionCodes: [
            { code: 'c', system: 's', date: '2026-06-10', endDate: '2026-06-01' },
          ],
        }),
        ctx(),
      ),
    ).toThrow(/endDate/);
  });

  it('uses the resolution-input error code', () => {
    try {
      assembleContext(
        synthetic({
          medications: [{ code: 'm', system: 's', date: '2026-06-10', endDate: '2026-06-01' }],
        }),
        ctx(),
      );
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('INVALID_RESOLUTION_INPUT');
    }
  });

  it('accepts an endDate equal to the date', () => {
    expect(() =>
      assembleContext(
        synthetic({
          conditionCodes: [
            { code: 'c', system: 's', date: '2026-06-01', endDate: '2026-06-01' },
          ],
        }),
        ctx(),
      ),
    ).not.toThrow();
  });

  it('accepts a coarser end whose range still overlaps the start', () => {
    // date 2026-06-10, endDate 2026-06 (month precision, hi = end of June).
    expect(() =>
      assembleContext(
        synthetic({
          conditionCodes: [{ code: 'c', system: 's', date: '2026-06-10', endDate: '2026-06' }],
        }),
        ctx(),
      ),
    ).not.toThrow();
  });
});
