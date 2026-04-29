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
  it('should be satisfied when patient has matching condition code (exact)', () => {
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

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(true);
    expect(result.contextFieldsRead).toContain('conditions');
    expect(result.dependedOnNodes).toEqual([]);
  });

  it('should NOT be satisfied when patient lacks matching wildcard code (Z94.*)', () => {
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
    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('Z94.*');
  });

  it('should match wildcard code when patient has it', () => {
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

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(true);
  });

  it('should check medication codes', () => {
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

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(true);
  });

  it('should return not satisfied when condition field is empty', () => {
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

    const result = evaluateGate(gate, EMPTY_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
  });

  it('should handle missing condition gracefully', () => {
    const gate: GateProperties = {
      title: 'No condition',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
    };

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('no condition');
  });
});

// ─── prior_node_result ────────────────────────────────────────────────

describe('evaluateGate — prior_node_result', () => {
  it('should be satisfied when depended-on node has expected status', () => {
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

    const result = evaluateGate(gate, REFERENCE_PATIENT, state, emptyAnswers);
    expect(result.satisfied).toBe(true);
    expect(result.dependedOnNodes).toContain('step-3-1');
  });

  it('should NOT be satisfied when depended-on node has wrong status', () => {
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

    const result = evaluateGate(gate, REFERENCE_PATIENT, state, emptyAnswers);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('step-3-1');
    expect(result.dependedOnNodes).toContain('step-3-1');
  });

  it('should NOT be satisfied when depended-on node is not in state', () => {
    const gate: GateProperties = {
      title: 'Depends on step-3-1',
      gate_type: GateType.PRIOR_NODE_RESULT,
      default_behavior: DefaultBehavior.SKIP,
      depends_on: [
        { node_id: 'step-3-1', status: 'INCLUDED' },
      ],
    };

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('NOT_FOUND');
  });
});

// ─── question ─────────────────────────────────────────────────────────

describe('evaluateGate — question', () => {
  it('should be satisfied when answered true', () => {
    const gate: GateProperties = {
      title: 'Prior cesarean?',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'Was the prior uterine surgery a cesarean delivery?',
      answer_type: AnswerType.BOOLEAN,
    };

    const answers = new Map<string, GateAnswer>();
    answers.set('gate-q1', { booleanValue: true });

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, answers, 'gate-q1');
    expect(result.satisfied).toBe(true);
  });

  it('should NOT be satisfied when answered false', () => {
    const gate: GateProperties = {
      title: 'Prior cesarean?',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'Was the prior uterine surgery a cesarean delivery?',
      answer_type: AnswerType.BOOLEAN,
    };

    const answers = new Map<string, GateAnswer>();
    answers.set('gate-q1', { booleanValue: false });

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, answers, 'gate-q1');
    expect(result.satisfied).toBe(false);
  });

  it('should NOT be satisfied when unanswered', () => {
    const gate: GateProperties = {
      title: 'Prior cesarean?',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'Was the prior uterine surgery a cesarean delivery?',
      answer_type: AnswerType.BOOLEAN,
    };

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers, 'gate-q1');
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('not been answered');
  });

  it('should be satisfied when numeric answer is provided', () => {
    const gate: GateProperties = {
      title: 'How many prior cesareans?',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'How many prior cesarean deliveries?',
      answer_type: AnswerType.NUMERIC,
    };

    const answers = new Map<string, GateAnswer>();
    answers.set('gate-q2', { numericValue: 2 });

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, answers, 'gate-q2');
    expect(result.satisfied).toBe(true);
  });

  it('should be satisfied when option is selected', () => {
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

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, answers, 'gate-q3');
    expect(result.satisfied).toBe(true);
    expect(result.reason).toContain('Low transverse');
  });
});

// ─── compound ─────────────────────────────────────────────────────────

describe('evaluateGate — compound', () => {
  it('should be satisfied with AND when all conditions met', () => {
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

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(true);
    expect(result.contextFieldsRead).toContain('conditions');
    expect(result.contextFieldsRead).toContain('medications');
  });

  it('should NOT be satisfied with AND when one condition fails', () => {
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

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('Unsatisfied');
  });

  it('should be satisfied with OR when one condition met', () => {
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

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(true);
  });

  it('should NOT be satisfied with OR when no conditions met', () => {
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

    const result = evaluateGate(gate, REFERENCE_PATIENT, emptyState, emptyAnswers);
    expect(result.satisfied).toBe(false);
  });
});
