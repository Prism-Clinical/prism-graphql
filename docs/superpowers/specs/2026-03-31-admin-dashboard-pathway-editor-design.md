# Admin Dashboard — Pathway Graph Editor & LLM Spec

**Date:** 2026-03-31
**Status:** Approved
**Scope:** Standalone admin application for managing clinical pathway recommendation trees, plus an LLM-consumable spec for generating pathway JSON from clinical documents.

---

## 1. Overview

A standalone Next.js application (`prism-admin-dashboard/`) that provides:

1. **Full graph editor** — Visual canvas for creating, editing, and managing clinical pathway trees using React Flow, backed by the existing `pathway-service` import pipeline and Apache AGE graph database.
2. **JSON editor** — Monaco-based split-panel editor for batch changes, synchronized bidirectionally with the graph canvas.
3. **Preview/simulation mode** — Read-only view that simulates what providers see during pathway resolution, with mock patient context and confidence score visualization.
4. **LLM pathway spec** — A standalone markdown document that, when given to an LLM alongside a clinical care plan document, produces a valid `PathwayJson` file ready for import.

The admin dashboard talks to the existing `prism-graphql` gateway (port 4000) via Apollo Client. No new backend services are required — all mutations route through `pathway-service`, `careplan-service`, and `careplan-recommender-service` via federation.

---

## 2. Architecture

### Application

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4
- **Data layer:** Apollo Client 4 → gateway (:4000) → federated subgraphs
- **Graph editor:** React Flow v12 (`@xyflow/react`) with custom node/edge components
- **JSON editor:** Monaco Editor (`@monaco-editor/react`)
- **Layout engine:** Dagre (hierarchical DAG layout)
- **Validation:** Zod schemas mirroring backend `PathwayJson` validation
- **Port:** 3001 (provider frontend is 3000)
- **Auth:** None for now — open access for dev iteration

### Data Flow

```
Admin Browser (:3001)
  │  Apollo Client
  ▼
Gateway (:4000)
  │  Federation
  ├──▶ pathway-service        (import, lifecycle, confidence)
  ├──▶ careplan-service        (templates, for linking)
  └──▶ careplan-recommender    (variant groups, for linking)
```

### Relationship to Existing Systems

- **Replaces:** Nothing — this is a new standalone app. The legacy pathway UI in `admin-dashboard` (which talks to `decision-explorer-service`) is unaffected.
- **Depends on:** `pathway-service` import pipeline (mutations: `importPathway`, `activatePathway`, `archivePathway`, `reactivatePathway`), confidence framework (queries: `pathwayConfidence`; mutations: `setSignalWeight`, `setNodeWeight`, `setResolutionThresholds`).
- **Produces:** `PathwayJson` documents that flow through the existing import pipeline into the Apache AGE graph.

---

## 3. Versioning Model

Every pathway is identified by a `logical_id`. Each edit creates a new version — pathways are never overwritten.

**Lifecycle:**
- Every save from the graph editor creates a new immutable version (auto-incremented)
- Exception: DRAFT versions are mutable working copies (updated via `DRAFT_UPDATE` import mode)
- Only one version per `logical_id` can be ACTIVE at a time
- Activating a new version automatically SUPERSEDES the previous active version
- All previous versions remain browsable and diffable
- Any historical version can be "forked" to create a new draft based on it

**Import modes (existing, from pathway-service):**

| Mode | When Used |
|------|-----------|
| `NEW_PATHWAY` | First-ever import of a `logical_id` — creates v1 DRAFT |
| `DRAFT_UPDATE` | Re-saving an existing DRAFT version — replaces in-place |
| `NEW_VERSION` | Publishing from ACTIVE pathway — creates new version as DRAFT |

**Status transitions:**
```
DRAFT → ACTIVE → ARCHIVED
                → SUPERSEDED (automatic when a newer version is activated)
ARCHIVED → ACTIVE (via reactivatePathway)
```

---

## 4. Pages & Routes

**Route parameters:** `[id]` = `pathway_graph_index.id` (UUID, identifies a specific version row). `[logicalId]` = `pathway_graph_index.logical_id` (shared across all versions of a pathway).

| Route | Purpose | Editable? |
|-------|---------|-----------|
| `/` | Dashboard — pathway list grouped by `logical_id`, showing active version, status badges, condition codes | — |
| `/pathways/new` | Upload JSON file or start from blank canvas → creates v1 DRAFT | Yes |
| `/pathways/[id]` | Graph editor + JSON editor + properties panel for a specific version | DRAFT only |
| `/pathways/[id]/preview` | Provider simulation mode with mock patient context | Read-only |
| `/pathways/[logicalId]/history` | All versions with side-by-side diffs between any two | Read-only |

---

## 5. Graph Editor

### Canvas (React Flow)

Custom node components for each of the 11 pathway node types, visually distinct by color and icon:

**Structural nodes:**
- **Stage** — blue, represents a major phase of the pathway
- **Step** — green, represents an action within a stage
- **DecisionPoint** — amber diamond, represents a clinical decision branch

**Clinical nodes:**
- **Medication** — purple, with role badge (preferred/acceptable/avoid/contraindicated)
- **LabTest** — teal
- **Procedure** — orange

**Supporting nodes:**
- **Criterion** — gray, decision criteria under a DecisionPoint
- **CodeEntry** — slate tag, ICD-10/SNOMED/RxNorm/LOINC/CPT codes
- **EvidenceCitation** — indigo, literature references
- **QualityMetric** — emerald, outcome measures
- **Schedule** — cyan, timing/interval

Edges rendered with labels showing the relationship type. Edge constraint enforcement per `VALID_EDGE_ENDPOINTS` — invalid connections are prevented in real-time with visual feedback showing which target types are allowed.

Additional canvas features: minimap, zoom controls, auto-layout (dagre hierarchical), fit-to-view.

### Interaction Model

- **Add nodes:** Right-click context menu with node type picker, or drag from a sidebar palette
- **Connect nodes:** Drag from source handle to target handle — validates edge type constraints in real-time
- **Edit properties:** Click node → right-side properties panel with type-specific form fields (e.g., Medication shows name, role dropdown, dosage fields; Stage shows stage_number, title)
- **Delete:** Select + Delete key, or context menu
- **Multi-select:** Shift+click or rectangle drag-select for bulk operations
- **Undo/redo:** Command history stack (Ctrl+Z / Ctrl+Shift+Z)

### JSON Editor (Monaco)

- Toggle-able side panel in split view (canvas left, JSON right)
- Bidirectional live sync between canvas and JSON
- Zod-based JSON schema validation with inline error highlighting
- Useful for bulk operations: renaming codes across nodes, pasting sections from other pathways, reviewing the raw structure

### Save Flow

- **"Save Draft"** → serializes canvas state to `PathwayJson` → calls `importPathway` with `DRAFT_UPDATE` mode
  - Validation errors from the import pipeline displayed inline on the canvas (offending nodes/edges highlighted in red with error messages)
- **"Publish Version"** → serializes → `NEW_VERSION` import → diff review modal showing nodes/edges added/removed/modified → confirm → option to activate immediately or leave as new DRAFT

### Serialization

Two key transforms:

- **Deserializer:** `PathwayJson` → React Flow state (nodes with positions via dagre layout, edges, metadata)
- **Serializer:** React Flow state → `PathwayJson` (strips positions and UI-only state, produces clean import JSON)

Client-side validation (Zod) mirrors the backend validator so errors are caught before the import call.

---

## 6. Preview / Simulation Mode

### Purpose

Lets pathway authors validate tree behavior before activation by simulating the provider experience.

### Mock Patient Context

Form to enter:
- Age, sex
- Condition codes (ICD-10/SNOMED autocomplete)
- Active medications
- Risk factors
- Lab results

**Presets:** Save/load named patient profiles for common test scenarios (e.g., "65yo male with diabetes and hypertension"). Stored in localStorage.

### Simulation View

- Same React Flow canvas in **read-only mode** with muted background and "Preview" badge
- Confidence scores rendered as color-coded badges on each node:
  - Green (≥0.85): auto-resolve threshold
  - Yellow (≥0.60): system-suggested threshold
  - Red (<0.60): requires manual provider decision
- Auto-resolved paths highlighted/animated to show the "happy path"
- Decision points that require provider input shown with interactive prompts — admin clicks through choices to explore branches
- Branches that don't apply to the mock patient context are greyed out
- Side panel shows confidence breakdown per selected node: all 4 signal scores (data completeness, evidence strength, match quality, risk magnitude) with weights and propagation influences

### Data Flow

- Calls `pathwayConfidence` query on pathway-service with the mock patient context
- Resolution rendering is client-side based on confidence response and threshold comparison
- Designed to upgrade to calling the full resolution engine (Plan 4) once it's built

---

## 7. LLM Pathway Spec

A standalone markdown document (`prism-admin-dashboard/docs/llm-pathway-spec.md`) that enables any LLM to convert a clinical care plan or guideline document into a valid `PathwayJson` file.

### Structure

1. **Purpose & context** — What Prism pathways are, what the output will be used for, how the JSON flows into the system

2. **Output format** — Complete `PathwayJson` schema with every field documented:
   - `schema_version`, `pathway` metadata (logical_id, title, version, category, condition_codes)
   - `nodes[]` array with `id`, `type`, `properties`
   - `edges[]` array with `from`, `to`, `type`, `properties`

3. **Node type reference** — Each of the 11 node types with:
   - Required and optional properties (from `REQUIRED_NODE_PROPERTIES`)
   - Semantic description of when to use this node type
   - Example node JSON snippet

4. **Edge type reference** — Each of the 12 edge types with:
   - Valid source → target constraints (from `VALID_EDGE_ENDPOINTS`)
   - Semantic meaning and usage guidance

5. **Clinical-to-graph mapping rules** — The key section. Guidance on decomposing clinical content:
   - Treatment protocols with sequential phases → Stages connected by HAS_STAGE
   - Actions within each phase → Steps within that Stage via HAS_STEP
   - If/then clinical criteria (e.g., "if GAS positive...") → DecisionPoint with Criterion children (HAS_CRITERION) and BRANCHES_TO edges to resulting Steps/Stages
   - First-line / second-line medication escalation → Medication nodes linked by ESCALATES_TO
   - Lab orders or monitoring requirements → LabTest nodes on the relevant Step via HAS_LAB_TEST
   - Surgical or procedural interventions → Procedure nodes via HAS_PROCEDURE
   - Cited evidence or guidelines → EvidenceCitation nodes with CITES_EVIDENCE edges
   - Medical codes (ICD-10, SNOMED, CPT, LOINC, RxNorm) → CodeEntry nodes with HAS_CODE edges
   - Timing/frequency requirements → Schedule nodes via HAS_SCHEDULE
   - Outcome measures → QualityMetric nodes via HAS_QUALITY_METRIC

6. **ID conventions** — Naming patterns:
   - Stages: `stage-{n}` (e.g., `stage-1`, `stage-2`)
   - Steps: `step-{stage}-{n}` (e.g., `step-1-1`, `step-1-2`)
   - Decision points: `dp-{descriptive-slug}` (e.g., `dp-rapid-strep-result`)
   - Criteria: `crit-{descriptive-slug}`
   - Medications: `med-{drug-name}` (e.g., `med-amoxicillin`)
   - Labs: `lab-{test-name}` (e.g., `lab-rapid-strep`)
   - Procedures: `proc-{name}`
   - Evidence: `ev-{n}` (e.g., `ev-1`, `ev-2`)
   - Codes: `code-{system}-{code}` (e.g., `code-icd10-j02-0`)
   - Quality metrics: `qm-{name}`
   - Schedules: `sched-{name}`

7. **Complete annotated example** — Full `PathwayJson` for strep throat management, with inline comments explaining each mapping decision from clinical guideline to graph structure

8. **Validation checklist** — Pre-submission verification:
   - All nodes have required properties for their type
   - All edges have valid source→target types per constraints
   - `condition_codes` populated with at least one ICD-10 code
   - No orphan nodes (every node reachable from root via edges)
   - Node IDs are unique
   - `schema_version` is "1.0"
   - Graph is within size limits (≤500 nodes, ≤2000 edges, ≤50 depth)

### Delivery

- Lives at `prism-admin-dashboard/docs/llm-pathway-spec.md`
- Usable standalone (copy-paste into any LLM chat with a clinical document)
- Designed so the admin dashboard can later embed it as the system prompt for an in-app LLM generation feature

---

## 8. Project Structure

```
prism-admin-dashboard/
├── src/
│   ├── app/                            # Next.js App Router
│   │   ├── layout.tsx                  # Root layout with sidebar nav
│   │   ├── page.tsx                    # Dashboard — pathway list
│   │   ├── pathways/
│   │   │   ├── new/page.tsx            # New pathway (upload or blank)
│   │   │   ├── [id]/page.tsx           # Graph editor for a version
│   │   │   ├── [id]/preview/page.tsx   # Simulation mode
│   │   │   └── [logicalId]/
│   │   │       └── history/page.tsx    # Version history & diffs
│   │   └── globals.css
│   ├── components/
│   │   ├── graph/                      # React Flow components
│   │   │   ├── PathwayCanvas.tsx       # Main React Flow wrapper
│   │   │   ├── nodes/                  # Custom node components (11 types)
│   │   │   │   ├── StageNode.tsx
│   │   │   │   ├── StepNode.tsx
│   │   │   │   ├── DecisionPointNode.tsx
│   │   │   │   ├── CriterionNode.tsx
│   │   │   │   ├── MedicationNode.tsx
│   │   │   │   ├── LabTestNode.tsx
│   │   │   │   ├── ProcedureNode.tsx
│   │   │   │   ├── CodeEntryNode.tsx
│   │   │   │   ├── EvidenceCitationNode.tsx
│   │   │   │   ├── QualityMetricNode.tsx
│   │   │   │   ├── ScheduleNode.tsx
│   │   │   │   └── nodeRegistry.ts     # Maps PathwayNodeType → component
│   │   │   ├── edges/                  # Custom edge rendering
│   │   │   ├── EdgeConstraintValidator.ts
│   │   │   └── AutoLayout.ts           # Dagre hierarchical layout
│   │   ├── editor/
│   │   │   ├── JsonEditorPanel.tsx      # Monaco split-panel
│   │   │   ├── PropertiesPanel.tsx      # Node property editor
│   │   │   ├── NodePalette.tsx          # Draggable node sidebar
│   │   │   └── EditorToolbar.tsx        # Save, publish, undo/redo
│   │   ├── preview/
│   │   │   ├── PreviewCanvas.tsx        # Read-only confidence overlay
│   │   │   ├── PatientContextForm.tsx   # Mock patient input
│   │   │   └── ConfidencePanel.tsx      # Signal breakdown sidebar
│   │   ├── dashboard/
│   │   │   ├── PathwayTable.tsx         # Pathway list
│   │   │   └── StatusBadge.tsx          # DRAFT/ACTIVE/ARCHIVED badges
│   │   └── ui/                          # Shared primitives (Button, Card, Modal, etc.)
│   ├── lib/
│   │   ├── graphql/
│   │   │   ├── queries/                 # pathway, confidence, variant queries
│   │   │   ├── mutations/               # import, lifecycle, confidence mutations
│   │   │   └── client.ts               # Apollo Client setup (gateway :4000)
│   │   ├── pathway-json/
│   │   │   ├── serializer.ts           # React Flow state → PathwayJson
│   │   │   ├── deserializer.ts         # PathwayJson → React Flow state
│   │   │   └── validator.ts            # Client-side Zod validation
│   │   └── hooks/                       # usePathway, useImport, useConfidence, etc.
│   └── types/
│       └── index.ts                     # Shared TypeScript interfaces
├── docs/
│   └── llm-pathway-spec.md             # LLM spec document
├── public/
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── README.md
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `next`, `react`, `react-dom` | Framework |
| `@apollo/client`, `graphql` | Data layer |
| `@xyflow/react` | Graph editor (React Flow v12) |
| `@monaco-editor/react` | JSON editor |
| `dagre`, `@types/dagre` | Hierarchical auto-layout |
| `tailwindcss` | Styling |
| `clsx` | Conditional CSS classes |
| `zod` | Runtime PathwayJson validation |

---

## 9. Future Extensions (Not in V1)

- **In-app LLM generation:** Upload/paste a clinical document → app calls LLM API with the spec as system prompt → produces PathwayJson → loads into editor for review
- **Auth integration:** Gate on ADMIN role via existing auth-service JWT
- **Variant group management:** UI for linking pathways to `care_plan_variant_groups` and configuring targeting criteria
- **Resolution engine integration:** Once Plan 4 (resolution engine) is built, preview mode upgrades to use it for full provider-experience simulation
- **Collaborative editing:** Multi-user awareness, locking, change attribution
- **Pathway analytics:** Usage statistics, resolution outcome tracking, confidence score trends
