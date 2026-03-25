// apps/pathway-service/src/__tests__/data-completeness-scorer.test.ts

import { DataCompletenessScorer } from '../services/confidence/scorers/data-completeness';
import {
  GraphNode,
  GraphEdge,
  SignalDefinition,
  ScorerParams,
  PatientContext,
  ScoringType,
  PropagationConfig,
} from '../services/confidence/types';
import { REFERENCE_PATIENT, EMPTY_PATIENT, makeGraphContext } from './fixtures/reference-patient-context';

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'age-1',
    nodeIdentifier: 'lab-1',
    nodeType: 'LabTest',
    properties: { name: 'Complete Blood Count', code_system: 'LOINC', code_value: '58410-2' },
    ...overrides,
  };
}

function makeSignalDef(): SignalDefinition {
  return {
    id: '00000000-0000-4000-a000-000000000001',
    name: 'data_completeness',
    displayName: 'Data Completeness',
    description: 'Measures data availability',
    scoringType: ScoringType.DATA_PRESENCE,
    scoringRules: {},
    propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
    scope: 'SYSTEM',
    defaultWeight: 0.30,
    isActive: true,
  };
}

describe('DataCompletenessScorer', () => {
  const scorer = new DataCompletenessScorer();

  it('should have scoringType DATA_PRESENCE', () => {
    expect(scorer.scoringType).toBe(ScoringType.DATA_PRESENCE);
  });

  describe('declareRequiredInputs', () => {
    it('should require result_value and result_date for LabTest nodes', () => {
      const node = makeNode({ nodeType: 'LabTest' });
      const inputs = scorer.declareRequiredInputs(node, makeSignalDef());
      const names = inputs.map(i => i.name);
      expect(names).toContain('result_value');
      expect(names).toContain('result_date');
    });

    it('should require allergies_checked and interactions_checked for Medication nodes', () => {
      const node = makeNode({ nodeType: 'Medication', nodeIdentifier: 'med-1', properties: { name: 'Oxytocin', role: 'acceptable' } });
      const inputs = scorer.declareRequiredInputs(node, makeSignalDef());
      const names = inputs.map(i => i.name);
      expect(names).toContain('allergies_checked');
      expect(names).toContain('interactions_checked');
    });
  });

  describe('score', () => {
    it('should score 1.0 when a LabTest has a matching lab result with value', () => {
      const node = makeNode({
        nodeType: 'LabTest',
        properties: { name: 'CBC', code_system: 'LOINC', code_value: '58410-2' },
      });
      const patient: PatientContext = {
        ...REFERENCE_PATIENT,
        labResults: [{ code: '58410-2', system: 'LOINC', value: 8.2, unit: '10*3/uL', date: '2026-03-20' }],
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: patient,
        graphContext: makeGraphContext([node]),
      });
      expect(result.score).toBe(1.0);
      expect(result.missingInputs).toHaveLength(0);
    });

    it('should score 0.5 when a LabTest has a matching result but no value', () => {
      const node = makeNode({
        nodeType: 'LabTest',
        properties: { name: 'CBC', code_system: 'LOINC', code_value: '58410-2' },
      });
      const patient: PatientContext = {
        ...REFERENCE_PATIENT,
        labResults: [{ code: '58410-2', system: 'LOINC', date: '2026-03-20' }],
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: patient,
        graphContext: makeGraphContext([node]),
      });
      expect(result.score).toBe(0.5);
      expect(result.missingInputs).toContain('result_value');
    });

    it('should score 0.0 when no matching lab result exists', () => {
      const node = makeNode({
        nodeType: 'LabTest',
        properties: { name: 'CBC', code_system: 'LOINC', code_value: '58410-2' },
      });
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: EMPTY_PATIENT,
        graphContext: makeGraphContext([node]),
      });
      expect(result.score).toBe(0.0);
      expect(result.missingInputs).toContain('result_value');
      expect(result.missingInputs).toContain('result_date');
    });

    it('should return 1.0 for Stage nodes (always complete)', () => {
      const node = makeNode({
        nodeType: 'Stage',
        nodeIdentifier: 'stage-1',
        properties: { stage_number: 1, title: 'Assessment' },
      });
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext([node]),
      });
      expect(result.score).toBe(1.0);
    });
  });

  describe('propagate', () => {
    it('should apply decay factor per hop for transitive_with_decay', () => {
      const result = scorer.propagate!({
        sourceNode: makeNode({ nodeIdentifier: 'lab-1' }),
        sourceScore: 0.4,
        targetNode: makeNode({ nodeIdentifier: 'step-1', nodeType: 'Step' }),
        edge: { id: 'e1', edgeType: 'HAS_LAB_TEST', sourceId: 'step-1', targetId: 'lab-1', properties: {} },
        propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
        hopDistance: 1,
      });
      expect(result.propagatedScore).toBeCloseTo(0.32); // 0.4 * 0.8
      expect(result.shouldPropagate).toBe(true);
    });

    it('should stop propagation when maxHops exceeded', () => {
      const result = scorer.propagate!({
        sourceNode: makeNode({ nodeIdentifier: 'lab-1' }),
        sourceScore: 0.4,
        targetNode: makeNode({ nodeIdentifier: 'step-1', nodeType: 'Step' }),
        edge: { id: 'e1', edgeType: 'HAS_LAB_TEST', sourceId: 'step-1', targetId: 'lab-1', properties: {} },
        propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
        hopDistance: 4,
      });
      expect(result.shouldPropagate).toBe(false);
    });

    it('should return shouldPropagate false for mode none', () => {
      const result = scorer.propagate!({
        sourceNode: makeNode({ nodeIdentifier: 'lab-1' }),
        sourceScore: 0.4,
        targetNode: makeNode({ nodeIdentifier: 'step-1', nodeType: 'Step' }),
        edge: { id: 'e1', edgeType: 'HAS_LAB_TEST', sourceId: 'step-1', targetId: 'lab-1', properties: {} },
        propagationConfig: { mode: 'none' },
        hopDistance: 1,
      });
      expect(result.shouldPropagate).toBe(false);
      expect(result.propagatedScore).toBe(0);
    });
  });
});
