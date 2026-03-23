// apps/pathway-service/src/__tests__/risk-magnitude-scorer.test.ts

import { RiskMagnitudeScorer } from '../services/confidence/scorers/risk-magnitude';
import {
  GraphNode,
  GraphContext,
  SignalDefinition,
  ScoringType,
} from '../services/confidence/types';
import { REFERENCE_PATIENT } from './fixtures/reference-patient-context';

function makeSignalDef(): SignalDefinition {
  return {
    id: '00000000-0000-4000-a000-000000000004',
    name: 'risk_magnitude',
    displayName: 'Risk Magnitude',
    description: 'Inverse risk scoring',
    scoringType: ScoringType.RISK_INVERSE,
    scoringRules: {},
    propagationConfig: { mode: 'direct' },
    scope: 'SYSTEM',
    defaultWeight: 0.20,
    isActive: true,
  };
}

function makeGraphContext(): GraphContext {
  return {
    allNodes: [],
    allEdges: [],
    incomingEdges: () => [],
    outgoingEdges: () => [],
    getNode: () => undefined,
    linkedNodes: () => [],
  };
}

describe('RiskMagnitudeScorer', () => {
  const scorer = new RiskMagnitudeScorer();

  it('should have scoringType RISK_INVERSE', () => {
    expect(scorer.scoringType).toBe(ScoringType.RISK_INVERSE);
  });

  describe('score', () => {
    it('should score high confidence for very low risk (0.001)', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-1', nodeType: 'Criterion',
        properties: { base_rate: 0.001 },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      // max(0.10, 1.0 - (log10(0.001 * 1000 + 1) / 3.0))
      // = max(0.10, 1.0 - (log10(2) / 3.0))
      // = max(0.10, 1.0 - 0.1003) ≈ 0.90
      expect(result.score).toBeGreaterThan(0.85);
      expect(result.score).toBeLessThan(0.95);
    });

    it('should score low confidence for high risk (0.10)', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-x', nodeType: 'Criterion',
        properties: { base_rate: 0.10 },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      // max(0.10, 1.0 - (log10(100 + 1) / 3.0))
      // = max(0.10, 1.0 - (2.004 / 3.0))
      // = max(0.10, 1.0 - 0.668) ≈ 0.33
      expect(result.score).toBeGreaterThan(0.25);
      expect(result.score).toBeLessThan(0.45);
    });

    it('should floor at 0.10 for extreme risk', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-x', nodeType: 'Criterion',
        properties: { base_rate: 1.0 },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.10);
    });

    it('should score 0.50 when no risk data available', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'stage-1', nodeType: 'Stage',
        properties: { stage_number: 1, title: 'Assessment' },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.50);
      expect(result.missingInputs).toContain('risk_value');
    });
  });

  describe('propagate', () => {
    it('should propagate with direct mode', () => {
      const result = scorer.propagate!({
        sourceNode: { id: '1', nodeIdentifier: 'crit-1', nodeType: 'Criterion', properties: {} },
        sourceScore: 0.3,
        targetNode: { id: '2', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: {} },
        edge: { id: 'e1', edgeType: 'HAS_CRITERION', sourceId: 'dp-1', targetId: 'crit-1', properties: {} },
        propagationConfig: { mode: 'direct' },
        hopDistance: 1,
      });
      expect(result.propagatedScore).toBe(0.3);
      expect(result.shouldPropagate).toBe(false);
    });
  });
});
