# Care Plan Generation Data Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix care plan generation so patient conditions are visible, ICD-10 search works, the mutation reaches the backend, and the visit page treats audio recording as optional.

**Architecture:** Add `patient: Patient` field to Visit type in providers-service (federation resolves clinical data via epic-api-service). Add ICD-10 reference table + search query in careplan-service. Fix frontend mutation field mismatches. Restructure visit page as a hub with two entry points.

**Tech Stack:** TypeScript 5, Apollo Federation 2.10, PostgreSQL 15 (pg_trgm), Next.js 16, React 19, Apollo Client 4

**Important:** Never use compound `cd && git` commands. Use `git -C /absolute/path` instead.

**Worktree paths:**
- Backend: `/home/claude/workspace/features/feat-visit-workflow-enhancements/prism-graphql`
- Frontend: `/home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end`

---

## Task 1: Add `patient` field to Visit type (providers-service)

**Files:**
- Modify: `prism-graphql/apps/providers-service/schema.graphql:18-46`
- Modify: `prism-graphql/apps/providers-service/src/resolvers/Query.ts:50-54`

**Step 1: Add `patient` field to Visit type in schema**

In `schema.graphql`, add `patient: Patient` to the Visit type after `patientId`:

```graphql
type Visit @key(fields: "id") {
  id: ID!
  patientId: ID!
  patient: Patient
  # ... rest unchanged
}
```

This is line 20 — insert `patient: Patient` after `patientId: ID!`.

**Step 2: Add Visit.patient resolver**

In `resolvers/Query.ts`, the `Visit` resolver block is at lines 50-54. Add a `patient` field resolver that returns a federation reference stub:

```typescript
Visit: {
  async relatedVisits(parent: any) {
    return visitService.getRelatedVisits(parent.id);
  },
  patient(parent: any) {
    return { __typename: 'Patient', id: parent.patientId };
  },
},
```

**Step 3: Verify TypeScript compiles**

Run: `npm run typecheck` from `prism-graphql/`
Expected: No new errors (the Patient type is already defined as `@key(fields: "id", resolvable: false)` so federation handles resolution).

**Step 4: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-graphql add apps/providers-service/schema.graphql apps/providers-service/src/resolvers/Query.ts
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-graphql commit -m "feat: add patient field to Visit type for federation resolution"
```

---

## Task 2: Add `GenerationMode` to backend schema and pipeline types

**Files:**
- Modify: `prism-graphql/apps/careplan-service/schema-pipeline.graphql:165-175`
- Modify: `prism-graphql/apps/careplan-service/src/orchestration/types.ts:12-35`
- Modify: `prism-graphql/apps/careplan-service/src/resolvers/mutations/generate-care-plan.ts:36-45,116-128`

**Step 1: Add GenerationMode enum and field to GraphQL schema**

In `schema-pipeline.graphql`, add the enum before the `GenerateCarePlanInput` (before line 165):

```graphql
enum GenerationMode {
  TEMPLATE
  ML_ASSISTED
  MANUAL
}
```

Then add `generationMode` field to `GenerateCarePlanInput` (after line 170, the `conditionCodes` line):

```graphql
input GenerateCarePlanInput {
  visitId: ID!
  patientId: ID!
  transcriptText: String
  audioUrl: String
  conditionCodes: [String!]!
  generationMode: GenerationMode = ML_ASSISTED
  generateDraft: Boolean = true
  preferredTemplateIds: [ID!]
  additionalContext: String
  idempotencyKey: String!
}
```

**Step 2: Add `generationMode` to PipelineInput TypeScript interface**

In `orchestration/types.ts`, add to the `PipelineInput` interface (after `conditionCodes` field at line 22):

```typescript
export interface PipelineInput {
  visitId: string;
  patientId: string;
  transcriptText?: string;
  audioUrl?: string;
  conditionCodes: string[];
  /** Generation mode: TEMPLATE, ML_ASSISTED, or MANUAL */
  generationMode?: 'TEMPLATE' | 'ML_ASSISTED' | 'MANUAL';
  idempotencyKey: string;
  correlationId: string;
  generateDraft?: boolean;
  preferredTemplateIds?: string[];
  userId: string;
  userRole: string;
}
```

**Step 3: Add `additionalContext` to PipelineInput**

The frontend sends `additionalContext` and the GraphQL schema accepts it, but the TypeScript interface doesn't have it. Add it to `PipelineInput`:

```typescript
  /** Additional context for generation (chief complaint, related visit notes) */
  additionalContext?: string;
```

**Step 4: Pass generationMode and additionalContext through in the resolver**

In `generate-care-plan.ts`, update the `GenerateCarePlanInput` interface (lines 36-45) to include:

```typescript
interface GenerateCarePlanInput {
  visitId: string;
  patientId: string;
  transcriptText?: string;
  audioUrl?: string;
  conditionCodes: string[];
  generationMode?: 'TEMPLATE' | 'ML_ASSISTED' | 'MANUAL';
  generateDraft?: boolean;
  preferredTemplateIds?: string[];
  additionalContext?: string;
  idempotencyKey: string;
}
```

Then update the `pipelineInput` construction (lines 116-128) to include the new fields:

```typescript
const pipelineInput: PipelineInput = {
  visitId: input.visitId,
  patientId: input.patientId,
  transcriptText: input.transcriptText,
  audioUrl: input.audioUrl,
  conditionCodes: input.conditionCodes,
  generationMode: input.generationMode,
  idempotencyKey: input.idempotencyKey,
  correlationId,
  generateDraft: input.generateDraft,
  preferredTemplateIds: input.preferredTemplateIds,
  additionalContext: input.additionalContext,
  userId: context.userId,
  userRole: context.userRole,
};
```

**Step 5: Verify TypeScript compiles**

Run: `npm run typecheck` from `prism-graphql/`
Expected: PASS

**Step 6: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-graphql add apps/careplan-service/schema-pipeline.graphql apps/careplan-service/src/orchestration/types.ts apps/careplan-service/src/resolvers/mutations/generate-care-plan.ts
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-graphql commit -m "feat: add GenerationMode enum to careplan pipeline schema and types"
```

---

## Task 3: Create ICD-10 reference table and seed data

**Files:**
- Create: `prism-graphql/shared/data-layer/migrations/034_create_icd10_codes.sql`
- Create: `prism-graphql/shared/data-layer/seed/icd10-common-codes.sql`

**Step 1: Create migration**

Create `034_create_icd10_codes.sql`:

```sql
-- ICD-10-CM reference table for code search
-- Source: CMS ICD-10-CM code set (public domain)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS icd10_codes (
    code        VARCHAR(10) PRIMARY KEY,
    description TEXT NOT NULL,
    category    VARCHAR(10) NOT NULL,
    category_description TEXT NOT NULL,
    is_billable BOOLEAN NOT NULL DEFAULT true
);

-- Trigram indexes for fast text search
CREATE INDEX IF NOT EXISTS idx_icd10_code_trgm
    ON icd10_codes USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_icd10_desc_trgm
    ON icd10_codes USING gin (description gin_trgm_ops);

-- Standard B-tree index on category for grouping
CREATE INDEX IF NOT EXISTS idx_icd10_category
    ON icd10_codes (category);
```

**Step 2: Create seed data with common primary care ICD-10 codes**

Create `icd10-common-codes.sql` with a representative set of common codes. This should include at minimum codes for:
- Diabetes (E11.x)
- Hypertension (I10, I11.x)
- Respiratory infections (J06.x, J20.x)
- Back pain (M54.x)
- Anxiety/depression (F32.x, F41.x)
- Hyperlipidemia (E78.x)
- Obesity (E66.x)
- Asthma (J45.x)
- COPD (J44.x)
- Heart failure (I50.x)
- Coronary artery disease (I25.x)
- Atrial fibrillation (I48.x)
- Chronic kidney disease (N18.x)
- Hypothyroidism (E03.x)
- GERD (K21.x)
- Osteoarthritis (M17.x, M19.x)
- Allergic rhinitis (J30.x)
- UTI (N39.0)
- Headache/migraine (G43.x, R51)
- Skin conditions (L20.x, L40.x)

Target: ~500-1000 common billable codes with descriptions. Use INSERT with ON CONFLICT DO NOTHING for idempotency.

Format:
```sql
INSERT INTO icd10_codes (code, description, category, category_description, is_billable)
VALUES
  ('E11', 'Type 2 diabetes mellitus', 'E11', 'Type 2 diabetes mellitus', false),
  ('E11.65', 'Type 2 diabetes mellitus with hyperglycemia', 'E11', 'Type 2 diabetes mellitus', true),
  -- ... more codes
ON CONFLICT (code) DO NOTHING;
```

**Step 3: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-graphql add shared/data-layer/migrations/034_create_icd10_codes.sql shared/data-layer/seed/icd10-common-codes.sql
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-graphql commit -m "feat: add ICD-10 reference table and common code seed data"
```

---

## Task 4: Add `searchIcd10Codes` query to careplan-service

**Files:**
- Modify: `prism-graphql/apps/careplan-service/schema.graphql:511-563`
- Modify: `prism-graphql/apps/careplan-service/src/resolvers/Query.ts:268`

**Step 1: Add Icd10Code type and query to schema**

In `schema.graphql`, add the type before the Query block (before line 511):

```graphql
type Icd10Code {
  code: String!
  description: String!
  category: String!
  categoryDescription: String!
  isBillable: Boolean!
}
```

Then add the search query inside the `type Query { ... }` block (after line 562, before the closing `}`):

```graphql
  # Search ICD-10 codes by code prefix or description text
  searchIcd10Codes(query: String!, limit: Int = 20): [Icd10Code!]!
```

**Step 2: Add resolver**

In `Query.ts`, add the `searchIcd10Codes` resolver inside the `Query` object (after the `trainingCarePlan` resolver, around line 267):

```typescript
async searchIcd10Codes(_parent, { query, limit }: { query: string; limit: number }, context) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const searchLimit = Math.min(limit || 20, 50);
  const pool = context.pool;

  // If input looks like an ICD-10 code (letter + digit), prioritize code prefix match
  const looksLikeCode = /^[A-Za-z]\d/.test(trimmed);

  let rows;
  if (looksLikeCode) {
    const result = await pool.query(
      `SELECT code, description, category, category_description, is_billable
       FROM icd10_codes
       WHERE code ILIKE $1
       ORDER BY code
       LIMIT $2`,
      [`${trimmed.toUpperCase()}%`, searchLimit]
    );
    rows = result.rows;
  } else {
    const result = await pool.query(
      `SELECT code, description, category, category_description, is_billable,
              similarity(description, $1) AS sim
       FROM icd10_codes
       WHERE description % $1 OR description ILIKE '%' || $1 || '%'
       ORDER BY sim DESC, code
       LIMIT $2`,
      [trimmed, searchLimit]
    );
    rows = result.rows;
  }

  return rows.map((row) => ({
    code: row.code,
    description: row.description,
    category: row.category,
    categoryDescription: row.category_description,
    isBillable: row.is_billable,
  }));
},
```

Note: The `context.pool` pattern follows the existing careplan-service resolver pattern. Verify that the resolver context includes a `pool` property — check how other resolvers access the database. If it uses a service pattern instead, adapt accordingly (e.g., create a simple `icd10Service.search(query, limit)` function).

**Step 3: Verify TypeScript compiles**

Run: `npm run typecheck` from `prism-graphql/`
Expected: PASS

**Step 4: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-graphql add apps/careplan-service/schema.graphql apps/careplan-service/src/resolvers/Query.ts
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-graphql commit -m "feat: add searchIcd10Codes query to careplan-service"
```

---

## Task 5: Fix frontend GET_VISIT query to include patient data

**Files:**
- Modify: `prism-provider-front-end/src/lib/graphql/queries/visits.ts:22-60`

**Step 1: Uncomment and populate the patient block in GET_VISIT**

Replace the current GET_VISIT query (lines 22-60) with the patient fields uncommented:

```typescript
export const GET_VISIT = gql`
  query GetVisit($id: ID!) {
    visit(id: $id) {
      id
      patientId
      patient {
        id
        mrn
        firstName
        lastName
        dateOfBirth
        gender
        conditions {
          id
          code
          codeSystem
          name
          status
          onsetDate
        }
        medications {
          id
          name
          dosage
          frequency
          status
        }
        allergies {
          id
          allergen
          reaction
          severity
        }
      }
      providerId
      scheduledAt
      startedAt
      completedAt
      status
      type
      chiefComplaint
      notes
      audioUri
      relatedVisits {
        id
        scheduledAt
        completedAt
        status
        type
        chiefComplaint
        notes
      }
    }
  }
`;
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build` from `prism-provider-front-end/`
Expected: PASS (the Patient type in `types/index.ts` already has optional `conditions`, `medications`, `allergies` fields)

**Step 3: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end add src/lib/graphql/queries/visits.ts
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end commit -m "feat: include patient clinical data in GET_VISIT query"
```

---

## Task 6: Align frontend SEARCH_ICD10_CODES query with backend

**Files:**
- Modify: `prism-provider-front-end/src/lib/graphql/queries/careplans.ts:103-112`

**Step 1: Update the query to match backend schema field name and return type**

Replace lines 103-112:

```typescript
export const SEARCH_ICD10_CODES = gql`
  query SearchIcd10Codes($query: String!, $limit: Int) {
    searchIcd10Codes(query: $query, limit: $limit) {
      code
      description
      category
      categoryDescription
      isBillable
    }
  }
`;
```

Key changes:
- Field name: `searchICD10Codes` → `searchIcd10Codes` (matching backend camelCase)
- Added: `categoryDescription`, `isBillable` fields

**Step 2: Add Icd10Code type to frontend types**

In `prism-provider-front-end/src/types/index.ts`, add after the `Condition` interface (after line 49):

```typescript
export interface Icd10Code {
  code: string;
  description: string;
  category: string;
  categoryDescription: string;
  isBillable: boolean;
}
```

**Step 3: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end add src/lib/graphql/queries/careplans.ts src/types/index.ts
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end commit -m "feat: align SEARCH_ICD10_CODES query with backend schema"
```

---

## Task 7: Fix useCarePlanGeneration hook mutation fields

**Files:**
- Modify: `prism-provider-front-end/src/lib/hooks/useCarePlanGeneration.ts:43-51,114-143`

**Step 1: Update GenerateInput interface**

Replace lines 43-51:

```typescript
interface GenerateInput {
  visitId: string;
  patientId: string;
  conditionCodes: string[];
  generationMode: 'TEMPLATE' | 'ML_ASSISTED' | 'MANUAL';
  templateId?: string;
  additionalContext?: string;
}
```

Changes: Removed `entityIds` (not in backend schema).

**Step 2: Update generateFromVisit to add idempotencyKey and map templateId**

Replace the `generateFromVisit` callback (lines 114-143):

```typescript
const generateFromVisit = useCallback(
  async (input: GenerateInput) => {
    setStatus('generating');
    setError(null);

    try {
      const { data } = await generateMutation({
        variables: {
          input: {
            visitId: input.visitId,
            patientId: input.patientId,
            conditionCodes: input.conditionCodes,
            generationMode: input.generationMode,
            preferredTemplateIds: input.templateId ? [input.templateId] : undefined,
            additionalContext: input.additionalContext,
            idempotencyKey: crypto.randomUUID(),
          },
        },
      });

      const result = data?.generateCarePlanFromVisit;
      if (!result) {
        throw new Error('Failed to generate care plan');
      }

      setRequestId(result.requestId);
      setRecommendations(result.recommendations || []);
      setDraftCarePlan(result.draftCarePlan || null);
      setRedFlags(result.redFlags || []);
      setProcessingTime(result.processingTime);
      setRequiresManualReview(result.requiresManualReview);
      setStatus('completed');
    } catch (err) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Generation failed');
      throw err;
    }
  },
  [generateMutation]
);
```

Key changes:
- Removed `entityIds` from variables
- Added `idempotencyKey: crypto.randomUUID()`
- Mapped `templateId` → `preferredTemplateIds: [templateId]`
- Passed `generationMode` through to backend

**Step 3: Verify TypeScript compiles**

Run: `npm run build` from `prism-provider-front-end/`
Expected: PASS

**Step 4: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end add src/lib/hooks/useCarePlanGeneration.ts
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end commit -m "fix: align useCarePlanGeneration with backend GenerateCarePlanInput schema"
```

---

## Task 8: Redesign ConditionCodePicker component

**Files:**
- Rewrite: `prism-provider-front-end/src/components/provider/ConditionCodePicker.tsx`

**Step 1: Rewrite ConditionCodePicker with two sections**

The new component has:
1. **Patient conditions section** — checkboxes for each condition from `visit.patient.conditions`
2. **ICD-10 search section** — debounced search input calling `searchIcd10Codes`, results as a dropdown

New props interface:

```typescript
interface ConditionCodePickerProps {
  patientConditions?: Condition[];
  selectedCodes: string[];
  onSelectionChange: (codes: string[]) => void;
  className?: string;
}
```

The component should:
- Show patient's active conditions as checkboxes (checked if code is in `selectedCodes`)
- Toggling a checkbox adds/removes the code from `selectedCodes`
- Search input with 300ms debounce calls `SEARCH_ICD10_CODES` via `useLazyQuery`
- Search results shown as a dropdown list — clicking a result adds it to `selectedCodes`
- "Added codes" section at the bottom shows any codes that aren't from the patient's conditions (i.e., manually searched and added)
- Keep the existing `SelectedCodeTag` sub-component for displaying added codes
- Keep the existing `ConditionCodeList` export for use elsewhere

Import `useLazyQuery` from `@apollo/client/react` and `SEARCH_ICD10_CODES` from the queries file.

Use the existing `Condition` type from `@/types` for `patientConditions`.

**Step 2: Verify TypeScript compiles**

Run: `npm run build` from `prism-provider-front-end/`
Expected: PASS

**Step 3: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end add src/components/provider/ConditionCodePicker.tsx
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end commit -m "feat: redesign ConditionCodePicker with patient conditions and ICD-10 search"
```

---

## Task 9: Update care plan page to use new ConditionCodePicker

**Files:**
- Modify: `prism-provider-front-end/src/app/visit/[visitId]/careplan/page.tsx`

**Step 1: Update ConditionCodePicker usage**

The careplan page currently uses:
```tsx
<ConditionCodePicker
  selectedCodes={conditionCodes}
  onAdd={handleAddConditionCode}
  onRemove={handleRemoveConditionCode}
/>
```

Change to:
```tsx
<ConditionCodePicker
  patientConditions={visit.patient?.conditions}
  selectedCodes={conditionCodes}
  onSelectionChange={setConditionCodes}
/>
```

**Step 2: Remove the old `handleAddConditionCode` and `handleRemoveConditionCode` functions**

Delete lines 149-157 (the `handleAddConditionCode` and `handleRemoveConditionCode` functions). They're replaced by `onSelectionChange` which directly sets the array.

**Step 3: Remove the old auto-population useEffect**

Delete the `useEffect` at lines 61-70 that tried to auto-populate from `visit.patient.conditions`. The new `ConditionCodePicker` handles display of patient conditions as checkboxes — the user explicitly selects which ones to include.

**Step 4: Update the handleGenerate function**

In `handleGenerate` (line 86), remove `entityIds` from the call since the hook no longer accepts it:

```typescript
await carePlanGen.generateFromVisit({
  visitId,
  patientId: visit.patientId,
  conditionCodes,
  templateId: selectedTemplateId || undefined,
  generationMode,
  additionalContext,
});
```

The `entityIds` and `selectedEntities` references can be removed from the destructuring and callback dependencies.

**Step 5: Verify TypeScript compiles**

Run: `npm run build` from `prism-provider-front-end/`
Expected: PASS

**Step 6: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end add src/app/visit/[visitId]/careplan/page.tsx
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end commit -m "feat: wire careplan page to new ConditionCodePicker with patient conditions"
```

---

## Task 10: Restructure visit page as hub with two entry points

**Files:**
- Rewrite: `prism-provider-front-end/src/app/visit/[visitId]/page.tsx`
- Create: `prism-provider-front-end/src/app/visit/[visitId]/record/page.tsx`

**Step 1: Create the record page**

Create `record/page.tsx` by extracting the AudioRecorder section from the current visit page. This page should:
- Show the same header with patient info
- Show VisitTimeline with 'recording' as current step
- Contain the AudioRecorder component, upload progress, and transcription status UI
- After recording stops → auto-navigate to `/visit/{visitId}/review` (existing behavior)
- Back button → `/visit/{visitId}`

Copy the audio-related state/hooks (`useAudioRecorder`, `useTranscription`, `isUploading`, `uploadProgress`, `handleStopRecording`) from the current visit page into this new page.

**Step 2: Rewrite the visit page as a hub**

Replace the current visit page content. The new page should:

**Remove:**
- VisitTimeline component (no longer on the hub page)
- AudioRecorder component and all audio-related state/hooks
- The `useAudioRecorder` and `useTranscription` imports and hooks
- The `uploadAudioToGCS` import
- The `isUploading`, `uploadProgress`, `workflowError` state
- The `handleStopRecording` callback

**Add:**
- Two action cards side by side in a 2-column grid:
  - **"Generate Care Plan"** card — icon (ClipboardDocumentListIcon or similar), description "Create a care plan from patient conditions and clinical context", button links to `/visit/{visitId}/careplan`
  - **"Record Visit Audio"** card — icon (MicrophoneIcon), description "Record and transcribe the visit to extract clinical entities for the care plan", button links to `/visit/{visitId}/record`

**Keep:**
- Header with patient info, status badge, End Visit / Reopen Visit buttons
- Patient Info sidebar (conditions, medications, allergies — now populated via federation)
- Visit Notes textarea
- Related Visits section

The layout becomes:
```
Header (patient info, status, actions)
Two action cards (side by side)
Patient Info + Notes + Related Visits (sidebar layout or stacked)
```

**Step 3: Verify TypeScript compiles**

Run: `npm run build` from `prism-provider-front-end/`
Expected: PASS

**Step 4: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end add src/app/visit/[visitId]/page.tsx src/app/visit/[visitId]/record/page.tsx
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end commit -m "feat: restructure visit page as hub, move AudioRecorder to /record"
```

---

## Task 11: Ungate review page Continue button from entity selection

**Files:**
- Modify: `prism-provider-front-end/src/app/visit/[visitId]/review/page.tsx:136-142,228-235`

**Step 1: Remove entity selection requirement from header Continue button**

At line 138, change:
```tsx
disabled={isTranscriptionProcessing || selectedEntities.size === 0}
```
to:
```tsx
disabled={isTranscriptionProcessing}
```

**Step 2: Remove entity selection requirement from footer button**

At line 231, change:
```tsx
disabled={selectedEntities.size === 0}
```
to:
```tsx
disabled={false}
```

Or better: just remove the `disabled` prop entirely from the footer button.

**Step 3: Update footer button label**

At line 233, change "Generate Care Plan" to "Continue to Care Plan" — since entity selection is now optional, the label should reflect navigation rather than implying generation requires entities.

**Step 4: Verify TypeScript compiles**

Run: `npm run build` from `prism-provider-front-end/`
Expected: PASS

**Step 5: Commit**

```bash
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end add src/app/visit/[visitId]/review/page.tsx
git -C /home/claude/workspace/features/feat-visit-workflow-enhancements/prism-provider-front-end commit -m "fix: ungate review page Continue button from entity selection"
```

---

## Task 12: Final verification

**Step 1: TypeScript check — backend**

Run: `npm run typecheck` from `prism-graphql/`
Expected: PASS with no errors

**Step 2: Lint — backend**

Run: `npm run lint` from `prism-graphql/`
Expected: PASS

**Step 3: TypeScript check — frontend**

Run: `npm run build` from `prism-provider-front-end/`
Expected: PASS (Next.js build includes type checking)

**Step 4: Lint — frontend**

Run: `npm run lint` from `prism-provider-front-end/`
Expected: PASS

**Step 5: Run existing backend tests**

Run: `npm run test` from `prism-graphql/`
Expected: Existing tests pass. No new tests are added in this plan (deferred — the project currently has zero frontend tests and backend tests don't cover the new ICD-10 query).

**Step 6: If any errors, fix and commit**

Fix compilation or lint errors. Commit fixes with:
```bash
git -C <repo-path> commit -m "fix: resolve typecheck/lint errors from careplan data flow changes"
```
