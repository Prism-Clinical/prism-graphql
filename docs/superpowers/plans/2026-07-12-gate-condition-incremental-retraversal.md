# Gate Condition Incremental Retraversal Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make attribute-model gate conditions (`patient.*`/`lab.*`/`vitals.*`/`allergy.*`) — and mid-session-added legacy context — re-evaluate correctly on the INCREMENTAL resolution path (`addPatientContext`, `answerGateQuestion`, `overrideNode`), not only at fresh `startResolution`.

**Architecture:** Two defects, one clean fix. (1) **Trigger gap:** `addPatientContext` selects "affected" gates by looking each gate's recorded dependency up in a map keyed only by the 5 legacy coded buckets (`conditions|medications|labs|allergies|vitals`); attribute dependencies are recorded as dotted paths (`patient.trimester`), so they never match and their gates are never re-evaluated. (2) **Context-scope bug (pre-existing, field-agnostic):** `answerGateQuestion` and `overrideNode` rebuild the `PatientContext` from `session.initialPatientContext` only and discard `session.additionalContext` wholesale — so ANY mid-session-added context (legacy or attribute) is invisible on those paths. We fix both by (a) extracting the existing `addPatientContext` merge logic into ONE shared `buildEffectivePatientContext(initialPc, additions)` helper used by all three entry points (so reconstruction is uniform and accumulates), and (b) making the dependency→context-key lookup namespace-aware so dotted attribute paths map to the right added-context bag.

**Tech Stack:** TypeScript 5 (strict), Apollo Federation subgraph, PostgreSQL, Jest (ts-jest, `maxWorkers=1`). Builds on Plans 1–3 (discriminated-union condition schema, attribute registry, `patientAttributes` input path, `normalizePatientAttributes`).

## Global Constraints

- Strict TypeScript: `noImplicitAny`, `noImplicitReturns`. No `any` in new code; use `unknown` + narrowing or precise casts that mirror existing ones (e.g. `as PatientContext`).
- Never chain `cd` with other commands. Use `npm --prefix`/`git -C`, or run `cd` alone.
- Work in the worktree: `/home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql`. Paths below are relative to it.
- Conventional commit prefixes. No `@anthropic.com`/`@claude.com` Co-Authored-By lines.
- **Verification gate is JEST + scoped `tsc`, NOT whole-project `tsc`** (~3990 pre-existing monorepo errors). ts-jest runs with `diagnostics` DISABLED, so Jest passing does NOT prove a file type-checks — after Jest is green, run the scoped `tsc -p apps/pathway-service/tsconfig.json` grep shown in each task.
- **The worktree dir name contains "attribute" AND "field"**, so `npm test -- attribute` matches ~90 unrelated files. Use `--runTestsByPath <abs-file>` or a pattern that contains NEITHER substring (e.g. `effective-context`, `dependency-context-key`, `resolution-retraversal` are safe).
- **Behavior-preservation for legacy coded paths:** the extracted helper must reproduce the EXACT merge semantics currently in `addPatientContext` (`resolution.ts:513-545`) — dedup coded arrays by `code|system`, spread-merge `vitalSigns`/`freeformData`, normalize+merge `patientAttributes`. Do not change dedup/merge behavior; only relocate and reuse it.

---

## File Structure

- **Create** `apps/pathway-service/src/services/resolution/effective-context.ts` — `buildEffectivePatientContext(initialPc, additions)` (the relocated merge logic) and `dependencyContextKey(field)` (dependency-string → added-context key, namespace-aware).
- **Modify** `apps/pathway-service/src/resolvers/mutations/resolution.ts` — three retraversal entry points:
  - `addPatientContext` (~505-623): use `buildEffectivePatientContext` from the ACCUMULATED merged bag; use `dependencyContextKey` in the affected-gate loop; add `patientAttributes` to `changedFields`.
  - `answerGateQuestion` (~362) and `overrideNode` (~225): reconstruct the effective context instead of using `initialPatientContext` raw.
- **Tests:**
  - Create `apps/pathway-service/src/__tests__/effective-context.test.ts` (Task 1).
  - Create `apps/pathway-service/src/__tests__/dependency-context-key.test.ts` (Task 2).
  - Extend the existing resolution-mutations test suite, or create `apps/pathway-service/src/__tests__/resolution-retraversal-context.test.ts`, for the entry-point wiring (Task 3).

---

## Task 1: Extract `buildEffectivePatientContext` (shared effective-context reconstruction)

**Files:**
- Create: `apps/pathway-service/src/services/resolution/effective-context.ts`
- Test: `apps/pathway-service/src/__tests__/effective-context.test.ts`

**Interfaces:**
- Consumes: `PatientContext` (from `../confidence/types`), `AdditionalContextInput` (the generated GraphQL input type — import it from the SAME module `resolution.ts` imports it from; grep `resolution.ts` for `AdditionalContextInput` to find the source), `normalizePatientAttributes` (from `./patient-attributes`).
- Produces:
  - `export function buildEffectivePatientContext(initialPc: PatientContext, additions: Partial<AdditionalContextInput> | undefined): PatientContext` — returns `initialPc` merged with `additions` using the exact semantics from `resolution.ts:513-545` (dedup coded arrays by `code|system`, spread vitals/freeform, normalize+merge patientAttributes). With `additions` nullish/empty, returns a context value-equal to `initialPc`.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/effective-context.test.ts`:

```ts
import { buildEffectivePatientContext } from '../services/resolution/effective-context';
import type { PatientContext } from '../services/confidence/types';

const BASE: PatientContext = {
  patientId: 'p1',
  conditionCodes: [{ code: 'D64.9', system: 'ICD-10' }],
  medications: [],
  labResults: [{ code: '718-7', system: 'LOINC', value: 8.1 }],
  allergies: [],
  vitalSigns: { systolic_bp: 120 },
  freeformData: { note: 'x' },
  patientAttributes: { trimester: 1 },
} as PatientContext;

describe('buildEffectivePatientContext', () => {
  it('returns a value-equal context when additions are empty/undefined', () => {
    expect(buildEffectivePatientContext(BASE, undefined)).toEqual(BASE);
    expect(buildEffectivePatientContext(BASE, {})).toEqual(BASE);
  });

  it('dedups coded arrays by code|system and appends new ones', () => {
    const out = buildEffectivePatientContext(BASE, {
      conditionCodes: [{ code: 'D64.9', system: 'ICD-10' }, { code: 'O99.0', system: 'ICD-10' }],
    } as never);
    expect(out.conditionCodes).toEqual([
      { code: 'D64.9', system: 'ICD-10' },
      { code: 'O99.0', system: 'ICD-10' },
    ]);
  });

  it('spread-merges vitalSigns and freeformData (added overrides base)', () => {
    const out = buildEffectivePatientContext(BASE, {
      vitalSigns: { diastolic_bp: 80, systolic_bp: 130 },
      freeformData: { extra: 'y' },
    } as never);
    expect(out.vitalSigns).toEqual({ systolic_bp: 130, diastolic_bp: 80 });
    expect(out.freeformData).toEqual({ note: 'x', extra: 'y' });
  });

  it('normalizes and merges patientAttributes (GA->trimester derivation applies)', () => {
    const out = buildEffectivePatientContext(BASE, {
      patientAttributes: { gestational_age_weeks: 20 },
    } as never);
    // base trimester 1 is overridden by the normalized additions (GA 20 -> trimester 2)
    expect(out.patientAttributes).toEqual({ trimester: 2, gestational_age_weeks: 20 });
  });

  it('does not mutate the input context', () => {
    const snapshot = JSON.parse(JSON.stringify(BASE));
    buildEffectivePatientContext(BASE, { medications: [{ code: 'M1', system: 'RxNorm' }] } as never);
    expect(BASE).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- effective-context`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/pathway-service/src/services/resolution/effective-context.ts`. Copy the dedup + merge shape VERBATIM from `resolution.ts:513-545` (only the source of the additions changes — a parameter instead of `args.additionalContext`). Find the correct import path for `AdditionalContextInput` by grepping `resolution.ts`.

```ts
import type { PatientContext } from '../confidence/types';
import type { AdditionalContextInput } from '<same source as resolution.ts>';
import { normalizePatientAttributes } from './patient-attributes';

/**
 * Reconstruct the effective PatientContext for a resolution session:
 * initial snapshot merged with accumulated additional context. Mirrors the
 * merge semantics that addPatientContext has always used, extracted so every
 * retraversal entry point reconstructs context identically.
 */
export function buildEffectivePatientContext(
  initialPc: PatientContext,
  additions: Partial<AdditionalContextInput> | undefined,
): PatientContext {
  const add = additions ?? {};

  const dedup = <T extends { code: string; system: string }>(base: T[], added: T[]): T[] => {
    const seen = new Set(base.map((e) => `${e.code}|${e.system}`));
    const result = [...base];
    for (const item of added) {
      const key = `${item.code}|${item.system}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
    return result;
  };

  return {
    patientId: initialPc.patientId,
    conditionCodes: dedup(initialPc.conditionCodes, add.conditionCodes ?? []),
    medications: dedup(initialPc.medications, add.medications ?? []),
    labResults: dedup(initialPc.labResults, add.labResults ?? []),
    allergies: dedup(initialPc.allergies, add.allergies ?? []),
    vitalSigns: { ...(initialPc.vitalSigns ?? {}), ...(add.vitalSigns ?? {}) },
    freeformData: { ...(initialPc.freeformData ?? {}), ...(add.freeformData ?? {}) },
    patientAttributes: {
      ...(initialPc.patientAttributes ?? {}),
      ...(normalizePatientAttributes(add.patientAttributes) ?? {}),
    },
  };
}
```

If `dedup(initialPc.conditionCodes, add.conditionCodes ?? [])` fails to type-check because the input-array element type differs from the domain-array element type, mirror EXACTLY what `resolution.ts:529` already does (it compiles today) — including any cast present there. Do not introduce `any`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- effective-context`
Expected: PASS.

- [ ] **Step 5: Scoped typecheck**

Run: `npx tsc --noEmit -p apps/pathway-service/tsconfig.json 2>&1 | grep effective-context`
Expected: empty (new file clean).

- [ ] **Step 6: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add apps/pathway-service/src/services/resolution/effective-context.ts apps/pathway-service/src/__tests__/effective-context.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: extract buildEffectivePatientContext for uniform retraversal context"
```

---

## Task 2: Namespace-aware dependency matching + wire `addPatientContext`

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/effective-context.ts` (add `dependencyContextKey`)
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts` (`addPatientContext` ~505-623)
- Test: `apps/pathway-service/src/__tests__/dependency-context-key.test.ts` (create)

**Interfaces:**
- Consumes: `buildEffectivePatientContext` (Task 1), `AdditionalContextInput`.
- Produces:
  - `export function dependencyContextKey(field: string): keyof AdditionalContextInput | undefined` — maps a recorded gate-dependency string to the `AdditionalContextInput` key that supplies it. Coded buckets: `conditions→conditionCodes`, `medications→medications`, `labs→labResults`, `allergies→allergies`, `vitals→vitalSigns`. Dotted attribute paths by namespace: `patient.*→patientAttributes`, `lab.*→labResults`, `vitals.*→vitalSigns`, `allergy.*→allergies`. Unknown → `undefined`.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/dependency-context-key.test.ts`:

```ts
import { dependencyContextKey } from '../services/resolution/effective-context';

describe('dependencyContextKey', () => {
  it('maps legacy coded bucket names', () => {
    expect(dependencyContextKey('conditions')).toBe('conditionCodes');
    expect(dependencyContextKey('medications')).toBe('medications');
    expect(dependencyContextKey('labs')).toBe('labResults');
    expect(dependencyContextKey('allergies')).toBe('allergies');
    expect(dependencyContextKey('vitals')).toBe('vitalSigns');
  });
  it('maps dotted attribute paths by namespace', () => {
    expect(dependencyContextKey('patient.trimester')).toBe('patientAttributes');
    expect(dependencyContextKey('lab.hemoglobin')).toBe('labResults');
    expect(dependencyContextKey('vitals.systolic_bp')).toBe('vitalSigns');
    expect(dependencyContextKey('allergy.metronidazole')).toBe('allergies');
  });
  it('returns undefined for unknown dependencies', () => {
    expect(dependencyContextKey('bogus')).toBeUndefined();
    expect(dependencyContextKey('unknown.path')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- dependency-context-key`
Expected: FAIL — `dependencyContextKey` not exported.

- [ ] **Step 3: Implement `dependencyContextKey`**

Append to `apps/pathway-service/src/services/resolution/effective-context.ts`:

```ts
const CODED_FIELD_TO_KEY: Record<string, keyof AdditionalContextInput> = {
  conditions: 'conditionCodes',
  medications: 'medications',
  labs: 'labResults',
  allergies: 'allergies',
  vitals: 'vitalSigns',
};

const ATTRIBUTE_NAMESPACE_TO_KEY: Record<string, keyof AdditionalContextInput> = {
  patient: 'patientAttributes',
  lab: 'labResults',
  vitals: 'vitalSigns',
  allergy: 'allergies',
};

/**
 * The AdditionalContextInput key whose presence means "the data this gate
 * dependency reads may have changed". Coded gate deps are bucket names
 * ('labs'); attribute gate deps are dotted paths ('lab.hemoglobin') keyed by
 * namespace. Unknown deps map to undefined (never marked affected).
 */
export function dependencyContextKey(field: string): keyof AdditionalContextInput | undefined {
  const coded = CODED_FIELD_TO_KEY[field];
  if (coded) return coded;
  const dot = field.indexOf('.');
  if (dot > 0) return ATTRIBUTE_NAMESPACE_TO_KEY[field.slice(0, dot)];
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- dependency-context-key`
Expected: PASS.

- [ ] **Step 5: Wire `addPatientContext` to use both helpers**

In `apps/pathway-service/src/resolvers/mutations/resolution.ts`, add imports near the top (adjust relative depth to match sibling imports):

```ts
import { buildEffectivePatientContext, dependencyContextKey } from '../../services/resolution/effective-context';
```

Then in `addPatientContext`:

(a) Replace the inline `dedup` definition and the `const updatedPc: PatientContext = {...}` block (currently `resolution.ts:513-545`) with a single call that rebuilds from the ACCUMULATED merged bag (not just the incoming args — this also fixes cross-call accumulation):

```ts
const basePc = session.initialPatientContext as PatientContext;
const updatedPc = buildEffectivePatientContext(basePc, merged as Partial<AdditionalContextInput>);
```

(`merged` is the existing `{ ...(session.additionalContext ?? {}), ...args.additionalContext }` at ~508 — leave that line as-is; it is both persisted and now the source for reconstruction.)

(b) Add `patientAttributes` to `changedFields` (after the existing `freeformData` line, ~554):

```ts
if (args.additionalContext.patientAttributes) changedFields.add('patientAttributes');
```

(c) Replace the affected-gate loop (currently `resolution.ts:561-575`, the local `fieldToContextKey` map + the `for` loop) with a namespace-aware version using `dependencyContextKey`. Delete the local `fieldToContextKey` const (now centralized in the helper):

```ts
for (const [gateId, fields] of session.dependencyMap.gateContextFields) {
  for (const field of fields) {
    const contextKey = dependencyContextKey(field);
    if (contextKey && args.additionalContext[contextKey] !== undefined) {
      affectedNodes.add(gateId);
      break;
    }
  }
}
```

Leave the action-node scorer loop (`scorerInputs` / `changedFields`, ~578-585) unchanged.

- [ ] **Step 6: Run tests + scoped typecheck**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- effective-context dependency-context-key`
Expected: PASS.

Run: `npx tsc --noEmit -p apps/pathway-service/tsconfig.json 2>&1 | grep -E "effective-context|resolution.ts"`
Expected: empty (no new errors in the touched files; if `resolution.ts` shows an error, confirm it is pre-existing via `git stash` A/B before treating it as yours).

- [ ] **Step 7: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add apps/pathway-service/src/services/resolution/effective-context.ts apps/pathway-service/src/__tests__/dependency-context-key.test.ts apps/pathway-service/src/resolvers/mutations/resolution.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "fix: attribute-aware affected-gate selection + accumulated retraversal context in addPatientContext"
```

---

## Task 3: Reconstruct effective context in `answerGateQuestion` and `overrideNode`

**Files:**
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts` (`overrideNode` ~225, `answerGateQuestion` ~362)
- Test: extend the existing resolution-mutations test suite if one exists, else create `apps/pathway-service/src/__tests__/resolution-retraversal-context.test.ts`.

**Interfaces:**
- Consumes: `buildEffectivePatientContext` (Task 1).
- Produces: both entry points reconstruct `patientCtx` = `initialPatientContext` merged with `session.additionalContext`, so mid-session-added context (legacy AND attribute) is visible when they retraverse.

- [ ] **Step 1: Locate the test harness**

Grep for existing tests exercising these resolvers to find the session-construction pattern:
`grep -rl "answerGateQuestion\|addPatientContext\|overrideNode" apps/pathway-service/src/__tests__ apps/pathway-service/tests 2>/dev/null`
and inspect how they build a `session` / `dependencyMap` / `resolutionState`. Reuse that harness. If NO resolver-level harness exists, write the Step 2 test against the smallest real seam you can (constructing a session object literal of the shape `getSession` returns — see `session-store.ts` `getSession` for the shape), and if even that is impractical without a DB, document in the report that the entry-point wiring is proven by the Task-1 helper test + code inspection and the end-to-end proof is deferred to Plan 5. **Do not fabricate a passing test that asserts nothing.**

- [ ] **Step 2: Write the failing test (behavioral contract)**

The contract to prove: after context is added to a session (so `session.additionalContext` is non-empty), a subsequent `answerGateQuestion`-path re-evaluation builds a `PatientContext` that INCLUDES the added data — i.e. `buildEffectivePatientContext(session.initialPatientContext, session.additionalContext)` is what feeds retraversal, not `session.initialPatientContext` alone.

Concretely, assert that for a session whose `initialPatientContext` has `patientAttributes: {}` and whose `additionalContext` is `{ patientAttributes: { trimester: 2 } }`, the context handed to retraversal has `patientAttributes.trimester === 2` (and, to prove the fix is field-agnostic, a second case with a legacy `labResults` addition appears in the reconstructed `labResults`). Shape the test to the real harness found in Step 1.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- resolution-retraversal-context` (or the existing suite's safe pattern)
Expected: FAIL — the entry points currently pass `initialPatientContext` raw, so the added context is absent.

- [ ] **Step 4: Reconstruct effective context at both entry points**

In `apps/pathway-service/src/resolvers/mutations/resolution.ts`:

- `overrideNode` (~225): replace
  ```ts
  const patientCtx = session.initialPatientContext as PatientContext;
  ```
  with
  ```ts
  const patientCtx = buildEffectivePatientContext(
    session.initialPatientContext as PatientContext,
    session.additionalContext as Partial<AdditionalContextInput>,
  );
  ```
- `answerGateQuestion` (~362): make the identical replacement.

(`buildEffectivePatientContext` and `AdditionalContextInput` are already imported from Task 2. Both `patientCtx` usages downstream — the adapter and the `retraverse(...)` call — now see the reconstructed context automatically.)

- [ ] **Step 5: Run tests + scoped typecheck**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- resolution-retraversal-context effective-context dependency-context-key`
Expected: PASS.

Run: `npx tsc --noEmit -p apps/pathway-service/tsconfig.json 2>&1 | grep -E "resolution.ts|effective-context"`
Expected: empty (or only pre-existing errors confirmed via A/B stash).

- [ ] **Step 6: Broader regression check**

Run the existing resolution/retraversal suites to confirm the context-scope change didn't break established behavior (use safe patterns — no "attribute"/"field"):
Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- reachability validator operator-constants effective-context dependency-context-key resolution-retraversal-context`
Plus any resolver suite discovered in Step 1 (via `--runTestsByPath`).
Expected: PASS. Report any pre-existing failures separately from regressions.

- [ ] **Step 7: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add apps/pathway-service/src/resolvers/mutations/resolution.ts apps/pathway-service/src/__tests__/resolution-retraversal-context.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "fix: reconstruct effective context in answerGateQuestion + overrideNode retraversal"
```

---

## Self-Review

**Spec coverage:**
- Trigger gap (attribute deps never select their gate) → Task 2 (`dependencyContextKey` namespace mapping + wiring) ✓.
- Context-scope bug (answerGateQuestion/overrideNode discard additionalContext) → Task 3 ✓.
- Cross-call accumulation (addPatientContext rebuilt from incoming args, not accumulated bag) → Task 2 Step 5(a) (rebuild from `merged`) ✓.
- Uniform, non-special-cased reconstruction → Task 1 shared helper used by all three entry points ✓.

**Placeholder scan:** none. Task 3's test is contingent on the discovered harness — this is an explicit, honest instruction (find the real seam; do not fabricate), not a TBD. Production code for all three tasks is complete and exact.

**Type consistency:** `buildEffectivePatientContext(initialPc, additions)` and `dependencyContextKey(field)` are named identically everywhere they appear (Tasks 1→2→3). `AdditionalContextInput` is imported from the single source `resolution.ts` already uses. The `as Partial<AdditionalContextInput>` cast on `session.additionalContext` (typed `Record<string, unknown>`) mirrors the existing `as PatientContext` cast idiom.

**Behavior preservation:** Task 1 relocates the `resolution.ts:513-545` merge verbatim; Task 1's "value-equal when additions empty" and "no-mutation" tests guard the legacy semantics. Task 2 removes the now-duplicated inline `dedup`/`fieldToContextKey` from `resolution.ts` (DRY — the helper is the single source).

**Scope note (flag for reviewer/user):** Task 3 also fixes a PRE-EXISTING, field-agnostic bug (mid-session legacy context was invisible to `answerGateQuestion`/`overrideNode`), not only the attribute case. This is intentional — special-casing attributes would leave the legacy bug in place and duplicate reconstruction logic. The change makes those two paths see accumulated context they previously ignored; the Step 6 regression check guards against unexpected fallout.

## Next Plan

- **Plan 4 — Authoring UI**, then **Plan 5 — Reset & prove** (which can now assert BOTH fresh `startResolution` and incremental `addPatientContext`/`answerGateQuestion` evaluation of `patient.*` gates).
