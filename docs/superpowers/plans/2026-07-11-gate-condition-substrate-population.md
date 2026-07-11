# Gate Condition Substrate Population — Implementation Plan (Plan 3 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `PatientContext.patientAttributes` so `patient.*` attribute conditions (e.g. `patient.trimester`) resolve against real data — via the simulator/GraphQL supply path, with `trimester` derived from `gestational_age_weeks` when only the latter is given.

**Architecture:** Exploration established that the snapshot layer stores **no** EDD/LMP/gestational-age data, and `rh_factor` is already reachable via the `lab.*` namespace (`lab.rh_factor` → LOINC `10331-7`). So the achievable, correct population path is the **input path**: add `patientAttributes` to `PatientContextInput`, normalize it (derive `trimester` from `gestational_age_weeks`), and thread it through the four input→`PatientContext` mapping sites; then let the admin composer supply it. Snapshot-derived attributes are deferred (no source data exists yet) and explicitly out of scope.

**Tech Stack:** Backend — pathway-service (TS, Apollo Federation, PostgreSQL, Jest). Frontend — prism-admin-dashboard (Next.js 16). Builds on Plan 1 (`patientAttributes` field + `patient.*` resolver) and shares the `KNOWN_PATIENT_ATTRIBUTES` list defined in Plan 4 Task 1.

## Global Constraints

- Never chain `cd`. Use `npm --prefix`/`git -C`.
- Backend worktree: `.../prism-graphql`; frontend worktree: `.../prism-admin-dashboard`. Paths below are relative to the relevant repo.
- Conventional commit prefixes. No `@anthropic.com`/`@claude.com` Co-Authored-By lines.
- Backend gate is JEST (not whole-project tsc); never use "attribute"/"field" as jest patterns (worktree dir name contains them) — use `--runTestsByPath` or a safe substring. Frontend gate is `npm run build` + `npm run lint` (no test infra).
- **Scope discipline:** snapshot-derivation of attributes is OUT OF SCOPE (no EDD/LMP/GA source data). This plan wires the supply path + the GA→trimester normalization only. Do not add speculative snapshot columns.
- `KNOWN_PATIENT_ATTRIBUTES` (from Plan 4 Task 1, `attribute-vocabulary.ts`) is the canonical `patient.*` set. If Plan 4 hasn't landed, define it there first (it is a prerequisite import for the normalizer's valueType coercion). If Plans are executed 3-before-4, move the `KNOWN_PATIENT_ATTRIBUTES` const into this plan's Task 1 and have Plan 4 import it.

---

## File Structure

**Backend (prism-graphql/apps/pathway-service):**
- Create `src/services/resolution/patient-attributes.ts` — `normalizePatientAttributes()` (GA→trimester + coercion).
- Modify `schema.graphql` — add `patientAttributes: JSON` to `PatientContextInput` (and `AdditionalContextInput`).
- Modify `src/resolvers/mutations/resolution.ts` (2 sites: ~85-93, ~523-537), `src/resolvers/mutations/multi-pathway-resolution.ts` (~524-535), `src/resolvers/Query.ts` (~521-528) — thread + normalize.
- Test: `src/__tests__/patient-attributes.test.ts`.

**Frontend (prism-admin-dashboard):**
- Modify `src/types/index.ts` (`PatientContextInput` ~288), `src/lib/derive-patient-context.ts` (~102-110), `src/app/encounter/page.tsx` — supply `patientAttributes`.

---

## Task 1: `normalizePatientAttributes` helper

**Files:**
- Create: `apps/pathway-service/src/services/resolution/patient-attributes.ts`
- Test: `apps/pathway-service/src/__tests__/patient-attributes.test.ts`

**Interfaces:**
- Produces: `export function normalizePatientAttributes(raw: unknown): Record<string, number | string | boolean> | undefined`
  - Returns `undefined` for nullish/empty input.
  - Copies through primitive (number/string/boolean) values; drops non-primitives.
  - If `gestational_age_weeks` is a finite number and `trimester` is absent, derives `trimester` (1: <14, 2: 14–27, 3: ≥28).

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/patient-attributes.test.ts`:

```ts
import { normalizePatientAttributes } from '../services/resolution/patient-attributes';

describe('normalizePatientAttributes', () => {
  it('returns undefined for nullish/empty input', () => {
    expect(normalizePatientAttributes(undefined)).toBeUndefined();
    expect(normalizePatientAttributes({})).toBeUndefined();
  });
  it('passes primitives through and drops non-primitives', () => {
    expect(normalizePatientAttributes({ trimester: 2, rh_factor: 'negative', flag: true, obj: { a: 1 } }))
      .toEqual({ trimester: 2, rh_factor: 'negative', flag: true });
  });
  it('derives trimester from gestational_age_weeks when trimester is absent', () => {
    expect(normalizePatientAttributes({ gestational_age_weeks: 10 })).toEqual({ gestational_age_weeks: 10, trimester: 1 });
    expect(normalizePatientAttributes({ gestational_age_weeks: 20 })).toEqual({ gestational_age_weeks: 20, trimester: 2 });
    expect(normalizePatientAttributes({ gestational_age_weeks: 30 })).toEqual({ gestational_age_weeks: 30, trimester: 3 });
  });
  it('does not override an explicitly supplied trimester', () => {
    expect(normalizePatientAttributes({ gestational_age_weeks: 30, trimester: 2 }))
      .toEqual({ gestational_age_weeks: 30, trimester: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- patient-attributes`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/pathway-service/src/services/resolution/patient-attributes.ts`:

```ts
type Primitive = number | string | boolean;

function isPrimitive(v: unknown): v is Primitive {
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
}

/** Trimester from gestational age in weeks: 1 (<14), 2 (14–27), 3 (>=28). */
function trimesterFromWeeks(weeks: number): number {
  if (weeks < 14) return 1;
  if (weeks < 28) return 2;
  return 3;
}

export function normalizePatientAttributes(raw: unknown): Record<string, Primitive> | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const out: Record<string, Primitive> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isPrimitive(v)) out[k] = v;
  }
  const ga = out.gestational_age_weeks;
  if (typeof ga === 'number' && Number.isFinite(ga) && out.trimester === undefined) {
    out.trimester = trimesterFromWeeks(ga);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- patient-attributes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add apps/pathway-service/src/services/resolution/patient-attributes.ts apps/pathway-service/src/__tests__/patient-attributes.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: normalizePatientAttributes (GA->trimester derivation + coercion)"
```

---

## Task 2: thread `patientAttributes` through the GraphQL input path

**Files:**
- Modify: `apps/pathway-service/schema.graphql` (`PatientContextInput` ~1117-1125; `AdditionalContextInput` ~1106-1113)
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts` (~85-93 startResolution; ~523-537 addPatientContext merge)
- Modify: `apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts` (`buildPatientContext` ~524-535)
- Modify: `apps/pathway-service/src/resolvers/Query.ts` (`previewPathwayConfidence` ~521-528)
- Test: `apps/pathway-service/src/__tests__/patient-attributes-mapping.test.ts` (create)

**Interfaces:**
- Consumes: `normalizePatientAttributes` (Task 1).
- Produces: every input→`PatientContext` mapping site attaches `patientAttributes: normalizePatientAttributes(pc?.patientAttributes)`. The `addPatientContext` path spread-merges new attributes over existing.

- [ ] **Step 1: Add the schema field**

In `apps/pathway-service/schema.graphql`, add to `input PatientContextInput` (after `freeformData: JSON`):

```graphql
  patientAttributes: JSON
```

and the same line to `input AdditionalContextInput`.

- [ ] **Step 2: Write the failing mapping test**

Create `apps/pathway-service/src/__tests__/patient-attributes-mapping.test.ts`. Since `buildPatientContext` in multi-pathway-resolution.ts is the cleanest pure-ish mapper, export it if not already exported and test it (if it is not exportable without side effects, test `normalizePatientAttributes` integration via a thin exported mapper instead). Minimal contract:

```ts
import { buildPatientContext } from '../resolvers/mutations/multi-pathway-resolution';

describe('buildPatientContext maps patientAttributes', () => {
  it('normalizes and attaches patientAttributes from input', () => {
    const pc = buildPatientContext({
      patientContext: {
        patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [],
        vitalSigns: {}, freeformData: {}, patientAttributes: { gestational_age_weeks: 20 },
      },
    } as never);
    expect(pc.patientAttributes).toEqual({ gestational_age_weeks: 20, trimester: 2 });
  });
});
```

If `buildPatientContext` isn't exported or takes a different arg shape, adjust the test to the real signature (the exploration cites `multi-pathway-resolution.ts:524-535`, called at 161/172). Prefer exporting the helper over reshaping it.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- patient-attributes-mapping`
Expected: FAIL — `patientAttributes` not mapped.

- [ ] **Step 4: Thread through all four mapping sites**

Add `import { normalizePatientAttributes } from '../../services/resolution/patient-attributes';` (adjust relative depth per file) and at each site attach the field:

- `resolution.ts` startResolution (~85-93): add to the `const patientContext: PatientContext = {...}` literal:
  ```ts
  patientAttributes: normalizePatientAttributes(pc?.patientAttributes),
  ```
- `resolution.ts` addPatientContext (~523-537): spread-merge like the `vitalSigns`/`freeformData` merges:
  ```ts
  patientAttributes: {
    ...(basePc.patientAttributes ?? {}),
    ...(normalizePatientAttributes(args.additionalContext.patientAttributes) ?? {}),
  },
  ```
  (If the merged object is empty, leaving `{}` is harmless; the `patient.*` resolver reads keys and returns undefined for missing ones.)
- `multi-pathway-resolution.ts` `buildPatientContext` (~524-535): add `patientAttributes: normalizePatientAttributes(pc?.patientAttributes),`.
- `Query.ts` `previewPathwayConfidence` (~521-528): add `patientAttributes: normalizePatientAttributes(pc?.patientAttributes),`.

- [ ] **Step 5: Run test + build codegen**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- patient-attributes-mapping patient-attributes`
Expected: PASS.

Run: `npm run build --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql/apps/pathway-service`
Expected: codegen + tsc succeed (the new `JSON` input field flows into generated types).

- [ ] **Step 6: Scoped typecheck for touched resolvers**

Run: `npx tsc --noEmit -p apps/pathway-service/tsconfig.json 2>&1 | grep -E "resolution.ts|multi-pathway-resolution|Query.ts|patient-attributes"`
Expected: no NEW errors attributable to these edits (pre-existing unrelated errors may remain; compare against a stash if unsure).

- [ ] **Step 7: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add apps/pathway-service/schema.graphql apps/pathway-service/src/resolvers/mutations/resolution.ts apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts apps/pathway-service/src/resolvers/Query.ts apps/pathway-service/src/__tests__/patient-attributes-mapping.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: accept patientAttributes on the resolution input path"
```

---

## Task 3 (frontend): supply `patientAttributes` from the composer

**Files:**
- Modify: `src/types/index.ts` (`PatientContextInput` ~288)
- Modify: `src/lib/derive-patient-context.ts` (default return ~102-110)
- Modify: `src/app/encounter/page.tsx` (assembly/submit)

**Interfaces:**
- Produces: the simulator sends `patientAttributes` (a `Record<string, number|string|boolean>`) in its `PatientContextInput`.

- [ ] **Step 1: Extend the FE input type**

In `src/types/index.ts`, add to `PatientContextInput` (~288):

```ts
  patientAttributes?: Record<string, number | string | boolean>;
```

- [ ] **Step 2: Include it in the composer default**

In `src/lib/derive-patient-context.ts`, add `patientAttributes: {}` to the returned object (~102-110) so the shape is always present.

- [ ] **Step 3: Wire a minimal supply UI + submit**

In `src/app/encounter/page.tsx`, where the `PatientContextInput` is assembled before submit: include `patientAttributes` from composer state. For v1, a minimal control is acceptable — the required-fields harvest (Plan 4 Task 4) surfaces which `patient.*` attributes a pathway needs; render number/text inputs for those and collect into a `patientAttributes` object. Keep it consistent with how `vitalSigns`/`narrative` are collected (this file already merges narrative into `freeformData` at ~131-153 and maps scenario `vitals` at ~240-241 — mirror that pattern).

If a full dynamic form is more than v1 warrants, a single JSON/number-field for `gestational_age_weeks` + `trimester` (the anemia pathway's needs) is an acceptable minimum — document the reduction in the report.

- [ ] **Step 4: Build + lint gate**

Run: `npm run build --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard`
Run: `npm run lint --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard`
Expected: both succeed.

- [ ] **Step 5: Manual verification**

Run the stack; in the encounter simulator, supply `gestational_age_weeks: 20` (or `trimester: 2`), resolve a pathway with a `patient.trimester` gate, and confirm via the resolution result / evidence trail that the trimester gate evaluates (not gated-out for missing data). Record in the report.

- [ ] **Step 6: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard add src/types/index.ts src/lib/derive-patient-context.ts src/app/encounter/page.tsx
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard commit -m "feat: supply patientAttributes from the encounter simulator"
```

---

## Self-Review

**Spec coverage:** `patientAttributes` populated via the supply path → Tasks 2+3 ✓; GA→trimester derivation → Task 1 ✓; `patient.*` resolves against real data → end-to-end via Tasks 1-3 ✓. Snapshot-derivation correctly deferred (no source data) and documented. `rh_factor` intentionally left to the `lab.*` namespace (redundant as `patient.*`).

**Placeholder scan:** none. The v1 composer-UI reduction (gestational_age_weeks/trimester minimum) is stated explicitly, not a TBD.

**Type consistency:** `normalizePatientAttributes` returns `Record<string, number|string|boolean> | undefined`, matching `PatientContext.patientAttributes?`. The four mapping sites call it identically. FE type mirrors the backend `JSON` input.

**Dependency note:** Task 3 (composer) is most useful once Plan 4 Task 4 (required-fields harvest for attributes) has landed, so the composer knows which `patient.*` fields to prompt for. If executed before Plan 4, ship the minimal gestational_age_weeks/trimester control.

---

## Next Plan

- **Plan 5 — Reset & prove**: re-author the disposable pathways to canonical form (using coded labs + `patient.trimester`) and add an end-to-end resolution test that supplies `patientAttributes` and asserts gates fire.
