/**
 * Evidence-trail emission from the per-pathway projection. Gate +
 * DecisionPoint nodes in the resolution state should produce
 * GateEvidence rows with the patient-context fields each one read
 * (sourced from the dependency map).
 */

import { projectResolutionToCarePlan } from '../services/resolution/care-plan-projection';
import {
  NodeStatus,
  ResolutionState,
  createEmptyDependencyMap,
} from '../services/resolution/types';

function gateNode(
  id: string,
  status: NodeStatus,
  overrides: { gate_type?: string; title?: string; reason?: string } = {},
) {
  return [
    id,
    {
      nodeId: id,
      nodeType: 'Gate',
      title: overrides.title ?? id,
      status,
      confidence: 1,
      confidenceBreakdown: [],
      depth: 1,
      excludeReason: overrides.reason,
      properties: { gate_type: overrides.gate_type ?? 'patient_attribute' },
    },
  ] as const;
}

function dpNode(id: string, status: NodeStatus, title = id) {
  return [
    id,
    {
      nodeId: id,
      nodeType: 'DecisionPoint',
      title,
      status,
      confidence: 1,
      confidenceBreakdown: [],
      depth: 1,
    },
  ] as const;
}

function medNode(id: string, title = id) {
  return [
    id,
    {
      nodeId: id,
      nodeType: 'Medication',
      title,
      status: NodeStatus.INCLUDED,
      confidence: 0.9,
      confidenceBreakdown: [],
      depth: 2,
      properties: { name: title, role: 'first_line' },
    },
  ] as const;
}

function makeState(...entries: Array<readonly [string, unknown]>): ResolutionState {
  const m = new Map<string, never>();
  for (const [k, v] of entries) (m as Map<string, unknown>).set(k, v);
  return m as unknown as ResolutionState;
}

describe('evidence trail in projectResolutionToCarePlan', () => {
  it('emits one entry per included Gate / DecisionPoint with its fields read', () => {
    const state = makeState(
      gateNode('gate-bp', NodeStatus.INCLUDED, {
        gate_type: 'patient_attribute',
        title: 'BP > 130',
        reason: 'vitals 138 > 130',
      }),
      dpNode('dp-anemia', NodeStatus.INCLUDED, 'Anemia severity decision'),
      medNode('med-lisinopril', 'Lisinopril'),
    );
    const depMap = createEmptyDependencyMap();
    depMap.gateContextFields.set('gate-bp', new Set(['vitals']));
    depMap.gateContextFields.set('dp-anemia', new Set(['labs']));

    const plan = projectResolutionToCarePlan(
      state,
      { pathwayId: 'p1', pathwayLogicalId: 'p-1', pathwayTitle: 'HTN' },
      [],
      depMap,
    );

    expect(plan.evidenceTrail).toHaveLength(2);
    const bp = plan.evidenceTrail.find((e) => e.nodeId === 'gate-bp');
    expect(bp).toMatchObject({
      kind: 'patient_attribute',
      status: NodeStatus.INCLUDED,
      title: 'BP > 130',
      reason: 'vitals 138 > 130',
      fieldsRead: ['vitals'],
    });
    const dp = plan.evidenceTrail.find((e) => e.nodeId === 'dp-anemia');
    expect(dp?.kind).toBe('decision_point');
    expect(dp?.fieldsRead).toEqual(['labs']);
  });

  it('still emits gates whose fields were not recorded (empty fieldsRead)', () => {
    const state = makeState(
      gateNode('gate-question', NodeStatus.PENDING_QUESTION, {
        gate_type: 'question',
        title: 'Patient symptom check',
      }),
      medNode('m1'),
    );
    const plan = projectResolutionToCarePlan(
      state,
      { pathwayId: 'p1', pathwayLogicalId: 'p-1', pathwayTitle: 'X' },
      [],
      createEmptyDependencyMap(),
    );
    expect(plan.evidenceTrail).toHaveLength(1);
    expect(plan.evidenceTrail[0].kind).toBe('question');
    expect(plan.evidenceTrail[0].fieldsRead).toEqual([]);
  });

  it('skips EXCLUDED gates — they did not contribute', () => {
    const state = makeState(
      gateNode('gate-excluded', NodeStatus.EXCLUDED),
      gateNode('gate-included', NodeStatus.INCLUDED),
      medNode('m1'),
    );
    const plan = projectResolutionToCarePlan(
      state,
      { pathwayId: 'p1', pathwayLogicalId: 'p-1', pathwayTitle: 'X' },
      [],
      createEmptyDependencyMap(),
    );
    expect(plan.evidenceTrail.map((e) => e.nodeId)).toEqual(['gate-included']);
  });

  it('emits GATED_OUT gates — provider may want to know why a path was blocked', () => {
    const state = makeState(
      gateNode('gate-blocked', NodeStatus.GATED_OUT, {
        reason: 'No matching code Z99.0 in conditions',
      }),
    );
    const plan = projectResolutionToCarePlan(
      state,
      { pathwayId: 'p1', pathwayLogicalId: 'p-1', pathwayTitle: 'X' },
      [],
      createEmptyDependencyMap(),
    );
    expect(plan.evidenceTrail).toHaveLength(1);
    expect(plan.evidenceTrail[0].status).toBe(NodeStatus.GATED_OUT);
    expect(plan.evidenceTrail[0].reason).toMatch(/Z99\.0/);
  });

  it('returns an empty array when there are no gates', () => {
    const state = makeState(medNode('m1'));
    const plan = projectResolutionToCarePlan(
      state,
      { pathwayId: 'p1', pathwayLogicalId: 'p-1', pathwayTitle: 'X' },
    );
    expect(plan.evidenceTrail).toEqual([]);
  });

  it('handles missing dependencyMap gracefully (no fieldsRead)', () => {
    const state = makeState(gateNode('g1', NodeStatus.INCLUDED));
    const plan = projectResolutionToCarePlan(
      state,
      { pathwayId: 'p1', pathwayLogicalId: 'p-1', pathwayTitle: 'X' },
      // dependencyMap omitted
    );
    expect(plan.evidenceTrail[0].fieldsRead).toEqual([]);
  });
});
