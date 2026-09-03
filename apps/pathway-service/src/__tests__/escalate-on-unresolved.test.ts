/**
 * A gate that CANNOT ANSWER asks for the datum it needed, instead of silently
 * taking `default_behavior`.
 *
 * Pinned to `v1` with an assembled fact store throughout: `indeterminate` and
 * `dataUnavailable` exist only on the kernel path, so under `legacy-v0` every
 * case here would pass vacuously.
 *
 * The negatives carry most of the weight. A gate that ANSWERED — including one
 * that answered "no" — must never prompt anyone, and the classes with no
 * honest question (membership, aggregate) must stay silent.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import {
  NodeStatus,
  AnswerType,
  DefaultBehavior,
  GateType,
} from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-08-30T12:00:00.000Z';
const RECENT = '2026-08-20T00:00:00.000Z';

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

function patientWith(labResults: unknown[]): PatientContext {
  return {
    patientId: 'pt-1',
    conditionCodes: [],
    medications: [],
    allergies: [],
    labResults,
  } as unknown as PatientContext;
}

async function resolve(nodes: GraphNode[], edges: GraphEdge[], patientContext: PatientContext) {
  const temporalContext = makeEvaluationTemporalContext({
    evaluationAsOf: AS_OF,
    temporalPolicyVersion: 'v1',
  });
  const factStore = assembleContext(
    { mode: 'SYNTHETIC', patientContext } as never,
    temporalContext,
  );
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

/** root -> gate -> step, so the gate has a subtree to hold. */
function oneGate(gateProps: Record<string, unknown>) {
  return {
    nodes: [
      node('root', 'Pathway'),
      node('gate-1', 'Gate', gateProps),
      node('step-1', 'Step', { title: 'Treat' }),
    ],
    edges: [
      edge('root', 'gate-1', 'HAS_GATE'),
      edge('gate-1', 'step-1', 'BRANCHES_TO'),
    ],
  };
}

const HB_SCALAR = {
  title: 'Anaemic?',
  gate_type: GateType.PATIENT_ATTRIBUTE,
  default_behavior: DefaultBehavior.SKIP,
  condition: {
    field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
    confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED',
  });
});

describe('escalation — a gate that could not decide asks for the datum', () => {
  it('pends, and asks for the datum, when a scalar gate has no value', async () => {
    const { nodes, edges } = oneGate(HB_SCALAR);
    const result = await resolve(nodes, edges, patientWith([]));

    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
    // The subtree is HELD, not gated out — the pathway has not decided against
    // it, it simply cannot decide yet.
    expect(result.resolutionState.get('step-1')!.status).toBe(NodeStatus.PENDING_QUESTION);

    expect(result.pendingQuestions).toHaveLength(1);
    const q = result.pendingQuestions[0];
    expect(q.datumKey).toBe('LOINC:718-7');
    expect(q.answerType).toBe(AnswerType.NUMERIC);
    expect(q.askTarget).toEqual({ kind: 'lab', code: '718-7', system: 'LOINC' });
  });

  it('prefers an authored prompt over the generated one', async () => {
    const { nodes, edges } = oneGate({
      ...HB_SCALAR,
      prompt: 'Most recent haemoglobin from the antenatal record?',
    });
    const result = await resolve(nodes, edges, patientWith([]));
    expect(result.pendingQuestions[0].prompt).toBe(
      'Most recent haemoglobin from the antenatal record?',
    );
  });

  it('takes default_behavior instead when on_unresolved is "default"', async () => {
    const { nodes, edges } = oneGate({ ...HB_SCALAR, on_unresolved: 'default' });
    const result = await resolve(nodes, edges, patientWith([]));

    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.pendingQuestions).toHaveLength(0);
  });

  // ─── The negatives ───────────────────────────────────────────────────

  it('does NOT ask when the gate read a real value and answered "no"', async () => {
    const { nodes, edges } = oneGate(HB_SCALAR);
    const result = await resolve(
      nodes, edges,
      patientWith([{ code: '718-7', system: 'LOINC', value: 13.2, date: RECENT }]),
    );

    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.pendingQuestions).toHaveLength(0);
  });

  it('does NOT ask for a membership gate that found no code', async () => {
    const { nodes, edges } = oneGate({
      title: 'Diabetic?',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: { field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10' },
    });
    const result = await resolve(nodes, edges, patientWith([]));

    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.pendingQuestions).toHaveLength(0);
  });

  it('does NOT ask for an aggregate gate — the answer would be a series', async () => {
    const { nodes, edges } = oneGate({
      title: 'Repeated low Hb?',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: {
        field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC',
        window_days: 180, count_threshold: 2,
      },
    });
    const result = await resolve(nodes, edges, patientWith([]));

    expect(result.pendingQuestions).toHaveLength(0);
  });

  // ─── Dedup ───────────────────────────────────────────────────────────

  it('asks once when two gates need the same datum', async () => {
    const nodes = [
      node('root', 'Pathway'),
      node('gate-a', 'Gate', HB_SCALAR),
      node('gate-b', 'Gate', {
        ...HB_SCALAR,
        title: 'Severely anaemic?',
        condition: { ...HB_SCALAR.condition, threshold: 7 },
      }),
      node('step-a', 'Step', { title: 'Treat' }),
      node('step-b', 'Step', { title: 'Transfuse' }),
    ];
    const edges = [
      edge('root', 'gate-a', 'HAS_GATE'),
      edge('root', 'gate-b', 'HAS_GATE'),
      edge('gate-a', 'step-a', 'BRANCHES_TO'),
      edge('gate-b', 'step-b', 'BRANCHES_TO'),
    ];
    const result = await resolve(nodes, edges, patientWith([]));

    // Both gates hold their subtrees...
    expect(result.resolutionState.get('gate-a')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(result.resolutionState.get('gate-b')!.status).toBe(NodeStatus.PENDING_QUESTION);
    // ...but the provider is asked for the haemoglobin once. One injected
    // fact resolves both, so a second question asks for what was already
    // requested.
    expect(result.pendingQuestions).toHaveLength(1);
    expect(result.pendingQuestions[0].datumKey).toBe('LOINC:718-7');
  });
});

/**
 * A COMPOUND gate escalates too — and asks for the right datum.
 *
 * This is the case the workstream exists for and the one it used to miss.
 * `evaluateCompound` propagated `indeterminate` and `uncertainty` but dropped
 * `dataUnavailable`, so a compound with one missing measurement reported
 * nothing unresolved and silently took its default. And when it did escalate,
 * the prompt asked for the FIRST askable condition, which can be one the
 * engine already has — leaving the blocking condition unasked for ever.
 */
describe('escalation from a compound gate', () => {
  /** Condition 1 HAS a value; condition 2 does not. */
  const COMPOUND_ONE_MISSING = {
    title: 'Anaemic and thrombocytopenic?',
    gate_type: GateType.COMPOUND,
    default_behavior: DefaultBehavior.SKIP,
    operator: 'AND',
    conditions: [
      { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 },
      { field: 'labs', operator: 'less_than', value: '777-3', system: 'LOINC', threshold: 150 },
    ],
  };

  const HAS_HAEMOGLOBIN_ONLY = patientWith([
    { code: '718-7', system: 'LOINC', value: 9, effectiveDateTime: '2026-08-20' },
  ]);

  it('escalates instead of silently taking its default', async () => {
    const { nodes, edges } = oneGate(COMPOUND_ONE_MISSING);
    const r = await resolve(nodes, edges, HAS_HAEMOGLOBIN_ONLY);
    expect(r.pendingQuestions.map(q => q.gateId)).toContain('gate-1');
  });

  // The point of naming the unresolved condition: the provider is asked for
  // the platelet count, not for the haemoglobin already on file.
  it('asks for the datum that is MISSING, not the first one it could ask for', async () => {
    const { nodes, edges } = oneGate(COMPOUND_ONE_MISSING);
    const r = await resolve(nodes, edges, HAS_HAEMOGLOBIN_ONLY);
    const q = r.pendingQuestions.find(p => p.gateId === 'gate-1');
    expect(q).toBeDefined();
    expect(q!.datumKey).toContain('777-3');
    expect(q!.datumKey).not.toContain('718-7');
  });

  // A compound the data already settles must not interrupt anyone.
  it('does not escalate when a definite false already settles the AND', async () => {
    const settled = {
      ...COMPOUND_ONE_MISSING,
      conditions: [
        // Definitely false: haemoglobin is 14, well above the threshold.
        { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 },
        { field: 'labs', operator: 'less_than', value: '777-3', system: 'LOINC', threshold: 150 },
      ],
    };
    const notAnaemic = patientWith([
      { code: '718-7', system: 'LOINC', value: 14, effectiveDateTime: '2026-08-20' },
    ]);
    const { nodes, edges } = oneGate(settled);
    const r = await resolve(nodes, edges, notAnaemic);
    expect(r.pendingQuestions.map(q => q.gateId)).not.toContain('gate-1');
  });
});
