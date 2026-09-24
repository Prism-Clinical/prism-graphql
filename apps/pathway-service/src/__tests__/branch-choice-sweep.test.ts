/**
 * Choosing a branch must not exclude the branch that was chosen.
 *
 * Reported from a live anemia-in-pregnancy session: answering dp-1 with
 * "Initiate oral iron + counseling" marked that very step EXCLUDED, "Not
 * selected … chose 'Initiate oral iron + counseling'", along with the step
 * CONTAINING dp-1 and all of stage 2. Choosing "Microcytic workup" did the same
 * to that step.
 *
 * Not an id/label mismatch — the option values are node ids, the labels are
 * titles, and the engine compares ids with ids. The chosen branch was reached
 * by the sweep that closes the UNCHOSEN one, through two kinds of edge:
 *
 *  1. REQUIRES, walked as if it were containment. It runs dependent →
 *     prerequisite (step-2-1 REQUIRES step-1-1), i.e. BACK UP the tree, so
 *     closing step-2-1 swept step-1-1, dp-1's own parent, and everything
 *     beneath it — including the chosen step-1-2.
 *  2. Forward convergence inside one fork: the unchosen workup leads, through
 *     a gate, to the stage that CONTAINS the chosen step
 *     (step-1-2 → gate-ida → stage-2 → step-2-1). The sweep ran before the
 *     queued chosen branch was written, and first-writer-wins did the rest.
 *
 * The graph below is the anemia v1.1 shape reduced to the edges that matter.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import {
  DefaultBehavior,
  GateAnswer,
  GateType,
  NodeStatus,
  createEmptyDependencyMap,
} from '../services/resolution/types';
import { GraphNode, GraphEdge } from '../services/confidence/types';
import { REFERENCE_PATIENT, makeGraphContext } from './fixtures/reference-patient-context';

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType: string): GraphEdge {
  return { id: `${sourceId}-${edgeType}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

const NODES = [
  node('root', 'Pathway'),
  node('stage-1', 'Stage', { title: 'Diagnosis' }),
  node('step-1-1', 'Step', { title: 'Diagnosis confirmation & evaluation' }),
  node('dp-1', 'DecisionPoint', { title: 'Empiric iron vs confirmatory studies first', branch_mode: 'one_of' }),
  node('step-1-2', 'Step', { title: 'Microcytic workup' }),
  node('lab-2', 'LabTest', { title: 'Ferritin' }),
  node('gate-ida', 'Gate', {
    title: 'Ferritin confirms iron deficiency',
    gate_type: GateType.QUESTION,
    default_behavior: DefaultBehavior.SKIP,
    prompt: 'Ferritin < 30?',
    answer_type: 'boolean',
  }),
  node('stage-2', 'Stage', { title: 'Iron Deficiency Treatment' }),
  node('step-2-1', 'Step', { title: 'Initiate oral iron + counseling' }),
  node('med-1', 'Medication', { title: 'Ferrous sulfate' }),
  node('step-2-2', 'Step', { title: 'Oral iron trial period' }),
  node('stage-4', 'Stage', { title: 'Late pregnancy' }),
  node('step-4-1', 'Step', { title: 'Predelivery optimization' }),
  node('gate-severe', 'Gate', {
    title: 'Severe anemia',
    gate_type: GateType.QUESTION,
    default_behavior: DefaultBehavior.SKIP,
    prompt: 'Hb < 7?',
    answer_type: 'boolean',
  }),
  node('step-3-6', 'Step', { title: 'Transfusion consideration' }),
];
const EDGES = [
  edge('root', 'stage-1', 'HAS_STAGE'),
  edge('stage-1', 'step-1-1', 'HAS_STEP'),
  edge('step-1-1', 'dp-1', 'HAS_DECISION_POINT'),
  edge('dp-1', 'step-1-2', 'BRANCHES_TO'),
  edge('dp-1', 'step-2-1', 'BRANCHES_TO'),
  edge('step-1-2', 'lab-2', 'HAS_LAB_TEST'),
  // Convergence: the workup leads, through a gate, to the treatment stage.
  edge('step-1-2', 'gate-ida', 'HAS_GATE'),
  edge('gate-ida', 'stage-2', 'BRANCHES_TO'),
  edge('stage-2', 'step-2-1', 'HAS_STEP'),
  edge('stage-2', 'step-2-2', 'HAS_STEP'),
  edge('step-2-1', 'med-1', 'USES_MEDICATION'),
  // Prerequisite: oral iron requires the diagnostic step — pointing back UP.
  edge('step-2-1', 'step-1-1', 'REQUIRES'),
  // Same shape elsewhere: a gated-out step requires one under an open stage.
  edge('root', 'stage-4', 'HAS_STAGE'),
  edge('stage-4', 'step-4-1', 'HAS_STEP'),
  edge('root', 'gate-severe', 'HAS_GATE'),
  edge('gate-severe', 'step-3-6', 'BRANCHES_TO'),
  edge('step-3-6', 'step-4-1', 'REQUIRES'),
];

function engine(): TraversalEngine {
  return new TraversalEngine(
    {
      computeNodeConfidence: jest.fn().mockResolvedValue({
        confidence: 0.9, breakdown: [], resolutionType: 'AUTO_RESOLVED',
      }),
    },
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    makeEvaluationTemporalContext({
      evaluationAsOf: '2026-09-24T12:00:00.000Z', temporalPolicyVersion: 'legacy-v0',
    }),
    {},
    [],
    new Map(),
  );
}

/** Start, find the fork pending, then answer it the way answerPendingDecision does. */
async function chooseIncrementally(choice: string) {
  const graph = makeGraphContext(NODES, EDGES);
  const eng = engine();
  const answers = new Map<string, GateAnswer>([['gate-severe', { booleanValue: false } as GateAnswer]]);
  const start = await eng.traverse(graph, REFERENCE_PATIENT, answers);

  expect(start.resolutionState.get('dp-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
  const q = start.pendingQuestions.find(p => p.gateId === 'dp-1')!;
  // Option VALUES are node ids; LABELS are titles. The fix must not depend on
  // them being equal — they are deliberately not.
  expect(q.options).toEqual(expect.arrayContaining(['step-1-2', 'step-2-1']));
  expect(q.optionLabels).toEqual(
    q.options!.map(id => NODES.find(n => n.nodeIdentifier === id)!.properties.title),
  );

  answers.set('dp-1', { selectedOption: choice } as GateAnswer);
  const state = start.resolutionState;
  await eng.resolveIncrementally(
    new Set(['dp-1']), state, start.dependencyMap ?? createEmptyDependencyMap(), graph,
    REFERENCE_PATIENT, answers,
    { pendingQuestions: start.pendingQuestions, redFlags: start.redFlags, alsoDropGateIds: ['dp-1'] },
  );
  return state;
}

const status = (s: Map<string, { status: NodeStatus }>, id: string) => s.get(id)?.status;

describe('choosing a branch at a DecisionPoint', () => {
  it('choosing "Microcytic workup" keeps it — and dp-1\'s own parent — included', async () => {
    const s = await chooseIncrementally('step-1-2');

    expect(status(s, 'step-1-2')).toBe(NodeStatus.INCLUDED);
    expect(status(s, 'lab-2')).toBe(NodeStatus.INCLUDED);
    expect(status(s, 'step-1-1')).toBe(NodeStatus.INCLUDED);
    expect(status(s, 'dp-1')).toBe(NodeStatus.INCLUDED);
    // The unchosen arm is NOT closed here, and correctly so: the chosen
    // workup itself leads to it (workup → ferritin gate → treatment stage →
    // oral iron). It waits on that gate's question instead — "treat if the
    // ferritin confirms it" — rather than being excluded by a choice that
    // leads straight to it.
    expect(status(s, 'step-2-1')).toBe(NodeStatus.PENDING_QUESTION);
    expect(s.get('step-2-1')!.excludeReason).toMatch(/Ferritin < 30/);
    expect(status(s, 'med-1')).toBe(NodeStatus.PENDING_QUESTION);
  });

  it('an unchosen branch the chosen one does NOT lead to is excluded, naming the choice', async () => {
    // Remove the convergence: only the REQUIRES back-edge is left.
    const nodes = NODES.filter(n => n.nodeIdentifier !== 'gate-ida' && n.nodeIdentifier !== 'stage-2'
      && n.nodeIdentifier !== 'step-2-2');
    const edges = EDGES.filter(e => ![e.sourceId, e.targetId].some(
      id => id === 'gate-ida' || id === 'stage-2' || id === 'step-2-2'));
    const graph = makeGraphContext(nodes, edges);
    const eng = engine();
    const answers = new Map<string, GateAnswer>([['gate-severe', { booleanValue: false } as GateAnswer]]);
    const start = await eng.traverse(graph, REFERENCE_PATIENT, answers);
    answers.set('dp-1', { selectedOption: 'step-1-2' } as GateAnswer);
    await eng.resolveIncrementally(
      new Set(['dp-1']), start.resolutionState, start.dependencyMap, graph, REFERENCE_PATIENT, answers,
      { pendingQuestions: start.pendingQuestions, redFlags: start.redFlags, alsoDropGateIds: ['dp-1'] },
    );
    const s = start.resolutionState;

    expect(status(s, 'step-1-2')).toBe(NodeStatus.INCLUDED);
    expect(status(s, 'step-1-1')).toBe(NodeStatus.INCLUDED);
    expect(status(s, 'step-2-1')).toBe(NodeStatus.EXCLUDED);
    expect(s.get('step-2-1')!.excludeReason).toMatch(/chose "Microcytic workup"/);
    expect(status(s, 'med-1')).toBe(NodeStatus.EXCLUDED);
  });

  it('choosing "Initiate oral iron + counseling" keeps it included', async () => {
    const s = await chooseIncrementally('step-2-1');

    expect(status(s, 'step-2-1')).toBe(NodeStatus.INCLUDED);
    expect(status(s, 'med-1')).toBe(NodeStatus.INCLUDED);
    expect(status(s, 'step-1-1')).toBe(NodeStatus.INCLUDED);
    expect(status(s, 'dp-1')).toBe(NodeStatus.INCLUDED);
    expect(status(s, 'step-1-2')).toBe(NodeStatus.EXCLUDED);
    expect(s.get('step-1-2')!.excludeReason).toMatch(/chose "Initiate oral iron \+ counseling"/);
    // Reachable ONLY through the unchosen workup, so it closes with it. That
    // is the graph as authored (stage-2 hangs off gate-ida alone), not the
    // engine: see the report on this fix.
    expect(status(s, 'step-2-2')).toBe(NodeStatus.EXCLUDED);
  });

  it('a full traversal with the answer already stored agrees', async () => {
    const graph = makeGraphContext(NODES, EDGES);
    const answers = new Map<string, GateAnswer>([
      ['gate-severe', { booleanValue: false } as GateAnswer],
      ['dp-1', { selectedOption: 'step-2-1' } as GateAnswer],
    ]);
    const r = await engine().traverse(graph, REFERENCE_PATIENT, answers);

    expect(status(r.resolutionState, 'step-2-1')).toBe(NodeStatus.INCLUDED);
    expect(status(r.resolutionState, 'med-1')).toBe(NodeStatus.INCLUDED);
    expect(status(r.resolutionState, 'step-1-1')).toBe(NodeStatus.INCLUDED);
    expect(status(r.resolutionState, 'step-1-2')).toBe(NodeStatus.EXCLUDED);
  });

  it('a routing gate does not sweep the branch it selected when an unselected branch leads there', async () => {
    // Same ordering bug at a multi-branch gate: step-watch leads on to
    // step-treat, and closing step-watch ran before step-treat was walked.
    const graph = makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-route', 'Gate', {
          gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP,
          prompt: 'Watch or treat?', answer_type: 'select', options: ['watch', 'treat'],
        }),
        node('step-watch', 'Step', { title: 'Watchful waiting' }),
        node('step-treat', 'Step', { title: 'Treat' }),
        node('med-t', 'Medication'),
      ],
      [
        edge('root', 'gate-route', 'HAS_GATE'),
        { ...edge('gate-route', 'step-watch', 'BRANCHES_TO'), properties: { when: { equals: 'watch' } } },
        { ...edge('gate-route', 'step-treat', 'BRANCHES_TO'), properties: { when: { equals: 'treat' } } },
        edge('step-watch', 'step-treat', 'HAS_STEP'),
        edge('step-treat', 'med-t', 'USES_MEDICATION'),
      ],
    );
    const r = await engine().traverse(
      graph, REFERENCE_PATIENT, new Map([['gate-route', { selectedOption: 'treat' } as GateAnswer]]),
    );

    expect(status(r.resolutionState, 'step-watch')).toBe(NodeStatus.EXCLUDED);
    expect(status(r.resolutionState, 'step-treat')).toBe(NodeStatus.INCLUDED);
    expect(status(r.resolutionState, 'med-t')).toBe(NodeStatus.INCLUDED);
  });

  it('a closed gate does not close a step its branch merely REQUIRES', async () => {
    // step-3-6 REQUIRES step-4-1; step-4-1 lives under stage-4, which is open.
    // Walking REQUIRES as containment gated it out with the transfusion step.
    const graph = makeGraphContext(NODES, EDGES);
    const r = await engine().traverse(
      graph, REFERENCE_PATIENT, new Map([['gate-severe', { booleanValue: false } as GateAnswer]]),
    );

    expect(status(r.resolutionState, 'step-3-6')).toBe(NodeStatus.GATED_OUT);
    expect(status(r.resolutionState, 'stage-4')).toBe(NodeStatus.INCLUDED);
    expect(status(r.resolutionState, 'step-4-1')).toBe(NodeStatus.INCLUDED);
  });
});
