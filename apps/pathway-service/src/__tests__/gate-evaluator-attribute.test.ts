import { evaluateGate } from '../services/resolution/gate-evaluator';
import { GateType } from '../services/resolution/types';
import { buildCodeMap } from '../services/resolution/attribute-code-map';
import type { PatientContext } from '../services/confidence/types';

const NOW = Date.parse('2026-06-27T00:00:00Z');
const codeMap = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
]);
function ctx(o: Partial<PatientContext> = {}): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [], ...o };
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
      ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 6.2 }] }),
      new Map(), new Map(), undefined, undefined, NOW, codeMap,
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
      ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 9.5 }] }),
      new Map(), new Map(), undefined, undefined, NOW, codeMap,
    );
    expect(result.satisfied).toBe(false);
    expect(result.contextFieldsRead).toEqual(['lab.hemoglobin']);
  });
});
