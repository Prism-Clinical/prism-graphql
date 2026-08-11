/**
 * The proof this whole plan exists to produce.
 *
 * Plan 04 rewires evaluateGate onto selectFacts, which maps an uncertain
 * scalar to INDETERMINATE and thence to fail-closed. `legacy-v0` exists to
 * reproduce today's behavior exactly — so if any legacy-v0 case below does not
 * come back READY, the interval modeling is wrong and plan 04 must not be
 * written against it.
 *
 * This runs the real chain: assembleContext → cascade → selectFacts. Nothing
 * is stubbed, because a stub here would prove nothing about the composition.
 */

import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import { ResolutionInput, SyntheticPatientContext } from '../../services/resolution/temporal/trust-mode';
import {
  EvaluationTemporalContext,
  makeEvaluationTemporalContext,
} from '../../services/resolution/temporal/evaluation-context';
import { resolveEffectivePolicy, toEffectivePolicy } from '../../services/resolution/temporal/cascade';
import { selectFacts } from '../../services/resolution/temporal/select-facts';
import { FactSelectionCondition, GateField } from '../../services/resolution/temporal/contract';
import { SelectionOutcome } from '../../services/resolution/temporal/select-facts';

const AS_OF = '2026-06-01T12:00:00.000Z';
const DAY = 86_400_000;
const daysBefore = (n: number) =>
  new Date(Date.parse(AS_OF) - n * DAY).toISOString().slice(0, 10);
const daysAfter = (n: number) =>
  new Date(Date.parse(AS_OF) + n * DAY).toISOString().slice(0, 10);

const ctx = (version: string): EvaluationTemporalContext =>
  makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: version });

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

/** The full chain, exactly as plan 04 will drive it. */
function resolve(
  version: string,
  pc: Partial<SyntheticPatientContext>,
  condition: FactSelectionCondition,
): SelectionOutcome {
  const temporalCtx = ctx(version);
  const store = assembleContext(synthetic(pc), temporalCtx);
  const tier = resolveEffectivePolicy(condition.field as GateField, version, {});
  return selectFacts(condition, store, toEffectivePolicy(tier, temporalCtx));
}

describe('legacy-v0 — today’s behavior is preserved', () => {
  it('an undated condition still satisfies includes_code', () => {
    const out = resolve(
      'legacy-v0',
      { conditionCodes: [{ code: 'E11.9', system: 'icd10' }] },
      { field: 'conditions', operator: 'includes_code', value: 'E11.9' },
    );
    expect(out.status).toBe('READY');
  });

  it('an UNDATED LAB resolves READY for a scalar comparison, not INDETERMINATE', () => {
    // The sharpest case in the suite. vitalSigns carries no dates and
    // LabResult.date is optional, so modeling an undated fact as an UNKNOWN
    // end would make overlap() return UNKNOWN even against LIFETIME — and
    // every scalar gate reading one would fail closed the moment plan 04
    // lands.
    const out = resolve(
      'legacy-v0',
      { labResults: [{ code: '4548-4', system: 'loinc', value: 9.1 }] },
      { field: 'labs', operator: 'greater_than', value: '4548-4' },
    );
    expect(out.status).toBe('READY');
  });

  it('a VITAL resolves READY', () => {
    const out = resolve(
      'legacy-v0',
      { vitalSigns: { systolic_bp: 148 } },
      { field: 'vitals', operator: 'greater_than', value: 'systolic_bp' },
    );
    expect(out.status).toBe('READY');
  });

  it('a dated lab inside the window resolves', () => {
    const out = resolve(
      'legacy-v0',
      { labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, date: daysBefore(10) }] },
      { field: 'labs', operator: 'greater_than', value: '4548-4' },
    );
    expect(out.status).toBe('READY');
  });

  it('an undated medication and allergy both resolve', () => {
    expect(
      resolve(
        'legacy-v0',
        { medications: [{ code: 'm1', system: 'rxnorm' }] },
        { field: 'medications', operator: 'includes_code', value: 'm1' },
      ).status,
    ).toBe('READY');
    expect(
      resolve(
        'legacy-v0',
        { allergies: [{ code: 'a1', system: 'snomed' }] },
        { field: 'allergies', operator: 'includes_code', value: 'a1' },
      ).status,
    ).toBe('READY');
  });

  it('a FUTURE-dated fact is NO_MATCH — the horizon ends at the evaluation clock', () => {
    const out = resolve(
      'legacy-v0',
      { labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, date: daysAfter(30) }] },
      { field: 'labs', operator: 'greater_than', value: '4548-4' },
    );
    expect(out.status).toBe('NO_MATCH');
  });
});

describe('v1 — the quarter default bites only where it should', () => {
  // Both halves are asserted separately on purpose: an earlier draft claimed
  // to prove undated-still-resolves AND two-year-old-does-not, but only
  // asserted the second, so the first was never checked.

  it('an undated lab still resolves', () => {
    const out = resolve(
      'v1',
      { labResults: [{ code: '4548-4', system: 'loinc', value: 9.1 }] },
      { field: 'labs', operator: 'greater_than', value: '4548-4' },
    );
    expect(out.status).toBe('READY');
  });

  it('a two-year-old lab falls outside QUARTER', () => {
    const out = resolve(
      'v1',
      { labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, date: daysBefore(730) }] },
      { field: 'labs', operator: 'greater_than', value: '4548-4' },
    );
    expect(out.status).toBe('NO_MATCH');
  });

  it('a lab from last month is still inside QUARTER', () => {
    const out = resolve(
      'v1',
      { labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, date: daysBefore(30) }] },
      { field: 'labs', operator: 'greater_than', value: '4548-4' },
    );
    expect(out.status).toBe('READY');
  });

  it('and the same two-year-old lab DOES resolve under legacy-v0 — the versions differ', () => {
    // Without this, the NO_MATCH above could be caused by anything at all.
    const out = resolve(
      'legacy-v0',
      { labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, date: daysBefore(730) }] },
      { field: 'labs', operator: 'greater_than', value: '4548-4' },
    );
    expect(out.status).toBe('READY');
  });
});
