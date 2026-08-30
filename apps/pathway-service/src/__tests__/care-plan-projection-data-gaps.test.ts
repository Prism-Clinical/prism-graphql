/**
 * Data-gap hints emitted by the projection. Each non-firing gate
 * (GATED_OUT, PENDING_QUESTION, UNKNOWN) should surface the
 * recommendations its subtree would have unlocked. Relies on
 * markSubtree's invariant that every gated-out descendant carries the
 * gate's id as parentNodeId.
 */

import { projectResolutionToCarePlan } from '../services/resolution/care-plan-projection';
import {
  NodeStatus,
  ResolutionState,
  createEmptyDependencyMap,
} from '../services/resolution/types';

type Entry = readonly [string, unknown];

function gate(
  id: string,
  status: NodeStatus,
  overrides: {
    gate_type?: string;
    title?: string;
    reason?: string;
    indeterminate?: boolean;
    dataUnavailable?: boolean;
  } = {},
): Entry {
  return [
    id,
    {
      nodeId: id,
      nodeType: 'Gate',
      title: overrides.title ?? id,
      status,
      confidence: status === NodeStatus.INCLUDED ? 1 : 0,
      confidenceBreakdown: [],
      depth: 1,
      excludeReason: overrides.reason,
      indeterminate: overrides.indeterminate,
      dataUnavailable: overrides.dataUnavailable,
      properties: { gate_type: overrides.gate_type ?? 'patient_attribute' },
    },
  ];
}

function action(
  id: string,
  nodeType: string,
  status: NodeStatus,
  parentNodeId: string | undefined,
  title = id,
): Entry {
  return [
    id,
    {
      nodeId: id,
      nodeType,
      title,
      status,
      confidence: status === NodeStatus.INCLUDED ? 0.9 : 0,
      confidenceBreakdown: [],
      depth: 2,
      parentNodeId,
      properties: { name: title },
    },
  ];
}

function state(...entries: Entry[]): ResolutionState {
  const m = new Map<string, never>();
  for (const [k, v] of entries) (m as Map<string, unknown>).set(k, v);
  return m as unknown as ResolutionState;
}

const META = { pathwayId: 'p1', pathwayLogicalId: 'p-1', pathwayTitle: 'Test' };

describe('data-gap hints in projectResolutionToCarePlan', () => {
  it('surfaces a GATED_OUT gate with its downstream recommendations', () => {
    const dep = createEmptyDependencyMap();
    dep.gateContextFields.set('gate-bp-high', new Set(['vitals.systolic_bp']));
    const s = state(
      gate('gate-bp-high', NodeStatus.GATED_OUT, {
        gate_type: 'patient_attribute',
        title: 'BP > 160',
        reason: 'No vitals.systolic_bp value',
      }),
      action('med-amlodipine', 'Medication', NodeStatus.GATED_OUT, 'gate-bp-high', 'Amlodipine'),
      action('lab-pra', 'LabTest', NodeStatus.GATED_OUT, 'gate-bp-high', 'Plasma renin'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], dep);
    expect(plan.dataGapHints).toHaveLength(1);
    const h = plan.dataGapHints[0];
    expect(h.gateNodeId).toBe('gate-bp-high');
    expect(h.fieldsRead).toEqual(['vitals.systolic_bp']);
    expect(h.unlockedRecommendations.map((r) => r.nodeId).sort()).toEqual(
      ['lab-pra', 'med-amlodipine'].sort(),
    );
  });

  it('handles PENDING_QUESTION gates the same way', () => {
    const s = state(
      gate('gate-q', NodeStatus.PENDING_QUESTION, {
        gate_type: 'question',
        title: 'Patient symptom check',
      }),
      action('proc-followup', 'Procedure', NodeStatus.PENDING_QUESTION, 'gate-q', 'Symptom follow-up'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.dataGapHints).toHaveLength(1);
    expect(plan.dataGapHints[0].kind).toBe('question');
    expect(plan.dataGapHints[0].unlockedRecommendations[0].title).toBe('Symptom follow-up');
  });

  it('does NOT surface a gate that has no downstream action nodes', () => {
    // Gated out, but no Medication / LabTest / etc. under it.
    const s = state(
      gate('gate-empty', NodeStatus.GATED_OUT),
      // Only structural nodes below — Stage isn't in ACTION_NODE_TYPES.
      action('stage-X', 'Stage', NodeStatus.GATED_OUT, 'gate-empty', 'Some Stage'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.dataGapHints).toEqual([]);
  });

  it('does NOT surface INCLUDED gates (those go in evidenceTrail)', () => {
    const s = state(
      gate('gate-ok', NodeStatus.INCLUDED),
      action('med-ok', 'Medication', NodeStatus.INCLUDED, 'gate-ok'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.dataGapHints).toEqual([]);
    expect(plan.evidenceTrail.map((e) => e.nodeId)).toEqual(['gate-ok']);
  });

  it('emits hints for multiple closed-off gates independently', () => {
    const s = state(
      gate('gate-bp', NodeStatus.GATED_OUT, { title: 'BP threshold' }),
      gate('gate-a1c', NodeStatus.PENDING_QUESTION, {
        gate_type: 'question',
        title: 'Recent hypoglycemia?',
      }),
      action('med-bp', 'Medication', NodeStatus.GATED_OUT, 'gate-bp', 'ACE-I'),
      action('med-metformin', 'Medication', NodeStatus.PENDING_QUESTION, 'gate-a1c', 'Metformin'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    expect(plan.dataGapHints).toHaveLength(2);
    const bp = plan.dataGapHints.find((h) => h.gateNodeId === 'gate-bp');
    const a1c = plan.dataGapHints.find((h) => h.gateNodeId === 'gate-a1c');
    expect(bp?.unlockedRecommendations[0].title).toBe('ACE-I');
    expect(a1c?.kind).toBe('question');
    expect(a1c?.unlockedRecommendations[0].title).toBe('Metformin');
  });

  it('reports fieldsRead from the dependency map when present', () => {
    const dep = createEmptyDependencyMap();
    dep.gateContextFields.set('gate-hba1c', new Set(['labs']));
    const s = state(
      gate('gate-hba1c', NodeStatus.GATED_OUT, { title: 'HbA1c series ≥3 points' }),
      action('med-titration', 'Medication', NodeStatus.GATED_OUT, 'gate-hba1c'),
    );
    const plan = projectResolutionToCarePlan(s, META, [], dep);
    expect(plan.dataGapHints[0].fieldsRead).toEqual(['labs']);
  });

  it('falls back to empty fieldsRead when dependencyMap is omitted', () => {
    const s = state(
      gate('g', NodeStatus.GATED_OUT),
      action('m', 'Medication', NodeStatus.GATED_OUT, 'g'),
    );
    const plan = projectResolutionToCarePlan(s, META);
    expect(plan.dataGapHints[0].fieldsRead).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('data-gap hints separate real gaps from real answers', () => {
  // "Add this data → unlocks N recommendations" is only honest for a gate that
  // LACKED data. A gate the patient definitely failed is an answer, not a gap,
  // and prompting for more data there sends a clinician after something that
  // would not change the plan.
  it('flags which gaps are missing data, unorderable data, or neither', () => {
    const s = state(
      gate('gate-missing', NodeStatus.GATED_OUT, {
        title: 'Ferritin low?',
        reason: 'No numeric value found for labs:2276-4',
        indeterminate: false,
        dataUnavailable: true,
      }),
      action('med-iron', 'Medication', NodeStatus.GATED_OUT, 'gate-missing', 'Ferrous sulfate'),
      gate('gate-ambiguous', NodeStatus.GATED_OUT, {
        title: 'Anemic?',
        reason: 'Indeterminate numeric value for labs:718-7',
        indeterminate: true,
        dataUnavailable: false,
      }),
      action('lab-cbc', 'LabTest', NodeStatus.GATED_OUT, 'gate-ambiguous', 'CBC'),
      gate('gate-failed', NodeStatus.GATED_OUT, {
        title: 'Severe?',
        reason: 'labs value 10 not < 7',
        indeterminate: false,
        dataUnavailable: false,
      }),
      action('med-iv', 'Medication', NodeStatus.GATED_OUT, 'gate-failed', 'IV iron'),
    );

    const plan = projectResolutionToCarePlan(s, META, [], createEmptyDependencyMap());
    const byId = (id: string) => plan.dataGapHints.find((h) => h.gateNodeId === id)!;

    expect(byId('gate-missing').dataUnavailable).toBe(true);
    expect(byId('gate-missing').indeterminate).toBe(false);

    expect(byId('gate-ambiguous').indeterminate).toBe(true);
    expect(byId('gate-ambiguous').dataUnavailable).toBe(false);

    // Still emitted — the provider may want to know why a path was blocked —
    // but flagged as neither kind of gap.
    expect(byId('gate-failed').indeterminate).toBe(false);
    expect(byId('gate-failed').dataUnavailable).toBe(false);
  });
});
