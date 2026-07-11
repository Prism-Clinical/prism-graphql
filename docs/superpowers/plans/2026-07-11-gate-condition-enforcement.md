# Gate Condition Enforcement — Implementation Plan (Plan 2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject non-canonical gate conditions at import time, and fix the reachability scorer so "do we have data for this gate?" and data-gap hints are correct for BOTH coded and attribute conditions.

**Architecture:** Add exported runtime operator/namespace constants (the schema currently has only TS-only union types). The import validator gains a per-condition check that mirrors the discriminated-union rules. The reachability scorer branches on `isAttributeCondition` — attribute conditions resolve via the same `resolveAttribute` path the evaluator uses (so it needs the `AttributeCodeMap` threaded in), and `exists` is data-independent while comparators are data-dependent.

**Tech Stack:** TypeScript 5 (strict), PostgreSQL 15 (Apache AGE), Jest (ts-jest, `maxWorkers=1`). Builds on Plan 1 (canonical schema, attribute registry, code map).

## Global Constraints

- Strict TypeScript: `noImplicitAny`, `noImplicitReturns`. No `any` in new code; use `unknown` + narrowing.
- Never chain `cd` with other commands. Use `npm --prefix`/`git -C`, or run `cd` alone.
- Work in the worktree: `/home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql`. Paths below are relative to it.
- Conventional commit prefixes. No `@anthropic.com`/`@claude.com` Co-Authored-By lines.
- **Verification gate is JEST, not whole-project `tsc`** (~3990 pre-existing monorepo errors; the pathway-service test suite never `tsc`-cleaned). Run suites via `npm test --prefix <repo-root> -- <safe-pattern>` OR `--runTestsByPath <abs-file>`. **The worktree dir name contains "attribute"/"field"**, so `npm test -- attribute` matches ~90 unrelated files — never use those substrings as a jest pattern.
- Canonical operators are snake_case only. Import validation must REJECT SQL-style `LT`/`GTE`/`EQUALS`/`IN` and any operator not in the kind's set.
- Validation failures are plain human-readable strings pushed into `ValidationResult.errors`/`.warnings` — no error codes/objects (match `validator.ts` convention). A malformed operator/field/namespace is a hard `errors` entry even in draft mode (it is schema-invalid, not WIP-incomplete).

---

## File Structure

- **Modify** `src/services/resolution/types.ts` — add exported runtime `VALID_CODED_OPERATORS`, `VALID_ATTRIBUTE_OPERATORS` (arrays/sets whose members exactly equal the union types).
- **Modify** `src/services/resolution/attribute-registry.ts` — export `VALID_ATTRIBUTE_NAMESPACES` and key `RESOLVERS` off it (no drift).
- **Modify** `src/services/import/validator.ts` — add `validateGateConditions` per-condition checks, called from the gate loop.
- **Modify** `src/services/resolution/reachability.ts` — branch `hasDataForCondition`/`missingDataForCondition`/`classifyGate`/`buildExplanation` on kind; thread `AttributeCodeMap`; add `MissingData.attribute?`.
- **Modify** `src/services/resolution/reachability-loader.ts` — load the code map and pass it to `scoreReachability`.
- **Tests** (modify): `src/__tests__/validator.test.ts`, `src/__tests__/reachability.test.ts`.

---

## Task 1: Export runtime operator + namespace constants

**Files:**
- Modify: `src/services/resolution/types.ts` (after the operator union types, ~line 84)
- Modify: `src/services/resolution/attribute-registry.ts` (RESOLVERS, ~line 27)
- Test: `src/__tests__/operator-constants.test.ts` (create)

**Interfaces:**
- Produces:
  - `export const VALID_CODED_OPERATORS: readonly CodedOperator[]`
  - `export const VALID_ATTRIBUTE_OPERATORS: readonly AttributeOperator[]`
  - `export const VALID_ATTRIBUTE_NAMESPACES: readonly ['lab','vitals','allergy','patient']` (from attribute-registry.ts)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/operator-constants.test.ts`:

```ts
import { VALID_CODED_OPERATORS, VALID_ATTRIBUTE_OPERATORS } from '../services/resolution/types';
import { VALID_ATTRIBUTE_NAMESPACES } from '../services/resolution/attribute-registry';

describe('runtime operator/namespace constants', () => {
  it('coded operators match the union members', () => {
    expect([...VALID_CODED_OPERATORS].sort()).toEqual(
      ['count_in_window','delta_from_baseline','equals','exists','greater_than','includes_code','less_than','trend_down','trend_up'].sort(),
    );
  });
  it('attribute operators match the union members', () => {
    expect([...VALID_ATTRIBUTE_OPERATORS].sort()).toEqual(
      ['equals','exists','greater_or_equal','greater_than','in','less_or_equal','less_than','not_equals'].sort(),
    );
  });
  it('attribute namespaces are the 4 registry namespaces', () => {
    expect([...VALID_ATTRIBUTE_NAMESPACES].sort()).toEqual(['allergy','lab','patient','vitals']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- operator-constants`
Expected: FAIL — the constants are not exported.

- [ ] **Step 3: Add operator constants in `types.ts`**

In `src/services/resolution/types.ts`, immediately after the `AttributeOperator` type (~line 84), add. The `satisfies readonly CodedOperator[]` makes the array a compile-time-checked mirror of the union (a typo or missing member fails the build):

```ts
export const VALID_CODED_OPERATORS = [
  'includes_code', 'equals', 'exists',
  'greater_than', 'less_than',
  'count_in_window', 'trend_up', 'trend_down', 'delta_from_baseline',
] as const satisfies readonly CodedOperator[];

export const VALID_ATTRIBUTE_OPERATORS = [
  'equals', 'not_equals',
  'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
  'in', 'exists',
] as const satisfies readonly AttributeOperator[];
```

- [ ] **Step 4: Export namespaces in `attribute-registry.ts` and key RESOLVERS off them**

In `src/services/resolution/attribute-registry.ts`, replace the `const RESOLVERS: Record<string, NamespaceResolver> = { lab, vitals, allergy, patient };` declaration so the namespace list is the single source of truth:

```ts
export const VALID_ATTRIBUTE_NAMESPACES = ['lab', 'vitals', 'allergy', 'patient'] as const;
export type AttributeNamespace = (typeof VALID_ATTRIBUTE_NAMESPACES)[number];

const RESOLVERS: Record<AttributeNamespace, NamespaceResolver> = { lab, vitals, allergy, patient };
```

(Keep the resolver function definitions above unchanged; only the const + type lines change.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- operator-constants`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add src/services/resolution/types.ts src/services/resolution/attribute-registry.ts src/__tests__/operator-constants.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: export runtime operator + namespace constants for validation"
```

---

## Task 2: Import-time condition validation

**Files:**
- Modify: `src/services/import/validator.ts` (add `validateGateConditions`, call from `validateGateNodes` ~line 199-237)
- Test: `src/__tests__/validator.test.ts` (extend the existing `describe('Gate node validation')` block ~line 335)

**Interfaces:**
- Consumes: `isAttributeCondition`, `VALID_CODED_OPERATORS`, `VALID_ATTRIBUTE_OPERATORS` (types.ts), `VALID_ATTRIBUTE_NAMESPACES` (attribute-registry.ts).
- Produces: import validation that pushes a descriptive `errors[]` string for each malformed condition. No signature changes to `validatePathwayJson`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/validator.test.ts`, inside the existing `describe('Gate node validation', ...)` block (~line 335, which already has an `addValidGate` helper), add:

```ts
describe('condition schema validation', () => {
  it('rejects a condition with neither field nor attribute', () => {
    const pw = clonePathway(REFERENCE_PATHWAY);
    addValidGate(pw, { operator: 'less_than', value: '7' }); // no field, no attribute
    const result = validatePathwayJson(pw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('exactly one of'));
  });

  it('rejects a condition with both field and attribute', () => {
    const pw = clonePathway(REFERENCE_PATHWAY);
    addValidGate(pw, { field: 'labs', attribute: 'lab.hemoglobin', operator: 'less_than', value: '7' });
    expect(validatePathwayJson(pw).errors).toContainEqual(expect.stringContaining('exactly one of'));
  });

  it('rejects an SQL-style operator (LT) on a coded condition', () => {
    const pw = clonePathway(REFERENCE_PATHWAY);
    addValidGate(pw, { field: 'labs', operator: 'LT', value: '718-7' });
    expect(validatePathwayJson(pw).errors).toContainEqual(expect.stringContaining('operator'));
  });

  it('rejects an attribute with an unregistered namespace', () => {
    const pw = clonePathway(REFERENCE_PATHWAY);
    addValidGate(pw, { attribute: 'bogus.thing', operator: 'exists', value: true });
    expect(validatePathwayJson(pw).errors).toContainEqual(expect.stringContaining('namespace'));
  });

  it('rejects an unknown decorator/extra key', () => {
    const pw = clonePathway(REFERENCE_PATHWAY);
    addValidGate(pw, { field: 'labs', operator: 'less_than', value: '718-7', threshold: 7, bogusKey: 1 });
    expect(validatePathwayJson(pw).errors).toContainEqual(expect.stringContaining('unknown'));
  });

  it('accepts a valid coded condition with a display decorator', () => {
    const pw = clonePathway(REFERENCE_PATHWAY);
    addValidGate(pw, { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7, display: 'Hemoglobin' });
    expect(validatePathwayJson(pw).valid).toBe(true);
  });

  it('accepts a valid attribute condition', () => {
    const pw = clonePathway(REFERENCE_PATHWAY);
    addValidGate(pw, { attribute: 'patient.trimester', operator: 'in', value: [1, 3] });
    expect(validatePathwayJson(pw).valid).toBe(true);
  });
});
```

If `addValidGate`'s current signature hardcodes the condition, adjust it (or add an `addGateWithCondition(pw, condition)` helper) so a raw condition object can be injected — keep it minimal, matching the file's existing helper style.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- validator`
Expected: FAIL — no condition validation exists yet (all malformed conditions currently pass).

- [ ] **Step 3: Implement `validateGateConditions`**

In `src/services/import/validator.ts`, add imports at the top:

```ts
import { VALID_CODED_OPERATORS, VALID_ATTRIBUTE_OPERATORS, isAttributeCondition } from '../resolution/types';
import { VALID_ATTRIBUTE_NAMESPACES } from '../resolution/attribute-registry';
```

Add the helper (module-private) and the allowed-key sets:

```ts
const CODED_KEYS = new Set([
  'field', 'operator', 'value', 'system', 'threshold',
  'window_days', 'count_threshold', 'min_points', 'slope_threshold', 'delta_threshold',
  'display', 'note',
]);
const ATTRIBUTE_KEYS = new Set(['attribute', 'operator', 'value', 'unit', 'display', 'note']);
const CODED_OPS = new Set<string>(VALID_CODED_OPERATORS);
const ATTR_OPS = new Set<string>(VALID_ATTRIBUTE_OPERATORS);
const NAMESPACES = new Set<string>(VALID_ATTRIBUTE_NAMESPACES);

function validateGateConditions(
  gateId: string,
  conditions: Array<Record<string, unknown>>,
  errors: string[],
): void {
  conditions.forEach((c, i) => {
    const where = `Gate "${gateId}" condition[${i}]`;
    const hasField = typeof c.field === 'string';
    const hasAttr = typeof c.attribute === 'string';
    if (hasField === hasAttr) {
      errors.push(`${where}: must have exactly one of "field" or "attribute".`);
      return; // can't classify further
    }
    const op = typeof c.operator === 'string' ? c.operator : '';
    if (hasAttr) {
      if (!ATTR_OPS.has(op)) errors.push(`${where}: operator "${op}" is not a valid attribute operator.`);
      const ns = (c.attribute as string).split('.')[0];
      if (!NAMESPACES.has(ns)) errors.push(`${where}: attribute namespace "${ns}" is not registered.`);
      for (const k of Object.keys(c)) if (!ATTRIBUTE_KEYS.has(k)) errors.push(`${where}: unknown key "${k}" on attribute condition.`);
    } else {
      if (!CODED_OPS.has(op)) errors.push(`${where}: operator "${op}" is not a valid coded operator.`);
      if (c.value == null) errors.push(`${where}: coded condition requires a "value".`);
      for (const k of Object.keys(c)) if (!CODED_KEYS.has(k)) errors.push(`${where}: unknown key "${k}" on coded condition.`);
    }
  });
}
```

Then call it from inside `validateGateNodes`'s per-gate loop (after the existing checks, ~line 236), gathering both the single `condition` and the `conditions[]` array:

```ts
const conds = [
  ...(props.condition && typeof props.condition === 'object' ? [props.condition as Record<string, unknown>] : []),
  ...(Array.isArray(props.conditions) ? (props.conditions as Array<Record<string, unknown>>) : []),
];
if (conds.length > 0) validateGateConditions(gate.id, conds, errors);
```

(Always `errors`, not `softTarget` — a malformed operator/namespace is schema-invalid regardless of draft mode.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- validator`
Expected: PASS — all new cases plus the pre-existing validator tests.

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add src/services/import/validator.ts src/__tests__/validator.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: reject non-canonical gate conditions at import"
```

---

## Task 3: Reachability scorer understands both condition kinds

**Files:**
- Modify: `src/services/resolution/reachability.ts` (`hasDataForCondition` ~60-89, `missingDataForCondition` ~91-111, `classifyGate` ~113-145, `buildExplanation` ~147-217, `scoreReachability` ~219-273, `MissingData` ~12-19, operator sets ~40-49)
- Modify: `src/services/resolution/reachability-loader.ts` (`computePathwayReachability` ~line 41 — load + pass the code map)
- Test: `src/__tests__/reachability.test.ts` (add attribute-condition cases)

**Interfaces:**
- Consumes: `isAttributeCondition` (types), `resolveAttribute` (attribute-registry), `AttributeCodeMap` + `loadAttributeCodeMap`/`buildCodeMap` (attribute-code-map).
- Produces: `hasDataForCondition(condition, patient, codeMap)`, `scoreReachability(gateNodes, patient, codeMap)` — the `codeMap` param is **required** on these internal functions (all callers pass it); `computePathwayReachability` loads it. `MissingData` gains `attribute?: string`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/reachability.test.ts`, add a helper + cases (mirror the existing `patientAttrGate`/`makeGateNode` style; construct a stub map with `buildCodeMap`):

```ts
import { buildCodeMap } from '../services/resolution/attribute-code-map';

const HB_MAP = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
]);

describe('reachability — attribute conditions', () => {
  it('exists on an attribute is always evaluable (data-independent)', () => {
    const cond = { attribute: 'patient.trimester', operator: 'exists', value: true } as const;
    expect(hasDataForCondition(cond, EMPTY_PATIENT, HB_MAP)).toBe(true);
  });

  it('a comparator attribute condition needs the datum present', () => {
    const cond = { attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 } as const;
    const withHb = { ...EMPTY_PATIENT, labResults: [{ code: '718-7', system: 'LOINC', value: 8.1 }] };
    expect(hasDataForCondition(cond, withHb, HB_MAP)).toBe(true);   // Hb present → evaluable
    expect(hasDataForCondition(cond, EMPTY_PATIENT, HB_MAP)).toBe(false); // Hb absent → data-blocked
  });

  it('patient.* comparator resolves from patientAttributes', () => {
    const cond = { attribute: 'patient.trimester', operator: 'greater_or_equal', value: 2 } as const;
    const withTri = { ...EMPTY_PATIENT, patientAttributes: { trimester: 2 } };
    expect(hasDataForCondition(cond, withTri, HB_MAP)).toBe(true);
    expect(hasDataForCondition(cond, EMPTY_PATIENT, HB_MAP)).toBe(false);
  });
});
```

Also update the existing `hasDataForCondition(...)` call sites in this test file to pass a third arg (e.g. `new Map()` or `HB_MAP`) — the signature is changing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- reachability`
Expected: FAIL — `hasDataForCondition` doesn't accept a codeMap and mis-scores attribute conditions.

- [ ] **Step 3: Rework `reachability.ts` to branch on kind**

Add imports:

```ts
import { isAttributeCondition, AttributeCodeMap } from './types';
import { resolveAttribute } from './attribute-registry';
```

Add `attribute?: string;` to the `MissingData` interface (~line 12-19).

Replace `hasDataForCondition` (keep the coded branch as-is; prepend the attribute branch):

```ts
export function hasDataForCondition(
  condition: GateCondition,
  patient: PatientContext,
  codeMap: AttributeCodeMap,
): boolean {
  if (isAttributeCondition(condition)) {
    if (condition.operator === 'exists') return true;            // data-independent
    return resolveAttribute(patient, condition.attribute, codeMap).value !== undefined;
  }
  const { field, operator } = condition;                        // coded path (unchanged below)
  if (ALWAYS_EVALUABLE_OPERATORS.has(operator)) return true;
  if (!DATA_DEPENDENT_OPERATORS.has(operator)) return false;
  // ... existing labs/vitals branches unchanged ...
}
```

Extend the coded operator sets so the coded time-shape operators are treated as data-dependent (they need lab series):

```ts
const DATA_DEPENDENT_OPERATORS: ReadonlySet<string> = new Set([
  'greater_than', 'less_than', 'count_in_window', 'trend_up', 'trend_down', 'delta_from_baseline',
]);
```

In `missingDataForCondition` (~91-111), add an early attribute branch:

```ts
if (isAttributeCondition(condition)) {
  return { attribute: condition.attribute, comparison: undefined };
}
```

In `classifyGate` (~113-145): the "has any data-dependent condition" test currently uses `DATA_DEPENDENT_OPERATORS.has(c.operator)`. Make it kind-aware — an attribute condition is data-dependent unless its operator is `exists`:

```ts
const isDataDependent = (c: GateCondition) =>
  isAttributeCondition(c) ? c.operator !== 'exists' : DATA_DEPENDENT_OPERATORS.has(c.operator);
```

Use `isDataDependent(c)` in place of the inline `DATA_DEPENDENT_OPERATORS.has(c.operator)` checks in `classifyGate` and `buildExplanation`, and pass `codeMap` into every `hasDataForCondition(...)` call. Thread a `codeMap: AttributeCodeMap` param through `classifyGate`, `buildExplanation`, and the exported `scoreReachability(gateNodes, patient, codeMap)`.

Keep the "unknown operator → false" behavior (the `reachability.test.ts:168` `matches_regex` case must still return false): an unknown operator is neither in the coded sets nor (for a coded condition) attribute-handled, so it falls through to `return false` as today.

- [ ] **Step 4: Load the code map in the loader**

In `src/services/resolution/reachability-loader.ts`, in `computePathwayReachability(pool, pathwayRelationalId, patient)` (~line 41), load the map and pass it:

```ts
import { loadAttributeCodeMap } from './attribute-code-map';
// ...
const codeMap = await loadAttributeCodeMap(pool);
return scoreReachability(gateNodes, patient, codeMap);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- reachability`
Expected: PASS — new attribute cases + existing coded cases (with the updated 3-arg calls) all green.

- [ ] **Step 6: Scoped typecheck + no regressions**

Run: `npx tsc --noEmit -p apps/pathway-service/tsconfig.json 2>&1 | grep -E "reachability|attribute-registry|import/validator"`
Expected: empty (touched files clean; the pre-existing `reachability.test.ts:168` operator-union mismatch is resolved because `matches_regex` now goes through the string-typed operator path — confirm it no longer errors).

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- reachability validator operator-constants matched-pathway-reachability`
(Note: none of those patterns contain "attribute"/"field", so they're safe.)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add src/services/resolution/reachability.ts src/services/resolution/reachability-loader.ts src/__tests__/reachability.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: reachability scorer handles attribute conditions (threads code map)"
```

---

## Self-Review

**Spec coverage:** import validation (exactly-one-of, operator-in-set, coded-requires-value, namespace-registered, decorator allowlist) → Task 2 ✓; reachability handles both kinds + threads code map → Task 3 ✓; runtime constants to drive both → Task 1 ✓. The deferred Plan-3 item "`valueType` vs resolved runtime type" is NOT in Plan 2 scope (it needs the resolver, not the validator) — leave for a later hardening pass.

**Placeholder scan:** none. `matches_regex` handling is explicit.

**Type consistency:** `VALID_*` constants are `satisfies` the unions (compile-time mirror). `hasDataForCondition`/`scoreReachability` gain a required `codeMap` param uniformly; the loader supplies it. `MissingData.attribute?` added where the attribute branch populates it.

---

## Next Plans

- **Plan 3 — Substrate population** (populate `patientAttributes`).
- **Plan 4 — Authoring UI** (must land AFTER this plan — the final review flagged that shipping the UI before this validator would let malformed conditions through).
- **Plan 5 — Reset & prove**.
