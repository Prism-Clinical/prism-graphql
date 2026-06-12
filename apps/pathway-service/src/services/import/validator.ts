import {
  PathwayJson,
  PathwayNodeType,
  PathwayEdgeType,
  CodeSetDefinition,
  REQUIRED_NODE_PROPERTIES,
  VALID_EDGE_ENDPOINTS,
  VALID_CODE_SYSTEMS,
  VALID_CODE_SET_SCOPES,
  VALID_MEDICATION_ROLES,
  VALID_EVIDENCE_LEVELS,
  VALID_BRANCH_MODES,
  MAX_GRAPH_NODES,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_DEPTH,
  ValidationResult,
} from './types';
import { PathwayCategory } from '../../types';

const VALID_NODE_TYPES = new Set<string>(Object.keys(REQUIRED_NODE_PROPERTIES));
const VALID_EDGE_TYPES = new Set<string>(Object.keys(VALID_EDGE_ENDPOINTS));
const VALID_CATEGORIES = new Set<string>(Object.values(PathwayCategory));

interface ValidateOptions {
  /** When true, missing required properties and other WIP issues become warnings instead of errors */
  draftMode?: boolean;
}

/**
 * Validate a pathway JSON definition.
 * Collects ALL errors — never fails on first error.
 *
 * In draftMode, "soft" issues (missing required properties, missing Stage nodes,
 * code format violations) are collected as warnings instead of errors, allowing
 * work-in-progress drafts to be saved.
 */
export function validatePathwayJson(pw: PathwayJson, options: ValidateOptions = {}): ValidationResult {
  const { draftMode = false } = options;
  const errors: string[] = [];
  const warnings: string[] = [];

  // ─── Top-level structure ─────────────────────────────────────────
  if (!pw.schema_version) {
    errors.push('Missing required field: schema_version');
  } else if (pw.schema_version !== '1.0') {
    errors.push(`Unsupported schema_version "${pw.schema_version}". Currently supported: "1.0"`);
  }

  if (!pw.pathway) {
    errors.push('Missing required field: pathway');
    // Can't validate further without pathway metadata
    return { valid: false, errors, warnings };
  }

  // ─── Pathway metadata ───────────────────────────────────────────
  const meta = pw.pathway;
  if (!meta.logical_id) errors.push('Missing required field: pathway.logical_id');
  if (!meta.title) errors.push('Missing required field: pathway.title');
  if (!meta.version) errors.push('Missing required field: pathway.version');
  if (!meta.category) {
    errors.push('Missing required field: pathway.category');
  } else if (!VALID_CATEGORIES.has(meta.category)) {
    errors.push(`Invalid pathway.category "${meta.category}". Must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
  }

  if (!meta.condition_codes || !Array.isArray(meta.condition_codes) || meta.condition_codes.length === 0) {
    errors.push('pathway.condition_codes must be a non-empty array');
  } else {
    validateConditionCodes(meta.condition_codes, errors, warnings);
  }

  // Phase 1b: validate optional code_sets if present.
  if (meta.code_sets !== undefined) {
    if (!Array.isArray(meta.code_sets)) {
      errors.push('pathway.code_sets must be an array when present');
    } else {
      validateCodeSets(meta.code_sets, errors, warnings);
    }
  }

  // ─── Nodes array ────────────────────────────────────────────────
  if (!pw.nodes || !Array.isArray(pw.nodes)) {
    errors.push('Missing required field: nodes (must be an array)');
    return { valid: errors.length === 0, errors, warnings };
  }

  if (pw.nodes.length > MAX_GRAPH_NODES) {
    errors.push(`Pathway exceeds maximum node count: ${pw.nodes.length} > ${MAX_GRAPH_NODES}`);
  }

  const nodeIds = new Set<string>();
  const nodeTypeMap = new Map<string, string>(); // id → type

  for (let i = 0; i < pw.nodes.length; i++) {
    const node = pw.nodes[i];
    if (!node.id) {
      errors.push(`node[${i}]: missing required field "id"`);
      continue;
    }

    if (nodeIds.has(node.id)) {
      errors.push(`node[${i}]: duplicate node id "${node.id}"`);
    }
    nodeIds.add(node.id);

    if (!node.type) {
      errors.push(`node[${i}] (${node.id}): missing required field "type"`);
    } else if (!VALID_NODE_TYPES.has(node.type)) {
      errors.push(`node[${i}] (${node.id}): invalid node type "${node.type}". Must be one of: ${[...VALID_NODE_TYPES].join(', ')}`);
    } else {
      nodeTypeMap.set(node.id, node.type);
      validateNodeProperties(node.id, node.type as PathwayNodeType, node.properties, i, errors, warnings, draftMode);
    }
  }

  // ─── Edges array ────────────────────────────────────────────────
  if (!pw.edges || !Array.isArray(pw.edges)) {
    errors.push('Missing required field: edges (must be an array)');
    return { valid: errors.length === 0, errors, warnings };
  }

  if (pw.edges.length > MAX_GRAPH_EDGES) {
    errors.push(`Pathway exceeds maximum edge count: ${pw.edges.length} > ${MAX_GRAPH_EDGES}`);
  }

  for (let i = 0; i < pw.edges.length; i++) {
    const edge = pw.edges[i];

    if (!edge.from) {
      errors.push(`edge[${i}]: missing required field "from"`);
      continue;
    }
    if (!edge.to) {
      errors.push(`edge[${i}]: missing required field "to"`);
      continue;
    }
    if (!edge.type) {
      errors.push(`edge[${i}]: missing required field "type"`);
      continue;
    }

    if (!VALID_EDGE_TYPES.has(edge.type)) {
      errors.push(`edge[${i}]: invalid edge type "${edge.type}". Must be one of: ${[...VALID_EDGE_TYPES].join(', ')}`);
      continue;
    }

    // Validate from reference exists (allow "root" as special source)
    if (edge.from !== 'root' && !nodeIds.has(edge.from)) {
      errors.push(`edge[${i}] (${edge.type}): "from" references nonexistent node "${edge.from}"`);
    }

    // Validate to reference exists
    if (!nodeIds.has(edge.to)) {
      errors.push(`edge[${i}] (${edge.type}): "to" references nonexistent node "${edge.to}"`);
    }

    // Validate edge endpoint type constraints
    const edgeType = edge.type as PathwayEdgeType;
    const constraints = VALID_EDGE_ENDPOINTS[edgeType];
    if (constraints) {
      const fromType = edge.from === 'root' ? 'root' : nodeTypeMap.get(edge.from);
      const toType = nodeTypeMap.get(edge.to);

      if (fromType && !constraints.from.includes(fromType as any)) {
        errors.push(`edge[${i}] (${edge.type}): "${edge.from}" is type "${fromType}" but ${edge.type} requires from to be one of: ${constraints.from.join(', ')}`);
      }
      if (toType && !constraints.to.includes(toType as any)) {
        errors.push(`edge[${i}] (${edge.type}): "${edge.to}" is type "${toType}" but ${edge.type} requires to to be one of: ${constraints.to.join(', ')}`);
      }
    }
  }

  // ─── Gate-specific validation ───────────────────────────────────
  validateGateNodes(pw, nodeIds, errors, warnings, draftMode);

  // ─── Semantic validation ────────────────────────────────────────
  validateSemanticRules(pw, nodeIds, nodeTypeMap, errors, warnings, draftMode);

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Gate Validation ──────────────────────────────────────────────────

function validateGateNodes(
  pw: PathwayJson,
  nodeIds: Set<string>,
  errors: string[],
  warnings: string[],
  draftMode: boolean,
): void {
  const edges = pw.edges && Array.isArray(pw.edges) ? pw.edges : [];
  const gateNodes = pw.nodes.filter(n => n.type === 'Gate');

  // Structural completeness checks fall into `warnings` in draft mode so a
  // gate that's mid-authoring (just dropped on the canvas, not yet wired or
  // configured) still autosaves. They re-promote to errors at publish time.
  const softTarget = draftMode ? warnings : errors;

  for (const gate of gateNodes) {
    const props = gate.properties || {};

    // Gate must have at least one outbound edge — soft in draft mode so a
    // newly-added gate doesn't block autosave before the user wires it up.
    const outbound = edges.filter(e => e.from === gate.id);
    if (outbound.length === 0) {
      softTarget.push(`Gate "${gate.id}": must have at least one outbound edge`);
    }

    // depends_on node IDs must exist in the pathway
    if (props.depends_on) {
      const dependsOn = Array.isArray(props.depends_on)
        ? props.depends_on as string[]
        : [props.depends_on as string];
      for (const depId of dependsOn) {
        if (!nodeIds.has(depId)) {
          errors.push(`Gate "${gate.id}": depends_on references nonexistent node "${depId}"`);
        }
      }
    }

    // select answer_type requires non-empty options array — also soft in
    // draft mode (author may still be filling in the options list).
    if (props.gate_type === 'select') {
      const options = props.options;
      if (!options || !Array.isArray(options) || options.length === 0) {
        softTarget.push(`Gate "${gate.id}": gate_type "select" requires a non-empty "options" array`);
      }
    }

    // compound gates must have non-empty conditions array — soft in draft.
    if (props.gate_type === 'compound') {
      const conditions = props.conditions;
      if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
        softTarget.push(`Gate "${gate.id}": gate_type "compound" requires a non-empty "conditions" array`);
      }
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function validateConditionCodes(
  codes: { code: string; system: string }[],
  errors: string[],
  warnings: string[]
): void {
  for (let i = 0; i < codes.length; i++) {
    const cc = codes[i];
    if (!cc.code) errors.push(`condition_codes[${i}]: missing "code"`);
    if (!cc.system) {
      errors.push(`condition_codes[${i}]: missing "system"`);
    } else if (!VALID_CODE_SYSTEMS.includes(cc.system as any)) {
      errors.push(`condition_codes[${i}]: invalid system "${cc.system}". Must be one of: ${VALID_CODE_SYSTEMS.join(', ')}`);
    }
  }
}

/**
 * Phase 1b: validate the optional `code_sets` JSON shape.
 * Each set must have a non-empty required_codes array; each member must have a
 * valid (code, system); scope and scope_override must be one of the supported
 * enum values.
 */
function validateCodeSets(
  sets: CodeSetDefinition[],
  errors: string[],
  warnings: string[]
): void {
  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];

    if (set.scope !== undefined && !VALID_CODE_SET_SCOPES.includes(set.scope)) {
      errors.push(`code_sets[${i}]: invalid scope "${set.scope}". Must be one of: ${VALID_CODE_SET_SCOPES.join(', ')}`);
    }

    if (!set.required_codes || !Array.isArray(set.required_codes) || set.required_codes.length === 0) {
      errors.push(`code_sets[${i}]: required_codes must be a non-empty array`);
      continue;
    }

    for (let j = 0; j < set.required_codes.length; j++) {
      const m = set.required_codes[j];
      if (!m.code) {
        errors.push(`code_sets[${i}].required_codes[${j}]: missing "code"`);
      }
      if (!m.system) {
        errors.push(`code_sets[${i}].required_codes[${j}]: missing "system"`);
      } else if (!VALID_CODE_SYSTEMS.includes(m.system as any)) {
        errors.push(`code_sets[${i}].required_codes[${j}]: invalid system "${m.system}". Must be one of: ${VALID_CODE_SYSTEMS.join(', ')}`);
      }
      if (m.scope_override !== undefined && !VALID_CODE_SET_SCOPES.includes(m.scope_override)) {
        errors.push(`code_sets[${i}].required_codes[${j}]: invalid scope_override "${m.scope_override}". Must be one of: ${VALID_CODE_SET_SCOPES.join(', ')}`);
      }
    }
  }
}

function validateNodeProperties(
  nodeId: string,
  nodeType: PathwayNodeType,
  properties: Record<string, unknown> | undefined,
  index: number,
  errors: string[],
  warnings: string[],
  draftMode: boolean
): void {
  if (!properties || typeof properties !== 'object') {
    errors.push(`node[${index}] (${nodeId}): missing "properties" object`);
    return;
  }

  const required = REQUIRED_NODE_PROPERTIES[nodeType];
  // In draft mode, missing required properties are warnings (WIP is expected)
  const target = draftMode ? warnings : errors;
  for (const prop of required) {
    if (properties[prop] === undefined || properties[prop] === null) {
      target.push(`node[${index}] (${nodeId}): ${nodeType} missing required property "${prop}"`);
    }
  }

  // Type-specific validation
  if (nodeType === 'Medication') {
    const role = properties.role as string;
    if (role && !VALID_MEDICATION_ROLES.includes(role as any)) {
      errors.push(`node[${index}] (${nodeId}): invalid medication role "${role}". Must be one of: ${VALID_MEDICATION_ROLES.join(', ')}`);
    }
  }

  if (nodeType === 'EvidenceCitation') {
    const level = properties.evidence_level as string;
    if (level && !VALID_EVIDENCE_LEVELS.includes(level as any)) {
      errors.push(`node[${index}] (${nodeId}): invalid evidence_level "${level}". Must be one of: ${VALID_EVIDENCE_LEVELS.join(', ')}`);
    }
  }

  if (nodeType === 'CodeEntry') {
    const system = properties.system as string;
    if (system && !VALID_CODE_SYSTEMS.includes(system as any)) {
      errors.push(`node[${index}] (${nodeId}): invalid code system "${system}". Must be one of: ${VALID_CODE_SYSTEMS.join(', ')}`);
    }
  }

  if (nodeType === 'DecisionPoint') {
    const mode = properties.branch_mode as string | undefined;
    if (mode && !VALID_BRANCH_MODES.includes(mode as any)) {
      errors.push(
        `node[${index}] (${nodeId}): invalid branch_mode "${mode}". Must be one of: ${VALID_BRANCH_MODES.join(', ')}`,
      );
    }
  }
}

function validateSemanticRules(
  pw: PathwayJson,
  nodeIds: Set<string>,
  nodeTypeMap: Map<string, string>,
  errors: string[],
  warnings: string[],
  draftMode: boolean
): void {
  // Guard: edges may be absent if structural validation already flagged it
  const edges = pw.edges && Array.isArray(pw.edges) ? pw.edges : [];

  // In draft mode, WIP-related semantic issues are warnings
  const softTarget = draftMode ? warnings : errors;

  // SE1: Code format validation for condition_codes
  if (pw.pathway.condition_codes) {
    for (let i = 0; i < pw.pathway.condition_codes.length; i++) {
      const cc = pw.pathway.condition_codes[i];
      if (cc.system && cc.code) {
        validateCodeFormat(cc.system, cc.code, `condition_codes[${i}]`, draftMode ? warnings : errors);
      }
    }
  }

  // SE2: At least one Stage node required
  const stageNodes = pw.nodes.filter(n => n.type === 'Stage');
  if (stageNodes.length === 0) {
    softTarget.push('Pathway must contain at least one Stage node');
  }

  // SE3: Graph depth check (compute from edge structure). REQUIRES is
  // cross-cut: it intentionally points "backwards" from a dependent node
  // to its prerequisite, so feeding it into the linear depth pass would
  // either inflate the depth or trigger a false cycle. Exclude it.
  const treeShapedEdges = edges.filter((e) => e.type !== 'REQUIRES');
  const depth = computeMaxDepth(treeShapedEdges);
  if (depth > MAX_GRAPH_DEPTH) {
    errors.push(`Pathway graph depth ${depth} exceeds maximum of ${MAX_GRAPH_DEPTH}`);
  } else if (depth > 30) {
    warnings.push(`Pathway graph depth is ${depth} — approaching the limit of ${MAX_GRAPH_DEPTH}`);
  }

  // SE3b: REQUIRES subgraph must be acyclic. A cycle here means the
  // backtracking resolver would loop forever ("28w requires 20w which
  // requires 28w"). Run a dedicated Kahn pass on only the REQUIRES
  // edges so the error can name the offending nodes precisely.
  const requiresCycle = detectRequiresCycle(edges);
  if (requiresCycle.length > 0) {
    errors.push(
      `REQUIRES subgraph contains a cycle through node(s): ${requiresCycle.join(
        ' → ',
      )}. Prerequisite chains must terminate.`,
    );
  }

  // SE4: Root must have at least one HAS_STAGE edge
  const rootStageEdges = edges.filter(e => e.from === 'root' && e.type === 'HAS_STAGE');
  if (rootStageEdges.length === 0) {
    softTarget.push('Pathway must have at least one root → HAS_STAGE edge');
  }

  // SE5: DecisionPoints should have BRANCHES_TO edges
  const decisionPoints = pw.nodes.filter(n => n.type === 'DecisionPoint');
  const branchEdgeTargets = new Set(edges.filter(e => e.type === 'BRANCHES_TO').map(e => e.from));
  for (const dp of decisionPoints) {
    if (!branchEdgeTargets.has(dp.id)) {
      warnings.push(`DecisionPoint "${dp.id}" has no BRANCHES_TO edges — it cannot route to any branch`);
    }
  }

  // SE6: Orphan node detection
  const connectedNodes = new Set<string>();
  for (const edge of edges) {
    if (edge.from !== 'root') connectedNodes.add(edge.from);
    connectedNodes.add(edge.to);
  }
  for (const nodeId of nodeIds) {
    if (!connectedNodes.has(nodeId)) {
      warnings.push(`Node "${nodeId}" is an orphan — not connected by any edge`);
    }
  }

  // SE7: CodeEntry and node code format validation (LOINC, CPT, SNOMED, RxNorm)
  for (let i = 0; i < pw.nodes.length; i++) {
    const node = pw.nodes[i];
    if (node.type === 'CodeEntry' && node.properties.system && node.properties.code) {
      validateCodeFormat(
        node.properties.system as string,
        node.properties.code as string,
        `node[${i}] (${node.id})`,
        draftMode ? warnings : errors
      );
    }
  }

  // SE8: Cross-reference — criterion code_values should appear in condition_codes
  const definedCodes = new Set(
    (pw.pathway.condition_codes || []).map(cc => cc.code)
  );
  for (const node of pw.nodes) {
    if (node.type === 'Criterion' && node.properties.code_value) {
      const code = node.properties.code_value as string;
      if (!definedCodes.has(code)) {
        warnings.push(`Criterion "${node.id}" references code "${code}" not found in pathway condition_codes — it may not be matchable`);
      }
    }
  }
}

function validateCodeFormat(system: string, code: string, context: string, errors: string[]): void {
  switch (system) {
    case 'ICD-10':
      if (!/^[A-Z]\d{2}(\.\w{1,4})?$/i.test(code)) {
        errors.push(`${context}: invalid ICD-10 code format "${code}" (expected pattern like "A00.0" or "O34.211")`);
      }
      break;
    case 'LOINC':
      if (!/^\d{1,5}-\d$/.test(code)) {
        errors.push(`${context}: invalid LOINC code format "${code}" (expected pattern like "58410-2")`);
      }
      break;
    case 'CPT':
      if (!/^\d{5}$/.test(code)) {
        errors.push(`${context}: invalid CPT code format "${code}" (expected 5-digit code like "59510")`);
      }
      break;
    case 'SNOMED':
      if (!/^\d{6,18}$/.test(code)) {
        errors.push(`${context}: invalid SNOMED code format "${code}" (expected 6-18 digit code)`);
      }
      break;
    // RXNORM: no strict format — skip
  }
}

function computeMaxDepth(edges: PathwayJson['edges']): number {
  // Build adjacency list and in-degree map. Cycle detection is via Kahn's
  // topological sort: if any node remains unprocessed, the graph has a cycle.
  // Longest-path-in-DAG is then computed in topological order in O(V+E).
  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const allNodes = new Set<string>(['root']);

  for (const edge of edges) {
    if (!children.has(edge.from)) children.set(edge.from, []);
    children.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    allNodes.add(edge.from);
    allNodes.add(edge.to);
  }
  for (const n of allNodes) {
    if (!inDegree.has(n)) inDegree.set(n, 0);
  }

  // Topo-sort sources first
  const queue: string[] = [];
  for (const [n, d] of inDegree) {
    if (d === 0) queue.push(n);
  }

  const depthMap = new Map<string, number>();
  depthMap.set('root', 0);
  let processed = 0;
  let maxDepth = 0;

  while (queue.length > 0) {
    const node = queue.shift()!;
    processed++;
    const d = depthMap.get(node) ?? 0;
    if (d > maxDepth) maxDepth = d;

    for (const kid of children.get(node) ?? []) {
      const kidDepth = depthMap.get(kid);
      if (kidDepth === undefined || kidDepth < d + 1) {
        depthMap.set(kid, d + 1);
      }
      const remaining = (inDegree.get(kid) ?? 0) - 1;
      inDegree.set(kid, remaining);
      if (remaining === 0) queue.push(kid);
    }
  }

  // Cycle: some node never reached zero in-degree
  if (processed < allNodes.size) {
    return MAX_GRAPH_DEPTH + 1;
  }

  return maxDepth;
}

/**
 * Detects a cycle in the REQUIRES subgraph using Kahn's algorithm
 * restricted to REQUIRES edges. Returns the node ids that remain in the
 * cycle (i.e. couldn't reach in-degree zero) so the validator can name
 * them in the error message. Returns an empty array when the subgraph
 * is acyclic.
 */
function detectRequiresCycle(edges: PathwayJson['edges']): string[] {
  const requiresEdges = (edges ?? []).filter((e) => e.type === 'REQUIRES');
  if (requiresEdges.length === 0) return [];

  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const allNodes = new Set<string>();

  for (const edge of requiresEdges) {
    if (!children.has(edge.from)) children.set(edge.from, []);
    children.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    allNodes.add(edge.from);
    allNodes.add(edge.to);
  }
  for (const n of allNodes) {
    if (!inDegree.has(n)) inDegree.set(n, 0);
  }

  const queue: string[] = [];
  for (const [n, d] of inDegree) {
    if (d === 0) queue.push(n);
  }
  let processed = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    processed++;
    for (const kid of children.get(node) ?? []) {
      const remaining = (inDegree.get(kid) ?? 0) - 1;
      inDegree.set(kid, remaining);
      if (remaining === 0) queue.push(kid);
    }
  }

  if (processed === allNodes.size) return [];
  // Anything still with non-zero in-degree is in (or downstream of) a cycle.
  return Array.from(inDegree)
    .filter(([, d]) => d > 0)
    .map(([n]) => n);
}
