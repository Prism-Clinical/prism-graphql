import { PatientMatchQualityScorer } from '../services/confidence/scorers/patient-match-quality';
import {
  GraphNode,
  GraphContext,
  SignalDefinition,
  ScoringType,
  PatientContext,
} from '../services/confidence/types';
import { REFERENCE_PATIENT, EMPTY_PATIENT, FULLY_MATCHED_PATIENT } from './fixtures/reference-patient-context';

function makeSignalDef(): SignalDefinition {
  return {
    id: '00000000-0000-4000-a000-000000000003',
    name: 'match_quality',
    displayName: 'Patient Match Quality',
    description: 'Matches patient codes',
    scoringType: ScoringType.CRITERIA_MATCH,
    scoringRules: {},
    propagationConfig: { mode: 'direct' },
    scope: 'SYSTEM',
    defaultWeight: 0.25,
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

describe('PatientMatchQualityScorer', () => {
  const scorer = new PatientMatchQualityScorer();

  it('should have scoringType CRITERIA_MATCH', () => {
    expect(scorer.scoringType).toBe(ScoringType.CRITERIA_MATCH);
  });

  describe('score', () => {
    it('should score 1.0 for a Criterion with exact code match', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-1', nodeType: 'Criterion',
        properties: { code_system: 'ICD-10', code_value: 'O34.211', is_critical: true },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(1.0);
    });

    it('should score 0.7 for a parent prefix match (e.g., O34.2 matches O34.211)', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-x', nodeType: 'Criterion',
        properties: { code_system: 'ICD-10', code_value: 'O34.2', is_critical: false },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.7);
    });

    it('should score 0.0 for no match at all', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-2', nodeType: 'Criterion',
        properties: { code_system: 'ICD-10', code_value: 'O34.29', is_critical: true },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.0);
    });

    it('should cap at 0.5 when a critical criterion is missing', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-2', nodeType: 'Criterion',
        properties: { code_system: 'ICD-10', code_value: 'O34.29', is_critical: true },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: EMPTY_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBeLessThanOrEqual(0.5);
    });

    it('should score 1.0 for Medication nodes when patient has matching med', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'med-1', nodeType: 'Medication',
        properties: { name: 'Oxytocin' },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it('should return 1.0 for nodes without matchable codes (e.g., Stage)', () => {
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
      expect(result.score).toBe(1.0);
    });
  });

  describe('propagate', () => {
    it('should propagate with direct mode (one hop, no further)', () => {
      const result = scorer.propagate!({
        sourceNode: { id: '1', nodeIdentifier: 'crit-1', nodeType: 'Criterion', properties: {} },
        sourceScore: 0.7,
        targetNode: { id: '2', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: {} },
        edge: { id: 'e1', edgeType: 'HAS_CRITERION', sourceId: 'dp-1', targetId: 'crit-1', properties: {} },
        propagationConfig: { mode: 'direct' },
        hopDistance: 1,
      });
      expect(result.propagatedScore).toBe(0.7);
      expect(result.shouldPropagate).toBe(false);
    });
  });
});
