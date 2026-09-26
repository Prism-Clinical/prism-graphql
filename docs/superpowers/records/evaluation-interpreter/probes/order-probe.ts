const S = require('path').resolve(__dirname, '../../../../..') + '/apps/pathway-service/src';
const { TraversalEngine } = require(S + '/services/resolution/traversal-engine');
const { makeEvaluationTemporalContext } = require(S + '/services/resolution/temporal/evaluation-context');
const { makeGraphContext } = require(S + '/__tests__/fixtures/reference-patient-context');
const node = (id: string, type: string, props: any = {}) => ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } });
const edge = (s: string, t: string, ty = 'HAS_CHILD') => ({ id: `${s}->${t}`, edgeType: ty, sourceId: s, targetId: t, properties: {} });
const conf = { computeNodeConfidence: async () => ({ confidence: 0.9, breakdown: [] }) };
const P = { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [] };
const eng = () => new TraversalEngine(conf, { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
  makeEvaluationTemporalContext({ evaluationAsOf: '2026-09-03T12:00:00.000Z', temporalPolicyVersion: 'legacy-v0' }), {}, [], new Map());
const nodes = [
  node('root', 'Pathway'),
  node('gate-dep', 'Gate', { gate_type: 'prior_node_result', default_behavior: 'skip', depends_on: [{ node_id: 'step-hidden', status: 'INCLUDED' }] }),
  node('gate-closed', 'Gate', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10' } }),
  node('step-hidden', 'Step'), node('med-dep', 'Medication', { name: 'X' }), node('med-hidden', 'Medication', { name: 'Y' }),
];
const tail = [edge('gate-closed', 'step-hidden', 'BRANCHES_TO'), edge('step-hidden', 'med-hidden'), edge('gate-dep', 'med-dep')];
(async () => {
  for (const order of [['gate-dep', 'gate-closed'], ['gate-closed', 'gate-dep']]) {
    const g = makeGraphContext(nodes, [...order.map((o) => edge('root', o, 'HAS_GATE')), ...tail]);
    const r = await eng().traverse(g, P, new Map());
    console.log(order.join(' before '), '=>', ['gate-dep', 'med-dep', 'step-hidden', 'med-hidden'].map((k) => `${k}:${r.resolutionState.get(k)?.status}`).join(' '));
  }
  // override INCLUDE on a one_of DecisionPoint: are both arms opened?
  const n2 = [node('root', 'Pathway'), node('dp', 'DecisionPoint', { branch_mode: 'one_of' }), node('a', 'Medication', { name: 'A' }), node('b', 'Medication', { name: 'B' })];
  const e2 = [edge('root', 'dp'), edge('dp', 'a', 'BRANCHES_TO'), edge('dp', 'b', 'BRANCHES_TO')];
  const r0 = await eng().traverse(makeGraphContext(n2, e2), P, new Map());
  console.log('DP no override:', r0.resolutionState.get('dp').status, r0.resolutionState.get('a').status, r0.resolutionState.get('b').status);
  const ov = new Map([['dp', { action: 'INCLUDE', originalStatus: 'PENDING_QUESTION', originalConfidence: 0 }]]);
  const r1 = await eng().traverse(makeGraphContext(n2, e2), P, new Map(), ov);
  console.log('DP INCLUDE override:', r1.resolutionState.get('dp').status, r1.resolutionState.get('a').status, r1.resolutionState.get('b').status, 'pending:', r1.pendingQuestions.length);
})();
