import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import { GateType } from '../services/resolution/types';
import { buildCodeMap } from '../services/resolution/attribute-code-map';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import type { PatientContext } from '../services/confidence/types';

const AS_OF = '2026-06-27T00:00:00.000Z';
const codeMap = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
]);
function ctx(o: Partial<PatientContext> = {}): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [], ...o };
}

/**
 * Plan 04 Task 3 replaced the positional parameter list with one deps object
 * (D6). The code map — the thing this suite is actually about — moves from
 * argument 8 to `deps.codeMap`; the assertions are unchanged.
 */
function deps(patientContext: PatientContext, map = codeMap): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({ evaluationAsOf: AS_OF }),
    pathwayDefaults: {},
    factStore: [],
    patientContext,
    resolutionState: new Map(),
    gateAnswers: new Map(),
    codeMap: map,
  };
}

describe('evaluateGate — attribute conditions', () => {
  it('fires a severe-anemia gate when Hb below threshold, reporting the attribute path', async () => {
    const result = await evaluateGate(
      {
        gate_type: GateType.PATIENT_ATTRIBUTE,
        title: 'Severe anemia',
        default_behavior: 'skip',
        condition: { attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 },
      },
      deps(ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 6.2 }] })),
    );
    expect(result.satisfied).toBe(true);
    expect(result.contextFieldsRead).toEqual(['lab.hemoglobin']);
  });

  it('does not fire when Hb at/above threshold', async () => {
    const result = await evaluateGate(
      {
        gate_type: GateType.PATIENT_ATTRIBUTE,
        title: 'Severe anemia',
        default_behavior: 'skip',
        condition: { attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 },
      },
      deps(ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 9.5 }] })),
    );
    expect(result.satisfied).toBe(false);
    expect(result.contextFieldsRead).toEqual(['lab.hemoglobin']);
  });
});
