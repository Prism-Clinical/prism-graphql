# Phase 1b — Set-Based Pathway Matching: Plan of Attack

**Status:** Decisions resolved. Ready to implement.
**Prerequisites:** Phase 0 (migration 044/045/046) and Phase 1a are live-smoke-verified.
**Shape:** One PR, four commits. No dual-write, no lock, no soak — the system isn't live to users yet.

---

## 1. Goal & Non-Goals

### Goal
Replace the flat `pathway_condition_codes` model with a normalized two-table model (`pathway_code_sets` + `pathway_code_set_members`), enabling **commutative, set-based matching with conjunction semantics**. A pathway expresses one or more code sets; each set is an `ALL_OF` conjunction of required (code, system) pairs; a patient matches a pathway when their (ontology-expanded) codes fully satisfy any one of its sets. This unlocks the "hypertension + diabetes" combination authoring you've been after since the early architecture conversation.

### Non-goals (deliberately deferred)
- **Multi-pathway resolution sessions** (Phase 3).
- **Cross-system matching (SNOMED ↔ ICD-10)** — `snomed_icd10_common_map` stays unwired.
- **Admin UI for authoring multiple code sets** — backend-only here.
- **Shared subgraph references between pathways.**
- **`scope=DESCENDANTS_OK` activation** — schema reserves it; v1 hardcodes EXACT (Phase 1a's patient-side ancestor expansion already covers most use cases).

---

## 2. Why This Matters

The current flat model encodes a pathway's trigger as a list of codes treated as "any of these matches." Fine for single-condition pathways; actively misleading for combinations. A pathway authored for "hypertension WITH diabetes" today fires for patients with EITHER — the array overlap operator ignores conjunction semantics. The clinical content lies.

After Phase 1b, an author can declare:
- "Match for hypertension alone" — set with `{I10}`
- "Match for hypertension AND diabetes" — set with `{I10, E11}`
- "Match for hypertension AND CKD AND diabetes" — set with `{I10, N18, E11}`

The matcher tests each set independently. The score and structured fields tell the provider which scenario the patient is in.

---

## 3. Resolved Decisions

The five open questions from the original draft of this plan are resolved as follows. (See companion design doc `2026-05-01-phase-1b-pathway-code-sets-design.md` for the full reasoning behind each.)

### 3.1 Code encoding — **normalized two-table model**

Each member row is `(code, system)`. Per-code metadata cleanly attaches; cross-system conjunctions are native; code-driven discovery is a single indexed lookup. The match query is slightly more complex than array containment but well within budget at expected scale (~50ms at year-3 scale vs ~10ms with arrays — both negligible for human-paced queries).

### 3.2 `matchScore` formula — **coverage, additive change**

The original "fraction of scenarios matched" was misleading: it penalized patients for having simpler clinical profiles. New definition:

> `matchScore = patientCodesAddressed / (patientCodesAddressed + patientCodesUnaddressed)`

This answers a useful question: "of this patient's relevant problems, what fraction does this pathway address?" A patient with E11 alone matching a `{E11}` set scores 1.0 (perfect coverage). A patient with E11 + F32.9 matching the same set scores 0.5 (half their problems unaddressed — consider another pathway for the depression).

The field shape (`Float!`) stays the same; the semantic shifts. Existing UIs displaying a 0-1 score continue to render reasonably.

### 3.3 GraphQL `MatchedPathway` shape — **additive**

Add structured fields alongside the redefined `matchScore`:
```graphql
type MatchedPathway {
  pathway: Pathway!
  matched: Boolean!
  matchedSets: [MatchedCodeSet!]!
  mostSpecificMatchedSet: MatchedCodeSet!
  specificityDepth: Int!                  # size of mostSpecificMatchedSet
  patientCodesAddressed: [String!]!
  patientCodesUnaddressed: [String!]!
  matchScore: Float!                       # = addressed / (addressed + unaddressed); see 3.2
  matchedConditionCodes: [String!]!        # union of codes from matched sets, retained
  reachability: ReachabilityScore!
}

type MatchedCodeSet {
  setId: ID!
  description: String
  members: [MatchedCodeSetMember!]!
  memberCount: Int!
  entryNodeId: String
}

type MatchedCodeSetMember {
  code: String!
  system: String!
}
```

No removals; no required-type changes. Existing `matchScore` and `matchedConditionCodes` consumers work; new clients get richer signal.

### 3.4 Drop `pathway_condition_codes` — **yes, in this PR**

System isn't live. After cutover lands and tests pass, the old table is no longer the source of truth for anything. Drop it as the final commit; no soak window needed.

### 3.5 Backfill window — **no lock, no dual-write**

System has no live users. Backfill runs once, atomically, in the same PR as the cutover. No race conditions because nothing else is racing.

---

## 4. Schema

### Migration `047_create_pathway_code_sets.sql`

```sql
CREATE TABLE pathway_code_sets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pathway_id      UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
  scope           VARCHAR(30) NOT NULL DEFAULT 'EXACT'
                  CHECK (scope IN ('EXACT', 'EXACT_AND_DESCENDANTS', 'DESCENDANTS_OK')),
  semantics       VARCHAR(20) NOT NULL DEFAULT 'ALL_OF'
                  CHECK (semantics IN ('ALL_OF')),
  entry_node_id   VARCHAR(100),
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pathway_code_set_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_set_id     UUID NOT NULL REFERENCES pathway_code_sets(id) ON DELETE CASCADE,
  code            VARCHAR(20) NOT NULL,
  system          VARCHAR(10) NOT NULL,
  scope_override  VARCHAR(30),                           -- per-code scope override; null = inherit from set
  description     TEXT,                                  -- per-code authoring note
  CHECK (system IN ('ICD-10', 'SNOMED', 'RXNORM', 'LOINC', 'CPT')),
  CONSTRAINT pathway_code_set_members_unique
    UNIQUE (code_set_id, code, system)
);

CREATE INDEX idx_pcs_pathway ON pathway_code_sets(pathway_id);
CREATE INDEX idx_pcsm_set ON pathway_code_set_members(code_set_id);
CREATE INDEX idx_pcsm_code_system ON pathway_code_set_members(code, system);
```

`pathway_graph_index.condition_codes TEXT[]` (the union/cache column) **stays** — it's still the autocomplete-and-quick-filter surface, refreshed at write time as a UNION across the pathway's code-set members.

---

## 5. Migration of Existing Data

For each row in `pathway_condition_codes`, create:
1. One row in `pathway_code_sets` (single-element set, EXACT scope, no entry_node_id, description copied from old row's description if present)
2. One row in `pathway_code_set_members` (the code + system from the old row)

This preserves "any code matches" disjunction-across-sets semantics: each old code becomes its own set, and a pathway matches if ANY of its sets matches.

```sql
-- Migration 048_backfill_pathway_code_sets.sql
INSERT INTO pathway_code_sets (id, pathway_id, scope, semantics, description)
SELECT gen_random_uuid(), pathway_id, 'EXACT', 'ALL_OF', description
FROM pathway_condition_codes;

-- Use the IDs we just generated; this requires a CTE or a temp table tracking the mapping.
-- Simpler: do it in a procedural block.
```

Concrete safe form (using DO block):

```sql
DO $$
DECLARE
  rec RECORD;
  set_id UUID;
BEGIN
  FOR rec IN SELECT id, pathway_id, code, system, description, usage, grouping
             FROM pathway_condition_codes
  LOOP
    set_id := gen_random_uuid();
    INSERT INTO pathway_code_sets (id, pathway_id, scope, semantics, description)
    VALUES (set_id, rec.pathway_id, 'EXACT', 'ALL_OF',
            COALESCE(rec.description, 'Migrated from legacy pathway_condition_codes'));

    INSERT INTO pathway_code_set_members (code_set_id, code, system, description)
    VALUES (set_id, rec.code, rec.system, rec.usage);
  END LOOP;
END $$;
```

Idempotency: the unique constraint on `(code_set_id, code, system)` prevents accidental member duplication. Re-running the migration would create new sets with new IDs (not great), so the backfill is wrapped in an "if not yet migrated" guard:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pathway_code_sets LIMIT 1) THEN
    -- run the loop above
  END IF;
END $$;
```

---

## 6. Match Logic

### 6.1 New `getMatchedPathways` SQL shape

```sql
WITH patient_codes AS (
  -- Same as Phase 1a (snapshot reads, active-condition filter)
  SELECT DISTINCT sc.code, ... -- code + system pairs after Phase 1.5 active filter
  FROM snapshot_conditions sc
  ...
),
expanded_codes AS (
  -- Same as Phase 1a (ICD-10 ancestor expansion)
  SELECT code, system FROM patient_codes
  UNION
  SELECT ancestor.code, 'ICD-10' AS system
  FROM patient_codes pc
  JOIN icd10_codes leaf ON leaf.code = pc.code
  JOIN icd10_codes ancestor ON leaf.path <@ ancestor.path
  WHERE ancestor.code != leaf.code
    AND pc.system = 'ICD-10'
),
matched_sets AS (
  -- A set matches when EVERY member is in the patient's expanded codes
  SELECT cs.id AS set_id, cs.pathway_id, cs.entry_node_id, cs.description
  FROM pathway_code_sets cs
  WHERE NOT EXISTS (
    SELECT 1 FROM pathway_code_set_members m
    WHERE m.code_set_id = cs.id
      AND NOT EXISTS (
        SELECT 1 FROM expanded_codes e
        WHERE e.code = m.code AND e.system = m.system
      )
  )
),
pathway_set_totals AS (
  SELECT pathway_id, COUNT(*) AS total_sets FROM pathway_code_sets GROUP BY pathway_id
)
SELECT
  pgi.id, pgi.logical_id, pgi.title, pgi.version, pgi.category, pgi.status,
  pgi.condition_codes,
  pst.total_sets,
  COUNT(DISTINCT ms.set_id) AS matched_set_count,
  ARRAY_AGG(DISTINCT ms.set_id) AS matched_set_ids,
  -- max members of any matched set, for specificityDepth:
  (SELECT MAX(member_count) FROM (
     SELECT COUNT(*) AS member_count
     FROM pathway_code_set_members
     WHERE code_set_id = ANY(ARRAY_AGG(DISTINCT ms.set_id))
     GROUP BY code_set_id
   ) AS sub) AS specificity_depth
FROM pathway_graph_index pgi
JOIN matched_sets ms ON ms.pathway_id = pgi.id
JOIN pathway_set_totals pst ON pst.pathway_id = pgi.id
WHERE pgi.status = 'ACTIVE' AND pgi.is_active = true
GROUP BY pgi.id, ..., pst.total_sets;
```

The resolver layer composes:
- `matched: true`
- `matchedSets`: load full set/member details for the matched set IDs
- `mostSpecificMatchedSet`: pick the set whose `members` count == `specificityDepth`
- `patientCodesAddressed`: union of (code, system) from matched-set members that intersect patient codes
- `patientCodesUnaddressed`: patient codes NOT in any matched-set member (active-filtered)
- `matchScore`: `addressed / (addressed + unaddressed)` per Decision 3.2

### 6.2 `relatedPathways` SQL update

The existing ontology-aware logic (Phase 1a) compares `pgi.condition_codes` arrays. Under Phase 1b, that array is auto-refreshed as a UNION across the pathway's code-set members at write time, so the existing relatedPathways query continues to work without changes. (Track 1 from the design doc — keeps it simple.)

---

## 7. Import Pipeline

### 7.1 JSON format extension

```json
"pathway": {
  "logical_id": "...",
  "condition_codes": [...],     // legacy — still supported
  "code_sets": [                // new — opt-in for combinations
    {
      "description": "T2DM with hypertension",
      "scope": "EXACT",
      "entry_node_id": "stage-1-comorbid",
      "required_codes": [
        {"code": "E11", "system": "ICD-10"},
        {"code": "I10", "system": "ICD-10"}
      ]
    }
  ]
}
```

Behavior:
- If `code_sets` is present: write directly. Each entry → one `pathway_code_sets` row + N `pathway_code_set_members` rows.
- If `code_sets` is absent: synthesize one set per code from `condition_codes` (legacy fallback, matches the data migration shape).
- Both present: `code_sets` wins; `condition_codes` is treated as informational only.

### 7.2 Validator changes
- New: validate `code_sets[].required_codes` is non-empty
- New: validate `code_sets[].scope` enum value
- New: validate `code_sets[].entry_node_id` references a real node id (if present)
- Existing `condition_codes` validation continues unchanged

### 7.3 Relational writer changes
- Add `writeCodeSets(client, pathwayId, codeSets)` — handles both shapes (synthesize if legacy)
- Add `deleteCodeSets(client, pathwayId)` for `DRAFT_UPDATE` flow (cascade-delete via FK from set to members)
- **Drop** `writeConditionCodes` and `deleteConditionCodes` (final commit when the table goes away)
- `pgi.condition_codes` array column refreshed as a UNION over members

### 7.4 ensureIcd10Codes integration
Phase 1a's `ensureIcd10Codes` continues to run before code sets are written, so any new ICD-10 code that lands in a member row also lands in the hierarchy.

---

## 8. The Four Commits

### Commit 1 — Schema + types

- Migration `047_create_pathway_code_sets.sql` (both tables, FKs, unique constraint, indexes)
- TypeScript types: `PathwayCodeSet`, `PathwayCodeSetMember`, JSON-side `CodeSetDefinition`
- No data migration, no resolver changes
- Tests on the new types; migration sanity check

### Commit 2 — Backfill + import pipeline switch

- Migration `048_backfill_pathway_code_sets.sql` (idempotent guard against re-run)
- `relational-writer.ts`: add `writeCodeSets` / `deleteCodeSets`; remove `writeConditionCodes` / `deleteConditionCodes` calls
- `import-orchestrator.ts`: switch wiring to the new writers
- `validator.ts`: validate the new `code_sets` JSON shape
- `import/types.ts`: extend `PathwayMetadata` with optional `code_sets`
- Tests for new validator paths, writer paths, orchestrator integration

### Commit 3 — Read-path cutover + GraphQL schema

- `getMatchedPathways` SQL replaced with the set-containment shape (§6.1)
- `MatchedPathway` GraphQL type extended with structured fields per §3.3
- Resolver computes `matched`, `matchedSets`, `mostSpecificMatchedSet`, `specificityDepth`, `patientCodesAddressed`, `patientCodesUnaddressed`, redefined `matchScore`
- `MatchedCodeSet` and `MatchedCodeSetMember` types added
- Codegen regenerated
- Update existing unit tests + add new ones for the set-based match logic

### Commit 4 — Drop old table

- Migration `049_drop_pathway_condition_codes.sql`
- Drop the table cleanly (FK cascade-delete is moot; pathway_condition_codes only references pathway_graph_index, no incoming refs)
- Remove any lingering imports of the old types from TS code
- Final test pass on the full suite

---

## 9. Files Touched

| File | Commit |
|---|---|
| `shared/data-layer/migrations/047_create_pathway_code_sets.sql` | 1 |
| `shared/data-layer/migrations/048_backfill_pathway_code_sets.sql` | 2 |
| `shared/data-layer/migrations/049_drop_pathway_condition_codes.sql` | 4 |
| `apps/pathway-service/src/services/import/types.ts` | 1, 2 |
| `apps/pathway-service/src/services/import/validator.ts` | 2 |
| `apps/pathway-service/src/services/import/relational-writer.ts` | 2, 4 |
| `apps/pathway-service/src/services/import/import-orchestrator.ts` | 2, 4 |
| `apps/pathway-service/src/services/resolution/session-store.ts` | 3 |
| `apps/pathway-service/src/resolvers/Query.ts` | 3 |
| `apps/pathway-service/schema.graphql` | 3 |
| `apps/pathway-service/src/__generated__/resolvers-types.ts` | 3 (codegen) |
| `apps/pathway-service/src/__tests__/*.ts` | every |
| `prism-admin-dashboard/docs/pathway-json-format.md` | 2 |

---

## 10. Risks (simplified, given no live users)

1. **Backfill misses something.** A pathway whose old-table data doesn't get replicated cleanly will stop matching anything after commit 3. Mitigation: verification query after the backfill confirming row counts match (one set per old condition code per pathway).
2. **Resolver SQL has a bug.** The new `NOT EXISTS / NOT EXISTS` pattern is more complex than `<@`. Mitigation: integration tests with realistic pathway data covering single-code sets, multi-code sets, partial matches, no-match.
3. **`matchScore` semantic shift surprises an internal client.** Admin-dashboard or provider-front-end might display the score in a way that changes meaning. Mitigation: grep both repos for `matchScore` before the PR merges; update any rendering that calls it "confidence."
4. **`pgi.condition_codes` cache drift.** The denormalized array on `pathway_graph_index` needs to stay in sync. Mitigation: rebuild it from members at write time; verification query in tests.

Risks I dropped from the original list (no longer apply): dual-write divergence, soak window contamination, performance under concurrent load.

---

## 11. Test Strategy

- **Per-commit unit tests** — schema sanity, validator branches, writer round-trips, resolver SQL shape.
- **Integration smoke** after commit 3: extend the existing runbook (`docs/testing/shared-pathways-phase-0-1a-smoke-test.md`) with set-based scenarios:
  - Pathway with explicit `code_sets: [{required_codes: [E11, I10]}]`
  - Patient with E11 alone → no match
  - Patient with E11 + I10 → match, `specificityDepth: 2`, `matchScore: 1.0`
  - Patient with E11 + I10 + F32.9 → match, `specificityDepth: 2`, `matchScore: 0.67`, `patientCodesUnaddressed: [F32.9]`
- **Performance smoke** before merge: `EXPLAIN ANALYZE` on `getMatchedPathways` against ~50 active pathways. Target: ≤ 200ms p99. If worse, add a covering index on `pathway_code_set_members(code_set_id)` (already in the schema) and recheck.
- **Full jest suite** passes throughout (no regressions).

---

## 12. Pre-flight Checklist

- [ ] Phase 0 + 1a + 1.5 PR is merged (or at least reviewed and stable)
- [ ] Inventory of active pathways: `SELECT count(*) FROM pathway_graph_index WHERE is_active = true`. Establishes the row-count baseline for the backfill verifier.
- [ ] Audit `matchScore` consumers in `prism-admin-dashboard` and `prism-provider-front-end`. Identify any that filter or label it as "confidence."

---

## 13. Rollback

Each commit is independently reversible. If commit 3 ships and we discover a bug:
- Revert commit 3 → resolver reads from old table again (still populated, since we haven't dropped it yet at commit 3).
- Or fix forward: most resolver bugs are app-side, not schema-side.

If commit 4 ships and we discover a bug we'd want to roll back:
- Schema-level rollback: restore from backup.
- Better: don't ship commit 4 until commit 3 has soaked in dev/staging for a day or two.

---

## 14. Out of Scope / Future Work

- Multi-pathway resolution sessions (Phase 3)
- Set-aware `relatedPathways` Track 2 (per-set classification rather than pathway-union)
- Shared-subgraph references between pathways
- Cross-system canonicalization (SNOMED → ICD-10 in matching)
- Authoring UI for code sets (admin dashboard)
- `scope=DESCENDANTS_OK` activation (Phase 1a's patient-side ancestor expansion already covers most use cases; activate only if real authoring need surfaces)
- Verification status filter in active-condition logic (`entered-in-error`, `refuted`)

---

## 15. Decision Log

| # | Decision | Date | Choice | Rationale (one-liner) |
|---|---|---|---|---|
| 1 | Code encoding | 2026-05-03 | Normalized two-table model (`pathway_code_sets` + `pathway_code_set_members`) | Per-code metadata, cross-system conjunctions, indexed code-driven discovery. Match-query speed is acceptable at expected scale. |
| 2 | matchScore formula | 2026-05-03 | Drop fraction-of-scenarios. Add structured fields. Headline `matchScore` = coverage. | The original formulation conflated specificity with confidence; coverage is honest about "fraction of patient's relevant problems addressed." |
| 3 | GraphQL surface | 2026-05-03 | Additive — keep `matchScore` field, redefine semantics; add new structured fields. | Field shape stable; existing UIs continue to render; new clients get richer signal. |
| 4 | Drop old table | 2026-05-03 | Yes, in this PR | System not live; no soak needed; cleanest forward state. |
| 5 | Backfill window | 2026-05-03 | No lock, no dual-write | System not live; no concurrent traffic to coordinate with. |
