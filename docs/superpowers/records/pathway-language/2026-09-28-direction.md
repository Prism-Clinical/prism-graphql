# Pathway language: design direction (2026-09-28)

**Status:** historical direction record; **not a spec**. The subsequent
[pathway language RFC](../../specs/2026-09-28-pathway-language-rfc.md) proposes a revised direction:
one language with fixed semantics, drawing from CQL and restricted Datalog. In particular, it recommends
replacing institution-specific semantics profiles with approved clinical content and bounded policy.
The RFC is proposed for review; it does not record implementation approval. The original discussion below
is preserved so the changes in direction are explicit.

Supersedes phases 2–5 of `docs/superpowers/specs/2026-09-26-evaluation-interpreter-design.md` and its
fixed-semantics answers to Q1–Q8. Phase 1 (the compiler, deployed to live 2026-09-28 at `main` 16a2ffd) keeps
running until the new engine replaces it; its kind tables and corpus findings are inputs, not constraints.

## The problem

How disparate data about a patient and a condition comes together into **follow-up actions, follow-up
data needs/asks, and recommendations**; how the nodes of a pathway graph fit together and how they are
evaluated. Those rules vary by **institution**, by **new studies**, and by **provider**, so they must be
changeable without changing the engine.

## Decisions made

1. **Deterministic, stable, error-resistant engine.** Behaviour changes through configuration and
   content, not engine code.
2. **Graph stays the primary structure.** The language defines **nodes and typed relationships** between
   them. Compilation validates each node *and* each relationship to everything it connects to: for example,
   a gate that can never affect its target is a compile error, not a live defect.
3. **Two layers.**
   - **Base compiler** — platform-owned and neutral. Syntax, types, graph structure, referential and data
     integrity, determinism, internal coherence. It makes **no clinical judgement**.
   - **Institutional layer** — owned by each institution. Holds all clinical and organisational judgement:
     - a **semantics profile** (how relationships combine, what happens when data is missing, what a
       provider assertion does);
     - **governance rules** (what may be published or changed, e.g. evidence recency, review sign-off).
   - A **default institutional layer** ships for starting out.
4. **Semantics are institution-specific.**
5. **Policy levels:** institution → pathway/node (author) → provider at runtime. There is no hidden
   platform-default layer beneath the institution.
6. **Provider assertions:** the provider decides per assertion whether it overrides chart data (Q6); its
   temporal scope depends on the situation (Q6a).
7. **Missing data (Q5)** is not a fixed rule: today "ask the provider", later "pull from Epic", or hybrid
   ("obtain and submit to Epic, then pull").
8. **New repository.** The language, compiler and engine live in an entirely new repository; the spec must
   cover that (layout, boundaries with `pathway-service`, how prism-graphql consumes it).

## Recommendations on the table (discussed, to confirm in the spec)

- **Graph as syntax, rules as meaning.** Each relationship type has a formal contribution to its target;
  a node's outcome is its own definition plus the combination of its incoming relationships. The result is
  order-independent (Datalog-like), which removes the path-dependence class of defects by construction.
- **Every relationship must matter:** the compiler proves some patient state exists in which each
  relationship changes its target's outcome (solver-backed); otherwise it is decorative → error.
- **A deliberately small condition fragment** (numbers, booleans, codes/value sets, bounded time windows)
  so the checker can prove reachability and coverage. CQL covers only this layer; its temporal semantics may
  be borrowed, but it is not the core of the problem.
- **The institutional layer is restrict-only** (it can reject what the base compiler accepts, never the
  reverse) and is **itself checked** by the base compiler.
- **Default profile is copied, not inherited**, so engine updates never silently change an institution.
- **Everything versioned and pinned per session** (pathway, semantics profile, governance, engine).
- **Runtime:** pure core; append-only session record (chart facts, assertions, choices, LLM verdicts,
  EHR pulls, clock); missing data yields *needs* met by policy-selected *fulfillers*; fail closed on
  invariant violations.
- **Confidence scoring (Q8)** becomes a semantic point in the profile rather than a hidden second decision
  engine.

## Open question

Whether "verified" should also cover clinical review/evidence status (e.g. refuse to publish a node whose
cited study is newer than its last review). The two-layer split places this in **governance rules**.

## Proposed decomposition (agreed in principle)

| # | Sub-project | Depends on |
|---|---|---|
| 1 | Language core: node/relationship catalogue (meaning, endpoints, properties, proof obligations), canonical representation, list of semantic points | — |
| 2 | Semantics profile: format, options per point, validation, default profile | 1 |
| 3 | Base compiler: node / relationship / node-in-context / whole-graph checks, solver-backed | 1, 2 |
| 4 | Runtime engine: pure core, session record, needs → fulfillers, pinned versions | 1–3 |
| 5 | Governance layer: restrict-only publish rules and the metadata they read | 1, 3 |
| 6 | Authoring and migration: admin dashboard, compile errors on canvas, migrate live pathways | all |

Each sub-project gets its own spec → plan → implementation cycle.
