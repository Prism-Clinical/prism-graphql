# Admin Dashboard Plan 3: Serializer, Save Flow & Editor Hydration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the admin dashboard graph editor to the backend so pathways can be loaded, edited, saved as drafts, and published as new versions with diff review.

**Architecture:** A single new `pathwayGraph` query on pathway-service exposes the full graph structure. Client-side serializer/deserializer converts between `PathwayJson` and React Flow state. Zod validation catches errors before network calls. Save Draft uses `importPathway(DRAFT_UPDATE)`, Publish uses `importPathway(NEW_VERSION)` with a diff review modal. The editor page hydrates the canvas from the query on load.

**Tech Stack:** TypeScript 5, Apollo Client 4, React Flow 12, Zod, Next.js 16, Apollo Server 4

**Spec:** `prism-graphql/docs/superpowers/specs/2026-04-01-admin-dashboard-serializer-save-flow-design.md`

**Depends on:** Plan 2 (graph editor, completed)

---

## File Structure

```
prism-graphql/apps/pathway-service/
├── schema.graphql                                    # + PathwayGraph type, pathwayGraph query
└── src/resolvers/
    └── Query.ts                                      # + pathwayGraph resolver

prism-admin-dashboard/src/
├── lib/
│   ├── pathway-json/
│   │   ├── deserializer.ts                           # PathwayJson → React Flow state
│   │   ├── serializer.ts                             # React Flow → PathwayJson
│   │   └── validator.ts                              # Zod schemas + error mapping
│   ├── graphql/
│   │   ├── queries/
│   │   │   └── pathways.ts                           # + GET_PATHWAY_GRAPH query
│   │   └── mutations/
│   │       └── pathways.ts                           # IMPORT_PATHWAY, ACTIVATE_PATHWAY
│   └── hooks/
│       └── usePathwaySave.ts                         # Save/publish orchestration hook
├── components/
│   ├── editor/
│   │   ├── EditorToolbar.tsx                         # + Save Draft, Publish buttons
│   │   └── DiffReviewModal.tsx                       # Diff summary + activate/keep-draft
│   └── graph/
│       └── PathwayCanvas.tsx                         # + initialNodes/initialEdges props
├── app/
│   └── pathways/
│       └── [id]/
│           └── page.tsx                              # Hydration via pathwayGraph query
└── types/
    └── index.ts                                      # + PathwayGraph response types
```

---

### Task 1: Backend — `pathwayGraph` Query

**Files:**
- Modify: `prism-graphql/apps/pathway-service/schema.graphql`
- Modify: `prism-graphql/apps/pathway-service/src/resolvers/Query.ts`

- [ ] **Step 1: Add GraphQL schema types**

Add after the existing `Pathway` type (around line 67) in `prism-graphql/apps/pathway-service/schema.graphql`:

```graphql
type PathwayGraphNode {
  id: String!
  type: String!
  properties: JSON!
}

type PathwayGraphEdge {
  from: String!
  to: String!
  type: String!
  properties: JSON
}

type PathwayConditionCode {
  code: String!
  system: String!
  description: String
  usage: String
  grouping: String
}

type PathwayGraph {
  pathway: Pathway!
  nodes: [PathwayGraphNode!]!
  edges: [PathwayGraphEdge!]!
  conditionCodeDetails: [PathwayConditionCode!]!
}
```

The `conditionCodeDetails` field returns the full condition code objects (with `system`, `description`, etc.) from the reconstructed PathwayJson. The `Pathway.conditionCodes` field only has code strings — the serializer needs the full objects to produce valid PathwayJson for re-import.

Add `pathwayGraph` to the `Query` type (after the existing `pathway(id: ID!): Pathway` line):

```graphql
  pathwayGraph(id: ID!): PathwayGraph
```

- [ ] **Step 2: Import `reconstructPathwayJson` in Query.ts**

In `prism-graphql/apps/pathway-service/src/resolvers/Query.ts`, add to the imports at the top:

```typescript
import { reconstructPathwayJson } from '../services/import/import-orchestrator';
```

Note: `reconstructPathwayJson` is currently not exported. You'll need to export it from the import orchestrator. In `prism-graphql/apps/pathway-service/src/services/import/import-orchestrator.ts`, change:

```typescript
async function reconstructPathwayJson(
```

to:

```typescript
export async function reconstructPathwayJson(
```

- [ ] **Step 3: Add the `pathwayGraph` resolver**

Add the resolver inside the `Query` object in `prism-graphql/apps/pathway-service/src/resolvers/Query.ts`, after the existing `pathway` resolver:

```typescript
    pathwayGraph: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      const client = await context.pool.connect();
      try {
        // First get the pathway metadata
        const pathwayResult = await client.query(
          `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
          [id],
        );
        const pathway = pathwayResult.rows[0];
        if (!pathway) return null;

        // Reconstruct the full graph
        const pathwayJson = await reconstructPathwayJson(client, id);
        if (!pathwayJson) {
          // Return pathway with empty graph if reconstruction fails
          return { pathway, nodes: [], edges: [], conditionCodeDetails: [] };
        }

        return {
          pathway,
          nodes: pathwayJson.nodes,
          edges: pathwayJson.edges,
          conditionCodeDetails: pathwayJson.pathway.condition_codes,
        };
      } finally {
        client.release();
      }
    },
```

- [ ] **Step 4: Verify the backend builds**

Run:
```bash
npm --prefix /home/claude/workspace/prism-graphql run build --workspace=apps/pathway-service
```

Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/schema.graphql apps/pathway-service/src/resolvers/Query.ts apps/pathway-service/src/services/import/import-orchestrator.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat(pathway-service): add pathwayGraph query for full graph retrieval"
```

---

### Task 2: Add Response Types + GraphQL Operations to Admin Dashboard

**Files:**
- Modify: `prism-admin-dashboard/src/types/index.ts`
- Modify: `prism-admin-dashboard/src/lib/graphql/queries/pathways.ts`
- Create: `prism-admin-dashboard/src/lib/graphql/mutations/pathways.ts`

- [ ] **Step 1: Add graph response types**

Add at the end of `prism-admin-dashboard/src/types/index.ts`:

```typescript
// ─── PathwayJson Types (for serializer output) ─────────────────────

export interface ConditionCodeDefinition {
  code: string;
  system: string;
  description?: string;
  usage?: string;
  grouping?: string;
}

export interface PathwayMetadata {
  logical_id: string;
  title: string;
  version: string;
  category: string;
  scope?: string;
  target_population?: string;
  condition_codes: ConditionCodeDefinition[];
}

export interface PathwayNodeDefinition {
  id: string;
  type: PathwayNodeType;
  properties: Record<string, unknown>;
}

export interface PathwayEdgeDefinition {
  from: string;
  to: string;
  type: PathwayEdgeType;
  properties?: Record<string, unknown>;
}

export interface PathwayJson {
  schema_version: string;
  pathway: PathwayMetadata;
  nodes: PathwayNodeDefinition[];
  edges: PathwayEdgeDefinition[];
}

// ─── PathwayGraph Query Response Types ──────────────────────────────

export interface PathwayGraphNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface PathwayGraphEdge {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface PathwayGraph {
  pathway: Pathway;
  nodes: PathwayGraphNode[];
  edges: PathwayGraphEdge[];
  conditionCodeDetails: ConditionCodeDefinition[];
}
```

- [ ] **Step 2: Add `GET_PATHWAY_GRAPH` query**

Add at the end of `prism-admin-dashboard/src/lib/graphql/queries/pathways.ts`:

```typescript
export const GET_PATHWAY_GRAPH = gql`
  query GetPathwayGraph($id: ID!) {
    pathwayGraph(id: $id) {
      pathway {
        id
        logicalId
        title
        version
        category
        status
        conditionCodes
        scope
        targetPopulation
        isActive
        createdAt
        updatedAt
      }
      nodes {
        id
        type
        properties
      }
      edges {
        from
        to
        type
        properties
      }
      conditionCodeDetails {
        code
        system
        description
        usage
        grouping
      }
    }
  }
`;
```

- [ ] **Step 3: Create mutations file**

Create `prism-admin-dashboard/src/lib/graphql/mutations/pathways.ts`:

```typescript
import { gql } from '@apollo/client/core';

export const IMPORT_PATHWAY = gql`
  mutation ImportPathway($pathwayJson: String!, $importMode: ImportMode!) {
    importPathway(pathwayJson: $pathwayJson, importMode: $importMode) {
      pathway {
        id
        logicalId
        title
        version
        category
        status
        conditionCodes
        isActive
        createdAt
        updatedAt
      }
      validation {
        valid
        errors
        warnings
      }
      diff {
        summary {
          nodesAdded
          nodesRemoved
          nodesModified
          edgesAdded
          edgesRemoved
          edgesModified
        }
        details {
          entityType
          action
          entityId
          entityLabel
        }
        synthetic
      }
      importType
    }
  }
`;

export const ACTIVATE_PATHWAY = gql`
  mutation ActivatePathway($id: ID!) {
    activatePathway(id: $id) {
      pathway {
        id
        logicalId
        title
        version
        status
        isActive
      }
      previousStatus
    }
  }
`;
```

- [ ] **Step 4: Verify the admin dashboard builds**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/types/index.ts src/lib/graphql/queries/pathways.ts src/lib/graphql/mutations/pathways.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add PathwayGraph types, query, and import/activate mutations"
```

---

### Task 3: Deserializer — PathwayJson → React Flow State

**Files:**
- Create: `prism-admin-dashboard/src/lib/pathway-json/deserializer.ts`

- [ ] **Step 1: Create the deserializer**

Create `prism-admin-dashboard/src/lib/pathway-json/deserializer.ts`:

```typescript
import type { Node, Edge } from '@xyflow/react';
import type {
  PathwayGraph,
  PathwayGraphNode,
  PathwayGraphEdge,
  PathwayNodeType,
  PathwayNodeData,
  PathwayEdgeData,
} from '@/types';

/**
 * Derive a human-readable label from node type and properties.
 */
function deriveLabel(type: string, properties: Record<string, unknown>): string {
  switch (type) {
    case 'Stage':
    case 'Step':
    case 'DecisionPoint':
    case 'EvidenceCitation':
      return (properties.title as string) || `Untitled ${type}`;
    case 'Medication':
    case 'LabTest':
    case 'Procedure':
    case 'QualityMetric':
      return (properties.name as string) || `Untitled ${type}`;
    case 'Criterion':
    case 'Schedule':
      return (properties.description as string) || `Untitled ${type}`;
    case 'CodeEntry':
      return `${properties.system || '?'}: ${properties.code || '?'}`;
    default:
      return `Unknown ${type}`;
  }
}

/**
 * Humanize an edge type string: "HAS_STAGE" → "Has Stage"
 */
function humanizeEdgeType(edgeType: string): string {
  return edgeType
    .split('_')
    .map((word, i) => (i === 0 ? word.charAt(0) + word.slice(1).toLowerCase() : word.toLowerCase()))
    .join(' ');
}

/**
 * Transforms a PathwayGraph response into React Flow nodes and edges.
 * Positions are set to (0,0) — call applyAutoLayout() after this.
 */
export function deserializePathway(graph: PathwayGraph): {
  nodes: Node<PathwayNodeData>[];
  edges: Edge<PathwayEdgeData>[];
} {
  const nodes: Node<PathwayNodeData>[] = graph.nodes.map((gn: PathwayGraphNode) => ({
    id: gn.id,
    type: gn.type as PathwayNodeType,
    position: { x: 0, y: 0 },
    data: {
      pathwayNodeType: gn.type as PathwayNodeType,
      pathwayNodeId: gn.id,
      label: deriveLabel(gn.type, gn.properties),
      properties: gn.properties,
    },
  }));

  // Filter out root edges — root is implicit in the canvas
  const edges: Edge<PathwayEdgeData>[] = graph.edges
    .filter((ge: PathwayGraphEdge) => ge.from !== 'root')
    .map((ge: PathwayGraphEdge) => ({
      id: `e-${ge.from}-${ge.to}-${ge.type}`,
      source: ge.from,
      target: ge.to,
      label: humanizeEdgeType(ge.type),
      data: {
        pathwayEdgeType: ge.type as PathwayEdgeData['pathwayEdgeType'],
        ...(ge.properties && Object.keys(ge.properties).length > 0
          ? { properties: ge.properties }
          : {}),
      },
    }));

  return { nodes, edges };
}
```

- [ ] **Step 2: Verify the admin dashboard builds**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/lib/pathway-json/deserializer.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add deserializer for PathwayJson to React Flow state"
```

---

### Task 4: Serializer — React Flow State → PathwayJson

**Files:**
- Create: `prism-admin-dashboard/src/lib/pathway-json/serializer.ts`

- [ ] **Step 1: Create the serializer**

Create `prism-admin-dashboard/src/lib/pathway-json/serializer.ts`:

```typescript
import type { Node, Edge } from '@xyflow/react';
import type {
  PathwayJson,
  PathwayMetadata,
  PathwayNodeDefinition,
  PathwayEdgeDefinition,
  PathwayNodeData,
  PathwayEdgeData,
} from '@/types';

/**
 * Transforms React Flow canvas state into a PathwayJson object
 * suitable for the importPathway mutation.
 */
export function serializePathway(
  nodes: Node[],
  edges: Edge[],
  metadata: PathwayMetadata,
): PathwayJson {
  // Map React Flow nodes to PathwayNodeDefinitions
  const pathwayNodes: PathwayNodeDefinition[] = nodes.map((node) => {
    const data = node.data as unknown as PathwayNodeData;
    return {
      id: data.pathwayNodeId,
      type: data.pathwayNodeType,
      properties: data.properties,
    };
  });

  // Map React Flow edges to PathwayEdgeDefinitions
  const pathwayEdges: PathwayEdgeDefinition[] = edges.map((edge) => {
    const data = edge.data as unknown as PathwayEdgeData;
    const def: PathwayEdgeDefinition = {
      from: edge.source,
      to: edge.target,
      type: data.pathwayEdgeType,
    };
    if (data.properties && Object.keys(data.properties).length > 0) {
      def.properties = data.properties;
    }
    return def;
  });

  // Add synthetic root → stage edges for stage nodes with no incoming edges
  const nodesWithIncoming = new Set(pathwayEdges.map((e) => e.to));
  const stageNodes = pathwayNodes.filter((n) => n.type === 'Stage');
  for (const stage of stageNodes) {
    if (!nodesWithIncoming.has(stage.id)) {
      pathwayEdges.push({
        from: 'root',
        to: stage.id,
        type: 'HAS_STAGE',
      });
    }
  }

  return {
    schema_version: '1.0',
    pathway: metadata,
    nodes: pathwayNodes,
    edges: pathwayEdges,
  };
}
```

- [ ] **Step 2: Verify the admin dashboard builds**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/lib/pathway-json/serializer.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add serializer for React Flow state to PathwayJson"
```

---

### Task 5: Zod Validation + Error Mapping

**Files:**
- Create: `prism-admin-dashboard/src/lib/pathway-json/validator.ts`

- [ ] **Step 1: Create the validator**

Create `prism-admin-dashboard/src/lib/pathway-json/validator.ts`:

```typescript
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
    errorMap: () => ({ message: `Invalid node type. Must be one of: ${PATHWAY_NODE_TYPES.join(', ')}` }),
  }),
  properties: z.record(z.unknown()),
});

const edgeSchema = z.object({
  from: z.string().min(1, 'Edge source is required'),
  to: z.string().min(1, 'Edge target is required'),
  type: z.enum(PATHWAY_EDGE_TYPES as [string, ...string[]], {
    errorMap: () => ({ message: `Invalid edge type. Must be one of: ${PATHWAY_EDGE_TYPES.join(', ')}` }),
  }),
  properties: z.record(z.unknown()).optional(),
});

const pathwayJsonSchema = z.object({
  schema_version: z.literal('1.0', { errorMap: () => ({ message: 'schema_version must be "1.0"' }) }),
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
```

- [ ] **Step 2: Verify the admin dashboard builds**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/lib/pathway-json/validator.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add Zod-based PathwayJson validator with error-to-node mapping"
```

---

### Task 6: Save/Publish Orchestration Hook

**Files:**
- Create: `prism-admin-dashboard/src/lib/hooks/usePathwaySave.ts`

- [ ] **Step 1: Create the hook**

Create `prism-admin-dashboard/src/lib/hooks/usePathwaySave.ts`:

```typescript
import { useState, useCallback } from 'react';
import { useMutation } from '@apollo/client/react';
import type { Node, Edge } from '@xyflow/react';
import { serializePathway } from '@/lib/pathway-json/serializer';
import { validatePathwayJson, type MappedValidationError } from '@/lib/pathway-json/validator';
import { IMPORT_PATHWAY, ACTIVATE_PATHWAY } from '@/lib/graphql/mutations/pathways';
import type {
  PathwayMetadata,
  ImportPathwayResult,
  PathwayStatusResult,
  ImportMode,
} from '@/types';

export interface SaveResult {
  success: boolean;
  result?: ImportPathwayResult;
  errors?: MappedValidationError[];
}

export function usePathwaySave() {
  const [isSaving, setIsSaving] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<MappedValidationError[]>([]);

  const [importPathwayMutation] = useMutation<
    { importPathway: ImportPathwayResult },
    { pathwayJson: string; importMode: ImportMode }
  >(IMPORT_PATHWAY);

  const [activatePathwayMutation] = useMutation<
    { activatePathway: PathwayStatusResult },
    { id: string }
  >(ACTIVATE_PATHWAY);

  const save = useCallback(async (
    nodes: Node[],
    edges: Edge[],
    metadata: PathwayMetadata,
    importMode: ImportMode,
  ): Promise<SaveResult> => {
    setIsSaving(true);
    setValidationErrors([]);

    try {
      // Serialize
      const pathwayJson = serializePathway(nodes, edges, metadata);

      // Client-side validation
      const clientValidation = validatePathwayJson(pathwayJson);
      if (!clientValidation.valid) {
        setValidationErrors(clientValidation.errors);
        return { success: false, errors: clientValidation.errors };
      }

      // Call backend
      const { data } = await importPathwayMutation({
        variables: {
          pathwayJson: JSON.stringify(pathwayJson),
          importMode,
        },
      });

      if (!data) {
        const error: MappedValidationError = {
          message: 'No response from server',
          path: '',
        };
        setValidationErrors([error]);
        return { success: false, errors: [error] };
      }

      const result = data.importPathway;

      // Check backend validation
      if (!result.validation.valid) {
        const backendErrors: MappedValidationError[] = result.validation.errors.map((msg) => ({
          message: msg,
          path: '',
        }));
        setValidationErrors(backendErrors);
        return { success: false, result, errors: backendErrors };
      }

      return { success: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      const error: MappedValidationError = { message, path: '' };
      setValidationErrors([error]);
      return { success: false, errors: [error] };
    } finally {
      setIsSaving(false);
    }
  }, [importPathwayMutation]);

  const activate = useCallback(async (pathwayId: string): Promise<boolean> => {
    setIsActivating(true);
    try {
      const { data } = await activatePathwayMutation({
        variables: { id: pathwayId },
      });
      return !!data?.activatePathway;
    } catch {
      return false;
    } finally {
      setIsActivating(false);
    }
  }, [activatePathwayMutation]);

  const clearErrors = useCallback(() => {
    setValidationErrors([]);
  }, []);

  return {
    save,
    activate,
    clearErrors,
    isSaving,
    isActivating,
    validationErrors,
  };
}
```

- [ ] **Step 2: Verify the admin dashboard builds**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/lib/hooks/usePathwaySave.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add usePathwaySave hook for save/publish orchestration"
```

---

### Task 7: Diff Review Modal

**Files:**
- Create: `prism-admin-dashboard/src/components/editor/DiffReviewModal.tsx`

- [ ] **Step 1: Create the DiffReviewModal component**

Create `prism-admin-dashboard/src/components/editor/DiffReviewModal.tsx`:

```typescript
'use client';

import { Button } from '@/components/ui/Button';
import type { ImportPathwayResult, ImportDiffSummary, DiffDetail } from '@/types';

interface DiffReviewModalProps {
  result: ImportPathwayResult;
  oldVersion: string;
  onActivate: () => void;
  onKeepDraft: () => void;
  isActivating: boolean;
}

function StatBadge({ label, count, color }: { label: string; count: number; color: string }) {
  if (count === 0) return null;
  const colorClasses: Record<string, string> = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border ${colorClasses[color]}`}>
      {color === 'green' ? '+' : color === 'red' ? '-' : '~'}{count} {label}
    </span>
  );
}

function SummaryBar({ summary }: { summary: ImportDiffSummary }) {
  return (
    <div className="flex flex-wrap gap-2">
      <StatBadge label="nodes added" count={summary.nodesAdded} color="green" />
      <StatBadge label="nodes removed" count={summary.nodesRemoved} color="red" />
      <StatBadge label="nodes modified" count={summary.nodesModified} color="yellow" />
      <StatBadge label="edges added" count={summary.edgesAdded} color="green" />
      <StatBadge label="edges removed" count={summary.edgesRemoved} color="red" />
      <StatBadge label="edges modified" count={summary.edgesModified} color="yellow" />
    </div>
  );
}

function DetailTable({ details }: { details: DiffDetail[] }) {
  if (details.length === 0) {
    return <p className="text-sm text-gray-500 italic">No detailed changes available.</p>;
  }

  const grouped = {
    added: details.filter((d) => d.action === 'ADDED'),
    removed: details.filter((d) => d.action === 'REMOVED'),
    modified: details.filter((d) => d.action === 'MODIFIED'),
  };

  return (
    <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
      {(['added', 'removed', 'modified'] as const).map((group) => {
        const items = grouped[group];
        if (items.length === 0) return null;
        const headerColors: Record<string, string> = {
          added: 'bg-emerald-50 text-emerald-800',
          removed: 'bg-red-50 text-red-800',
          modified: 'bg-amber-50 text-amber-800',
        };
        return (
          <div key={group}>
            <div className={`px-3 py-1.5 text-xs font-semibold uppercase ${headerColors[group]}`}>
              {group} ({items.length})
            </div>
            {items.map((item, i) => (
              <div key={`${group}-${i}`} className="px-3 py-2 flex items-center gap-3 text-sm">
                <span className="text-gray-500 font-mono text-xs w-24 flex-shrink-0">{item.entityType}</span>
                <span className="text-gray-900">{item.entityLabel || item.entityId}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function DiffReviewModal({
  result,
  oldVersion,
  onActivate,
  onKeepDraft,
  isActivating,
}: DiffReviewModalProps) {
  const newVersion = result.pathway?.version ?? '?';
  const diff = result.diff;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — non-dismissable */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Review Changes — v{oldVersion} → v{newVersion}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {diff ? (
            <>
              <SummaryBar summary={diff.summary} />
              <DetailTable details={diff.details} />
            </>
          ) : (
            <p className="text-sm text-gray-500">No diff information available.</p>
          )}

          {result.validation.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-medium text-amber-800 mb-1">Warnings</p>
              <ul className="text-xs text-amber-700 space-y-0.5">
                {result.validation.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
          <Button
            variant="secondary"
            onClick={onKeepDraft}
            disabled={isActivating}
          >
            Keep as Draft
          </Button>
          <Button
            variant="primary"
            onClick={onActivate}
            isLoading={isActivating}
          >
            Activate Now
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the admin dashboard builds**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/editor/DiffReviewModal.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add DiffReviewModal for publish version flow"
```

---

### Task 8: EditorToolbar — Add Save Draft + Publish Buttons

**Files:**
- Modify: `prism-admin-dashboard/src/components/editor/EditorToolbar.tsx`

- [ ] **Step 1: Update EditorToolbar with save/publish buttons**

Replace the full contents of `prism-admin-dashboard/src/components/editor/EditorToolbar.tsx` with:

```typescript
'use client';

import { Button } from '@/components/ui/Button';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowsPointingOutIcon,
  ViewColumnsIcon,
  CloudArrowUpIcon,
  ArrowUpTrayIcon,
} from '@heroicons/react/24/outline';
import type { PathwayStatus } from '@/types';

interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAutoLayout: () => void;
  onFitView: () => void;
  onSaveDraft?: () => void;
  onPublish?: () => void;
  pathwayTitle: string;
  pathwayVersion: string;
  isDraft: boolean;
  pathwayStatus?: PathwayStatus;
  isSaving?: boolean;
}

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAutoLayout,
  onFitView,
  onSaveDraft,
  onPublish,
  pathwayTitle,
  pathwayVersion,
  isDraft,
  pathwayStatus,
  isSaving = false,
}: EditorToolbarProps) {
  const showSaveDraft = isDraft && onSaveDraft;
  const showPublish = onPublish && (pathwayStatus === 'DRAFT' || pathwayStatus === 'ACTIVE');

  return (
    <div className="h-14 bg-white border-b border-gray-200 px-4 flex items-center justify-between flex-shrink-0">
      {/* Left: Pathway info */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-gray-900 truncate max-w-[300px]">
          {pathwayTitle || 'Untitled Pathway'}
        </h1>
        <span className="text-xs font-mono text-gray-400">v{pathwayVersion}</span>
        {isDraft && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
            Draft
          </span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onUndo}
          disabled={!canUndo || isSaving}
          leftIcon={<ArrowUturnLeftIcon className="h-4 w-4" />}
        >
          Undo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRedo}
          disabled={!canRedo || isSaving}
          leftIcon={<ArrowUturnRightIcon className="h-4 w-4" />}
        >
          Redo
        </Button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onAutoLayout}
          disabled={isSaving}
          leftIcon={<ViewColumnsIcon className="h-4 w-4" />}
        >
          Auto Layout
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onFitView}
          disabled={isSaving}
          leftIcon={<ArrowsPointingOutIcon className="h-4 w-4" />}
        >
          Fit View
        </Button>

        {(showSaveDraft || showPublish) && (
          <div className="w-px h-6 bg-gray-200 mx-1" />
        )}

        {showPublish && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onPublish}
            disabled={isSaving}
            isLoading={isSaving}
            leftIcon={<ArrowUpTrayIcon className="h-4 w-4" />}
          >
            Publish
          </Button>
        )}

        {showSaveDraft && (
          <Button
            variant="primary"
            size="sm"
            onClick={onSaveDraft}
            disabled={isSaving}
            isLoading={isSaving}
            leftIcon={<CloudArrowUpIcon className="h-4 w-4" />}
          >
            Save Draft
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the admin dashboard builds**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds. The new optional props (`onSaveDraft`, `onPublish`, `pathwayStatus`, `isSaving`) have defaults, so existing callers still work.

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/editor/EditorToolbar.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add Save Draft and Publish buttons to EditorToolbar"
```

---

### Task 9: Wire Everything into the Editor Page

**Files:**
- Modify: `prism-admin-dashboard/src/app/pathways/[id]/page.tsx`
- Modify: `prism-admin-dashboard/src/components/graph/PathwayCanvas.tsx`

- [ ] **Step 1: Update PathwayCanvas to accept save callbacks and error state**

In `prism-admin-dashboard/src/components/graph/PathwayCanvas.tsx`, update the `PathwayCanvasProps` interface and the `PathwayCanvasInner` function. Replace the existing interface and add the new props:

Replace the `PathwayCanvasProps` interface:

```typescript
interface PathwayCanvasProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  pathwayTitle?: string;
  pathwayVersion?: string;
  isDraft?: boolean;
  readOnly?: boolean;
  pathwayStatus?: PathwayStatus;
  onSaveDraft?: (nodes: Node[], edges: Edge[]) => void;
  onPublish?: (nodes: Node[], edges: Edge[]) => void;
  isSaving?: boolean;
  validationErrors?: { nodeId?: string; message: string }[];
}
```

Add the `PathwayStatus` import at the top alongside the other type imports:

```typescript
import type { PathwayNodeType, PathwayNodeData, PathwayEdgeData, PathwayStatus } from '@/types';
```

Update the `PathwayCanvasInner` destructuring to include the new props:

```typescript
function PathwayCanvasInner({
  initialNodes = [],
  initialEdges = [],
  pathwayTitle = 'Untitled Pathway',
  pathwayVersion = '1.0',
  isDraft = true,
  readOnly = false,
  pathwayStatus,
  onSaveDraft,
  onPublish,
  isSaving = false,
  validationErrors = [],
}: PathwayCanvasProps) {
```

Update the `<EditorToolbar>` render to pass the new props:

```typescript
      <EditorToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onAutoLayout={handleAutoLayout}
        onFitView={handleFitView}
        onSaveDraft={onSaveDraft ? () => onSaveDraft(nodes, edges) : undefined}
        onPublish={onPublish ? () => onPublish(nodes, edges) : undefined}
        pathwayTitle={pathwayTitle}
        pathwayVersion={pathwayVersion}
        isDraft={isDraft}
        pathwayStatus={pathwayStatus}
        isSaving={isSaving}
      />
```

Add a validation error banner right after the `<EditorToolbar>`, before the `<div className="flex flex-1 overflow-hidden">`:

```typescript
      {validationErrors.length > 0 && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2">
          <div className="flex items-start gap-2">
            <span className="text-red-500 text-sm font-medium flex-shrink-0">Validation errors:</span>
            <ul className="text-sm text-red-700 space-y-0.5">
              {validationErrors.slice(0, 5).map((err, i) => (
                <li key={i}>• {err.message}</li>
              ))}
              {validationErrors.length > 5 && (
                <li className="text-red-500">...and {validationErrors.length - 5} more</li>
              )}
            </ul>
          </div>
        </div>
      )}
```

- [ ] **Step 2: Replace the editor page with full hydration and save flow**

Replace the full contents of `prism-admin-dashboard/src/app/pathways/[id]/page.tsx`:

```typescript
'use client';

import { use, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { useRouter } from 'next/navigation';
import type { Node, Edge } from '@xyflow/react';
import { GET_PATHWAY_GRAPH } from '@/lib/graphql/queries/pathways';
import { deserializePathway } from '@/lib/pathway-json/deserializer';
import { applyAutoLayout } from '@/components/graph/AutoLayout';
import { PathwayCanvas } from '@/components/graph/PathwayCanvas';
import { DiffReviewModal } from '@/components/editor/DiffReviewModal';
import { usePathwaySave } from '@/lib/hooks/usePathwaySave';
import { Spinner } from '@/components/ui/Spinner';
import type { PathwayGraph, PathwayMetadata, ImportPathwayResult } from '@/types';

export default function PathwayEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, loading, error } = useQuery<{ pathwayGraph: PathwayGraph | null }>(GET_PATHWAY_GRAPH, {
    variables: { id },
  });

  const { save, activate, isSaving, isActivating, validationErrors, clearErrors } = usePathwaySave();
  const [publishResult, setPublishResult] = useState<ImportPathwayResult | null>(null);

  // Deserialize + layout once when data arrives
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!data?.pathwayGraph) return { initialNodes: [], initialEdges: [] };
    const { nodes, edges } = deserializePathway(data.pathwayGraph);
    const layoutedNodes = applyAutoLayout(nodes, edges);
    return { initialNodes: layoutedNodes, initialEdges: edges };
  }, [data]);

  const pathway = data?.pathwayGraph?.pathway;

  // Build metadata for serializer from the pathway record + full condition code details
  const conditionCodeDetails = data?.pathwayGraph?.conditionCodeDetails ?? [];
  const metadata: PathwayMetadata | null = useMemo(() => {
    if (!pathway) return null;
    return {
      logical_id: pathway.logicalId,
      title: pathway.title,
      version: pathway.version,
      category: pathway.category,
      scope: pathway.scope ?? undefined,
      target_population: pathway.targetPopulation ?? undefined,
      condition_codes: conditionCodeDetails,
    };
  }, [pathway, conditionCodeDetails]);

  const handleSaveDraft = useCallback(async (nodes: Node[], edges: Edge[]) => {
    if (!metadata) return;
    clearErrors();
    const result = await save(nodes, edges, metadata, 'DRAFT_UPDATE');
    if (result.success) {
      // Refresh the page data to pick up updated timestamps
      window.location.reload();
    }
  }, [metadata, save, clearErrors]);

  const handlePublish = useCallback(async (nodes: Node[], edges: Edge[]) => {
    if (!metadata) return;
    clearErrors();
    const result = await save(nodes, edges, metadata, 'NEW_VERSION');
    if (result.success && result.result) {
      setPublishResult(result.result);
    }
  }, [metadata, save, clearErrors]);

  const handleActivate = useCallback(async () => {
    if (!publishResult?.pathway) return;
    const success = await activate(publishResult.pathway.id);
    if (success) {
      router.push(`/pathways/${publishResult.pathway.id}`);
    }
  }, [publishResult, activate, router]);

  const handleKeepDraft = useCallback(() => {
    if (!publishResult?.pathway) return;
    router.push(`/pathways/${publishResult.pathway.id}`);
  }, [publishResult, router]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700">Failed to load pathway: {error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Not found state
  if (!pathway) {
    return (
      <div className="p-8">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-sm text-gray-700">Pathway not found.</p>
          <a href="/" className="mt-2 text-sm text-blue-600 underline hover:text-blue-800">
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  const isDraft = pathway.status === 'DRAFT';

  return (
    <div className="h-screen flex flex-col">
      <PathwayCanvas
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        pathwayTitle={pathway.title}
        pathwayVersion={pathway.version}
        isDraft={isDraft}
        readOnly={!isDraft}
        pathwayStatus={pathway.status}
        onSaveDraft={isDraft ? handleSaveDraft : undefined}
        onPublish={handlePublish}
        isSaving={isSaving}
        validationErrors={validationErrors}
      />

      {publishResult && (
        <DiffReviewModal
          result={publishResult}
          oldVersion={pathway.version}
          onActivate={handleActivate}
          onKeepDraft={handleKeepDraft}
          isActivating={isActivating}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify the admin dashboard builds**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/app/pathways/[id]/page.tsx src/components/graph/PathwayCanvas.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: wire editor page with hydration, save draft, and publish flow"
```

---

### Task 10: Verification

- [ ] **Step 1: Verify backend typecheck**

Run:
```bash
npm --prefix /home/claude/workspace/prism-graphql run typecheck --workspace=apps/pathway-service
```

Expected: No type errors.

- [ ] **Step 2: Verify admin dashboard typecheck**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Verify all files exist**

Run:
```bash
ls -la /home/claude/workspace/prism-admin-dashboard/src/lib/pathway-json/
ls -la /home/claude/workspace/prism-admin-dashboard/src/lib/graphql/mutations/
ls -la /home/claude/workspace/prism-admin-dashboard/src/lib/hooks/usePathwaySave.ts
ls -la /home/claude/workspace/prism-admin-dashboard/src/components/editor/DiffReviewModal.tsx
```

Expected: All files exist.

- [ ] **Step 4: Commit any remaining changes**

Run:
```bash
git -C /home/claude/workspace/prism-graphql status --short
git -C /home/claude/workspace/prism-admin-dashboard status --short
```

If any unstaged changes, add and commit them with appropriate messages.
