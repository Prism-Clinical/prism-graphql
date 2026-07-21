# Pathway Temporal Horizon — Design

**Date:** 2026-07-21
**Status:** Approved design, ready for planning
**Repos:** `prism-graphql` (pathway-service), `prism-admin-dashboard` (authoring UI)
**Branch:** `feat/pathway-temporal-horizon`

## Problem

Pathway gate conditions have almost no control over *when* in a patient's history they look.

A `window_days` field exists on `CodedCondition` but is read by only three operators
(`count_in_window`, `trend_up`/`trend_down`, `delta_from_baseline`) at
`services/resolution/gate-evaluator.ts:292,348,392`. Every other operator —
including the plain membership and comparison operators that all deployed
pathways actually use — ignores time entirely. The admin dashboard exposes no
temporal control at all: there is no `window_days` anywhere in its source, and
its operator list offers only `includes_code`, `equals`, `exists`,
`greater_than`, `less_than`.

The result is that a gate asking "is hemoglobin below 11" matches a hemoglobin
drawn three years ago exactly as readily as one drawn today.

Separately, clinical currency is enforced today by a *hidden* filter:
`snapshot-context.ts` drops resolved conditions via `isConditionActive` and
fetches only `status = 'active'` medications, before the evaluator sees
anything. Authors cannot see this, cannot override it, and cannot express
"ever diagnosed, including resolved."

## Goals

- Give pathway authors explicit, layered control over the time window a gate condition examines.
- Make clinical-status filtering explicit and overridable instead of hidden in the data mapper.
- Keep the two dimensions — *when* and *what state* — separately expressible.
- Reproduce today's effective semantics via defaults, so nothing silently changes meaning.

## Non-Goals

- Exposing the windowed operators (`count_in_window`, `trend_*`, `delta_from_baseline`) in the authoring UI. Separate feature.
- Per-institution or per-organization horizon scoping. See "Cascade depth" below.
- Vitals horizons. See "Vitals are out of scope."
- ML/recommender consumption of horizons.

## Design

### 1. The temporal model

A **`Horizon`** is a first-class value in pathway JSON, expressed as a named
tier or a custom day count:

```
LIFETIME | YEAR | QUARTER | MONTH | WEEK | DAY | ENCOUNTER | { days: N }
```

- `LIFETIME` — no lower bound.
- `ENCOUNTER` — since `encounterStart` (the time anchor, passed in by the caller).
- The remainder are day-count sugar: 365 / 90 / 30 / 7 / 1.

Every form resolves to a `{ lowerBound, upperBound }` instant pair, so tiers and
the numeric escape hatch share one evaluation path and nothing downstream knows
which form the author used.

### 2. Matching is interval overlap

Every clinical fact projects to an interval `[start, end]`. It is in-window if
that interval **intersects** the horizon.

This matters because conditions and medications have *duration* while labs are
*instants*. A condition with onset five years ago that is still active must
satisfy a 90-day horizon; a naive point comparison against `onsetDateTime`
would wrongly exclude it.

Interval construction, per the verified schema (migrations 026 and 030):

| Type | start | end |
|---|---|---|
| condition | `onset_date_time` → fallback `recorded_date` | `abatement_date_time`; else **open** if `isConditionActive`; else `start` |
| medication | `authored_on` | `dispense_request->validityPeriod->end` (JSONB) if set; else **open** if `status='active'`; else `start` |
| allergy | `onset_date_time` → fallback `last_occurrence` → fallback `recorded_date` | **open** if clinical status active; else `last_occurrence` if present; else `start` |
| lab | `effective_date_time` → fallback `issued_date` | = start (instant) |

Note on allergies: `snapshot_allergies` (migration 030) carries both
`clinical_status` and `last_occurrence`. FHIR permits `resolved` allergies, so
allergies behave like conditions, not like instants.

**Undated facts** get interval `[-∞, +∞]`. They overlap every horizon and are
therefore always included, each carrying a `temporalConfidence: 'unverified'`
marker. This is fail-open, matching the existing posture of `isConditionActive`.

That marker surfaces on `GateEvaluationResult` (`services/resolution/types.ts:192`)
as a new optional `temporallyUnverified?: boolean` alongside the existing LLM
annotations, and the human-readable `reason` string notes which facts were
admitted without a usable date. A gate satisfied *only* by undated facts is the
case an author most needs to see in the simulator, since it will behave
identically under every horizon they try.

Date parsing must handle FHIR partial dates: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`,
and full instants. The date columns are `VARCHAR(30)`, not timestamps.

### 3. Time and state are orthogonal

Interval overlap answers *when was this true*. It structurally **cannot** answer
*is this true now* — a condition resolved yesterday overlaps `WEEK`, `MONTH`, and
`LIFETIME` alike.

Collapsing both into a single control is therefore wrong. `CodedCondition` gains
two independent fields:

```jsonc
{
  "field": "conditions",
  "operator": "includes_code",
  "value": "E11.9",
  "horizon": "LIFETIME",   // WHEN to look
  "status":  "active"      // WHAT STATE counts — active | inactive | any
}
```

`status` is a three-valued filter, not a tri-state flag: `active` admits only
facts whose interval is open, `inactive` admits only facts whose interval has
closed, and `any` admits both. The vocabulary is deliberately generic because
the per-type meaning differs — a closed interval is a *resolved* condition or
allergy, but a *stopped or completed* medication. `labs` have no clinical status
worth filtering, so `status` is rejected at validation for `field: "labs"`
rather than silently ignored.

Both resolve through the **same** cascade mechanism, so there is one piece of
machinery serving two dimensions.

`isConditionActive` becomes the predicate backing `status`, evaluated against the
interval's open/closed end at gate-evaluation time — no longer a pre-filter in
the mapper.

### 4. The cascade

Three levels, resolved per `(gate condition, data type)`:

```
SYSTEM_DEFAULT  →  PATHWAY  →  NODE
```

Level names are a strict subset of the existing scope vocabulary in migration
038 (`SYSTEM_DEFAULT | ORGANIZATION | INSTITUTION | PATHWAY | NODE`), so adding
`INSTITUTION` / `ORGANIZATION` later is additive and requires no restatement of
stored values.

**Cascade depth rationale.** The established `WeightCascadeResolver`
(`services/confidence/weight-cascade-resolver.ts`) uses all five levels, but
nothing in `services/resolution/` reads institution or organization scope today.
Three levels cover where the authoring value actually is without paying for
scoping machinery the resolution path does not yet use.

**Physical placement** follows the existing split — pathway JSON is the canonical
authoring format, so both author-facing levels live in the JSON and only the
platform baseline is data:

| Level | Lives in | Set by |
|---|---|---|
| `SYSTEM_DEFAULT` | table `pathway_horizon_defaults`, seeded by migration (one row per data type) | platform |
| `PATHWAY` | pathway JSON header: `default_horizons` / `default_statuses` | author |
| `NODE` | gate condition: `horizon` / `status` | author |

Resolution is a pure function —
`resolveHorizon(dataType, pathwayHeader, condition) → { lowerBound, upperBound }` —
with no DB access at gate-evaluation time. The defaults table is loaded once per
resolution session, like the existing weight matrix. This keeps
`gate-evaluator.ts` synchronous, which it currently is.

### 5. Platform defaults

| Data type | `horizon` | `status` | Meaning at default |
|---|---|---|---|
| conditions | `LIFETIME` | `active` | "currently has this diagnosis" |
| medications | `LIFETIME` | `active` | "currently on this med" |
| allergies | `LIFETIME` | `active` | unresolved allergy, ever recorded |
| labs | `QUARTER` | `any` | a 2-year-old culture shouldn't drive today's decision |
| vitals | `ENCOUNTER` (fixed) | n/a | out of scope — see below |
| narrative / attributes | `ENCOUNTER` (implicit) | n/a | derived from this encounter |

**These defaults reproduce today's effective semantics** — not by preserving a
hidden filter, but by making that filter an explicit, overridable default. An
author who wants "ever diagnosed, including resolved" writes `status: "any"`,
which is not expressible today.

Because the defaults are semantics-preserving by construction, **no grandfathering
is required.** The system is not yet in production; the correct long-term
foundation is preferred over migration-compatibility machinery. No pathway
carries a legacy header, and no compatibility flag exists.

### 6. `horizon` supersedes `window_days`

`window_days` already means "look back N days" and would otherwise be a second
field answering the same question, with an inevitable precedence rule.

The import validator normalizes `window_days: 90` → `horizon: { days: 90 }` and
drops the legacy key. `window_days` remains an accepted *input* alias in
`CODED_KEYS` but ceases to exist as a runtime concept; the three windowed
operators read the resolved horizon like every other operator.

The validator (`services/import/validator.ts`) uses a strict key allowlist —
`CODED_KEYS` / `ATTRIBUTE_KEYS` — so `horizon` and `status` must be registered
there or imports will reject them.

**No live data requires conversion:** zero deployed gate conditions use
`window_days` (verified against the AGE graph).

### 7. Data flow changes

The interval model describes what `snapshot-context.ts` must **start producing**.
Today that mapper discards precisely the data the model needs:

| Type | Currently selects | Currently drops |
|---|---|---|
| conditions | `code, code_detail, display, clinical_status, abatement_date_time`, then `.filter(isConditionActive)` | resolved conditions **dropped entirely**; no date on `CodeEntry` |
| medications | `WHERE status = 'active'` at SQL level | stopped/completed meds **never fetched**; `authored_on` unselected |
| allergies | `code` only | all date columns |
| labs | `code, value_quantity, value_unit, effective_date_time` | — |
| vitals | `observation_type, value` | `recorded_date` |

Three coordinated changes:

1. **Widen the context types.** `CodeEntry` and `LabResult` gain
   `interval: { start?: string; end?: string | null; open: boolean }` and a
   status marker, alongside the existing `date?` field — which is retained, so
   the windowed operators and their tests are untouched.

2. **Stop pre-filtering; carry endpoints.** The mapper drops
   `.filter(isConditionActive)` and the `status = 'active'` SQL predicate,
   selects the date columns it currently ignores, and calls `isConditionActive`
   to set `interval.open` rather than to decide inclusion.

3. **Filter explicitly at evaluation.** The widened context is narrowed by the
   resolved `horizon` + `status`, both author-visible.

This subsumes `active-context-filter.ts` rather than sitting beside it: "resolved
two years ago" fails a 90-day gate *because its interval ended*, not because a
separate filter dropped it. The module stays — it becomes an input to interval
construction instead of a parallel filter.

### 8. Vitals are out of scope

`PatientContext.vitalSigns` is `Record<string, unknown>` — an undated flat bag
with no per-value timeline to test an interval against. `vitals → ENCOUNTER` is
therefore already structurally true and needs no mechanism, but also cannot be
overridden until vitals become a dated series.

The UI shows the vitals horizon as fixed at Encounter with an explanatory
tooltip, rather than offering a control that silently does nothing.

### 9. Authoring UI

**One control per coded condition row.** `GateConditionEditor` renders each
condition as a row (field → operator → value → threshold); `horizon` and
`status` become additional segments, defaulting to **Inherit**:

```
Lab results ▾  less than ▾  718-7 (Hemoglobin)  11 g/dL │ Horizon: Inherit ▾
                                                         └─ resolves to: Quarter (90d) · from pathway default
```

The horizon dropdown offers the named tiers plus **Custom…** (numeric day
input), matching the JSON's two forms exactly. The resolved-value caption is
essential: in a cascade, the author must see *what they will actually get* and
*which level supplied it* without leaving the row. It is computed client-side
from the same three inputs the backend resolver uses.

**Pathway header editor.** `default_horizons` / `default_statuses` get a section
in `PropertiesPanel` when the pathway root is selected — one row per data type,
each defaulting to Inherit (from platform).

**Attribute conditions get no horizon control.** `AttributeCondition` reads
encounter-derived attributes (`patient.trimester`, transcript-derived values)
with no independent timeline. They remain pinned at `ENCOUNTER` implicitly. If
an attribute later becomes historical, that is when it earns the control.

**Publish validation.** `PublishValidationModal` gains one check: a horizon
shorter than `ENCOUNTER` on a data type whose facts are typically undated will
match everything via the `[-∞,+∞]` fail-open rule, so publishing warns rather
than silently misleading the author.

## Current Deployed State (verified 2026-07-21)

Queried against the live AGE graph `clinical_pathways` and the `snapshot_*`
tables on the production host:

- **41 `Gate` nodes; 11 carry conditions.**
- Conditions exist in **two dialects simultaneously**:
  - Attribute dialect: `{"attribute": "lab.hemoglobin", "operator": "LT", "value": 11}` — uppercase operators the engine does not read.
  - Coded dialect: `{"field": "labs", "operator": "less_than", "value": "718-7", "system": "LOINC", "threshold": 11}`
- The only **working** coded gates are two hemoglobin (LOINC 718-7) gates for anemia staging, thresholds 11 and 10.5.
- **No** deployed condition uses `window_days`.
- **No** vitals, conditions, medications, or allergies gates exist.
- All four `snapshot_*` tables are **empty** — there is no clinical data on the host. The encounter simulator's `PatientComposer` is the only source of patient context.

Effect of this design on live behavior: the two hemoglobin gates adopt
`labs → QUARTER`, i.e. "hemoglobin in the last 90 days" instead of "any
hemoglobin ever recorded." This is the clinically correct reading.

## Testing

Because the snapshot tables are empty, the simulator is the only integration
surface:

- **Unit, table-driven:** `resolveHorizon` and `resolveStatus` across all three cascade levels; interval construction across every FHIR partial-date form (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`, full instant, null) and every type in the interval table.
- **Interval overlap:** open-ended vs closed intervals against each named tier and custom day counts; the `[-∞,+∞]` undated fail-open path.
- **Semantics-preservation:** assert the two live hemoglobin gates and the existing `count_in_window` / `trend_*` / `delta_from_baseline` tests produce identical output under platform defaults, confirming `window_days` normalization is lossless.
- **Simulator scenarios:** resolved-condition and stopped-medication cases, which cannot exist in the DB today and are the main behavioral risk of the widened context.

## Rollout Order

1. Widen context types (`CodeEntry`, `LabResult`) with interval + status.
2. `snapshot-context.ts` stops pre-filtering, carries intervals and status.
3. `pathway_horizon_defaults` table + seed migration.
4. Cascade resolver for `horizon` and `status`.
5. `gate-evaluator.ts` applies horizon + status to all operators; `window_days` reads through the resolved horizon.
6. Import validator: register `horizon` / `status` keys, normalize `window_days`.
7. Admin dashboard: row controls, header section, resolved-value caption, publish validation.

Steps 1–2 are behavior-preserving only once step 5 lands; they should be
developed and merged together, or the widened context will reach the evaluator
unfiltered.

## Open Questions

None blocking. Deferred by explicit decision: institution/organization cascade
levels, vitals as a dated series, windowed operators in the UI.
