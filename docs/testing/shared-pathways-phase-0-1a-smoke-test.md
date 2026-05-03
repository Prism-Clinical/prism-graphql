# Manual Smoke Test: Shared Pathways Phase 0 + 1a

Validates the body of work landed across:
- **Item #1** — Decision-point reachability scoring on `MatchedPathway`
- **Item #2** — Per-gate explanations in `ReachabilityScore.gateExplanations`
- **Item #3** — `relatedPathways` query (now ontology-aware)
- **Phase 0** — ICD-10 hierarchy via `ltree` (migration 044)
- **Phase 1a** — Ontology-aware `getMatchedPathways` + auto-add ICD-10 codes at pathway import

Total runtime: ~30 min. Each section has explicit pass/fail criteria; if any phase fails, see the rollback procedure at the end.

---

## Prerequisites

```bash
cd workspace/prism-graphql
git fetch origin
git checkout <branch with this work>
```

Required state of the dev DB before starting:
- Migrations 001–043 applied
- `icd10-common-codes.sql` seed loaded (~600 codes)
- At least one test patient with snapshot data including ICD-10 conditions (use `seed-epic-snapshots.sh` if needed)
- At least 3 ACTIVE pathways with ICD-10 condition codes — ideally a mix of broad (3-char) and specific (5+ char) codes. If the dev DB is sparse, the smoke test queries for finding suitable test data are below.

```bash
docker compose up -d postgres redis pathway-service
docker compose exec postgres pg_isready -U postgres
```

---

## 1. Pre-flight Sanity Checks

**What to verify:** baseline state before applying migration 044.

```sql
-- Confirm icd10_codes is populated
SELECT count(*) FROM icd10_codes;
-- Expected: ~600 (from the seed). If 0, run the seed first.

-- Confirm migration 044 has NOT yet been applied
SELECT column_name FROM information_schema.columns
WHERE table_name = 'icd10_codes'
ORDER BY ordinal_position;
-- Expected columns: code, description, category, category_description, is_billable
-- Should NOT yet contain: parent_code, path

-- Confirm ltree extension is not yet installed (or is, depending on env)
SELECT extname FROM pg_extension WHERE extname = 'ltree';
-- Either result is fine; migration uses CREATE EXTENSION IF NOT EXISTS.

-- Find candidate test patients (one with multiple ICD-10 conditions is ideal)
SELECT p.id, count(sc.code) AS condition_count, array_agg(DISTINCT sc.code) AS codes
FROM patients p
JOIN patient_clinical_snapshots pcs ON pcs.epic_patient_id = p.epic_patient_id
JOIN snapshot_conditions sc ON sc.snapshot_id = pcs.id
WHERE sc.code IS NOT NULL
GROUP BY p.id
HAVING count(sc.code) > 0
ORDER BY condition_count DESC
LIMIT 5;
-- Save one of these patient IDs as $TEST_PATIENT_ID for later steps.

-- Find candidate test pathways (look for ones whose codes have known ancestors/descendants)
SELECT id, logical_id, title, condition_codes
FROM pathway_graph_index
WHERE status = 'ACTIVE' AND is_active = true
ORDER BY title
LIMIT 10;
-- Save 2-3 pathway IDs that have ICD-10 codes. Note pathways with broad codes (e.g., 'E11')
-- vs. specific codes (e.g., 'E11.65') for the relatedPathways test in section 6.
```

**Pass:** baseline state confirmed; you have a test patient ID and 2-3 pathway IDs noted.
**Fail:** seed data missing → run `make seed` or the appropriate seed script before continuing.

---

## 2. Apply Migration 044

**What to verify:** migration runs cleanly, schema changes land, no rows lost.

```bash
make migrate
# OR directly: psql ... -f shared/data-layer/migrations/044_add_icd10_hierarchy.sql
```

Watch the output for:
- `CREATE EXTENSION` (ltree)
- `ALTER TABLE icd10_codes` (adding parent_code and path)
- `CREATE OR REPLACE FUNCTION icd10_parent`
- `CREATE OR REPLACE FUNCTION icd10_label`
- The `DO $$ ... LOOP ... END $$` block for parent backfill (logs how many synthetic rows were inserted)
- `WITH RECURSIVE hierarchy ... UPDATE icd10_codes SET path = h.path` (logs row count)
- `ALTER TABLE icd10_codes ALTER COLUMN path SET NOT NULL`
- `ADD CONSTRAINT icd10_parent_fk`
- `CREATE INDEX idx_icd10_path_gist`
- `CREATE INDEX idx_icd10_parent_btree`

**Expected output:** all statements succeed, no errors. Time: 1-3 seconds for 600 rows.

**Verify schema state:**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'icd10_codes'
ORDER BY ordinal_position;
-- Expected new columns: parent_code (varchar, YES nullable), path (USER-DEFINED, NO nullable)

SELECT conname, contype FROM pg_constraint WHERE conrelid = 'icd10_codes'::regclass;
-- Expected: icd10_parent_fk (FK), plus existing PK

SELECT indexname FROM pg_indexes WHERE tablename = 'icd10_codes';
-- Expected new indexes: idx_icd10_path_gist, idx_icd10_parent_btree
```

**Pass:** all schema additions present, no NULL paths, FK constraint active.
**Fail:** if any error — see Rollback. The migration is one SQL file; partial application means rolling back the in-flight ALTER statements.

---

## 3. Verify ICD-10 Hierarchy Populated

**What to verify:** parent_code and path columns are correctly populated for the seeded data.

```sql
-- 3a. Roots have NULL parent_code, leaves have non-NULL
SELECT
  count(*) FILTER (WHERE parent_code IS NULL AND length(code) = 3) AS expected_roots,
  count(*) FILTER (WHERE parent_code IS NOT NULL AND length(code) > 3) AS expected_non_roots,
  count(*) FILTER (WHERE parent_code IS NULL AND length(code) > 3) AS unexpected_orphans,
  count(*) FILTER (WHERE parent_code IS NOT NULL AND length(code) = 3) AS unexpected_children_of_3char
FROM icd10_codes;
-- Expected: unexpected_orphans = 0, unexpected_children_of_3char = 0.

-- 3b. Synthetic stubs added by backfill (if any)
SELECT count(*) AS synthetic_count
FROM icd10_codes
WHERE description LIKE '<synthetic parent of%>';
-- Expected: small number (0 to ~20) depending on seed completeness. Not a failure if > 0.

-- 3c. Sample paths look right
SELECT code, parent_code, path::text
FROM icd10_codes
WHERE code IN ('E11', 'E11.6', 'E11.65', 'I10', 'I10.9')
ORDER BY code;
-- Expected paths:
--   E11    -> path: 'E11',                 parent_code: NULL
--   E11.6  -> path: 'E11.E11_6',           parent_code: 'E11'
--   E11.65 -> path: 'E11.E11_6.E11_65',    parent_code: 'E11.6'
--   I10    -> path: 'I10',                 parent_code: NULL
--   I10.9  -> path: 'I10.I10_9',           parent_code: 'I10'

-- 3d. Spot-check ancestor query via ltree
SELECT code FROM icd10_codes
WHERE path <@ (SELECT path FROM icd10_codes WHERE code = 'E11')
ORDER BY code;
-- Expected: E11 plus all its descendants in seed (E11.0, E11.00, E11.01, E11.1, ...).
-- This is the underlying query that powers `expandWithDescendants`.

-- 3e. Spot-check descendant→ancestor query
SELECT code FROM icd10_codes
WHERE (SELECT path FROM icd10_codes WHERE code = 'E11.65') <@ path
ORDER BY length(code), code;
-- Expected: E11, E11.6, E11.65 (in increasing specificity).
-- This is the underlying query that powers `expandWithAncestors`.

-- 3f. FK enforcement check
INSERT INTO icd10_codes (code, description, category, category_description, parent_code, path)
VALUES ('TEST.99', 'Test', 'TEST', 'Test', 'NONEXISTENT', 'TEST.TEST_99'::ltree);
-- Expected: ERROR — violates foreign key constraint icd10_parent_fk.
-- If this succeeds, the FK is broken.
ROLLBACK;
```

**Pass:** sample paths match expected format, ancestor/descendant queries return correct sets, FK rejects orphan inserts.
**Fail:** if paths look wrong, the recursive CTE may have a bug. Check for codes with `path IS NULL` (shouldn't be any).

---

## 4. Test Ontology-aware `matchedPathways`

**What to verify:** a patient with a specific ICD-10 code now matches a pathway requiring its parent.

**Setup:** ensure you have at least one test pathway requiring a 3-char or 4-char ICD-10 code, and at least one test patient whose snapshot includes a more-specific descendant.

```sql
-- Find a "broad" pathway in dev data
SELECT id, title, condition_codes FROM pathway_graph_index
WHERE 'E11' = ANY(condition_codes) OR 'I10' = ANY(condition_codes)
  AND status = 'ACTIVE';

-- Confirm a test patient has a more-specific descendant code
SELECT p.id, sc.code
FROM patients p
JOIN patient_clinical_snapshots pcs ON pcs.epic_patient_id = p.epic_patient_id
JOIN snapshot_conditions sc ON sc.snapshot_id = pcs.id
WHERE sc.code IN ('E11.65', 'E11.0', 'I10.9')  -- common specifics
  AND pcs.snapshot_version = (SELECT MAX(snapshot_version)
                              FROM patient_clinical_snapshots
                              WHERE epic_patient_id = p.epic_patient_id);
```

If no matching combo exists, you may need to insert a test pathway. The simplest:

```sql
-- Quick test pathway requiring 'E11' (broad)
-- Note: this bypasses the import pipeline. For a clean test, prefer uploading via
-- the API (section 7 below) which exercises the auto-add behavior.
```

**GraphQL query** (use `psql` for SQL or your preferred GraphQL client like Insomnia/Postman, hitting the pathway-service or gateway endpoint):

```graphql
query MatchedPathwaysSmoke($patientId: ID!) {
  matchedPathways(patientId: $patientId) {
    pathway { id title conditionCodes }
    matchedConditionCodes
    matchScore
  }
}
```

Variables: `{ "patientId": "<TEST_PATIENT_ID>" }`

**Expected:**
- A pathway requiring E11 fires for a patient with E11.65 in their snapshot (didn't fire before this work).
- `matchedConditionCodes` contains the **pathway's** code that matched (e.g., `["E11"]`), not the patient's E11.65.
- `matchScore` is non-zero.

**Compare against pre-migration behavior:** if you have access to a pre-Phase-1a build, run the same query — the ontology-aware version will return more matches for patients with specific codes. If you don't have a pre-Phase-1a build, validate by checking that the SQL contains the `expanded_codes` CTE in pathway-service logs (set log level to debug if needed).

**Direct SQL probe** (verify the expansion happened at the DB level):

```sql
-- Find what the patient's expanded code set should be
WITH patient_codes AS (
  SELECT DISTINCT sc.code
  FROM snapshot_conditions sc
  JOIN patient_clinical_snapshots pcs ON sc.snapshot_id = pcs.id
  JOIN patients p ON pcs.epic_patient_id = p.epic_patient_id
  WHERE p.id = '<TEST_PATIENT_ID>'
    AND pcs.snapshot_version = (SELECT MAX(snapshot_version)
                                FROM patient_clinical_snapshots
                                WHERE epic_patient_id = p.epic_patient_id)
    AND sc.code IS NOT NULL
)
SELECT 'patient' AS source, code FROM patient_codes
UNION
SELECT 'expanded' AS source, ancestor.code
FROM patient_codes pc
JOIN icd10_codes leaf ON leaf.code = pc.code
JOIN icd10_codes ancestor ON leaf.path <@ ancestor.path
WHERE ancestor.code != leaf.code
ORDER BY source, code;
```

**Pass:** `matchedPathways` returns at least one pathway whose condition code is an ancestor of (not equal to) any of the patient's snapshot codes.
**Fail:** if matches don't include ancestor relationships, check pathway-service logs for SQL errors; verify the code in `session-store.ts:339` was deployed.

---

## 5. Test Reachability Scoring + Gate Explanations

**What to verify:** `MatchedPathway.reachability` returns a structured score with per-gate explanations.

```graphql
query ReachabilitySmoke($patientId: ID!) {
  matchedPathways(patientId: $patientId) {
    pathway { id title }
    matchScore
    reachability {
      totalGates
      alwaysEvaluableGates
      dataDependentGates
      dataAvailableGates
      questionGates
      indeterminateGates
      autoResolvableScore
      gateExplanations {
        gateNodeIdentifier
        gateTitle
        classification
        reason
        missingData {
          field
          code
          system
          vitalName
          threshold
          comparison
        }
      }
    }
  }
}
```

**Expected for each matched pathway:**
- `totalGates` reflects the count of Gate nodes in the pathway's AGE graph.
- `autoResolvableScore` is `(alwaysEvaluableGates + dataAvailableGates) / totalGates` (or `null` if no gates).
- `gateExplanations` length matches `totalGates`.
- Gates with `classification = DATA_BLOCKED` have non-empty `missingData`.
- Gates with `classification = QUESTION` have a `reason` containing the gate prompt (if set).
- Gates with `classification = ALWAYS_EVALUABLE`, `DATA_AVAILABLE`, or `INDETERMINATE` have empty `missingData`.

**Performance check:** in pathway-service logs, this query should add ~50-200ms per matched pathway (one AGE graph load each). For 3 matches, total added latency ~150-600ms.

**Pass:** scores look correct relative to the pathway's gate structure; missingData is populated only for blocked gates.
**Fail:**
- All `totalGates = 0` → AGE fetch returning no Gate nodes; check `fetchGraphFromAGE` returns nodes with `nodeType = 'Gate'`.
- `gateExplanations` empty → `scoreReachability` not building them; check `services/resolution/reachability.ts`.
- All scores `null` even when gates exist → integer division or NaN issue.

---

## 6. Test Ontology-aware `relatedPathways`

**What to verify:** ancestor/descendant relationships between pathways are now classified, not missed.

**Setup:** ideally, two pathways where one's code is an ancestor of the other's. If dev data doesn't have this naturally, you can verify by uploading two test pathways (see section 7) — one requiring `E11` and one requiring `E11.65`.

```graphql
query RelatedPathwaysSmoke($pathwayId: ID!) {
  relatedPathways(pathwayId: $pathwayId) {
    pathway { id title conditionCodes }
    relationshipType
    sharedCodes
    uniqueToCandidate
    uniqueToInput
  }
}
```

**Test 1 — input is the broad pathway (requires E11):**

Variables: `{ "pathwayId": "<BROAD_PATHWAY_ID>" }` (the one requiring E11)

**Expected:**
- The specific pathway (requiring E11.65) appears with `relationshipType: SUBSET`.
- `sharedCodes` is empty (no literal overlap; the relationship is via descent).
- `uniqueToCandidate` contains `["E11.65"]`.
- `uniqueToInput` contains `["E11"]`.

**Test 2 — input is the specific pathway (requires E11.65):**

Variables: `{ "pathwayId": "<SPECIFIC_PATHWAY_ID>" }`

**Expected:**
- The broad pathway (requiring E11) appears with `relationshipType: SUPERSET`.
- The flat sets behave symmetrically: `sharedCodes` empty, `uniqueToCandidate: ["E11"]`, `uniqueToInput: ["E11.65"]`.

**Test 3 — sanity: input has only non-ICD-10 codes:**

If you have a pathway with only SNOMED codes, query it. Result should rely on flat overlap only — codes either match exactly or don't.

**Test 4 — pre-existing flat behavior preserved:**

For two pathways with literally-identical condition_codes (no ontology involved), result should still be `IDENTICAL` (this case was passing before; just verifying no regression).

**Pass:** ancestor/descendant relationships now produce SUBSET/SUPERSET classifications that previously returned no result.
**Fail:**
- If SUBSET/SUPERSET pathways are missing from results entirely → the WHERE clause fallback `OR EXISTS (... ucn.path <@ uin.path OR uin.path <@ ucn.path ...)` may not be deployed.
- If they appear but classify as PARTIAL_OVERLAP → the SUBSET/SUPERSET CASE branches aren't hitting; verify the nested NOT EXISTS subqueries in the SQL.

---

## 7. Test Auto-add ICD-10 Codes at Upload (`ensureIcd10Codes`)

**What to verify:** uploading a pathway with a new ICD-10 code (not in the seed) adds it to `icd10_codes` automatically, with synthetic parent backfill.

**Choose a code NOT in seed:** find a code via the CMS ICD-10-CM 2025 list that you know isn't in `icd10-common-codes.sql`. Example candidates (verify NOT in current seed first):

```sql
SELECT 1 FROM icd10_codes WHERE code = 'M15.4';  -- Erosive (osteo)arthritis
-- Expected: 0 rows. If not, pick another code.
```

**Upload via the GraphQL `importPathway` mutation:**

```graphql
mutation ImportPathwaySmoke($input: ImportPathwayInput!) {
  importPathway(input: $input) {
    pathway { id title conditionCodes }
    validation { valid errors warnings }
    importType
  }
}
```

Variables (substitute a real `M15.4`-equivalent code that's confirmed missing):

```json
{
  "input": {
    "importMode": "NEW_PATHWAY",
    "pathwayJson": {
      "schema_version": "1.0",
      "pathway": {
        "logical_id": "smoke-test-erosive-oa",
        "title": "Smoke Test: Erosive Osteoarthritis Management",
        "version": "1.0",
        "category": "CHRONIC_DISEASE",
        "condition_codes": [
          {
            "code": "M15.4",
            "system": "ICD-10",
            "description": "Erosive (osteo)arthritis"
          }
        ]
      },
      "nodes": [
        { "id": "stage-1", "type": "Stage", "properties": { "stage_number": 1, "title": "Assessment" } },
        { "id": "step-1-1", "type": "Step", "properties": {
            "stage_number": 1, "step_number": 1, "display_number": "1.1",
            "title": "Initial assessment"
          }
        }
      ],
      "edges": [
        { "from": "root", "to": "stage-1", "type": "HAS_STAGE" },
        { "from": "stage-1", "to": "step-1-1", "type": "HAS_STEP" }
      ]
    }
  }
}
```

**Expected:** `validation.valid: true`, pathway created.

**Verify icd10_codes was auto-extended:**

```sql
-- 7a. Original code from upload now exists
SELECT code, description, parent_code, path::text, is_billable
FROM icd10_codes
WHERE code = 'M15.4';
-- Expected: row exists, parent_code = 'M15', path includes 'M15_4', is_billable = true,
-- description = 'Erosive (osteo)arthritis' (from upload, not synthetic).

-- 7b. Synthetic parent (if M15 wasn't in seed) was inserted automatically
SELECT code, description, parent_code, path::text, is_billable
FROM icd10_codes
WHERE code = 'M15';
-- Expected: row exists. Either pre-existing (description from seed) OR synthetic
-- (description matches '<auto-added parent of M15.4>', is_billable = false).

-- 7c. Hierarchy is queryable via ltree from the new code
SELECT code FROM icd10_codes
WHERE path <@ (SELECT path FROM icd10_codes WHERE code = 'M15');
-- Expected: includes both M15 and M15.4.
```

**Verify expansion works through the new code:**

If you can construct a synthetic patient snapshot with code M15.4 (or use existing tooling), then run the matchedPathways query against any pathway requiring just `M15` — it should now match. If creating snapshots is hard, this section can stop at the SQL verification.

**Edge case — re-upload the same pathway as DRAFT_UPDATE:**

```graphql
# Same mutation, importMode: "DRAFT_UPDATE"
```

**Expected:** does NOT cause duplicate-key errors. The `ON CONFLICT (code) DO NOTHING` in `ensureIcd10Codes` makes this idempotent.

**Pass:** new code present in `icd10_codes`, parent backfilled if needed, path correctly populated, re-upload is safe.
**Fail:**
- Code missing from `icd10_codes` after upload → `ensureIcd10Codes` not wired into the orchestrator path that ran. Check `import-orchestrator.ts:206 / :224`.
- FK violation during upload → parent backfill order broken; the top-down insert order in `ensureSingleCode` should prevent this.
- Duplicate key on re-upload → ON CONFLICT clause missing.

---

## Pass / Fail Summary

| Section | What it gates |
|---|---|
| 1. Pre-flight | Baseline data in place |
| 2. Migration | Schema delta applied cleanly |
| 3. Hierarchy populated | ltree paths correct, FK active |
| 4. Ontology matchedPathways | Phase 1a — patient codes expanded with ancestors |
| 5. Reachability + explanations | Items #1, #2 — provider-trust UX wired through |
| 6. Ontology relatedPathways | Phase 1a — admin auto-detection now ontology-aware |
| 7. Auto-add at upload | `ensureIcd10Codes` keeps the hierarchy growing |

If sections 1-3 pass: Phase 0 is verified.
If sections 4-7 pass additionally: Phase 1a + items #1/#2/#3 are verified.

---

## Rollback Procedure

If migration 044 succeeds but later sections fail and you want to roll back:

```sql
BEGIN;

-- Drop indexes added by 044
DROP INDEX IF EXISTS idx_icd10_path_gist;
DROP INDEX IF EXISTS idx_icd10_parent_btree;

-- Drop FK
ALTER TABLE icd10_codes DROP CONSTRAINT IF EXISTS icd10_parent_fk;

-- Remove synthetic stubs (so we don't leave junk in the seed)
DELETE FROM icd10_codes WHERE description LIKE '<synthetic parent of%>';

-- Drop columns
ALTER TABLE icd10_codes DROP COLUMN IF EXISTS path;
ALTER TABLE icd10_codes DROP COLUMN IF EXISTS parent_code;

-- Drop helper functions
DROP FUNCTION IF EXISTS icd10_parent(VARCHAR);
DROP FUNCTION IF EXISTS icd10_label(VARCHAR);

-- ltree extension can stay; it's harmless when unused.

COMMIT;
```

After rollback, `getMatchedPathways` will fail at the `expanded_codes` CTE because it references `icd10_codes.path` which no longer exists. Revert the application code (revert the `services/resolution/session-store.ts` change and the resolver changes) before redeploying.

---

## Known Gaps

- **No automated CI for ltree behavior.** Migration unit tests run against migration files at the syntactic level, not against ltree semantics. If Postgres ltree behavior changes between minor versions, this could regress silently.
- **SNOMED matching still flat.** The auto-add helper and ontology-aware queries only handle ICD-10 codes. SNOMED-only or RXNORM-only pathways behave as before.
- **Synthetic parents appear in autocomplete searches if `searchCodes` doesn't filter by `is_billable`.** Verify this in the admin UI before exposing.
- **Performance under load not tested.** `relatedPathways` SQL has nested NOT EXISTS subqueries; profile against ~100+ active pathways before declaring production-ready.
- **No pathway authored at `M15` level in the smoke test.** Section 7 only verifies the auto-add side; the cross-section interaction (auto-added code now drives a `matchedPathways` match for a different pathway) requires manual setup beyond this runbook.
