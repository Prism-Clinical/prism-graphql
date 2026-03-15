# Care Plan Generation Data Flow Design

**Date:** 2026-03-10
**Branch:** feat/visit-workflow-enhancements
**Status:** Approved

## Problem

The care plan generation page is broken in three ways:

1. **No ICD-10 condition codes displayed** — The `GET_VISIT` query has the `patient` field commented out. The Visit type in providers-service doesn't expose a `patient` field. So `visit.patient.conditions` is always undefined and the condition code list is empty, which disables the Generate button.

2. **Frontend-backend mutation mismatches** — The frontend sends fields the backend doesn't accept (`entityIds`, `generationMode`) and omits a required field (`idempotencyKey`). The mutation fails at the GraphQL schema validation level.

3. **Visit UX implies audio recording is required** — The visit page is structured as step 1 of a linear pipeline (Record → Transcribe → Review → Care Plan), making it appear that audio recording is a prerequisite for care plan generation.

## Goals

- Patient's active conditions (from Epic clinical snapshots) are visible and selectable on the care plan page
- Doctors can search a full ICD-10-CM database to add conditions not on the patient's record
- The generate mutation successfully reaches the backend pipeline orchestrator
- The visit page presents audio recording as optional, with direct access to care plan generation
- All changes pass TypeScript compilation with no errors

## Non-Goals

- Pipeline orchestrator / ML service wiring (separate workstream)
- Mock draft data for dev testing
- Auth context propagation (`createdBy: 'system'` TODOs)
- Access control checks
- Accept/reject draft flow fixes

## Design

### 1. Surface Patient Clinical Data via Federation

**Approach:** Add `patient: Patient` field to the Visit type in providers-service. The federation gateway already composes epic-api-service, which has a working `__resolveReference` resolver that maps patient ID → Epic patient ID → latest clinical snapshot → conditions/medications/allergies.

**Why this approach:** The infrastructure is already built but disconnected:
- epic-api-service already extends Patient with `conditions`, `medications`, `allergies` fields
- epic-api-service already has `__resolveReference` that fetches latest snapshot data
- patient-clinical-mappers.ts already converts snapshot data to frontend-friendly types
- The only missing link is Visit → Patient reference in the providers-service schema

**providers-service schema change:**

```graphql
type Visit @key(fields: "id") {
  id: ID!
  patientId: ID!
  patient: Patient    # NEW — federation resolves via patients-service + epic-api-service
  # ... existing fields unchanged
}
```

**providers-service Visit resolver:**

```typescript
Visit: {
  patient(visit) {
    return { __typename: 'Patient', id: visit.patientId };
  }
}
```

**Federation resolution chain:**
1. providers-service returns `{ __typename: 'Patient', id: '<uuid>' }`
2. Gateway calls patients-service `__resolveReference` → basic fields (name, mrn, dob)
3. Gateway calls epic-api-service `__resolveReference` → conditions, medications, allergies from latest snapshot

**Frontend GET_VISIT query update:**

```graphql
query GetVisit($id: ID!) {
  visit(id: $id) {
    # ... existing fields
    patient {
      id
      mrn
      firstName
      lastName
      dateOfBirth
      gender
      conditions { id code codeSystem name status onsetDate }
      medications { id name dosage frequency status }
      allergies { id allergen reaction severity }
    }
  }
}
```

### 2. ICD-10 Code Search

**Approach:** PostgreSQL reference table in careplan-service with pg_trgm trigram index for fast text search.

**Why this approach:**
- Fast, reliable, no external dependency — appropriate for a clinical tool
- ICD-10-CM dataset is freely available from CMS (~72K codes)
- pg_trgm enables fuzzy search on both code prefixes and description text
- careplan-service is the primary consumer of ICD-10 code selection

**Database migration** (`034_create_icd10_codes.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE icd10_codes (
  code        VARCHAR(10) PRIMARY KEY,
  description TEXT NOT NULL,
  category    VARCHAR(10) NOT NULL,
  category_description TEXT NOT NULL,
  is_billable BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_icd10_code_trgm ON icd10_codes USING gin (code gin_trgm_ops);
CREATE INDEX idx_icd10_desc_trgm ON icd10_codes USING gin (description gin_trgm_ops);
```

**Seed data:** Parse CMS ICD-10-CM flat file into SQL seed. Start with common primary care codes (~2-3K), expand to full set later.

**GraphQL schema (careplan-service):**

```graphql
type Icd10Code {
  code: String!
  description: String!
  category: String!
  categoryDescription: String!
  isBillable: Boolean!
}

extend type Query {
  searchIcd10Codes(query: String!, limit: Int = 20): [Icd10Code!]!
}
```

**Search logic:**
- If input looks like an ICD-10 code (starts with letter + digit), prioritize `code ILIKE $1%`
- Otherwise, trigram similarity search on description
- Combined with UNION, ordered by relevance, limited to requested count

### 3. Frontend ConditionCodePicker Redesign

**Current:** Simple text input for manual ICD-10 code entry.

**New:** Two-section component:

1. **Patient's Active Conditions** — Checkbox list from `visit.patient.conditions`, showing code + name + status badge. Doctor checks which are relevant to this care plan.

2. **ICD-10 Search** — Debounced search input calling `searchIcd10Codes`. Results shown as dropdown with `code — description` format. Selecting adds to the selected codes list.

**New props interface:**

```typescript
interface ConditionCodePickerProps {
  patientConditions: PatientCondition[];   // from visit.patient.conditions
  selectedCodes: string[];
  onSelectionChange: (codes: string[]) => void;
}
```

### 4. Visit Page UX Restructure

**Current:** Visit page is the audio recording page (step 1 of 4-step linear pipeline).

**New:** Visit page becomes a hub with two entry points:

1. **"Start Care Plan"** → `/visit/{visitId}/careplan` — works without audio/transcription
2. **"Start Recording"** → `/visit/{visitId}/record` — optional enrichment path

**Changes:**
- Move AudioRecorder out of main visit page into new `/visit/{visitId}/record/page.tsx`
- Remove VisitTimeline from visit hub page (keep on review + careplan pages as breadcrumb)
- Show patient clinical info (conditions, meds, allergies) on the visit hub itself
- Present two action cards side by side (Care Plan and Record Audio)
- Ungate "Continue" button on review page — entity selection becomes optional enhancement

### 5. Frontend-Backend Mutation Fixes

**Backend schema** — Add `GenerationMode` enum to `GenerateCarePlanInput`:

```graphql
enum GenerationMode {
  TEMPLATE
  ML_ASSISTED
  MANUAL
}

input GenerateCarePlanInput {
  # ... existing fields
  generationMode: GenerationMode = ML_ASSISTED   # NEW
}
```

**Backend resolver** — Pass `generationMode` through to `PipelineInput`.

**Frontend hook changes:**
- Generate `idempotencyKey: crypto.randomUUID()` before each mutation call
- Remove `entityIds` from the input (not in backend schema)
- Map `templateId` → `preferredTemplateIds: [templateId]`

## Files Changed

### Backend (prism-graphql)

| File | Change |
|------|--------|
| `apps/providers-service/schema.graphql` | Add `patient: Patient` field to Visit type |
| `apps/providers-service/src/resolvers/` | Add Visit.patient resolver returning Patient reference |
| `apps/careplan-service/schema-pipeline.graphql` | Add `GenerationMode` enum, add field to input |
| `apps/careplan-service/src/resolvers/mutations/generate-care-plan.ts` | Pass generationMode to pipeline input |
| `apps/careplan-service/src/orchestration/types.ts` | Add generationMode to PipelineInput type |
| `apps/careplan-service/schema.graphql` | Add `Icd10Code` type and `searchIcd10Codes` query |
| `apps/careplan-service/src/resolvers/Query.ts` | Add searchIcd10Codes resolver |
| `shared/data-layer/migrations/034_create_icd10_codes.sql` | Create icd10_codes table with pg_trgm |
| `shared/data-layer/seed/icd10-codes.sql` | ICD-10-CM seed data |

### Frontend (prism-provider-front-end)

| File | Change |
|------|--------|
| `src/lib/graphql/queries/visits.ts` | Uncomment patient block in GET_VISIT, add condition fields |
| `src/lib/graphql/queries/careplans.ts` | Add SEARCH_ICD10_CODES query |
| `src/lib/hooks/useCarePlanGeneration.ts` | Add idempotencyKey, remove entityIds, map templateId |
| `src/components/provider/ConditionCodePicker.tsx` | Redesign: selectable patient conditions + ICD-10 search |
| `src/app/visit/[visitId]/page.tsx` | Restructure as hub with two entry points |
| `src/app/visit/[visitId]/record/page.tsx` | New page — AudioRecorder moved here |
| `src/app/visit/[visitId]/review/page.tsx` | Ungate Continue button from entity selection |
| `src/app/visit/[visitId]/careplan/page.tsx` | Use new ConditionCodePicker with patient conditions |
| `src/types/index.ts` | Verify PatientCondition type matches backend |

## Verification

After all changes:
- `npm run typecheck` passes in both prism-graphql and prism-provider-front-end
- `npm run lint` passes in both repos
- Existing tests continue to pass (`npm run test` in prism-graphql)

## End-to-End Flow After Implementation

```
Doctor opens visit → sees patient info (conditions, meds, allergies from Epic)
  │
  ├─→ "Start Care Plan" → careplan page
  │     → Patient conditions shown as checkboxes
  │     → Doctor selects relevant conditions
  │     → Doctor searches ICD-10 for new diagnosis, adds it
  │     → Selects generation mode → Generate
  │     → Pipeline orchestrator produces draft
  │     → Doctor reviews/edits → Save or Activate
  │
  └─→ "Start Recording" → record page → audio → review page
        → Entities extracted from transcript
        → Doctor selects entities → Continue to careplan
        → Same care plan flow, enriched with entity context
```
