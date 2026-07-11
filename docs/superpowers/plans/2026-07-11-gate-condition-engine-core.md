# Gate Condition Engine Core — Implementation Plan (Plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pathway-service evaluate both a coded (`field`) and a named (`attribute`) gate condition against a `PatientContext`, resolving named attributes through a curated name→code map and a derived-scalar bag.

**Architecture:** A gate condition is a discriminated union — exactly one of `field` (coded) or `attribute` (named). Coded conditions keep today's code-matching / numeric-by-code evaluators. Attribute conditions resolve a dotted path (`lab.hemoglobin`, `patient.trimester`, `vitals.systolic_bp`, `allergy.metronidazole`) through a namespace registry to a typed scalar/boolean, then a scalar-comparison core applies the operator. A curated `pathway_attribute_code_map` table (cached in-memory) maps `lab.*`/`allergy.*` names to codes; the map is loaded once when the resolution context is built and threaded into the evaluator so attribute resolution stays synchronous.

**Tech Stack:** TypeScript 5 (strict), Apollo Federation subgraph, PostgreSQL 15, Jest (ts-jest, `maxWorkers=1`, 30s timeout). Tests live in `apps/pathway-service/src/__tests__/*.test.ts`.

## Global Constraints

- Strict TypeScript: `noImplicitAny`, `noImplicitReturns`. No `any` in new code; use `unknown` + narrowing.
- Never chain `cd` with other commands. Use `npm --prefix <path>` / `git -C <path>` / run `cd` alone.
- All work happens in the worktree: `/home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql`. Every path below is relative to that repo root.
- Commit messages use conventional prefixes (`feat:`, `test:`, `chore:`). No `@anthropic.com`/`@claude.com` Co-Authored-By lines, no "Generated with Claude Code".
- Run a task's tests with: `npm test --prefix <repo-root> -- <testfile-substring>` (ts-jest). Migrations are applied against the live dev DB `prism_db` (user `prism`) — see Task 2.
- Canonical operators are snake_case only. SQL-style `LT`/`GTE`/`EQUALS`/`IN` are never accepted.
- **Typecheck reality (read before trusting any typecheck step):** `npm run typecheck` runs over the whole monorepo and reports **~3990 pre-existing errors** across other apps (missing `__generated__`, missing `cors` types, etc.), and the pathway-service test suite has never `tsc`-cleaned either (e.g. `default_behavior: 'skip'` vs `DefaultBehavior`). Tests run under ts-jest (lenient on types), which is the **real gate**. Do NOT gate a task on a clean whole-project typecheck. To check a task's *own* type safety, compile-scope to the files it changed, e.g. `npx tsc --noEmit -p apps/pathway-service/tsconfig.json 2>&1 | grep <changed-file>` and confirm no NEW errors there. The discriminated-union change also introduces exactly two incremental test-file errors — `gate-evaluator-count-in-window.test.ts` (widened inline `operator: string`) and `reachability.test.ts:168` (`operator: 'matches_regex'`, not in either union) — fixed in Task 5 and Plan 2 respectively (see those tasks).

---

## File Structure

- **Modify** `src/services/confidence/types.ts` — add `patientAttributes?` to `PatientContext`.
- **Modify** `src/services/resolution/types.ts` — replace `GateCondition` with the discriminated union + operator unions; add `AttributeCodeMap`/`AttributeCodeEntry` types.
- **Create** `shared/data-layer/migrations/062_create_pathway_attribute_code_map.sql` — the curated map table + seed rows.
- **Create** `src/services/resolution/attribute-code-map.ts` — cached loader for the map table.
- **Create** `src/services/resolution/attribute-registry.ts` — namespace resolvers + `resolveAttribute()`.
- **Create** `src/services/resolution/scalar-compare.ts` — the attribute-operator comparison core.
- **Modify** `src/services/resolution/gate-evaluator.ts` — split `evaluateCondition` into coded + attribute dispatch; thread the code map.
- **Modify** `src/resolvers/helpers/resolution-context.ts` — load the code map when building the resolution context.
- **Tests** (create): `attribute-code-map.test.ts`, `attribute-registry.test.ts`, `scalar-compare.test.ts`, `gate-evaluator-attribute.test.ts`.

---

## Task 1: Canonical condition schema + `patientAttributes` substrate

**Files:**
- Modify: `src/services/confidence/types.ts` (PatientContext interface)
- Modify: `src/services/resolution/types.ts` (GateCondition + operator unions + code-map types)
- Test: `src/__tests__/condition-schema-types.test.ts` (create)

**Interfaces:**
- Produces:
  - `PatientContext.patientAttributes?: Record<string, number | string | boolean>`
  - `type CodedOperator`, `type AttributeOperator`
  - `interface CodedCondition`, `interface AttributeCondition`, `type GateCondition = CodedCondition | AttributeCondition`
  - `function isAttributeCondition(c: GateCondition): c is AttributeCondition`
  - `interface AttributeCodeEntry { attributeName: string; namespace: string; system: string; code: string; valueType: 'number' | 'boolean' | 'string' }`
  - `type AttributeCodeMap = Map<string, AttributeCodeEntry>` (keyed by full `attributeName`, e.g. `lab.hemoglobin`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/condition-schema-types.test.ts`:

```ts
import { isAttributeCondition, GateCondition } from '../services/resolution/types';

describe('condition discriminant', () => {
  it('identifies an attribute condition by the attribute key', () => {
    const c: GateCondition = { attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 };
    expect(isAttributeCondition(c)).toBe(true);
  });

  it('identifies a coded condition (no attribute key)', () => {
    const c: GateCondition = { field: 'labs', operator: 'less_than', value: '718-7', threshold: 7 };
    expect(isAttributeCondition(c)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- condition-schema-types`
Expected: FAIL — `isAttributeCondition` is not exported.

- [ ] **Step 3: Add `patientAttributes` to `PatientContext`**

In `src/services/confidence/types.ts`, inside the `PatientContext` interface, add after `freeformData`:

```ts
  /**
   * Derived/named scalar signals that have no natural terminology code
   * (e.g. trimester, rh_factor, gestational_age_weeks). Read by the
   * attribute registry's `patient.*` namespace. Populated by the
   * snapshot/composer layer (Plan 3).
   */
  patientAttributes?: Record<string, number | string | boolean>;
```

- [ ] **Step 4: Replace the condition schema in `types.ts`**

In `src/services/resolution/types.ts`, replace the existing `GateCondition` interface (currently `{ field: string; operator: string; value: string; ... }`) with:

```ts
export type CodedOperator =
  | 'includes_code' | 'equals' | 'exists'
  | 'greater_than' | 'less_than'
  | 'count_in_window' | 'trend_up' | 'trend_down' | 'delta_from_baseline';

export type AttributeOperator =
  | 'equals' | 'not_equals'
  | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal'
  | 'in' | 'exists';

export interface CodedCondition {
  field: 'conditions' | 'medications' | 'allergies' | 'labs' | 'vitals';
  operator: CodedOperator;
  value: string;
  system?: string;
  threshold?: number;
  window_days?: number;
  count_threshold?: number;
  min_points?: number;
  slope_threshold?: number;
  delta_threshold?: number;
  display?: string; // UI decorator — ignored by the evaluator
  note?: string;    // UI decorator — ignored by the evaluator
}

export interface AttributeCondition {
  attribute: string;
  operator: AttributeOperator;
  value: string | number | boolean | Array<string | number>;
  unit?: string;
  display?: string; // UI decorator
  note?: string;    // UI decorator
}

export type GateCondition = CodedCondition | AttributeCondition;

export function isAttributeCondition(c: GateCondition): c is AttributeCondition {
  return typeof (c as AttributeCondition).attribute === 'string';
}

export interface AttributeCodeEntry {
  attributeName: string;
  namespace: string;
  system: string;
  code: string;
  valueType: 'number' | 'boolean' | 'string';
}

export type AttributeCodeMap = Map<string, AttributeCodeEntry>;
```

Note: `GateProperties.condition?: GateCondition` and `conditions?: GateCondition[]` already reference `GateCondition`, so they pick up the union automatically.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- condition-schema-types`
Expected: PASS.

- [ ] **Step 6: Typecheck (the union change will surface call sites to fix in later tasks)**

Run: `npm run typecheck --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql`
Expected: Errors ONLY in `gate-evaluator.ts` / `reachability.ts` where `condition.field`/`condition.value` are accessed without narrowing. These are addressed in Task 5 (gate-evaluator) and Plan 2 (reachability). If errors appear elsewhere, note them for the relevant task. Do not fix them here.

- [ ] **Step 7: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add src/services/confidence/types.ts src/services/resolution/types.ts src/__tests__/condition-schema-types.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: canonical discriminated-union gate condition schema + patientAttributes"
```

---

## Task 2: `pathway_attribute_code_map` table + cached loader

**Files:**
- Create: `shared/data-layer/migrations/062_create_pathway_attribute_code_map.sql`
- Create: `src/services/resolution/attribute-code-map.ts`
- Test: `src/__tests__/attribute-code-map.test.ts`

**Interfaces:**
- Consumes: `AttributeCodeEntry`, `AttributeCodeMap` (Task 1).
- Produces:
  - `async function loadAttributeCodeMap(pool: import('pg').Pool): Promise<AttributeCodeMap>` — loads + caches process-wide.
  - `function buildCodeMap(rows: AttributeCodeEntry[]): AttributeCodeMap` — pure, testable.
  - `function __resetAttributeCodeMapCache(): void` — test hook.

- [ ] **Step 1: Write the migration**

Create `shared/data-layer/migrations/062_create_pathway_attribute_code_map.sql`:

```sql
-- Migration 062: curated attribute-name -> code map for the pathway
-- resolution engine's attribute registry (lab.* / allergy.* namespaces).
-- Mirrors the snomed_icd10_common_map read-boundary pattern: small curated
-- table, cached in-memory by pathway-service.

BEGIN;

CREATE TABLE pathway_attribute_code_map (
  attribute_name TEXT PRIMARY KEY,            -- e.g. 'lab.hemoglobin'
  namespace      TEXT NOT NULL,               -- 'lab' | 'allergy'
  system         TEXT NOT NULL,               -- 'LOINC' | 'SNOMED' | ...
  code           TEXT NOT NULL,               -- '718-7'
  value_type     TEXT NOT NULL DEFAULT 'number'
    CHECK (value_type IN ('number', 'boolean', 'string'))
);

COMMENT ON TABLE pathway_attribute_code_map IS
  'Curated map from an attribute dotted-name (lab.hemoglobin) to a terminology code. Read by pathway-service attribute resolvers; cached in-memory.';

INSERT INTO pathway_attribute_code_map (attribute_name, namespace, system, code, value_type) VALUES
  ('lab.hemoglobin',        'lab',     'LOINC',  '718-7',   'number'),
  ('lab.ferritin',          'lab',     'LOINC',  '2276-4',  'number'),
  ('lab.rh_factor',         'lab',     'LOINC',  '10331-7', 'string'),
  ('allergy.metronidazole', 'allergy', 'RXNORM', '6922',    'boolean');

COMMIT;
```

- [ ] **Step 2: Apply the migration to the dev DB**

Run (single Bash call; the migrator CLI is broken — apply directly, per CLAUDE.md):

```bash
export PGPASSWORD=$(pm2 env 0 2>/dev/null | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
MIG=/home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql/shared/data-layer/migrations
f=062_create_pathway_attribute_code_map.sql; id="${f%.sql}"
checksum=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('${MIG}/${f}','utf-8').trim()).digest('hex'))")
psql -h localhost -U prism -d prism_db -v ON_ERROR_STOP=1 -f "${MIG}/${f}"
psql -h localhost -U prism -d prism_db -c "INSERT INTO migration_history (migration_id, name, checksum) VALUES ('$id','$id','$checksum');"
```

Expected: `CREATE TABLE`, `INSERT 0 4`, `INSERT 0 1`.

- [ ] **Step 3: Write the failing test**

Create `src/__tests__/attribute-code-map.test.ts`:

```ts
import { buildCodeMap } from '../services/resolution/attribute-code-map';
import { AttributeCodeEntry } from '../services/resolution/types';

const rows: AttributeCodeEntry[] = [
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
];

describe('buildCodeMap', () => {
  it('keys entries by full attribute name', () => {
    const map = buildCodeMap(rows);
    expect(map.get('lab.hemoglobin')?.code).toBe('718-7');
    expect(map.get('lab.unknown')).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- attribute-code-map`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the loader**

Create `src/services/resolution/attribute-code-map.ts`:

```ts
import type { Pool } from 'pg';
import { AttributeCodeEntry, AttributeCodeMap } from './types';

let cache: AttributeCodeMap | null = null;

export function buildCodeMap(rows: AttributeCodeEntry[]): AttributeCodeMap {
  const map: AttributeCodeMap = new Map();
  for (const r of rows) map.set(r.attributeName, r);
  return map;
}

export async function loadAttributeCodeMap(pool: Pool): Promise<AttributeCodeMap> {
  if (cache) return cache;
  const { rows } = await pool.query(
    `SELECT attribute_name, namespace, system, code, value_type
       FROM pathway_attribute_code_map`,
  );
  cache = buildCodeMap(
    rows.map((r): AttributeCodeEntry => ({
      attributeName: r.attribute_name,
      namespace: r.namespace,
      system: r.system,
      code: r.code,
      valueType: r.value_type,
    })),
  );
  return cache;
}

/** Test hook — clears the process-wide cache. */
export function __resetAttributeCodeMapCache(): void {
  cache = null;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- attribute-code-map`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add shared/data-layer/migrations/062_create_pathway_attribute_code_map.sql src/services/resolution/attribute-code-map.ts src/__tests__/attribute-code-map.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: pathway_attribute_code_map table + cached loader"
```

---

## Task 3: Attribute registry + resolvers

**Files:**
- Create: `src/services/resolution/attribute-registry.ts`
- Test: `src/__tests__/attribute-registry.test.ts`

**Interfaces:**
- Consumes: `PatientContext` (Task 1), `AttributeCodeMap` (Task 1), `resolveNumericPath` behavior (mirror gate-evaluator's dotted vitals lookup).
- Produces:
  - `interface AttributeResolution { value: number | string | boolean | undefined; fieldsRead: string[] }`
  - `function resolveAttribute(ctx: PatientContext, attribute: string, codeMap: AttributeCodeMap): AttributeResolution`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/attribute-registry.test.ts`:

```ts
import { resolveAttribute } from '../services/resolution/attribute-registry';
import { buildCodeMap } from '../services/resolution/attribute-code-map';
import type { PatientContext } from '../services/confidence/types';

const codeMap = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
  { attributeName: 'allergy.metronidazole', namespace: 'allergy', system: 'RXNORM', code: '6922', valueType: 'boolean' },
]);

function ctx(o: Partial<PatientContext> = {}): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [], ...o };
}

describe('resolveAttribute', () => {
  it('lab.* resolves a numeric lab by mapped LOINC code', () => {
    const r = resolveAttribute(
      ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 8.1 }] }),
      'lab.hemoglobin', codeMap);
    expect(r.value).toBe(8.1);
    expect(r.fieldsRead).toEqual(['lab.hemoglobin']);
  });

  it('vitals.* reads the vitalSigns bag', () => {
    const r = resolveAttribute(ctx({ vitalSigns: { systolic_bp: 150 } }), 'vitals.systolic_bp', codeMap);
    expect(r.value).toBe(150);
  });

  it('allergy.* returns a boolean presence', () => {
    const present = resolveAttribute(ctx({ allergies: [{ code: '6922', system: 'RXNORM' }] }), 'allergy.metronidazole', codeMap);
    expect(present.value).toBe(true);
    const absent = resolveAttribute(ctx(), 'allergy.metronidazole', codeMap);
    expect(absent.value).toBe(false);
  });

  it('patient.* reads patientAttributes', () => {
    const r = resolveAttribute(ctx({ patientAttributes: { trimester: 2 } }), 'patient.trimester', codeMap);
    expect(r.value).toBe(2);
  });

  it('unknown namespace yields undefined value but still a fieldsRead path', () => {
    const r = resolveAttribute(ctx(), 'bogus.thing', codeMap);
    expect(r.value).toBeUndefined();
    expect(r.fieldsRead).toEqual(['bogus.thing']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- attribute-registry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

Create `src/services/resolution/attribute-registry.ts`:

```ts
import type { PatientContext } from '../confidence/types';
import { AttributeCodeMap } from './types';

export interface AttributeResolution {
  value: number | string | boolean | undefined;
  fieldsRead: string[];
}

/** Walk a dotted path into a JSON bag, returning a finite number or undefined. */
function numericPath(bag: Record<string, unknown> | undefined, path: string): number | undefined {
  if (!bag) return undefined;
  let cursor: unknown = bag;
  for (const seg of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : undefined;
}

type NamespaceResolver = (
  ctx: PatientContext,
  rest: string,
  fullName: string,
  codeMap: AttributeCodeMap,
) => number | string | boolean | undefined;

const RESOLVERS: Record<string, NamespaceResolver> = {
  lab: (ctx, _rest, fullName, codeMap) => {
    const entry = codeMap.get(fullName);
    if (!entry) return undefined;
    const lab = ctx.labResults.find(
      (l) => l.code === entry.code && (!entry.system || l.system === entry.system),
    );
    return lab?.value;
  },
  vitals: (ctx, rest) => numericPath(ctx.vitalSigns, rest),
  allergy: (ctx, _rest, fullName, codeMap) => {
    const entry = codeMap.get(fullName);
    if (!entry) return undefined;
    return ctx.allergies.some(
      (a) => a.code === entry.code && (!entry.system || a.system === entry.system),
    );
  },
  patient: (ctx, rest) => ctx.patientAttributes?.[rest],
};

export function resolveAttribute(
  ctx: PatientContext,
  attribute: string,
  codeMap: AttributeCodeMap,
): AttributeResolution {
  const dot = attribute.indexOf('.');
  const namespace = dot === -1 ? attribute : attribute.slice(0, dot);
  const rest = dot === -1 ? '' : attribute.slice(dot + 1);
  const resolver = RESOLVERS[namespace];
  const value = resolver ? resolver(ctx, rest, attribute, codeMap) : undefined;
  return { value, fieldsRead: [attribute] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- attribute-registry`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add src/services/resolution/attribute-registry.ts src/__tests__/attribute-registry.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: attribute registry with lab/vitals/allergy/patient resolvers"
```

---

## Task 4: Scalar comparison core

**Files:**
- Create: `src/services/resolution/scalar-compare.ts`
- Test: `src/__tests__/scalar-compare.test.ts`

**Interfaces:**
- Consumes: `AttributeOperator` (Task 1), `AttributeResolution.value` type (Task 3).
- Produces:
  - `function compareScalar(resolved: number | string | boolean | undefined, operator: AttributeOperator, operand: string | number | boolean | Array<string | number>): { satisfied: boolean; reason: string }`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/scalar-compare.test.ts`:

```ts
import { compareScalar } from '../services/resolution/scalar-compare';

describe('compareScalar', () => {
  it('less_than on numbers', () => {
    expect(compareScalar(6, 'less_than', 7).satisfied).toBe(true);
    expect(compareScalar(8, 'less_than', 7).satisfied).toBe(false);
  });
  it('greater_or_equal on numbers', () => {
    expect(compareScalar(7, 'greater_or_equal', 7).satisfied).toBe(true);
  });
  it('equals / not_equals on strings', () => {
    expect(compareScalar('negative', 'equals', 'negative').satisfied).toBe(true);
    expect(compareScalar('negative', 'not_equals', 'positive').satisfied).toBe(true);
  });
  it('in checks set membership', () => {
    expect(compareScalar(2, 'in', [1, 3]).satisfied).toBe(false);
    expect(compareScalar(3, 'in', [1, 3]).satisfied).toBe(true);
  });
  it('exists is true for any non-undefined resolved value', () => {
    expect(compareScalar(false, 'exists', true).satisfied).toBe(true);
    expect(compareScalar(undefined, 'exists', true).satisfied).toBe(false);
  });
  it('numeric comparators are unsatisfied when the value is missing', () => {
    expect(compareScalar(undefined, 'less_than', 7).satisfied).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- scalar-compare`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the comparison core**

Create `src/services/resolution/scalar-compare.ts`:

```ts
import { AttributeOperator } from './types';

type Resolved = number | string | boolean | undefined;
type Operand = string | number | boolean | Array<string | number>;

export function compareScalar(
  resolved: Resolved,
  operator: AttributeOperator,
  operand: Operand,
): { satisfied: boolean; reason: string } {
  if (operator === 'exists') {
    const ok = resolved !== undefined;
    return { satisfied: ok, reason: ok ? 'attribute is present' : 'attribute is absent' };
  }
  if (resolved === undefined) {
    return { satisfied: false, reason: 'attribute has no value' };
  }
  if (operator === 'in') {
    const list = Array.isArray(operand) ? operand : [operand as string | number];
    const ok = list.some((x) => x === resolved);
    return { satisfied: ok, reason: `${String(resolved)} ${ok ? 'in' : 'not in'} [${list.join(', ')}]` };
  }
  if (operator === 'equals') {
    const ok = resolved === operand;
    return { satisfied: ok, reason: `${String(resolved)} ${ok ? '==' : '!='} ${String(operand)}` };
  }
  if (operator === 'not_equals') {
    const ok = resolved !== operand;
    return { satisfied: ok, reason: `${String(resolved)} ${ok ? '!=' : '=='} ${String(operand)}` };
  }
  // Numeric comparators
  if (typeof resolved !== 'number' || typeof operand !== 'number') {
    return { satisfied: false, reason: `numeric ${operator} needs numeric operands` };
  }
  const ops: Record<string, (a: number, b: number) => boolean> = {
    greater_than: (a, b) => a > b,
    greater_or_equal: (a, b) => a >= b,
    less_than: (a, b) => a < b,
    less_or_equal: (a, b) => a <= b,
  };
  const cmp = ops[operator];
  const ok = cmp ? cmp(resolved, operand) : false;
  return { satisfied: ok, reason: `${resolved} ${operator} ${operand} → ${ok}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- scalar-compare`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add src/services/resolution/scalar-compare.ts src/__tests__/scalar-compare.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: scalar comparison core for attribute operators"
```

---

## Task 5: Evaluator dispatch (coded vs attribute)

**Files:**
- Modify: `src/services/resolution/gate-evaluator.ts` (`evaluateCondition` at ~line 176; thread `codeMap`)
- Test: `src/__tests__/gate-evaluator-attribute.test.ts`

**Interfaces:**
- Consumes: `isAttributeCondition` (Task 1), `resolveAttribute` (Task 3), `compareScalar` (Task 4), `AttributeCodeMap` (Task 1).
- Produces: `evaluateCondition(condition, patientContext, codeMap, now)` returns `{ satisfied: boolean; reason: string; fieldsRead: string[] }` — same shape as today, now handling both kinds. `evaluateGate`/`evaluatePatientAttribute`/`evaluateCompound` accept and forward an `AttributeCodeMap` (default `new Map()`).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/gate-evaluator-attribute.test.ts`:

```ts
import { evaluateGate } from '../services/resolution/gate-evaluator';
import { GateType } from '../services/resolution/types';
import { buildCodeMap } from '../services/resolution/attribute-code-map';
import type { PatientContext } from '../services/confidence/types';

const NOW = Date.parse('2026-06-27T00:00:00Z');
const codeMap = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
]);
function ctx(o: Partial<PatientContext> = {}): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [], ...o };
}

describe('evaluateGate — attribute conditions', () => {
  it('fires a severe-anemia gate when Hb below threshold, reporting the attribute path', async () => {
    const result = await evaluateGate(
      {
        gate_type: GateType.PATIENT_ATTRIBUTE,
        title: 'Severe anemia',
        default_behavior: 'skip',
        condition: { attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 },
      },
      ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 6.2 }] }),
      new Map(), new Map(), undefined, undefined, NOW, codeMap,
    );
    expect(result.satisfied).toBe(true);
    expect(result.contextFieldsRead).toEqual(['lab.hemoglobin']);
  });

  it('does not fire when Hb at/above threshold', async () => {
    const result = await evaluateGate(
      {
        gate_type: GateType.PATIENT_ATTRIBUTE,
        title: 'Severe anemia',
        default_behavior: 'skip',
        condition: { attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 },
      },
      ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 9.5 }] }),
      new Map(), new Map(), undefined, undefined, NOW, codeMap,
    );
    expect(result.satisfied).toBe(false);
    expect(result.contextFieldsRead).toEqual(['lab.hemoglobin']);
  });
});
```

NOTE: This adds an 8th positional arg (`codeMap`) to `evaluateGate`. Check the current `evaluateGate` signature (~line 720) and existing call sites in the test files (`gate-evaluator-count-in-window.test.ts` pass 7 args ending in `NOW`). Add `codeMap` as a trailing **optional** parameter defaulting to `new Map()` so existing 7-arg calls still compile.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- gate-evaluator-attribute`
Expected: FAIL — attribute conditions currently hit the `default: "Unknown operator"` branch (`satisfied:false`) and `contextFieldsRead` is `['lab.hemoglobin']`? No — today `field` is undefined so it returns `[undefined]`. The test fails on `satisfied` being false for the first case.

- [ ] **Step 3: Split `evaluateCondition` into coded + attribute dispatch**

In `src/services/resolution/gate-evaluator.ts`, add imports at the top:

```ts
import { isAttributeCondition, AttributeCodeMap } from './types';
import { resolveAttribute } from './attribute-registry';
import { compareScalar } from './scalar-compare';
```

Change the `evaluateCondition` signature and add a dispatch at its top. The current signature is:

```ts
function evaluateCondition(
  condition: GateCondition,
  patientContext: PatientContext,
  now: number = Date.now(),
): { satisfied: boolean; reason: string; fieldsRead: string[] } {
```

Replace with:

```ts
function evaluateCondition(
  condition: GateCondition,
  patientContext: PatientContext,
  now: number = Date.now(),
  codeMap: AttributeCodeMap = new Map(),
): { satisfied: boolean; reason: string; fieldsRead: string[] } {
  if (isAttributeCondition(condition)) {
    const { value, fieldsRead } = resolveAttribute(patientContext, condition.attribute, codeMap);
    const { satisfied, reason } = compareScalar(value, condition.operator, condition.value);
    return { satisfied, reason, fieldsRead };
  }
  // Coded path below — `condition` is now narrowed to CodedCondition.
  const { field, operator, value, system } = condition;
  const fieldsRead = field ? [field] : [];
  // ... existing switch unchanged ...
```

The rest of the existing coded `switch` stays as-is (it already reads `field`/`value`/`system`/`threshold`, all valid on `CodedCondition`). The `field ? [field] : []` guard from the shipped hotfix is retained.

- [ ] **Step 4: Thread `codeMap` through the gate evaluators**

`evaluateCondition` is called by `evaluatePatientAttribute` (~line 434) and `evaluateCompound` (~line 560s). Add a trailing `codeMap: AttributeCodeMap = new Map()` param to both and to `evaluateGate`, forwarding it down:
- `evaluatePatientAttribute(gate, patientContext, now, codeMap)` → `evaluateCondition(gate.condition, patientContext, now, codeMap)`.
- `evaluateCompound(...)` → each `evaluateCondition(cond, patientContext, now, codeMap)`.
- `evaluateGate(gate, patientContext, gateAnswers, ..., now, codeMap)` → forwards to the two above.

Show the `evaluateGate` end of the change (add the last param, forward it):

```ts
export async function evaluateGate(
  gate: GateProperties,
  patientContext: PatientContext,
  gateAnswers: Map<string, GateAnswer>,
  nodeResults: Map<string, NodeResult>,
  llmEvaluator?: LlmGateEvaluator,
  gateId?: string,
  now: number = Date.now(),
  codeMap: AttributeCodeMap = new Map(),   // NEW trailing param
): Promise<GateEvaluationResult> {
  // ...
  // where it dispatches on gate_type, pass codeMap into the patient_attribute / compound branches:
  //   return evaluatePatientAttribute(gate, patientContext, now, codeMap);
  //   return evaluateCompound(gate, patientContext, now, codeMap);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- gate-evaluator-attribute`
Expected: PASS (both cases).

- [ ] **Step 6: Run the full gate-evaluator + projection suites (no regressions) — jest is the gate**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- gate-evaluator care-plan-projection scalar-compare attribute`
Expected: PASS — all existing coded-operator tests still green; the `field ? [field] : []` guard preserved. (Per Global Constraints, do NOT gate on a clean whole-project `tsc`. The union change leaves one known incremental `tsc`-only error in `gate-evaluator-count-in-window.test.ts:111,128` — inline gate literals widen `operator` to `string`. This does not fail jest and that file already carries pre-existing `tsc` errors, so leave it; a fully `tsc`-clean test suite is out of this plan's scope.)

- [ ] **Step 7: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add src/services/resolution/gate-evaluator.ts src/__tests__/gate-evaluator-attribute.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: evaluate attribute conditions via registry + scalar compare"
```

---

## Task 6: Load the code map into the resolution context and pass it to the traversal

**Files:**
- Modify: `src/resolvers/helpers/resolution-context.ts` (build path — load the map)
- Modify: `src/services/resolution/traversal-engine.ts` (~lines 213, 661 where `gateProps` is cast and `evaluateGate`/`evaluateCondition` are called — forward the map)

**Interfaces:**
- Consumes: `loadAttributeCodeMap` (Task 2), `AttributeCodeMap` (Task 1), `evaluateGate` with the new trailing `codeMap` param (Task 5).
- Produces: the traversal passes the loaded `AttributeCodeMap` into every `evaluateGate` call, so attribute conditions resolve against real data end-to-end.

- [ ] **Step 1: Read the current wiring (no code change yet)**

Run: `grep -n "evaluateGate\|buildResolutionContext\|ResolutionContext" src/resolvers/helpers/resolution-context.ts src/services/resolution/traversal-engine.ts`
Identify (a) where the resolution context object is assembled, and (b) the two `evaluateGate` call sites in the traversal. The `codeMap` must be reachable at those call sites (add it to the context struct the traversal already receives, or pass alongside `thresholds`).

- [ ] **Step 2: Write the failing integration test**

Create `src/__tests__/gate-evaluator-codemap-threading.test.ts` — a focused test proving that when a real map is threaded, the evaluator uses it. Since full traversal needs a DB, assert at the seam instead: the traversal helper that builds per-gate evaluation must forward a non-empty map.

```ts
import { buildCodeMap } from '../services/resolution/attribute-code-map';
import { evaluateGate } from '../services/resolution/gate-evaluator';
import { GateType } from '../services/resolution/types';
import type { PatientContext } from '../services/confidence/types';

const NOW = Date.parse('2026-06-27T00:00:00Z');
function ctx(o: Partial<PatientContext> = {}): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [], ...o };
}

it('an empty code map cannot resolve lab.* (proves the map is required and threaded)', async () => {
  const withMap = buildCodeMap([{ attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' }]);
  const patient = ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 6 }] });
  const cond = { attribute: 'lab.hemoglobin', operator: 'less_than' as const, value: 7 };

  const resolved = await evaluateGate(
    { gate_type: GateType.PATIENT_ATTRIBUTE, title: 't', default_behavior: 'skip', condition: cond },
    patient, new Map(), new Map(), undefined, undefined, NOW, withMap);
  const unresolved = await evaluateGate(
    { gate_type: GateType.PATIENT_ATTRIBUTE, title: 't', default_behavior: 'skip', condition: cond },
    patient, new Map(), new Map(), undefined, undefined, NOW, new Map());

  expect(resolved.satisfied).toBe(true);    // map present → Hb resolves → 6 < 7
  expect(unresolved.satisfied).toBe(false); // no map → lab.* unresolved → unsatisfied
});
```

- [ ] **Step 3: Run test to verify it passes at the evaluator seam**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- gate-evaluator-codemap-threading`
Expected: PASS (this validates the contract; Steps 4–5 wire the real loader so production uses a non-empty map).

- [ ] **Step 4: Load the map when building the resolution context**

In `src/resolvers/helpers/resolution-context.ts`, where the context is built (it already has a `pool`), call `loadAttributeCodeMap(pool)` and attach the result to the context object under a `codeMap` field. Add `codeMap: AttributeCodeMap` to the context interface/type it returns. Import:

```ts
import { loadAttributeCodeMap } from '../../services/resolution/attribute-code-map';
import { AttributeCodeMap } from '../../services/resolution/types';
```

- [ ] **Step 5: Forward the map at the traversal `evaluateGate` call sites**

In `src/services/resolution/traversal-engine.ts`, at the two `evaluateGate(...)` calls (near the `gateProps` casts ~lines 213 and 661), pass the context's `codeMap` as the trailing argument. The traversal already receives the resolution context; thread `codeMap` from it to both calls.

- [ ] **Step 6: Scoped typecheck of changed production files + full jest suite**

Do NOT expect a clean whole-project `tsc` (see Global Constraints — ~3990 pre-existing monorepo errors). Instead verify our changed **production** files carry no NEW type errors:

Run: `npx tsc --noEmit -p apps/pathway-service/tsconfig.json 2>&1 | grep -E "resolution/(gate-evaluator|traversal-engine|attribute-registry|attribute-code-map|scalar-compare)|helpers/resolution-context"`
Expected: no output (these production modules are clean). `gate-evaluator.ts` must no longer show `condition.field`-without-narrowing errors — the Task 5 `isAttributeCondition` split resolves them. `reachability.ts` errors remain and are handled in Plan 2.

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql`
Expected: PASS (ignore the known `tsc`-only test-file errors documented in Global Constraints; they do not fail jest).

- [ ] **Step 7: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add src/resolvers/helpers/resolution-context.ts src/services/resolution/traversal-engine.ts src/__tests__/gate-evaluator-codemap-threading.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: load attribute code map into resolution context and thread to traversal"
```

---

## Self-Review

**Spec coverage (Plan 1 slice):**
- Canonical discriminated-union schema → Task 1 ✓
- `patientAttributes` substrate field → Task 1 ✓ (population is Plan 3)
- Decorator fields `display`/`note` → Task 1 ✓ (allowlist enforcement is Plan 2)
- name→code curated table + cache → Task 2 ✓
- Attribute registry + 4 namespace resolvers → Task 3 ✓
- Scalar operator core (incl. `greater_or_equal`/`less_or_equal`/`not_equals`/`in`) → Task 4 ✓
- Evaluator dispatch + non-empty `fieldsRead` for both kinds → Task 5 ✓
- End-to-end threading of the map → Task 6 ✓
- Out of scope for Plan 1 (tracked): import validation (Plan 2), reachability (Plan 2), substrate population (Plan 3), UI (Plan 4), pathway reset + full e2e (Plan 5).

**Placeholder scan:** No TBD/TODO. The one `// Plan 2` note in Task 6 Step 6 is an explicit, scoped hand-off, not a gap.

**Type consistency:** `AttributeResolution.value` (`number|string|boolean|undefined`) matches `compareScalar`'s `resolved` param and `resolveAttribute`'s return. `codeMap: AttributeCodeMap` threaded identically through Tasks 2→3→5→6. `evaluateGate`'s new trailing `codeMap` param is optional everywhere, preserving existing 7-arg call sites in the current test suite.

---

## Next Plans (not yet written)

- **Plan 2 — Enforcement:** import-validator condition-schema checks (exactly-one-of, operator-in-set, decorator allowlist, namespace registered) + reachability scorer rewrite for both kinds.
- **Plan 3 — Substrate population:** snapshot/composer populate `patientAttributes` (trimester, rh_factor, gestational_age_weeks).
- **Plan 4 — Authoring UI:** admin-dashboard Coded/Attribute editor toggle.
- **Plan 5 — Reset & prove:** re-author `anemia-in-pregnancy` canonically, reset the other 4, end-to-end resolution test.
