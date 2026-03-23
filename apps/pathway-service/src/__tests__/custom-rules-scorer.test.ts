import { CustomRulesScorer } from '../services/confidence/scorers/custom-rules';
import {
  GraphNode,
  GraphContext,
  SignalDefinition,
  ScoringType,
  PatientContext,
} from '../services/confidence/types';
import { REFERENCE_PATIENT, EMPTY_PATIENT } from './fixtures/reference-patient-context';

function makeSignalDef(rulesOverride?: object): SignalDefinition {
  return {
    id: 'custom-signal-1',
    name: 'institutional_pref',
    displayName: 'Institutional Preference',
    description: 'Custom rules',
    scoringType: ScoringType.CUSTOM_RULES,
    scoringRules: {
      rules: [
        {
          condition: 'code_present',
          params: { system: 'ICD-10', codes: ['O34.211'] },
          score: 0.9,
        },
        {
          condition: 'code_present',
          params: { system: 'ICD-10', codes: ['O34.29'] },
          score: 0.7,
        },
      ],
      default_score: 0.4,
      ...rulesOverride,
    },
    propagationConfig: { mode: 'none' },
    scope: 'INSTITUTION',
    institutionId: 'inst-1',
    defaultWeight: 0.15,
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

describe('CustomRulesScorer', () => {
  const scorer = new CustomRulesScorer();

  it('should have scoringType CUSTOM_RULES', () => {
    expect(scorer.scoringType).toBe(ScoringType.CUSTOM_RULES);
  });

  describe('code_present condition', () => {
    it('should return first matching rule score', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-1', nodeType: 'Criterion', properties: {},
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.9);
    });

    it('should return default_score when no rules match', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-1', nodeType: 'Criterion', properties: {},
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: EMPTY_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.4);
    });
  });

  describe('field_exists condition', () => {
    it('should match when field path exists in patient context', () => {
      const signalDef = makeSignalDef({
        rules: [
          { condition: 'field_exists', params: { field_path: 'vitalSigns.bloodPressure' }, score: 0.85 },
        ],
        default_score: 0.3,
      });
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'n-1', nodeType: 'Step', properties: {},
      };
      const patient: PatientContext = {
        ...REFERENCE_PATIENT,
        vitalSigns: { bloodPressure: { systolic: 120 } },
      };
      const result = scorer.score({
        node,
        signalDefinition: signalDef,
        patientContext: patient,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.85);
    });
  });

  describe('value_in_range condition', () => {
    it('should match when numeric field is in range', () => {
      const signalDef = makeSignalDef({
        rules: [
          { condition: 'value_in_range', params: { field_path: 'vitalSigns.heartRate', min: 60, max: 100 }, score: 0.9 },
        ],
        default_score: 0.3,
      });
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'n-1', nodeType: 'Step', properties: {},
      };
      const patient: PatientContext = {
        ...REFERENCE_PATIENT,
        vitalSigns: { heartRate: 72 },
      };
      const result = scorer.score({
        node,
        signalDefinition: signalDef,
        patientContext: patient,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.9);
    });

    it('should not match when value is out of range', () => {
      const signalDef = makeSignalDef({
        rules: [
          { condition: 'value_in_range', params: { field_path: 'vitalSigns.heartRate', min: 60, max: 100 }, score: 0.9 },
        ],
        default_score: 0.3,
      });
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'n-1', nodeType: 'Step', properties: {},
      };
      const patient: PatientContext = {
        ...REFERENCE_PATIENT,
        vitalSigns: { heartRate: 120 },
      };
      const result = scorer.score({
        node,
        signalDefinition: signalDef,
        patientContext: patient,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.3);
    });
  });

  describe('field_equals condition', () => {
    it('should match when field equals expected value', () => {
      const signalDef = makeSignalDef({
        rules: [
          { condition: 'field_equals', params: { field_path: 'patientId', value: 'patient-test-001' }, score: 1.0 },
        ],
        default_score: 0.2,
      });
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'n-1', nodeType: 'Step', properties: {},
      };
      const result = scorer.score({
        node,
        signalDefinition: signalDef,
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(1.0);
    });
  });
});
