import { TraversalEngine } from '../../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { NodeStatus, GateAnswer, GateType, DefaultBehavior } from '../../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../../services/confidence/types';
import { makeGraphContext } from '../fixtures/reference-patient-context';

function node(id: string, nodeType: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType, properties: { title: id, ...properties } } as GraphNode;
}
function edge(sourceId: string, targetId: string): GraphEdge {
  return {
    id: `${sourceId}->${targetId}`,
    edgeType: 'HAS_CHILD',
    sourceId,
    targetId,
    properties: {},
  } as GraphEdge;
}

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.9,
    breakdown: [],
    resolutionType: 'AUTO_RESOLVED',
  }),
};
const thresholds = { autoResolveThreshold: 0.85, suggestThreshold: 0.6 };

// A count_in_window gate is the sharpest probe: it is one of the three
// operators that actually reads the clock, and a 30-day window puts the
// fact's date right at the boundary.
const PINNED = '2026-07-30T12:00:00.000Z';
const nodes = [
  node('root', 'Pathway'),
  node('gate-1', 'Gate', {
    gate_type: GateType.PATIENT_ATTRIBUTE,
    // `default_behavior: skip` is load-bearing for this test, not decoration.
    // Without it an unsatisfied gate falls through to "Default traverse —
    // include anyway" (traversal-engine.ts:370) and the node stays INCLUDED
    // whatever the clock says, so the test passes without proving anything.
    default_behavior: DefaultBehavior.SKIP,
    condition: {
      field: 'labs',
      operator: 'count_in_window',
      value: '718-7',
      window_days: 30,
      count_threshold: 2,
    },
  }),
  node('step-1', 'Step'),
];
const edges = [edge('root', 'gate-1'), edge('gate-1', 'step-1')];

// Two hemoglobin results 10 and 20 days before PINNED — inside a 30-day
// window measured from PINNED, but outside one measured from a wall clock
// six months later.
const patient: PatientContext = {
  patientId: 'p1',
  conditionCodes: [],
  medications: [],
  labResults: [
    { code: '718-7', system: 'LOINC', value: 9.1, unit: 'g/dL', date: '2026-07-20T00:00:00.000Z' },
    { code: '718-7', system: 'LOINC', value: 9.4, unit: 'g/dL', date: '2026-07-10T00:00:00.000Z' },
  ],
  allergies: [],
} as unknown as PatientContext;

async function traverseAtSystemTime(systemTime: string): Promise<NodeStatus | undefined> {
  jest.useFakeTimers().setSystemTime(new Date(systemTime));
  try {
    const engine = new TraversalEngine(
      mockConfidenceEngine as never,
      thresholds,
      makeEvaluationTemporalContext({ evaluationAsOf: PINNED, temporalPolicyVersion: 'legacy-v0' }),
      {},
      // Required from plan 04 Task 9 on; empty because this is `legacy-v0`.
      [],
      // `codeMap`, required from review finding 3 on (R11-4); empty for the
      // same reason.
      new Map(),
    );
    const result = await engine.traverse(
      makeGraphContext(nodes, edges),
      patient,
      new Map<string, GateAnswer>(),
    );
    return result.resolutionState.get('gate-1')?.status;
  } finally {
    jest.useRealTimers();
  }
}

describe('pinned evaluation clock', () => {
  it('a moved wall clock does not change gate outcome', async () => {
    const atCreation = await traverseAtSystemTime('2026-07-30T12:00:00.000Z');
    const sixMonthsLater = await traverseAtSystemTime('2027-01-30T12:00:00.000Z');

    expect(atCreation).toBe(NodeStatus.INCLUDED);
    expect(sixMonthsLater).toBe(atCreation);
  });
});
