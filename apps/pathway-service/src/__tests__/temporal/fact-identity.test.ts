import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import { ResolutionInput, SyntheticPatientContext } from '../../services/resolution/temporal/trust-mode';
import {
  EvaluationTemporalContext,
  makeEvaluationTemporalContext,
} from '../../services/resolution/temporal/evaluation-context';
import { NormalizedFact } from '../../services/resolution/temporal/fact-model';
import { buildEffectivePatientContext } from '../../services/resolution/effective-context';
import type { PatientContext } from '../../services/confidence/types';

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

const pc = (over: Partial<PatientContext> = {}): PatientContext => ({
  patientId: 'p1',
  conditionCodes: [],
  medications: [],
  labResults: [],
  allergies: [],
  ...over,
});

const idOf = (store: readonly NormalizedFact[], kind: string): string[] =>
  store.filter((f) => f.kind === kind).map((f) => f.factId);

describe('factId stability', () => {
  it('does not renumber other kinds when a condition is added', () => {
    // A shared ordinal counter meant inserting one condition shifted every
    // medication, allergy and lab id — so nothing downstream could reference
    // a fact across two assemblies of nearly-identical input.
    const base = {
      medications: [{ code: 'm1', system: 's' }],
      labResults: [{ code: 'l1', system: 's' }],
    };
    const before = assembleContext(synthetic(base), ctx());
    const after = assembleContext(
      synthetic({ ...base, conditionCodes: [{ code: 'c1', system: 's' }] }),
      ctx(),
    );
    expect(idOf(after, 'medication_order')).toEqual(idOf(before, 'medication_order'));
    expect(idOf(after, 'lab')).toEqual(idOf(before, 'lab'));
  });

  it('assigns identical ids to identical input, which is what retraversal relies on', () => {
    const input = () =>
      synthetic({
        conditionCodes: [{ code: 'c1', system: 's' }],
        vitalSigns: { heart_rate: 80 },
      });
    expect(assembleContext(input(), ctx()).map((f) => f.factId)).toEqual(
      assembleContext(input(), ctx()).map((f) => f.factId),
    );
  });
});

describe('buildEffectivePatientContext — distinct occurrences survive', () => {
  it('keeps the same code on a DIFFERENT date', () => {
    // Deduplicating on code|system alone discarded recurrence entirely, so
    // count_in_window counted 1 no matter how many events occurred. This is
    // upstream of the assembler: no amount of fact-model correctness fixes it.
    const merged = buildEffectivePatientContext(
      pc({ conditionCodes: [{ code: 'N39.0', system: 'icd10', date: '2026-01-15' }] }),
      { conditionCodes: [{ code: 'N39.0', system: 'icd10', date: '2026-06-02' }] },
    );
    expect(merged.conditionCodes).toHaveLength(2);
  });

  it('keeps the same code and date under a different sourceId', () => {
    const merged = buildEffectivePatientContext(
      pc({
        conditionCodes: [
          { code: 'N39.0', system: 'icd10', date: '2026-01-15', sourceId: 'a' },
        ],
      }),
      {
        conditionCodes: [
          { code: 'N39.0', system: 'icd10', date: '2026-01-15', sourceId: 'b' },
        ],
      },
    );
    expect(merged.conditionCodes).toHaveLength(2);
  });

  it('STILL collapses a genuine duplicate — same code, system, date and source', () => {
    const entry = { code: 'N39.0', system: 'icd10', date: '2026-01-15' };
    const merged = buildEffectivePatientContext(pc({ conditionCodes: [entry] }), {
      conditionCodes: [{ ...entry }],
    });
    expect(merged.conditionCodes).toHaveLength(1);
  });

  it('collapses undated duplicates, preserving today for the no-date case', () => {
    const entry = { code: 'E11.9', system: 'icd10' };
    const merged = buildEffectivePatientContext(pc({ conditionCodes: [entry] }), {
      conditionCodes: [{ ...entry }],
    });
    expect(merged.conditionCodes).toHaveLength(1);
  });

  it('applies the same rule to labs, medications and allergies', () => {
    const merged = buildEffectivePatientContext(
      pc({
        labResults: [{ code: 'l', system: 'loinc', value: 1, date: '2026-01-01' }],
        medications: [{ code: 'm', system: 'rx', date: '2026-01-01' }],
        allergies: [{ code: 'a', system: 'sn', date: '2026-01-01' }],
      }),
      {
        labResults: [{ code: 'l', system: 'loinc', value: 2, date: '2026-05-01' }],
        medications: [{ code: 'm', system: 'rx', date: '2026-05-01' }],
        allergies: [{ code: 'a', system: 'sn', date: '2026-05-01' }],
      },
    );
    expect(merged.labResults).toHaveLength(2);
    expect(merged.medications).toHaveLength(2);
    expect(merged.allergies).toHaveLength(2);
  });
});
