import { GateProperties, GateCondition, isAttributeCondition, AttributeCodeMap } from './types';
import { resolveAttribute } from './attribute-registry';
import { PatientContext, GraphNode } from '../confidence/types';
import { GateType } from '../../types';

export type GateClassification =
  | 'ALWAYS_EVALUABLE'
  | 'DATA_AVAILABLE'
  | 'DATA_BLOCKED'
  | 'QUESTION'
  | 'INDETERMINATE';

export interface MissingData {
  field?: string;
  code?: string;
  system?: string;
  vitalName?: string;
  threshold?: number;
  comparison?: 'greater_than' | 'less_than';
  attribute?: string;
}

export interface GateExplanation {
  gateNodeIdentifier: string;
  gateTitle: string;
  classification: GateClassification;
  reason: string;
  missingData: MissingData[];
}

export interface ReachabilityScore {
  totalGates: number;
  alwaysEvaluableGates: number;
  dataDependentGates: number;
  dataAvailableGates: number;
  questionGates: number;
  indeterminateGates: number;
  autoResolvableScore: number | null;
  gateExplanations: GateExplanation[];
}

const ALWAYS_EVALUABLE_OPERATORS: ReadonlySet<string> = new Set([
  'includes_code',
  'equals',
  'exists',
]);

const DATA_DEPENDENT_OPERATORS: ReadonlySet<string> = new Set([
  'greater_than',
  'less_than',
  'count_in_window',
  'trend_up',
  'trend_down',
  'delta_from_baseline',
]);

export function extractGateProperties(node: GraphNode): GateProperties | null {
  if (node.nodeType !== 'Gate') return null;
  const props = node.properties as Partial<GateProperties>;
  if (typeof props.title !== 'string' || typeof props.gate_type !== 'string') {
    return null;
  }
  return props as GateProperties;
}

export function hasDataForCondition(
  condition: GateCondition,
  patient: PatientContext,
  codeMap: AttributeCodeMap,
): boolean {
  if (isAttributeCondition(condition)) {
    if (condition.operator === 'exists') return true; // data-independent
    return resolveAttribute(patient, condition.attribute, codeMap).value !== undefined;
  }

  const { field, operator } = condition; // coded path (unchanged below)

  if (ALWAYS_EVALUABLE_OPERATORS.has(operator)) {
    return true;
  }

  if (!DATA_DEPENDENT_OPERATORS.has(operator)) {
    return false;
  }

  if (field === 'labs') {
    return patient.labResults.some(
      (l) =>
        l.code === condition.value &&
        (!condition.system || l.system === condition.system) &&
        typeof l.value === 'number',
    );
  }

  if (field === 'vitals' && patient.vitalSigns) {
    const v = patient.vitalSigns[condition.value];
    return typeof v === 'number';
  }

  return false;
}

function missingDataForCondition(condition: GateCondition): MissingData {
  if (isAttributeCondition(condition)) {
    return { attribute: condition.attribute, comparison: undefined };
  }

  const comparison =
    condition.operator === 'greater_than' || condition.operator === 'less_than'
      ? condition.operator
      : undefined;
  if (condition.field === 'vitals') {
    return {
      field: 'vitals',
      vitalName: condition.value,
      threshold: condition.threshold,
      comparison,
    };
  }
  return {
    field: condition.field,
    code: condition.value,
    system: condition.system,
    threshold: condition.threshold,
    comparison,
  };
}

/** Kind-aware "does this condition depend on patient data?" check. An attribute
 *  condition is data-dependent unless its operator is `exists` (data-independent);
 *  a coded condition is data-dependent iff its operator is in DATA_DEPENDENT_OPERATORS. */
function isDataDependent(c: GateCondition): boolean {
  return isAttributeCondition(c) ? c.operator !== 'exists' : DATA_DEPENDENT_OPERATORS.has(c.operator);
}

function classifyGate(
  gate: GateProperties,
  patient: PatientContext,
  codeMap: AttributeCodeMap,
): GateClassification {
  if (gate.gate_type === GateType.QUESTION) {
    return 'QUESTION';
  }

  if (
    gate.gate_type === GateType.PRIOR_NODE_RESULT ||
    gate.gate_type === GateType.COMPOUND
  ) {
    return 'INDETERMINATE';
  }

  const conditions: GateCondition[] =
    gate.conditions ?? (gate.condition ? [gate.condition] : []);

  if (conditions.length === 0) {
    return 'INDETERMINATE';
  }

  const hasDataDependent = conditions.some(isDataDependent);

  if (!hasDataDependent) {
    return 'ALWAYS_EVALUABLE';
  }

  const allDataPresent = conditions.every((c) => hasDataForCondition(c, patient, codeMap));
  return allDataPresent ? 'DATA_AVAILABLE' : 'DATA_BLOCKED';
}

function buildExplanation(
  node: GraphNode,
  gate: GateProperties,
  classification: GateClassification,
  patient: PatientContext,
  codeMap: AttributeCodeMap,
): GateExplanation {
  const conditions: GateCondition[] =
    gate.conditions ?? (gate.condition ? [gate.condition] : []);

  const base = {
    gateNodeIdentifier: node.nodeIdentifier,
    gateTitle: gate.title,
    classification,
    missingData: [] as MissingData[],
  };

  switch (classification) {
    case 'QUESTION':
      return {
        ...base,
        reason: gate.prompt
          ? `Requires provider answer: ${gate.prompt}`
          : 'Requires provider answer',
      };
    case 'INDETERMINATE':
      return {
        ...base,
        reason:
          gate.gate_type === GateType.COMPOUND
            ? 'Compound gate — depends on resolution of sub-gates'
            : gate.gate_type === GateType.PRIOR_NODE_RESULT
              ? 'Depends on resolution of an upstream node'
              : 'Cannot pre-evaluate without additional context',
      };
    case 'ALWAYS_EVALUABLE':
      return {
        ...base,
        reason: 'Evaluates from patient codes already on file',
      };
    case 'DATA_AVAILABLE':
      return {
        ...base,
        reason: 'Patient has the data needed to resolve this gate',
      };
    case 'DATA_BLOCKED': {
      const missing = conditions
        .filter((c) => isDataDependent(c) && !hasDataForCondition(c, patient, codeMap))
        .map(missingDataForCondition);

      const summary = missing
        .map((m) => {
          if (m.vitalName) return m.vitalName;
          if (m.code && m.system) return `${m.system} ${m.code}`;
          return m.code ?? m.field ?? m.attribute;
        })
        .join(', ');

      return {
        ...base,
        missingData: missing,
        reason: summary
          ? `Missing data needed to evaluate: ${summary}`
          : 'Missing data needed to evaluate',
      };
    }
  }
}

export function scoreReachability(
  gateNodes: GraphNode[],
  patient: PatientContext,
  codeMap: AttributeCodeMap,
): ReachabilityScore {
  let totalGates = 0;
  let alwaysEvaluableGates = 0;
  let dataDependentGates = 0;
  let dataAvailableGates = 0;
  let questionGates = 0;
  let indeterminateGates = 0;
  const gateExplanations: GateExplanation[] = [];

  for (const node of gateNodes) {
    const gate = extractGateProperties(node);
    if (!gate) continue;

    totalGates++;
    const classification = classifyGate(gate, patient, codeMap);
    gateExplanations.push(buildExplanation(node, gate, classification, patient, codeMap));

    switch (classification) {
      case 'ALWAYS_EVALUABLE':
        alwaysEvaluableGates++;
        break;
      case 'DATA_AVAILABLE':
        dataDependentGates++;
        dataAvailableGates++;
        break;
      case 'DATA_BLOCKED':
        dataDependentGates++;
        break;
      case 'QUESTION':
        questionGates++;
        break;
      case 'INDETERMINATE':
        indeterminateGates++;
        break;
    }
  }

  const autoResolvableNumerator = alwaysEvaluableGates + dataAvailableGates;
  const autoResolvableScore =
    totalGates === 0 ? null : autoResolvableNumerator / totalGates;

  return {
    totalGates,
    alwaysEvaluableGates,
    dataDependentGates,
    dataAvailableGates,
    questionGates,
    indeterminateGates,
    autoResolvableScore,
    gateExplanations,
  };
}
