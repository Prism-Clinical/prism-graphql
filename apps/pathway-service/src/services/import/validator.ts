import {
  PathwayJson,
  PathwayNodeType,
  PathwayEdgeType,
  REQUIRED_NODE_PROPERTIES,
  VALID_EDGE_ENDPOINTS,
  VALID_CODE_SYSTEMS,
  VALID_MEDICATION_ROLES,
  VALID_EVIDENCE_LEVELS,
  MAX_GRAPH_NODES,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_DEPTH,
  ValidationResult,
} from './types';
import { PathwayCategory } from '../../types';

const VALID_NODE_TYPES = new Set<string>(Object.keys(REQUIRED_NODE_PROPERTIES));
const VALID_EDGE_TYPES = new Set<string>(Object.keys(VALID_EDGE_ENDPOINTS));
const VALID_CATEGORIES = new Set<string>(Object.values(PathwayCategory));

/**
 * Validate a pathway JSON definition.
 * Collects ALL errors — never fails on first error.
 */
export function validatePathwayJson(pw: PathwayJson): ValidationResult {
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
      validateNodeProperties(node.id, node.type as PathwayNodeType, node.properties, i, errors, warnings);
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

  // ─── Semantic validation ────────────────────────────────────────
  validateSemanticRules(pw, nodeIds, nodeTypeMap, errors, warnings);

  return { valid: errors.length === 0, errors, warnings };
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

function validateNodeProperties(
  nodeId: string,
  nodeType: PathwayNodeType,
  properties: Record<string, unknown> | undefined,
  index: number,
  errors: string[],
  warnings: string[]
): void {
  if (!properties || typeof properties !== 'object') {
    errors.push(`node[${index}] (${nodeId}): missing "properties" object`);
    return;
  }

  const required = REQUIRED_NODE_PROPERTIES[nodeType];
  for (const prop of required) {
    if (properties[prop] === undefined || properties[prop] === null) {
      errors.push(`node[${index}] (${nodeId}): ${nodeType} missing required property "${prop}"`);
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
}

function validateSemanticRules(
  pw: PathwayJson,
  nodeIds: Set<string>,
  nodeTypeMap: Map<string, string>,
  errors: string[],
  warnings: string[]
): void {
  // Guard: edges may be absent if structural validation already flagged it
  const edges = pw.edges && Array.isArray(pw.edges) ? pw.edges : [];

  // SE1: Code format validation for condition_codes
  if (pw.pathway.condition_codes) {
    for (let i = 0; i < pw.pathway.condition_codes.length; i++) {
      const cc = pw.pathway.condition_codes[i];
      if (cc.system && cc.code) {
        validateCodeFormat(cc.system, cc.code, `condition_codes[${i}]`, errors);
      }
    }
  }

  // SE2: At least one Stage node required
  const stageNodes = pw.nodes.filter(n => n.type === 'Stage');
  if (stageNodes.length === 0) {
    errors.push('Pathway must contain at least one Stage node');
  }

  // SE3: Graph depth check (compute from edge structure)
  const depth = computeMaxDepth(edges);
  if (depth > MAX_GRAPH_DEPTH) {
    errors.push(`Pathway graph depth ${depth} exceeds maximum of ${MAX_GRAPH_DEPTH}`);
  } else if (depth > 30) {
    warnings.push(`Pathway graph depth is ${depth} — approaching the limit of ${MAX_GRAPH_DEPTH}`);
  }

  // SE4: Root must have at least one HAS_STAGE edge
  const rootStageEdges = edges.filter(e => e.from === 'root' && e.type === 'HAS_STAGE');
  if (rootStageEdges.length === 0) {
    errors.push('Pathway must have at least one root → HAS_STAGE edge');
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
        errors
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
  // Build adjacency list
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (!children.has(edge.from)) children.set(edge.from, []);
    children.get(edge.from)!.push(edge.to);
  }

  // BFS from root, tracking maximum depth per node (handles DAGs where
  // the same node is reachable via multiple paths at different depths).
  const maxDepthMap = new Map<string, number>();
  let maxDepth = 0;
  const queue: Array<{ node: string; depth: number }> = [{ node: 'root', depth: 0 }];

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    const knownDepth = maxDepthMap.get(node);
    if (knownDepth !== undefined && knownDepth >= depth) continue;
    maxDepthMap.set(node, depth);
    maxDepth = Math.max(maxDepth, depth);

    const kids = children.get(node) || [];
    for (const kid of kids) {
      const kidDepth = maxDepthMap.get(kid);
      if (kidDepth === undefined || kidDepth < depth + 1) {
        queue.push({ node: kid, depth: depth + 1 });
      }
    }
  }

  return maxDepth;
}
