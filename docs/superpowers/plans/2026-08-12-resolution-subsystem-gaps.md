# Resolution-subsystem gaps — pre-existing defects, queued not fixed

**Status:** findings register. Not a task plan. Each entry is enough to pick up
cold; deciding whether they are one plan or three is the first job of whoever
takes them.

**Found by:** round-14 external review of plan 04
(`2026-07-26-temporal-horizon-04-evaluator-kernel.md`), recorded there as
**R14-5**, **R14-6**, **R14-7**.

**Why they are here and not fixed:** all three are **pre-existing defects in the
resolution subsystem that plan 04 never touched**. Plan 04's diff (`main..HEAD`
on `feat/temporal-horizon-evaluator-kernel`) touches several of the same *files*,
but only to thread the temporal deps — new constructor parameters, a `gateDeps()`
helper, and collapsing `evaluateGate`'s positional arguments into the D6 options
object. **Every decisive line quoted below is byte-identical on `main`**, and
each entry says so explicitly. Fixing them inside plan 04 would have made a
branch whose headline evidence is "`legacy-v0` is preserved byte-for-byte" carry
unrelated behaviour changes.

**Every finding below was verified against the code, not accepted from the
review.** Two were subtly wrong as filed; the corrections are recorded in place,
and verification turned up three further defects nobody had reported (§1's
`gateOpened` blast radius, §2's `overrideNode` pending-question loss, §3's
preview-cleanup hole).

**Related:** `2026-08-12-gate-subtree-retraversal.md` (*Retraversal fidelity*)
carries the other two round-14 findings, which are one family with the
stale-subtree defect it already described. §1 below is entangled with that plan's
defect 3 — see the cross-reference.

**Severity order.** §1 is first because it is the only one that is a **live
clinical-workflow bug with no workaround**, on the default deployment, today.
§4 is not from the review at all — it was found while fixing R14-1, which
reported only half of it.

---

## 1. Retraversal red flags are never reconciled — **HIGHEST SEVERITY**

*(R14-6. Verified. Live on the current deployment: it needs no `v1`, no flag, no
unusual pathway.)*

Red flags accumulate on a session and are never removed, never deduplicated, and
in one mutation never recorded at all. **Care-plan generation blocks on every
unacknowledged stored flag, and no acknowledgment mutation exists anywhere in the
schema.** So a red flag that was true for one instant — and is not true now —
blocks care-plan generation for that session **permanently**, and there is
nothing the provider or an operator can do through the API to clear it.

That last clause is what makes this the top item. The other findings in this file
produce wrong or incomplete data; this one produces a dead end in a clinical
workflow.

### Evidence

**Append-only, with no reconciliation and no dedup.** Both retraversal paths in
`resolvers/mutations/resolution.ts`:

```ts
// :578-579  answerGateQuestion
if (reResult.newRedFlags.length > 0) {
  session.redFlags = [...session.redFlags, ...reResult.newRedFlags];
}
// :808-809  addPatientContext — identical
```

- `RetraversalEngine` re-derives flags from scratch each pass
  (`retraversal-engine.ts:150`, pushed at `:287-292`) and emits on *current*
  state (`all branches EXCLUDED`, `:275-286`). So a `DecisionPoint` that is still
  excluded re-emits an **identical** flag on every retraversal, and each is
  appended again. There is no key on `nodeId` and no dedup.
- Nothing anywhere filters `session.redFlags`. A flag whose condition has since
  resolved stays.
- **The line immediately above the append reconciles pending questions
  properly** — `resolution.ts:576-577` does
  `.filter(q => q.gateId !== args.gateId).concat(...)`. The red-flag line beside
  it does not. That adjacency is the strongest evidence this is an omission
  rather than a decision.
- The persistence layer is a whole-array replace (`session-store.ts:251-254`,
  `red_flags = $n ← JSON.stringify(updates.redFlags)`), so removal is already
  trivially expressible. Nothing ever calls it with a shrunken array.
- In `answerGateQuestion` the append is inside the `gateOpened` branch only; the
  gate-CLOSING branch (`:581-604`) runs no retraversal at all, so flags
  invalidated by closing a gate are never revisited either.

**`overrideNode` discards them completely.** `resolution.ts:308-437`: the
retraversal runs at `:390-397`, only `reResult.statusChanges` is consumed
(`:401`), and the `updateSession` call at `:405-408` writes `resolutionState` and
`totalNodesEvaluated` and nothing else. **It also drops `newPendingQuestions`** —
a second loss the finding did not mention. A provider override can therefore
raise a red flag, or open a question, that the session never records.

**Generation blocks on every stored flag, forever.**
`services/resolution/care-plan-generator.ts:125-129`:

```ts
// 2. Unresolved red flags (only block on unacknowledged ones)
for (const flag of redFlags) {
  if (!flag.acknowledged) {
    blockers.push({ type: BlockerType.UNRESOLVED_RED_FLAG, … });
```

Called from `resolution.ts:868`; `blockers.length > 0` returns
`success: false` at `:869-880`.

**No acknowledgment path exists, in either direction.** `acknowledged?: boolean`
is optional (`types.ts:303`) and **nothing ever writes it**, so
`!flag.acknowledged` is always true. A repo-wide grep for
`acknowledg|Acknowledg|ACKNOWLEDG` across `*.graphql`, `*.ts` and `*.sql`
(node_modules excluded) returns exactly three hits — the comment, the read, and
the field declaration — and **zero hits in any of the 16 `schema.graphql`
files**. The field is not even *readable*: `type RedFlagType`
(`schema.graphql:1020-1026`) exposes only `nodeId/nodeTitle/type/description/branches`,
and both projecting resolvers (`resolvers/Query.ts:124-136` and `:729-747`) strip
it. A client cannot see the state, cannot set it, and generation stays blocked.

**Scope:** single-pathway sessions only. Multi-pathway `validateForGeneration`
(`multi-pathway-resolution.ts:1030-1053`) checks conflicts and emptiness and
never looks at red flags; `redFlags` appears there once, at `:864`, as a
passthrough.

### Why it is pre-existing

Grepping plan 04's diff of `resolvers/mutations/resolution.ts` for
`redFlags` / `newRedFlags` returns **zero hits** — both append sites and
`overrideNode`'s discard are outside every changed hunk.
`care-plan-generator.ts`, `session-store.ts` and `schema.graphql` are **not in
the diff at all**. `retraversal-engine.ts` changed, but only its `evaluateGate`
call signature; the `newRedFlags` emission is untouched.

### Fix direction

**Recompute and reconcile by node ID on every mutation**, rather than appending.
`RetraversalEngine` already re-derives the full flag set for the nodes it
touched, so the reconciliation is a keyed replace over that scope: flags for
recomputed nodes are replaced, flags for untouched nodes are kept, and a flag
whose node no longer qualifies is dropped. `overrideNode` must consume
`newRedFlags` **and** `newPendingQuestions` and persist both.

Two things to decide deliberately, not to guess:

1. **Is `acknowledged` still wanted at all?** If flags reconcile correctly, the
   permanent-blocker problem largely disappears and acknowledgment becomes a
   clinical-override feature rather than an escape hatch. If it IS wanted, it
   needs a schema field, a mutation, and an audit row — it is a clinical
   override, not a UI dismissal.
2. **What happens to sessions that already carry stale or duplicated flags?**
   They exist now. A reconciliation on next retraversal fixes a session that is
   retraversed; a session that is not stays blocked. Decide whether to backfill.

---

## 2. Question-gate answer contracts are unenforced

*(R14-5. Verified; the finding is right on all three counts, with one
characterization corrected and one further defect found.)*

`answer_type` is declared on question gates, displayed in the authoring UI, and
**enforced nowhere**. The importer's check reads the wrong field, the evaluator
ignores the field entirely, and the resolver's own heuristic can reach the
opposite verdict from the evaluator on the same answer.

### Evidence

**The importer checks `gate_type` where it means `answer_type`.**
`services/import/validator.ts:254-259`:

```ts
// select answer_type requires non-empty options array — also soft in
// draft mode (author may still be filling in the options list).
if (props.gate_type === 'select') {
```

The comment says `answer_type`; the code reads `gate_type`. `GateType`
(`src/types/index.ts:164-176`) has no `select` member — it is
`patient_attribute | question | prior_node_result | compound | llm_text_analysis`
— while `SELECT` is an `AnswerType` (`schema.graphql:49`). The branch is
therefore **dead for any well-formed pathway**, and a `question` gate with
`answer_type: SELECT` and zero `options` imports clean. The adjacent
`gate_type === 'compound'` check at `:264` *is* a real gate type, which is what
identifies `:256` as a copy-paste slip rather than an alias.

*Correction to the finding as filed:* it is a **soft** check (`softTarget`,
`validator.ts:240`) — warnings in draft mode, errors otherwise. Even with the
right field it would not reject a draft.

**`evaluateQuestion` ignores `answer_type` and `options`.**
`gate-evaluator.ts:1186-1246`. The body never reads either; `gate` is used only
for the signature. It is a first-match cascade over the three value fields:

```ts
1210:  if (answer.booleanValue !== undefined) { satisfied: answer.booleanValue === true }
1222:  if (answer.numericValue !== undefined && answer.numericValue !== null) { satisfied: true }
1232:  if (answer.selectedOption !== undefined && answer.selectedOption !== null) { satisfied: true }
```

So **any** number opens a BOOLEAN question — including `0`, since the guard is a
null check and not truthiness — and **any** string opens a SELECT, including one
outside `options`. There is no option-membership test anywhere in the service:
`grep -rn "options\.includes"` over non-test `src` returns zero hits. Nothing at
the type level requires it either — `GateProperties.answer_type` and `options`
are both optional (`services/resolution/types.ts:192-193`), and `GateAnswer`
(`types.ts:217-219`) carries all three value fields as independent optionals,
which is what makes a mixed answer representable in the first place.

**The resolver's `gateOpened` heuristic disagrees with the evaluator.**
`resolvers/mutations/resolution.ts:492-497`:

```ts
// For now, any non-null answer value is treated as opening the gate.
// The retraversal will use the proper gate evaluator for final status.
gateOpened = args.answer.booleanValue === true ||
  (args.answer.selectedOption != null) ||
  (args.answer.numericValue != null);
```

An **OR across all three fields** against the evaluator's **first-match cascade
with `booleanValue` first**. `{ booleanValue: false, numericValue: 5 }` gives
`gateOpened === true` — so the resolver sets the gate `INCLUDED` with
`confidence: 1` (`:530-533`), **deletes the `PENDING_QUESTION`/`GATED_OUT`
subtree** (`:536-543`, which is *Retraversal fidelity* defect 2), and runs
retraversal — which calls `evaluateQuestion` and answers `satisfied: false`. The
subtree is re-derived under the opposite verdict from the one just committed for
the gate.

**A further defect found while verifying, not previously reported:** `gateOpened`
is what is persisted — to the audit trail (`:633`) and to `pathway_gate_answers`
(`:645`). **The permanent record stores the heuristic, not the evaluator's
answer.** Nothing validates the input either: `GateAnswerInput`
(`src/__generated__/resolvers-types.ts:348-351`) has all three fields as
`InputMaybe`, and `:486-489` copies all three onto the stored `GateAnswer`
unvalidated.

### Why it is pre-existing

`validator.ts` is in plan 04's diff (+44/−4) but the hunks are the temporal
imports and the condition-field / vitals-system / control-domain checks inside
`validateGateConditions`; `:256` is untouched context. `gate-evaluator.ts`
changed heavily, but `evaluateQuestion`'s body appears in the diff only as
context — the sole change is the call site at `:1665`, `(gate, gateAnswers,
gateId)` → `(gate, deps.gateAnswers, deps.gateId)`. The diff of `resolution.ts`
has zero hits for `gateOpened`.

### Fix direction

**One shared function, called from all three places.** Validate that an answer
supplies **exactly one** value field, that the field matches the gate's
`answer_type`, and — for SELECT — that the value is in `options`. The resolver
must call it instead of re-deriving `gateOpened`, the evaluator must call it
instead of guessing from field presence, and the importer must call it (against
`answer_type`, and requiring `options` for SELECT) so an unanswerable gate cannot
be published. Two validators are two chances to disagree; today there are three
and they already do.

**Cross-reference — do this in ONE pass with *Retraversal fidelity* defect 3.**
That defect records the same root from the other side: initial traversal decides
what a question is by `gate_type === QUESTION` (`traversal-engine.ts:389`) while
retraversal decides it by the presence of `prompt` and `answer_type`
(`retraversal-engine.ts:226`). `answer_type` is load-bearing in one engine and
decorative in another. The shared function above is where both reconcile.

---

## 3. Multi-pathway creation can leave orphan child sessions

*(R14-7. Verified, including the "validation precedes writes" half — which is
true, and is exactly what makes the remaining hole non-obvious.)*

`resolveAndPersistAll` validates the whole pathway set before writing anything,
then persists **each child session and its audit rows inside the loop**, while
the merge and the PARENT session are created afterwards. Any failure after the
first child is committed leaves earlier children `ACTIVE` with nothing
referencing them.

### Evidence

**Validation genuinely is hoisted**, in a non-writing loop
(`resolvers/mutations/multi-pathway-resolution.ts:793-803`), and its comment says
why:

```
// Load every pathway's context and validate the whole set BEFORE any
// traversal. Nothing here writes: a rejection must leave no child sessions
// and no audit rows behind.
```

**The write loop has no enclosing transaction** (`:805-887`): child insert at
`:854`, audit flush at `:870`. `createSession` (`session-store.ts:135`) is a bare
`INSERT … RETURNING id` on `pool.query` — pooled auto-commit. There is no
`BEGIN`/`COMMIT` anywhere in `startMultiPathwayResolution` or
`resolveAndPersistAll`; the only transaction in the whole multi-pathway store is
in `deletePreviewSession` (`multi-pathway-session-store.ts:236`).

**The parent is written last** (`:261-287`): `resolveAndPersistAll` → then
`runMergePipeline` → then `createMultiPathwaySession`. So a throw in iteration N
(traversal, `flushAudits`, prerequisites), or in `runMergePipeline` — which does
async DDI I/O at `:657` and `:688` — or in `createMultiPathwaySession` itself,
leaves iterations 1..N−1 committed as `ACTIVE`/`DEGRADED` rows in
`pathway_resolution_sessions` with no parent. The zero-match early return
(`:242-257`) is the only path that writes the parent first, and it writes no
children.

**Preview traffic is worse than the finding states — a second defect found while
verifying.** `isPreview` (`:212`, `args.syntheticPatient === true`) is passed
**only** to `createMultiPathwaySession` (`:285`). The child `createSession` call
takes no preview flag, and migration
`061_add_is_preview_to_multi_pathway_sessions.sql` adds `is_preview` only to
`multi_pathway_resolution_sessions` — `pathway_resolution_sessions` has no such
column. Orphaned children from a preview run are therefore (a) indistinguishable
at the row level from real provider sessions, and (b) **unreachable by the
cleanup path**: `deletePreviewSession` finds children only through the parent's
`contributing_session_ids` (`multi-pathway-session-store.ts:242, 260-264`), and
on a failed run that parent row was never created. Preview is the highest-volume
traffic and the one whose rows were meant to be disposable.

### Why it is pre-existing

`multi-pathway-resolution.ts` is in plan 04's diff (+40/−3), confined to
threading `resolveTemporalPolicyVersion` and a new `factStore` parameter. The
child-then-parent ordering and the absent transaction are byte-identical on
`main`. `session-store.ts`, `multi-pathway-session-store.ts` and
`shared/data-layer/migrations/` are not in the diff at all.

### Fix direction

Either shape works; pick one deliberately.

- **A pending parent plus compensating cleanup.** Create the parent row first in
  a `PENDING` state, write children against it, and promote it on success. A
  failure leaves a `PENDING` parent that a sweep can find and delete with its
  children — which is also what makes the orphans *reachable*, the property the
  preview path currently lacks.
- **A scoped unit of work.** One client checked out of the pool, `BEGIN` before
  the loop, `COMMIT` after the parent write. Simpler, but it holds a connection
  across every traversal, every audit flush, and the merge's outbound DDI calls
  — measure that before choosing it. Note `createSession` and the audit flush
  take a `Pool`, not a client, so this is a signature change through the store
  layer.

Independently of which: **propagate `isPreview` to child sessions** and add the
column, so preview rows are identifiable and sweepable without the parent.

---

## 4. `allergy.* exists` is satisfied by an ABSENT allergy under `legacy-v0`

*(Not from the external review. Found while fixing its R14-1, which reported only
the kernel half. Verified by test.)*

`resolveAttribute`'s allergy resolver returns `ctx.allergies.some(...)` — a
**boolean, never `undefined`** (`services/resolution/attribute-registry.ts:39-46`)
— and `compareScalar` defines `exists` as `resolved !== undefined`
(`services/resolution/scalar-compare.ts:11-13`). So an `allergy.peanut exists`
gate is satisfied for a patient with **no** peanut allergy: a false positive on
an allergy, the worst direction for that field.

`lab.*` and `vitals.*` are unaffected — both resolvers return `undefined` when
nothing matches (`:31-37`, `:38`).

### Why it is pre-existing, and why it is queued rather than fixed

`attribute-registry.ts` and `scalar-compare.ts` are **unmodified by plan 04's
branch**; this is `main`'s behaviour and the behaviour of the current
deployment, which runs `legacy-v0`. Plan 04 fixed the KERNEL half — its attribute
route derived the same boolean and read it the same way — at the derivation site,
operator-aware, so that `equals false` keeps meaning "does not have this
allergy" (R14-1).

Fixing `resolveAttribute` too was rejected **for that branch, not on the
merits**: it would change `legacy-v0`, whose byte-for-byte preservation is plan
04's headline evidence and its locked decision #2. The consequence is recorded
honestly there — the fix creates a `v1` delta, and the live behaviour is the
unfixed one, because nothing routes to `v1` yet. Pinned in both directions by
`temporal/attribute-condition-kernel.test.ts` → `is a DISCLOSED v1 delta:
legacy-v0 still reports the absent allergy as present`.

### Fix direction

Make the allergy resolver return `undefined` when there is no `codeMap` row *and*
when nothing matches, so `exists` reads absence correctly — then `equals false`
needs its own handling, because `undefined` would make it report "attribute has
no value" instead of `false`. That is the same operator-aware boundary the kernel
half already solves, so the two fixes should be written together and the
`legacy-v0` delta accepted deliberately.

**The pinning test inverts when this lands.** It was written to be flipped, not
rewritten. Treat "the pin still passes unchanged" as evidence the fix did not
take.
