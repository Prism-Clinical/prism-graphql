// Read-only probes of the live-built engine (dist @ d377465). No DB, no repo writes.
const D = require('path').resolve(__dirname, '../../../../..') + '/apps/pathway-service/dist/services/resolution';
const { TraversalEngine } = require(D + '/traversal-engine');
const { makeEvaluationTemporalContext } = require(D + '/temporal/evaluation-context');
const P = (x) => (typeof x === 'string' ? JSON.parse(x) : x || {});

function ctx(nodes, edges) {
  const nm = new Map(nodes.map((n) => [n.nodeIdentifier, n]));
  const out = new Map(); nodes.forEach((n) => out.set(n.nodeIdentifier, []));
  edges.forEach((e) => out.get(e.sourceId)?.push(e));
  return { allNodes: nodes, allEdges: edges, getNode: (i) => nm.get(i), outgoingEdges: (i) => out.get(i) ?? [],
    incomingEdges: (i) => edges.filter((e) => e.targetId === i), linkedNodes: () => [] };
}
const N = (id, t, p = {}) => ({ id, nodeIdentifier: id, nodeType: t, properties: { title: id, ...p } });
const E = (s, t, ty = 'HAS_CHILD', p = {}) => ({ id: `${s}->${t}`, edgeType: ty, sourceId: s, targetId: t, properties: p });
function eng(conf = () => 0.9) {
  return new TraversalEngine(
    { computeNodeConfidence: async (n) => ({ confidence: conf(n), breakdown: [] }) },
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    makeEvaluationTemporalContext({ evaluationAsOf: '2026-09-10T12:00:00.000Z', temporalPolicyVersion: 'legacy-v0' }),
    {}, [], new Map());
}
const PT = { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [] };
const st = (r, ids) => ids.map((i) => `${i}=${r.resolutionState.get(i)?.status ?? 'ABSENT'}`).join(' ');

(async () => {
  // ── 1. anemia step-3-3 (exported live graph a1774566) ──
  const j = require(__dirname + '/graphs/a1774566-42ce-43cc-b83c-1a5749b240e1.json').data.pathwayGraph;
  const nodes = j.nodes.map((n) => N(n.id, n.type, P(n.properties)));
  const edges = j.edges.map((e) => E(e.from, e.to, e.type, P(e.properties)));
  const hb = { ...PT, labResults: [{ code: '718-7', system: 'LOINC', value: 9.4, date: '2026-09-01' }], patientAttributes: { trimester: 2 } };
  const s3 = edges.filter((e) => e.sourceId === 'stage-3').map((e) => `${e.edgeType}:${e.targetId}`);
  let r = await eng().traverse(ctx(nodes, edges), hb, new Map());
  console.log('1a anemia export order stage-3 edges:', s3.join(','));
  console.log('1a', st(r, ['gate-severe-anemia', 'step-3-3', 'proc-1']), 'step-3-3.parent=', r.resolutionState.get('step-3-3')?.parentNodeId);
  // gate edge first under stage-3
  const e2 = [...edges.filter((e) => !(e.sourceId === 'stage-3' && e.edgeType === 'HAS_GATE')), ...[]];
  const gateEdge = edges.find((e) => e.sourceId === 'stage-3' && e.edgeType === 'HAS_GATE');
  const idx = e2.findIndex((e) => e.sourceId === 'stage-3'); e2.splice(idx, 0, gateEdge);
  r = await eng().traverse(ctx(nodes, e2), hb, new Map());
  console.log('1b gate-first under stage-3:', st(r, ['gate-severe-anemia', 'step-3-3', 'proc-1']));
  // step-2-2 (t1t3/t2 gates both closed w/o trimester match? trimester 2, Hb 9.4 -> t2 satisfied)
  console.log('1c', st(r, ['gate-anemia-t1t3', 'gate-anemia-t2', 'step-2-2', 'dp-1', 'step-3-1', 'gate-iron-deficient', 'step-4-3', 'gate-oral-iron-response']));
  const hbNoT = { ...hb, labResults: [{ code: '718-7', system: 'LOINC', value: 12.5, date: '2026-09-01' }] };
  r = await eng().traverse(ctx(nodes, edges), hbNoT, new Map());
  console.log('1d Hb 12.5 (both anemia gates closed):', st(r, ['gate-anemia-t1t3', 'gate-anemia-t2', 'step-2-2', 'lab-2', 'dp-1', 'step-2-3', 'step-3-1', 'med-1']));

  // ── 2. order dependence via eager prior_node_result ──
  const g2n = [N('root', 'Pathway'),
    N('gate-dep', 'Gate', { gate_type: 'prior_node_result', default_behavior: 'skip', depends_on: [{ node_id: 'step-hidden', status: 'INCLUDED' }] }),
    N('gate-closed', 'Gate', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10' } }),
    N('step-hidden', 'Step'), N('med-dep', 'Medication')];
  const g2e = (depFirst) => [
    ...(depFirst ? [E('root', 'gate-dep', 'HAS_GATE'), E('root', 'gate-closed', 'HAS_GATE')] : [E('root', 'gate-closed', 'HAS_GATE'), E('root', 'gate-dep', 'HAS_GATE')]),
    E('gate-closed', 'step-hidden', 'BRANCHES_TO'), E('gate-dep', 'med-dep', 'BRANCHES_TO')];
  for (const f of [true, false]) {
    r = await eng().traverse(ctx(g2n, g2e(f)), PT, new Map());
    console.log(`2 depFirst=${f}:`, st(r, ['gate-dep', 'med-dep', 'step-hidden']));
  }

  // ── 3. INCLUDE override on one_of DecisionPoint / multi-branch gate ──
  const g3 = ctx([N('root', 'Pathway'), N('dp', 'DecisionPoint', { branch_mode: 'one_of' }), N('a', 'Step'), N('b', 'Step'), N('ma', 'Medication'), N('mb', 'Medication')],
    [E('root', 'dp'), E('dp', 'a', 'BRANCHES_TO'), E('dp', 'b', 'BRANCHES_TO'), E('a', 'ma'), E('b', 'mb')]);
  const ov = (action) => new Map([['dp', { action, reason: 'x', originalStatus: 'PENDING_QUESTION', originalConfidence: 0 }]]);
  r = await eng().traverse(g3, PT, new Map());
  console.log('3a no override:', st(r, ['dp', 'a', 'b', 'ma', 'mb']), 'pq=', r.pendingQuestions.length);
  r = await eng().traverse(g3, PT, new Map(), ov('INCLUDE'));
  console.log('3b INCLUDE dp:', st(r, ['dp', 'a', 'b', 'ma', 'mb']), 'pq=', r.pendingQuestions.length, 'flags=', r.redFlags.map((f) => f.type));
  r = await eng().traverse(g3, PT, new Map(), ov('EXCLUDE'));
  console.log('3c EXCLUDE dp:', st(r, ['dp', 'a', 'b', 'ma', 'mb']));
  const g3g = ctx([N('root', 'Pathway'), N('g', 'Gate', { gate_type: 'question', answer_type: 'SELECT', options: ['A', 'B'], default_behavior: 'skip' }), N('a', 'Step'), N('b', 'Step'), N('ma', 'Medication'), N('mb', 'Medication')],
    [E('root', 'g'), E('g', 'a', 'BRANCHES_TO', { when: { equals: 'A' } }), E('g', 'b', 'BRANCHES_TO', { when: { equals: 'B' } }), E('a', 'ma'), E('b', 'mb')]);
  const ovg = (action) => new Map([['g', { action, reason: 'x', originalStatus: 'PENDING_QUESTION', originalConfidence: 0 }]]);
  r = await eng().traverse(g3g, PT, new Map(), ovg('INCLUDE'));
  console.log('3d INCLUDE multi-branch gate:', st(r, ['g', 'a', 'b', 'ma', 'mb']), 'pq=', r.pendingQuestions.length);
  r = await eng().traverse(g3g, PT, new Map(), ovg('EXCLUDE'));
  console.log('3e EXCLUDE multi-branch gate:', st(r, ['g', 'a', 'b', 'ma', 'mb']));

  // ── 4. first-writer-wins diamond: med under open step AND under closed gate ──
  const g4 = (openFirst) => ctx([N('root', 'Pathway'), N('open', 'Step'), N('gc', 'Gate', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { field: 'conditions', operator: 'includes_code', value: 'X', system: 'ICD-10' } }), N('m', 'Medication')],
    [...(openFirst ? [E('root', 'open'), E('root', 'gc')] : [E('root', 'gc'), E('root', 'open')]), E('open', 'm'), E('gc', 'm', 'BRANCHES_TO')]);
  for (const f of [true, false]) { r = await eng().traverse(g4(f), PT, new Map()); console.log(`4 openFirst=${f}:`, st(r, ['gc', 'm'])); }
  // depth variant: gate one level deeper than the open path
  const g4b = ctx([N('root', 'Pathway'), N('s', 'Stage'), N('open', 'Step'), N('gs', 'Step'), N('gc', 'Gate', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { field: 'conditions', operator: 'includes_code', value: 'X', system: 'ICD-10' } }), N('m', 'Medication')],
    [E('root', 'gs'), E('root', 'open'), E('gs', 'gc', 'HAS_GATE'), E('gc', 'm', 'BRANCHES_TO'), E('open', 'm')]);
  r = await eng().traverse(g4b, PT, new Map()); console.log('4b gate deeper, listed first:', st(r, ['gc', 'm']));

  // ── 5. default_behavior traverse on a multi-branch gate with no decision ──
  const g5 = ctx([N('root', 'Pathway'), N('g', 'Gate', { gate_type: 'patient_attribute', default_behavior: 'traverse', condition: { field: 'conditions', operator: 'includes_code', value: 'X', system: 'ICD-10' } }), N('a', 'Step'), N('b', 'Step')],
    [E('root', 'g'), E('g', 'a', 'BRANCHES_TO', { when: { equals: 'A' } }), E('g', 'b', 'BRANCHES_TO', { when: { equals: 'B' } })]);
  r = await eng().traverse(g5, PT, new Map());
  console.log('5 unsatisfied+traverse multi-branch:', st(r, ['g', 'a', 'b']), 'flags=', r.redFlags.map((f) => f.type));

  // ── 6. eager dependency on a question gate: duplicate pending question ──
  const g6 = ctx([N('root', 'Pathway'), N('s', 'Step'),
    N('gd', 'Gate', { gate_type: 'prior_node_result', default_behavior: 'skip', depends_on: [{ node_id: 'q', status: 'INCLUDED' }] }),
    N('q', 'Gate', { gate_type: 'question', answer_type: 'BOOLEAN', default_behavior: 'skip', prompt: 'Q?' }), N('m', 'Medication'), N('m2', 'Medication')],
    [E('root', 'gd', 'HAS_GATE'), E('root', 's'), E('s', 'q', 'HAS_GATE'), E('q', 'm', 'BRANCHES_TO'), E('gd', 'm2', 'BRANCHES_TO')]);
  r = await eng().traverse(g6, PT, new Map());
  console.log('6 eager question dep:', st(r, ['gd', 'q', 'm', 'm2']), 'pendingQ gateIds=', r.pendingQuestions.map((q) => q.gateId));

  // ── 7. provisional left in final state when dependency is never reached ──
  const g7 = ctx([N('root', 'Pathway'), N('gd', 'Gate', { gate_type: 'prior_node_result', default_behavior: 'skip', depends_on: [{ node_id: 'orphan', status: 'INCLUDED' }] }), N('orphan', 'Step'), N('m', 'Medication')],
    [E('root', 'gd', 'HAS_GATE'), E('gd', 'm', 'BRANCHES_TO'), E('orphan', 'm')]);
  r = await eng().traverse(g7, PT, new Map());
  console.log('7 orphan dep:', st(r, ['gd', 'orphan', 'm']));

  // ── 8. eager DP pending, later swept: stale question & stuck PENDING targets ──
  const g8 = ctx([N('root', 'Pathway'),
    N('gd', 'Gate', { gate_type: 'prior_node_result', default_behavior: 'skip', depends_on: [{ node_id: 'dp', status: 'INCLUDED' }] }),
    N('gc', 'Gate', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { field: 'conditions', operator: 'includes_code', value: 'X', system: 'ICD-10' } }),
    N('dp', 'DecisionPoint', { branch_mode: 'one_of' }), N('a', 'Step'), N('b', 'Step'), N('ma', 'Medication')],
    [E('root', 'gd', 'HAS_GATE'), E('root', 'gc', 'HAS_GATE'), E('gc', 'dp', 'BRANCHES_TO'), E('dp', 'a', 'BRANCHES_TO'), E('dp', 'b', 'BRANCHES_TO'), E('a', 'ma')]);
  r = await eng().traverse(g8, PT, new Map());
  console.log('8 eager DP then swept:', st(r, ['gd', 'gc', 'dp', 'a', 'b', 'ma']), 'pendingQ=', r.pendingQuestions.map((q) => q.gateId));

  // ── 9. dependency is PENDING → depending gate takes default (skip) ──
  const g9 = ctx([N('root', 'Pathway'), N('q', 'Gate', { gate_type: 'question', answer_type: 'BOOLEAN', default_behavior: 'skip', prompt: 'Q?' }),
    N('gd', 'Gate', { gate_type: 'prior_node_result', default_behavior: 'skip', depends_on: [{ node_id: 'q', status: 'INCLUDED' }] }), N('m', 'Medication')],
    [E('root', 'q', 'HAS_GATE'), E('root', 'gd', 'HAS_GATE'), E('gd', 'm', 'BRANCHES_TO')]);
  r = await eng().traverse(g9, PT, new Map());
  console.log('9 dep pending:', st(r, ['q', 'gd', 'm']), r.resolutionState.get('gd')?.excludeReason);

  // ── 10. cycle ──
  const g10 = ctx([N('root', 'Pathway'),
    N('ga', 'Gate', { gate_type: 'prior_node_result', default_behavior: 'traverse', depends_on: [{ node_id: 'gb', status: 'INCLUDED' }] }),
    N('gb', 'Gate', { gate_type: 'prior_node_result', default_behavior: 'traverse', depends_on: [{ node_id: 'ga', status: 'INCLUDED' }] }), N('m', 'Medication')],
    [E('root', 'ga', 'HAS_GATE'), E('root', 'gb', 'HAS_GATE'), E('ga', 'm')]);
  r = await eng().traverse(g10, PT, new Map());
  console.log('10 cycle (traverse):', st(r, ['ga', 'gb', 'm']), r.resolutionState.get('ga')?.excludeReason, '|', r.resolutionState.get('gb')?.excludeReason);

  // ── 11. held INCLUDE override on an unreachable node ──
  const g11 = ctx([N('root', 'Pathway'), N('gc', 'Gate', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { field: 'conditions', operator: 'includes_code', value: 'X', system: 'ICD-10' } }), N('s', 'Step'), N('m', 'Medication')],
    [E('root', 'gc'), E('gc', 's'), E('s', 'm')]);
  r = await eng().traverse(g11, PT, new Map(), new Map([['m', { action: 'INCLUDE', reason: 'x', originalStatus: 'GATED_OUT', originalConfidence: 0 }]]));
  console.log('11 INCLUDE med under closed gate:', st(r, ['gc', 's', 'm']), 'm.parent=', r.resolutionState.get('m')?.parentNodeId, 'depth', r.resolutionState.get('m')?.depth);

  // ── 12. question gate: explicit null booleanValue + selectedOption on single-target gate ──
  const g12 = ctx([N('root', 'Pathway'), N('q', 'Gate', { gate_type: 'question', answer_type: 'SELECT', options: ['A'], default_behavior: 'skip' }), N('m', 'Medication')],
    [E('root', 'q'), E('q', 'm', 'BRANCHES_TO')]);
  r = await eng().traverse(g12, PT, new Map([['q', { booleanValue: null, numericValue: null, selectedOption: 'A' }]]));
  console.log('12 null-padded select answer:', st(r, ['q', 'm']), r.resolutionState.get('q')?.excludeReason);
  r = await eng().traverse(g12, PT, new Map([['q', { selectedOption: 'A' }]]));
  console.log('12b clean select answer:', st(r, ['q', 'm']));
})().catch((e) => { console.error(e); process.exit(1); });
