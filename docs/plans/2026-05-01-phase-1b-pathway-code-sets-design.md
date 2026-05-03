# Phase 1b — Set-Based Pathway Matching: Design

**Status:** Companion to `2026-05-01-phase-1b-pathway-code-sets-plan.md`. Plan describes WHAT to do and WHEN; this doc describes WHY each design choice is made and WHERE the trade-offs lie.

**Audience:** anyone who needs to either implement, review, or extend the Phase 1b matcher — not a how-to but a why-this-shape doc.

---

## 1. The problem in one paragraph

Today's matcher fires a pathway when any of the patient's codes (after Phase 1a ancestor expansion) appears in the pathway's flat `condition_codes` array. That semantic is a **disjunction**: ANY-OF matching. It works fine for single-condition pathways but lies about combination pathways. A pathway authored for "hypertension with type 2 diabetes" has its evidence base in *the combination*, but the flat array model fires it for patients with hypertension alone, diabetes alone, or both — as if the recommendation were valid for any of them. It isn't. Phase 1b makes the matcher honest about conjunction by replacing the flat list with explicit code sets, each set a conjunction (`ALL_OF`) of required codes, with disjunction across sets so a single pathway can still cover multiple scenarios.

---

## 2. Definitions

| Term | Meaning |
|---|---|
| **code set** | An ordered tuple of codes that must ALL be present (after ontology expansion of patient codes) for the set to match. Stored as `required_codes TEXT[]` in `pathway_code_sets`. |
| **set match** | A boolean: `required_codes <@ patient_expanded_codes`. True when every element of `required_codes` is in the patient's expanded code set. |
| **pathway match** | A boolean: there exists at least one code set in the pathway whose set match is true. Phase-1b pathway match is the disjunction across the pathway's code sets. |
| **patient expanded codes** | The patient's snapshot codes plus all ICD-10 ancestors via the `icd10_codes` ltree path (Phase 1a behavior). Computed once per `matchedPathways` call. |
| **ALL_OF semantics** | The set's match condition is conjunction over its codes. Phase 1b's only supported semantics. The schema reserves room for future variants but doesn't implement them. |

---

## 3. Set semantics, formally

### 3.1 The match predicate

For pathway `P` with code sets `S₁, S₂, ..., Sₙ` and patient `Q` with expanded code set `E(Q)`:

```
matches(P, Q)  ≡  ∃ i ∈ [1..n] : Sᵢ ⊆ E(Q)
```

This is disjunction-over-sets-of-conjunctions: the **disjunctive normal form** of "this pathway should fire."

### 3.2 Why DNF is the right shape

DNF is the canonical form for "if any of these conditions is fully met, fire." Every real-world clinical recommendation rule fits into it:

- "Patient has hypertension AND (diabetes OR CKD)" decomposes into two ALL_OF sets: `{HTN, DM}` and `{HTN, CKD}`.
- "First-line antihypertensive: thiazide if uncomplicated; ACE/ARB if comorbid diabetes" decomposes into the standalone-HTN set and the HTN+DM set in separate pathways (per the pathway-per-combination decision from earlier).

DNF specifically rules out OR-within-a-set ("X or Y"), which is rare in clinical conditions and easy to express as separate sets when needed.

### 3.3 Why we explicitly do NOT support OR-within-set

Three reasons:

1. **Authoring ambiguity.** "Match if patient has X or Y" with X and Y as sibling clinical concepts is rarely what authors mean. They usually mean "fire for X" and "fire for Y" — two distinct sets driving the same content. Forcing them into separate sets makes the author's intent explicit.
2. **Resolution-time semantics.** If a single set says `{X OR Y, Z}`, the resolution engine has to decide whether the matched code was X-via-disjunction or Y-via-disjunction, which affects downstream branching. Cleaner: have two sets, route to different entry nodes if needed.
3. **Index efficiency.** Postgres `<@` is a single GIN-friendly operator. Adding intra-set OR would require either a separate index strategy or query rewriting per set. Not worth the complexity for a feature that doesn't have demand.

The schema's `semantics` enum has only `'ALL_OF'` for v1 with the column header for future growth. If we ever genuinely need OR-within-a-set, we can add a second value rather than retrofit.

---

## 4. SQL deep-dive

The current `getMatchedPathways` SQL (post-Phase-1a) is reproduced here, then transformed for Phase 1b.

### 4.1 Current shape (Phase 1a)

```sql
WITH patient_codes AS (
  SELECT DISTINCT sc.code
  FROM snapshot_conditions sc
  JOIN patient_clinical_snapshots pcs ON sc.snapshot_id = pcs.id
  JOIN patients p ON pcs.epic_patient_id = p.epic_patient_id
  WHERE p.id = $1
    AND pcs.snapshot_version = (SELECT MAX(...))
    AND sc.code IS NOT NULL
    AND <active_condition_predicate>
),
expanded_codes AS (
  SELECT code FROM patient_codes
  UNION
  SELECT ancestor.code
  FROM patient_codes pc
  JOIN icd10_codes leaf ON leaf.code = pc.code
  JOIN icd10_codes ancestor ON leaf.path <@ ancestor.path
  WHERE ancestor.code != leaf.code
),
pathway_totals AS (
  SELECT pathway_id, COUNT(*) AS total_codes
  FROM pathway_condition_codes
  GROUP BY pathway_id
)
SELECT pgi.id, ..., array_agg(DISTINCT pc.code) AS matched_codes, pt.total_codes
FROM pathway_graph_index pgi
JOIN pathway_condition_codes pc ON pc.pathway_id = pgi.id
JOIN expanded_codes ON expanded_codes.code = pc.code
JOIN pathway_totals pt ON pt.pathway_id = pgi.id
WHERE pgi.status = 'ACTIVE' AND pgi.is_active = true
GROUP BY pgi.id, ..., pt.total_codes
ORDER BY pgi.title;
```

The match logic is the inner JOIN on `expanded_codes.code = pc.code`. The score is `array_length(matched_codes, 1) / total_codes`.

### 4.2 Phase 1b shape

```sql
WITH patient_codes AS (
  -- Same as Phase 1a, no change.
  SELECT DISTINCT sc.code FROM snapshot_conditions sc ... AND <active_condition_predicate>
),
expanded_codes AS (
  -- Same as Phase 1a, no change.
  SELECT code FROM patient_codes
  UNION
  SELECT ancestor.code FROM patient_codes pc JOIN icd10_codes ...
),
patient_code_array AS (
  -- New: aggregate expanded codes into a single array for set containment.
  SELECT array_agg(DISTINCT code) AS codes FROM expanded_codes
),
matched_sets AS (
  -- New: each row is one (pathway_id, set_id) pair where the set is satisfied.
  SELECT pcs.pathway_id, pcs.id AS set_id, pcs.required_codes, pcs.entry_node_id
  FROM pathway_code_sets pcs
  CROSS JOIN patient_code_array pca
  WHERE pcs.required_codes <@ pca.codes
),
pathway_set_totals AS (
  -- New: total set count per pathway, for the matchScore denominator.
  SELECT pathway_id, COUNT(*) AS total_sets
  FROM pathway_code_sets
  GROUP BY pathway_id
)
SELECT
  pgi.id, pgi.logical_id, pgi.title, pgi.version, pgi.category,
  pgi.status, pgi.condition_codes,
  COUNT(DISTINCT ms.set_id) AS matched_set_count,
  pst.total_sets,
  array_agg(DISTINCT element) AS matched_codes
FROM pathway_graph_index pgi
JOIN matched_sets ms ON ms.pathway_id = pgi.id
JOIN pathway_set_totals pst ON pst.pathway_id = pgi.id
CROSS JOIN unnest(ms.required_codes) AS element
WHERE pgi.status = 'ACTIVE' AND pgi.is_active = true
GROUP BY pgi.id, pgi.logical_id, pgi.title, pgi.version, pgi.category,
         pgi.status, pgi.condition_codes, pst.total_sets
ORDER BY pgi.title;
```

### 4.3 Line-by-line annotation

- **`patient_codes` and `expanded_codes` CTEs** are unchanged from Phase 1a. The active-condition predicate (Phase 1.5) and ancestor expansion (Phase 1a) both happen exactly as before. Phase 1b adds nothing to the patient-side computation.
- **`patient_code_array`** wraps the expanded codes into a single array via `array_agg`. This is the operand for the GIN containment check. Without this CTE we'd need an array constructor inline; pulling it into a CTE makes the plan more readable and may help the optimizer.
- **`matched_sets`** is the heart of the new model. `WHERE pcs.required_codes <@ pca.codes` reads as "every element of `required_codes` is in `pca.codes`" — Postgres array containment. With a GIN index on `required_codes`, this is fast even with many code-set rows.
- **`pathway_set_totals`** computes the denominator for the score. It scans `pathway_code_sets` once and groups by pathway. Equivalent in cost to the old `pathway_totals` CTE.
- The final `SELECT` joins through `matched_sets` (only pathways with at least one matched set survive) and aggregates back up to one row per pathway, with `matched_set_count` (numerator) and `total_sets` (denominator) as the two halves of the score.
- The `CROSS JOIN unnest(ms.required_codes)` flattens the matched sets' codes for `matched_codes` aggregation. The DISTINCT inside `array_agg` deduplicates across sets.

### 4.4 What the optimizer does with this

Postgres should plan as follows (verify with `EXPLAIN ANALYZE` once data is loaded):

1. **`patient_codes`** — index lookup on `snapshot_conditions(snapshot_id)` and `(patient_clinical_snapshots, epic_patient_id)`. Sub-millisecond on a single patient.
2. **`expanded_codes`** — UNION of patient_codes and the ltree ancestor JOIN. Phase 1a's GIST index on `icd10_codes.path` makes the `<@` ancestor lookup fast (~1ms per code).
3. **`patient_code_array`** — single aggregation, ~5-50 codes.
4. **`matched_sets`** — `<@` against GIN index on `required_codes`. Cardinality: the candidate set is N rows where N = number of pathway_code_sets rows. GIN scan filters fast; the surviving set is small (~5-20 sets typical).
5. **Final SELECT** — joins through ~20 matched_sets rows, group-aggregates into ~5-10 unique pathways. Microseconds.

Total query time estimate: 20-100ms for a typical primary-care patient. No worse than current at expected scale.

### 4.5 The non-obvious GIN behavior

`<@` (left contained-in right) on text arrays is supported by GIN with the `gin__int_ops` opclass or, more relevantly, the default `array_ops`. The index is built such that lookups by "find rows where this element is in the array" are O(log n). Containment of a multi-element array is O(k log n) where k is the candidate's array size — cheap.

The opposite direction (`@>` left contains right) also uses the same index. We don't need both directions; Phase 1b only uses `<@`.

---

## 5. Interaction with Phase 1a's ontology expansion

This is the design choice that makes Phase 1b clean: Phase 1a's `expanded_codes` produces the patient's full ancestor closure, and Phase 1b's `<@` containment operates on that closure. The interaction is associative and cleanly composable.

### 5.1 Worked examples

**Example 1 — single-code set, ancestor match.**
- Pathway requires `{E11}`.
- Patient has `E11.65`. Expanded = `{E11, E11.6, E11.65}`.
- `{E11} <@ {E11, E11.6, E11.65}` → TRUE. Match.

**Example 2 — two-code conjunction set, partial patient.**
- Pathway requires `{E11, I10}`.
- Patient has `E11.65` only. Expanded = `{E11, E11.6, E11.65}`.
- `{E11, I10} <@ {E11, E11.6, E11.65}` → FALSE (`I10` missing). No match.

**Example 3 — two-code conjunction set, ancestor + literal patient match.**
- Pathway requires `{E11, I10}`.
- Patient has `E11.65 + I10.9`. Expanded = `{E11, E11.6, E11.65, I10, I10.9}`.
- `{E11, I10} <@ expanded` → TRUE. Match.

**Example 4 — three-code conjunction, full deep-specific patient.**
- Pathway requires `{E11.65, I10.9, N18.3}`.
- Patient has the same. Expanded = `{E11, E11.6, E11.65, I10, I10.9, N18, N18.3}`.
- `{E11.65, I10.9, N18.3} <@ expanded` → TRUE. Match.

**Example 5 — pathway requires an ancestor; patient has only a sibling.**
- Pathway requires `{E11.65}`.
- Patient has `E11.0` (different child of E11). Expanded = `{E11, E11.0}`.
- `{E11.65} <@ {E11, E11.0}` → FALSE. No match.

This last case is exactly right: "diabetes with hyperglycemia" pathway shouldn't fire for a patient with diabetes-with-hyperosmolarity.

### 5.2 The asymmetry

Phase 1a expands the patient's codes with **ancestors**. Phase 1b's `<@` containment, when run on that expanded set, transitively grants pathways requiring ancestors of patient codes. But it does NOT grant pathways requiring descendants of patient codes (Example 5).

This asymmetry is correct:
- A patient with E11.65 satisfies a pathway requiring "any patient with E11" (ancestor — broader category satisfied by a more specific instance).
- A patient with E11 alone does NOT satisfy a pathway requiring E11.65 specifically (descendant — broader instance doesn't imply more specific subtype).

The asymmetry is the medical-coding asymmetry. Phase 1b gets it for free from the patient-side ancestor expansion + simple set containment.

### 5.3 If we needed bidirectional descent (we don't, for v1)

The schema's `scope` column is `'EXACT'` by default. `'EXACT_AND_DESCENDANTS'` and `'DESCENDANTS_OK'` are reserved for future use cases where a pathway's code set says "match patients who have my code OR any descendant of my code." Implementation would expand the pathway's `required_codes` with descendants at match time before the containment check. This effectively turns the comparison into "set containment after both sides are expanded."

We don't activate these scope values in v1. The default is `'EXACT'` which means the patient's expansion does all the lifting.

---

## 6. matchScore — three options compared with worked numbers

The matchScore is the headline value rendered in provider UI. It needs to be:
- Monotonic with "how good a match is this?"
- Explainable in one sentence
- Sensitive enough to differentiate similar-but-not-identical matches
- Easy for a UI to render (probably a 0-1 progress bar)

### 6.1 The setup for examples

Pathway A: 3 code sets.
- Set 1: `{E11}` (T2DM only)
- Set 2: `{E11, I10}` (T2DM + HTN)
- Set 3: `{E11, I10, N18}` (T2DM + HTN + CKD)

Patient profiles (after expansion):
- Patient X: only E11. Expanded = `{E11}`.
- Patient Y: E11.65 + I10. Expanded = `{E11, E11.6, E11.65, I10}`.
- Patient Z: E11.65 + I10.9 + N18.3. Expanded includes all 3 with their ancestors.

### 6.2 Option A: matched_set_count / total_sets

> "How many of the pathway's trigger conditions does the patient satisfy?"

| Patient | Sets matched | Total sets | Score |
|---|---|---|---|
| X | 1 | 3 | 0.33 |
| Y | 2 | 3 | 0.67 |
| Z | 3 | 3 | 1.00 |

**Strengths:**
- Direct mapping to the new model. The score is literally "how many of this pathway's clinical-scenario sets fired."
- Easy to explain to a provider: "This pathway covers 3 scenarios; you match 2 of them."
- Composes well across pathways — comparable scores across pathways with different shapes.

**Weaknesses:**
- Doesn't distinguish "matched the broad set" (Set 1) from "matched the specific combination set" (Set 3). Patient X with score 0.33 might really only match the broadest case; that's clinically less actionable than matching the specific combination.
- A pathway with one super-specific set and one trivial single-code set looks the same as two equally-balanced sets.

### 6.3 Option B: max specificity of matched sets

> "What's the most specific scenario this patient triggers?"

Score = `max(array_length(matched_sets[i].required_codes)) / max(array_length(all_sets[i].required_codes))`.

| Patient | Max matched set size | Max set size | Score |
|---|---|---|---|
| X | 1 (Set 1: {E11}) | 3 (Set 3) | 0.33 |
| Y | 2 (Set 2: {E11, I10}) | 3 | 0.67 |
| Z | 3 (Set 3: {E11, I10, N18}) | 3 | 1.00 |

**Same numbers** in this contrived example because the sets are nested. With non-nested sets, scores would diverge:

Pathway B: 2 sets.
- Set 1: `{E11}` (size 1)
- Set 2: `{F32.9, F41.1}` (depression + GAD; size 2; unrelated to Set 1)

Patient W has E11 only.
- Set 1 matches; Set 2 doesn't.
- Option A: 1/2 = 0.50.
- Option B: max matched size 1 / max overall size 2 = 0.50.

Patient V has F32.9 + F41.1.
- Set 1 doesn't; Set 2 matches.
- Option A: 1/2 = 0.50.
- Option B: max matched size 2 / max overall size 2 = 1.00.

Option B differentiates these patients; Option A does not. Option B says "Patient V hit the most-specific available trigger" while Patient W only hit the broad single-code trigger.

**Strengths:**
- Captures intuition that more-specific matches are clinically stronger signals.
- Good differentiator for pathways with mixed-specificity sets.

**Weaknesses:**
- Hard to explain succinctly to a provider. "Most specific match relative to most specific possible" is a mouthful.
- A pathway with one giant set (size 5) and one tiny set (size 1) makes the tiny-set match score badly even when it's the clinically meaningful trigger.

### 6.4 Option C: hybrid

> "Score is matched count, weighted by specificity."

`Σ (size(matched_set_i)) / Σ (size(all_set_i))`.

| Pathway B (Sets {E11}, {F32.9, F41.1}) | Patient W (E11) | Patient V (F32.9+F41.1) |
|---|---|---|
| Σ matched sizes | 1 | 2 |
| Σ all sizes | 1 + 2 = 3 | 1 + 2 = 3 |
| Score | 0.33 | 0.67 |

**Strengths:**
- Captures both "how many sets matched" and "how specific those matches are."
- Differentiates Patient V from Patient W.

**Weaknesses:**
- Even harder to explain than Option B. "Score is the fraction of total code-set surface area you cover" is correct but unintuitive.
- Sensitive to authoring patterns: a pathway with one 10-code mega-set dominates the denominator and squashes any other set's contribution.

### 6.5 Recommendation

**Land Option A.** Three reasons:

1. **Provider explainability is the top UX priority.** "You match 2 of 3 trigger conditions" is the cleanest one-line story. A score that requires a paragraph to justify will get ignored.
2. **It composes across pathways.** A 0.67 means the same thing on every pathway: roughly two-thirds of trigger conditions are met. Option B and C can mean very different things on different pathways depending on set sizes.
3. **It's the simplest to test and the easiest to debug.** Provider says "why is this pathway showing up?" — answer is "it has 3 trigger sets and you match this one."

If practice shows Option A is too coarse — providers can't differentiate similar pathways from each other — revisit. Cheap to add a `matchedSetSpecificity` field separately from the headline `matchScore` if needed.

### 6.6 What about Option B/C as supplementary fields?

Worth considering exposing `matchedSetCount`, `totalSets`, AND a separate `topMatchedSetSize` (size of the largest matched set) on the GraphQL `MatchedPathway`. Renderers can compose these into whichever score they prefer. This is the most flexible v1 — the headline `matchScore` is Option A, with the raw data behind it for other consumers.

---

## 7. Edge cases

### 7.1 Empty `required_codes` (zero-code set)
- Schema constraint: `CHECK (array_length(required_codes, 1) >= 1)`. Prevents at write time. No runtime handling needed.
- Why prohibit? A zero-element set is trivially `⊆` anything. It would match every patient and signal "no clinical condition required" — meaningless for a *condition*-driven pathway. If a pathway is genuinely codeless (e.g., universal preventive screening), it should be modeled differently.

### 7.2 Pathway with no code sets at all
- Post-migration: every active pathway gets at least one set (the backfill migration enforces this).
- Defensive: the `JOIN matched_sets ms ON ms.pathway_id = pgi.id` in the resolver SQL means a pathway with zero sets simply doesn't appear in results. No null/error path.

### 7.3 Patient with no codes
- `expanded_codes` is empty. `patient_code_array.codes` is `{}` (empty array).
- `required_codes <@ {}` is FALSE for any non-empty `required_codes`. No matches.
- Result: empty array of matched pathways. Correct.

### 7.4 Code in `required_codes` not present in `icd10_codes`
- Could be a SNOMED code, RXNORM code, or an ICD-10 code that hasn't been added to the hierarchy yet.
- Phase 1a's expansion only adds ancestors via the `icd10_codes` JOIN. Non-ICD-10 codes pass through unchanged in the patient set.
- Phase 1b's `<@` is on raw text arrays, system-agnostic. If the patient has the literal SNOMED code `'38341003'` and the pathway requires `{'38341003'}`, they match via literal element equality.
- **Caveat:** if the pathway requires a SNOMED code AND the patient has the equivalent ICD-10 code (e.g., SNOMED 38341003 = ICD-10 I10), they don't match today. Cross-system canonicalization is future work.

### 7.5 Duplicate codes in `required_codes`
- `required_codes <@ patient_array` is set-semantic; duplicates in either side don't affect the result. `[E11, E11] <@ [E11]` is TRUE.
- No need to enforce uniqueness via constraint. Authors who duplicate accidentally pay no penalty.

### 7.6 Pathway has a set that's a subset of another of its own sets
- E.g., pathway has `{E11}` AND `{E11, I10}`. Both are valid sets.
- A patient with E11+I10 matches both. `matched_set_count = 2`.
- Score (Option A) = 2/2 = 1.0.
- This is the right behavior. The pathway has chosen to express both "fires for diabetes alone" and "fires more strongly for diabetes + HTN" as separate scenarios. The matcher reports both fired.
- If authors want to enforce mutual exclusivity (one set OR the other, never both), that's a resolution-time concern, not a match-time one.

### 7.7 Code that's both in `required_codes` and a descendant of itself in another `required_codes` of the same set
- E.g., a poorly-authored set `{E11, E11.65}` (semantically: "must have E11 AND E11.65").
- Since E11.65 is a descendant of E11, having E11.65 also implies having E11 in the patient's expanded set.
- `{E11, E11.65} <@ patient_expanded` is TRUE iff E11.65 is in patient_expanded (which forces E11 to be there too via Phase 1a).
- Effectively, the redundant E11 is harmless. The set fires for any patient with E11.65 (and only those patients).
- Validator should warn (not error) on this pattern: "set contains both E11 and a descendant E11.65; E11 is redundant." No semantic problem; just authoring noise.

---

## 8. Behavior comparison table

How representative scenarios match under the three matchers. "—" means no match; **bold** is a behavior change worth flagging.

| Scenario | Pre-Phase-1a (flat) | Phase 1a (ancestor expansion) | Phase 1b (set-based) |
|---|---|---|---|
| Pathway `[E11]`, patient with E11 | match (matched: E11) | match (matched: E11) | match — set `{E11}` fires |
| Pathway `[E11]`, patient with E11.65 | — | match (matched: E11) | match — set `{E11}` fires |
| Pathway `[E11.65]`, patient with E11 | — | — | — |
| Pathway `[E11, I10]`, patient with E11 only | match (matched: E11) | match (matched: E11) | match — set `{E11}` fires (post-migration: 1 set per code) |
| Pathway `[E11, I10]`, patient with E11 + I10 | match (matched: E11, I10) | same | match — both single-code sets fire |
| Pathway with explicit code set `{E11, I10}`, patient with E11 only | match | match | **— no match (intended new behavior)** |
| Pathway with explicit code set `{E11, I10}`, patient with E11 + I10 | match | match | match |
| Pathway with sets `{E11}` AND `{E11, I10}`, patient with E11 only | match (treats as flat [E11, E11, I10]) | match | match — only the `{E11}` set fires; `matched_set_count = 1, total_sets = 2`, score = 0.5 |
| Pathway with sets `{E11}` AND `{E11, I10}`, patient with E11 + I10 | match | match | match — both sets fire; `matched_set_count = 2, total_sets = 2`, score = 1.0 |

The two **bold** rows are the Phase 1b semantic change. They only fire for **explicitly-authored conjunction sets**. Existing pathways migrated from the flat shape have one set per original code, which preserves old behavior. The new behavior is opt-in via the new JSON `code_sets` shape.

---

## 9. Performance characteristics

### 9.1 Indices that matter

```sql
CREATE INDEX idx_pcs_pathway ON pathway_code_sets(pathway_id);
CREATE INDEX idx_pcs_required_gin ON pathway_code_sets USING GIN (required_codes);
```

The GIN index on `required_codes` is the workhorse for `<@`. Without it, every match query is a full sequential scan of `pathway_code_sets`. With it, `<@` is roughly O(k log n) where k is the patient's expanded code set size and n is the total number of code sets in the table.

### 9.2 Realistic cardinality estimates

| Scale | Pathways | Sets/pathway avg | Total sets | Patient codes (expanded) |
|---|---|---|---|---|
| Today | ~50 | 1 (post-migration: 1 per existing code, so ~5) | ~250 | ~5-50 |
| Year 1 | ~500 | 2-3 | ~1500 | ~5-50 |
| Year 3+ | ~5000 | 3-5 | ~25,000 | ~5-50 |

Even at year 3 scale, a GIN-backed `<@` query on 25,000 sets with a patient code array of ~50 elements is in the low tens of milliseconds.

The GROUP BY at the end is small — only matched sets' pathways (10s, not 1000s) participate.

### 9.3 What could go wrong under load

**Slow patient-snapshot read.** The `patient_codes` and `expanded_codes` CTEs do a JOIN against `snapshot_conditions`, `patient_clinical_snapshots`, and `icd10_codes`. None of these are large but they're hit per query. Cache or memoize at the application layer if profiles show this dominating.

**Large patient code arrays.** A patient with 200+ snapshot conditions (rare but possible — chronic care patients with rich histories) yields a 200+ element expanded array. GIN containment is still fast but the `array_agg` and DISTINCT can dominate. Mitigation: cap the expansion or apply additional filtering (active conditions only — already done via Phase 1.5).

**Code sets with many codes.** A 20-code set is unusual but possible. `<@` is fast either way; the bigger concern is that authoring a 20-code conjunction is probably wrong. Validator should warn on sets with >5 codes — strong sign of authoring confusion.

### 9.4 Profiling gates

Before sub-phase 1b.4 cutover, run `EXPLAIN ANALYZE` on the new `getMatchedPathways` query against:
1. Realistic patient: ~10 active conditions, each a billable ICD-10 code.
2. Realistic library: 50+ pathways, each with 1-3 code sets.

Acceptable: total query time ≤ 100ms. If it's worse, identify the dominant cost (CTE materialization, GIN scan, GROUP BY) and tune.

---

## 10. Authoring implications

### 10.1 Two authoring paths post-1b

A pathway author can declare condition matching in either of two shapes in the JSON upload:

**Legacy shape** (still supported indefinitely):
```json
"condition_codes": [{"code": "E11", "system": "ICD-10"}, {"code": "I10", "system": "ICD-10"}]
```
Backend synthesizes one code set per code. Behavior matches Phase 1a exactly.

**New shape** (opt-in for combination authoring):
```json
"code_sets": [
  {"required_codes": [{"code": "E11", "system": "ICD-10"}, {"code": "I10", "system": "ICD-10"}],
   "description": "T2DM with hypertension"}
]
```
Backend writes one row per declared set. Conjunction semantics applied.

Both paths exist forever. The legacy shape is the natural default for single-condition pathways (no ambiguity) and remains valid even when authoring the most basic pathway.

### 10.2 What a "good" combination pathway looks like in the new shape

```json
"pathway": {
  "logical_id": "htn-management",
  "title": "Hypertension Management",
  "code_sets": [
    {
      "required_codes": [{"code": "I10", "system": "ICD-10"}],
      "entry_node_id": "stage-1-uncomplicated",
      "description": "Uncomplicated hypertension"
    },
    {
      "required_codes": [
        {"code": "I10", "system": "ICD-10"},
        {"code": "E11", "system": "ICD-10"}
      ],
      "entry_node_id": "stage-1-with-diabetes",
      "description": "HTN with type 2 diabetes — first-line ACE-I/ARB"
    },
    {
      "required_codes": [
        {"code": "I10", "system": "ICD-10"},
        {"code": "N18", "system": "ICD-10"}
      ],
      "entry_node_id": "stage-1-with-ckd",
      "description": "HTN with CKD — BP target 130/80"
    }
  ]
}
```

This is the use case the user described in the early conversation. Each set drives a distinct entry point in the pathway graph. Patients with just I10 enter at the uncomplicated entry; patients with I10+E11 enter at the diabetes-aware branch.

### 10.3 What about pathway authors who don't migrate?

They don't have to. The legacy `condition_codes` shape produces 1-set-per-code under the hood, giving them exactly the Phase 1a behavior. Phase 1b is invisible to them.

---

## 11. Migration semantic guarantees

The backfill migration (sub-phase 1b.2) splits each existing `condition_codes` array into N single-code sets. This is the **only** way to preserve Phase 1a's behavior exactly. Any other splitting changes match semantics.

Specifically:
- A pathway with `condition_codes: [E11, I10]` becomes two sets: `{E11}` and `{I10}`.
- Patient with E11 only matches `{E11}`. Score = 1/2 = 0.5.
- Patient with I10 only matches `{I10}`. Score = 1/2 = 0.5.
- Patient with both matches both. Score = 2/2 = 1.0.

Compare to the explicit conjunction (`[{E11, I10}]`):
- Patient with E11 only: no match.
- Patient with I10 only: no match.
- Patient with both: match. Score = 1/1 = 1.0.

The legacy migration preserves "fires for any code" disjunction. Authors who want conjunction must upload the new JSON shape explicitly.

### 11.1 What's intentionally NOT preserved

The matchScore numeric values for legacy pathways will shift. Today's score is `matched_codes / total_codes` (where total_codes is number of distinct condition codes); under Phase 1b it becomes `matched_set_count / total_sets`. For 1-set-per-code legacy shape, these compute to the same number — but that's a coincidence of the migration choice, not a guarantee.

If someone authored a flat `condition_codes: [E11, E11.65]` (with both ancestor and descendant in the list — bizarre but possible), today's score for a patient with E11.65 is 1/2 = 0.5 (E11.65 matches itself; E11 doesn't appear in patient codes). Phase 1a expansion changes this: E11.65 → {E11, E11.6, E11.65}, so both pathway codes match → score 2/2 = 1.0. Phase 1b post-migration: two sets `{E11}` and `{E11.65}`, both match for E11.65 patient → 2/2 = 1.0. Same number. This is fine — it just means scores can drift by small amounts under Phase 1a even before Phase 1b lands.

---

## 12. Open questions (deeper than the plan's open questions)

The plan-of-attack's §11 lists open questions tactically; this section frames them with the design context.

### 12.1 Code system encoding in `required_codes`

Three options:
- **(a) Bare codes + sibling system column.** Each row in `pathway_code_sets` has a `system VARCHAR(10)` column. Codes are bare (`'E11'`). Match logic canonicalizes patient codes to the same system before comparing.
- **(b) Prefixed codes.** Codes stored as `'ICD-10:E11'`. No system column. Match is straightforward set containment over fully-qualified strings.
- **(c) JSONB code objects.** Codes are `{"code": "E11", "system": "ICD-10"}`. Most flexible, slowest to index.

**Recommend (a).** Reasons:
1. Matches the current `pathway_condition_codes` convention (system as a column, not as a prefix).
2. Allows `<@` GIN containment to work over text arrays (Postgres's most efficient containment path).
3. Patient-side canonicalization is straightforward — when building the patient's expanded array, filter to codes matching the set's system before comparison.

The downside of (a) is sets can't mix systems (a set is always all-ICD-10 or all-SNOMED). Plausibly fine — most clinical conjunctions are within one system. If we need cross-system conjunctions later, that's a Phase 2+ feature anyway (cross-system canonicalization).

(b) is appealing for cross-system but the set-system constraint loss isn't actually a benefit — most authors will work within one system per pathway.

(c) is the academic best answer but introduces real query plan complexity. JSONB containment via `@>` is slower than text array containment. Not worth it.

### 12.2 matchScore formula — settled?

§6.5 recommends Option A. **The plan's open question is whether to also expose Option B/C-relevant fields on `MatchedPathway` (matchedSetCount, totalSets, topMatchedSetSize).** Mild recommendation: yes, expose the raw data fields; let the headline `matchScore` use Option A. Clients that want different scoring logic can compute it from the raw counts.

### 12.3 Should the GraphQL `MatchedPathway` change?

Two trade-offs:
- **Backwards compat.** `matchScore` and `matchedConditionCodes` are existing fields. Changing semantics breaks clients silently.
- **Honest signal.** Old fields lose meaning under set semantics.

Recommend:
- Keep `matchScore` (semantics: matched_set_count / total_sets per Option A — formally a behavior change but the value range stays 0-1 and "higher is better" remains true).
- Keep `matchedConditionCodes` as the union of codes from all matched sets (current semantics: the codes that matched, dedup'd; new computation: union of `required_codes` across `matched_sets`).
- Add `matchedSetCount: Int!`, `totalSets: Int!`, and `matchedSets: [MatchedCodeSet!]!` (latter exposing per-set entry node, codes, description).

This gives clients both backward compat AND access to the richer data.

### 12.4 Drop `pathway_condition_codes` after soak?

Two paths:
- **Drop it.** Single source of truth in `pathway_code_sets`. Cleaner long-term.
- **Keep as denormalized cache.** Used by autocomplete/quick-filter UIs that want a fast "all codes ever associated with this pathway" lookup. The `pgi.condition_codes` array column already serves this purpose, so the table itself is redundant.

Recommend: drop it ~6 weeks after sub-phase 1b.6 cutover. The `pgi.condition_codes` array is sufficient for autocomplete; the per-row table adds nothing.

### 12.5 Backfill window: live or maintenance?

Backfill (sub-phase 1b.2) reads from `pathway_condition_codes` and writes to `pathway_code_sets`. Both tables; no locks on actively-read rows. If an import runs concurrently and writes to `pathway_condition_codes` mid-backfill, those new rows might miss the backfill cutoff — leading to a pathway with stale `pathway_code_sets` rows.

Two mitigations:
- **Lock the import endpoint during backfill.** Brief downtime (~1 min). Clean.
- **Re-run backfill periodically until quiescent.** Idempotent design supports this.

Recommend: brief import-endpoint lock during the migration. Customers can tolerate it; the alternative (dual-write race) is harder to reason about.

---

## 13. What this design intentionally doesn't solve

- **Multi-pathway resolution.** Phase 3.
- **Set-aware `relatedPathways`.** Track 2 in the plan; deferred.
- **Cross-system canonicalization** (SNOMED ↔ ICD-10 in matching). Future work.
- **Authoring UX for multiple code sets per pathway.** Frontend; separate plan.
- **Versioning of code sets** (when a pathway's code sets change between versions). Belongs in the diff-engine + import pipeline; not part of this design.
- **Live SNOMED hierarchy.** Phase 4.

---

## 14. Decision Log Template

When the user answers the open questions, record decisions here:

```
Decision: <topic>
Date: <YYYY-MM-DD>
Choice: <which option>
Reasoning: <one paragraph>
```

(Empty until decisions are made.)
