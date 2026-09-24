/**
 * Evaluator behaviour the import validator admits but the engine read
 * differently: operator casing and missing demographic data.
 */
import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  GateType,
  DefaultBehavior,
  GateCondition,
} from '../services/resolution/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import type { PatientContext } from '../services/confidence/types';
import type { NormalizedFact } from '../services/resolution/temporal/fact-model';

const AS_OF = '2026-08-11T00:00:00.000Z';

function patient(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    patientId: 'p',
    conditionCodes: [],
    patientAttributes: { age: 30 },
    medications: [],
    labResults: [],
    allergies: [],
    ...overrides,
  } as PatientContext;
}

function deps(version: string, overrides: Partial<GateEvaluationDeps> = {}): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
      encounterStart: '2026-08-10T08:00:00.000Z',
      temporalPolicyVersion: version,
    }),
    pathwayDefaults: {},
    factStore: [],
    codeMap: new Map(),
    patientContext: patient(),
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
    ...overrides,
  };
}

// `patient.*` resolves from patientContext under BOTH versions (the kernel has
// no fact kind for demographics), so one fixture drives legacy-v0 and v1 alike.
const TRUE_C = { attribute: 'patient.age', operator: 'greater_than', value: 18 } as GateCondition;
const FALSE_C = { attribute: 'patient.age', operator: 'less_than', value: 18 } as GateCondition;

function compound(operator: string, conditions: GateCondition[]): GateProperties {
  return {
    title: 'c',
    gate_type: GateType.COMPOUND,
    default_behavior: DefaultBehavior.SKIP,
    operator: operator as 'AND',
    conditions,
  };
}

describe('the wildcard the import validator suggests actually matches', () => {
  // The validator rejects "G82.2*" and tells the author to write "G82.2.*".
  // That advice is only honest if both engines match G82.21 with it.
  const gate: GateProperties = {
    title: 'w',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: { field: 'conditions', operator: 'includes_code', value: 'G82.2.*' },
  };

  it('matches under legacy-v0 (matchesCodePattern)', async () => {
    const ctx = patient({ conditionCodes: [{ code: 'G82.21', system: 'ICD-10' }] } as Partial<PatientContext>);
    const r = await evaluateGate(gate, deps('legacy-v0', { patientContext: ctx }));
    expect(r.satisfied).toBe(true);
  });

  it('matches under v1 (select-facts codeMatches)', async () => {
    const fact = {
      kind: 'condition',
      factId: 'f1',
      code: 'G82.21',
      system: 'ICD-10',
      interval: {
        start: { value: '2020', precision: 'year' },
        end: { kind: 'OPEN', assertedCurrentAt: AS_OF },
      },
      recordValidity: 'VALID',
      validityBasis: 'verification:confirmed',
      provenance: { sourceType: 'SYNTHETIC' },
      clinicalState: 'ACTIVE',
      stateBasis: 'FHIR_STATUS',
    } as unknown as NormalizedFact;
    const r = await evaluateGate(gate, deps('v1', { factStore: [fact] }));
    expect(r.satisfied).toBe(true);
  });
});

describe('compound operator casing', () => {
  // The validator accepts `and`/`or` in any case; the evaluator compared
  // `op === 'AND'` and treated everything else as OR.
  it.each(['legacy-v0', 'v1'])('a lowercase "and" is AND, not OR (%s)', async (version) => {
    const r = await evaluateGate(compound('and', [TRUE_C, FALSE_C]), deps(version));
    expect(r.satisfied).toBe(false);
  });

  it.each(['legacy-v0', 'v1'])('a lowercase "or" is OR (%s)', async (version) => {
    const r = await evaluateGate(compound('or', [TRUE_C, FALSE_C]), deps(version));
    expect(r.satisfied).toBe(true);
  });
});
