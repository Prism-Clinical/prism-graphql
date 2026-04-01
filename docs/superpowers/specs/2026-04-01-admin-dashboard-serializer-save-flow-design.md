# Admin Dashboard — Serializer, Save Flow & Editor Hydration

**Date:** 2026-04-01
**Status:** Approved
**Scope:** Backend query for pathway graph data, client-side serialization/deserialization between PathwayJson and React Flow state, Save Draft and Publish Version flows with diff review, and editor page hydration.

---

## 1. Overview

The admin dashboard graph editor (Plans 1–2) can render and edit pathway nodes/edges visually, but currently loads an empty canvas and has no way to persist changes. This plan adds:

1. **Backend `pathwayGraph` query** — exposes full graph structure (nodes, edges, properties) for a pathway version
2. **Deserializer** — transforms PathwayJson into React Flow state for canvas rendering
3. **Serializer** — transforms React Flow state back into PathwayJson for backend import
4. **Zod validation** — client-side structural validation with error-to-node mapping
5. **Save Draft flow** — serialize → validate → `importPathway(DRAFT_UPDATE)`
6. **Publish Version flow** — serialize → validate → `importPathway(NEW_VERSION)` → diff review modal → activate or keep draft
7. **Editor page hydration** — fetch graph on load → deserialize → populate canvas

No new backend services are required. The only backend change is a single new query on `pathway-service` that wraps the existing `reconstructPathwayJson()` internal function.

---

## 2. Backend — `pathwayGraph` Query

A single new query on pathway-service that returns the full graph structure for a given pathway version.

### GraphQL Schema Additions

```graphql
type PathwayGraph {
  pathway: Pathway!
  nodes: [PathwayGraphNode!]!
  edges: [PathwayGraphEdge!]!
}

type PathwayGraphNode {
  id: String!
  type: PathwayNodeType!
  properties: JSON!
}

type PathwayGraphEdge {
  from: String!
  to: String!
  type: PathwayEdgeType!
  properties: JSON
}

extend type Query {
  pathwayGraph(id: ID!): PathwayGraph
}
```

### Resolver

The resolver calls the existing `reconstructPathwayJson()` function from the import orchestrator, which already reads from AGE and relational side tables, and maps the result to the GraphQL types above. No new data access code is needed — just a thin resolver wrapping existing internals.

The `JSON` scalar for properties avoids defining 11 separate property types in the schema. Client-side Zod schemas handle typed validation instead.

### Return Behavior

- Pathway found → returns full graph with metadata, nodes, edges
- Pathway not found → returns `null`
- AGE graph read error → throws GraphQL error

---

## 3. Deserializer — PathwayJson → React Flow State

Transforms the `pathwayGraph` query response into React Flow's `Node[]` and `Edge[]`.

### Function Signature

```typescript
deserializePathway(graph: PathwayGraphResponse): { nodes: Node<PathwayNodeData>[], edges: Edge<PathwayEdgeData>[] }
```

### Node Mapping

Each `PathwayGraphNode` becomes a React Flow `Node<PathwayNodeData>`:

| PathwayGraphNode field | React Flow Node field |
|------------------------|----------------------|
| `id` | `id` |
| `type` | `type` (maps to React Flow node type in `nodeTypes` registry) |
| — | `position: { x: 0, y: 0 }` (layout computed after) |
| `type` | `data.pathwayNodeType` |
| `id` | `data.pathwayNodeId` |
| `properties.title` or `properties.name` or `properties.description` | `data.label` (derived per type) |
| `properties` | `data.properties` |

**Label derivation by node type:**
- Stage, Step, DecisionPoint → `properties.title`
- Medication, LabTest, Procedure → `properties.name`
- Criterion → `properties.description`
- CodeEntry → `"{properties.system}: {properties.code}"`
- EvidenceCitation → `properties.title`
- QualityMetric → `properties.name`
- Schedule → `properties.description`

### Edge Mapping

Each `PathwayGraphEdge` becomes a React Flow `Edge<PathwayEdgeData>`:

| PathwayGraphEdge field | React Flow Edge field |
|-----------------------|----------------------|
| — | `id: "e-{from}-{to}-{type}"` |
| `from` | `source` |
| `to` | `target` |
| `type` | `label` (humanized: `HAS_STAGE` → `"Has Stage"`) |
| `type` | `data.pathwayEdgeType` |

**Root edge filtering:** Edges with `from: "root"` are excluded — root is implicit in the canvas, not a rendered node. Stage nodes with no incoming canvas edges are understood to be root-connected.

### Post-Deserialize

1. Run `applyAutoLayout()` (existing dagre utility) to compute hierarchical positions
2. Call `fitView()` to center the graph in the viewport

**File:** `src/lib/pathway-json/deserializer.ts`

---

## 4. Serializer — React Flow State → PathwayJson

Transforms the canvas state back into the `PathwayJson` format expected by `importPathway`.

### Function Signature

```typescript
serializePathway(nodes: Node[], edges: Edge[], metadata: PathwayMetadata): PathwayJson
```

### Node Mapping

Each React Flow node becomes a `PathwayNodeDefinition`:

| React Flow Node field | PathwayNodeDefinition field |
|----------------------|---------------------------|
| `data.pathwayNodeId` | `id` |
| `data.pathwayNodeType` | `type` |
| `data.properties` | `properties` |

Positions, selection state, and other React Flow concerns are stripped.

### Edge Mapping

Each React Flow edge becomes a `PathwayEdgeDefinition`:

| React Flow Edge field | PathwayEdgeDefinition field |
|----------------------|---------------------------|
| `source` | `from` |
| `target` | `to` |
| `data.pathwayEdgeType` | `type` |
| `data.properties` | `properties` (omitted if empty) |

### Synthetic Root Edges

Stage nodes that have no incoming edges get a synthetic `{ from: "root", to: stageId, type: "HAS_STAGE" }` edge. The backend requires explicit root → stage connections, but the canvas doesn't render a root node.

### Metadata

Passed in separately from the pathway record fetched on page load. Includes `logical_id`, `title`, `version`, `category`, `scope`, `target_population`, `condition_codes`. These are read-only in this plan; a metadata editor panel is a future addition.

### Output

```typescript
{
  schema_version: "1.0",
  pathway: metadata,
  nodes: [...],
  edges: [...]
}
```

**File:** `src/lib/pathway-json/serializer.ts`

---

## 5. Client-Side Zod Validation

Zod schemas that mirror the backend validator's structural checks. Run before calling `importPathway` to provide instant feedback.

### Scope — Structural and Type Validation Only

The client-side validation catches fast, common errors. Expensive semantic checks (graph depth traversal, orphan detection, cross-reference validation) are left to the backend.

**What the client validates:**
- `schema_version` must be `"1.0"`
- `pathway` metadata: `logical_id`, `title`, `version`, `category` required; `condition_codes` array with at least one entry, each having `code` and `system`
- `nodes[]`: each has `id` (string), `type` (valid `PathwayNodeType`), `properties` (object). Required properties checked per type using `REQUIRED_NODE_PROPERTIES`
- `edges[]`: each has `from`, `to` (strings), `type` (valid `PathwayEdgeType`). Endpoint constraints checked against `VALID_EDGE_ENDPOINTS`
- Code format spot-checks: ICD-10 (`/^[A-Z]\d{2}(\.\w{1,4})?$/i`), SNOMED (`/^\d{6,18}$/`), LOINC (`/^\d{1,5}-\d$/`), CPT (`/^\d{5}$/`), RxNorm patterns on CodeEntry nodes

### Error Mapping

Zod errors include the path (e.g., `nodes[3].properties.title`). The save flow maps these back to node IDs so the canvas can highlight offending nodes in red with error tooltips. Edges get the same treatment.

### When It Runs

After serialization, before the `importPathway` call:
- Zod fails → errors displayed inline on canvas, no network request
- Zod passes, backend returns errors → backend errors mapped to nodes/edges the same way

**File:** `src/lib/pathway-json/validator.ts`

---

## 6. Save Flow

Two actions in the editor toolbar, both using the same serialize → validate → import pipeline.

### Save Draft

1. Serialize canvas state → `PathwayJson` via `serializePathway()`
2. Run Zod validation — if errors, highlight nodes/edges on canvas, show error toast, stop
3. Call `importPathway(pathwayJson, "DRAFT_UPDATE")`
4. On success: show success toast, update pathway metadata in local state from mutation response
5. On backend validation error: map errors to nodes/edges, highlight on canvas, show error details

Available only when `pathway.status === 'DRAFT'`. Button disabled with tooltip on non-draft versions.

### Publish Version

1. Serialize canvas state → `PathwayJson` via `serializePathway()`
2. Run Zod validation — same error handling as Save Draft
3. Call `importPathway(pathwayJson, "NEW_VERSION")`
4. On success: open the **Diff Review Modal** (see Section 8)
5. On error: same inline error display

Available when viewing an ACTIVE or DRAFT version. When used on a DRAFT, it creates a new version from it.

### Toolbar Changes

The `EditorToolbar` gains two new buttons on the right side:
- **"Save Draft"** — primary style, shown when `isDraft`
- **"Publish"** — secondary style, shown when status is DRAFT or ACTIVE (hidden for ARCHIVED/SUPERSEDED)
- Both disabled with spinner during save
- Existing undo/redo/layout/fit-view buttons unchanged

### GraphQL Mutations

Uses the existing mutations — no new ones needed:

```graphql
mutation ImportPathway($pathwayJson: String!, $importMode: ImportMode!) {
  importPathway(pathwayJson: $pathwayJson, importMode: $importMode) {
    pathway { id logicalId title version status }
    validation { valid errors warnings }
    diff { summary { nodesAdded nodesRemoved nodesModified edgesAdded edgesRemoved edgesModified } details { type id changes } }
  }
}

mutation ActivatePathway($id: ID!) {
  activatePathway(id: $id) {
    pathway { id status }
    previousStatus
  }
}
```

---

## 7. Editor Page Hydration

The editor page (`/pathways/[id]/page.tsx`) currently fetches metadata only and renders an empty canvas. Updated flow:

### On Page Load

1. Fetch `pathwayGraph(id)` — single query returning metadata + nodes + edges
2. Deserialize response via `deserializePathway()`
3. Run `applyAutoLayout()` to compute positions
4. Pass `initialNodes`, `initialEdges`, and metadata to `PathwayCanvas`
5. Show loading spinner until query completes

### PathwayCanvas Changes

- Accept optional `initialNodes` and `initialEdges` props
- Initialize React Flow state from these props when provided (empty canvas when not — for the future "new pathway" page)
- Existing `readOnly` prop already disables editing for non-draft pathways

### Metadata State

- Page holds pathway metadata (`logicalId`, `title`, `version`, `category`, `status`, `conditionCodes`) in component state
- Passed to `EditorToolbar` for display and to the serializer when saving
- Updated after successful save/publish from mutation response

### Error States

- Query error → error message with retry button
- Pathway not found → 404 message with link back to dashboard
- Empty graph (0 nodes) → empty canvas with hint to drag nodes from palette

### GraphQL Query

```graphql
query GetPathwayGraph($id: ID!) {
  pathwayGraph(id: $id) {
    pathway {
      id logicalId title version category status
      conditionCodes scope targetPopulation
      isActive createdAt updatedAt
    }
    nodes { id type properties }
    edges { from to type properties }
  }
}
```

---

## 8. Diff Review Modal

Appears after a successful Publish, showing changes between the current active version and the new version.

### Data Source

The `ImportPathwayResult` returned by `importPathway` includes an `ImportDiff` with:
- `summary`: counts of `nodesAdded`, `nodesRemoved`, `nodesModified`, `edgesAdded`, `edgesRemoved`, `edgesModified`
- `details[]`: array of individual change entries with type, id, and what changed

### Layout

- **Header:** "Review Changes — v{old} → v{new}"
- **Summary bar:** 6 stat badges with color coding — green for added, red for removed, yellow for modified
- **Detail table:** scrollable list grouped by change type (Added / Removed / Modified), each row showing node/edge type, id, and for modifications the specific fields that changed
- **Footer:** two action buttons

### Behavior

- Modal is non-dismissable — no backdrop click close, user must choose an action
- **"Activate Now"** (primary) → calls `activatePathway(newId)` → success toast → redirect to `/pathways/{newId}`
- **"Keep as Draft"** (secondary) → success toast → redirect to `/pathways/{newId}`
- Both buttons show spinner while action is in flight

### Component

`DiffReviewModal` in `src/components/editor/`. Receives `ImportPathwayResult` as prop, plus `onActivate` and `onKeepDraft` callbacks.

---

## 9. File Structure

```
prism-graphql/apps/pathway-service/
├── schema.graphql                          # + PathwayGraph type, pathwayGraph query
└── src/resolvers/
    └── Query.ts                            # + pathwayGraph resolver

prism-admin-dashboard/src/
├── lib/
│   ├── pathway-json/
│   │   ├── serializer.ts                   # React Flow → PathwayJson
│   │   ├── deserializer.ts                 # PathwayJson → React Flow
│   │   └── validator.ts                    # Zod schemas + error mapping
│   ├── graphql/
│   │   ├── queries/
│   │   │   └── pathways.ts                 # + GET_PATHWAY_GRAPH query
│   │   └── mutations/
│   │       └── pathways.ts                 # + IMPORT_PATHWAY, ACTIVATE_PATHWAY mutations
│   └── hooks/
│       └── usePathwaySave.ts               # Save/publish orchestration hook
├── components/
│   ├── editor/
│   │   ├── EditorToolbar.tsx               # + Save Draft, Publish buttons
│   │   └── DiffReviewModal.tsx             # Diff summary + activate/keep-draft
│   └── graph/
│       └── PathwayCanvas.tsx               # + initialNodes/initialEdges props
└── app/
    └── pathways/
        └── [id]/
            └── page.tsx                    # Hydration via pathwayGraph query
```

---

## 10. Dependencies

No new npm packages required. Uses:
- `zod` (already installed) for validation schemas
- `@apollo/client` (already installed) for queries/mutations
- `@xyflow/react` (already installed) for Node/Edge types
