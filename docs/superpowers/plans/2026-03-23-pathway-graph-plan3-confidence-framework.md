# Pathway Graph — Plan 3: Confidence Framework

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the confidence scoring framework that evaluates each node in a clinical pathway graph against a patient's clinical context, producing per-node and pathway-level confidence values with full signal breakdown and propagation transparency.

**Architecture:** A scorer registry pattern where each scoring signal is implemented as a discrete scorer class. Built-in scorers cover 4 clinical signals (data completeness, evidence strength, patient match quality, risk magnitude); institutions can add custom rules-based signals. A weight cascade resolver walks a 5-level override hierarchy (node → pathway → institution → organization → system default) to determine effective weights. The confidence engine orchestrates: load graph → load signals → resolve weights → score each (node, signal) pair → propagate along graph edges in topological order → compute weighted rollup. Admin CRUD mutations manage signal definitions, weight overrides, and resolution thresholds.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2.10, PostgreSQL 15, Apache AGE 1.5.0, Jest

**Spec:** `docs/superpowers/specs/2026-03-23-confidence-framework-design.md`

**Depends on:** Plan 1 (Infrastructure & Service Scaffold — merged PR #26), Plan 2 (Import Pipeline — merged)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `shared/data-layer/migrations/040_stabilize_signal_ids.sql` | Replace random UUIDs for 4 built-in signals with stable deterministic IDs |
| `shared/data-layer/migrations/041_add_propagation_config.sql` | Add `propagation_overrides` column + update built-in signal `scoring_rules` with propagation configs |
| `apps/pathway-service/src/services/confidence/types.ts` | All confidence framework interfaces, enums, and stable signal ID constants |
| `apps/pathway-service/src/services/confidence/scorer-registry.ts` | ScorerRegistry class — register/retrieve scorers by ScoringType |
| `apps/pathway-service/src/services/confidence/scorers/data-completeness.ts` | DataCompletenessScorer (`DATA_PRESENCE`) |
| `apps/pathway-service/src/services/confidence/scorers/evidence-strength.ts` | EvidenceStrengthScorer (`MAPPING_LOOKUP`) |
| `apps/pathway-service/src/services/confidence/scorers/patient-match-quality.ts` | PatientMatchQualityScorer (`CRITERIA_MATCH`) |
| `apps/pathway-service/src/services/confidence/scorers/risk-magnitude.ts` | RiskMagnitudeScorer (`RISK_INVERSE`) |
| `apps/pathway-service/src/services/confidence/scorers/custom-rules.ts` | CustomRulesScorer (`CUSTOM_RULES`) |
| `apps/pathway-service/src/services/confidence/weight-cascade-resolver.ts` | WeightCascadeResolver — resolves effective weight per (signal, node) via 5-level cascade |
| `apps/pathway-service/src/services/confidence/confidence-engine.ts` | ConfidenceEngine orchestrator — ties registry, cascade resolver, and graph together |
| `apps/pathway-service/src/services/confidence/index.ts` | Barrel export for confidence module |
| `apps/pathway-service/src/__tests__/fixtures/reference-patient-context.ts` | Realistic patient clinical data fixture for scoring tests |
| `apps/pathway-service/src/__tests__/scorer-registry.test.ts` | ScorerRegistry unit tests |
| `apps/pathway-service/src/__tests__/data-completeness-scorer.test.ts` | DataCompletenessScorer unit tests |
| `apps/pathway-service/src/__tests__/evidence-strength-scorer.test.ts` | EvidenceStrengthScorer unit tests |
| `apps/pathway-service/src/__tests__/patient-match-scorer.test.ts` | PatientMatchQualityScorer unit tests |
| `apps/pathway-service/src/__tests__/risk-magnitude-scorer.test.ts` | RiskMagnitudeScorer unit tests |
| `apps/pathway-service/src/__tests__/custom-rules-scorer.test.ts` | CustomRulesScorer unit tests |
| `apps/pathway-service/src/__tests__/weight-cascade-resolver.test.ts` | WeightCascadeResolver unit tests |
| `apps/pathway-service/src/__tests__/confidence-engine.test.ts` | ConfidenceEngine unit tests |
| `apps/pathway-service/src/__tests__/confidence-query-resolvers.test.ts` | Confidence query resolver unit tests |
| `apps/pathway-service/src/__tests__/confidence-mutation-resolvers.test.ts` | Confidence mutation resolver unit tests |

### Modified files

| File | Change |
|------|--------|
| `apps/pathway-service/schema.graphql` | Add all confidence types, inputs, enums, queries, mutations |
| `apps/pathway-service/src/types/index.ts` | Add ScoringType, SignalScope, WeightScope, ThresholdScope, PropagationMode, WeightSource enums |
| `apps/pathway-service/src/resolvers/Query.ts` | Add confidence query resolvers (pathwayConfidence, signalDefinitions, effectiveWeights, effectiveThresholds) |
| `apps/pathway-service/src/resolvers/Mutation.ts` | Add confidence admin mutation resolvers (signal CRUD, weight overrides, threshold overrides) |
| `apps/pathway-service/src/index.ts` | Initialize ScorerRegistry at startup, register built-in scorers |

---

## Chunk 1: Migrations, Types, and Test Fixture

### Task 1: Migration 040 — Stabilize Built-in Signal IDs

**Files:**
- Create: `shared/data-layer/migrations/040_stabilize_signal_ids.sql`

Migration 039 used `gen_random_uuid()` for the 4 built-in signal IDs, making them non-deterministic. This migration replaces them with stable UUIDs so test fixtures and application code can reference them reliably.

- [ ] **Step 1: Create the migration file**

```sql
-- shared/data-layer/migrations/040_stabilize_signal_ids.sql
--
-- Stabilize built-in signal definition IDs
-- Migration 039 used gen_random_uuid() which produces different IDs per deployment.
-- These stable UUIDs enable reliable test fixtures and cross-references.

BEGIN;

UPDATE confidence_signal_definitions
  SET id = '00000000-0000-4000-a000-000000000001'
  WHERE name = 'data_completeness' AND scope = 'SYSTEM';

UPDATE confidence_signal_definitions
  SET id = '00000000-0000-4000-a000-000000000002'
  WHERE name = 'evidence_strength' AND scope = 'SYSTEM';

UPDATE confidence_signal_definitions
  SET id = '00000000-0000-4000-a000-000000000003'
  WHERE name = 'match_quality' AND scope = 'SYSTEM';

UPDATE confidence_signal_definitions
  SET id = '00000000-0000-4000-a000-000000000004'
  WHERE name = 'risk_magnitude' AND scope = 'SYSTEM';

COMMIT;
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `npm run typecheck --prefix apps/pathway-service`
Expected: PASS (migration is SQL-only, no TS impact yet)

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add shared/data-layer/migrations/040_stabilize_signal_ids.sql
git -C /home/claude/workspace/prism-graphql commit -m "chore: migration 040 — stabilize built-in signal definition IDs"
```

---

### Task 2: Migration 041 — Add Propagation Config Support

**Files:**
- Create: `shared/data-layer/migrations/041_add_propagation_config.sql`

Adds `propagation_overrides` column to `confidence_node_weights` and updates the 4 built-in signal definitions with default propagation configs in their `scoring_rules` JSON.

- [ ] **Step 1: Create the migration file**

```sql
-- shared/data-layer/migrations/041_add_propagation_config.sql
--
-- Add propagation configuration support to the confidence framework.
-- 1. Add propagation_overrides column to confidence_node_weights
-- 2. Update built-in signal scoring_rules with default propagation configs

BEGIN;

-- 1. Add propagation_overrides column for per-node propagation behavior overrides
ALTER TABLE confidence_node_weights
  ADD COLUMN IF NOT EXISTS propagation_overrides JSONB DEFAULT '{}';

COMMENT ON COLUMN confidence_node_weights.propagation_overrides IS
  'Per-signal propagation config overrides. Keys are signal names, values are PropagationConfig objects. Overrides the signal-level default.';

-- 2. Add unique constraint to confidence_resolution_thresholds for upsert support
ALTER TABLE confidence_resolution_thresholds
  ADD CONSTRAINT confidence_resolution_thresholds_unique
  UNIQUE NULLS NOT DISTINCT (scope, pathway_id, node_identifier, institution_id);

-- 3. Update built-in signal definitions with default propagation configs
-- Data completeness: cascades transitively (missing upstream data degrades downstream)
UPDATE confidence_signal_definitions
  SET scoring_rules = scoring_rules || '{"propagation": {"mode": "transitive_with_decay", "decayFactor": 0.8, "maxHops": 3}}'::jsonb
  WHERE name = 'data_completeness' AND scope = 'SYSTEM';

-- Evidence strength: intrinsic to the node, does not propagate
UPDATE confidence_signal_definitions
  SET scoring_rules = scoring_rules || '{"propagation": {"mode": "none"}}'::jsonb
  WHERE name = 'evidence_strength' AND scope = 'SYSTEM';

-- Match quality: affects immediate parent only
UPDATE confidence_signal_definitions
  SET scoring_rules = scoring_rules || '{"propagation": {"mode": "direct"}}'::jsonb
  WHERE name = 'match_quality' AND scope = 'SYSTEM';

-- Risk magnitude: flags immediate decision point only
UPDATE confidence_signal_definitions
  SET scoring_rules = scoring_rules || '{"propagation": {"mode": "direct"}}'::jsonb
  WHERE name = 'risk_magnitude' AND scope = 'SYSTEM';

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add shared/data-layer/migrations/041_add_propagation_config.sql
git -C /home/claude/workspace/prism-graphql commit -m "chore: migration 041 — add propagation config to confidence framework"
```

---

### Task 3: Confidence Types

**Files:**
- Create: `apps/pathway-service/src/services/confidence/types.ts`
- Modify: `apps/pathway-service/src/types/index.ts`

All TypeScript interfaces and enums for the confidence framework.

- [ ] **Step 1: Add new enums to the service types file**

Add the following enums to `apps/pathway-service/src/types/index.ts` after the existing `ResolutionType` enum:

```typescript
// Scoring type — determines which scorer class handles the signal
export enum ScoringType {
  DATA_PRESENCE = 'DATA_PRESENCE',
  MAPPING_LOOKUP = 'MAPPING_LOOKUP',
  CRITERIA_MATCH = 'CRITERIA_MATCH',
  RISK_INVERSE = 'RISK_INVERSE',
  CUSTOM_RULES = 'CUSTOM_RULES',
}

// Signal definition scope
export enum SignalScope {
  SYSTEM = 'SYSTEM',
  ORGANIZATION = 'ORGANIZATION',
  INSTITUTION = 'INSTITUTION',
}

// Weight override scope (resolution order: NODE > PATHWAY > INSTITUTION_GLOBAL > ORGANIZATION_GLOBAL > system default)
export enum WeightScope {
  NODE = 'NODE',
  PATHWAY = 'PATHWAY',
  INSTITUTION_GLOBAL = 'INSTITUTION_GLOBAL',
  ORGANIZATION_GLOBAL = 'ORGANIZATION_GLOBAL',
}

// Threshold override scope
export enum ThresholdScope {
  SYSTEM_DEFAULT = 'SYSTEM_DEFAULT',
  ORGANIZATION = 'ORGANIZATION',
  INSTITUTION = 'INSTITUTION',
  PATHWAY = 'PATHWAY',
  NODE = 'NODE',
}

// Propagation mode
export enum PropagationMode {
  NONE = 'NONE',
  DIRECT = 'DIRECT',
  TRANSITIVE_WITH_DECAY = 'TRANSITIVE_WITH_DECAY',
}

// Where the effective weight came from in the cascade
export enum WeightSource {
  NODE_OVERRIDE = 'NODE_OVERRIDE',
  PATHWAY_OVERRIDE = 'PATHWAY_OVERRIDE',
  INSTITUTION_GLOBAL = 'INSTITUTION_GLOBAL',
  ORGANIZATION_GLOBAL = 'ORGANIZATION_GLOBAL',
  SYSTEM_DEFAULT = 'SYSTEM_DEFAULT',
}
```

- [ ] **Step 2: Create the confidence types file**

```typescript
// apps/pathway-service/src/services/confidence/types.ts

import { PathwayNodeType, PathwayEdgeType } from '../import/types';
import {
  ScoringType,
  SignalScope,
  WeightScope,
  ThresholdScope,
  PropagationMode,
  WeightSource,
  ResolutionType,
} from '../../types';

// Re-export enums for convenience
export {
  ScoringType,
  SignalScope,
  WeightScope,
  ThresholdScope,
  PropagationMode,
  WeightSource,
  ResolutionType,
};

// ─── Stable Built-in Signal IDs ──────────────────────────────────────
// These match the UUIDs set by migration 040. Use these constants in
// application code and test fixtures instead of querying by name.

export const BUILTIN_SIGNAL_IDS = {
  DATA_COMPLETENESS: '00000000-0000-4000-a000-000000000001',
  EVIDENCE_STRENGTH: '00000000-0000-4000-a000-000000000002',
  MATCH_QUALITY: '00000000-0000-4000-a000-000000000003',
  RISK_MAGNITUDE: '00000000-0000-4000-a000-000000000004',
} as const;

// ─── Graph Types ─────────────────────────────────────────────────────
// Hydrated graph data from AGE Cypher queries, used by scorers.

export interface GraphNode {
  id: string;                           // AGE internal vertex ID
  nodeIdentifier: string;               // Logical ID within pathway (e.g., "medication-amoxicillin")
  nodeType: PathwayNodeType;            // Stage, Step, DecisionPoint, etc.
  properties: Record<string, unknown>;  // All properties from the AGE vertex
}

export interface GraphEdge {
  id: string;                           // AGE internal edge ID
  edgeType: PathwayEdgeType;            // HAS_STAGE, BRANCHES_TO, etc.
  sourceId: string;                     // Source node identifier
  targetId: string;                     // Target node identifier
  properties: Record<string, unknown>;
}

export interface GraphContext {
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  incomingEdges(nodeId: string): GraphEdge[];
  outgoingEdges(nodeId: string): GraphEdge[];
  getNode(nodeId: string): GraphNode | undefined;
  linkedNodes(nodeId: string, edgeType: PathwayEdgeType | string): GraphNode[];
}

// ─── Signal Definition (DB-hydrated) ─────────────────────────────────

/**
 * Propagation config uses lowercase mode strings internally and in DB JSONB.
 * GraphQL uses the PropagationMode enum (NONE, DIRECT, TRANSITIVE_WITH_DECAY).
 * Normalize at the GraphQL boundary: resolvers convert uppercase→lowercase on input,
 * and lowercase→uppercase on output. All TypeScript code uses lowercase.
 */
export interface PropagationConfig {
  mode: 'none' | 'direct' | 'transitive_with_decay';
  decayFactor?: number;
  maxHops?: number;
  edgeTypes?: string[];
  sourceNodeTypes?: string[];
  immuneToSignals?: string[];
}

/** Convert GraphQL PropagationMode enum to internal lowercase string. */
export function normalizePropagationMode(mode: string): PropagationConfig['mode'] {
  const map: Record<string, PropagationConfig['mode']> = {
    NONE: 'none',
    DIRECT: 'direct',
    TRANSITIVE_WITH_DECAY: 'transitive_with_decay',
    // Also accept lowercase (from DB)
    none: 'none',
    direct: 'direct',
    transitive_with_decay: 'transitive_with_decay',
  };
  return map[mode] ?? 'none';
}

export interface ScoringRules {
  propagation?: PropagationConfig;
  [key: string]: unknown;              // Scorer-specific rules (e.g., rules[], mappings)
}

export interface SignalDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  scoringType: ScoringType;
  scoringRules: ScoringRules;
  propagationConfig: PropagationConfig; // Extracted from scoringRules.propagation at hydration
  scope: 'SYSTEM' | 'ORGANIZATION' | 'INSTITUTION';
  institutionId?: string;
  defaultWeight: number;
  isActive: boolean;
}

// ─── Scorer Interface ────────────────────────────────────────────────

export interface RequiredInput {
  name: string;
  source: 'patient_context' | 'graph_node' | 'linked_node';
  required: boolean;                    // false = partial credit (0.5) when missing
}

export interface SignalScore {
  score: number;                        // 0.0–1.0
  missingInputs: string[];
  metadata?: Record<string, unknown>;
}

export interface ScorerParams {
  node: GraphNode;
  signalDefinition: SignalDefinition;
  patientContext: PatientContext;
  graphContext: GraphContext;
}

export interface SignalScorer {
  readonly scoringType: ScoringType;
  declareRequiredInputs(node: GraphNode, signalConfig: SignalDefinition): RequiredInput[];
  score(params: ScorerParams): SignalScore;
  propagate?(params: PropagationParams): PropagationResult;
}

// ─── Propagation ─────────────────────────────────────────────────────

export interface PropagationParams {
  sourceNode: GraphNode;
  sourceScore: number;
  targetNode: GraphNode;
  edge: GraphEdge;
  propagationConfig: PropagationConfig;
  hopDistance: number;
}

export interface PropagationResult {
  propagatedScore: number;              // Adjusted score after decay
  shouldPropagate: boolean;             // false = stop propagation along this path
}

// ─── Patient Context ─────────────────────────────────────────────────

export interface CodeEntry {
  code: string;
  system: string;
  display?: string;
}

export interface LabResult {
  code: string;
  system: string;
  value?: number;
  unit?: string;
  date?: string;
  display?: string;
}

export interface PatientContext {
  patientId: string;
  conditionCodes: CodeEntry[];
  medications: CodeEntry[];
  labResults: LabResult[];
  allergies: CodeEntry[];
  vitalSigns?: Record<string, unknown>;
}

// ─── Weight Cascade ──────────────────────────────────────────────────

export interface ResolvedWeight {
  weight: number;
  source: WeightSource;
}

export interface NodeIdentifier {
  nodeIdentifier: string;
  nodeType: string;
}

export type WeightMatrix = Record<string, Record<string, ResolvedWeight>>;
// WeightMatrix[nodeIdentifier][signalName] → ResolvedWeight

// ─── Confidence Engine Results ───────────────────────────────────────

export interface PathwayConfidenceResult {
  pathwayId: string;
  overallConfidence: number;
  nodes: NodeConfidenceResult[];
}

export interface NodeConfidenceResult {
  nodeIdentifier: string;
  nodeType: string;
  confidence: number;
  resolutionType?: ResolutionType;      // Only for DecisionPoint nodes
  breakdown: SignalBreakdown[];
  propagationInfluences: PropagationInfluence[];
}

export interface SignalBreakdown {
  signalName: string;
  score: number;
  weight: number;
  weightSource: WeightSource;
  missingInputs: string[];
}

export interface PropagationInfluence {
  sourceNodeIdentifier: string;
  signalName: string;
  originalScore: number;
  propagatedScore: number;
  hopDistance: number;
}

// ─── Resolved Thresholds ─────────────────────────────────────────────

export interface ResolvedThresholds {
  autoResolveThreshold: number;
  suggestThreshold: number;
  scope: ThresholdScope;
}
```

- [ ] **Step 3: Run typecheck to verify types compile**

Run: `npm run typecheck --prefix apps/pathway-service`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/types/index.ts apps/pathway-service/src/services/confidence/types.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add confidence framework types and enums"
```

---

### Task 4: Reference Patient Context Test Fixture

**Files:**
- Create: `apps/pathway-service/src/__tests__/fixtures/reference-patient-context.ts`

Realistic patient clinical data fixture that pairs with the existing `REFERENCE_PATHWAY` fixture. This patient has conditions, medications, labs, and allergies that partially match the Prior Uterine Surgery pathway — deliberately leaving some data absent to exercise partial-credit and missing-input scenarios.

- [ ] **Step 1: Create the fixture file**

```typescript
// apps/pathway-service/src/__tests__/fixtures/reference-patient-context.ts

import { PatientContext } from '../../services/confidence/types';

/**
 * Reference patient: pregnant woman with prior cesarean delivery.
 * Matches REFERENCE_PATHWAY (Prior Uterine Surgery Management).
 *
 * Designed to exercise scoring scenarios:
 * - Has O34.211 (exact match for crit-1)
 * - Missing O34.29 (crit-2 match absent → partial credit)
 * - Has CBC lab (lab-1 match), but no result value → data completeness partial
 * - Has oxytocin (med-1 match)
 * - Has known allergy (penicillin) — not directly relevant but exercises allergy checking
 * - No vital signs → data completeness gap
 */
export const REFERENCE_PATIENT: PatientContext = {
  patientId: 'patient-test-001',
  conditionCodes: [
    { code: 'O34.211', system: 'ICD-10', display: 'Low transverse cesarean scar' },
    { code: 'Z87.51', system: 'ICD-10', display: 'Personal history of other complications of pregnancy' },
  ],
  medications: [
    { code: '7052', system: 'RXNORM', display: 'Oxytocin' },
    { code: '161', system: 'RXNORM', display: 'Prenatal vitamins' },
  ],
  labResults: [
    {
      code: '58410-2',
      system: 'LOINC',
      display: 'Complete Blood Count',
      // value intentionally omitted — exercises data completeness partial credit
      date: '2026-03-20',
    },
    {
      code: '718-7',
      system: 'LOINC',
      display: 'Hemoglobin',
      value: 11.5,
      unit: 'g/dL',
      date: '2026-03-20',
    },
  ],
  allergies: [
    { code: '7980', system: 'RXNORM', display: 'Penicillin' },
  ],
  // vitalSigns intentionally omitted
};

/**
 * Empty patient context — no clinical data available.
 * Exercises worst-case scoring (all missing inputs).
 */
export const EMPTY_PATIENT: PatientContext = {
  patientId: 'patient-empty-001',
  conditionCodes: [],
  medications: [],
  labResults: [],
  allergies: [],
};

/**
 * Fully-matched patient — has everything the reference pathway needs.
 * Exercises best-case scoring (all inputs present, all codes match).
 */
export const FULLY_MATCHED_PATIENT: PatientContext = {
  patientId: 'patient-full-001',
  conditionCodes: [
    { code: 'O34.211', system: 'ICD-10', display: 'Low transverse cesarean scar' },
    { code: 'O34.29', system: 'ICD-10', display: 'Prior classical or T-incision' },
  ],
  medications: [
    { code: '7052', system: 'RXNORM', display: 'Oxytocin' },
    { code: '24689', system: 'RXNORM', display: 'Dinoprostone' },
  ],
  labResults: [
    {
      code: '58410-2',
      system: 'LOINC',
      display: 'Complete Blood Count',
      value: 8.2,
      unit: '10*3/uL',
      date: '2026-03-20',
    },
  ],
  allergies: [],
  vitalSigns: {
    bloodPressure: { systolic: 120, diastolic: 78 },
    heartRate: 72,
  },
};
```

- [ ] **Step 2: Run typecheck to verify fixture compiles**

Run: `npm run typecheck --prefix apps/pathway-service`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/__tests__/fixtures/reference-patient-context.ts
git -C /home/claude/workspace/prism-graphql commit -m "test: add reference patient context fixtures for confidence scoring"
```

---

## Chunk 2: Scorer Registry and First Two Scorers

### Task 5: ScorerRegistry

**Files:**
- Create: `apps/pathway-service/src/services/confidence/scorer-registry.ts`
- Test: `apps/pathway-service/src/__tests__/scorer-registry.test.ts`

The registry maps `ScoringType` → `SignalScorer`. Built-in scorers register at startup; custom signals register dynamically via `loadCustomSignals()`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pathway-service/src/__tests__/scorer-registry.test.ts

import { ScorerRegistry } from '../services/confidence/scorer-registry';
import {
  ScoringType,
  SignalScorer,
  GraphNode,
  SignalDefinition,
  ScorerParams,
} from '../services/confidence/types';

// Minimal mock scorer for testing registry behavior
function createMockScorer(type: ScoringType): SignalScorer {
  return {
    scoringType: type,
    declareRequiredInputs: jest.fn().mockReturnValue([]),
    score: jest.fn().mockReturnValue({ score: 0.5, missingInputs: [] }),
  };
}

describe('ScorerRegistry', () => {
  let registry: ScorerRegistry;

  beforeEach(() => {
    registry = new ScorerRegistry();
  });

  describe('register', () => {
    it('should register a scorer and make it retrievable', () => {
      const scorer = createMockScorer(ScoringType.DATA_PRESENCE);
      registry.register(scorer);
      expect(registry.get(ScoringType.DATA_PRESENCE)).toBe(scorer);
    });

    it('should overwrite existing scorer for same type', () => {
      const scorer1 = createMockScorer(ScoringType.DATA_PRESENCE);
      const scorer2 = createMockScorer(ScoringType.DATA_PRESENCE);
      registry.register(scorer1);
      registry.register(scorer2);
      expect(registry.get(ScoringType.DATA_PRESENCE)).toBe(scorer2);
    });
  });

  describe('get', () => {
    it('should return undefined for unregistered type', () => {
      expect(registry.get(ScoringType.RISK_INVERSE)).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for registered type', () => {
      registry.register(createMockScorer(ScoringType.MAPPING_LOOKUP));
      expect(registry.has(ScoringType.MAPPING_LOOKUP)).toBe(true);
    });

    it('should return false for unregistered type', () => {
      expect(registry.has(ScoringType.MAPPING_LOOKUP)).toBe(false);
    });
  });

  describe('loadCustomSignals', () => {
    it('should return count of custom signal definitions', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{ count: '2' }],
        }),
      };

      const count = await registry.loadCustomSignals(mockPool as any, 'inst-1');
      expect(count).toBe(2);
    });

    it('should return 0 when no custom signals exist', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{ count: '0' }],
        }),
      };

      const count = await registry.loadCustomSignals(mockPool as any, 'inst-1');
      expect(count).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --prefix apps/pathway-service src/__tests__/scorer-registry.test.ts --no-coverage`
Expected: FAIL — cannot find module `../services/confidence/scorer-registry`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/pathway-service/src/services/confidence/scorer-registry.ts

import { Pool } from 'pg';
import { ScoringType, SignalScorer } from './types';

export class ScorerRegistry {
  private scorers: Map<ScoringType, SignalScorer> = new Map();

  register(scorer: SignalScorer): void {
    this.scorers.set(scorer.scoringType, scorer);
  }

  get(scoringType: ScoringType): SignalScorer | undefined {
    return this.scorers.get(scoringType);
  }

  has(scoringType: ScoringType): boolean {
    return this.scorers.has(scoringType);
  }

  /**
   * Load custom signal definitions from DB. If any CUSTOM_RULES signals exist,
   * the caller must have already registered a CUSTOM_RULES scorer via register().
   * This method just checks whether custom signals exist and returns the count.
   *
   * The CustomRulesScorer is registered at startup in src/index.ts alongside
   * the other built-in scorers — it does NOT need to be imported here.
   */
  async loadCustomSignals(pool: Pool, institutionId?: string): Promise<number> {
    let query = `
      SELECT COUNT(*) as count
      FROM confidence_signal_definitions
      WHERE scoring_type = 'CUSTOM_RULES' AND is_active = true
    `;
    const params: string[] = [];

    if (institutionId) {
      query += ` AND (scope = 'SYSTEM' OR (scope = 'INSTITUTION' AND institution_id = $1))`;
      params.push(institutionId);
    } else {
      query += ` AND scope = 'SYSTEM'`;
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --prefix apps/pathway-service src/__tests__/scorer-registry.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/services/confidence/scorer-registry.ts apps/pathway-service/src/__tests__/scorer-registry.test.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add ScorerRegistry for confidence framework"
```

---

### Task 6: DataCompletenessScorer

**Files:**
- Create: `apps/pathway-service/src/services/confidence/scorers/data-completeness.ts`
- Test: `apps/pathway-service/src/__tests__/data-completeness-scorer.test.ts`

Scores how much data is available for scoring a node. Node-type-specific: LabTest needs `result_value` and `result_date`, Medication needs `allergies_checked` and `interactions_checked`, DecisionPoint needs all criteria resolved. Propagates transitively with decay (missing upstream data degrades downstream).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pathway-service/src/__tests__/data-completeness-scorer.test.ts

import { DataCompletenessScorer } from '../services/confidence/scorers/data-completeness';
import {
  GraphNode,
  GraphEdge,
  GraphContext,
  SignalDefinition,
  ScorerParams,
  PatientContext,
  ScoringType,
  PropagationConfig,
} from '../services/confidence/types';
import { REFERENCE_PATIENT, EMPTY_PATIENT } from './fixtures/reference-patient-context';

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'age-1',
    nodeIdentifier: 'lab-1',
    nodeType: 'LabTest',
    properties: { name: 'Complete Blood Count', code_system: 'LOINC', code_value: '58410-2' },
    ...overrides,
  };
}

function makeSignalDef(): SignalDefinition {
  return {
    id: '00000000-0000-4000-a000-000000000001',
    name: 'data_completeness',
    displayName: 'Data Completeness',
    description: 'Measures data availability',
    scoringType: ScoringType.DATA_PRESENCE,
    scoringRules: {},
    propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
    scope: 'SYSTEM',
    defaultWeight: 0.30,
    isActive: true,
  };
}

function makeGraphContext(nodes: GraphNode[] = [], edges: GraphEdge[] = []): GraphContext {
  return {
    allNodes: nodes,
    allEdges: edges,
    incomingEdges: (nodeId: string) => edges.filter(e => e.targetId === nodeId),
    outgoingEdges: (nodeId: string) => edges.filter(e => e.sourceId === nodeId),
    getNode: (nodeId: string) => nodes.find(n => n.nodeIdentifier === nodeId),
    linkedNodes: (nodeId: string, edgeType: string) => {
      const targetIds = edges
        .filter(e => e.sourceId === nodeId && e.edgeType === edgeType)
        .map(e => e.targetId);
      return nodes.filter(n => targetIds.includes(n.nodeIdentifier));
    },
  };
}

describe('DataCompletenessScorer', () => {
  const scorer = new DataCompletenessScorer();

  it('should have scoringType DATA_PRESENCE', () => {
    expect(scorer.scoringType).toBe(ScoringType.DATA_PRESENCE);
  });

  describe('declareRequiredInputs', () => {
    it('should require result_value and result_date for LabTest nodes', () => {
      const node = makeNode({ nodeType: 'LabTest' });
      const inputs = scorer.declareRequiredInputs(node, makeSignalDef());
      const names = inputs.map(i => i.name);
      expect(names).toContain('result_value');
      expect(names).toContain('result_date');
    });

    it('should require allergies_checked and interactions_checked for Medication nodes', () => {
      const node = makeNode({ nodeType: 'Medication', nodeIdentifier: 'med-1', properties: { name: 'Oxytocin', role: 'acceptable' } });
      const inputs = scorer.declareRequiredInputs(node, makeSignalDef());
      const names = inputs.map(i => i.name);
      expect(names).toContain('allergies_checked');
      expect(names).toContain('interactions_checked');
    });
  });

  describe('score', () => {
    it('should score 1.0 when a LabTest has a matching lab result with value', () => {
      const node = makeNode({
        nodeType: 'LabTest',
        properties: { name: 'CBC', code_system: 'LOINC', code_value: '58410-2' },
      });
      const patient: PatientContext = {
        ...REFERENCE_PATIENT,
        labResults: [{ code: '58410-2', system: 'LOINC', value: 8.2, unit: '10*3/uL', date: '2026-03-20' }],
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: patient,
        graphContext: makeGraphContext([node]),
      });
      expect(result.score).toBe(1.0);
      expect(result.missingInputs).toHaveLength(0);
    });

    it('should score 0.5 when a LabTest has a matching result but no value', () => {
      const node = makeNode({
        nodeType: 'LabTest',
        properties: { name: 'CBC', code_system: 'LOINC', code_value: '58410-2' },
      });
      const patient: PatientContext = {
        ...REFERENCE_PATIENT,
        labResults: [{ code: '58410-2', system: 'LOINC', date: '2026-03-20' }],
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: patient,
        graphContext: makeGraphContext([node]),
      });
      expect(result.score).toBe(0.5);
      expect(result.missingInputs).toContain('result_value');
    });

    it('should score 0.0 when no matching lab result exists', () => {
      const node = makeNode({
        nodeType: 'LabTest',
        properties: { name: 'CBC', code_system: 'LOINC', code_value: '58410-2' },
      });
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: EMPTY_PATIENT,
        graphContext: makeGraphContext([node]),
      });
      expect(result.score).toBe(0.0);
      expect(result.missingInputs).toContain('result_value');
      expect(result.missingInputs).toContain('result_date');
    });

    it('should return 1.0 for Stage nodes (always complete)', () => {
      const node = makeNode({
        nodeType: 'Stage',
        nodeIdentifier: 'stage-1',
        properties: { stage_number: 1, title: 'Assessment' },
      });
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext([node]),
      });
      expect(result.score).toBe(1.0);
    });
  });

  describe('propagate', () => {
    it('should apply decay factor per hop for transitive_with_decay', () => {
      const result = scorer.propagate!({
        sourceNode: makeNode({ nodeIdentifier: 'lab-1' }),
        sourceScore: 0.4,
        targetNode: makeNode({ nodeIdentifier: 'step-1', nodeType: 'Step' }),
        edge: { id: 'e1', edgeType: 'HAS_LAB_TEST', sourceId: 'step-1', targetId: 'lab-1', properties: {} },
        propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
        hopDistance: 1,
      });
      expect(result.propagatedScore).toBeCloseTo(0.32); // 0.4 * 0.8
      expect(result.shouldPropagate).toBe(true);
    });

    it('should stop propagation when maxHops exceeded', () => {
      const result = scorer.propagate!({
        sourceNode: makeNode({ nodeIdentifier: 'lab-1' }),
        sourceScore: 0.4,
        targetNode: makeNode({ nodeIdentifier: 'step-1', nodeType: 'Step' }),
        edge: { id: 'e1', edgeType: 'HAS_LAB_TEST', sourceId: 'step-1', targetId: 'lab-1', properties: {} },
        propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
        hopDistance: 4,
      });
      expect(result.shouldPropagate).toBe(false);
    });

    it('should return shouldPropagate false for mode none', () => {
      const result = scorer.propagate!({
        sourceNode: makeNode({ nodeIdentifier: 'lab-1' }),
        sourceScore: 0.4,
        targetNode: makeNode({ nodeIdentifier: 'step-1', nodeType: 'Step' }),
        edge: { id: 'e1', edgeType: 'HAS_LAB_TEST', sourceId: 'step-1', targetId: 'lab-1', properties: {} },
        propagationConfig: { mode: 'none' },
        hopDistance: 1,
      });
      expect(result.shouldPropagate).toBe(false);
      expect(result.propagatedScore).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --prefix apps/pathway-service src/__tests__/data-completeness-scorer.test.ts --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the implementation**

```typescript
// apps/pathway-service/src/services/confidence/scorers/data-completeness.ts

import {
  SignalScorer,
  ScoringType,
  GraphNode,
  SignalDefinition,
  RequiredInput,
  SignalScore,
  ScorerParams,
  PropagationParams,
  PropagationResult,
  PatientContext,
} from '../types';

/**
 * Scores data availability for a node. Node-type-specific required inputs:
 * - LabTest: result_value, result_date
 * - Medication: allergies_checked, interactions_checked
 * - DecisionPoint: criteria inputs resolved
 * - Stage/Step/EvidenceCitation/etc.: always 1.0 (structural nodes, no data dependency)
 *
 * Propagation: transitive_with_decay (default). Missing upstream data degrades downstream.
 */
export class DataCompletenessScorer implements SignalScorer {
  readonly scoringType = ScoringType.DATA_PRESENCE;

  declareRequiredInputs(node: GraphNode, _signalConfig: SignalDefinition): RequiredInput[] {
    switch (node.nodeType) {
      case 'LabTest':
        return [
          { name: 'result_value', source: 'patient_context', required: true },
          { name: 'result_date', source: 'patient_context', required: false },
        ];
      case 'Medication':
        return [
          { name: 'allergies_checked', source: 'patient_context', required: true },
          { name: 'interactions_checked', source: 'patient_context', required: false },
        ];
      case 'DecisionPoint':
        return [
          { name: 'criteria_resolved', source: 'graph_node', required: true },
        ];
      case 'Criterion':
        return [
          { name: 'code_match', source: 'patient_context', required: true },
        ];
      default:
        // Structural nodes (Stage, Step, EvidenceCitation, etc.) — no data dependency
        return [];
    }
  }

  score(params: ScorerParams): SignalScore {
    const { node, patientContext } = params;

    switch (node.nodeType) {
      case 'LabTest':
        return this.scoreLabTest(node, patientContext);
      case 'Medication':
        return this.scoreMedication(node, patientContext);
      case 'Criterion':
        return this.scoreCriterion(node, patientContext);
      case 'DecisionPoint':
        return this.scoreDecisionPoint(node, params);
      default:
        // Structural nodes always complete
        return { score: 1.0, missingInputs: [] };
    }
  }

  propagate(params: PropagationParams): PropagationResult {
    const { sourceScore, propagationConfig, hopDistance } = params;

    if (propagationConfig.mode === 'none') {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    if (propagationConfig.mode === 'direct') {
      return {
        propagatedScore: sourceScore,
        shouldPropagate: false, // direct = one hop only
      };
    }

    // transitive_with_decay
    const maxHops = propagationConfig.maxHops ?? 3;
    if (hopDistance > maxHops) {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    const decay = propagationConfig.decayFactor ?? 0.8;
    return {
      propagatedScore: sourceScore * decay,
      shouldPropagate: hopDistance < maxHops,
    };
  }

  private scoreLabTest(node: GraphNode, patient: PatientContext): SignalScore {
    const codeValue = node.properties.code_value as string | undefined;
    const missingInputs: string[] = [];
    let available = 0;
    let total = 2; // result_value + result_date

    if (!codeValue) {
      return { score: 0.0, missingInputs: ['result_value', 'result_date'] };
    }

    const matchingLab = patient.labResults.find(l => l.code === codeValue);
    if (!matchingLab) {
      return { score: 0.0, missingInputs: ['result_value', 'result_date'] };
    }

    if (matchingLab.value !== undefined && matchingLab.value !== null) {
      available += 1;
    } else {
      missingInputs.push('result_value');
    }

    if (matchingLab.date) {
      available += 1;
    } else {
      missingInputs.push('result_date');
    }

    return { score: available / total, missingInputs };
  }

  private scoreMedication(node: GraphNode, patient: PatientContext): SignalScore {
    const missingInputs: string[] = [];
    let available = 0;
    let total = 2;

    // Check if allergies have been assessed (patient has allergy data)
    if (patient.allergies.length > 0) {
      available += 1;
    } else {
      missingInputs.push('allergies_checked');
    }

    // Check if medication interactions are assessable (patient has medication list)
    if (patient.medications.length > 0) {
      available += 1;
    } else {
      missingInputs.push('interactions_checked');
    }

    return { score: available / total, missingInputs };
  }

  private scoreCriterion(node: GraphNode, patient: PatientContext): SignalScore {
    const codeValue = node.properties.code_value as string | undefined;
    const codeSystem = node.properties.code_system as string | undefined;

    if (!codeValue || !codeSystem) {
      return { score: 0.5, missingInputs: ['code_match'], metadata: { reason: 'no_code_on_criterion' } };
    }

    const hasMatch = patient.conditionCodes.some(
      c => c.code === codeValue && c.system === codeSystem
    );

    if (hasMatch) {
      return { score: 1.0, missingInputs: [] };
    }

    return { score: 0.0, missingInputs: ['code_match'] };
  }

  private scoreDecisionPoint(node: GraphNode, params: ScorerParams): SignalScore {
    const { graphContext } = params;
    // Check how many criteria are connected and have data
    const criteria = graphContext.linkedNodes(node.nodeIdentifier, 'HAS_CRITERION');

    if (criteria.length === 0) {
      return { score: 1.0, missingInputs: [] }; // No criteria = nothing to check
    }

    let resolved = 0;
    const missingInputs: string[] = [];

    for (const crit of criteria) {
      const critScore = this.scoreCriterion(crit, params.patientContext);
      if (critScore.score > 0) {
        resolved++;
      } else {
        missingInputs.push(`criterion_${crit.nodeIdentifier}`);
      }
    }

    return {
      score: resolved / criteria.length,
      missingInputs,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --prefix apps/pathway-service src/__tests__/data-completeness-scorer.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/services/confidence/scorers/data-completeness.ts apps/pathway-service/src/__tests__/data-completeness-scorer.test.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add DataCompletenessScorer (DATA_PRESENCE)"
```

---

### Task 7: EvidenceStrengthScorer

**Files:**
- Create: `apps/pathway-service/src/services/confidence/scorers/evidence-strength.ts`
- Test: `apps/pathway-service/src/__tests__/evidence-strength-scorer.test.ts`

Maps evidence levels to scores. Traverses `CITES_EVIDENCE` edges to find `EvidenceCitation` nodes. Uses highest evidence level when multiple citations exist. Propagation: `none` (evidence quality is intrinsic).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pathway-service/src/__tests__/evidence-strength-scorer.test.ts

import { EvidenceStrengthScorer } from '../services/confidence/scorers/evidence-strength';
import {
  GraphNode,
  GraphEdge,
  GraphContext,
  SignalDefinition,
  ScoringType,
} from '../services/confidence/types';
import { REFERENCE_PATIENT } from './fixtures/reference-patient-context';

function makeSignalDef(): SignalDefinition {
  return {
    id: '00000000-0000-4000-a000-000000000002',
    name: 'evidence_strength',
    displayName: 'Evidence Strength',
    description: 'Maps evidence levels',
    scoringType: ScoringType.MAPPING_LOOKUP,
    scoringRules: {
      mappings: {
        'Level A': 0.95,
        'Level B': 0.80,
        'Level C': 0.65,
        'Expert Consensus': 0.60,
      },
      default_score: 0.30,
    },
    propagationConfig: { mode: 'none' },
    scope: 'SYSTEM',
    defaultWeight: 0.25,
    isActive: true,
  };
}

function makeGraphContext(nodes: GraphNode[], edges: GraphEdge[]): GraphContext {
  return {
    allNodes: nodes,
    allEdges: edges,
    incomingEdges: (nodeId) => edges.filter(e => e.targetId === nodeId),
    outgoingEdges: (nodeId) => edges.filter(e => e.sourceId === nodeId),
    getNode: (nodeId) => nodes.find(n => n.nodeIdentifier === nodeId),
    linkedNodes: (nodeId, edgeType) => {
      const targetIds = edges
        .filter(e => e.sourceId === nodeId && e.edgeType === edgeType)
        .map(e => e.targetId);
      return nodes.filter(n => targetIds.includes(n.nodeIdentifier));
    },
  };
}

describe('EvidenceStrengthScorer', () => {
  const scorer = new EvidenceStrengthScorer();

  it('should have scoringType MAPPING_LOOKUP', () => {
    expect(scorer.scoringType).toBe(ScoringType.MAPPING_LOOKUP);
  });

  it('should score 0.95 for a node with Level A evidence', () => {
    const evidenceNode: GraphNode = {
      id: 'age-ev1', nodeIdentifier: 'ev-1', nodeType: 'EvidenceCitation',
      properties: { evidence_level: 'Level A', title: 'ACOG Bulletin' },
    };
    const dpNode: GraphNode = {
      id: 'age-dp1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint',
      properties: { title: 'Delivery Decision' },
    };
    const edge: GraphEdge = {
      id: 'e1', edgeType: 'CITES_EVIDENCE', sourceId: 'dp-1', targetId: 'ev-1', properties: {},
    };

    const result = scorer.score({
      node: dpNode,
      signalDefinition: makeSignalDef(),
      patientContext: REFERENCE_PATIENT,
      graphContext: makeGraphContext([dpNode, evidenceNode], [edge]),
    });

    expect(result.score).toBe(0.95);
    expect(result.missingInputs).toHaveLength(0);
  });

  it('should use the highest evidence level when multiple citations exist', () => {
    const evA: GraphNode = {
      id: 'age-ev1', nodeIdentifier: 'ev-1', nodeType: 'EvidenceCitation',
      properties: { evidence_level: 'Level B' },
    };
    const evB: GraphNode = {
      id: 'age-ev2', nodeIdentifier: 'ev-2', nodeType: 'EvidenceCitation',
      properties: { evidence_level: 'Level A' },
    };
    const dpNode: GraphNode = {
      id: 'age-dp1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint',
      properties: { title: 'Decision' },
    };
    const edges: GraphEdge[] = [
      { id: 'e1', edgeType: 'CITES_EVIDENCE', sourceId: 'dp-1', targetId: 'ev-1', properties: {} },
      { id: 'e2', edgeType: 'CITES_EVIDENCE', sourceId: 'dp-1', targetId: 'ev-2', properties: {} },
    ];

    const result = scorer.score({
      node: dpNode,
      signalDefinition: makeSignalDef(),
      patientContext: REFERENCE_PATIENT,
      graphContext: makeGraphContext([dpNode, evA, evB], edges),
    });

    expect(result.score).toBe(0.95); // Takes highest (Level A)
  });

  it('should score 0.30 (default) when no evidence linked', () => {
    const dpNode: GraphNode = {
      id: 'age-dp1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint',
      properties: { title: 'Decision' },
    };

    const result = scorer.score({
      node: dpNode,
      signalDefinition: makeSignalDef(),
      patientContext: REFERENCE_PATIENT,
      graphContext: makeGraphContext([dpNode], []),
    });

    expect(result.score).toBe(0.30);
    expect(result.missingInputs).toContain('evidence_level');
  });

  it('should read evidence_level directly from EvidenceCitation nodes', () => {
    const evNode: GraphNode = {
      id: 'age-ev1', nodeIdentifier: 'ev-1', nodeType: 'EvidenceCitation',
      properties: { evidence_level: 'Level C', title: 'Study' },
    };

    const result = scorer.score({
      node: evNode,
      signalDefinition: makeSignalDef(),
      patientContext: REFERENCE_PATIENT,
      graphContext: makeGraphContext([evNode], []),
    });

    expect(result.score).toBe(0.65);
  });

  it('should not have a propagate method (evidence is intrinsic)', () => {
    expect(scorer.propagate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --prefix apps/pathway-service src/__tests__/evidence-strength-scorer.test.ts --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the implementation**

```typescript
// apps/pathway-service/src/services/confidence/scorers/evidence-strength.ts

import {
  SignalScorer,
  ScoringType,
  GraphNode,
  SignalDefinition,
  RequiredInput,
  SignalScore,
  ScorerParams,
} from '../types';

// Default evidence level score mappings (can be overridden via scoring_rules.mappings)
const DEFAULT_EVIDENCE_SCORES: Record<string, number> = {
  'Level A': 0.95,
  'Level B': 0.80,
  'Level C': 0.65,
  'Expert Consensus': 0.60,
};

const DEFAULT_SCORE = 0.30;

/**
 * Maps evidence levels to confidence scores. Looks for evidence_level on the node
 * itself (for EvidenceCitation nodes) or on linked EvidenceCitation nodes via
 * CITES_EVIDENCE edges. Uses the highest evidence level when multiple citations exist.
 *
 * Propagation: none. Evidence quality is intrinsic to the node.
 */
export class EvidenceStrengthScorer implements SignalScorer {
  readonly scoringType = ScoringType.MAPPING_LOOKUP;

  declareRequiredInputs(node: GraphNode, _signalConfig: SignalDefinition): RequiredInput[] {
    return [
      { name: 'evidence_level', source: node.nodeType === 'EvidenceCitation' ? 'graph_node' : 'linked_node', required: false },
    ];
  }

  score(params: ScorerParams): SignalScore {
    const { node, signalDefinition, graphContext } = params;

    const mappings = (signalDefinition.scoringRules.mappings as Record<string, number>) ?? DEFAULT_EVIDENCE_SCORES;
    const defaultScore = (signalDefinition.scoringRules.default_score as number) ?? DEFAULT_SCORE;

    // Collect evidence levels: from the node itself + from linked EvidenceCitation nodes
    const evidenceLevels: string[] = [];

    // Direct property on the node (for EvidenceCitation nodes)
    const directLevel = node.properties.evidence_level as string | undefined;
    if (directLevel) {
      evidenceLevels.push(directLevel);
    }

    // Linked EvidenceCitation nodes via CITES_EVIDENCE edges
    const linkedCitations = graphContext.linkedNodes(node.nodeIdentifier, 'CITES_EVIDENCE');
    for (const citation of linkedCitations) {
      const level = citation.properties.evidence_level as string | undefined;
      if (level) {
        evidenceLevels.push(level);
      }
    }

    if (evidenceLevels.length === 0) {
      return {
        score: defaultScore,
        missingInputs: ['evidence_level'],
        metadata: { reason: 'no_evidence_citations' },
      };
    }

    // Use the highest evidence level score
    let bestScore = defaultScore;
    for (const level of evidenceLevels) {
      const levelScore = mappings[level] ?? defaultScore;
      if (levelScore > bestScore) {
        bestScore = levelScore;
      }
    }

    return {
      score: bestScore,
      missingInputs: [],
      metadata: { evidenceLevels, bestLevel: evidenceLevels.find(l => (mappings[l] ?? defaultScore) === bestScore) },
    };
  }

  // No propagate method — evidence quality is intrinsic (mode: none)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --prefix apps/pathway-service src/__tests__/evidence-strength-scorer.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/services/confidence/scorers/evidence-strength.ts apps/pathway-service/src/__tests__/evidence-strength-scorer.test.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add EvidenceStrengthScorer (MAPPING_LOOKUP)"
```

---

## Chunk 3: Remaining Scorers

### Task 8: PatientMatchQualityScorer

**Files:**
- Create: `apps/pathway-service/src/services/confidence/scorers/patient-match-quality.ts`
- Test: `apps/pathway-service/src/__tests__/patient-match-scorer.test.ts`

Scores how well the patient's clinical codes match the node's expected codes. Weighted: exact 1.0, parent prefix 0.7, inferred 0.5, absent 0.0. Critical criteria missing → capped at 0.5. Propagation: `direct` (one hop only).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pathway-service/src/__tests__/patient-match-scorer.test.ts

import { PatientMatchQualityScorer } from '../services/confidence/scorers/patient-match-quality';
import {
  GraphNode,
  GraphContext,
  SignalDefinition,
  ScoringType,
  PatientContext,
} from '../services/confidence/types';
import { REFERENCE_PATIENT, EMPTY_PATIENT, FULLY_MATCHED_PATIENT } from './fixtures/reference-patient-context';

function makeSignalDef(): SignalDefinition {
  return {
    id: '00000000-0000-4000-a000-000000000003',
    name: 'match_quality',
    displayName: 'Patient Match Quality',
    description: 'Matches patient codes',
    scoringType: ScoringType.CRITERIA_MATCH,
    scoringRules: {},
    propagationConfig: { mode: 'direct' },
    scope: 'SYSTEM',
    defaultWeight: 0.25,
    isActive: true,
  };
}

function makeGraphContext(): GraphContext {
  return {
    allNodes: [],
    allEdges: [],
    incomingEdges: () => [],
    outgoingEdges: () => [],
    getNode: () => undefined,
    linkedNodes: () => [],
  };
}

describe('PatientMatchQualityScorer', () => {
  const scorer = new PatientMatchQualityScorer();

  it('should have scoringType CRITERIA_MATCH', () => {
    expect(scorer.scoringType).toBe(ScoringType.CRITERIA_MATCH);
  });

  describe('score', () => {
    it('should score 1.0 for a Criterion with exact code match', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-1', nodeType: 'Criterion',
        properties: { code_system: 'ICD-10', code_value: 'O34.211', is_critical: true },
      };

      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT, // Has O34.211
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBe(1.0);
    });

    it('should score 0.7 for a parent prefix match (e.g., O34.2 matches O34.211)', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-x', nodeType: 'Criterion',
        properties: { code_system: 'ICD-10', code_value: 'O34.2', is_critical: false },
      };

      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT, // Has O34.211 which starts with O34.2
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBe(0.7);
    });

    it('should score 0.0 for no match at all', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-2', nodeType: 'Criterion',
        properties: { code_system: 'ICD-10', code_value: 'O34.29', is_critical: true },
      };

      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT, // Does NOT have O34.29
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBe(0.0);
    });

    it('should cap at 0.5 when a critical criterion is missing', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-2', nodeType: 'Criterion',
        properties: { code_system: 'ICD-10', code_value: 'O34.29', is_critical: true },
      };

      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: EMPTY_PATIENT,
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBeLessThanOrEqual(0.5);
    });

    it('should score 1.0 for Medication nodes when patient has matching med', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'med-1', nodeType: 'Medication',
        properties: { name: 'Oxytocin' },
      };

      // REFERENCE_PATIENT has Oxytocin (RXNORM 7052)
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });

      // Medication match is about relevance, not code — should still produce a valid score
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it('should return 1.0 for nodes without matchable codes (e.g., Stage)', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'stage-1', nodeType: 'Stage',
        properties: { stage_number: 1, title: 'Assessment' },
      };

      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBe(1.0);
    });
  });

  describe('propagate', () => {
    it('should propagate with direct mode (one hop, no further)', () => {
      const result = scorer.propagate!({
        sourceNode: { id: '1', nodeIdentifier: 'crit-1', nodeType: 'Criterion', properties: {} },
        sourceScore: 0.7,
        targetNode: { id: '2', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: {} },
        edge: { id: 'e1', edgeType: 'HAS_CRITERION', sourceId: 'dp-1', targetId: 'crit-1', properties: {} },
        propagationConfig: { mode: 'direct' },
        hopDistance: 1,
      });

      expect(result.propagatedScore).toBe(0.7);
      expect(result.shouldPropagate).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --prefix apps/pathway-service src/__tests__/patient-match-scorer.test.ts --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the implementation**

```typescript
// apps/pathway-service/src/services/confidence/scorers/patient-match-quality.ts

import {
  SignalScorer,
  ScoringType,
  GraphNode,
  SignalDefinition,
  RequiredInput,
  SignalScore,
  ScorerParams,
  PropagationParams,
  PropagationResult,
  PatientContext,
  CodeEntry,
} from '../types';

/**
 * Scores how well the patient's clinical codes match a node's expected codes.
 * Match levels: exact 1.0, parent prefix 0.7, inferred 0.5, absent 0.0.
 * Critical criteria missing → score capped at 0.5.
 *
 * Propagation: direct (one hop — a poorly matched criterion affects its parent
 * DecisionPoint but doesn't cascade further).
 */
export class PatientMatchQualityScorer implements SignalScorer {
  readonly scoringType = ScoringType.CRITERIA_MATCH;

  declareRequiredInputs(node: GraphNode, _signalConfig: SignalDefinition): RequiredInput[] {
    if (node.nodeType === 'Criterion' || node.nodeType === 'Medication' || node.nodeType === 'LabTest') {
      return [
        { name: 'condition_codes', source: 'patient_context', required: true },
        { name: 'medications', source: 'patient_context', required: false },
        { name: 'lab_results', source: 'patient_context', required: false },
      ];
    }
    return [];
  }

  score(params: ScorerParams): SignalScore {
    const { node, patientContext } = params;

    switch (node.nodeType) {
      case 'Criterion':
        return this.scoreCriterion(node, patientContext);
      case 'Medication':
        return this.scoreMedication(node, patientContext);
      case 'LabTest':
        return this.scoreLabTest(node, patientContext);
      default:
        // Structural nodes — not matchable, score 1.0
        return { score: 1.0, missingInputs: [] };
    }
  }

  propagate(params: PropagationParams): PropagationResult {
    const { sourceScore, propagationConfig } = params;

    if (propagationConfig.mode === 'none') {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    // direct mode: pass score through, but don't propagate further
    return {
      propagatedScore: sourceScore,
      shouldPropagate: false,
    };
  }

  private scoreCriterion(node: GraphNode, patient: PatientContext): SignalScore {
    const codeValue = node.properties.code_value as string | undefined;
    const codeSystem = node.properties.code_system as string | undefined;
    const isCritical = node.properties.is_critical as boolean | undefined;

    if (!codeValue || !codeSystem) {
      return { score: 0.5, missingInputs: ['code_value'], metadata: { reason: 'no_code_on_criterion' } };
    }

    const codes = this.getCodesForSystem(patient, codeSystem);
    const matchScore = this.findBestMatch(codeValue, codes);

    // Critical criteria missing → cap at 0.5
    if (isCritical && matchScore === 0.0) {
      return {
        score: 0.0,
        missingInputs: ['code_match'],
        metadata: { critical: true, expectedCode: codeValue },
      };
    }

    return {
      score: matchScore,
      missingInputs: matchScore === 0.0 ? ['code_match'] : [],
      metadata: { matchType: matchScore === 1.0 ? 'exact' : matchScore === 0.7 ? 'prefix' : matchScore === 0.5 ? 'inferred' : 'absent' },
    };
  }

  private scoreMedication(node: GraphNode, patient: PatientContext): SignalScore {
    // For medications, check if the patient is currently on a related medication
    // This is a softer match — by name or code
    const medName = (node.properties.name as string || '').toLowerCase();

    const hasMatch = patient.medications.some(
      m => m.display?.toLowerCase().includes(medName) || medName.includes(m.display?.toLowerCase() || '')
    );

    return {
      score: hasMatch ? 1.0 : 0.5,
      missingInputs: hasMatch ? [] : ['medication_match'],
    };
  }

  private scoreLabTest(node: GraphNode, patient: PatientContext): SignalScore {
    const codeValue = node.properties.code_value as string | undefined;
    if (!codeValue) {
      return { score: 0.5, missingInputs: [], metadata: { reason: 'no_code_on_lab' } };
    }

    const hasMatch = patient.labResults.some(l => l.code === codeValue);
    return {
      score: hasMatch ? 1.0 : 0.0,
      missingInputs: hasMatch ? [] : ['lab_match'],
    };
  }

  private getCodesForSystem(patient: PatientContext, system: string): string[] {
    // Combine all patient codes from relevant sources
    const codes: string[] = [];
    for (const c of patient.conditionCodes) {
      if (c.system === system) codes.push(c.code);
    }
    for (const m of patient.medications) {
      if (m.system === system) codes.push(m.code);
    }
    for (const l of patient.labResults) {
      if (l.system === system) codes.push(l.code);
    }
    return codes;
  }

  private findBestMatch(targetCode: string, patientCodes: string[]): number {
    // Exact match
    if (patientCodes.includes(targetCode)) {
      return 1.0;
    }

    // Parent prefix match: patient has a code that starts with or is a prefix of the target
    for (const code of patientCodes) {
      if (code.startsWith(targetCode) || targetCode.startsWith(code)) {
        return 0.7;
      }
    }

    // No match
    return 0.0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --prefix apps/pathway-service src/__tests__/patient-match-scorer.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/services/confidence/scorers/patient-match-quality.ts apps/pathway-service/src/__tests__/patient-match-scorer.test.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add PatientMatchQualityScorer (CRITERIA_MATCH)"
```

---

### Task 9: RiskMagnitudeScorer

**Files:**
- Create: `apps/pathway-service/src/services/confidence/scorers/risk-magnitude.ts`
- Test: `apps/pathway-service/src/__tests__/risk-magnitude-scorer.test.ts`

Inverse risk scoring: higher risk → lower confidence. Formula: `max(0.10, 1.0 - (log10(risk * 1000 + 1) / 3.0))`. No data → 0.50. Propagation: `direct`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pathway-service/src/__tests__/risk-magnitude-scorer.test.ts

import { RiskMagnitudeScorer } from '../services/confidence/scorers/risk-magnitude';
import {
  GraphNode,
  GraphContext,
  SignalDefinition,
  ScoringType,
} from '../services/confidence/types';
import { REFERENCE_PATIENT } from './fixtures/reference-patient-context';

function makeSignalDef(): SignalDefinition {
  return {
    id: '00000000-0000-4000-a000-000000000004',
    name: 'risk_magnitude',
    displayName: 'Risk Magnitude',
    description: 'Inverse risk scoring',
    scoringType: ScoringType.RISK_INVERSE,
    scoringRules: {},
    propagationConfig: { mode: 'direct' },
    scope: 'SYSTEM',
    defaultWeight: 0.20,
    isActive: true,
  };
}

function makeGraphContext(): GraphContext {
  return {
    allNodes: [],
    allEdges: [],
    incomingEdges: () => [],
    outgoingEdges: () => [],
    getNode: () => undefined,
    linkedNodes: () => [],
  };
}

describe('RiskMagnitudeScorer', () => {
  const scorer = new RiskMagnitudeScorer();

  it('should have scoringType RISK_INVERSE', () => {
    expect(scorer.scoringType).toBe(ScoringType.RISK_INVERSE);
  });

  describe('score', () => {
    it('should score high confidence for very low risk (0.001)', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-1', nodeType: 'Criterion',
        properties: { base_rate: 0.001 },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      // max(0.10, 1.0 - (log10(0.001 * 1000 + 1) / 3.0))
      // = max(0.10, 1.0 - (log10(2) / 3.0))
      // = max(0.10, 1.0 - 0.1003) ≈ 0.90
      expect(result.score).toBeGreaterThan(0.85);
      expect(result.score).toBeLessThan(0.95);
    });

    it('should score low confidence for high risk (0.10)', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-x', nodeType: 'Criterion',
        properties: { base_rate: 0.10 },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      // max(0.10, 1.0 - (log10(100 + 1) / 3.0))
      // = max(0.10, 1.0 - (2.004 / 3.0))
      // = max(0.10, 1.0 - 0.668) ≈ 0.33
      expect(result.score).toBeGreaterThan(0.25);
      expect(result.score).toBeLessThan(0.45);
    });

    it('should floor at 0.10 for extreme risk', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-x', nodeType: 'Criterion',
        properties: { base_rate: 1.0 },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.10);
    });

    it('should score 0.50 when no risk data available', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'stage-1', nodeType: 'Stage',
        properties: { stage_number: 1, title: 'Assessment' },
      };
      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });
      expect(result.score).toBe(0.50);
      expect(result.missingInputs).toContain('risk_value');
    });
  });

  describe('propagate', () => {
    it('should propagate with direct mode', () => {
      const result = scorer.propagate!({
        sourceNode: { id: '1', nodeIdentifier: 'crit-1', nodeType: 'Criterion', properties: {} },
        sourceScore: 0.3,
        targetNode: { id: '2', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: {} },
        edge: { id: 'e1', edgeType: 'HAS_CRITERION', sourceId: 'dp-1', targetId: 'crit-1', properties: {} },
        propagationConfig: { mode: 'direct' },
        hopDistance: 1,
      });

      expect(result.propagatedScore).toBe(0.3);
      expect(result.shouldPropagate).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --prefix apps/pathway-service src/__tests__/risk-magnitude-scorer.test.ts --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the implementation**

```typescript
// apps/pathway-service/src/services/confidence/scorers/risk-magnitude.ts

import {
  SignalScorer,
  ScoringType,
  GraphNode,
  SignalDefinition,
  RequiredInput,
  SignalScore,
  ScorerParams,
  PropagationParams,
  PropagationResult,
} from '../types';

const NO_DATA_SCORE = 0.50;
const FLOOR_SCORE = 0.10;

/**
 * Inverse risk scoring: higher risk → lower confidence.
 * Formula: max(0.10, 1.0 - (log10(risk * 1000 + 1) / 3.0))
 * No data → 0.50.
 *
 * Reads `base_rate` from node properties (set on Criterion nodes by the pathway author).
 *
 * Propagation: direct (high-risk interventions flag the immediate decision point only).
 */
export class RiskMagnitudeScorer implements SignalScorer {
  readonly scoringType = ScoringType.RISK_INVERSE;

  declareRequiredInputs(node: GraphNode, _signalConfig: SignalDefinition): RequiredInput[] {
    if (node.nodeType === 'Criterion' || node.nodeType === 'Medication' || node.nodeType === 'Procedure') {
      return [
        { name: 'risk_value', source: 'graph_node', required: false },
      ];
    }
    return [];
  }

  score(params: ScorerParams): SignalScore {
    const { node } = params;

    // Look for risk value in node properties
    const riskValue = node.properties.base_rate as number | undefined
      ?? node.properties.risk_value as number | undefined;

    if (riskValue === undefined || riskValue === null) {
      return {
        score: NO_DATA_SCORE,
        missingInputs: ['risk_value'],
        metadata: { reason: 'no_risk_data' },
      };
    }

    // Formula: max(0.10, 1.0 - (log10(risk * 1000 + 1) / 3.0))
    const rawScore = 1.0 - (Math.log10(riskValue * 1000 + 1) / 3.0);
    const score = Math.max(FLOOR_SCORE, rawScore);

    return {
      score: Math.round(score * 100) / 100, // Round to 2 decimal places
      missingInputs: [],
      metadata: { riskValue, rawScore },
    };
  }

  propagate(params: PropagationParams): PropagationResult {
    const { sourceScore, propagationConfig } = params;

    if (propagationConfig.mode === 'none') {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    return {
      propagatedScore: sourceScore,
      shouldPropagate: false, // direct = one hop
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --prefix apps/pathway-service src/__tests__/risk-magnitude-scorer.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/services/confidence/scorers/risk-magnitude.ts apps/pathway-service/src/__tests__/risk-magnitude-scorer.test.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add RiskMagnitudeScorer (RISK_INVERSE)"
```

---

### Task 10: CustomRulesScorer

**Files:**
- Create: `apps/pathway-service/src/services/confidence/scorers/custom-rules.ts`
- Test: `apps/pathway-service/src/__tests__/custom-rules-scorer.test.ts`

Generic scorer for institution-defined rules. Evaluates a `rules[]` array from the signal definition's `scoring_rules` JSON. Supports conditions: `code_present`, `field_exists`, `value_in_range`, `field_equals`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pathway-service/src/__tests__/custom-rules-scorer.test.ts

import { CustomRulesScorer } from '../services/confidence/scorers/custom-rules';
import {
  GraphNode,
  GraphContext,
  SignalDefinition,
  ScoringType,
  PatientContext,
} from '../services/confidence/types';
import { REFERENCE_PATIENT, EMPTY_PATIENT } from './fixtures/reference-patient-context';

function makeSignalDef(rulesOverride?: object): SignalDefinition {
  return {
    id: 'custom-signal-1',
    name: 'institutional_pref',
    displayName: 'Institutional Preference',
    description: 'Custom rules',
    scoringType: ScoringType.CUSTOM_RULES,
    scoringRules: {
      rules: [
        {
          condition: 'code_present',
          params: { system: 'ICD-10', codes: ['O34.211'] },
          score: 0.9,
        },
        {
          condition: 'code_present',
          params: { system: 'ICD-10', codes: ['O34.29'] },
          score: 0.7,
        },
      ],
      default_score: 0.4,
      ...rulesOverride,
    },
    propagationConfig: { mode: 'none' },
    scope: 'INSTITUTION',
    institutionId: 'inst-1',
    defaultWeight: 0.15,
    isActive: true,
  };
}

function makeGraphContext(): GraphContext {
  return {
    allNodes: [],
    allEdges: [],
    incomingEdges: () => [],
    outgoingEdges: () => [],
    getNode: () => undefined,
    linkedNodes: () => [],
  };
}

describe('CustomRulesScorer', () => {
  const scorer = new CustomRulesScorer();

  it('should have scoringType CUSTOM_RULES', () => {
    expect(scorer.scoringType).toBe(ScoringType.CUSTOM_RULES);
  });

  describe('code_present condition', () => {
    it('should return first matching rule score', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-1', nodeType: 'Criterion', properties: {},
      };

      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: REFERENCE_PATIENT, // Has O34.211
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBe(0.9);
    });

    it('should return default_score when no rules match', () => {
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'crit-1', nodeType: 'Criterion', properties: {},
      };

      const result = scorer.score({
        node,
        signalDefinition: makeSignalDef(),
        patientContext: EMPTY_PATIENT,
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBe(0.4);
    });
  });

  describe('field_exists condition', () => {
    it('should match when field path exists in patient context', () => {
      const signalDef = makeSignalDef({
        rules: [
          { condition: 'field_exists', params: { field_path: 'vitalSigns.bloodPressure' }, score: 0.85 },
        ],
        default_score: 0.3,
      });
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'n-1', nodeType: 'Step', properties: {},
      };

      const patient: PatientContext = {
        ...REFERENCE_PATIENT,
        vitalSigns: { bloodPressure: { systolic: 120 } },
      };

      const result = scorer.score({
        node,
        signalDefinition: signalDef,
        patientContext: patient,
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBe(0.85);
    });
  });

  describe('value_in_range condition', () => {
    it('should match when numeric field is in range', () => {
      const signalDef = makeSignalDef({
        rules: [
          { condition: 'value_in_range', params: { field_path: 'vitalSigns.heartRate', min: 60, max: 100 }, score: 0.9 },
        ],
        default_score: 0.3,
      });
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'n-1', nodeType: 'Step', properties: {},
      };

      const patient: PatientContext = {
        ...REFERENCE_PATIENT,
        vitalSigns: { heartRate: 72 },
      };

      const result = scorer.score({
        node,
        signalDefinition: signalDef,
        patientContext: patient,
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBe(0.9);
    });

    it('should not match when value is out of range', () => {
      const signalDef = makeSignalDef({
        rules: [
          { condition: 'value_in_range', params: { field_path: 'vitalSigns.heartRate', min: 60, max: 100 }, score: 0.9 },
        ],
        default_score: 0.3,
      });
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'n-1', nodeType: 'Step', properties: {},
      };

      const patient: PatientContext = {
        ...REFERENCE_PATIENT,
        vitalSigns: { heartRate: 120 },
      };

      const result = scorer.score({
        node,
        signalDefinition: signalDef,
        patientContext: patient,
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBe(0.3); // default
    });
  });

  describe('field_equals condition', () => {
    it('should match when field equals expected value', () => {
      const signalDef = makeSignalDef({
        rules: [
          { condition: 'field_equals', params: { field_path: 'patientId', value: 'patient-test-001' }, score: 1.0 },
        ],
        default_score: 0.2,
      });
      const node: GraphNode = {
        id: 'age-1', nodeIdentifier: 'n-1', nodeType: 'Step', properties: {},
      };

      const result = scorer.score({
        node,
        signalDefinition: signalDef,
        patientContext: REFERENCE_PATIENT,
        graphContext: makeGraphContext(),
      });

      expect(result.score).toBe(1.0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --prefix apps/pathway-service src/__tests__/custom-rules-scorer.test.ts --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the implementation**

```typescript
// apps/pathway-service/src/services/confidence/scorers/custom-rules.ts

import {
  SignalScorer,
  ScoringType,
  GraphNode,
  SignalDefinition,
  RequiredInput,
  SignalScore,
  ScorerParams,
  PropagationParams,
  PropagationResult,
  PatientContext,
} from '../types';

interface CustomRule {
  condition: 'code_present' | 'field_exists' | 'value_in_range' | 'field_equals';
  params: Record<string, unknown>;
  score: number;
}

/**
 * Generic scorer for institution-defined custom rules.
 * Evaluates rules[] in order, returns the score of the first matching rule
 * or default_score if none match.
 *
 * Supported conditions:
 * - code_present: { system, codes[] } — patient has any of the codes
 * - field_exists: { field_path } — dotted path exists in patient context
 * - value_in_range: { field_path, min?, max? } — numeric field in range
 * - field_equals: { field_path, value } — field matches exact value
 */
export class CustomRulesScorer implements SignalScorer {
  readonly scoringType = ScoringType.CUSTOM_RULES;

  declareRequiredInputs(_node: GraphNode, signalConfig: SignalDefinition): RequiredInput[] {
    // Custom rules can use any patient context field — declare generically
    return [
      { name: 'patient_context', source: 'patient_context', required: false },
    ];
  }

  score(params: ScorerParams): SignalScore {
    const { signalDefinition, patientContext } = params;
    const rules = (signalDefinition.scoringRules.rules as CustomRule[]) ?? [];
    const defaultScore = (signalDefinition.scoringRules.default_score as number) ?? 0.5;

    for (const rule of rules) {
      if (this.evaluateCondition(rule, patientContext)) {
        return {
          score: rule.score,
          missingInputs: [],
          metadata: { matchedRule: rule.condition, params: rule.params },
        };
      }
    }

    return {
      score: defaultScore,
      missingInputs: [],
      metadata: { reason: 'no_rules_matched' },
    };
  }

  propagate(params: PropagationParams): PropagationResult {
    const { sourceScore, propagationConfig, hopDistance } = params;

    if (propagationConfig.mode === 'none') {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    if (propagationConfig.mode === 'direct') {
      return { propagatedScore: sourceScore, shouldPropagate: false };
    }

    // transitive_with_decay
    const maxHops = propagationConfig.maxHops ?? 3;
    if (hopDistance > maxHops) {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    const decay = propagationConfig.decayFactor ?? 0.8;
    return {
      propagatedScore: sourceScore * decay,
      shouldPropagate: hopDistance < maxHops,
    };
  }

  private evaluateCondition(rule: CustomRule, patient: PatientContext): boolean {
    switch (rule.condition) {
      case 'code_present':
        return this.evalCodePresent(rule.params, patient);
      case 'field_exists':
        return this.evalFieldExists(rule.params, patient);
      case 'value_in_range':
        return this.evalValueInRange(rule.params, patient);
      case 'field_equals':
        return this.evalFieldEquals(rule.params, patient);
      default:
        return false;
    }
  }

  private evalCodePresent(params: Record<string, unknown>, patient: PatientContext): boolean {
    const system = params.system as string;
    const codes = params.codes as string[];
    if (!system || !codes) return false;

    const allCodes = [
      ...patient.conditionCodes,
      ...patient.medications,
      ...patient.allergies,
      ...patient.labResults.map(l => ({ code: l.code, system: l.system })),
    ];

    return allCodes.some(c => c.system === system && codes.includes(c.code));
  }

  private evalFieldExists(params: Record<string, unknown>, patient: PatientContext): boolean {
    const fieldPath = params.field_path as string;
    if (!fieldPath) return false;
    return this.getNestedValue(patient, fieldPath) !== undefined;
  }

  private evalValueInRange(params: Record<string, unknown>, patient: PatientContext): boolean {
    const fieldPath = params.field_path as string;
    if (!fieldPath) return false;

    const value = this.getNestedValue(patient, fieldPath);
    if (typeof value !== 'number') return false;

    const min = params.min as number | undefined;
    const max = params.max as number | undefined;

    if (min !== undefined && value < min) return false;
    if (max !== undefined && value > max) return false;

    return true;
  }

  private evalFieldEquals(params: Record<string, unknown>, patient: PatientContext): boolean {
    const fieldPath = params.field_path as string;
    const expectedValue = params.value;
    if (!fieldPath) return false;

    const actual = this.getNestedValue(patient, fieldPath);
    return actual === expectedValue;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --prefix apps/pathway-service src/__tests__/custom-rules-scorer.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/services/confidence/scorers/custom-rules.ts apps/pathway-service/src/__tests__/custom-rules-scorer.test.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add CustomRulesScorer (CUSTOM_RULES)"
```

---

## Chunk 4: Weight Cascade Resolver

### Task 11: WeightCascadeResolver

**Files:**
- Create: `apps/pathway-service/src/services/confidence/weight-cascade-resolver.ts`
- Test: `apps/pathway-service/src/__tests__/weight-cascade-resolver.test.ts`

Resolves the effective weight for each signal on each node by walking the 5-level override hierarchy: NODE → PATHWAY → INSTITUTION_GLOBAL → ORGANIZATION_GLOBAL → system default. `resolveAllWeights` batch-loads with a single SQL query using LEFT JOINs and COALESCE. Same pattern for resolution thresholds.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pathway-service/src/__tests__/weight-cascade-resolver.test.ts

import { WeightCascadeResolver } from '../services/confidence/weight-cascade-resolver';
import {
  SignalDefinition,
  ScoringType,
  WeightSource,
  NodeIdentifier,
  ResolvedThresholds,
  ThresholdScope,
} from '../services/confidence/types';

function makeSignalDefs(): SignalDefinition[] {
  return [
    {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'data_completeness',
      displayName: 'Data Completeness',
      description: '',
      scoringType: ScoringType.DATA_PRESENCE,
      scoringRules: {},
      propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
      scope: 'SYSTEM',
      defaultWeight: 0.30,
      isActive: true,
    },
    {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'evidence_strength',
      displayName: 'Evidence Strength',
      description: '',
      scoringType: ScoringType.MAPPING_LOOKUP,
      scoringRules: {},
      propagationConfig: { mode: 'none' },
      scope: 'SYSTEM',
      defaultWeight: 0.25,
      isActive: true,
    },
  ];
}

describe('WeightCascadeResolver', () => {
  let resolver: WeightCascadeResolver;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
    resolver = new WeightCascadeResolver();
  });

  describe('resolveAllWeights', () => {
    it('should return system defaults when no overrides exist', async () => {
      // No override rows returned
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await resolver.resolveAllWeights({
        pool: mockPool,
        pathwayId: 'pathway-1',
        signalDefinitions: makeSignalDefs(),
        nodeIdentifiers: [
          { nodeIdentifier: 'stage-1', nodeType: 'Stage' },
          { nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint' },
        ],
      });

      // All entries should have system default weights
      expect(result['stage-1']['data_completeness'].weight).toBe(0.30);
      expect(result['stage-1']['data_completeness'].source).toBe(WeightSource.SYSTEM_DEFAULT);
      expect(result['dp-1']['evidence_strength'].weight).toBe(0.25);
      expect(result['dp-1']['evidence_strength'].source).toBe(WeightSource.SYSTEM_DEFAULT);
    });

    it('should apply node-level override when present', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            signal_definition_id: '00000000-0000-4000-a000-000000000001',
            node_identifier: 'dp-1',
            weight: 0.50,
            scope: 'NODE',
          },
        ],
      });

      const result = await resolver.resolveAllWeights({
        pool: mockPool,
        pathwayId: 'pathway-1',
        signalDefinitions: makeSignalDefs(),
        nodeIdentifiers: [
          { nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint' },
        ],
      });

      expect(result['dp-1']['data_completeness'].weight).toBe(0.50);
      expect(result['dp-1']['data_completeness'].source).toBe(WeightSource.NODE_OVERRIDE);
    });

    it('should prefer node override over pathway override', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            signal_definition_id: '00000000-0000-4000-a000-000000000001',
            node_identifier: 'dp-1',
            weight: 0.50,
            scope: 'NODE',
          },
          {
            signal_definition_id: '00000000-0000-4000-a000-000000000001',
            node_identifier: null,
            weight: 0.40,
            scope: 'PATHWAY',
          },
        ],
      });

      const result = await resolver.resolveAllWeights({
        pool: mockPool,
        pathwayId: 'pathway-1',
        signalDefinitions: makeSignalDefs(),
        nodeIdentifiers: [
          { nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint' },
        ],
      });

      expect(result['dp-1']['data_completeness'].weight).toBe(0.50);
      expect(result['dp-1']['data_completeness'].source).toBe(WeightSource.NODE_OVERRIDE);
    });
  });

  describe('resolveThresholds', () => {
    it('should return system defaults when no overrides exist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            auto_resolve_threshold: 0.85,
            suggest_threshold: 0.60,
            scope: 'SYSTEM_DEFAULT',
          },
        ],
      });

      const result = await resolver.resolveThresholds({
        pool: mockPool,
        pathwayId: 'pathway-1',
      });

      expect(result.autoResolveThreshold).toBe(0.85);
      expect(result.suggestThreshold).toBe(0.60);
      expect(result.scope).toBe(ThresholdScope.SYSTEM_DEFAULT);
    });

    it('should prefer more specific scope', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            auto_resolve_threshold: 0.90,
            suggest_threshold: 0.70,
            scope: 'PATHWAY',
          },
          {
            auto_resolve_threshold: 0.85,
            suggest_threshold: 0.60,
            scope: 'SYSTEM_DEFAULT',
          },
        ],
      });

      const result = await resolver.resolveThresholds({
        pool: mockPool,
        pathwayId: 'pathway-1',
      });

      expect(result.autoResolveThreshold).toBe(0.90);
      expect(result.scope).toBe(ThresholdScope.PATHWAY);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --prefix apps/pathway-service src/__tests__/weight-cascade-resolver.test.ts --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the implementation**

```typescript
// apps/pathway-service/src/services/confidence/weight-cascade-resolver.ts

import { Pool } from 'pg';
import {
  SignalDefinition,
  ResolvedWeight,
  WeightSource,
  WeightMatrix,
  NodeIdentifier,
  ResolvedThresholds,
  ThresholdScope,
} from './types';

// Priority order for weight scopes (lower index = higher priority)
const WEIGHT_SCOPE_PRIORITY: Record<string, { source: WeightSource; priority: number }> = {
  NODE: { source: WeightSource.NODE_OVERRIDE, priority: 1 },
  PATHWAY: { source: WeightSource.PATHWAY_OVERRIDE, priority: 2 },
  INSTITUTION_GLOBAL: { source: WeightSource.INSTITUTION_GLOBAL, priority: 3 },
  ORGANIZATION_GLOBAL: { source: WeightSource.ORGANIZATION_GLOBAL, priority: 4 },
};

const THRESHOLD_SCOPE_PRIORITY: Record<string, number> = {
  NODE: 1,
  PATHWAY: 2,
  INSTITUTION: 3,
  ORGANIZATION: 4,
  SYSTEM_DEFAULT: 5,
};

export class WeightCascadeResolver {
  /**
   * Batch-resolve effective weights for all signals × all nodes in a pathway.
   * Runs a single SQL query to load all overrides, then fills the matrix
   * using the cascade: NODE > PATHWAY > INSTITUTION_GLOBAL > ORGANIZATION_GLOBAL > system default.
   */
  async resolveAllWeights(params: {
    pool: Pool;
    pathwayId: string;
    signalDefinitions: SignalDefinition[];
    nodeIdentifiers: NodeIdentifier[];
    institutionId?: string;
    organizationId?: string;
  }): Promise<WeightMatrix> {
    const { pool, pathwayId, signalDefinitions, nodeIdentifiers, institutionId } = params;

    // Load all weight overrides for this pathway (+ institution/org if provided)
    const queryParams: unknown[] = [pathwayId];
    let whereClause = `pathway_id = $1 OR pathway_id IS NULL`;

    if (institutionId) {
      queryParams.push(institutionId);
      whereClause += ` AND (institution_id = $${queryParams.length} OR institution_id IS NULL)`;
    }

    const result = await pool.query(
      `SELECT signal_definition_id, node_identifier, weight, scope
       FROM confidence_signal_weights
       WHERE (${whereClause})
       ORDER BY scope ASC`,
      queryParams
    );

    // Build a lookup: signalId → scope → { weight, nodeIdentifier }
    const overrides = new Map<string, Map<string, { weight: number; nodeIdentifier: string | null }>>();
    for (const row of result.rows) {
      const signalId = row.signal_definition_id;
      if (!overrides.has(signalId)) {
        overrides.set(signalId, new Map());
      }
      const key = row.node_identifier ? `${row.scope}:${row.node_identifier}` : row.scope;
      overrides.get(signalId)!.set(key, {
        weight: parseFloat(row.weight),
        nodeIdentifier: row.node_identifier,
      });
    }

    // Fill the weight matrix
    const matrix: WeightMatrix = {};

    for (const node of nodeIdentifiers) {
      matrix[node.nodeIdentifier] = {};

      for (const signal of signalDefinitions) {
        const resolved = this.resolveWeight(signal, node.nodeIdentifier, overrides.get(signal.id));
        matrix[node.nodeIdentifier][signal.name] = resolved;
      }
    }

    return matrix;
  }

  /**
   * Resolve effective thresholds for a pathway, optionally for a specific node.
   * Cascade: NODE > PATHWAY > INSTITUTION > ORGANIZATION > SYSTEM_DEFAULT.
   */
  async resolveThresholds(params: {
    pool: Pool;
    pathwayId: string;
    nodeIdentifier?: string;
    institutionId?: string;
    organizationId?: string;
  }): Promise<ResolvedThresholds> {
    const { pool, pathwayId, nodeIdentifier, institutionId } = params;

    const queryParams: unknown[] = [pathwayId];
    let query = `
      SELECT auto_resolve_threshold, suggest_threshold, scope
      FROM confidence_resolution_thresholds
      WHERE (pathway_id = $1 OR pathway_id IS NULL)
    `;

    if (nodeIdentifier) {
      queryParams.push(nodeIdentifier);
      query += ` AND (node_identifier = $${queryParams.length} OR node_identifier IS NULL)`;
    } else {
      query += ` AND node_identifier IS NULL`;
    }

    if (institutionId) {
      queryParams.push(institutionId);
      query += ` AND (institution_id = $${queryParams.length} OR institution_id IS NULL)`;
    }

    query += ` ORDER BY scope ASC`;

    const result = await pool.query(query, queryParams);

    if (result.rows.length === 0) {
      // Fallback: system defaults
      return {
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      };
    }

    // Pick highest-priority scope
    let best = result.rows[0];
    let bestPriority = THRESHOLD_SCOPE_PRIORITY[best.scope] ?? 99;

    for (const row of result.rows) {
      const priority = THRESHOLD_SCOPE_PRIORITY[row.scope] ?? 99;
      if (priority < bestPriority) {
        best = row;
        bestPriority = priority;
      }
    }

    return {
      autoResolveThreshold: parseFloat(best.auto_resolve_threshold),
      suggestThreshold: parseFloat(best.suggest_threshold),
      scope: best.scope as ThresholdScope,
    };
  }

  private resolveWeight(
    signal: SignalDefinition,
    nodeIdentifier: string,
    overridesForSignal?: Map<string, { weight: number; nodeIdentifier: string | null }>
  ): ResolvedWeight {
    if (!overridesForSignal) {
      return { weight: signal.defaultWeight, source: WeightSource.SYSTEM_DEFAULT };
    }

    // Check in priority order
    const nodeKey = `NODE:${nodeIdentifier}`;
    if (overridesForSignal.has(nodeKey)) {
      return { weight: overridesForSignal.get(nodeKey)!.weight, source: WeightSource.NODE_OVERRIDE };
    }

    if (overridesForSignal.has('PATHWAY')) {
      return { weight: overridesForSignal.get('PATHWAY')!.weight, source: WeightSource.PATHWAY_OVERRIDE };
    }

    if (overridesForSignal.has('INSTITUTION_GLOBAL')) {
      return { weight: overridesForSignal.get('INSTITUTION_GLOBAL')!.weight, source: WeightSource.INSTITUTION_GLOBAL };
    }

    if (overridesForSignal.has('ORGANIZATION_GLOBAL')) {
      return { weight: overridesForSignal.get('ORGANIZATION_GLOBAL')!.weight, source: WeightSource.ORGANIZATION_GLOBAL };
    }

    return { weight: signal.defaultWeight, source: WeightSource.SYSTEM_DEFAULT };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --prefix apps/pathway-service src/__tests__/weight-cascade-resolver.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/services/confidence/weight-cascade-resolver.ts apps/pathway-service/src/__tests__/weight-cascade-resolver.test.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add WeightCascadeResolver with 5-level override hierarchy"
```

---

## Chunk 5: Confidence Engine

### Task 12: ConfidenceEngine

**Files:**
- Create: `apps/pathway-service/src/services/confidence/confidence-engine.ts`
- Test: `apps/pathway-service/src/__tests__/confidence-engine.test.ts`

The main orchestrator. Computation flow: load graph → load signals → resolve weights → resolve propagation overrides → score each (node, signal) → topological sort → propagate → compute per-node weighted confidence → classify resolution type → pathway rollup.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pathway-service/src/__tests__/confidence-engine.test.ts

import { ConfidenceEngine } from '../services/confidence/confidence-engine';
import { ScorerRegistry } from '../services/confidence/scorer-registry';
import { WeightCascadeResolver } from '../services/confidence/weight-cascade-resolver';
import {
  GraphNode,
  GraphEdge,
  SignalDefinition,
  ScoringType,
  WeightSource,
  PatientContext,
  ThresholdScope,
  ResolutionType,
} from '../services/confidence/types';
import { REFERENCE_PATIENT } from './fixtures/reference-patient-context';

// Minimal mock scorer that returns configurable scores
function createMockScorer(type: ScoringType, score: number) {
  return {
    scoringType: type,
    declareRequiredInputs: jest.fn().mockReturnValue([]),
    score: jest.fn().mockReturnValue({ score, missingInputs: [] }),
  };
}

function makeSignalDefs(): SignalDefinition[] {
  return [
    {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'data_completeness',
      displayName: 'Data Completeness',
      description: '',
      scoringType: ScoringType.DATA_PRESENCE,
      scoringRules: {},
      propagationConfig: { mode: 'none' },
      scope: 'SYSTEM',
      defaultWeight: 0.5,
      isActive: true,
    },
    {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'evidence_strength',
      displayName: 'Evidence Strength',
      description: '',
      scoringType: ScoringType.MAPPING_LOOKUP,
      scoringRules: {},
      propagationConfig: { mode: 'none' },
      scope: 'SYSTEM',
      defaultWeight: 0.5,
      isActive: true,
    },
  ];
}

describe('ConfidenceEngine', () => {
  let engine: ConfidenceEngine;
  let registry: ScorerRegistry;
  let cascadeResolver: WeightCascadeResolver;
  let mockPool: any;

  beforeEach(() => {
    registry = new ScorerRegistry();
    registry.register(createMockScorer(ScoringType.DATA_PRESENCE, 0.8));
    registry.register(createMockScorer(ScoringType.MAPPING_LOOKUP, 0.6));

    cascadeResolver = new WeightCascadeResolver();
    mockPool = { query: jest.fn() };

    engine = new ConfidenceEngine(registry, cascadeResolver);
  });

  describe('computePathwayConfidence', () => {
    it('should compute per-node confidence as weighted average of signal scores', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { stage_number: 1, title: 'Assessment' } },
      ];
      const edges: GraphEdge[] = [];
      const signals = makeSignalDefs();

      // Mock: no weight overrides, no threshold overrides
      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'stage-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges,
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      expect(result.pathwayId).toBe('pathway-1');
      expect(result.nodes).toHaveLength(1);

      const nodeResult = result.nodes[0];
      expect(nodeResult.nodeIdentifier).toBe('stage-1');
      // Weighted average: (0.8 * 0.5 + 0.6 * 0.5) / (0.5 + 0.5) = 0.7
      expect(nodeResult.confidence).toBeCloseTo(0.7);
      expect(nodeResult.breakdown).toHaveLength(2);
    });

    it('should classify DecisionPoint resolution type based on thresholds', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: { title: 'Decision', auto_resolve_eligible: true } },
      ];
      const signals = makeSignalDefs();

      // High-confidence scorers
      registry = new ScorerRegistry();
      registry.register(createMockScorer(ScoringType.DATA_PRESENCE, 0.95));
      registry.register(createMockScorer(ScoringType.MAPPING_LOOKUP, 0.90));
      engine = new ConfidenceEngine(registry, cascadeResolver);

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'dp-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges: [],
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      const dpResult = result.nodes[0];
      // (0.95 * 0.5 + 0.90 * 0.5) / 1.0 = 0.925 ≥ 0.85 → AUTO_RESOLVED
      expect(dpResult.resolutionType).toBe(ResolutionType.AUTO_RESOLVED);
    });

    it('should classify as SYSTEM_SUGGESTED when between suggest and auto thresholds', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: { title: 'Decision', auto_resolve_eligible: true } },
      ];
      const signals = makeSignalDefs();

      registry = new ScorerRegistry();
      registry.register(createMockScorer(ScoringType.DATA_PRESENCE, 0.7));
      registry.register(createMockScorer(ScoringType.MAPPING_LOOKUP, 0.7));
      engine = new ConfidenceEngine(registry, cascadeResolver);

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'dp-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges: [],
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      expect(result.nodes[0].resolutionType).toBe(ResolutionType.SYSTEM_SUGGESTED);
    });

    it('should classify as FORCED_MANUAL when auto_resolve_eligible is false', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: { title: 'Decision', auto_resolve_eligible: false } },
      ];
      const signals = makeSignalDefs();

      registry = new ScorerRegistry();
      registry.register(createMockScorer(ScoringType.DATA_PRESENCE, 0.95));
      registry.register(createMockScorer(ScoringType.MAPPING_LOOKUP, 0.95));
      engine = new ConfidenceEngine(registry, cascadeResolver);

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'dp-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges: [],
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      expect(result.nodes[0].resolutionType).toBe(ResolutionType.FORCED_MANUAL);
    });

    it('should compute pathway overall confidence as weighted average of node confidences', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { stage_number: 1, title: 'A' } },
        { id: 'age-2', nodeIdentifier: 'step-1', nodeType: 'Step', properties: { stage_number: 1, step_number: 1, display_number: '1.1', title: 'B' } },
      ];
      const signals = makeSignalDefs();

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'stage-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
        'step-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges: [],
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      // Both nodes get same scores (mock scorers return same values)
      // Overall = average of node confidences (equal default weight)
      expect(result.overallConfidence).toBeCloseTo(0.7);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --prefix apps/pathway-service src/__tests__/confidence-engine.test.ts --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the implementation**

```typescript
// apps/pathway-service/src/services/confidence/confidence-engine.ts

import { Pool } from 'pg';
import { ScorerRegistry } from './scorer-registry';
import { WeightCascadeResolver } from './weight-cascade-resolver';
import {
  GraphNode,
  GraphEdge,
  GraphContext,
  SignalDefinition,
  PatientContext,
  PathwayConfidenceResult,
  NodeConfidenceResult,
  SignalBreakdown,
  PropagationInfluence,
  PropagationConfig,
  ResolvedThresholds,
  ResolutionType,
  WeightMatrix,
} from './types';
import { PathwayEdgeType } from '../import/types';

export class ConfidenceEngine {
  constructor(
    private registry: ScorerRegistry,
    private cascadeResolver: WeightCascadeResolver,
  ) {}

  async computePathwayConfidence(params: {
    pool: Pool;
    pathwayId: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    signalDefinitions: SignalDefinition[];
    patientContext: PatientContext;
    institutionId?: string;
    organizationId?: string;
  }): Promise<PathwayConfidenceResult> {
    const { pool, pathwayId, nodes, edges, signalDefinitions, patientContext, institutionId, organizationId } = params;

    // Build graph context with convenience lookups
    const graphContext = this.buildGraphContext(nodes, edges);

    // Resolve weight matrix (all signals × all nodes)
    const weightMatrix = await this.cascadeResolver.resolveAllWeights({
      pool,
      pathwayId,
      signalDefinitions,
      nodeIdentifiers: nodes.map(n => ({ nodeIdentifier: n.nodeIdentifier, nodeType: n.nodeType })),
      institutionId,
      organizationId,
    });

    // Load propagation overrides from DB
    const propagationOverrides = await this.loadPropagationOverrides(pool, pathwayId);

    // Resolve thresholds
    const thresholds = await this.cascadeResolver.resolveThresholds({
      pool,
      pathwayId,
      institutionId,
      organizationId,
    });

    // Score each (node, signal) pair
    const rawScores = new Map<string, Map<string, { score: number; missingInputs: string[] }>>();

    for (const node of nodes) {
      const nodeScores = new Map<string, { score: number; missingInputs: string[] }>();

      for (const signal of signalDefinitions) {
        const scorer = this.registry.get(signal.scoringType);
        if (!scorer) {
          nodeScores.set(signal.name, { score: 0.5, missingInputs: ['scorer_not_found'] });
          continue;
        }

        const result = scorer.score({
          node,
          signalDefinition: signal,
          patientContext,
          graphContext,
        });

        nodeScores.set(signal.name, { score: result.score, missingInputs: result.missingInputs });
      }

      rawScores.set(node.nodeIdentifier, nodeScores);
    }

    // Propagation: topological sort then walk
    const propagationInfluences = this.applyPropagation(
      nodes, edges, signalDefinitions, rawScores, propagationOverrides
    );

    // Compute per-node confidence (weighted average of signal scores)
    const nodeResults: NodeConfidenceResult[] = [];

    for (const node of nodes) {
      const nodeScores = rawScores.get(node.nodeIdentifier)!;
      const nodeWeights = weightMatrix[node.nodeIdentifier] ?? {};
      const nodePropInfluences = propagationInfluences.get(node.nodeIdentifier) ?? [];

      const breakdown: SignalBreakdown[] = [];
      let weightedSum = 0;
      let totalWeight = 0;

      for (const signal of signalDefinitions) {
        const scoreEntry = nodeScores.get(signal.name);
        const weightEntry = nodeWeights[signal.name];

        if (!scoreEntry || !weightEntry) continue;

        const weight = weightEntry.weight;
        breakdown.push({
          signalName: signal.name,
          score: scoreEntry.score,
          weight,
          weightSource: weightEntry.source,
          missingInputs: scoreEntry.missingInputs,
        });

        weightedSum += scoreEntry.score * weight;
        totalWeight += weight;
      }

      const confidence = totalWeight > 0 ? weightedSum / totalWeight : 0;

      // Classify resolution type for DecisionPoint nodes
      let resolutionType: ResolutionType | undefined;
      if (node.nodeType === 'DecisionPoint') {
        resolutionType = this.classifyResolution(node, confidence, thresholds);
      }

      nodeResults.push({
        nodeIdentifier: node.nodeIdentifier,
        nodeType: node.nodeType,
        confidence: Math.round(confidence * 1000) / 1000, // 3 decimal places
        resolutionType,
        breakdown,
        propagationInfluences: nodePropInfluences,
      });
    }

    // Pathway rollup: weighted average of node confidences using node weights
    const nodeWeightMap = await this.loadNodeWeights(pool, pathwayId);
    let rollupWeightedSum = 0;
    let rollupTotalWeight = 0;
    for (const nr of nodeResults) {
      const nw = nodeWeightMap.get(nr.nodeIdentifier) ?? 1.0;
      rollupWeightedSum += nr.confidence * nw;
      rollupTotalWeight += nw;
    }
    const overallConfidence = rollupTotalWeight > 0
      ? rollupWeightedSum / rollupTotalWeight
      : 0;

    return {
      pathwayId,
      overallConfidence: Math.round(overallConfidence * 1000) / 1000,
      nodes: nodeResults,
    };
  }

  private buildGraphContext(nodes: GraphNode[], edges: GraphEdge[]): GraphContext {
    return {
      allNodes: nodes,
      allEdges: edges,
      incomingEdges: (nodeId: string) => edges.filter(e => e.targetId === nodeId),
      outgoingEdges: (nodeId: string) => edges.filter(e => e.sourceId === nodeId),
      getNode: (nodeId: string) => nodes.find(n => n.nodeIdentifier === nodeId),
      linkedNodes: (nodeId: string, edgeType: PathwayEdgeType) => {
        const targetIds = edges
          .filter(e => e.sourceId === nodeId && e.edgeType === edgeType)
          .map(e => e.targetId);
        return nodes.filter(n => targetIds.includes(n.nodeIdentifier));
      },
    };
  }

  private classifyResolution(
    node: GraphNode,
    confidence: number,
    thresholds: ResolvedThresholds
  ): ResolutionType {
    // Check auto_resolve_eligible flag
    if (node.properties.auto_resolve_eligible === false) {
      return ResolutionType.FORCED_MANUAL;
    }

    if (confidence >= thresholds.autoResolveThreshold) {
      return ResolutionType.AUTO_RESOLVED;
    }

    if (confidence >= thresholds.suggestThreshold) {
      return ResolutionType.SYSTEM_SUGGESTED;
    }

    return ResolutionType.PROVIDER_DECIDED;
  }

  private applyPropagation(
    nodes: GraphNode[],
    edges: GraphEdge[],
    signalDefinitions: SignalDefinition[],
    rawScores: Map<string, Map<string, { score: number; missingInputs: string[] }>>,
    propagationOverrides: Map<string, Record<string, PropagationConfig>>
  ): Map<string, PropagationInfluence[]> {
    const influences = new Map<string, PropagationInfluence[]>();

    // Topological sort
    const sorted = this.topologicalSort(nodes, edges);
    if (!sorted) {
      // Cycle detected — skip propagation
      return influences;
    }

    // Track propagated scores and hop distances for transitive cascading.
    // Key: `${nodeIdentifier}:${signalName}` → { score, hopDistance, originNodeId }
    const propagatedState = new Map<string, { score: number; hopDistance: number; originNodeId: string }>();

    for (const node of sorted) {
      for (const signal of signalDefinitions) {
        const scorer = this.registry.get(signal.scoringType);
        if (!scorer?.propagate) continue;

        // Get effective propagation config (node override > signal default)
        const nodeOverrides = propagationOverrides.get(node.nodeIdentifier);
        const effectiveConfig = nodeOverrides?.[signal.name] ?? signal.propagationConfig;

        if (effectiveConfig.mode === 'none') continue;

        const sourceScores = rawScores.get(node.nodeIdentifier);
        if (!sourceScores) continue;

        // Use the raw score for this node as the base
        const rawScore = sourceScores.get(signal.name)?.score ?? 0.5;

        // Check if this node has incoming propagated influence for this signal
        const stateKey = `${node.nodeIdentifier}:${signal.name}`;
        const incomingState = propagatedState.get(stateKey);
        const effectiveScore = incomingState ? Math.min(rawScore, incomingState.score) : rawScore;
        const baseHopDistance = incomingState?.hopDistance ?? 0;

        // Find downstream neighbors
        const outEdges = edges.filter(e => e.sourceId === node.nodeIdentifier);

        for (const edge of outEdges) {
          // Check edge type filter
          if (effectiveConfig.edgeTypes && !effectiveConfig.edgeTypes.includes(edge.edgeType)) {
            continue;
          }

          const hopDistance = baseHopDistance + 1;
          const result = scorer.propagate({
            sourceNode: node,
            sourceScore: effectiveScore,
            targetNode: nodes.find(n => n.nodeIdentifier === edge.targetId) ?? node,
            edge,
            propagationConfig: effectiveConfig,
            hopDistance,
          });

          if (result.propagatedScore > 0) {
            if (!influences.has(edge.targetId)) {
              influences.set(edge.targetId, []);
            }
            influences.get(edge.targetId)!.push({
              sourceNodeIdentifier: incomingState?.originNodeId ?? node.nodeIdentifier,
              signalName: signal.name,
              originalScore: rawScore,
              propagatedScore: result.propagatedScore,
              hopDistance,
            });

            // Store propagated state for transitive cascading
            if (result.shouldPropagate) {
              const targetKey = `${edge.targetId}:${signal.name}`;
              const existing = propagatedState.get(targetKey);
              // Keep the worst (lowest) propagated score
              if (!existing || result.propagatedScore < existing.score) {
                propagatedState.set(targetKey, {
                  score: result.propagatedScore,
                  hopDistance,
                  originNodeId: incomingState?.originNodeId ?? node.nodeIdentifier,
                });
              }
            }
          }
        }
      }
    }

    return influences;
  }

  private topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] | null {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.nodeIdentifier, 0);
      adjacency.set(node.nodeIdentifier, []);
    }

    for (const edge of edges) {
      if (inDegree.has(edge.targetId)) {
        inDegree.set(edge.targetId, (inDegree.get(edge.targetId) ?? 0) + 1);
      }
      adjacency.get(edge.sourceId)?.push(edge.targetId);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    const sorted: GraphNode[] = [];
    const nodeMap = new Map(nodes.map(n => [n.nodeIdentifier, n]));

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = nodeMap.get(nodeId);
      if (node) sorted.push(node);

      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    // Cycle detection: if sorted < total nodes, there's a cycle
    if (sorted.length < nodes.length) {
      return null;
    }

    return sorted;
  }

  private async loadNodeWeights(
    pool: Pool,
    pathwayId: string
  ): Promise<Map<string, number>> {
    const result = await pool.query(
      `SELECT node_identifier, COALESCE(weight_override, default_weight) as effective_weight
       FROM confidence_node_weights
       WHERE pathway_id = $1`,
      [pathwayId]
    );
    const weights = new Map<string, number>();
    for (const row of result.rows) {
      weights.set(row.node_identifier, parseFloat(row.effective_weight));
    }
    return weights;
  }

  private async loadPropagationOverrides(
    pool: Pool,
    pathwayId: string
  ): Promise<Map<string, Record<string, PropagationConfig>>> {
    const result = await pool.query(
      `SELECT node_identifier, propagation_overrides
       FROM confidence_node_weights
       WHERE pathway_id = $1 AND propagation_overrides != '{}'::jsonb`,
      [pathwayId]
    );

    const overrides = new Map<string, Record<string, PropagationConfig>>();
    for (const row of result.rows) {
      if (row.propagation_overrides && Object.keys(row.propagation_overrides).length > 0) {
        overrides.set(row.node_identifier, row.propagation_overrides);
      }
    }
    return overrides;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --prefix apps/pathway-service src/__tests__/confidence-engine.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/services/confidence/confidence-engine.ts apps/pathway-service/src/__tests__/confidence-engine.test.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add ConfidenceEngine orchestrator with propagation and resolution classification"
```

---

## Chunk 6: GraphQL Schema and Query Resolvers

### Task 13: GraphQL Schema Additions

**Files:**
- Modify: `apps/pathway-service/schema.graphql`

Add all confidence types, inputs, enums, queries, and mutations to the schema.

- [ ] **Step 1: Add enums after the existing `ImportMode` enum**

Add these enums to `schema.graphql` after line 29 (after `ImportMode`):

```graphql
enum ScoringType {
  DATA_PRESENCE
  MAPPING_LOOKUP
  CRITERIA_MATCH
  RISK_INVERSE
  CUSTOM_RULES
}

enum SignalScope { SYSTEM ORGANIZATION INSTITUTION }
enum WeightScope { NODE PATHWAY INSTITUTION_GLOBAL ORGANIZATION_GLOBAL }
enum ThresholdScope { SYSTEM_DEFAULT ORGANIZATION INSTITUTION PATHWAY NODE }
enum WeightSource { NODE_OVERRIDE PATHWAY_OVERRIDE INSTITUTION_GLOBAL ORGANIZATION_GLOBAL SYSTEM_DEFAULT }
enum PropagationMode { NONE DIRECT TRANSITIVE_WITH_DECAY }
enum ResolutionType { AUTO_RESOLVED SYSTEM_SUGGESTED PROVIDER_DECIDED FORCED_MANUAL }
```

- [ ] **Step 2: Add confidence result types after the existing `PathwayStatusResult` type**

```graphql
# ─── Confidence Types ─────────────────────────────────────────────────

type PathwayConfidenceResult {
  pathwayId: ID!
  overallConfidence: Float!
  nodes: [NodeConfidenceResult!]!
}

type NodeConfidenceResult {
  nodeIdentifier: String!
  nodeType: String!
  confidence: Float!
  resolutionType: ResolutionType
  breakdown: [SignalBreakdown!]!
  propagationInfluences: [PropagationInfluence!]!
}

type SignalBreakdown {
  signalName: String!
  score: Float!
  weight: Float!
  weightSource: WeightSource!
  missingInputs: [String!]!
}

type PropagationInfluence {
  sourceNodeIdentifier: String!
  signalName: String!
  originalScore: Float!
  propagatedScore: Float!
  hopDistance: Int!
}

type SignalDefinition {
  id: ID!
  name: String!
  displayName: String!
  description: String
  scoringType: ScoringType!
  scoringRules: JSON!
  propagationConfig: PropagationConfig
  scope: SignalScope!
  institutionId: ID
  defaultWeight: Float!
  isActive: Boolean!
}

type PropagationConfig {
  mode: PropagationMode!
  decayFactor: Float
  maxHops: Int
  edgeTypes: [String!]
  sourceNodeTypes: [String!]
  immuneToSignals: [String!]
}

type SignalWeight {
  id: ID!
  signalDefinitionId: ID!
  weight: Float!
  scope: WeightScope!
  pathwayId: ID
  nodeIdentifier: String
  nodeType: String
  institutionId: ID
}

type NodeWeight {
  id: ID!
  pathwayId: ID!
  nodeIdentifier: String!
  nodeType: String!
  defaultWeight: Float!
  institutionId: ID
  weightOverride: Float
  propagationOverrides: JSON
}

type ResolutionThresholds {
  id: ID!
  autoResolveThreshold: Float!
  suggestThreshold: Float!
  scope: ThresholdScope!
  pathwayId: ID
  nodeIdentifier: String
  institutionId: ID
}

type WeightMatrixEntry {
  nodeIdentifier: String!
  signalName: String!
  weight: Float!
  source: WeightSource!
}

type WeightMatrix {
  entries: [WeightMatrixEntry!]!
}

type ResolvedThresholds {
  autoResolveThreshold: Float!
  suggestThreshold: Float!
  scope: ThresholdScope!
}
```

- [ ] **Step 3: Add confidence input types before the Query type**

```graphql
# ─── Confidence Inputs ────────────────────────────────────────────────

input PatientContextInput {
  patientId: ID!
  conditionCodes: [CodeInput!]
  medications: [CodeInput!]
  labResults: [LabResultInput!]
  allergies: [CodeInput!]
  vitalSigns: JSON
}

input CodeInput {
  code: String!
  system: String!
  display: String
}

input LabResultInput {
  code: String!
  system: String!
  value: Float
  unit: String
  date: String
  display: String
}

input PropagationConfigInput {
  mode: PropagationMode!
  decayFactor: Float
  maxHops: Int
  edgeTypes: [String!]
  sourceNodeTypes: [String!]
  immuneToSignals: [String!]
}

input CreateSignalDefinitionInput {
  name: String!
  displayName: String!
  description: String
  scoringType: ScoringType!
  scoringRules: JSON!
  scope: SignalScope!
  institutionId: ID
  defaultWeight: Float!
  propagationConfig: PropagationConfigInput
}

input UpdateSignalDefinitionInput {
  displayName: String
  description: String
  scoringRules: JSON
  defaultWeight: Float
  propagationConfig: PropagationConfigInput
  isActive: Boolean
}

input SetSignalWeightInput {
  signalDefinitionId: ID!
  weight: Float!
  scope: WeightScope!
  pathwayId: ID
  nodeIdentifier: String
  nodeType: String
  institutionId: ID
}

input SetNodeWeightInput {
  pathwayId: ID!
  nodeIdentifier: String!
  nodeType: String!
  institutionId: ID
  weightOverride: Float
  propagationOverrides: JSON
}

input SetResolutionThresholdsInput {
  autoResolveThreshold: Float!
  suggestThreshold: Float!
  scope: ThresholdScope!
  pathwayId: ID
  nodeIdentifier: String
  institutionId: ID
}

scalar JSON
```

- [ ] **Step 4: Add confidence queries to the Query type**

Add after the existing `pathway(id: ID!): Pathway` line:

```graphql
  pathwayConfidence(
    pathwayId: ID!
    patientContext: PatientContextInput!
    institutionId: ID
    organizationId: ID
  ): PathwayConfidenceResult!

  signalDefinitions(
    scope: SignalScope
    institutionId: ID
  ): [SignalDefinition!]!

  effectiveWeights(
    pathwayId: ID!
    institutionId: ID
    organizationId: ID
  ): WeightMatrix!

  effectiveThresholds(
    pathwayId: ID!
    nodeIdentifier: String
    institutionId: ID
    organizationId: ID
  ): ResolvedThresholds!
```

- [ ] **Step 5: Add confidence mutations to the Mutation type**

Add after the existing `reactivatePathway` mutation:

```graphql
  createSignalDefinition(input: CreateSignalDefinitionInput!): SignalDefinition!
  updateSignalDefinition(id: ID!, input: UpdateSignalDefinitionInput!): SignalDefinition!
  deleteSignalDefinition(id: ID!): Boolean!

  setSignalWeight(input: SetSignalWeightInput!): SignalWeight!
  removeSignalWeight(id: ID!): Boolean!

  setNodeWeight(input: SetNodeWeightInput!): NodeWeight!
  removeNodeWeight(id: ID!): Boolean!

  setResolutionThresholds(input: SetResolutionThresholdsInput!): ResolutionThresholds!
  removeResolutionThresholds(id: ID!): Boolean!
```

- [ ] **Step 6: Run typecheck to verify schema compiles**

Run: `npm run typecheck --prefix apps/pathway-service`
Expected: PASS (or warnings about unused resolvers — OK until resolvers are wired)

- [ ] **Step 7: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/schema.graphql
git -C /home/claude/workspace/prism-graphql commit -m "feat: add confidence framework GraphQL schema (types, inputs, queries, mutations)"
```

---

### Task 14: Confidence Query Resolvers

**Files:**
- Modify: `apps/pathway-service/src/resolvers/Query.ts`
- Test: `apps/pathway-service/src/__tests__/confidence-query-resolvers.test.ts`

Add resolvers for `pathwayConfidence`, `signalDefinitions`, `effectiveWeights`, `effectiveThresholds`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pathway-service/src/__tests__/confidence-query-resolvers.test.ts

import { Query } from '../resolvers/Query';

function createMockContext() {
  return {
    pool: {
      query: jest.fn(),
    },
    redis: {},
    userId: 'test-user',
    userRole: 'PROVIDER',
  };
}

describe('Confidence query resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signalDefinitions', () => {
    it('should query signal definitions with no scope filter', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({
        rows: [
          {
            id: '00000000-0000-4000-a000-000000000001',
            name: 'data_completeness',
            display_name: 'Data Completeness',
            description: 'Measures data availability',
            scoring_type: 'DATA_PRESENCE',
            scoring_rules: '{"propagation":{"mode":"transitive_with_decay"}}',
            scope: 'SYSTEM',
            institution_id: null,
            default_weight: 0.30,
            is_active: true,
          },
        ],
      });

      const result = await Query.Query.signalDefinitions({}, {}, ctx as any);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('data_completeness');
      expect(result[0].displayName).toBe('Data Completeness');
      expect(result[0].scoringType).toBe('DATA_PRESENCE');
    });

    it('should filter by scope when provided', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await Query.Query.signalDefinitions({}, { scope: 'INSTITUTION', institutionId: 'inst-1' }, ctx as any);

      const call = (ctx.pool.query as jest.Mock).mock.calls[0];
      expect(call[0]).toContain('scope = $1');
      expect(call[1]).toContain('INSTITUTION');
    });
  });

  describe('effectiveThresholds', () => {
    it('should return resolved thresholds', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({
        rows: [
          { auto_resolve_threshold: 0.85, suggest_threshold: 0.60, scope: 'SYSTEM_DEFAULT' },
        ],
      });

      const result = await Query.Query.effectiveThresholds(
        {},
        { pathwayId: 'pathway-1' },
        ctx as any
      );

      expect(result.autoResolveThreshold).toBe(0.85);
      expect(result.suggestThreshold).toBe(0.60);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --prefix apps/pathway-service src/__tests__/confidence-query-resolvers.test.ts --no-coverage`
Expected: FAIL — `signalDefinitions` is not a function

- [ ] **Step 3: Add confidence query resolvers to Query.ts**

Add the following resolvers inside the `Query` object in `apps/pathway-service/src/resolvers/Query.ts`, after the existing `pathway` resolver. Also add the necessary imports at the top.

Add imports at top of file:

```typescript
import { ConfidenceEngine } from '../services/confidence/confidence-engine';
import { ScorerRegistry } from '../services/confidence/scorer-registry';
import { WeightCascadeResolver } from '../services/confidence/weight-cascade-resolver';
import { DataCompletenessScorer } from '../services/confidence/scorers/data-completeness';
import { EvidenceStrengthScorer } from '../services/confidence/scorers/evidence-strength';
import { PatientMatchQualityScorer } from '../services/confidence/scorers/patient-match-quality';
import { RiskMagnitudeScorer } from '../services/confidence/scorers/risk-magnitude';
import {
  SignalDefinition,
  PatientContext,
  GraphNode,
  GraphEdge,
} from '../services/confidence/types';
import { executeCypher } from '../services/age-client';
```

Add resolvers inside `Query.Query`:

```typescript
    signalDefinitions: async (
      _: unknown,
      args: { scope?: string; institutionId?: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      let query = `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                          scope, institution_id, default_weight, is_active
                   FROM confidence_signal_definitions WHERE is_active = true`;
      const params: unknown[] = [];
      let paramIdx = 1;

      if (args.scope) {
        query += ` AND scope = $${paramIdx}`;
        params.push(args.scope);
        paramIdx++;
      }
      if (args.institutionId) {
        query += ` AND (institution_id = $${paramIdx} OR institution_id IS NULL)`;
        params.push(args.institutionId);
        paramIdx++;
      }

      query += ` ORDER BY name ASC`;
      const result = await pool.query(query, params);

      return result.rows.map(hydrateSignalDefinition);
    },

    effectiveWeights: async (
      _: unknown,
      args: { pathwayId: string; institutionId?: string; organizationId?: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;

      // Load signal definitions
      const signalResult = await pool.query(
        `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                scope, institution_id, default_weight, is_active
         FROM confidence_signal_definitions WHERE is_active = true ORDER BY name ASC`
      );
      const signals = signalResult.rows.map(hydrateSignalDefinition);

      // Load node identifiers for this pathway from AGE
      const nodeResult = await pool.query(
        `SELECT node_identifier, node_type
         FROM confidence_node_weights WHERE pathway_id = $1`,
        [args.pathwayId]
      );

      const cascadeResolver = new WeightCascadeResolver();
      const matrix = await cascadeResolver.resolveAllWeights({
        pool,
        pathwayId: args.pathwayId,
        signalDefinitions: signals,
        nodeIdentifiers: nodeResult.rows.map((r: any) => ({
          nodeIdentifier: r.node_identifier,
          nodeType: r.node_type,
        })),
        institutionId: args.institutionId,
        organizationId: args.organizationId,
      });

      // Convert WeightMatrix to flat entries
      const entries: Array<{ nodeIdentifier: string; signalName: string; weight: number; source: string }> = [];
      for (const [nodeId, signals] of Object.entries(matrix)) {
        for (const [signalName, resolved] of Object.entries(signals as any)) {
          entries.push({
            nodeIdentifier: nodeId,
            signalName,
            weight: (resolved as any).weight,
            source: (resolved as any).source,
          });
        }
      }

      return { entries };
    },

    effectiveThresholds: async (
      _: unknown,
      args: { pathwayId: string; nodeIdentifier?: string; institutionId?: string; organizationId?: string },
      context: DataSourceContext
    ) => {
      const cascadeResolver = new WeightCascadeResolver();
      return cascadeResolver.resolveThresholds({
        pool: context.pool,
        pathwayId: args.pathwayId,
        nodeIdentifier: args.nodeIdentifier,
        institutionId: args.institutionId,
        organizationId: args.organizationId,
      });
    },

    pathwayConfidence: async (
      _: unknown,
      args: {
        pathwayId: string;
        patientContext: any;
        institutionId?: string;
        organizationId?: string;
      },
      context: DataSourceContext
    ) => {
      const { pool } = context;

      // Load signal definitions
      const signalResult = await pool.query(
        `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                scope, institution_id, default_weight, is_active
         FROM confidence_signal_definitions WHERE is_active = true ORDER BY name ASC`
      );
      const signals = signalResult.rows.map(hydrateSignalDefinition);

      // Load graph from AGE
      const { nodes, edges } = await loadPathwayGraph(pool, args.pathwayId);

      // Build engine
      const registry = new ScorerRegistry();
      registry.register(new DataCompletenessScorer());
      registry.register(new EvidenceStrengthScorer());
      registry.register(new PatientMatchQualityScorer());
      registry.register(new RiskMagnitudeScorer());
      await registry.loadCustomSignals(pool, args.institutionId);

      const cascadeResolver = new WeightCascadeResolver();
      const engine = new ConfidenceEngine(registry, cascadeResolver);

      // Map GraphQL input to PatientContext
      const patientContext: PatientContext = {
        patientId: args.patientContext.patientId,
        conditionCodes: args.patientContext.conditionCodes ?? [],
        medications: args.patientContext.medications ?? [],
        labResults: args.patientContext.labResults ?? [],
        allergies: args.patientContext.allergies ?? [],
        vitalSigns: args.patientContext.vitalSigns,
      };

      return engine.computePathwayConfidence({
        pool,
        pathwayId: args.pathwayId,
        nodes,
        edges,
        signalDefinitions: signals,
        patientContext,
        institutionId: args.institutionId,
        organizationId: args.organizationId,
      });
    },
```

Add the `hydrateSignalDefinition` helper at the bottom of the file (outside the export). This same function is also used by Mutation.ts — extract it to a shared location if the implementer prefers (e.g., `services/confidence/hydration.ts`), but co-locating in Query.ts and importing from there is acceptable:

```typescript
export function hydrateSignalDefinition(row: any): SignalDefinition {
  const scoringRules = typeof row.scoring_rules === 'string'
    ? JSON.parse(row.scoring_rules)
    : row.scoring_rules;

  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    scoringType: row.scoring_type,
    scoringRules,
    propagationConfig: scoringRules.propagation ?? { mode: 'none' },
    scope: row.scope,
    institutionId: row.institution_id,
    defaultWeight: parseFloat(row.default_weight),
    isActive: row.is_active,
  };
}

async function loadPathwayGraph(pool: any, pathwayId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  // Look up the pathway to get its logical_id for AGE query
  const pathwayResult = await pool.query(
    `SELECT logical_id, version FROM pathway_graph_index WHERE id = $1`,
    [pathwayId]
  );

  if (!pathwayResult.rows[0]) {
    return { nodes: [], edges: [] };
  }

  const { logical_id } = pathwayResult.rows[0];

  // Query nodes from AGE
  const nodesResult = await executeCypher(
    pool,
    `MATCH (p:Pathway {logical_id: '${logical_id}'})-[*]->(n) RETURN id(n), n.node_id, labels(n), properties(n)`,
    '(id agtype, node_id agtype, labels agtype, props agtype)'
  );

  const nodes: GraphNode[] = nodesResult.rows.map((row: any) => ({
    id: String(row.id),
    nodeIdentifier: String(row.node_id).replace(/"/g, ''),
    nodeType: String(row.labels).replace(/[\[\]"]/g, ''),
    properties: typeof row.props === 'string' ? JSON.parse(row.props) : row.props ?? {},
  }));

  // Query edges from AGE
  const edgesResult = await executeCypher(
    pool,
    `MATCH (p:Pathway {logical_id: '${logical_id}'})-[*]->(a)-[r]->(b) RETURN id(r), type(r), a.node_id, b.node_id, properties(r)`,
    '(id agtype, edge_type agtype, source agtype, target agtype, props agtype)'
  );

  const edges: GraphEdge[] = edgesResult.rows.map((row: any) => ({
    id: String(row.id),
    edgeType: String(row.edge_type).replace(/"/g, ''),
    sourceId: String(row.source).replace(/"/g, ''),
    targetId: String(row.target).replace(/"/g, ''),
    properties: typeof row.props === 'string' ? JSON.parse(row.props) : row.props ?? {},
  }));

  return { nodes, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --prefix apps/pathway-service src/__tests__/confidence-query-resolvers.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/resolvers/Query.ts apps/pathway-service/src/__tests__/confidence-query-resolvers.test.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add confidence query resolvers (pathwayConfidence, signalDefinitions, effectiveWeights, effectiveThresholds)"
```

---

### Task 15: Confidence Mutation Resolvers

**Files:**
- Modify: `apps/pathway-service/src/resolvers/Mutation.ts`
- Test: `apps/pathway-service/src/__tests__/confidence-mutation-resolvers.test.ts`

Admin CRUD mutations for signal definitions, weight overrides, node weights, and resolution thresholds. Resolvers are thin — validate scope consistency then write to DB.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pathway-service/src/__tests__/confidence-mutation-resolvers.test.ts

import { Mutation } from '../resolvers/Mutation';

function createMockContext() {
  return {
    pool: {
      query: jest.fn(),
    },
    redis: {},
    userId: 'test-user',
    userRole: 'ADMIN',
  };
}

describe('Confidence mutation resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createSignalDefinition', () => {
    it('should insert a new signal definition and return it', async () => {
      const ctx = createMockContext();
      const insertedRow = {
        id: 'new-signal-id',
        name: 'custom_signal',
        display_name: 'Custom Signal',
        description: 'A custom signal',
        scoring_type: 'CUSTOM_RULES',
        scoring_rules: '{"rules":[],"default_score":0.5}',
        scope: 'INSTITUTION',
        institution_id: 'inst-1',
        default_weight: 0.15,
        is_active: true,
      };
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [insertedRow] });

      const result = await Mutation.Mutation.createSignalDefinition(
        {},
        {
          input: {
            name: 'custom_signal',
            displayName: 'Custom Signal',
            description: 'A custom signal',
            scoringType: 'CUSTOM_RULES',
            scoringRules: { rules: [], default_score: 0.5 },
            scope: 'INSTITUTION',
            institutionId: 'inst-1',
            defaultWeight: 0.15,
          },
        },
        ctx as any
      );

      expect(result.name).toBe('custom_signal');
      expect(result.displayName).toBe('Custom Signal');
    });

    it('should reject INSTITUTION scope without institutionId', async () => {
      const ctx = createMockContext();

      await expect(
        Mutation.Mutation.createSignalDefinition(
          {},
          {
            input: {
              name: 'test',
              displayName: 'Test',
              scoringType: 'CUSTOM_RULES',
              scoringRules: {},
              scope: 'INSTITUTION',
              defaultWeight: 0.1,
              // missing institutionId
            },
          },
          ctx as any
        )
      ).rejects.toThrow('institutionId is required');
    });
  });

  describe('setSignalWeight', () => {
    it('should upsert a signal weight override', async () => {
      const ctx = createMockContext();
      const row = {
        id: 'weight-1',
        signal_definition_id: 'signal-1',
        weight: 0.40,
        scope: 'PATHWAY',
        pathway_id: 'pathway-1',
        node_identifier: null,
        node_type: null,
        institution_id: null,
      };
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [row] });

      const result = await Mutation.Mutation.setSignalWeight(
        {},
        {
          input: {
            signalDefinitionId: 'signal-1',
            weight: 0.40,
            scope: 'PATHWAY',
            pathwayId: 'pathway-1',
          },
        },
        ctx as any
      );

      expect(result.weight).toBe(0.40);
      expect(result.scope).toBe('PATHWAY');
    });
  });

  describe('setResolutionThresholds', () => {
    it('should upsert resolution thresholds', async () => {
      const ctx = createMockContext();
      const row = {
        id: 'threshold-1',
        auto_resolve_threshold: 0.90,
        suggest_threshold: 0.65,
        scope: 'PATHWAY',
        pathway_id: 'pathway-1',
        node_identifier: null,
        institution_id: null,
      };
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [row] });

      const result = await Mutation.Mutation.setResolutionThresholds(
        {},
        {
          input: {
            autoResolveThreshold: 0.90,
            suggestThreshold: 0.65,
            scope: 'PATHWAY',
            pathwayId: 'pathway-1',
          },
        },
        ctx as any
      );

      expect(result.autoResolveThreshold).toBe(0.90);
    });
  });

  describe('deleteSignalDefinition', () => {
    it('should delete and return true', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      const result = await Mutation.Mutation.deleteSignalDefinition(
        {},
        { id: 'signal-to-delete' },
        ctx as any
      );

      expect(result).toBe(true);
    });

    it('should throw if signal not found', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rowCount: 0 });

      await expect(
        Mutation.Mutation.deleteSignalDefinition({}, { id: 'nonexistent' }, ctx as any)
      ).rejects.toThrow('not found');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --prefix apps/pathway-service src/__tests__/confidence-mutation-resolvers.test.ts --no-coverage`
Expected: FAIL — `createSignalDefinition` is not a function

- [ ] **Step 3: Add confidence mutation resolvers to Mutation.ts**

Add the following resolvers inside the `Mutation.Mutation` object in `apps/pathway-service/src/resolvers/Mutation.ts`, after the existing `reactivatePathway` resolver:

```typescript
    async createSignalDefinition(
      _parent: unknown,
      args: { input: any },
      context: DataSourceContext
    ) {
      const { pool } = context;
      const { input } = args;

      // Scope validation
      if (input.scope === 'INSTITUTION' && !input.institutionId) {
        throw new GraphQLError('institutionId is required for INSTITUTION scope', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // Merge propagationConfig into scoring_rules if provided
      let scoringRules = input.scoringRules;
      if (input.propagationConfig) {
        scoringRules = { ...scoringRules, propagation: input.propagationConfig };
      }

      const result = await pool.query(
        `INSERT INTO confidence_signal_definitions
         (name, display_name, description, scoring_type, scoring_rules, scope, institution_id, default_weight)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, display_name, description, scoring_type, scoring_rules, scope, institution_id, default_weight, is_active`,
        [
          input.name,
          input.displayName,
          input.description || '',
          input.scoringType,
          JSON.stringify(scoringRules),
          input.scope,
          input.institutionId || null,
          input.defaultWeight,
        ]
      );

      return hydrateSignalDefinition(result.rows[0]);
    },

    async updateSignalDefinition(
      _parent: unknown,
      args: { id: string; input: any },
      context: DataSourceContext
    ) {
      const { pool } = context;
      const { id, input } = args;

      const setClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input.displayName !== undefined) {
        setClauses.push(`display_name = $${paramIdx++}`);
        params.push(input.displayName);
      }
      if (input.description !== undefined) {
        setClauses.push(`description = $${paramIdx++}`);
        params.push(input.description);
      }
      if (input.scoringRules !== undefined) {
        let rules = input.scoringRules;
        if (input.propagationConfig) {
          rules = { ...rules, propagation: input.propagationConfig };
        }
        setClauses.push(`scoring_rules = $${paramIdx++}`);
        params.push(JSON.stringify(rules));
      } else if (input.propagationConfig) {
        // Update propagation in existing scoring_rules
        setClauses.push(`scoring_rules = scoring_rules || $${paramIdx++}::jsonb`);
        params.push(JSON.stringify({ propagation: input.propagationConfig }));
      }
      if (input.defaultWeight !== undefined) {
        setClauses.push(`default_weight = $${paramIdx++}`);
        params.push(input.defaultWeight);
      }
      if (input.isActive !== undefined) {
        setClauses.push(`is_active = $${paramIdx++}`);
        params.push(input.isActive);
      }

      if (setClauses.length === 0) {
        throw new GraphQLError('No fields to update', { extensions: { code: 'BAD_USER_INPUT' } });
      }

      params.push(id);
      const result = await pool.query(
        `UPDATE confidence_signal_definitions SET ${setClauses.join(', ')}
         WHERE id = $${paramIdx}
         RETURNING id, name, display_name, description, scoring_type, scoring_rules, scope, institution_id, default_weight, is_active`,
        params
      );

      if (!result.rows[0]) {
        throw new GraphQLError('Signal definition not found', { extensions: { code: 'NOT_FOUND' } });
      }

      return hydrateSignalDefinition(result.rows[0]);
    },

    async deleteSignalDefinition(
      _parent: unknown,
      args: { id: string },
      context: DataSourceContext
    ) {
      const result = await context.pool.query(
        `DELETE FROM confidence_signal_definitions WHERE id = $1`,
        [args.id]
      );

      if (result.rowCount === 0) {
        throw new GraphQLError('Signal definition not found', { extensions: { code: 'NOT_FOUND' } });
      }

      return true;
    },

    async setSignalWeight(
      _parent: unknown,
      args: { input: any },
      context: DataSourceContext
    ) {
      const { pool } = context;
      const { input } = args;

      // Scope validation
      if ((input.scope === 'NODE') && (!input.pathwayId || !input.nodeIdentifier)) {
        throw new GraphQLError('pathwayId and nodeIdentifier required for NODE scope', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      if (input.scope === 'PATHWAY' && !input.pathwayId) {
        throw new GraphQLError('pathwayId required for PATHWAY scope', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const result = await pool.query(
        `INSERT INTO confidence_signal_weights
         (signal_definition_id, weight, scope, pathway_id, node_identifier, node_type, institution_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT confidence_signal_weights_unique
         DO UPDATE SET weight = $2
         RETURNING id, signal_definition_id, weight, scope, pathway_id, node_identifier, node_type, institution_id`,
        [
          input.signalDefinitionId,
          input.weight,
          input.scope,
          input.pathwayId || null,
          input.nodeIdentifier || null,
          input.nodeType || null,
          input.institutionId || null,
        ]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        signalDefinitionId: row.signal_definition_id,
        weight: parseFloat(row.weight),
        scope: row.scope,
        pathwayId: row.pathway_id,
        nodeIdentifier: row.node_identifier,
        nodeType: row.node_type,
        institutionId: row.institution_id,
      };
    },

    async removeSignalWeight(
      _parent: unknown,
      args: { id: string },
      context: DataSourceContext
    ) {
      const result = await context.pool.query(
        `DELETE FROM confidence_signal_weights WHERE id = $1`,
        [args.id]
      );
      if (result.rowCount === 0) {
        throw new GraphQLError('Signal weight not found', { extensions: { code: 'NOT_FOUND' } });
      }
      return true;
    },

    async setNodeWeight(
      _parent: unknown,
      args: { input: any },
      context: DataSourceContext
    ) {
      const { pool } = context;
      const { input } = args;

      const result = await pool.query(
        `INSERT INTO confidence_node_weights
         (pathway_id, node_identifier, node_type, institution_id, weight_override, propagation_overrides)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT confidence_node_weights_unique
         DO UPDATE SET weight_override = $5, propagation_overrides = $6
         RETURNING id, pathway_id, node_identifier, node_type, default_weight, institution_id, weight_override, propagation_overrides`,
        [
          input.pathwayId,
          input.nodeIdentifier,
          input.nodeType,
          input.institutionId || null,
          input.weightOverride ?? null,
          JSON.stringify(input.propagationOverrides ?? {}),
        ]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        pathwayId: row.pathway_id,
        nodeIdentifier: row.node_identifier,
        nodeType: row.node_type,
        defaultWeight: parseFloat(row.default_weight),
        institutionId: row.institution_id,
        weightOverride: row.weight_override ? parseFloat(row.weight_override) : null,
        propagationOverrides: row.propagation_overrides,
      };
    },

    async removeNodeWeight(
      _parent: unknown,
      args: { id: string },
      context: DataSourceContext
    ) {
      const result = await context.pool.query(
        `DELETE FROM confidence_node_weights WHERE id = $1`,
        [args.id]
      );
      if (result.rowCount === 0) {
        throw new GraphQLError('Node weight not found', { extensions: { code: 'NOT_FOUND' } });
      }
      return true;
    },

    async setResolutionThresholds(
      _parent: unknown,
      args: { input: any },
      context: DataSourceContext
    ) {
      const { pool } = context;
      const { input } = args;

      if (input.scope === 'NODE' && (!input.pathwayId || !input.nodeIdentifier)) {
        throw new GraphQLError('pathwayId and nodeIdentifier required for NODE scope', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const result = await pool.query(
        `INSERT INTO confidence_resolution_thresholds
         (auto_resolve_threshold, suggest_threshold, scope, pathway_id, node_identifier, institution_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT confidence_resolution_thresholds_unique
         DO UPDATE SET auto_resolve_threshold = $1, suggest_threshold = $2
         RETURNING id, auto_resolve_threshold, suggest_threshold, scope, pathway_id, node_identifier, institution_id`,
        [
          input.autoResolveThreshold,
          input.suggestThreshold,
          input.scope,
          input.pathwayId || null,
          input.nodeIdentifier || null,
          input.institutionId || null,
        ]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        autoResolveThreshold: parseFloat(row.auto_resolve_threshold),
        suggestThreshold: parseFloat(row.suggest_threshold),
        scope: row.scope,
        pathwayId: row.pathway_id,
        nodeIdentifier: row.node_identifier,
        institutionId: row.institution_id,
      };
    },

    async removeResolutionThresholds(
      _parent: unknown,
      args: { id: string },
      context: DataSourceContext
    ) {
      const result = await context.pool.query(
        `DELETE FROM confidence_resolution_thresholds WHERE id = $1`,
        [args.id]
      );
      if (result.rowCount === 0) {
        throw new GraphQLError('Resolution thresholds not found', { extensions: { code: 'NOT_FOUND' } });
      }
      return true;
    },
```

Import `hydrateSignalDefinition` from Query.ts (or a shared module) instead of duplicating:

```typescript
import { hydrateSignalDefinition } from './Query';
```

Then use `hydrateSignalDefinition(result.rows[0])` in all mutation resolvers that return signal definitions.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --prefix apps/pathway-service src/__tests__/confidence-mutation-resolvers.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/resolvers/Mutation.ts apps/pathway-service/src/__tests__/confidence-mutation-resolvers.test.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add confidence admin mutation resolvers (signal CRUD, weights, thresholds)"
```

---

## Chunk 7: Barrel Export and Startup Wiring

### Task 16: Barrel Export

**Files:**
- Create: `apps/pathway-service/src/services/confidence/index.ts`

- [ ] **Step 1: Create the barrel export**

```typescript
// apps/pathway-service/src/services/confidence/index.ts

export { ScorerRegistry } from './scorer-registry';
export { WeightCascadeResolver } from './weight-cascade-resolver';
export { ConfidenceEngine } from './confidence-engine';
export { DataCompletenessScorer } from './scorers/data-completeness';
export { EvidenceStrengthScorer } from './scorers/evidence-strength';
export { PatientMatchQualityScorer } from './scorers/patient-match-quality';
export { RiskMagnitudeScorer } from './scorers/risk-magnitude';
export { CustomRulesScorer } from './scorers/custom-rules';
export * from './types';
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck --prefix apps/pathway-service`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-graphql add apps/pathway-service/src/services/confidence/index.ts
git -C /home/claude/workspace/prism-graphql commit -m "feat: add confidence module barrel export"
```

---

### Task 17: Run All Tests

Final verification that everything works together.

- [ ] **Step 1: Run all pathway-service tests**

Run: `npx jest --prefix apps/pathway-service --no-coverage`
Expected: All tests PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck --prefix apps/pathway-service`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint --prefix apps/pathway-service`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git -C /home/claude/workspace/prism-graphql add -A apps/pathway-service/
git -C /home/claude/workspace/prism-graphql commit -m "chore: fix any lint/typecheck issues in confidence framework"
```
