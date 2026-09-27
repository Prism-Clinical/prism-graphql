# Evaluation Interpreter — Phase 1: Compiler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure compiler that turns a stored or authored pathway into a validated, typed `CompiledPathway`. Use it to refuse activation of pathways that cannot be evaluated, to report problems at import, and to compile (and cache) every pathway inside the evaluation snapshot. Evaluation still runs on `TraversalEngine`.

**Architecture:** `compilePathway(input)` runs the existing strict import validator, then the compiler's own rules:
- node and edge kinds;
- reachability and ownership;
- acyclicity and deterministic orders;
- gate/choice arms, and strict `depends_on`;
- datum resolution against the attribute code map;
- temporal checks.

It returns `{ ok: true, model }` or `{ ok: false, errors }`. Stored pathways are turned back into pathway JSON with `pathwayJsonFromStoredGraph` (ported from the unmerged commit `1340e1a`), so import, activation and evaluation compile one input shape.

**Tech Stack:** TypeScript 5 (strict), Jest + ts-jest, PostgreSQL + Apache AGE (`pg`), no new dependencies.

**Revision:** revised after review of `c7985ec`. Changes:
- activation compiles and activates one locked graph version (Task 8);
- complete gate-payload validation (Task 3);
- registry-typed datums (Task 4);
- the compiler owns and freezes its output (Task 5);
- a bounded, canonical-key cache (Task 7);
- Q13 guidance names legal graph shapes (Task 3).

**Second review (of `d8711e2`)** added:
- conflicting code-map aliases are an error when read (Task 4);
- operands are validated against operator and datum type (Task 4);
- counting and bucket-existence keep their own semantics (Tasks 3–4);
- the lock tests synchronize on observed lock state (Task 8);
- the Q13 "all apply" guidance is legal for Step and Stage targets (Task 3).

**Spec:** `docs/superpowers/specs/2026-09-26-evaluation-interpreter-design.md` (branch `docs/evaluation-interpreter-design` @ `5601bc4`) — §3 (execution model), §3.5 V1–V10, §4.8 (annotation order), §5.1 (DatumRef), §8, §10.5 phase 1, §11.2 Q3/Q9/Q10/Q13 (decided 2026-09-27).

## Global Constraints

- **Worktree.** Branch `feat/interpreter-01-compiler` from `origin/main` (`d377465` or later), created with `/new-feature` (prism-graphql only). Never switch branches in `/home/claude/workspace/prism-graphql`.
- **No runtime behaviour change** except that activation/reactivation refuse non-compiling pathways, archive accepts DRAFT, and draft saves and activations serialize on the pathway row lock (Task 8). `TraversalEngine`, `evaluate()`, hashes and the GraphQL schema are unchanged.
- **Do not pre-empt clinical decisions Q1, Q2, Q4, Q5, Q6, Q6a, Q7.** The compiler classifies edges and computes orders. It does not decide applicability, joins, defaults or answer precedence.
- **Q13 (decided):** a condition (`patient_attribute`/`compound`) or `prior_node_result` gate must have exactly one `BRANCHES_TO` target. The error message names both fixes: one containing Step/Stage (all apply), or a DecisionPoint (alternatives).
- **Q10 (decided):** non-compiling drafts cannot be activated; anemia 1.1–1.3 are archived (Task 10, approval-gated).
- **Strict TypeScript.** Jest runs ts-jest with diagnostics off, so a green jest run is not proof the code compiles. Every task ends with `node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`, run from the worktree root.
- **Suite baseline:** 9 known failures in `data-completeness-scorer` and `patient-match-scorer`. Any other failure blocks the task.
- **Commits** use conventional prefixes. Per CLAUDE.md: no `@anthropic.com`/`@claude.com` Co-Authored-By lines and no "Generated with Claude Code" links.
- **Never `cd` chained with `&&`.** Use `npm --prefix`, `git -C`, absolute paths.
- **Live database:** reads only, except Task 10's archive step, which needs the user's explicit approval at that moment.

## Review Focus

These are the inputs the spec implies but no task's main tests exercise, most likely first. Each has a pinning test in its owning task.

1. **Stored edges with `properties: null`** (live exports have them): must read as `{}`. Pinned in Task 3 (`when` lookup on a null-properties edge).
2. **A stored graph including the `Pathway` root node** and authored JSON omitting it: exactly one root either way. Pinned in Task 7 (`pathwayJsonFromStoredGraph` round trip).
3. **Casing variants:**
   - `default_behavior: 'Traverse'` and compound `operator: 'and'` normalize;
   - `branch_mode: 'ONE_OF'` is an error (exact, per the existing validator).

   Pinned in Task 3.
4. **A code-map row added after process start:** must be seen by the next compile without a restart. Pinned in Task 6.
5. **Activating a metadata-only pathway (no AGE graph):** must not crash and is not blocked. Pinned in Task 8.

---

## File map

| File | Responsibility |
|---|---|
| Create `apps/pathway-service/src/services/compiler/model.ts` | Types and `COMPILER_VERSION` |
| Create `apps/pathway-service/src/services/compiler/kinds.ts` | Node-type → kind and edge-type → kind tables |
| Create `apps/pathway-service/src/services/compiler/structure.ts` | Containers, guards, owners; reachability (V2); acyclicity and orders (V3) |
| Create `apps/pathway-service/src/services/compiler/gates.ts` | Gate and choice compilation: vocabularies, arms (V4, V5, Q13), strict `depends_on` (V8) |
| Create `apps/pathway-service/src/services/compiler/datums.ts` | DatumRef resolution (V7) |
| Create `apps/pathway-service/src/services/compiler/temporal.ts` | Temporal checks and `requiresEncounterAnchor` (V9) |
| Create `apps/pathway-service/src/services/compiler/compile.ts` | `compilePathway`: validator + rules above; owns and freezes its output |
| Create `apps/pathway-service/src/services/compiler/immutable.ts` | `deepFreeze`, `FrozenMap` |
| Create `apps/pathway-service/src/services/compiler/cache.ts` | `compileCached`: bounded LRU keyed on canonical content |
| Create `apps/pathway-service/src/services/compiler/stored-input.ts` | Read index row + codes; build `CompileInput` from a stored graph |
| Create `apps/pathway-service/src/services/compiler/report.ts` | Merge compile errors into an import `ValidationResult` as warnings |
| Create `apps/pathway-service/src/services/import/stored-graph.ts` | Ported verbatim from `1340e1a` |
| Create `apps/pathway-service/src/scripts/compile-stored-pathways.ts` | Read-only corpus report |
| Modify `apps/pathway-service/src/services/resolution/attribute-code-map.ts` | Remove the process-wide cache |
| Modify `apps/pathway-service/src/services/resolution/pipeline/load-env.ts` | Compile in the snapshot; `EvaluationEnv.compilation` |
| Modify `apps/pathway-service/src/resolvers/mutations/import.ts` | Activate/reactivate in one locked transaction that compiles what it activates; archive DRAFT |
| Modify `apps/pathway-service/src/services/import/import-orchestrator.ts` | Draft saves take the pathway row lock; report compile errors on import |
| Create tests under `apps/pathway-service/src/__tests__/compiler-*.test.ts` and fixtures under `__tests__/fixtures/compiler-corpus/` | — |

All test commands below run from the worktree root `W=/home/claude/workspace/features/feat-interpreter-01-compiler/prism-graphql`:
`npm test --prefix $W/apps/pathway-service -- --runInBand <path>`.

---

### Task 1: Compiler model and kind tables

**Files:**
- Create: `apps/pathway-service/src/services/compiler/model.ts`
- Create: `apps/pathway-service/src/services/compiler/kinds.ts`
- Test: `apps/pathway-service/src/__tests__/compiler-kinds.test.ts`

**Interfaces:**
- Produces: every type in `model.ts` (exact names used by all later tasks); `nodeKindOf(type: string, properties: Record<string, unknown>): NodeKind | null`; `edgeKindOf(type: string): EdgeKind | null`.

- [ ] **Step 1: Write `model.ts`** (types only; nothing to test on its own)

```ts
// apps/pathway-service/src/services/compiler/model.ts
import type { PathwayJson } from '../import/types';
import type { AttributeCodeMap } from '../resolution/types';
import type { PathwayTemporalDefaults } from '../resolution/temporal/cascade';

/** Bump whenever compiled output for the same input can change (it keys the cache). */
export const COMPILER_VERSION = '1';

export type NodeKind = 'root' | 'container' | 'gate' | 'choice' | 'action' | 'constraint' | 'item' | 'annotation';
export type EdgeKind = 'contains' | 'guards' | 'owns' | 'references' | 'prerequisite' | 'alternative';
export type DatumKey = string;
export type DefaultBehavior = 'skip' | 'traverse';

export interface DatumSpec {
  key: DatumKey;
  domain: 'lab' | 'vital' | 'allergy' | 'attribute';
  valueType: 'number' | 'boolean' | 'string';
  /** Gate ids that read this datum, sorted. */
  readBy: string[];
}

export interface GateArm { id: string; target: string; when?: unknown }
export interface ChoiceArm { id: string; target: string }
export interface ArmRef { controller: string; armId: string }

/**
 * Phase 1 keeps each condition as authored (it is validated); the condition IR
 * (spec §5.2) replaces `conditions` in phase 2.
 */
export type CompiledGate =
  | { type: 'condition'; conditions: Record<string, unknown>[]; operator: 'AND' | 'OR' | null; onUnresolved: 'ask' | 'default'; defaultBehavior: DefaultBehavior }
  | { type: 'question'; answerType: 'boolean' | 'numeric' | 'select'; options: string[]; defaultBehavior: DefaultBehavior }
  | { type: 'prior_result'; dependsOn: { nodeId: string; status: string }[]; defaultBehavior: DefaultBehavior }
  | { type: 'llm'; properties: Record<string, unknown>; defaultBehavior: DefaultBehavior };

export type CompiledNode =
  | { kind: 'root' | 'container' | 'item' | 'action' | 'constraint' | 'annotation'; id: string; nodeType: string; properties: Record<string, unknown> }
  | { kind: 'gate'; id: string; nodeType: 'Gate'; properties: Record<string, unknown>; gate: CompiledGate; arms: GateArm[] }
  | { kind: 'choice'; id: string; nodeType: 'DecisionPoint'; properties: Record<string, unknown>; mode: 'one_of' | 'all_of' | 'any_of'; arms: ChoiceArm[] };

export interface CompiledPathway {
  compilerVersion: string;
  nodes: ReadonlyMap<string, CompiledNode>;
  /** Semantic nodes, topological over contains ∪ guards ∪ data, ties by nodeId. */
  order: string[];
  /** Annotations, topological over owns, ties by nodeId (spec §4.8). */
  annotationOrder: string[];
  containers: ReadonlyMap<string, string[]>;
  guards: ReadonlyMap<string, ArmRef[]>;
  owners: ReadonlyMap<string, string[]>;
  datums: ReadonlyMap<DatumKey, DatumSpec>;
  requiresEncounterAnchor: boolean;
}

export type CompileErrorCode =
  | 'VALIDATION' | 'UNKNOWN_NODE_TYPE' | 'UNKNOWN_EDGE_TYPE' | 'UNREACHABLE' | 'ORPHAN_ANNOTATION' | 'CYCLE'
  | 'GATE_TYPE' | 'DEFAULT_BEHAVIOR' | 'ON_UNRESOLVED' | 'COMPOUND_OPERATOR' | 'NO_TARGET'
  | 'MULTI_TARGET_NON_ROUTING_GATE' | 'MISSING_WHEN' | 'CHOICE_ARM_WHEN' | 'BRANCH_MODE' | 'DEPENDS_ON'
  | 'UNMAPPED_ATTRIBUTE' | 'UNKNOWN_PATIENT_ATTRIBUTE' | 'TEMPORAL' | 'NOT_FOUND' | 'PAYLOAD' | 'DATUM_TYPE';

export interface CompileError { code: CompileErrorCode; message: string; nodeId?: string }
export type CompileResult = { ok: true; model: CompiledPathway } | { ok: false; errors: CompileError[] };

export interface CompileInput {
  pathway: PathwayJson;
  codeMap: AttributeCodeMap;
  temporalDefaults: PathwayTemporalDefaults;
}

/** The compiler's internal graph shape: the root is an ordinary node with id "root". */
export interface GraphNodeIn { id: string; type: string; properties: Record<string, unknown> }
export interface GraphEdgeIn { from: string; to: string; type: string; properties: Record<string, unknown> }
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/compiler-kinds.test.ts
import { REQUIRED_NODE_PROPERTIES, VALID_EDGE_ENDPOINTS } from '../services/import/types';
import { edgeKindOf, nodeKindOf } from '../services/compiler/kinds';

describe('compiler kind tables', () => {
  it('gives every authorable edge type exactly one kind', () => {
    for (const type of Object.keys(VALID_EDGE_ENDPOINTS)) expect(edgeKindOf(type)).not.toBeNull();
  });

  it('gives every authorable node type a kind', () => {
    for (const type of Object.keys(REQUIRED_NODE_PROPERTIES)) expect(nodeKindOf(type, {})).not.toBeNull();
  });

  it('maps the spec §3.3 table', () => {
    expect(edgeKindOf('HAS_STEP')).toBe('contains');
    expect(edgeKindOf('HAS_GATE')).toBe('contains');
    expect(edgeKindOf('BRANCHES_TO')).toBe('guards');
    expect(edgeKindOf('CITES_EVIDENCE')).toBe('owns');
    expect(edgeKindOf('SELECTS_BRANCH')).toBe('references');
    expect(edgeKindOf('REQUIRES')).toBe('prerequisite');
    expect(edgeKindOf('ESCALATES_TO')).toBe('alternative');
    expect(edgeKindOf('HAS_CHILD')).toBeNull();
  });

  it('classifies a contraindicated or avoid Medication as a constraint (V10)', () => {
    expect(nodeKindOf('Medication', { role: 'first_line' })).toBe('action');
    expect(nodeKindOf('Medication', { role: 'contraindicated' })).toBe('constraint');
    expect(nodeKindOf('Medication', { role: 'avoid' })).toBe('constraint');
    expect(nodeKindOf('Pathway', {})).toBe('root');
    expect(nodeKindOf('Schedule', {})).toBe('item');
    expect(nodeKindOf('Criterion', {})).toBe('annotation');
    expect(nodeKindOf('Monitoring', {})).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-kinds.test.ts`
Expected: FAIL — `Cannot find module '../services/compiler/kinds'`.

- [ ] **Step 4: Write `kinds.ts`**

```ts
// apps/pathway-service/src/services/compiler/kinds.ts
import type { EdgeKind, NodeKind } from './model';

const NODE_KINDS: Record<string, NodeKind> = {
  Stage: 'container', Step: 'container',
  Gate: 'gate', DecisionPoint: 'choice',
  Medication: 'action', LabTest: 'action', Imaging: 'action', Procedure: 'action', Guidance: 'action',
  Schedule: 'item', QualityMetric: 'item',
  Criterion: 'annotation', EvidenceCitation: 'annotation', CodeEntry: 'annotation',
};

/** Spec §3.2. `null` for a type no pathway may contain. */
export function nodeKindOf(type: string, properties: Record<string, unknown>): NodeKind | null {
  if (type === 'Pathway') return 'root';
  const kind = NODE_KINDS[type] ?? null;
  if (type === 'Medication' && (properties.role === 'contraindicated' || properties.role === 'avoid')) return 'constraint';
  return kind;
}

const EDGE_KINDS: Record<string, EdgeKind> = {
  HAS_STAGE: 'contains', HAS_STEP: 'contains', HAS_GATE: 'contains', HAS_DECISION_POINT: 'contains',
  USES_MEDICATION: 'contains', HAS_LAB_TEST: 'contains', HAS_IMAGING: 'contains', HAS_PROCEDURE: 'contains',
  HAS_GUIDANCE: 'contains', HAS_SCHEDULE: 'contains', HAS_QUALITY_METRIC: 'contains',
  BRANCHES_TO: 'guards',
  HAS_CRITERION: 'owns', CITES_EVIDENCE: 'owns', HAS_CODE: 'owns',
  SELECTS_BRANCH: 'references',
  REQUIRES: 'prerequisite',
  ESCALATES_TO: 'alternative',
};

/** Spec §3.3. `null` for an edge type the compiler does not know. */
export function edgeKindOf(type: string): EdgeKind | null {
  return EDGE_KINDS[type] ?? null;
}
```

- [ ] **Step 5: Run the test, then typecheck**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-kinds.test.ts`
Expected: PASS (4 tests).
Run: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean`
Expected: `tsc-clean`.

- [ ] **Step 6: Commit**

```bash
git -C $W add apps/pathway-service/src/services/compiler apps/pathway-service/src/__tests__/compiler-kinds.test.ts
git -C $W commit -m "feat(pathway-service): compiler model and node/edge kind tables"
```

---

### Task 2: Structure — containment, guards, ownership, reachability, orders

**Files:**
- Create: `apps/pathway-service/src/services/compiler/structure.ts`
- Test: `apps/pathway-service/src/__tests__/compiler-structure.test.ts`

**Interfaces:**
- Consumes: `NodeKind`, `ArmRef`, `GraphEdgeIn`, `CompileError` (Task 1); `edgeKindOf` (Task 1).
- Produces: `buildStructure(kinds: Map<string, NodeKind>, edges: GraphEdgeIn[], dataDeps: Map<string, string[]>, errors: CompileError[]): Structure`, where `Structure = { containers: Map<string, string[]>; guards: Map<string, ArmRef[]>; owners: Map<string, string[]>; order: string[]; annotationOrder: string[] }`. `dataDeps` maps a gate id to the node ids it depends on. Arm ids are `${controller}->${target}`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/compiler-structure.test.ts
import { buildStructure } from '../services/compiler/structure';
import type { CompileError, GraphEdgeIn, NodeKind } from '../services/compiler/model';

const e = (from: string, to: string, type: string): GraphEdgeIn => ({ from, to, type, properties: {} });
const run = (kinds: Record<string, NodeKind>, edges: GraphEdgeIn[], deps: Record<string, string[]> = {}) => {
  const errors: CompileError[] = [];
  const s = buildStructure(new Map(Object.entries(kinds)), edges, new Map(Object.entries(deps)), errors);
  return { s, errors };
};
const shuffle = <T>(xs: T[], seed: number) => xs.map((x, i) => ({ x, k: (i * 7919 + seed * 104729) % 1009 })).sort((a, b) => a.k - b.k).map((p) => p.x);

describe('buildStructure', () => {
  // The live anemia shape: step-3-3 is both stage-contained and gate-guarded.
  const kinds: Record<string, NodeKind> = {
    root: 'root', 'stage-3': 'container', 'gate-severe': 'gate', 'step-3-3': 'container', 'proc-1': 'action',
    'z-med': 'action', 'a-code': 'annotation', 'crit-1': 'annotation', 'ev-1': 'annotation', 'dp-1': 'choice',
  };
  const edges = [
    e('root', 'stage-3', 'HAS_STAGE'), e('stage-3', 'gate-severe', 'HAS_GATE'), e('stage-3', 'step-3-3', 'HAS_STEP'),
    e('gate-severe', 'step-3-3', 'BRANCHES_TO'), e('step-3-3', 'proc-1', 'HAS_PROCEDURE'),
    e('stage-3', 'dp-1', 'HAS_DECISION_POINT'), e('dp-1', 'crit-1', 'HAS_CRITERION'), e('crit-1', 'ev-1', 'CITES_EVIDENCE'),
    e('proc-1', 'ev-1', 'CITES_EVIDENCE'), e('step-3-3', 'z-med', 'USES_MEDICATION'), e('z-med', 'a-code', 'HAS_CODE'),
    e('crit-1', 'step-3-3', 'SELECTS_BRANCH'),
  ];

  it('records containers and guards separately', () => {
    const { s, errors } = run(kinds, edges);
    expect(errors).toEqual([]);
    expect(s.containers.get('step-3-3')).toEqual(['stage-3']);
    expect(s.guards.get('step-3-3')).toEqual([{ controller: 'gate-severe', armId: 'gate-severe->step-3-3' }]);
  });

  it('orders every node after all of its parents, and annotations after their annotation owners', () => {
    const { s } = run(kinds, edges);
    const at = (id: string) => s.order.indexOf(id);
    expect(at('gate-severe')).toBeLessThan(at('step-3-3'));
    expect(at('stage-3')).toBeLessThan(at('step-3-3'));
    expect(s.order).not.toContain('crit-1');
    expect(s.annotationOrder.indexOf('crit-1')).toBeLessThan(s.annotationOrder.indexOf('ev-1'));
    expect(s.owners.get('ev-1')).toEqual(['crit-1', 'proc-1']);          // shared evidence, sorted
    expect(s.owners.get('a-code')).toEqual(['z-med']);                    // adversarial id order
  });

  it('is independent of edge order', () => {
    const base = run(kinds, edges).s;
    for (const seed of [1, 2, 3, 4, 5]) expect(run(kinds, shuffle(edges, seed)).s).toEqual(base);
  });

  it('orders a depends_on target before the gate that reads it', () => {
    const k: Record<string, NodeKind> = { root: 'root', stage: 'container', 'a-gate-dep': 'gate', 'z-step': 'container', 'b-step': 'container' };
    const { s, errors } = run(k, [
      e('root', 'stage', 'HAS_STAGE'), e('stage', 'a-gate-dep', 'HAS_GATE'), e('stage', 'z-step', 'HAS_STEP'),
      e('a-gate-dep', 'b-step', 'BRANCHES_TO'),
    ], { 'a-gate-dep': ['z-step'] });
    expect(errors).toEqual([]);
    expect(s.order.indexOf('z-step')).toBeLessThan(s.order.indexOf('a-gate-dep'));
  });

  it('rejects unreachable nodes and orphan annotations; SELECTS_BRANCH does not reach', () => {
    const { errors } = run(
      { root: 'root', stage: 'container', crit: 'annotation', lonely: 'container', ev: 'annotation' },
      [e('root', 'stage', 'HAS_STAGE'), e('crit', 'lonely', 'SELECTS_BRANCH')],
    );
    expect(errors.map((x) => [x.code, x.nodeId])).toEqual([
      ['UNREACHABLE', 'lonely'], ['ORPHAN_ANNOTATION', 'crit'], ['ORPHAN_ANNOTATION', 'ev'],
    ]);
  });

  it('rejects a cycle created by depends_on', () => {
    const { errors } = run(
      { root: 'root', stage: 'container', gate: 'gate', step: 'container' },
      [e('root', 'stage', 'HAS_STAGE'), e('stage', 'gate', 'HAS_GATE'), e('gate', 'step', 'BRANCHES_TO')],
      { gate: ['step'] },
    );
    expect(errors).toEqual([expect.objectContaining({ code: 'CYCLE', message: expect.stringContaining('gate, step') })]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-structure.test.ts`
Expected: FAIL — `Cannot find module '../services/compiler/structure'`.

- [ ] **Step 3: Write `structure.ts`**

```ts
// apps/pathway-service/src/services/compiler/structure.ts
import { edgeKindOf } from './kinds';
import type { ArmRef, CompileError, GraphEdgeIn, NodeKind } from './model';

export interface Structure {
  containers: Map<string, string[]>;
  guards: Map<string, ArmRef[]>;
  owners: Map<string, string[]>;
  order: string[];
  annotationOrder: string[];
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

/** Kahn's algorithm with a sorted ready set: the order depends only on the graph, never on input order. */
function topo(ids: string[], deps: Map<string, Set<string>>): { order: string[]; stuck: string[] } {
  const members = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const next = new Map<string, string[]>();
  for (const id of ids) {
    for (const before of deps.get(id) ?? []) {
      if (!members.has(before)) continue;
      indegree.set(id, indegree.get(id)! + 1);
      push(next, before, id);
    }
  }
  const ready = ids.filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const n of next.get(id) ?? []) {
      indegree.set(n, indegree.get(n)! - 1);
      if (indegree.get(n) === 0) { ready.push(n); ready.sort(); } // ponytail: O(n² log n) worst case; fine for a few hundred nodes
    }
  }
  const placed = new Set(order);
  return { order, stuck: ids.filter((id) => !placed.has(id)).sort() };
}

export function buildStructure(
  kinds: Map<string, NodeKind>,
  edges: GraphEdgeIn[],
  dataDeps: Map<string, string[]>,
  errors: CompileError[],
): Structure {
  const containers = new Map<string, string[]>();
  const guards = new Map<string, ArmRef[]>();
  const owners = new Map<string, string[]>();
  const forward = new Map<string, string[]>();
  const deps = new Map<string, Set<string>>();
  const follow = (node: string, before: string) => {
    const s = deps.get(node) ?? new Set<string>();
    s.add(before);
    deps.set(node, s);
  };

  for (const edge of edges) {
    const kind = edgeKindOf(edge.type);
    if (kind === 'contains') {
      push(containers, edge.to, edge.from); push(forward, edge.from, edge.to); follow(edge.to, edge.from);
    } else if (kind === 'guards') {
      push(guards, edge.to, { controller: edge.from, armId: `${edge.from}->${edge.to}` });
      push(forward, edge.from, edge.to); follow(edge.to, edge.from);
    } else if (kind === 'owns') {
      push(owners, edge.to, edge.from);
    }
  }
  for (const [gate, targets] of dataDeps) for (const t of targets) follow(gate, t);

  const semantic = [...kinds].filter(([, k]) => k !== 'annotation').map(([id]) => id);
  const annotations = [...kinds].filter(([, k]) => k === 'annotation').map(([id]) => id);

  // V2: every semantic node reachable from the root; every annotation owned.
  const seen = new Set<string>(['root']);
  const stack = ['root'];
  while (stack.length > 0) {
    for (const n of forward.get(stack.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  }
  for (const id of semantic.filter((x) => !seen.has(x)).sort()) {
    errors.push({ code: 'UNREACHABLE', nodeId: id, message: `Node "${id}" is not reachable from the pathway root through containment or branch edges` });
  }
  for (const id of annotations.filter((x) => !(owners.get(x)?.length)).sort()) {
    errors.push({ code: 'ORPHAN_ANNOTATION', nodeId: id, message: `Annotation "${id}" has no owner (HAS_CRITERION, CITES_EVIDENCE or HAS_CODE)` });
  }

  // V3: one order for semantic nodes, one for annotations.
  const sem = topo(semantic, deps);
  if (sem.stuck.length > 0) {
    errors.push({ code: 'CYCLE', message: `Cycle through containment, branch or depends_on edges involving: ${sem.stuck.join(', ')}` });
  }
  const annotationDeps = new Map(annotations.map((id) => [
    id, new Set((owners.get(id) ?? []).filter((o) => kinds.get(o) === 'annotation')),
  ]));
  const ann = topo(annotations, annotationDeps);
  if (ann.stuck.length > 0) {
    errors.push({ code: 'CYCLE', message: `Cycle through ownership edges involving: ${ann.stuck.join(', ')}` });
  }

  for (const m of [containers, owners]) for (const [k, v] of m) m.set(k, [...new Set(v)].sort());
  for (const [k, v] of guards) {
    guards.set(k, [...new Map(v.map((a) => [a.armId, a])).values()].sort((a, b) => (a.armId < b.armId ? -1 : 1)));
  }
  return { containers, guards, owners, order: sem.order, annotationOrder: ann.order };
}
```

- [ ] **Step 4: Run the test, then typecheck**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-structure.test.ts`
Expected: PASS (6 tests).
Run: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean`
Expected: `tsc-clean`.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/services/compiler/structure.ts apps/pathway-service/src/__tests__/compiler-structure.test.ts
git -C $W commit -m "feat(pathway-service): compiler structure — containers, guards, ownership, deterministic orders"
```

---

### Task 3: Gate and choice compilation (vocabulary, arms, payloads)

**Files:**
- Create: `apps/pathway-service/src/services/compiler/gates.ts`
- Test: `apps/pathway-service/src/__tests__/compiler-gates.test.ts`

**Interfaces:**
- Consumes: `CompiledGate`, `GateArm`, `ChoiceArm`, `CompileError`, `CompileErrorCode`, `GraphEdgeIn`, `NodeKind` (Task 1).
- Produces:
  - `compileGate(id: string, props: Record<string, unknown>, armEdges: GraphEdgeIn[], kinds: Map<string, NodeKind>, nodeTypes: Map<string, string>, errors: CompileError[]): { gate: CompiledGate; arms: GateArm[] } | null`;
  - `compileChoice(id: string, props: Record<string, unknown>, armEdges: GraphEdgeIn[], errors: CompileError[]): { mode: 'one_of' | 'all_of' | 'any_of'; arms: ChoiceArm[] }`;
  - `conditionProblem(c: unknown): string | null`, also used by Task 5's tests.

  `armEdges` are the node's outgoing `BRANCHES_TO` edges.

**Payload rules** (review of `c7985ec`, finding 2). A compiled gate must be usable, not just well-typed:
- `patient_attribute`: exactly one valid `condition`.
- `compound`: a non-empty array of valid `conditions`.
- **An attribute condition** needs an `operator`. `exists` needs no value. `in` needs a non-empty array. Every other operator needs a scalar `value`.
- **A coded condition** needs an `operator` and a non-empty code `value`. `greater_than` / `less_than` also need a finite numeric `threshold`. That removes the legacy fallback of comparing against `parseFloat(<code>)`, e.g. 718 for `718-7`.
- `question`: `answer_type` (any case; absent means boolean) must be boolean, numeric or select. A select question needs a non-empty `options` list of strings.
- `llm_text_analysis`: a non-empty `branches` list whose entries have a string `name`, with exactly one `is_safe_default: true`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/compiler-gates.test.ts
import { compileChoice, compileGate, conditionProblem } from '../services/compiler/gates';
import type { CompileError, GraphEdgeIn, NodeKind } from '../services/compiler/model';

const arm = (from: string, to: string, when?: unknown): GraphEdgeIn =>
  ({ from, to, type: 'BRANCHES_TO', properties: (when === undefined ? null : { when }) as never });
const kinds = new Map<string, NodeKind>([['step-a', 'container'], ['step-b', 'container'], ['crit', 'annotation'], ['med', 'action']]);
const types = new Map([['step-a', 'Step'], ['step-b', 'Step'], ['crit', 'Criterion'], ['med', 'Medication']]);
const gate = (props: Record<string, unknown>, arms: GraphEdgeIn[]) => {
  const errors: CompileError[] = [];
  return { out: compileGate('g', props, arms, kinds, types, errors), errors };
};
const LAB = { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 };

describe('compileGate', () => {
  it('normalizes default_behavior case and a lowercase compound operator; null edge properties read as {}', () => {
    const { out, errors } = gate(
      { gate_type: 'compound', default_behavior: 'Traverse', operator: 'and', conditions: [LAB] },
      [arm('g', 'step-a')],
    );
    expect(errors).toEqual([]);
    expect(out!.gate).toEqual({ type: 'condition', conditions: [LAB], operator: 'AND', onUnresolved: 'ask', defaultBehavior: 'traverse' });
    expect(out!.arms).toEqual([{ id: 'g->step-a', target: 'step-a' }]);
  });

  it('Q13: a condition gate with several targets is an error that describes the legal shapes', () => {
    const { errors } = gate({ gate_type: 'patient_attribute', default_behavior: 'skip', condition: LAB }, [arm('g', 'step-a'), arm('g', 'step-b')]);
    expect(errors).toEqual([expect.objectContaining({
      code: 'MULTI_TARGET_NON_ROUTING_GATE',
      message: expect.stringMatching(/use one gate per target, or put the target Steps under one Stage and guard that Stage.*guard one Step that contains a DecisionPoint/),
    })]);
  });

  it('a routing (question) gate with several targets needs `when` on every arm', () => {
    const { errors } = gate(
      { gate_type: 'question', default_behavior: 'skip', answer_type: 'boolean' },
      [arm('g', 'step-a', { equals: true }), arm('g', 'step-b')],
    );
    expect(errors).toEqual([expect.objectContaining({ code: 'MISSING_WHEN', message: expect.stringContaining('step-b') })]);
  });

  it('rejects unknown vocabularies and a gate with no target', () => {
    const { errors } = gate({ gate_type: 'patient_attribute', default_behavior: 'maybe', on_unresolved: 'never', condition: LAB }, []);
    expect(errors.map((e) => e.code)).toEqual(['DEFAULT_BEHAVIOR', 'NO_TARGET', 'ON_UNRESOLVED']);
  });

  it('payloads: a condition gate needs a usable condition; a SELECT question needs options (any case); an LLM gate needs one safe default', () => {
    const codes = (p: Record<string, unknown>) => gate(p, [arm('g', 'step-a')]).errors.map((e) => e.code);
    expect(codes({ gate_type: 'patient_attribute', default_behavior: 'skip' })).toEqual(['PAYLOAD']);
    expect(codes({ gate_type: 'compound', default_behavior: 'skip', conditions: [] })).toEqual(['PAYLOAD']);
    expect(codes({ gate_type: 'question', default_behavior: 'skip', answer_type: 'SELECT' })).toEqual(['PAYLOAD']);
    expect(codes({ gate_type: 'question', default_behavior: 'skip', answer_type: 'SELECT', options: ['a', 'b'] })).toEqual([]);
    expect(codes({ gate_type: 'question', default_behavior: 'skip', answer_type: 'text' })).toEqual(['PAYLOAD']);
    expect(codes({ gate_type: 'llm_text_analysis', default_behavior: 'skip', branches: [{ name: 'a' }, { name: 'b' }] })).toEqual(['PAYLOAD']);
    expect(codes({ gate_type: 'llm_text_analysis', default_behavior: 'skip', branches: [{ name: 'a', is_safe_default: true }] })).toEqual([]);
  });

  it('V8: depends_on must be canonical, with an exact status, on a non-annotation, non-Medication target', () => {
    const bare = gate({ gate_type: 'prior_node_result', default_behavior: 'skip', depends_on: 'step-a' }, [arm('g', 'step-b')]);
    expect(bare.errors.map((e) => e.code)).toEqual(['DEPENDS_ON']);

    const bad = gate({
      gate_type: 'prior_node_result', default_behavior: 'skip',
      depends_on: [{ node_id: 'step-a', status: 'included' }, { node_id: 'crit', status: 'INCLUDED' }, { node_id: 'med', status: 'INCLUDED' }],
    }, [arm('g', 'step-b')]);
    expect(bad.errors.map((e) => e.message)).toEqual([
      expect.stringContaining('status "included"'),
      expect.stringContaining('"crit" is an annotation'),
      expect.stringContaining('"med" is a Medication'),
    ]);

    const good = gate({ gate_type: 'prior_node_result', default_behavior: 'skip', depends_on: [{ node_id: 'step-a', status: 'INCLUDED' }] }, [arm('g', 'step-b')]);
    expect(good.errors).toEqual([]);
    expect(good.out!.gate).toEqual({ type: 'prior_result', dependsOn: [{ nodeId: 'step-a', status: 'INCLUDED' }], defaultBehavior: 'skip' });
  });
});

describe('conditionProblem', () => {
  it.each([
    [{ attribute: 'patient.trimester', operator: 'less_than' }, 'needs a value'],
    [{ attribute: 'patient.trimester', operator: 'in', value: [] }, 'non-empty array'],
    [{ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, 'numeric threshold'],
    [{ field: 'labs', operator: 'less_than', value: '', threshold: 7 }, 'code value'],
    [{ operator: 'equals', value: 1 }, 'field or attribute'],
  ])('rejects %j', (c, fragment) => expect(conditionProblem(c)).toContain(fragment));

  it.each([
    [{ attribute: 'patient.trimester', operator: 'less_than', value: 3 }],
    [{ attribute: 'patient.trimester', operator: 'in', value: [1, 3] }],
    [{ attribute: 'allergy.metronidazole', operator: 'exists' }],
    [LAB],
    [{ field: 'conditions', operator: 'includes_code', value: 'O99.0*', system: 'ICD-10' }],
    [{ field: 'labs', operator: 'exists', value: '' }],
  ])('accepts %j', (c) => expect(conditionProblem(c)).toBeNull());
});

describe('compileChoice', () => {
  it('accepts arms without `when` and requires an exact branch_mode', () => {
    const errors: CompileError[] = [];
    expect(compileChoice('dp', { branch_mode: 'one_of' }, [arm('dp', 'step-b'), arm('dp', 'step-a')], errors))
      .toEqual({ mode: 'one_of', arms: [{ id: 'dp->step-a', target: 'step-a' }, { id: 'dp->step-b', target: 'step-b' }] });
    expect(errors).toEqual([]);

    compileChoice('dp', { branch_mode: 'ONE_OF' }, [arm('dp', 'step-a', { equals: true })], errors);
    expect(errors.map((e) => e.code)).toEqual(['BRANCH_MODE', 'CHOICE_ARM_WHEN']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-gates.test.ts`
Expected: FAIL — `Cannot find module '../services/compiler/gates'`.

- [ ] **Step 3: Write `gates.ts`**

```ts
// apps/pathway-service/src/services/compiler/gates.ts
import { NodeStatus } from '../../types';
import type { ChoiceArm, CompileError, CompileErrorCode, CompiledGate, DefaultBehavior, GateArm, GraphEdgeIn, NodeKind } from './model';

const STATUSES = new Set<string>(Object.values(NodeStatus));
const GATE_TYPES: Record<string, CompiledGate['type']> = {
  patient_attribute: 'condition', compound: 'condition', question: 'question',
  prior_node_result: 'prior_result', llm_text_analysis: 'llm',
};
const SCALAR_CODED = new Set(['greater_than', 'less_than']);
const whenOf = (edge: GraphEdgeIn): unknown => (edge.properties ?? {}).when;
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isScalar = (v: unknown) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';

/** Why a condition cannot be evaluated as written, or null. Operator vocabularies are checked by the import validator. */
export function conditionProblem(c: unknown): string | null {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return 'a condition must be an object';
  const r = c as Record<string, unknown>;
  if (typeof r.attribute === 'string') {
    if (typeof r.operator !== 'string') return `the condition on "${r.attribute}" has no operator`;
    if (r.operator === 'exists') return null;
    if (r.operator === 'in') return Array.isArray(r.value) && r.value.length > 0 ? null : `the condition on "${r.attribute}" (in) needs a non-empty array value`;
    return isScalar(r.value) ? null : `the condition on "${r.attribute}" (${r.operator}) needs a value to compare against`;
  }
  if (typeof r.field === 'string') {
    if (typeof r.operator !== 'string') return `the condition on ${r.field} has no operator`;
    if (r.operator === 'exists') return null; // bucket existence: the adapter ignores code and system (condition-adapter.ts)
    if (typeof r.value !== 'string' || r.value === '') return `the condition on ${r.field} (${r.operator}) needs a code value`;
    if (SCALAR_CODED.has(r.operator) && !(typeof r.threshold === 'number' && Number.isFinite(r.threshold))) {
      return `the condition on ${r.field} ${r.value} (${r.operator}) needs a numeric threshold`;
    }
    return null;
  }
  return 'a condition needs either field or attribute';
}

export function compileGate(
  id: string,
  props: Record<string, unknown>,
  armEdges: GraphEdgeIn[],
  kinds: Map<string, NodeKind>,
  nodeTypes: Map<string, string>,
  errors: CompileError[],
): { gate: CompiledGate; arms: GateArm[] } | null {
  const err = (code: CompileErrorCode, message: string) => errors.push({ code, nodeId: id, message: `Gate "${id}": ${message}` });

  const type = GATE_TYPES[String(props.gate_type ?? '')];
  if (!type) { err('GATE_TYPE', `unknown gate_type "${String(props.gate_type)}"`); return null; }

  const db = String(props.default_behavior ?? '').toLowerCase();
  if (db !== 'skip' && db !== 'traverse') err('DEFAULT_BEHAVIOR', `default_behavior must be "skip" or "traverse" (got "${String(props.default_behavior)}")`);
  const defaultBehavior: DefaultBehavior = db === 'traverse' ? 'traverse' : 'skip';

  const arms: GateArm[] = armEdges
    .map((e) => (whenOf(e) === undefined ? { id: `${id}->${e.to}`, target: e.to } : { id: `${id}->${e.to}`, target: e.to, when: whenOf(e) }))
    .sort(byId);
  if (arms.length === 0) err('NO_TARGET', 'has no BRANCHES_TO target');

  const routing = type === 'question' || type === 'llm';
  if (routing && arms.length > 1) {
    for (const a of arms) if (a.when === undefined) err('MISSING_WHEN', `the branch to "${a.target}" needs a \`when\`, because the gate routes to ${arms.length} targets`);
  }
  if (!routing && arms.length > 1) {
    // BRANCHES_TO targets only Steps/Stages and only a Stage contains Steps (VALID_EDGE_ENDPOINTS), so these are the legal rewrites.
    err('MULTI_TARGET_NON_ROUTING_GATE',
      `a ${String(props.gate_type)} gate is evaluated from the chart and must guard exactly one target, but it has ${arms.length} ` +
      `(${arms.map((a) => a.target).join(', ')}). If all of them apply, use one gate per target, or put the target Steps under one Stage and guard that Stage. ` +
      `If they are alternatives, guard one Step that contains a DecisionPoint whose branches go to them.`);
  }

  switch (type) {
    case 'condition': {
      const ou = props.on_unresolved === undefined ? 'ask' : String(props.on_unresolved);
      if (ou !== 'ask' && ou !== 'default') err('ON_UNRESOLVED', `on_unresolved must be "ask" or "default" (got "${ou}")`);
      const onUnresolved = ou === 'default' ? 'default' : 'ask';
      if (props.gate_type === 'compound') {
        const op = String(props.operator ?? 'AND').toUpperCase();
        if (op !== 'AND' && op !== 'OR') err('COMPOUND_OPERATOR', `compound operator must be AND or OR (got "${String(props.operator)}")`);
        const conditions = Array.isArray(props.conditions) ? (props.conditions as Record<string, unknown>[]) : [];
        if (conditions.length === 0) err('PAYLOAD', 'a compound gate needs at least one condition');
        conditions.forEach((c, i) => { const p = conditionProblem(c); if (p) err('PAYLOAD', `condition ${i + 1}: ${p}`); });
        return { gate: { type, conditions, operator: op === 'OR' ? 'OR' : 'AND', onUnresolved, defaultBehavior }, arms };
      }
      if (props.condition === undefined || props.condition === null) {
        err('PAYLOAD', 'a patient_attribute gate needs a condition');
        return { gate: { type, conditions: [], operator: null, onUnresolved, defaultBehavior }, arms };
      }
      const p = conditionProblem(props.condition);
      if (p) err('PAYLOAD', p);
      return { gate: { type, conditions: [props.condition as Record<string, unknown>], operator: null, onUnresolved, defaultBehavior }, arms };
    }
    case 'question': {
      const at = String(props.answer_type ?? 'boolean').toLowerCase();
      if (at !== 'boolean' && at !== 'numeric' && at !== 'select') err('PAYLOAD', `answer_type must be boolean, numeric or select (got "${String(props.answer_type)}")`);
      const answerType = at === 'numeric' ? 'numeric' : at === 'select' ? 'select' : 'boolean';
      const options = Array.isArray(props.options) ? (props.options as unknown[]).filter((o): o is string => typeof o === 'string') : [];
      if (answerType === 'select' && options.length === 0) err('PAYLOAD', 'a select question needs a non-empty list of options');
      return { gate: { type, answerType, options, defaultBehavior }, arms };
    }
    case 'prior_result': {
      const raw = props.depends_on;
      const dependsOn: { nodeId: string; status: string }[] = [];
      if (!Array.isArray(raw) || raw.length === 0) {
        err('DEPENDS_ON', `depends_on must be a non-empty array of { node_id, status } (got ${JSON.stringify(raw)})`);
      } else {
        for (const d of raw as unknown[]) {
          const entry = d as { node_id?: unknown; status?: unknown } | null;
          if (typeof entry !== 'object' || entry === null || typeof entry.node_id !== 'string' || typeof entry.status !== 'string') {
            err('DEPENDS_ON', `depends_on entry ${JSON.stringify(d)} must be { node_id, status }`);
            continue;
          }
          const nodeId = entry.node_id;
          const status = entry.status;
          if (!STATUSES.has(status)) err('DEPENDS_ON', `depends_on status "${status}" is not one of ${[...STATUSES].join(', ')}`);
          const kind = kinds.get(nodeId);
          if (!kind) err('DEPENDS_ON', `depends_on target "${nodeId}" does not exist`);
          else if (kind === 'annotation') err('DEPENDS_ON', `depends_on target "${nodeId}" is an annotation; depend on its owner instead`);
          else if (nodeTypes.get(nodeId) === 'Medication') err('DEPENDS_ON', `depends_on target "${nodeId}" is a Medication, which can be withheld after evaluation (EP D11)`);
          dependsOn.push({ nodeId, status });
        }
      }
      return { gate: { type, dependsOn, defaultBehavior }, arms };
    }
    case 'llm': {
      const branches = Array.isArray(props.branches) ? (props.branches as Array<Record<string, unknown>>) : [];
      if (branches.length === 0 || branches.some((b) => typeof b?.name !== 'string')) err('PAYLOAD', 'an llm_text_analysis gate needs a non-empty list of named branches');
      if (branches.filter((b) => b?.is_safe_default === true).length !== 1) err('PAYLOAD', 'an llm_text_analysis gate needs exactly one branch with is_safe_default: true');
      return { gate: { type, properties: props, defaultBehavior }, arms };
    }
  }
}

export function compileChoice(
  id: string,
  props: Record<string, unknown>,
  armEdges: GraphEdgeIn[],
  errors: CompileError[],
): { mode: 'one_of' | 'all_of' | 'any_of'; arms: ChoiceArm[] } {
  const mode = props.branch_mode;
  if (mode !== 'one_of' && mode !== 'all_of' && mode !== 'any_of') {
    errors.push({ code: 'BRANCH_MODE', nodeId: id, message: `DecisionPoint "${id}": branch_mode must be one_of, all_of or any_of (got "${String(mode)}")` });
  }
  for (const e of armEdges) {
    if (whenOf(e) !== undefined) errors.push({ code: 'CHOICE_ARM_WHEN', nodeId: id, message: `DecisionPoint "${id}": the branch to "${e.to}" has a \`when\`; a DecisionPoint selects by qualification or provider choice, not by answer value` });
  }
  const arms = armEdges.map((e) => ({ id: `${id}->${e.to}`, target: e.to })).sort(byId);
  return { mode: mode === 'all_of' || mode === 'any_of' ? mode : 'one_of', arms };
}
```

- [ ] **Step 4: Run the test, then typecheck**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-gates.test.ts`
Expected: PASS (18 tests).
Run: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean`
Expected: `tsc-clean`.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/services/compiler apps/pathway-service/src/__tests__/compiler-gates.test.ts
git -C $W commit -m "feat(pathway-service): compile gates and decision points — vocabulary, arms (Q13), payloads, strict depends_on"
```

---

### Task 4: Datum identity and temporal checks

**Files:**
- Create: `apps/pathway-service/src/services/compiler/datums.ts`
- Create: `apps/pathway-service/src/services/compiler/temporal.ts`
- Test: `apps/pathway-service/src/__tests__/compiler-datums-temporal.test.ts`

**Interfaces:**
- Consumes: `DatumSpec`, `DatumKey`, `CompileError` (Task 1).
  Also consumes:
  - `AttributeCodeMap` (`services/resolution/types`);
  - `KNOWN_PATIENT_ATTRIBUTES` (`services/resolution/attribute-vocabulary`);
  - `sweepableConditions` (`resolvers/helpers/resolution-context`);
  - `collectEncounterAnchorRequirements`, `PathwayTemporalDefaults` (`services/resolution/temporal/cascade`);
  - `TemporalContextError` (`services/resolution/temporal/evaluation-context`).
- Produces:
  - `buildDatumRegistry(codeMap: AttributeCodeMap): DatumRegistry`, where `DatumRegistry = { types: Map<DatumKey, 'number' | 'boolean' | 'string'>; conflicts: Map<DatumKey, string> }`. It is built once per compilation;
  - `resolveDatums(gateId: string, conditions: Record<string, unknown>[], codeMap: AttributeCodeMap, registry: DatumRegistry, datums: Map<DatumKey, DatumSpec>, errors: CompileError[]): void`;
  - `checkTemporal(nodes: GraphNodeIn[], codeMap: AttributeCodeMap, temporalDefaults: PathwayTemporalDefaults, errors: CompileError[]): boolean`, which returns `requiresEncounterAnchor`.

**Datum keys** (spec §5.1):
- `lab:<system>:<code>` for coded `labs` and for `lab.*` attributes (via their code-map row);
- `allergy:<system>:<code>` for `allergy.*` attributes;
- `vital:<path>` for coded `vitals` and `vitals.*` attributes;
- `attribute:<name>` for `patient.*`.

**Which conditions read a datum.** Only reads of a value create one:
- coded `greater_than`, `less_than`, `trend_up`, `trend_down` and `delta_from_baseline` on labs or vitals. These **require a numeric value**;
- every attribute condition.

These create no datum:
- coded `includes_code`, `equals` and `exists`, which are **membership** queries;
- coded `count_in_window`, which counts dated occurrences and does not need a value of any type (review of `d8711e2`, finding 3). A count is never askable, so it needs no datum;
- coded `conditions`, `medications` and `allergies`.

**A datum's value type comes from a registry, never from the first reader.**
- For a lab or allergy key, the type is the code-map row with that `(system, code)`, whichever alias reads it. With no row, a lab is `number`.
- Vitals are `number`.
- Patient attributes come from `KNOWN_PATIENT_ATTRIBUTES`.

The registry is built once per compilation. Two attribute aliases mapping to one code with **different** types is recorded as a conflict, never resolved by picking one. The schema allows it: migration 062 makes only `attribute_name` unique.

These are compile errors (`DATUM_TYPE`):
- reading a conflicted key (the message names the aliases and their types);
- a numeric read (an ordered attribute comparison, or a coded numeric operator) on a datum whose type is not `number`.

**Operands are validated against the operator and the datum's type** (`PAYLOAD`):
- `greater_than` / `greater_or_equal` / `less_than` / `less_or_equal` need a finite number;
- `equals` / `not_equals` need a value of the datum's type;
- `in` needs a non-empty list whose members are all of the datum's type;
- `exists` needs no operand.

Nothing is coerced: `"2"` does not equal `2`, matching `compareScalar`'s strict `===`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/compiler-datums-temporal.test.ts
import { buildDatumRegistry, resolveDatums } from '../services/compiler/datums';
import { checkTemporal } from '../services/compiler/temporal';
import type { CompileError, DatumKey, DatumSpec } from '../services/compiler/model';
import { buildCodeMap } from '../services/resolution/attribute-code-map';

const codeMap = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
  { attributeName: 'lab.rh_factor', namespace: 'lab', system: 'LOINC', code: '10331-7', valueType: 'string' },
  { attributeName: 'allergy.metronidazole', namespace: 'allergy', system: 'RXNORM', code: '6922', valueType: 'boolean' },
]);
type Reader = [string, Record<string, unknown>[]];
const resolve = (readers: Reader[], map = codeMap) => {
  const datums = new Map<DatumKey, DatumSpec>();
  const errors: CompileError[] = [];
  const registry = buildDatumRegistry(map);
  for (const [gate, conditions] of readers) resolveDatums(gate, conditions, map, registry, datums, errors);
  return { datums: [...datums.values()].sort((a, b) => (a.key < b.key ? -1 : 1)), errors };
};

const READERS: Reader[] = [
  ['g2', [{ attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 }]],
  ['g1', [{ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 }]],
  ['g3', [
    { attribute: 'patient.trimester', operator: 'in', value: [1, 3] },
    { attribute: 'vitals.systolic_bp', operator: 'greater_than', value: 140 },
    { field: 'vitals', operator: 'greater_than', value: 'systolic_bp', threshold: 140 },
    { attribute: 'allergy.metronidazole', operator: 'equals', value: true },
    { field: 'conditions', operator: 'includes_code', value: 'O99.0*', system: 'ICD-10' },
    { field: 'labs', operator: 'equals', value: '10331-7', system: 'LOINC' },
    { attribute: 'lab.rh_factor', operator: 'equals', value: 'negative' },
  ]],
];

describe('resolveDatums', () => {
  it('gives coded and attribute spellings one key and one registry type, and records every reader', () => {
    const { datums, errors } = resolve(READERS);
    expect(errors).toEqual([]);
    expect(datums).toEqual([
      { key: 'allergy:RXNORM:6922', domain: 'allergy', valueType: 'boolean', readBy: ['g3'] },
      { key: 'attribute:trimester', domain: 'attribute', valueType: 'number', readBy: ['g3'] },
      { key: 'lab:LOINC:10331-7', domain: 'lab', valueType: 'string', readBy: ['g3'] },   // membership read added nothing
      { key: 'lab:LOINC:718-7', domain: 'lab', valueType: 'number', readBy: ['g1', 'g2'] },
      { key: 'vital:systolic_bp', domain: 'vital', valueType: 'number', readBy: ['g3'] },
    ]);
  });

  it('is independent of reader order', () => {
    expect(resolve([...READERS].reverse())).toEqual(resolve(READERS));
    const g3 = READERS[2];
    expect(resolve([[g3[0], [...g3[1]].reverse()], READERS[0], READERS[1]])).toEqual(resolve(READERS));
  });

  it('rejects a numeric comparison on a non-numeric datum, whichever alias reads it', () => {
    expect(resolve([['g', [{ field: 'labs', operator: 'less_than', value: '10331-7', system: 'LOINC', threshold: 1 }]]]).errors.map((e) => e.code)).toEqual(['DATUM_TYPE']);
    expect(resolve([['g', [{ attribute: 'lab.rh_factor', operator: 'greater_than', value: 1 }]]]).errors.map((e) => e.code)).toEqual(['DATUM_TYPE']);
  });

  it('counting a string lab and bucket existence need no numeric value; trend on a string lab does', () => {
    expect(resolve([['g', [{ field: 'labs', operator: 'count_in_window', value: '10331-7', system: 'LOINC', window_days: 30, count_threshold: 1 }]]])).toEqual({ datums: [], errors: [] });
    expect(resolve([['g', [{ field: 'labs', operator: 'exists', value: '' }]]])).toEqual({ datums: [], errors: [] });
    expect(resolve([['g', [{ field: 'labs', operator: 'trend_up', value: '10331-7', system: 'LOINC' }]]]).errors.map((e) => e.code)).toEqual(['DATUM_TYPE']);
  });

  it('conflicting alias declarations are an error when read, identically in either code-map order', () => {
    const rows = [
      { attributeName: 'lab.rh_factor', namespace: 'lab', system: 'LOINC', code: '10331-7', valueType: 'string' as const },
      { attributeName: 'lab.rh_alias', namespace: 'lab', system: 'LOINC', code: '10331-7', valueType: 'number' as const },
    ];
    const read: Reader[] = [['g', [{ attribute: 'lab.rh_factor', operator: 'equals', value: 'negative' }]]];
    const forward = resolve(read, buildCodeMap(rows));
    expect(forward.errors).toEqual([expect.objectContaining({
      code: 'DATUM_TYPE', message: expect.stringContaining('lab.rh_alias (number), lab.rh_factor (string)'),
    })]);
    expect(resolve(read, buildCodeMap([...rows].reverse()))).toEqual(forward);
    // Agreeing aliases are fine.
    expect(resolve(read, buildCodeMap(rows.map((r) => ({ ...r, valueType: 'string' as const })))).errors).toEqual([]);
    // A conflict nobody reads is not an error.
    expect(resolve([['g', [{ attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 }]]], buildCodeMap([...rows, codeMap.get('lab.hemoglobin')!])).errors).toEqual([]);
  });

  it.each([
    [{ attribute: 'patient.trimester', operator: 'less_than', value: 'oops' }],
    [{ attribute: 'patient.trimester', operator: 'in', value: [{}] }],
    [{ attribute: 'patient.trimester', operator: 'in', value: [1, '2'] }],
    [{ attribute: 'patient.trimester', operator: 'equals', value: true }],
    [{ attribute: 'lab.rh_factor', operator: 'equals', value: 1 }],
    [{ attribute: 'allergy.metronidazole', operator: 'equals', value: 'yes' }],
  ])('rejects an operand that does not match its operator and datum type: %j', (c) => {
    expect(resolve([['g', [c]]]).errors.map((e) => e.code)).toEqual(['PAYLOAD']);
  });

  it.each([
    [{ attribute: 'patient.trimester', operator: 'in', value: [1, 3] }],
    [{ attribute: 'patient.trimester', operator: 'less_or_equal', value: 2 }],
    [{ attribute: 'lab.rh_factor', operator: 'not_equals', value: 'positive' }],
    [{ attribute: 'allergy.metronidazole', operator: 'equals', value: true }],
    [{ attribute: 'allergy.metronidazole', operator: 'exists' }],
  ])('accepts a correctly typed operand: %j', (c) => {
    expect(resolve([['g', [c]]]).errors).toEqual([]);
  });

  it('rejects an unmapped lab attribute and an unknown patient attribute', () => {
    expect(resolve([['g', [
      { attribute: 'lab.MCV', operator: 'less_than', value: 80 },
      { attribute: 'patient.parity', operator: 'equals', value: 2 },
    ]]]).errors.map((e) => e.code)).toEqual(['UNMAPPED_ATTRIBUTE', 'UNKNOWN_PATIENT_ATTRIBUTE']);
  });
});

describe('checkTemporal', () => {
  const gateNode = (condition: Record<string, unknown>) => [{ id: 'g', type: 'Gate', properties: { gate_type: 'patient_attribute', default_behavior: 'skip', condition } }];

  it('reports whether the pathway needs an encounter anchor (vitals default to ENCOUNTER under v1)', () => {
    const errors: CompileError[] = [];
    expect(checkTemporal(gateNode({ field: 'vitals', operator: 'greater_than', value: 'systolic_bp', threshold: 140 }), codeMap, {}, errors)).toBe(true);
    expect(checkTemporal(gateNode({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 }), codeMap, {}, errors)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('turns an invalid temporal override into a compile error', () => {
    const errors: CompileError[] = [];
    checkTemporal(gateNode({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7, horizon: 'QUARTER', window_days: 30 }), codeMap, {}, errors);
    expect(errors).toEqual([expect.objectContaining({ code: 'TEMPORAL' })]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-datums-temporal.test.ts`
Expected: FAIL — `Cannot find module '../services/compiler/datums'`.

- [ ] **Step 3: Write `datums.ts` and `temporal.ts`**

```ts
// apps/pathway-service/src/services/compiler/datums.ts
import { KNOWN_PATIENT_ATTRIBUTES } from '../resolution/attribute-vocabulary';
import type { AttributeCodeMap } from '../resolution/types';
import type { CompileError, DatumKey, DatumSpec } from './model';

type ValueType = DatumSpec['valueType'];
export interface DatumRegistry { types: Map<DatumKey, ValueType>; conflicts: Map<DatumKey, string> }

const NUMERIC_CODED = new Set(['greater_than', 'less_than', 'trend_up', 'trend_down', 'delta_from_baseline']);
const ORDERED_ATTRIBUTE_OPS = new Set(['greater_than', 'greater_or_equal', 'less_than', 'less_or_equal']);
const keyOfRow = (row: { namespace: string; system: string; code: string }): DatumKey =>
  `${row.namespace === 'allergy' ? 'allergy' : 'lab'}:${row.system}:${row.code}`;

/** Once per compilation. Aliases must agree on a code's type; a disagreement is kept as a conflict, never resolved by picking one. */
export function buildDatumRegistry(codeMap: AttributeCodeMap): DatumRegistry {
  const declared = new Map<DatumKey, Map<ValueType, string[]>>();
  for (const row of codeMap.values()) {
    const byType = declared.get(keyOfRow(row)) ?? new Map<ValueType, string[]>();
    byType.set(row.valueType, [...(byType.get(row.valueType) ?? []), row.attributeName].sort());
    declared.set(keyOfRow(row), byType);
  }
  const types = new Map<DatumKey, ValueType>();
  const conflicts = new Map<DatumKey, string>();
  for (const [key, byType] of declared) {
    if (byType.size === 1) { types.set(key, [...byType.keys()][0]); continue; }
    conflicts.set(key, [...byType].map(([t, names]) => names.map((n) => `${n} (${t})`)).flat().sort().join(', '));
  }
  return { types, conflicts };
}

const ofType = (v: unknown, t: ValueType) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === t);

/** Why an attribute condition's operand cannot be compared with a `t` datum, or null. No coercion. */
function operandProblem(op: string, value: unknown, t: ValueType): string | null {
  if (op === 'exists') return null;
  if (ORDERED_ATTRIBUTE_OPS.has(op)) return typeof value === 'number' && Number.isFinite(value) ? null : `${op} needs a finite number (got ${JSON.stringify(value)})`;
  if (op === 'in') return Array.isArray(value) && value.length > 0 && value.every((v) => ofType(v, t)) ? null : `in needs a non-empty list of ${t} values (got ${JSON.stringify(value)})`;
  return ofType(value, t) ? null : `${op} needs a ${t} value (got ${JSON.stringify(value)})`;
}

export function resolveDatums(
  gateId: string,
  conditions: Record<string, unknown>[],
  codeMap: AttributeCodeMap,
  registry: DatumRegistry,
  datums: Map<DatumKey, DatumSpec>,
  errors: CompileError[],
): void {
  const fail = (code: 'DATUM_TYPE' | 'PAYLOAD', message: string) => errors.push({ code, nodeId: gateId, message: `Gate "${gateId}": ${message}` });
  /** Records the read; returns the datum's type, or null when the read is invalid. */
  const add = (key: DatumKey, domain: DatumSpec['domain'], fallback: ValueType, numeric: boolean): ValueType | null => {
    const conflict = registry.conflicts.get(key);
    if (conflict) { fail('DATUM_TYPE', `${key} is declared with conflicting types by ${conflict}; fix pathway_attribute_code_map`); return null; }
    const valueType = registry.types.get(key) ?? fallback;
    if (numeric && valueType !== 'number') { fail('DATUM_TYPE', `compares ${key} numerically, but it is a ${valueType} value`); return null; }
    const d = datums.get(key);
    if (!d) datums.set(key, { key, domain, valueType, readBy: [gateId] });
    else if (!d.readBy.includes(gateId)) { d.readBy.push(gateId); d.readBy.sort(); }
    return valueType;
  };
  const checkOperand = (c: Record<string, unknown>, t: ValueType | null) => {
    if (t === null) return;
    const p = operandProblem(String(c.operator ?? ''), c.value, t);
    if (p) fail('PAYLOAD', `condition on "${String(c.attribute)}": ${p}`);
  };

  for (const c of conditions) {
    const op = String(c.operator ?? '');
    if (typeof c.attribute === 'string') {
      const [ns, ...rest] = c.attribute.split('.');
      const name = rest.join('.');
      const numeric = ORDERED_ATTRIBUTE_OPS.has(op);
      if (ns === 'lab' || ns === 'allergy') {
        const row = codeMap.get(c.attribute);
        if (!row) {
          errors.push({ code: 'UNMAPPED_ATTRIBUTE', nodeId: gateId, message: `Gate "${gateId}": attribute "${c.attribute}" has no pathway_attribute_code_map row, so it cannot be read` });
          continue;
        }
        checkOperand(c, add(keyOfRow(row), ns, row.valueType, numeric));
      } else if (ns === 'vitals') {
        checkOperand(c, add(`vital:${name}`, 'vital', 'number', numeric));
      } else if (ns === 'patient') {
        const known = KNOWN_PATIENT_ATTRIBUTES.find((p) => p.name === name);
        if (!known) {
          errors.push({ code: 'UNKNOWN_PATIENT_ATTRIBUTE', nodeId: gateId, message: `Gate "${gateId}": "${c.attribute}" is not a known patient attribute (${KNOWN_PATIENT_ATTRIBUTES.map((p) => p.name).join(', ')})` });
          continue;
        }
        checkOperand(c, add(`attribute:${name}`, 'attribute', known.valueType, numeric));
      }
      // Other namespaces are rejected by validatePathwayJson (V6).
    } else if (NUMERIC_CODED.has(op) && c.field === 'labs') {
      add(`lab:${String(c.system ?? 'LOINC')}:${String(c.value)}`, 'lab', 'number', true);
    } else if (NUMERIC_CODED.has(op) && c.field === 'vitals') {
      add(`vital:${String(c.value)}`, 'vital', 'number', true);
    }
    // Membership, count_in_window, and conditions/medications/allergies: no datum (spec §5.1; review of d8711e2 #3).
  }
}
```

```ts
// apps/pathway-service/src/services/compiler/temporal.ts
import { sweepableConditions } from '../../resolvers/helpers/resolution-context';
import { collectEncounterAnchorRequirements, PathwayTemporalDefaults } from '../resolution/temporal/cascade';
import { TemporalContextError } from '../resolution/temporal/evaluation-context';
import type { AttributeCodeMap } from '../resolution/types';
import type { CompileError, GraphNodeIn } from './model';

/**
 * V9: parse every temporal override under the v1 policy (the only policy the
 * interpreter will support, Q9) and report whether any condition needs an
 * encounter anchor. Whether a SESSION supplies the anchor is checked at
 * evaluation time (spec §4.9), not here.
 */
export function checkTemporal(
  nodes: GraphNodeIn[],
  codeMap: AttributeCodeMap,
  temporalDefaults: PathwayTemporalDefaults,
  errors: CompileError[],
): boolean {
  const graphNodes = nodes.map((n) => ({ id: n.id, nodeIdentifier: n.id, nodeType: n.type, properties: n.properties }));
  try {
    return collectEncounterAnchorRequirements(sweepableConditions(graphNodes, 'v1', codeMap), 'v1', temporalDefaults).length > 0;
  } catch (e) {
    if (e instanceof TemporalContextError) { errors.push({ code: 'TEMPORAL', message: e.message }); return false; }
    throw e;
  }
}
```

- [ ] **Step 4: Run the test, then typecheck**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-datums-temporal.test.ts`
Expected: PASS (19 tests).
- If the `horizon` + `window_days` case does not throw, read `temporal/cascade.ts` for the exact rejection TH04 D2 implements, and use that rejected input instead.
- Do not weaken `checkTemporal`.

Run: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean`
Expected: `tsc-clean`.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/services/compiler apps/pathway-service/src/__tests__/compiler-datums-temporal.test.ts
git -C $W commit -m "feat(pathway-service): compile datum identities with registry types (V7) and temporal checks (V9)"
```

---

### Task 5: `compilePathway`, and the corpus of stored pathways

**Files:**
- Create: `apps/pathway-service/src/services/compiler/compile.ts`
- Create: `apps/pathway-service/src/services/compiler/immutable.ts`
- Create: `apps/pathway-service/src/services/import/stored-graph.ts` (ported, see Step 1)
- Create fixtures: `apps/pathway-service/src/__tests__/fixtures/compiler-corpus/{anemia-1.4,anemia-1.1,ghtn-1,chronic-htn-1.0}.json`
- Test: `apps/pathway-service/src/__tests__/compiler-compile.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `validatePathwayJson` (`services/import/validator`); `PathwayJson` (`services/import/types`).
- Produces:
  - `compilePathway(input: CompileInput): CompileResult`;
  - `pathwayJsonFromStoredGraph(input: StoredGraphInput): PathwayJson`, plus `StoredPathwayRow` and `StoredGraphInput`, ported unchanged from `1340e1a`.

- [ ] **Step 1: Port `stored-graph.ts` and copy the corpus**

```bash
G=/home/claude/workspace/prism-graphql
git -C $G show 1340e1a:apps/pathway-service/src/services/import/stored-graph.ts > $W/apps/pathway-service/src/services/import/stored-graph.ts
R=$G/../features/docs-evaluation-interpreter-design/prism-graphql/docs/superpowers/records/evaluation-interpreter/probes/graphs
C=$W/apps/pathway-service/src/__tests__/fixtures/compiler-corpus
mkdir -p $C
cp $R/a1774566-42ce-43cc-b83c-1a5749b240e1.json $C/anemia-1.4.json
cp $R/100c5909-89e4-4306-b078-e0ac50f35c90.json $C/anemia-1.1.json
cp $R/9ee949c9-625a-48ac-873b-c121e8fd24e2.json $C/ghtn-1.json
cp $R/8d7fbfc6-06cf-4caa-a4e7-2efe07e9ea6c.json $C/chronic-htn-1.0.json
```

If the records directory is not present locally, fetch it:
`git -C $G fetch origin docs/evaluation-interpreter-design` and read the files with `git show origin/docs/evaluation-interpreter-design:<path>`.

These are the live stored graphs exported on 2026-09-26: pathway definitions only, no patient data.

- [ ] **Step 2: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/compiler-compile.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { compilePathway } from '../services/compiler/compile';
import type { CompileResult } from '../services/compiler/model';
import { buildCodeMap } from '../services/resolution/attribute-code-map';
import { pathwayJsonFromStoredGraph } from '../services/import/stored-graph';
import { MINIMAL_PATHWAY } from './fixtures/reference-pathway';

const codeMap = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
  { attributeName: 'lab.ferritin', namespace: 'lab', system: 'LOINC', code: '2276-4', valueType: 'number' },
  { attributeName: 'lab.rh_factor', namespace: 'lab', system: 'LOINC', code: '10331-7', valueType: 'string' },
  { attributeName: 'allergy.metronidazole', namespace: 'allergy', system: 'RXNORM', code: '6922', valueType: 'boolean' },
]);

/** A stored export (pathwayGraph query shape) → the pathway JSON the compiler reads, metadata from the root node. */
function corpus(file: string) {
  const g = JSON.parse(readFileSync(join(__dirname, 'fixtures/compiler-corpus', file), 'utf8')).data.pathwayGraph;
  const root = g.nodes.find((n: { id: string }) => n.id === 'root').properties;
  return pathwayJsonFromStoredGraph({
    pathway: { logicalId: root.logical_id, title: root.title, version: String(root.version), category: root.category, scope: root.scope, targetPopulation: root.target_population },
    conditionCodes: [{ code: 'O99.019', system: 'ICD-10' }],
    nodes: g.nodes,
    edges: g.edges.map((e: { properties: unknown }) => ({ ...e, properties: e.properties ?? {} })),
  });
}
const compile = (file: string) => compilePathway({ pathway: corpus(file), codeMap, temporalDefaults: {} });
/** MINIMAL_PATHWAY plus one gate `gate-x` on stage-1 guarding a new step-1-2. */
const withGate = (props: Record<string, unknown>) => ({
  ...MINIMAL_PATHWAY,
  nodes: [
    ...MINIMAL_PATHWAY.nodes,
    { id: 'gate-x', type: 'Gate', properties: { title: 'Gate X', ...props } },
    { id: 'step-1-2', type: 'Step', properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'Guarded' } },
  ],
  edges: [...MINIMAL_PATHWAY.edges, { from: 'stage-1', to: 'gate-x', type: 'HAS_GATE' }, { from: 'gate-x', to: 'step-1-2', type: 'BRANCHES_TO' }],
}) as never;
const codes = (r: CompileResult) => (r.ok ? [] : r.errors.map((e) => `${e.code}${e.nodeId ? `:${e.nodeId}` : ''}`));

describe('compilePathway', () => {
  it('compiles the minimal reference pathway', () => {
    const r = compilePathway({ pathway: MINIMAL_PATHWAY, codeMap, temporalDefaults: {} });
    expect(codes(r)).toEqual([]);
    if (!r.ok) return;
    expect(r.model.order).toEqual(['root', 'stage-1', 'step-1-1']);
    expect(r.model.nodes.get('root')?.kind).toBe('root');
  });

  it('compiles the live ACTIVE anemia 1.4 and records the stage-contained, gate-guarded transfusion step', () => {
    const r = compile('anemia-1.4.json');
    expect(codes(r)).toEqual([]);
    if (!r.ok) return;
    expect(r.model.containers.get('step-3-3')).toEqual(['stage-3']);
    expect(r.model.guards.get('step-3-3')).toEqual([{ controller: 'gate-severe-anemia', armId: 'gate-severe-anemia->step-3-3' }]);
    expect(r.model.order.indexOf('gate-severe-anemia')).toBeLessThan(r.model.order.indexOf('step-3-3'));
    expect([...r.model.datums.keys()].sort()).toEqual(['attribute:trimester', 'lab:LOINC:2276-4', 'lab:LOINC:718-7']);
    expect(r.model.requiresEncounterAnchor).toBe(false);
  });

  it('refuses anemia 1.1 (legacy condition dialect)', () => {
    const r = compile('anemia-1.1.json');
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors.map((e) => e.message).join('\n')).toMatch(/LT|EQUALS|IN/);
  });

  it('refuses GHTN: routing question gates without `when`, and Q13 on its compound gate', () => {
    const got = codes(compile('ghtn-1.json'));
    expect(got).toEqual(expect.arrayContaining([
      'MISSING_WHEN:gate-aspirin-indicated',
      'MISSING_WHEN:gate-htn-confirmed',
      'MULTI_TARGET_NON_ROUTING_GATE:gate-htn-diagnosed',
    ]));
  });

  it.each([
    ['patient_attribute with no condition', { gate_type: 'patient_attribute', default_behavior: 'skip' }],
    ['SELECT question with no options (uppercase answer_type)', { gate_type: 'question', default_behavior: 'skip', answer_type: 'SELECT' }],
    ['trimester comparison with no value', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'patient.trimester', operator: 'less_than' } }],
  ])('refuses an unusable gate payload: %s', (_label, props) => {
    const r = compilePathway({ pathway: withGate(props), codeMap, temporalDefaults: {} });
    expect(codes(r)).toContain('PAYLOAD:gate-x');
  });

  it.each([
    ['patient_attribute with a condition', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'patient.trimester', operator: 'less_than', value: 3 } }],
    ['SELECT question with options', { gate_type: 'question', default_behavior: 'skip', answer_type: 'SELECT', options: ['yes', 'no'], prompt: 'Which?' }],
  ])('compiles the well-formed equivalent: %s', (_label, props) => {
    expect(codes(compilePathway({ pathway: withGate(props), codeMap, temporalDefaults: {} }))).toEqual([]);
  });

  it.each([
    ['a trimester comparison against a string', { attribute: 'patient.trimester', operator: 'less_than', value: 'oops' }],
    ['an `in` list with a non-scalar member', { attribute: 'patient.trimester', operator: 'in', value: [{}] }],
  ])('refuses a malformed operand through the public compiler: %s', (_label, condition) => {
    expect(codes(compilePathway({ pathway: withGate({ gate_type: 'patient_attribute', default_behavior: 'skip', condition }), codeMap, temporalDefaults: {} }))).toContain('PAYLOAD:gate-x');
  });

  it.each([
    ['a count over a string-valued lab', { field: 'labs', operator: 'count_in_window', value: '10331-7', system: 'LOINC', window_days: 30, count_threshold: 1 }],
    ['bucket existence with an empty code', { field: 'labs', operator: 'exists', value: '' }],
  ])('compiles %s', (_label, condition) => {
    expect(codes(compilePathway({ pathway: withGate({ gate_type: 'patient_attribute', default_behavior: 'skip', condition }), codeMap, temporalDefaults: {} }))).toEqual([]);
  });

  it('conflicting code-map aliases fail the same way in either row order', () => {
    const rows = [...codeMap.values(), { attributeName: 'lab.rh_alias', namespace: 'lab', system: 'LOINC', code: '10331-7', valueType: 'number' as const }];
    const pathway = withGate({ gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'lab.rh_factor', operator: 'equals', value: 'negative' } });
    const a = compilePathway({ pathway, codeMap: buildCodeMap(rows), temporalDefaults: {} });
    expect(codes(a)).toEqual(['DATUM_TYPE:gate-x']);
    expect(compilePathway({ pathway, codeMap: buildCodeMap([...rows].reverse()), temporalDefaults: {} })).toEqual(a);
  });

  it('owns its output: later input edits cannot change an earlier result, and the result cannot be mutated', () => {
    const input = structuredClone(MINIMAL_PATHWAY);
    const r = compilePathway({ pathway: input, codeMap, temporalDefaults: {} });
    if (!r.ok) throw new Error('minimal pathway must compile');
    (input.nodes[0].properties as Record<string, unknown>).title = 'Edited after compile';
    expect(r.model.nodes.get('stage-1')!.properties.title).toBe('Assessment');
    expect(() => { (r.model.nodes.get('stage-1')!.properties as Record<string, unknown>).title = 'x'; }).toThrow(TypeError);
    expect(() => (r.model.nodes as Map<string, unknown>).set('x', {})).toThrow(TypeError);
    expect(() => (r.model.order as string[]).push('x')).toThrow(TypeError);
    expect(compilePathway({ pathway: structuredClone(MINIMAL_PATHWAY), codeMap, temporalDefaults: {} })).toEqual(r);
  });

  it('is deterministic under node and edge order', () => {
    const p = corpus('anemia-1.4.json');
    const reversed = { ...p, nodes: [...p.nodes].reverse(), edges: [...p.edges].reverse() };
    expect(compilePathway({ pathway: reversed, codeMap, temporalDefaults: {} })).toEqual(compilePathway({ pathway: p, codeMap, temporalDefaults: {} }));
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-compile.test.ts`
Expected: FAIL — `Cannot find module '../services/compiler/compile'`.

- [ ] **Step 4: Write `immutable.ts` and `compile.ts`**

The compiler owns its output (review of `c7985ec`, finding 4). The input is cloned before anything reads it, and the result is deep-frozen. Maps are `FrozenMap`, which rejects writes, since `Object.freeze` does not stop `Map.set`. A cached result can therefore be shared safely.

```ts
// apps/pathway-service/src/services/compiler/immutable.ts
const sealed = new WeakSet<object>();

/** A Map that rejects writes once constructed. `Object.freeze` does not stop Map.set, so compiled Maps use this. */
export class FrozenMap<K, V> extends Map<K, V> {
  constructor(entries: Iterable<readonly [K, V]> = []) {
    super();
    for (const [k, v] of entries) super.set(k, v);
    sealed.add(this);
  }
  set(key: K, value: V): this {
    if (sealed.has(this)) throw new TypeError('a compiled pathway is immutable');
    return super.set(key, value);
  }
  delete(_key: K): boolean { throw new TypeError('a compiled pathway is immutable'); }
  clear(): void { throw new TypeError('a compiled pathway is immutable'); }
}

/** Freeze a value and everything reachable from it, including Map keys and values. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    if (value instanceof Map) for (const [k, v] of value) { deepFreeze(k); deepFreeze(v); }
    else for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
```

```ts
// apps/pathway-service/src/services/compiler/compile.ts
import { validatePathwayJson } from '../import/validator';
import { buildDatumRegistry, resolveDatums } from './datums';
import { compileChoice, compileGate } from './gates';
import { edgeKindOf, nodeKindOf } from './kinds';
import {
  COMPILER_VERSION, CompileError, CompileInput, CompileResult, CompiledNode, DatumKey, DatumSpec, GraphEdgeIn, GraphNodeIn, NodeKind,
} from './model';
import { buildStructure } from './structure';
import { checkTemporal } from './temporal';
import { deepFreeze, FrozenMap } from './immutable';

/**
 * Authored or stored pathway → CompiledPathway (spec §3). Pure. Runs the strict
 * import validator first, so there is one set of authoring rules; the
 * compiler's own rules (V2, V3, V5-Q13, V7, V8 strict, V9, V10) follow.
 */
export function compilePathway(input: CompileInput): CompileResult {
  // Own the input: nothing in the result may alias the caller's objects.
  const pathway = structuredClone(input.pathway);
  const { codeMap, temporalDefaults } = input;
  const errors: CompileError[] = validatePathwayJson(pathway, { draftMode: false }).errors
    .map((message) => ({ code: 'VALIDATION' as const, message }));

  // Authored JSON addresses the root as "root" in edges and never lists it.
  const nodes: GraphNodeIn[] = [
    { id: 'root', type: 'Pathway', properties: {} },
    ...(pathway.nodes ?? []).filter((n) => n.id !== 'root').map((n) => ({ id: n.id, type: n.type as string, properties: n.properties ?? {} })),
  ];
  const edges: GraphEdgeIn[] = (pathway.edges ?? []).map((e) => ({ from: e.from, to: e.to, type: e.type as string, properties: e.properties ?? {} }));

  const kinds = new Map<string, NodeKind>();
  const nodeTypes = new Map(nodes.map((n) => [n.id, n.type]));
  for (const n of nodes) {
    const kind = nodeKindOf(n.type, n.properties);
    if (kind) kinds.set(n.id, kind);
    else errors.push({ code: 'UNKNOWN_NODE_TYPE', nodeId: n.id, message: `Node "${n.id}": unknown type "${n.type}"` });
  }
  for (const e of edges) {
    if (!edgeKindOf(e.type)) errors.push({ code: 'UNKNOWN_EDGE_TYPE', message: `Edge ${e.from} -> ${e.to}: unknown type "${e.type}"` });
  }

  const armsOf = (id: string) => edges.filter((e) => e.from === id && edgeKindOf(e.type) === 'guards');
  const compiled = new Map<string, CompiledNode>();
  const dataDeps = new Map<string, string[]>();
  const datums = new Map<DatumKey, DatumSpec>();
  const registry = buildDatumRegistry(codeMap);
  for (const n of [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const kind = kinds.get(n.id);
    if (!kind) continue;
    if (kind === 'gate') {
      const g = compileGate(n.id, n.properties, armsOf(n.id), kinds, nodeTypes, errors);
      if (!g) continue;
      compiled.set(n.id, { kind, id: n.id, nodeType: 'Gate', properties: n.properties, gate: g.gate, arms: g.arms });
      if (g.gate.type === 'prior_result') dataDeps.set(n.id, g.gate.dependsOn.map((d) => d.nodeId));
      if (g.gate.type === 'condition') resolveDatums(n.id, g.gate.conditions, codeMap, registry, datums, errors);
    } else if (kind === 'choice') {
      const c = compileChoice(n.id, n.properties, armsOf(n.id), errors);
      compiled.set(n.id, { kind, id: n.id, nodeType: 'DecisionPoint', properties: n.properties, mode: c.mode, arms: c.arms });
    } else {
      compiled.set(n.id, { kind, id: n.id, nodeType: n.type, properties: n.properties });
    }
  }

  const structure = buildStructure(kinds, edges, dataDeps, errors);
  const requiresEncounterAnchor = checkTemporal(nodes, codeMap, temporalDefaults, errors);
  if (errors.length > 0) return deepFreeze({ ok: false as const, errors });
  return deepFreeze({
    ok: true as const,
    model: {
      compilerVersion: COMPILER_VERSION,
      nodes: new FrozenMap(compiled),
      datums: new FrozenMap(datums),
      requiresEncounterAnchor,
      order: structure.order,
      annotationOrder: structure.annotationOrder,
      containers: new FrozenMap(structure.containers),
      guards: new FrozenMap(structure.guards),
      owners: new FrozenMap(structure.owners),
    },
  });
}
```

- [ ] **Step 5: Run the test, then typecheck**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-compile.test.ts`
Expected: PASS (16 tests).

**Falsification rules, not adjustments:**
- If `MINIMAL_PATHWAY` or anemia 1.4 fails, **stop and report the errors to the user.** Anemia 1.4 is the live ACTIVE pathway. Do not relax a rule, and do not edit the fixture, to make it pass.
- If GHTN produces *additional* error codes beyond the three asserted, that is expected. Record them in Task 10.

Run: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean`
Expected: `tsc-clean`.

- [ ] **Step 6: Commit**

```bash
git -C $W add apps/pathway-service/src/services/compiler/compile.ts apps/pathway-service/src/services/compiler/immutable.ts apps/pathway-service/src/services/import/stored-graph.ts apps/pathway-service/src/__tests__/compiler-compile.test.ts apps/pathway-service/src/__tests__/fixtures/compiler-corpus
git -C $W commit -m "feat(pathway-service): compilePathway over authored and stored pathways, with live corpus tests"
```

---

### Task 6: Read the attribute code map in every snapshot

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/attribute-code-map.ts` (whole file, 33 lines)
- Test: `apps/pathway-service/src/__tests__/attribute-code-map.test.ts`

**Interfaces:**
- Produces: `loadAttributeCodeMap(pool: Pick<Pool, 'query'>): Promise<AttributeCodeMap>`, which queries on every call. `__resetAttributeCodeMapCache` is removed; no test imports it (`grep -rn __resetAttributeCodeMapCache apps/pathway-service/src` finds only the definition).

Why: the process-wide cache means `buildResolutionContext` never reads the code map inside the evaluation snapshot. That breaks EP C4, and a new row is invisible until restart (spec §8). The table has 4 rows; one query per snapshot is cheap.

- [ ] **Step 1: Add the failing test** (append to the existing file)

```ts
import { loadAttributeCodeMap } from '../services/resolution/attribute-code-map';

describe('loadAttributeCodeMap', () => {
  it('reads the table on every call, so a new row is visible without a restart', async () => {
    const row = (name: string) => ({ attribute_name: name, namespace: 'lab', system: 'LOINC', code: '1-1', value_type: 'number' });
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [row('lab.hemoglobin')] })
      .mockResolvedValueOnce({ rows: [row('lab.hemoglobin'), row('lab.mcv')] });
    const pool = { query } as never;
    expect([...(await loadAttributeCodeMap(pool)).keys()]).toEqual(['lab.hemoglobin']);
    expect([...(await loadAttributeCodeMap(pool)).keys()]).toEqual(['lab.hemoglobin', 'lab.mcv']);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/attribute-code-map.test.ts`
Expected: FAIL — the second call returns only `['lab.hemoglobin']`, and `query` was called once (the cache).

- [ ] **Step 3: Replace the loader**

```ts
// apps/pathway-service/src/services/resolution/attribute-code-map.ts
import type { Pool } from 'pg';
import { AttributeCodeEntry, AttributeCodeMap } from './types';

export function buildCodeMap(rows: AttributeCodeEntry[]): AttributeCodeMap {
  const map: AttributeCodeMap = new Map();
  for (const r of rows) map.set(r.attributeName, r);
  return map;
}

/**
 * Read the code map. No cache: evaluation calls this inside its snapshot
 * transaction (EP C4), so the map is consistent with everything else the
 * mutation reads, and an added row is visible to the next request.
 */
export async function loadAttributeCodeMap(pool: Pick<Pool, 'query'>): Promise<AttributeCodeMap> {
  const { rows } = await pool.query(
    `SELECT attribute_name, namespace, system, code, value_type
       FROM pathway_attribute_code_map`,
  );
  return buildCodeMap(
    rows.map((r): AttributeCodeEntry => ({
      attributeName: r.attribute_name,
      namespace: r.namespace,
      system: r.system,
      code: r.code,
      valueType: r.value_type,
    })),
  );
}
```

- [ ] **Step 4: Run the test and the suites that load the code map, then typecheck**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/attribute-code-map.test.ts src/__tests__/gate-evaluator-codemap-threading.test.ts src/__tests__/pipeline-load-env.test.ts`
Expected: PASS.
Run: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean`
Expected: `tsc-clean`.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/attribute-code-map.ts apps/pathway-service/src/__tests__/attribute-code-map.test.ts
git -C $W commit -m "fix(pathway-service): read the attribute code map in each snapshot instead of caching it for the process"
```

---

### Task 7: Stored input, compile cache, and compiling inside the evaluation snapshot

**Files:**
- Create: `apps/pathway-service/src/services/compiler/stored-input.ts`
- Create: `apps/pathway-service/src/services/compiler/cache.ts`
- Modify: `apps/pathway-service/src/services/resolution/pipeline/load-env.ts` (`EvaluationEnv`, `readPathway`, `envOf`, `loadEvaluationEnv`, `loadRunEnv`)
- Test: `apps/pathway-service/src/__tests__/compiler-stored-input.test.ts`, `apps/pathway-service/src/__tests__/pipeline-load-env.test.ts`

**Interfaces:**
- Consumes: `compilePathway` (Task 5); `pathwayJsonFromStoredGraph`, `StoredPathwayRow` (Task 5); `fetchGraphFromAGE` (`resolvers/helpers/resolution-context`); `loadAttributeCodeMap` (Task 6); `parsePathwayTemporalDefaults` (`services/resolution/temporal/cascade`); `hashOf` (`services/resolution/pipeline/canonical`); `GraphNode`, `GraphEdge` (`services/confidence/types`).
- Produces:
  - `readStoredIndex(db: Pick<Pool, 'query'>, pathwayId: string): Promise<StoredIndex | null>`;
  - `compileCached` is a bounded LRU (256 entries), keyed on canonical content (nodes sorted by id, edges by from|to|type), so re-exported or reordered copies share an entry;
  - `compileInputFrom(index: StoredIndex, nodes: GraphNode[], edges: GraphEdge[], codeMap: AttributeCodeMap): CompileInput`;
  - `loadStoredCompileInput(db: Pick<Pool, 'query'>, pathwayId: string): Promise<CompileInput | null>` — `null` for a pathway with no index row or no graph. It takes a pool **or a transaction client**, and Task 8 passes the locked client;
  - `compileCached(input: CompileInput): CompileResult`;
  - `EvaluationEnv.compilation: CompileResult`.

  `StoredIndex` is `{ row: StoredPathwayRow & { id: string; ageNodeId: string | null; temporalDefaults: unknown }; conditionCodes: { code: string; system: string; description?: string | null }[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/pathway-service/src/__tests__/compiler-stored-input.test.ts
import { COMPILE_CACHE_CAPACITY, compileCached, compileCacheSize } from '../services/compiler/cache';
import { compileInputFrom } from '../services/compiler/stored-input';
import { compilePathway } from '../services/compiler/compile';
import { pathwayJsonFromStoredGraph } from '../services/import/stored-graph';

const index = {
  row: { id: 'pw', ageNodeId: '42', logicalId: 'CP-Minimal', title: 'Minimal Test Pathway', version: '1.0', category: 'ACUTE_CARE', scope: null, targetPopulation: null, temporalDefaults: null },
  conditionCodes: [{ code: 'J06.9', system: 'ICD-10' }],
};
const node = (id: string, nodeType: string, properties: Record<string, unknown>) => ({ id: `age-${id}`, nodeIdentifier: id, nodeType, properties });
const edge = (sourceId: string, targetId: string, edgeType: string) => ({ id: `${sourceId}-${targetId}`, sourceId, targetId, edgeType, properties: null as never });
const nodes = [
  node('root', 'Pathway', { title: 'Minimal Test Pathway', node_id: 'root' }),
  node('stage-1', 'Stage', { stage_number: 1, title: 'Assessment', node_id: 'stage-1', pathway_version: '1.0' }),
  node('step-1-1', 'Step', { stage_number: 1, step_number: 1, display_number: '1.1', title: 'Initial Evaluation' }),
];
const edges = [edge('root', 'stage-1', 'HAS_STAGE'), edge('stage-1', 'step-1-1', 'HAS_STEP')];

describe('compileInputFrom', () => {
  it('keeps exactly one root and strips the graph writer stamps', () => {
    const input = compileInputFrom(index, nodes, edges, new Map());
    expect(input.pathway.nodes.map((n) => n.id)).toEqual(['stage-1', 'step-1-1']);
    expect(input.pathway.nodes[0].properties).toEqual({ stage_number: 1, title: 'Assessment' });
    expect(input.temporalDefaults).toEqual({});
    const r = compileCached(input);
    expect(r.ok && r.model.order).toEqual(['root', 'stage-1', 'step-1-1']);
  });
});

describe('compileCached', () => {
  it('returns the same result object for the same content, and recompiles when the code map changes', () => {
    const input = compileInputFrom(index, nodes, edges, new Map());
    const a = compileCached(input);
    expect(compileCached(compileInputFrom(index, nodes, edges, new Map()))).toBe(a);
    const other = compileCached(compileInputFrom(index, nodes, edges, new Map([['lab.x', { attributeName: 'lab.x', namespace: 'lab', system: 'LOINC', code: '1-1', valueType: 'number' }]])));
    expect(other).not.toBe(a);
  });

  it('a cache hit and a fresh compile agree even when the code map was built in another order', () => {
    const rows = [
      { attributeName: 'lab.a', namespace: 'lab', system: 'LOINC', code: '1-1', valueType: 'string' as const },
      { attributeName: 'lab.b', namespace: 'lab', system: 'LOINC', code: '1-1', valueType: 'number' as const },
    ];
    const one = compileInputFrom(index, nodes, edges, new Map(rows.map((r) => [r.attributeName, r])));
    const two = compileInputFrom(index, nodes, edges, new Map([...rows].reverse().map((r) => [r.attributeName, r])));
    expect(compileCached(two)).toEqual(compilePathway(two));
    expect(compileCached(one)).toEqual(compilePathway(one));
  });

  it('shares an entry for a reordered copy and stays within capacity', () => {
    const input = compileInputFrom(index, nodes, edges, new Map());
    const a = compileCached(input);
    expect(compileCached({ ...input, pathway: { ...input.pathway, nodes: [...input.pathway.nodes].reverse(), edges: [...input.pathway.edges].reverse() } })).toBe(a);
    for (let i = 0; i <= COMPILE_CACHE_CAPACITY; i += 1) {
      compileCached({ ...input, pathway: { ...input.pathway, pathway: { ...input.pathway.pathway, title: `t${i}` } } });
    }
    expect(compileCacheSize()).toBe(COMPILE_CACHE_CAPACITY);
  });
});

describe('pathwayJsonFromStoredGraph', () => {
  it('drops the stored Pathway root node but keeps root-anchored edges', () => {
    const pw = pathwayJsonFromStoredGraph({
      pathway: index.row, conditionCodes: index.conditionCodes,
      nodes: nodes.map((n) => ({ id: n.nodeIdentifier, type: n.nodeType, properties: n.properties })),
      edges: edges.map((e) => ({ from: e.sourceId, to: e.targetId, type: e.edgeType, properties: {} })),
    });
    expect(pw.nodes.some((n) => n.id === 'root')).toBe(false);
    expect(pw.edges[0].from).toBe('root');
  });
});
```

Append to `apps/pathway-service/src/__tests__/pipeline-load-env.test.ts`, inside `describe('loadEvaluationEnv', …)`:

```ts
  it('compiles the pathway inside the same snapshot and attaches the result without refusing evaluation (phase 1)', async () => {
    const { client, pool } = db();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM pathway_graph_index')) {
        return { rows: [{ id: 'pw', ageNodeId: '1', logicalId: 'L', title: 'T', version: '1', category: 'ACUTE_CARE', scope: null, targetPopulation: null, temporalDefaults: null }] };
      }
      return { rows: [] };
    });
    const env = await loadEvaluationEnv(pool as never, 'pw', { patient: patient as never });

    const sqls = client.query.mock.calls.map((c: unknown[]) => String(c[0]));
    const begin = sqls.indexOf('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const commit = sqls.lastIndexOf('COMMIT');
    const indexRead = sqls.findIndex((s) => s.includes('FROM pathway_graph_index'));
    expect(begin).toBeLessThan(indexRead);
    expect(indexRead).toBeLessThan(commit);
    // This fixture's HAS_CHILD edge is not an authorable type: the result says so, and evaluation still gets its env.
    expect(env.compilation.ok).toBe(false);
    expect(env.compilation.ok ? [] : env.compilation.errors.map((e) => e.code)).toContain('UNKNOWN_EDGE_TYPE');
    expect(env.graphFingerprint).toBeDefined();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-stored-input.test.ts src/__tests__/pipeline-load-env.test.ts`
Expected: FAIL. `compiler-stored-input` cannot find `../services/compiler/cache`. The new load-env test fails because `env.compilation` is `undefined`.

- [ ] **Step 3: Write `stored-input.ts` and `cache.ts`**

```ts
// apps/pathway-service/src/services/compiler/stored-input.ts
import type { Pool } from 'pg';
import { fetchGraphFromAGE } from '../../resolvers/helpers/resolution-context';
import type { GraphEdge, GraphNode } from '../confidence/types';
import { pathwayJsonFromStoredGraph, StoredPathwayRow } from '../import/stored-graph';
import { loadAttributeCodeMap } from '../resolution/attribute-code-map';
import { parsePathwayTemporalDefaults } from '../resolution/temporal/cascade';
import type { AttributeCodeMap } from '../resolution/types';
import type { CompileInput } from './model';

export interface StoredIndex {
  row: StoredPathwayRow & { id: string; ageNodeId: string | null; temporalDefaults: unknown };
  conditionCodes: { code: string; system: string; description?: string | null }[];
}

export async function readStoredIndex(db: Pick<Pool, 'query'>, pathwayId: string): Promise<StoredIndex | null> {
  const r = await db.query(
    `SELECT id, age_node_id AS "ageNodeId", logical_id AS "logicalId", title, version, category,
            scope, target_population AS "targetPopulation", temporal_defaults AS "temporalDefaults"
       FROM pathway_graph_index WHERE id = $1`,
    [pathwayId],
  );
  if (!r.rows[0]) return null;
  const codes = await db.query(
    `SELECT m.code, m.system, cs.description
       FROM pathway_code_set_members m
       JOIN pathway_code_sets cs ON cs.id = m.code_set_id
      WHERE cs.pathway_id = $1
      ORDER BY cs.id, m.code`,
    [pathwayId],
  );
  return { row: r.rows[0], conditionCodes: codes.rows };
}

/** A stored graph (as the resolution loader reads it) → the compiler's input. Pure. */
export function compileInputFrom(index: StoredIndex, nodes: GraphNode[], edges: GraphEdge[], codeMap: AttributeCodeMap): CompileInput {
  return {
    pathway: pathwayJsonFromStoredGraph({
      pathway: index.row,
      conditionCodes: index.conditionCodes,
      nodes: nodes.map((n) => ({ id: n.nodeIdentifier, type: n.nodeType, properties: n.properties ?? {} })),
      edges: edges.map((e) => ({ from: e.sourceId, to: e.targetId, type: e.edgeType, properties: e.properties ?? {} })),
    }),
    codeMap,
    temporalDefaults: parsePathwayTemporalDefaults(index.row.temporalDefaults),
  };
}

/** Activation and the corpus script: read everything the compiler needs. `null` when there is nothing to compile. */
export async function loadStoredCompileInput(db: Pick<Pool, 'query'>, pathwayId: string): Promise<CompileInput | null> {
  const index = await readStoredIndex(db, pathwayId);
  if (!index || !index.row.ageNodeId) return null;
  // Sequential, not Promise.all: a single transaction client runs one query at a time.
  const graph = await fetchGraphFromAGE(db as Pool, String(index.row.ageNodeId));
  const codeMap = await loadAttributeCodeMap(db);
  return compileInputFrom(index, graph.nodes, graph.edges, codeMap);
}
```

```ts
// apps/pathway-service/src/services/compiler/cache.ts
import { hashOf } from '../resolution/pipeline/canonical';
import { compilePathway } from './compile';
import { COMPILER_VERSION, CompileInput, CompileResult } from './model';

/** Draft autosaves produce many content revisions, so the cache is bounded. Map insertion order is the recency order. */
export const COMPILE_CACHE_CAPACITY = 256;
const cache = new Map<string, CompileResult>();

const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

/** Content key: order-insensitive for nodes and edges (compilation is order-independent too). */
function keyOf(input: CompileInput): string {
  const p = input.pathway;
  return hashOf({
    v: COMPILER_VERSION,
    pathway: {
      ...p,
      nodes: [...(p.nodes ?? [])].sort((a, b) => compare(a.id, b.id)),
      edges: [...(p.edges ?? [])].sort((a, b) => compare(`${a.from}|${a.to}|${a.type}`, `${b.from}|${b.to}|${b.type}`)),
    },
    codeMap: input.codeMap,
    temporalDefaults: input.temporalDefaults,
  });
}

/** Compile once per distinct content; results are frozen (Task 5), so sharing them is safe. */
export function compileCached(input: CompileInput): CompileResult {
  const key = keyOf(input);
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const result = compilePathway(input);
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[compiler] ${input.pathway.pathway?.logical_id}@${input.pathway.pathway?.version} does not compile: ${result.errors.length} error(s)`);
  }
  cache.set(key, result);
  if (cache.size > COMPILE_CACHE_CAPACITY) cache.delete(cache.keys().next().value as string);
  return result;
}

/** Test hook. */
export const compileCacheSize = (): number => cache.size;
```

- [ ] **Step 4: Wire into `load-env.ts`**

Add the imports:

```ts
import { compileCached } from '../../compiler/cache';
import type { CompileResult } from '../../compiler/model';
import { compileInputFrom, readStoredIndex } from '../../compiler/stored-input';
```

Add to `EvaluationEnv` (after `unnormalized`):

```ts
  /**
   * The pathway compiled inside this snapshot (interpreter spec §3.1). Phase 1
   * attaches it without acting on it: evaluation still runs on TraversalEngine.
   */
  compilation: CompileResult;
```

Replace `readPathway` with:

```ts
async function readPathway(db: Pool, pathwayId: string): Promise<{ resolution: ResolutionContext; scoring: ScoringConfig; compilation: CompileResult }> {
  const resolution = await buildResolutionContext(db, pathwayId);
  const scoring = await resolution.confidenceEngine.loadScoringConfig({
    pool: db,
    pathwayId,
    nodes: resolution.graphContext.allNodes,
    signalDefinitions: resolution.signals,
  });
  const index = await readStoredIndex(db, pathwayId);
  const compilation: CompileResult = index
    ? compileCached(compileInputFrom(index, resolution.graphContext.allNodes, resolution.edges, resolution.codeMap))
    : { ok: false, errors: [{ code: 'NOT_FOUND', message: `pathway ${pathwayId} has no index row` }] };
  return { resolution, scoring, compilation };
}
```

Change `envOf` to take and return the compilation:

```ts
function envOf(resolution: ResolutionContext, scoring: ScoringConfig, safety: SafetyReference, unnormalized: MedicationInput[], compilation: CompileResult): EvaluationEnv {
```

and its `return` to:

```ts
  return { resolution, scoring, safety, graphFingerprint, envFingerprint, llmModel, unnormalized, compilation };
```

`envFingerprint` is **not** changed in phase 1.

In `loadEvaluationEnv`:
- the snapshot body becomes `const { resolution, scoring, compilation } = await readPathway(db, pathwayId);` and returns `compilation` alongside the others;
- the final line becomes `return envOf(read.resolution, read.scoring, read.safety, unnormalizedOf(read.medications, read.safety), read.compilation);`.

In `loadRunEnv`, the `graphs` map values now carry `compilation`; change the `children` line to:

```ts
  const children = new Map([...read.graphs].map(([id, g]) => [id, envOf(g.resolution, g.scoring, read.safety, [], g.compilation)]));
```

Every other caller that builds an `EvaluationEnv` object literal needs `compilation` too. Find them with:
`grep -rn "envFingerprint:" $W/apps/pathway-service/src --include=*.ts`
In test fixtures (`__tests__/fixtures/pipeline-env.ts` `makeEnv`), add `compilation: { ok: false, errors: [] }`. Phase-1 consumers never read it; tsc will list any missed site.

- [ ] **Step 5: Run the tests, the pipeline suites, then typecheck**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-stored-input.test.ts src/__tests__/pipeline-load-env.test.ts`
Expected: PASS.
Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline- 2>&1 | grep -E "^Tests:"`
Expected: no failures.
Run: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean`
Expected: `tsc-clean`.

- [ ] **Step 6: Commit**

```bash
git -C $W add apps/pathway-service/src/services/compiler/stored-input.ts apps/pathway-service/src/services/compiler/cache.ts apps/pathway-service/src/services/resolution/pipeline/load-env.ts apps/pathway-service/src/__tests__
git -C $W commit -m "feat(pathway-service): compile each pathway inside the evaluation snapshot, cached by content"
```

---

### Task 8: Activate only what was compiled — one locked transaction, shared with draft saves

**Files:**
- Modify: `apps/pathway-service/src/resolvers/mutations/import.ts` (`activatePathway`, `reactivatePathway`, `archivePathway`)
- Modify: `apps/pathway-service/src/services/import/import-orchestrator.ts:437-447` (`findExistingPathway`)
- Test: `apps/pathway-service/src/__tests__/mutation-resolvers.test.ts` (rewrite the `activatePathway` / `reactivatePathway` blocks, lines 89-175)
- Test: `apps/pathway-service/src/__tests__/activation-postgres.test.ts` (opt-in, real Postgres)

**Interfaces:**
- Consumes: `loadStoredCompileInput(db: Pick<Pool, 'query'>, pathwayId)` (Task 7; it takes a client), and `compilePathway` (Task 5).
- Produces:
  - `activatePathway` refuses a DRAFT that does not compile, and `reactivatePathway` refuses a SUPERSEDED/ARCHIVED one, both with `BAD_USER_INPUT` and `extensions.compileErrors: CompileError[]`. The graph that was compiled is the graph that was activated.
  - `archivePathway` accepts ACTIVE or DRAFT (Q10).
  - `findExistingPathway` locks the row it returns.

**Protocol** (review of `c7985ec`, finding 1). Everything happens in **one transaction**:
1. Lock **every** `pathway_graph_index` row sharing the target's `logical_id`, in id order, with `FOR UPDATE`.
2. Read the stored graph, code-set members and code map **after** acquiring the lock, on the same client.
3. Compile.
4. Run the existing status CTE.
5. Commit, or roll back on any failure.

Draft saves take the same row lock. `DRAFT_UPDATE`'s `findExistingPathway` runs inside the import transaction, which already exists (`import-orchestrator.ts:113`), and becomes `SELECT … FOR UPDATE`. So:
- **A save that holds the lock first:** activation waits, then reads and compiles the saved content (READ COMMITTED: statements after the lock see committed data).
- **An activation that holds the lock first:** the save waits. When it resumes, Postgres re-reads the row. It is no longer `DRAFT`, so the existing check refuses the save (`import-orchestrator.ts:121-139`).
- **Two activations of versions of one pathway:** both lock the logical pathway's rows in id order, so they serialize without deadlock and only one ACTIVE version results. This closes review F5 (two ACTIVE versions) as well.

On refusal nothing is updated, so the previously ACTIVE version stays ACTIVE.

- [ ] **Step 1: Rewrite the unit tests** (replace the two `describe` blocks for `activatePathway` and `reactivatePathway`; keep `importPathway` and `archivePathway`)

At the top of `mutation-resolvers.test.ts`, with the other mocks:

```ts
jest.mock('../services/compiler/stored-input', () => ({ loadStoredCompileInput: jest.fn() }));
import { loadStoredCompileInput } from '../services/compiler/stored-input';
```

A context whose pool hands out a transaction client, with queries answered by SQL text instead of call order:

```ts
type Route = (sql: string) => { rows: unknown[] } | undefined;
function txContext(route: Route) {
  const query = jest.fn(async (sql: string) => route(String(sql)) ?? { rows: [] });
  const client = { query, release: jest.fn() };
  return { ctx: { pool: { query, connect: jest.fn(async () => client) }, redis: {}, userId: 'test-user', userRole: 'PROVIDER' } as never, query, client };
}
const sqlOf = (query: jest.Mock) => query.mock.calls.map(([s]) => String(s));
const row = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'test-id', status, logicalId: 'CP-Test', ageNodeId: '7', title: 'Test', version: '1.0', category: 'ACUTE_CARE', ...extra });
const LEGACY = {
  ...MINIMAL_PATHWAY,
  nodes: [
    ...MINIMAL_PATHWAY.nodes,
    { id: 'gate-legacy', type: 'Gate', properties: { title: 'Severe', gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'lab.hemoglobin', operator: 'LT', value: 7 } } },
    { id: 'step-1-2', type: 'Step', properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'Transfusion' } },
  ],
  edges: [...MINIMAL_PATHWAY.edges, { from: 'stage-1', to: 'gate-legacy', type: 'HAS_GATE' }, { from: 'gate-legacy', to: 'step-1-2', type: 'BRANCHES_TO' }],
} as never;
const compileInput = (pathway: unknown) => ({ pathway, codeMap: new Map(), temporalDefaults: {} });
```

The tests:

```ts
  describe('activatePathway', () => {
    beforeEach(() => (loadStoredCompileInput as jest.Mock).mockReset());

    it('locks the logical pathway, compiles the stored graph under the lock, then activates, in one transaction', async () => {
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(compileInput(MINIMAL_PATHWAY));
      const { ctx, query, client } = txContext((sql) =>
        sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'DRAFT' }] }
          : sql.startsWith('WITH') ? { rows: [{ ...row('ACTIVE'), previousStatus: 'DRAFT' }] } : undefined);

      const result = await Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx);

      expect(result.previousStatus).toBe('DRAFT');
      const sqls = sqlOf(query);
      const at = (p: (s: string) => boolean) => sqls.findIndex(p);
      expect(sqls[0]).toBe('BEGIN');
      expect(at((s) => s.includes('FOR UPDATE') && s.includes('ORDER BY id'))).toBeLessThan(at((s) => s.startsWith('WITH')));
      expect(sqls.at(-1)).toBe('COMMIT');
      expect((loadStoredCompileInput as jest.Mock).mock.calls[0][0]).toBe(client);   // read on the locked client
      expect(client.release).toHaveBeenCalled();
    });

    it('refuses a DRAFT that does not compile, lists the errors, updates nothing, and rolls back', async () => {
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(compileInput(LEGACY));
      const { ctx, query } = txContext((sql) => (sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'DRAFT' }] } : undefined));

      await expect(Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)).rejects.toMatchObject({
        extensions: { code: 'BAD_USER_INPUT', compileErrors: expect.arrayContaining([expect.objectContaining({ code: 'VALIDATION' })]) },
      });
      const sqls = sqlOf(query);
      expect(sqls.some((s) => s.startsWith('WITH') || /^\s*UPDATE/.test(s))).toBe(false);   // the lock query says FOR UPDATE; no status write may run
      expect(sqls.at(-1)).toBe('ROLLBACK');
    });

    it.each([
      ['patient_attribute with no condition', { gate_type: 'patient_attribute', default_behavior: 'skip' }],
      ['SELECT question with no options', { gate_type: 'question', default_behavior: 'skip', answer_type: 'SELECT' }],
      ['trimester comparison with no value', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'patient.trimester', operator: 'less_than' } }],
    ])('refuses to activate an unusable gate payload: %s', async (_label, props) => {
      const pathway = {
        ...MINIMAL_PATHWAY,
        nodes: [...MINIMAL_PATHWAY.nodes, { id: 'gate-x', type: 'Gate', properties: { title: 'X', ...props } }, { id: 'step-1-2', type: 'Step', properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'Guarded' } }],
        edges: [...MINIMAL_PATHWAY.edges, { from: 'stage-1', to: 'gate-x', type: 'HAS_GATE' }, { from: 'gate-x', to: 'step-1-2', type: 'BRANCHES_TO' }],
      };
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(compileInput(pathway));
      const { ctx } = txContext((sql) => (sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'DRAFT' }] } : undefined));
      await expect(Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)).rejects.toMatchObject({
        extensions: { compileErrors: expect.arrayContaining([expect.objectContaining({ code: 'PAYLOAD' })]) },
      });
    });

    it('does not block a metadata-only pathway (no stored graph to compile)', async () => {
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(null);
      const { ctx } = txContext((sql) =>
        sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'DRAFT' }] }
          : sql.startsWith('WITH') ? { rows: [{ ...row('ACTIVE'), previousStatus: 'DRAFT' }] } : undefined);
      await expect(Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)).resolves.toMatchObject({ previousStatus: 'DRAFT' });
    });

    it('rejects activating a non-DRAFT pathway without compiling it', async () => {
      const { ctx } = txContext((sql) =>
        sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'ACTIVE' }] }
          : sql.startsWith('SELECT status') ? { rows: [{ status: 'ACTIVE' }] } : undefined);
      await expect(Mutation.Mutation.activatePathway({}, { id: 'test-id' }, ctx)).rejects.toThrow('Cannot activate');
      expect(loadStoredCompileInput).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND for a nonexistent pathway', async () => {
      const { ctx } = txContext(() => undefined);
      await expect(Mutation.Mutation.activatePathway({}, { id: 'nonexistent' }, ctx)).rejects.toThrow('not found');
    });
  });

  describe('reactivatePathway', () => {
    beforeEach(() => (loadStoredCompileInput as jest.Mock).mockReset());

    it('refuses to reactivate an ARCHIVED pathway that does not compile', async () => {
      (loadStoredCompileInput as jest.Mock).mockResolvedValue(compileInput(LEGACY));
      const { ctx } = txContext((sql) => (sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status: 'ARCHIVED' }] } : undefined));
      await expect(Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx)).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    });

    it.each(['DRAFT', 'ACTIVE'])('rejects reactivating a %s pathway', async (status) => {
      const { ctx } = txContext((sql) =>
        sql.includes('FOR UPDATE') ? { rows: [{ id: 'test-id', status }] }
          : sql.startsWith('SELECT status') ? { rows: [{ status }] } : undefined);
      await expect(Mutation.Mutation.reactivatePathway({}, { id: 'test-id' }, ctx)).rejects.toThrow('Cannot reactivate');
    });
  });
```

In the existing `archivePathway` test, change the mocked status `'DRAFT'` to `'SUPERSEDED'`, since a DRAFT can now be archived. Add:

```ts
    it('archives a DRAFT', async () => {
      const ctx = createMockContext();
      await Mutation.Mutation.archivePathway({}, { id: 'test-id' }, ctx);
      expect((ctx.pool.query as jest.Mock).mock.calls.some(([sql]) => /status IN \('ACTIVE', 'DRAFT'\)/.test(String(sql)))).toBe(true);
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/mutation-resolvers.test.ts`
Expected: FAIL. `pool.connect` is never called (activation uses `pool.query`), so the transaction assertions fail, and the "refuses" tests resolve.

- [ ] **Step 3: Implement**

In `resolvers/mutations/import.ts`:

```ts
import { compilePathway } from '../../services/compiler/compile';
import { loadStoredCompileInput } from '../../services/compiler/stored-input';

/**
 * A status transition that must only put a pathway into service if it can be
 * evaluated (interpreter spec §3.1, §8; Q10). One transaction:
 *   1. lock every version of the logical pathway (id order: two activations of
 *      one pathway serialize and cannot deadlock);
 *   2. read and compile the target as stored NOW, on the locked client;
 *   3. run the status CTE.
 * DRAFT_UPDATE locks its row with the same FOR UPDATE (import-orchestrator
 * `findExistingPathway`), so a draft save and an activation never interleave.
 */
async function transition(
  pool: DataSourceContext['pool'],
  id: string,
  guarded: string[],
  verb: string,
  statusSql: string,
  wrongStatus: (status: string) => string,
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("LOAD 'age'");
    await client.query('SET search_path = ag_catalog, "$user", public');
    const locked = await client.query(
      `SELECT id, status FROM pathway_graph_index
        WHERE logical_id = (SELECT logical_id FROM pathway_graph_index WHERE id = $1)
        ORDER BY id FOR UPDATE`,
      [id],
    );
    const target = locked.rows.find((r: { id: string }) => r.id === id);
    if (target && guarded.includes(target.status)) {
      const input = await loadStoredCompileInput(client, id);
      if (input) {
        const compiled = compilePathway(input);
        if (!compiled.ok) {
          throw new GraphQLError(
            `Cannot ${verb} pathway: ${compiled.errors.length} problem(s) would stop it from being evaluated. Fix them in the editor and try again.`,
            { extensions: { code: 'BAD_USER_INPUT', compileErrors: compiled.errors } },
          );
        }
      }
    }
    const result = await client.query(statusSql, [id]);
    if (!result.rows[0]) {
      const check = await client.query('SELECT status FROM pathway_graph_index WHERE id = $1', [id]);
      if (!check.rows[0]) throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      throw new GraphQLError(wrongStatus(check.rows[0].status), { extensions: { code: 'BAD_USER_INPUT' } });
    }
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch((): void => undefined);
    throw err;
  } finally {
    client.release();
  }
}
```

Rewrite the two resolvers to use it. Move each existing CTE string unchanged into a constant:

```ts
const ACTIVATE_SQL = `WITH target AS ( … exactly the current activatePathway CTE … )`;
const REACTIVATE_SQL = `WITH target AS ( … exactly the current reactivatePathway CTE … )`;

  async activatePathway(_parent: unknown, args: { id: string }, context: DataSourceContext) {
    const { pool } = context;
    const row = await transition(pool, args.id, ['DRAFT'], 'activate', ACTIVATE_SQL,
      (s) => `Cannot activate pathway with status "${s}". Only DRAFT pathways can be activated.`);
    // D14: an activated pathway's medications should be normalised before the first session.
    prewarmPathwayInBackground(pool, args.id, 'activate');
    const { previousStatus, ...pathway } = row;
    return { pathway, previousStatus };
  },

  async reactivatePathway(_parent: unknown, args: { id: string }, context: DataSourceContext) {
    const row = await transition(context.pool, args.id, ['SUPERSEDED', 'ARCHIVED'], 'reactivate', REACTIVATE_SQL,
      (s) => `Cannot reactivate pathway with status "${s}". Only SUPERSEDED or ARCHIVED pathways can be reactivated.`);
    const { previousStatus, ...pathway } = row;
    return { pathway, previousStatus };
  },
```

In `archivePathway`:
- change `WHERE id = $1 AND status = 'ACTIVE'` to `WHERE id = $1 AND status IN ('ACTIVE', 'DRAFT')`;
- change the message to `` `Cannot archive pathway with status "${check.rows[0].status}". Only ACTIVE or DRAFT pathways can be archived.` ``.

In `import-orchestrator.ts`, `findExistingPathway`: change the query to
`'SELECT id, status FROM pathway_graph_index WHERE logical_id = $1 AND version = $2 FOR UPDATE'`.
Add a comment that it is the draft-save half of the activation lock protocol. It already runs inside the import transaction.

- [ ] **Step 4: Run the unit tests**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/mutation-resolvers.test.ts src/__tests__/import-orchestrator.test.ts`
Expected: PASS. The orchestrator mock matches on `SELECT` + `pathway_graph_index`, so `FOR UPDATE` changes nothing there.

- [ ] **Step 5: Write the interleaving test against real Postgres** (opt-in, scratch database, same guard as `pipeline-postgres.test.ts`)

```ts
// apps/pathway-service/src/__tests__/activation-postgres.test.ts
jest.mock('../services/compiler/stored-input', () => ({ loadStoredCompileInput: jest.fn() }));
jest.mock('../services/medications/prewarm-pathway', () => ({ prewarmPathwayInBackground: jest.fn() }));

import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { Mutation } from '../resolvers/Mutation';
import { loadStoredCompileInput } from '../services/compiler/stored-input';
import { MINIMAL_PATHWAY } from './fixtures/reference-pathway';

const describePg = process.env.RUN_PIPELINE_PG_TESTS === '1' ? describe : describe.skip;
const BROKEN = { ...MINIMAL_PATHWAY, nodes: [...MINIMAL_PATHWAY.nodes, { id: 'orphan', type: 'Step', properties: { stage_number: 9, step_number: 9, display_number: '9.9', title: 'Unreachable' } }] };

describePg('activation and draft saves serialize on the pathway row lock (scratch database)', () => {
  const database = process.env.PIPELINE_PG_DATABASE ?? '';
  let pool: Pool;
  let logical: string;
  let activeId: string;
  let draftId: string;
  const statusOf = async (id: string) => (await pool.query('SELECT status FROM pathway_graph_index WHERE id = $1', [id])).rows[0].status;
  /** Resolves once some session in this database is waiting on a row lock: observed state, not elapsed time. */
  async function lockWaiterSeen(): Promise<void> {
    for (let i = 0; i < 250; i += 1) {
      const r = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
      if (r.rows[0].n > 0) return;
      await new Promise((res) => setTimeout(res, 20));
    }
    throw new Error('no session ever waited on the pathway row lock');
  }

  beforeAll(() => {
    if (!database.includes('scratch') || database === 'prism_db') throw new Error(`refusing database "${database}": set PIPELINE_PG_DATABASE to a scratch database`);
    pool = new Pool({ host: process.env.POSTGRES_HOST ?? 'localhost', user: process.env.POSTGRES_USER ?? 'prism', password: process.env.POSTGRES_PASSWORD, database });
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    logical = `lp-lock-${randomUUID().slice(0, 8)}`;
    activeId = randomUUID();
    draftId = randomUUID();
    await pool.query(`INSERT INTO pathway_graph_index (id, logical_id, title, version, category, status, is_active) VALUES ($1, $2, 'v1', '1.0', 'ACUTE_CARE', 'ACTIVE', true)`, [activeId, logical]);
    await pool.query(`INSERT INTO pathway_graph_index (id, logical_id, title, version, category, status, is_active) VALUES ($1, $2, 'v2', '2.0', 'ACUTE_CARE', 'DRAFT', false)`, [draftId, logical]);
    // The mocked loader reads the title on the transaction's own client: 'broken' stands for a non-compiling graph.
    (loadStoredCompileInput as jest.Mock).mockReset().mockImplementation(async (db: Pool, id: string) => {
      const title = (await db.query('SELECT title FROM pathway_graph_index WHERE id = $1', [id])).rows[0].title;
      return { pathway: title === 'broken' ? BROKEN : MINIMAL_PATHWAY, codeMap: new Map(), temporalDefaults: {} };
    });
  });

  it('a draft save already holding the lock is what activation compiles, and a failure leaves v1 ACTIVE', async () => {
    const saver = await pool.connect();
    await saver.query('BEGIN');
    await saver.query('SELECT id, status FROM pathway_graph_index WHERE logical_id = $1 AND version = $2 FOR UPDATE', [logical, '2.0']);
    const activation = Mutation.Mutation.activatePathway({}, { id: draftId }, { pool } as never);
    await lockWaiterSeen();                                             // activation is blocked on the saver's lock
    await saver.query(`UPDATE pathway_graph_index SET title = 'broken' WHERE id = $1`, [draftId]);
    await saver.query('COMMIT');
    saver.release();
    await expect(activation).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    expect(await statusOf(activeId)).toBe('ACTIVE');
    expect(await statusOf(draftId)).toBe('DRAFT');
  });

  it('a draft save that arrives while activation holds the lock waits, then finds no DRAFT and is refused', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const inCompile = new Promise<void>((r) => { entered = r; });
    (loadStoredCompileInput as jest.Mock).mockImplementation(async () => { entered(); await gate; return { pathway: MINIMAL_PATHWAY, codeMap: new Map(), temporalDefaults: {} }; });
    const activation = Mutation.Mutation.activatePathway({}, { id: draftId }, { pool } as never);
    // Compile is entered only after the lock is held; fail fast if activation ends without getting there.
    await Promise.race([inCompile, activation.then(() => { throw new Error('activation finished before compiling'); })]);
    const saver = await pool.connect();
    await saver.query('BEGIN');
    const save = saver.query('SELECT id, status FROM pathway_graph_index WHERE logical_id = $1 AND version = $2 FOR UPDATE', [logical, '2.0']);
    await lockWaiterSeen();                                             // the save is queued behind activation's lock
    release();
    await activation;
    const seen = await save;
    await saver.query('ROLLBACK');
    saver.release();
    expect(seen.rows[0].status).toBe('ACTIVE');                         // DRAFT_UPDATE's existing check refuses this
    expect(await statusOf(activeId)).toBe('SUPERSEDED');
  });
});
```

Run (scratch database; never `prism_db`):

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
dropdb -h localhost -U prism --if-exists prism_lock_scratch; createdb -h localhost -U prism prism_lock_scratch
pg_dump -h localhost -U prism --schema-only --no-owner prism_db | psql -q -h localhost -U prism prism_lock_scratch 2>&1 | grep -vi "age\|ag_catalog" | head -5
RUN_PIPELINE_PG_TESTS=1 PIPELINE_PG_DATABASE=prism_lock_scratch POSTGRES_PASSWORD=$PGPASSWORD \
  npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/activation-postgres.test.ts
dropdb -h localhost -U prism prism_lock_scratch
```

Expected: PASS (2 tests).

**Falsify the protocol:** temporarily remove `FOR UPDATE` from the lock query in `transition` and re-run. The first test must fail, because activation compiles v2's pre-save title and activates it. Restore, and confirm `git -C $W diff --stat` shows only the intended files.

- [ ] **Step 6: Typecheck and commit**

Run: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean`
Expected: `tsc-clean`.

```bash
git -C $W add apps/pathway-service/src/resolvers/mutations/import.ts apps/pathway-service/src/services/import/import-orchestrator.ts apps/pathway-service/src/__tests__/mutation-resolvers.test.ts apps/pathway-service/src/__tests__/activation-postgres.test.ts
git -C $W commit -m "feat(pathway-service): activate only a compiled graph — one locked transaction shared with draft saves"
```

---

### Task 9: Report compile problems at import

**Files:**
- Create: `apps/pathway-service/src/services/compiler/report.ts`
- Modify: `apps/pathway-service/src/services/import/import-orchestrator.ts` (after the validation early return, around line 108; and the success `return`, around line 417)
- Test: `apps/pathway-service/src/__tests__/compiler-report.test.ts`, `apps/pathway-service/src/__tests__/import-orchestrator.test.ts`

**Interfaces:**
- Consumes: `compilePathway` (Task 5); `loadAttributeCodeMap` (Task 6); `ValidationResult` (`services/import/types`).
- Produces: `withCompileReport(validation: ValidationResult, compiled: CompileResult): ValidationResult`. It appends one warning per compile error, prefixed `Not evaluable until fixed: `. Import still succeeds (spec §3.1: a draft that does not compile may be stored, but not previewed or activated).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/pathway-service/src/__tests__/compiler-report.test.ts
import { withCompileReport } from '../services/compiler/report';

describe('withCompileReport', () => {
  const validation = { valid: true, errors: [], warnings: ['existing'] };
  it('leaves a compiling pathway untouched', () => {
    expect(withCompileReport(validation, { ok: true, model: {} as never })).toBe(validation);
  });
  it('adds compile errors as warnings; the import is still valid', () => {
    const r = withCompileReport(validation, { ok: false, errors: [{ code: 'UNMAPPED_ATTRIBUTE', nodeId: 'g', message: 'Gate "g": attribute "lab.hemoglobin" has no pathway_attribute_code_map row, so it cannot be read' }] });
    expect(r).toEqual({ valid: true, errors: [], warnings: ['existing', 'Not evaluable until fixed: Gate "g": attribute "lab.hemoglobin" has no pathway_attribute_code_map row, so it cannot be read'] });
  });
});
```

In `import-orchestrator.test.ts`, add at the top with the other mocks:

```ts
jest.mock('../services/resolution/attribute-code-map', () => ({
  ...jest.requireActual('../services/resolution/attribute-code-map'),
  loadAttributeCodeMap: jest.fn(async () => new Map()),
}));
```

and a test in `describe('importPathway', …)`:

```ts
  it('stores a draft that does not compile, and reports why as warnings', async () => {
    const pw = {
      ...MINIMAL_PATHWAY,
      nodes: [
        ...MINIMAL_PATHWAY.nodes,
        { id: 'gate-hb', type: 'Gate', properties: { title: 'Hb', gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 } } },
        { id: 'step-1-2', type: 'Step', properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'Transfusion' } },
      ],
      edges: [
        ...MINIMAL_PATHWAY.edges,
        { from: 'stage-1', to: 'gate-hb', type: 'HAS_GATE' },
        { from: 'gate-hb', to: 'step-1-2', type: 'BRANCHES_TO' },
      ],
    } as never;
    const { pool } = createMockPool({ expectedEdgeCount: 4 }); // the post-write integrity check counts edges
    const result = await importPathway(pool as never, pw, 'NEW_PATHWAY', 'user-1');
    expect(result.validation.valid).toBe(true);
    expect(result.validation.warnings).toEqual(expect.arrayContaining([expect.stringContaining('Not evaluable until fixed: Gate "gate-hb": attribute "lab.hemoglobin" has no pathway_attribute_code_map row')]));
  });
```

`createMockPool` is the file's existing helper. Its pool has only `connect`, not `query`. So the `loadAttributeCodeMap` mock above is required, and it applies to every test in the file; the others never reach it, because it runs only after validation passes.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-report.test.ts src/__tests__/import-orchestrator.test.ts`
Expected: FAIL. `report` module not found, and the orchestrator test finds no `Not evaluable` warning.

- [ ] **Step 3: Implement**

```ts
// apps/pathway-service/src/services/compiler/report.ts
import type { ValidationResult } from '../import/types';
import type { CompileResult } from './model';

/** Import stays lenient for drafts; compile problems are reported, and enforced at activation (Task 8). */
export function withCompileReport(validation: ValidationResult, compiled: CompileResult): ValidationResult {
  if (compiled.ok) return validation;
  return { ...validation, warnings: [...validation.warnings, ...compiled.errors.map((e) => `Not evaluable until fixed: ${e.message}`)] };
}
```

In `import-orchestrator.ts`, add the imports:

```ts
import { compilePathway } from '../compiler/compile';
import { withCompileReport } from '../compiler/report';
import { loadAttributeCodeMap } from '../resolution/attribute-code-map';
```

Immediately after the `if (!validation.valid) { return { … } }` block (before "Step 2: Acquire client"), add:

```ts
  // Report, don't block: a draft may be saved mid-authoring, but anything that
  // would stop it being evaluated is shown now (interpreter spec §3.1).
  const reported = withCompileReport(
    validation,
    compilePathway({ pathway: pathwayJson, codeMap: await loadAttributeCodeMap(pool), temporalDefaults: {} }),
  );
```

In the success `return` (the one with `status: 'DRAFT'`), change `validation,` to `validation: reported,`. Authored JSON carries no temporal defaults: `pathway_graph_index.temporal_defaults` is set separately. So `{}` here matches what activation will see for a fresh import.

- [ ] **Step 4: Run the tests and the import suites, then typecheck**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compiler-report.test.ts src/__tests__/import-orchestrator.test.ts src/__tests__/mutation-resolvers.test.ts`
Expected: PASS.
Run: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean`
Expected: `tsc-clean`.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/services/compiler/report.ts apps/pathway-service/src/services/import/import-orchestrator.ts apps/pathway-service/src/__tests__/compiler-report.test.ts apps/pathway-service/src/__tests__/import-orchestrator.test.ts
git -C $W commit -m "feat(pathway-service): report compile problems on import without blocking drafts"
```

---

### Task 10: Corpus report, full suite, PR; then (approval-gated) deploy and archive anemia 1.1–1.3

**Files:**
- Create: `apps/pathway-service/src/scripts/compile-stored-pathways.ts`
- Create: `docs/superpowers/records/evaluation-interpreter/compiler-corpus.md`, on this implementation branch
- Test: `apps/pathway-service/src/__tests__/compile-stored-pathways.test.ts`

**Interfaces:**
- Consumes: `loadStoredCompileInput` (Task 7), `compilePathway` (Task 5).
- Produces: `compileAll(pool: Pool, log: (line: string) => void): Promise<{ total: number; ok: number }>`, plus a CLI entry that prints one line per stored pathway and its errors. It is read-only.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/compile-stored-pathways.test.ts
jest.mock('../services/compiler/stored-input', () => ({ loadStoredCompileInput: jest.fn() }));
import { compileAll } from '../scripts/compile-stored-pathways';
import { loadStoredCompileInput } from '../services/compiler/stored-input';
import { MINIMAL_PATHWAY } from './fixtures/reference-pathway';

it('compiles every stored pathway read-only and prints one line each', async () => {
  const pool = { query: jest.fn(async () => ({ rows: [
    { id: 'a', logical_id: 'good', version: '1', status: 'ACTIVE' },
    { id: 'b', logical_id: 'nograph', version: '1', status: 'DRAFT' },
  ] })) };
  (loadStoredCompileInput as jest.Mock).mockImplementation(async (_db: unknown, id: string) =>
    id === 'a' ? { pathway: MINIMAL_PATHWAY, codeMap: new Map(), temporalDefaults: {} } : null);
  const lines: string[] = [];
  const s = await compileAll(pool as never, (l) => lines.push(l));
  expect(s).toEqual({ total: 2, ok: 1 });
  expect(lines[0]).toMatch(/^OK +ACTIVE +good@1 \(\d+ ms\)$/);
  expect(lines[1]).toBe('SKIP  DRAFT    nograph@1 (no stored graph)');
  expect(pool.query.mock.calls.every(([sql]: [string]) => /^\s*SELECT/i.test(sql))).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compile-stored-pathways.test.ts`
Expected: FAIL — `Cannot find module '../scripts/compile-stored-pathways'`.

- [ ] **Step 3: Write the script**

```ts
// apps/pathway-service/src/scripts/compile-stored-pathways.ts
import { Pool } from 'pg';
import { performance } from 'perf_hooks';
import { compilePathway } from '../services/compiler/compile';
import { loadStoredCompileInput } from '../services/compiler/stored-input';

/** Read-only: compile every stored pathway and report. Used to record the corpus before and after phase 1. */
export async function compileAll(pool: Pool, log: (line: string) => void): Promise<{ total: number; ok: number }> {
  const { rows } = await pool.query<{ id: string; logical_id: string; version: string; status: string }>(
    'SELECT id, logical_id, version, status FROM pathway_graph_index ORDER BY logical_id, version',
  );
  let ok = 0;
  for (const p of rows) {
    const label = `${p.status.padEnd(8)} ${p.logical_id}@${p.version}`;
    const input = await loadStoredCompileInput(pool, p.id);
    if (!input) { log(`SKIP  ${label} (no stored graph)`); continue; }
    const t = performance.now();
    const r = compilePathway(input);
    const ms = Math.round(performance.now() - t);
    if (r.ok) { ok += 1; log(`OK    ${label} (${ms} ms)`); continue; }
    log(`ERR   ${label} (${ms} ms, ${r.errors.length} error(s))`);
    for (const e of r.errors) log(`        ${e.code}${e.nodeId ? ` ${e.nodeId}` : ''}: ${e.message}`);
  }
  return { total: rows.length, ok };
}

if (require.main === module) {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'prism',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB ?? 'prism_db',
  });
  pool.on('connect', (client) => {
    client.query(`LOAD 'age'; SET search_path = ag_catalog, "$user", public;`).catch((): void => undefined);
  });
  compileAll(pool, (line) => console.log(line))
    .then((s) => console.log(`${s.ok}/${s.total} pathways compile`))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}
```

- [ ] **Step 4: Run the test, the full suite, typecheck and build**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/compile-stored-pathways.test.ts`
Expected: PASS.
Run: `npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:)" | sort | uniq -c`
Expected: only the two scorer suites FAIL. `Tests:` shows 9 failed, and passed = the pre-phase count plus this plan's new tests.
Run: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean`
Expected: `tsc-clean`.
Run: `npm run build --prefix $W/apps/pathway-service && echo built`
Expected: `built`.

- [ ] **Step 5: Record the live corpus (read-only)**

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
POSTGRES_PASSWORD=$PGPASSWORD node $W/apps/pathway-service/dist/scripts/compile-stored-pathways.js | tee /tmp/compiler-corpus.txt
```

Expected, and stop and report if different:
- `anemia-in-pregnancy-v1@1.4` is `OK` (the live ACTIVE pathway);
- anemia 1.1–1.3 are `ERR`, with the legacy-operator `VALIDATION` errors;
- GHTN is `ERR`, with at least the three errors of Task 5.

Record every line in `docs/superpowers/records/evaluation-interpreter/compiler-corpus.md`, headed with the date, the branch commit, and "read-only". Commit:

```bash
git -C $W add apps/pathway-service/src/scripts/compile-stored-pathways.ts apps/pathway-service/src/__tests__/compile-stored-pathways.test.ts docs/superpowers/records/evaluation-interpreter/compiler-corpus.md
git -C $W commit -m "feat(pathway-service): read-only compile report over stored pathways, with the live corpus record"
```

- [ ] **Step 6: Push and open the PR into `main`**

```bash
git -C $W push -u origin feat/interpreter-01-compiler
gh pr create -R Prism-Clinical/prism-graphql --base main --head feat/interpreter-01-compiler \
  --title "Interpreter phase 1: pathway compiler" \
  --body "Implements phase 1 of docs/superpowers/specs/2026-09-26-evaluation-interpreter-design.md (branch docs/evaluation-interpreter-design): compiler (V1-V10, Q13), code map read per snapshot, compile in the evaluation snapshot (not acted on yet), activation/reactivation refuse non-compiling pathways, archive accepts DRAFT, import reports compile problems. Runtime evaluation unchanged. Live corpus: docs/superpowers/records/evaluation-interpreter/compiler-corpus.md."
```

If `gh` is not authenticated, give the user the compare URL `https://github.com/Prism-Clinical/prism-graphql/compare/main...feat/interpreter-01-compiler`. No "Generated with Claude Code" line (CLAUDE.md).

**STOP. The merge is the user's.**

- [ ] **Step 7 (only after merge, and only with the user's explicit approval): deploy, then archive anemia 1.1–1.3**

1. **Deploy.** Backend only, no migrations. Use the redeploy sequence in `CLAUDE.md`, as a short maintenance window like the lab-datum fix:
   1. build pathway-service at merged `main` outside live and confirm it builds;
   2. `pm2 stop admin-dashboard gateway pathway-service`;
   3. back up `prism_db` and `apps/pathway-service/dist`;
   4. `git pull --ff-only`, `npm install`, then build;
   5. start pathway-service, then gateway, then admin-dashboard;
   6. verify: 200 on `/`, and `{__typename}` on `/graphql`.
2. **Verify activation enforcement read-only first.** Re-run Step 5 against the deployed build. Expect the same output.
3. **Archive anemia 1.1–1.3** (Q10; ids `100c5909-89e4-4306-b078-e0ac50f35c90`, `f7ee81f5-7eaf-4477-ad5b-16edfcdf35c3`, `bfe262e8-9048-4634-9b75-b193ef6e338a`). Call through the API so the audit path is the normal one:
   ```bash
   for id in 100c5909-89e4-4306-b078-e0ac50f35c90 f7ee81f5-7eaf-4477-ad5b-16edfcdf35c3 bfe262e8-9048-4634-9b75-b193ef6e338a; do
     curl -s -X POST -H 'Content-Type: application/json' \
       -d "{\"query\":\"mutation { archivePathway(id: \\\"$id\\\") { previousStatus pathway { version status } } }\"}" http://localhost:4000/graphql; echo
   done
   ```
   Expected: each returns `previousStatus: DRAFT`, `status: ARCHIVED`. Append the result to `compiler-corpus.md`.
