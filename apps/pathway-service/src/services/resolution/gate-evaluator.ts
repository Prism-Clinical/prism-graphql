import { PatientContext, CodeEntry, LabResult } from '../confidence/types';
import {
  GateProperties,
  GateCondition,
  GateAnswer,
  GateEvaluationResult,
  NodeResult,
  GateType,
} from './types';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Match a code value against a pattern, supporting trailing wildcard (*).
 * E.g., 'Z94.*' matches 'Z94.0', 'Z94.12', etc.
 */
function matchesCodePattern(code: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return code.startsWith(prefix);
  }
  return code === pattern;
}

/**
 * Retrieve the list of CodeEntry items for a given patient context field.
 */
function getCodeEntries(
  patientContext: PatientContext,
  field: string,
): CodeEntry[] {
  switch (field) {
    case 'conditions':
      return patientContext.conditionCodes;
    case 'medications':
      return patientContext.medications;
    case 'allergies':
      return patientContext.allergies;
    case 'labs':
      return patientContext.labResults;
    default:
      return [];
  }
}

/**
 * Get a numeric value from patient context for comparison operators.
 * Supports lab results (by code) and vital signs (by key).
 */
function getNumericValue(
  patientContext: PatientContext,
  field: string,
  condition: GateCondition,
): number | undefined {
  if (field === 'labs') {
    const lab = patientContext.labResults.find(
      (l) => l.code === condition.value && (!condition.system || l.system === condition.system),
    );
    return lab?.value;
  }
  if (field === 'vitals' && patientContext.vitalSigns) {
    const val = patientContext.vitalSigns[condition.value];
    return typeof val === 'number' ? val : undefined;
  }
  return undefined;
}

// ─── Condition Evaluator ──────────────────────────────────────────────

function evaluateCondition(
  condition: GateCondition,
  patientContext: PatientContext,
): { satisfied: boolean; reason: string; fieldsRead: string[] } {
  const { field, operator, value, system } = condition;
  const fieldsRead = [field];

  switch (operator) {
    case 'includes_code': {
      const entries = getCodeEntries(patientContext, field);
      const matched = entries.some(
        (e) =>
          matchesCodePattern(e.code, value) &&
          (!system || e.system === system),
      );
      return {
        satisfied: matched,
        reason: matched
          ? `Patient has matching code ${value} in ${field}`
          : `No matching code ${value} found in patient ${field}`,
        fieldsRead,
      };
    }

    case 'exists': {
      const entries = getCodeEntries(patientContext, field);
      const exists = entries.length > 0;
      return {
        satisfied: exists,
        reason: exists
          ? `Patient has entries in ${field}`
          : `Patient has no entries in ${field}`,
        fieldsRead,
      };
    }

    case 'equals': {
      const entries = getCodeEntries(patientContext, field);
      const matched = entries.some(
        (e) => e.code === value && (!system || e.system === system),
      );
      return {
        satisfied: matched,
        reason: matched
          ? `Patient has exact code ${value} in ${field}`
          : `No exact code ${value} found in patient ${field}`,
        fieldsRead,
      };
    }

    case 'greater_than': {
      const numericVal = getNumericValue(patientContext, field, condition);
      const threshold = condition.threshold ?? parseFloat(value);
      if (numericVal === undefined) {
        return {
          satisfied: false,
          reason: `No numeric value found for ${field}:${condition.value}`,
          fieldsRead,
        };
      }
      const satisfied = numericVal > threshold;
      return {
        satisfied,
        reason: satisfied
          ? `${field} value ${numericVal} > ${threshold}`
          : `${field} value ${numericVal} <= ${threshold}`,
        fieldsRead,
      };
    }

    case 'less_than': {
      const numericVal = getNumericValue(patientContext, field, condition);
      const threshold = condition.threshold ?? parseFloat(value);
      if (numericVal === undefined) {
        return {
          satisfied: false,
          reason: `No numeric value found for ${field}:${condition.value}`,
          fieldsRead,
        };
      }
      const satisfied = numericVal < threshold;
      return {
        satisfied,
        reason: satisfied
          ? `${field} value ${numericVal} < ${threshold}`
          : `${field} value ${numericVal} >= ${threshold}`,
        fieldsRead,
      };
    }

    default:
      return {
        satisfied: false,
        reason: `Unknown operator: ${operator}`,
        fieldsRead,
      };
  }
}

// ─── Gate Type Evaluators ─────────────────────────────────────────────

function evaluatePatientAttribute(
  gate: GateProperties,
  patientContext: PatientContext,
): GateEvaluationResult {
  if (!gate.condition) {
    return {
      satisfied: false,
      reason: 'Gate has no condition defined',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  const result = evaluateCondition(gate.condition, patientContext);
  return {
    satisfied: result.satisfied,
    reason: result.reason,
    contextFieldsRead: result.fieldsRead,
    dependedOnNodes: [],
  };
}

function evaluateQuestion(
  gate: GateProperties,
  gateAnswers: Map<string, GateAnswer>,
  gateId?: string,
): GateEvaluationResult {
  if (!gateId) {
    return {
      satisfied: false,
      reason: 'No gate ID provided for question evaluation',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  const answer = gateAnswers.get(gateId);
  if (!answer) {
    return {
      satisfied: false,
      reason: 'Question has not been answered',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  // Boolean: true opens the gate
  if (answer.booleanValue !== undefined) {
    return {
      satisfied: answer.booleanValue === true,
      reason: answer.booleanValue
        ? 'Question answered yes'
        : 'Question answered no',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  // Numeric: any non-null value opens the gate
  if (answer.numericValue !== undefined && answer.numericValue !== null) {
    return {
      satisfied: true,
      reason: `Numeric answer provided: ${answer.numericValue}`,
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  // Select: any selected option opens the gate
  if (answer.selectedOption !== undefined && answer.selectedOption !== null) {
    return {
      satisfied: true,
      reason: `Option selected: ${answer.selectedOption}`,
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  return {
    satisfied: false,
    reason: 'Question answer has no value',
    contextFieldsRead: [],
    dependedOnNodes: [],
  };
}

function evaluatePriorNodeResult(
  gate: GateProperties,
  resolutionState: Map<string, NodeResult>,
): GateEvaluationResult {
  if (!gate.depends_on || gate.depends_on.length === 0) {
    return {
      satisfied: false,
      reason: 'Gate has no depends_on entries',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  const dependedOnNodes: string[] = [];
  const unsatisfied: string[] = [];

  for (const dep of gate.depends_on) {
    dependedOnNodes.push(dep.node_id);
    const nodeResult = resolutionState.get(dep.node_id);
    if (!nodeResult || nodeResult.status !== dep.status) {
      const actual = nodeResult?.status ?? 'NOT_FOUND';
      unsatisfied.push(`${dep.node_id} expected ${dep.status}, got ${actual}`);
    }
  }

  const satisfied = unsatisfied.length === 0;
  return {
    satisfied,
    reason: satisfied
      ? `All depended-on nodes have expected status`
      : `Unmet dependencies: ${unsatisfied.join('; ')}`,
    contextFieldsRead: [],
    dependedOnNodes,
  };
}

function evaluateCompound(
  gate: GateProperties,
  patientContext: PatientContext,
): GateEvaluationResult {
  if (!gate.conditions || gate.conditions.length === 0) {
    return {
      satisfied: false,
      reason: 'Compound gate has no conditions',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  const op = gate.operator ?? 'AND';
  const allFieldsRead: string[] = [];
  const results: Array<{ satisfied: boolean; reason: string }> = [];

  for (const condition of gate.conditions) {
    const result = evaluateCondition(condition, patientContext);
    results.push(result);
    allFieldsRead.push(...result.fieldsRead);
  }

  const uniqueFields = [...new Set(allFieldsRead)];

  if (op === 'AND') {
    const allSatisfied = results.every((r) => r.satisfied);
    const failedReasons = results
      .filter((r) => !r.satisfied)
      .map((r) => r.reason);
    return {
      satisfied: allSatisfied,
      reason: allSatisfied
        ? 'All compound conditions satisfied'
        : `Unsatisfied conditions: ${failedReasons.join('; ')}`,
      contextFieldsRead: uniqueFields,
      dependedOnNodes: [],
    };
  }

  // OR
  const anySatisfied = results.some((r) => r.satisfied);
  const satisfiedReasons = results
    .filter((r) => r.satisfied)
    .map((r) => r.reason);
  return {
    satisfied: anySatisfied,
    reason: anySatisfied
      ? `Satisfied conditions: ${satisfiedReasons.join('; ')}`
      : 'No compound conditions satisfied',
    contextFieldsRead: uniqueFields,
    dependedOnNodes: [],
  };
}

// ─── Main Evaluator ───────────────────────────────────────────────────

/**
 * Evaluate a gate to determine if its guarded subtree should be traversed.
 *
 * @param gate       - The gate's properties (type, condition, depends_on, etc.)
 * @param patientContext - Current patient clinical context
 * @param resolutionState - Map of nodeId → NodeResult for prior_node_result gates
 * @param gateAnswers - Map of gateId → provider answer for question gates
 * @param gateId     - The gate's own ID (needed for question lookup)
 */
export function evaluateGate(
  gate: GateProperties,
  patientContext: PatientContext,
  resolutionState: Map<string, NodeResult>,
  gateAnswers: Map<string, GateAnswer>,
  gateId?: string,
): GateEvaluationResult {
  switch (gate.gate_type) {
    case GateType.PATIENT_ATTRIBUTE:
      return evaluatePatientAttribute(gate, patientContext);

    case GateType.QUESTION:
      return evaluateQuestion(gate, gateAnswers, gateId);

    case GateType.PRIOR_NODE_RESULT:
      return evaluatePriorNodeResult(gate, resolutionState);

    case GateType.COMPOUND:
      return evaluateCompound(gate, patientContext);

    default:
      return {
        satisfied: false,
        reason: `Unknown gate type: ${gate.gate_type}`,
        contextFieldsRead: [],
        dependedOnNodes: [],
      };
  }
}
