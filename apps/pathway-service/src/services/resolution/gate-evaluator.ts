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
 * Supports lab results (by code) and vital signs (by key or dotted path).
 *
 * For vitals, the condition's `value` is the key within the vitalSigns bag.
 * Fixed vitals live at the root (`systolic_bp`, `heart_rate`, ...) and custom
 * vitals nest under `custom.<key>` — so callers can target either with a
 * single string:
 *   value: "systolic_bp"        → vitalSigns.systolic_bp
 *   value: "custom.pain_score"  → vitalSigns.custom.pain_score
 *
 * Returns undefined if the path doesn't resolve to a finite number.
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
    return resolveNumericPath(patientContext.vitalSigns, condition.value);
  }
  return undefined;
}

/**
 * Walk a dotted path through a JSON bag, returning the value only if it's a
 * finite number. Tolerates missing segments at any depth.
 */
function resolveNumericPath(bag: Record<string, unknown>, path: string): number | undefined {
  if (!path) return undefined;
  const segments = path.split('.');
  let cursor: unknown = bag;
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : undefined;
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

// ─── llm_text_analysis evaluator ──────────────────────────────────────

/**
 * Result of one LLM gate evaluation, in the shape the gate-evaluator expects
 * back from its async callback. The callback owns the actual API call,
 * caching, audit-trail writing — this layer just consumes the verdict and
 * folds it into a GateEvaluationResult.
 */
export interface LlmGateVerdict {
  chosenBranch: string;
  confidence: number;
  reasoning: string;
  /** True if the LLM call itself failed; evaluator falls back to safe-default. */
  failed?: boolean;
  errorMessage?: string;
}

export type LlmGateEvaluator = (
  gate: GateProperties,
  gateId: string,
  patientContext: PatientContext,
) => Promise<LlmGateVerdict>;

async function evaluateLlmTextAnalysis(
  gate: GateProperties,
  gateId: string | undefined,
  patientContext: PatientContext,
  llmEvaluator?: LlmGateEvaluator,
): Promise<GateEvaluationResult> {
  if (!gateId) {
    return {
      satisfied: false,
      reason: 'LLM gate evaluated without gateId',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }
  if (!gate.branches || gate.branches.length === 0) {
    return {
      satisfied: false,
      reason: 'LLM gate has no declared branches',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  const safeDefault =
    gate.branches.find((b) => b.is_safe_default)?.name ?? gate.branches[0].name;
  const threshold = gate.confidence_threshold ?? 0.75;
  const inputAttr = gate.input_attribute ?? '';

  // Missing callback (no LLM_GATE_API_KEY configured) → fall back to
  // safe-default + tentative, so the gate surfaces as a pending question
  // for manual provider answer.
  if (!llmEvaluator) {
    return {
      satisfied: true,
      reason: 'LLM gate evaluator not configured; defaulted to safe branch',
      contextFieldsRead: inputAttr ? [inputAttr] : [],
      dependedOnNodes: [],
      tentative: true,
      chosenBranch: safeDefault,
      llmConfidence: 0,
      llmReasoning: 'LLM gate evaluator not configured.',
    };
  }

  const verdict = await llmEvaluator(gate, gateId, patientContext);

  if (verdict.failed) {
    return {
      satisfied: true,
      reason: `LLM call failed (${verdict.errorMessage ?? 'unknown'}); defaulted to safe branch`,
      contextFieldsRead: inputAttr ? [inputAttr] : [],
      dependedOnNodes: [],
      tentative: true,
      chosenBranch: safeDefault,
      llmConfidence: 0,
      llmReasoning: verdict.errorMessage ?? 'LLM call failed',
    };
  }

  const tentative = verdict.confidence < threshold;
  const effectiveBranch = tentative ? safeDefault : verdict.chosenBranch;
  return {
    // A gate is "satisfied" (subtree traversed) whenever it routes a branch.
    // For LLM gates the branch IS the gate's output; downstream branch routing
    // is handled separately by the traversal engine via gate properties.
    satisfied: true,
    reason: tentative
      ? `LLM picked "${verdict.chosenBranch}" with confidence ${verdict.confidence.toFixed(2)} < ${threshold}; routing safe-default "${safeDefault}" pending provider confirmation`
      : `LLM picked "${verdict.chosenBranch}" with confidence ${verdict.confidence.toFixed(2)}`,
    contextFieldsRead: inputAttr ? [inputAttr] : [],
    dependedOnNodes: [],
    tentative,
    chosenBranch: effectiveBranch,
    llmConfidence: verdict.confidence,
    llmReasoning: verdict.reasoning,
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
 * @param gateId     - The gate's own ID (needed for question + LLM lookup)
 * @param llmEvaluator - Optional async callback that performs the LLM call
 *                       for llm_text_analysis gates. The resolver wires this
 *                       in (with caching + audit-trail writing); call sites
 *                       that don't supply it default LLM gates to the
 *                       safe-default branch with tentative=true.
 */
export async function evaluateGate(
  gate: GateProperties,
  patientContext: PatientContext,
  resolutionState: Map<string, NodeResult>,
  gateAnswers: Map<string, GateAnswer>,
  gateId?: string,
  llmEvaluator?: LlmGateEvaluator,
): Promise<GateEvaluationResult> {
  switch (gate.gate_type) {
    case GateType.PATIENT_ATTRIBUTE:
      return evaluatePatientAttribute(gate, patientContext);

    case GateType.QUESTION:
      return evaluateQuestion(gate, gateAnswers, gateId);

    case GateType.PRIOR_NODE_RESULT:
      return evaluatePriorNodeResult(gate, resolutionState);

    case GateType.COMPOUND:
      return evaluateCompound(gate, patientContext);

    case GateType.LLM_TEXT_ANALYSIS:
      return evaluateLlmTextAnalysis(gate, gateId, patientContext, llmEvaluator);

    default:
      return {
        satisfied: false,
        reason: `Unknown gate type: ${gate.gate_type}`,
        contextFieldsRead: [],
        dependedOnNodes: [],
      };
  }
}
