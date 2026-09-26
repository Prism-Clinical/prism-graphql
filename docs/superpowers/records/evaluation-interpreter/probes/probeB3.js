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
  const j = require(__dirname + '/graphs/a1774566-42ce-43cc-b83c-1a5749b240e1.json').data.pathwayGraph;
  const nodes = j.nodes.map((n) => N(n.id, n.type, P(n.properties)));
  const edges = j.edges.map((e) => E(e.from, e.to, e.type, P(e.properties)));
  const hb = { ...PT, labResults: [{ code: '718-7', system: 'LOINC', value: 9.4, date: '2026-09-01' }], patientAttributes: { trimester: 2 } };
  let r = await eng().traverse(ctx(nodes, edges), hb, new Map([['dp-1', { selectedOption: 'step-3-1' }]]));
  console.log('13 dp-1 chose step-3-1:', st(r, ['dp-1', 'step-2-3', 'lab-5', 'step-3-1', 'gate-iron-deficient', 'crit-1a']));
  r = await eng().traverse(ctx(nodes, edges), hb, new Map([['dp-1', { selectedOption: 'step-2-3' }]]));
  console.log('13b dp-1 chose step-2-3:', st(r, ['dp-1', 'step-2-3', 'step-3-1', 'med-1', 'med-2']), r.resolutionState.get('step-3-1')?.parentNodeId);
  // 4c: diamond where the open path is shallower than the closing gate
  const gcP = { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { field: 'conditions', operator: 'includes_code', value: 'X', system: 'ICD-10' } };
  const g4c = ctx([N('root', 'Pathway'), N('s', 'Step'), N('gc', 'Gate', gcP), N('open', 'Step'), N('m', 'Medication')],
    [E('root', 's'), E('root', 'open'), E('s', 'gc', 'HAS_GATE'), E('gc', 'm', 'BRANCHES_TO'), E('open', 'm')]);
  r = await eng().traverse(g4c, PT, new Map()); console.log('4c open path shallower:', st(r, ['gc', 'm']));
  { const g4d = ctx([N('root','Pathway'),N('s','Step'),N('s2','Step'),N('gc','Gate',gcP),N('open','Step'),N('m','Medication')],[E('root','s'),E('root','open'),E('s','s2'),E('s2','gc','HAS_GATE'),E('gc','m','BRANCHES_TO'),E('open','m')]); r = await eng().traverse(g4d, PT, new Map()); console.log('4d open path strictly shallower:', st(r,['gc','m'])); }
  // 14: PENDING DP leaves non-branch children absent
  const g14 = ctx([N('root', 'Pathway'), N('dp', 'DecisionPoint'), N('a', 'Step'), N('b', 'Step'), N('c', 'Criterion'), N('g', 'Gate', gcP)],
    [E('root', 'dp'), E('dp', 'a', 'BRANCHES_TO'), E('dp', 'b', 'BRANCHES_TO'), E('dp', 'c', 'HAS_CRITERION'), E('dp', 'g', 'HAS_GATE')]);
  r = await eng().traverse(g14, PT, new Map()); console.log('14 pending DP non-branch kids:', st(r, ['dp', 'a', 'b', 'c', 'g']));
  // 15: any_of / unknown branch_mode
  for (const bm of ['any_of', 'ALL_OF', 'bogus']) {
    const g15 = ctx([N('root', 'Pathway'), N('dp', 'DecisionPoint', { branch_mode: bm }), N('a', 'Medication'), N('b', 'Medication')],
      [E('root', 'dp'), E('dp', 'a', 'BRANCHES_TO'), E('dp', 'b', 'BRANCHES_TO')]);
    r = await eng().traverse(g15, PT, new Map()); console.log(`15 branch_mode=${bm}:`, st(r, ['dp', 'a', 'b']), 'pq', r.pendingQuestions.length);
  }
  // 16: exactly-one-qualifies auto-resolve (confidence), no provider
  const g16 = ctx([N('root', 'Pathway'), N('dp', 'DecisionPoint'), N('a', 'Step'), N('b', 'Step')], [E('root', 'dp'), E('dp', 'a', 'BRANCHES_TO'), E('dp', 'b', 'BRANCHES_TO')]);
  r = await eng((n) => (n.nodeIdentifier === 'b' ? 0.3 : 0.9)).traverse(g16, PT, new Map());
  console.log('16 one qualifies:', st(r, ['dp', 'a', 'b']));
  // 17: pending question gate whose child was already INCLUDED via another parent
  const g17 = ctx([N('root', 'Pathway'), N('open', 'Step'), N('s', 'Step'), N('q', 'Gate', { gate_type: 'question', answer_type: 'BOOLEAN', default_behavior: 'skip', prompt: 'Q?' }), N('m', 'Medication')],
    [E('root', 'open'), E('root', 's'), E('open', 'm'), E('s', 'q', 'HAS_GATE'), E('q', 'm', 'BRANCHES_TO')]);
  r = await eng().traverse(g17, PT, new Map()); console.log('17 pending q, child reached elsewhere:', st(r, ['q', 'm']));
})().catch((e) => { console.error(e); process.exit(1); });
