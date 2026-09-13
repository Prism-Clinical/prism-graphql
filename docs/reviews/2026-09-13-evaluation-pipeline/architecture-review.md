# Architectural review: evaluation pipeline design

**Reviewed design:** `docs/evaluation-pipeline-design`, commit `41da369c519688b6383ba1b02ef22e8578a6eed3`.

**Recommendation: proceed with the proposed architecture, after clarifying four foundational boundaries.** The changes below refine the design rather than replace it. They should be settled before implementation distributes their assumptions across traversal, composition, persistence, and API code.

This review assesses whether the design establishes a sound foundation for stability, reliability, and safety. It does not require the refactor to fix every existing defect. It supersedes the earlier review's framing for architectural decision-making; that report remains a separate inventory of implementation and release concerns.

## What the design gets right

The central change—derive evaluation state from recorded inputs rather than maintain it through multiple incremental mutation paths—is well justified. It reduces the number of places that must correctly implement gate propagation, findings, readiness, and safety. Recomputing a result also provides a useful reference behavior for debugging and testing.

Several supporting decisions reinforce that direction:

- **One graph-wide scoring pass** gives scoring an explicit contract and avoids mutation-specific scoring behavior.
- **Parent-owned patient facts** establish one authority for the patient context shared by a multi-pathway run.
- **Derived conflict decisions** avoid treating successive selections as additions to an already-mutated plan.
- **Integer revisions and atomic plan creation** provide a sound persistence model for concurrent changes and generation.
- **A reviewed-result check** makes the transition from evaluation to generation explicit and detects material changes before committing a plan.

The main architectural risk is that the proposed evaluator remains responsible for several kinds of work with different semantics: acquiring external information, deriving graph state, applying safety policy, composing alternatives, and managing lifecycle transitions. The following adjustments make those boundaries precise while preserving the overall design.

## 1. Separate external observations from deterministic evaluation

### The issue

The spec promises that the same inputs and environment produce the same result, while `evaluate` can call an LLM and read mutable medication normalization or interaction data. Those operations can change independently of the recorded inputs. A timeout followed by a successful response is enough to produce different results from otherwise identical arguments.

This is more than a wording issue. The boundary determines what must be retained for retries, what an audit can reproduce, and which tests can reasonably assert determinism. It also affects concurrency: a successful external response acquired during an attempt that loses the revision claim should not necessarily require another call.

Relevant spec: [evaluation rules, lines 111–120](https://github.com/Prism-Clinical/prism-graphql/blob/41da369c519688b6383ba1b02ef22e8578a6eed3/docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md#L111), [dependencies, lines 156–161](https://github.com/Prism-Clinical/prism-graphql/blob/41da369c519688b6383ba1b02ef22e8578a6eed3/docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md#L156), and retry reuse at line 281.

### Recommended adjustment

Distinguish an orchestration layer that acquires observations from a deterministic core that consumes them. An observation is an explicit record of information obtained externally: for example, an LLM verdict or a medication normalization result, together with the identity of the request and relevant provenance.

The desired contract is:

```text
derive(inputs, environmentSnapshot, observations) → result
```

The orchestration layer may discover that additional observations are needed, acquire them, and resume or rerun derivation. This need not mean prefetching every possible LLM answer. Reachability-dependent requests can be discovered as evaluation proceeds; the important point is that external responses cross an explicit boundary rather than appear as hidden mutable dependencies of a supposedly pure function.

Represent unavailable or unsuccessful observations explicitly during an attempt. They need not become permanent session answers: a subsequent attempt may acquire a successful result. The distinction is between “this attempt lacked a usable observation” and “the clinical condition was evaluated as false.”

Define reuse by the semantic request, including relevant context and evaluator policy, rather than assuming unchanged narrative text always means an unchanged question. The exact key can remain simple where the existing gate contract supports that assumption, but its validity should be explicit.

### Retry and persistence implications

Keep reusable observations in a request-local collection across revision retries. After reloading inputs, reuse only observations whose semantic requests still match. Persist the accepted observations and their association with the winning evaluation atomically with the session result.

External cache writes may occur independently, but they should not be confused with committing an observation as authoritative for a session. This distinction also makes audit behavior on failed attempts understandable.

### Tradeoff and scope

This introduces a small amount of orchestration and explicit data modeling. In exchange, the core becomes easier to test, replay, and reason about. It does **not** require event sourcing, an external workflow engine, or permanent storage of every failed call.

**Architectural acceptance:** frozen inputs, environment, and observations produce the same result; a retry reuses a compatible observation; changed context invalidates incompatible observations; unavailable evidence cannot masquerade as a completed evaluation.

## 2. Define the relationship between graph eligibility and final safety disposition

### The issue

The pipeline traverses the graph and derives findings before final safety changes included medications to excluded. Existing `prior_node_result` gates read node resolution status. Consequently, a gate can pass because medication A is included, then remain satisfied after safety excludes A.

Simply rerunning the entire evaluator is not automatically a solution: traversal could include A again, safety could suppress it again, and the same contradiction would recur. The design first needs to define what a dependent gate is intended to observe.

Relevant spec: [stages 3–6, lines 167–170](https://github.com/Prism-Clinical/prism-graphql/blob/41da369c519688b6383ba1b02ef22e8578a6eed3/docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md#L167).

### Recommended adjustment

Distinguish two concepts in the internal result model:

- **Eligibility:** the action is supported by the pathway's facts, gates, scoring, and applicable overrides.
- **Final disposition:** the action is included, suppressed, or otherwise withheld after safety and composition policy.

These can be separate fields or explicit types; they need not require an immediate public API redesign. Preserve the reason and provenance for each decision so that safety does not overwrite the explanation of why the pathway proposed the action.

Then define the dependency contract. A condition meaning “the pathway considers A applicable” can read eligibility. A condition meaning “A will be part of this plan” must read final disposition. Existing status-based dependencies need an explicit interpretation; silently assigning them one meaning during the refactor risks changing authored semantics.

For dependencies on final disposition, specify how suppression invalidates affected decisions and how findings and readiness are derived from the reconciled state. Options include a constrained dependency order, a bounded reconciliation algorithm, or rejection of unsupported dependency cycles. Choose the simplest mechanism that supports the graph semantics actually needed.

### Tradeoff and scope

Separating these concepts makes the internal model slightly richer, but removes ambiguity from overrides, suppression, explanations, and dependencies. It also avoids using one mutable status to represent both “recommended by the pathway” and “permitted in the final plan.”

This adjustment does not require a general rule solver. It requires a declared dependency model and a defined response when that model cannot produce a consistent result.

**Architectural acceptance:** suppressing an action cannot leave a final-disposition dependency incorrectly satisfied; eligibility remains explainable after suppression; downstream findings and readiness reflect the defined final state; unsupported cycles terminate with an explicit outcome.

## 3. Treat composition as a domain operation with its own readiness and safety rules

### The issue

A child being ready to generate independently is not equivalent to that child being ready to contribute to a combined plan. The spec currently inherits every child's blocker. A resolved child with no applicable recommendations therefore contributes `EMPTY_PLAN` and blocks another child's valid recommendations.

Safety also depends on the set being considered. A child can suppress an action because of another child-local candidate, while a later conflict decision removes that interacting candidate. Treating the child's suppression as an irreversible input to composition can leave a valid alternative unavailable. Conversely, combinations introduced during composition require their own safety evaluation.

Relevant spec: [composition, lines 213–231](https://github.com/Prism-Clinical/prism-graphql/blob/41da369c519688b6383ba1b02ef22e8578a6eed3/docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md#L213).

### Recommended adjustment

Define a child evaluation result as a contribution containing candidates, provenance, unresolved evaluation requirements, and safety findings with enough context to interpret their applicability. The parent then owns aggregate decisions:

1. Select and merge candidates using recorded conflict choices.
2. Determine which safety findings still apply to that candidate set and perform required aggregate checks.
3. Reconcile any dependencies affected by final disposition.
4. Calculate readiness for the combined plan.

Separate **evaluation completeness** from **output eligibility**. Unanswered relevant questions and incomplete evaluation ordinarily propagate from a child. Emptiness is evaluated at the generation root. This can be expressed through blocker scope or separate completeness/readiness structures; a collection of undocumented exception filters would be harder to maintain.

Safety findings should likewise distinguish their dependencies. A patient-specific contraindication may remain applicable regardless of conflict selection. A finding caused by a particular pair of proposed actions depends on whether both remain candidates. Reconsidering the latter should follow explicit policy, not indiscriminately restore every suppressed action.

### Tradeoff and scope

The composer gains responsibility, but that responsibility already exists implicitly in multi-pathway behavior. Making it explicit prevents child generation rules from accidentally becoming aggregate rules. Keep composition a focused domain function rather than another independently evolving copy of the evaluator.

The architectural contract can be settled without fixing every existing merge or identity defect in this refactor. Those defects remain implementation concerns within the declared contract.

**Architectural acceptance:** an empty resolved child can coexist with a useful combined plan; unresolved relevant child work still blocks; changing a conflict choice derives a new result from candidates and decisions; set-dependent safety findings are evaluated against the set to which they actually apply.

## 4. Establish one coherent environment policy for each evaluation of a run

### The issue

The spec allows live configuration, while an answer on child A reevaluates only A and a conflict change reevaluates no children. If configuration affecting B changes between mutations, the parent can combine results evaluated against different versions of the same shared configuration.

Full reevaluation during generation can catch a changed result, but it does not make the earlier composite cache fresh. The mismatch is between the declared invariant—every write leaves every cache fresh—and the invalidation policy.

Relevant spec: [freshness and mutation behavior, lines 194–243](https://github.com/Prism-Clinical/prism-graphql/blob/41da369c519688b6383ba1b02ef22e8578a6eed3/docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md#L194).

### Recommended adjustment

Choose one of two coherent policies:

| Policy | Behavior | Tradeoff |
|---|---|---|
| Pin configuration for the run | Subsequent evaluations use the recorded configuration snapshot or version | Strong reproducibility; changes require an explicit refresh policy |
| Use live configuration with versioned invalidation | Each mutation establishes a coherent environment and recomputes children whose dependencies changed | Reflects current configuration; requires invalidation and provenance |

Either is architecturally sound. Given the spec's deliberate choice of live configuration, **versioned invalidation is the smaller adjustment**. Record the relevant environment fingerprint with each result. Reuse a child cache only when both its inputs and its environment dependencies remain valid.

A conservative first implementation can invalidate all children when shared configuration changes. Fine-grained dependency tracking is an optimization, not a prerequisite. Pathway-specific environments may naturally differ; coherence means they belong to a declared evaluation snapshot and do not disagree about shared configuration.

Define how that snapshot is loaded. A versioned immutable configuration bundle or a short consistent database read can establish it without holding a transaction open across LLM/network work. External safety data should fit the observation/provenance contract from adjustment 1 rather than remain an untracked exception.

### Tradeoff and scope

Environment changes may trigger extra recomputation, which belongs in the performance measurements. This is preferable to claiming freshness while reusing incompatible results. The design does not need historical configuration pinning to adopt this adjustment.

**Architectural acceptance:** after a shared configuration change, an answer on A or a conflict mutation produces the same composite result as a full evaluation under the declared new environment; unchanged compatible child results remain reusable.

## Persistence: retain the design, clarify its boundary

The revision-based protocol and atomic generation claim are a good foundation. Evaluation outside the write transaction avoids holding database locks during remote calls; a conditional revision update prevents committing against an obsolete input version.

Keep that approach and clarify three details:

- A successful commit associates the accepted inputs, observations, environment provenance, cached result, and lifecycle state with the same revision. Generation includes the materialized plan and related child updates in that atomic outcome.
- Retries reload inputs and recheck lifecycle eligibility. Reuse of observations and child results follows their explicit validity rules.
- Lifecycle-only operations, especially abandonment and returning an already-completed generation result, do not require successful clinical reevaluation. They share persistence infrastructure, not necessarily every evaluation stage.

These are refinements to a sound transaction model, not reasons to redesign persistence.

## Suggested change to the specification

Add a short normative section before the pipeline stages covering:

1. The deterministic core's inputs, including environment and external observations.
2. Eligibility versus final disposition, and which state graph dependencies observe.
3. Child contribution versus root readiness, including the scope of safety findings.
4. Environment versioning and cache validity across a run.

Update the stage ordering, composition result types, and mutation table to follow those contracts. Add focused examples for the four architectural acceptance cases above before broad implementation begins. Retain the proposed early performance gate and measure the invalidation policy it will actually use.

Deferred identity, reconvergence, datum-routing, and output-persistence defects do not by themselves invalidate this architectural direction. Track them separately rather than turning this refactor into a requirement to solve every known issue. The decision here is to proceed with recomputation and unified persistence while making their semantic boundaries explicit enough that the new pipeline does not recreate the old inconsistencies in a different form.
