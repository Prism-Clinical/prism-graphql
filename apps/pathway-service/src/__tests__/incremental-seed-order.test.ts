/**
 * Seeding an incremental resolve with both a node and its descendant must not
 * depend on which one is listed first.
 *
 * `resolveIncrementally` enqueues every seed as given. A branch target seeded
 * BEFORE its DecisionPoint therefore disposes first — and when the fork is
 * disposed a moment later and decides to pend, the loop that marks its
 * branches PENDING_QUESTION skips anything already in the resolution state.
 * The branch stays INCLUDED while the fork that governs it is unanswered:
 * one arm of a mutually exclusive decision taken by nobody.
 *
 * `addPatientContext` produces exactly this order. Branch confidences are
 * recorded against the branch target and then against the DecisionPoint, and
 * a Map preserves insertion order — so the target is always seeded first.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { NodeStatus } from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-09-03T12:00:00.000Z';
const SUGGEST = 0.6;

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

/** Both branches clear the threshold, so the one_of fork must pend. */
const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn(async (n: GraphNode) => ({
    nodeIdentifier: n.nodeIdentifier,
    nodeType: n.nodeType,
    confidence: 0.9,
    breakdown: [],
    resolutionType: 'AUTO_RESOLVED',
  })),
};

const PATIENT = {
  patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [],
} as unknown as PatientContext;

function engine() {
  return new TraversalEngine(
    mockConfidenceEngine as never,
    { autoResolveThreshold: 0.85, suggestThreshold: SUGGEST },
    makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'legacy-v0' }),
    {}, [], new Map(),
  );
}

function graph() {
  return makeGraphContext(
    [
      node('root', 'Pathway'),
      node('dp-1', 'DecisionPoint', { title: 'Which treatment?', branch_mode: 'one_of' }),
      node('step-a', 'Step', { title: 'Treat A' }),
      node('step-b', 'Step', { title: 'Treat B' }),
    ],
    [
      edge('root', 'dp-1', 'HAS_DECISION_POINT'),
      edge('dp-1', 'step-a', 'BRANCHES_TO'),
      edge('dp-1', 'step-b', 'BRANCHES_TO'),
    ],
  );
}

beforeEach(() => jest.clearAllMocks());

/** Seeds listed descendant-first, which is the order addPatientContext builds. */
const DESCENDANT_FIRST = ['step-a', 'dp-1'];
const ANCESTOR_FIRST = ['dp-1', 'step-a'];

describe('overlapping incremental seeds', () => {
  async function resolveWith(seeds: string[]) {
    const g = graph();
    const first = await engine().traverse(g, PATIENT, new Map());
    await engine().resolveIncrementally(
      new Set(seeds), first.resolutionState, first.dependencyMap, g, PATIENT, new Map(),
    );
    return first.resolutionState;
  }

  it('pends the fork and takes NEITHER branch, whichever seed comes first', async () => {
    for (const seeds of [DESCENDANT_FIRST, ANCESTOR_FIRST]) {
      const state = await resolveWith(seeds);
      expect(state.get('dp-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
      // The defect: seeded descendant-first, step-a resolved before the fork
      // and the pend loop skipped it, leaving one arm of a mutually exclusive
      // decision INCLUDED with nobody having chosen it.
      expect(state.get('step-a')!.status).not.toBe(NodeStatus.INCLUDED);
      expect(state.get('step-b')!.status).not.toBe(NodeStatus.INCLUDED);
    }
  });

  it('produces the same state either way', async () => {
    const statuses = async (seeds: string[]) => {
      const s = await resolveWith(seeds);
      return Object.fromEntries([...s].map(([id, r]) => [id, r.status]));
    };
    expect(await statuses(DESCENDANT_FIRST)).toEqual(await statuses(ANCESTOR_FIRST));
  });

  // A seed that is nobody's descendant is still walked — normalisation must
  // drop redundant seeds, not independent ones.
  it('still resolves a seed that no other seed reaches', async () => {
    const state = await resolveWith(['step-b']);
    expect(state.has('step-b')).toBe(true);
  });
});
