const { buildEffectivePatientContext, mergeAdditionalContext } = require(require('path').resolve(__dirname, '../../../../..') + '/apps/pathway-service/dist/services/resolution/effective-context.js');
const { assembleContext } = require(require('path').resolve(__dirname, '../../../../..') + '/apps/pathway-service/dist/services/resolution/temporal/context-assembler.js');
const { selectFacts } = require(require('path').resolve(__dirname, '../../../../..') + '/apps/pathway-service/dist/services/resolution/temporal/select-facts.js');
const { makeEvaluationTemporalContext, resolveHorizon } = require(require('path').resolve(__dirname, '../../../../..') + '/apps/pathway-service/dist/services/resolution/temporal/evaluation-context.js');
const ctx = makeEvaluationTemporalContext({ evaluationAsOf: '2026-09-26T15:00:00.000Z' });
const pol = { horizon: resolveHorizon('LIFETIME', ctx) };
const cond = { field: 'labs', operator: 'less_than', value: '718-7' };
function run(label, initLabs, adds, vitals = {}, vc = null) {
  let ac = undefined;
  for (const a of adds) ac = mergeAdditionalContext(ac, a);
  const eff = buildEffectivePatientContext({ patientId: 'p', conditionCodes: [], medications: [], labResults: initLabs, allergies: [], vitalSigns: vitals }, ac);
  const store = assembleContext({ mode: 'SYNTHETIC', patientContext: eff }, ctx);
  const o = selectFacts(vc ?? cond, store, pol);
  console.log(label, o.status, o.reasons ?? (o.selected ?? []).map((f) => f.code + '=' + f.value));
}
const ans = (v) => ({ labResults: [{ code: '718-7', system: 'LOINC', value: v, date: ctx.evaluationAsOf }] });
run('A undated+dated then answer', [{ code: '718-7', system: 'LOINC', value: 9 }, { code: '718-7', system: 'LOINC', value: 11, date: '2026-08-01' }], [ans(8)]);
run('B two undated then answer', [{ code: '718-7', system: 'LOINC', value: 9 }, { code: '718-7', system: 'LOINC', value: 12 }], [ans(8)]);
run('C same-day day-precision lab', [{ code: '718-7', system: 'LOINC', value: 9, date: '2026-09-26' }], [ans(8)]);
run('D answer then correction', [], [ans(7), ans(17)]);
run('E vitals attr answer', [], [], {}, null);
run('E2 vitals.systolic_bp flat key', [], [{ vitalSigns: { 'vitals.systolic_bp': 150 } }], {}, { field: 'vitals', operator: 'greater_than', value: 'systolic_bp', system: 'urn:prism:vitals' });
run('F nested+flat vital', [], [{ vitalSigns: { 'custom.pain': 8 } }], { custom: { pain: 3 } }, { field: 'vitals', operator: 'greater_than', value: 'custom.pain' });
run('G answer, API undated correction, re-answer', [], [ans(7), { labResults: [{ code: '718-7', system: 'LOINC', value: 17 }] }, ans(17)]);
{ let ac; ac = mergeAdditionalContext(ac, ans(7)); const before = JSON.stringify(ac); ac = mergeAdditionalContext(ac, ans(17)); console.log('H second answer changes additionalContext?', before !== JSON.stringify(ac)); }
run('I coded labs exists satisfied by valueless other lab', [{ code: '2276-4', system: 'LOINC' }], [], {}, { field: 'labs', operator: 'exists', value: '718-7' });
