# Pathway Temporal Horizon — Design

**Date:** 2026-07-21 (revised 2026-07-26, three review rounds)
**Status:** Ready for implementation planning
**Repos:** `prism-graphql` (pathway-service), `prism-admin-dashboard` (authoring UI)
**Branch:** `feat/pathway-temporal-horizon`

## Revision history

- **2026-07-21 — draft.** Cascade of horizon + status over gate conditions.
- **2026-07-26 round 1.** Review raised twelve findings; ten accepted, two
  pushbacks. Added the pinned evaluation clock, the normalized fact model with
  three-valued overlap, the record-validity filter, operator-specific selection,
  data-flow retargeting to the input contract, pathway-default persistence, a
  separate canonicalization stage, and evidence persistence.
- **2026-07-26 round 2.** Direction approved. Folded in six P1 + four additional
  findings: the `TemporalEnd` disposition, the clinical-state contract + operator
  taxonomy (`equals` is membership), trust modes, an executable version registry,
  per-condition evidence, a shared reachability kernel, and a
  development-vs-deployment split.
- **2026-07-26 round 3.** Marked "ready for planning after five contract-level
  corrections." Four accepted (§1 clock contract, §2 discriminated fact union +
  id, §3 decoupled decision dimensions, §5 version-baseline reframe); one
  (import/canonicalization) **rejected on premise** — see the correction note in
  §6. Added explicit GraphQL/persistence surfaces, reachability clock ownership,
  and algorithm-level acceptance criteria. Round-3 disposition table is at the end.

All file:line claims across all three rounds were verified against **this branch's
worktree** before acceptance. One recurring correction: the round-1 and round-3
reviews asserted the import validator has no gate-condition schema
(`CODED_KEYS`/`ATTRIBUTE_KEYS`). It does, since PR #48
(`feat/gate-condition-field-attribute-model`, merged into this branch's base) —
verified at `validator.ts:27/32`. That review was run against a checkout predating
PR #48; §6 reflects the actual code.

The **architecture is unchanged since round 1.** Rounds 2–3 sharpen contracts:
the fact model, the three decoupled decision dimensions, the trusted-input
boundary, version baselining, per-condition evidence, and the concrete
GraphQL/persistence surfaces.

A load-bearing deployment fact still shapes everything: **all `snapshot_*` tables
are empty, there is no clinical data on the host, and the principal resolution
path builds context from GraphQL input — the encounter simulator is the only live
source of patient context.** In practice v1 runs entirely in *synthetic* mode
(below), which is precisely why the trusted-input boundary is cheap to install
now, before live clinical resolution is wired.

## Problem

Pathway gate conditions have almost no control over *when* in a patient's history they look.

`window_days` exists on `CodedCondition` but is read by only three operators
(`count_in_window`, `trend_*`, `delta_from_baseline`); every other operator —
including the membership and comparison operators all deployed pathways use —
ignores time. Scalar comparison also selects the *first* array match
(`gate-evaluator.ts:70`, `.find(...)`) over labs loaded with no `ORDER BY`
(`snapshot-context.ts:74`), so it does not reliably pick *which* value. The admin
dashboard exposes no temporal control at all.

Clinical currency is enforced by a *hidden* filter: `snapshot-context.ts` drops
resolved conditions via `isConditionActive` and fetches only `status = 'active'`
medications. Authors cannot see, override, or invert it. And record *validity* is
never checked: FHIR `refuted` / `entered-in-error` conditions and allergies, and
`cancelled` / `entered-in-error` observations, satisfy gates today.

## Goals

- Explicit, layered author control over the time window a gate condition examines.
- Clinical-status filtering explicit and overridable instead of hidden in the mapper.
- Three separately-expressible dimensions: *when* (horizon), *what clinical state* (status), and *is the record trustworthy* (validity — a non-overridable platform filter).
- **Reproducible** evaluation: the same session, retraversed later, produces the same result.
- Reproduce today's effective semantics where correct, and **version any place it deliberately does not** (labs).

## Non-Goals

- Windowed operators (`count_in_window`, `trend_*`, `delta_from_baseline`) in the authoring UI.
- Per-institution / per-organization horizon scoping.
- Vitals horizons.
- ML/recommender consumption of horizons.
- Temporal/state policy applied to **pathway selection / entry criteria** (v1 applies it only after selection).
- Runtime editing of platform-default horizons (constants, not a table).
- **"Patient currently taking" medication semantics** — v1 models the *order*, not exposure (§3, P1-1).

## Design

### 1. A pinned evaluation clock

Every temporal computation needs one persisted clock. Today there is none:
`evaluateGate` and `evaluateCompound` default `now` to `Date.now()`
(`gate-evaluator.ts:743`, `:559`), and traversal/retraversal pass `undefined`, so
each invocation re-reads the wall clock — a session retraversed later can change
outcome with identical data.

A session gains an **`EvaluationTemporalContext`**, stamped once at
`startResolution` (single- **and** multi-pathway) and reused verbatim by every
initial traversal, provider-answer retraversal, scenario replay, reachability
computation, and explanation:

```ts
interface EvaluationTemporalContext {
  evaluationAsOf: string;          // ISO instant — the clock for ALL relative computation
  encounterStart?: string;         // anchor for the ENCOUNTER horizon
  snapshotId?: string;             // pinned clinical snapshot, when LIVE mode
  snapshotCapturedAt?: string;     // when that snapshot was captured — bounds OPEN-ended facts (§2)
  timezone: 'UTC';
  temporalPolicyVersion: string;   // selects the immutable policy constants (§5)
}
```

`Date.now()` is read once, to stamp `evaluationAsOf` at session creation when the
caller (synthetic mode) supplies none, and never again at evaluation time.
`evaluateGate` / `evaluateCompound` receive `evaluationAsOf` from the traversal
boundary instead of defaulting.

**`encounterStart` rule (round 3, single contract).** `ENCOUNTER` depends on
`encounterStart`. The round-2 draft left two possible behaviors (reject *or*
indeterminate); those are different contracts, so v1 picks one:

> **Validate before traversal and reject session creation** if any effective gate
> horizon in the pathway resolves to `ENCOUNTER` and the mode cannot supply
> `encounterStart`.

LIVE mode derives `encounterStart` from the encounter; SYNTHETIC mode supplies it.
This avoids partially-initialized sessions and new three-valued compound-gate
behavior for a merely-missing required anchor. Reachability (which runs before a
session exists) may report an advisory indeterminate, but authoritative resolution
has exactly this one deterministic contract, and never silently substitutes
`evaluationAsOf`.

### 2. The normalized fact model and interval matching

A **`Horizon`** is a first-class pathway-JSON value, a named tier or a custom day count:

```
LIFETIME | YEAR | QUARTER | MONTH | WEEK | DAY | ENCOUNTER | { days: N }
```

`LIFETIME` has no lower bound; `ENCOUNTER` runs since `encounterStart`; the rest are
day-count sugar (365/90/30/7/1) measured back from `evaluationAsOf`. Every form
resolves to a `{ lowerBound, upperBound }` instant pair.

Every clinical fact normalizes to a **discriminated union** (round 3) — labs carry
no clinical state, so a single universal interface is wrong:

```ts
interface TemporalBound { value: string; precision: 'year' | 'month' | 'day' | 'instant'; }

// "ongoing" and "unknown" are NOT interchangeable — an explicit disposition.
type TemporalEnd =
  | { kind: 'KNOWN';   bound: TemporalBound }        // a real end (abatement, resolution, stop)
  | { kind: 'OPEN';    assertedCurrentAt: string }   // ongoing, known-current only as of this instant
  | { kind: 'UNKNOWN' };                             // no usable end signal — do NOT invent one

interface FactBase {
  factId: string;                                    // ALWAYS present; assigned at ingestion (see below)
  code: string; system: string; display?: string;   // display is used by DDI/scorers (ddi-pass.ts:226)
  interval: { start?: TemporalBound; end: TemporalEnd };
  recordValidity: 'VALID' | 'INVALID' | 'UNKNOWN';
  validityBasis: string;                             // which status/rule produced recordValidity
  provenance: { sourceType: 'FHIR' | 'SYNTHETIC'; sourceId?: string; snapshotId?: string };
}

interface StatefulFact extends FactBase {            // conditions, medication orders, allergies
  kind: 'condition' | 'medication_order' | 'allergy';
  clinicalState: 'ACTIVE' | 'INACTIVE' | 'ON_HOLD' | 'UNKNOWN' | 'CONFLICT';
  stateAsOf?: string;
  stateBasis: 'FHIR_STATUS' | 'ABATEMENT' | 'SNAPSHOT_ASSERTION'
            | 'SYNTHETIC' | 'MISSING_STATUS_FAIL_OPEN';
}

interface LabFact extends FactBase {                 // labs have no clinical state
  kind: 'lab';
  value?: number; unit?: string;
  observationStatus?: string;                        // registered|preliminary|final|amended|corrected|...
  issuedAt?: string;                                 // for choosing among amended/corrected results
}

type NormalizedFact = StatefulFact | LabFact;
```

**`factId` is assigned, not hashed (round 3).** A deterministic hash of
`kind+code+system+start` collapses two distinct same-code occurrences on the same
date with no source id — which would silently corrupt `count_in_window` (it counts
distinct ids). The assembler assigns a **distinct** `factId` at ingestion and
persists it in the normalized session context; replay reuses the persisted id and
never regenerates. If a deterministic id is ever required for idempotency, it must
include the full canonical payload **plus an occurrence ordinal**, not a lossy hash.

Interval construction (verified schema: migrations 026/030; all date columns are
`VARCHAR(30)` FHIR strings). **No end is ever fabricated as `start`:**

| Kind | `start` | `end` |
|---|---|---|
| condition | `onset_date_time` → `recorded_date` | `KNOWN(abatement_date_time)` if present; else `OPEN(snapshotCapturedAt)` if state ACTIVE; else `UNKNOWN` |
| medication_order | `authored_on` | `KNOWN` only if a real end date exists; else `OPEN(snapshotCapturedAt)` if order state ACTIVE; else `UNKNOWN`. **Never** `dispenseRequest.validityPeriod.end` |
| allergy | `onset_date_time` → `recorded_date` | `KNOWN` only if a real resolution date exists; else `OPEN(snapshotCapturedAt)` if state ACTIVE; else `UNKNOWN`. **Never** `last_occurrence` |
| lab | `effective_date_time` → `issued_date` | `KNOWN` = start (instant) |

The two FHIR corrections from round 1 stand: `dispenseRequest.validityPeriod` is a
dispensing window (not exposure), and `lastOccurrence` is the last *reaction* (not
resolution); neither closes an interval.

#### Three-valued overlap

Overlap of a fact interval against a horizon returns **`MATCH` / `NO_MATCH` / `UNKNOWN`**.
`UNKNOWN` arises when a fact is undated, when a partial date straddles a boundary
(`2026` expands to `[2026-01-01, 2026-12-31]`; a straddle is `UNKNOWN`, never a
fabricated `2026-01-01`), or when an **`OPEN`-ended** fact's `assertedCurrentAt`
falls before the horizon's lower bound (P1-2 subtlety):

> An `OPEN` end contributes established overlap only up to `assertedCurrentAt`
> (typically `snapshotCapturedAt`). If the entire horizon window lies *after*
> `assertedCurrentAt`, the fact was active but is not *known* active in-window →
> `UNKNOWN`, not `MATCH` and not `NO_MATCH`.

In **synthetic** mode there is no `snapshotCapturedAt`, so
`OPEN.assertedCurrentAt = stateAsOf ?? evaluationAsOf`, with the invariant that a
supplied `stateAsOf` and `assertedCurrentAt` may not disagree. (Acceptance
criterion: an ACTIVE fact with no onset but an `OPEN.assertedCurrentAt` inside the
window is a `MATCH`, not merely "undated → UNKNOWN.")

#### Operator taxonomy and the `UNKNOWN` policy (P1-3 — corrected)

The round-1 draft misclassified `equals`. Verified: `equals` is exact **code
membership** (`gate-evaluator.ts:226`, `e.code === value`), UI-restricted to
conditions/medications/allergies (`GateConditionEditor.tsx:40`) — not numeric
equality. Correct taxonomy:

| Class | Operators | `UNKNOWN` overlap → |
|---|---|---|
| **membership** | `includes_code`, `equals`, `exists` | **include** (fail-open) — "ever recorded" intent; matches today's `isConditionActive` posture |
| **scalar** | `greater_than`, `less_than` | **exclude** (fail-closed) — a threshold must not fire on an undated value |
| **aggregate** | `count_in_window`, `trend_*`, `delta_from_baseline` | **exclude** (fail-closed) — matches today's windowed behavior exactly |

A numeric-equality operator, if ever wanted, is introduced later as a **distinct
`value_equals`**, not by overloading `equals`.

This preserves the windowed operators' current fail-**closed** behavior for undated
facts (`gate-evaluator.ts:102` returns `false`; regression test
`gate-evaluator-count-in-window.test.ts:178`), so `window_days → horizon` is a
faithful normalization rather than the inverted fail-open rule the draft proposed.

### 3. Three dimensions: when, what state, is it valid

```jsonc
{ "field": "conditions", "operator": "includes_code", "value": "E11.9",
  "horizon": "LIFETIME",   // WHEN          — author-selectable
  "status":  "active" }    // CLINICAL STATE — author-selectable: active | inactive | any
```

**Clinical state comes from a per-resource mapping (P1-2), not interval openness,
and `isConditionActive` is not reused as-is.** The current predicate
(`active-context-filter.ts:42`) is impure — it folds abatement into the decision
and defaults missing/malformed status to *active* — so state derivation is an
explicit table:

| Kind | Source field | → clinicalState |
|---|---|---|
| condition | `abatement_date_time` present **and** `clinical_status` ∈ {inactive, remission, resolved} or absent | `INACTIVE` (basis `ABATEMENT`) |
| condition | `abatement_date_time` present **and** `clinical_status` = active | `CONFLICT` — FHIR forbids an abated-yet-active condition; do not silently pick one |
| condition | `clinical_status` ∈ {active, recurrence, relapse}, no abatement | `ACTIVE` |
| condition | `clinical_status` ∈ {inactive, remission, resolved} | `INACTIVE` |
| condition | missing / malformed `clinical_status`, no abatement | `ACTIVE`, basis `MISSING_STATUS_FAIL_OPEN` — **preserves today's fail-safe** |
| medication_order | `status` = active | `ACTIVE` |
| medication_order | `status` = on-hold | `ON_HOLD` |
| medication_order | `status` ∈ {stopped, completed, cancelled} | `INACTIVE` |
| medication_order | `status` ∈ {draft, unknown} | `UNKNOWN` |
| allergy | `clinical_status` = active | `ACTIVE` |
| allergy | `clinical_status` ∈ {inactive, resolved} | `INACTIVE` |
| allergy | missing | `ACTIVE`, basis `MISSING_STATUS_FAIL_OPEN` (preserves today's fail-safe) |

**The three dimensions are decided independently (round 3).** The round-2 draft
admitted `UNKNOWN`/`CONFLICT` state via the operator's *temporal* fail-open policy
— which leaked the temporal axis into the state axis. Selection instead produces a
per-fact decision with three separate results plus the operator's combination:

```ts
interface FactDecision {
  validityDecision: 'ADMIT' | 'DROP_INVALID' | 'UNKNOWN';
  stateMatch:       'MATCH' | 'NO_MATCH' | 'UNKNOWN' | 'NOT_APPLICABLE'; // NOT_APPLICABLE for labs
  temporalMatch:    'MATCH' | 'NO_MATCH' | 'UNKNOWN';
  operatorDecision: 'INCLUDE' | 'EXCLUDE' | 'INDETERMINATE';
}
```

Independent policies, none derived from another axis:

- `recordValidity = INVALID` → **always drop** (validity dominates).
- `recordValidity = UNKNOWN` → **admit with evidence** (`validityUnverified: true`).
- Author `status: active` admits `ACTIVE`; `inactive` admits `INACTIVE`; **`any`
  bypasses state filtering entirely** — it admits every state including `UNKNOWN`
  and `CONFLICT`, each still marked in evidence.
- `status: active` with `MISSING_STATUS_FAIL_OPEN` state is admitted (preserving
  today's fail-safe), but evidence records `stateUnverified: true`.
- A `CONFLICT` state under `status: active`/`inactive` is **excluded** — a temporal
  membership fail-open must **not** silently resolve a clinical-state conflict.
- `labs` have no clinical status (`stateMatch: NOT_APPLICABLE`); author `status` is
  rejected at validation for `field: "labs"`.

**Record validity is a non-overridable platform safety filter** (orthogonal to
`status`), applied *before* any author dimension. The full mapping (round 3 — the
draft's partial list is completed, per the FHIR `Observation.status` value set):

| Kind | Source | `recordValidity` |
|---|---|---|
| condition / allergy | `verification_status` ∈ {refuted, entered-in-error} | `INVALID` |
| condition / allergy | `verification_status` ∈ {confirmed, provisional, presumed} or absent | `VALID` |
| medication_order | `status` = entered-in-error | `INVALID` |
| lab / vital | `Observation.status` ∈ {cancelled, entered-in-error} | `INVALID` |
| lab / vital | `Observation.status` ∈ {final, amended, corrected} | `VALID` |
| lab / vital | `Observation.status` ∈ {registered, preliminary, unknown} | `UNKNOWN` (no/partial result — admit with `validityUnverified`, but a scalar/aggregate gate treats it fail-closed) |

These columns exist (`snapshot_conditions.verification_status`,
`snapshot_allergies.verification_status`, `snapshot_lab_results.status`,
`snapshot_medications.status`). Labs get no author `status` but **do** get validity.

**Medication semantics (P1-1).** `snapshot_medications` is MedicationRequest-sourced
(`medication_request_id`, `status`, `authored_on` — migration 026:129), so the
fact kind is **`medication_order`** and the author-facing label is **"active
medication order,"** not "currently taking." True exposure (therapy episodes from
MedicationStatement / MedicationAdministration / MedicationDispense) is a future
feature gated on ingestion that does not exist — explicitly out of v1 scope.

### 4. Operator-specific fact selection (P1-3-consistent)

| Operator | Selects |
|---|---|
| `includes_code` / `equals` / `exists` (membership) | any valid, in-window fact — code/existence, no value selection |
| `greater_than` / `less_than` (scalar) | **latest** valid, dated, in-window result (sort by effective time, descending) |
| `count_in_window` | count of **distinct `factId`**, valid + in-window |
| `trend_*` / `delta_from_baseline` | all valid, dated, in-window results sorted by effective time |

Unknown or conflicting timestamps yield `UNKNOWN` (§2), never array-order
dependence — fixing today's first-`.find()` behavior over unordered labs.

### 5. Cascade, platform defaults, and an executable version registry

Three levels, resolved per `(gate condition, data type)`:
`SYSTEM_DEFAULT → PATHWAY → NODE` (a subset of the migration-038 scope vocabulary,
so `INSTITUTION`/`ORGANIZATION` remain additive).

| Level | Lives in | Set by |
|---|---|---|
| `SYSTEM_DEFAULT` | typed constants in an **immutable versioned registry** | platform (code change) |
| `PATHWAY` | pathway JSON header `default_horizons`/`default_statuses`, persisted per §7 | author |
| `NODE` | gate condition `horizon`/`status` | author |

**Platform defaults are typed constants, not a mutable table** (round-1 pushback,
review-accepted: no runtime-edit requirement, pre-production; a table would drag in
an effective-policy API, per-session snapshotting, cache invalidation, and audit we
do not need).

**The version must be executable, not merely recorded (P1-5).** An immutable
registry, keyed by the version a session pins:

```ts
const TEMPORAL_POLICIES = {
  'legacy-v0': {   // reproduces TODAY exactly — labs are lifetime because every operator ignores time
    conditions:  { horizon: 'LIFETIME', status: 'active' },
    medications: { horizon: 'LIFETIME', status: 'active' },   // "active medication order"
    allergies:   { horizon: 'LIFETIME', status: 'active' },
    labs:        { horizon: 'LIFETIME' },
  },
  'v1': {          // the corrected policy
    conditions:  { horizon: 'LIFETIME', status: 'active' },
    medications: { horizon: 'LIFETIME', status: 'active' },
    allergies:   { horizon: 'LIFETIME', status: 'active' },
    labs:        { horizon: 'QUARTER' },                       // 90 days, not lifetime
  },
} as const;
```

Rules:

- **Never mutate an existing version's meaning** — add `v2`.
- Evaluation selects constants by the session's stored `temporalPolicyVersion`.
- An **unknown version is a hard error**, never "use latest."
- Every rolling-deployment pod must understand all still-active session versions.
- Temporal context is persisted for both single- and multi-pathway sessions.

**Version selects defaults, not the whole evaluation kernel (round 3).** `v1`
changes more than default horizons/statuses — it also changes scalar selection
(`.find()` → latest dated), adds the validity filter, precision-aware partial
dates, decoupled unknown-state handling, the allergy projection, and consumer
projections. So a session pinned to `legacy-v0` but run through the **new** kernel
would *not* reproduce today's behavior, and `legacy-v0` must not be advertised as
replayable through it.

Because there are **no production sessions**, v1 takes the simple, correct path
(the reviewer's recommended option): the **current evaluator itself is the shadow
baseline** for the deployment's shadow-evaluation step (§Rollout) — the new `v1`
path is diffed against the *legacy code path*, not against an in-kernel
`legacy-v0`. Existing sessions are declared **non-retraversable** across
activation. `temporalPolicyVersion` still governs `v1` vs a future `v2` going
forward; full cross-kernel replay of old sessions would require versioning the
entire `EvaluationSemantics` (scalar selection, validity mode, state mode,
partial-date mode, projection mode), which is explicitly deferred until a real
replay requirement exists.

Resolution stays a pure, synchronous function —
`resolveHorizon(dataType, effectivePolicy, pathwayHeader, condition)` — with the
policy constants and pathway defaults loaded once at session start (§7).

### 6. `horizon` supersedes `window_days`; canonicalization is a distinct stage

`window_days` is already an accepted key (`validator.ts:29`); the import path
canonicalizes `window_days: 90 → horizon: { days: 90 }` and drops it, and the
windowed operators read the resolved horizon.

The validator cannot do this — `validatePathwayJson` returns a `ValidationResult`
and is non-transforming; the orchestrator persists the original JSON
(`import-orchestrator.ts:96`). So canonicalization is a **separate stage**:

```
parse → canonicalize → validate (canonical) → persist
```

The canonicalizer returns a **new** `PathwayJson`, renames `window_days → horizon`,
coerces types, **rejects** a condition supplying both `window_days` and `horizon`,
and emits warnings. `horizon`/`status` are registered in `CODED_KEYS`. The admin
dashboard validator has no allowlist (`src/lib/pathway-json/`), so the same
canonicalizer is mirrored client-side and covered by **shared conformance fixtures**
to prevent client/server drift. No live data uses `window_days`.

**Correction (round 3): this branch already has a gate-condition validator.** The
round-1 and round-3 reviews (run against a checkout predating PR #48) claimed there
is no `CODED_KEYS`/`ATTRIBUTE_KEYS` and that a gate-condition schema must be
introduced from scratch. Verified against **this** worktree: `CODED_KEYS`
(with `window_days`) and `ATTRIBUTE_KEYS` exist at `validator.ts:27/32`, alongside
operator validation and structural gate checks. So the plan **extends** that
validator; it does not create one. What the reviews got right, and what the plan
must still do — because the existing validator checks condition *keys*, not *value
shapes* (`PathwayNodeDefinition.properties` is `Record<string, unknown>`,
`types.ts:117`):

1. **Value-validate** `horizon` shape, `{days:N}` bounds, `status` applicability
   (reject on `labs`), and the `window_days`/`horizon` conflict.
2. Register `horizon`/`status` in `CODED_KEYS`; traverse **both**
   `properties.condition` and `properties.conditions[]` (compound gates).
3. **`conditionId`** does not exist on `GateCondition`
   (`GateCondition = CodedCondition | AttributeCondition`, verified). Add it;
   generate + persist a stable id for legacy conditions on import; require
   uniqueness within a gate; preserve it across admin edits and import/export
   round-trips. The per-condition evidence (§9) depends on it.
4. **Schema-version decision:** the validator accepts only `"1.0"`
   (`validator.ts:58`). Decide whether `horizon`/`status`/`conditionId` are
   backward-compatible `1.0` additions or warrant a version bump — a mandatory
   planning decision.

### 7. Pathway-level defaults need real storage

Putting `default_horizons` in the header is not enough — it is decomposed on import
and only known fields survive (`PathwayMetadata` has no temporal fields,
`import/types.ts:14`; root creation serializes a fixed list,
`graph-builder.ts:26`; the index table and `Pathway` type have no temporal column;
reconstruction rebuilds only known fields, `import-orchestrator.ts:906`).

1. `PathwayMetadata` gains `default_horizons?` / `default_statuses?`.
2. A `temporal_defaults JSONB` column on `pathway_graph_index` is the **single
   source** — there is no copy on the AGE root node.
3. The `Pathway` GraphQL type exposes it.
4. **Ownership is relational, not graph (round 3):** the relational writer persists
   `temporal_defaults` to `pathway_graph_index`; import reconstruction reads it back
   from the relational index; graph root creation (`graph-builder.ts`, AGE Cypher)
   deliberately **ignores** it — so it round-trips through the relational store, not
   the graph.
5. **`buildResolutionContext` loads it (P1-5).** Today it selects only `age_node_id`
   (`resolution-context.ts:230`); it must also read `temporal_defaults` from the
   relational index and pass it to the evaluator.

### 8. Data flow: input contract, trust boundary, shared assembler

The principal path builds `PatientContext` from GraphQL input, not `snapshot-context.ts`
(which is only on the `MatchedPathway.reachability` read path, `Query.ts:846`):
`startResolution` (`resolution.ts:88`) and `startMultiPathwayResolution`
(`multi-pathway-resolution.ts:526`) read `args.patientContext`, and `CodeInput`
(`schema.graphql:1130`) carries only code/system/display.

**Explicit trust modes (P1-4).** Resolution takes exactly one mode — never inferred
from whether optional `patientContext` is absent:

```ts
type ResolutionMode =
  | { mode: 'LIVE';      snapshotId: string }             // server selects+authorizes snapshot, DERIVES validity/state, STAMPS clock
  | { mode: 'SYNTHETIC'; patientContext: SyntheticInput } // authorized admin may supply raw statuses/dates/asOf
  | { mode: 'REPLAY';    sessionId: string };             // persisted normalized facts + temporal context
```

- **LIVE:** the server derives `recordValidity` / `clinicalState` from source
  records and stamps `evaluationAsOf`; caller-supplied validity/state/clock fields
  on `CodeInput` are **rejected**. This closes the "caller bypasses the validity
  filter / spoofs the clinical clock" hole.
- **SYNTHETIC:** the simulator's authorized input may carry `date`, interval
  endpoints, `clinicalState`, `recordValidity`, `sourceId`, and `evaluationAsOf` —
  this is where the extended `CodeInput` fields live.
- **REPLAY:** normalized facts + `EvaluationTemporalContext` are re-read, nothing
  re-derived.

v1 is effectively SYNTHETIC-only (empty tables); LIVE is defined now so it is safe
by construction when wired.

**`factId` is required after normalization (P1-4).** `count_in_window` counts
distinct IDs and evidence needs `selectedFactIds`, so the assembler always produces
a stable `factId`, synthesizing one deterministically (hash of kind+code+system+
start+sourceId) when the source lacks an identifier.

**One context assembler**, used by `startResolution`,
`startMultiPathwayResolution`, reachability, scenario replay, and confidence
preview — producing the same `NormalizedFact[]` from a snapshot (LIVE) or from
synthetic input.

**Contamination isolation (round-1 blocking finding).** `PatientContext` is shared:
DDI screens every med/allergy unfiltered (`ddi-pass.ts:100`), the completeness
scorer counts raw arrays (`data-completeness.ts:124`), custom-rules unions all
codes (`custom-rules.ts:87`). The widened fact list feeds **only the gate
evaluator**; every other consumer reads an **explicit named projection** off one
fact store, so none is *silently* contaminated by the widening:

- `selectFacts(condition, factStore, effectivePolicy, temporalContext)` — the gate
  kernel (below).
- `actionableMedications` / `actionableAllergies` — **valid + active**, for DDI.
- scorer projections declaring `current | historical | any`.

This is **not "zero behavior change" (round-3 correction).** Snapshot allergies are
loaded with no status filter today (`snapshot-context.ts:79`,
`SELECT code FROM snapshot_allergies`), so DDI's `valid + active` allergy projection
*changes what DDI sees* — a deliberate `v1` correction (a refuted or resolved
allergy should not screen a candidate drug). The point of the isolation is that each
consumer's projection is chosen **deliberately** and its `v1` delta disclosed
(Compatibility), not that consumers are unchanged.

**A shared selection kernel for reachability (finding 7).** Reachability currently
treats {includes_code, equals, exists} as `ALWAYS_EVALUABLE` and only checks
whether data *exists* (`reachability.ts`) — it applies no validity, state, horizon,
or clock, so it would drift from resolution. Both reachability and gate evaluation
call the **same pure `selectFacts(...)`**; reachability reports whether usable facts
exist without duplicating the routing evaluator.

### 9. Per-condition evaluation evidence (P1-6)

Traversal stores a reason only on **failed** gates (`traversal-engine.ts:363/675`);
on success it stores nothing (`:282-294`). And a compound gate holds several
conditions with different fields/horizons/results (`GateProperties.conditions[]` +
`operator: 'AND'|'OR'`; `evaluateCompound`, `gate-evaluator.ts:556`), so a single
flattened evidence object cannot audit it.

`NodeResult` gains structured evidence, populated on **both** branches:

```ts
interface GateEvaluationEvidence {
  aggregateResult: boolean;
  operator: 'AND' | 'OR' | 'SINGLE';
  conditions: GateConditionEvidence[];
}
interface GateConditionEvidence {
  conditionId: string;                 // stable per condition (§6)
  field: string; operator: string;
  effectiveHorizon: string;  horizonSource: 'SYSTEM_DEFAULT' | 'PATHWAY' | 'NODE';
  effectiveStatus?: string;  statusSource?: 'SYSTEM_DEFAULT' | 'PATHWAY' | 'NODE';
  resolvedBounds: { lowerBound: string | null; upperBound: string };
  // all three decision dimensions are visible, not just the temporal one (round 3):
  temporalMatch: 'MATCH' | 'NO_MATCH' | 'UNKNOWN';   temporallyUnverified: boolean;
  stateMatch: 'MATCH' | 'NO_MATCH' | 'UNKNOWN' | 'NOT_APPLICABLE';  stateUnverified: boolean;
  recordValidity: 'VALID' | 'INVALID' | 'UNKNOWN';   validityUnverified: boolean;
  selectedFactIds: string[];
  explanation: string;
}
```

Exposing all three dimensions (not just `temporalMatch`) is what keeps the audit
record honest: an author must see a gate satisfied only by undated facts
(`temporallyUnverified`), *and* one admitted only by a fail-open missing status
(`stateUnverified`), *and* one leaning on an unverified record
(`validityUnverified`). The simulator surfaces all three per condition.

### 10. Authoring UI

**One control per coded-condition row** — `horizon` and `status` segments default
to **Inherit**, with a resolved-value caption showing what the author gets and which
cascade level supplied it (computed client-side from the same inputs the resolver
uses). Horizon offers named tiers plus **Custom…** (numeric days).

**A dedicated pathway-metadata panel, not a node-props extension** —
`PropertiesPanel` returns `null` with no node selected (`PropertiesPanel.tsx:130`)
and the root is dropped from the canvas (`deserializer.ts:95`), so a new panel hosts
`default_horizons` / `default_statuses`, one row per data type, defaulting to
Inherit.

**Attribute conditions** get no horizon control (encounter-derived, no timeline).
**Vitals** show a fixed "Encounter" horizon with a tooltip.

**Publish validation (finding 9b — corrected).** ENCOUNTER has no fixed duration, so
the check is not "shorter than ENCOUNTER"; it warns on **any finite / non-lifetime
horizon applied to a data type whose facts are typically undated** (it would match
everything via membership fail-open), and when both `window_days` and `horizon`
appear on one condition.

### 11. GraphQL and persistence surfaces (round-3 hardening — made explicit)

The API/DB changes must be enumerated, not implied. Today `ResolutionSession`
exposes no temporal context or policy version, `ResolvedNode` exposes no evidence
(`schema.graphql:991`), and the formatter would drop new fields (`Query.ts:75`):

- A **`temporal_context JSONB`** column on the session row, for single- **and**
  multi-pathway sessions, holding the `EvaluationTemporalContext`.
- GraphQL exposure of the session temporal context and `temporalPolicyVersion`.
- GraphQL exposure of `GateEvaluationEvidence` on `ResolvedNode`.
- Formatter / hydrator updates so the new fields survive to the response.
- Evidence may remain **embedded in `resolution_state`** (no separate evidence
  column) unless evidence must be queried independently.

### 12. Reachability clock ownership (round-3 hardening)

The shared `selectFacts` kernel (§8) fixes semantics, but `MatchedPathway.reachability`
runs **before a session exists** — via `matchedPathways(patientId)`
(`Query.ts:549/813`), with no temporal arguments — so it cannot reuse a persisted
session context. Contract:

- Reachability is **advisory**: it receives a **request-scoped `evaluationAsOf`**
  and reports whether usable facts exist, running the same `selectFacts` kernel.
- Authoritative resolution **recomputes** with its own pinned
  `EvaluationTemporalContext`; reachability's result is never treated as binding.
- Optionally, reachability may return a context/snapshot **token** that
  `startResolution` can adopt — but it does not read a session context that does
  not yet exist.

### 13. Algorithm-level acceptance criteria (round-3 — to seed the plan)

Recorded here as mandatory, testable planning decisions:

- **`{days:N}` validation:** a finite positive integer with an agreed maximum;
  otherwise a validation error.
- **Upper bound = `evaluationAsOf`** for every horizon; a fact dated in the future
  (after `evaluationAsOf`) never matches.
- **OPEN in-window:** an ACTIVE fact with no onset but `OPEN.assertedCurrentAt`
  inside the window is `MATCH`, not "undated → UNKNOWN."
- **Lab ties:** when two equally authoritative results share an effective time,
  selection is deterministic — prefer `corrected` > `amended` > `final`, then a
  stable tiebreak on `factId`; never array order.
- **Amended/corrected supersede** earlier results at the same effective time.
- **Shadow evaluation is side-effect-free:** no duplicate LLM calls, audit events,
  or session mutations while diffing the new path against the legacy evaluator.

## Compatibility (all deltas versioned as `v1`)

The honest per-type statement:

- **conditions / medications / allergies — `LIFETIME` + `active`** reproduces the
  hidden currency filter as an explicit, overridable default. **But not "no
  behavior change":** the new **validity filter** drops `refuted` /
  `entered-in-error` facts that match today, and snapshot **allergies are currently
  loaded with no status filter at all** (`snapshot-context.ts:79`,
  `SELECT code FROM snapshot_allergies`), so a `valid + active` projection changes
  what DDI sees. Both are deliberate `v1` corrections.
- **labs — `QUARTER`** is a deliberate breaking change: today every operator ignores
  time, so "hemoglobin < 11" means "any ever"; under `v1` it means "last 90 days."
  Windowed lab operators with no `window_days` likewise move from lifetime to
  `QUARTER` — existing tests carry series older than 90 days
  (`gate-evaluator-trend.test.ts:67`) and will change under `v1`. The two live
  hemoglobin gates (LOINC 718-7) adopt it.
- **missing/malformed clinical status** is mapped to `ACTIVE` (unverified),
  preserving today's `isConditionActive` fail-safe.

`legacy-v0` reproduces today's behavior exactly (labs lifetime, no validity filter
semantics beyond today's), so the change from `legacy-v0` to `v1` is a reviewable,
shadow-testable diff, not a silent shift.

**Entry criteria are out of scope for v1.** Pathway *matching* filters to active
conditions in SQL (`session-store.ts:407`), dropping resolved diagnoses before
selection. v1 applies temporal/state policy **only after** selection; a pathway that
must reason over a resolved diagnosis for *selection* would require pushing state
policy into the matcher — deferred, recorded as a decision.

## Current Deployed State (verified 2026-07-21)

- 41 `Gate` nodes; 11 carry conditions, in two dialects (attribute `LT`/uppercase
  the engine ignores; coded `less_than`). Only working coded gates: two hemoglobin
  (718-7) anemia-staging gates.
- No deployed condition uses `window_days`; no condition/med/allergy/vitals gates.
- All `snapshot_*` tables empty; the simulator's `PatientComposer` is the only
  context source. Hence input-contract-first sequencing, synthetic-only v1.

## Testing

- **Fact model:** interval construction across every partial-date form and every
  kind; the `TemporalEnd` disposition — `KNOWN`/`OPEN(assertedCurrentAt)`/`UNKNOWN`
  — with no fabricated `end = start`; the per-resource state-mapping table
  including `recurrence`/`relapse`, med `on-hold`/`draft`/`unknown`, missing status,
  and `CONFLICT`.
- **Three-valued overlap:** open vs closed vs unknown ends against each tier;
  partial-date straddle → `UNKNOWN`; an `OPEN` fact whose `assertedCurrentAt`
  precedes the window → `UNKNOWN`; the operator-taxonomy `UNKNOWN` policy
  (membership include; scalar + aggregate exclude), with `equals` **in membership**.
- **Validity:** refuted/entered-in-error/cancelled facts dropped regardless of
  horizon or author `status`.
- **Selection:** two labs in one window (10 then 12) — `less_than 11` uses the
  *latest*, not array order; `count_in_window` counts distinct `factId`.
- **Reproducibility:** replay with the pinned `evaluationAsOf` is identical; a moved
  wall clock does not change outcome; `ENCOUNTER` with no `encounterStart` →
  rejection/indeterminate, never `evaluationAsOf` substitution.
- **Version registry:** an unknown `temporalPolicyVersion` is a hard error; a
  session pinned to `legacy-v0` is unaffected by adding `v1`; `legacy-v0` output
  equals today's for the existing operator tests.
- **Trust boundary:** LIVE mode rejects caller-supplied validity/state/`evaluationAsOf`;
  SYNTHETIC accepts them; snapshot-vs-synthetic is exactly-one, not absence-inferred.
- **Contamination:** a stopped med / resolved / refuted fact does not alter DDI,
  completeness, or custom-rules output.
- **Evidence:** a satisfied **compound** gate persists per-condition evidence with
  `conditionId`, resolved bounds, `temporalMatch`, `selectedFactIds`, and
  `temporallyUnverified`.
- **Reachability parity:** reachability and gate evaluation agree via the shared
  `selectFacts` kernel on the same inputs.
- **Import/export:** `window_days → horizon` round-trip; both-supplied conflict
  rejected; pathway defaults round-trip through `temporal_defaults`; shared
  client/server conformance fixtures.

## Rollout — development order vs deployment order (finding 8)

**Development** (build + unit-test in this order; internal, no behavior activated):

1. Normalized fact model — `TemporalEnd`, state mapping, validity, three-valued
   overlap, operator taxonomy, selection kernel `selectFacts`. Pure functions.
2. Pinned clock — `EvaluationTemporalContext` persisted (single + multi-pathway);
   thread `evaluationAsOf`/`encounterStart` through traversal + retraversal +
   `evaluateCompound`; remove `Date.now()` defaults; `encounterStart` rule.
3. Immutable policy registry (`legacy-v0`, `v1`) + pure cascade resolver;
   `buildResolutionContext` loads `temporal_defaults`.
4. Evaluator applies validity → author dimensions via `selectFacts`; reachability
   calls the same kernel.
5. Input contract + trust modes + context assembler; `factId` synthesis;
   contamination isolation (DDI/scorers keep the filtered view).
6. Canonicalization stage + pathway-default persistence (backend + mirrored client,
   shared fixtures).
7. Snapshot mapper produces `NormalizedFact[]` (follows — tables empty).
8. Per-condition evaluation evidence on `NodeResult`.
9. Admin UI — row controls + caption; pathway-metadata panel; publish validation.

**Deployment / activation** (order in which behavior goes live):

1. Schema + storage (`temporal_defaults`, evidence columns) — inert.
2. **Shadow evaluation** — run `v1` alongside `legacy-v0`, record outcome diffs,
   change nothing the author sees.
3. Authoring + evidence surfaces ship, so authors can see/override/audit.
4. **Explicit activation of `v1`** as the default policy version.
5. Remove `legacy-v0` only after a compatibility window.

## Reviewer findings — round 2 disposition

| # | Finding | Disposition |
|---|---|---|
| P1-1 | Medication conflates order with exposure | **Accepted (scoped)** — §3 `medication_order` kind + "active medication order" label; exposure-episode modeling explicitly deferred (needs MedicationStatement/Administration/Dispense ingestion that doesn't exist). |
| P1-2 | `endKnown: boolean` too coarse; impure state mapping | **Accepted** — §2 `TemporalEnd` (KNOWN/OPEN(assertedCurrentAt)/UNKNOWN); §3 full `clinicalState` enum + `stateBasis` + per-resource mapping table replacing `isConditionActive` reuse. |
| P1-3 | `equals` misclassified | **Accepted** — §2/§4 membership {includes_code, equals, exists} / scalar {greater_than, less_than} / aggregate; numeric equality deferred to a future `value_equals`. |
| P1-4 | GraphQL contract bypasses validity boundary | **Accepted** — §8 explicit trust modes (LIVE derives + rejects caller fields; SYNTHETIC accepts; REPLAY re-reads); exactly-one snapshot/synthetic; required `factId`. |
| P1-5 | Pinned version must be executable | **Accepted** — §5 immutable `TEMPORAL_POLICIES` registry, unknown-version hard error, `legacy-v0` for existing sessions, single+multi persistence; §7 `buildResolutionContext` loads defaults; §1 `encounterStart` rule. |
| P1-6 | Evidence must be per-condition | **Accepted** — §9 `{aggregateResult, operator, conditions[]}` with `conditionId`. |
| 7 | Reachability needs the selection kernel | **Accepted** — §8 shared `selectFacts` pure function. |
| 8 | Rollout activates before auditability | **Accepted** — split into development order vs deployment/activation with shadow evaluation before the `v1` flip. |
| 9 | Compatibility language overstated | **Accepted** — Compatibility lists validity-drop, allergy active-filter, and windowed-lab `QUARTER` inheritance as `v1` changes; `legacy-v0` makes the diff shadow-testable. |
| 9b | Publish-warning wording | **Accepted** — §10 warns on any finite/non-lifetime horizon over typically-undated facts, not "shorter than ENCOUNTER." |

## Reviewer findings — round 3 disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | `legacy-v0` doesn't reproduce today through defaults alone | **Accepted** — §5 reframed: the current evaluator is the shadow baseline; `legacy-v0` not replayable through the new kernel; existing sessions non-retraversable; "zero behavior change" for DDI/scorers removed (§8, Compatibility). |
| 2 | `NormalizedFact` should be a discriminated union; `factId` synthesis collides | **Accepted** — §2 `FactBase \| StatefulFact \| LabFact` with `display`/`unit`/`provenance`/`observationStatus`/`issuedAt`/`validityBasis` and `MISSING_STATUS_FAIL_OPEN`; `factId` assigned + persisted at ingestion, not hashed; synthetic `assertedCurrentAt = stateAsOf ?? evaluationAsOf`. |
| 3 | Temporal / state / validity uncertainty still coupled | **Accepted** — §3 independent `FactDecision` axes + policies; evidence exposes `stateMatch`/`stateUnverified`/`recordValidity`/`validityUnverified` (§9); full `Observation.status` mapping; `active + abatement → CONFLICT`. |
| 4 | Import/canonicalization based on incorrect repo claim | **Rejected on premise, substance accepted** — `CODED_KEYS`/`ATTRIBUTE_KEYS` **do** exist in this branch (PR #48; `validator.ts:27/32`), so the plan extends the validator rather than creating one. The valid substance (value-validation, `conditionId`, traversing `condition`+`conditions[]`, schema-version decision) is captured in §6. |
| 5 | `encounterStart` has two possible behaviors | **Accepted** — §1 single contract: validate before traversal, reject session creation when an effective `ENCOUNTER` horizon lacks an anchor; reachability may report advisory indeterminate. |
| H | GraphQL/persistence surfaces, reachability clock, default ownership, acceptance criteria | **Accepted** — §11 (surfaces), §12 (reachability clock ownership), §7 (relational ownership wording), §13 (acceptance criteria). |

## Open Questions

None blocking. Deferred by explicit decision: institution/organization cascade
levels; vitals as a dated series; windowed operators in the UI; entry-criteria
temporal policy; medication *exposure* (vs order) semantics; numeric `value_equals`;
full `EvaluationSemantics` versioning for cross-kernel replay of old sessions (§5).
