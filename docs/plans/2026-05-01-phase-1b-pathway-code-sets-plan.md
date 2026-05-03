# Phase 1b — Set-Based Pathway Matching: Plan of Attack

**Status:** Proposed. Not started.
**Prerequisites:** Phase 0 (migration 044) and Phase 1a (ontology-aware matching, auto-add at upload) must be live-smoke-verified first.
**Estimated effort:** 3–4 weeks of focused work, broken into 6 incremental sub-phases.

---

## 1. Goal & Non-Goals

### Goal
Replace the flat `pathway_condition_codes` model with `pathway_code_sets`, enabling **commutative, set-based matching with conjunction semantics**. A pathway expresses one or more code sets, each set being an `ALL_OF` conjunction of required codes. A patient matches a pathway when their (ontology-expanded) codes fully satisfy any one of its code sets. This unlocks the "hypertension + diabetes" combination authoring the user has been after since the early architecture conversation.

### Non-goals (deliberately deferred)
- **Multi-pathway resolution sessions.** Patients matching multiple pathways still get isolated sessions per pathway today; the multi-pathway resolution layer is Phase 3.
- **Pathway-relationship registry beyond what `relatedPathways` already infers.** No new `pathway_relationships` table; lattice continues to be derived from set containment on demand.
- **Cross-system matching (SNOMED ↔ ICD-10).** Out of scope; the existing `snomed_icd10_common_map` (mig 035) remains unwired.
- **Admin UI for authoring multiple code sets.** Backend-only here; frontend is a separate plan.
- **Shared subgraph references between pathways.** A separate Phase 1b.7 if/when content reuse becomes a real authoring pain point.

---

## 2. Why This Matters

The current model encodes a pathway's trigger as a flat list of codes treated as "any of these matches." That's fine for single-condition pathways but actively misleading for combination pathways. A pathway authored for "hypertension WITH diabetes" today fires for patients with EITHER, because the flat array overlap operator (`&&`) ignores conjunction semantics. The clinical content lies — the pathway's evidence base is for the combination, but the matching logic treats it as a disjunction.

`pathway_code_sets` lets a pathway author declare:
- "Match for patients with hypertension alone" (set 1: `{I10}`)
- "Match for patients with hypertension AND diabetes" (set 2: `{I10, E11}`, distinct entry node)
- "Match for patients with hypertension AND CKD AND diabetes" (set 3: `{I10, N18, E11}`)

The matcher tests each set independently, finds the most-specific subset cover, and (in Phase 3) lets resolution decide which to fire.

The lattice for `relatedPathways` becomes structurally tighter: pathways are related precisely when their code sets are subset/superset/overlap of each other, not when they happen to share any code.

---

## 3. Schema Design

### 3.1 New table: `pathway_code_sets`

```sql
CREATE TABLE pathway_code_sets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pathway_id      UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
  required_codes  TEXT[] NOT NULL CHECK (array_length(required_codes, 1) >= 1),
  scope           VARCHAR(30) NOT NULL DEFAULT 'EXACT'
                  CHECK (scope IN ('EXACT', 'EXACT_AND_DESCENDANTS', 'DESCENDANTS_OK')),
  semantics       VARCHAR(20) NOT NULL DEFAULT 'ALL_OF'
                  CHECK (semantics IN ('ALL_OF')),     -- room to grow; v1 is conjunction-only
  entry_node_id   VARCHAR(100),                         -- AGE node ID for the entry point this set drives
  description     TEXT,                                  -- author-facing label, e.g. "HTN + diabetes"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pcs_pathway ON pathway_code_sets(pathway_id);
CREATE INDEX idx_pcs_required_gin ON pathway_code_sets USING GIN (required_codes);
```

**Key choices:**
- **`required_codes TEXT[]`** with GIN index: this is the workhorse. The match query is `WHERE required_codes <@ patient_expanded_codes` — Postgres `@>`/`<@` containment on text arrays uses the GIN index efficiently.
- **`scope` defaults to `EXACT`.** Authors must explicitly opt into descendant matching for a set. Conservative default; ontology-aware patient expansion already happens upstream of the match (Phase 1a), so most use cases don't need the per-set descendant flag.
- **`semantics` is enum-typed but only `'ALL_OF'` is valid for v1.** Schema header for OR-of-codes if ever needed; not actively supported in matcher logic.
- **`entry_node_id`** is nullable — old-shape pathways migrate without an explicit entry node; new authoring can declare them per-set.
- **No `system` column on the set itself.** The codes in `required_codes` are system-prefixed by convention (`'ICD-10:E11'`, etc.) OR the system is implicit because all current matching is ICD-10-aware (with non-ICD-10 codes treated as flat literals — same as today). **Open question** — see §11.

### 3.2 Old table fate
- `pathway_condition_codes` retained throughout Phase 1b for back-compat reads.
- Deprecation candidate after Phase 1b.6 cutover and a soak period (suggest 4 weeks live).
- Drop in a separate follow-up migration with explicit user signoff.

### 3.3 What does NOT change
- `pathway_graph_index.condition_codes TEXT[]` (the array column on the index table) stays as-is. It's a denormalized cache of "all codes referenced by this pathway" used by autocomplete and quick filters. Phase 1b refreshes it as a UNION across the new code sets. Same surface, same GIN index.
- `icd10_codes` and the ltree hierarchy are untouched.
- `pathway_resolution_sessions` and the AGE graph are untouched.

---

## 4. Migration Strategy for Existing Data

### Behavior to preserve
The current matcher fires a pathway when **any** of the patient's codes (after Phase 1a ancestor expansion) is in the pathway's `condition_codes` array. That's an `ANY_OF` semantic at the pathway level. Naively converting all existing codes into a single `ALL_OF` set would change behavior — a pathway with `[E11, I10]` today fires for either; under `ALL_OF` it'd require both.

### Migration approach: 1 row per existing code

For each existing pathway with codes `[c1, c2, ..., cN]`, generate N rows in `pathway_code_sets`:

```
(pathway_id, required_codes, scope, semantics)
(p, [c1], 'EXACT', 'ALL_OF')
(p, [c2], 'EXACT', 'ALL_OF')
(p, [cN], 'EXACT', 'ALL_OF')
```

Each set has a single code → `ALL_OF` over one element trivially equals matching that one code. The pathway-level disjunction (any set matches) preserves the old `ANY_OF` behavior exactly.

**Side effect:** existing pathways that should have been authored as conjunctions (e.g., a "diabetes with hypertension" pathway) end up over-firing under the new system — same as before. The migration is structural, not semantic. Authors who care about conjunction semantics author new code sets explicitly via the import API; existing pathways stay behaviorally identical until they're manually re-authored.

### Idempotency
Migration script wrapped in a transaction. Reruns are safe via `ON CONFLICT DO NOTHING` or `TRUNCATE pathway_code_sets ... INSERT ...` paired with a backfill check.

### Verification queries
```sql
-- Every pathway has at least one code set
SELECT pgi.id, pgi.title FROM pathway_graph_index pgi
LEFT JOIN pathway_code_sets pcs ON pcs.pathway_id = pgi.id
WHERE pgi.is_active = true AND pcs.id IS NULL;
-- Expected: 0 rows.

-- Total code count is preserved (modulo dedup within a pathway)
SELECT pgi.id,
       array_length(pgi.condition_codes, 1) AS old_count,
       (SELECT count(*) FROM pathway_code_sets WHERE pathway_id = pgi.id) AS new_count
FROM pathway_graph_index pgi
WHERE pgi.is_active = true;
-- Expected: new_count >= old_count (>= because the old table can have duplicates that the new table dedupes).
```

---

## 5. Match Logic Updates

### 5.1 New `matchedPathways` SQL shape

The current SQL (post-Phase-1a) joins `expanded_codes` against `pathway_condition_codes.code`. Phase 1b replaces this with set-containment:

```sql
WITH patient_codes AS (...),
expanded_codes AS (...),  -- same as Phase 1a
patient_code_array AS (
  SELECT array_agg(DISTINCT code) AS codes FROM expanded_codes
),
matched_sets AS (
  SELECT pcs.pathway_id, pcs.id AS set_id, pcs.required_codes, pcs.entry_node_id
  FROM pathway_code_sets pcs
  CROSS JOIN patient_code_array pca
  WHERE pcs.required_codes <@ pca.codes  -- the conjunction check, GIN-indexed
)
SELECT
  pgi.id, pgi.logical_id, pgi.title, pgi.version, pgi.category,
  pgi.status, pgi.condition_codes,
  (SELECT count(*) FROM pathway_code_sets WHERE pathway_id = pgi.id) AS total_sets,
  (SELECT count(*) FROM matched_sets WHERE pathway_id = pgi.id) AS matched_set_count,
  (SELECT array_agg(DISTINCT element) FROM matched_sets ms
     CROSS JOIN unnest(ms.required_codes) AS element
     WHERE ms.pathway_id = pgi.id) AS matched_codes
FROM pathway_graph_index pgi
JOIN matched_sets ms ON ms.pathway_id = pgi.id
WHERE pgi.status = 'ACTIVE' AND pgi.is_active = true
GROUP BY pgi.id, pgi.logical_id, pgi.title, pgi.version, pgi.category,
         pgi.status, pgi.condition_codes
ORDER BY pgi.title;
```

### 5.2 `matchScore` — design choice required

The current score is `matched_codes.length / total_codes` — fraction of pathway codes the patient satisfies. Under set-based matching, this loses meaning. Options:

- **A.** Score is fraction of code sets matched: `matched_set_count / total_sets`. Honest about the new model. Provider sees "this pathway has 3 trigger conditions; the patient matches 1 of them."
- **B.** Score is the most-specific matched set's specificity: `max(array_length(required_codes)) / max possible`. Rewards pathways where a more-specific combination matches.
- **C.** Score the most-specific match plus partial-match credit. More sophisticated; risks being noisy.

**Recommend (A).** Simplest, most explainable, easy to test. Refine later when there's UI feedback.

### 5.3 `relatedPathways` — set-aware lattice

Today's resolver compares `pathway_graph_index.condition_codes` arrays. Under Phase 1b, the right unit of comparison shifts to **code sets**, not the union of all codes. Pathway A with sets `{I10}` and `{I10, E11}` is structurally different from pathway B with one set `{I10, E11}`. The flat array union loses that.

Two design tracks:

- **Track 1 — keep the array-union comparison.** Continue using `pgi.condition_codes` (auto-refreshed by the migration to be a UNION across the pathway's code sets). Existing classification logic stays intact. Loses some structural info but is non-disruptive.
- **Track 2 — set-level comparison.** Compare each candidate set against each input set. Classification becomes per-set, not per-pathway. More expressive and useful for admin UX, but a much bigger resolver refactor.

**Recommend Track 1 for Phase 1b.** Track 2 belongs in a follow-up specifically focused on multi-set authoring UX. Phase 1b should land the storage layer cleanly first.

---

## 6. Import Pipeline Updates

### 6.1 Pathway JSON format extension

Current shape (`prism-admin-dashboard/docs/pathway-json-format.md`):
```json
"pathway": {
  "logical_id": "...",
  "condition_codes": [{"code": "E11", "system": "ICD-10"}, {"code": "I10", "system": "ICD-10"}]
}
```

Phase 1b adds an optional `code_sets`:
```json
"pathway": {
  "logical_id": "...",
  "condition_codes": [...],   // legacy; still parsed for back-compat
  "code_sets": [
    {
      "required_codes": [{"code": "E11", "system": "ICD-10"}, {"code": "I10", "system": "ICD-10"}],
      "scope": "EXACT",
      "entry_node_id": "stage-1-comorbid",
      "description": "Hypertension with type 2 diabetes"
    },
    {
      "required_codes": [{"code": "I10", "system": "ICD-10"}],
      "scope": "EXACT",
      "entry_node_id": "stage-1-htn-only",
      "description": "Hypertension alone"
    }
  ]
}
```

**Behavior at import time:**
- If `code_sets` is present: use it directly. Each entry becomes one row in `pathway_code_sets`.
- If `code_sets` is absent but `condition_codes` is present: synthesize one set per code (legacy fallback, matches the data migration shape from §4).
- If both are present: `code_sets` wins. `condition_codes` is treated as the union for the index column refresh only.
- The `condition_codes`-only path stays valid forever — admins of single-code pathways don't need to learn the new schema.

### 6.2 Validator changes (`services/import/validator.ts`)
- Validate each `code_sets[].required_codes` is non-empty
- Validate `scope` enum membership
- Validate `entry_node_id` if present matches a real node ID in the pathway's nodes array
- Existing `condition_codes` validation continues unchanged

### 6.3 Relational writer (`services/import/relational-writer.ts`)
- Add `writeCodeSets(client, pathwayId, codeSets)` analogous to existing `writeConditionCodes`
- Add `deleteCodeSets(client, pathwayId)` for `DRAFT_UPDATE` flow
- Wire both into `import-orchestrator.ts` at the same call sites where `writeConditionCodes`/`deleteConditionCodes` fire today
- `ensureIcd10Codes` (from Phase 1a) continues to ensure new codes land in the hierarchy — call before writing code sets

### 6.4 GraphQL mutation surface
- `importPathway` mutation signature unchanged — it accepts the JSON blob and the JSON validator checks for the new shape
- Output `Pathway` type may want a new field `codeSets: [PathwayCodeSet!]!` for round-tripping. Out of scope for the storage migration; queue for Phase 1b.5.

---

## 7. Sub-phasing — Six Incremental Steps

Each sub-phase is independently shippable. Test gates between each.

### 1b.1 — Schema migration (additive, ~1 day)
- Migration `045_create_pathway_code_sets.sql`
- Table + indexes as in §3.1
- No backfill; no resolver changes; no behavior change
- **Gate:** migration runs cleanly against dev DB; schema verifications pass

### 1b.2 — Backfill migration (~1 day, mostly verification)
- Migration `046_backfill_pathway_code_sets.sql`
- One row per existing condition code per pathway (§4)
- **Gate:** every active pathway has ≥1 row in `pathway_code_sets`; total row count matches expectation; spot-check several pathways manually

### 1b.3 — Dual-write at import time (~2-3 days)
- Update `relational-writer.ts` and `import-orchestrator.ts` to write to BOTH old and new tables
- Update validator to accept the new optional `code_sets` field but make it a no-op for matching
- New uploaded pathways now populate `pathway_code_sets` with either the explicit shape (if author provides) or the synthesized 1-code-per-set form
- **Gate:** unit tests for new validator paths; integration tests verify both tables get written; tests cover NEW_PATHWAY, DRAFT_UPDATE, NEW_VERSION import modes

### 1b.4 — Cutover read path: `matchedPathways` (~3-4 days)
- New SQL per §5.1
- New `matchScore` formula per §5.2 (recommend option A: matched_sets / total_sets)
- Update `MatchedPathway` GraphQL type if exposing matched set count (suggest add `matchedSetCount` and `totalSets` fields, deprecate `matchScore` to a derived field that always equals matched/total)
- Update existing tests + add new ones
- **Gate:** unit tests pass; existing matchedPathways query semantics preserved (a pathway with 1 set per code still fires for any matching code); integration test verifying a 2-code conjunction set fires only when both codes present

### 1b.5 — Cutover read path: `relatedPathways` (~2 days, less if Track 1)
- Per §5.3 recommend Track 1: keep flat array comparison via the auto-refreshed `pgi.condition_codes` index column
- Verify that the index column is correctly maintained as a UNION across `pathway_code_sets` (small SQL fix — make sure dual-write keeps it in sync)
- No resolver logic change if Track 1; Track 2 would be 1+ week
- **Gate:** existing relatedPathways tests pass unchanged

### 1b.6 — Deprecation prep (separate calendar window)
- Add deprecation log on the old `pathway_condition_codes` writer paths
- Run for 4 weeks observing whether anything still reads from the old table outside the import pipeline
- After verification, follow-up migration drops `pathway_condition_codes`
- **Gate:** soak window with no errors

---

## 8. Files Touched (Reference)

| File | Sub-phase | Type of change |
|---|---|---|
| `prism-graphql/shared/data-layer/migrations/045_create_pathway_code_sets.sql` | 1b.1 | new |
| `prism-graphql/shared/data-layer/migrations/046_backfill_pathway_code_sets.sql` | 1b.2 | new |
| `prism-graphql/apps/pathway-service/src/services/import/types.ts` | 1b.3 | extend `PathwayMetadata` with optional `code_sets` |
| `prism-graphql/apps/pathway-service/src/services/import/validator.ts` | 1b.3 | new validation paths |
| `prism-graphql/apps/pathway-service/src/services/import/relational-writer.ts` | 1b.3 | add `writeCodeSets`, `deleteCodeSets` |
| `prism-graphql/apps/pathway-service/src/services/import/import-orchestrator.ts` | 1b.3 | wire dual-write |
| `prism-graphql/apps/pathway-service/src/services/resolution/session-store.ts` | 1b.4 | replace `getMatchedPathways` SQL |
| `prism-graphql/apps/pathway-service/src/resolvers/Query.ts` | 1b.4–5 | matchedPathways field resolver if shape changes; relatedPathways unchanged in Track 1 |
| `prism-graphql/apps/pathway-service/schema.graphql` | 1b.4 | possibly add `matchedSetCount`/`totalSets` to `MatchedPathway` |
| `prism-graphql/apps/pathway-service/src/__tests__/*` | every | extend tests at each sub-phase |
| `prism-admin-dashboard/docs/pathway-json-format.md` | 1b.3 | document new `code_sets` shape |

---

## 9. Risks

### High-impact risks
1. **Behavior change in `matchScore`.** UI consumers might rely on the current `matched_codes / total_codes` semantics. Audit who calls `matchedPathways { matchScore }` before changing.
2. **Migration completeness in production.** Backfill must hit every active pathway. If any pathway is missed, it stops matching anything. Mitigate with the verification queries from §4 and a pre-cutover audit.
3. **Performance under load.** GIN containment on `required_codes` is fast (indexed) but the resolver SQL has additional CTEs and subqueries. Profile against realistic pathway counts (~50, ~500, ~5000) before sub-phase 1b.4 cutover.
4. **Dual-write divergence.** During sub-phase 1b.3, the two tables MUST stay in sync. A bug in the dual-write code that drops a code set silently breaks future matching for that pathway. Mitigate with a CI check that validates equivalence after each import.

### Medium-impact risks
5. **`condition_codes` index column drift.** `pgi.condition_codes` is currently the source of truth for `relatedPathways`. Phase 1b makes it derived from `pathway_code_sets`. If the dual-write update of this column lags, related-pathways results stale.
6. **Author confusion at the JSON format extension.** Pathways can be authored two ways now — old `condition_codes` flat list or new `code_sets`. Some authors will mix them inadvertently. Validator should warn (not error) when both are present.
7. **Multi-row writes per pathway in 1b.2 backfill.** A pathway with 50 codes → 50 rows. Bulk insert is fine but test with the largest production pathways first.

### Lower-impact risks
8. **`scope=DESCENDANTS_OK` overlap with Phase 1a.** Phase 1a expands patient codes with ancestors before matching. Adding `scope=DESCENDANTS_OK` on the set side does the symmetric thing — expand pathway codes with descendants. Both happening simultaneously could double-expand if not careful. v1 hardcodes `scope=EXACT` from the migration; we don't activate `DESCENDANTS_OK` until explicit author opt-in.
9. **Validator becoming order-dependent.** If a pathway provides both `condition_codes` and `code_sets`, the validator must agree on which wins. Document explicitly: `code_sets` wins; `condition_codes` becomes informational only.

---

## 10. Test Strategy

### Unit tests (per sub-phase)
- **1b.1:** schema-only; nothing testable in TS (verified via SQL inspection)
- **1b.2:** backfill verifier — write a Jest integration test that runs the migration against a fixture DB and confirms invariants
- **1b.3:** validator + relational-writer tests for new shape, mixed shape, legacy-only shape; orchestrator dual-write test
- **1b.4:** `getMatchedPathways` SQL shape; matchScore formula; conjunction matching (2 codes both required); single-code-set legacy behavior preserved
- **1b.5:** `relatedPathways` regression — existing tests pass unchanged

### Integration smoke (after 1b.4)
- Author a pathway with explicit `code_sets`: `[{required_codes: [E11, I10]}, {required_codes: [I10]}]`
- Test patients:
  - Patient with only I10 → matches the single-code set, NOT the combination set
  - Patient with E11 only → no match
  - Patient with E11 + I10 → matches the combination set (and the I10-only set, since both criteria are satisfied)
- Verify `matchedSetCount` reflects which sets matched

### Performance smoke (before cutover)
- Run `EXPLAIN ANALYZE` on the new `getMatchedPathways` SQL with realistic pathway counts (50, 500, 5000)
- Compare p99 latency to current implementation
- Acceptable: ≤ 2x current latency at 500 pathways. If worse, optimize with materialized expanded-code arrays or dedicated patient-snapshot caching.

---

## 11. Open Questions

These need answers before sub-phase 1b.3 begins. Not blockers for 1b.1 (schema-only).

1. **Code system encoding in `required_codes`.** Options:
   - (a) Codes stored bare (`'E11'`); system inferred per-set via a sibling `system` column.
   - (b) Codes prefixed (`'ICD-10:E11'`); single text array, no system column.
   - (c) Codes are JSONB objects (`{"code": "E11", "system": "ICD-10"}`) — most flexible, slowest to index.
   - **Recommend (a):** sibling system column on `pathway_code_sets`, codes stored bare. Matches existing `pathway_condition_codes` convention. The matcher canonicalizes patient codes to the same system before comparison.
   - **User decision needed.**

2. **`matchScore` formula.** Options A/B/C in §5.2. **Recommend A.** **User decision needed.**

3. **Should the GraphQL `MatchedPathway` type change?** Adding `matchedSetCount`/`totalSets` is non-breaking but exposes the new model to clients. Old callers see `matchScore` as a derived field. Is that the right time to deprecate `matchedConditionCodes` as a less-meaningful concept under set semantics? **User decision needed.**

4. **Whether to drop `pathway_condition_codes` after the soak window.** Or leave it indefinitely as a denormalized cache. Latter is simpler operationally but leaves cruft. **User decision needed at sub-phase 1b.6.**

5. **Backfill safety in production.** Should sub-phase 1b.2 run during a maintenance window or live? It's a single-table read + insert, transactional, but if pathway-service is reading `pathway_condition_codes` simultaneously via an in-flight import... low risk in practice but worth deciding. **User decision needed.**

---

## 12. Pre-flight Checklist

Before starting sub-phase 1b.1:

- [ ] Phase 0 + Phase 1a smoke test runbook executed and passing in dev.
- [ ] Inventory of active pathways: `SELECT count(*) FROM pathway_graph_index WHERE is_active = true`. Establishes a baseline for the migration verifier.
- [ ] Inventory of code count distribution: `SELECT id, array_length(condition_codes, 1) FROM pathway_graph_index WHERE is_active = true ORDER BY array_length DESC LIMIT 20`. Confirms the largest pathway we're migrating.
- [ ] Audit of `matchedPathways` callers in admin-dashboard, provider-front-end, and any other federation clients. Identify who reads `matchScore` and `matchedConditionCodes`.
- [ ] User signoff on §11 open questions.

---

## 13. Rollback Strategy

### Per sub-phase
- **1b.1:** drop the table. Zero impact on running app.
- **1b.2:** truncate `pathway_code_sets`. Zero impact (no read path uses it yet).
- **1b.3:** revert dual-write code. Existing matching unaffected (still reads from old table). New `pathway_code_sets` rows from imports during the dual-write window are stranded but harmless.
- **1b.4:** revert the `getMatchedPathways` SQL change. Old query still works because old table is intact.
- **1b.5:** revert `relatedPathways` change (Track 1 = trivial; Track 2 = larger).
- **1b.6:** if migration to drop the old table has run, restore from backup. If not, simply abort the deprecation.

### Forward-compat for partial rollouts
The dual-write window (1b.3 → 1b.4) is the riskiest stretch. Recommend keeping it short (1-2 weeks) and monitoring closely.

---

## 14. Out-of-Scope / Future Work

- **Multi-pathway resolution sessions** (Phase 3): unifies result of multiple matched pathways into a single care plan recommendation. Set-based matching is a prerequisite; this builds on top.
- **Set-level `relatedPathways` (Track 2):** classify the relationship between specific code sets (set A1 of pathway A is a SUBSET of set B2 of pathway B). Useful for admin UX where authors are explicitly comparing combinations.
- **Shared subgraph references:** the "function call" mechanism for content reuse across pathways. Belongs after multi-set authoring is real and observed.
- **Cross-system canonicalization:** wire `snomed_icd10_common_map` into the matcher so patients with SNOMED-only data still trigger ICD-10-based pathways.
- **Author UI for code sets:** admin dashboard support for declaring multiple combinations per pathway. Backend ready in 1b.4; frontend follows.

---

## 15. Decision Log

(To be appended as the user decides §11 open questions.)
