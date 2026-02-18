# Expand Epic Sandbox Seed Data

**Date:** 2026-02-18
**Status:** Approved

## Problem

The dev database has only 1 test patient (Camila Lopez) seeded from Epic's FHIR sandbox. Developers need more patients with varied clinical data to exercise the full visit workflow, dashboard, and recommendation pipeline. Additionally, the frontend patient detail page displays allergies but epic-api-service doesn't fetch AllergyIntolerance from Epic.

## Solution

1. **Discover test patients** — One-time script queries Epic's sandbox Patient search endpoint, probes each patient's data richness (conditions, meds, vitals, labs), and ranks them
2. **Expand SQL seed** — Hardcode the top 8-10 patients with richest clinical data into the existing seed script
3. **Add AllergyIntolerance** — New 6th FHIR resource type in the snapshot pipeline (client method, transform, DB table, GraphQL schema)

## Components

### 1. Discovery Script

File: `shared/data-layer/seed/discover-epic-patients.sh`

- Authenticates with Epic sandbox via RS384 JWT (same flow as epic-api-service)
- Calls `GET /Patient?_count=50` to enumerate test patients
- For each patient, probes: Condition, MedicationRequest, Observation (vital-signs + laboratory) bundle totals
- Outputs ranked list with name, ID, and resource counts
- Run once manually; output informs which patients to hardcode

### 2. Expanded SQL Seed

File: `shared/data-layer/seed/epic-sandbox-patients.sql` (modify existing)

- Add ~8-10 patients (up from 1) selected by discovery script
- Each row: deterministic UUID, first_name, last_name, date_of_birth, gender, medical_record_number, epic_patient_id
- Keep existing institution and provider rows
- Idempotent (ON CONFLICT DO NOTHING)

### 3. AllergyIntolerance Pipeline

**FHIR client** (`epic-fhir-client.ts`):
- New method: `getAllergyIntolerances(patientId)` → `GET /AllergyIntolerance?patient={id}`

**Transform** (`transforms.ts`):
- New output type: `AllergyOut` (allergen name, reaction, severity, clinical status, category, criticality, onset, recorder, notes)
- New function: `transformAllergyIntolerances(allergyIntolerances)`

**Database** (new migration `027_add_snapshot_allergies.sql`):
- New table: `snapshot_allergies` with columns matching AllergyOut fields
- FK to `patient_clinical_snapshots(id)`

**Snapshot creation** (`index.ts` resolver):
- Add AllergyIntolerance to the parallel FHIR fetch in `createClinicalSnapshot`
- Add allergies to `SnapshotData` interface and DB insert
- Add allergies to `loadSnapshotDetails` read path

**GraphQL schema** (epic-api-service):
- Add `Allergy` type and `allergies` field on `ClinicalSnapshot`
- Add `allergies` field on `EpicPatientData`

### 4. No Changes to Seed Runner

`seed-epic-snapshots.sh` already loops over all patients with `epic_patient_id`. Adding more rows to the SQL seed is sufficient — the snapshot script will automatically create snapshots for all of them.

## Decisions

- **Static discovery** chosen over dynamic (reproducible, no runtime Epic dependency)
- **8-10 patients** balances data variety with seed speed (each snapshot = 6 FHIR API calls)
- **AllergyIntolerance** added because frontend already expects it and it's clinically important
