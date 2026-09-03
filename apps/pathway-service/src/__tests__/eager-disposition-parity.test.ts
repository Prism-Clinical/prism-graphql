/**
 * A node means the same thing however traversal reached it.
 *
 * A `prior_node_result` gate cannot decide until its dependency has a status,
 * so it forces that dependency to be resolved out of BFS order. That eager
 * path used to be a SECOND disposition implementation, and it disagreed with
 * the real one on nearly everything: an unsatisfied gate became GATED_OUT
 * regardless of `default_behavior`, an unanswered question never pended, and a
 * DecisionPoint was blindly INCLUDED whatever its `branch_mode` said.
 *
 * So the same gate on the same facts could resolve differently depending on
 * the order it happened to be reached — the defect family plan 03 unified the
 * engines to remove, surviving in the one path nobody had looked at.
 *
 * Each case here builds the SAME dependency two ways: reached normally, and
 * forced through the eager path by a gate that depends on it.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import {
  NodeStatus, GateType, DefaultBehavior, AnswerType,
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

/** The subject: a gate that is NOT satisfied but says to traverse anyway. */
const TRAVERSE_ANYWAY = {
  title: 'Anaemic?',
  gate_type: GateType.PATIENT_ATTRIBUTE,
  default_behavior: DefaultBehavior.TRAVERSE,
  condition: { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10' },
};

/** An unanswered question, which should PEND rather than close. */
const UNANSWERED = {
  title: 'Symptomatic?',
  gate_type: GateType.QUESTION,
  default_behavior: DefaultBehavior.SKIP,
  answer_type: AnswerType.BOOLEAN,
};

/** Reached by the ordinary walk: root -> subject -> step. */
function normally(subjectProps: Record<string, unknown>) {
  return makeGraphContext(
    [node('root', 'Pathway'), node('subject', 'Gate', subjectProps), node('step-1', 'Step')],
    [edge('root', 'subject', 'HAS_GATE'), edge('subject', 'step-1', 'BRANCHES_TO')],
  );
}

/**
 * Reached EAGERLY: the walk meets `dependent` first, which depends on
 * `subject`, forcing it to be resolved out of order.
 */
function eagerly(subjectProps: Record<string, unknown>) {
  return makeGraphContext(
    [
      node('root', 'Pathway'),
      node('dependent', 'Gate', {
        title: 'Downstream',
        gate_type: GateType.PRIOR_NODE_RESULT,
        default_behavior: DefaultBehavior.SKIP,
        depends_on: [{ node_id: 'subject', status: NodeStatus.INCLUDED }],
      }),
      node('subject', 'Gate', subjectProps),
      node('step-1', 'Step'),
    ],
    [
      edge('root', 'dependent', 'HAS_GATE'),
      edge('dependent', 'subject', 'BRANCHES_TO'),
      edge('subject', 'step-1', 'BRANCHES_TO'),
    ],
  );
}

beforeEach(() => jest.clearAllMocks());

describe('eager evaluation disposes a node the same way the walk does', () => {
  it('honours default_behavior TRAVERSE on both paths', async () => {
    const direct = await engine().traverse(normally(TRAVERSE_ANYWAY), PATIENT, new Map());
    const eager = await engine().traverse(eagerly(TRAVERSE_ANYWAY), PATIENT, new Map());

    // The gate is unsatisfied, but the author said to traverse anyway.
    expect(direct.resolutionState.get('subject')!.status).toBe(NodeStatus.INCLUDED);
    expect(eager.resolutionState.get('subject')!.status)
      .toBe(direct.resolutionState.get('subject')!.status);
  });

  it('pends an unanswered question on both paths', async () => {
    const direct = await engine().traverse(normally(UNANSWERED), PATIENT, new Map());
    const eager = await engine().traverse(eagerly(UNANSWERED), PATIENT, new Map());

    expect(direct.resolutionState.get('subject')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(eager.resolutionState.get('subject')!.status)
      .toBe(direct.resolutionState.get('subject')!.status);
  });

  // A question reached eagerly must still ASK. Disposing it silently left the
  // provider no way to resolve a gate the session was waiting on.
  it('raises the pending question when reached eagerly', async () => {
    const eager = await engine().traverse(eagerly(UNANSWERED), PATIENT, new Map());
    expect(eager.pendingQuestions.map(q => q.gateId)).toContain('subject');
  });

  /**
   * Eager evaluation writes the node into `resolutionState`, and the main BFS
   * skips anything already there — so before this, whatever the eager node
   * opened up was enqueued by nobody and its subtree vanished from the
   * session entirely.
   */
  it('still traverses the subtree below an eagerly-resolved node', async () => {
    const eager = await engine().traverse(eagerly(TRAVERSE_ANYWAY), PATIENT, new Map());
    expect(eager.resolutionState.has('step-1')).toBe(true);
  });
});
