import {
  scoreReachability,
  hasDataForCondition,
  extractGateProperties,
  GateExplanation,
} from '../services/resolution/reachability';
import {
  GateProperties,
  GateCondition,
} from '../services/resolution/types';
import { GraphNode, PatientContext } from '../services/confidence/types';
import { GateType, DefaultBehavior } from '../types';
import {
  REFERENCE_PATIENT,
  EMPTY_PATIENT,
  FULLY_MATCHED_PATIENT,
} from './fixtures/reference-patient-context';

// ─── Helpers ──────────────────────────────────────────────────────────

let nodeIdCounter = 1;

function makeGateNode(props: GateProperties): GraphNode {
  return {
    id: String(nodeIdCounter++),
    nodeIdentifier: `gate-${nodeIdCounter}`,
    nodeType: 'Gate',
    properties: props as unknown as Record<string, unknown>,
  };
}

function makeNonGateNode(nodeType: string): GraphNode {
  return {
    id: String(nodeIdCounter++),
    nodeIdentifier: `${nodeType.toLowerCase()}-${nodeIdCounter}`,
    nodeType,
    properties: {},
  };
}

function patientAttrGate(condition: GateCondition): GateProperties {
  return {
    title: 'Test gate',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition,
  };
}

function questionGate(): GateProperties {
  return {
    title: 'Provider question',
    gate_type: GateType.QUESTION,
    default_behavior: DefaultBehavior.SKIP,
    prompt: 'Has the patient consented?',
  };
}

// ─── extractGateProperties ────────────────────────────────────────────

describe('extractGateProperties', () => {
  it('returns null for non-Gate nodes', () => {
    expect(extractGateProperties(makeNonGateNode('Step'))).toBeNull();
    expect(extractGateProperties(makeNonGateNode('DecisionPoint'))).toBeNull();
  });

  it('returns null for Gate nodes missing required fields', () => {
    const node: GraphNode = {
      id: '1',
      nodeIdentifier: 'g',
      nodeType: 'Gate',
      properties: { title: 'incomplete' },
    };
    expect(extractGateProperties(node)).toBeNull();
  });

  it('returns properties for well-formed Gate nodes', () => {
    const gate = patientAttrGate({
      field: 'conditions',
      operator: 'includes_code',
      value: 'I10',
    });
    const node = makeGateNode(gate);
    expect(extractGateProperties(node)).toEqual(gate);
  });
});

// ─── hasDataForCondition ──────────────────────────────────────────────

describe('hasDataForCondition', () => {
  it('returns true for always-evaluable operators regardless of data', () => {
    expect(
      hasDataForCondition(
        { field: 'conditions', operator: 'includes_code', value: 'X' },
        EMPTY_PATIENT,
      ),
    ).toBe(true);
    expect(
      hasDataForCondition(
        { field: 'medications', operator: 'exists', value: '' },
        EMPTY_PATIENT,
      ),
    ).toBe(true);
    expect(
      hasDataForCondition(
        { field: 'allergies', operator: 'equals', value: 'Z' },
        EMPTY_PATIENT,
      ),
    ).toBe(true);
  });

  it('returns true for greater_than on labs when patient has the lab with a numeric value', () => {
    const condition: GateCondition = {
      field: 'labs',
      operator: 'greater_than',
      value: '718-7',
      system: 'LOINC',
      threshold: 10,
    };
    expect(hasDataForCondition(condition, REFERENCE_PATIENT)).toBe(true);
  });

  it('returns false for greater_than on labs when patient lacks the lab', () => {
    const condition: GateCondition = {
      field: 'labs',
      operator: 'greater_than',
      value: 'unknown-loinc',
      system: 'LOINC',
      threshold: 10,
    };
    expect(hasDataForCondition(condition, REFERENCE_PATIENT)).toBe(false);
  });

  it('returns false when system mismatches', () => {
    const condition: GateCondition = {
      field: 'labs',
      operator: 'greater_than',
      value: '718-7',
      system: 'SNOMED',
      threshold: 10,
    };
    expect(hasDataForCondition(condition, REFERENCE_PATIENT)).toBe(false);
  });

  it('returns true for greater_than on vitals when patient has the vital', () => {
    const condition: GateCondition = {
      field: 'vitals',
      operator: 'greater_than',
      value: 'heartRate',
      threshold: 60,
    };
    expect(hasDataForCondition(condition, FULLY_MATCHED_PATIENT)).toBe(true);
  });

  it('returns false for greater_than on vitals when patient lacks vitals', () => {
    const condition: GateCondition = {
      field: 'vitals',
      operator: 'less_than',
      value: 'heartRate',
      threshold: 60,
    };
    expect(hasDataForCondition(condition, REFERENCE_PATIENT)).toBe(false);
  });

  it('returns false for unknown operators', () => {
    expect(
      hasDataForCondition(
        { field: 'labs', operator: 'matches_regex', value: '.*' },
        REFERENCE_PATIENT,
      ),
    ).toBe(false);
  });
});

// ─── scoreReachability ────────────────────────────────────────────────

describe('scoreReachability', () => {
  beforeEach(() => {
    nodeIdCounter = 1;
  });

  it('returns null score when no gates present', () => {
    const result = scoreReachability([], REFERENCE_PATIENT);
    expect(result.totalGates).toBe(0);
    expect(result.autoResolvableScore).toBeNull();
  });

  it('ignores non-Gate nodes', () => {
    const nodes = [
      makeNonGateNode('Step'),
      makeNonGateNode('DecisionPoint'),
      makeNonGateNode('Stage'),
    ];
    const result = scoreReachability(nodes, REFERENCE_PATIENT);
    expect(result.totalGates).toBe(0);
    expect(result.autoResolvableScore).toBeNull();
  });

  it('counts always-evaluable gates as auto-resolvable regardless of patient data', () => {
    const gates = [
      makeGateNode(
        patientAttrGate({ field: 'conditions', operator: 'includes_code', value: 'I10' }),
      ),
      makeGateNode(
        patientAttrGate({ field: 'medications', operator: 'exists', value: '' }),
      ),
    ];
    const result = scoreReachability(gates, EMPTY_PATIENT);
    expect(result.totalGates).toBe(2);
    expect(result.alwaysEvaluableGates).toBe(2);
    expect(result.dataDependentGates).toBe(0);
    expect(result.autoResolvableScore).toBe(1);
  });

  it('counts data-dependent gate as resolvable when patient has the data', () => {
    const gate = makeGateNode(
      patientAttrGate({
        field: 'labs',
        operator: 'greater_than',
        value: '718-7',
        system: 'LOINC',
        threshold: 10,
      }),
    );
    const result = scoreReachability([gate], REFERENCE_PATIENT);
    expect(result.totalGates).toBe(1);
    expect(result.dataDependentGates).toBe(1);
    expect(result.dataAvailableGates).toBe(1);
    expect(result.autoResolvableScore).toBe(1);
  });

  it('counts data-dependent gate as blocked when patient lacks the data', () => {
    const gate = makeGateNode(
      patientAttrGate({
        field: 'labs',
        operator: 'greater_than',
        value: 'missing-lab',
        system: 'LOINC',
        threshold: 10,
      }),
    );
    const result = scoreReachability([gate], REFERENCE_PATIENT);
    expect(result.totalGates).toBe(1);
    expect(result.dataDependentGates).toBe(1);
    expect(result.dataAvailableGates).toBe(0);
    expect(result.autoResolvableScore).toBe(0);
  });

  it('classifies question gates separately and excludes them from auto-resolvable', () => {
    const gates = [
      makeGateNode(questionGate()),
      makeGateNode(
        patientAttrGate({ field: 'conditions', operator: 'includes_code', value: 'I10' }),
      ),
    ];
    const result = scoreReachability(gates, REFERENCE_PATIENT);
    expect(result.totalGates).toBe(2);
    expect(result.questionGates).toBe(1);
    expect(result.alwaysEvaluableGates).toBe(1);
    expect(result.autoResolvableScore).toBe(0.5);
  });

  it('classifies prior_node_result and compound gates as indeterminate', () => {
    const priorNodeGate: GateProperties = {
      title: 'Wait for prior',
      gate_type: GateType.PRIOR_NODE_RESULT,
      default_behavior: DefaultBehavior.SKIP,
      depends_on: [{ node_id: 'step-1', status: 'INCLUDED' }],
    };
    const compoundGate: GateProperties = {
      title: 'Compound',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'AND',
      conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'I10' },
        { field: 'conditions', operator: 'includes_code', value: 'E11' },
      ],
    };
    const result = scoreReachability(
      [makeGateNode(priorNodeGate), makeGateNode(compoundGate)],
      REFERENCE_PATIENT,
    );
    expect(result.totalGates).toBe(2);
    expect(result.indeterminateGates).toBe(2);
    expect(result.autoResolvableScore).toBe(0);
  });

  it('requires every condition in a multi-condition gate to have data for it to be available', () => {
    const gateAllPresent: GateProperties = {
      title: 'multi-condition all present',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'AND',
      conditions: [
        {
          field: 'labs',
          operator: 'greater_than',
          value: '718-7',
          system: 'LOINC',
          threshold: 10,
        },
        {
          field: 'labs',
          operator: 'less_than',
          value: '58410-2',
          system: 'LOINC',
          threshold: 100,
        },
      ],
    };
    const gateOneMissing: GateProperties = {
      ...gateAllPresent,
      conditions: [
        {
          field: 'labs',
          operator: 'greater_than',
          value: '718-7',
          system: 'LOINC',
          threshold: 10,
        },
        {
          field: 'labs',
          operator: 'less_than',
          value: 'missing',
          system: 'LOINC',
          threshold: 100,
        },
      ],
    };
    const result = scoreReachability(
      [makeGateNode(gateAllPresent), makeGateNode(gateOneMissing)],
      REFERENCE_PATIENT,
    );
    expect(result.totalGates).toBe(2);
    expect(result.dataDependentGates).toBe(2);
    expect(result.dataAvailableGates).toBe(1);
    expect(result.autoResolvableScore).toBe(0.5);
  });

  it('produces a representative mixed-pathway score', () => {
    const gates = [
      makeGateNode(
        patientAttrGate({ field: 'conditions', operator: 'includes_code', value: 'I10' }),
      ),
      makeGateNode(
        patientAttrGate({ field: 'allergies', operator: 'exists', value: '' }),
      ),
      makeGateNode(
        patientAttrGate({
          field: 'labs',
          operator: 'greater_than',
          value: '718-7',
          system: 'LOINC',
          threshold: 10,
        }),
      ),
      makeGateNode(
        patientAttrGate({
          field: 'labs',
          operator: 'less_than',
          value: 'missing',
          system: 'LOINC',
          threshold: 100,
        }),
      ),
      makeGateNode(questionGate()),
    ];
    const result = scoreReachability(gates, REFERENCE_PATIENT);
    expect(result.totalGates).toBe(5);
    expect(result.alwaysEvaluableGates).toBe(2);
    expect(result.dataDependentGates).toBe(2);
    expect(result.dataAvailableGates).toBe(1);
    expect(result.questionGates).toBe(1);
    expect(result.autoResolvableScore).toBe(3 / 5);
  });

  it('drops gates with malformed properties without crashing', () => {
    const malformed: GraphNode = {
      id: 'x',
      nodeIdentifier: 'gate-bad',
      nodeType: 'Gate',
      properties: { title: 'no gate_type' },
    };
    const good = makeGateNode(
      patientAttrGate({ field: 'conditions', operator: 'includes_code', value: 'I10' }),
    );
    const result = scoreReachability([malformed, good], REFERENCE_PATIENT);
    expect(result.totalGates).toBe(1);
    expect(result.alwaysEvaluableGates).toBe(1);
  });

  it('emits an empty gateExplanations array when no gates are present', () => {
    const result = scoreReachability([], REFERENCE_PATIENT);
    expect(result.gateExplanations).toEqual([]);
  });

  it('emits one explanation per gate with matching counts', () => {
    const gates = [
      makeGateNode(
        patientAttrGate({ field: 'conditions', operator: 'includes_code', value: 'I10' }),
      ),
      makeGateNode(questionGate()),
    ];
    const result = scoreReachability(gates, REFERENCE_PATIENT);
    expect(result.gateExplanations).toHaveLength(2);
    expect(result.gateExplanations[0].classification).toBe('ALWAYS_EVALUABLE');
    expect(result.gateExplanations[1].classification).toBe('QUESTION');
  });
});

describe('scoreReachability — explanation details', () => {
  beforeEach(() => {
    nodeIdCounter = 1;
  });

  it('lists missing data for blocked lab gate', () => {
    const gate = makeGateNode(
      patientAttrGate({
        field: 'labs',
        operator: 'greater_than',
        value: 'unknown-loinc',
        system: 'LOINC',
        threshold: 7,
      }),
    );
    const result = scoreReachability([gate], REFERENCE_PATIENT);
    const explanation = result.gateExplanations[0];
    expect(explanation.classification).toBe('DATA_BLOCKED');
    expect(explanation.missingData).toHaveLength(1);
    expect(explanation.missingData[0]).toMatchObject({
      field: 'labs',
      code: 'unknown-loinc',
      system: 'LOINC',
      threshold: 7,
      comparison: 'greater_than',
    });
    expect(explanation.reason).toContain('LOINC unknown-loinc');
  });

  it('reports vitalName instead of code for vitals fields', () => {
    const gate = makeGateNode(
      patientAttrGate({
        field: 'vitals',
        operator: 'less_than',
        value: 'heartRate',
        threshold: 50,
      }),
    );
    const result = scoreReachability([gate], REFERENCE_PATIENT);
    const explanation = result.gateExplanations[0];
    expect(explanation.classification).toBe('DATA_BLOCKED');
    expect(explanation.missingData[0]).toMatchObject({
      field: 'vitals',
      vitalName: 'heartRate',
      threshold: 50,
      comparison: 'less_than',
    });
    expect(explanation.missingData[0].code).toBeUndefined();
  });

  it('lists every missing condition for multi-condition blocked gates', () => {
    const gate = makeGateNode({
      title: 'multi',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'AND',
      conditions: [
        {
          field: 'labs',
          operator: 'greater_than',
          value: 'missing-1',
          system: 'LOINC',
          threshold: 5,
        },
        {
          field: 'labs',
          operator: 'less_than',
          value: 'missing-2',
          system: 'LOINC',
          threshold: 100,
        },
      ],
    });
    const result = scoreReachability([gate], REFERENCE_PATIENT);
    const explanation = result.gateExplanations[0];
    expect(explanation.missingData.map((m) => m.code)).toEqual(['missing-1', 'missing-2']);
  });

  it('does not list missing data for always_evaluable, data_available, or question gates', () => {
    const gates = [
      makeGateNode(
        patientAttrGate({ field: 'conditions', operator: 'includes_code', value: 'I10' }),
      ),
      makeGateNode(
        patientAttrGate({
          field: 'labs',
          operator: 'greater_than',
          value: '718-7',
          system: 'LOINC',
          threshold: 5,
        }),
      ),
      makeGateNode(questionGate()),
    ];
    const result = scoreReachability(gates, REFERENCE_PATIENT);
    for (const e of result.gateExplanations) {
      expect(e.missingData).toEqual([]);
    }
  });

  it('passes the gate prompt through for question gates', () => {
    const gate: GateExplanation['gateNodeIdentifier'] = '';
    void gate;
    const node = makeGateNode({
      title: 'Provider question',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'Has the patient consented to study X?',
    });
    const result = scoreReachability([node], REFERENCE_PATIENT);
    expect(result.gateExplanations[0].reason).toContain('study X');
  });

  it('explains compound and prior_node gates as indeterminate with appropriate reason', () => {
    const compound = makeGateNode({
      title: 'compound',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'AND',
      conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'I10' },
        { field: 'conditions', operator: 'includes_code', value: 'E11' },
      ],
    });
    const priorNode = makeGateNode({
      title: 'prior',
      gate_type: GateType.PRIOR_NODE_RESULT,
      default_behavior: DefaultBehavior.SKIP,
      depends_on: [{ node_id: 'step-1', status: 'INCLUDED' }],
    });
    const result = scoreReachability([compound, priorNode], REFERENCE_PATIENT);
    expect(result.gateExplanations[0].reason).toContain('Compound');
    expect(result.gateExplanations[1].reason).toContain('upstream node');
  });
});
