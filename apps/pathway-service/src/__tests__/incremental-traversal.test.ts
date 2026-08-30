/**
 * `TraversalEngine.resolveIncrementally` — the entry point that replaces
 * RetraversalEngine.
 *
 * Every case here is a defect from
 * `docs/superpowers/plans/2026-08-12-gate-subtree-retraversal.md`, asserted
 * from the CORRECT side. The parity suite asserts the same scenarios from the
 * broken side against the old engine; when that engine goes, these remain.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import {
  NodeStatus,
  NodeResult,
  DefaultBehavior,
  GateType,
  OverrideAction,
} from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-08-30T12:00:00.000Z';

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.85,
    breakdown: [],
    resolutionType: 'AUTO_RESOLVED',
  }),
};

function engine(): TraversalEngine {
  return new TraversalEngine(
    mockConfidenceEngine as never,
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
      temporalPolicyVersion: 'legacy-v0',
    }),
    {},
    [],
    new Map(),
  );
}

const CODE_GATE = {
  title: 'Anemic?',
  gate_type: GateType.PATIENT_ATTRIBUTE,
  default_behavior: DefaultBehavior.SKIP,
  condition: { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10' },
};

function graphFor(gateProps: Record<string, unknown>) {
  return makeGraphContext(
    [
      node('root', 'Pathway'),
      node('gate-1', 'Gate', gateProps),
      node('step-1', 'Step', { title: 'Treat' }),
      node('med-1', 'Medication', { name: 'Ferrous sulfate', role: 'first_line' }),
    ],
    [
      edge('root', 'gate-1', 'HAS_GATE'),
      edge('gate-1', 'step-1', 'BRANCHES_TO'),
      edge('step-1', 'med-1', 'USES_MEDICATION'),
    ],
  );
}

function patient(conditionCodes: Array<{ code: string; system: string }>): PatientContext {
  return {
    patientId: 'pt-1',
    conditionCodes,
    medications: [],
    allergies: [],
    labResults: [],
  } as unknown as PatientContext;
}

const HAS = patient([{ code: 'D50.9', system: 'ICD-10' }]);
const HAS_NOT = patient([]);

beforeEach(() => {
  jest.clearAllMocks();
  mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
    confidence: 0.85,
    breakdown: [],
    resolutionType: 'AUTO_RESOLVED',
  });
});

describe('resolveIncrementally — defect 1: a flipped gate re-resolves its subtree', () => {
  it('opens the whole branch, not just the gate row', async () => {
    const graph = graphFor(CODE_GATE);
    const e = engine();
    const initial = await e.traverse(graph, HAS_NOT, new Map());
    expect(initial.resolutionState.get('step-1')!.status).toBe(NodeStatus.GATED_OUT);

    await e.resolveIncrementally(
      new Set(['gate-1']),
      initial.resolutionState,
      initial.dependencyMap,
      graph,
      HAS,
      new Map(),
    );

    expect(initial.resolutionState.get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(initial.resolutionState.get('step-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(initial.resolutionState.get('med-1')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('clears reasons that named a decision no longer in force', async () => {
    const graph = graphFor(CODE_GATE);
    const e = engine();
    const initial = await e.traverse(graph, HAS_NOT, new Map());
    expect(initial.resolutionState.get('step-1')!.excludeReason).toContain('Gated out by');

    await e.resolveIncrementally(
      new Set(['gate-1']),
      initial.resolutionState,
      initial.dependencyMap,
      graph,
      HAS,
      new Map(),
    );

    expect(initial.resolutionState.get('gate-1')!.excludeReason).toBeUndefined();
    expect(initial.resolutionState.get('step-1')!.excludeReason).toBeUndefined();
  });

  it('matches what a full traversal against the same facts produces', async () => {
    const graph = graphFor(CODE_GATE);
    const e = engine();
    const reference = await e.traverse(graph, HAS, new Map());
    const initial = await e.traverse(graph, HAS_NOT, new Map());

    await e.resolveIncrementally(
      new Set(['gate-1']),
      initial.resolutionState,
      initial.dependencyMap,
      graph,
      HAS,
      new Map(),
    );

    const statusesOf = (m: Map<string, NodeResult>) =>
      Object.fromEntries([...m].map(([id, r]) => [id, r.status]));
    expect(statusesOf(initial.resolutionState)).toEqual(statusesOf(reference.resolutionState));
  });
});

describe('resolveIncrementally — defect 2: nothing is deleted', () => {
  it('never shrinks the session — the destructive one', async () => {
    const graph = graphFor(CODE_GATE);
    const e = engine();
    const initial = await e.traverse(graph, HAS_NOT, new Map());
    const before = new Set(initial.resolutionState.keys());

    await e.resolveIncrementally(
      new Set(['gate-1']),
      initial.resolutionState,
      initial.dependencyMap,
      graph,
      HAS,
      new Map(),
    );

    const after = new Set(initial.resolutionState.keys());
    for (const id of before) {
      expect(after.has(id)).toBe(true);
    }
  });
});

describe('resolveIncrementally — defect 3: default_behavior is honoured', () => {
  it('includes an unsatisfied gate whose default_behavior is TRAVERSE', async () => {
    const graph = graphFor({ ...CODE_GATE, default_behavior: DefaultBehavior.TRAVERSE });
    const e = engine();
    const initial = await e.traverse(graph, HAS_NOT, new Map());
    expect(initial.resolutionState.get('gate-1')!.status).toBe(NodeStatus.INCLUDED);

    await e.resolveIncrementally(
      new Set(['gate-1']),
      initial.resolutionState,
      initial.dependencyMap,
      graph,
      HAS_NOT,
      new Map(),
    );

    // Same gate, same facts, same answer — regardless of WHEN it was evaluated.
    expect(initial.resolutionState.get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
  });
});

describe('resolveIncrementally — provider overrides', () => {
  it('respects an override on its own node but still re-resolves its descendants', async () => {
    const graph = graphFor(CODE_GATE);
    const e = engine();
    const initial = await e.traverse(graph, HAS_NOT, new Map());

    // A provider forced step-1 in while the branch was shut.
    const step = initial.resolutionState.get('step-1')!;
    step.status = NodeStatus.INCLUDED;
    step.providerOverride = {
      action: OverrideAction.INCLUDE,
      reason: 'clinical judgement',
      originalStatus: NodeStatus.GATED_OUT,
      originalConfidence: 0,
    };

    await e.resolveIncrementally(
      new Set(['gate-1']),
      initial.resolutionState,
      initial.dependencyMap,
      graph,
      HAS,
      new Map(),
    );

    // The human decision stands on the node it was made about...
    expect(initial.resolutionState.get('step-1')!.providerOverride).toBeDefined();
    expect(initial.resolutionState.get('step-1')!.status).toBe(NodeStatus.INCLUDED);
    // ...and does not freeze the branch beneath it. Today's `continue` skips
    // the node AND everything downstream; the override was never a decision
    // about med-1.
    expect(initial.resolutionState.get('med-1')!.status).toBe(NodeStatus.INCLUDED);
  });
});
