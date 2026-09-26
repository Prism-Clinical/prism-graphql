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
  const g = ctx([N('root','Pathway'),N('dp','DecisionPoint',{branch_mode:'one_of'}),N('a','Step'),N('b','Step'),N('mb','Medication')],
    [E('root','dp'),E('dp','a','BRANCHES_TO'),E('dp','b','BRANCHES_TO'),E('b','mb')]);
  const ov = new Map([['b',{action:'INCLUDE',reason:'x',originalStatus:'EXCLUDED',originalConfidence:0.3}]]);
  const r = await eng((n)=> n.nodeIdentifier==='b'?0.3:0.9).traverse(g, PT, new Map(), ov);
  const b = r.resolutionState.get('b');
  console.log('18 INCLUDE override on unchosen DP arm:', st(r,['dp','a','b','mb']), 'b.providerOverride=', !!b.providerOverride, b.excludeReason);
  // timeout reason/parent uses current entry for all remaining
})().catch((e)=>{console.error(e);process.exit(1)});
