/**
 * A DecisionPoint's declared branching semantics, enforced.
 *
 * `branch_mode` was validated at import and never read at resolution, so a
 * `one_of` fork included every branch clearing `suggestThreshold` — which on a
 * fork whose branches are mutually exclusive treatments puts all of them in one
 * plan.
 *
 * Branch qualification is driven per-node through the confidence mock, because
 * that is the only lever the DecisionPoint arm actually reads.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { NodeStatus, AnswerType } from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-08-31T12:00:00.000Z';
const SUGGEST = 0.6;

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn(),
};

/** Per-node scores; anything unlisted scores comfortably above threshold. */
function scoreAs(scores: Record<string, number>) {
  mockConfidenceEngine.computeNodeConfidence.mockImplementation(
    async (n: GraphNode) => ({
      confidence: scores[n.nodeIdentifier] ?? 0.9,
      breakdown: [],
      resolutionType: 'AUTO_RESOLVED',
    }),
  );
}

const PATIENT = {
  patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [],
} as unknown as PatientContext;

/** root -> dp-1 -> {step-a, step-b, step-c}, each with a child of its own. */
function graphFor(branchMode: string | undefined) {
  const props: Record<string, unknown> = { title: 'Which treatment?' };
  if (branchMode !== undefined) props.branch_mode = branchMode;
  return makeGraphContext(
    [
      node('root', 'Pathway'),
      node('dp-1', 'DecisionPoint', props),
      node('step-a', 'Step', { title: 'Treat A' }),
      node('step-b', 'Step', { title: 'Treat B' }),
      node('step-c', 'Step', { title: 'Treat C' }),
      node('med-a', 'Medication', { name: 'Drug A', role: 'first_line' }),
    ],
    [
      edge('root', 'dp-1', 'HAS_DECISION_POINT'),
      edge('dp-1', 'step-a', 'BRANCHES_TO'),
      edge('dp-1', 'step-b', 'BRANCHES_TO'),
      edge('dp-1', 'step-c', 'BRANCHES_TO'),
      edge('step-a', 'med-a', 'USES_MEDICATION'),
    ],
  );
}

async function resolve(branchMode: string | undefined, scores: Record<string, number>) {
  scoreAs(scores);
  const engine = new TraversalEngine(
    mockConfidenceEngine as never,
    { autoResolveThreshold: 0.85, suggestThreshold: SUGGEST },
    makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
      temporalPolicyVersion: 'legacy-v0',
    }),
    {},
    [],
    new Map(),
  );
  return engine.traverse(graphFor(branchMode), PATIENT, new Map());
}

beforeEach(() => jest.clearAllMocks());

describe('branch_mode: one_of', () => {
  it('auto-selects when exactly one branch qualifies', async () => {
    const r = await resolve('one_of', { 'step-b': 0.2, 'step-c': 0.2 });

    expect(r.resolutionState.get('step-a')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-b')!.status).toBe(NodeStatus.EXCLUDED);
    expect(r.resolutionState.get('step-c')!.status).toBe(NodeStatus.EXCLUDED);
    expect(r.pendingQuestions).toHaveLength(0);
  });

  // THE SAFETY CASE. On an exclusive fork these branches are typically
  // mutually exclusive treatments; two clearing the bar means the data did not
  // decide it, and taking both is the defect this whole task exists to remove.
  it('PENDS when two branches qualify, and traverses neither', async () => {
    const r = await resolve('one_of', { 'step-c': 0.2 });

    expect(r.resolutionState.get('dp-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(r.resolutionState.get('step-a')!.status).not.toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-b')!.status).not.toBe(NodeStatus.INCLUDED);
    // ...and nothing beneath them either.
    expect(r.resolutionState.get('med-a')?.status).not.toBe(NodeStatus.INCLUDED);
  });

  it('asks which branch applies, listing the candidates', async () => {
    const r = await resolve('one_of', { 'step-c': 0.2 });

    expect(r.pendingQuestions).toHaveLength(1);
    const q = r.pendingQuestions[0];
    expect(q.gateId).toBe('dp-1');
    expect(q.answerType).toBe(AnswerType.SELECT);
    expect(q.options).toEqual(expect.arrayContaining(['step-a', 'step-b']));
    expect(q.options).not.toContain('step-c');
  });

  it('still red-flags a fork where no branch qualifies', async () => {
    const r = await resolve('one_of', { 'step-a': 0.2, 'step-b': 0.2, 'step-c': 0.2 });

    expect(r.redFlags.some(f => f.type === 'all_branches_excluded')).toBe(true);
    expect(r.pendingQuestions).toHaveLength(0);
  });

  it('treats an absent branch_mode as one_of', async () => {
    const r = await resolve(undefined, { 'step-c': 0.2 });
    expect(r.resolutionState.get('dp-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
  });
});

describe('branch_mode: all_of', () => {
  // "After assessment, start workup AND prophylaxis" — migration 060's own
  // example. The author said these all happen, so a branch the data does not
  // support is a disagreement to REPORT, not a step to silently drop.
  it('traverses every branch, including one below threshold', async () => {
    const r = await resolve('all_of', { 'step-b': 0.2 });

    expect(r.resolutionState.get('step-a')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-b')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-c')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('red-flags the branch the data does not support', async () => {
    const r = await resolve('all_of', { 'step-b': 0.2 });

    const flag = r.redFlags.find(f => f.type === 'all_of_branch_unsupported');
    expect(flag).toBeDefined();
    expect(flag!.branches!.map(b => b.nodeId)).toEqual(['step-b']);
  });

  it('never pends, however many branches qualify', async () => {
    const r = await resolve('all_of', {});
    expect(r.resolutionState.get('dp-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.pendingQuestions).toHaveLength(0);
  });

  it('raises no flag when every branch is supported', async () => {
    const r = await resolve('all_of', {});
    expect(r.redFlags.some(f => f.type === 'all_of_branch_unsupported')).toBe(false);
  });
});

describe('branch_mode: any_of', () => {
  // Today's behaviour, pinned so Task 1's change cannot leak into it.
  it('includes every qualifying branch and excludes the rest', async () => {
    const r = await resolve('any_of', { 'step-c': 0.2 });

    expect(r.resolutionState.get('step-a')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-b')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-c')!.status).toBe(NodeStatus.EXCLUDED);
    expect(r.pendingQuestions).toHaveLength(0);
  });
});
