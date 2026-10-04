// apps/pathway-service/src/services/compiler/gates.ts
import { NodeStatus } from '../../types';
import { calendarConditionError, isCalendarCondition } from '../resolution/temporal/condition-adapter';
import type { ChoiceArm, CompileError, CompileErrorCode, CompiledGate, DefaultBehavior, GateArm, GraphEdgeIn, NodeKind } from './model';

const STATUSES = new Set<string>(Object.values(NodeStatus));
const GATE_TYPES: Record<string, CompiledGate['type']> = {
  patient_attribute: 'condition', compound: 'condition', question: 'question',
  prior_node_result: 'prior_result', llm_text_analysis: 'llm',
};
const SCALAR_CODED = new Set(['greater_than', 'less_than']);
const whenOf = (edge: GraphEdgeIn): unknown => (edge.properties ?? {}).when;
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isScalar = (v: unknown) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';

/** Why a condition cannot be evaluated as written, or null. Operator vocabularies are checked by the import validator. */
export function conditionProblem(c: unknown): string | null {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return 'a condition must be an object';
  const r = c as Record<string, unknown>;
  // A nested AND/OR group (josh-dev): sound when its operator is and every
  // entry inside it is — leaves and further groups alike.
  if (Array.isArray(r.conditions) && r.field === undefined && r.attribute === undefined) {
    const op = String(r.operator ?? '').toUpperCase();
    if (op !== 'AND' && op !== 'OR') return 'a condition group needs operator "AND" or "OR"';
    if (r.conditions.length === 0) return 'a condition group needs at least one condition';
    for (const inner of r.conditions) {
      const problem = conditionProblem(inner);
      if (problem) return problem;
    }
    return null;
  }
  // `encounter.date in_season`: engine-supplied, with its own grammar (from/to,
  // no value) — checked by the parser the evaluator runs.
  if (isCalendarCondition(r)) return calendarConditionError(r);
  if (typeof r.attribute === 'string') {
    if (typeof r.operator !== 'string') return `the condition on "${r.attribute}" has no operator`;
    if (r.operator === 'exists') return null;
    if (r.operator === 'in') return Array.isArray(r.value) && r.value.length > 0 ? null : `the condition on "${r.attribute}" (in) needs a non-empty array value`;
    return isScalar(r.value) ? null : `the condition on "${r.attribute}" (${r.operator}) needs a value to compare against`;
  }
  if (typeof r.field === 'string') {
    if (typeof r.operator !== 'string') return `the condition on ${r.field} has no operator`;
    if (r.operator === 'exists') return null; // bucket existence: the adapter ignores code and system (condition-adapter.ts)
    if (typeof r.value !== 'string' || r.value === '') return `the condition on ${r.field} (${r.operator}) needs a code value`;
    if (SCALAR_CODED.has(r.operator) && !(typeof r.threshold === 'number' && Number.isFinite(r.threshold))) {
      return `the condition on ${r.field} ${r.value} (${r.operator}) needs a numeric threshold`;
    }
    return null;
  }
  return 'a condition needs either field or attribute';
}

export function compileGate(
  id: string,
  props: Record<string, unknown>,
  armEdges: GraphEdgeIn[],
  kinds: Map<string, NodeKind>,
  nodeTypes: Map<string, string>,
  errors: CompileError[],
): { gate: CompiledGate; arms: GateArm[] } | null {
  const err = (code: CompileErrorCode, message: string) => errors.push({ code, nodeId: id, message: `Gate "${id}": ${message}` });

  const type = GATE_TYPES[String(props.gate_type ?? '')];
  if (!type) { err('GATE_TYPE', `unknown gate_type "${String(props.gate_type)}"`); return null; }

  const db = String(props.default_behavior ?? '').toLowerCase();
  if (db !== 'skip' && db !== 'traverse') err('DEFAULT_BEHAVIOR', `default_behavior must be "skip" or "traverse" (got "${String(props.default_behavior)}")`);
  const defaultBehavior: DefaultBehavior = db === 'traverse' ? 'traverse' : 'skip';

  const arms: GateArm[] = armEdges
    .map((e) => (whenOf(e) === undefined ? { id: `${id}->${e.to}`, target: e.to } : { id: `${id}->${e.to}`, target: e.to, when: whenOf(e) }))
    .sort(byId);
  if (arms.length === 0) err('NO_TARGET', 'has no BRANCHES_TO target');

  const routing = type === 'question' || type === 'llm';
  if (routing && arms.length > 1) {
    for (const a of arms) if (a.when === undefined) err('MISSING_WHEN', `the branch to "${a.target}" needs a \`when\`, because the gate routes to ${arms.length} targets`);
  }
  if (!routing && arms.length > 1) {
    // BRANCHES_TO targets only Steps/Stages and only a Stage contains Steps (VALID_EDGE_ENDPOINTS), so these are the legal rewrites.
    err('MULTI_TARGET_NON_ROUTING_GATE',
      `a ${String(props.gate_type)} gate is evaluated from the chart and must guard exactly one target, but it has ${arms.length} ` +
      `(${arms.map((a) => a.target).join(', ')}). If all of them apply, use one gate per target, or put the target Steps under one Stage and guard that Stage. ` +
      `If they are alternatives, guard one Step that contains a DecisionPoint whose branches go to them.`);
  }

  switch (type) {
    case 'condition': {
      const ou = props.on_unresolved === undefined ? 'ask' : String(props.on_unresolved);
      if (ou !== 'ask' && ou !== 'default') err('ON_UNRESOLVED', `on_unresolved must be "ask" or "default" (got "${ou}")`);
      const onUnresolved = ou === 'default' ? 'default' : 'ask';
      if (props.gate_type === 'compound') {
        const op = String(props.operator ?? 'AND').toUpperCase();
        if (op !== 'AND' && op !== 'OR') err('COMPOUND_OPERATOR', `compound operator must be AND or OR (got "${String(props.operator)}")`);
        const conditions = Array.isArray(props.conditions) ? (props.conditions as Record<string, unknown>[]) : [];
        if (conditions.length === 0) err('PAYLOAD', 'a compound gate needs at least one condition');
        conditions.forEach((c, i) => { const p = conditionProblem(c); if (p) err('PAYLOAD', `condition ${i + 1}: ${p}`); });
        return { gate: { type, conditions, operator: op === 'OR' ? 'OR' : 'AND', onUnresolved, defaultBehavior }, arms };
      }
      if (props.condition === undefined || props.condition === null) {
        err('PAYLOAD', 'a patient_attribute gate needs a condition');
        return { gate: { type, conditions: [], operator: null, onUnresolved, defaultBehavior }, arms };
      }
      const p = conditionProblem(props.condition);
      if (p) err('PAYLOAD', p);
      return { gate: { type, conditions: [props.condition as Record<string, unknown>], operator: null, onUnresolved, defaultBehavior }, arms };
    }
    case 'question': {
      const at = String(props.answer_type ?? 'boolean').toLowerCase();
      if (at !== 'boolean' && at !== 'numeric' && at !== 'select') err('PAYLOAD', `answer_type must be boolean, numeric or select (got "${String(props.answer_type)}")`);
      const answerType = at === 'numeric' ? 'numeric' : at === 'select' ? 'select' : 'boolean';
      const options = Array.isArray(props.options) ? (props.options as unknown[]).filter((o): o is string => typeof o === 'string') : [];
      if (answerType === 'select' && options.length === 0) err('PAYLOAD', 'a select question needs a non-empty list of options');
      return { gate: { type, answerType, options, defaultBehavior }, arms };
    }
    case 'prior_result': {
      const raw = props.depends_on;
      const dependsOn: { nodeId: string; status: string }[] = [];
      if (!Array.isArray(raw) || raw.length === 0) {
        err('DEPENDS_ON', `depends_on must be a non-empty array of { node_id, status } (got ${JSON.stringify(raw)})`);
      } else {
        for (const d of raw as unknown[]) {
          const entry = d as { node_id?: unknown; status?: unknown } | null;
          if (typeof entry !== 'object' || entry === null || typeof entry.node_id !== 'string' || typeof entry.status !== 'string') {
            err('DEPENDS_ON', `depends_on entry ${JSON.stringify(d)} must be { node_id, status }`);
            continue;
          }
          const nodeId = entry.node_id;
          const status = entry.status;
          if (!STATUSES.has(status)) err('DEPENDS_ON', `depends_on status "${status}" is not one of ${[...STATUSES].join(', ')}`);
          const kind = kinds.get(nodeId);
          if (!kind) err('DEPENDS_ON', `depends_on target "${nodeId}" does not exist`);
          else if (kind === 'annotation') err('DEPENDS_ON', `depends_on target "${nodeId}" is an annotation; depend on its owner instead`);
          else if (nodeTypes.get(nodeId) === 'Medication') err('DEPENDS_ON', `depends_on target "${nodeId}" is a Medication, which can be withheld after evaluation (EP D11)`);
          dependsOn.push({ nodeId, status });
        }
      }
      return { gate: { type, dependsOn, defaultBehavior }, arms };
    }
    case 'llm': {
      const branches = Array.isArray(props.branches) ? (props.branches as Array<Record<string, unknown>>) : [];
      if (branches.length === 0 || branches.some((b) => typeof b?.name !== 'string')) err('PAYLOAD', 'an llm_text_analysis gate needs a non-empty list of named branches');
      if (branches.filter((b) => b?.is_safe_default === true).length !== 1) err('PAYLOAD', 'an llm_text_analysis gate needs exactly one branch with is_safe_default: true');
      return { gate: { type, properties: props, defaultBehavior }, arms };
    }
  }
}

export function compileChoice(
  id: string,
  props: Record<string, unknown>,
  armEdges: GraphEdgeIn[],
  errors: CompileError[],
): { mode: 'one_of' | 'all_of' | 'any_of'; arms: ChoiceArm[] } {
  const mode = props.branch_mode;
  if (mode !== 'one_of' && mode !== 'all_of' && mode !== 'any_of') {
    errors.push({ code: 'BRANCH_MODE', nodeId: id, message: `DecisionPoint "${id}": branch_mode must be one_of, all_of or any_of (got "${String(mode)}")` });
  }
  for (const e of armEdges) {
    if (whenOf(e) !== undefined) errors.push({ code: 'CHOICE_ARM_WHEN', nodeId: id, message: `DecisionPoint "${id}": the branch to "${e.to}" has a \`when\`; a DecisionPoint selects by qualification or provider choice, not by answer value` });
  }
  const arms = armEdges.map((e) => ({ id: `${id}->${e.to}`, target: e.to })).sort(byId);
  return { mode: mode === 'all_of' || mode === 'any_of' ? mode : 'one_of', arms };
}
