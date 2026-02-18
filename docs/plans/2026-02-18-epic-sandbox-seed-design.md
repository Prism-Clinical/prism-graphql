# Epic FHIR Sandbox Test Data Seed

**Date:** 2026-02-18
**Status:** Approved

## Problem

After running `make compose-up` and `make migrate`, the dev database is empty. There are no patients, providers, or clinical data visible in the UI. Developers need test data from Epic's FHIR sandbox to exercise the full visit workflow.

## Solution

A `make seed-epic-data` command that:
1. Inserts known Epic sandbox test patients into the `patients` table (with `epic_patient_id` linked)
2. Seeds a test provider and institution
3. Calls the existing `createClinicalSnapshot` mutation on epic-api-service for each patient, which pulls live FHIR data (vitals, labs, meds, conditions) from Epic's sandbox and stores it locally

## Architecture

```
make seed-epic-data
  |
  +-- 1. SQL INSERT -> postgres
  |     (patients with epic_patient_id, provider, institution)
  |
  +-- 2. For each patient:
       curl -> epic-api-service:4006/graphql
         |    createClinicalSnapshot(epicPatientId, trigger: MANUAL_REFRESH)
         |
         +-> epic-api-service authenticates with Epic (RS384 JWT)
              |
              +-> Fetches from fhir.epic.com:
                   GET /Patient/{id}
                   GET /Observation?patient={id}&category=vital-signs
                   GET /Observation?patient={id}&category=laboratory
                   GET /MedicationRequest?patient={id}
                   GET /Condition?patient={id}
                   |
                   +-> Transforms FHIR -> stores in clinical_snapshots tables
```

## Components

### 1. Docker Compose Epic Sandbox Override

File: `docker-compose.epic-sandbox.yml`

Overrides epic-api-service environment to point at real Epic sandbox:
- `EPIC_BASE_URL=https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`
- `EPIC_CLIENT_ID=b071ea66-9918-43f2-ae82-9a67a322ca36`
- `EPIC_TOKEN_URL=https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token`
- `EPIC_AUTH_ENABLED=true`

### 2. SQL Seed Script

File: `shared/data-layer/seed/epic-sandbox-patients.sql`

Inserts:
- 1 institution (test clinic)
- 1 provider (test doctor)
- Known Epic sandbox patients with `epic_patient_id` set

All idempotent via `ON CONFLICT DO NOTHING`.

### 3. Snapshot Seed Script

File: `shared/data-layer/seed/seed-epic-snapshots.sh`

For each patient's `epic_patient_id`:
- Waits for epic-api-service health
- Sends `createClinicalSnapshot` GraphQL mutation
- Reports success/failure

### 4. Orchestrator

File: `shared/data-layer/seed/seed-runner.sh`

Runs SQL seed, then snapshot seed. Reports summary.

### 5. Makefile Target

```makefile
seed-epic-data:  ## Seed DB with Epic sandbox patients + clinical snapshots
    @./shared/data-layer/seed/seed-runner.sh
```

## Prerequisites

- `make compose-up` (services running)
- `make migrate` (tables created)
- `./keys/epic-private-key.pem` present
- epic-api-service pointed at Epic sandbox (via override or env vars)
- Internet access to reach fhir.epic.com

## Known Epic Sandbox Test Patients

From Epic's open FHIR sandbox (erXuFYUfucBZaryVksYEcMg3 = Camila Lopez, confirmed in test-sandbox.ts). Additional IDs sourced from Epic's published test patient list.

## Error Handling

- SQL seed is idempotent (ON CONFLICT DO NOTHING)
- Snapshot creation uses Promise.allSettled per resource type (partial data is fine)
- Script reports per-patient success/failure
- Re-runnable: running `make seed-epic-data` twice is safe

## Decisions

- **Approach A (SQL + API) chosen** over TypeScript script (B) or GraphQL-only (C) for simplicity and code reuse
- **Known patient IDs** preferred over dynamic search for reliability
- **Make command** trigger preferred over auto-compose for explicitness
