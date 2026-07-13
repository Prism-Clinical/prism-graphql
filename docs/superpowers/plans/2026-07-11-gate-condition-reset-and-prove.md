# Gate Condition Reset & Prove — Implementation Plan (Plan 5 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the whole field/attribute feature end-to-end — re-author the `anemia-in-pregnancy` pathway into canonical form, demonstrate its gates actually fire against a patient, and retire the remaining foreign-dialect pathways.

**Architecture:** The proof is an in-memory traversal test (no DB) that builds the re-authored anemia pathway as a `GraphContext`, runs `TraversalEngine.traverse` with a real `PatientContext` (coded Hb lab + `patientAttributes.trimester`) and code map, and asserts the severe-anemia and trimester gates fire and gate the right steps. A second task re-authors the pathway into the live AGE graph via `importPathway`. A third retires the 4 other foreign-dialect pathways.

**Tech Stack:** pathway-service (TS, Apollo Federation, PostgreSQL/Apache AGE, Jest). Builds on Plans 1–3 (canonical schema + registry + code map + `patientAttributes` input path). Import validation from Plan 2 guards the re-authored JSON.

**Dependencies:** Land AFTER Plans 1–3. The live-DB verification (Task 2) needs Plan 3's `patientAttributes` input wiring for trimester gates to fire through `startMultiPathwayResolution`. The in-memory proof (Task 1) needs only Plan 1.

## Global Constraints

- Never chain `cd`. Use `npm --prefix`/`git -C`. Work in `.../prism-graphql`; paths relative to it.
- Conventional commit prefixes. No `@anthropic.com`/`@claude.com` Co-Authored-By lines.
- JEST is the gate; never use "attribute"/"field" as jest patterns (worktree dir name contains them) — use `--runTestsByPath` or a safe substring.
- **Canonical rewrite rules** (from the exploration; use verbatim):
  - `LT`→`less_than`, `GTE`→`greater_or_equal`, `EQUALS`→`equals`, `IN`→`in`.
  - `attribute` conditions keep `attribute`; coded labs use `{field:'labs', value:'<LOINC>', system:'LOINC', threshold}`.
  - **`in` value MUST be an array** (`value: [1,3]`), not the string `"1,3"` — `compareScalar` does strict element `===`.
  - `lab.hemoglobin_delta_2wk` is NOT in the code map — model it as a **coded** `delta_from_baseline` on Hb (`{field:'labs', operator:'delta_from_baseline', value:'718-7', system:'LOINC', delta_threshold:1, window_days:14}`).
- Live-DB writes (Task 2/3) touch the shared dev `prism_db` — additive/replace only; get the password via `PGPASSWORD=$(pm2 env 0 2>/dev/null | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')`.

---

## Canonical anemia-in-pregnancy gate conditions (reference for all tasks)

| Gate node | gate_type | Current (foreign) | Canonical |
|---|---|---|---|
| `gate-severe-anemia` | patient_attribute (skip) | `{attribute:lab.hemoglobin, LT, 7}` | `{field:'labs', operator:'less_than', value:'718-7', system:'LOINC', threshold:7}` |
| `gate-anemia-t1t3` | compound AND (skip) | trimester IN "1,3"; Hb LT 11 | `[{attribute:'patient.trimester', operator:'in', value:[1,3]}, {field:'labs', operator:'less_than', value:'718-7', system:'LOINC', threshold:11}]` |
| `gate-anemia-t2` | compound AND (skip) | trimester EQUALS 2; Hb LT 10.5 | `[{attribute:'patient.trimester', operator:'equals', value:2}, {field:'labs', operator:'less_than', value:'718-7', system:'LOINC', threshold:10.5}]` |
| `gate-iron-deficient` | patient_attribute (skip) | `{attribute:lab.ferritin, LT, 30}` | `{field:'labs', operator:'less_than', value:'2276-4', system:'LOINC', threshold:30}` |
| `gate-oral-iron-response` | patient_attribute (traverse) | `{attribute:lab.hemoglobin_delta_2wk, GTE, 1}` | `{field:'labs', operator:'delta_from_baseline', value:'718-7', system:'LOINC', delta_threshold:1, window_days:14}` |

(Trimester gates use the attribute form because `patient.trimester` has no code; labs use the coded form for precision. Both forms are first-class per Plan 1.)

---

## File Structure

- Create `src/__tests__/fixtures/anemia-pathway-canonical.ts` — the re-authored pathway as an in-memory `GraphContext` builder + its `PathwayJson`.
- Create `src/__tests__/anemia-pathway-e2e.test.ts` — traversal proof.
- Create `scripts/reauthor-anemia-pathway.md` (or a `.ts` importer script) — the canonical `PathwayJson` + import invocation (Task 2).
- Task 3 is operational (archive mutations / SQL) — no source files, documented in a runbook note.

---

## Task 1: In-memory traversal proof (no DB)

**Files:**
- Create: `src/__tests__/fixtures/anemia-pathway-canonical.ts`
- Create: `src/__tests__/anemia-pathway-e2e.test.ts`

**Interfaces:**
- Consumes: `TraversalEngine` + `GraphContext` (mirror `traversal-engine.test.ts`), `buildCodeMap` (Plan 1), `PatientContext`.
- Produces: `buildCanonicalAnemiaGraph(): GraphContext` and a passing proof that canonical anemia gates fire.

- [ ] **Step 1: Study the traversal test harness**

Read `src/__tests__/traversal-engine.test.ts` (esp. the `makeGraphContext`/`createPathwayWithGates` usage ~lines 46-156) and `src/__tests__/fixtures/reference-pathway-with-gates.ts` (the gate-node shape `{id, type:'Gate', properties:{gate_type, title, default_behavior, condition|conditions}}` wired via `HAS_GATE`/`BRANCHES_TO`). The canonical fixture must match this structure exactly. Also read `src/__tests__/fixtures/reference-patient-context.ts` for the `PatientContext`/`makeGraphContext` helpers and how `TraversalEngine` is constructed (`new TraversalEngine(adapter, thresholds, llmEval, codeMap)`).

- [ ] **Step 2: Write the canonical anemia fixture**

Create `src/__tests__/fixtures/anemia-pathway-canonical.ts` exporting `buildCanonicalAnemiaGraph()` that returns a `GraphContext` with a Step (or Stage) that HAS_GATE each of the 5 canonical gates above (conditions per the reference table), each gate BRANCHES_TO a distinct downstream action node (e.g. a Medication/LabTest node) so gate firing is observable as node inclusion/exclusion. Model it on `createPathwayWithGates()`. Keep node ids stable (`gate-severe-anemia`, etc.).

- [ ] **Step 3: Write the failing proof test**

Create `src/__tests__/anemia-pathway-e2e.test.ts`:

```ts
import { buildCanonicalAnemiaGraph } from './fixtures/anemia-pathway-canonical';
import { buildCodeMap } from '../services/resolution/attribute-code-map';
// import TraversalEngine + adapter + thresholds the same way traversal-engine.test.ts does
import type { PatientContext } from '../services/confidence/types';

const CODE_MAP = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
  { attributeName: 'lab.ferritin', namespace: 'lab', system: 'LOINC', code: '2276-4', valueType: 'number' },
]);

function anemicSecondTrimesterPatient(): PatientContext {
  return {
    patientId: 'p', conditionCodes: [], medications: [], allergies: [],
    labResults: [{ code: '718-7', system: 'LOINC', value: 6.2 }],  // Hb 6.2 → severe + t2 anemia
    vitalSigns: {}, freeformData: {},
    patientAttributes: { trimester: 2 },
  };
}

describe('canonical anemia pathway — gate firing (in-memory, no DB)', () => {
  it('severe-anemia gate fires for Hb 6.2 (< 7)', async () => {
    const graph = buildCanonicalAnemiaGraph();
    // construct engine exactly as traversal-engine.test.ts does, passing CODE_MAP as the 4th arg
    const result = await /* engine */.traverse(graph, anemicSecondTrimesterPatient(), new Map());
    // assert the node(s) downstream of gate-severe-anemia are INCLUDED, and that
    // gate-anemia-t2 (trimester==2 AND Hb<10.5) also fires.
    expect(/* severe-anemia downstream node status */).toBe('INCLUDED');
    expect(/* t2 anemia downstream node status */).toBe('INCLUDED');
  });

  it('trimester gate does NOT fire when patientAttributes is absent (data-blocked / skip)', async () => {
    const graph = buildCanonicalAnemiaGraph();
    const patient = { ...anemicSecondTrimesterPatient(), patientAttributes: undefined };
    const result = await /* engine */.traverse(graph, patient, new Map());
    expect(/* t2 anemia downstream node status */).not.toBe('INCLUDED'); // no trimester → gate skips
  });
});
```

Fill the `/* engine */` and status-assertion specifics from the patterns read in Step 1 (the exact `NodeStatus` enum values and how `traverse` returns node results are in `traversal-engine.test.ts`).

- [ ] **Step 4: Run RED, then make it pass**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- anemia-pathway-e2e`
Expected first: FAIL (fixture/assert wiring incomplete). Iterate on the fixture + assertions (NOT the engine — Plan 1 is done and reviewed) until GREEN. If a gate doesn't fire as expected, debug the fixture's condition JSON against the reference table above, not the evaluator.

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add src/__tests__/fixtures/anemia-pathway-canonical.ts src/__tests__/anemia-pathway-e2e.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "test: end-to-end proof that canonical anemia gates fire"
```

---

## Task 2: Re-author anemia-in-pregnancy into the live AGE graph

**Files:**
- Create: `scripts/reauthor-anemia-pathway.ts` (a small Node script that calls `importPathway(pool, json, mode, userId)`) OR `scripts/anemia-pathway-canonical.json` + a documented `importPathway` GraphQL call.

**Interfaces:**
- Consumes: `importPathway` orchestrator (`src/services/import/import-orchestrator.ts:89`) or the `importPathway` GraphQL mutation (`schema.graphql:1431`); Plan 2's validator (rejects a non-canonical JSON).

- [ ] **Step 1: Author the canonical PathwayJson**

Write the full canonical `anemia-in-pregnancy` pathway JSON (schema per `src/services/import/types.ts:7`) — same nodes/edges/logical_id as the current one, with the 5 gate conditions rewritten per the reference table. Keep `logical_id: 'anemia-in-pregnancy-v1'`. Choose the version strategy in Step 2.

- [ ] **Step 2: Choose import mode (the ACTIVE-version constraint)**

`anemia-in-pregnancy-v1 @1.0` is **ACTIVE** (cannot be DRAFT_UPDATE'd). The draft versions `1.1/1.2/1.3` exist. Two options — pick one and document it in the report:
- **NEW_VERSION** to `1.4` (canonical), then `activatePathway` it (archives 1.0). Cleanest audit trail. Use `importPathway(pool, json{version:'1.4'}, 'NEW_VERSION', userId)`.
- **DRAFT_UPDATE `1.3`** (already a DRAFT) with the canonical conditions, then activate 1.3. Reuses an existing draft slot.

Recommended: **NEW_VERSION → 1.4 → activate**.

- [ ] **Step 3: Validate before importing**

The import path runs Plan 2's validator. Dry-run the JSON through `validatePathwayJson` (write a throwaway node one-liner or a tiny test) and confirm `valid: true` — this catches any residual foreign-dialect operator before it hits the DB.

- [ ] **Step 4: Import + verify in the graph**

Run the importer (script or GraphQL mutation against `http://localhost:4016/graphql`). Then verify the stored conditions are canonical:

```bash
export PGPASSWORD=$(pm2 env 0 2>/dev/null | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
psql -h localhost -U prism -d prism_db -t -A <<'SQL'
LOAD 'age'; SET search_path=ag_catalog,public;
SELECT n FROM cypher('clinical_pathways', $$ MATCH (n) WHERE n.node_id='gate-severe-anemia' AND n.pathway_version='1.4' RETURN n $$) as (n agtype);
SQL
```
Expected: the condition shows `{field:'labs', operator:'less_than', value:'718-7', ...}` — snake_case, no `LT`/`attribute` dialect.

- [ ] **Step 5: Live resolution smoke (needs Plan 3)**

With Plan 3's `patientAttributes` input wired, POST `startMultiPathwayResolution` with `patientContext: {labResults:[{code:'718-7',system:'LOINC',value:6.2}], patientAttributes:{trimester:2}, ...}` and confirm the merged plan / evidence trail shows the severe-anemia and t2 gates as fired (not GATED_OUT for unknown-operator). Record the response in the report. (If Plan 3 isn't landed yet, note this step as blocked-on-Plan-3 and rely on Task 1's in-memory proof.)

- [ ] **Step 6: Commit the script/JSON**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add scripts/reauthor-anemia-pathway.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "chore: re-author anemia-in-pregnancy pathway into canonical form"
```

---

## Task 3: Retire the 4 remaining foreign-dialect pathways

**Files:** none (operational). Document actions + outcomes in the task report.

**Interfaces:** `archivePathway` / `reactivatePathway` mutations (`schema.graphql:1434-1440`); there is **no** hard delete mutation.

- [ ] **Step 1: Enumerate the disposables**

The 4 (besides anemia) are DRAFT and carry the foreign dialect: `anemia-pregnancy-v1`, `routine-prenatal-care-v1`, `vaginal-discharge-pregnancy-v1`, `vaginitis-in-pregnancy-v1` (plus non-gate `chronic-htn-pregnancy-v1`). Confirm current status:

```bash
export PGPASSWORD=$(pm2 env 0 2>/dev/null | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
psql -h localhost -U prism -d prism_db -c "SELECT logical_id, version, status FROM pathway_graph_index ORDER BY logical_id, version;"
```

- [ ] **Step 2: Decide reset action (get user confirmation before destructive graph deletes)**

Options per pathway (document choice in report):
- **Archive** (`archivePathway`) — non-destructive, removes from active/list surfaces. Safe default for the DRAFTs.
- **Re-author** later (out of this plan) — only if a pathway is worth keeping; then it follows Task 2's pattern.
- **Hard graph delete** — only via internal `deleteGraphSubtree` during a DRAFT_UPDATE; there is no standalone delete. Do NOT hand-delete AGE vertices without explicit user sign-off.

Recommended: **archive the 4 foreign-dialect DRAFTs** (they can't evaluate anyway) and leave them for later re-authoring. Since these are the user's disposable data, confirm the archive list with the user before executing.

- [ ] **Step 3: Execute the chosen resets**

Call `archivePathway(id)` for each confirmed pathway id (ids from `pathway_graph_index`). Verify status flips to ARCHIVED.

- [ ] **Step 4: Record outcomes in the report** (no commit — operational).

---

## Self-Review

**Spec coverage:** re-author anemia canonically → Task 2 ✓; end-to-end proof gates fire → Task 1 ✓ (in-memory, DB-independent) + Task 2 Step 5 (live, Plan-3-gated); reset the other 4 → Task 3 ✓ (archive, with user confirmation for anything destructive).

**Placeholder scan:** the test's `/* engine */`/status-assertion placeholders are explicitly deferred to Step 1's harness study (the exact `NodeStatus`/traverse API lives in `traversal-engine.test.ts`) — flagged, not hidden. All condition JSON is concrete (reference table).

**Type/behavior consistency:** `in` uses an array value; `delta_from_baseline` handles the delta gate; trimester uses the attribute form + `patientAttributes`; labs use the coded form. Matches the evaluator's dispatch (Plan 1) and the code map (Plan 1 migration 062).

**Safety:** Task 3 requires user confirmation before any destructive graph operation; archive (reversible) is the default.

---

## Feature complete after this plan

Plans 1–5 together: canonical schema + resolution (1), enforcement + reachability (2), substrate population (3), authoring UI (4), and re-authored data + proof (5). At that point attribute conditions are authored, validated, resolved, and demonstrated firing end-to-end.
