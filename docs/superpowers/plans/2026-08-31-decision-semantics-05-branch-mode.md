# Decision Semantics 05 — Enforce `branch_mode` and `SELECTS_BRANCH` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a DecisionPoint's declared branching semantics real. A `one_of` fork must take exactly one branch, and an excluded branch must explain itself in the author's own words.

**Architecture:** Both `branch_mode` and `SELECTS_BRANCH` are validated at import and then never read at resolution. The DecisionPoint arm of `disposeNode` scores every `BRANCHES_TO` target with the confidence engine and includes every one clearing `suggestThreshold`, whatever mode the author declared. This plan reads the mode, and consumes the criterion→branch mapping the editor already lets authors draw.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2, Jest + ts-jest, PostgreSQL 15 with Apache AGE; `prism-admin-dashboard` (Next.js 16).

**Spec:** `docs/superpowers/specs/2026-08-30-decision-semantics-design.md` (W3)

**Depends on:** Plan 03 only, and loosely — `resolveIncrementally` is what re-resolves a fork after a provider picks a branch. Independent of the v1 flip: nothing here reads a temporal signal.

## Why this one is the urgent one

This is the only live patient-safety defect in the workstream. Every DecisionPoint that declares a mode declares `one_of` — 7 on the ACTIVE anaemia pathway, 6 on chronic-htn, 1 on vaginitis — and none of them are enforced. A fork whose branches are mutually exclusive treatments can put all of them in one plan.

It is exactly the vaginitis scenario: `dp-1` is `one_of` with branches to *treat bacterial vaginosis*, *treat trichomoniasis*, and *treat vulvovaginal candidiasis*. Nothing stops all three being included, which is metronidazole **and** clindamycin **and** fluconazole in a pregnant patient.

## What `SELECTS_BRANCH` is, and is not

It is a **mapping**, not a predicate. The design comment on the edge type says it exists so that tying criterion → target lets the engine "compute exclusion lineage … and lets the UI show *If X then go to Y* inline instead of leaving the mapping implicit in the criterion description."

**It does not require evaluating the criterion.** Criteria are prose (`description` only), and nothing in this plan changes that. Which branch is taken still comes from confidence or a provider's answer, exactly as today. The mapping only changes *how an exclusion is explained*: instead of

> `step-2-2` excluded — Confidence 0.4 below suggest threshold 0.6

the trail can say

> `step-2-2` excluded — criterion "Mixed or equivocal results requiring clinical judgement" did not apply

**The authoring side already exists.** `CriterionBranchSelector` and `PathwayCanvas` let an author draw these edges today; the engine throws them away. Same defect class as `branch_mode`, which is why they belong in one plan.

**There are currently zero `SELECTS_BRANCH` edges in the graph.** This ships as a capability with no existing users. Do not treat an empty result as a bug.

## Decisions taken

1. **`one_of` with more than one qualifying branch PENDS for the provider.** It does not auto-pick the highest confidence. On an exclusive clinical fork, two branches clearing the bar means the data did not decide it, and picking the higher number is the same silent-routing failure this work exists to remove — just with better arithmetic.
2. **Absent `branch_mode` becomes an import validation error**, preceded by a backfill for the three DecisionPoints that have none. All three are on ARCHIVED pathways (`vaginal-discharge-pregnancy-v1`, `routine-prenatal-care-v1`, `anemia-pregnancy-v1`), so no ACTIVE or DRAFT pathway is affected.
3. **`answerGateQuestion` is renamed to `answerPendingDecision(sessionId, nodeId, answer)`** and the old name dropped outright. No users, so no alias. Plan 04 deliberately left the rename here so the call sites move once.
4. **A branch is chosen by node id in `selectedOption`.** `GateAnswerInput` already carries it; no input-type change.
5. **`SELECTS_BRANCH` is consumed for exclusion lineage and display only.** No criterion evaluation, now or in this plan.

## Global Constraints

- **Do not auto-resolve an ambiguous `one_of`.** If a task finds itself ranking branches to break a tie, it has taken decision 1 in the wrong direction.
- **The suite is not green.** 9 pre-existing failures in `data-completeness-scorer.test.ts` and `patient-match-scorer.test.ts`. Do not fix them.
- **`npm run typecheck` is not a gate** (~4000 pre-existing monorepo errors), and ts-jest runs with diagnostics disabled so jest-green does not mean it compiles. Use `npx tsc --noEmit -p apps/pathway-service/tsconfig.json`, which is clean and must stay clean. In the dashboard use `node_modules/.bin/tsc --noEmit -p tsconfig.json` — `npm run lint` is broken repo-wide there (ESLint 9, no `eslint.config.js`), and `npx tsc` resolves to the wrong binary.
- **Never chain `cd` with other commands.** Use `git -C <path>` / `npm --prefix <path>`.
- Conventional commit prefixes. No `@anthropic.com` / `@claude.com` in commits.

---

### Task 1: Enforce `one_of`

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts` (the DecisionPoint arm of `disposeNode`)
- Test: `apps/pathway-service/src/__tests__/branch-mode.test.ts` (create)

**Interfaces:**
- Consumes: `node.properties.branch_mode`, and the `PendingQuestion` shape (`AnswerType.SELECT` with `options`).
- Produces: pending questions whose `gateId` is a **DecisionPoint** id. Task 4's mutation must accept those.

**The rule.**

| qualifying branches | `one_of` behaviour |
|---|---|
| 0 | today's `all_branches_excluded` red flag, unchanged |
| 1 | auto-select it; exclude the rest, as today |
| 2+ | **pend**: emit a decision question listing the candidates, exclude nothing, traverse nothing |

A pended fork must traverse none of its branches. Including them "provisionally" is the multi-arm plan this task exists to prevent.

- [ ] **Step 1: Write the failing tests**

Create `apps/pathway-service/src/__tests__/branch-mode.test.ts`, reusing the harness from `incremental-traversal.test.ts` (same `node` / `edge` / engine helpers). Drive branch qualification by making `computeNodeConfidence` return per-node values:

```typescript
mockConfidenceEngine.computeNodeConfidence.mockImplementation(
  async (n: GraphNode) => ({
    confidence: SCORES[n.nodeIdentifier] ?? 0.9,
    breakdown: [],
    resolutionType: 'AUTO_RESOLVED',
  }),
);
```

Cases, on a `dp-1` with `BRANCHES_TO` to `step-a` / `step-b` / `step-c`:

1. `one_of`, only `step-a` above threshold → `step-a` INCLUDED, `step-b`/`step-c` EXCLUDED, no pending question.
2. **`one_of`, `step-a` and `step-b` both above threshold → a pending question naming both, and NEITHER traversed.** The safety case; assert `step-a` and `step-c` are not INCLUDED.
3. `one_of`, none above threshold → the existing `all_branches_excluded` red flag, unchanged.
4. The pending question carries `answerType: SELECT` and `options` containing both candidate node ids.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest apps/pathway-service/src/__tests__/branch-mode.test.ts`

Expected: case 2 FAILS — both branches are currently INCLUDED and no question is raised. Cases 1 and 3 pass already; they are today's behaviour and must keep working.

- [ ] **Step 3: Implement**

In the DecisionPoint arm, after `includedBranches` is computed:

```typescript
      const branchMode = (node.properties.branch_mode as string | undefined) ?? 'one_of';

      // An exclusive fork with more than one qualifying branch has NOT been
      // decided by the data. Ranking the candidates and taking the top one
      // would be the same silent routing this work exists to remove, with
      // better arithmetic — and on a one_of fork the branches are typically
      // mutually exclusive treatments.
      if (branchMode === 'one_of' && includedBranches.length > 1) {
        resolutionState.set(nodeIdentifier, {
          nodeId: nodeIdentifier,
          nodeType: node.nodeType,
          title: nodeTitle(node),
          status: NodeStatus.PENDING_QUESTION,
          confidence: 0,
          confidenceBreakdown: [],
          excludeReason: `${includedBranches.length} branches qualify on an exclusive decision`,
          parentNodeId,
          depth,
          properties: node.properties,
        });

        // NOTHING is traversed. Marking the candidates PENDING_QUESTION
        // rather than leaving them absent keeps the session's node set
        // complete, which plan 03 made an invariant.
        for (const br of branchResults) {
          const targetNode = graphContext.getNode(br.targetId);
          if (!targetNode || resolutionState.has(br.targetId)) continue;
          const childIds = graphContext.outgoingEdges(br.targetId).map(e => e.targetId);
          markSubtree(childIds, graphContext, resolutionState, NodeStatus.PENDING_QUESTION,
            `Awaiting branch choice at ${nodeTitle(node)}`, br.targetId, depth + 1);
        }

        pendingQuestions.push({
          gateId: nodeIdentifier,
          prompt: `${nodeTitle(node)} — which branch applies?`,
          answerType: AnswerType.SELECT,
          options: includedBranches,
          affectedSubtreeSize: countSubtree(includedBranches, graphContext),
          estimatedImpact: 'high',
        });
        return;
      }
```

Place it before the existing "decision point itself is always included" write.

- [ ] **Step 4: Verify**

```bash
npx jest apps/pathway-service
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
```

**Expect fallout in suites that build a DecisionPoint with a permissive mock confidence engine** — a shared mock returning one value for every node makes every branch qualify, which now pends. Where the suite is about something else, give its DecisionPoint `branch_mode: 'any_of'` rather than weakening this rule, exactly as plan 04 pinned `on_unresolved: 'default'` in suites escalation had confounded.

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src
git commit -m "fix(pathway-service): enforce one_of on DecisionPoints

A one_of fork with several qualifying branches now pends for a provider
instead of including them all. Every DecisionPoint that declares a mode
declares one_of, and none were enforced, so mutually exclusive treatments
could land in a single plan.

Deliberately does NOT auto-pick the highest confidence: on an exclusive
clinical fork, two branches clearing the bar means the data did not
decide it."
```

---

### Task 2: `all_of` and `any_of`

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts`
- Test: `apps/pathway-service/src/__tests__/branch-mode.test.ts` (extend)

**Semantics**, per migration 060's documented meaning (`all_of` = "after assessment, start workup AND prophylaxis"; `any_of` = optional add-ons at the provider's discretion):

- **`all_of`** — every branch is traversed. A branch below threshold is included with a **red flag**, not excluded: the author said these all happen, and silently dropping one contradicts that. The flag says the data does not support a step the pathway mandates.
- **`any_of`** — today's behaviour exactly: every branch at or above `suggestThreshold` is included, the rest excluded. No change beyond making it explicit.

- [ ] **Step 1: Write the failing tests**

1. `all_of` with one branch below threshold → all branches INCLUDED, and a red flag naming the weak one.
2. `any_of` with one branch below threshold → that branch EXCLUDED, others INCLUDED, no pending question. (Passes already — it is today's behaviour, and pinning it stops Task 1's change leaking into it.)
3. `all_of` never pends, however many branches qualify.

- [ ] **Step 2: Run to verify case 1 fails**

- [ ] **Step 3: Implement**

Replace the unconditional `if (conf >= suggestThreshold) includedBranches.push(...)`
with a mode-aware selection, computed after `branchResults` is built:

```typescript
      // all_of takes every branch by declaration. A branch the data does not
      // support is INCLUDED and red-flagged rather than dropped: the author
      // said these all happen, and silently excluding one contradicts the
      // pathway instead of reporting a disagreement with it.
      if (branchMode === 'all_of') {
        includedBranches.length = 0;
        includedBranches.push(...branchResults.map(b => b.targetId));

        const weak = branchResults.filter(
          b => b.confidence < this.thresholds.suggestThreshold,
        );
        if (weak.length > 0) {
          redFlags.push({
            nodeId: nodeIdentifier,
            nodeTitle: nodeTitle(node),
            type: 'all_of_branch_unsupported',
            description:
              `${weak.length} of ${branchResults.length} mandated branches at ` +
              `"${nodeTitle(node)}" are not supported by the patient data`,
            branches: weak.map(b => ({
              nodeId: b.targetId,
              title: b.title,
              confidence: b.confidence,
              topExcludeReason: b.excludeReason,
            })),
          });
        }
      }
```

`any_of` needs no branch — it is the existing threshold behaviour, and case 2
exists to pin that Task 1's change did not leak into it.

- [ ] **Step 4: Verify and commit**

```bash
npx jest apps/pathway-service
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
git add apps/pathway-service/src
git commit -m "feat(pathway-service): implement all_of and any_of branch modes

all_of traverses every branch and red-flags one the data does not
support, rather than dropping it: the author said these all happen, and
silently excluding one contradicts the pathway. any_of keeps today's
threshold behaviour, now explicitly rather than by default."
```

---

### Task 3: Require `branch_mode`, and backfill

**Files:**
- Modify: `apps/pathway-service/src/services/import/validator.ts`
- Create: `shared/data-layer/migrations/066_backfill_remaining_branch_mode.sql`
- Test: `apps/pathway-service/src/__tests__/validator.test.ts` (extend)

**Order matters: backfill BEFORE the validator change**, or the three pathways carrying a NULL become non-importable and — since plan 01 added strict re-validation on activate — non-reactivatable.

- [ ] **Step 1: Confirm the three, and that they are all archived**

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
psql -h localhost -U prism -d prism_db -c "LOAD 'age'; SET search_path=ag_catalog,public;
  SELECT * FROM cypher('clinical_pathways', \$\$
    MATCH (d:DecisionPoint) WHERE d.branch_mode IS NULL
    RETURN d.pathway_logical_id, d.pathway_version, d.node_id \$\$)
  AS (p agtype, v agtype, n agtype);"
psql -h localhost -U prism -d prism_db -c "SELECT logical_id, version, status FROM pathway_graph_index WHERE status IN ('ACTIVE','DRAFT');"
```

Expected: three rows, none belonging to an ACTIVE or DRAFT pathway. **If an ACTIVE or DRAFT pathway appears, stop** — the backfill heuristic is about to change a live pathway's branching semantics and that needs a human.

- [ ] **Step 2: Write the migration**

`066_backfill_remaining_branch_mode.sql`, reusing migration 060's heuristic verbatim — a DecisionPoint with no `HAS_CRITERION` children is not really choosing, so `all_of`; one with criteria is `one_of`. Copy 060's Cypher and its `WHERE branch_mode IS NULL` guard so it stays idempotent.

- [ ] **Step 3: Apply and record**

Per CLAUDE.md's migration workflow (the migrator CLI is broken): run the file, then insert the `migration_history` row with `sha256(trimmed content)`.

- [ ] **Step 4: Verify none remain, and the migration is idempotent**

Re-run the Step 1 query — expect zero rows. Re-run the migration file — expect `SET 0` / no rows updated.

- [ ] **Step 5: Make it a validation error**

In `validator.ts`'s DecisionPoint block, `branch_mode` becomes required, hard even in draft mode: an absent mode is not work-in-progress, it is a fork whose exclusivity is undefined.

- [ ] **Step 6: Verify and commit**

---

### Task 4: `answerPendingDecision`

**Files:**
- Modify: `apps/pathway-service/schema.graphql` (rename the mutation, update the two prose mentions)
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts`
- Modify: `prism-admin-dashboard/src/components/encounter-simulator/PendingGatesPanel.tsx` and `src/components/pathway-preview/PreviewResolutionPanel.tsx`
- Test: `apps/pathway-service/src/__tests__/answer-pending-decision.test.ts` (create)

**Why rename.** The mutation now answers three different things: a question gate, an escalated datum request (plan 04), and a branch choice at a DecisionPoint. `gateId` is wrong for the third, and `answerGateQuestion` is wrong for all but the first.

`answerPendingDecision(sessionId: ID!, nodeId: ID!, answer: GateAnswerInput!): ResolutionSession!`

**`PendingQuestion.gateId` keeps its name**, deliberately. It is an internal
field, it is persisted on every stored session, and renaming it means a data
migration for a cosmetic gain. Note the mismatch in its doc comment instead:
the field holds the id of whatever node raised the question — a Gate, or a
DecisionPoint. Renaming the argument matters because it is the public API;
renaming the stored field does not.

- [ ] **Step 1: Write the failing tests**

1. Answering a DecisionPoint's pending question with `selectedOption: 'step-b'` includes `step-b` and EXCLUDES the other candidates.
2. The excluded siblings carry a reason naming the chosen branch, not a confidence score.
3. `selectedOption` naming a node that is not a candidate is rejected.
4. Existing question-gate and escalated-datum answers still work through the new name.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Rename, change `gateId` → `nodeId` throughout, and add a DecisionPoint branch: validate the choice is among the pending options, mark the chosen branch for traversal and the rest EXCLUDED, then `resolveIncrementally` seeded from the DecisionPoint.

- [ ] **Step 4: Update the dashboard call sites** — both files, and the `$gateId` variable name in each GraphQL document.

- [ ] **Step 5: Verify and commit**

```bash
npx jest apps/pathway-service
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
node_modules/.bin/tsc --noEmit -p tsconfig.json   # in prism-admin-dashboard
grep -rn "answerGateQuestion" apps/pathway-service/src prism-admin-dashboard/src   # expect nothing
```

---

### Task 5: `SELECTS_BRANCH` exclusion lineage

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts` (DecisionPoint arm)
- Test: `apps/pathway-service/src/__tests__/branch-mode.test.ts` (extend)

**What it does.** When a branch is excluded at a DecisionPoint, look for a Criterion with a `SELECTS_BRANCH` edge to that branch. If there is one, the exclusion reason names the criterion's `description` instead of citing a confidence number.

No criterion evaluation. The mapping only supplies wording for a decision already made.

- [ ] **Step 1: Write the failing tests**

1. A branch excluded at a DecisionPoint, with a Criterion `SELECTS_BRANCH`-ing to it, carries an `excludeReason` containing the criterion's description.
2. A branch with no such criterion keeps today's confidence-based reason. **Empty is the normal case** — there are zero such edges in the graph.
3. Two criteria mapping to one branch: the reason names both, rather than picking one arbitrarily.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Build the mapping once per DecisionPoint, before the branch loop:

```typescript
      // branch target id -> the criteria an author mapped onto it.
      // Empty for every pathway today; this is a capability, not a migration.
      const criteriaByBranch = new Map<string, string[]>();
      for (const critEdge of graphContext.outgoingEdges(nodeIdentifier)) {
        if (critEdge.edgeType !== 'HAS_CRITERION') continue;
        const crit = graphContext.getNode(critEdge.targetId);
        if (!crit) continue;
        const description = crit.properties.description as string | undefined;
        if (!description) continue;
        for (const sel of graphContext.outgoingEdges(critEdge.targetId)) {
          if (sel.edgeType !== 'SELECTS_BRANCH') continue;
          const list = criteriaByBranch.get(sel.targetId) ?? [];
          list.push(description);
          criteriaByBranch.set(sel.targetId, list);
        }
      }
```

Then, where an excluded branch's `excludeReason` is written:

```typescript
              // The author's own words beat a confidence number. Both criteria
              // are named when two map to one branch — picking one would be
              // arbitrary, and the reader needs to know what else did not apply.
              const mapped = criteriaByBranch.get(br.targetId);
              const reason = mapped?.length
                ? `Criterion did not apply: ${mapped.join('; ')}`
                : br.excludeReason;
```

- [ ] **Step 4: Verify and commit**

```bash
git add apps/pathway-service/src
git commit -m "feat(pathway-service): explain branch exclusions in the author's words

A branch excluded at a DecisionPoint now names the criterion that did not
apply, where the author drew a SELECTS_BRANCH edge, instead of citing a
confidence score. The editor has always let authors draw these edges; the
engine discarded them.

No criterion evaluation: which branch is taken still comes from
confidence or a provider's answer. The mapping only supplies wording for
a decision already made."
```

---

### Task 6: Surface it in the dashboard

**Files:**
- Modify: `prism-admin-dashboard/src/components/encounter-simulator/PendingGatesPanel.tsx`
- Modify: `prism-admin-dashboard/src/components/editor/` — DecisionPoint property editor, for `branch_mode`
- Modify: `prism-admin-dashboard/src/lib/pathway-json/validator.ts` (mirror the required-`branch_mode` check)

- [ ] **Step 1: Render a branch choice** — a pending DecisionPoint arrives as `answerType: SELECT` with node ids in `options`. Show branch **titles**, not ids; a clinician cannot pick between `step-2-1` and `step-2-3`. Resolve the titles from the loaded graph.
- [ ] **Step 2: Author `branch_mode`** on DecisionPoint, required, with the three modes described in clinical terms rather than by name — "one of these branches", "all of these branches", "any that apply".
- [ ] **Step 3: Mirror the required-`branch_mode` validation** client-side.
- [ ] **Step 4: Verify** — `node_modules/.bin/tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit**

---

## Verification

- [ ] `npx jest apps/pathway-service` — failures confined to the two known scorer suites.
- [ ] `npx tsc --noEmit -p apps/pathway-service/tsconfig.json` — clean; dashboard `tsc` clean.
- [ ] `npm run build --prefix apps/pathway-service` — succeeds.
- [ ] No `branch_mode IS NULL` DecisionPoints remain; migration 066 is idempotent.
- [ ] `grep -rn "answerGateQuestion"` returns nothing in either repo's `src`.
- [ ] Live: a resolution against `anemia-in-pregnancy-v1` v1.4 where `dp-1`'s two branches both qualify surfaces a branch choice rather than including both.

## Expect fewer auto-resolutions

`one_of` forks that used to include several branches now stop and ask. That is the point — the plan they produced was not one a clinician would have written — but it will read as the engine having got worse at deciding. It has got better at noticing it cannot.

## What this plan deliberately does not do

- Evaluate criteria. They stay prose; `SELECTS_BRANCH` is consumed as a mapping only.
- Question per-branch routing (W4).
- Authoring UI for drawing `SELECTS_BRANCH` edges — that already exists.
