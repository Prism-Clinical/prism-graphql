/**
 * The distinction this whole workstream exists for: "the gate could not tell"
 * versus "the gate's condition was false". The kernel already computes it per
 * condition; traversal read only `satisfied` and dropped it, so downstream the
 * two were the same event.
 *
 * Pinned to `v1` and given a REAL assembled fact store, because `indeterminate`
 * exists only on the kernel path — `legacy-v0` never sets it, and a `v1` gate
 * handed an empty store selects from nothing and answers a quiet false, which
 * would make the negative cases below pass for the wrong reason.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { NodeStatus, GateType, DefaultBehavior } from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-08-30T12:00:00.000Z';
// Inside any plausible lab horizon, so a dated lab is never dropped for age —
// the negative cases must fail on VALUE, not on the horizon.
const RECENT = '2026-08-20T00:00:00.000Z';

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}

function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

// Pathway root -> Gate(Hb < 11) -> Step. The root must be type 'Pathway';
// traverse() looks it up by node type.
const NODES: GraphNode[] = [
  node('root', 'Pathway'),
  node('gate-hb', 'Gate', {
    title: 'Anemic?',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: {
      field: 'labs',
      value: '718-7',
      system: 'LOINC',
      operator: 'less_than',
      threshold: 11,
    },
  }),
  node('step-treat', 'Step', { title: 'Treat' }),
];

const EDGES: GraphEdge[] = [
  edge('root', 'gate-hb', 'HAS_GATE'),
  edge('gate-hb', 'step-treat', 'BRANCHES_TO'),
];

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.85,
    breakdown: [],
    resolutionType: 'AUTO_RESOLVED',
  }),
};

function patientWith(labResults: PatientContext['labResults']): PatientContext {
  return {
    patientId: 'pt-1',
    conditionCodes: [],
    medications: [],
    allergies: [],
    labResults,
  };
}

async function resolve(patientContext: PatientContext) {
  const temporalContext = makeEvaluationTemporalContext({
    evaluationAsOf: AS_OF,
    temporalPolicyVersion: 'v1',
  });
  const factStore = assembleContext(
    { mode: 'SYNTHETIC', patientContext } as never,
    temporalContext,
  );
  const engine = new TraversalEngine(
    mockConfidenceEngine,
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    temporalContext,
    {},
    factStore,
    new Map(),
  );
  return engine.traverse(makeGraphContext(NODES, EDGES), patientContext, new Map());
}

describe('indeterminate reaches resolution state', () => {
  // INDETERMINATE means "there are candidate facts but I cannot order them",
  // not "there is no fact".
  //
  // The precise trigger, per the assembler's own note: an undated lab is
  // asserted current, so ONE undated fact is READY and answers definitely.
  // It is an undated fact PLUS another candidate that is AMBIGUOUS_LATEST —
  // genuinely unorderable — and a scalar comparison over that fails closed
  // with the uncertainty retained.
  it('marks a gate indeterminate when its candidate facts cannot be ordered', async () => {
    const result = await resolve(
      patientWith([
        { code: '718-7', system: 'LOINC', value: 9.1, date: RECENT } as never,
        { code: '718-7', system: 'LOINC', value: 12.4 } as never, // undated
      ]),
    );
    const gate = result.resolutionState.get('gate-hb')!;

    expect(gate.indeterminate).toBe(true);
    expect(gate.uncertaintyReason).toBeTruthy();
    // Routing is UNCHANGED by this plan: default_behavior 'skip' still gates
    // it out. Escalation is a later workstream.
    expect(gate.status).toBe(NodeStatus.GATED_OUT);
  });

  // The case the "silent defaults" complaint is actually about — and it is
  // NOT indeterminate. With no candidate fact at all the kernel returns
  // NO_MATCH, a DEFINITE decision, so `indeterminate` is false and a
  // downstream escalate-on-indeterminate rule would never fire for it.
  //
  // That is defensible for a membership operator (no diabetes code on the
  // problem list really is evidence of no diabetes) and wrong for a scalar
  // one: "no haemoglobin on file" is not "haemoglobin is not below 11".
  // Pinned here so the distinction is visible rather than discovered again.
  it('does NOT mark a gate indeterminate when the datum is absent entirely', async () => {
    const result = await resolve(patientWith([]));
    const gate = result.resolutionState.get('gate-hb')!;

    expect(gate.indeterminate).toBe(false);
    expect(gate.status).toBe(NodeStatus.GATED_OUT);
    expect(gate.excludeReason).toContain('No numeric value found');
  });

  it('does NOT mark a gate indeterminate when the condition is definitely false', async () => {
    const result = await resolve(
      patientWith([{ code: '718-7', system: 'LOINC', value: 13.2, date: RECENT } as never]),
    );
    const gate = result.resolutionState.get('gate-hb')!;

    // The value is present and 13.2 is simply not < 11. The gate ANSWERED.
    expect(gate.indeterminate).toBeFalsy();
    expect(gate.status).toBe(NodeStatus.GATED_OUT);
  });

  it('does not mark a satisfied gate indeterminate', async () => {
    const result = await resolve(
      patientWith([{ code: '718-7', system: 'LOINC', value: 9.1, date: RECENT } as never]),
    );
    const gate = result.resolutionState.get('gate-hb')!;

    expect(gate.indeterminate).toBeFalsy();
    expect(gate.status).toBe(NodeStatus.INCLUDED);
  });
});
