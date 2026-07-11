import { buildCodeMap } from '../services/resolution/attribute-code-map';
import { evaluateGate } from '../services/resolution/gate-evaluator';
import { GateType } from '../services/resolution/types';
import type { PatientContext } from '../services/confidence/types';

const NOW = Date.parse('2026-06-27T00:00:00Z');
function ctx(o: Partial<PatientContext> = {}): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [], ...o };
}

it('an empty code map cannot resolve lab.* (proves the map is required and threaded)', async () => {
  const withMap = buildCodeMap([{ attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' }]);
  const patient = ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 6 }] });
  const cond = { attribute: 'lab.hemoglobin', operator: 'less_than' as const, value: 7 };

  const resolved = await evaluateGate(
    { gate_type: GateType.PATIENT_ATTRIBUTE, title: 't', default_behavior: 'skip', condition: cond },
    patient, new Map(), new Map(), undefined, undefined, NOW, withMap);
  const unresolved = await evaluateGate(
    { gate_type: GateType.PATIENT_ATTRIBUTE, title: 't', default_behavior: 'skip', condition: cond },
    patient, new Map(), new Map(), undefined, undefined, NOW, new Map());

  expect(resolved.satisfied).toBe(true);    // map present → Hb resolves → 6 < 7
  expect(unresolved.satisfied).toBe(false); // no map → lab.* unresolved → unsatisfied
});
