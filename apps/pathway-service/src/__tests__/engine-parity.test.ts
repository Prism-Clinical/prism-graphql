/**
 * The two engines are one semantics with two implementations. This suite runs
 * the SAME scenario through both and compares the resolution state they
 * produce.
 *
 * Written BEFORE the unification, so it pins today's behaviour — divergences
 * included. Cases that currently diverge assert the DIVERGENCE, so the refactor
 * closing them is visible as those assertions flipping rather than as a test
 * quietly starting to pass.
 *
 * Scenario shape throughout: root -> gate-1 -> step-1 -> med-1. A gate WITH a
 * subtree is the minimum that exposes the defect family; a bare gate hides
 * every one of them, because every defect is about what happens BELOW the gate.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { RetraversalEngine } from '../services/resolution/retraversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import {
  NodeStatus,
  NodeResult,
  DefaultBehavior,
  GateType,
  createEmptyDependencyMap,
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

const THRESHOLDS = { autoResolveThreshold: 0.85, suggestThreshold: 0.6 };

function clock() {
  return makeEvaluationTemporalContext({
    evaluationAsOf: AS_OF,
    temporalPolicyVersion: 'legacy-v0',
  });
}

function traversalEngine(): TraversalEngine {
  return new TraversalEngine(
    mockConfidenceEngine as never,
    THRESHOLDS,
    clock(),
    {},
    [],
    new Map(),
  );
}

function retraversalEngine(): RetraversalEngine {
  return new RetraversalEngine(
    mockConfidenceEngine as never,
    THRESHOLDS,
    clock(),
    {},
    [],
    new Map(),
  );
}

function graphFor(gateProps: Record<string, unknown>) {
  const nodes = [
    node('root', 'Pathway'),
    node('gate-1', 'Gate', gateProps),
    node('step-1', 'Step', { title: 'Treat' }),
    node('med-1', 'Medication', { name: 'Ferrous sulfate', role: 'first_line' }),
  ];
  const edges = [
    edge('root', 'gate-1', 'HAS_GATE'),
    edge('gate-1', 'step-1', 'BRANCHES_TO'),
    edge('step-1', 'med-1', 'USES_MEDICATION'),
  ];
  return makeGraphContext(nodes, edges);
}

/** Statuses only — the comparison that matters, and stable across refactors. */
function statuses(state: Map<string, NodeResult>): Record<string, string> {
  return Object.fromEntries([...state].map(([id, r]) => [id, r.status]));
}

const HAS_ANEMIA = {
  patientId: 'pt-1',
  conditionCodes: [{ code: 'D50.9', system: 'ICD-10' }],
  medications: [],
  allergies: [],
  labResults: [],
} as unknown as PatientContext;

const NO_CONDITIONS = {
  patientId: 'pt-1',
  conditionCodes: [],
  medications: [],
  allergies: [],
  labResults: [],
} as unknown as PatientContext;

/** A gate that fires only when the patient carries D50.9. */
const CODE_GATE = {
  title: 'Anemic?',
  gate_type: GateType.PATIENT_ATTRIBUTE,
  default_behavior: DefaultBehavior.SKIP,
  condition: { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
    confidence: 0.85,
    breakdown: [],
    resolutionType: 'AUTO_RESOLVED',
  });
});

describe('engine parity: the same scenario through both engines', () => {
  it('agrees when the gate is satisfied on both paths', async () => {
    const graph = graphFor(CODE_GATE);

    const full = await traversalEngine().traverse(graph, HAS_ANEMIA, new Map());
    expect(statuses(full.resolutionState)).toMatchObject({
      'gate-1': NodeStatus.INCLUDED,
      'step-1': NodeStatus.INCLUDED,
      'med-1': NodeStatus.INCLUDED,
    });

    // Re-running the incremental path over an already-correct state must not
    // move anything. This is the control: if THIS diverges, the harness is
    // wrong rather than the engines.
    const state = full.resolutionState;
    await retraversalEngine().retraverse(
      new Set(['gate-1']),
      state,
      full.dependencyMap,
      graph,
      HAS_ANEMIA,
      new Map(),
    );
    expect(statuses(state)).toMatchObject({
      'gate-1': NodeStatus.INCLUDED,
      'step-1': NodeStatus.INCLUDED,
      'med-1': NodeStatus.INCLUDED,
    });
  });

  // ─── DEFECT 1 ────────────────────────────────────────────────────────
  //
  // A session starts without the condition (gate shut, subtree gated out),
  // then the condition arrives. Full traversal against the new facts opens
  // the whole branch. Retraversal opens the gate ROW and stops: the cascade
  // reads dependencyMap.influences, which never recorded gate -> subtree.
  //
  // These assertions INVERT in Task 3.
  it('DIVERGES today: a gate flipping shut->open does not re-resolve its subtree', async () => {
    const graph = graphFor(CODE_GATE);

    // Reference: what a full traversal against the FINAL facts produces.
    const reference = await traversalEngine().traverse(graph, HAS_ANEMIA, new Map());

    // Incremental: start shut, then supply the condition and retraverse.
    const initial = await traversalEngine().traverse(graph, NO_CONDITIONS, new Map());
    expect(statuses(initial.resolutionState)).toMatchObject({
      'gate-1': NodeStatus.GATED_OUT,
      'step-1': NodeStatus.GATED_OUT,
    });

    const state = initial.resolutionState;
    await retraversalEngine().retraverse(
      new Set(['gate-1']),
      state,
      initial.dependencyMap,
      graph,
      HAS_ANEMIA,
      new Map(),
    );

    // The gate itself flips.
    expect(state.get('gate-1')!.status).toBe(NodeStatus.INCLUDED);

    // ...but the subtree does not, and the reference says it should have.
    expect(reference.resolutionState.get('step-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(state.get('step-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(state.get('med-1')!.status).toBe(NodeStatus.GATED_OUT);

    // And the reason still names a gate decision no longer in force.
    expect(state.get('step-1')!.excludeReason).toContain('Gated out by');

    // The one relationship the cascade needed is the one never recorded.
    expect(initial.dependencyMap.influences.size).toBe(0);
  });

  // ─── DEFECT 3 ────────────────────────────────────────────────────────
  //
  // Traversal consults default_behavior; retraversal sets
  // `satisfied ? INCLUDED : GATED_OUT` unconditionally. The same gate on the
  // same facts means different things depending on WHEN it was evaluated.
  //
  // These assertions INVERT in Task 3.
  it('DIVERGES today: retraversal ignores default_behavior TRAVERSE', async () => {
    const graph = graphFor({ ...CODE_GATE, default_behavior: DefaultBehavior.TRAVERSE });

    // Full traversal: unsatisfied, but default_behavior says traverse anyway.
    const full = await traversalEngine().traverse(graph, NO_CONDITIONS, new Map());
    expect(full.resolutionState.get('gate-1')!.status).toBe(NodeStatus.INCLUDED);

    // Retraversal over the same unsatisfied gate gates it out instead.
    const state = full.resolutionState;
    await retraversalEngine().retraverse(
      new Set(['gate-1']),
      state,
      full.dependencyMap,
      graph,
      NO_CONDITIONS,
      new Map(),
    );
    expect(state.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
  });
});
