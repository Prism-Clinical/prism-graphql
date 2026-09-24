// Diagnostic harness: prove why attribute-form lab gates don't fire from
// simulator-style patient context, and that coded-form equivalents do.
// Run: npx ts-node --transpile-only .claude/skills/pathway-json-builder/scripts/gate-proof.ts
import { evaluateGate, GateEvaluationDeps } from '../../../../apps/pathway-service/src/services/resolution/gate-evaluator';
import { makeEvaluationTemporalContext } from '../../../../apps/pathway-service/src/services/resolution/temporal/evaluation-context';
import { GateType, DefaultBehavior } from '../../../../apps/pathway-service/src/types';
import type { GateProperties } from '../../../../apps/pathway-service/src/services/resolution/types';
import type { PatientContext } from '../../../../apps/pathway-service/src/services/confidence/types';

// What the simulator's PatientComposer actually sends: labs keyed by LOINC.
const patient: PatientContext = {
  conditionCodes: [{ code: 'O99.011', system: 'ICD-10' }],
  medications: [], allergies: [],
  labResults: [
    { code: '787-2', system: 'LOINC', value: 72, unit: 'fL', date: '2026-08-10' },   // MCV 72 — microcytic
    { code: '2276-4', system: 'LOINC', value: 12, unit: 'ng/mL', date: '2026-08-10' }, // ferritin 12 — IDA
  ],
} as unknown as PatientContext;

function deps(codeMap: Map<string, any>): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({ evaluationAsOf: '2026-08-16T00:00:00.000Z' }),
    pathwayDefaults: {}, factStore: [], codeMap,
    patientContext: patient,
    resolutionState: new Map(), gateAnswers: new Map(),
  } as GateEvaluationDeps;
}

const attributeForm: GateProperties = {
  title: 'MCV < 80 (attribute form — as currently authored)',
  gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
  condition: { attribute: 'lab.mcv', operator: 'less_than', value: 80, unit: 'fL', horizon: { days: 90 } } as any,
};
const codedForm: GateProperties = {
  title: 'MCV < 80 (coded form — proposed re-authoring)',
  gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
  condition: { field: 'labs', operator: 'less_than', value: '787-2', system: 'LOINC', threshold: 80, horizon: { days: 90 } } as any,
};

async function main() {
  const emptyMap = new Map();          // = deployment with unseeded pathway_attribute_code_map
  const seededMap = new Map([['lab.mcv', { attributeName: 'lab.mcv', namespace: 'lab', system: 'LOINC', code: '787-2', valueType: 'number' }]]);

  for (const [label, gate, map] of [
    ['attribute-form, code map UNSEEDED (today)', attributeForm, emptyMap],
    ['attribute-form, code map seeded        ', attributeForm, seededMap],
    ['coded-form, no code map needed         ', codedForm, emptyMap],
  ] as const) {
    const r = await evaluateGate(gate, deps(map as Map<string, any>));
    console.log(`${label} → satisfied=${r.satisfied}  reason: ${r.reason}`);
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
