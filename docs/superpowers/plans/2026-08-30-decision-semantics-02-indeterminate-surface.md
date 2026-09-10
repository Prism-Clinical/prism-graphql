# Decision Semantics 02 — Carry `indeterminate` to the Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "the gate could not tell" distinguishable from "the gate's condition was false" everywhere downstream of the evaluator — in `NodeResult`, in `GateEvidence`, in `DataGapHint`, and on the GraphQL surface the dashboard reads.

**Architecture:** The kernel already computes `indeterminate` and `uncertainty` per condition, with a normative truth table for compound gates (`compoundIndeterminate`). `traversal-engine.ts` reads only `gateResult.satisfied` and drops them. This plan adds a *reason* channel that travels alongside the existing status, threading those two fields from the evaluator through resolution state into the two evidence projections and the schema. It deliberately adds no new `NodeStatus` and changes no routing.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-08-30-decision-semantics-design.md` (W1)

**Correction applied during execution (2026-08-30).** This plan was written assuming
`indeterminate` meant "the data is missing". It does not — it means "candidate facts exist
but cannot be ordered". Zero candidates returns `NO_MATCH`, a definite decision. A second
signal, `dataUnavailable` (scalar-only), was added to carry the missing-data case, and all
three fields are threaded through instead of two. See the spec's W1 correction and commit
b0055bd. Task titles below still say "indeterminate"; read them as "both channels".

**Depends on:** Plan 01 (`v1` default). Under `legacy-v0` the evaluator never sets these fields and every test here would assert `undefined`.

## Global Constraints

- **This plan changes no routing.** A gate that is indeterminate still takes exactly the status it takes today. Escalation is plan 03. If a test in this plan changes which nodes are INCLUDED or GATED_OUT, the implementation is wrong.
- **Do not add a `NodeStatus.INDETERMINATE`.** Status is the outcome channel; this is the reason channel. Merging them re-creates the bug — "pending because unanswered" and "pending because data missing" would collapse to one value again.
- **Do not re-derive the compound truth table.** `compoundIndeterminate` in `gate-evaluator.ts` is normative. Consume it; do not reimplement it.
- **The suite is not green.** 9 pre-existing failures in `data-completeness-scorer.test.ts` and `patient-match-scorer.test.ts`. Do not fix them.
- **Never chain `cd` with other commands.** Use `git -C <path>` / `npm --prefix <path>`.
- Conventional commit prefixes. No `@anthropic.com` / `@claude.com` in commits.

---

### Task 1: Carry `indeterminate` onto `NodeResult`

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/types.ts:45-58` (the `NodeResult` interface)
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts` (the Gate branch — the `resolutionState.set(...)` calls following `evaluateGate`)
- Test: `apps/pathway-service/src/__tests__/indeterminate-surface.test.ts` (create)

**Interfaces:**
- Consumes: `GateEvaluationResult.indeterminate?: boolean` and `.uncertainty?: UncertaintyReason`, already produced by the kernel evaluator.
- Produces: `NodeResult.indeterminate?: boolean` and `NodeResult.uncertaintyReason?: string`. Tasks 2 and 3 read these off resolution state.

Note the deliberate rename at this boundary: the evaluator's field is `uncertainty` and carries an `UncertaintyReason`; `NodeResult` exposes `uncertaintyReason` as a plain string. Resolution state is projected to GraphQL and must not leak an internal union type.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/indeterminate-surface.test.ts`. This is the spec's central distinction, so it is tested as a pair — a missing datum and a definitely-false condition on the *same* gate shape:

```typescript
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { NodeStatus } from '../services/resolution/types';
import { buildGraphContext } from '../resolvers/helpers/resolution-context';
import type { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';

// A one-gate pathway: Stage -> Gate(Hb < 11) -> Step.
function graph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: [
      { nodeIdentifier: 'stage-1', nodeType: 'Stage',
        properties: { title: 'Assess', stage_number: 1 } },
      { nodeIdentifier: 'gate-hb', nodeType: 'Gate',
        properties: {
          title: 'Anemic?', gate_type: 'patient_attribute', default_behavior: 'skip',
          condition: { field: 'labs', value: '718-7', system: 'LOINC',
                       operator: 'less_than', threshold: 11 },
        } },
      { nodeIdentifier: 'step-treat', nodeType: 'Step',
        properties: { title: 'Treat', stage_number: 1, step_number: 1, display_number: '1.1' } },
    ],
    edges: [
      { sourceId: 'stage-1', targetId: 'gate-hb', edgeType: 'HAS_GATE', properties: {} },
      { sourceId: 'gate-hb', targetId: 'step-treat', edgeType: 'BRANCHES_TO', properties: {} },
    ],
  };
}

function patient(labResults: PatientContext['labResults']): PatientContext {
  return {
    conditionCodes: [], medications: [], allergies: [], labResults,
  } as unknown as PatientContext;
}

// TraversalEngine's constructor is (confidenceEngine, thresholds,
// temporalContext, pathwayDefaults, factStore, codeMap, llmGateEvaluator?).
// `factStore` MUST be assembled here, not `[]`: under v1 the kernel selects
// from it, and an empty store makes every gate answer a quiet false — which
// would make the second and third tests below pass for the wrong reason.
function engineFor(pc: PatientContext) {
  const ctx = makeEvaluationTemporalContext({
    evaluationAsOf: '2026-08-30T12:00:00.000Z',
    temporalPolicyVersion: 'v1',
  });
  const factStore = assembleContext(
    { mode: 'SYNTHETIC', patientContext: pc } as never,
    ctx,
  );
  return new TraversalEngine(
    mockConfidenceEngine,   // copy from traversal-engine.test.ts
    { autoResolveThreshold: 0.8, suggestThreshold: 0.5 },
    ctx,
    {},                     // pathwayDefaults
    factStore,
    new Map(),              // codeMap — no attribute conditions here
  );
}

describe('indeterminate reaches resolution state', () => {
  it('marks a gate indeterminate when the datum it needs is absent', async () => {
    const g = graph();
    const engine = new TraversalEngine();
    const result = await engine.traverse({
      graphContext: buildGraphContext(g.nodes, g.edges),
      patientContext: patient([]),           // no hemoglobin at all
      rootNodeIds: ['stage-1'],
    } as never);

    const gate = result.resolutionState.get('gate-hb')!;
    expect(gate.indeterminate).toBe(true);
    expect(gate.uncertaintyReason).toBeTruthy();
    // Routing is unchanged: default_behavior 'skip' still gates it out.
    expect(gate.status).toBe(NodeStatus.GATED_OUT);
  });

  it('does NOT mark a gate indeterminate when the condition is definitely false', async () => {
    const g = graph();
    const engine = new TraversalEngine();
    const result = await engine.traverse({
      graphContext: buildGraphContext(g.nodes, g.edges),
      patientContext: patient([
        { code: '718-7', system: 'LOINC', value: 13.2, date: '2026-08-01' } as never,
      ]),                                     // present, and 13.2 is not < 11
      rootNodeIds: ['stage-1'],
    } as never);

    const gate = result.resolutionState.get('gate-hb')!;
    expect(gate.indeterminate).toBeFalsy();
    expect(gate.status).toBe(NodeStatus.GATED_OUT);
  });

  it('does not mark a satisfied gate indeterminate', async () => {
    const g = graph();
    const engine = new TraversalEngine();
    const result = await engine.traverse({
      graphContext: buildGraphContext(g.nodes, g.edges),
      patientContext: patient([
        { code: '718-7', system: 'LOINC', value: 9.1, date: '2026-08-01' } as never,
      ]),
      rootNodeIds: ['stage-1'],
    } as never);

    const gate = result.resolutionState.get('gate-hb')!;
    expect(gate.indeterminate).toBeFalsy();
    expect(gate.status).toBe(NodeStatus.INCLUDED);
  });
});
```

**Two things to copy rather than invent.** `mockConfidenceEngine` already exists in `apps/pathway-service/src/__tests__/traversal-engine.test.ts` — lift it verbatim rather than writing a second one. And `engine.traverse(...)`'s exact argument object is defined in that same file; mirror its shape, keeping the three assertions above as written.

**Note the deliberate difference from that file:** it pins `legacy-v0` and passes `factStore: []`. This suite pins `v1` and assembles a real store, because `indeterminate` exists only on the kernel path. That contrast is the point — do not "simplify" it back to an empty store.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest apps/pathway-service/src/__tests__/indeterminate-surface.test.ts`

Expected: FAIL on the first test — `gate.indeterminate` is `undefined`, not `true`. The second and third tests may pass vacuously (`undefined` is falsy); that is expected and they become meaningful once the field exists.

- [ ] **Step 3: Add the fields to `NodeResult`**

In `apps/pathway-service/src/services/resolution/types.ts`, add to the `NodeResult` interface after `excludeReason`:

```typescript
  /**
   * True when the gate could not reach a definite answer — the datum was
   * absent, undated where a horizon required a date, or otherwise unorderable.
   * Distinct from a condition that evaluated definitely false.
   *
   * A REASON channel, not an outcome channel: `status` still says what the
   * traversal did. Collapsing the two would make "pending because nobody
   * answered" and "pending because the chart is silent" the same value again,
   * which is the bug this field exists to fix.
   *
   * Only the `kernel` evaluation mode (`v1`) computes this; under `legacy-v0`
   * it is always undefined.
   */
  indeterminate?: boolean;
  /** Human-readable why, when `indeterminate` is true. */
  uncertaintyReason?: string;
```

- [ ] **Step 4: Populate them in the traversal engine**

In `apps/pathway-service/src/services/resolution/traversal-engine.ts`, in the Gate branch after `const gateResult = await evaluateGate(...)`, define one helper local and spread it into every `resolutionState.set` call in that branch — the satisfied path, the pending-question path, the default-skip path, and the default-traverse path:

```typescript
        // Reason channel — carried onto every outcome the gate can take, so
        // "couldn't tell" survives regardless of what default_behavior did
        // with it. Spread rather than assigned so `legacy-v0` results (which
        // report neither field) leave the NodeResult shape untouched.
        const uncertaintyFields = {
          ...(gateResult.indeterminate !== undefined
            ? { indeterminate: gateResult.indeterminate }
            : {}),
          ...(gateResult.uncertainty !== undefined
            ? { uncertaintyReason: String(gateResult.uncertainty) }
            : {}),
        };
```

Then add `...uncertaintyFields,` to each of those four `resolutionState.set({ ... })` object literals.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest apps/pathway-service/src/__tests__/indeterminate-surface.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 6: Confirm no routing changed**

Run: `npx jest apps/pathway-service/src/__tests__/traversal-engine.test.ts apps/pathway-service/src/__tests__/reachability.test.ts`

Expected: PASS, unchanged counts. **If any assertion about node status changed, the implementation altered routing and is wrong** — revert step 4 and re-do it as a pure addition.

- [ ] **Step 7: Commit**

```bash
git add apps/pathway-service/src/services/resolution/types.ts \
        apps/pathway-service/src/services/resolution/traversal-engine.ts \
        apps/pathway-service/src/__tests__/indeterminate-surface.test.ts
git commit -m "feat(pathway-service): carry indeterminate onto NodeResult

The kernel distinguishes 'condition is false' from 'I could not tell',
with a normative truth table for compound gates. traversal-engine read
only gateResult.satisfied and dropped both fields, so downstream the two
were the same event.

Adds a reason channel alongside status. No routing changes: an
indeterminate gate still takes exactly the status it took before."
```

---

### Task 2: Surface `indeterminate` on `GateEvidence`

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/care-plan-merge.ts:197-215` (the `GateEvidence` interface)
- Modify: `apps/pathway-service/src/services/resolution/care-plan-projection.ts:266-299` (`collectEvidenceTrail`)
- Modify: `apps/pathway-service/schema.graphql` (the `GateEvidence` type, around line 395)
- Test: `apps/pathway-service/src/__tests__/care-plan-projection-evidence.test.ts` (extend)

**Interfaces:**
- Consumes: `NodeResult.indeterminate` / `.uncertaintyReason` from Task 1.
- Produces: `GateEvidence.indeterminate?: boolean` and `.uncertaintyReason?: string`, and the matching nullable GraphQL fields. The admin dashboard's Lineage tab reads these.

- [ ] **Step 1: Write the failing test**

Append to `apps/pathway-service/src/__tests__/care-plan-projection-evidence.test.ts`. Read the file's existing helpers first and reuse them — it already builds a `ResolutionState` and calls the projection; mirror that shape rather than inventing a second harness.

First extend the file's existing `gateNode` helper (line 15) to accept the two new fields — it currently takes `{ gate_type?, title?, reason? }`:

```typescript
function gateNode(
  id: string,
  status: NodeStatus,
  overrides: {
    gate_type?: string;
    title?: string;
    reason?: string;
    indeterminate?: boolean;
    uncertaintyReason?: string;
  } = {},
) {
  return [
    id,
    {
      nodeId: id,
      nodeType: 'Gate',
      title: overrides.title ?? id,
      status,
      confidence: 1,
      confidenceBreakdown: [],
      depth: 1,
      excludeReason: overrides.reason,
      indeterminate: overrides.indeterminate,
      uncertaintyReason: overrides.uncertaintyReason,
      properties: { gate_type: overrides.gate_type ?? 'patient_attribute' },
    },
  ] as const;
}
```

Then append the new describe block, using the file's existing `makeState` helper and the public `projectResolutionToCarePlan` entry point — `collectEvidenceTrail` is module-private and must not be exported just for a test:

```typescript
describe('evidence trail carries the indeterminate reason channel', () => {
  it('marks an indeterminate gate and preserves its reason', () => {
    const state = makeState(
      gateNode('gate-hb', NodeStatus.GATED_OUT, {
        title: 'Anemic?',
        reason: 'no hemoglobin on file',
        indeterminate: true,
        uncertaintyReason: 'NO_FACT_IN_HORIZON',
      }),
    );

    const plan = projectResolutionToCarePlan(state, createEmptyDependencyMap());
    const row = plan.evidenceTrail.find(r => r.nodeId === 'gate-hb')!;
    expect(row.indeterminate).toBe(true);
    expect(row.uncertaintyReason).toBe('NO_FACT_IN_HORIZON');
  });

  // The distinction the whole plan exists for: this gate answered "no",
  // it did not fail to answer.
  it('leaves a definitely-false gate unmarked', () => {
    const state = makeState(
      gateNode('gate-hb', NodeStatus.GATED_OUT, {
        title: 'Anemic?',
        reason: 'labs value 13.2 not < 11',
      }),
    );

    const plan = projectResolutionToCarePlan(state, createEmptyDependencyMap());
    const row = plan.evidenceTrail.find(r => r.nodeId === 'gate-hb')!;
    expect(row.indeterminate).toBeFalsy();
    expect(row.uncertaintyReason).toBeUndefined();
  });
});
```

Match `projectResolutionToCarePlan`'s exact argument list to the existing call at line 83 of that file — reproduce it, do not assume the two-argument form above is right.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest apps/pathway-service/src/__tests__/care-plan-projection-evidence.test.ts`

Expected: FAIL — `row.indeterminate` is `undefined`.

- [ ] **Step 3: Add the fields to the `GateEvidence` interface**

In `apps/pathway-service/src/services/resolution/care-plan-merge.ts`, add after `fieldsRead`:

```typescript
  /**
   * True when this gate could not reach a definite answer, as opposed to
   * answering "no". Lets the UI say "we lacked data" instead of implying the
   * patient failed a criterion. Undefined under `legacy-v0`.
   */
  indeterminate?: boolean;
  /** Why it could not decide, when `indeterminate` is true. */
  uncertaintyReason?: string;
```

- [ ] **Step 4: Populate them in `collectEvidenceTrail`**

In `apps/pathway-service/src/services/resolution/care-plan-projection.ts`, extend the `out.push({...})` literal:

```typescript
    out.push({
      nodeId: node.nodeId,
      title: node.title,
      kind,
      status: node.status,
      reason: node.excludeReason ?? undefined,
      fieldsRead: Array.from(fieldsByGate.get(node.nodeId) ?? []),
      ...(node.indeterminate !== undefined ? { indeterminate: node.indeterminate } : {}),
      ...(node.uncertaintyReason !== undefined
        ? { uncertaintyReason: node.uncertaintyReason }
        : {}),
    });
```

- [ ] **Step 5: Extend the GraphQL type**

In `apps/pathway-service/schema.graphql`, inside `type GateEvidence`, after `fieldsRead`:

```graphql
  """
  True when the gate could not reach a definite answer — the datum was
  absent or unorderable — as opposed to the condition evaluating false.
  Null when the resolution ran under a policy version that does not
  compute it.
  """
  indeterminate: Boolean
  """Why the gate could not decide, when `indeterminate` is true."""
  uncertaintyReason: String
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest apps/pathway-service/src/__tests__/care-plan-projection-evidence.test.ts apps/pathway-service/src/__tests__/care-plan-merge.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pathway-service/src/services/resolution/care-plan-merge.ts \
        apps/pathway-service/src/services/resolution/care-plan-projection.ts \
        apps/pathway-service/schema.graphql \
        apps/pathway-service/src/__tests__/care-plan-projection-evidence.test.ts
git commit -m "feat(pathway-service): surface indeterminate on GateEvidence

Lets the lineage view distinguish 'we lacked the data' from 'the patient
did not meet the criterion' — today both render identically as a
gated-out row.

Schema change: gateway must recompose the supergraph on redeploy."
```

---

### Task 3: Surface `indeterminate` on `DataGapHint`

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/care-plan-merge.ts` (the `DataGapHint` interface)
- Modify: `apps/pathway-service/src/services/resolution/care-plan-projection.ts` (the data-gap collector, immediately above `collectEvidenceTrail`)
- Modify: `apps/pathway-service/schema.graphql` (the `DataGapHint` type, around line 369)
- Test: `apps/pathway-service/src/__tests__/care-plan-projection-data-gaps.test.ts` (extend)

**Interfaces:**
- Consumes: `NodeResult.indeterminate` / `.uncertaintyReason` from Task 1.
- Produces: `DataGapHint.indeterminate?: boolean` and `.uncertaintyReason?: string`.

**Why this matters separately:** `DataGapHint` is what powers "add this data → unlocks N recommendations". Today it lists every non-firing gate equally, so a gate the patient genuinely failed sits next to one that merely lacked data, and the prompt to supply data is wrong for the first. `indeterminate` is exactly the flag that separates them.

- [ ] **Step 1: Write the failing test**

Append to `apps/pathway-service/src/__tests__/care-plan-projection-data-gaps.test.ts`, reusing that file's existing harness:

Read this file's existing helpers first — it builds a state whose gated-out gates have downstream action nodes, which is what makes a hint appear at all. A gate with no reachable recommendations produces no `DataGapHint`, so reusing that harness is not optional.

```typescript
it('flags which data gaps are genuinely missing data vs failed criteria', () => {
  // Both gates are GATED_OUT with recommendations behind them, so both
  // produce hints. Only the first is an honest "add this data" prompt.
  const state = makeStateWithGatedSubtree(
    { id: 'gate-missing', title: 'Ferritin low?', reason: 'no ferritin on file',
      indeterminate: true, uncertaintyReason: 'NO_FACT_IN_HORIZON' },
    { id: 'gate-failed', title: 'Severe?', reason: 'labs value 10 not < 7' },
  );

  const plan = projectResolutionToCarePlan(state, createEmptyDependencyMap());
  const missing = plan.dataGapHints.find(h => h.gateNodeId === 'gate-missing')!;
  const failed = plan.dataGapHints.find(h => h.gateNodeId === 'gate-failed')!;

  expect(missing.indeterminate).toBe(true);
  expect(missing.uncertaintyReason).toBe('NO_FACT_IN_HORIZON');
  expect(failed.indeterminate).toBeFalsy();
});
```

`makeStateWithGatedSubtree` is a stand-in name: use whatever the existing file already calls its state builder, extended to pass `indeterminate` / `uncertaintyReason` through onto the gate node the same way Task 2 extended `gateNode`. Do not add a second state builder alongside the one that is there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest apps/pathway-service/src/__tests__/care-plan-projection-data-gaps.test.ts`

Expected: FAIL — `indeterminate` is `undefined` on both hints.

- [ ] **Step 3: Add the fields to `DataGapHint`**

In `care-plan-merge.ts`, on the `DataGapHint` interface:

```typescript
  /**
   * True when this gate lacked the data to decide, rather than deciding
   * "no". Only an indeterminate gap is genuinely an "add this data" prompt —
   * a definitely-false gate is not a gap, it is an answer.
   */
  indeterminate?: boolean;
  /** Why it could not decide, when `indeterminate` is true. */
  uncertaintyReason?: string;
```

- [ ] **Step 4: Populate them in the data-gap collector**

Extend the collector's push literal with the same two conditional spreads used in Task 2 Step 4, reading from the `NodeResult`.

- [ ] **Step 5: Extend the GraphQL type**

In `schema.graphql`, inside `type DataGapHint`, after `fieldsRead`:

```graphql
  """
  True when this gate lacked the data to decide rather than deciding "no".
  Only an indeterminate gap is genuinely an "add this data" prompt.
  """
  indeterminate: Boolean
  """Why the gate could not decide, when `indeterminate` is true."""
  uncertaintyReason: String
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest apps/pathway-service/src/__tests__/care-plan-projection-data-gaps.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the whole suite**

Run: `npx jest apps/pathway-service 2>&1 | tail -6`

Expected: failures confined to the two known scorer suites.

- [ ] **Step 8: Commit**

```bash
git add apps/pathway-service/src/services/resolution/care-plan-merge.ts \
        apps/pathway-service/src/services/resolution/care-plan-projection.ts \
        apps/pathway-service/schema.graphql \
        apps/pathway-service/src/__tests__/care-plan-projection-data-gaps.test.ts
git commit -m "feat(pathway-service): surface indeterminate on DataGapHint

'Add this data → unlocks N recommendations' is only honest for a gate
that lacked data. A gate the patient definitely failed is an answer, not
a gap, and prompting for more data there is wrong.

Schema change: gateway must recompose the supergraph on redeploy."
```

---

## Verification

- [ ] `npx jest apps/pathway-service 2>&1 | tail -6` — failures confined to the two known scorer suites.
- [ ] `npm run build --prefix apps/pathway-service` succeeds (runs `graphql-codegen` then `tsc`; confirms the schema additions generate).
- [ ] Against a running stack, `startMultiPathwayResolution` on `anemia-in-pregnancy-v1` v1.4 with an empty patient returns `evidenceTrail` rows where the hemoglobin gates carry `indeterminate: true`, and a patient with Hb 13.2 returns the same gates with `indeterminate: false`.

## Deploy note

Two schema changes. On redeploy the gateway must recompose the supergraph — restart `pathway-service` **before** `gateway`, per the CLAUDE.md sequence. Both fields are nullable additions, so the change is backward-safe for any client that does not select them.

## What this plan deliberately does not do

- Escalate anything. An indeterminate gate still takes `default_behavior`. That is plan 03.
- Add a `NodeStatus.INDETERMINATE`.
- Render the new fields in the admin dashboard. UI consumption follows the escalation work, so the lineage view changes once rather than twice.
