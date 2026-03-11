# SNOMED-to-ICD-10 Condition Code Mapping

**Date:** 2026-03-11
**Status:** Approved
**Feature branch:** feat/visit-workflow-enhancements

## Problem

Patient conditions from Epic FHIR use SNOMED CT codes (e.g., `38341003` for Hypertension). The care plan generation pipeline — both the GraphQL `generateCarePlanFromVisit` mutation and the ML `careplan_recommender` service — requires ICD-10 codes (e.g., `I10`). When a provider selects a patient condition in the ConditionCodePicker and generates a care plan, the SNOMED code fails validation.

## Approach

**Extract ICD-10 from FHIR data first, fall back to a static mapping table.**

Epic FHIR Condition resources often include multiple codings in `code.coding[]` — both SNOMED and ICD-10. The `snapshot_conditions.code_detail` JSONB column already stores this full array. We extract the ICD-10 code at read time when resolving patient conditions. For conditions that only have SNOMED, a small curated mapping table (~200 common primary care codes) provides the fallback. Unmapped conditions are surfaced in the UI with a prompt to search manually.

## Data Flow

```
Epic FHIR → snapshot_conditions.code_detail (already has full coding[])
                        ↓
          Patient.__resolveReference (epic-api-service)
          mapConditions() extracts ICD-10 from coding[] or queries fallback table
                        ↓
          PatientCondition { code, codeSystem, icd10Code }
                        ↓
          ConditionCodePicker (frontend) — shows condition name, passes icd10Code
                        ↓
          generateCarePlanFromVisit (careplan-service) — receives ICD-10 codes
                        ↓
          ML careplan_recommender — works as-is (ICD-10 only)
```

Mapping happens once at the read boundary (epic-api-service). The write path (careplan-service → ML) stays strict ICD-10.

## Changes

### 1. New Migration: `snomed_icd10_common_map` table

```sql
CREATE TABLE snomed_icd10_common_map (
  snomed_code VARCHAR(18) PRIMARY KEY,
  icd10_code  VARCHAR(10) NOT NULL REFERENCES icd10_codes(code),
  description TEXT NOT NULL
);
```

Seeded with ~200 common primary care SNOMED→ICD-10 mappings sourced from the NLM SNOMED-to-ICD-10-CM map. Covers: hypertension, diabetes (type 1/2), COPD, asthma, depression, anxiety, hyperlipidemia, obesity, CAD, heart failure, CKD, osteoarthritis, and similar high-frequency conditions.

### 2. epic-api-service: `patient-clinical-mappers.ts`

Update `mapConditions()` to:
1. Scan `codeDetail.coding[]` for an entry where `system` contains `icd-10` (e.g., `http://hl7.org/fhir/sid/icd-10-cm`).
2. If found, set `icd10Code` to that entry's `code`.
3. If not found and the primary code is SNOMED, query `snomed_icd10_common_map` by the SNOMED code.
4. If still no match, `icd10Code` is `null`.

### 3. epic-api-service: GraphQL schema

Add `icd10Code` to `PatientCondition`:

```graphql
type PatientCondition {
  id: ID!
  code: String!
  codeSystem: String
  icd10Code: String      # Extracted/mapped ICD-10 code, null if unmapped
  name: String!
  status: PatientConditionStatus!
  onsetDate: String
}
```

Update the `PatientCondition` TypeScript interface to match.

### 4. Frontend: `types/index.ts`

Add `icd10Code: string | null` to the `Condition` interface.

### 5. Frontend: GraphQL queries

Add `icd10Code` to condition fragments in `visits.ts` and `patients.ts`.

### 6. Frontend: `ConditionCodePicker.tsx`

- Pass `condition.icd10Code` instead of `condition.code` when a patient condition checkbox is toggled.
- Disable conditions where `icd10Code` is `null`, with a message: "No ICD-10 mapping — use search below."
- Display the ICD-10 code badge alongside the condition name, with SNOMED code shown as secondary reference.

### 7. careplan-service: `generate-care-plan.ts`

Revert validation back to ICD-10-only (remove SNOMED pattern added earlier). The frontend now only sends ICD-10 codes, so strict validation is the correct safety net.

## What stays untouched

- Pipeline orchestrator — passes codes through
- ML service client (`careplan-recommender/client.ts`) — already validates ICD-10
- ML `careplan_recommender` service — already expects ICD-10
- ICD-10 search feature in ConditionCodePicker — already works
- Care plan generation flow downstream of validation

## Scope

- ~7 files modified
- 1 new migration + seed file
- No architectural changes
