/**
 * Per-recommendation attribution. For each INCLUDED action node, the
 * projection should attach `evidenceGateIds` listing the gate / DP
 * node ids that gated the path to it — siblings under any ancestor
 * along the parentNodeId chain.
 */

import { projectResolutionToCarePlan } from '../services/resolution/care-plan-projection';
import {
  NodeStatus,
  ResolutionState,
  createEmptyDependencyMap,
} from '../services/resolution/types';

type Entry = readonly [string, unknown];

function structural(
  id: string,
  nodeType: 'Stage' | 'Step',
  parentNodeId?: string,
): Entry {
  return [
    id,
    {
      nodeId: id,
      nodeType,
      title: id,
      status: NodeStatus.INCLUDED,
      confidence: 1,
      confidenceBreakdown: [],
      depth: 1,
      parentNodeId,
    },
  ];
}

function gate(
  id: string,
  parentNodeId: string,
  status: NodeStatus = NodeStatus.INCLUDED,
  overrides: { kind?: string; title?: string } = {},
): Entry {
  return [
    id,
    {
      nodeId: id,
      nodeType: 'Gate',
      title: overrides.title ?? id,
      status,
      confidence: 1,
      confidenceBreakdown: [],
      depth: 2,
      parentNodeId,
      properties: { gate_type: overrides.kind ?? 'patient_attribute' },
    },
  ];
}

function dp(id: string, parentNodeId: string, title = id): Entry {
  return [
    id,
    {
      nodeId: id,
      nodeType: 'DecisionPoint',
      title,
      status: NodeStatus.INCLUDED,
      confidence: 1,
      confidenceBreakdown: [],
      depth: 2,
      parentNodeId,
    },
  ];
}

function med(id: string, parentNodeId: string, title = id): Entry {
  return [
    id,
    {
      nodeId: id,
      nodeType: 'Medication',
      title,
      status: NodeStatus.INCLUDED,
      confidence: 0.9,
      confidenceBreakdown: [],
      depth: 3,
      parentNodeId,
      properties: { name: title, role: 'first_line' },
    },
  ];
}

function state(...entries: Entry[]): ResolutionState {
  const m = new Map<string, never>();
  for (const [k, v] of entries) (m as Map<string, unknown>).set(k, v);
  return m as unknown as ResolutionState;
}

const META = { pathwayId: 'p1', pathwayLogicalId: 'p-1', pathwayTitle: 'Test' };

describe('per-recommendation evidence attribution', () => {
  it('attaches siblings gates under the action node\'s Step', () => {
    // stage-1 → step-1 → { gate-bp (INCLUDED), med-amlodipine }
    const s = state(
      structural('stage-1', 'Stage'),
      structural('step-1', 'Step', 'stage-1'),
      gate('gate-bp', 'step-1', NodeStatus.INCLUDED, { title: 'BP > 130' }),
      med('med-amlodipine', 'step-1', 'Amlodipine'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.medications).toHaveLength(1);
    expect(plan.medications[0].evidenceGateIds).toEqual(['gate-bp']);
  });

  it('collects gates at multiple ancestor levels (Step + Stage)', () => {
    const s = state(
      structural('stage-1', 'Stage'),
      gate('gate-stage', 'stage-1', NodeStatus.INCLUDED, { title: 'Adult age' }),
      structural('step-1', 'Step', 'stage-1'),
      gate('gate-step', 'step-1', NodeStatus.INCLUDED, { title: 'BP > 130' }),
      med('med-1', 'step-1'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.medications[0].evidenceGateIds.sort()).toEqual(
      ['gate-stage', 'gate-step'].sort(),
    );
  });

  it('includes DecisionPoint nodes alongside Gates', () => {
    const s = state(
      structural('step-1', 'Step'),
      gate('gate-x', 'step-1', NodeStatus.INCLUDED),
      dp('dp-anemia', 'step-1', 'Anemia severity'),
      med('med-1', 'step-1'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.medications[0].evidenceGateIds.sort()).toEqual(
      ['dp-anemia', 'gate-x'].sort(),
    );
  });

  it('skips EXCLUDED gates (they did not influence the rec)', () => {
    const s = state(
      structural('step-1', 'Step'),
      gate('gate-active', 'step-1', NodeStatus.INCLUDED),
      gate('gate-irrelevant', 'step-1', NodeStatus.EXCLUDED),
      med('med-1', 'step-1'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.medications[0].evidenceGateIds).toEqual(['gate-active']);
  });

  it('includes PENDING_QUESTION gates (they are part of why this fired)', () => {
    // A PENDING_QUESTION sibling under the same Step is asking for context
    // that affects the action node. Author still wants to know it was in
    // the lineage, so attribution captures it (consumer can filter by
    // status if they want only INCLUDED).
    const s = state(
      structural('step-1', 'Step'),
      gate('gate-q', 'step-1', NodeStatus.PENDING_QUESTION, { kind: 'question' }),
      med('med-1', 'step-1'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.medications[0].evidenceGateIds).toEqual(['gate-q']);
  });

  it('returns empty array when no gates exist in the lineage', () => {
    const s = state(
      structural('step-1', 'Step'),
      med('med-1', 'step-1'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.medications[0].evidenceGateIds).toEqual([]);
  });

  it('attributes correctly when multiple recs share the same Step', () => {
    const s = state(
      structural('step-1', 'Step'),
      gate('gate-x', 'step-1', NodeStatus.INCLUDED),
      med('med-A', 'step-1'),
      med('med-B', 'step-1'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.medications).toHaveLength(2);
    for (const m of plan.medications) {
      expect(m.evidenceGateIds).toEqual(['gate-x']);
    }
  });

  it('different Steps see different gates', () => {
    const s = state(
      structural('stage-1', 'Stage'),
      structural('step-A', 'Step', 'stage-1'),
      structural('step-B', 'Step', 'stage-1'),
      gate('gate-A', 'step-A', NodeStatus.INCLUDED),
      gate('gate-B', 'step-B', NodeStatus.INCLUDED),
      med('med-A', 'step-A'),
      med('med-B', 'step-B'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    const medA = plan.medications.find((m) => m.sourceNodeId === 'med-A');
    const medB = plan.medications.find((m) => m.sourceNodeId === 'med-B');
    expect(medA?.evidenceGateIds).toEqual(['gate-A']);
    expect(medB?.evidenceGateIds).toEqual(['gate-B']);
  });

  it('cycle-safe (defensive against pathological parentNodeId chains)', () => {
    // step-A.parentNodeId = step-B, step-B.parentNodeId = step-A — cycle.
    // Walk should terminate and return whatever gates are reachable.
    const s = state(
      [
        'step-A',
        {
          nodeId: 'step-A',
          nodeType: 'Step',
          title: 'A',
          status: NodeStatus.INCLUDED,
          confidence: 1,
          confidenceBreakdown: [],
          depth: 1,
          parentNodeId: 'step-B',
        },
      ],
      [
        'step-B',
        {
          nodeId: 'step-B',
          nodeType: 'Step',
          title: 'B',
          status: NodeStatus.INCLUDED,
          confidence: 1,
          confidenceBreakdown: [],
          depth: 1,
          parentNodeId: 'step-A',
        },
      ],
      gate('gate-A', 'step-A', NodeStatus.INCLUDED),
      med('med-1', 'step-A'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.medications[0].evidenceGateIds.sort()).toEqual(['gate-A'].sort());
  });
});
