# Gate Condition Model: First-Class `field` (coded) + `attribute` (named)

**Date:** 2026-07-11
**Status:** Approved design — ready for implementation planning
**Repos:** `prism-graphql` (pathway-service engine), `prism-admin-dashboard` (authoring UI)
**Branch:** `feat/gate-condition-field-attribute-model`

## Problem

Pathway gate conditions are stored in the AGE `clinical_pathways` graph in a dialect the
resolution engine cannot read. All 5 currently-stored pathways author conditions as:

```json
{ "attribute": "lab.hemoglobin", "operator": "LT", "value": 7, "unit": "g/dL" }
```

But `evaluateCondition` (`apps/pathway-service/src/services/resolution/gate-evaluator.ts`)
reads `condition.field` (not `attribute`) and switches on snake_case operators
(`less_than`, not `LT`). Consequences observed:

1. **Crash (already hotfixed separately, branch `fix/gate-evidence-fieldsread-null`):**
   `field` is `undefined`, so `fieldsRead = [field]` became `[undefined]`, which is a null in
   the non-nullable `GateEvidence.fieldsRead` (`[String!]!`) → GraphQL 500. That hotfix is a
   belt-and-suspenders guard and is retained; this design closes the root cause.
2. **Silent mis-evaluation:** operator `LT`/`GTE`/`EQUALS`/`IN` matches no `switch` case →
   `default: "Unknown operator"` → `satisfied: false`. All 25 condition-bearing gates
   (16 patient_attribute + 9 compound; 34 conditions total) across all 5 pathways silently
   gate out. The reachability scorer (`reachability.ts`) is broken by the same mismatch.

**Root cause:** two addressing models exist in intent but only one (`field`) was ever
implemented, and no validation prevented the other (`attribute`) from being persisted.

## Goals

- Support **both** addressing models as first-class, split by data shape:
  - **Coded (`field`)** — terminology matching against coded arrays (conditions/medications/
    allergies by ICD-10/RxNorm/SNOMED) and numeric labs/vitals by code.
  - **Named attribute (`attribute`)** — derived/named scalars addressed by a dotted path
    (`patient.trimester`, `lab.hemoglobin`, `allergy.metronidazole`, `vitals.systolic_bp`).
- **One canonical internal schema.** No permanent dual-dialect normalizer. The SQL-style
  `LT`/`GTE`/`EQUALS`/`IN` dialect is *not* supported; it only lived in disposable data.
- **Enforce canonical at import** so the mismatch cannot recur silently.
- **Preserve human-readable code labels** as UI decorators that never affect evaluation.
- Fix the reachability scorer to understand both kinds.
- Reset & re-author the 5 disposable pathways to canonical (data is disposable per owner).

## Non-Goals

- Unit conversion for attribute values (documented via `unit`, not enforced in v1).
- A universal single "selector" abstraction (rejected — discards the useful coded-vs-derived
  distinction, largest blast radius).
- Migrating the existing stored conditions in place (they are disposable; re-author instead).

## Architecture — 3-Layer Model

`field` and `attribute` are not rivals. `attribute` is a **naming layer** on top of a shared
resolution substrate; some attributes bottom out in coded data, others in a derived-scalar bag.

```
Layer 3 — Comparison:   operators apply to a resolved typed value
                              ▲
Layer 2 — Resolution:   • Coded condition     → match codes in coded arrays / numeric by code
                        • Attribute condition → registry maps dotted name → resolver → typed value
                              ▲
Layer 1 — Substrate:    PatientContext
                        • coded arrays: conditions / medications / allergies / labs
                        • vitalSigns bag
                        • NEW patientAttributes bag: derived scalars (trimester, rh_factor)
```

`lab.hemoglobin < 7` and `{field:"labs", value:"718-7", less_than, threshold:7}` resolve to
the **same** evaluation — the attribute form is the ergonomic name, resolved via a curated
`lab.hemoglobin → LOINC 718-7` map against the same `labResults`. `patient.trimester in [1,3]`
has no code and reads the new `patientAttributes` bag.

## Layer 3 — Canonical Condition Schema

A condition is a **discriminated union**: exactly one of `field` or `attribute`.

```ts
// Coded: terminology matching on coded arrays, or numeric labs/vitals by code.
interface CodedCondition {
  field: 'conditions' | 'medications' | 'allergies' | 'labs' | 'vitals';
  operator: CodedOperator;
  value: string;              // FUNCTIONAL — code / wildcard pattern (or vitals key for numeric)
  system?: string;            // FUNCTIONAL — code-system filter (LOINC/ICD-10/RxNorm/SNOMED)
  threshold?: number;         // numeric comparand for greater_than/less_than on labs/vitals
  window_days?: number;       // time-shape params (unchanged from today)
  count_threshold?: number;
  min_points?: number;
  slope_threshold?: number;
  delta_threshold?: number;
  display?: string;           // DECORATOR — e.g. "Hemoglobin" for 718-7; UI-only, ignored by engine
  note?: string;              // DECORATOR — freetext; UI-only
}
type CodedOperator =
  | 'includes_code' | 'equals' | 'exists'
  | 'greater_than' | 'less_than'
  | 'count_in_window' | 'trend_up' | 'trend_down' | 'delta_from_baseline';

// Attribute: named/derived scalar, resolved via the Layer 2 registry.
interface AttributeCondition {
  attribute: string;          // FUNCTIONAL — dotted path: 'lab.hemoglobin', 'patient.trimester'
  operator: AttributeOperator;
  value: string | number | boolean | Array<string | number>;  // scalar, or list for `in`
  unit?: string;              // documented; no auto-conversion in v1
  display?: string;           // DECORATOR — UI-only
  note?: string;              // DECORATOR — UI-only
}
type AttributeOperator =
  | 'equals' | 'not_equals'
  | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal'
  | 'in' | 'exists';

type GateCondition = CodedCondition | AttributeCondition;   // compound gates hold conditions[]
```

**Rules:**
- **Structural discriminant** — exactly one of `field`/`attribute`; validator rejects both/neither.
- **One operator vocabulary, snake_case.** SQL-style codes are not canonical.
- **Same operator name, kind-appropriate semantics:** coded `equals` = exact code match;
  attribute `equals` = scalar equality. Coded `exists` = any matching entry in the bucket;
  attribute `exists` = attribute resolved to a non-null value. Unambiguous — dispatch is by kind.
- **Decorators never drive evaluation.** The engine reads only functional fields. A wrong/stale
  `display` cannot change a clinical decision.

## Layer 1 — Substrate change

One addition to `PatientContext`:

```ts
patientAttributes?: Record<string, number | string | boolean>;  // derived/named scalars
```

Holds only signals with **no natural code** (`trimester`, `rh_factor`, `gestational_age_weeks`).
Populated by the snapshot/composer layer that already builds the coded arrays. Coded labs/vitals
are **not** duplicated here.

## Layer 2 — Attribute Registry & name→code map

One resolver per namespace, keyed on the dotted path's first segment:

```ts
type ResolvedValue = number | string | boolean;
interface AttributeResolution { value: ResolvedValue | undefined; fieldsRead: string[]; }
interface AttributeResolver { resolve(ctx: PatientContext, rest: string): AttributeResolution; }

const REGISTRY: Record<string, AttributeResolver> = {
  lab:     …,   // 'lab.hemoglobin' → name→LOINC via map → numeric from labResults
  vitals:  …,   // 'vitals.systolic_bp' → vitalSigns[key] (custom.* supported)
  allergy: …,   // 'allergy.metronidazole' → name→code → boolean match in allergies
  patient: …,   // 'patient.trimester' → patientAttributes['trimester']
};
```

- Resolution: split `attribute` on first `.` → `{namespace, rest}` → dispatch. Unknown namespace
  or attribute → `value: undefined` → gate unsatisfied (never a crash).
- Every resolution returns explicit non-empty `fieldsRead` (attribute path for attribute
  conditions, bucket name for coded). This closes the null-`fieldsRead` root cause; the shipped
  hotfix guard remains as defense-in-depth.

**name→code map — curated DB table + in-memory cache** (mirrors the SNOMED→ICD-10 read-boundary
pattern):

```
pathway_attribute_code_map(
  attribute_name TEXT,     -- e.g. 'lab.hemoglobin'
  namespace      TEXT,     -- 'lab' | 'allergy'
  system         TEXT,     -- 'LOINC' | 'SNOMED' | ...
  code           TEXT,     -- '718-7'
  value_type     TEXT      -- 'number' | 'boolean' | 'string'
)
```

Seeded via migration. Cached in-memory in pathway-service. Exposed to the admin UI via GraphQL so
the authoring vocabulary and the resolver never drift.

## Evaluator dispatch

`evaluateCondition` splits:
- `evaluateCodedCondition` — today's operator implementations, unchanged (`getCodeEntries`,
  `getNumericValue`, time-shape operators).
- `evaluateAttributeCondition` — resolve via registry → typed value → a scalar comparison core
  implementing the `AttributeOperator` set.

Compound gates iterate either kind. Every branch returns non-empty `fieldsRead`.

## Import validation (enforcement)

`apps/pathway-service/src/services/import/validator.ts` gains condition validation:
- exactly-one-of `{field, attribute}`;
- operator ∈ the kind's allowed set;
- coded requires `value`; attribute's namespace must be registered;
- decorator keys restricted to the `{display, note}` allowlist (functional-field typos rejected
  rather than sailing through as "some decorator");
- condition schema carries a version tag.

Non-canonical conditions are **rejected at import**, not silently persisted.

## Reachability scorer

`reachability.ts` currently only reads `condition.field` and a subset of operators. Update it to
understand both kinds (sharing the schema and namespace knowledge) so "do we have data for this
gate?" and the data-gap hints work for attribute conditions.

## Authoring UI (admin-dashboard)

`GateConditionEditor` gains a **Coded / Attribute** toggle:
- **Coded** — today's field/operator/value/system/threshold form + a `display` label field.
- **Attribute** — attribute picker populated from the name→code table + the `patient.*` derived
  list (via GraphQL, so UI vocabulary == resolver vocabulary), scalar operator set, value/list input.
`CompoundGateEditor` composes N rows of either kind.

## Data reset

After engine/validation/UI land: remove the 5 disposable pathways and re-author canonical
versions. At minimum `anemia-in-pregnancy` re-authored canonically, used as the end-to-end proof
(severe-anemia gate must actually fire for a patient with a Hb value below threshold).

## Error handling

- Unknown namespace/attribute or missing `patientAttributes` → `undefined` → gate unsatisfied.
- Unknown operators / malformed conditions → caught at **import**, never at runtime.
- Decorator fields never affect evaluation.

## Testing

- **Unit:** each resolver (`lab`/`vitals`/`allergy`/`patient`); each operator per kind; the
  discriminated dispatch; validator accept/reject cases; name→code cache behavior.
- **Integration:** re-authored anemia pathway resolves correctly for a patient with a Hb value +
  trimester — severe-anemia gate fires; evidence trail carries meaningful `fieldsRead`.
- **Regression:** the null-`fieldsRead` test (`gate-evaluator-fields-read-null.test.ts`) stays green.

## Build order (feeds the implementation plan)

1. Canonical schema types + attribute registry + resolvers + evaluator dispatch (pathway-service).
2. Import validation.
3. `pathway_attribute_code_map` table + migration + seed + cache + GraphQL exposure.
4. Reachability scorer update.
5. `patientAttributes` substrate population (snapshot/composer).
6. Authoring UI (admin-dashboard).
7. Reset & re-author the disposable pathways; end-to-end proof.

## Dependency note

Branch is cut from `origin/main` (2575ed3), which does **not** include the null-`fieldsRead`
hotfix (`fix/gate-evidence-fieldsread-null`, PR pending). The two touch the same files
(`gate-evaluator.ts`, `care-plan-projection.ts`); this feature reimplements that area properly and
supersedes the hotfix. Expect a trivial merge reconciliation if the hotfix merges first.
