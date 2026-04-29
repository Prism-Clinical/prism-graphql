import { z } from 'zod';
import {
  VALID_EDGE_ENDPOINTS,
  REQUIRED_NODE_PROPERTIES,
  type PathwayNodeType,
  type PathwayEdgeType,
} from '@/types';

// ─── Node and Edge type enums ───────────────────────────────────────

const PATHWAY_NODE_TYPES: PathwayNodeType[] = [
  'Stage', 'Step', 'DecisionPoint', 'Criterion', 'CodeEntry',
  'Medication', 'LabTest', 'Procedure', 'EvidenceCitation',
  'QualityMetric', 'Schedule',
];

const PATHWAY_EDGE_TYPES: PathwayEdgeType[] = [
  'HAS_STAGE', 'HAS_STEP', 'HAS_DECISION_POINT', 'HAS_CRITERION',
  'BRANCHES_TO', 'USES_MEDICATION', 'ESCALATES_TO', 'CITES_EVIDENCE',
  'HAS_LAB_TEST', 'HAS_PROCEDURE', 'HAS_QUALITY_METRIC', 'HAS_SCHEDULE',
  'HAS_CODE',
];

// ─── Code format patterns ───────────────────────────────────────────

const CODE_PATTERNS: Record<string, RegExp> = {
  'ICD-10': /^[A-Z]\d{2}(\.\w{1,4})?$/i,
  'SNOMED': /^\d{6,18}$/,
  'LOINC': /^\d{1,5}-\d$/,
  'CPT': /^\d{5}$/,
  'RXNORM': /^\d+$/,
};

// ─── Zod schemas ────────────────────────────────────────────────────

const conditionCodeSchema = z.object({
  code: z.string().min(1, 'Condition code is required'),
  system: z.string().min(1, 'Code system is required'),
  description: z.string().optional(),
  usage: z.string().optional(),
  grouping: z.string().optional(),
});

const pathwayMetadataSchema = z.object({
  logical_id: z.string().min(1, 'Logical ID is required'),
  title: z.string().min(1, 'Title is required'),
  version: z.string().min(1, 'Version is required'),
  category: z.string().min(1, 'Category is required'),
  scope: z.string().optional(),
  target_population: z.string().optional(),
  condition_codes: z.array(conditionCodeSchema).min(1, 'At least one condition code is required'),
});

const nodeSchema = z.object({
  id: z.string().min(1, 'Node ID is required'),
  type: z.enum(PATHWAY_NODE_TYPES as [string, ...string[]], {
    error: `Invalid node type. Must be one of: ${PATHWAY_NODE_TYPES.join(', ')}`,
  }),
  properties: z.record(z.string(), z.unknown()),
});

const edgeSchema = z.object({
  from: z.string().min(1, 'Edge source is required'),
  to: z.string().min(1, 'Edge target is required'),
  type: z.enum(PATHWAY_EDGE_TYPES as [string, ...string[]], {
    error: `Invalid edge type. Must be one of: ${PATHWAY_EDGE_TYPES.join(', ')}`,
  }),
  properties: z.record(z.string(), z.unknown()).optional(),
});

const pathwayJsonSchema = z.object({
  schema_version: z.literal('1.0', { error: 'schema_version must be "1.0"' }),
  pathway: pathwayMetadataSchema,
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

// ─── Validation error with node/edge mapping ────────────────────────

export interface MappedValidationError {
  message: string;
  nodeId?: string;
  edgeIndex?: number;
  path: string;
}

export interface ClientValidationResult {
  valid: boolean;
  errors: MappedValidationError[];
}

/**
 * Validate a PathwayJson object client-side.
 * Returns structured errors mapped to specific nodes/edges.
 */
export function validatePathwayJson(json: unknown): ClientValidationResult {
  const errors: MappedValidationError[] = [];

  // Phase 1: Zod structural validation
  const zodResult = pathwayJsonSchema.safeParse(json);
  if (!zodResult.success) {
    for (const issue of zodResult.error.issues) {
      const pathStr = issue.path.join('.');
      const error: MappedValidationError = {
        message: issue.message,
        path: pathStr,
      };

      // Map to node/edge if possible
      if (issue.path[0] === 'nodes' && typeof issue.path[1] === 'number') {
        const nodeIndex = issue.path[1];
        const parsed = zodResult.data ?? (json as { nodes?: { id?: string }[] });
        const nodeId = (parsed as { nodes?: { id?: string }[] })?.nodes?.[nodeIndex]?.id;
        if (nodeId) error.nodeId = nodeId;
      }
      if (issue.path[0] === 'edges' && typeof issue.path[1] === 'number') {
        error.edgeIndex = issue.path[1];
      }

      errors.push(error);
    }
    return { valid: false, errors };
  }

  const data = zodResult.data;

  // Phase 2: Required properties per node type
  for (let i = 0; i < data.nodes.length; i++) {
    const node = data.nodes[i];
    const required = REQUIRED_NODE_PROPERTIES[node.type as PathwayNodeType];
    if (!required) continue;

    for (const prop of required) {
      const value = node.properties[prop];
      if (value === undefined || value === null || value === '') {
        errors.push({
          message: `${node.type} node requires property "${prop}"`,
          nodeId: node.id,
          path: `nodes[${i}].properties.${prop}`,
        });
      }
    }
  }

  // Phase 3: Edge endpoint constraints
  const nodeTypeMap = new Map(data.nodes.map((n) => [n.id, n.type]));
  for (let i = 0; i < data.edges.length; i++) {
    const edge = data.edges[i];
    const constraint = VALID_EDGE_ENDPOINTS[edge.type as PathwayEdgeType];
    if (!constraint) continue;

    const fromType = edge.from === 'root' ? 'root' : nodeTypeMap.get(edge.from);
    const toType = nodeTypeMap.get(edge.to);

    if (fromType && !constraint.from.includes(fromType as PathwayNodeType | 'root')) {
      errors.push({
        message: `Edge type ${edge.type} cannot originate from ${fromType} node`,
        edgeIndex: i,
        path: `edges[${i}].from`,
      });
    }
    if (toType && !constraint.to.includes(toType as PathwayNodeType)) {
      errors.push({
        message: `Edge type ${edge.type} cannot target ${toType} node`,
        edgeIndex: i,
        path: `edges[${i}].to`,
      });
    }
  }

  // Phase 4: Code format validation on CodeEntry nodes
  for (let i = 0; i < data.nodes.length; i++) {
    const node = data.nodes[i];
    if (node.type !== 'CodeEntry') continue;

    const system = node.properties.system as string | undefined;
    const code = node.properties.code as string | undefined;
    if (system && code) {
      const pattern = CODE_PATTERNS[system];
      if (pattern && !pattern.test(code)) {
        errors.push({
          message: `Invalid ${system} code format: "${code}"`,
          nodeId: node.id,
          path: `nodes[${i}].properties.code`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
