import { evaluateGate } from '../services/resolution/gate-evaluator';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  NodeStatus,
  GateType,
  DefaultBehavior,
  AnswerType,
} from '../services/resolution/types';
import { REFERENCE_PATIENT, EMPTY_PATIENT } from './fixtures/reference-patient-context';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeNodeResult(nodeId: string, status: NodeStatus): NodeResult {
  return {
    nodeId,
    nodeType: 'Step',
    title: `Node ${nodeId}`,
    status,
    confidence: 0.8,
    confidenceBreakdown: [],
    depth: 1,
  };
}

const emptyState = new Map<string, NodeResult>();
const emptyAnswers = new Map<string, GateAnswer>();

// ─── patient_attribute ────────────────────────────────────────────────

describe('evaluateGate — patient_attribute', () => {
  it('should be satisfied when patient has matching condition code (exact)', async () => {
    const gate: GateProperties = {
      title: 'Check O34.211',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: {
        field: 'conditions',
        operator: 'includes_code',
        value: 'O34.211',
        system: 'ICD-10',
      },
    };

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(true);
    expect(result.contextFieldsRead).toContain('conditions');
    expect(result.dependedOnNodes).toEqual([]);
  });

  it('should NOT be satisfied when patient lacks matching wildcard code (Z94.*)', async () => {
    const gate: GateProperties = {
      title: 'Transplant Screen',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: {
        field: 'conditions',
        operator: 'includes_code',
        value: 'Z94.*',
        system: 'ICD-10',
      },
    };

    // REFERENCE_PATIENT has O34.211 and Z87.51, but no Z94.x
    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('Z94.*');
  });

  it('should match wildcard code when patient has it', async () => {
    const gate: GateProperties = {
      title: 'Check Z87.*',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: {
        field: 'conditions',
        operator: 'includes_code',
        value: 'Z87.*',
        system: 'ICD-10',
      },
    };

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(true);
  });

  it('should check medication codes', async () => {
    const gate: GateProperties = {
      title: 'Check Oxytocin',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: {
        field: 'medications',
        operator: 'includes_code',
        value: '7052',
        system: 'RXNORM',
      },
    };

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(true);
  });

  it('should return not satisfied when condition field is empty', async () => {
    const gate: GateProperties = {
      title: 'Check conditions',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: {
        field: 'conditions',
        operator: 'exists',
        value: '',
      },
    };

    const result = await evaluateGate(gate, EMPTY_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
  });

  it('should handle missing condition gracefully', async () => {
    const gate: GateProperties = {
      title: 'No condition',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
    };

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('no condition');
  });

  // ─── Vitals: fixed paths + custom dotted paths ──────────────────────

  describe('vitals path resolution', () => {
    const SIM_PATIENT = {
      ...EMPTY_PATIENT,
      vitalSigns: {
        systolic_bp: 142,
        diastolic_bp: 91,
        heart_rate: 78,
        spo2: 97,
        custom: {
          pain_score: 8,
          nested: { deeper: 3 },
        },
      },
    };

    it('reads a flat vital (greater_than)', async () => {
      const gate: GateProperties = {
        title: 'BP > 140',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'vitals', operator: 'greater_than', value: 'systolic_bp', threshold: 140 },
      };
      const result = await evaluateGate(gate, SIM_PATIENT, emptyState, emptyAnswers);
      expect(result.satisfied).toBe(true);
      expect(result.reason).toContain('142');
    });

    it('reads a flat vital (less_than, not satisfied)', async () => {
      const gate: GateProperties = {
        title: 'HR < 60',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'vitals', operator: 'less_than', value: 'heart_rate', threshold: 60 },
      };
      const result = await evaluateGate(gate, SIM_PATIENT, emptyState, emptyAnswers);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('78');
    });

    it('reads a custom vital via dotted path', async () => {
      const gate: GateProperties = {
        title: 'Pain score >= 7',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'vitals', operator: 'greater_than', value: 'custom.pain_score', threshold: 6 },
      };
      const result = await evaluateGate(gate, SIM_PATIENT, emptyState, emptyAnswers);
      expect(result.satisfied).toBe(true);
    });

    it('walks arbitrary depth on dotted paths', async () => {
      const gate: GateProperties = {
        title: 'Deeply nested',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'vitals', operator: 'greater_than', value: 'custom.nested.deeper', threshold: 2 },
      };
      const result = await evaluateGate(gate, SIM_PATIENT, emptyState, emptyAnswers);
      expect(result.satisfied).toBe(true);
    });

    it('returns not-satisfied when the vital is missing', async () => {
      const gate: GateProperties = {
        title: 'Missing vital',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'vitals', operator: 'greater_than', value: 'temperature_f', threshold: 100 },
      };
      const result = await evaluateGate(gate, SIM_PATIENT, emptyState, emptyAnswers);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toMatch(/no numeric value/i);
    });

    it('returns not-satisfied when a custom dotted path is missing', async () => {
      const gate: GateProperties = {
        title: 'Missing custom',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'vitals', operator: 'less_than', value: 'custom.does_not_exist', threshold: 5 },
      };
      const result = await evaluateGate(gate, SIM_PATIENT, emptyState, emptyAnswers);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toMatch(/no numeric value/i);
    });

    it('returns not-satisfied when patient has no vitalSigns at all', async () => {
      const gate: GateProperties = {
        title: 'No vitals on patient',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'vitals', operator: 'greater_than', value: 'systolic_bp', threshold: 140 },
      };
      const result = await evaluateGate(gate, EMPTY_PATIENT, emptyState, emptyAnswers);
      expect(result.satisfied).toBe(false);
    });

    it('gracefully ignores non-numeric vital values', async () => {
      const gate: GateProperties = {
        title: 'Non-numeric vital',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'vitals', operator: 'greater_than', value: 'note', threshold: 5 },
      };
      const patientWithStringVital = {
        ...EMPTY_PATIENT,
        vitalSigns: { note: 'some text', systolic_bp: 130 },
      };
      const result = await evaluateGate(gate, patientWithStringVital, emptyState, emptyAnswers);
      expect(result.satisfied).toBe(false);
    });
  });
});

// ─── prior_node_result ────────────────────────────────────────────────

describe('evaluateGate — prior_node_result', () => {
  it('should be satisfied when depended-on node has expected status', async () => {
    const gate: GateProperties = {
      title: 'Depends on step-3-1',
      gate_type: GateType.PRIOR_NODE_RESULT,
      default_behavior: DefaultBehavior.SKIP,
      depends_on: [
        { node_id: 'step-3-1', status: 'INCLUDED' },
      ],
    };

    const state = new Map<string, NodeResult>();
    state.set('step-3-1', makeNodeResult('step-3-1', NodeStatus.INCLUDED));

    const result = await evaluateGate(gate, REFERENCE_PATIENT, state, emptyAnswers);
    expect(result.satisfied).toBe(true);
    expect(result.dependedOnNodes).toContain('step-3-1');
  });

  it('should NOT be satisfied when depended-on node has wrong status', async () => {
    const gate: GateProperties = {
      title: 'Depends on step-3-1',
      gate_type: GateType.PRIOR_NODE_RESULT,
      default_behavior: DefaultBehavior.SKIP,
      depends_on: [
        { node_id: 'step-3-1', status: 'INCLUDED' },
      ],
    };

    const state = new Map<string, NodeResult>();
    state.set('step-3-1', makeNodeResult('step-3-1', NodeStatus.EXCLUDED));

    const result = await evaluateGate(gate, REFERENCE_PATIENT, state, emptyAnswers);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('step-3-1');
    expect(result.dependedOnNodes).toContain('step-3-1');
  });

  it('should NOT be satisfied when depended-on node is not in state', async () => {
    const gate: GateProperties = {
      title: 'Depends on step-3-1',
      gate_type: GateType.PRIOR_NODE_RESULT,
      default_behavior: DefaultBehavior.SKIP,
      depends_on: [
        { node_id: 'step-3-1', status: 'INCLUDED' },
      ],
    };

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('NOT_FOUND');
  });
});

// ─── question ─────────────────────────────────────────────────────────

describe('evaluateGate — question', () => {
  it('should be satisfied when answered true', async () => {
    const gate: GateProperties = {
      title: 'Prior cesarean?',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'Was the prior uterine surgery a cesarean delivery?',
      answer_type: AnswerType.BOOLEAN,
    };

    const answers = new Map<string, GateAnswer>();
    answers.set('gate-q1', { booleanValue: true });

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, answers, 'gate-q1');
    expect(result.satisfied).toBe(true);
  });

  it('should NOT be satisfied when answered false', async () => {
    const gate: GateProperties = {
      title: 'Prior cesarean?',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'Was the prior uterine surgery a cesarean delivery?',
      answer_type: AnswerType.BOOLEAN,
    };

    const answers = new Map<string, GateAnswer>();
    answers.set('gate-q1', { booleanValue: false });

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, answers, 'gate-q1');
    expect(result.satisfied).toBe(false);
  });

  it('should NOT be satisfied when unanswered', async () => {
    const gate: GateProperties = {
      title: 'Prior cesarean?',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'Was the prior uterine surgery a cesarean delivery?',
      answer_type: AnswerType.BOOLEAN,
    };

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers, 'gate-q1');
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('not been answered');
  });

  it('should be satisfied when numeric answer is provided', async () => {
    const gate: GateProperties = {
      title: 'How many prior cesareans?',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'How many prior cesarean deliveries?',
      answer_type: AnswerType.NUMERIC,
    };

    const answers = new Map<string, GateAnswer>();
    answers.set('gate-q2', { numericValue: 2 });

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, answers, 'gate-q2');
    expect(result.satisfied).toBe(true);
  });

  it('should be satisfied when option is selected', async () => {
    const gate: GateProperties = {
      title: 'Incision type?',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'What type of uterine incision?',
      answer_type: AnswerType.SELECT,
      options: ['Low transverse', 'Classical', 'T-incision'],
    };

    const answers = new Map<string, GateAnswer>();
    answers.set('gate-q3', { selectedOption: 'Low transverse' });

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, answers, 'gate-q3');
    expect(result.satisfied).toBe(true);
    expect(result.reason).toContain('Low transverse');
  });
});

// ─── compound ─────────────────────────────────────────────────────────

describe('evaluateGate — compound', () => {
  it('should be satisfied with AND when all conditions met', async () => {
    const gate: GateProperties = {
      title: 'Compound AND gate',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'AND',
      conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'O34.211', system: 'ICD-10' },
        { field: 'medications', operator: 'includes_code', value: '7052', system: 'RXNORM' },
      ],
    };

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(true);
    expect(result.contextFieldsRead).toContain('conditions');
    expect(result.contextFieldsRead).toContain('medications');
  });

  it('should NOT be satisfied with AND when one condition fails', async () => {
    const gate: GateProperties = {
      title: 'Compound AND gate',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'AND',
      conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'O34.211', system: 'ICD-10' },
        { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
      ],
    };

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('Unsatisfied');
  });

  it('should be satisfied with OR when one condition met', async () => {
    const gate: GateProperties = {
      title: 'Compound OR gate',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'OR',
      conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
        { field: 'conditions', operator: 'includes_code', value: 'O34.211', system: 'ICD-10' },
      ],
    };

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(true);
  });

  it('should NOT be satisfied with OR when no conditions met', async () => {
    const gate: GateProperties = {
      title: 'Compound OR gate',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'OR',
      conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
        { field: 'conditions', operator: 'includes_code', value: 'J06.9', system: 'ICD-10' },
      ],
    };

    const result = await evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
  });
});
