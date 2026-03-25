import { generateCarePlan, validateForGeneration } from '../services/resolution/care-plan-generator';
import { NodeStatus, NodeResult, BlockerType } from '../services/resolution/types';
import type { SignalBreakdown } from '../services/confidence/types';

// ─── Helpers ───────────────────────────────────────────────────────

function makeNode(overrides: Partial<NodeResult> & Pick<NodeResult, 'nodeId' | 'nodeType' | 'title'>): NodeResult {
  return {
    status: NodeStatus.INCLUDED,
    confidence: 0.9,
    confidenceBreakdown: [] as SignalBreakdown[],
    depth: 1,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('CarePlanGenerator', () => {
  describe('validateForGeneration', () => {
    it('should block on empty plan (no included action nodes)', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({ nodeId: 'stage-1', nodeType: 'Stage', title: 'S1', depth: 0 })],
      ]);
      const result = validateForGeneration(state, []);
      expect(result.some(b => b.type === BlockerType.EMPTY_PLAN)).toBe(true);
    });

    it('should block on unresolved red flags', () => {
      const state = new Map<string, NodeResult>([
        ['med-1', makeNode({ nodeId: 'med-1', nodeType: 'Medication', title: 'Med' })],
      ]);
      const redFlags = [{
        nodeId: 'dp-1',
        nodeTitle: 'DP',
        type: 'all_branches_excluded' as const,
        description: 'All excluded',
      }];
      const result = validateForGeneration(state, redFlags);
      expect(result.some(b => b.type === BlockerType.UNRESOLVED_RED_FLAG)).toBe(true);
    });

    it('should block on pending gate questions', () => {
      const state = new Map<string, NodeResult>([
        ['med-1', makeNode({ nodeId: 'med-1', nodeType: 'Medication', title: 'Med' })],
        ['gate-1', makeNode({
          nodeId: 'gate-1', nodeType: 'Gate', title: 'Allergy check',
          status: NodeStatus.PENDING_QUESTION, confidence: 0, depth: 0,
        })],
      ]);
      const result = validateForGeneration(state, []);
      expect(result.some(b => b.type === BlockerType.PENDING_GATE)).toBe(true);
      expect(result.find(b => b.type === BlockerType.PENDING_GATE)!.relatedNodeIds).toContain('gate-1');
    });

    it('should pass validation with included action nodes and no red flags', () => {
      const state = new Map<string, NodeResult>([
        ['med-1', makeNode({ nodeId: 'med-1', nodeType: 'Medication', title: 'Med' })],
      ]);
      const result = validateForGeneration(state, []);
      expect(result.length).toBe(0);
    });
  });

  describe('generateCarePlan', () => {
    it('should map Stage to goal and Medication to intervention', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({ nodeId: 'stage-1', nodeType: 'Stage', title: 'Assessment', depth: 0 })],
        ['med-1', makeNode({
          nodeId: 'med-1', nodeType: 'Medication', title: 'Metformin 500mg',
          confidence: 0.87, depth: 2, parentNodeId: 'stage-1',
        })],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');

      expect(plan.goals.length).toBe(1);
      expect(plan.goals[0].description).toContain('Assessment');
      expect(plan.goals[0].priority).toBe('HIGH');
      expect(plan.goals[0].pathwayNodeId).toBe('stage-1');
      expect(plan.interventions.length).toBe(1);
      expect(plan.interventions[0].type).toBe('MEDICATION');
      expect(plan.interventions[0].description).toContain('Metformin');
      expect(plan.interventions[0].pathwayNodeId).toBe('med-1');
      expect(plan.interventions[0].pathwayId).toBe('pathway-1');
      expect(plan.interventions[0].sessionId).toBe('session-1');
      expect(plan.interventions[0].recommendationConfidence).toBe(0.87);
      expect(plan.interventions[0].source).toBe('pathway_recommendation');
    });

    it('should omit excluded nodes', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({ nodeId: 'stage-1', nodeType: 'Stage', title: 'Stage', depth: 0 })],
        ['med-inc', makeNode({ nodeId: 'med-inc', nodeType: 'Medication', title: 'Included', parentNodeId: 'stage-1' })],
        ['med-exc', makeNode({
          nodeId: 'med-exc', nodeType: 'Medication', title: 'Excluded',
          status: NodeStatus.EXCLUDED, confidence: 0.3, parentNodeId: 'stage-1',
        })],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');
      expect(plan.interventions.length).toBe(1);
      expect(plan.interventions[0].pathwayNodeId).toBe('med-inc');
    });

    it('should mark provider overrides', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({ nodeId: 'stage-1', nodeType: 'Stage', title: 'Stage', depth: 0 })],
        ['med-1', makeNode({
          nodeId: 'med-1', nodeType: 'Medication', title: 'Overridden med',
          confidence: 0.4, parentNodeId: 'stage-1',
          providerOverride: {
            action: 'INCLUDE' as any,
            originalStatus: NodeStatus.EXCLUDED,
            originalConfidence: 0.4,
          },
        })],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');
      expect(plan.interventions[0].source).toBe('provider_override');
    });

    it('should map LabTest to MONITORING intervention', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({ nodeId: 'stage-1', nodeType: 'Stage', title: 'Stage', depth: 0 })],
        ['lab-1', makeNode({
          nodeId: 'lab-1', nodeType: 'LabTest', title: 'CBC',
          confidence: 0.85, parentNodeId: 'stage-1',
        })],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');
      expect(plan.interventions[0].type).toBe('MONITORING');
    });

    it('should map Procedure to PROCEDURE intervention', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({ nodeId: 'stage-1', nodeType: 'Stage', title: 'Stage', depth: 0 })],
        ['proc-1', makeNode({
          nodeId: 'proc-1', nodeType: 'Procedure', title: 'Cesarean',
          confidence: 0.9, parentNodeId: 'stage-1',
        })],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');
      expect(plan.interventions[0].type).toBe('PROCEDURE');
    });

    it('should map Lifestyle and Referral to their types', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({ nodeId: 'stage-1', nodeType: 'Stage', title: 'Stage', depth: 0 })],
        ['life-1', makeNode({
          nodeId: 'life-1', nodeType: 'Lifestyle', title: 'Daily exercise',
          parentNodeId: 'stage-1',
        })],
        ['ref-1', makeNode({
          nodeId: 'ref-1', nodeType: 'Referral', title: 'Cardiology referral',
          parentNodeId: 'stage-1',
          properties: { specialty: 'Cardiology' },
        })],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');
      expect(plan.interventions.length).toBe(2);

      const lifestyle = plan.interventions.find(i => i.pathwayNodeId === 'life-1')!;
      expect(lifestyle.type).toBe('LIFESTYLE');

      const referral = plan.interventions.find(i => i.pathwayNodeId === 'ref-1')!;
      expect(referral.type).toBe('REFERRAL');
      expect(referral.referralSpecialty).toBe('Cardiology');
    });

    it('should skip stages with no included action descendants', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({ nodeId: 'stage-1', nodeType: 'Stage', title: 'Active Stage', depth: 0 })],
        ['med-1', makeNode({ nodeId: 'med-1', nodeType: 'Medication', title: 'Med', parentNodeId: 'stage-1' })],
        ['stage-2', makeNode({ nodeId: 'stage-2', nodeType: 'Stage', title: 'Empty Stage', depth: 0 })],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');
      expect(plan.goals.length).toBe(1);
      expect(plan.goals[0].description).toBe('Active Stage');
    });

    it('should extract medication properties from node properties', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({ nodeId: 'stage-1', nodeType: 'Stage', title: 'Treatment', depth: 0 })],
        ['med-1', makeNode({
          nodeId: 'med-1', nodeType: 'Medication', title: 'Metformin',
          parentNodeId: 'stage-1',
          properties: {
            medication_code: 'RX12345',
            dosage: '500mg',
            frequency: 'twice daily',
          },
        })],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');
      expect(plan.interventions[0].medicationCode).toBe('RX12345');
      expect(plan.interventions[0].dosage).toBe('500mg');
      expect(plan.interventions[0].frequency).toBe('twice daily');
    });

    it('should extract procedure code from properties', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({ nodeId: 'stage-1', nodeType: 'Stage', title: 'Surgery', depth: 0 })],
        ['proc-1', makeNode({
          nodeId: 'proc-1', nodeType: 'Procedure', title: 'Appendectomy',
          parentNodeId: 'stage-1',
          properties: { procedure_code: 'CPT-44970' },
        })],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');
      expect(plan.interventions[0].procedureCode).toBe('CPT-44970');
    });

    it('should collect condition codes from node properties', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', makeNode({
          nodeId: 'stage-1', nodeType: 'Stage', title: 'Stage', depth: 0,
          properties: { condition_codes: ['E11.9', 'I10'] },
        })],
        ['med-1', makeNode({ nodeId: 'med-1', nodeType: 'Medication', title: 'Med', parentNodeId: 'stage-1' })],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');
      expect(plan.conditionCodes).toEqual(['E11.9', 'I10']);
    });
  });
});
