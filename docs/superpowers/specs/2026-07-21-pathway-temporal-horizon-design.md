# Pathway Temporal Horizon — Design

**Date:** 2026-07-21 (revised 2026-07-26 after architecture review)
**Status:** Revised after architecture review — ready for planning
**Repos:** `prism-graphql` (pathway-service), `prism-admin-dashboard` (authoring UI)
**Branch:** `feat/pathway-temporal-horizon`

## Revision note (2026-07-26)

An architecture review of the 2026-07-21 draft raised twelve findings. Ten are
accepted and folded into this revision; the specific file:line claims were
verified against the current worktree before acceptance. Two are handled as
deliberate pushbacks, recorded inline and summarised under
"Reviewer findings — disposition."

The **core of the original design is unchanged**: time and clinical state are
separately expressible, ongoing facts match by interval overlap rather than
point events, and authors see the inherited policy through a cascade. What
changed is the *fact boundary* and the *session-time contract* — the two areas
the review correctly identified as the source of most downstream risk. Three
structural additions now precede the cascade work:

1. A **pinned evaluation clock** persisted per session (§1).
2. A **normalized fact model** with explicit interval precision, an unfabricated
   end, and three-valued overlap (§2).
3. A **record-validity safety filter**, orthogonal to author-facing state (§3),
   plus **operator-specific fact selection** (§4).

A load-bearing fact about the deployment shapes the sequencing throughout: **all
`snapshot_*` tables are empty, there is no clinical data on the host, and the
principal resolution path builds context from GraphQL `CodeInput`
(code/system/display only) — the encounter simulator is the only live source of
patient context.** The original §7 concentrated its data-flow work in
`snapshot-context.ts`, which is only on the `MatchedPathway.reachability` read
path, not the resolution path. This revision retargets that work to the input
contract and a shared context assembler (§8).

## Problem

Pathway gate conditions have almost no control over *when* in a patient's history they look.

A `window_days` field exists on `CodedCondition` but is read by only three operators
(`count_in_window`, `trend_up`/`trend_down`, `delta_from_baseline`) at
`services/resolution/gate-evaluator.ts`. Every other operator — including the
plain membership and comparison operators that all deployed pathways actually use
— ignores time entirely. The admin dashboard exposes no temporal control at all.

The result is that a gate asking "is hemoglobin below 11" matches a hemoglobin
drawn three years ago exactly as readily as one drawn today — and, because scalar
comparison selects the first array match (`gate-evaluator.ts:70`, `.find(...)`)
over labs loaded with no `ORDER BY` (`snapshot-context.ts:74`), it does not even
reliably pick *which* hemoglobin.

Separately, clinical currency is enforced today by a *hidden* filter:
`snapshot-context.ts` drops resolved conditions via `isConditionActive` and
fetches only `status = 'active'` medications, before the evaluator sees anything.
Authors cannot see this, cannot override it, and cannot express "ever diagnosed,
including resolved."

And record *validity* is never checked at all: FHIR `refuted` /
`entered-in-error` conditions and allergies, and `cancelled` /
`entered-in-error` observations, can satisfy gates today, because the active
filter looks only at `clinical_status`, not `verification_status` /
`Observation.status`.

## Goals

- Give pathway authors explicit, layered control over the time window a gate condition examines.
- Make clinical-status filtering explicit and overridable instead of hidden in the data mapper.
- Keep the three dimensions — *when*, *what clinical state*, and *is the record trustworthy* — separately expressible, with validity as a non-overridable platform safety filter.
- Make gate evaluation **reproducible**: the same session, retraversed later, must produce the same result.
- Reproduce today's effective semantics where doing so is correct, and **version any place it deliberately does not** (labs; see Compatibility).

## Non-Goals

- Exposing the windowed operators (`count_in_window`, `trend_*`, `delta_from_baseline`) in the authoring UI. Separate feature.
- Per-institution or per-organization horizon scoping. See "Cascade depth."
- Vitals horizons. See "Vitals are out of scope."
- ML/recommender consumption of horizons.
- Applying temporal/state policy to **pathway selection / entry criteria** (v1 applies it only after selection; see Compatibility).
- Runtime editing of platform-default horizons (constants, not a table; see §5).

## Design

### 1. A pinned evaluation clock (new — addresses review finding 6)

Every temporal computation needs a single, persisted clock. Today it does not
have one: `evaluateGate` defaults `now` to `Date.now()`
(`gate-evaluator.ts:743`), and both traversal (`traversal-engine.ts:271-274`)
and retraversal (`retraversal-engine.ts:151-160`) pass `undefined`, so each
invocation re-reads the wall clock. A session retraversed a week later can
therefore change outcome with identical pathway and patient data — any
`window_days`/horizon operator measures age against "now."

A session gains an **`EvaluationTemporalContext`**, stamped once at
`startResolution` and reused verbatim by every initial traversal, provider-answer
retraversal, scenario replay, reachability computation, and explanation:

```ts
interface EvaluationTemporalContext {
  evaluationAsOf: string;          // ISO instant — the clock for ALL relative computation
  encounterStart?: string;         // anchor for the ENCOUNTER horizon
  snapshotId?: string;             // pinned clinical snapshot, when real-patient
  snapshotCapturedAt?: string;
  timezone: 'UTC';
  temporalDefaultsVersion: string; // which platform-default constant set applied (§5)
}
```

`Date.now()` is read exactly once — to stamp `evaluationAsOf` at session creation
when the caller supplies none — and never again at evaluation time. `evaluateGate`
receives `evaluationAsOf` from the traversal boundary instead of defaulting.

### 2. The temporal model and interval matching

A **`Horizon`** is a first-class value in pathway JSON, a named tier or a custom
day count:

```
LIFETIME | YEAR | QUARTER | MONTH | WEEK | DAY | ENCOUNTER | { days: N }
```

- `LIFETIME` — no lower bound.
- `ENCOUNTER` — since `encounterStart` from the `EvaluationTemporalContext`.
- The remainder are day-count sugar (365 / 90 / 30 / 7 / 1), measured back from `evaluationAsOf`.

Every form resolves to a `{ lowerBound, upperBound }` instant pair, so tiers and
the numeric escape hatch share one evaluation path.

**Every clinical fact projects to an interval**, and matching is interval
overlap — because conditions, medications, and allergies have *duration* while
labs are *instants*. The interval carries explicit precision and an **unfabricated
end** (addresses review finding 3):

```ts
interface TemporalBound { value: string; precision: 'year' | 'month' | 'day' | 'instant'; }
interface FactInterval {
  start?: TemporalBound;
  end?: TemporalBound;
  endKnown: boolean;   // false = ongoing OR unknown. NEVER set end = start to invent a resolution.
}
```

Interval construction, per the verified schema (`snapshot_conditions`/
`snapshot_lab_results`/`snapshot_medications` in migration 026, `snapshot_allergies`
in migration 030; all date columns are `VARCHAR(30)` FHIR strings, not timestamps):

| Type | start | end | `endKnown` |
|---|---|---|---|
| condition | `onset_date_time` → `recorded_date` | `abatement_date_time` if present | `true` iff `abatement_date_time` present; otherwise `false` (ongoing or unknown) |
| medication | `authored_on` | a real end date only if one exists | `false` unless a real end exists — **not** `dispenseRequest.validityPeriod.end` |
| allergy | `onset_date_time` → `recorded_date` | a real resolution date only if one exists | `false` unless one exists — **not** `last_occurrence` |
| lab | `effective_date_time` → `issued_date` | = start | `true` (instant) |

Two FHIR-correctness corrections from the review, both accepted:

- **`MedicationRequest.dispenseRequest.validityPeriod`** is the window in which
  the prescription may be *dispensed*, not the period the patient was *taking* the
  drug, and `MedicationRequest.status` is the order state, not proof of exposure.
  Neither is used as an interval end. An active prescription whose dispensing
  window closed is **not** thereby "inactive."
- **`AllergyIntolerance.lastOccurrence`** is the last known *reaction*, not a
  resolution date. It is retained as a separate signal, not used to close the
  interval. A resolved allergy with an old last reaction does **not** appear to
  have ended on the reaction date.

An `inactive` condition with no `abatement_date_time` therefore has
`endKnown: false` — its *state* is inactive (§3) but its *end time* is unknown; the
model never invents `end = start`.

#### Three-valued overlap (addresses review findings 5 and 8)

Overlap of a fact interval against a horizon returns **three** values, not a boolean:

```
MATCH     — overlap is established.
NO_MATCH  — non-overlap is established.
UNKNOWN   — available timestamps / precision cannot decide.
```

`UNKNOWN` arises when a fact is undated, or when a FHIR partial date straddles a
horizon boundary — e.g. `2026` (year precision) against a horizon that begins in
mid-2026. Partial dates are expanded to their precision range
(`2026` → `[2026-01-01, 2026-12-31]`); if that range straddles the bound, the
result is `UNKNOWN` rather than a fabricated `2026-01-01`.

How `UNKNOWN` resolves is **operator-specific**, and this is what makes
`window_days → horizon` faithful rather than a silent behavior change:

| Operator class | `UNKNOWN` → |
|---|---|
| membership (`includes_code`, `exists`) | **include** (fail-open) — matches "ever recorded" intent, and the existing `isConditionActive` fail-open posture |
| scalar comparison (`greater_than`, `less_than`, `equals`) | **exclude** (fail-closed) — a quantitative threshold must not fire on an undated value |
| windowed (`count_in_window`, `trend_*`, `delta_from_baseline`) | **exclude** (fail-closed) — matches today's behavior exactly |

The current windowed behavior is fail-**closed** for undated facts:
`gate-evaluator.ts:102` returns `false` when a finite window is set and the entry
has no date, and there is an explicit regression test for it
(`gate-evaluator-count-in-window.test.ts:178`). The original draft's blanket
"undated ⇒ `[-∞,+∞]` ⇒ matches every horizon" rule would have **inverted** that
and was not, as the draft claimed, a lossless normalization. The operator-specific
rule above preserves windowed semantics while keeping membership fail-open.

A fact admitted via a fail-open `UNKNOWN` carries a `temporallyUnverified` marker
that reaches the persisted result (§9).

### 3. Three dimensions: when, what state, is it valid

Interval overlap answers *when was this true*. It structurally cannot answer *is
this true now* — a condition resolved yesterday overlaps `WEEK`, `MONTH`, and
`LIFETIME` alike. And neither answers *is this record trustworthy* — a `refuted`
allergy overlaps and may be "active" by clinical status, yet must not satisfy a
gate.

So there are **three** dimensions, not two:

```jsonc
{
  "field": "conditions",
  "operator": "includes_code",
  "value": "E11.9",
  "horizon": "LIFETIME",   // WHEN to look        — author-selectable
  "status":  "active"      // WHAT CLINICAL STATE  — author-selectable: active | inactive | any
  // validity                is a PLATFORM filter — not author-selectable (below)
}
```

**`status` is derived from FHIR status fields, not from interval openness**
(correcting the original draft, which said `active` = open interval). The signal
is `clinical_status` (conditions/allergies) and `MedicationRequest.status`
(medications). `active` admits facts whose clinical state is current, `inactive`
admits resolved/stopped/completed, `any` admits both. Deriving state from the
status field — rather than from whether the interval happens to be open — keeps
the *when* and *what-state* dimensions genuinely independent, which is the whole
point of separating them. `isConditionActive` becomes the predicate backing
`status`, evaluated at gate time rather than as a mapper pre-filter.

`labs` have no clinical status worth filtering, so author-facing `status` is
rejected at validation for `field: "labs"`.

**Validity is a non-overridable platform safety filter** (addresses review
finding 4). Before any author dimension is applied, facts are dropped if the
record itself is untrustworthy:

| Type | Dropped when |
|---|---|
| condition | `verification_status` ∈ { `refuted`, `entered-in-error` } |
| allergy | `verification_status` ∈ { `refuted`, `entered-in-error` } |
| lab / vital | `Observation.status` ∈ { `cancelled`, `entered-in-error` } |
| medication | `status` = `entered-in-error` |

These columns already exist (`snapshot_conditions.verification_status`,
`snapshot_allergies.verification_status`, `snapshot_lab_results.status`,
`snapshot_medications.status`). Validity is orthogonal to `status`: it is *not*
author-selectable — labs get no author `status` but **do** get the validity
filter, closing the "admit an invalid lab" gap the original draft left open.

### 4. Operator-specific fact selection (addresses review finding 7)

Narrowing to a horizon does not by itself say *which* in-window fact a scalar gate
compares. Today `greater_than`/`less_than` take the first `.find()` match over an
unordered array — so "hemoglobin < 11 in 90 days" is array-order dependent, and
the motivating stale-lab fix is incomplete. Selection is defined per operator:

| Operator | Selects |
|---|---|
| `includes_code` / `exists` | any valid, in-window fact |
| `greater_than` / `less_than` / `equals` | **latest** valid, dated, in-window result (sort by effective time, descending) |
| `count_in_window` | count of **distinct source fact IDs**, valid + in-window |
| `trend_*` / `delta_from_baseline` | all valid, dated, in-window results sorted by effective time |

Where timestamps are unknown or conflicting, the result is indeterminate
(`UNKNOWN` per §2), never array-order dependent.

### 5. The cascade and platform defaults

Three levels, resolved per `(gate condition, data type)`:

```
SYSTEM_DEFAULT  →  PATHWAY  →  NODE
```

Level names are a subset of the migration-038 scope vocabulary
(`SYSTEM_DEFAULT | ORGANIZATION | INSTITUTION | PATHWAY | NODE`), so adding
`INSTITUTION`/`ORGANIZATION` later is additive. Nothing in `services/resolution/`
reads institution/organization scope today, so three levels are enough.

**Physical placement (revised — pushback on review finding 10):**

| Level | Lives in | Set by |
|---|---|---|
| `SYSTEM_DEFAULT` | **typed code constants**, versioned by `temporalDefaultsVersion` | platform (code change) |
| `PATHWAY` | pathway JSON header: `default_horizons` / `default_statuses`, persisted per §7 | author |
| `NODE` | gate condition: `horizon` / `status` | author |

The original draft put `SYSTEM_DEFAULT` in a mutable `pathway_horizon_defaults`
table. **We use typed constants instead.** The review itself notes the tradeoff
("If runtime editing is not required, typed code constants are safer and simpler
than a table"), and there is no requirement to edit platform defaults at runtime,
no admin surface for doing so, and the system is pre-production. A table would pull
in an `effectiveTemporalPolicies` read API, per-session policy snapshotting, cache
invalidation, missing/duplicate-row handling, and an audit trail for a
clinically-meaningful config change — none of which we need. The version *string*
is what a session pins (`EvaluationTemporalContext.temporalDefaultsVersion`), so
changing the constants is a normal, reviewable, deployable code change and an
in-flight session is unaffected.

Resolution is a pure function —
`resolveHorizon(dataType, pathwayHeader, condition) → { lowerBound, upperBound }`,
`resolveStatus(...)` alongside it — with no DB access at gate-evaluation time,
keeping `gate-evaluator.ts` synchronous.

Platform default constants (`temporalDefaultsVersion: "v1"`):

| Data type | `horizon` | `status` | Meaning |
|---|---|---|---|
| conditions | `LIFETIME` | `active` | "currently has this diagnosis" |
| medications | `LIFETIME` | `active` | "currently on this med" |
| allergies | `LIFETIME` | `active` | unresolved allergy, ever recorded |
| labs | `QUARTER` | n/a | a 2-year-old result shouldn't drive today's decision |
| vitals | `ENCOUNTER` (fixed) | n/a | out of scope — see below |
| narrative / attributes | `ENCOUNTER` (implicit) | n/a | derived from this encounter |

For conditions/medications/allergies these defaults reproduce today's hidden
filter as an explicit, overridable default. **For labs they do not** — labs move
from "any lab ever" (all operators currently ignore time) to `QUARTER`. That is a
deliberate breaking change, versioned as `v1`, not a semantics-preserving default;
see Compatibility.

### 6. `horizon` supersedes `window_days`; canonicalization is a distinct stage

`window_days` and `horizon` answer the same question, so keeping both means a
precedence rule. `window_days` is already an accepted key (`validator.ts:29`,
`CODED_KEYS`); the import path canonicalizes `window_days: 90` → `horizon: { days: 90 }`
and drops the legacy key, and the three windowed operators then read the resolved
horizon like every other operator.

The original draft implied the validator would "normalize and drop." It cannot:
`validatePathwayJson` returns a `ValidationResult` (`{valid, errors, warnings}`)
and is strictly non-transforming; the orchestrator persists the original JSON
(`import-orchestrator.ts:96` onward). So canonicalization is a **separate stage**
(addresses review finding 12):

```
parse → canonicalize → validate (canonical) → persist
```

The canonicalizer returns a **new** `PathwayJson`, renames `window_days` → `horizon`,
coerces types, **rejects** a condition that supplies *both* `window_days` and
`horizon`, and emits warnings for converted fields. `horizon` and `status` are
registered in `CODED_KEYS` (else the strict allowlist rejects them). The admin
dashboard validator has no such allowlist today (`src/lib/pathway-json/`), so the
same canonicalization is mirrored client-side. Import/export round-trip tests
cover it. No live data requires conversion — zero deployed gate conditions use
`window_days`.

### 7. Pathway-level defaults need real storage (addresses review finding 9)

Putting `default_horizons` in the JSON header is not enough on its own: the header
is decomposed on import and only known fields survive. `PathwayMetadata`
(`import/types.ts:14-29`) has no temporal fields; root-node creation serializes a
fixed field list (`graph-builder.ts:26`); `pathway_graph_index` (migration 038)
and the GraphQL `Pathway` type (`schema.graphql:54`) have no temporal column; and
import reconstruction rebuilds only known fields (`import-orchestrator.ts:906-917`),
so anything unknown is dropped from diffs and version creation.

Storage path, end to end:

1. `PathwayMetadata` gains `default_horizons?` / `default_statuses?`.
2. A `temporal_defaults JSONB` column on `pathway_graph_index`.
3. The `Pathway` GraphQL type exposes it.
4. Root creation and import reconstruction read/write it, so it round-trips.

Do **not** store a second copy on the AGE root node unless a consistency mechanism
is defined; the JSONB column on the index is the single source.

### 8. Data flow — retarget to the input contract and a shared assembler (addresses review findings 1 and 2)

The original §7 rewrote `snapshot-context.ts`. But that loader is only wired to
`MatchedPathway.reachability` (`Query.ts:846`); the resolution mutations build
`PatientContext` **exclusively from GraphQL input** — `startResolution`
(`resolution.ts:88-98`) and `startMultiPathwayResolution`
(`multi-pathway-resolution.ts:526-538`) — and `CodeInput` (`schema.graphql:1130`)
carries only `code`, `system`, `display`. As written, snapshot rows would become
temporally rich while production resolution and most simulator input stayed
temporally empty.

Two coordinated changes:

**(a) Extend the input contract.** `CodeInput` (and `PatientContextInput`) gain
optional `date`, interval endpoints, `clinicalState`, `validity`, and `sourceId`;
the session input gains `evaluationAsOf` / `encounterStart` (§1). `LabResultInput`
already carries `date`. Without this the feature is untestable through the actual
resolution path, since the simulator is the only live context source.

**(b) One context assembler, used everywhere.** A single assembly service produces
the normalized fact representation for `startResolution`,
`startMultiPathwayResolution`, matched-pathway reachability, scenario replay, and
confidence preview. Real-patient resolution loads a pinned snapshot (by
`snapshotId`) when no synthetic context is supplied; synthetic input and saved
scenarios use the same normalized representation. The snapshot mapper stops
pre-filtering (drops `.filter(isConditionActive)` and the `status='active'` SQL
predicate) and instead carries intervals + clinical state + validity — but this is
**step 7 of rollout**, after the input contract, because the tables are empty and
the simulator is the live surface.

**Contamination isolation (the blocking finding).** `PatientContext` is **not**
gate-private. DDI screens every med/allergy in it with no status filter
(`ddi-pass.ts:100-114`); the completeness scorer counts raw arrays
(`data-completeness.ts:124-133`); custom-rules unions all condition/med/allergy/lab
codes (`custom-rules.ts:87-94`). If resolved conditions, stopped meds, and resolved
allergies were placed into the shared arrays, a stopped med could trigger a DDI
suppression, a refuted allergy could block treatment, and a resolved condition
could inflate match confidence — and this stays broken regardless of gate
filtering.

The fix keeps the blast radius minimal rather than rebuilding the whole boundary:
the **widened** fact list is what the **gate evaluator** consumes; DDI, confidence
scorers, and custom-rules keep receiving the **existing filtered projection**
(valid + currently-active) — status quo, zero behavior change for them. Concretely,
explicit projections off one fact store:

- `gateFacts(policy)` — selected per the gate's resolved horizon + status.
- `actionableMedications` / `actionableAllergies` — valid + active, for DDI.
- scorer projections that declare `current | historical | any`.

Each consumer migrates off the filtered contract deliberately, if ever. This is
the review's "keep the existing filtered `PatientContext` contract until each
consumer migrates" — scoped as a minimal parallel projection, not an up-front
refactor of every consumer.

### 9. Evaluation evidence must persist on satisfied gates (addresses review finding 11)

Traversal stores a gate's reason only when it **fails** (`excludeReason`,
`traversal-engine.ts:363/675`); on success it stores nothing about *why*
(`traversal-engine.ts:282-294`). So a `temporallyUnverified` marker on a
*satisfied* gate — precisely the case an author most needs to see, since it
behaves identically under every horizon — would vanish from the persisted session
and the GraphQL response.

`NodeResult` gains structured evaluation evidence, populated on the **included**
branch as well as the excluded one:

```ts
interface GateEvaluationEvidence {
  effectiveHorizon: string;    horizonSource: 'SYSTEM_DEFAULT' | 'PATHWAY' | 'NODE';
  effectiveStatus?: string;    statusSource?: 'SYSTEM_DEFAULT' | 'PATHWAY' | 'NODE';
  selectedFactIds: string[];
  temporalMatch: 'MATCH' | 'NO_MATCH' | 'UNKNOWN';
  temporallyUnverified: boolean;
  inferredEndpoints?: { factId: string; which: 'start' | 'end' }[];
  evaluationAsOf: string;
  explanation: string;         // human-readable, notes any fail-open admissions
}
```

The simulator surfaces `temporallyUnverified` so the author sees a gate satisfied
only by undated facts.

### 10. Authoring UI

**One control per coded condition row.** `GateConditionEditor` renders each
condition as a row (field → operator → value → threshold); `horizon` and `status`
become additional segments defaulting to **Inherit**, with a resolved-value caption
showing *what the author will actually get* and *which cascade level supplied it*,
computed client-side from the same three inputs the backend resolver uses. The
horizon dropdown offers the named tiers plus **Custom…** (numeric days).

**Pathway header editor — a dedicated panel, not a node-props extension.**
`PropertiesPanel` returns `null` with no node selected (`PropertiesPanel.tsx:130`)
and the pathway root is deliberately dropped from the canvas
(`deserializer.ts:95-97`), so there is no node to hang pathway metadata on.
`default_horizons` / `default_statuses` (and the existing read-only title/version)
get a **new pathway-metadata panel** shown when nothing is selected or via an
explicit "pathway settings" affordance — one row per data type, each defaulting to
Inherit (from platform).

**Attribute conditions get no horizon control** — `AttributeCondition` reads
encounter-derived attributes with no independent timeline; pinned at `ENCOUNTER`
implicitly.

**Vitals** show a fixed "Encounter" horizon with an explanatory tooltip rather than
a control that does nothing (`PatientContext.vitalSigns` is an undated flat bag).

**Publish validation.** `PublishValidationModal` warns when a horizon shorter than
`ENCOUNTER` sits on a data type whose facts are typically undated (it would match
everything via the membership fail-open rule), and when both `window_days` and
`horizon` appear on one condition (canonicalization rejects it — surface it before
publish).

### Vitals are out of scope

`PatientContext.vitalSigns` is `Record<string, unknown>` — undated, with no
per-value timeline to test an interval against. `vitals → ENCOUNTER` is already
structurally true and cannot be overridden until vitals become a dated series.

## Compatibility

**Do not claim blanket semantics-preservation** (correcting the original draft).
The honest statement, per data type:

- **conditions / medications / allergies** — `LIFETIME` + `active` reproduces the
  hidden `isConditionActive` / `status='active'` filter as an explicit, overridable
  default. No behavior change. An author can now write `status: "any"` for "ever
  diagnosed, including resolved," which was previously inexpressible.
- **labs** — `QUARTER` is a **deliberate breaking change**. Today every operator
  ignores time for labs, so "hemoglobin < 11" means "any hemoglobin ever"; under
  `v1` it means "in the last 90 days." This is the clinically correct reading and
  the whole point of the feature, but it *is* a change and is versioned as
  `temporalDefaultsVersion: "v1"`, not grandfathered away. The two live hemoglobin
  gates (LOINC 718-7, thresholds 11 and 10.5) adopt it.

**Entry criteria are explicitly out of scope for v1.** Pathway *matching* filters
to active conditions in SQL (`session-store.ts:407`, via `activeConditionPredicate`),
so a resolved diagnosis is dropped before set-cover selection. v1 applies
temporal/state policy **only after** a pathway is selected (at gate evaluation);
the matcher keeps its current active-condition filter. A pathway that must reason
over a *resolved* diagnosis for **selection** would require pushing state policy
into the matcher and is deferred — recorded here as a decision, not a silent gap.

## Current Deployed State (verified 2026-07-21)

- **41 `Gate` nodes; 11 carry conditions.** Conditions exist in two dialects:
  an attribute dialect (`{"attribute": ..., "operator": "LT", ...}`, uppercase ops
  the engine does not read) and a coded dialect
  (`{"field": "labs", "operator": "less_than", "value": "718-7", ...}`).
- The only **working** coded gates are two hemoglobin (718-7) anemia-staging gates.
- **No** deployed condition uses `window_days`; **no** conditions/medications/
  allergies/vitals gates exist.
- All `snapshot_*` tables are **empty** — no clinical data on the host. The
  simulator's `PatientComposer` is the only source of patient context. This is why
  the input contract (§8a) leads the rollout and the snapshot mapper (§8b) follows.

## Testing

- **Unit, table-driven:** `resolveHorizon` / `resolveStatus` across all three
  cascade levels; interval construction across every FHIR partial-date form
  (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`, full instant, null) and every type; the
  no-fabricated-end rule for inactive-undated conditions, meds, and allergies.
- **Three-valued overlap:** open vs closed intervals against each tier and custom
  days; partial-date straddle → `UNKNOWN`; the operator-specific `UNKNOWN` policy
  (membership include, comparison/windowed exclude).
- **Validity filter:** `refuted` / `entered-in-error` conditions and allergies,
  `cancelled` / `entered-in-error` observations are dropped regardless of horizon
  or author `status`.
- **Fact selection:** two labs in one window (10 then 12) — assert `less_than 11`
  uses the *latest*, not array order.
- **Reproducibility:** a session replayed with the pinned `evaluationAsOf` produces
  identical output; the same session with a moved wall clock does **not** change.
- **Semantics-preservation (where claimed):** the existing `count_in_window` /
  `trend_*` / `delta_from_baseline` tests, and the condition/med/allergy defaults,
  produce identical output; confirm `window_days` canonicalization is lossless
  under the operator-specific `UNKNOWN` rule.
- **Versioned change (labs):** assert the two hemoglobin gates change from
  "any ever" to `QUARTER` under `v1`, as a documented diff.
- **Contamination regression:** a stopped med / resolved allergy in context does
  **not** alter DDI, completeness, or custom-rules output.
- **Persistence:** `temporallyUnverified` on a *satisfied* gate survives into the
  session and GraphQL response.
- **Import/export:** `window_days → horizon` round-trip; `window_days` + `horizon`
  conflict rejected; pathway `default_horizons` round-trips through the
  `temporal_defaults` column.
- **Platform-default version:** changing the constants does not affect an in-flight
  session pinned to the prior version.

## Rollout Order (revised — input-contract first)

1. **Normalized fact model** — interval + precision + `endKnown` + `clinicalState`
   + `validity`; three-valued overlap; operator-specific selection. Pure functions,
   unit-tested. No wiring yet.
2. **Evaluation clock** — `EvaluationTemporalContext` persisted on the session;
   thread `evaluationAsOf` / `encounterStart` through traversal + retraversal;
   remove the `Date.now()` default at the traversal boundary.
3. **Validity + author dimensions in the evaluator** — validity filter, then
   resolved `horizon` + `status`, applied to all operators; windowed operators read
   the resolved horizon.
4. **Typed platform-default constants** (versioned) + pure cascade resolver.
5. **Input contract + context assembler** — extend `CodeInput` /
   `PatientContextInput` + session `asOf`/`encounterStart`; single assembler across
   all entry points; contamination isolation via explicit projections (DDI /
   scorers keep the filtered view).
6. **Canonicalization stage + pathway-default persistence** — `parse → canonicalize
   → validate → persist`; register `horizon`/`status` keys; `temporal_defaults`
   JSONB column + `Pathway` type + import reconstruction; mirror canonicalizer
   client-side.
7. **Snapshot mapper** — stop pre-filtering; produce normalized facts
   (interval/state/validity). Follows, because tables are empty and the simulator
   is the live surface.
8. **Structured evaluation evidence** on `NodeResult` (satisfied + failed).
9. **Admin UI** — row horizon/status controls + resolved-value caption; dedicated
   pathway-metadata panel; publish validation.

Steps 1–4 are internal and behavior-preserving until step 5 wires real input.
Because the widened context reaches only the gate evaluator (step 5's projection
isolation), the DDI/scorer contamination risk never opens.

## Reviewer findings — disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | Widening `PatientContext` contaminates DDI/confidence/custom-rules | **Accepted** — §8 contamination isolation: widen only the evaluator's view; consumers keep the filtered projection. |
| 2 | `snapshot-context.ts` is not the principal path | **Accepted** — §8 retargets data-flow to the input contract + shared assembler. |
| 3 | State cannot be derived from interval openness | **Accepted** — §2 no-fabricated-end + §3 state from FHIR status fields; validityPeriod/lastOccurrence not used as ends. |
| 4 | Source-record validity missing | **Accepted** — §3 non-overridable validity platform filter. |
| 5 | Undated fail-open is not backward-compatible | **Accepted** — §2 three-valued overlap + operator-specific `UNKNOWN` policy; `window_days` normalization is lossless only under this rule. |
| 6 | No stable evaluation clock / anchor | **Accepted** — §1 `EvaluationTemporalContext`, pinned per session. |
| 7 | Horizon doesn't define which lab is compared | **Accepted** — §4 operator-specific selection (latest valid dated for comparisons). |
| 8 | FHIR partial dates need precision-aware bounds | **Accepted** — §2 precision on `TemporalBound`; straddle → `UNKNOWN`. |
| 9 | Pathway defaults have no round-trip storage | **Accepted** — §7 `temporal_defaults` JSONB + `Pathway` type + import reconstruction + §10 dedicated metadata panel. |
| 10 | Platform-default cascade lacks API/audit | **Pushback** — §5 use typed versioned constants, not a mutable table; no runtime-edit requirement, so the API/audit/cache machinery is unnecessary (the review offers this as the simpler alternative). |
| 11 | `temporallyUnverified` discarded for satisfied gates | **Accepted** — §9 structured evidence on the included branch. |
| 12 | Import needs a separate canonicalization stage | **Accepted** — §6 `parse → canonicalize → validate → persist`. Note: `CODED_KEYS`/`ATTRIBUTE_KEYS` **do** already exist in the backend validator (`validator.ts:27/32`) — the review's premise held only for the admin client, which is where the mirrored canonicalizer is added. |
| — | "Semantics-preserving / no grandfathering" contradicts labs lifetime→quarter | **Accepted** — Compatibility versions the lab change as `v1`; no blanket preservation claim. |
| — | Pathway matching SQL-filters to active conditions | **Accepted as scoped decision** — Compatibility: v1 applies policy only after selection; entry-criteria state policy deferred. |
| — | Full `ClinicalFactStore` + per-consumer projections | **Partial** — adopt the fact store + explicit projections (§8), but as a minimal parallel projection isolating the evaluator, not an up-front refactor of every consumer; consumers migrate deliberately over time. |

## Open Questions

None blocking. Deferred by explicit decision: institution/organization cascade
levels; vitals as a dated series; windowed operators in the UI; entry-criteria /
pathway-selection temporal policy.
