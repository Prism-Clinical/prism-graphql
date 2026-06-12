/**
 * findUnmetPrerequisites — covers satisfaction predicates, transitive
 * REQUIRES walking, cycle safety, and the no-check default.
 */

import { findUnmetPrerequisites } from '../services/resolution/prerequisites';
import { buildGraphContext } from '../resolvers/helpers/resolution-context';
import type {
  GraphNode,
  GraphEdge,
  PatientContext,
} from '../services/confidence/types';

function makeNode(
  id: string,
  type: string,
  properties: Record<string, unknown> = {},
): GraphNode {
  return {
    id: `age-${id}`,
    nodeIdentifier: id,
    nodeType: type,
    properties: { title: id, ...properties },
  };
}

function makeEdge(
  from: string,
  to: string,
  edgeType: string,
): GraphEdge {
  return {
    id: `e-${from}-${edgeType}-${to}`,
    edgeType,
    sourceId: from,
    targetId: to,
    properties: {},
  };
}

function emptyContext(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    patientId: 'pt-test',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
    ...overrides,
  };
}

describe('findUnmetPrerequisites', () => {
  it('returns [] when the start node has no REQUIRES edges', () => {
    const graph = buildGraphContext(
      [makeNode('stage-28w', 'Stage')],
      [],
    );
    expect(findUnmetPrerequisites('stage-28w', emptyContext(), graph)).toEqual([]);
  });

  it('flags a direct prereq with no satisfaction_check as unmet', () => {
    const graph = buildGraphContext(
      [
        makeNode('stage-28w', 'Stage'),
        makeNode('stage-20w', 'Stage'),
      ],
      [makeEdge('stage-28w', 'stage-20w', 'REQUIRES')],
    );
    const result = findUnmetPrerequisites('stage-28w', emptyContext(), graph);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      nodeId: 'stage-20w',
      dependentNodeId: 'stage-28w',
      reason: 'no-satisfaction-check',
    });
  });

  it('treats code satisfaction as satisfied when the code is in the snapshot', () => {
    const graph = buildGraphContext(
      [
        makeNode('stage-28w', 'Stage'),
        makeNode('stage-20w', 'Stage', {
          satisfaction_check: { type: 'code', code: '76811', system: 'CPT' },
        }),
      ],
      [makeEdge('stage-28w', 'stage-20w', 'REQUIRES')],
    );
    const ctx = emptyContext({
      labResults: [{ code: '76811', system: 'CPT' }],
    });
    expect(findUnmetPrerequisites('stage-28w', ctx, graph)).toEqual([]);
  });

  it('flags code satisfaction as unmet when the code is absent', () => {
    const graph = buildGraphContext(
      [
        makeNode('stage-28w', 'Stage'),
        makeNode('stage-20w', 'Stage', {
          satisfaction_check: { type: 'code', code: '76811', system: 'CPT' },
        }),
      ],
      [makeEdge('stage-28w', 'stage-20w', 'REQUIRES')],
    );
    const result = findUnmetPrerequisites('stage-28w', emptyContext(), graph);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('code-not-in-snapshot');
  });

  it('recurses through transitive prereqs when an intermediate is unmet', () => {
    // 28w -REQUIRES-> 20w -REQUIRES-> initial-visit
    // None satisfied — all three should surface, deepest first.
    const graph = buildGraphContext(
      [
        makeNode('stage-28w', 'Stage'),
        makeNode('stage-20w', 'Stage'),
        makeNode('stage-initial', 'Stage'),
      ],
      [
        makeEdge('stage-28w', 'stage-20w', 'REQUIRES'),
        makeEdge('stage-20w', 'stage-initial', 'REQUIRES'),
      ],
    );
    const result = findUnmetPrerequisites('stage-28w', emptyContext(), graph);
    expect(result.map((r) => r.nodeId)).toEqual(['stage-initial', 'stage-20w']);
  });

  it('stops recursion at the first satisfied prereq', () => {
    // 28w -REQUIRES-> 20w (satisfied) -REQUIRES-> initial (would be unmet)
    // 20w satisfaction breaks the chain — initial doesn't surface.
    const graph = buildGraphContext(
      [
        makeNode('stage-28w', 'Stage'),
        makeNode('stage-20w', 'Stage', {
          satisfaction_check: { type: 'code', code: '76811', system: 'CPT' },
        }),
        makeNode('stage-initial', 'Stage'),
      ],
      [
        makeEdge('stage-28w', 'stage-20w', 'REQUIRES'),
        makeEdge('stage-20w', 'stage-initial', 'REQUIRES'),
      ],
    );
    const ctx = emptyContext({
      labResults: [{ code: '76811', system: 'CPT' }],
    });
    expect(findUnmetPrerequisites('stage-28w', ctx, graph)).toEqual([]);
  });

  it('is cycle-safe via a visited set', () => {
    // A -REQUIRES-> B -REQUIRES-> A. The validator would reject this at
    // publish but the resolver must terminate either way.
    const graph = buildGraphContext(
      [makeNode('A', 'Stage'), makeNode('B', 'Stage')],
      [
        makeEdge('A', 'B', 'REQUIRES'),
        makeEdge('B', 'A', 'REQUIRES'),
      ],
    );
    const result = findUnmetPrerequisites('A', emptyContext(), graph);
    expect(result.map((r) => r.nodeId).sort()).toEqual(['A', 'B'].sort());
  });

  it('attestation predicate is always unsatisfied', () => {
    const graph = buildGraphContext(
      [
        makeNode('stage-28w', 'Stage'),
        makeNode('stage-edu', 'Step', {
          satisfaction_check: { type: 'attestation', label: 'Initial education delivered' },
        }),
      ],
      [makeEdge('stage-28w', 'stage-edu', 'REQUIRES')],
    );
    const ctx = emptyContext({
      // Even with a matching code in the snapshot, attestation doesn't
      // probe — it always asks the provider.
      labResults: [{ code: 'whatever', system: 'LOINC' }],
    });
    const result = findUnmetPrerequisites('stage-28w', ctx, graph);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('attestation-required');
  });

  it('matches codes against any patient context bucket', () => {
    // Prereq satisfied if the code is in conditionCodes (not just labs).
    const graph = buildGraphContext(
      [
        makeNode('stage-followup', 'Stage'),
        makeNode('stage-diagnosis', 'Stage', {
          satisfaction_check: { type: 'code', code: 'D50.9', system: 'ICD-10' },
        }),
      ],
      [makeEdge('stage-followup', 'stage-diagnosis', 'REQUIRES')],
    );
    const ctx = emptyContext({
      conditionCodes: [{ code: 'D50.9', system: 'ICD-10' }],
    });
    expect(findUnmetPrerequisites('stage-followup', ctx, graph)).toEqual([]);
  });

  it('non-REQUIRES outgoing edges are ignored', () => {
    // HAS_STEP from a Stage to its Steps shouldn't be misinterpreted as
    // a prereq edge.
    const graph = buildGraphContext(
      [makeNode('stage-A', 'Stage'), makeNode('step-A1', 'Step')],
      [makeEdge('stage-A', 'step-A1', 'HAS_STEP')],
    );
    expect(findUnmetPrerequisites('stage-A', emptyContext(), graph)).toEqual([]);
  });
});
