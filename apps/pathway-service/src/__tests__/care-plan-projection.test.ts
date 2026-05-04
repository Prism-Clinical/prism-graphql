import { projectResolutionToCarePlan } from '../services/resolution/care-plan-projection';
import {
  NodeResult,
  NodeStatus,
  ResolutionState,
} from '../services/resolution/types';

// ─── Fixtures ────────────────────────────────────────────────────────

function makeNode(partial: Partial<NodeResult> & {
  nodeId: string;
  nodeType: string;
}): NodeResult {
  return {
    nodeId: partial.nodeId,
    nodeType: partial.nodeType,
    title: partial.title ?? partial.nodeId,
    status: partial.status ?? NodeStatus.INCLUDED,
    confidence: partial.confidence ?? 1,
    confidenceBreakdown: partial.confidenceBreakdown ?? [],
    parentNodeId: partial.parentNodeId,
    depth: partial.depth ?? 1,
    properties: partial.properties,
    excludeReason: partial.excludeReason,
    providerOverride: partial.providerOverride,
  };
}

function makeState(nodes: NodeResult[]): ResolutionState {
  const m: ResolutionState = new Map();
  for (const n of nodes) m.set(n.nodeId, n);
  return m;
}

const META = {
  pathwayId: 'p-1',
  pathwayLogicalId: 'lp-htn',
  pathwayTitle: 'Hypertension',
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('projectResolutionToCarePlan — basic projection', () => {
  it('returns empty arrays when state has no projectable nodes', () => {
    const state = makeState([
      makeNode({ nodeId: 'stage-1', nodeType: 'Stage' }),
      makeNode({ nodeId: 'step-1', nodeType: 'Step' }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result).toEqual({
      pathwayId: 'p-1',
      pathwayLogicalId: 'lp-htn',
      pathwayTitle: 'Hypertension',
      medications: [],
      labs: [],
      procedures: [],
      schedules: [],
      qualityMetrics: [],
    });
  });

  it('projects an INCLUDED Medication with all properties', () => {
    const state = makeState([
      makeNode({
        nodeId: 'med-1',
        nodeType: 'Medication',
        properties: {
          name: 'Lisinopril',
          role: 'first_line',
          dose: '10 mg',
          frequency: 'daily',
          duration: '90 days',
          route: 'oral',
        },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.medications).toEqual([
      {
        name: 'Lisinopril',
        role: 'first_line',
        dose: '10 mg',
        frequency: 'daily',
        duration: '90 days',
        route: 'oral',
        sourcePathwayId: 'p-1',
        sourceNodeId: 'med-1',
      },
    ]);
  });

  it('falls back to dosage when dose is absent', () => {
    const state = makeState([
      makeNode({
        nodeId: 'med-1',
        nodeType: 'Medication',
        properties: { name: 'Metformin', role: 'first_line', dosage: '500 mg' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.medications[0].dose).toBe('500 mg');
  });

  it('falls back to title when name property is missing', () => {
    const state = makeState([
      makeNode({
        nodeId: 'med-1',
        nodeType: 'Medication',
        title: 'Some Med',
        properties: { role: 'first_line' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.medications[0].name).toBe('Some Med');
  });

  it('drops a Medication with no role (cannot be merged safely)', () => {
    const state = makeState([
      makeNode({
        nodeId: 'med-1',
        nodeType: 'Medication',
        properties: { name: 'Lisinopril' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.medications).toEqual([]);
  });
});

describe('projectResolutionToCarePlan — status filtering', () => {
  it('skips EXCLUDED nodes', () => {
    const state = makeState([
      makeNode({
        nodeId: 'med-1',
        nodeType: 'Medication',
        status: NodeStatus.EXCLUDED,
        properties: { name: 'X', role: 'first_line' },
      }),
    ]);
    expect(projectResolutionToCarePlan(state, META).medications).toEqual([]);
  });

  it('skips GATED_OUT nodes', () => {
    const state = makeState([
      makeNode({
        nodeId: 'lab-1',
        nodeType: 'LabTest',
        status: NodeStatus.GATED_OUT,
        properties: { name: 'A1c' },
      }),
    ]);
    expect(projectResolutionToCarePlan(state, META).labs).toEqual([]);
  });

  it('skips PENDING_QUESTION nodes', () => {
    const state = makeState([
      makeNode({
        nodeId: 'proc-1',
        nodeType: 'Procedure',
        status: NodeStatus.PENDING_QUESTION,
        properties: { name: 'Echocardiogram' },
      }),
    ]);
    expect(projectResolutionToCarePlan(state, META).procedures).toEqual([]);
  });

  it('keeps a Medication that was INCLUDED via provider override', () => {
    const state = makeState([
      makeNode({
        nodeId: 'med-1',
        nodeType: 'Medication',
        status: NodeStatus.INCLUDED,
        providerOverride: {
          action: 'INCLUDE' as never,
          originalStatus: NodeStatus.EXCLUDED,
          originalConfidence: 0.2,
        },
        properties: { name: 'Lisinopril', role: 'first_line' },
      }),
    ]);
    expect(projectResolutionToCarePlan(state, META).medications).toHaveLength(1);
  });
});

describe('projectResolutionToCarePlan — labs / procedures / schedules / quality metrics', () => {
  it('projects a LabTest with code+system', () => {
    const state = makeState([
      makeNode({
        nodeId: 'lab-1',
        nodeType: 'LabTest',
        properties: { name: 'A1c', code: '4548-4', system: 'LOINC', specimen: 'blood' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.labs).toEqual([
      {
        name: 'A1c',
        code: '4548-4',
        system: 'LOINC',
        specimen: 'blood',
        sourcePathwayId: 'p-1',
        sourceNodeId: 'lab-1',
      },
    ]);
  });

  it('projects a LabTest without code/system (name only)', () => {
    const state = makeState([
      makeNode({
        nodeId: 'lab-1',
        nodeType: 'LabTest',
        properties: { name: 'BMP' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.labs).toHaveLength(1);
    expect(result.labs[0].code).toBeUndefined();
  });

  it('projects a Procedure, falling back to procedure_code when code is absent', () => {
    const state = makeState([
      makeNode({
        nodeId: 'proc-1',
        nodeType: 'Procedure',
        properties: { name: 'Echocardiogram', procedure_code: '93306', system: 'CPT' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.procedures[0].code).toBe('93306');
  });

  it('drops a Schedule that is missing interval or description', () => {
    const state = makeState([
      makeNode({
        nodeId: 's-1',
        nodeType: 'Schedule',
        properties: { interval: '3 months' }, // missing description
      }),
      makeNode({
        nodeId: 's-2',
        nodeType: 'Schedule',
        properties: { description: 'follow-up' }, // missing interval
      }),
      makeNode({
        nodeId: 's-3',
        nodeType: 'Schedule',
        properties: { interval: 'monthly', description: 'BP check' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].interval).toBe('monthly');
  });

  it('drops a QualityMetric without measure, keeps one with', () => {
    const state = makeState([
      makeNode({
        nodeId: 'qm-1',
        nodeType: 'QualityMetric',
        properties: { name: 'BP control' }, // missing measure
      }),
      makeNode({
        nodeId: 'qm-2',
        nodeType: 'QualityMetric',
        properties: { name: 'A1c <7', measure: 'a1c < 7' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.qualityMetrics).toHaveLength(1);
    expect(result.qualityMetrics[0].measure).toBe('a1c < 7');
  });
});

describe('projectResolutionToCarePlan — provenance', () => {
  it('stamps every projected item with sourcePathwayId from metadata', () => {
    const state = makeState([
      makeNode({
        nodeId: 'med-1',
        nodeType: 'Medication',
        properties: { name: 'X', role: 'first_line' },
      }),
      makeNode({
        nodeId: 'lab-1',
        nodeType: 'LabTest',
        properties: { name: 'Y' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, {
      pathwayId: 'pw-special',
      pathwayLogicalId: 'lp-special',
      pathwayTitle: 'Special',
    });
    expect(result.medications[0].sourcePathwayId).toBe('pw-special');
    expect(result.labs[0].sourcePathwayId).toBe('pw-special');
  });

  it('records sourceNodeId so downstream consumers can trace back', () => {
    const state = makeState([
      makeNode({
        nodeId: 'unique-med-id-99',
        nodeType: 'Medication',
        properties: { name: 'X', role: 'first_line' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.medications[0].sourceNodeId).toBe('unique-med-id-99');
  });
});

describe('projectResolutionToCarePlan — mixed-bag scenarios', () => {
  it('projects a fully populated single-pathway resolution', () => {
    const state = makeState([
      makeNode({ nodeId: 'stage', nodeType: 'Stage' }),
      makeNode({ nodeId: 'step', nodeType: 'Step', parentNodeId: 'stage' }),
      makeNode({
        nodeId: 'med-1',
        nodeType: 'Medication',
        parentNodeId: 'step',
        properties: { name: 'Lisinopril', role: 'first_line' },
      }),
      makeNode({
        nodeId: 'med-2',
        nodeType: 'Medication',
        parentNodeId: 'step',
        properties: { name: 'NSAIDs', role: 'avoid' },
      }),
      makeNode({
        nodeId: 'lab-1',
        nodeType: 'LabTest',
        parentNodeId: 'step',
        properties: { name: 'BMP' },
      }),
      makeNode({
        nodeId: 'sched-1',
        nodeType: 'Schedule',
        parentNodeId: 'step',
        properties: { interval: 'monthly', description: 'BP check' },
      }),
      makeNode({
        nodeId: 'qm-1',
        nodeType: 'QualityMetric',
        parentNodeId: 'step',
        properties: { name: 'BP <130', measure: 'sbp < 130' },
      }),
      // Should be ignored (not a projectable type)
      makeNode({
        nodeId: 'crit-1',
        nodeType: 'Criterion',
        parentNodeId: 'step',
        properties: { description: 'patient is adult' },
      }),
    ]);
    const result = projectResolutionToCarePlan(state, META);
    expect(result.medications).toHaveLength(2);
    expect(result.labs).toHaveLength(1);
    expect(result.schedules).toHaveLength(1);
    expect(result.qualityMetrics).toHaveLength(1);
    // The 'avoid' medication still goes through — merge layer applies suppression.
    expect(result.medications.map((m) => m.role)).toContain('avoid');
  });
});
