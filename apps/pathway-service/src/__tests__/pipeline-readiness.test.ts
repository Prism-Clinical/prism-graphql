import { applyDisposition, medicationCandidates } from '../services/resolution/pipeline/disposition';
import { readinessOf } from '../services/resolution/pipeline/readiness';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { NodeResult, NodeStatus, OverrideAction, ResolutionState } from '../services/resolution/types';
import type { GraphEdge, GraphNode } from '../services/confidence/types';
import type { ScopedFinding } from '../services/resolution/pipeline/types';
import { REFERENCE_PATIENT, makeGraphContext } from './fixtures/reference-patient-context';

const n = (nodeId: string, nodeType: string, status: NodeStatus, extra: Partial<NodeResult> = {}): NodeResult =>
  ({ nodeId, nodeType, title: nodeId, status, confidence: 0.9, confidenceBreakdown: [], depth: 1, properties: { name: nodeId }, ...extra });
const state = (...nodes: NodeResult[]): ResolutionState => new Map(nodes.map((x) => [x.nodeId, x]));
const base = { pendingQuestions: [], redFlags: [], unavailable: [], scope: 'ROOT' as const, isDegraded: false };
const allergy: ScopedFinding = {
  recommendationId: 'med', drugName: 'med', action: 'SUPPRESS', severity: 'SEVERE', category: 'ALLERGY',
  mechanism: null, clinicalAdvice: 'x', source: { kind: 'PATIENT_ALLERGY', snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin' }, scope: 'PATIENT',
};

describe('applyDisposition (C2)', () => {
  it('keeps eligibility and withholds by safety', () => {
    const out = applyDisposition(state(n('med', 'Medication', NodeStatus.INCLUDED)), [allergy]).get('med')!;
    expect(out.eligibility).toEqual({ status: NodeStatus.INCLUDED, reason: undefined, decidedBy: 'traversal' });
    expect(out.disposition).toMatchObject({ status: NodeStatus.EXCLUDED, withheldBy: 'safety' });
    expect(out.status).toBe(NodeStatus.EXCLUDED);
    expect(out.excludeReason).toContain('ALLERGY');
  });

  it('leaves non-included nodes and unrelated nodes unchanged; overrides are decidedBy override', () => {
    const s = applyDisposition(state(
      n('med', 'Medication', NodeStatus.EXCLUDED, { excludeReason: 'low' }),
      n('lab', 'LabTest', NodeStatus.INCLUDED, { providerOverride: { action: OverrideAction.INCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: 0.1 } }),
    ), [allergy]);
    expect(s.get('med')!.disposition).toEqual({ status: NodeStatus.EXCLUDED });
    expect(s.get('med')!.excludeReason).toBe('low');
    expect(s.get('lab')!.eligibility!.decidedBy).toBe('override');
  });

  it('medicationCandidates lists included medications by the DDI name', () => {
    expect(medicationCandidates(state(n('m1', 'Medication', NodeStatus.INCLUDED), n('m2', 'Medication', NodeStatus.EXCLUDED), n('l', 'LabTest', NodeStatus.INCLUDED))))
      .toEqual([{ recommendationId: 'm1', drugName: 'm1', meta: { nodeType: 'Medication' } }]);
  });
});

describe('readinessOf (C3)', () => {
  const types = (r: ReturnType<typeof readinessOf>) => r.blockers.map((b) => `${b.scope}:${b.type}`).sort();

  it('ready when an action is included and nothing is open', () => {
    const r = readinessOf({ ...base, state: state(n('med', 'Medication', NodeStatus.INCLUDED)) });
    expect(r).toMatchObject({ ready: true, blockers: [], status: 'ACTIVE' });
  });

  it('completeness blockers: pending node, tentative question, red flag, timeout, unavailable safety data', () => {
    const r = readinessOf({
      ...base,
      state: state(n('med', 'Medication', NodeStatus.INCLUDED), n('q', 'Gate', NodeStatus.PENDING_QUESTION), n('llm', 'Gate', NodeStatus.INCLUDED), n('t', 'Step', NodeStatus.TIMEOUT)),
      pendingQuestions: [{ gateId: 'q', prompt: 'q', answerType: 'BOOLEAN' as never, affectedSubtreeSize: 0, estimatedImpact: 'low' },
        { gateId: 'llm', prompt: 'llm', answerType: 'SELECT' as never, affectedSubtreeSize: 0, estimatedImpact: 'low', tentative: true }],
      redFlags: [{ nodeId: 'dp', nodeTitle: 'dp', type: 'all_branches_excluded', description: 'x' }],
      unavailable: [{ drugName: 'Mysterydrug', source: 'PATIENT_MEDICATION' }],
    });
    expect(types(r)).toEqual([
      'COMPLETENESS:INCOMPLETE_RESOLUTION', 'COMPLETENESS:PENDING_GATE', 'COMPLETENESS:PENDING_GATE',
      'COMPLETENESS:SAFETY_DATA_UNAVAILABLE', 'COMPLETENESS:UNRESOLVED_RED_FLAG',
    ]);
    expect(r.status).toBe('DEGRADED');
  });

  it('EMPTY_PLAN is an OUTPUT blocker at ROOT only, judged on disposition', () => {
    const withheld = applyDisposition(state(n('med', 'Medication', NodeStatus.INCLUDED)), [allergy]);
    expect(types(readinessOf({ ...base, state: withheld }))).toEqual(['OUTPUT:EMPTY_PLAN']);
    expect(types(readinessOf({ ...base, scope: 'CONTRIBUTION', state: withheld }))).toEqual([]);
  });

  it.each([NodeStatus.TIMEOUT, NodeStatus.CASCADE_LIMIT, NodeStatus.UNKNOWN])(
    'blocks on a %s node, naming it', (s) => {
      const r = readinessOf({ ...base, state: state(n('med', 'Medication', NodeStatus.INCLUDED), n('step-9', 'Step', s)) });
      expect(r.blockers).toContainEqual(expect.objectContaining({ scope: 'COMPLETENESS', type: 'INCOMPLETE_RESOLUTION', relatedNodeIds: ['step-9'] }));
    },
  );

  it.each([NodeStatus.EXCLUDED, NodeStatus.GATED_OUT])('does not block on a decided %s node', (s) => {
    const r = readinessOf({ ...base, state: state(n('med', 'Medication', NodeStatus.INCLUDED), n('step-9', 'Step', s)) });
    expect(r).toMatchObject({ ready: true, blockers: [] });
  });
});

describe('degraded traversal (spec §1 rule 5)', () => {
  it('a degraded evaluation is never ready, even with no TIMEOUT node', () => {
    const r = readinessOf({ ...base, isDegraded: true, state: state(n('med', 'Medication', NodeStatus.INCLUDED)) });
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual([expect.objectContaining({ scope: 'COMPLETENESS', type: 'INCOMPLETE_RESOLUTION' })]);
    expect(r.status).toBe('DEGRADED');
  });

  it('reachable: a timeout with only a held override left queued marks no node TIMEOUT', async () => {
    const gnode = (id: string, type: string): GraphNode => ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id } });
    const gedge = (s: string, t: string): GraphEdge => ({ id: `${s}->${t}`, edgeType: 'HAS_CHILD', sourceId: s, targetId: t, properties: {} });
    // The clock jumps past the 10 s budget while `step` is being disposed, so
    // the next dequeue — the held `med` — hits the timeout check.
    let late = false;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (late ? 1e12 : 1e9));
    try {
      const engine = new TraversalEngine(
        {
          computeNodeConfidence: async (x: GraphNode) => {
            if (x.nodeIdentifier === 'step') late = true;
            return { nodeIdentifier: x.nodeIdentifier, nodeType: x.nodeType, confidence: 0.9, breakdown: [], propagationInfluences: [] };
          },
        } as never,
        { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
        makeEvaluationTemporalContext({ evaluationAsOf: '2026-09-15T12:00:00.000Z', temporalPolicyVersion: 'legacy-v0' }),
        {},
        [],
        new Map(),
      );
      const t = await engine.traverse(
        makeGraphContext(
          [gnode('root', 'Pathway'), gnode('step', 'Step'), gnode('med', 'Medication'), gnode('code', 'CodeEntry')],
          [gedge('root', 'step'), gedge('step', 'med'), gedge('med', 'code')],
        ),
        REFERENCE_PATIENT,
        new Map(),
        new Map([['med', { action: OverrideAction.INCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: 0.1 }]]),
      );

      // The shape the reviewer described: degraded, yet nothing is TIMEOUT and the held subtree is unvisited.
      expect(t.isDegraded).toBe(true);
      expect([...t.resolutionState.values()].map((x) => x.status)).not.toContain(NodeStatus.TIMEOUT);
      expect(t.resolutionState.get('med')!.status).toBe(NodeStatus.INCLUDED);
      expect(t.resolutionState.has('code')).toBe(false);

      expect(readinessOf({ ...base, state: t.resolutionState, isDegraded: t.isDegraded }).ready).toBe(false);
    } finally {
      now.mockRestore();
    }
  });
});
