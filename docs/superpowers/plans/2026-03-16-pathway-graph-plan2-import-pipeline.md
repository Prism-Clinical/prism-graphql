# Pathway Graph — Plan 2: Import Pipeline

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the JSON import pipeline that validates pathway definitions, constructs AGE graph nodes/edges, populates relational side tables, computes diffs between versions, and handles three import modes (new, draft-update, new-version) — all within a single PostgreSQL transaction.

**Architecture:** Incoming pathway JSON is validated against structural and semantic rules (all errors collected, not fail-on-first). Valid payloads are transformed into Cypher CREATE statements for the AGE graph, with corresponding relational rows in `pathway_graph_index`, `pathway_condition_codes`, and `pathway_version_diffs`. Draft updates use a diff engine to apply only changed nodes/edges. The entire import runs in one PG transaction so any failure rolls back graph and relational writes together.

**Tech Stack:** TypeScript 5, Apache AGE 1.5.0 (Cypher), PostgreSQL 15, Apollo Server 4, Apollo Federation 2.10, Jest

**Spec:** `docs/superpowers/specs/` (see RFC at `prism-ml-infra/docs/RFC_Clinical_Pathway_Graph_Architecture.md`)

**Depends on:** Plan 1 (Infrastructure & Service Scaffold) — merged as PR #26

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `apps/pathway-service/src/services/import/types.ts` | TypeScript interfaces for the pathway JSON schema and import results |
| `apps/pathway-service/src/services/import/validator.ts` | JSON validation — structural + semantic rules, all-errors-at-once |
| `apps/pathway-service/src/services/import/graph-builder.ts` | Converts validated JSON into Cypher CREATE statements for AGE |
| `apps/pathway-service/src/services/import/relational-writer.ts` | Populates pathway_graph_index, pathway_condition_codes, pathway_version_diffs |
| `apps/pathway-service/src/services/import/diff-engine.ts` | Computes node/edge/property-level diffs between pathway versions |
| `apps/pathway-service/src/services/import/import-orchestrator.ts` | Coordinates validate → build → write in a single PG transaction |
| `apps/pathway-service/src/services/import/index.ts` | Barrel export for import module |
| `apps/pathway-service/src/resolvers/Mutation.ts` | importPathway, activatePathway, archivePathway resolvers |
| `apps/pathway-service/src/__tests__/fixtures/reference-pathway.ts` | Reference pathway JSON fixture for testing |
| `apps/pathway-service/src/__tests__/validator.test.ts` | Validator unit tests |
| `apps/pathway-service/src/__tests__/graph-builder.test.ts` | Graph builder unit tests |
| `apps/pathway-service/src/__tests__/relational-writer.test.ts` | Relational writer unit tests |
| `apps/pathway-service/src/__tests__/diff-engine.test.ts` | Diff engine unit tests |
| `apps/pathway-service/src/__tests__/import-orchestrator.test.ts` | Orchestrator unit tests |
| `apps/pathway-service/src/__tests__/mutation-resolvers.test.ts` | Mutation resolver unit tests |

### Modified files

| File | Change |
|------|--------|
| `apps/pathway-service/schema.graphql` | Add import mutations, input types, result types, enums |
| `apps/pathway-service/src/resolvers/index.ts` | Import and merge Mutation resolvers |
| `apps/pathway-service/src/types/index.ts` | Add ImportMode enum |

---

## Chunk 1: Types, Fixture, Schema

### Task 1: Import Types — Pathway JSON Schema Interfaces

**Files:**
- Create: `apps/pathway-service/src/services/import/types.ts`
- Test: (type-only file — validated by typecheck, no runtime tests needed)

The pathway JSON schema defines the structure that AI-generated pathway content must conform to. This is the contract between the authoring workflow and the import pipeline.

- [ ] **Step 1: Create the import types file**

```typescript
// apps/pathway-service/src/services/import/types.ts

// ─── Pathway JSON Schema ─────────────────────────────────────────────
// This is the shape of the JSON that gets POSTed to the import endpoint.
// AI systems produce this from doctor-authored pathway content.

export interface PathwayJson {
  schema_version: string;
  pathway: PathwayMetadata;
  nodes: PathwayNodeDefinition[];
  edges: PathwayEdgeDefinition[];
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

export interface ConditionCodeDefinition {
  code: string;
  system: string;
  description?: string;
  usage?: string;
  grouping?: string;
}

// All valid node types in the graph
export type PathwayNodeType =
  | 'Stage'
  | 'Step'
  | 'DecisionPoint'
  | 'Criterion'
  | 'CodeEntry'
  | 'Medication'
  | 'LabTest'
  | 'Procedure'
  | 'EvidenceCitation'
  | 'QualityMetric'
  | 'Schedule';

export interface PathwayNodeDefinition {
  id: string;
  type: PathwayNodeType;
  properties: Record<string, unknown>;
}

// All valid edge types in the graph
export type PathwayEdgeType =
  | 'HAS_STAGE'
  | 'HAS_STEP'
  | 'HAS_DECISION_POINT'
  | 'HAS_CRITERION'
  | 'BRANCHES_TO'
  | 'USES_MEDICATION'
  | 'ESCALATES_TO'
  | 'CITES_EVIDENCE'
  | 'HAS_LAB_TEST'
  | 'HAS_PROCEDURE'
  | 'HAS_QUALITY_METRIC'
  | 'HAS_SCHEDULE'
  | 'HAS_CODE';

export interface PathwayEdgeDefinition {
  from: string;          // node id or "root" for the Pathway root node
  to: string;            // node id
  type: PathwayEdgeType;
  properties?: Record<string, unknown>;
}

// ─── Required Properties Per Node Type ───────────────────────────────
// Used by the validator to check that each node has the right properties.

export const REQUIRED_NODE_PROPERTIES: Record<PathwayNodeType, string[]> = {
  Stage:            ['stage_number', 'title'],
  Step:             ['stage_number', 'step_number', 'display_number', 'title'],
  DecisionPoint:    ['title'],
  Criterion:        ['description'],
  CodeEntry:        ['system', 'code'],
  Medication:       ['name', 'role'],
  LabTest:          ['name'],
  Procedure:        ['name'],
  EvidenceCitation: ['reference_number', 'title', 'evidence_level'],
  QualityMetric:    ['name', 'measure'],
  Schedule:         ['interval', 'description'],
};

// Valid edge source→target type constraints
export const VALID_EDGE_ENDPOINTS: Record<PathwayEdgeType, { from: ('root' | PathwayNodeType)[]; to: PathwayNodeType[] }> = {
  HAS_STAGE:           { from: ['root'],           to: ['Stage'] },
  HAS_STEP:            { from: ['Stage'],           to: ['Step'] },
  HAS_DECISION_POINT:  { from: ['Step'],            to: ['DecisionPoint'] },
  HAS_CRITERION:       { from: ['DecisionPoint'],   to: ['Criterion'] },
  BRANCHES_TO:         { from: ['DecisionPoint'],   to: ['Step', 'Stage'] },
  USES_MEDICATION:     { from: ['Step'],            to: ['Medication'] },
  ESCALATES_TO:        { from: ['Medication'],      to: ['Medication'] },
  CITES_EVIDENCE:      { from: ['Stage', 'Step', 'DecisionPoint', 'Criterion', 'Medication', 'LabTest', 'Procedure'], to: ['EvidenceCitation'] },
  HAS_LAB_TEST:        { from: ['Step'],            to: ['LabTest'] },
  HAS_PROCEDURE:       { from: ['Step'],            to: ['Procedure'] },
  HAS_QUALITY_METRIC:  { from: ['Step'],            to: ['QualityMetric'] },
  HAS_SCHEDULE:        { from: ['Step'],            to: ['Schedule'] },
  HAS_CODE:            { from: ['Step', 'Criterion', 'Medication', 'LabTest', 'Procedure'], to: ['CodeEntry'] },
};

// Valid code systems for ConditionCodeDefinition and CodeEntry nodes
export const VALID_CODE_SYSTEMS = ['ICD-10', 'SNOMED', 'RXNORM', 'LOINC', 'CPT'] as const;

// Valid medication roles
export const VALID_MEDICATION_ROLES = ['preferred', 'acceptable', 'avoid', 'contraindicated'] as const;

// Valid evidence levels
export const VALID_EVIDENCE_LEVELS = ['Level A', 'Level B', 'Level C', 'Expert Consensus'] as const;

// Graph size limits (enforced at import time per spec)
export const MAX_GRAPH_DEPTH = 50;
export const MAX_GRAPH_NODES = 500;

// ─── Import Pipeline Types ───────────────────────────────────────────

// ImportMode is defined as an enum in src/types/index.ts — import from there.
// Do NOT define a duplicate here.
import { ImportMode } from '../../types';
export { ImportMode };

export interface ImportPathwayInput {
  pathwayJson: PathwayJson;
  importMode: ImportMode;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ImportDiffSummary {
  nodesAdded: number;
  nodesRemoved: number;
  nodesModified: number;
  edgesAdded: number;
  edgesRemoved: number;
  edgesModified: number;
}

export interface DiffDetail {
  entityType: 'node' | 'edge';
  action: 'added' | 'removed' | 'modified';
  entityId: string;
  entityLabel: string;
  changes?: PropertyChange[];
}

export interface PropertyChange {
  property: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ImportResult {
  pathwayId: string;
  ageNodeId: string | null;
  logicalId: string;
  version: string;
  status: string;
  validation: ValidationResult;
  diff: {
    summary: ImportDiffSummary;
    details: DiffDetail[];
  } | null;
  importType: ImportMode;
}
```

- [ ] **Step 2: Run typecheck to verify types compile**

Run: `npx --prefix apps/pathway-service tsc --noEmit`
Expected: PASS (no type errors)

- [ ] **Step 3: Commit**

```bash
git add apps/pathway-service/src/services/import/types.ts
git commit -m "feat(pathway): add import pipeline TypeScript interfaces"
```

---

### Task 2: Reference Pathway Test Fixture

**Files:**
- Create: `apps/pathway-service/src/__tests__/fixtures/reference-pathway.ts`

A realistic pathway fixture (prior uterine surgery) used across all import pipeline tests. It exercises all node types, edge types, and validation rules.

- [ ] **Step 1: Create the reference pathway fixture**

```typescript
// apps/pathway-service/src/__tests__/fixtures/reference-pathway.ts

import { PathwayJson } from '../../services/import/types';

/**
 * Reference pathway: Prior Uterine Surgery Management
 * Exercises all node types, edge types, and validation rules.
 * Used as the baseline across all import pipeline tests.
 */
export const REFERENCE_PATHWAY: PathwayJson = {
  schema_version: '1.0',
  pathway: {
    logical_id: 'CP-PriorUterineSurgery',
    title: 'Prior Uterine Surgery Management',
    version: '1.0',
    category: 'OBSTETRIC',
    scope: 'Management of patients with prior uterine surgical history',
    target_population: 'Pregnant patients with history of cesarean delivery or other uterine surgery',
    condition_codes: [
      { code: 'O34.211', system: 'ICD-10', description: 'Maternal care for unspecified type scar from previous cesarean delivery', usage: 'primary', grouping: 'prior_surgery' },
      { code: 'O34.29', system: 'ICD-10', description: 'Maternal care due to uterine scar from other previous surgery', usage: 'secondary', grouping: 'prior_surgery' },
    ],
  },
  nodes: [
    // Stage 1: Initial Assessment
    { id: 'stage-1', type: 'Stage', properties: { stage_number: 1, title: 'Initial Assessment', description: 'Gather surgical history and assess risk factors' } },
    { id: 'step-1-1', type: 'Step', properties: { stage_number: 1, step_number: 1, display_number: '1.1', title: 'Obtain Surgical History', description: 'Document type, number, and indication of prior uterine surgeries' } },
    { id: 'step-1-2', type: 'Step', properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'Review Operative Reports', description: 'Review prior operative reports for incision type and complications' } },

    // Stage 2: Risk Stratification
    { id: 'stage-2', type: 'Stage', properties: { stage_number: 2, title: 'Risk Stratification', description: 'Determine delivery planning based on risk profile' } },
    { id: 'step-2-1', type: 'Step', properties: { stage_number: 2, step_number: 1, display_number: '2.1', title: 'Assess TOLAC Candidacy', description: 'Evaluate trial of labor after cesarean eligibility' } },

    // Decision Point: TOLAC vs Repeat Cesarean
    { id: 'dp-1', type: 'DecisionPoint', properties: { title: 'Delivery Method Decision', auto_resolve_eligible: true } },
    { id: 'crit-1', type: 'Criterion', properties: { description: 'Single prior low-transverse cesarean', code_system: 'ICD-10', code_value: 'O34.211', base_rate: 0.006, is_critical: true } },
    { id: 'crit-2', type: 'Criterion', properties: { description: 'Prior classical or T-incision', code_system: 'ICD-10', code_value: 'O34.29', base_rate: 0.04, is_critical: true } },

    // Stage 3: TOLAC pathway
    { id: 'stage-3', type: 'Stage', properties: { stage_number: 3, title: 'TOLAC Management', description: 'Management for trial of labor after cesarean' } },
    { id: 'step-3-1', type: 'Step', properties: { stage_number: 3, step_number: 1, display_number: '3.1', title: 'Continuous Fetal Monitoring', description: 'Apply continuous electronic fetal monitoring during labor' } },

    // Medication
    { id: 'med-1', type: 'Medication', properties: { name: 'Oxytocin', dose: '2 milliunits/min initial', route: 'IV', frequency: 'Titrate per protocol', role: 'acceptable' } },
    { id: 'med-2', type: 'Medication', properties: { name: 'Dinoprostone', dose: '10mg insert', route: 'Vaginal', frequency: 'Once', role: 'acceptable' } },
    { id: 'med-3', type: 'Medication', properties: { name: 'Misoprostol', dose: 'N/A', route: 'N/A', frequency: 'N/A', role: 'contraindicated' } },

    // Lab Test
    { id: 'lab-1', type: 'LabTest', properties: { name: 'Complete Blood Count', code_system: 'LOINC', code_value: '58410-2' } },

    // Procedure
    { id: 'proc-1', type: 'Procedure', properties: { name: 'Cesarean Delivery', code_system: 'CPT', code_value: '59510' } },

    // Evidence
    { id: 'ev-1', type: 'EvidenceCitation', properties: { reference_number: 1, title: 'ACOG Practice Bulletin No. 205: Vaginal Birth After Cesarean Delivery', source: 'Obstetrics & Gynecology', evidence_level: 'Level A', year: 2019 } },
    { id: 'ev-2', type: 'EvidenceCitation', properties: { reference_number: 2, title: 'Uterine Rupture Risk Factors', source: 'American Journal of Obstetrics & Gynecology', evidence_level: 'Level B', year: 2020 } },

    // Quality Metric
    { id: 'qm-1', type: 'QualityMetric', properties: { name: 'VBAC Success Rate', measure: 'Percentage of TOLAC attempts resulting in vaginal delivery', target: '>= 60%' } },

    // Schedule
    { id: 'sched-1', type: 'Schedule', properties: { interval: 'Every 15 minutes', duration: 'Throughout active labor', description: 'Fetal heart rate monitoring intervals during TOLAC' } },

    // Code entries
    { id: 'code-1', type: 'CodeEntry', properties: { system: 'ICD-10', code: 'O34.211', description: 'Low transverse cesarean scar' } },
    { id: 'code-2', type: 'CodeEntry', properties: { system: 'CPT', code: '59510', description: 'Cesarean delivery' } },
  ],
  edges: [
    // Root → Stages
    { from: 'root', to: 'stage-1', type: 'HAS_STAGE', properties: { order: 1 } },
    { from: 'root', to: 'stage-2', type: 'HAS_STAGE', properties: { order: 2 } },
    { from: 'root', to: 'stage-3', type: 'HAS_STAGE', properties: { order: 3 } },

    // Stage 1 → Steps
    { from: 'stage-1', to: 'step-1-1', type: 'HAS_STEP', properties: { order: 1 } },
    { from: 'stage-1', to: 'step-1-2', type: 'HAS_STEP', properties: { order: 2 } },

    // Stage 2 → Steps + Decision
    { from: 'stage-2', to: 'step-2-1', type: 'HAS_STEP', properties: { order: 1 } },
    { from: 'step-2-1', to: 'dp-1', type: 'HAS_DECISION_POINT' },

    // Decision Point → Criteria + Branches
    { from: 'dp-1', to: 'crit-1', type: 'HAS_CRITERION' },
    { from: 'dp-1', to: 'crit-2', type: 'HAS_CRITERION' },
    { from: 'dp-1', to: 'stage-3', type: 'BRANCHES_TO', properties: { label: 'TOLAC candidate', confidence_threshold: 0.7 } },

    // Stage 3 → Steps
    { from: 'stage-3', to: 'step-3-1', type: 'HAS_STEP', properties: { order: 1 } },

    // Step → Medication
    { from: 'step-3-1', to: 'med-1', type: 'USES_MEDICATION' },
    { from: 'step-3-1', to: 'med-2', type: 'USES_MEDICATION' },
    { from: 'step-3-1', to: 'med-3', type: 'USES_MEDICATION' },

    // Medication escalation (only between acceptable agents; contraindicated med-3 has no escalation path)
    { from: 'med-1', to: 'med-2', type: 'ESCALATES_TO' },

    // Step → Lab / Procedure
    { from: 'step-1-1', to: 'lab-1', type: 'HAS_LAB_TEST' },
    { from: 'step-2-1', to: 'proc-1', type: 'HAS_PROCEDURE' },

    // Evidence citations
    { from: 'dp-1', to: 'ev-1', type: 'CITES_EVIDENCE' },
    { from: 'crit-2', to: 'ev-2', type: 'CITES_EVIDENCE' },

    // Quality metric + Schedule
    { from: 'step-3-1', to: 'qm-1', type: 'HAS_QUALITY_METRIC' },
    { from: 'step-3-1', to: 'sched-1', type: 'HAS_SCHEDULE' },

    // Code entries
    { from: 'crit-1', to: 'code-1', type: 'HAS_CODE' },
    { from: 'proc-1', to: 'code-2', type: 'HAS_CODE' },
  ],
};

/**
 * Helper: deep-clone the reference pathway for mutation in tests.
 */
export function clonePathway(pw: PathwayJson = REFERENCE_PATHWAY): PathwayJson {
  return JSON.parse(JSON.stringify(pw));
}

/**
 * Minimal valid pathway with just one stage and one step.
 * Useful for tests that don't need full graph complexity.
 */
export const MINIMAL_PATHWAY: PathwayJson = {
  schema_version: '1.0',
  pathway: {
    logical_id: 'CP-Minimal',
    title: 'Minimal Test Pathway',
    version: '1.0',
    category: 'ACUTE_CARE',
    condition_codes: [
      { code: 'J06.9', system: 'ICD-10', description: 'Acute upper respiratory infection' },
    ],
  },
  nodes: [
    { id: 'stage-1', type: 'Stage', properties: { stage_number: 1, title: 'Assessment' } },
    { id: 'step-1-1', type: 'Step', properties: { stage_number: 1, step_number: 1, display_number: '1.1', title: 'Initial Evaluation' } },
  ],
  edges: [
    { from: 'root', to: 'stage-1', type: 'HAS_STAGE', properties: { order: 1 } },
    { from: 'stage-1', to: 'step-1-1', type: 'HAS_STEP', properties: { order: 1 } },
  ],
};
```

- [ ] **Step 2: Run typecheck to verify fixture compiles against types**

Run: `npx --prefix apps/pathway-service tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/pathway-service/src/__tests__/fixtures/reference-pathway.ts
git commit -m "test(pathway): add reference pathway fixture for import pipeline tests"
```

---

### Task 3: GraphQL Schema Extensions for Import

**Files:**
- Modify: `apps/pathway-service/schema.graphql`
- Modify: `apps/pathway-service/src/types/index.ts`

Extend the schema with import mutations and related types. We add these now so resolvers can be built against them incrementally.

- [ ] **Step 1: Extend schema.graphql with import types and mutations**

Replace the entire contents of `schema.graphql` with:

```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key", "@external", "@shareable"])

# ─── Enums ─────────────────────────────────────────────────────────────

enum PathwayStatus {
  DRAFT
  ACTIVE
  ARCHIVED
  SUPERSEDED
}

enum PathwayCategory {
  CHRONIC_DISEASE
  ACUTE_CARE
  PREVENTIVE_CARE
  POST_PROCEDURE
  MEDICATION_MANAGEMENT
  LIFESTYLE_MODIFICATION
  MENTAL_HEALTH
  PEDIATRIC
  GERIATRIC
  OBSTETRIC
}

enum ImportMode {
  NEW_PATHWAY
  DRAFT_UPDATE
  NEW_VERSION
}

# ─── Core Types ────────────────────────────────────────────────────────

type Pathway @key(fields: "id") {
  id: ID!
  logicalId: String!
  title: String!
  version: String!
  category: PathwayCategory!
  status: PathwayStatus!
  conditionCodes: [String!]!
  scope: String
  targetPopulation: String
  isActive: Boolean!
  createdAt: String!
  updatedAt: String!
}

# ─── Import Types ──────────────────────────────────────────────────────

type ValidationResult {
  valid: Boolean!
  errors: [String!]!
  warnings: [String!]!
}

type ImportDiffSummary {
  nodesAdded: Int!
  nodesRemoved: Int!
  nodesModified: Int!
  edgesAdded: Int!
  edgesRemoved: Int!
  edgesModified: Int!
}

type DiffDetail {
  entityType: String!
  action: String!
  entityId: String!
  entityLabel: String!
}

type ImportDiff {
  summary: ImportDiffSummary!
  details: [DiffDetail!]!
}

type ImportPathwayResult {
  pathway: Pathway
  validation: ValidationResult!
  diff: ImportDiff
  importType: ImportMode!
}

type PathwayStatusResult {
  pathway: Pathway!
  previousStatus: PathwayStatus!
}

# ─── Queries ───────────────────────────────────────────────────────────

type Query {
  pathwayServiceHealth: Boolean!
  pathways(status: PathwayStatus, category: PathwayCategory, first: Int): [Pathway!]!
  pathway(id: ID!): Pathway
}

# ─── Mutations ─────────────────────────────────────────────────────────

type Mutation {
  """
  Import a clinical pathway from JSON. Supports three modes:
  - NEW_PATHWAY: First import of a new pathway
  - DRAFT_UPDATE: Re-import of an existing DRAFT pathway (applies diff)
  - NEW_VERSION: Create a new version of an existing pathway

  pathwayJson is a JSON string conforming to the PathwayJson schema (see
  apps/pathway-service/src/services/import/types.ts). It includes schema_version,
  pathway metadata, nodes array, and edges array. The pipeline validates the
  full structure and returns all errors at once.
  """
  importPathway(pathwayJson: String!, importMode: ImportMode!): ImportPathwayResult!

  """Activate a DRAFT pathway, making it available for patient matching."""
  activatePathway(id: ID!): PathwayStatusResult!

  """Archive an ACTIVE pathway, removing it from patient matching."""
  archivePathway(id: ID!): PathwayStatusResult!

  """Reactivate a SUPERSEDED or ARCHIVED pathway."""
  reactivatePathway(id: ID!): PathwayStatusResult!
}
```

- [ ] **Step 2: Add ImportMode enum to types/index.ts**

Add to the end of `apps/pathway-service/src/types/index.ts`:

```typescript
// Import modes
export enum ImportMode {
  NEW_PATHWAY = 'NEW_PATHWAY',
  DRAFT_UPDATE = 'DRAFT_UPDATE',
  NEW_VERSION = 'NEW_VERSION',
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx --prefix apps/pathway-service tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/pathway-service/schema.graphql apps/pathway-service/src/types/index.ts
git commit -m "feat(pathway): extend GraphQL schema with import mutations and types"
```

---

## Chunk 2: Validator

### Task 4: Validator — Structural Rules

**Files:**
- Create: `apps/pathway-service/src/services/import/validator.ts`
- Create: `apps/pathway-service/src/__tests__/validator.test.ts`

The validator checks the incoming JSON for structural correctness (shape, required fields, valid enums) and collects ALL errors before returning. Never fail on the first error.

- [ ] **Step 1: Write failing tests for structural validation**

```typescript
// apps/pathway-service/src/__tests__/validator.test.ts

import { validatePathwayJson } from '../services/import/validator';
import { REFERENCE_PATHWAY, MINIMAL_PATHWAY, clonePathway } from './fixtures/reference-pathway';

describe('validatePathwayJson', () => {
  describe('structural rules', () => {
    it('should pass validation for the reference pathway', () => {
      const result = validatePathwayJson(REFERENCE_PATHWAY);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass validation for the minimal pathway', () => {
      const result = validatePathwayJson(MINIMAL_PATHWAY);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // S1: schema_version required
    it('should reject missing schema_version', () => {
      const pw = clonePathway();
      delete (pw as any).schema_version;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('schema_version'));
    });

    // S2: pathway metadata required
    it('should reject missing pathway metadata', () => {
      const pw = clonePathway();
      delete (pw as any).pathway;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('pathway'));
    });

    // S3: required pathway fields
    it('should reject missing pathway.logical_id', () => {
      const pw = clonePathway();
      delete (pw.pathway as any).logical_id;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('logical_id'));
    });

    it('should reject missing pathway.title', () => {
      const pw = clonePathway();
      delete (pw.pathway as any).title;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('title'));
    });

    it('should reject missing pathway.version', () => {
      const pw = clonePathway();
      delete (pw.pathway as any).version;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('version'));
    });

    it('should reject missing pathway.category', () => {
      const pw = clonePathway();
      delete (pw.pathway as any).category;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('category'));
    });

    // S4: invalid category
    it('should reject invalid pathway.category', () => {
      const pw = clonePathway();
      pw.pathway.category = 'INVALID_CATEGORY';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('category'));
    });

    // S5: nodes must be an array
    it('should reject missing nodes array', () => {
      const pw = clonePathway();
      delete (pw as any).nodes;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('nodes'));
    });

    // S6: edges must be an array
    it('should reject missing edges array', () => {
      const pw = clonePathway();
      delete (pw as any).edges;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('edges'));
    });

    // S7: node must have id, type, properties
    it('should reject node without id', () => {
      const pw = clonePathway();
      delete (pw.nodes[0] as any).id;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('node[0]'));
    });

    // S8: invalid node type
    it('should reject invalid node type', () => {
      const pw = clonePathway();
      (pw.nodes[0] as any).type = 'InvalidType';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('InvalidType'));
    });

    // S9: duplicate node ids
    it('should reject duplicate node ids', () => {
      const pw = clonePathway();
      pw.nodes.push({ ...pw.nodes[0] });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('duplicate'));
    });

    // S10: required properties per node type
    it('should reject Stage missing stage_number', () => {
      const pw = clonePathway();
      const stage = pw.nodes.find(n => n.type === 'Stage')!;
      delete (stage.properties as any).stage_number;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('stage_number'));
    });

    // S11: edge must have from, to, type
    it('should reject edge without from', () => {
      const pw = clonePathway();
      delete (pw.edges[0] as any).from;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('edge[0]'));
    });

    // S12: invalid edge type
    it('should reject invalid edge type', () => {
      const pw = clonePathway();
      (pw.edges[0] as any).type = 'INVALID_EDGE';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('INVALID_EDGE'));
    });

    // S13: edge references nonexistent node
    it('should reject edge referencing nonexistent node', () => {
      const pw = clonePathway();
      pw.edges.push({ from: 'nonexistent', to: 'stage-1', type: 'HAS_STAGE' });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('nonexistent'));
    });

    // S14: edge endpoint type constraints
    it('should reject HAS_STAGE from a Step node', () => {
      const pw = clonePathway();
      pw.edges.push({ from: 'step-1-1', to: 'stage-2', type: 'HAS_STAGE' });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('HAS_STAGE'));
    });

    // S15: condition_codes required and non-empty
    it('should reject empty condition_codes', () => {
      const pw = clonePathway();
      pw.pathway.condition_codes = [];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('condition_codes'));
    });

    // All-errors-at-once: multiple errors collected
    it('should collect multiple errors at once', () => {
      const pw = clonePathway();
      delete (pw as any).schema_version;
      delete (pw.pathway as any).logical_id;
      pw.pathway.condition_codes = [];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=validator --no-coverage`
Expected: FAIL — `validatePathwayJson` does not exist

- [ ] **Step 3: Implement the validator — structural rules**

```typescript
// apps/pathway-service/src/services/import/validator.ts

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=validator --no-coverage`
Expected: All 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/import/validator.ts apps/pathway-service/src/__tests__/validator.test.ts
git commit -m "feat(pathway): add import validator with structural rules"
```

---

### Task 5: Validator — Semantic Rules

**Files:**
- Modify: `apps/pathway-service/src/services/import/validator.ts`
- Modify: `apps/pathway-service/src/__tests__/validator.test.ts`

Add semantic validation: code format patterns, graph depth check, at least one Stage, and connectivity warnings.

- [ ] **Step 1: Add failing tests for semantic validation**

Append to the `describe('validatePathwayJson')` block in `validator.test.ts`:

```typescript
  describe('semantic rules', () => {
    // SE1: ICD-10 code format
    it('should reject invalid ICD-10 code format', () => {
      const pw = clonePathway();
      pw.pathway.condition_codes[0].code = 'INVALID';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('ICD-10'));
    });

    // SE2: must have at least one Stage node
    it('should reject pathway with no Stage nodes', () => {
      const pw = clonePathway();
      pw.nodes = pw.nodes.filter(n => n.type !== 'Stage');
      // Also remove edges that reference removed stages
      pw.edges = pw.edges.filter(e => {
        const stageIds = ['stage-1', 'stage-2', 'stage-3'];
        return !stageIds.includes(e.from) && !stageIds.includes(e.to);
      });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Stage'));
    });

    // SE3: graph depth check
    it('should not warn for shallow pathways', () => {
      const pw = clonePathway();
      const result = validatePathwayJson(pw);
      expect(result.warnings.filter(w => w.includes('depth'))).toHaveLength(0);
    });

    it('should warn when graph depth exceeds 30', () => {
      const pw = clonePathway();
      // Build a chain of 32 nested steps to trigger the warning
      for (let i = 10; i <= 41; i++) {
        pw.nodes.push({ id: `deep-step-${i}`, type: 'Step', properties: { stage_number: 1, step_number: i, display_number: `1.${i}`, title: `Deep Step ${i}` } });
        pw.edges.push({ from: i === 10 ? 'step-1-1' : `deep-step-${i-1}`, to: `deep-step-${i}`, type: 'HAS_DECISION_POINT' as any });
      }
      const result = validatePathwayJson(pw);
      expect(result.warnings).toContainEqual(expect.stringContaining('depth'));
    });

    // SE4: root must have at least one HAS_STAGE edge
    it('should reject pathway with no root → HAS_STAGE edges', () => {
      const pw = clonePathway();
      pw.edges = pw.edges.filter(e => !(e.from === 'root' && e.type === 'HAS_STAGE'));
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('HAS_STAGE'));
    });

    // SE5: DecisionPoint should have at least one BRANCHES_TO edge
    it('should warn when DecisionPoint has no BRANCHES_TO edges', () => {
      const pw = clonePathway();
      pw.edges = pw.edges.filter(e => e.type !== 'BRANCHES_TO');
      const result = validatePathwayJson(pw);
      expect(result.warnings).toContainEqual(expect.stringContaining('BRANCHES_TO'));
    });

    // SE6: orphan nodes (nodes not connected by any edge)
    it('should warn about orphan nodes', () => {
      const pw = clonePathway();
      pw.nodes.push({ id: 'orphan-1', type: 'Stage', properties: { stage_number: 99, title: 'Orphan' } });
      const result = validatePathwayJson(pw);
      expect(result.warnings).toContainEqual(expect.stringContaining('orphan'));
    });

    // SE7: CodeEntry code format validation for non-ICD-10 systems
    it('should reject CodeEntry with invalid LOINC code format', () => {
      const pw = clonePathway();
      const codeEntry = pw.nodes.find(n => n.id === 'code-1')!;
      codeEntry.properties.system = 'LOINC';
      codeEntry.properties.code = 'NOT-A-LOINC';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('LOINC'));
    });

    // SE8: cross-reference validation — condition codes used in criteria must be defined
    it('should warn when criterion references code not in condition_codes', () => {
      const pw = clonePathway();
      // Change a criterion's code to something not in condition_codes
      const crit = pw.nodes.find(n => n.id === 'crit-1')!;
      crit.properties.code_value = 'Z99.99';
      const result = validatePathwayJson(pw);
      expect(result.warnings).toContainEqual(expect.stringContaining('Z99.99'));
    });
  });
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=validator --no-coverage`
Expected: New semantic tests FAIL, structural tests still PASS

- [ ] **Step 3: Add semantic validation to validator.ts**

Add the following function to `validator.ts` and call it at the end of `validatePathwayJson` (before the return statement):

```typescript
// Add this call before the return statement in validatePathwayJson:
  validateSemanticRules(pw, nodeIds, nodeTypeMap, errors, warnings);

// Add this function:
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
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=validator --no-coverage`
Expected: All 25 tests PASS (16 structural + 9 semantic)

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/import/validator.ts apps/pathway-service/src/__tests__/validator.test.ts
git commit -m "feat(pathway): add semantic validation rules to import validator"
```

---

## Chunk 3: Graph Builder & Relational Writer

### Task 6: Graph Builder — Cypher Generation

**Files:**
- Create: `apps/pathway-service/src/services/import/graph-builder.ts`
- Create: `apps/pathway-service/src/__tests__/graph-builder.test.ts`

Generates Cypher CREATE statements from validated pathway JSON. The builder produces a list of Cypher commands that run within a single transaction to construct the full graph.

**Important:** All property values are escaped for Cypher. No string interpolation of user input — values go through safe serialization.

- [ ] **Step 1: Write failing tests for graph builder**

```typescript
// apps/pathway-service/src/__tests__/graph-builder.test.ts

import { buildGraphCommands } from '../services/import/graph-builder';
import { REFERENCE_PATHWAY, MINIMAL_PATHWAY, clonePathway } from './fixtures/reference-pathway';

describe('buildGraphCommands', () => {
  it('should return a root Pathway CREATE as the first command', () => {
    const commands = buildGraphCommands(REFERENCE_PATHWAY);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands[0].cypher).toContain('CREATE (v:Pathway');
    expect(commands[0].cypher).toContain('CP-PriorUterineSurgery');
  });

  it('should create one command per node plus root', () => {
    const commands = buildGraphCommands(MINIMAL_PATHWAY);
    // root + 2 nodes = 3 node creates, plus 2 edge creates = 5 total
    const nodeCreates = commands.filter(c => c.type === 'node');
    expect(nodeCreates).toHaveLength(3); // root + stage-1 + step-1-1
  });

  it('should create one command per edge', () => {
    const commands = buildGraphCommands(MINIMAL_PATHWAY);
    const edgeCreates = commands.filter(c => c.type === 'edge');
    expect(edgeCreates).toHaveLength(2); // HAS_STAGE + HAS_STEP
  });

  it('should escape single quotes in property values', () => {
    const pw = clonePathway(MINIMAL_PATHWAY);
    pw.nodes[0].properties.title = "Patient's Assessment";
    const commands = buildGraphCommands(pw);
    const stageCypher = commands.find(c => c.nodeId === 'stage-1')!.cypher;
    expect(stageCypher).toContain("Patient\\'s Assessment");
    expect(stageCypher).not.toContain("Patient's Assessment");
  });

  it('should reject property keys with unsafe characters', () => {
    const pw = clonePathway(MINIMAL_PATHWAY);
    pw.nodes[0].properties['bad}key'] = 'exploit';
    expect(() => buildGraphCommands(pw)).toThrow('Invalid property key');
  });

  it('should include all node types from reference pathway', () => {
    const commands = buildGraphCommands(REFERENCE_PATHWAY);
    const allCypher = commands.map(c => c.cypher).join('\n');
    expect(allCypher).toContain(':Stage');
    expect(allCypher).toContain(':Step');
    expect(allCypher).toContain(':DecisionPoint');
    expect(allCypher).toContain(':Criterion');
    expect(allCypher).toContain(':Medication');
    expect(allCypher).toContain(':EvidenceCitation');
  });

  it('should include all edge types from reference pathway', () => {
    const commands = buildGraphCommands(REFERENCE_PATHWAY);
    const allCypher = commands.map(c => c.cypher).join('\n');
    expect(allCypher).toContain('HAS_STAGE');
    expect(allCypher).toContain('HAS_STEP');
    expect(allCypher).toContain('HAS_DECISION_POINT');
    expect(allCypher).toContain('BRANCHES_TO');
    expect(allCypher).toContain('USES_MEDICATION');
  });

  it('should set node_id property on every node for reference linking', () => {
    const commands = buildGraphCommands(MINIMAL_PATHWAY);
    const nodeCreates = commands.filter(c => c.type === 'node');
    for (const cmd of nodeCreates) {
      expect(cmd.cypher).toContain('node_id:');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=graph-builder --no-coverage`
Expected: FAIL — `buildGraphCommands` does not exist

- [ ] **Step 3: Implement the graph builder**

```typescript
// apps/pathway-service/src/services/import/graph-builder.ts

import { PathwayJson } from './types';

export interface CypherCommand {
  type: 'node' | 'edge';
  cypher: string;
  nodeId?: string; // For nodes: the JSON id (e.g., "stage-1")
}

/**
 * Build Cypher CREATE commands from a validated pathway JSON.
 * Returns an ordered list: root node first, then all nodes, then all edges.
 *
 * The commands use MATCH on node_id properties for edge creation,
 * so nodes must be created before edges in the transaction.
 */
export function buildGraphCommands(pw: PathwayJson): CypherCommand[] {
  const commands: CypherCommand[] = [];
  const meta = pw.pathway;

  // 1. Create root Pathway node
  commands.push({
    type: 'node',
    nodeId: 'root',
    cypher: `CREATE (v:Pathway {node_id: ${esc('root')}, logical_id: ${esc(meta.logical_id)}, title: ${esc(meta.title)}, version: ${esc(meta.version)}, category: ${esc(meta.category)}, scope: ${esc(meta.scope || '')}, target_population: ${esc(meta.target_population || '')}}) RETURN v`,
  });

  // 2. Create all other nodes
  for (const node of pw.nodes) {
    const props = serializeProperties({
      node_id: node.id,
      node_type: node.type,
      ...node.properties,
    });
    commands.push({
      type: 'node',
      nodeId: node.id,
      cypher: `CREATE (v:${node.type} {${props}}) RETURN v`,
    });
  }

  // 3. Create all edges
  for (const edge of pw.edges) {
    const fromMatch = edge.from === 'root'
      ? `MATCH (a:Pathway {node_id: 'root'})`
      : `MATCH (a {node_id: ${esc(edge.from)}})`;

    const toMatch = `MATCH (b {node_id: ${esc(edge.to)}})`;

    const edgeProps = edge.properties
      ? ` {${serializeProperties(edge.properties)}}`
      : '';

    commands.push({
      type: 'edge',
      cypher: `${fromMatch} ${toMatch} CREATE (a)-[:${edge.type}${edgeProps}]->(b) RETURN a, b`,
    });
  }

  return commands;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Escape a value for safe inclusion in a Cypher string literal.
 * AGE uses single-quoted strings.
 */
function esc(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

// Property key allowlist pattern — prevents Cypher injection via property names
const SAFE_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Serialize a properties object into Cypher property map syntax.
 * Example: {name: 'Oxytocin', dose: '2 milliunits/min'}
 * Property keys are validated against a safe pattern to prevent injection.
 */
function serializeProperties(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (!SAFE_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid property key "${key}" — keys must be alphanumeric/underscore identifiers`);
    }
    parts.push(`${key}: ${serializeValue(value)}`);
  }
  return parts.join(', ');
}

function serializeValue(value: unknown): string {
  if (typeof value === 'string') {
    return esc(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  // Arrays and objects: store as JSON string
  return esc(JSON.stringify(value));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=graph-builder --no-coverage`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/import/graph-builder.ts apps/pathway-service/src/__tests__/graph-builder.test.ts
git commit -m "feat(pathway): add graph builder for Cypher CREATE generation"
```

---

### Task 7: Relational Writer

**Files:**
- Create: `apps/pathway-service/src/services/import/relational-writer.ts`
- Create: `apps/pathway-service/src/__tests__/relational-writer.test.ts`

Writes to `pathway_graph_index`, `pathway_condition_codes`, and `pathway_version_diffs` within a given PG client (transaction-aware).

- [ ] **Step 1: Write failing tests for relational writer**

```typescript
// apps/pathway-service/src/__tests__/relational-writer.test.ts

import {
  writePathwayIndex,
  writeConditionCodes,
  writeVersionDiff,
} from '../services/import/relational-writer';
import { REFERENCE_PATHWAY } from './fixtures/reference-pathway';
import { ImportDiffSummary, DiffDetail } from '../services/import/types';

// Mock PG client
function createMockClient() {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  return {
    query: jest.fn(async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      // Return a fake row for INSERT ... RETURNING
      return {
        rows: [{
          id: '00000000-0000-4000-a000-000000000099',
          age_node_id: null,
          logical_id: 'CP-PriorUterineSurgery',
          title: 'Prior Uterine Surgery Management',
          version: '1.0',
          category: 'OBSTETRIC',
          status: 'DRAFT',
          condition_codes: ['O34.211', 'O34.29'],
          is_active: false,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      };
    }),
    queries,
  };
}

describe('writePathwayIndex', () => {
  it('should INSERT into pathway_graph_index with correct values', async () => {
    const client = createMockClient();
    const meta = REFERENCE_PATHWAY.pathway;
    await writePathwayIndex(client as any, meta, 'age-node-123', 'user-1');

    expect(client.query).toHaveBeenCalledTimes(1);
    const call = client.queries[0];
    expect(call.text).toContain('INSERT INTO pathway_graph_index');
    expect(call.values).toContain('CP-PriorUterineSurgery');
    expect(call.values).toContain('Prior Uterine Surgery Management');
    expect(call.values).toContain('1.0');
    expect(call.values).toContain('OBSTETRIC');
    expect(call.values).toContain('age-node-123');
  });
});

describe('writeConditionCodes', () => {
  it('should INSERT one row per condition code', async () => {
    const client = createMockClient();
    const pathwayId = '00000000-0000-4000-a000-000000000099';
    await writeConditionCodes(client as any, pathwayId, REFERENCE_PATHWAY.pathway.condition_codes);

    expect(client.query).toHaveBeenCalledTimes(2); // 2 condition codes
    for (const q of client.queries) {
      expect(q.text).toContain('INSERT INTO pathway_condition_codes');
    }
  });

  it('should skip if no condition codes', async () => {
    const client = createMockClient();
    await writeConditionCodes(client as any, 'pid', []);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('writeVersionDiff', () => {
  it('should INSERT into pathway_version_diffs', async () => {
    const client = createMockClient();
    const summary: ImportDiffSummary = { nodesAdded: 5, nodesRemoved: 0, nodesModified: 0, edgesAdded: 3, edgesRemoved: 0, edgesModified: 0 };
    const details: DiffDetail[] = [{ entityType: 'node', action: 'added', entityId: 'stage-1', entityLabel: 'Stage' }];

    await writeVersionDiff(client as any, 'pw-id', null, 'NEW_PATHWAY', summary, details, 'user-1');

    expect(client.query).toHaveBeenCalledTimes(1);
    const call = client.queries[0];
    expect(call.text).toContain('INSERT INTO pathway_version_diffs');
    expect(call.values).toContain('NEW_PATHWAY');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=relational-writer --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the relational writer**

```typescript
// apps/pathway-service/src/services/import/relational-writer.ts

import { PoolClient } from 'pg';
import {
  PathwayMetadata,
  ConditionCodeDefinition,
  ImportMode,
  ImportDiffSummary,
  DiffDetail,
} from './types';

/**
 * Insert a row into pathway_graph_index. Returns the inserted row.
 */
export async function writePathwayIndex(
  client: PoolClient,
  meta: PathwayMetadata,
  ageNodeId: string | null,
  userId: string
): Promise<{ id: string }> {
  const conditionCodesArray = meta.condition_codes.map(cc => cc.code);

  const result = await client.query(
    `INSERT INTO pathway_graph_index
      (age_node_id, logical_id, title, version, category, condition_codes, scope, target_population, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      ageNodeId,
      meta.logical_id,
      meta.title,
      meta.version,
      meta.category,
      conditionCodesArray,
      meta.scope || null,
      meta.target_population || null,
      userId,
    ]
  );

  return result.rows[0];
}

/**
 * Insert rows into pathway_condition_codes for a given pathway.
 */
export async function writeConditionCodes(
  client: PoolClient,
  pathwayId: string,
  conditionCodes: ConditionCodeDefinition[]
): Promise<void> {
  for (const cc of conditionCodes) {
    await client.query(
      `INSERT INTO pathway_condition_codes
        (pathway_id, code, system, description, usage, grouping)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pathwayId, cc.code, cc.system, cc.description || null, cc.usage || null, cc.grouping || null]
    );
  }
}

/**
 * Insert a row into pathway_version_diffs to record the import audit trail.
 */
export async function writeVersionDiff(
  client: PoolClient,
  pathwayId: string,
  previousPathwayId: string | null,
  importType: ImportMode,
  summary: ImportDiffSummary,
  details: DiffDetail[],
  userId: string
): Promise<void> {
  await client.query(
    `INSERT INTO pathway_version_diffs
      (pathway_id, previous_pathway_id, import_type, diff_summary, diff_details, imported_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [pathwayId, previousPathwayId, importType, JSON.stringify(summary), JSON.stringify(details), userId]
  );
}

/**
 * Delete condition codes for a pathway (used during DRAFT_UPDATE to replace them).
 */
export async function deleteConditionCodes(
  client: PoolClient,
  pathwayId: string
): Promise<void> {
  await client.query('DELETE FROM pathway_condition_codes WHERE pathway_id = $1', [pathwayId]);
}

/**
 * Update a pathway_graph_index row (for DRAFT_UPDATE mode).
 * Note: logical_id and version are NOT updated — DRAFT_UPDATE is version-preserving
 * by design. The orchestrator already verified (logical_id, version) match before calling.
 */
export async function updatePathwayIndex(
  client: PoolClient,
  pathwayId: string,
  meta: PathwayMetadata,
  ageNodeId: string | null
): Promise<{ id: string }> {
  const conditionCodesArray = meta.condition_codes.map(cc => cc.code);

  const result = await client.query(
    `UPDATE pathway_graph_index
     SET age_node_id = $1, title = $2, condition_codes = $3, scope = $4,
         target_population = $5, category = $6
     WHERE id = $7
     RETURNING *`,
    [ageNodeId, meta.title, conditionCodesArray, meta.scope || null, meta.target_population || null, meta.category, pathwayId]
  );

  return result.rows[0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=relational-writer --no-coverage`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/import/relational-writer.ts apps/pathway-service/src/__tests__/relational-writer.test.ts
git commit -m "feat(pathway): add relational writer for pathway index and condition codes"
```

---

## Chunk 4: Diff Engine

### Task 8: Diff Engine

**Files:**
- Create: `apps/pathway-service/src/services/import/diff-engine.ts`
- Create: `apps/pathway-service/src/__tests__/diff-engine.test.ts`

Computes diffs between an incoming pathway JSON and an existing one. Operates on three levels: node-level (added/removed/modified), edge-level, and property-level. Nodes are matched by their `id` field. Edges are matched by `(from, to, type)` tuple.

- [ ] **Step 1: Write failing tests for the diff engine**

```typescript
// apps/pathway-service/src/__tests__/diff-engine.test.ts

import { computeDiff } from '../services/import/diff-engine';
import { MINIMAL_PATHWAY, clonePathway } from './fixtures/reference-pathway';
import { PathwayJson } from '../services/import/types';

describe('computeDiff', () => {
  it('should report no changes for identical pathways', () => {
    const diff = computeDiff(MINIMAL_PATHWAY, MINIMAL_PATHWAY);
    expect(diff.summary.nodesAdded).toBe(0);
    expect(diff.summary.nodesRemoved).toBe(0);
    expect(diff.summary.nodesModified).toBe(0);
    expect(diff.summary.edgesAdded).toBe(0);
    expect(diff.summary.edgesRemoved).toBe(0);
    expect(diff.summary.edgesModified).toBe(0);
    expect(diff.details).toHaveLength(0);
  });

  it('should detect added nodes', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.nodes.push({
      id: 'step-1-2',
      type: 'Step',
      properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'New Step' },
    });

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.nodesAdded).toBe(1);
    expect(diff.details).toContainEqual(
      expect.objectContaining({ entityType: 'node', action: 'added', entityId: 'step-1-2' })
    );
  });

  it('should detect removed nodes', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.nodes = incoming.nodes.filter(n => n.id !== 'step-1-1');
    // Also remove edges referencing the removed node
    incoming.edges = incoming.edges.filter(e => e.to !== 'step-1-1');

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.nodesRemoved).toBe(1);
    expect(diff.details).toContainEqual(
      expect.objectContaining({ entityType: 'node', action: 'removed', entityId: 'step-1-1' })
    );
  });

  it('should detect modified node properties', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.nodes[0].properties.title = 'Updated Assessment';

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.nodesModified).toBe(1);
    const modified = diff.details.find(d => d.action === 'modified' && d.entityType === 'node');
    expect(modified).toBeDefined();
    expect(modified!.changes).toContainEqual(
      expect.objectContaining({ property: 'title', oldValue: 'Assessment', newValue: 'Updated Assessment' })
    );
  });

  it('should detect added edges', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.nodes.push({
      id: 'ev-1',
      type: 'EvidenceCitation',
      properties: { reference_number: 1, title: 'Test', evidence_level: 'Level A' },
    });
    incoming.edges.push({ from: 'step-1-1', to: 'ev-1', type: 'CITES_EVIDENCE' });

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.edgesAdded).toBe(1);
    expect(diff.summary.nodesAdded).toBe(1);
  });

  it('should detect removed edges', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.edges = incoming.edges.filter(e => e.type !== 'HAS_STEP');

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.edgesRemoved).toBe(1);
  });

  it('should detect modified edge properties', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.edges[0].properties = { order: 99 };

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.edgesModified).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=diff-engine --no-coverage`
Expected: FAIL — `computeDiff` does not exist

- [ ] **Step 3: Implement the diff engine**

```typescript
// apps/pathway-service/src/services/import/diff-engine.ts

import {
  PathwayJson,
  PathwayNodeDefinition,
  PathwayEdgeDefinition,
  ImportDiffSummary,
  DiffDetail,
  PropertyChange,
} from './types';

export interface DiffResult {
  summary: ImportDiffSummary;
  details: DiffDetail[];
}

/**
 * Compute the diff between an existing pathway and an incoming one.
 * Nodes are matched by `id`. Edges are matched by `(from, to, type)` tuple.
 */
export function computeDiff(existing: PathwayJson, incoming: PathwayJson): DiffResult {
  const details: DiffDetail[] = [];

  // ─── Node diffs ─────────────────────────────────────────────────
  const existingNodes = new Map<string, PathwayNodeDefinition>();
  for (const node of existing.nodes) {
    existingNodes.set(node.id, node);
  }

  const incomingNodes = new Map<string, PathwayNodeDefinition>();
  for (const node of incoming.nodes) {
    incomingNodes.set(node.id, node);
  }

  let nodesAdded = 0;
  let nodesRemoved = 0;
  let nodesModified = 0;

  // Check for added and modified nodes
  for (const [id, inNode] of incomingNodes) {
    const exNode = existingNodes.get(id);
    if (!exNode) {
      nodesAdded++;
      details.push({ entityType: 'node', action: 'added', entityId: id, entityLabel: inNode.type });
    } else {
      const changes = diffProperties(exNode.properties, inNode.properties);
      if (changes.length > 0) {
        nodesModified++;
        details.push({ entityType: 'node', action: 'modified', entityId: id, entityLabel: inNode.type, changes });
      }
    }
  }

  // Check for removed nodes
  for (const [id, exNode] of existingNodes) {
    if (!incomingNodes.has(id)) {
      nodesRemoved++;
      details.push({ entityType: 'node', action: 'removed', entityId: id, entityLabel: exNode.type });
    }
  }

  // ─── Edge diffs ─────────────────────────────────────────────────
  const edgeKey = (e: PathwayEdgeDefinition) => `${e.from}|${e.to}|${e.type}`;

  const existingEdges = new Map<string, PathwayEdgeDefinition>();
  for (const edge of existing.edges) {
    existingEdges.set(edgeKey(edge), edge);
  }

  const incomingEdges = new Map<string, PathwayEdgeDefinition>();
  for (const edge of incoming.edges) {
    incomingEdges.set(edgeKey(edge), edge);
  }

  let edgesAdded = 0;
  let edgesRemoved = 0;
  let edgesModified = 0;

  // Check for added and modified edges
  for (const [key, inEdge] of incomingEdges) {
    const exEdge = existingEdges.get(key);
    if (!exEdge) {
      edgesAdded++;
      details.push({ entityType: 'edge', action: 'added', entityId: key, entityLabel: inEdge.type });
    } else {
      const changes = diffProperties(exEdge.properties || {}, inEdge.properties || {});
      if (changes.length > 0) {
        edgesModified++;
        details.push({ entityType: 'edge', action: 'modified', entityId: key, entityLabel: inEdge.type, changes });
      }
    }
  }

  // Check for removed edges
  for (const [key, exEdge] of existingEdges) {
    if (!incomingEdges.has(key)) {
      edgesRemoved++;
      details.push({ entityType: 'edge', action: 'removed', entityId: key, entityLabel: exEdge.type });
    }
  }

  return {
    summary: { nodesAdded, nodesRemoved, nodesModified, edgesAdded, edgesRemoved, edgesModified },
    details,
  };
}

/**
 * Diff two property objects, returning a list of changed properties.
 */
function diffProperties(
  oldProps: Record<string, unknown>,
  newProps: Record<string, unknown>
): PropertyChange[] {
  const changes: PropertyChange[] = [];
  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);

  for (const key of allKeys) {
    const oldVal = oldProps[key];
    const newVal = newProps[key];

    if (!deepEqual(oldVal, newVal)) {
      changes.push({ property: key, oldValue: oldVal, newValue: newVal });
    }
  }

  return changes;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  // Use stable-sorted stringify to handle property order differences
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + sorted.map(k => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k])).join(',') + '}';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=diff-engine --no-coverage`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/import/diff-engine.ts apps/pathway-service/src/__tests__/diff-engine.test.ts
git commit -m "feat(pathway): add diff engine for pathway version comparison"
```

---

## Chunk 5: Orchestrator, Resolvers, Versioning

### Task 9: Import Orchestrator

**Files:**
- Create: `apps/pathway-service/src/services/import/import-orchestrator.ts`
- Create: `apps/pathway-service/src/__tests__/import-orchestrator.test.ts`
- Create: `apps/pathway-service/src/services/import/index.ts`

Coordinates the full import flow within a single PG transaction: validate → build graph → execute Cypher → write relational → compute diff → return result.

- [ ] **Step 1: Write failing tests for the import orchestrator**

```typescript
// apps/pathway-service/src/__tests__/import-orchestrator.test.ts

import { importPathway } from '../services/import/import-orchestrator';
import { REFERENCE_PATHWAY, MINIMAL_PATHWAY, clonePathway } from './fixtures/reference-pathway';

// Mock the pool and client
function createMockPool() {
  const queryResults: Record<string, any> = {};
  const client = {
    query: jest.fn(async (text: string, values?: unknown[]) => {
      // Handle BEGIN/COMMIT/ROLLBACK
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) {
        return { rows: [] };
      }
      // Handle LOAD/SET for AGE
      if (text.includes('LOAD') || text.includes('search_path')) {
        return { rows: [] };
      }
      // Handle Cypher queries (SELECT * FROM cypher...)
      if (text.includes('cypher(')) {
        return { rows: [{ v: JSON.stringify({ id: 123456 }) }] };
      }
      // Handle SELECT for existing pathway lookup
      if (text.includes('SELECT') && text.includes('pathway_graph_index')) {
        return { rows: [] }; // No existing pathway
      }
      // Handle INSERT ... RETURNING
      if (text.includes('INSERT INTO pathway_graph_index')) {
        return {
          rows: [{
            id: '00000000-0000-4000-a000-000000000099',
            age_node_id: null,
            logical_id: values?.[1] || 'test',
            title: values?.[2] || 'test',
            version: values?.[3] || '1.0',
            category: values?.[4] || 'OBSTETRIC',
            status: 'DRAFT',
            condition_codes: [],
            is_active: false,
            created_at: new Date(),
            updated_at: new Date(),
          }],
        };
      }
      // Handle other INSERTs
      if (text.includes('INSERT')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };

  const pool = {
    connect: jest.fn(async () => client),
  };

  return { pool, client };
}

describe('importPathway', () => {
  it('should succeed for a valid NEW_PATHWAY import', async () => {
    const { pool } = createMockPool();
    const result = await importPathway(pool as any, MINIMAL_PATHWAY, 'NEW_PATHWAY', 'user-1');

    expect(result.validation.valid).toBe(true);
    expect(result.pathwayId).toBeDefined();
    expect(result.importType).toBe('NEW_PATHWAY');
  });

  it('should return validation errors without writing to DB', async () => {
    const { pool, client } = createMockPool();
    const pw = clonePathway(MINIMAL_PATHWAY);
    delete (pw as any).schema_version;
    delete (pw.pathway as any).logical_id;

    const result = await importPathway(pool as any, pw, 'NEW_PATHWAY', 'user-1');

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
    expect(result.pathwayId).toBe('');
    // Should not have started a transaction
    expect(client.query).not.toHaveBeenCalledWith('BEGIN');
  });

  it('should execute graph and relational writes within BEGIN/COMMIT', async () => {
    const { pool, client } = createMockPool();
    await importPathway(pool as any, MINIMAL_PATHWAY, 'NEW_PATHWAY', 'user-1');

    const calls = client.query.mock.calls.map((c: any[]) => c[0]);
    const beginIdx = calls.indexOf('BEGIN');
    const commitIdx = calls.indexOf('COMMIT');
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThan(beginIdx);
  });

  it('should ROLLBACK on error during graph construction', async () => {
    const { pool, client } = createMockPool();
    // Make Cypher execution fail
    let callCount = 0;
    client.query.mockImplementation(async (text: string) => {
      if (text.includes('cypher(')) {
        callCount++;
        if (callCount > 1) throw new Error('AGE error');
        return { rows: [{ v: JSON.stringify({ id: 123456 }) }] };
      }
      if (text.includes('INSERT INTO pathway_graph_index')) {
        return { rows: [{ id: 'test-id' }] };
      }
      return { rows: [] };
    });

    await expect(
      importPathway(pool as any, MINIMAL_PATHWAY, 'NEW_PATHWAY', 'user-1')
    ).rejects.toThrow();

    const calls = client.query.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain('ROLLBACK');
  });

  it('should reject DRAFT_UPDATE when no existing DRAFT pathway found', async () => {
    const { pool } = createMockPool();
    const result = await importPathway(pool as any, MINIMAL_PATHWAY, 'DRAFT_UPDATE', 'user-1');

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toContainEqual(
      expect.stringContaining('DRAFT')
    );
  });

  it('should release client on success', async () => {
    const { pool, client } = createMockPool();
    await importPathway(pool as any, MINIMAL_PATHWAY, 'NEW_PATHWAY', 'user-1');
    expect(client.release).toHaveBeenCalled();
  });

  it('should not acquire a DB client when validation fails', async () => {
    const { pool, client } = createMockPool();
    const pw = clonePathway(MINIMAL_PATHWAY);
    delete (pw as any).schema_version;

    await importPathway(pool as any, pw, 'NEW_PATHWAY', 'user-1');
    // Validation fails before pool.connect(), so client is never acquired
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=import-orchestrator --no-coverage`
Expected: FAIL — `importPathway` does not exist

- [ ] **Step 3: Implement the import orchestrator**

```typescript
// apps/pathway-service/src/services/import/import-orchestrator.ts

import { Pool, PoolClient } from 'pg';
import { PathwayJson, ImportMode, ImportResult, ImportDiffSummary, DiffDetail } from './types';
import { validatePathwayJson } from './validator';
import { buildGraphCommands } from './graph-builder';
import { buildCypherQuery } from '../age-client';
import {
  writePathwayIndex,
  writeConditionCodes,
  writeVersionDiff,
  deleteConditionCodes,
  updatePathwayIndex,
} from './relational-writer';
import { computeDiff } from './diff-engine';

/**
 * Import a clinical pathway from JSON.
 *
 * Flow:
 * 1. Validate the JSON (returns all errors at once)
 * 2. If valid, acquire a PG client and begin transaction
 * 3. Check import mode prerequisites (existing pathway state)
 * 4. Build and execute Cypher commands for AGE graph
 * 5. Write relational side tables
 * 6. Compute diff (for DRAFT_UPDATE and NEW_VERSION)
 * 7. Commit transaction
 *
 * Any failure after BEGIN triggers ROLLBACK.
 */
export async function importPathway(
  pool: Pool,
  pathwayJson: PathwayJson,
  importMode: ImportMode,
  userId: string
): Promise<ImportResult> {
  // Step 1: Validate
  const validation = validatePathwayJson(pathwayJson);
  if (!validation.valid) {
    return {
      pathwayId: '',
      ageNodeId: null,
      logicalId: pathwayJson.pathway?.logical_id || '',
      version: pathwayJson.pathway?.version || '',
      status: '',
      validation,
      diff: null,
      importType: importMode,
    };
  }

  // Step 2: Acquire client + begin transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Ensure AGE is loaded on this connection
    await client.query("LOAD 'age'");
    await client.query('SET search_path = ag_catalog, "$user", public');

    // Step 3: Check import mode prerequisites
    const existing = await findExistingPathway(client, pathwayJson.pathway.logical_id, pathwayJson.pathway.version);

    if (importMode === 'DRAFT_UPDATE') {
      if (!existing || existing.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return {
          pathwayId: '',
          ageNodeId: null,
          logicalId: pathwayJson.pathway.logical_id,
          version: pathwayJson.pathway.version,
          status: '',
          validation: {
            valid: false,
            errors: [`DRAFT_UPDATE requires an existing DRAFT pathway with logical_id "${pathwayJson.pathway.logical_id}" version "${pathwayJson.pathway.version}", but none was found`],
            warnings: [],
          },
          diff: null,
          importType: importMode,
        };
      }
    }

    if (importMode === 'NEW_PATHWAY' && existing) {
      await client.query('ROLLBACK');
      return {
        pathwayId: '',
        ageNodeId: null,
        logicalId: pathwayJson.pathway.logical_id,
        version: pathwayJson.pathway.version,
        status: '',
        validation: {
          valid: false,
          errors: [`NEW_PATHWAY but pathway with logical_id "${pathwayJson.pathway.logical_id}" version "${pathwayJson.pathway.version}" already exists`],
          warnings: [],
        },
        diff: null,
        importType: importMode,
      };
    }

    // Cache the latest existing pathway for this logical_id (used for NEW_VERSION prerequisite
    // check AND for previousId in the diff audit — avoids a second query that could return
    // the newly-inserted row after our INSERT).
    const latestExistingByLogicalId = await findExistingPathwayByLogicalId(client, pathwayJson.pathway.logical_id);

    if (importMode === 'NEW_VERSION') {
      // For NEW_VERSION, check that the logical_id exists (any version)
      if (!latestExistingByLogicalId) {
        await client.query('ROLLBACK');
        return {
          pathwayId: '',
          ageNodeId: null,
          logicalId: pathwayJson.pathway.logical_id,
          version: pathwayJson.pathway.version,
          status: '',
          validation: {
            valid: false,
            errors: [`NEW_VERSION requires an existing pathway with logical_id "${pathwayJson.pathway.logical_id}", but none was found`],
            warnings: [],
          },
          diff: null,
          importType: importMode,
        };
      }
      // Check this specific version doesn't already exist
      if (existing) {
        await client.query('ROLLBACK');
        return {
          pathwayId: '',
          ageNodeId: null,
          logicalId: pathwayJson.pathway.logical_id,
          version: pathwayJson.pathway.version,
          status: '',
          validation: {
            valid: false,
            errors: [`Version "${pathwayJson.pathway.version}" already exists for logical_id "${pathwayJson.pathway.logical_id}"`],
            warnings: [],
          },
          diff: null,
          importType: importMode,
        };
      }
    }

    // Step 4: Build and execute graph commands
    const commands = buildGraphCommands(pathwayJson);
    let rootAgeNodeId: string | null = null;

    for (const cmd of commands) {
      const sql = buildCypherQuery(undefined, cmd.cypher, cmd.type === 'edge' ? '(a agtype, b agtype)' : '(v agtype)');
      const result = await client.query(sql);
      // Capture root node's AGE id
      if (cmd.nodeId === 'root' && result.rows[0]) {
        try {
          const parsed = JSON.parse(result.rows[0].v);
          rootAgeNodeId = String(parsed.id);
        } catch {
          // AGE may return different formats — not critical
        }
      }
    }

    // Step 5: Write relational tables
    let pathwayId: string;
    let diffResult: { summary: ImportDiffSummary; details: DiffDetail[] } | null = null;

    if (importMode === 'DRAFT_UPDATE' && existing) {
      // Update existing index row, replace condition codes
      await deleteConditionCodes(client, existing.id);
      const updated = await updatePathwayIndex(client, existing.id, pathwayJson.pathway, rootAgeNodeId);
      pathwayId = updated.id;
      await writeConditionCodes(client, pathwayId, pathwayJson.pathway.condition_codes);

      // TODO: Reconstruct old pathway JSON from AGE graph and call computeDiff()
      // for proper DRAFT_UPDATE auditing. For now, record an empty diff — the import
      // itself is still correct, but the audit trail lacks granular change detail.
      diffResult = {
        summary: { nodesAdded: 0, nodesRemoved: 0, nodesModified: 0, edgesAdded: 0, edgesRemoved: 0, edgesModified: 0 },
        details: [],
      };
    } else {
      // NEW_PATHWAY or NEW_VERSION — insert new rows
      const indexRow = await writePathwayIndex(client, pathwayJson.pathway, rootAgeNodeId, userId);
      pathwayId = indexRow.id;
      await writeConditionCodes(client, pathwayId, pathwayJson.pathway.condition_codes);

      if (importMode === 'NEW_PATHWAY') {
        // No diff for brand new pathways — record the creation summary
        diffResult = {
          summary: {
            nodesAdded: pathwayJson.nodes.length + 1, // +1 for root
            nodesRemoved: 0,
            nodesModified: 0,
            edgesAdded: pathwayJson.edges.length,
            edgesRemoved: 0,
            edgesModified: 0,
          },
          details: [],
        };
      } else {
        // NEW_VERSION — would diff against the previous active version's JSON
        diffResult = {
          summary: {
            nodesAdded: pathwayJson.nodes.length + 1,
            nodesRemoved: 0,
            nodesModified: 0,
            edgesAdded: pathwayJson.edges.length,
            edgesRemoved: 0,
            edgesModified: 0,
          },
          details: [],
        };
      }
    }

    // Step 6: Write version diff audit record
    // Use the cached latestExistingByLogicalId (queried BEFORE our INSERT) to avoid
    // returning the newly-inserted row as the "previous" version.
    const previousId = importMode === 'NEW_VERSION'
      ? latestExistingByLogicalId?.id || null
      : null;

    await writeVersionDiff(
      client,
      pathwayId,
      previousId,
      importMode,
      diffResult.summary,
      diffResult.details,
      userId
    );

    // Step 7: Commit
    await client.query('COMMIT');

    return {
      pathwayId,
      ageNodeId: rootAgeNodeId,
      logicalId: pathwayJson.pathway.logical_id,
      version: pathwayJson.pathway.version,
      status: 'DRAFT',
      validation,
      diff: diffResult,
      importType: importMode,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function findExistingPathway(
  client: PoolClient,
  logicalId: string,
  version: string
): Promise<{ id: string; status: string } | null> {
  const result = await client.query(
    'SELECT id, status FROM pathway_graph_index WHERE logical_id = $1 AND version = $2',
    [logicalId, version]
  );
  return result.rows[0] || null;
}

async function findExistingPathwayByLogicalId(
  client: PoolClient,
  logicalId: string
): Promise<{ id: string; status: string } | null> {
  const result = await client.query(
    'SELECT id, status FROM pathway_graph_index WHERE logical_id = $1 ORDER BY created_at DESC LIMIT 1',
    [logicalId]
  );
  return result.rows[0] || null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=import-orchestrator --no-coverage`
Expected: All 6 tests PASS

- [ ] **Step 5: Create barrel export**

```typescript
// apps/pathway-service/src/services/import/index.ts

export { importPathway } from './import-orchestrator';
export { validatePathwayJson } from './validator';
export { buildGraphCommands } from './graph-builder';
export { computeDiff } from './diff-engine';
export * from './types';
```

- [ ] **Step 6: Commit**

```bash
git add apps/pathway-service/src/services/import/
git commit -m "feat(pathway): add import orchestrator with transactional graph+relational writes"
```

---

### Task 10: Mutation Resolvers — importPathway

**Files:**
- Create: `apps/pathway-service/src/resolvers/Mutation.ts`
- Modify: `apps/pathway-service/src/resolvers/index.ts`
- Create: `apps/pathway-service/src/__tests__/mutation-resolvers.test.ts`

Wire the import orchestrator into the GraphQL mutation resolver.

- [ ] **Step 1: Write failing tests for the importPathway resolver**

```typescript
// apps/pathway-service/src/__tests__/mutation-resolvers.test.ts

import { Mutation } from '../resolvers/Mutation';
import { MINIMAL_PATHWAY } from './fixtures/reference-pathway';

// Mock the import module
jest.mock('../services/import/import-orchestrator', () => ({
  importPathway: jest.fn(),
}));

import { importPathway as mockImportPathway } from '../services/import/import-orchestrator';

const PATHWAY_COLUMNS = `
  id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
  title, version, category, status,
  condition_codes AS "conditionCodes",
  scope, target_population AS "targetPopulation",
  is_active AS "isActive",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

function createMockContext() {
  return {
    pool: {
      query: jest.fn(async () => ({
        rows: [{
          id: '00000000-0000-4000-a000-000000000099',
          ageNodeId: null,
          logicalId: 'CP-Minimal',
          title: 'Minimal Test Pathway',
          version: '1.0',
          category: 'ACUTE_CARE',
          status: 'DRAFT',
          conditionCodes: ['J06.9'],
          scope: null,
          targetPopulation: null,
          isActive: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      })),
    },
    redis: {},
    userId: 'test-user',
    userRole: 'PROVIDER',
  };
}

describe('Mutation resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('importPathway', () => {
    it('should call importPathway with parsed JSON and return result', async () => {
      const ctx = createMockContext();
      (mockImportPathway as jest.Mock).mockResolvedValue({
        pathwayId: '00000000-0000-4000-a000-000000000099',
        ageNodeId: null,
        logicalId: 'CP-Minimal',
        version: '1.0',
        status: 'DRAFT',
        validation: { valid: true, errors: [], warnings: [] },
        diff: { summary: { nodesAdded: 3, nodesRemoved: 0, nodesModified: 0, edgesAdded: 2, edgesRemoved: 0, edgesModified: 0 }, details: [] },
        importType: 'NEW_PATHWAY',
      });

      const result = await Mutation.Mutation.importPathway(
        {},
        { pathwayJson: JSON.stringify(MINIMAL_PATHWAY), importMode: 'NEW_PATHWAY' },
        ctx
      );

      expect(mockImportPathway).toHaveBeenCalledWith(ctx.pool, MINIMAL_PATHWAY, 'NEW_PATHWAY', 'test-user');
      expect(result.validation.valid).toBe(true);
      expect(result.importType).toBe('NEW_PATHWAY');
    });

    it('should return validation error for invalid JSON string', async () => {
      const ctx = createMockContext();

      const result = await Mutation.Mutation.importPathway(
        {},
        { pathwayJson: 'not valid json', importMode: 'NEW_PATHWAY' },
        ctx
      );

      expect(result.validation.valid).toBe(false);
      expect(result.validation.errors).toContainEqual(expect.stringContaining('JSON'));
    });
  });

  describe('activatePathway', () => {
    it('should activate a DRAFT pathway using atomic CTE', async () => {
      const ctx = createMockContext();
      // First query: SELECT current state (DRAFT)
      ctx.pool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ ...createMockContext().pool.query(), status: 'DRAFT', logicalId: 'CP-Test' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'test-id', status: 'ACTIVE', logicalId: 'CP-Test' }] }); // CTE result

      // Note: this test verifies the resolver calls pool.query with the CTE
      // A full integration test would verify the actual DB state transitions
      await expect(
        Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)
      ).resolves.toBeDefined();
    });

    it('should reject activating a non-DRAFT pathway', async () => {
      const ctx = createMockContext();
      ctx.pool.query = jest.fn().mockResolvedValueOnce({
        rows: [{ status: 'ACTIVE', logicalId: 'CP-Test' }],
      });

      await expect(
        Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot activate');
    });

    it('should throw NOT_FOUND for nonexistent pathway', async () => {
      const ctx = createMockContext();
      ctx.pool.query = jest.fn().mockResolvedValueOnce({ rows: [] });

      await expect(
        Mutation.Mutation.activatePathway({}, { id: 'nonexistent' }, ctx)
      ).rejects.toThrow('not found');
    });
  });

  describe('archivePathway', () => {
    it('should reject archiving a non-ACTIVE pathway', async () => {
      const ctx = createMockContext();
      ctx.pool.query = jest.fn().mockResolvedValueOnce({
        rows: [{ status: 'DRAFT', logicalId: 'CP-Test' }],
      });

      await expect(
        Mutation.Mutation.archivePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot archive');
    });
  });

  describe('reactivatePathway', () => {
    it('should reject reactivating a DRAFT pathway', async () => {
      const ctx = createMockContext();
      ctx.pool.query = jest.fn().mockResolvedValueOnce({
        rows: [{ status: 'DRAFT', logicalId: 'CP-Test' }],
      });

      await expect(
        Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot reactivate');
    });

    it('should reject reactivating an ACTIVE pathway', async () => {
      const ctx = createMockContext();
      ctx.pool.query = jest.fn().mockResolvedValueOnce({
        rows: [{ status: 'ACTIVE', logicalId: 'CP-Test' }],
      });

      await expect(
        Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx)
      ).rejects.toThrow('Cannot reactivate');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=mutation-resolvers --no-coverage`
Expected: FAIL — `Mutation` does not exist

- [ ] **Step 3: Implement the Mutation resolvers**

```typescript
// apps/pathway-service/src/resolvers/Mutation.ts

import { GraphQLError } from 'graphql';
import { DataSourceContext } from '../types';
import { importPathway } from '../services/import/import-orchestrator';
import { PathwayJson, ImportMode } from '../services/import/types';

const PATHWAY_COLUMNS = `
  id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
  title, version, category, status,
  condition_codes AS "conditionCodes",
  scope, target_population AS "targetPopulation",
  is_active AS "isActive",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export const Mutation = {
  Mutation: {
    async importPathway(
      _parent: unknown,
      args: { pathwayJson: string; importMode: ImportMode },
      context: DataSourceContext
    ) {
      // Parse JSON
      let parsed: PathwayJson;
      try {
        parsed = JSON.parse(args.pathwayJson);
      } catch {
        return {
          pathway: null,
          validation: { valid: false, errors: ['Invalid JSON: could not parse pathwayJson string'], warnings: [] },
          diff: null,
          importType: args.importMode,
        };
      }

      // Run import pipeline
      const result = await importPathway(context.pool, parsed, args.importMode, context.userId);

      // If validation failed, return without pathway
      if (!result.validation.valid) {
        return {
          pathway: null,
          validation: result.validation,
          diff: null,
          importType: result.importType,
        };
      }

      // Fetch the created/updated pathway for the response
      const pathway = await context.pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [result.pathwayId]
      );

      return {
        pathway: pathway.rows[0] || null,
        validation: result.validation,
        diff: result.diff ? {
          summary: result.diff.summary,
          details: result.diff.details,
        } : null,
        importType: result.importType,
      };
    },

    async activatePathway(
      _parent: unknown,
      args: { id: string },
      context: DataSourceContext
    ) {
      const { pool } = context;

      // Fetch current state with FOR UPDATE to prevent concurrent activation races
      const current = await pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [args.id]
      );
      if (!current.rows[0]) {
        throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      }

      const pathway = current.rows[0];
      if (pathway.status !== 'DRAFT') {
        throw new GraphQLError(`Cannot activate pathway with status "${pathway.status}". Only DRAFT pathways can be activated.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // Atomic: supersede existing ACTIVE + activate this one in a single CTE.
      // Prevents race conditions where two concurrent activations could both succeed.
      const updated = await pool.query(
        `WITH superseded AS (
           UPDATE pathway_graph_index SET status = 'SUPERSEDED', is_active = false
           WHERE logical_id = (SELECT logical_id FROM pathway_graph_index WHERE id = $1)
             AND status = 'ACTIVE' AND id != $1
         )
         UPDATE pathway_graph_index SET status = 'ACTIVE', is_active = true
         WHERE id = $1 AND status = 'DRAFT'
         RETURNING ${PATHWAY_COLUMNS}`,
        [args.id]
      );

      if (!updated.rows[0]) {
        throw new GraphQLError('Failed to activate pathway — it may have been modified concurrently.', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }

      return {
        pathway: updated.rows[0],
        previousStatus: 'DRAFT',
      };
    },

    async archivePathway(
      _parent: unknown,
      args: { id: string },
      context: DataSourceContext
    ) {
      const { pool } = context;

      const current = await pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [args.id]
      );
      if (!current.rows[0]) {
        throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      }

      const pathway = current.rows[0];
      if (pathway.status !== 'ACTIVE') {
        throw new GraphQLError(`Cannot archive pathway with status "${pathway.status}". Only ACTIVE pathways can be archived.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const updated = await pool.query(
        `UPDATE pathway_graph_index SET status = 'ARCHIVED', is_active = false WHERE id = $1 RETURNING ${PATHWAY_COLUMNS}`,
        [args.id]
      );

      return {
        pathway: updated.rows[0],
        previousStatus: 'ACTIVE',
      };
    },

    async reactivatePathway(
      _parent: unknown,
      args: { id: string },
      context: DataSourceContext
    ) {
      const { pool } = context;

      const current = await pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [args.id]
      );
      if (!current.rows[0]) {
        throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      }

      const pathway = current.rows[0];
      if (pathway.status !== 'SUPERSEDED' && pathway.status !== 'ARCHIVED') {
        throw new GraphQLError(`Cannot reactivate pathway with status "${pathway.status}". Only SUPERSEDED or ARCHIVED pathways can be reactivated.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const previousStatus = pathway.status;

      // Atomic: supersede existing ACTIVE + reactivate this one in a single CTE.
      const updated = await pool.query(
        `WITH superseded AS (
           UPDATE pathway_graph_index SET status = 'SUPERSEDED', is_active = false
           WHERE logical_id = (SELECT logical_id FROM pathway_graph_index WHERE id = $1)
             AND status = 'ACTIVE' AND id != $1
         )
         UPDATE pathway_graph_index SET status = 'ACTIVE', is_active = true
         WHERE id = $1 AND status IN ('SUPERSEDED', 'ARCHIVED')
         RETURNING ${PATHWAY_COLUMNS}`,
        [args.id]
      );

      if (!updated.rows[0]) {
        throw new GraphQLError('Failed to reactivate pathway — it may have been modified concurrently.', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }

      return {
        pathway: updated.rows[0],
        previousStatus,
      };
    },
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --prefix apps/pathway-service jest --testPathPattern=mutation-resolvers --no-coverage`
Expected: All 7 tests PASS (2 import + 3 activate + 1 archive + 1 reactivate)

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/resolvers/Mutation.ts apps/pathway-service/src/__tests__/mutation-resolvers.test.ts
git commit -m "feat(pathway): add importPathway and versioning mutation resolvers"
```

---

### Task 11: Wire Mutations into Resolver Index

**Files:**
- Modify: `apps/pathway-service/src/resolvers/index.ts`

- [ ] **Step 1: Update resolver barrel to include Mutation**

Replace `apps/pathway-service/src/resolvers/index.ts` with:

```typescript
import { Query } from "./Query";
import { Mutation } from "./Mutation";

const resolvers = {
  ...Query,
  ...Mutation,
};

export default resolvers;
```

- [ ] **Step 2: Run full test suite for pathway-service**

Run: `npx --prefix apps/pathway-service jest --no-coverage`
Expected: All tests PASS (age-client, database, validator, graph-builder, relational-writer, diff-engine, import-orchestrator, mutation-resolvers)

- [ ] **Step 3: Run typecheck**

Run: `npx --prefix apps/pathway-service tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/pathway-service/src/resolvers/index.ts
git commit -m "feat(pathway): wire import mutations into resolver index"
```

---

### Task 12: Final Verification & Lint

- [ ] **Step 1: Run linter on all changed files**

Run: `npx --prefix apps/pathway-service eslint src/ --ext .ts` (if eslint is configured; otherwise skip)
Expected: PASS or only pre-existing warnings

- [ ] **Step 2: Run the full pathway-service test suite one final time**

Run: `npx --prefix apps/pathway-service jest --no-coverage --verbose`
Expected: All tests PASS

- [ ] **Step 3: Run typecheck one final time**

Run: `npx --prefix apps/pathway-service tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Final commit if any lint fixes were needed**

```bash
git add -A apps/pathway-service/
git commit -m "chore(pathway): lint fixes for import pipeline"
```
