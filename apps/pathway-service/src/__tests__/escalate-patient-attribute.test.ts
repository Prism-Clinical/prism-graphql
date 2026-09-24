/**
 * A `patient.*` gate whose attribute is ABSENT could not decide — it did not
 * decide "no". It must escalate like any other missing datum: `ask` holds the
 * subtree and requests the datum, `default` applies `default_behavior`.
 *
 * Before this, `evaluateAttributeKernel` fell back to the legacy evaluator for
 * `patient.*` and returned a bare `satisfied: false`, so a missing gestational
 * age silently gated a subtree out exactly as a measured one outside the range
 * would. Under `v1` only; `legacy-v0` reports no missing-data signal for any
 * datum and is deliberately unchanged.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { NodeStatus, AnswerType, DefaultBehavior, GateType } from '../services/resolution/types';
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
    confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED',
  }),
};

function patientWith(patientAttributes?: Record<string, number>): PatientContext {
  return {
    patientId: 'pt-1',
    conditionCodes: [],
    medications: [],
    allergies: [],
    labResults: [],
    ...(patientAttributes ? { patientAttributes } : {}),
  } as unknown as PatientContext;
}

async function resolve(
  nodes: GraphNode[],
  edges: GraphEdge[],
  patientContext: PatientContext,
  version = 'v1',
) {
  const temporalContext = makeEvaluationTemporalContext({
    evaluationAsOf: AS_OF,
    temporalPolicyVersion: version,
  });
  const factStore =
    version === 'v1'
      ? assembleContext({ mode: 'SYNTHETIC', patientContext } as never, temporalContext)
      : [];
  const engine = new TraversalEngine(
    mockConfidenceEngine as never,
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    temporalContext,
    {},
    factStore,
    new Map(),
  );
  return engine.traverse(makeGraphContext(nodes, edges), patientContext, new Map());
}

function oneGate(gateProps: Record<string, unknown>) {
  return {
    nodes: [
      node('root', 'Pathway'),
      node('gate-1', 'Gate', gateProps),
      node('step-1', 'Step', { title: 'Anatomy scan' }),
    ],
    edges: [edge('root', 'gate-1', 'HAS_GATE'), edge('gate-1', 'step-1', 'BRANCHES_TO')],
  };
}

const GA_GATE = {
  title: 'Past 18 weeks?',
  gate_type: GateType.PATIENT_ATTRIBUTE,
  default_behavior: DefaultBehavior.SKIP,
  condition: { attribute: 'patient.gestational_age_weeks', operator: 'greater_or_equal', value: 18 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
    confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED',
  });
});

describe('a missing patient.* attribute escalates like any missing datum (v1)', () => {
  it('on_unresolved absent (= ask): pends and requests patient.gestational_age_weeks', async () => {
    const { nodes, edges } = oneGate(GA_GATE);
    const result = await resolve(nodes, edges, patientWith());

    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(result.resolutionState.get('step-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(result.pendingQuestions).toHaveLength(1);
    const q = result.pendingQuestions[0];
    expect(q.datumKey).toBe('patient.gestational_age_weeks');
    expect(q.answerType).toBe(AnswerType.NUMERIC);
    // Where the answer is injected: resolution.ts maps this to
    // patientAttributes.gestational_age_weeks, which is what the gate reads.
    expect(q.askTarget).toEqual({ kind: 'attribute', path: 'patient.gestational_age_weeks' });
  });

  it('on_unresolved "default": applies default_behavior and asks nothing', async () => {
    const { nodes, edges } = oneGate({ ...GA_GATE, on_unresolved: 'default' });
    const result = await resolve(nodes, edges, patientWith());
    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.pendingQuestions).toHaveLength(0);
  });

  it('a PRESENT attribute that fails the comparison answers "no" and asks nothing', async () => {
    const { nodes, edges } = oneGate(GA_GATE);
    const result = await resolve(nodes, edges, patientWith({ gestational_age_weeks: 12 }));
    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.pendingQuestions).toHaveLength(0);
  });

  it('a PRESENT attribute that passes includes the subtree', async () => {
    const { nodes, edges } = oneGate(GA_GATE);
    const result = await resolve(nodes, edges, patientWith({ gestational_age_weeks: 20 }));
    expect(result.resolutionState.get('step-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(result.pendingQuestions).toHaveLength(0);
  });

  it('legacy-v0 is unchanged: the missing attribute still gates out silently', async () => {
    const { nodes, edges } = oneGate(GA_GATE);
    const result = await resolve(nodes, edges, patientWith(), 'legacy-v0');
    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.pendingQuestions).toHaveLength(0);
  });
});
