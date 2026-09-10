/**
 * What an incremental resolve must re-examine.
 *
 * The region was "the structural descendants of the seeds, each seed walked as
 * a ROOT". Three things follow from that, and all three put a treatment in a
 * plan that a full traversal would not:
 *
 *  - A seed deep under a CLOSED gate is disposed on its own account, with
 *    nothing above it consulted, so the subtree re-opens.
 *  - A `prior_node_result` gate that READS a changed node is not a structural
 *    descendant of it, so it keeps its previous decision.
 *  - An overridden node's children were queued ahead of the ancestor seeds, so
 *    they disposed before the gate governing them.
 *
 * Each case here compares the incremental result against a FULL traversal of
 * the same facts, which is the invariant the whole retraversal family violated.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import {
  NodeStatus, GateType, DefaultBehavior, OverrideAction,
} from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-09-10T12:00:00.000Z';

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

const NO_CONDITIONS = {
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

/** An unanswered question gate closes its subtree under SKIP. */
const SHUT_QUESTION = {
  title: 'Symptomatic?',
  gate_type: GateType.QUESTION,
  default_behavior: DefaultBehavior.SKIP,
  answer_type: 'BOOLEAN',
};

beforeEach(() => jest.clearAllMocks());

describe('a seed beneath a closed gate', () => {
  /** root -> gate-shut -> step-1 -> med-1 */
  function graph() {
    return makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-shut', 'Gate', SHUT_QUESTION),
        node('step-1', 'Step', { title: 'Treat' }),
        node('med-1', 'Medication', { name: 'Ferrous sulfate', role: 'first_line' }),
      ],
      [
        edge('root', 'gate-shut', 'HAS_GATE'),
        edge('gate-shut', 'step-1', 'BRANCHES_TO'),
        edge('step-1', 'med-1', 'USES_MEDICATION'),
      ],
    );
  }

  it('does not re-open the treatment when only the medication is seeded', async () => {
    const g = graph();
    const first = await engine().traverse(g, NO_CONDITIONS, new Map());
    expect(first.resolutionState.get('gate-shut')!.status).toBe(NodeStatus.PENDING_QUESTION);

    // A lab change moves the medication's score. Seeded alone, it used to be
    // walked as a root — nothing above it consulted — and came back INCLUDED
    // under a gate nobody had answered.
    await engine().resolveIncrementally(
      new Set(['med-1']), first.resolutionState, first.dependencyMap, g, NO_CONDITIONS, new Map(),
    );

    expect(first.resolutionState.get('med-1')!.status).not.toBe(NodeStatus.INCLUDED);
    expect(first.resolutionState.get('gate-shut')!.status).not.toBe(NodeStatus.INCLUDED);
  });
});

describe('a gate that READS a changed node', () => {
  /**
   * `gate-dep` depends on `step-a`. It is a SIBLING, not a descendant, so the
   * structural walk never reaches it — but its decision is made entirely from
   * step-a's status.
   */
  function graph() {
    return makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-a', 'Gate', SHUT_QUESTION),
        node('step-a', 'Step', { title: 'Prerequisite' }),
        node('gate-dep', 'Gate', {
          title: 'Prerequisite done?',
          gate_type: GateType.PRIOR_NODE_RESULT,
          default_behavior: DefaultBehavior.SKIP,
          depends_on: [{ node_id: 'step-a', status: NodeStatus.INCLUDED }],
        }),
        node('med-dep', 'Medication', { name: 'Folic acid', role: 'adjunct' }),
      ],
      [
        edge('root', 'gate-a', 'HAS_GATE'),
        edge('gate-a', 'step-a', 'BRANCHES_TO'),
        edge('root', 'gate-dep', 'HAS_GATE'),
        edge('gate-dep', 'med-dep', 'USES_MEDICATION'),
      ],
    );
  }

  it('re-decides when the node it depends on is re-resolved', async () => {
    const g = graph();
    // Answered: gate-a opens, so step-a is INCLUDED and gate-dep is satisfied.
    const answers = new Map([['gate-a', { booleanValue: true } as never]]);
    const first = await engine().traverse(g, NO_CONDITIONS, answers);
    expect(first.resolutionState.get('med-dep')!.status).toBe(NodeStatus.INCLUDED);

    // Now the answer is withdrawn. Seeding gate-a re-closes step-a — and
    // gate-dep, which READS step-a, must re-decide too. It is not a structural
    // descendant, so only `dependencyMap.influences` connects them.
    await engine().resolveIncrementally(
      new Set(['gate-a']), first.resolutionState, first.dependencyMap, g, NO_CONDITIONS, new Map(),
    );

    const reference = await engine().traverse(g, NO_CONDITIONS, new Map());
    expect(first.resolutionState.get('med-dep')!.status)
      .toBe(reference.resolutionState.get('med-dep')!.status);
    expect(first.resolutionState.get('med-dep')!.status).not.toBe(NodeStatus.INCLUDED);
  });
});

describe('an overridden node inside the region', () => {
  /** root -> gate-shut -> step-over (overridden) -> med-1 */
  function graph() {
    return makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-shut', 'Gate', SHUT_QUESTION),
        node('step-over', 'Step', { title: 'Manually included' }),
        node('med-1', 'Medication', { name: 'Ferrous sulfate', role: 'first_line' }),
      ],
      [
        edge('root', 'gate-shut', 'HAS_GATE'),
        edge('gate-shut', 'step-over', 'BRANCHES_TO'),
        edge('step-over', 'med-1', 'USES_MEDICATION'),
      ],
    );
  }

  it('does not let its descendants outrun the gate above it', async () => {
    const g = graph();
    const answers = new Map([['gate-shut', { booleanValue: true } as never]]);
    const first = await engine().traverse(g, NO_CONDITIONS, answers);

    const step = first.resolutionState.get('step-over')!;
    step.providerOverride = {
      action: OverrideAction.INCLUDE,
      reason: 'clinical judgement',
      originalStatus: NodeStatus.GATED_OUT,
      originalConfidence: 0,
    };

    // The answer is withdrawn, so the gate shuts. The override stands on its
    // own node — but its children used to be queued ahead of the gate, resolve
    // first, and then be skipped by the sweep as already-written.
    await engine().resolveIncrementally(
      new Set(['gate-shut']), first.resolutionState, first.dependencyMap, g, NO_CONDITIONS, new Map(),
    );

    expect(first.resolutionState.get('gate-shut')!.status).not.toBe(NodeStatus.INCLUDED);
    // The human decision about step-over stands.
    expect(first.resolutionState.get('step-over')!.providerOverride).toBeDefined();
    // It was never a decision about the medication beneath it.
    expect(first.resolutionState.get('med-1')!.status).not.toBe(NodeStatus.INCLUDED);
  });
});
