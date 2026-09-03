/**
 * An incremental resolve returns the RECONCILED findings, not a set to append.
 *
 * The callers used `session.redFlags = [...old, ...new]`. A flag whose
 * condition was still true re-emitted an identical copy every pass and each
 * was kept; a flag whose condition had resolved was never removed. Since
 * care-plan generation blocks on every unacknowledged red flag, a flag true
 * for one instant blocked that session permanently.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import {
  NodeStatus, GateType, DefaultBehavior, AnswerType, RedFlag,
} from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-09-03T12:00:00.000Z';

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.9, breakdown: [], resolutionType: 'AUTO_RESOLVED',
  }),
};

const PATIENT = {
  patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [],
} as unknown as PatientContext;

function engine() {
  return new TraversalEngine(
    mockConfidenceEngine as never,
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'legacy-v0' }),
    {}, [], new Map(),
  );
}

/** An unanswered question gate, so a pending question exists to reconcile. */
function graph() {
  return makeGraphContext(
    [
      node('root', 'Pathway'),
      node('gate-1', 'Gate', {
        title: 'Anaemic?',
        gate_type: GateType.QUESTION,
        default_behavior: DefaultBehavior.SKIP,
        answer_type: AnswerType.BOOLEAN,
      }),
      node('step-1', 'Step', { title: 'Treat' }),
    ],
    [edge('root', 'gate-1', 'HAS_GATE'), edge('gate-1', 'step-1', 'BRANCHES_TO')],
  );
}

const staleFlag = (nodeId: string): RedFlag => ({
  nodeId, nodeTitle: nodeId, type: 'all_branches_excluded',
  description: 'stale, from an earlier pass',
});

beforeEach(() => jest.clearAllMocks());

describe('findings returned by an incremental resolve', () => {
  it('drops a stale flag about a node it re-disposed', async () => {
    const g = graph();
    const first = await engine().traverse(g, PATIENT, new Map());

    const r = await engine().resolveIncrementally(
      new Set(['gate-1']), first.resolutionState, first.dependencyMap, g, PATIENT, new Map(),
      { redFlags: [staleFlag('gate-1')], pendingQuestions: [] },
    );

    // gate-1 was re-disposed and raised no such flag, so it is settled.
    expect(r.redFlags.find(f => f.nodeId === 'gate-1')).toBeUndefined();
  });

  it('keeps a flag about a node outside the region it re-disposed', async () => {
    const g = graph();
    const first = await engine().traverse(g, PATIENT, new Map());

    const r = await engine().resolveIncrementally(
      new Set(['step-1']), first.resolutionState, first.dependencyMap, g, PATIENT, new Map(),
      { redFlags: [staleFlag('gate-1')], pendingQuestions: [] },
    );

    // step-1's region does not include gate-1, so nothing was learned about it.
    expect(r.redFlags.find(f => f.nodeId === 'gate-1')).toBeDefined();
  });

  it('does not duplicate a question it re-derives', async () => {
    const g = graph();
    const first = await engine().traverse(g, PATIENT, new Map());
    expect(first.pendingQuestions.map(q => q.gateId)).toContain('gate-1');

    const r = await engine().resolveIncrementally(
      new Set(['gate-1']), first.resolutionState, first.dependencyMap, g, PATIENT, new Map(),
      { pendingQuestions: first.pendingQuestions, redFlags: [] },
    );

    expect(r.pendingQuestions.filter(q => q.gateId === 'gate-1')).toHaveLength(1);
  });

  it('drops the question of a gate that has now been answered', async () => {
    const g = graph();
    const first = await engine().traverse(g, PATIENT, new Map());

    const answers = new Map([['gate-1', { booleanValue: true } as never]]);
    const r = await engine().resolveIncrementally(
      new Set(['gate-1']), first.resolutionState, first.dependencyMap, g, PATIENT, answers,
      { pendingQuestions: first.pendingQuestions, redFlags: [], alsoDropGateIds: ['gate-1'] },
    );

    expect(r.pendingQuestions.map(q => q.gateId)).not.toContain('gate-1');
    expect(first.resolutionState.get('step-1')!.status).toBe(NodeStatus.INCLUDED);
  });

  // Backwards compatibility: a fresh session passes nothing and gets the
  // derived set straight back.
  it('returns the derived set untouched when nothing is stored', async () => {
    const g = graph();
    const first = await engine().traverse(g, PATIENT, new Map());
    const r = await engine().resolveIncrementally(
      new Set(['gate-1']), first.resolutionState, first.dependencyMap, g, PATIENT, new Map(),
    );
    expect(r.pendingQuestions.map(q => q.gateId)).toContain('gate-1');
  });
});
