import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction, ProviderOverride } from '../services/resolution/types';
import type { GraphEdge, GraphNode } from '../services/confidence/types';
import { REFERENCE_PATIENT, makeGraphContext } from './fixtures/reference-patient-context';

const node = (id: string, type: string, props: Record<string, unknown> = {}): GraphNode =>
  ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } });
const edge = (s: string, t: string): GraphEdge => ({ id: `${s}->${t}`, edgeType: 'HAS_CHILD', sourceId: s, targetId: t, properties: {} });

function engine(): TraversalEngine {
  return new TraversalEngine(
    { computeNodeConfidence: async (n: GraphNode) => ({ nodeIdentifier: n.nodeIdentifier, nodeType: n.nodeType, confidence: (n.properties.score as number) ?? 0.9, breakdown: [], propagationInfluences: [] }) } as never,
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    makeEvaluationTemporalContext({ evaluationAsOf: '2026-09-15T12:00:00.000Z', temporalPolicyVersion: 'legacy-v0' }),
    {},
    [],
    new Map(),
  );
}
const include = (originalStatus: NodeStatus): ProviderOverride =>
  ({ action: OverrideAction.INCLUDE, reason: 'clinician', originalStatus, originalConfidence: 0.1 });

describe('traverse with overrides as input', () => {
  it('an INCLUDE override pins a below-threshold medication and its children still traverse', async () => {
    const g = makeGraphContext(
      [node('root', 'Pathway'), node('step', 'Step'), node('med', 'Medication', { score: 0.1 }), node('code', 'CodeEntry')],
      [edge('root', 'step'), edge('step', 'med'), edge('med', 'code')],
    );
    const r = await engine().traverse(g, REFERENCE_PATIENT, new Map(), new Map([['med', include(NodeStatus.EXCLUDED)]]));

    expect(r.resolutionState.get('med')).toMatchObject({ status: NodeStatus.INCLUDED, parentNodeId: 'step', depth: 2 });
    expect(r.resolutionState.get('med')!.providerOverride!.action).toBe(OverrideAction.INCLUDE);
    expect(r.resolutionState.get('code')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('a closing gate sweeps past a held Step without rewriting it', async () => {
    const g = makeGraphContext(
      [node('root', 'Pathway'),
       node('q', 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'q?' }),
       node('step', 'Step'), node('med', 'Medication')],
      [edge('root', 'q'), edge('q', 'step'), edge('step', 'med')],
    );
    const r = await engine().traverse(g, REFERENCE_PATIENT, new Map([['q', { booleanValue: false }]]), new Map([['step', include(NodeStatus.GATED_OUT)]]));

    expect(r.resolutionState.get('q')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.resolutionState.get('step')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('med')!.status).toBe(NodeStatus.GATED_OUT);
  });

  it('no overrides behaves exactly as before', async () => {
    const g = makeGraphContext([node('root', 'Pathway'), node('step', 'Step'), node('med', 'Medication', { score: 0.1 })], [edge('root', 'step'), edge('step', 'med')]);
    const withDefault = await engine().traverse(g, REFERENCE_PATIENT, new Map());
    const withEmpty = await engine().traverse(g, REFERENCE_PATIENT, new Map(), new Map());
    expect([...withEmpty.resolutionState]).toEqual([...withDefault.resolutionState]);
    expect(withDefault.resolutionState.get('med')!.status).toBe(NodeStatus.EXCLUDED);
  });
});
