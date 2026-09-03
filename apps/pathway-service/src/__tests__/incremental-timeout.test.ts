/**
 * An incremental resolve that times out must not silently EAT the session.
 *
 * `resolveIncrementally` deletes the region it is about to rebuild, so a
 * timeout partway through leaves nodes that existed a moment ago simply
 * absent — and the caller persists that map. The old code then reported
 * `isDegraded: false` and `nodesRecomputed: region.size`, so a partial
 * rebuild was indistinguishable from a complete one.
 *
 * A full traversal cannot do this: it has merely not REACHED a node yet.
 * Only the incremental path deletes first, which is why it needs its own
 * guarantee — every region member ends up present, either rebuilt or TIMEOUT.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { NodeStatus, TRAVERSAL_TIMEOUT_MS } from '../services/resolution/types';
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

/** A chain deep enough that a mid-walk timeout leaves work undone. */
function chain() {
  return makeGraphContext(
    [
      node('root', 'Pathway'),
      node('step-1', 'Step'), node('step-2', 'Step'),
      node('step-3', 'Step'), node('step-4', 'Step'),
    ],
    [
      edge('root', 'step-1'), edge('step-1', 'step-2'),
      edge('step-2', 'step-3'), edge('step-3', 'step-4'),
    ],
  );
}

afterEach(() => jest.restoreAllMocks());
beforeEach(() => jest.clearAllMocks());

describe('an incremental resolve that times out', () => {
  /** Real time for the first `grace` reads, then far past the deadline. */
  function clockThatTripsAfter(grace: number) {
    const real = Date.now();
    let calls = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      calls++;
      return calls <= grace ? real : real + TRAVERSAL_TIMEOUT_MS + 1;
    });
  }

  it('leaves every node present — rebuilt or TIMEOUT, never absent', async () => {
    const graph = chain();
    const full = await engine().traverse(graph, PATIENT, new Map());
    const before = [...full.resolutionState.keys()].sort();
    expect(before.length).toBeGreaterThan(1);

    clockThatTripsAfter(2);
    const r = await engine().resolveIncrementally(
      new Set(['step-1']),
      full.resolutionState,
      full.dependencyMap,
      graph,
      PATIENT,
      new Map(),
    );

    // The invariant: nothing the session had was erased.
    expect([...full.resolutionState.keys()].sort()).toEqual(before);
    expect(r.isDegraded).toBe(true);
  });

  it('marks what it could not rebuild as TIMEOUT rather than leaving it stale', async () => {
    const graph = chain();
    const full = await engine().traverse(graph, PATIENT, new Map());

    clockThatTripsAfter(2);
    await engine().resolveIncrementally(
      new Set(['step-1']),
      full.resolutionState,
      full.dependencyMap,
      graph,
      PATIENT,
      new Map(),
    );

    const timedOut = [...full.resolutionState.values()]
      .filter(n => n.status === NodeStatus.TIMEOUT);
    expect(timedOut.length).toBeGreaterThan(0);
    expect(timedOut[0].excludeReason).toMatch(/timeout/i);
  });

  it('reports what it actually disposed, not what it meant to', async () => {
    const graph = chain();
    const full = await engine().traverse(graph, PATIENT, new Map());

    clockThatTripsAfter(2);
    const r = await engine().resolveIncrementally(
      new Set(['step-1']),
      full.resolutionState,
      full.dependencyMap,
      graph,
      PATIENT,
      new Map(),
    );

    // The region is step-1..step-4; a walk cut short cannot have done them all.
    expect(r.nodesRecomputed).toBeLessThan(4);
  });

  it('reports no degradation and a full count when it completes', async () => {
    const graph = chain();
    const full = await engine().traverse(graph, PATIENT, new Map());

    const r = await engine().resolveIncrementally(
      new Set(['step-1']),
      full.resolutionState,
      full.dependencyMap,
      graph,
      PATIENT,
      new Map(),
    );

    expect(r.isDegraded).toBe(false);
    expect(r.nodesRecomputed).toBe(4);
    expect([...full.resolutionState.values()].some(n => n.status === NodeStatus.TIMEOUT)).toBe(false);
  });
});
