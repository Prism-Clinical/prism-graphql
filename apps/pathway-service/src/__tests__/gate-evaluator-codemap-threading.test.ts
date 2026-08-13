import { buildCodeMap } from '../services/resolution/attribute-code-map';
import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import { GateType } from '../services/resolution/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import type { AttributeCodeMap } from '../services/resolution/types';
import type { PatientContext } from '../services/confidence/types';

const AS_OF = '2026-06-27T00:00:00.000Z';
function ctx(o: Partial<PatientContext> = {}): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [], ...o };
}

/**
 * Plan 04 Task 3 moved the code map out of positional argument 8 and into
 * `deps.codeMap`. The claim under test is unchanged: without the map, `lab.*`
 * cannot resolve.
 */
function deps(patientContext: PatientContext, codeMap: AttributeCodeMap): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({ evaluationAsOf: AS_OF }),
    pathwayDefaults: {},
    factStore: [],
    patientContext,
    resolutionState: new Map(),
    gateAnswers: new Map(),
    codeMap,
  };
}

it('an empty code map cannot resolve lab.* (proves the map is required and threaded)', async () => {
  const withMap = buildCodeMap([{ attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' }]);
  const patient = ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 6 }] });
  const cond = { attribute: 'lab.hemoglobin', operator: 'less_than' as const, value: 7 };

  const resolved = await evaluateGate(
    { gate_type: GateType.PATIENT_ATTRIBUTE, title: 't', default_behavior: 'skip', condition: cond },
    deps(patient, withMap));
  const unresolved = await evaluateGate(
    { gate_type: GateType.PATIENT_ATTRIBUTE, title: 't', default_behavior: 'skip', condition: cond },
    deps(patient, new Map()));

  expect(resolved.satisfied).toBe(true);    // map present → Hb resolves → 6 < 7
  expect(unresolved.satisfied).toBe(false); // no map → lab.* unresolved → unsatisfied
});
