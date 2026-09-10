# Decision Semantics 03 — Retraversal Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make retraversal produce the same result initial traversal would have produced from the same facts, by making it *be* the traversal engine re-entered incrementally rather than a second implementation of the same semantics.

**Architecture:** `TraversalEngine` (822 lines) and `RetraversalEngine` (306 lines) are two implementations of one thing, and nothing holds them to each other. Three known defects follow from that, and `safety.ts` already carries a note that the two "implement equivalent safety checks inline". The fix extracts the **disposition of a single node** — given graph, patient context, answers and current state, what status does this node take and what does it enqueue — into one unit both entry points call. Full traversal seeds it from the Pathway root; incremental retraversal seeds it from an affected set. Every defect below then falls out of the unification rather than being patched into the second copy.

**Tech Stack:** TypeScript 5, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-08-30-decision-semantics-design.md`, and the defect analysis in `docs/superpowers/plans/2026-08-12-gate-subtree-retraversal.md` (read that first — it is the evidence base and this plan does not repeat it).

**Depends on:** Plan 01 (`v1` default). Defect 1 is what the stub calls a blocker for the v1 rollout flip, so this must land **before** plan 01 is deployed.

**Blocks:** W2 escalation. That workstream is entirely "provider answers → gate flips → subtree re-resolves", so all three defects sit in its path. Escalation built on today's retraversal would ship and visibly do nothing.

## The three defects

Full evidence in the stub; restated only enough to execute against.

| # | Defect | Root cause |
|---|---|---|
| 1 | A gate flipping `GATED_OUT → INCLUDED` does not re-resolve its subtree | `recordInfluence` has two call sites — a gate's `depends_on` and a DecisionPoint's branch targets. It **never records gate → the subtree it gated out**, so `retraverse`'s cascade (`retraversal-engine.ts:266`) has nothing to enqueue and dies at the gate. `overrideNode` reads the same map and has the same blind spot. |
| 2 | Answering an opening question **deletes** its guarded subtree | `resolution.ts:534-542` deletes every `PENDING_QUESTION` / `GATED_OUT` node it reached, then hands the ids to `retraverse`, which skips any id not in `resolutionState` (`retraversal-engine.ts:187`). The nodes are never recreated — they vanish from the session. |
| 3 | Retraversal ignores `default_behavior` | `retraversal-engine.ts:237` sets `newStatus = gateResult.satisfied ? INCLUDED : GATED_OUT` unconditionally. Traversal consults `default_behavior`. The same gate on the same facts means different things depending on when it was evaluated. |

Defects 2 and 3 are **live in production today** under `legacy-v0` and need no temporal policy of any kind. Defect 2 is destructive and persisted.

## Decisions taken

The stub lists six open questions and says question 6 decides the plan's shape. All six are answered here; do not re-open them mid-execution.

1. **Mirror direction** (`INCLUDED → GATED_OUT` must gate out a currently-included subtree) — **in scope, Task 5.** The stub notes it is arguably the more dangerous direction: a subtree that should now be excluded staying included is a clinical over-recommendation, where the flip direction is only an under-recommendation.
2. **Provider overrides on descendants** — **respect the override on its own node, but cascade through it.** Today `retraversal-engine.ts:190-193` does `continue`, which skips the node *and* everything downstream of it, so one overridden node freezes an entire branch. The human decision was about that node; it was never a decision about its descendants.
3. **Is re-resolution subtree-local?** — **measure, then bound.** Task 3 instruments the cascade against the anemia pathway before choosing whether `MAX_CASCADE_DEPTH` needs changing. Do not pick a number without the measurement.
4. **Existing live sessions** — **moot.** Plan 01's migration 065 purged all 41 per-pathway and 14 multi-pathway sessions. `pathway_resolution_sessions` is empty, so there are no persisted dependency maps missing gate→subtree entries and no sessions carrying defect-3 statuses. Verify with a `count(*)` before relying on this; if rows exist, stop and re-decide.
5. **Rebuilding nodes defect 2 already deleted** — **moot, same reason.**
6. **One implementation or three patches** — **one implementation.** Decided by the user, 2026-08-30. Defect 2's honest fix needs node materialization that only `TraversalEngine` has; defect 3 needs one gate-disposition rule both apply; defect 1 needs traversal's knowledge of the subtree it gated out. Patching the second implementation a third time leaves the two free to diverge a fourth — and W2 is about to add `on_unresolved`, a fourth rule both would have to agree on.

## Global Constraints

- **The refactor must not change initial-traversal behaviour.** Task 2 is a pure extraction: the full-traversal suite must be byte-identical before and after. If it moves, the extraction is wrong.
- **The pinned assertions INVERT, they are not rewritten.** `temporal/v1-traversal-behavior.test.ts` deliberately asserts today's defective behaviour (`influences.size === 0`, `step-1` still `GATED_OUT`, `gate-1`'s stale `excludeReason`). Flip them to the correct expectation and keep the block comment, updated. **"The pin still passes unchanged" is evidence the fix did not take.**
- **The suite is not green.** 9 pre-existing failures in `data-completeness-scorer.test.ts` and `patient-match-scorer.test.ts`. Do not fix them.
- **`npm run typecheck` is not a gate** (~4000 pre-existing monorepo errors) and **ts-jest runs with diagnostics disabled, so jest-green does not mean it compiles.** Use `npx tsc --noEmit -p apps/pathway-service/tsconfig.json`, which is clean and must stay clean.
- **Never chain `cd` with other commands.** Use `git -C <path>` / `npm --prefix <path>`.
- Conventional commit prefixes. No `@anthropic.com` / `@claude.com` in commits.

---

### Task 1: Differential harness — pin what the two engines do today

**Files:**
- Test: `apps/pathway-service/src/__tests__/engine-parity.test.ts` (create)

**Interfaces:**
- Consumes: `TraversalEngine.traverse(graphContext, patientContext, gateAnswers)` and `RetraversalEngine.retraverse(affectedNodeIds, resolutionState, dependencyMap, graphContext, patientContext, gateAnswers)`.
- Produces: a harness later tasks re-run unchanged. It is the safety net for a refactor that merges two implementations, so it must exist before either is touched.

**Why first.** Tasks 2–4 move code between two engines. Without a test that runs the *same scenario* through both and compares, a divergence introduced by the refactor is indistinguishable from a divergence that was already there.

- [ ] **Step 1: Write the parity harness**

Create `apps/pathway-service/src/__tests__/engine-parity.test.ts`. Copy the engine-construction helpers from `traversal-engine.test.ts` (`node`, `edge`, `mockConfidenceEngine`, `mockThresholds`) rather than writing new ones — parity is the point, so the two engines must be built from identical inputs.

```typescript
/**
 * The two engines are one semantics with two implementations. This suite runs
 * the SAME scenario through both and compares the resolution state they
 * produce.
 *
 * Written BEFORE the unification, so it pins today's behaviour — divergences
 * included. Cases that currently diverge assert the DIVERGENCE, so the refactor
 * closing them is visible as those assertions flipping rather than as a test
 * quietly starting to pass.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { RetraversalEngine } from '../services/resolution/retraversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import {
  NodeStatus,
  NodeResult,
  createEmptyDependencyMap,
} from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext, EMPTY_PATIENT } from './fixtures/reference-patient-context';

const AS_OF = '2026-08-30T12:00:00.000Z';

// Copy these three verbatim from traversal-engine.test.ts — parity is the
// point, so both engines must be built from identical inputs.
function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}
const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED',
  }),
};

// root -> gate -> step -> med. A gate WITH a subtree is the minimum shape that
// exposes all three defects; a bare gate hides every one of them.
function graphFor(gateProps: Record<string, unknown>) {
  const nodes = [
    node('root', 'Pathway'),
    node('gate-1', 'Gate', gateProps),
    node('step-1', 'Step', { title: 'Treat' }),
    node('med-1', 'Medication', { name: 'Ferrous sulfate', role: 'first_line' }),
  ];
  const edges = [
    edge('root', 'gate-1', 'HAS_GATE'),
    edge('gate-1', 'step-1', 'BRANCHES_TO'),
    edge('step-1', 'med-1', 'USES_MEDICATION'),
  ];
  return makeGraphContext(nodes, edges);
}

const CLOCK = makeEvaluationTemporalContext({
  evaluationAsOf: AS_OF,
  temporalPolicyVersion: 'legacy-v0',
});
const THRESHOLDS = { autoResolveThreshold: 0.85, suggestThreshold: 0.6 };
const ARGS = [CLOCK, {}, [], new Map()] as const;

function traversalEngine() {
  return new TraversalEngine(mockConfidenceEngine, THRESHOLDS, ...ARGS);
}
function retraversalEngine() {
  return new RetraversalEngine(mockConfidenceEngine, THRESHOLDS, ...ARGS);
}

/** Statuses only — the comparison that matters, and stable across refactors. */
function statuses(state: Map<string, NodeResult>): Record<string, string> {
  return Object.fromEntries([...state].map(([id, r]) => [id, r.status]));
}
```

Then one case per row of the defect table. The shape of each: run a full
traversal to get the reference result; separately build a starting state, apply
the change the scenario describes, run `retraverse` over the affected set, and
compare `statuses()` of both.

**Record what actually happens — do not predict it.** Run each case, read the
two status maps, and assert exactly those. The value of this task is a truthful
record of today, and a guessed assertion that happens to pass is worth nothing.

At minimum, one case per defect plus one control:

| Case | Gate props | Expectation to record |
|---|---|---|
| control — gate satisfied both ways | condition the patient meets | both engines agree |
| defect 1 — gate flips open | condition initially unmet, then met | traversal includes `step-1`/`med-1`; retraversal leaves them `GATED_OUT` |
| defect 3 — `default_behavior: 'traverse'` | unmet condition, `default_behavior: 'traverse'` | traversal INCLUDES the gate; retraversal GATES it OUT |

 Do not guess at the divergences — **run each case and write down what actually happens**, then assert that. The point of this task is a truthful record of today, not a prediction.

- [ ] **Step 2: Run it and record the baseline**

Run: `npx jest apps/pathway-service/src/__tests__/engine-parity.test.ts`

Expected: PASS — every assertion describes current behaviour, including the divergent ones.

- [ ] **Step 3: Commit**

```bash
git add apps/pathway-service/src/__tests__/engine-parity.test.ts
git commit -m "test(pathway-service): pin traversal/retraversal parity and divergence

The two engines are one semantics with two implementations. This runs the
same scenario through both and asserts what each produces today,
divergences included, so the unification's effect is visible as these
assertions flipping rather than as tests quietly changing meaning."
```

---

### Task 2: Extract node disposition into one unit

**Files:**
- Create: `apps/pathway-service/src/services/resolution/node-disposition.ts`
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts`
- Test: `apps/pathway-service/src/__tests__/node-disposition.test.ts` (create)

**Interfaces:**
- Produces:

```typescript
/** What resolving one node decided, and what that implies for the walk. */
export interface Disposition {
  /** The row to write into resolutionState for this node. */
  result: NodeResult;
  /** Children to enqueue for resolution (the gate opened, the DP branched). */
  enqueue: string[];
  /**
   * Descendants to mark with a single status without individually resolving
   * them — traversal's `markSubtree` case (gated out, pending an answer).
   * Empty when the node did not close off a subtree.
   */
  markSubtree?: { rootIds: string[]; status: NodeStatus; reason: string };
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  /** Dependency edges this node's resolution established. */
  influences: Array<{ from: string; to: string }>;
  contextFieldsRead: string[];
}

export async function disposeNode(
  node: GraphNode,
  ctx: DispositionContext,   // graphContext, patientContext, gateAnswers, resolutionState, deps
): Promise<Disposition>;
```

**This task changes no behaviour.** It moves the body of `TraversalEngine`'s BFS switch — the Gate branch, the DecisionPoint branch, the structural/action branches — into `disposeNode`, and rewrites `traverse` to be a queue that calls it. Nothing about *what* is decided moves.

- [ ] **Step 1: Write the characterization test for the extracted unit**

Create `apps/pathway-service/src/__tests__/node-disposition.test.ts`, one case per branch of the current switch: a satisfied gate, an unsatisfied gate under `skip`, an unsatisfied gate under `traverse`, an unanswered question gate, a tentative LLM gate, a DecisionPoint with one qualifying branch, a DecisionPoint with none, and a plain action node. Assert the `Disposition` each produces.

Write these by reading the current traversal code, not by guessing — they are the specification of what must not change.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest apps/pathway-service/src/__tests__/node-disposition.test.ts`

Expected: FAIL — `node-disposition.ts` does not exist.

- [ ] **Step 3: Extract**

Move the disposition logic out of `traverse`'s loop into `disposeNode`. `markSubtree`, `countSubtree`, `recordInfluence` and `uncertaintyOf` move with it or become its callers' business. `traverse` keeps: root lookup, the queue, the timeout, the visited/memoization rule, and writing results into `resolutionState`.

Keep `recordInfluence`'s two existing call sites producing the same edges — **defect 1's new edge is Task 3's job, not this one.** Adding it here would make the "no behaviour change" check fail for a good reason and hide a bad one.

- [ ] **Step 4: Verify nothing moved**

```bash
npx jest apps/pathway-service/src/__tests__/node-disposition.test.ts
npx jest apps/pathway-service/src/__tests__/traversal-engine.test.ts \
         apps/pathway-service/src/__tests__/engine-parity.test.ts \
         apps/pathway-service/src/__tests__/temporal
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
```

Expected: all PASS, with the parity suite's divergence assertions **still passing unchanged** — retraversal has not been touched yet.

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/resolution/node-disposition.ts \
        apps/pathway-service/src/services/resolution/traversal-engine.ts \
        apps/pathway-service/src/__tests__/node-disposition.test.ts
git commit -m "refactor(pathway-service): extract node disposition from traversal

Pure extraction, no behaviour change: what a single node decides, and
what that implies for the walk, becomes one unit. Prepares the
incremental entry point that replaces RetraversalEngine.

Deliberately does NOT add the gate-to-subtree dependency edge — that is
the next task, and adding it here would make the no-change check fail
for a good reason while hiding a bad one."
```

---

### Task 3: Incremental entry point — the three defects fall out

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts`
- Modify: `apps/pathway-service/src/__tests__/temporal/v1-traversal-behavior.test.ts` (invert the four pins)
- Modify: `apps/pathway-service/src/__tests__/engine-parity.test.ts` (invert the divergence cases)
- Test: `apps/pathway-service/src/__tests__/incremental-traversal.test.ts` (create)

**Interfaces:**
- Produces: `TraversalEngine.resolveIncrementally(seedNodeIds, resolutionState, dependencyMap, graphContext, patientContext, gateAnswers): Promise<TraversalResult>` — the same return shape `traverse` produces, so callers do not branch on which entry point ran.

**How each defect resolves:**

- **Defect 1** — the cascade walks the **graph**, not only `dependencyMap.influences`. When `disposeNode` says a gate now opens, its children are enqueued and resolved by the same unit that would have resolved them on a full traversal. The dependency map stays for what it is genuinely for (`depends_on`, DecisionPoint branches); it stops being the only route to a node's dependents.
- **Defect 2** — nothing is deleted. A node whose disposition changes is **overwritten in place** by `disposeNode`'s result. The deletion loop at `resolution.ts:534-542` is removed in Task 4.
- **Defect 3** — `default_behavior` is consulted inside `disposeNode`, so both entry points get it by construction. There is no second rule left to forget.

- [ ] **Step 1: Write the failing tests**

Create `apps/pathway-service/src/__tests__/incremental-traversal.test.ts` covering, at minimum:

1. A gate flipping `GATED_OUT → INCLUDED` re-resolves its whole subtree, clears its own `excludeReason`, and recomputes its confidence.
2. Descendants' derived reasons (`Gated out by gate-1: ...`) are cleared, not left naming a decision no longer in force.
3. An answer that opens a question gate leaves **no node missing** from `resolutionState` — assert the key set is unchanged or grown, never shrunk. This is defect 2 and it is the destructive one.
4. An unsatisfied gate with `default_behavior: 'traverse'` is INCLUDED on the incremental path exactly as on the full path.
5. A node carrying a `providerOverride` keeps its status, **and its descendants are still re-resolved** (decision 2).

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest apps/pathway-service/src/__tests__/incremental-traversal.test.ts`

Expected: FAIL — `resolveIncrementally` does not exist.

- [ ] **Step 3: Implement the incremental entry point**

Seed the queue from `seedNodeIds`, then walk exactly as `traverse` does, with two differences: nodes already in `resolutionState` are re-resolved rather than skipped, and a node whose disposition is unchanged does not enqueue its children again (that is the termination condition — without it a diamond graph re-walks forever).

- [ ] **Step 4: Invert the pins**

In `temporal/v1-traversal-behavior.test.ts`, the P1-2 flip test's four assertions become:

```typescript
    // ─── PINNED DEFECT, NOW FIXED ─────────────────────────────────────
    // These four assertions were written to be INVERTED when the
    // gate-subtree retraversal work landed, and this is that inversion.
    // Previously: influences.size === 0, step-1 still GATED_OUT with a
    // derived reason, and gate-1 carrying a stale excludeReason.
    expect(resolutionState.get('step-1')!.status).not.toBe(NodeStatus.GATED_OUT);
    expect(resolutionState.get('step-1')!.excludeReason).toBeUndefined();
    expect(resolutionState.get('gate-1')!.excludeReason).toBeUndefined();
```

Update the block comment above them to describe the fix rather than the defect, and keep the pointer to the stub. Do the same for the parity suite's two divergence cases: they now assert **agreement**.

- [ ] **Step 5: Measure the cascade (decision 3)**

Instrument `resolveIncrementally` to report nodes recomputed, run it against the anemia pathway fixture, and record the number in the commit message. If it exceeds `MAX_CASCADE_DEPTH`, raise the limit deliberately with the measurement as justification. **Do not pick a bound without the number.**

- [ ] **Step 6: Verify**

```bash
npx jest apps/pathway-service
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
```

Expected: failures confined to the two known scorer suites.

- [ ] **Step 7: Commit**

```bash
git add apps/pathway-service/src apps/pathway-service/src/__tests__
git commit -m "fix(pathway-service): re-resolve subtrees on the incremental path

Adds TraversalEngine.resolveIncrementally, which walks the same
disposition unit a full traversal does, seeded from an affected set
instead of the root. All three retraversal defects resolve as
consequences rather than patches:

- a flipped gate re-resolves its subtree, because the cascade walks the
  GRAPH rather than only dependencyMap.influences, which never recorded
  the gate-to-subtree edge;
- nothing is deleted, because a changed node is overwritten in place;
- default_behavior is consulted in the shared unit, so both entry points
  honour it by construction.

The four pinned assertions in the P1-2 flip test are INVERTED, as they
were written to be. Cascade measured at <N> nodes on the anemia pathway."
```

---

### Task 4: Retire `RetraversalEngine`

**Files:**
- Delete: `apps/pathway-service/src/services/resolution/retraversal-engine.ts`
- Modify: `apps/pathway-service/src/services/resolution/index.ts` (drop the export)
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts` (three call sites: `overrideNode` ~:375, `answerGateQuestion` ~:545, `addPatientContext` ~:776)
- Modify: `apps/pathway-service/src/services/resolution/safety.ts` (its note about two engines is now false)
- Delete or migrate: `apps/pathway-service/src/__tests__/retraversal-engine.test.ts`

**Interfaces:**
- Consumes: `resolveIncrementally` from Task 3.
- Produces: one engine. No later plan constructs a `RetraversalEngine`.

- [ ] **Step 1: Migrate the three call sites**

Each currently builds a `RetraversalEngine` with the same seven arguments `TraversalEngine` takes, then calls `retraverse(...)`. Replace with the already-constructed traversal engine and `resolveIncrementally(...)`.

**Delete the subtree-deletion loop at `resolution.ts:534-542` as part of this.** It exists only to work around the fact that `retraverse` could not re-resolve in place; leaving it in would delete the nodes Task 3 just taught the engine to rebuild.

- [ ] **Step 2: Migrate the retraversal tests**

`retraversal-engine.test.ts` asserts real behaviour that must survive. Port each case onto `resolveIncrementally` rather than deleting the file wholesale — **except** any case that asserts one of the three defects, which the parity and incremental suites now cover from the correct side. Note in the commit which cases were dropped and why.

- [ ] **Step 3: Verify**

```bash
npx jest apps/pathway-service
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
grep -rn "RetraversalEngine" apps/pathway-service/src | grep -v __tests__
```

Expected: suite failures confined to the two known scorer suites; the grep returns nothing.

- [ ] **Step 4: Commit**

```bash
git add -A apps/pathway-service
git commit -m "refactor(pathway-service): retire RetraversalEngine

One implementation of one semantics. The three mutation call sites now
re-enter TraversalEngine incrementally.

Also removes the subtree-deletion loop in answerGateQuestion, which
existed only because retraverse could not re-resolve in place — the
cause of the destructive defect where answering a question made nodes
vanish from the session."
```

---

### Task 5: The mirror direction, and the override policy

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts` (if the mirror case is not already covered)
- Test: `apps/pathway-service/src/__tests__/incremental-traversal.test.ts` (extend)

**Why separate.** Tasks 3–4 fix the direction the stub documented. The mirror — a gate flipping `INCLUDED → GATED_OUT`, which must now gate out a subtree that is currently included — is open question 1, and the stub argues it is the **more dangerous** direction: a subtree that should be excluded staying included is a clinical over-recommendation.

- [ ] **Step 1: Write the failing tests**

1. A gate flipping `INCLUDED → GATED_OUT` gates out its previously-included subtree, with the derived reason set.
2. A previously-included action node under that gate no longer appears in the projected care plan.
3. An overridden descendant keeps its provider-set status even as the subtree closes — the human decision stands — **but** its own descendants still re-resolve.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest apps/pathway-service/src/__tests__/incremental-traversal.test.ts`

If any already passes, the unification covered that case for free. Say so in the commit rather than deleting the test — a passing test that documents the mirror direction is worth keeping.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Verify and commit**

```bash
npx jest apps/pathway-service
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
git add -A apps/pathway-service
git commit -m "fix(pathway-service): close subtrees when a gate flips shut

The mirror of the flip fix, and the more dangerous direction: a subtree
that should now be excluded staying included is a clinical
over-recommendation, where the open direction only under-recommends.

Provider overrides stand on their own node and no longer freeze the
branch below them — the human decision was about that node, never about
its descendants."
```

---

## Verification

- [ ] `npx jest apps/pathway-service` — failures confined to `data-completeness-scorer.test.ts` and `patient-match-scorer.test.ts`.
- [ ] `npx tsc --noEmit -p apps/pathway-service/tsconfig.json` — clean.
- [ ] `npm run build --prefix apps/pathway-service` — succeeds.
- [ ] `grep -rn "RetraversalEngine" apps/pathway-service/src` — nothing outside deleted tests.
- [ ] The four P1-2 pins are inverted, and the parity suite's divergence cases now assert agreement.
- [ ] `SELECT count(*) FROM pathway_resolution_sessions;` is still 0, confirming decisions 4 and 5 held.

## What this plan deliberately does not do

- Escalation (`on_unresolved`). That is the next plan, and it needs this one to have landed — it is entirely "answer → flip → re-resolve".
- `branch_mode` / `SELECTS_BRANCH` enforcement, and question per-branch routing. Independent workstreams.
- Any change to what a gate *decides*. This plan changes only whether the rest of the session agrees with that decision.
