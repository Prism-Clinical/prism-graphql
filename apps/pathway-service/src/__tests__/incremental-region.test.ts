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

/**
 * A REJECTED branch is the routing gate's decision to revisit, not its own.
 *
 * The ancestor check recognised only CLOSED ancestors. An answered routing
 * gate stays INCLUDED while rejecting particular branches — so a rejected arm
 * had an open parent, was seeded as a root, and came back INCLUDED alongside
 * the branch the provider had switched to. Two mutually exclusive treatments,
 * from a change to something else entirely.
 */
describe('a branch the answer rejected', () => {
  function routed() {
    return makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-r', 'Gate', {
          title: 'Which arm?', gate_type: GateType.QUESTION,
          default_behavior: DefaultBehavior.SKIP, answer_type: 'SELECT',
          options: ['A', 'B'],
        }),
        node('step-a', 'Step', { title: 'Arm A' }),
        node('step-b', 'Step', { title: 'Arm B' }),
      ],
      [
        edge('root', 'gate-r', 'HAS_GATE'),
        { ...edge('gate-r', 'step-a', 'BRANCHES_TO'), properties: { when: { equals: 'A' } } },
        { ...edge('gate-r', 'step-b', 'BRANCHES_TO'), properties: { when: { equals: 'B' } } },
      ],
    );
  }

  it('stays rejected when a context change rescores it', async () => {
    const g = routed();
    const chooseB = new Map([['gate-r', { selectedOption: 'B' } as never]]);
    const first = await engine().traverse(g, NO_CONDITIONS, chooseB);
    expect(first.resolutionState.get('step-b')!.status).toBe(NodeStatus.INCLUDED);
    expect(first.resolutionState.get('step-a')!.status).toBe(NodeStatus.EXCLUDED);

    // Something rescored the rejected arm — a lab change, say.
    await engine().resolveIncrementally(
      new Set(['step-a']), first.resolutionState, first.dependencyMap, g, NO_CONDITIONS, chooseB,
    );

    expect(first.resolutionState.get('step-a')!.status).not.toBe(NodeStatus.INCLUDED);
    expect(first.resolutionState.get('step-b')!.status).toBe(NodeStatus.INCLUDED);
  });
});

/**
 * Switching away from an OVERRIDDEN branch must exclude its subtree, not
 * delete it.
 *
 * The incremental pass clears descendant rows first. `markBranchNotSelected`
 * then returned immediately on a held branch root — preserving the override,
 * but abandoning everything below it. Nothing rebuilt those rows, so a
 * medication vanished from the session entirely.
 */
describe('switching away from an overridden branch', () => {
  function routed() {
    return makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-r', 'Gate', {
          title: 'Which arm?', gate_type: GateType.QUESTION,
          default_behavior: DefaultBehavior.SKIP, answer_type: 'SELECT',
          options: ['A', 'B'],
        }),
        node('step-a', 'Step', { title: 'Arm A' }),
        node('med-a', 'Medication', { name: 'Drug A', role: 'first_line' }),
        node('step-b', 'Step', { title: 'Arm B' }),
      ],
      [
        edge('root', 'gate-r', 'HAS_GATE'),
        { ...edge('gate-r', 'step-a', 'BRANCHES_TO'), properties: { when: { equals: 'A' } } },
        { ...edge('gate-r', 'step-b', 'BRANCHES_TO'), properties: { when: { equals: 'B' } } },
        edge('step-a', 'med-a', 'USES_MEDICATION'),
      ],
    );
  }

  it('keeps the medication in the session, excluded rather than gone', async () => {
    const g = routed();
    const chooseA = new Map([['gate-r', { selectedOption: 'A' } as never]]);
    const first = await engine().traverse(g, NO_CONDITIONS, chooseA);

    first.resolutionState.get('step-a')!.providerOverride = {
      action: OverrideAction.INCLUDE,
      reason: 'clinical judgement',
      originalStatus: NodeStatus.EXCLUDED,
      originalConfidence: 0,
    };

    const chooseB = new Map([['gate-r', { selectedOption: 'B' } as never]]);
    await engine().resolveIncrementally(
      new Set(['gate-r']), first.resolutionState, first.dependencyMap, g, NO_CONDITIONS, chooseB,
    );

    // Present, and out of the plan — a node that simply disappears reads as an
    // oversight rather than a decision.
    expect(first.resolutionState.has('med-a')).toBe(true);
    expect(first.resolutionState.get('med-a')!.status).not.toBe(NodeStatus.INCLUDED);
  });
});

/**
 * A seed keeps the place it had.
 *
 * Every incremental root was re-parented to `undefined` at depth 0. Care-plan
 * generation walks the ancestry chain, so re-answering a gate beneath a Stage
 * severed that Stage from its subtree — and an UNCHANGED answer silently
 * dropped the Stage's goals from the generated plan.
 */
describe('seed placement', () => {
  function nested() {
    return makeGraphContext(
      [
        node('root', 'Pathway'),
        node('stage-1', 'Stage', { title: 'Assessment', stage_number: 1 }),
        node('gate-1', 'Gate', SHUT_QUESTION),
        node('step-1', 'Step', { title: 'Treat' }),
      ],
      [
        edge('root', 'stage-1', 'HAS_STAGE'),
        edge('stage-1', 'gate-1', 'HAS_GATE'),
        edge('gate-1', 'step-1', 'BRANCHES_TO'),
      ],
    );
  }

  it('keeps the seed parented where it was, not at the root', async () => {
    const g = nested();
    const answers = new Map([['gate-1', { booleanValue: true } as never]]);
    const first = await engine().traverse(g, NO_CONDITIONS, answers);
    const before = first.resolutionState.get('gate-1')!;
    expect(before.parentNodeId).toBe('stage-1');

    await engine().resolveIncrementally(
      new Set(['gate-1']), first.resolutionState, first.dependencyMap, g, NO_CONDITIONS, answers,
    );

    const after = first.resolutionState.get('gate-1')!;
    expect(after.parentNodeId).toBe('stage-1');
    expect(after.depth).toBe(before.depth);
  });
});
