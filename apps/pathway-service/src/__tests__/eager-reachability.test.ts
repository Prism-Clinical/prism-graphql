/**
 * Eagerly evaluating a dependency must not smuggle it into the plan.
 *
 * A `prior_node_result` gate forces its dependency to resolve out of BFS
 * order. Import validation only checks that the referenced id EXISTS, so the
 * dependency can sit inside a different, gated branch.
 *
 * Eager evaluation writes it into the same resolution state the walk uses for
 * reachability. So when the gate that actually guards it closes a moment
 * later, `markSubtree` skips it — already present — and a treatment nobody
 * could reach stays INCLUDED. Which way it goes depends only on the order
 * traversal happened to visit the two gates.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import {
  NodeStatus, GateType, DefaultBehavior,
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

/** No conditions, so the guarding gate is NOT satisfied and must close. */
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

/**
 * `gate-dep` depends on `step-hidden`, which lives under `gate-closed` — a
 * different branch, and one that shuts. `gate-dep` is reached FIRST, so it
 * evaluates the dependency eagerly before its real guard has been disposed.
 */
function graph() {
  return makeGraphContext(
    [
      node('root', 'Pathway'),
      node('gate-dep', 'Gate', {
        title: 'Depends on the hidden step',
        gate_type: GateType.PRIOR_NODE_RESULT,
        default_behavior: DefaultBehavior.SKIP,
        depends_on: [{ node_id: 'step-hidden', status: NodeStatus.INCLUDED }],
      }),
      node('gate-closed', 'Gate', {
        title: 'Anaemic?',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10' },
      }),
      node('step-hidden', 'Step', { title: 'Hidden step' }),
      node('med-hidden', 'Medication', { name: 'Ferrous sulfate', role: 'first_line' }),
    ],
    [
      edge('root', 'gate-dep', 'HAS_GATE'),
      edge('root', 'gate-closed', 'HAS_GATE'),
      edge('gate-closed', 'step-hidden', 'BRANCHES_TO'),
      edge('step-hidden', 'med-hidden', 'USES_MEDICATION'),
    ],
  );
}

beforeEach(() => jest.clearAllMocks());

describe('a dependency inside a gated branch', () => {
  it('is closed with its branch, not left included by evaluation order', async () => {
    const r = await engine().traverse(graph(), PATIENT, new Map());

    // gate-closed is unsatisfied, so everything it guards is out.
    expect(r.resolutionState.get('gate-closed')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.resolutionState.get('step-hidden')!.status).not.toBe(NodeStatus.INCLUDED);
  });

  /**
   * The clinical form of the same bug: a treatment under a branch that shut,
   * still in the plan because a gate elsewhere happened to name its parent.
   */
  it('does not leave a medication from the closed branch in the plan', async () => {
    const r = await engine().traverse(graph(), PATIENT, new Map());
    const med = r.resolutionState.get('med-hidden');
    expect(med?.status).not.toBe(NodeStatus.INCLUDED);
  });

  // The dependency still has to be READABLE — the gate that named it must be
  // able to decide, which is the whole reason for evaluating out of order.
  it('still lets the depending gate reach a verdict', async () => {
    const r = await engine().traverse(graph(), PATIENT, new Map());
    expect(r.resolutionState.get('gate-dep')).toBeDefined();
    expect(r.resolutionState.get('step-hidden')).toBeDefined();
  });
});
