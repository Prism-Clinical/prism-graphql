# Patient Clinical Data via Federation

**Date:** 2026-02-19
**Status:** Approved

## Goal

Show conditions, medications, and allergies on the patient detail page by having epic-api-service extend the Patient type via Apollo Federation, resolving from the latest clinical snapshot in the database.

## Architecture

```
Frontend: GET_PATIENT query
  → Gateway routes conditions/medications/allergies to epic-api-service
    → Looks up epic_patient_id from patients table
    → Fetches latest clinical snapshot
    → Maps snapshot data to simplified types
```

## Backend Changes (epic-api-service)

### New GraphQL Types

```graphql
enum PatientConditionStatus { ACTIVE, RESOLVED, INACTIVE }
enum PatientMedicationStatus { ACTIVE, DISCONTINUED }
enum AllergySeverity { MILD, MODERATE, SEVERE }

type PatientCondition {
  id: ID!
  code: String!
  codeSystem: String
  name: String!
  status: PatientConditionStatus!
  onsetDate: String
}

type PatientMedication {
  id: ID!
  name: String!
  dosage: String
  frequency: String
  status: PatientMedicationStatus!
  prescribedDate: String
}

type PatientAllergy {
  id: ID!
  allergen: String!
  reaction: String
  severity: AllergySeverity!
}
```

### Patient Extension

```graphql
extend type Patient @key(fields: "id") {
  id: ID! @external
  conditions: [PatientCondition!]!
  medications: [PatientMedication!]!
  allergies: [PatientAllergy!]!
}
```

### Resolver

`Patient.__resolveReference(ref)`:
1. Query `patients` table for `epic_patient_id` WHERE `id = ref.id`
2. If no epic_patient_id, return empty arrays
3. Query latest snapshot's conditions, medications, allergies
4. Map to simplified types

### New Database Functions

- `getEpicPatientIdByPatientId(patientId)` — simple lookup on patients table
- `getLatestSnapshotClinicalData(epicPatientId)` — lightweight query fetching only conditions/meds/allergies from latest snapshot (not vitals/labs)

## Data Mapping

### Conditions (snapshot_conditions → PatientCondition)

| Snapshot | Frontend | Mapping |
|---|---|---|
| `condition_id` or row id | `id` | Use condition_id, fallback to generated |
| `code` | `code` | Direct |
| `code_detail.coding[0].system` | `codeSystem` | First coding system |
| `display` | `name` | Direct |
| `clinical_status.coding[0].code` | `status` | `active`→ACTIVE, `resolved`→RESOLVED, else→INACTIVE |
| `onset_date_time` | `onsetDate` | Direct |

### Medications (snapshot_medications → PatientMedication)

| Snapshot | Frontend | Mapping |
|---|---|---|
| `medication_request_id` or row id | `id` | Use med request id, fallback to generated |
| `name` | `name` | Direct |
| `dosage_instructions[].text` | `dosage` | All instruction texts joined with ` · ` |
| `dosage_instructions[].timing` | `frequency` | All timings joined with ` · ` |
| `status` | `status` | `active`→ACTIVE, else→DISCONTINUED |
| `authored_on` | `prescribedDate` | Direct |

### Allergies (snapshot_allergies → PatientAllergy)

| Snapshot | Frontend | Mapping |
|---|---|---|
| `allergy_intolerance_id` or row id | `id` | Use allergy id, fallback to generated |
| `code.text` or `code.coding[].display` joined | `allergen` | code.text preferred, fallback to all coding displays joined with ` · ` |
| All `reactions[].manifestations[].text/display` | `reaction` | All manifestations across all reactions joined with ` · ` |
| `criticality` | `severity` | `high`→SEVERE, `low`→MILD, else→MODERATE |

## Frontend Changes

### Uncomment GET_PATIENT query fields

```graphql
query GetPatient($id: ID!) {
  patient(id: $id) {
    # ... existing fields ...
    conditions { id, code, codeSystem, name, status, onsetDate }
    medications { id, name, dosage, frequency, status, prescribedDate }
    allergies { id, allergen, reaction, severity }
  }
}
```

No type changes needed — frontend Patient interface already expects these fields.

## Files Modified

- `prism-graphql/apps/epic-api-service/src/index.ts` — schema + resolver
- `prism-graphql/apps/epic-api-service/src/services/database.ts` — new query functions
- `prism-provider-front-end/src/lib/graphql/queries/patients.ts` — uncomment fields
