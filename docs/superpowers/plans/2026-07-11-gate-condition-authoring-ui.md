# Gate Condition Authoring UI — Implementation Plan (Plan 4 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let pathway authors create BOTH coded and named-attribute gate conditions in the admin dashboard, with the attribute vocabulary sourced from the backend so the UI and the resolver never drift.

**Architecture:** A new backend GraphQL query (`attributeVocabulary`) returns the curated `pathway_attribute_code_map` rows plus the known `patient.*` derived attributes. The admin `ConditionRow` gains a Coded/Attribute toggle; attribute mode uses an `AttributePicker` fed by that query. Serializer/deserializer already pass `properties` through verbatim, so conditions round-trip once the editor writes the right keys.

**Tech Stack:** Backend — pathway-service (TS, Apollo Federation, PostgreSQL, Jest). Frontend — prism-admin-dashboard (Next.js 16, React 19, Apollo Client 4, Tailwind CSS 4). **No frontend test infra exists** — frontend tasks gate on `npm run build` + `npm run lint` + explicit manual verification.

**Dependencies:** Land AFTER Plan 2 (import validator — so malformed conditions authored here are rejected server-side) and Plan 3 (defines the `patient.*` attribute set this UI offers). The final review explicitly flagged: **do not ship this UI before Plan 2's validator.**

## Global Constraints

- Never chain `cd`. Use `npm --prefix`/`git -C`.
- Two repos, both worktrees under `/home/claude/workspace/features/feat-gate-condition-field-attribute-model/`:
  - Backend: `.../prism-graphql` (branch `feat/gate-condition-field-attribute-model`)
  - Frontend: `.../prism-admin-dashboard` (branch `feat/gate-condition-field-attribute-model`, off `master`)
- Conventional commit prefixes. No `@anthropic.com`/`@claude.com` Co-Authored-By lines.
- Backend verification: JEST (not whole-project tsc); worktree dir name contains "attribute"/"field" so never use those as jest `-t` patterns — use `--runTestsByPath` or a safe substring.
- Frontend verification: `npm run build` (Next 16, ~30s — surfaces type errors) + `npm run lint`. There is no `typecheck` script and no unit-test runner. Each frontend task ends with a build+lint gate and a written manual-verification checklist.
- Frontend design: match existing editor utility-class conventions — blue for active/primary (`bg-blue-100 text-blue-900`), gray chrome (`border-gray-200 bg-gray-50 text-gray-600`), `text-[11px]` labels, `space-y-2` stacking, `@heroicons/react/24/outline`. Do NOT introduce new design tokens.
- The `patient.*` attribute set is the SINGLE SOURCE shared by Plan 3's resolver population and this UI. Define it once (see Task 1) and reuse.

---

## File Structure

**Backend (prism-graphql):**
- Modify `apps/pathway-service/schema.graphql` — add `AttributeVocabularyEntry` type + `attributeVocabulary` query.
- Create `apps/pathway-service/src/services/resolution/attribute-vocabulary.ts` — the known `patient.*` list + a builder combining it with the code-map rows.
- Modify `apps/pathway-service/src/resolvers/Query.ts` — resolve `attributeVocabulary`.
- Test: `apps/pathway-service/src/__tests__/attribute-vocabulary.test.ts`.

**Frontend (prism-admin-dashboard):**
- Modify `src/components/editor/GateConditionEditor.tsx` — extend `GateCondition`, add `ATTRIBUTE_OPERATORS`, the Coded/Attribute toggle, and the attribute sub-form.
- Create `src/lib/graphql/queries/attributes.ts` — `LIST_ATTRIBUTE_VOCABULARY`.
- Create `src/components/editor/AttributePicker.tsx` — vocabulary-driven picker (mirrors `CodeSearchCombobox`).
- Modify `src/lib/pathway-required-fields.ts` — handle attribute conditions in `addCondition`.
- Modify `src/types/index.ts` — promote/extend the shared `GateCondition` type.

---

## Task 1 (backend): `attributeVocabulary` query

**Files:**
- Create: `apps/pathway-service/src/services/resolution/attribute-vocabulary.ts`
- Modify: `apps/pathway-service/schema.graphql`
- Modify: `apps/pathway-service/src/resolvers/Query.ts`
- Test: `apps/pathway-service/src/__tests__/attribute-vocabulary.test.ts`

**Interfaces:**
- Consumes: `loadAttributeCodeMap` (Plan 1), the `patient.*` set (defined here, reused by Plan 3).
- Produces:
  - `export const KNOWN_PATIENT_ATTRIBUTES: readonly {name: string; display: string; valueType: 'number'|'string'|'boolean'; unit?: string}[]`
  - `export function buildAttributeVocabulary(codeMapRows: AttributeCodeEntry[]): AttributeVocabularyEntry[]`
  - GraphQL: `attributeVocabulary: [AttributeVocabularyEntry!]!`

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/attribute-vocabulary.test.ts`:

```ts
import { buildAttributeVocabulary, KNOWN_PATIENT_ATTRIBUTES } from '../services/resolution/attribute-vocabulary';

describe('buildAttributeVocabulary', () => {
  it('merges code-map (lab/allergy) entries with the known patient.* set', () => {
    const vocab = buildAttributeVocabulary([
      { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
    ]);
    expect(vocab.find((v) => v.attribute === 'lab.hemoglobin')?.valueType).toBe('number');
    // every known patient.* attribute is present
    for (const p of KNOWN_PATIENT_ATTRIBUTES) {
      expect(vocab.find((v) => v.attribute === `patient.${p.name}`)).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- attribute-vocabulary`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the vocabulary builder**

Create `apps/pathway-service/src/services/resolution/attribute-vocabulary.ts`:

```ts
import { AttributeCodeEntry } from './types';

export interface AttributeVocabularyEntry {
  attribute: string;       // 'lab.hemoglobin' | 'patient.trimester'
  namespace: string;       // 'lab' | 'allergy' | 'patient' | 'vitals'
  display: string;         // human label
  valueType: 'number' | 'string' | 'boolean';
  unit?: string;
}

// The single source of truth for the derived patient.* attributes (no code).
// Plan 3's substrate population reads this same list. Keep in sync.
export const KNOWN_PATIENT_ATTRIBUTES = [
  { name: 'trimester', display: 'Trimester', valueType: 'number' as const },
  { name: 'rh_factor', display: 'Rh factor', valueType: 'string' as const },
  { name: 'gestational_age_weeks', display: 'Gestational age (weeks)', valueType: 'number' as const, unit: 'weeks' },
] as const;

export function buildAttributeVocabulary(codeMapRows: AttributeCodeEntry[]): AttributeVocabularyEntry[] {
  const fromCodeMap: AttributeVocabularyEntry[] = codeMapRows.map((r) => ({
    attribute: r.attributeName,
    namespace: r.namespace,
    display: r.attributeName,          // code-map has no display column in v1; use the name
    valueType: r.valueType,
  }));
  const fromPatient: AttributeVocabularyEntry[] = KNOWN_PATIENT_ATTRIBUTES.map((p) => ({
    attribute: `patient.${p.name}`,
    namespace: 'patient',
    display: p.display,
    valueType: p.valueType,
    unit: 'unit' in p ? (p as { unit?: string }).unit : undefined,
  }));
  return [...fromCodeMap, ...fromPatient];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql -- attribute-vocabulary`
Expected: PASS.

- [ ] **Step 5: Add the GraphQL type + query to `schema.graphql`**

In `apps/pathway-service/schema.graphql`, add near the other query types:

```graphql
type AttributeVocabularyEntry {
  attribute: String!
  namespace: String!
  display: String!
  valueType: String!
  unit: String
}

extend type Query {
  """Authoring vocabulary for named attribute conditions (code-map + derived patient.* attributes)."""
  attributeVocabulary: [AttributeVocabularyEntry!]!
}
```

(If `Query` is defined here rather than extended, add the field to the existing `type Query` block instead of `extend`.)

- [ ] **Step 6: Resolve the query in `Query.ts`**

In `apps/pathway-service/src/resolvers/Query.ts`, add a resolver that loads the code map and builds the vocabulary:

```ts
import { loadAttributeCodeMap } from '../services/resolution/attribute-code-map';
import { buildAttributeVocabulary } from '../services/resolution/attribute-vocabulary';
// ... within the Query resolver map:
attributeVocabulary: async (_p: unknown, _a: unknown, context: { pool: Pool }) => {
  const map = await loadAttributeCodeMap(context.pool);
  return buildAttributeVocabulary([...map.values()]);
},
```

(Match the file's existing resolver signature/`context` typing — read a neighboring Query resolver first.)

- [ ] **Step 7: Codegen + build + verify the field resolves**

Run: `npm run build --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql/apps/pathway-service`
Expected: codegen + tsc succeed (the new resolver type is generated).

Run (against the running dev subgraph, if up): `curl -s -X POST -H 'Content-Type: application/json' -d '{"query":"{attributeVocabulary{attribute namespace valueType}}"}' http://localhost:4016/graphql`
Expected: JSON listing `lab.*`/`allergy.*` (from the seeded code map) + `patient.trimester`/`patient.rh_factor`/`patient.gestational_age_weeks`.

- [ ] **Step 8: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql add apps/pathway-service/schema.graphql apps/pathway-service/src/services/resolution/attribute-vocabulary.ts apps/pathway-service/src/resolvers/Query.ts apps/pathway-service/src/__tests__/attribute-vocabulary.test.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-graphql commit -m "feat: attributeVocabulary query for authoring named attribute conditions"
```

---

## Task 2 (frontend): shared `GateCondition` type + attribute operators

**Files:**
- Modify: `src/types/index.ts` (add a shared `GateCondition` interface)
- Modify: `src/components/editor/GateConditionEditor.tsx` (import the shared type; add `ATTRIBUTE_OPERATORS`)

**Interfaces:**
- Produces: an exported `GateCondition` shared type with both kinds; `ATTRIBUTE_OPERATORS` constant.

- [ ] **Step 1: Add the shared type to `src/types/index.ts`**

```ts
export interface GateCondition {
  kind?: 'coded' | 'attribute';   // absent => coded (back-compat with existing pathways)
  // coded
  field?: string;
  system?: string;
  threshold?: number;
  // attribute
  attribute?: string;
  unit?: string;
  // shared
  operator?: string;
  value?: string | number | boolean | Array<string | number>;
  display?: string;
  note?: string;
}
```

- [ ] **Step 2: Import it in `GateConditionEditor.tsx` and add attribute operators**

Replace the local `GateCondition` interface (lines 47-53) with `import type { GateCondition } from '@/types';`. Keep `ConditionRow`/`GateConditionEditor` exporting as before. Add alongside `OPERATORS` (line 45):

```ts
const ATTRIBUTE_OPERATORS: Array<{ value: string; label: string }> = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'greater_or_equal', label: 'greater or equal' },
  { value: 'less_than', label: 'less than' },
  { value: 'less_or_equal', label: 'less or equal' },
  { value: 'in', label: 'in (list)' },
  { value: 'exists', label: 'has any' },
];
```

- [ ] **Step 3: Build + lint gate**

Run: `npm run build --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard`
Run: `npm run lint --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard`
Expected: both succeed. (Existing coded editor still compiles since every new field is optional.)

- [ ] **Step 4: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard add src/types/index.ts src/components/editor/GateConditionEditor.tsx
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard commit -m "feat: shared GateCondition type + attribute operator list"
```

---

## Task 3 (frontend): Coded/Attribute toggle + AttributePicker

**Files:**
- Create: `src/lib/graphql/queries/attributes.ts`
- Create: `src/components/editor/AttributePicker.tsx`
- Modify: `src/components/editor/GateConditionEditor.tsx` (`ConditionRow` — toggle + attribute sub-form)

**Interfaces:**
- Consumes: `attributeVocabulary` query (Task 1); `GateCondition`, `ATTRIBUTE_OPERATORS` (Task 2).

- [ ] **Step 1: Add the vocabulary query**

Create `src/lib/graphql/queries/attributes.ts`:

```ts
import { gql } from '@apollo/client/core';

export const LIST_ATTRIBUTE_VOCABULARY = gql`
  query ListAttributeVocabulary {
    attributeVocabulary { attribute namespace display valueType unit }
  }
`;
```

- [ ] **Step 2: Create `AttributePicker.tsx`**

Mirror `CodeSearchCombobox`'s consumption pattern but eager (`useQuery`) since the vocabulary is bounded:

```tsx
'use client';
import { useQuery } from '@apollo/client/react';
import { LIST_ATTRIBUTE_VOCABULARY } from '@/lib/graphql/queries/attributes';

interface VocabEntry { attribute: string; namespace: string; display: string; valueType: string; unit?: string }

export function AttributePicker({ value, onChange }: { value?: string; onChange: (attribute: string) => void }) {
  const { data, loading } = useQuery<{ attributeVocabulary: VocabEntry[] }>(LIST_ATTRIBUTE_VOCABULARY, { fetchPolicy: 'cache-first' });
  const entries = data?.attributeVocabulary ?? [];
  return (
    <label className="block text-[11px] text-gray-600">
      Attribute
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs bg-white"
        disabled={loading}
      >
        <option value="">{loading ? 'Loading…' : 'Select an attribute…'}</option>
        {entries.map((v) => (
          <option key={v.attribute} value={v.attribute}>{v.display} ({v.attribute})</option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 3: Add the toggle + attribute branch in `ConditionRow`**

At the top of `ConditionRow`'s returned JSX (before the "Look in" select, ~line 119), add a segmented Coded/Attribute toggle reusing the AND/OR toggle markup from `CompoundGateEditor.tsx:65-88`. Derive `const kind = condition.kind ?? 'coded';`. On toggle, clear the other mode's fields to avoid mixed payloads:

```tsx
// coded → attribute: onChange({ kind: 'attribute', operator: undefined, attribute: undefined, value: undefined, display: cond.display, note: cond.note })
// attribute → coded: onChange({ kind: 'coded', operator: undefined, field: undefined, value: undefined, display: cond.display, note: cond.note })
```

Then branch the body: `kind === 'coded'` renders the existing field/operator/value/threshold/system rows unchanged; `kind === 'attribute'` renders:
1. `<AttributePicker value={cond.attribute} onChange={(attribute) => update({ attribute })} />`
2. an operator `<select>` from `ATTRIBUTE_OPERATORS` → `update({ operator })`
3. a value input (shown when operator set and ≠ `exists`); for `in`, accept a comma-separated list and store as `value` (string is fine — the backend accepts scalar or array; keep it a string for v1 and document that `in` uses comma-separated values, OR split into an array on change). → `update({ value })`
4. an optional unit text input → `update({ unit })`

Add a shared optional `display` text input (both modes) → `update({ display })`.

- [ ] **Step 4: Build + lint gate**

Run: `npm run build --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard`
Run: `npm run lint --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard`
Expected: both succeed.

- [ ] **Step 5: Manual verification (no test infra — do this and record results in the report)**

Start the stack (`make quick-start` in prism-graphql, then `npm run dev` in admin-dashboard on :3001) and:
1. Open a pathway, add a `patient_attribute` Gate, open the condition editor.
2. Toggle to **Attribute** → the picker loads vocabulary (should list `lab.hemoglobin`, `patient.trimester`, etc.).
3. Pick `patient.trimester`, operator `in`, value `1,3` → confirm the properties panel shows `{kind:'attribute', attribute:'patient.trimester', operator:'in', value:'1,3'}`.
4. Toggle back to **Coded** → confirm attribute fields are cleared and the coded form works as before.
5. Save/serialize → confirm the pathway JSON carries the attribute condition (inspect the network `importPathway` payload or the JSON editor).

- [ ] **Step 6: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard add src/lib/graphql/queries/attributes.ts src/components/editor/AttributePicker.tsx src/components/editor/GateConditionEditor.tsx
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard commit -m "feat: Coded/Attribute toggle + attribute picker in condition editor"
```

---

## Task 4 (frontend): surface attribute conditions in required-fields harvest

**Files:**
- Modify: `src/lib/pathway-required-fields.ts` (`addCondition` ~190-226; output shape ~34-52)

**Interfaces:**
- Produces: attribute conditions appear in the harvested required-fields (so the preview composer prompts for them).

- [ ] **Step 1: Add an attribute branch in `addCondition`**

`addCondition` (line ~190) currently does `if (!field) return;` (line ~202), silently dropping attribute conditions. Add, before that guard: if `cond.attribute` is a string, push into a new `attributes` bucket (add `attributes: string[]` to `PathwayRequiredFields` at ~34-52, deduped) and return. Keep the existing coded logic unchanged for `field`-based conditions.

```ts
if (typeof cond.attribute === 'string') {
  if (!out.attributes.includes(cond.attribute)) out.attributes.push(cond.attribute);
  return;
}
```

(Initialize `attributes: []` wherever the `PathwayRequiredFields` accumulator is constructed.)

- [ ] **Step 2: Build + lint gate**

Run: `npm run build --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard`
Run: `npm run lint --prefix /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard`
Expected: both succeed.

- [ ] **Step 3: Manual verification**

In a pathway with an attribute condition, open the preview/composer and confirm the attribute (e.g. `patient.trimester`) is surfaced as a required field the composer prompts for. Record in the report.

- [ ] **Step 4: Commit**

```bash
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard add src/lib/pathway-required-fields.ts
git -C /home/claude/workspace/features/feat-gate-condition-field-attribute-model/prism-admin-dashboard commit -m "feat: surface attribute conditions in required-fields harvest"
```

---

## Self-Review

**Spec coverage:** Coded/Attribute toggle → Task 3 ✓; attribute picker fed by backend vocabulary (UI == resolver) → Tasks 1+3 ✓; compound rows inherit automatically (each is a `ConditionRow`) → Task 3 ✓; serializer/deserializer unchanged (pass-through) → confirmed, no task needed; required-fields harvest → Task 4 ✓; shared type → Task 2 ✓.

**Placeholder scan:** none. The `in`-as-comma-string decision is stated explicitly (v1 simplification).

**Type consistency:** `KNOWN_PATIENT_ATTRIBUTES` is the single source for `patient.*` (backend Task 1) and is reused by Plan 3's population. `AttributeVocabularyEntry` fields (`attribute/namespace/display/valueType/unit`) match across the GraphQL type, the builder, the query, and the picker.

**Cross-repo note:** Tasks 1 lives in prism-graphql; Tasks 2-4 in prism-admin-dashboard. The subagent-driven executor must dispatch each task's implementer into the correct repo worktree.

---

## Next Plan

- **Plan 5 — Reset & prove**: re-author the disposable pathways to canonical form and add an end-to-end resolution test.
