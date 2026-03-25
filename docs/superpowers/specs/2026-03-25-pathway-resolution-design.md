# Pathway Resolution Engine

**Date:** 2026-03-25
**Status:** Draft
**Plan:** Plan 4 of 5 (Clinical Pathway Graph Architecture)
**Depends on:** Plan 1 (Infrastructure, PR #26), Plan 2 (Import Pipeline, PR #27), Plan 3 (Confidence Framework, PR #29)
**RFC:** `prism-ml-infra/docs/RFC_Clinical_Pathway_Graph_Architecture.md`

## Problem

Plans 1-3 built the pathway graph infrastructure, import pipeline, and confidence framework. But there is no way to actually use a pathway for a patient. The system can store pathways, import them, and compute per-node confidence scores in isolation -- but it cannot:

- Match a patient to relevant pathways based on their condition codes
- Traverse the pathway graph to produce a recommendation subgraph
- Let providers interact with the traversal result (override nodes, answer questions, add context)
- Generate a draft care plan from the resolved pathway

This plan builds the **pathway resolution engine**: the runtime that connects pathway graphs to patient care.

## Design Overview

The resolution engine operates in three layers:

1. **Compute** -- Automated confidence-gated BFS produces a full recommendation subgraph from the pathway graph, evaluating every node against the patient's clinical context.
2. **Refine** -- Provider reviews the result, overrides inclusions/exclusions, and adds patient information. Each interaction triggers a scoped re-traversal of affected nodes only.
3. **Guided** -- The system identifies low-confidence nodes where specific information would change the recommendation and asks the provider targeted questions via Gate nodes.

```
Patient conditions  -->  matchedPathways query
                              |
                              v
                    startResolution mutation
                              |
                              v
               Automated BFS traversal + confidence scoring
                              |
                              v
              RecommendationSubgraph (included/excluded/gated-out nodes)
                              |
            +--+--------------+--------------+--+
            |                 |                  |
     overrideNode     answerGateQuestion    addPatientContext
            |                 |                  |
            +--+--------------+--------------+--+
                              |
                     Scoped re-traversal
                              |
                              v
               generateCarePlanFromResolution
                              |
                              v
                     Draft care plan (careplan-service)
```

---

## Section 1: Graph Traversal Engine

The core of Plan 4 is a confidence-gated BFS traversal engine that walks the pathway graph and produces a **recommendation subgraph** -- the subset of nodes that should appear in the patient's care plan.

### Algorithm

1. **Find entry point:** Match patient condition codes against `pathway_condition_codes` (GIN index).
2. **Initialize BFS queue** with the pathway's root node.
3. **For each node dequeued:**

   **a. Gate node** -- Evaluate gate condition against patient context, prior node results, or provider answers.
   - Satisfied or `default_behavior=traverse` --> continue into subtree
   - Not satisfied and `default_behavior=skip` --> skip entire subtree, record as `gated_out`
   - Unanswered question --> skip subtree, add to `pending_questions` list

   **b. DecisionPoint** -- Score all outbound branches via confidence engine.
   - Each branch gets a confidence score; branches above threshold are included
   - Multiple branches CAN be included (a patient might need both medication management AND lifestyle intervention)

   **c. Leaf/action node** (Medication, LabTest, Procedure, etc.) -- Compute confidence.
   - Above threshold --> include in recommendation subgraph
   - Below threshold --> record as `excluded` with reason + signal breakdown

   **d. Structural node** (Stage, Step) -- Always traverse children, aggregate confidence.

4. **Return:** `RecommendationSubgraph` (included nodes, excluded nodes, gated-out subtrees, pending questions, red flags).

### Key Behaviors

- **Multi-path output** -- Multiple branches from a DecisionPoint can be included if they each clear confidence. Unlike a "pick one branch" model.
- **Subtree pruning at gates** -- When a Gate evaluates to `skip`, the entire subtree beneath it is pruned. No confidence computation wasted on irrelevant branches.
- **Structural nodes pass through** -- Stages and Steps are organizational; always traversed. Their confidence is an aggregate of their children (informational, not gating).
- **Lazy evaluation with memoization** -- The resolution state is a `Map<nodeId, NodeResult>` that grows as traversal progresses. Gate nodes can reference any other node by ID. If a referenced node hasn't been evaluated yet, the engine evaluates it on the spot and caches the result. No ordering constraints on pathway authors.

---

## Section 2: Gate Node Schema

A new node type that controls whether entire subtrees are traversed.

### Concept

Gates provide two distinct gating mechanisms:
1. **Confidence gating** -- Nodes are evaluated but only included if confidence clears the threshold. Provider can add info to boost confidence.
2. **Conditional gating** -- Entire subtrees are gated behind a condition. The traversal doesn't enter the subtree unless the gate is satisfied. For rare/specialized branches that shouldn't be explored by default.

Gates differ from DecisionPoints:
- **DecisionPoint:** "Patient has hypertension -- which treatment tier?" (always traversed, branches scored)
- **Gate:** "Does the patient have a history of organ transplant?" (skip the immunosuppression subtree entirely unless yes)

### Node Type Definition

```json
{
  "id": "gate-immunosuppression",
  "type": "Gate",
  "properties": {
    "title": "Immunosuppression management screening",
    "gate_type": "patient_attribute | question | prior_node_result | compound",
    "default_behavior": "skip | traverse",

    "condition": {
      "field": "conditions",
      "operator": "includes_code",
      "value": "Z94.*",
      "system": "ICD-10"
    },

    "prompt": "Does the patient have a history of organ transplant?",
    "answer_type": "boolean | numeric | select",
    "options": ["Yes", "No"],

    "depends_on": [
      { "node_id": "med-management-step", "status": "included" }
    ],

    "operator": "AND | OR",
    "conditions": []
  }
}
```

**Gate types:**

| Type | Evaluates Against | Example |
|------|-------------------|---------|
| `patient_attribute` | Patient clinical context (conditions, meds, labs, allergies, vitals) | "Does the patient have ICD-10 Z94.*?" |
| `question` | Provider answer (gathered in guided mode) | "History of organ transplant?" |
| `prior_node_result` | Resolution state of other nodes (by ID) | "Was medication management included?" |
| `compound` | AND/OR combination of the above | "Transplant history AND on immunosuppressants" |

### Edge Type

`HAS_GATE` -- Connects a parent node to a Gate that guards a subtree.

Graph structure: `Step --HAS_GATE--> Gate --BRANCHES_TO--> [gated subtree]`

### Import Validator Additions

- Gate must have at least one outbound edge
- `depends_on` node IDs must exist in the pathway
- `answer_type` must match `options` (select requires options, boolean doesn't)
- Compound gates must have non-empty `conditions` array

---

## Section 3: Resolution State & Session Model

The session is the container for a traversal result that the provider then interacts with.

### Session Lifecycle

```
startResolution(pathwayId, patientId, patientContext)
  --> Automated BFS traversal runs
  --> Produces recommendation subgraph
  --> Returns session with full result

Provider interactions (any order, any number):
  --> overrideNode(sessionId, nodeId, include|exclude, reason?)
  --> answerGateQuestion(sessionId, gateId, answer)
  --> addPatientContext(sessionId, additionalContext)
  Each triggers scoped re-traversal (Section 4)

generateCarePlan(sessionId)
  --> Transforms included nodes into draft care plan

abandonSession(sessionId)
  --> Marks session abandoned
```

### Resolution State

The core data structure is a `Map<nodeId, NodeResult>`:

```typescript
type NodeStatus =
  | 'included'      // confidence above threshold or provider override
  | 'excluded'      // confidence below threshold or provider override
  | 'gated_out'     // behind a gate that evaluated to skip
  | 'pending_question' // behind a gate with unanswered question
  | 'timeout'       // traversal timed out before evaluation
  | 'cascade_limit' // max re-traversal cascade depth exceeded
  | 'unknown';      // cycle detected, used default_behavior

interface NodeResult {
  nodeId: string;
  nodeType: string;
  status: NodeStatus;
  confidence: number;
  confidenceBreakdown: SignalBreakdown[];
  excludeReason?: string; // "below_threshold" | "gate_skipped" | "provider_excluded"
  providerOverride?: {
    action: 'include' | 'exclude';
    reason?: string;
    originalStatus: string;
    originalConfidence: number;
  };
}
```

### Pending Questions

```typescript
interface PendingQuestion {
  gateId: string;
  prompt: string;
  answerType: 'boolean' | 'numeric' | 'select';
  options?: string[];
  affectedSubtreeSize: number;       // how many nodes behind this gate
  estimatedImpact: string;           // "Would add 12 nodes including 3 medications"
}
```

### Gate Evaluation Sources

Gates evaluate against three distinct sources, not just patient context:
1. **Patient context** -- Clinical snapshot data (conditions, meds, labs, allergies, vitals)
2. **Prior node results** -- Nodes already included/excluded earlier in the traversal (e.g., "if medication management was included, open drug interaction monitoring subtree")
3. **Provider answers** -- Responses to questions gathered in guided mode

The traversal engine carries an accumulating resolution state as it walks the graph.

### Session Persistence

The session row stores the full resolution state as JSONB so the provider can leave and come back. Individual node decisions also go to relational tables for cross-session analytics.

---

## Section 4: Scoped Re-Traversal

When the provider interacts with a resolved session, we recompute only the affected portion of the graph.

### Dependency Tracking

Built as a side effect of the initial traversal:

```typescript
interface DependencyMap {
  // nodeId --> set of nodes whose result influenced this node's evaluation
  influencedBy: Map<string, Set<string>>;

  // nodeId --> set of nodes that depend on this node's result
  influences: Map<string, Set<string>>;

  // gateId --> set of patient context fields the gate condition reads
  gateContextFields: Map<string, Set<string>>;

  // nodeId --> set of confidence scorer inputs (which context fields affected the score)
  scorerInputs: Map<string, Set<string>>;
}
```

Every time the engine evaluates a gate's `depends_on`, reads a patient context field, or runs a confidence scorer, it records the dependency.

### Re-Traversal Triggers

**`overrideNode(nodeId, include|exclude)`:**
- Scope: All nodes in `influences[nodeId]` (gates referencing this node via `prior_node_result`) + all descendants of those gates.
- If the overridden node is a DecisionPoint or Step, its entire subtree is re-evaluated.

**`answerGateQuestion(gateId, answer)`:**
- If answer opens the gate: BFS traverses the gated subtree fresh (never evaluated before). New nodes added to resolution state.
- If answer closes a previously-open gate: All nodes in that subtree marked `gated_out`. Downstream gates depending on those nodes re-evaluated.

**`addPatientContext(additionalContext)`:**
- Engine identifies which context fields changed.
- Scope: All nodes where `scorerInputs[nodeId]` intersects changed fields + all gates where `gateContextFields[gateId]` intersects changed fields.
- Re-scored nodes that flip status cascade via `influences`.

### Algorithm

```
retraverse(affectedNodeIds: Set<string>):
  queue = topological_sort(affectedNodeIds)
  // If topological sort detects a cycle in the affected set,
  // break it using the same cycle-detection logic from Section 6.1:
  // treat the back-edge node as status 'unknown', evaluate gate
  // against default_behavior, and continue.

  for each nodeId in queue:
    previousResult = resolutionState.get(nodeId)
    newResult = evaluate(nodeId)

    if newResult.status !== previousResult.status:
      // Status changed -- cascade to dependents
      for each dependent in influences[nodeId]:
        queue.add(dependent)

      // If structural node, re-evaluate children
      if nodeType in [Stage, Step, DecisionPoint]:
        for each child in getChildren(nodeId):
          queue.add(child)

    resolutionState.set(nodeId, newResult)
```

**Termination:** Re-traversal stops when status changes stop propagating. If a re-scored node lands on the same status (e.g., confidence dropped from 0.85 to 0.78, both above threshold), no cascade occurs.

**Typical scope:** Most provider interactions touch <10% of nodes. Worst case (root-level context change) is equivalent to a full re-traversal.

### Audit Trail

Every re-traversal appends to a `resolution_events` log:

```typescript
interface ResolutionEvent {
  eventType: 'override' | 'gate_answer' | 'context_update';
  timestamp: Date;
  trigger: { nodeId?: string; gateId?: string; contextFields?: string[] };
  nodesRecomputed: number;
  statusChanges: Array<{ nodeId: string; from: string; to: string }>;
}
```

---

## Section 5: Care Plan Generation

`generateCarePlanFromResolution(sessionId)` transforms the resolved subgraph into a draft care plan compatible with the existing careplan-service schema.

### Node-to-Entity Mapping

| Pathway Node Type | Care Plan Entity | Notes |
|---|---|---|
| Stage | Care Plan Goal | Top-level organizational mapping. Stage title --> goal description. |
| Step | Care Plan Milestone | Steps within a stage become milestones under the goal. |
| Medication | Intervention (type: medication) | Dose, frequency, duration from node properties. |
| LabTest | Intervention (type: lab_order) | Test name, frequency, target ranges. |
| Procedure | Intervention (type: procedure) | Procedure details, timing. |
| Monitoring | Intervention (type: monitoring) | What to track, frequency, alert thresholds. |
| Lifestyle | Intervention (type: lifestyle) | Behavioral recommendations. |
| Referral | Intervention (type: referral) | Specialty, urgency, reason. |

### Generation Rules

1. **Only included nodes** are mapped. Excluded, gated_out, and pending_question nodes are omitted.
2. **Provider overrides preserved** -- Manually included below-threshold nodes get `source: 'provider_override'` vs `source: 'pathway_recommendation'`.
3. **Confidence scores carry through** -- Each intervention gets `recommendationConfidence` from the resolution state.
4. **Structural hierarchy preserved** -- Stage-->Step-->Action becomes Goal-->Milestone-->Intervention. If a Stage has no included action nodes, the Goal is omitted.
5. **Back-references** -- Every care plan entity carries `pathwayNodeId`, `pathwayId`, and `sessionId` for traceability ("Why is this intervention in my care plan?" --> link back to pathway node and confidence breakdown).

### Example Mapping

```typescript
// Pathway Medication node
{
  type: "Medication",
  properties: {
    name: "Metformin",
    dose: "500mg",
    frequency: "twice daily",
    duration: "ongoing",
    icd10_code: "E11.9",
    contraindications: ["eGFR < 30"]
  }
}

// Becomes Care Plan Intervention
{
  type: "medication",
  description: "Metformin 500mg twice daily",
  details: { dose: "500mg", frequency: "twice daily", duration: "ongoing" },
  conditionCode: "E11.9",
  recommendationConfidence: 0.87,
  source: "pathway_recommendation",
  pathwayNodeId: "med-metformin-500",
  pathwayId: "pathway-t2dm-v3",
  sessionId: "session-abc123"
}
```

### Excluded Nodes

The care plan itself only contains included nodes. The session's resolution state (persisted as JSONB) retains the full picture. The frontend can show a "What was considered but not recommended" section by querying the session.

### Draft Lifecycle

`generateCarePlanFromResolution` always produces a `status: 'draft'` care plan. The existing careplan-service `acceptCarePlan` mutation transitions it to `active`. No changes to careplan-service's state machine.

### Validation Before Generation

The engine checks for:
- At least one included action node (don't generate an empty care plan)
- No unresolved pending questions on gates that guard included subtrees
- No contradictory inclusions (two medications with known interaction both included) -- delegates to safety-service

If validation fails, the mutation returns blockers rather than generating a broken care plan.

---

## Section 6: Safety Constraints

### 1. Cycle Detection

The pathway graph is a DAG by design, but `prior_node_result` gate dependencies can create logical cycles (Gate A depends on Node B, but Node B is a descendant of Gate A).

**Detection:** During traversal, the engine maintains an evaluation stack (not just a visited set). If lazy evaluation encounters a node already in the current evaluation stack, that's a cycle.

**Response:** Break the cycle by treating the circularly-referenced node as `status: 'unknown'`. The gate evaluates against `default_behavior`. Log a `cycle_detected` warning on the session.

**Import validator addition:** Static analysis of `depends_on` references to catch obvious cycles at import time.

### 2. Traversal Timeout

- Initial BFS: 10 seconds wall-clock
- Re-traversals: 5 seconds

If timeout hits mid-traversal:
- All evaluated nodes keep their results
- Remaining unevaluated nodes get `status: 'timeout'`
- Session enters `degraded` state
- Provider sees: "Pathway evaluation timed out -- X of Y nodes evaluated. Showing partial results."

### 3. All Branches Contraindicated

When a DecisionPoint has all outbound branches excluded, it gets `all_excluded_red_flag` status:

```typescript
interface RedFlag {
  nodeId: string;
  nodeTitle: string;
  type: 'all_branches_excluded' | 'contradiction' | 'missing_critical_data';
  description: string;
  branches: Array<{
    nodeId: string;
    title: string;
    confidence: number;
    topExcludeReason: string;
  }>;
}
```

Provider must acknowledge red flags before generating a care plan.

### 4. Contradiction Detection

Two included nodes with a known conflict (e.g., drug interaction). After traversal completes, the engine sends the included node set to safety-service's existing check endpoint. Contradictions surface as red flags.

The engine does not auto-resolve contradictions -- the provider excludes one of the conflicting nodes, triggering scoped re-traversal.

### 5. Missing Critical Data

When `DATA_PRESENCE` scorer returns 0 for a node marked `critical: true` in the pathway, it becomes a `missing_critical_data` red flag.

Guided mode surfaces these as: "To evaluate [node title], the system needs [data field]. Is this information available?"

### 6. Max Re-Traversal Cascade Depth

Provider interactions can cascade (answering a gate opens a subtree, which includes a node, which satisfies another gate's `prior_node_result`, which opens another subtree).

- Max cascade depth: 10 levels
- If exceeded: stop cascading, mark remaining nodes as `cascade_limit`, add warning

---

## Section 7: GraphQL API Surface

### Queries

```graphql
# Find pathways matching a patient's conditions
matchedPathways(patientId: ID!): [MatchedPathway!]!

# Get a resolution session with full state
resolutionSession(sessionId: ID!): ResolutionSession

# Get pending questions for guided mode
pendingQuestions(sessionId: ID!): [PendingQuestion!]!

# Get red flags for a session
redFlags(sessionId: ID!): [RedFlag!]!

# List sessions for a patient (history)
patientResolutionSessions(
  patientId: ID!
  status: SessionStatus
): [ResolutionSessionSummary!]!
```

### Mutations

```graphql
# Run automated traversal, produce recommendation subgraph
startResolution(
  pathwayId: ID!
  patientId: ID!
  patientContext: PatientContextInput
): ResolutionSession!

# Provider overrides a node's inclusion/exclusion
overrideNode(
  sessionId: ID!
  nodeId: ID!
  action: OverrideAction!  # INCLUDE | EXCLUDE
  reason: String
): ResolutionSession!

# Provider answers a gate question
answerGateQuestion(
  sessionId: ID!
  gateId: ID!
  answer: GateAnswerInput!
): ResolutionSession!

# Provider adds clinical context
addPatientContext(
  sessionId: ID!
  additionalContext: AdditionalContextInput!
): ResolutionSession!

# Generate draft care plan from resolved session
generateCarePlanFromResolution(
  sessionId: ID!
): CarePlanGenerationResult!

# Abandon a session
abandonSession(
  sessionId: ID!
  reason: String
): ResolutionSession!
```

### Enums and Scalars

```graphql
enum SessionStatus { ACTIVE COMPLETED ABANDONED DEGRADED }
enum NodeStatus { INCLUDED EXCLUDED GATED_OUT PENDING_QUESTION TIMEOUT CASCADE_LIMIT UNKNOWN }
enum OverrideAction { INCLUDE EXCLUDE }
enum AnswerType { BOOLEAN NUMERIC SELECT }
enum BlockerType { EMPTY_PLAN UNRESOLVED_RED_FLAG CONTRADICTION PENDING_GATE }
```

Note: The existing schema uses `String!` for timestamps. This plan continues that convention (not `DateTime`).

### Key Return Types

```graphql
type MatchedPathway {
  pathway: Pathway!
  matchedConditionCodes: [String!]!   # which patient codes matched
  matchScore: Float!                   # relevance ranking
}

type ResolutionSession {
  id: ID!
  pathwayId: ID!
  pathwayVersion: String!              # snapshot at time of resolution
  patientId: ID!
  providerId: ID!
  status: SessionStatus!

  includedNodes: [ResolvedNode!]!
  excludedNodes: [ResolvedNode!]!
  gatedOutNodes: [ResolvedNode!]!

  pendingQuestions: [PendingQuestion!]!
  redFlags: [RedFlag!]!
  resolutionEvents: [ResolutionEvent!]!

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
  providerOverride: ProviderOverride
  excludeReason: String
  parentNodeId: ID
  depth: Int!
}

type ProviderOverride {
  action: OverrideAction!
  reason: String
  originalStatus: NodeStatus!
  originalConfidence: Float!
}

type ResolutionEvent {
  id: ID!
  eventType: String!
  triggerData: JSON!
  nodesRecomputed: Int!
  statusChanges: JSON!
  createdAt: String!
}

type RedFlag {
  nodeId: ID!
  nodeTitle: String!
  type: String!  # all_branches_excluded | contradiction | missing_critical_data
  description: String!
  branches: [RedFlagBranch!]
}

type RedFlagBranch {
  nodeId: ID!
  title: String!
  confidence: Float!
  topExcludeReason: String!
}

type PendingQuestion {
  gateId: ID!
  prompt: String!
  answerType: AnswerType!
  options: [String!]
  affectedSubtreeSize: Int!
  estimatedImpact: String
}

input GateAnswerInput {
  booleanValue: Boolean     # for BOOLEAN gates
  numericValue: Float       # for NUMERIC gates
  selectedOption: String    # for SELECT gates
}

input AdditionalContextInput {
  conditionCodes: [CodeInput!]
  medications: [CodeInput!]
  labResults: [LabResultInput!]
  allergies: [CodeInput!]
  vitalSigns: JSON
  freeformData: JSON        # flexible key-value for pathway-specific fields
}

type CarePlanGenerationResult {
  success: Boolean!
  carePlanId: ID
  warnings: [String!]!
  blockers: [ValidationBlocker!]!
}

type ValidationBlocker {
  type: BlockerType!
  description: String!
  relatedNodeIds: [ID!]!
}
```

Note: `AdditionalContextInput` is used instead of `PatientContextInput` for the `addPatientContext` mutation. The existing `PatientContextInput` includes a required `patientId` field which is redundant when the session already knows the patient. `startResolution` continues to accept the existing `PatientContextInput` since it needs the patient ID for initial context loading.

### Design Decisions

- Every mutation that modifies the session returns the full `ResolutionSession` -- avoids separate refetch.
- `estimatedImpact` on `PendingQuestion` is pre-computed at initial traversal and recomputed on re-traversals that affect the gate's subtree.
- `CarePlanGenerationResult` separates `warnings` (informational) from `blockers` (must resolve first).
- **`provider_id` comes from auth context**, not as a mutation input. During development with `DEV_BYPASS_AUTH=true`, fallback to a hardcoded dev provider ID (same pattern as other services). This is a known gap tracked in the project's current state assessment.

### Departure from RFC

The RFC (Section 7.2) describes the resolution API as: `startPathwayResolution` --> `resolveDecisionPoint` --> `generateCarePlanFromResolution`. This spec replaces the single `resolveDecisionPoint` mutation with three separate mutations:

- `overrideNode` -- Provider flips a node's inclusion/exclusion
- `answerGateQuestion` -- Provider answers a gate's question
- `addPatientContext` -- Provider adds clinical data

This split reflects the design evolution during brainstorming: the RFC assumed providers step through individual DecisionPoints, but the actual model is an automated traversal with three distinct types of provider interaction. A single `resolveDecisionPoint` mutation would conflate these different operations.

---

## Section 8: Database Schema

### Migration 042: Extend Resolution Sessions and Add Events

The existing `pathway_resolution_sessions` table (from migration 038) is a minimal scaffold. This migration extends it with the full resolution state and adds the events table.

```sql
BEGIN;

-- Migration 038 created pathway_resolution_sessions with minimal columns:
--   id, patient_id, provider_id, pathway_id, patient_context, status,
--   resulting_care_plan_id, started_at, completed_at, timestamps
--
-- This migration extends the table for the full resolution engine.
-- Column renames/drops address naming evolution from the scaffold.

-- 1. Rename patient_context -> initial_patient_context (clearer semantics)
ALTER TABLE pathway_resolution_sessions
  RENAME COLUMN patient_context TO initial_patient_context;

-- 2. Rename resulting_care_plan_id -> care_plan_id (consistent naming)
ALTER TABLE pathway_resolution_sessions
  RENAME COLUMN resulting_care_plan_id TO care_plan_id;

-- 3. Add new columns for full resolution state
ALTER TABLE pathway_resolution_sessions
  ADD COLUMN resolution_state JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN dependency_map JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN additional_context JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN pending_questions JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN red_flags JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN total_nodes_evaluated INT NOT NULL DEFAULT 0,
  ADD COLUMN traversal_duration_ms INT;

-- 4. Update status constraint: IN_PROGRESS -> ACTIVE, add DEGRADED
-- This is safe for pre-production: no real sessions exist yet.
-- Semantic mapping: IN_PROGRESS (038 scaffold) = ACTIVE (Plan 4 runtime)
ALTER TABLE pathway_resolution_sessions
  DROP CONSTRAINT pathway_resolution_sessions_status_check;
UPDATE pathway_resolution_sessions SET status = 'ACTIVE' WHERE status = 'IN_PROGRESS';
ALTER TABLE pathway_resolution_sessions
  ADD CONSTRAINT pathway_resolution_sessions_status_check
  CHECK (status IN ('ACTIVE', 'COMPLETED', 'ABANDONED', 'DEGRADED'));

-- 5. Snapshot pathway version at resolution time (immutable)
ALTER TABLE pathway_resolution_sessions
  ADD COLUMN pathway_version VARCHAR(20);

-- 6. Add composite index for provider's active sessions
CREATE INDEX idx_resolution_sessions_patient_provider
  ON pathway_resolution_sessions(patient_id, provider_id, status);

-- Resolution events: audit trail of every interaction
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

### Migration 043: Node Overrides and Gate Answers (Relational Analytics)

The resolution state JSONB holds the full picture for fast reads. These relational tables enable cross-session analytics ("how often do providers override this node?").

**Relationship to `pathway_resolution_decisions` (migration 038):** The existing `pathway_resolution_decisions` table tracks individual DecisionPoint resolutions (which branch was chosen, confidence, override). It is **complementary** to the new tables:
- `pathway_resolution_decisions` -- Records DecisionPoint branch selections (auto-resolved or provider-chosen)
- `pathway_node_overrides` -- Records provider overrides on any node type (include/exclude)
- `pathway_gate_answers` -- Records provider answers to Gate questions

All three tables are written during resolution interactions. `pathway_resolution_decisions` continues to serve its original purpose for DecisionPoint-specific analytics.

```sql
-- Individual node overrides (queryable across sessions)
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

CREATE INDEX idx_node_overrides_pattern
  ON pathway_node_overrides(pathway_id, node_id, action);

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

CREATE INDEX idx_gate_answers_pattern
  ON pathway_gate_answers(pathway_id, gate_id, gate_opened);
```

### Why Dual Storage (JSONB + Relational)?

- **JSONB on session:** Fast read path. Frontend fetches one session row and has everything -- no joins. Re-traversal reads/writes resolution state in-place.
- **Relational tables:** Analytics path. "Providers override node X in 40% of sessions" is a simple aggregate query. Can't efficiently query that across JSONB blobs.

Both are written in the same transaction, always consistent.

---

## Performance Expectations

| Operation | Expected Latency | Notes |
|---|---|---|
| `matchedPathways` query | 50-200ms | Relational query with GIN index |
| `startResolution` (150-node pathway) | 500ms-1s | Full BFS + confidence computation |
| `overrideNode` | 100-300ms | Scoped re-traversal, typically <10% of nodes |
| `answerGateQuestion` | 100-500ms | May open a large subtree |
| `addPatientContext` | 200-500ms | Depends on how many nodes affected |
| `generateCarePlanFromResolution` | 200-500ms | Transform + validation + safety check |

The 10s/5s timeouts provide safety nets. Pathways near the 500-node limit may be 2-3x slower.

**Implementation note:** The confidence engine (Plan 3) is called per-node during traversal. To meet the 500ms-1s target for 150-node pathways, signal weights and resolution thresholds must be batch-loaded at traversal start (one query) rather than fetched per-node. The confidence engine's `WeightCascadeResolver` already supports this pattern.

---

## What This Plan Does NOT Cover

- **Frontend UI** -- Plan 5 (depends on this plan's API surface)
- **Recommendation engine integration** -- careplan-recommender-service calling `matchedPathways` (post-MVP)
- **Multi-pathway composition** -- Resolving multiple pathways simultaneously (out of scope per RFC)
- **Outcome feedback loop** -- Tracking which resolutions led to better outcomes (deferred per RFC)
