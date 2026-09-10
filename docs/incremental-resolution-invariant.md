# Where an incremental resolve may re-enter

An incremental resolve re-examines part of a session instead of rebuilding it.
Five review rounds found seven defects in *which* part, each reported and fixed
separately. They were all the same rule, stated nowhere.

## The invariant

> **A node's status is written either by disposing that node, or by an ancestor
> that DECIDED it. An incremental pass must re-enter at the decider of every
> seed.**

Disposing a node whose status was somebody else's decision makes that decision
up again from nothing. That is the whole defect family: a treatment beneath a
closed gate came back, a rejected branch reopened alongside the chosen one, a
mandated branch lost its mandate.

## Who decides

Derived, not assumed. Every write of a node **other than the one being
disposed** in `traversal-engine.ts`:

| Writer | Decides | Decided by |
|---|---|---|
| `markBranchNotSelected` | a branch target the answer did not select | a routing **Gate** |
| `markSubtree` | a whole subtree | the **Gate** that closed or pended it, or the **DecisionPoint** that excluded the branch |
| DecisionPoint branch arms | each branch target | a **DecisionPoint** |
| timeout materialisation | whatever the walk did not reach | the **pass itself** — no ancestor to re-enter at |

So the deciders are exactly **Gate** and **DecisionPoint**, ruling on their
`BRANCHES_TO` targets and those targets' subtrees. Nothing else writes a
foreign node.

Two things decide a node's status *itself*, and need no promotion:

- **Confidence scoring** — an action node's own score.
- **A provider override** — a decision about that node, and never about its
  descendants. (Hence `overrideHeld`: the node keeps its status while the sweep
  continues beneath it.)

## The rule this implies

`promote()` in `resolveIncrementally`:

1. **Climb past a node that is closed** (`GATED_OUT`, `EXCLUDED`,
   `PENDING_QUESTION`) — it was closed from above, so its status is not its own
   to restate. **Unless it is a decider:** a gate that shut because its
   condition failed, or pended because nobody answered, decided that itself.
2. **Then re-enter at the nearest ancestor Gate or DecisionPoint.** One level
   only — re-disposing a decider re-decides everything below it, so climbing
   further widens the region without changing an outcome.

Seeds are then normalised against each other (a seed another seed can reach is
redundant) and the region is expanded through `dependencyMap.influences`, since
a `prior_node_result` gate that READS a node is a sibling, not a descendant, and
so must become a seed in its own right.

## What the rule replaced

Four accumulated special cases, each added after its own bug report:

| Reported as | Was really |
|---|---|
| a treatment under a shut gate re-opened | no re-entry at a closed ancestor |
| a rejected branch came back alongside the chosen one | no re-entry at an **open** gate that had rejected it |
| an overridden branch's medication vanished | a held node stopping the sweep below it |
| `all_of` kept a weak Step but dropped a weak Medication | the mandate lost when the pass re-entered below the fork |

And a fifth the rule found before anyone reported it: **a mandated branch target
seeded alone lost its mandate**, because `mandated` is filled by the fork and
the pass never re-entered there. That case is
`incremental-region.test.ts` → *"keeps the mandate when only the target is
re-resolved"*.

## The check to run against a change

When anything in `disposeNode` learns to write a node other than the one it is
disposing, ask:

1. **Who is the decider?** If it is not a Gate or DecisionPoint, the table above
   is out of date and `isDecider` must change with it.
2. **Can that decision be reproduced by disposing the decider alone?** If it
   needs per-walk state — as `mandated` does — then re-entering below the
   decider loses it, and the promotion rule is what protects it.
3. **Does the sweep still reach the subtree?** A node preserved for any reason
   (override, provisional) must not stop the descent past it.

The parity test in `engine-parity.test.ts` is the backstop: an incremental
result must equal a full traversal from the same facts. Every defect in this
family violated that, and none of them was caught by it, because each test
seeded exactly the node the fix was about. Prefer a seed that is *not* the node
under suspicion.
