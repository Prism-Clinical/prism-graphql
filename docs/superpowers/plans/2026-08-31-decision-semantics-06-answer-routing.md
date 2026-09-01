# Decision Semantics 06 — Route on the Answer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gate with several branch targets takes the one the answer selects, instead of taking all of them.

**Architecture:** The routing table already exists — it is the gate's `BRANCHES_TO` edges. What is missing is the mapping from an answer to *which* of them. This plan adds a `when` property on that edge and makes traversal read it, so the mapping lives on the edge it governs. Deliberately the same shape as `SELECTS_BRANCH` in plan 05: routing is expressed as a graph edge, not as a lookup table on a node.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2, Jest + ts-jest, PostgreSQL 15 with Apache AGE; `prism-admin-dashboard` (Next.js 16).

**Spec:** `docs/superpowers/specs/2026-08-30-decision-semantics-design.md` (W4)

**Depends on:** nothing. Independent of the v1 flip and of plans 03–05, though it is the same defect class as plan 05's `one_of` and should not ship long after it.

## The live case

`gate-etiology` on `vaginal-discharge-pregnancy-v1`:

```
answer_type: select
options: [Bacterial vaginosis, Vulvovaginal candidiasis, Trichomoniasis,
          Cervicitis / GC-CT, Physiologic leukorrhea]

BRANCHES_TO → step-3-1  Treat bacterial vaginosis (pregnancy-safe oral metronidazole)
              step-3-2  Treat vulvovaginal candidiasis (topical azole, 7-day course)
              step-3-3  Treat trichomoniasis (metronidazole; test/treat partners)
              step-3-4  Cervicitis / GC-CT positive: treat and hand off
              step-3-5  Physiologic leukorrhea: reassurance; no antimicrobial
```

Five options, five treatments, in the same order. The author's intent is unmistakable. **Today, answering with any one option opens all five branches** — `evaluateQuestion` returns `satisfied: true` for any selected option, and traversal then walks every outgoing edge.

The result is a care plan containing metronidazole *and* a topical azole *and* metronidazole again *and* STI hand-off *and* "reassurance, no antimicrobial". It is plan 05's multi-arm defect on a gate rather than a DecisionPoint, and worse, because a SELECT with enumerated options states the mapping intent explicitly.

## Correcting the spec's premise

W4 says to "reuse the LLM gate's existing `branches: [{name, target}]` vocabulary… proven in code". **That shape does not exist and does not route.** Verified:

- `LlmGateBranchSpec` is `{ name, description, is_safe_default }` — **no target**. It is a vocabulary for the model to choose from, not a routing table.
- `chosenBranch` has exactly one consumer in traversal: populating `tentativeBranch` on a pending question. **It never routes.** An LLM gate that is satisfied traverses every outgoing edge, like any other gate.
- There are **zero `llm_text_analysis` gates in the graph**, so the shape has never run against real data.

This is the second time in this workstream that "reuse the existing proven shape" turned out hollow — `SELECTS_BRANCH` was the first. The pattern is worth naming: a construct that is *authored and validated* is not thereby *consumed*, and in this codebase the gap between the two has been the defect, repeatedly.

So the mapping goes where routing already happens: on the `BRANCHES_TO` edge.

## Decisions taken

1. **The mapping is an edge property, `when`.** It lives on the edge it governs, survives node edits, and matches how `SELECTS_BRANCH` expresses routing. A gate property holding `{option: targetId}` would duplicate the edge set and let the two disagree.
2. **Required only when a gate has more than one branch target.** A single-target gate routes trivially — satisfied, traverse it — and every gate on the ACTIVE anaemia pathway is single-target. This adds no authoring burden to them.
3. **The mapping must be TOTAL.** Every possible answer maps to exactly one target, checked at import. An answer falling through to no branch is the presence-only bug in a new costume; an answer matching two is the multi-arm bug.
4. **One routing mechanism for every gate type.** The answer source differs — a provider's selection, an LLM's chosen branch, a boolean — but they all supply a value matched against `when`. This is the part of the "one decision construct" proposal that is genuinely earned: unify *how a branch is chosen*, not *what a gate is*.
5. **`gate-etiology` is not backfilled by migration.** Its pathway is ARCHIVED, and the option→step mapping is a clinical assertion, not a mechanical one. It is authored by hand, by someone who can confirm that "Trichomoniasis" means `step-3-3`.

## Global Constraints

- **Never infer the mapping from array order.** `gate-etiology`'s options and branches happen to align, and relying on that would silently mis-route the first pathway where they do not.
- **A gate with several branches and no mapping is an import error, not a default.** Falling back to "traverse all" would preserve exactly the defect this plan removes.
- **The suite is not green.** 9 pre-existing failures in `data-completeness-scorer.test.ts` and `patient-match-scorer.test.ts`. Do not fix them.
- **`npm run typecheck` is not a gate** (~4000 pre-existing monorepo errors), and ts-jest runs with diagnostics disabled so jest-green does not mean it compiles. Use `npx tsc --noEmit -p apps/pathway-service/tsconfig.json`. In the dashboard use `node_modules/.bin/tsc --noEmit -p tsconfig.json` — `npx tsc` there resolves to the wrong binary and `npm run lint` is broken repo-wide (ESLint 9, no `eslint.config.js`).
- **Never chain `cd` with other commands.** Use `git -C <path>` / `npm --prefix <path>`.
- Conventional commit prefixes. No `@anthropic.com` / `@claude.com` in commits.

---

### Task 1: The `when` edge property, and totality

**Files:**
- Modify: `apps/pathway-service/src/services/import/types.ts` (a `BranchWhen` type)
- Modify: `apps/pathway-service/src/services/import/validator.ts`
- Test: `apps/pathway-service/src/__tests__/branch-routing-validation.test.ts` (create)

**Interfaces:**
- Produces:

```typescript
/** Which answers select this branch. Shape follows the gate's answer_type. */
export type BranchWhen =
  | { equals: string | boolean }                 // SELECT option, or BOOLEAN
  | { gte?: number; lt?: number };               // NUMERIC, half-open [gte, lt)

export function parseBranchWhen(raw: unknown): BranchWhen | null;
```

Half-open ranges are what make NUMERIC totality checkable: `[-∞, 7)`, `[7, 11)`, `[11, ∞)` tile the line with no gap and no overlap, and no value sits in two.

**Validation rules**, all hard errors even in draft — a mis-routed branch is not work-in-progress:

| Gate shape | Rule |
|---|---|
| 1 branch target | `when` optional; ignored if present |
| >1 targets, any missing `when` | error |
| `answer_type: select` | every entry in `options` matches exactly one branch, and every branch's `equals` is in `options` |
| `answer_type: boolean` | exactly two branches, one `equals: true`, one `equals: false` |
| `answer_type: numeric` | ranges tile `(-∞, ∞)`: sorted by `gte`, no gap, no overlap, first has no `gte`, last has no `lt` |

- [ ] **Step 1: Write the failing tests**

Create `apps/pathway-service/src/__tests__/branch-routing-validation.test.ts`. Cases, each on a gate with two or more `BRANCHES_TO` edges:

1. SELECT with every option mapped → valid.
2. SELECT with an option no branch claims → error naming the option. *(The fall-through case.)*
3. SELECT with two branches claiming one option → error naming the option. *(The multi-arm case.)*
4. SELECT with a branch claiming an option not in `options` → error.
5. BOOLEAN with `true` and `false` branches → valid; with only `true` → error.
6. NUMERIC with `[-∞,7) [7,11) [11,∞)` → valid.
7. NUMERIC with `[-∞,7) [11,∞)` → error naming the gap.
8. NUMERIC with `[-∞,11) [7,∞)` → error naming the overlap.
9. A single-target gate with no `when` → valid. *(No new burden on the anaemia pathway.)*
10. A multi-target gate with no `when` anywhere → error.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest apps/pathway-service/src/__tests__/branch-routing-validation.test.ts`

Expected: all the error cases FAIL (nothing validates `when` yet); the valid cases pass vacuously.

- [ ] **Step 3: Implement**

`parseBranchWhen` in `import/types.ts`; the rules in `validator.ts`'s Gate block, reading each gate's outgoing `BRANCHES_TO` edges from the JSON's `edges` array.

- [ ] **Step 4: Verify and commit**

```bash
npx jest apps/pathway-service
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
git add apps/pathway-service/src
git commit -m "feat(pathway-service): validate answer->branch routing on BRANCHES_TO

A gate with several branch targets must map every possible answer to
exactly one of them. An answer matching none is the presence-only bug in
a new costume; an answer matching two is the multi-arm bug.

The mapping is an edge property because that is where routing already
lives — the same shape SELECTS_BRANCH uses. A gate property holding
{option: targetId} would duplicate the edge set and let the two disagree.

Single-target gates need nothing, so the ACTIVE anaemia pathway is
unaffected."
```

---

### Task 2: Route on the answer

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts` (the Gate arm's satisfied path)
- Test: `apps/pathway-service/src/__tests__/branch-routing.test.ts` (create)

**Interfaces:**
- Consumes: `parseBranchWhen`, and the `GateAnswer` already in `gateAnswers`.
- Produces: no new export.

**The change.** Where a satisfied gate today enqueues every outgoing edge, it enqueues only the ones whose `when` matches the answer. Non-`BRANCHES_TO` edges (`HAS_CODE`, `CITES_EVIDENCE`, structural children) are unaffected — they are not routing.

Branches not selected are marked `EXCLUDED` with a reason naming the answer, so the trail says *why* the other four treatments are absent rather than leaving them unexplained.

- [ ] **Step 1: Write the failing tests**

Model the live case: a SELECT gate with five options and five branches.

1. Answering "Trichomoniasis" includes only its branch; the other four are EXCLUDED. **This is the safety case** — assert the other four are not INCLUDED, individually.
2. The excluded branches' reason names the answer that selected elsewhere.
3. A single-target gate with no `when` still traverses its one branch when satisfied. *(Regression guard for every gate on the anaemia pathway.)*
4. A BOOLEAN gate routes true and false to different branches.
5. A NUMERIC gate routes by range: 6 → the `[-∞,7)` branch, 9 → `[7,11)`, 13 → `[11,∞)`.
6. Non-`BRANCHES_TO` children are traversed regardless of routing.

- [ ] **Step 2: Run to verify they fail**

Expected: cases 1, 2, 4 and 5 FAIL — all branches are currently traversed. Cases 3 and 6 pass already and must keep passing.

- [ ] **Step 3: Implement**

In the satisfied path, replace the unconditional enqueue:

```typescript
          const answer = gateAnswers.get(nodeIdentifier);
          const outgoing = graphContext.outgoingEdges(nodeIdentifier);
          const branchEdges = outgoing.filter(e => e.edgeType === 'BRANCHES_TO');

          // Only a multi-target gate routes. One target means traversing it IS
          // the routing, and demanding a mapping there would break every
          // single-branch gate in every existing pathway.
          const routes = branchEdges.length > 1;

          for (const edge of outgoing) {
            if (routes && edge.edgeType === 'BRANCHES_TO') {
              const when = parseBranchWhen(edge.properties?.when);
              if (!when || !answerSelects(when, answer)) {
                // Say WHY the other treatments are absent. An unexplained
                // missing branch reads as an oversight.
                if (!resolutionState.has(edge.targetId)) {
                  const t = graphContext.getNode(edge.targetId);
                  if (t) {
                    resolutionState.set(edge.targetId, {
                      nodeId: edge.targetId,
                      nodeType: t.nodeType,
                      title: nodeTitle(t),
                      status: NodeStatus.EXCLUDED,
                      confidence: 0,
                      confidenceBreakdown: [],
                      excludeReason: `Not selected by the answer at ${nodeTitle(node)}`,
                      parentNodeId: nodeIdentifier,
                      depth: depth + 1,
                      properties: t.properties,
                    });
                    const kids = graphContext.outgoingEdges(edge.targetId).map(e2 => e2.targetId);
                    markSubtree(kids, graphContext, resolutionState, NodeStatus.EXCLUDED,
                      `Excluded with ${nodeTitle(t)}`, edge.targetId, depth + 1);
                  }
                }
                continue;
              }
            }
            if (!resolutionState.has(edge.targetId)) {
              queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
            }
          }
```

`answerSelects(when, answer)` compares by shape: `equals` against `selectedOption` or `booleanValue`; a range against `numericValue`, half-open.

- [ ] **Step 4: Verify**

```bash
npx jest apps/pathway-service
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src
git commit -m "fix(pathway-service): take the branch the answer selects

A gate with several branch targets took ALL of them once satisfied. On
vaginal-discharge-pregnancy-v1, gate-etiology has five options and five
treatments; answering any one of them produced a plan with metronidazole
AND a topical azole AND metronidazole again AND STI hand-off AND
'reassurance, no antimicrobial'.

Unselected branches are EXCLUDED with a reason naming the answer, so the
trail says why the other treatments are absent rather than leaving them
unexplained.

Single-target gates are untouched: traversing the one branch IS the
routing, and every gate on the ACTIVE anaemia pathway is single-target."
```

---

### Task 3: One routing mechanism, including LLM gates

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts`
- Test: `apps/pathway-service/src/__tests__/branch-routing.test.ts` (extend)

**The finding this closes.** An LLM gate's `chosenBranch` is computed, persisted to the audit table, shown to the provider — and never used to route. `LlmGateBranchSpec` carries no target, so there was nothing to route *to*. With `when` on the edge there now is: a branch declares `when: { equals: '<branch name>' }` and the LLM's choice selects it exactly as a provider's selection does.

This is decision 4, and it is the defensible core of the "one decision construct" argument: the *source* of an answer varies — provider, model, chart — while *how a branch is chosen* should not.

- [ ] **Step 1: Write the failing tests**

1. An LLM gate whose evaluator returns `chosenBranch: 'bacterial'` traverses only the branch with `when: { equals: 'bacterial' }`.
2. A **tentative** LLM result (below confidence threshold) routes the safe-default branch AND still raises its pending question — the existing behaviour must survive.
3. Confirming a tentative gate with a different branch re-routes to that branch.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement** — extend the answer value `answerSelects` matches against to include `gateResult.chosenBranch` for LLM gates.

- [ ] **Step 4: Verify and commit**

---

### Task 4: Author the mapping

**Files:**
- Modify: `prism-admin-dashboard/src/components/graph/` — the `BRANCHES_TO` edge editor
- Modify: `prism-admin-dashboard/src/lib/pathway-json/validator.ts` (mirror totality)

**Read before editing.** `PathwayCanvas` already renders `BRANCHES_TO` edges and `nodeChips` shows branch chips; find where an edge's properties are edited before adding a surface. If `BRANCHES_TO` has no property editor today, that is the gap to fill.

- [ ] **Step 1: Edit `when` on a branch edge**, with the control shaped by the source gate's `answer_type` — a dropdown of the gate's `options` for SELECT, true/false for BOOLEAN, two range bounds for NUMERIC.
- [ ] **Step 2: Show totality inline** — which options are unmapped, which are claimed twice, where a numeric gap or overlap is. This is the check most likely to be got wrong by hand, and finding out at publish time is much worse than seeing it while wiring.
- [ ] **Step 3: Mirror the totality validation** client-side.
- [ ] **Step 4: Verify** — `node_modules/.bin/tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit**

---

### Task 5: Author `gate-etiology`'s mapping — NOT DONE, and deliberately

**Status (2026-08-31): blocked on clinical sign-off, by design.**

Tasks 1–4 are implemented. This one is not, for the reason the task itself
gives: the option→step mapping is a clinical assertion. The five options and
five steps happen to be in matching order, and encoding that assumption is
exactly the inference this plan's global constraints forbid. Applying it needs
a clinician to confirm that "Trichomoniasis" means `step-3-3`, and it should be
applied through the editor (Task 4's surface), not by direct Cypher.

**Consequence, measured after Task 1 landed:** `gate-etiology` is the ONLY
multi-branch gate in the entire graph, and it now fails import validation for
having no mapping. Its pathway is ARCHIVED, so nothing resolves against it
today, but it is now non-importable and non-reactivatable until the mapping is
authored. That is the correct outcome — the pathway is genuinely mis-authored,
and answering it opens five treatments — but it should be a known state rather
than a surprise. No ACTIVE or DRAFT pathway is affected: every other gate in
the graph is single-target.

---

### Task 5 (original): Author `gate-etiology`'s mapping

**Not a migration.** The option→step mapping is a clinical assertion. The order happens to align, and encoding that assumption in SQL is exactly the inference the global constraints forbid.

- [ ] **Step 1: Propose the mapping** from the option list and step titles, and **have a clinician confirm it** before applying:

| option | branch |
|---|---|
| Bacterial vaginosis | `step-3-1` Treat bacterial vaginosis |
| Vulvovaginal candidiasis | `step-3-2` Treat vulvovaginal candidiasis |
| Trichomoniasis | `step-3-3` Treat trichomoniasis |
| Cervicitis / GC-CT | `step-3-4` Cervicitis / GC-CT positive |
| Physiologic leukorrhea | `step-3-5` Physiologic leukorrhea |

- [ ] **Step 2: Apply it through the editor**, not by direct Cypher — that exercises Task 4's surface and Task 1's validation on the first real user.
- [ ] **Step 3: Verify** a resolution answering "Trichomoniasis" yields only `step-3-3`.

**The pathway is ARCHIVED.** Plan 01 made activation re-validate strictly, so check whether it can be reactivated at all before assuming this is publishable — it also carries the mis-modelled `prior_node_result` diagnosis gates flagged during the `depends_on` work.

---

## Verification

- [ ] `npx jest apps/pathway-service` — failures confined to the two known scorer suites.
- [ ] `npx tsc --noEmit -p apps/pathway-service/tsconfig.json` clean; dashboard `tsc` clean.
- [ ] `npm run build --prefix apps/pathway-service` succeeds.
- [ ] The ACTIVE anaemia pathway resolves unchanged — every one of its gates is single-target, so this plan must be invisible to it.
- [ ] A SELECT gate with five branches, answered once, yields one branch and four EXCLUDED with a reason.

## What this plan deliberately does not do

- Give `LlmGateBranchSpec` a `target`. The edge carries routing; the spec stays a vocabulary of names.
- Change `evaluateQuestion`'s satisfied/unsatisfied semantics. A question gate still opens on any answer; what changes is *which branch* opening leads to.
- Touch single-target gates.
