# Pathway Graph — Plan 4: Resolution Engine

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pathway resolution engine that traverses clinical pathway graphs against patient context, lets providers interact with the result, and generates draft care plans.

**Architecture:** A confidence-gated BFS traversal engine walks the pathway graph and produces a recommendation subgraph. Gate nodes conditionally prune subtrees. Providers refine results via three interaction mutations (override, answer gate question, add context), each triggering scoped re-traversal. Resolved pathways transform into draft care plans for the existing careplan-service.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2.10, PostgreSQL 15, Apache AGE 1.5.0, Jest

**Spec:** `docs/superpowers/specs/2026-03-25-pathway-resolution-design.md`

**Depends on:** Plan 1 (Infrastructure, PR #26), Plan 2 (Import Pipeline, PR #27), Plan 3 (Confidence Framework, PR #29)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `shared/data-layer/migrations/042_extend_resolution_sessions.sql` | Extend session table, add events table |
| `shared/data-layer/migrations/043_create_resolution_analytics.sql` | Node overrides + gate answers tables |
| `apps/pathway-service/src/services/resolution/types.ts` | All resolution engine interfaces, enums, constants |
| `apps/pathway-service/src/services/resolution/gate-evaluator.ts` | Gate condition evaluation (4 gate types + compound) |
| `apps/pathway-service/src/services/resolution/traversal-engine.ts` | Confidence-gated BFS with lazy eval + dependency tracking |
| `apps/pathway-service/src/services/resolution/retraversal-engine.ts` | Scoped re-traversal for provider interactions |
| `apps/pathway-service/src/services/resolution/safety.ts` | Cycle detection, timeout, red flags, cascade limits |
| `apps/pathway-service/src/services/resolution/care-plan-generator.ts` | Node-to-entity mapping, validation, care plan creation |
| `apps/pathway-service/src/services/resolution/session-store.ts` | Session CRUD + event logging + analytics writes |
| `apps/pathway-service/src/services/resolution/index.ts` | Barrel export |
| `apps/pathway-service/src/__tests__/fixtures/reference-pathway-with-gates.ts` | Extended pathway fixture with Gate nodes |
| `apps/pathway-service/src/__tests__/gate-evaluator.test.ts` | Gate evaluation unit tests |
| `apps/pathway-service/src/__tests__/traversal-engine.test.ts` | BFS traversal unit tests |
| `apps/pathway-service/src/__tests__/retraversal-engine.test.ts` | Scoped re-traversal unit tests |
| `apps/pathway-service/src/__tests__/safety.test.ts` | Safety constraint unit tests |
| `apps/pathway-service/src/__tests__/care-plan-generator.test.ts` | Care plan generation unit tests |
| `apps/pathway-service/src/__tests__/session-store.test.ts` | Session persistence unit tests |
| `apps/pathway-service/src/__tests__/resolution-resolvers.test.ts` | GraphQL resolver unit tests |

### Modified files

| File | Change |
|------|--------|
| `apps/pathway-service/src/types/index.ts` | Add NodeStatus, SessionStatus, OverrideAction, AnswerType, BlockerType enums |
| `apps/pathway-service/src/services/import/types.ts` | Add Gate to PathwayNodeType, HAS_GATE to PathwayEdgeType, Gate to REQUIRED_NODE_PROPERTIES, HAS_GATE to VALID_EDGE_ENDPOINTS |
| `apps/pathway-service/src/services/import/validator.ts` | Add Gate-specific validation rules |
| `apps/pathway-service/src/services/import/graph-builder.ts` | Handle Gate node type in Cypher generation |
| `apps/pathway-service/schema.graphql` | Add all resolution types, inputs, enums, queries, mutations |
| `apps/pathway-service/src/resolvers/Query.ts` | Add matchedPathways, resolutionSession, pendingQuestions, redFlags, patientResolutionSessions |
| `apps/pathway-service/src/resolvers/Mutation.ts` | Add startResolution, overrideNode, answerGateQuestion, addPatientContext, generateCarePlanFromResolution, abandonSession |

---

## Chunk 1: Migrations and Core Types

### Task 1: Migration 042 — Extend Resolution Sessions + Events Table

**Files:**
- Create: `shared/data-layer/migrations/042_extend_resolution_sessions.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- shared/data-layer/migrations/042_extend_resolution_sessions.sql
--
-- Extend pathway_resolution_sessions for the full resolution engine.
-- Migration 038 created the scaffold; this adds resolution state, events.

BEGIN;

-- 1. Rename columns for clarity (scaffold -> production naming)
ALTER TABLE pathway_resolution_sessions
  RENAME COLUMN patient_context TO initial_patient_context;

ALTER TABLE pathway_resolution_sessions
  RENAME COLUMN resulting_care_plan_id TO care_plan_id;

-- 2. Add resolution state columns
ALTER TABLE pathway_resolution_sessions
  ADD COLUMN resolution_state JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN dependency_map JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN additional_context JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN pending_questions JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN red_flags JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN total_nodes_evaluated INT NOT NULL DEFAULT 0,
  ADD COLUMN traversal_duration_ms INT;

-- 3. Snapshot pathway version at resolution time
ALTER TABLE pathway_resolution_sessions
  ADD COLUMN pathway_version VARCHAR(20);

-- 4. Update status enum: IN_PROGRESS -> ACTIVE, add DEGRADED
-- Safe for pre-production: no real sessions exist yet.
ALTER TABLE pathway_resolution_sessions
  DROP CONSTRAINT pathway_resolution_sessions_status_check;
UPDATE pathway_resolution_sessions SET status = 'ACTIVE' WHERE status = 'IN_PROGRESS';
ALTER TABLE pathway_resolution_sessions
  ADD CONSTRAINT pathway_resolution_sessions_status_check
  CHECK (status IN ('ACTIVE', 'COMPLETED', 'ABANDONED', 'DEGRADED'));

-- 5. Composite index for provider's active sessions
CREATE INDEX idx_resolution_sessions_patient_provider
  ON pathway_resolution_sessions(patient_id, provider_id, status);

-- 6. Resolution events: audit trail of every interaction
CREATE TABLE pathway_resolution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES pathway_resolution_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'traversal_complete', 'override', 'gate_answer',
      'context_update', 'care_plan_generated', 'abandoned'
    )),
  trigger_data JSONB NOT NULL,
  nodes_recomputed INT NOT NULL DEFAULT 0,
  status_changes JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resolution_events_session
  ON pathway_resolution_events(session_id, created_at);

COMMIT;
```

- [ ] **Step 2: Verify migration syntax**

Run: `cd /home/claude/workspace/prism-graphql && node -e "const fs = require('fs'); const sql = fs.readFileSync('shared/data-layer/migrations/042_extend_resolution_sessions.sql', 'utf8'); console.log('Lines:', sql.split('\n').length); console.log('Has BEGIN:', sql.includes('BEGIN')); console.log('Has COMMIT:', sql.includes('COMMIT'));"`
Expected: Lines count, both BEGIN and COMMIT present.

- [ ] **Step 3: Commit**

```bash
git add shared/data-layer/migrations/042_extend_resolution_sessions.sql
git commit -m "feat: migration 042 — extend resolution sessions for Plan 4"
```

### Task 2: Migration 043 — Resolution Analytics Tables

**Files:**
- Create: `shared/data-layer/migrations/043_create_resolution_analytics.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- shared/data-layer/migrations/043_create_resolution_analytics.sql
--
-- Relational analytics tables for cross-session queries.
-- Complement the JSONB resolution_state (fast reads) with relational
-- tables (fast aggregates: "how often do providers override node X?").
--
-- These are append-only (no updates). Immutable audit trail.

BEGIN;

-- Provider node overrides (queryable across sessions)
CREATE TABLE pathway_node_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES pathway_resolution_sessions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id),
  action TEXT NOT NULL CHECK (action IN ('include', 'exclude')),
  reason TEXT,
  original_status TEXT NOT NULL,
  original_confidence FLOAT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Override rate per node" queries
CREATE INDEX idx_node_overrides_pattern
  ON pathway_node_overrides(pathway_id, node_id, action);

CREATE INDEX idx_node_overrides_session
  ON pathway_node_overrides(session_id);

-- Gate question answers (queryable across sessions)
CREATE TABLE pathway_gate_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES pathway_resolution_sessions(id) ON DELETE CASCADE,
  gate_id TEXT NOT NULL,
  pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id),
  answer JSONB NOT NULL,
  gate_opened BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Answer distribution per gate" queries
CREATE INDEX idx_gate_answers_pattern
  ON pathway_gate_answers(pathway_id, gate_id, gate_opened);

CREATE INDEX idx_gate_answers_session
  ON pathway_gate_answers(session_id);

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
git add shared/data-layer/migrations/043_create_resolution_analytics.sql
git commit -m "feat: migration 043 — resolution analytics tables (overrides, gate answers)"
```

### Task 3: Core Resolution Types

**Files:**
- Create: `apps/pathway-service/src/services/resolution/types.ts`
- Modify: `apps/pathway-service/src/types/index.ts`

- [ ] **Step 1: Add new enums to types/index.ts**

Add after the existing `WeightSource` enum at the end of `apps/pathway-service/src/types/index.ts`:

```typescript
// ─── Resolution Engine Enums (Plan 4) ────────────────────────────────

// Replaces ResolutionSessionStatus (Plan 1 scaffold)
export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED',
  DEGRADED = 'DEGRADED',
}

export enum NodeStatus {
  INCLUDED = 'INCLUDED',
  EXCLUDED = 'EXCLUDED',
  GATED_OUT = 'GATED_OUT',
  PENDING_QUESTION = 'PENDING_QUESTION',
  TIMEOUT = 'TIMEOUT',
  CASCADE_LIMIT = 'CASCADE_LIMIT',
  UNKNOWN = 'UNKNOWN',
}

export enum OverrideAction {
  INCLUDE = 'INCLUDE',
  EXCLUDE = 'EXCLUDE',
}

export enum AnswerType {
  BOOLEAN = 'BOOLEAN',
  NUMERIC = 'NUMERIC',
  SELECT = 'SELECT',
}

export enum BlockerType {
  EMPTY_PLAN = 'EMPTY_PLAN',
  UNRESOLVED_RED_FLAG = 'UNRESOLVED_RED_FLAG',
  CONTRADICTION = 'CONTRADICTION',
  PENDING_GATE = 'PENDING_GATE',
}

export enum GateType {
  PATIENT_ATTRIBUTE = 'patient_attribute',
  QUESTION = 'question',
  PRIOR_NODE_RESULT = 'prior_node_result',
  COMPOUND = 'compound',
}

export enum DefaultBehavior {
  SKIP = 'skip',
  TRAVERSE = 'traverse',
}
```

- [ ] **Step 2: Create resolution types file**

Create `apps/pathway-service/src/services/resolution/types.ts`:

```typescript
import {
  NodeStatus,
  SessionStatus,
  OverrideAction,
  AnswerType,
  BlockerType,
  GateType,
  DefaultBehavior,
} from '../../types';
import {
  GraphNode,
  GraphEdge,
  GraphContext,
  PatientContext,
  SignalBreakdown,
  ResolvedThresholds,
  NodeConfidenceResult,
} from '../confidence/types';

export {
  NodeStatus,
  SessionStatus,
  OverrideAction,
  AnswerType,
  BlockerType,
  GateType,
  DefaultBehavior,
};

// ─── Node Result ────────────────────────────────────────────────────

export interface ProviderOverride {
  action: OverrideAction;
  reason?: string;
  originalStatus: NodeStatus;
  originalConfidence: number;
}

export interface NodeResult {
  nodeId: string;
  nodeType: string;
  title: string;
  status: NodeStatus;
  confidence: number;
  confidenceBreakdown: SignalBreakdown[];
  excludeReason?: string;
  providerOverride?: ProviderOverride;
  parentNodeId?: string;
  depth: number;
}

// ─── Resolution State ───────────────────────────────────────────────

export type ResolutionState = Map<string, NodeResult>;

export interface DependencyMap {
  influencedBy: Map<string, Set<string>>;
  influences: Map<string, Set<string>>;
  gateContextFields: Map<string, Set<string>>;
  scorerInputs: Map<string, Set<string>>;
}

export function createEmptyDependencyMap(): DependencyMap {
  return {
    influencedBy: new Map(),
    influences: new Map(),
    gateContextFields: new Map(),
    scorerInputs: new Map(),
  };
}

// ─── Gate Evaluation ────────────────────────────────────────────────

export interface GateCondition {
  field: string;
  operator: string;
  value: string;
  system?: string;
}

export interface GateDependsOn {
  node_id: string;
  status: string;
}

export interface GateProperties {
  title: string;
  gate_type: GateType;
  default_behavior: DefaultBehavior;
  condition?: GateCondition;
  prompt?: string;
  answer_type?: AnswerType;
  options?: string[];
  depends_on?: GateDependsOn[];
  operator?: 'AND' | 'OR';
  conditions?: GateCondition[];
}

export interface GateAnswer {
  booleanValue?: boolean;
  numericValue?: number;
  selectedOption?: string;
}

export interface GateEvaluationResult {
  satisfied: boolean;
  reason: string;
  contextFieldsRead: string[];
  dependedOnNodes: string[];
}

// ─── Pending Questions ──────────────────────────────────────────────

export interface PendingQuestion {
  gateId: string;
  prompt: string;
  answerType: AnswerType;
  options?: string[];
  affectedSubtreeSize: number;
  estimatedImpact: string;
}

// ─── Red Flags ──────────────────────────────────────────────────────

export interface RedFlagBranch {
  nodeId: string;
  title: string;
  confidence: number;
  topExcludeReason: string;
}

export type RedFlagType = 'all_branches_excluded' | 'contradiction' | 'missing_critical_data';

export interface RedFlag {
  nodeId: string;
  nodeTitle: string;
  type: RedFlagType;
  description: string;
  branches?: RedFlagBranch[];
}

// ─── Resolution Event ───────────────────────────────────────────────

export interface ResolutionEvent {
  id?: string;
  eventType: string;
  triggerData: Record<string, unknown>;
  nodesRecomputed: number;
  statusChanges: Array<{ nodeId: string; from: string; to: string }>;
  createdAt?: Date;
}

// ─── Session ────────────────────────────────────────────────────────

export interface ResolutionSession {
  id: string;
  pathwayId: string;
  pathwayVersion: string;
  patientId: string;
  providerId: string;
  status: SessionStatus;
  resolutionState: ResolutionState;
  dependencyMap: DependencyMap;
  initialPatientContext: PatientContext;
  additionalContext: Record<string, unknown>;
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  resolutionEvents: ResolutionEvent[];
  totalNodesEvaluated: number;
  traversalDurationMs: number;
  carePlanId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Traversal Result ───────────────────────────────────────────────

export interface TraversalResult {
  resolutionState: ResolutionState;
  dependencyMap: DependencyMap;
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  totalNodesEvaluated: number;
  traversalDurationMs: number;
  isDegraded: boolean;
}

// ─── Re-Traversal Result ────────────────────────────────────────────

export interface RetraversalResult {
  statusChanges: Array<{ nodeId: string; from: string; to: string }>;
  nodesRecomputed: number;
  newPendingQuestions: PendingQuestion[];
  newRedFlags: RedFlag[];
}

// ─── Care Plan Generation ───────────────────────────────────────────

export interface ValidationBlocker {
  type: BlockerType;
  description: string;
  relatedNodeIds: string[];
}

export interface CarePlanGenerationResult {
  success: boolean;
  carePlanId?: string;
  warnings: string[];
  blockers: ValidationBlocker[];
}

// ─── Matched Pathway ────────────────────────────────────────────────

export interface MatchedPathway {
  pathway: {
    id: string;
    logicalId: string;
    title: string;
    version: string;
    category: string;
    status: string;
    conditionCodes: string[];
  };
  matchedConditionCodes: string[];
  matchScore: number;
}

// ─── Constants ──────────────────────────────────────────────────────

export const TRAVERSAL_TIMEOUT_MS = 10_000;
export const RETRAVERSAL_TIMEOUT_MS = 5_000;
export const MAX_CASCADE_DEPTH = 10;

/** Node types that are structural (always traversed, confidence is aggregate) */
export const STRUCTURAL_NODE_TYPES = new Set(['Stage', 'Step']);

/** Node types that are action nodes (included/excluded based on confidence).
 *  Monitoring, Lifestyle, Referral are forward-looking — not yet in PathwayNodeType
 *  (import schema). They will be added when pathways use them. The traversal engine
 *  handles them already so no code change is needed when they appear. */
export const ACTION_NODE_TYPES = new Set([
  'Medication', 'LabTest', 'Procedure', 'Monitoring', 'Lifestyle', 'Referral',
]);
```

- [ ] **Step 3: Create barrel export**

Create `apps/pathway-service/src/services/resolution/index.ts`:

```typescript
export * from './types';
```

- [ ] **Step 4: Commit**

```bash
git add apps/pathway-service/src/types/index.ts \
        apps/pathway-service/src/services/resolution/types.ts \
        apps/pathway-service/src/services/resolution/index.ts
git commit -m "feat: resolution engine types and enums (Plan 4)"
```

---

## Chunk 2: Gate Node Support in Import Pipeline

### Task 4: Add Gate to Import Schema Types

**Files:**
- Modify: `apps/pathway-service/src/services/import/types.ts`

Read the current file first. The key changes:

- [ ] **Step 1: Add Gate to PathwayNodeType union**

In `apps/pathway-service/src/services/import/types.ts`, add `'Gate'` to the `PathwayNodeType` union after `'Schedule'`.

- [ ] **Step 2: Add HAS_GATE to PathwayEdgeType union**

Add `'HAS_GATE'` to the `PathwayEdgeType` union after `'HAS_CODE'`.

- [ ] **Step 3: Add Gate to REQUIRED_NODE_PROPERTIES**

Add to the `REQUIRED_NODE_PROPERTIES` object:

```typescript
Gate: ['title', 'gate_type', 'default_behavior'],
```

- [ ] **Step 4: Add HAS_GATE to VALID_EDGE_ENDPOINTS**

Add to the `VALID_EDGE_ENDPOINTS` object (read file to find exact structure):

```typescript
HAS_GATE: {
  from: ['Step', 'Stage', 'DecisionPoint'],
  to: ['Gate'],
},
```

Also update the `BRANCHES_TO` entry to include `Gate` as a valid source (Gates branch to their gated subtrees).

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/import/types.ts
git commit -m "feat: add Gate node type and HAS_GATE edge to import schema"
```

### Task 5: Gate Validation Rules

**Files:**
- Modify: `apps/pathway-service/src/services/import/validator.ts`
- Test: `apps/pathway-service/src/__tests__/validator.test.ts`

- [ ] **Step 1: Write failing tests for Gate validation**

Add to `apps/pathway-service/src/__tests__/validator.test.ts` in a new `describe('Gate node validation')` block:

```typescript
describe('Gate node validation', () => {
  it('should accept a valid Gate node with patient_attribute type', () => {
    const pathway = clonePathway();
    pathway.nodes.push({
      id: 'gate-test',
      type: 'Gate',
      properties: {
        title: 'Test gate',
        gate_type: 'patient_attribute',
        default_behavior: 'skip',
        condition: { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
      },
    });
    pathway.edges.push({ from: 'step-initial-assessment', to: 'gate-test', type: 'HAS_GATE' });
    pathway.edges.push({ from: 'gate-test', to: 'step-scar-eval', type: 'BRANCHES_TO' });
    const result = validatePathwayJson(pathway);
    expect(result.valid).toBe(true);
  });

  it('should reject Gate with no outbound edges', () => {
    const pathway = clonePathway();
    pathway.nodes.push({
      id: 'gate-orphan',
      type: 'Gate',
      properties: { title: 'Orphan', gate_type: 'question', default_behavior: 'skip', prompt: 'Test?', answer_type: 'boolean' },
    });
    pathway.edges.push({ from: 'step-initial-assessment', to: 'gate-orphan', type: 'HAS_GATE' });
    // No outbound edge from gate-orphan
    const result = validatePathwayJson(pathway);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('gate-orphan') && e.includes('outbound'))).toBe(true);
  });

  it('should reject Gate with depends_on referencing nonexistent node', () => {
    const pathway = clonePathway();
    pathway.nodes.push({
      id: 'gate-bad-ref',
      type: 'Gate',
      properties: {
        title: 'Bad ref', gate_type: 'prior_node_result', default_behavior: 'skip',
        depends_on: [{ node_id: 'does-not-exist', status: 'included' }],
      },
    });
    pathway.edges.push({ from: 'step-initial-assessment', to: 'gate-bad-ref', type: 'HAS_GATE' });
    pathway.edges.push({ from: 'gate-bad-ref', to: 'step-scar-eval', type: 'BRANCHES_TO' });
    const result = validatePathwayJson(pathway);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('does-not-exist'))).toBe(true);
  });

  it('should reject select Gate without options', () => {
    const pathway = clonePathway();
    pathway.nodes.push({
      id: 'gate-no-opts',
      type: 'Gate',
      properties: {
        title: 'No opts', gate_type: 'question', default_behavior: 'skip',
        prompt: 'Choose one', answer_type: 'select',
        // missing options
      },
    });
    pathway.edges.push({ from: 'step-initial-assessment', to: 'gate-no-opts', type: 'HAS_GATE' });
    pathway.edges.push({ from: 'gate-no-opts', to: 'step-scar-eval', type: 'BRANCHES_TO' });
    const result = validatePathwayJson(pathway);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('options'))).toBe(true);
  });

  it('should reject compound Gate with empty conditions', () => {
    const pathway = clonePathway();
    pathway.nodes.push({
      id: 'gate-empty-compound',
      type: 'Gate',
      properties: {
        title: 'Empty compound', gate_type: 'compound', default_behavior: 'skip',
        operator: 'AND', conditions: [],
      },
    });
    pathway.edges.push({ from: 'step-initial-assessment', to: 'gate-empty-compound', type: 'HAS_GATE' });
    pathway.edges.push({ from: 'gate-empty-compound', to: 'step-scar-eval', type: 'BRANCHES_TO' });
    const result = validatePathwayJson(pathway);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('compound') && e.includes('conditions'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix apps/pathway-service test -- --testPathPattern=validator.test --verbose 2>&1 | tail -30`
Expected: Gate tests FAIL (validation rules not yet implemented).

- [ ] **Step 3: Add Gate validation rules to validator.ts**

In `apps/pathway-service/src/services/import/validator.ts`, add a new function and call it from `validatePathwayJson()`:

```typescript
function validateGateNodes(
  nodes: PathwayNodeDefinition[],
  edges: PathwayEdgeDefinition[],
  errors: string[],
): void {
  const nodeIds = new Set(nodes.map(n => n.id));
  const gateNodes = nodes.filter(n => n.type === 'Gate');

  for (const gate of gateNodes) {
    const props = gate.properties as Record<string, unknown>;
    const gateType = props.gate_type as string;

    // Gate must have at least one outbound edge
    const outbound = edges.filter(e => e.from === gate.id);
    if (outbound.length === 0) {
      errors.push(`Gate "${gate.id}" must have at least one outbound edge`);
    }

    // depends_on references must exist
    const dependsOn = props.depends_on as Array<{ node_id: string }> | undefined;
    if (dependsOn) {
      for (const dep of dependsOn) {
        if (!nodeIds.has(dep.node_id) && dep.node_id !== 'root') {
          errors.push(`Gate "${gate.id}" depends_on references non-existent node "${dep.node_id}"`);
        }
      }
    }

    // select answer_type requires options
    if (gateType === 'question' || gateType === 'compound') {
      const answerType = props.answer_type as string | undefined;
      const options = props.options as string[] | undefined;
      if (answerType === 'select' && (!options || options.length === 0)) {
        errors.push(`Gate "${gate.id}" with answer_type "select" must provide non-empty options array`);
      }
    }

    // compound gates must have non-empty conditions
    if (gateType === 'compound') {
      const conditions = props.conditions as unknown[] | undefined;
      if (!conditions || conditions.length === 0) {
        errors.push(`Gate "${gate.id}" with gate_type "compound" must have non-empty conditions array`);
      }
    }
  }
}
```

Call `validateGateNodes(json.nodes, json.edges, errors)` from the main `validatePathwayJson()` function, after the existing node/edge validation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix apps/pathway-service test -- --testPathPattern=validator.test --verbose 2>&1 | tail -30`
Expected: All Gate validation tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/import/validator.ts \
        apps/pathway-service/src/__tests__/validator.test.ts
git commit -m "feat: add Gate node validation rules to import pipeline"
```

### Task 6: Gate Node Support in Graph Builder

**Files:**
- Modify: `apps/pathway-service/src/services/import/graph-builder.ts`
- Test: `apps/pathway-service/src/__tests__/graph-builder.test.ts`

- [ ] **Step 1: Write failing test**

Add to `graph-builder.test.ts`:

```typescript
describe('Gate node Cypher generation', () => {
  it('should generate CREATE for Gate node with all properties', () => {
    const pathway = clonePathway();
    pathway.nodes.push({
      id: 'gate-transplant',
      type: 'Gate',
      properties: {
        title: 'Transplant screening',
        gate_type: 'patient_attribute',
        default_behavior: 'skip',
        condition: { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
      },
    });
    pathway.edges.push({ from: 'step-initial-assessment', to: 'gate-transplant', type: 'HAS_GATE' });
    pathway.edges.push({ from: 'gate-transplant', to: 'step-scar-eval', type: 'BRANCHES_TO' });

    const commands = buildGraphCommands(pathway);
    const gateCmd = commands.find(c => c.nodeId === 'gate-transplant');
    expect(gateCmd).toBeDefined();
    expect(gateCmd!.cypher).toContain(':Gate');
    expect(gateCmd!.cypher).toContain('gate_type');

    const edgeCmd = commands.find(c => c.cypher.includes('HAS_GATE'));
    expect(edgeCmd).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/pathway-service test -- --testPathPattern=graph-builder.test --verbose 2>&1 | tail -20`
Expected: FAIL — Gate type not yet handled (or already works if the builder is generic enough).

- [ ] **Step 3: Update graph-builder.ts if needed**

Read `apps/pathway-service/src/services/import/graph-builder.ts` to check if node creation is type-generic (likely is since it uses `node.type` as the label). The Gate node should work out of the box if the builder is generic. If not, add Gate handling following the existing pattern.

The HAS_GATE edge may need to be added to any edge-type allowlists. Check and update as needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix apps/pathway-service test -- --testPathPattern=graph-builder.test --verbose 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/import/graph-builder.ts \
        apps/pathway-service/src/__tests__/graph-builder.test.ts
git commit -m "feat: Gate node support in graph builder"
```

---

## Chunk 3: Gate Evaluator + Test Fixture

### Task 7: Reference Pathway Fixture with Gates

**Files:**
- Create: `apps/pathway-service/src/__tests__/fixtures/reference-pathway-with-gates.ts`

- [ ] **Step 1: Create the fixture**

This extends the existing reference pathway with Gate nodes for testing. Import the existing `REFERENCE_PATHWAY` and add gates:

```typescript
import { PathwayJson } from '../../services/import/types';
import { REFERENCE_PATHWAY, clonePathway } from './reference-pathway';

/**
 * Extended pathway fixture with Gate nodes for testing the resolution engine.
 * Based on REFERENCE_PATHWAY (Prior Uterine Surgery) with 3 gates added:
 *
 * 1. gate-transplant-screen (patient_attribute): guards immunosuppression subtree
 * 2. gate-prior-cesarean (question): "Was the prior surgery a cesarean?"
 * 3. gate-med-monitoring (prior_node_result): opens monitoring if step-3-1 included
 *
 * Uses actual node IDs from REFERENCE_PATHWAY:
 *   stage-1 (Initial Assessment), stage-2 (Risk Stratification), stage-3 (TOLAC)
 *   step-1-1, step-1-2, step-2-1, step-3-1
 */
export function createPathwayWithGates(): PathwayJson {
  const pathway = clonePathway();

  // Add Gate nodes
  pathway.nodes.push(
    {
      id: 'gate-transplant-screen',
      type: 'Gate' as any,
      properties: {
        title: 'Organ transplant screening',
        gate_type: 'patient_attribute',
        default_behavior: 'skip',
        condition: { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
      },
    },
    {
      id: 'gate-prior-cesarean',
      type: 'Gate' as any,
      properties: {
        title: 'Prior cesarean confirmation',
        gate_type: 'question',
        default_behavior: 'skip',
        prompt: 'Was the prior uterine surgery a cesarean delivery?',
        answer_type: 'boolean',
      },
    },
    {
      id: 'gate-med-monitoring',
      type: 'Gate' as any,
      properties: {
        title: 'Medication monitoring gate',
        gate_type: 'prior_node_result',
        default_behavior: 'skip',
        depends_on: [{ node_id: 'step-3-1', status: 'included' }],
      },
    },
  );

  // Add action nodes behind each gate for testing
  pathway.nodes.push(
    {
      id: 'step-immunosuppression',
      type: 'Step',
      properties: { stage_number: 3, step_number: 10, display_number: '3.10', title: 'Immunosuppression management' },
    },
    {
      id: 'step-cesarean-specific',
      type: 'Step',
      properties: { stage_number: 2, step_number: 10, display_number: '2.10', title: 'Cesarean-specific evaluation' },
    },
    {
      id: 'step-med-monitoring',
      type: 'Step',
      properties: { stage_number: 3, step_number: 11, display_number: '3.11', title: 'Medication monitoring protocol' },
    },
  );

  // Wire gates into the graph (using actual REFERENCE_PATHWAY node IDs)
  pathway.edges.push(
    // Gate 1: from stage-3 (TOLAC) to transplant gate
    { from: 'stage-3', to: 'gate-transplant-screen', type: 'HAS_GATE' as any },
    { from: 'gate-transplant-screen', to: 'step-immunosuppression', type: 'BRANCHES_TO' },
    // Gate 2: from stage-2 (Risk Stratification) to prior cesarean gate
    { from: 'stage-2', to: 'gate-prior-cesarean', type: 'HAS_GATE' as any },
    { from: 'gate-prior-cesarean', to: 'step-cesarean-specific', type: 'BRANCHES_TO' },
    // Gate 3: from stage-3 to med monitoring gate (depends on step-3-1)
    { from: 'stage-3', to: 'gate-med-monitoring', type: 'HAS_GATE' as any },
    { from: 'gate-med-monitoring', to: 'step-med-monitoring', type: 'BRANCHES_TO' },
  );

  return pathway;
}

/** Pathway IDs for test assertions */
export const GATE_IDS = {
  TRANSPLANT_SCREEN: 'gate-transplant-screen',
  PRIOR_CESAREAN: 'gate-prior-cesarean',
  MED_MONITORING: 'gate-med-monitoring',
} as const;
```

Note: The `as any` casts for `'Gate'` and `'HAS_GATE'` are needed until Task 4 type changes are in place. If Task 4 is already done, remove the casts.

- [ ] **Step 2: Commit**

```bash
git add apps/pathway-service/src/__tests__/fixtures/reference-pathway-with-gates.ts
git commit -m "test: add reference pathway fixture with Gate nodes"
```

### Task 8: Gate Evaluator

**Files:**
- Create: `apps/pathway-service/src/services/resolution/gate-evaluator.ts`
- Test: `apps/pathway-service/src/__tests__/gate-evaluator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/pathway-service/src/__tests__/gate-evaluator.test.ts`:

```typescript
import { evaluateGate } from '../services/resolution/gate-evaluator';
import { GateProperties, GateType, DefaultBehavior, NodeStatus } from '../services/resolution/types';
import { PatientContext } from '../services/confidence/types';
import { REFERENCE_PATIENT } from './fixtures/reference-patient-context';

describe('GateEvaluator', () => {
  const makeGate = (overrides: Partial<GateProperties>): GateProperties => ({
    title: 'Test gate',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    ...overrides,
  });

  describe('patient_attribute gates', () => {
    it('should satisfy gate when patient has matching condition code', () => {
      const gate = makeGate({
        gate_type: GateType.PATIENT_ATTRIBUTE,
        condition: { field: 'conditions', operator: 'includes_code', value: 'O34.211', system: 'ICD-10' },
      });
      // REFERENCE_PATIENT has condition O34.211
      const result = evaluateGate(gate, REFERENCE_PATIENT, new Map(), new Map());
      expect(result.satisfied).toBe(true);
    });

    it('should not satisfy gate when patient lacks condition code', () => {
      const gate = makeGate({
        gate_type: GateType.PATIENT_ATTRIBUTE,
        condition: { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
      });
      const result = evaluateGate(gate, REFERENCE_PATIENT, new Map(), new Map());
      expect(result.satisfied).toBe(false);
    });

    it('should track which context fields were read', () => {
      const gate = makeGate({
        condition: { field: 'conditions', operator: 'includes_code', value: 'O34.211', system: 'ICD-10' },
      });
      const result = evaluateGate(gate, REFERENCE_PATIENT, new Map(), new Map());
      expect(result.contextFieldsRead).toContain('conditions');
    });
  });

  describe('prior_node_result gates', () => {
    it('should satisfy gate when referenced node has expected status', () => {
      const gate = makeGate({
        gate_type: GateType.PRIOR_NODE_RESULT,
        depends_on: [{ node_id: 'step-delivery-planning', status: 'included' }],
      });
      const resolutionState = new Map([
        ['step-delivery-planning', { nodeId: 'step-delivery-planning', status: NodeStatus.INCLUDED } as any],
      ]);
      const result = evaluateGate(gate, REFERENCE_PATIENT, resolutionState, new Map());
      expect(result.satisfied).toBe(true);
      expect(result.dependedOnNodes).toContain('step-delivery-planning');
    });

    it('should not satisfy gate when referenced node has different status', () => {
      const gate = makeGate({
        gate_type: GateType.PRIOR_NODE_RESULT,
        depends_on: [{ node_id: 'step-delivery-planning', status: 'included' }],
      });
      const resolutionState = new Map([
        ['step-delivery-planning', { nodeId: 'step-delivery-planning', status: NodeStatus.EXCLUDED } as any],
      ]);
      const result = evaluateGate(gate, REFERENCE_PATIENT, resolutionState, new Map());
      expect(result.satisfied).toBe(false);
    });

    it('should not satisfy gate when referenced node not yet evaluated', () => {
      const gate = makeGate({
        gate_type: GateType.PRIOR_NODE_RESULT,
        depends_on: [{ node_id: 'step-not-evaluated', status: 'included' }],
      });
      const result = evaluateGate(gate, REFERENCE_PATIENT, new Map(), new Map());
      expect(result.satisfied).toBe(false);
    });
  });

  describe('question gates', () => {
    it('should satisfy gate when answer matches boolean true', () => {
      const gate = makeGate({
        gate_type: GateType.QUESTION,
        prompt: 'Prior cesarean?',
        answer_type: 'boolean' as any,
      });
      const gateAnswers = new Map([['test-gate', { booleanValue: true }]]);
      const result = evaluateGate(gate, REFERENCE_PATIENT, new Map(), gateAnswers, 'test-gate');
      expect(result.satisfied).toBe(true);
    });

    it('should not satisfy unanswered question gate', () => {
      const gate = makeGate({
        gate_type: GateType.QUESTION,
        prompt: 'Prior cesarean?',
        answer_type: 'boolean' as any,
      });
      const result = evaluateGate(gate, REFERENCE_PATIENT, new Map(), new Map(), 'test-gate');
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('unanswered');
    });
  });

  describe('compound gates', () => {
    it('should satisfy AND gate when all conditions met', () => {
      const gate = makeGate({
        gate_type: GateType.COMPOUND,
        operator: 'AND',
        conditions: [
          { field: 'conditions', operator: 'includes_code', value: 'O34.211', system: 'ICD-10' },
          { field: 'medications', operator: 'includes_code', value: '7052', system: 'RXNORM' },
        ],
      });
      const result = evaluateGate(gate, REFERENCE_PATIENT, new Map(), new Map());
      expect(result.satisfied).toBe(true);
    });

    it('should not satisfy AND gate when one condition fails', () => {
      const gate = makeGate({
        gate_type: GateType.COMPOUND,
        operator: 'AND',
        conditions: [
          { field: 'conditions', operator: 'includes_code', value: 'O34.211', system: 'ICD-10' },
          { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
        ],
      });
      const result = evaluateGate(gate, REFERENCE_PATIENT, new Map(), new Map());
      expect(result.satisfied).toBe(false);
    });

    it('should satisfy OR gate when one condition met', () => {
      const gate = makeGate({
        gate_type: GateType.COMPOUND,
        operator: 'OR',
        conditions: [
          { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
          { field: 'conditions', operator: 'includes_code', value: 'O34.211', system: 'ICD-10' },
        ],
      });
      const result = evaluateGate(gate, REFERENCE_PATIENT, new Map(), new Map());
      expect(result.satisfied).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix apps/pathway-service test -- --testPathPattern=gate-evaluator --verbose 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement gate-evaluator.ts**

Create `apps/pathway-service/src/services/resolution/gate-evaluator.ts`:

```typescript
import { PatientContext, CodeEntry } from '../confidence/types';
import {
  GateProperties,
  GateType,
  GateCondition,
  GateAnswer,
  GateEvaluationResult,
  NodeResult,
  NodeStatus,
} from './types';

/**
 * Evaluate a Gate node's condition against patient context, resolution state,
 * and/or provider answers. Returns whether the gate is satisfied and tracks
 * which inputs were read (for dependency tracking).
 */
export function evaluateGate(
  gate: GateProperties,
  patientContext: PatientContext,
  resolutionState: Map<string, NodeResult>,
  gateAnswers: Map<string, GateAnswer>,
  gateId?: string,
): GateEvaluationResult {
  const contextFieldsRead: string[] = [];
  const dependedOnNodes: string[] = [];

  switch (gate.gate_type) {
    case GateType.PATIENT_ATTRIBUTE: {
      if (!gate.condition) {
        return { satisfied: false, reason: 'No condition defined', contextFieldsRead, dependedOnNodes };
      }
      const result = evaluateCondition(gate.condition, patientContext, contextFieldsRead);
      return { satisfied: result, reason: result ? 'Condition met' : 'Condition not met', contextFieldsRead, dependedOnNodes };
    }

    case GateType.QUESTION: {
      const answer = gateId ? gateAnswers.get(gateId) : undefined;
      if (!answer) {
        return { satisfied: false, reason: 'Question unanswered', contextFieldsRead, dependedOnNodes };
      }
      const satisfied = evaluateAnswer(gate, answer);
      return { satisfied, reason: satisfied ? 'Answer opens gate' : 'Answer closes gate', contextFieldsRead, dependedOnNodes };
    }

    case GateType.PRIOR_NODE_RESULT: {
      if (!gate.depends_on || gate.depends_on.length === 0) {
        return { satisfied: false, reason: 'No depends_on defined', contextFieldsRead, dependedOnNodes };
      }
      let allSatisfied = true;
      for (const dep of gate.depends_on) {
        dependedOnNodes.push(dep.node_id);
        const nodeResult = resolutionState.get(dep.node_id);
        if (!nodeResult) {
          allSatisfied = false;
          continue;
        }
        const expectedStatus = dep.status.toUpperCase() as NodeStatus;
        if (nodeResult.status !== expectedStatus) {
          allSatisfied = false;
        }
      }
      return {
        satisfied: allSatisfied,
        reason: allSatisfied ? 'All dependencies satisfied' : 'Dependencies not met',
        contextFieldsRead,
        dependedOnNodes,
      };
    }

    case GateType.COMPOUND: {
      if (!gate.conditions || gate.conditions.length === 0) {
        return { satisfied: false, reason: 'Empty compound conditions', contextFieldsRead, dependedOnNodes };
      }
      const operator = gate.operator ?? 'AND';
      const results = gate.conditions.map(c => evaluateCondition(c, patientContext, contextFieldsRead));
      const satisfied = operator === 'AND'
        ? results.every(r => r)
        : results.some(r => r);
      return { satisfied, reason: `Compound ${operator}: ${satisfied}`, contextFieldsRead, dependedOnNodes };
    }

    default:
      return { satisfied: false, reason: `Unknown gate type: ${gate.gate_type}`, contextFieldsRead, dependedOnNodes };
  }
}

function evaluateCondition(
  condition: GateCondition,
  patientContext: PatientContext,
  contextFieldsRead: string[],
): boolean {
  contextFieldsRead.push(condition.field);

  const fieldData = getContextField(patientContext, condition.field);
  if (!fieldData) return false;

  switch (condition.operator) {
    case 'includes_code': {
      const codes = fieldData as CodeEntry[];
      const pattern = condition.value;
      const system = condition.system?.toLowerCase();
      return codes.some(entry => {
        const systemMatch = !system || entry.system.toLowerCase().includes(system);
        const codeMatch = pattern.includes('*')
          ? entry.code.startsWith(pattern.replace('*', ''))
          : entry.code === pattern;
        return systemMatch && codeMatch;
      });
    }

    case 'exists':
      return fieldData !== undefined && fieldData !== null;

    case 'equals':
      return String(fieldData) === condition.value;

    case 'greater_than':
      return Number(fieldData) > Number(condition.value);

    case 'less_than':
      return Number(fieldData) < Number(condition.value);

    default:
      return false;
  }
}

function evaluateAnswer(gate: GateProperties, answer: GateAnswer): boolean {
  switch (gate.answer_type) {
    case 'boolean':
      return answer.booleanValue === true;
    case 'numeric':
      // For numeric, any non-null value is considered an answer
      return answer.numericValue !== undefined && answer.numericValue !== null;
    case 'select':
      return answer.selectedOption !== undefined && answer.selectedOption !== null;
    default:
      return false;
  }
}

function getContextField(ctx: PatientContext, field: string): unknown {
  switch (field) {
    case 'conditions': return ctx.conditionCodes;
    case 'medications': return ctx.medications;
    case 'labResults': case 'labs': return ctx.labResults;
    case 'allergies': return ctx.allergies;
    case 'vitalSigns': case 'vitals': return ctx.vitalSigns;
    default: {
      // Support dotted paths like "surgical_history.scar_type"
      const parts = field.split('.');
      let current: unknown = ctx.vitalSigns ?? {};
      for (const part of parts) {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[part];
        } else {
          return undefined;
        }
      }
      return current;
    }
  }
}
```

- [ ] **Step 4: Update barrel export**

Add to `apps/pathway-service/src/services/resolution/index.ts`:

```typescript
export { evaluateGate } from './gate-evaluator';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix apps/pathway-service test -- --testPathPattern=gate-evaluator --verbose 2>&1 | tail -30`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pathway-service/src/services/resolution/gate-evaluator.ts \
        apps/pathway-service/src/services/resolution/index.ts \
        apps/pathway-service/src/__tests__/gate-evaluator.test.ts
git commit -m "feat: gate evaluator with 4 gate types (patient_attribute, question, prior_node_result, compound)"
```

---

## Chunk 4: Traversal Engine

### Task 9: Traversal Engine — Core BFS

**Files:**
- Create: `apps/pathway-service/src/services/resolution/traversal-engine.ts`
- Test: `apps/pathway-service/src/__tests__/traversal-engine.test.ts`

This is the largest and most critical task. The traversal engine:
1. Fetches the pathway graph from AGE
2. Runs confidence-gated BFS
3. Evaluates Gate nodes
4. Builds dependency map
5. Detects red flags
6. Returns TraversalResult

- [ ] **Step 1: Write failing tests**

Create `apps/pathway-service/src/__tests__/traversal-engine.test.ts`:

```typescript
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { NodeStatus, STRUCTURAL_NODE_TYPES, ACTION_NODE_TYPES } from '../services/resolution/types';
import { makeGraphContext, REFERENCE_PATIENT, EMPTY_PATIENT } from './fixtures/reference-patient-context';
import { createPathwayWithGates, GATE_IDS } from './fixtures/reference-pathway-with-gates';
import { GraphNode, GraphEdge, GraphContext } from '../services/confidence/types';

// Mock the confidence engine — we don't want real DB queries in unit tests
const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.85,
    breakdown: [{ signalName: 'data_completeness', score: 0.9, weight: 1.0, weightSource: 'SYSTEM_DEFAULT', missingInputs: [] }],
    resolutionType: 'AUTO_RESOLVED',
  }),
};

const mockThresholds = { autoResolveThreshold: 0.85, suggestThreshold: 0.60, scope: 'SYSTEM_DEFAULT' };

describe('TraversalEngine', () => {
  let engine: TraversalEngine;

  beforeEach(() => {
    engine = new TraversalEngine(mockConfidenceEngine as any, mockThresholds as any);
    jest.clearAllMocks();
  });

  it('should traverse a simple pathway and include nodes above threshold', async () => {
    // Build a minimal graph: root -> stage -> step -> medication
    // IMPORTANT: sourceId/targetId must use nodeIdentifier values (not id)
    // because makeGraphContext indexes outEdgeMap by nodeIdentifier
    const nodes: GraphNode[] = [
      { id: '1', nodeIdentifier: 'root', nodeType: 'Pathway', properties: { title: 'Test' } },
      { id: '2', nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { title: 'Stage 1', stage_number: 1 } },
      { id: '3', nodeIdentifier: 'step-1', nodeType: 'Step', properties: { title: 'Step 1', stage_number: 1, step_number: 1, display_number: '1.1' } },
      { id: '4', nodeIdentifier: 'med-1', nodeType: 'Medication', properties: { title: 'Metformin', name: 'Metformin' } },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1', edgeType: 'HAS_STAGE', sourceId: 'root', targetId: 'stage-1', properties: {} },
      { id: 'e2', edgeType: 'HAS_STEP', sourceId: 'stage-1', targetId: 'step-1', properties: {} },
      { id: 'e3', edgeType: 'USES_MEDICATION', sourceId: 'step-1', targetId: 'med-1', properties: {} },
    ];
    const graphContext = makeGraphContext(nodes, edges);

    const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

    expect(result.totalNodesEvaluated).toBeGreaterThan(0);
    expect(result.resolutionState.get('med-1')?.status).toBe(NodeStatus.INCLUDED);
    expect(result.isDegraded).toBe(false);
  });

  it('should exclude nodes below confidence threshold', async () => {
    mockConfidenceEngine.computeNodeConfidence.mockResolvedValueOnce({
      confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED',
    }).mockResolvedValueOnce({
      confidence: 0.40, breakdown: [], resolutionType: 'PROVIDER_DECIDED',
    });

    const nodes: GraphNode[] = [
      { id: '1', nodeIdentifier: 'root', nodeType: 'Pathway', properties: { title: 'Test' } },
      { id: '2', nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { title: 'Stage 1', stage_number: 1 } },
      { id: '3', nodeIdentifier: 'med-high', nodeType: 'Medication', properties: { title: 'High conf' } },
      { id: '4', nodeIdentifier: 'med-low', nodeType: 'Medication', properties: { title: 'Low conf' } },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1', edgeType: 'HAS_STAGE', sourceId: 'root', targetId: 'stage-1', properties: {} },
      { id: 'e2', edgeType: 'USES_MEDICATION', sourceId: 'stage-1', targetId: 'med-high', properties: {} },
      { id: 'e3', edgeType: 'USES_MEDICATION', sourceId: 'stage-1', targetId: 'med-low', properties: {} },
    ];
    const graphContext = makeGraphContext(nodes, edges);

    const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

    expect(result.resolutionState.get('med-high')?.status).toBe(NodeStatus.INCLUDED);
    expect(result.resolutionState.get('med-low')?.status).toBe(NodeStatus.EXCLUDED);
  });

  it('should gate out subtree when Gate evaluates to skip', async () => {
    const nodes: GraphNode[] = [
      { id: '1', nodeIdentifier: 'root', nodeType: 'Pathway', properties: { title: 'Test' } },
      { id: '2', nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { title: 'Stage', stage_number: 1 } },
      { id: '3', nodeIdentifier: 'gate-1', nodeType: 'Gate', properties: {
        title: 'Transplant gate', gate_type: 'patient_attribute', default_behavior: 'skip',
        condition: { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
      }},
      { id: '4', nodeIdentifier: 'step-gated', nodeType: 'Step', properties: { title: 'Gated step', stage_number: 1, step_number: 1, display_number: '1.1' } },
      { id: '5', nodeIdentifier: 'med-gated', nodeType: 'Medication', properties: { title: 'Gated med' } },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1', edgeType: 'HAS_STAGE', sourceId: 'root', targetId: 'stage-1', properties: {} },
      { id: 'e2', edgeType: 'HAS_GATE', sourceId: 'stage-1', targetId: 'gate-1', properties: {} },
      { id: 'e3', edgeType: 'BRANCHES_TO', sourceId: 'gate-1', targetId: 'step-gated', properties: {} },
      { id: 'e4', edgeType: 'USES_MEDICATION', sourceId: 'step-gated', targetId: 'med-gated', properties: {} },
    ];
    const graphContext = makeGraphContext(nodes, edges);

    // Patient does NOT have Z94.* — gate should skip
    const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

    expect(result.resolutionState.get('gate-1')?.status).toBe(NodeStatus.GATED_OUT);
    expect(result.resolutionState.get('step-gated')?.status).toBe(NodeStatus.GATED_OUT);
    expect(result.resolutionState.get('med-gated')?.status).toBe(NodeStatus.GATED_OUT);
  });

  it('should add pending question for unanswered question gate', async () => {
    const nodes: GraphNode[] = [
      { id: '1', nodeIdentifier: 'root', nodeType: 'Pathway', properties: { title: 'Test' } },
      { id: '2', nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { title: 'Stage', stage_number: 1 } },
      { id: '3', nodeIdentifier: 'gate-q', nodeType: 'Gate', properties: {
        title: 'Question gate', gate_type: 'question', default_behavior: 'skip',
        prompt: 'Prior cesarean?', answer_type: 'boolean',
      }},
      { id: '4', nodeIdentifier: 'step-behind-q', nodeType: 'Step', properties: { title: 'Behind question', stage_number: 1, step_number: 1, display_number: '1.1' } },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1', edgeType: 'HAS_STAGE', sourceId: 'root', targetId: 'stage-1', properties: {} },
      { id: 'e2', edgeType: 'HAS_GATE', sourceId: 'stage-1', targetId: 'gate-q', properties: {} },
      { id: 'e3', edgeType: 'BRANCHES_TO', sourceId: 'gate-q', targetId: 'step-behind-q', properties: {} },
    ];
    const graphContext = makeGraphContext(nodes, edges);

    const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

    expect(result.pendingQuestions.length).toBe(1);
    expect(result.pendingQuestions[0].gateId).toBe('gate-q');
    expect(result.pendingQuestions[0].prompt).toBe('Prior cesarean?');
    expect(result.resolutionState.get('gate-q')?.status).toBe(NodeStatus.PENDING_QUESTION);
  });

  it('should build dependency map tracking gate dependencies', async () => {
    const nodes: GraphNode[] = [
      { id: '1', nodeIdentifier: 'root', nodeType: 'Pathway', properties: { title: 'Test' } },
      { id: '2', nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { title: 'Stage', stage_number: 1 } },
      { id: '3', nodeIdentifier: 'step-a', nodeType: 'Step', properties: { title: 'Step A', stage_number: 1, step_number: 1, display_number: '1.1' } },
      { id: '4', nodeIdentifier: 'gate-dep', nodeType: 'Gate', properties: {
        title: 'Dep gate', gate_type: 'prior_node_result', default_behavior: 'skip',
        depends_on: [{ node_id: 'step-a', status: 'included' }],
      }},
      { id: '5', nodeIdentifier: 'step-b', nodeType: 'Step', properties: { title: 'Step B', stage_number: 1, step_number: 2, display_number: '1.2' } },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1', edgeType: 'HAS_STAGE', sourceId: 'root', targetId: 'stage-1', properties: {} },
      { id: 'e2', edgeType: 'HAS_STEP', sourceId: 'stage-1', targetId: 'step-a', properties: {} },
      { id: 'e3', edgeType: 'HAS_GATE', sourceId: 'stage-1', targetId: 'gate-dep', properties: {} },
      { id: 'e4', edgeType: 'BRANCHES_TO', sourceId: 'gate-dep', targetId: 'step-b', properties: {} },
    ];
    const graphContext = makeGraphContext(nodes, edges);

    const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

    // gate-dep depends on step-a
    expect(result.dependencyMap.influences.get('step-a')?.has('gate-dep')).toBe(true);
    expect(result.dependencyMap.influencedBy.get('gate-dep')?.has('step-a')).toBe(true);
  });

  it('should detect all-branches-excluded red flag on DecisionPoint', async () => {
    // All branches score below threshold
    mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
      confidence: 0.30, breakdown: [], resolutionType: 'PROVIDER_DECIDED',
    });

    const nodes: GraphNode[] = [
      { id: '1', nodeIdentifier: 'root', nodeType: 'Pathway', properties: { title: 'Test' } },
      { id: '2', nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { title: 'Stage', stage_number: 1 } },
      { id: '3', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: { title: 'Choose treatment' } },
      { id: '4', nodeIdentifier: 'med-a', nodeType: 'Medication', properties: { title: 'Med A' } },
      { id: '5', nodeIdentifier: 'med-b', nodeType: 'Medication', properties: { title: 'Med B' } },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1', edgeType: 'HAS_STAGE', sourceId: 'root', targetId: 'stage-1', properties: {} },
      { id: 'e2', edgeType: 'HAS_DECISION_POINT', sourceId: 'stage-1', targetId: 'dp-1', properties: {} },
      { id: 'e3', edgeType: 'BRANCHES_TO', sourceId: 'dp-1', targetId: 'med-a', properties: {} },
      { id: 'e4', edgeType: 'BRANCHES_TO', sourceId: 'dp-1', targetId: 'med-b', properties: {} },
    ];
    const graphContext = makeGraphContext(nodes, edges);

    const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

    expect(result.redFlags.some(rf => rf.type === 'all_branches_excluded' && rf.nodeId === 'dp-1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix apps/pathway-service test -- --testPathPattern=traversal-engine --verbose 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement traversal-engine.ts**

Create `apps/pathway-service/src/services/resolution/traversal-engine.ts`. This is the core BFS engine.

Key implementation points (the tests define the contract):
- Constructor takes a confidence engine interface (for mocking) and resolved thresholds
- `traverse(graphContext, patientContext, gateAnswers)` runs BFS from the root node
- For each node type, apply the appropriate evaluation strategy (see spec Section 1)
- Build DependencyMap as a side effect of evaluation
- Collect PendingQuestions from unanswered question Gates
- Detect red flags (all-branches-excluded on DecisionPoints)
- Track timing with `performance.now()` for `traversalDurationMs`
- Return `TraversalResult`

The engine should:
1. Find the root node (type 'Pathway')
2. BFS using `graphContext.outgoingEdges()` to walk children
3. For Gate nodes, call `evaluateGate()` and either continue or prune
4. For DecisionPoint nodes, compute confidence on each branch target
5. For action nodes, compute confidence and include/exclude
6. For structural nodes, always traverse children
7. Lazy evaluation: if a Gate's `depends_on` references an un-evaluated node, evaluate it first (check evaluation stack for cycles)
8. Record dependency links in DependencyMap

Implementation should be ~200-250 lines. Use the `evaluateGate()` function from Task 8. The confidence engine is injected (not imported directly) for testability.

- [ ] **Step 4: Update barrel export**

Add to `apps/pathway-service/src/services/resolution/index.ts`:

```typescript
export { TraversalEngine } from './traversal-engine';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix apps/pathway-service test -- --testPathPattern=traversal-engine --verbose 2>&1 | tail -30`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pathway-service/src/services/resolution/traversal-engine.ts \
        apps/pathway-service/src/services/resolution/index.ts \
        apps/pathway-service/src/__tests__/traversal-engine.test.ts
git commit -m "feat: confidence-gated BFS traversal engine with gate evaluation and dependency tracking"
```

---

## Chunk 5: Safety Constraints

### Task 10: Safety Module

**Files:**
- Create: `apps/pathway-service/src/services/resolution/safety.ts`
- Test: `apps/pathway-service/src/__tests__/safety.test.ts`

Implements: cycle detection (evaluation stack), traversal timeout wrapper, cascade depth limiter, missing critical data detection. The all-branches-excluded detection is already in the traversal engine (Task 9).

- [ ] **Step 1: Write failing tests**

Create `apps/pathway-service/src/__tests__/safety.test.ts`:

```typescript
import { detectCycle, enforceTimeout, checkMissingCriticalData } from '../services/resolution/safety';
import { NodeStatus } from '../services/resolution/types';
import { REFERENCE_PATIENT } from './fixtures/reference-patient-context';

describe('Safety', () => {
  describe('detectCycle', () => {
    it('should detect a cycle in the evaluation stack', () => {
      const stack = new Set(['node-a', 'node-b']);
      expect(detectCycle('node-a', stack)).toBe(true);
    });

    it('should not flag non-cycle', () => {
      const stack = new Set(['node-a', 'node-b']);
      expect(detectCycle('node-c', stack)).toBe(false);
    });
  });

  describe('enforceTimeout', () => {
    it('should not throw before timeout', () => {
      const startTime = Date.now();
      expect(() => enforceTimeout(startTime, 10_000)).not.toThrow();
    });

    it('should throw after timeout', () => {
      const startTime = Date.now() - 11_000; // 11 seconds ago
      expect(() => enforceTimeout(startTime, 10_000)).toThrow('timeout');
    });
  });

  describe('checkMissingCriticalData', () => {
    it('should return red flag for critical node with 0 data presence score', () => {
      const node = {
        nodeIdentifier: 'med-critical',
        nodeType: 'Medication',
        properties: { title: 'Critical med', critical: true },
      };
      const breakdown = [{ signalName: 'data_completeness', score: 0, weight: 1, weightSource: 'SYSTEM_DEFAULT' as const, missingInputs: ['lab_results'] }];
      const flags = checkMissingCriticalData(node as any, breakdown);
      expect(flags.length).toBe(1);
      expect(flags[0].type).toBe('missing_critical_data');
    });

    it('should not flag non-critical nodes', () => {
      const node = {
        nodeIdentifier: 'med-normal',
        nodeType: 'Medication',
        properties: { title: 'Normal med' },
      };
      const breakdown = [{ signalName: 'data_completeness', score: 0, weight: 1, weightSource: 'SYSTEM_DEFAULT' as const, missingInputs: ['lab_results'] }];
      const flags = checkMissingCriticalData(node as any, breakdown);
      expect(flags.length).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm --prefix apps/pathway-service test -- --testPathPattern=safety.test --verbose 2>&1 | tail -20`

- [ ] **Step 3: Implement safety.ts**

Create `apps/pathway-service/src/services/resolution/safety.ts`:

```typescript
import { GraphNode, SignalBreakdown } from '../confidence/types';
import { RedFlag, MAX_CASCADE_DEPTH } from './types';

export class TraversalTimeoutError extends Error {
  constructor(evaluatedCount: number, totalCount: number) {
    super(`Traversal timeout: ${evaluatedCount} of ${totalCount} nodes evaluated`);
    this.name = 'TraversalTimeoutError';
  }
}

/**
 * Check if evaluating nodeId would create a cycle.
 * The evaluationStack contains nodes currently being evaluated (not just visited).
 */
export function detectCycle(nodeId: string, evaluationStack: Set<string>): boolean {
  return evaluationStack.has(nodeId);
}

/**
 * Throw if the traversal has exceeded the timeout.
 * Called periodically during BFS iteration.
 */
export function enforceTimeout(
  startTimeMs: number,
  timeoutMs: number,
): void {
  if (Date.now() - startTimeMs > timeoutMs) {
    throw new TraversalTimeoutError(0, 0);
  }
}

/**
 * Check for missing critical data on a node.
 * A node is flagged if it has `critical: true` in properties
 * AND the DATA_PRESENCE/data_completeness signal scored 0.
 */
export function checkMissingCriticalData(
  node: GraphNode,
  breakdown: SignalBreakdown[],
): RedFlag[] {
  const isCritical = node.properties.critical === true;
  if (!isCritical) return [];

  const dataSignal = breakdown.find(
    b => b.signalName === 'data_completeness' || b.signalName === 'DATA_PRESENCE'
  );
  if (!dataSignal || dataSignal.score > 0) return [];

  return [{
    nodeId: node.nodeIdentifier,
    nodeTitle: String(node.properties.title ?? node.nodeIdentifier),
    type: 'missing_critical_data',
    description: `Critical node "${node.properties.title}" is missing required data: ${dataSignal.missingInputs.join(', ')}`,
  }];
}

/**
 * Check if cascade depth has been exceeded during re-traversal.
 */
export function isCascadeLimitReached(currentDepth: number): boolean {
  return currentDepth >= MAX_CASCADE_DEPTH;
}
```

- [ ] **Step 4: Update barrel export**

Add to `apps/pathway-service/src/services/resolution/index.ts`:

```typescript
export { detectCycle, enforceTimeout, checkMissingCriticalData, isCascadeLimitReached, TraversalTimeoutError } from './safety';
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm --prefix apps/pathway-service test -- --testPathPattern=safety.test --verbose 2>&1 | tail -20`

- [ ] **Step 6: Commit**

```bash
git add apps/pathway-service/src/services/resolution/safety.ts \
        apps/pathway-service/src/services/resolution/index.ts \
        apps/pathway-service/src/__tests__/safety.test.ts
git commit -m "feat: safety constraints — cycle detection, timeout, missing critical data, cascade limits"
```

---

## Chunk 6: Scoped Re-Traversal Engine

### Task 11: Re-Traversal Engine

**Files:**
- Create: `apps/pathway-service/src/services/resolution/retraversal-engine.ts`
- Test: `apps/pathway-service/src/__tests__/retraversal-engine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/pathway-service/src/__tests__/retraversal-engine.test.ts`:

```typescript
import { RetraversalEngine } from '../services/resolution/retraversal-engine';
import { NodeStatus, NodeResult, DependencyMap, createEmptyDependencyMap } from '../services/resolution/types';

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.90, breakdown: [], resolutionType: 'AUTO_RESOLVED',
  }),
};

const mockThresholds = { autoResolveThreshold: 0.85, suggestThreshold: 0.60, scope: 'SYSTEM_DEFAULT' };

describe('RetraversalEngine', () => {
  let engine: RetraversalEngine;

  beforeEach(() => {
    engine = new RetraversalEngine(mockConfidenceEngine as any, mockThresholds as any);
    jest.clearAllMocks();
  });

  it('should recompute affected nodes when override changes status', async () => {
    // Setup: node-a is INCLUDED, gate-b depends on node-a
    const resolutionState = new Map<string, NodeResult>([
      ['node-a', { nodeId: 'node-a', nodeType: 'Step', title: 'A', status: NodeStatus.INCLUDED, confidence: 0.9, confidenceBreakdown: [], depth: 1 }],
      ['gate-b', { nodeId: 'gate-b', nodeType: 'Gate', title: 'B', status: NodeStatus.INCLUDED, confidence: 0, confidenceBreakdown: [], depth: 2 }],
    ]);
    const depMap = createEmptyDependencyMap();
    depMap.influences.set('node-a', new Set(['gate-b']));
    depMap.influencedBy.set('gate-b', new Set(['node-a']));

    const result = await engine.retraverse(
      new Set(['gate-b']),
      resolutionState,
      depMap,
      {} as any, // graphContext (mock)
      {} as any, // patientContext
      new Map(),
    );

    expect(result.nodesRecomputed).toBeGreaterThan(0);
  });

  it('should respect cascade depth limit', async () => {
    // Create a chain of 15 dependent nodes
    const resolutionState = new Map<string, NodeResult>();
    const depMap = createEmptyDependencyMap();

    for (let i = 0; i < 15; i++) {
      const id = `node-${i}`;
      resolutionState.set(id, {
        nodeId: id, nodeType: 'Step', title: `Node ${i}`,
        status: NodeStatus.INCLUDED, confidence: 0.9, confidenceBreakdown: [], depth: i,
      });
      if (i > 0) {
        const prev = `node-${i - 1}`;
        depMap.influences.set(prev, new Set([id]));
        depMap.influencedBy.set(id, new Set([prev]));
      }
    }

    // Force status changes to cascade
    mockConfidenceEngine.computeNodeConfidence
      .mockResolvedValue({ confidence: 0.40, breakdown: [], resolutionType: 'PROVIDER_DECIDED' });

    const result = await engine.retraverse(
      new Set(['node-0']),
      resolutionState,
      depMap,
      {} as any,
      {} as any,
      new Map(),
    );

    // Should stop cascading at depth 10
    expect(result.nodesRecomputed).toBeLessThanOrEqual(11); // 10 cascade + 1 initial
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement retraversal-engine.ts**

Create `apps/pathway-service/src/services/resolution/retraversal-engine.ts`.

Key implementation points:
- `retraverse(affectedNodeIds, resolutionState, dependencyMap, graphContext, patientContext, gateAnswers)` implements the algorithm from spec Section 4
- Process nodes in topological order (or fall back to insertion order if cycle detected)
- For each node: re-evaluate, compare status change, cascade to dependents if changed
- Track cascade depth per chain, stop at `MAX_CASCADE_DEPTH`
- Return `RetraversalResult` with status changes and counts

~120-150 lines.

- [ ] **Step 4: Update barrel export and run tests**

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/resolution/retraversal-engine.ts \
        apps/pathway-service/src/services/resolution/index.ts \
        apps/pathway-service/src/__tests__/retraversal-engine.test.ts
git commit -m "feat: scoped re-traversal engine with dependency-based cascade and depth limits"
```

---

## Chunk 7: Session Store

### Task 12: Session Persistence

**Files:**
- Create: `apps/pathway-service/src/services/resolution/session-store.ts`
- Test: `apps/pathway-service/src/__tests__/session-store.test.ts`

- [ ] **Step 1: Write failing tests**

Focus on the serialization/deserialization logic (unit testable without DB), plus the SQL query shapes:

```typescript
import { serializeResolutionState, deserializeResolutionState, serializeDependencyMap, deserializeDependencyMap } from '../services/resolution/session-store';
import { NodeStatus, NodeResult, createEmptyDependencyMap } from '../services/resolution/types';

describe('SessionStore serialization', () => {
  it('should round-trip ResolutionState through JSON', () => {
    const state = new Map<string, NodeResult>([
      ['node-1', {
        nodeId: 'node-1', nodeType: 'Medication', title: 'Med', status: NodeStatus.INCLUDED,
        confidence: 0.85, confidenceBreakdown: [], depth: 2,
      }],
    ]);
    const json = serializeResolutionState(state);
    const restored = deserializeResolutionState(json);
    expect(restored.get('node-1')?.status).toBe(NodeStatus.INCLUDED);
    expect(restored.get('node-1')?.confidence).toBe(0.85);
  });

  it('should round-trip DependencyMap through JSON', () => {
    const depMap = createEmptyDependencyMap();
    depMap.influences.set('a', new Set(['b', 'c']));
    depMap.influencedBy.set('b', new Set(['a']));
    depMap.gateContextFields.set('gate-1', new Set(['conditions']));

    const json = serializeDependencyMap(depMap);
    const restored = deserializeDependencyMap(json);

    expect(restored.influences.get('a')?.has('b')).toBe(true);
    expect(restored.influencedBy.get('b')?.has('a')).toBe(true);
    expect(restored.gateContextFields.get('gate-1')?.has('conditions')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement session-store.ts**

Create `apps/pathway-service/src/services/resolution/session-store.ts`.

Key functions:
- `serializeResolutionState(state: ResolutionState): object` — Convert Map to JSON-safe object
- `deserializeResolutionState(json: object): ResolutionState` — Reverse
- `serializeDependencyMap(depMap: DependencyMap): object` — Convert Maps/Sets to arrays
- `deserializeDependencyMap(json: object): DependencyMap` — Reverse
- `createSession(pool, session)` — INSERT into `pathway_resolution_sessions`
- `updateSession(pool, sessionId, updates)` — UPDATE resolution_state, pending_questions, red_flags, etc.
- `getSession(pool, sessionId)` — SELECT + deserialize
- `logEvent(pool, event)` — INSERT into `pathway_resolution_events`
- `logNodeOverride(pool, override)` — INSERT into `pathway_node_overrides`
- `logGateAnswer(pool, answer)` — INSERT into `pathway_gate_answers`
- `getMatchedPathways(pool, patientConditionCodes)` — query `pathway_condition_codes` with GIN overlap
- `getPatientSessions(pool, patientId, status?)` — list sessions

~200-250 lines total.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/resolution/session-store.ts \
        apps/pathway-service/src/services/resolution/index.ts \
        apps/pathway-service/src/__tests__/session-store.test.ts
git commit -m "feat: session store with JSONB serialization and resolution analytics writes"
```

---

## Chunk 8: Care Plan Generator

### Task 13: Care Plan Generation

**Files:**
- Create: `apps/pathway-service/src/services/resolution/care-plan-generator.ts`
- Test: `apps/pathway-service/src/__tests__/care-plan-generator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { generateCarePlan, validateForGeneration } from '../services/resolution/care-plan-generator';
import { NodeStatus, NodeResult, BlockerType } from '../services/resolution/types';

describe('CarePlanGenerator', () => {
  describe('validateForGeneration', () => {
    it('should block on empty plan (no included action nodes)', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', { nodeId: 'stage-1', nodeType: 'Stage', title: 'S1', status: NodeStatus.INCLUDED, confidence: 0.9, confidenceBreakdown: [], depth: 0 }],
        // No action nodes included
      ]);
      const result = validateForGeneration(state, []);
      expect(result.some(b => b.type === BlockerType.EMPTY_PLAN)).toBe(true);
    });

    it('should block on unresolved red flags', () => {
      const state = new Map<string, NodeResult>([
        ['med-1', { nodeId: 'med-1', nodeType: 'Medication', title: 'Med', status: NodeStatus.INCLUDED, confidence: 0.9, confidenceBreakdown: [], depth: 1 }],
      ]);
      const redFlags = [{ nodeId: 'dp-1', nodeTitle: 'DP', type: 'all_branches_excluded' as const, description: 'All excluded' }];
      const result = validateForGeneration(state, redFlags);
      expect(result.some(b => b.type === BlockerType.UNRESOLVED_RED_FLAG)).toBe(true);
    });

    it('should pass validation with included action nodes and no red flags', () => {
      const state = new Map<string, NodeResult>([
        ['med-1', { nodeId: 'med-1', nodeType: 'Medication', title: 'Med', status: NodeStatus.INCLUDED, confidence: 0.9, confidenceBreakdown: [], depth: 1 }],
      ]);
      const result = validateForGeneration(state, []);
      expect(result.length).toBe(0);
    });
  });

  describe('generateCarePlan', () => {
    it('should map Stage to goal and Medication to intervention', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', { nodeId: 'stage-1', nodeType: 'Stage', title: 'Assessment', status: NodeStatus.INCLUDED, confidence: 0.9, confidenceBreakdown: [], depth: 0 }],
        ['step-1', { nodeId: 'step-1', nodeType: 'Step', title: 'Initial eval', status: NodeStatus.INCLUDED, confidence: 0.9, confidenceBreakdown: [], depth: 1, parentNodeId: 'stage-1' }],
        ['med-1', { nodeId: 'med-1', nodeType: 'Medication', title: 'Metformin 500mg', status: NodeStatus.INCLUDED, confidence: 0.87, confidenceBreakdown: [], depth: 2, parentNodeId: 'step-1' }],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');

      expect(plan.goals.length).toBe(1);
      expect(plan.goals[0].description).toContain('Assessment');
      expect(plan.interventions.length).toBe(1);
      expect(plan.interventions[0].type).toBe('MEDICATION');
      expect(plan.interventions[0].description).toContain('Metformin');
      expect(plan.interventions[0].pathwayNodeId).toBe('med-1');
    });

    it('should omit excluded nodes from care plan', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', { nodeId: 'stage-1', nodeType: 'Stage', title: 'Stage', status: NodeStatus.INCLUDED, confidence: 0.9, confidenceBreakdown: [], depth: 0 }],
        ['med-included', { nodeId: 'med-included', nodeType: 'Medication', title: 'Included', status: NodeStatus.INCLUDED, confidence: 0.9, confidenceBreakdown: [], depth: 1 }],
        ['med-excluded', { nodeId: 'med-excluded', nodeType: 'Medication', title: 'Excluded', status: NodeStatus.EXCLUDED, confidence: 0.3, confidenceBreakdown: [], depth: 1 }],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');

      expect(plan.interventions.length).toBe(1);
      expect(plan.interventions[0].pathwayNodeId).toBe('med-included');
    });

    it('should mark provider overrides with source provider_override', () => {
      const state = new Map<string, NodeResult>([
        ['stage-1', { nodeId: 'stage-1', nodeType: 'Stage', title: 'Stage', status: NodeStatus.INCLUDED, confidence: 0.9, confidenceBreakdown: [], depth: 0 }],
        ['med-1', {
          nodeId: 'med-1', nodeType: 'Medication', title: 'Overridden med',
          status: NodeStatus.INCLUDED, confidence: 0.4, confidenceBreakdown: [], depth: 1,
          providerOverride: { action: 'INCLUDE' as any, originalStatus: NodeStatus.EXCLUDED, originalConfidence: 0.4 },
        }],
      ]);

      const plan = generateCarePlan(state, 'pathway-1', 'session-1');

      expect(plan.interventions[0].source).toBe('provider_override');
    });
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement care-plan-generator.ts**

Create `apps/pathway-service/src/services/resolution/care-plan-generator.ts`.

Key functions:
- `validateForGeneration(state, redFlags)` — returns `ValidationBlocker[]`
- `generateCarePlan(state, pathwayId, sessionId)` — returns `{ goals, interventions, conditionCodes }` structured for INSERT into `care_plans`, `care_plan_goals`, `care_plan_interventions`

The node-to-entity mapping follows the table in spec Section 5. Each intervention carries `pathwayNodeId`, `pathwayId`, `sessionId`, `recommendationConfidence`, and `source`.

~150-180 lines.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/resolution/care-plan-generator.ts \
        apps/pathway-service/src/services/resolution/index.ts \
        apps/pathway-service/src/__tests__/care-plan-generator.test.ts
git commit -m "feat: care plan generator with node-to-entity mapping and validation"
```

---

## Chunk 9: GraphQL Schema and Resolvers

### Task 14: Extend GraphQL Schema

**Files:**
- Modify: `apps/pathway-service/schema.graphql`

- [ ] **Step 1: Add resolution types and mutations to schema.graphql**

Add the following sections to the existing `schema.graphql`. Read the file first to find the right insertion points.

**New enums** (add after existing enums):

```graphql
enum SessionStatus { ACTIVE COMPLETED ABANDONED DEGRADED }
enum NodeStatus { INCLUDED EXCLUDED GATED_OUT PENDING_QUESTION TIMEOUT CASCADE_LIMIT UNKNOWN }
enum OverrideAction { INCLUDE EXCLUDE }
enum AnswerType { BOOLEAN NUMERIC SELECT }
enum BlockerType { EMPTY_PLAN UNRESOLVED_RED_FLAG CONTRADICTION PENDING_GATE }
```

**New types** (add after existing types):

```graphql
# ─── Resolution Types ────────────────────────────────────────────────

type MatchedPathway {
  pathway: Pathway!
  matchedConditionCodes: [String!]!
  matchScore: Float!
}

type ResolutionSession {
  id: ID!
  pathwayId: ID!
  pathwayVersion: String!
  patientId: ID!
  providerId: ID!
  status: SessionStatus!
  includedNodes: [ResolvedNode!]!
  excludedNodes: [ResolvedNode!]!
  gatedOutNodes: [ResolvedNode!]!
  pendingQuestions: [PendingQuestionType!]!
  redFlags: [RedFlagType!]!
  resolutionEvents: [ResolutionEventType!]!
  totalNodesEvaluated: Int!
  traversalDurationMs: Int!
  createdAt: String!
  updatedAt: String!
}

type ResolutionSessionSummary {
  id: ID!
  pathwayId: ID!
  pathwayTitle: String!
  status: SessionStatus!
  totalNodesEvaluated: Int!
  includedCount: Int!
  redFlagCount: Int!
  carePlanId: ID
  createdAt: String!
  updatedAt: String!
}

type ResolvedNode {
  nodeId: ID!
  nodeType: String!
  title: String!
  status: NodeStatus!
  confidence: Float!
  confidenceBreakdown: [SignalBreakdown!]!
  providerOverride: ProviderOverrideType
  excludeReason: String
  parentNodeId: ID
  depth: Int!
}

type ProviderOverrideType {
  action: OverrideAction!
  reason: String
  originalStatus: NodeStatus!
  originalConfidence: Float!
}

type ResolutionEventType {
  id: ID!
  eventType: String!
  triggerData: JSON!
  nodesRecomputed: Int!
  statusChanges: JSON!
  createdAt: String!
}

type RedFlagType {
  nodeId: ID!
  nodeTitle: String!
  type: String!
  description: String!
  branches: [RedFlagBranchType!]
}

type RedFlagBranchType {
  nodeId: ID!
  title: String!
  confidence: Float!
  topExcludeReason: String!
}

type PendingQuestionType {
  gateId: ID!
  prompt: String!
  answerType: AnswerType!
  options: [String!]
  affectedSubtreeSize: Int!
  estimatedImpact: String
}

type CarePlanGenerationResult {
  success: Boolean!
  carePlanId: ID
  warnings: [String!]!
  blockers: [ValidationBlockerType!]!
}

type ValidationBlockerType {
  type: BlockerType!
  description: String!
  relatedNodeIds: [ID!]!
}

input GateAnswerInput {
  booleanValue: Boolean
  numericValue: Float
  selectedOption: String
}

input AdditionalContextInput {
  conditionCodes: [CodeInput!]
  medications: [CodeInput!]
  labResults: [LabResultInput!]
  allergies: [CodeInput!]
  vitalSigns: JSON
  freeformData: JSON
}
```

**New queries** (add to existing `type Query`):

```graphql
  matchedPathways(patientId: ID!): [MatchedPathway!]!
  resolutionSession(sessionId: ID!): ResolutionSession
  pendingQuestions(sessionId: ID!): [PendingQuestionType!]!
  redFlags(sessionId: ID!): [RedFlagType!]!
  patientResolutionSessions(patientId: ID!, status: SessionStatus): [ResolutionSessionSummary!]!
```

**New mutations** (add to existing `type Mutation`):

```graphql
  startResolution(pathwayId: ID!, patientId: ID!, patientContext: PatientContextInput): ResolutionSession!
  overrideNode(sessionId: ID!, nodeId: ID!, action: OverrideAction!, reason: String): ResolutionSession!
  answerGateQuestion(sessionId: ID!, gateId: ID!, answer: GateAnswerInput!): ResolutionSession!
  addPatientContext(sessionId: ID!, additionalContext: AdditionalContextInput!): ResolutionSession!
  generateCarePlanFromResolution(sessionId: ID!): CarePlanGenerationResult!
  abandonSession(sessionId: ID!, reason: String): ResolutionSession!
```

- [ ] **Step 2: Run typecheck to verify schema is valid**

Run: `npm --prefix apps/pathway-service run typecheck 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add apps/pathway-service/schema.graphql
git commit -m "feat: add resolution engine types, queries, and mutations to GraphQL schema"
```

### Task 15: Resolution Query Resolvers

**Files:**
- Modify: `apps/pathway-service/src/resolvers/Query.ts`
- Test: `apps/pathway-service/src/__tests__/resolution-resolvers.test.ts`

- [ ] **Step 1: Write failing tests for query resolvers**

Create `apps/pathway-service/src/__tests__/resolution-resolvers.test.ts`:

```typescript
import { resolvers } from '../resolvers';

// Mock the session store and traversal engine
jest.mock('../services/resolution/session-store');

describe('Resolution Query Resolvers', () => {
  const mockContext = {
    pool: {} as any,
    redis: {} as any,
    userId: 'test-provider',
    userRole: 'provider',
  };

  it('matchedPathways should call getMatchedPathways with patient condition codes', async () => {
    const { getMatchedPathways } = require('../services/resolution/session-store');
    getMatchedPathways.mockResolvedValue([]);

    await resolvers.Query.matchedPathways(null, { patientId: 'patient-1' }, mockContext);

    expect(getMatchedPathways).toHaveBeenCalledWith(mockContext.pool, 'patient-1');
  });

  it('resolutionSession should return null for non-existent session', async () => {
    const { getSession } = require('../services/resolution/session-store');
    getSession.mockResolvedValue(null);

    const result = await resolvers.Query.resolutionSession(null, { sessionId: 'nonexistent' }, mockContext);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Implement query resolvers**

Add to `apps/pathway-service/src/resolvers/Query.ts`:

```typescript
// Resolution queries
matchedPathways: async (_: unknown, args: { patientId: string }, context: DataSourceContext) => {
  return getMatchedPathways(context.pool, args.patientId);
},

resolutionSession: async (_: unknown, args: { sessionId: string }, context: DataSourceContext) => {
  const session = await getSession(context.pool, args.sessionId);
  if (!session) return null;
  return formatSessionForGraphQL(session);
},

pendingQuestions: async (_: unknown, args: { sessionId: string }, context: DataSourceContext) => {
  const session = await getSession(context.pool, args.sessionId);
  return session?.pendingQuestions ?? [];
},

redFlags: async (_: unknown, args: { sessionId: string }, context: DataSourceContext) => {
  const session = await getSession(context.pool, args.sessionId);
  return session?.redFlags ?? [];
},

patientResolutionSessions: async (_: unknown, args: { patientId: string; status?: string }, context: DataSourceContext) => {
  return getPatientSessions(context.pool, args.patientId, args.status);
},
```

The `formatSessionForGraphQL()` helper converts the internal `ResolutionSession` (with Maps) to the GraphQL shape (with arrays split by status).

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git add apps/pathway-service/src/resolvers/Query.ts \
        apps/pathway-service/src/__tests__/resolution-resolvers.test.ts
git commit -m "feat: resolution query resolvers (matchedPathways, resolutionSession, pendingQuestions, redFlags)"
```

### Task 16: Resolution Mutation Resolvers

**Files:**
- Modify: `apps/pathway-service/src/resolvers/Mutation.ts`
- Test: `apps/pathway-service/src/__tests__/resolution-resolvers.test.ts`

- [ ] **Step 1: Write failing tests for mutation resolvers**

Add to `resolution-resolvers.test.ts`:

```typescript
describe('Resolution Mutation Resolvers', () => {
  it('startResolution should create session and run traversal', async () => {
    // Test that startResolution:
    // 1. Fetches pathway from DB
    // 2. Fetches graph from AGE
    // 3. Runs traversal engine
    // 4. Creates session in DB
    // 5. Logs traversal_complete event
    // 6. Returns formatted session
    // (Mock all dependencies, verify they're called in order)
  });

  it('overrideNode should update resolution state and log override', async () => {
    // Test that overrideNode:
    // 1. Loads session
    // 2. Applies override to resolution state
    // 3. Runs scoped re-traversal
    // 4. Updates session in DB
    // 5. Logs override event
    // 6. Writes to pathway_node_overrides
    // 7. Returns updated session
  });

  it('abandonSession should mark session as ABANDONED', async () => {
    // Test status transition
  });
});
```

- [ ] **Step 2: Implement mutation resolvers**

Add to `apps/pathway-service/src/resolvers/Mutation.ts`. Each mutation follows a similar pattern:
1. Load session (for interaction mutations) or pathway (for startResolution)
2. Execute the resolution logic
3. Persist changes
4. Log event
5. Return formatted session

The `startResolution` mutation is the most complex:
1. Fetch pathway from `pathway_graph_index`
2. Fetch graph nodes/edges from AGE via Cypher
3. Build `GraphContext`
4. Batch-load confidence weights (one query)
5. Instantiate `TraversalEngine` with confidence engine + thresholds
6. Run `traverse()`
7. Create session in DB with full result
8. Log `traversal_complete` event
9. Return formatted session

~250-300 lines for all 6 mutations.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Run full test suite**

Run: `npm --prefix apps/pathway-service test --verbose 2>&1 | tail -40`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/resolvers/Mutation.ts \
        apps/pathway-service/src/__tests__/resolution-resolvers.test.ts
git commit -m "feat: resolution mutation resolvers (startResolution, overrideNode, answerGateQuestion, addPatientContext, generateCarePlanFromResolution, abandonSession)"
```

---

## Chunk 10: Integration Wiring + Final Verification

### Task 17: Wire Up Service Entry Point

**Files:**
- Modify: `apps/pathway-service/src/index.ts`

- [ ] **Step 1: Update index.ts to initialize resolution engine**

Read `apps/pathway-service/src/index.ts` first. Add initialization of the `ScorerRegistry` (if not already done by Plan 3) and the resolution engine dependencies. The traversal engine and re-traversal engine are instantiated per-request in the resolvers, not at startup — they depend on per-pathway thresholds.

No new singletons needed at startup; the resolution engine uses the existing confidence engine and database pool.

- [ ] **Step 2: Run typecheck**

Run: `npm --prefix apps/pathway-service run typecheck 2>&1 | tail -20`
Expected: No type errors.

- [ ] **Step 3: Run full test suite**

Run: `npm --prefix apps/pathway-service test --verbose 2>&1 | tail -40`
Expected: All tests pass.

- [ ] **Step 4: Run lint**

Run: `npm --prefix apps/pathway-service run lint 2>&1 | tail -20`
Expected: No lint errors (or only pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/index.ts
git commit -m "chore: wire resolution engine into pathway-service startup"
```

### Task 18: Final Verification

- [ ] **Step 1: Run all pathway-service tests**

Run: `npm --prefix apps/pathway-service test --verbose 2>&1 | tail -50`
Expected: All tests pass. Document the count.

- [ ] **Step 2: Run typecheck across all affected packages**

Run: `npm --prefix apps/pathway-service run typecheck 2>&1 | tail -20`
Expected: Clean.

- [ ] **Step 3: Verify migration files are properly numbered**

Run: `ls -la /home/claude/workspace/prism-graphql/shared/data-layer/migrations/04*.sql`
Expected: 042_extend_resolution_sessions.sql and 043_create_resolution_analytics.sql present.

- [ ] **Step 4: Verify no uncommitted changes remain**

Run: `git -C /home/claude/workspace/prism-graphql status`
Expected: Clean working tree.

- [ ] **Step 5: Final commit if any loose ends**

Clean up any remaining changes.
