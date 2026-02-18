# Expand Epic Sandbox Seed Data Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add more Epic sandbox test patients and AllergyIntolerance support so the dev environment shows rich, varied clinical data across the full provider dashboard.

**Architecture:** One-time discovery script finds data-rich patients from Epic's FHIR sandbox. Their IDs are hardcoded into the SQL seed. AllergyIntolerance is added as a 6th FHIR resource type through the full snapshot pipeline (FHIR client → transform → DB → GraphQL schema → resolver). The existing `seed-epic-snapshots.sh` automatically picks up new patients.

**Tech Stack:** TypeScript 5, PostgreSQL 15, Epic FHIR R4, Apollo Server 4, bash/curl

---

### Task 1: Discovery Script — Find Data-Rich Epic Sandbox Patients

**Files:**
- Create: `shared/data-layer/seed/discover-epic-patients.sh`

This script authenticates with Epic's sandbox and enumerates test patients with their data richness. It's run once manually; the output informs which patients to hardcode.

**Step 1: Create the discovery script**

```bash
#!/bin/bash
# discover-epic-patients.sh
#
# One-time script to discover data-rich patients in Epic's FHIR sandbox.
# Authenticates via RS384 JWT, searches patients, probes each for data richness.
#
# Usage: ./discover-epic-patients.sh
# Prerequisites: keys/epic-private-key.pem, jq, openssl, curl

set -euo pipefail

EPIC_BASE_URL="https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"
EPIC_TOKEN_URL="https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"
EPIC_CLIENT_ID="b071ea66-9918-43f2-ae82-9a67a322ca36"
PRIVATE_KEY_PATH="./keys/epic-private-key.pem"
KID="prism-clinical-sandbox"

# ---- JWT creation ----
create_jwt() {
  local now
  now=$(date +%s)
  local exp=$((now + 300))
  local jti
  jti=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || openssl rand -hex 16)

  local header
  header=$(echo -n '{"alg":"RS384","typ":"JWT","kid":"'"$KID"'"}' | openssl base64 -e | tr -d '\n=' | tr '+/' '-_')
  local payload
  payload=$(echo -n '{"iss":"'"$EPIC_CLIENT_ID"'","sub":"'"$EPIC_CLIENT_ID"'","aud":"'"$EPIC_TOKEN_URL"'","jti":"'"$jti"'","iat":'"$now"',"exp":'"$exp"'}' | openssl base64 -e | tr -d '\n=' | tr '+/' '-_')

  local signature
  signature=$(echo -n "${header}.${payload}" | openssl dgst -sha384 -sign "$PRIVATE_KEY_PATH" | openssl base64 -e | tr -d '\n=' | tr '+/' '-_')

  echo "${header}.${payload}.${signature}"
}

# ---- Get access token ----
echo "Authenticating with Epic sandbox..." >&2
JWT=$(create_jwt)
TOKEN_RESPONSE=$(curl -s -X POST "$EPIC_TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer&client_assertion=$JWT&scope=system/Patient.rs%20system/Observation.rs%20system/MedicationRequest.rs%20system/Condition.rs%20system/AllergyIntolerance.rs")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')
if [ "$ACCESS_TOKEN" = "null" ] || [ -z "$ACCESS_TOKEN" ]; then
  echo "ERROR: Failed to get access token" >&2
  echo "$TOKEN_RESPONSE" >&2
  exit 1
fi
echo "Authenticated." >&2

# ---- Helper: count resources ----
count_resources() {
  local resource_type="$1"
  local patient_id="$2"
  local params="$3"
  local url="${EPIC_BASE_URL}/${resource_type}?patient=${patient_id}&_summary=count${params:+&$params}"
  local result
  result=$(curl -s "$url" -H "Authorization: Bearer $ACCESS_TOKEN" -H "Accept: application/fhir+json" 2>/dev/null)
  echo "$result" | jq -r '.total // 0' 2>/dev/null || echo "0"
}

# ---- Known Epic sandbox patient IDs to probe ----
# These are published/commonly known test patient IDs from Epic's open FHIR sandbox.
KNOWN_IDS=(
  "erXuFYUfucBZaryVksYEcMg3"     # Camila Lopez (confirmed)
  "eq081-VQEgP8drUUqCWzHfw3"     # Derrick Lin
  "TgnR.yiGmEKkry0K5Rnj4kgB"    # Jason Argonaut
  "E.mdSPRJbJjIVlKsbgrzumA3"    # Hypertension patient
  "ePMCsQh8bjaW.vRBqNMQUiQ3"    # Diabetes patient
  "efVCgwJRKFIjBkCjwHSKCaw3"    # Pediatric patient
  "egqBHVfQlt4Bw3XGXoxVxHg3"    # Medications patient
  "eIRlnut.3hfDGZL-E6ZGzMg3"    # Lab results patient
  "eAB3mDIBBcyUKviyzPxAGHw3"    # General test
  "e63wRTbPfr1p8UW81d8Seiw3"    # Female test
  "eREmjenzCtYfaFQPRk0h6Rg3"    # Conditions patient
  "ehS.ylMR9x0YFMJxGMiMPQ3"    # Allergy patient
  "e.Rxfb0Vxqn5IDrZABN1.1Q3"   # Complex care
)

# Also try Patient search to discover additional patients
echo "Searching for additional patients..." >&2
SEARCH_RESULT=$(curl -s "${EPIC_BASE_URL}/Patient?_count=20" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/fhir+json" 2>/dev/null)

SEARCH_IDS=$(echo "$SEARCH_RESULT" | jq -r '.entry[]?.resource.id // empty' 2>/dev/null)
for sid in $SEARCH_IDS; do
  found=0
  for kid in "${KNOWN_IDS[@]}"; do
    if [ "$kid" = "$sid" ]; then found=1; break; fi
  done
  if [ "$found" -eq 0 ]; then
    KNOWN_IDS+=("$sid")
  fi
done

echo "" >&2
echo "Probing ${#KNOWN_IDS[@]} patients for data richness..." >&2
echo "" >&2

# ---- Probe each patient ----
printf "%-45s %-20s %-10s %-10s %-10s %-10s %-10s %-10s\n" "EPIC_PATIENT_ID" "NAME" "VITALS" "LABS" "MEDS" "COND" "ALLERGY" "TOTAL"
printf "%-45s %-20s %-10s %-10s %-10s %-10s %-10s %-10s\n" "----" "----" "----" "----" "----" "----" "----" "----"

for pid in "${KNOWN_IDS[@]}"; do
  # Get patient name
  patient_json=$(curl -s "${EPIC_BASE_URL}/Patient/${pid}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Accept: application/fhir+json" 2>/dev/null)

  # Check for error
  resource_type=$(echo "$patient_json" | jq -r '.resourceType // "error"' 2>/dev/null)
  if [ "$resource_type" = "OperationOutcome" ] || [ "$resource_type" = "error" ]; then
    printf "%-45s %-20s %s\n" "$pid" "NOT FOUND" "skipped"
    continue
  fi

  first_name=$(echo "$patient_json" | jq -r '(.name[0].given[0] // "?")' 2>/dev/null)
  last_name=$(echo "$patient_json" | jq -r '(.name[0].family // "?")' 2>/dev/null)
  dob=$(echo "$patient_json" | jq -r '(.birthDate // "?")' 2>/dev/null)
  gender=$(echo "$patient_json" | jq -r '(.gender // "?")' 2>/dev/null)
  name="${first_name} ${last_name}"

  # Count resources
  vitals=$(count_resources "Observation" "$pid" "category=vital-signs")
  labs=$(count_resources "Observation" "$pid" "category=laboratory")
  meds=$(count_resources "MedicationRequest" "$pid" "")
  conds=$(count_resources "Condition" "$pid" "")
  allergies=$(count_resources "AllergyIntolerance" "$pid" "")
  total=$((vitals + labs + meds + conds + allergies))

  printf "%-45s %-20s %-10s %-10s %-10s %-10s %-10s %-10s\n" "$pid" "$name" "$vitals" "$labs" "$meds" "$conds" "$allergies" "$total"

  # Output SQL-ready line to stderr for easy copy
  echo "-- SQL: ('$first_name','$last_name','$dob','$gender','$pid') total=$total" >&2
done

echo "" >&2
echo "Done. Pick patients with highest TOTAL for the seed script." >&2
```

**Step 2: Make it executable and run it**

```bash
chmod +x shared/data-layer/seed/discover-epic-patients.sh
./shared/data-layer/seed/discover-epic-patients.sh
```

Expected: Table of patient IDs with resource counts. Pick the 8-10 with the most data.

**Step 3: Commit**

```bash
git add shared/data-layer/seed/discover-epic-patients.sh
git commit -m "feat: add Epic sandbox patient discovery script"
```

---

### Task 2: Expand SQL Seed with Discovered Patients

**Files:**
- Modify: `shared/data-layer/seed/epic-sandbox-patients.sql`

**Step 1: Update the seed script with discovered patients**

After running the discovery script, update the SQL file with the top 8-10 patients. Keep the existing Camila Lopez entry and add new ones following the same pattern.

Add patients after the existing Camila Lopez INSERT (before COMMIT), one block per patient:

```sql
-- ---------------------------------------------------------------------------
-- Patient: [Name] (Epic sandbox)
-- ---------------------------------------------------------------------------
INSERT INTO patients (
    id,
    first_name,
    last_name,
    date_of_birth,
    gender,
    medical_record_number,
    epic_patient_id
) VALUES (
    '00000000-0000-4000-b000-00000000000N',  -- increment N for each
    'FirstName',
    'LastName',
    'YYYY-MM-DD',
    'gender',
    'EPIC-SEED-00N',
    'epic-fhir-id-from-discovery'
) ON CONFLICT (medical_record_number) DO NOTHING;
```

Use deterministic UUIDs (`00000000-0000-4000-b000-000000000002` through `000...00010`).
Use sequential MRNs (`EPIC-SEED-002` through `EPIC-SEED-010`).
Get first_name, last_name, date_of_birth, gender from the Patient FHIR resource.

**Step 2: Test the seed script is valid SQL**

```bash
# Dry run — parse only, don't execute
docker compose exec -T postgres psql -U postgres -d healthcare_federation -c "\i /dev/stdin" < shared/data-layer/seed/epic-sandbox-patients.sql
```

Expected: INSERT statements succeed or "DO NOTHING" for existing rows.

**Step 3: Commit**

```bash
git add shared/data-layer/seed/epic-sandbox-patients.sql
git commit -m "feat: expand Epic sandbox seed to 8-10 test patients"
```

---

### Task 3: Add AllergyIntolerance FHIR Type and Client Method

**Files:**
- Modify: `apps/epic-api-service/src/clients/epic-fhir-client.ts`
- Modify: `apps/epic-api-service/src/clients/epic-auth-client.ts` (scope)

**Step 1: Add FHIRAllergyIntolerance type to epic-fhir-client.ts**

Add after the `FHIRMedication` interface (around line 280):

```typescript
// =============================================================================
// TYPES — FHIR AllergyIntolerance (R4)
// =============================================================================

export interface FHIRAllergyIntoleranceReaction {
  substance?: FHIRCodeableConcept;
  manifestation: FHIRCodeableConcept[];
  description?: string;
  onset?: string;
  severity?: string;  // mild | moderate | severe
  exposureRoute?: FHIRCodeableConcept;
  note?: FHIRAnnotation[];
}

export interface FHIRAllergyIntolerance {
  resourceType?: string;
  id?: string;
  clinicalStatus?: FHIRCodeableConcept;
  verificationStatus?: FHIRCodeableConcept;
  type?: string;        // allergy | intolerance
  category?: string[];  // food | medication | environment | biologic
  criticality?: string; // low | high | unable-to-assess
  code?: FHIRCodeableConcept;
  patient?: FHIRReference;
  encounter?: FHIRReference;
  onsetDateTime?: string;
  onsetAge?: { value: number; unit: string };
  onsetString?: string;
  recordedDate?: string;
  recorder?: FHIRReference;
  asserter?: FHIRReference;
  lastOccurrence?: string;
  note?: FHIRAnnotation[];
  reaction?: FHIRAllergyIntoleranceReaction[];
}
```

**Step 2: Add `getAllergyIntolerances` method to EpicFhirClient class**

Add after the `getConditions` method (around line 368):

```typescript
  async getAllergyIntolerances(
    patientId: string,
    requestId?: string
  ): Promise<AxiosResponse<FHIRBundle<FHIRAllergyIntolerance>>> {
    return this.get(`AllergyIntolerance`, { patient: patientId }, requestId);
  }
```

**Step 3: Update OAuth scope in epic-auth-client.ts**

In `epic-auth-client.ts` line 113, add `system/AllergyIntolerance.rs` to the default scope:

Change:
```typescript
        "system/Patient.rs system/Observation.rs system/MedicationRequest.rs system/Condition.rs",
```
To:
```typescript
        "system/Patient.rs system/Observation.rs system/MedicationRequest.rs system/Condition.rs system/AllergyIntolerance.rs",
```

Also update the same scope string in `test-sandbox.ts` line 20.

**Step 4: Commit**

```bash
git add apps/epic-api-service/src/clients/epic-fhir-client.ts apps/epic-api-service/src/clients/epic-auth-client.ts apps/epic-api-service/test-sandbox.ts
git commit -m "feat: add AllergyIntolerance FHIR type and client method"
```

---

### Task 4: Add AllergyIntolerance Transform

**Files:**
- Modify: `apps/epic-api-service/src/services/transforms.ts`

**Step 1: Add AllergyOut output types**

Add after the `DiagnosisOut` interface and its related types (around line 273):

```typescript
// =============================================================================
// Allergy Output Types
// =============================================================================

export interface AllergyReactionOut {
  substance: CodeableConceptOut | null;
  manifestations: CodeableConceptOut[];
  description: string | null;
  onset: string | null;
  severity: string | null;
  exposureRoute: CodeableConceptOut | null;
}

export interface AllergyOut {
  id: string | null;
  code: CodeableConceptOut | null;
  clinicalStatus: CodeableConceptOut | null;
  verificationStatus: CodeableConceptOut | null;
  type: string | null;
  categories: string[];
  criticality: string | null;
  onsetDateTime: string | null;
  onsetAge: number | null;
  onsetString: string | null;
  recordedDate: string | null;
  lastOccurrence: string | null;
  recorder: ReferenceInfo | null;
  asserter: ReferenceInfo | null;
  encounter: ReferenceInfo | null;
  reactions: AllergyReactionOut[];
  notes: string[];
}
```

**Step 2: Add `transformAllergyIntolerances` function**

Add at the end of the file, after `transformConditions`:

```typescript
// =============================================================================
// Transform: AllergyIntolerances
// =============================================================================

export function transformAllergyIntolerances(
  allergyIntolerances: FHIRAllergyIntolerance[]
): AllergyOut[] {
  return allergyIntolerances.map((ai) => ({
    id: ai.id || null,
    code: transformCodeableConcept(ai.code),
    clinicalStatus: transformCodeableConcept(ai.clinicalStatus),
    verificationStatus: transformCodeableConcept(ai.verificationStatus),
    type: ai.type || null,
    categories: ai.category || [],
    criticality: ai.criticality || null,
    onsetDateTime: ai.onsetDateTime || null,
    onsetAge: ai.onsetAge?.value ?? null,
    onsetString: ai.onsetString || null,
    recordedDate: ai.recordedDate || null,
    lastOccurrence: ai.lastOccurrence || null,
    recorder: transformReference(ai.recorder),
    asserter: transformReference(ai.asserter),
    encounter: transformReference(ai.encounter),
    reactions: (ai.reaction || []).map((r) => ({
      substance: transformCodeableConcept(r.substance),
      manifestations: transformCodeableConceptArray(r.manifestation),
      description: r.description || null,
      onset: r.onset || null,
      severity: r.severity || null,
      exposureRoute: transformCodeableConcept(r.exposureRoute),
    })),
    notes: (ai.note || []).map((n) => n.text),
  }));
}
```

Add the import for `FHIRAllergyIntolerance` at the top of the file alongside the other FHIR type imports:

```typescript
import type {
  FHIRPatient,
  FHIRMedicationRequest,
  FHIRCondition,
  FHIRMedication,
  FHIRAllergyIntolerance,
  FHIRCodeableConcept,
  FHIRReference,
  FHIRExtension,
  FHIRDosage,
  FHIRCoding,
} from "../clients/epic-fhir-client";
```

**Step 3: Commit**

```bash
git add apps/epic-api-service/src/services/transforms.ts
git commit -m "feat: add AllergyIntolerance transform"
```

---

### Task 5: Add snapshot_allergies Database Migration

**Files:**
- Create: `shared/data-layer/migrations/030_add_snapshot_allergies.sql`

**Step 1: Create the migration**

```sql
-- Migration: 030_add_snapshot_allergies.sql
-- Description: Add allergy data to clinical snapshots (AllergyIntolerance FHIR resource)

CREATE TABLE IF NOT EXISTS snapshot_allergies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL,
    allergy_intolerance_id VARCHAR(100),
    code JSONB,
    clinical_status JSONB,
    verification_status JSONB,
    type VARCHAR(20),
    categories TEXT[],
    criticality VARCHAR(30),
    onset_date_time VARCHAR(30),
    onset_age NUMERIC,
    onset_string TEXT,
    recorded_date VARCHAR(30),
    last_occurrence VARCHAR(30),
    recorder JSONB,
    asserter JSONB,
    encounter JSONB,
    reactions JSONB DEFAULT '[]',
    notes TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (snapshot_id) REFERENCES patient_clinical_snapshots(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_snapshot_allergies_snapshot
    ON snapshot_allergies(snapshot_id);

-- Immutability rules (matches pattern from 026_create_clinical_snapshots.sql)
CREATE OR REPLACE RULE snapshot_allergies_no_update AS
    ON UPDATE TO snapshot_allergies
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_allergies_no_delete AS
    ON DELETE TO snapshot_allergies
    DO INSTEAD NOTHING;

COMMENT ON TABLE snapshot_allergies IS 'Allergy/intolerance data from FHIR AllergyIntolerance resources, immutable snapshot child table.';
```

**Step 2: Run the migration**

```bash
make migrate
```

Expected: `030_add_snapshot_allergies` shows as "Applied".

**Step 3: Commit**

```bash
git add shared/data-layer/migrations/030_add_snapshot_allergies.sql
git commit -m "feat: add snapshot_allergies migration"
```

---

### Task 6: Wire Allergies into Snapshot Database Layer

**Files:**
- Modify: `apps/epic-api-service/src/services/database.ts`

**Step 1: Update SnapshotData and imports**

Add `AllergyOut` to the imports at the top:

```typescript
import type {
  PatientDemographicsOut,
  VitalOut,
  LabResultOut,
  MedicationOut,
  DiagnosisOut,
  AllergyOut,
} from "./transforms";
```

Add `allergies` to the `SnapshotData` interface:

```typescript
export interface SnapshotData {
  demographics: PatientDemographicsOut | null;
  vitals: VitalOut[];
  labs: LabResultOut[];
  medications: MedicationOut[];
  diagnoses: DiagnosisOut[];
  allergies: AllergyOut[];
}
```

Add `allergies` to `ClinicalSnapshotFull` (it extends `SnapshotData` so it inherits automatically — no change needed there).

Add `allergyCount` to `SnapshotSummary`:

```typescript
export interface SnapshotSummary {
  id: string;
  epicPatientId: string;
  snapshotVersion: number;
  triggerEvent: string;
  createdAt: string;
  vitalCount: number;
  labCount: number;
  medicationCount: number;
  diagnosisCount: number;
  allergyCount: number;
}
```

**Step 2: Add insertAllergiesBatch function**

Add after `insertConditionsBatch`:

```typescript
async function insertAllergiesBatch(
  client: PoolClient,
  snapshotId: string,
  allergies: AllergyOut[]
): Promise<void> {
  const columns = [
    "snapshot_id", "allergy_intolerance_id", "code", "clinical_status",
    "verification_status", "type", "categories", "criticality",
    "onset_date_time", "onset_age", "onset_string", "recorded_date",
    "last_occurrence", "recorder", "asserter", "encounter", "reactions", "notes",
  ];
  const rows = allergies.map((a) => [
    snapshotId, a.id, JSON.stringify(a.code), JSON.stringify(a.clinicalStatus),
    JSON.stringify(a.verificationStatus), a.type, a.categories, a.criticality,
    a.onsetDateTime, a.onsetAge, a.onsetString, a.recordedDate,
    a.lastOccurrence, JSON.stringify(a.recorder), JSON.stringify(a.asserter),
    JSON.stringify(a.encounter), JSON.stringify(a.reactions), a.notes,
  ]);
  const { text, values } = buildBatchInsert("snapshot_allergies", columns, rows);
  await client.query(text, values);
}
```

**Step 3: Call insertAllergiesBatch in createSnapshot**

In the `createSnapshot` function, add after the `insertConditionsBatch` call (around line 121):

```typescript
    if (data.allergies.length > 0) {
      await insertAllergiesBatch(client, snapshotId, data.allergies);
    }
```

Update the logger.info call to include allergyCount:

```typescript
    logger.info("Clinical snapshot created", {
      epicPatientId,
      snapshotId,
      snapshotVersion,
      triggerEvent,
      vitalCount: data.vitals.length,
      labCount: data.labs.length,
      medicationCount: data.medications.length,
      diagnosisCount: data.diagnoses.length,
      allergyCount: data.allergies.length,
    });
```

**Step 4: Update getSnapshotHistory to include allergyCount**

In the `getSnapshotHistory` function, add a subquery for allergy count alongside the existing subqueries:

```sql
       (SELECT COUNT(*) FROM snapshot_allergies a WHERE a.snapshot_id = s.id)::int AS allergy_count
```

And update the row mapping to include `allergyCount: row.allergy_count as number`.

**Step 5: Update loadSnapshotDetails to read allergies**

In `loadSnapshotDetails`, add a 6th query to the `Promise.all` array:

```typescript
      db.query(
        `SELECT allergy_intolerance_id, code, clinical_status, verification_status,
                type, categories, criticality, onset_date_time, onset_age,
                onset_string, recorded_date, last_occurrence, recorder,
                asserter, encounter, reactions, notes
         FROM snapshot_allergies WHERE snapshot_id = $1 ORDER BY allergy_intolerance_id`,
        [row.id]
      ),
```

Destructure it:

```typescript
  const [demoResult, vitalsResult, labsResult, medsResult, conditionsResult, allergiesResult] =
    await Promise.all([...]);
```

Add the allergies mapping to the return object:

```typescript
    allergies: allergiesResult.rows.map((r: Record<string, unknown>) => ({
      id: r.allergy_intolerance_id as string | null,
      code: r.code as AllergyOut["code"],
      clinicalStatus: r.clinical_status as AllergyOut["clinicalStatus"],
      verificationStatus: r.verification_status as AllergyOut["verificationStatus"],
      type: r.type as string | null,
      categories: (r.categories || []) as string[],
      criticality: r.criticality as string | null,
      onsetDateTime: r.onset_date_time as string | null,
      onsetAge: r.onset_age ? parseFloat(r.onset_age as string) : null,
      onsetString: r.onset_string as string | null,
      recordedDate: r.recorded_date as string | null,
      lastOccurrence: r.last_occurrence as string | null,
      recorder: r.recorder as AllergyOut["recorder"],
      asserter: r.asserter as AllergyOut["asserter"],
      encounter: r.encounter as AllergyOut["encounter"],
      reactions: (r.reactions || []) as AllergyOut["reactions"],
      notes: (r.notes || []) as string[],
    })),
```

**Step 6: Commit**

```bash
git add apps/epic-api-service/src/services/database.ts
git commit -m "feat: wire allergies into snapshot database layer"
```

---

### Task 7: Update GraphQL Schema and Resolvers for Allergies

**Files:**
- Modify: `apps/epic-api-service/src/index.ts`

**Step 1: Add Allergy GraphQL types to the schema**

Add after the Diagnosis types section (after `type ConditionEvidence`, around line 386):

```graphql
  # =========================================================================
  # Allergies / Intolerances
  # =========================================================================

  type AllergyReaction {
    substance: CodeableConcept
    manifestations: [CodeableConcept!]!
    description: String
    onset: String
    severity: String
    exposureRoute: CodeableConcept
  }

  type Allergy {
    id: String
    code: CodeableConcept
    clinicalStatus: CodeableConcept
    verificationStatus: CodeableConcept
    type: String
    categories: [String!]!
    criticality: String
    onsetDateTime: String
    onsetAge: Float
    onsetString: String
    recordedDate: String
    lastOccurrence: String
    recorder: ReferenceInfo
    asserter: ReferenceInfo
    encounter: ReferenceInfo
    reactions: [AllergyReaction!]!
    notes: [String!]!
  }
```

**Step 2: Add `allergies` field to ClinicalSnapshot, EpicPatientData, and SnapshotSummary**

In the `ClinicalSnapshot` type, add after `diagnoses`:
```graphql
    allergies: [Allergy!]!
```

In the `EpicPatientData` type, add after `diagnoses`:
```graphql
    allergies: [Allergy!]!
```

In the `SnapshotSummary` type, add after `diagnosisCount`:
```graphql
    allergyCount: Int!
```

Add `ALLERGIES` to the `EpicDataType` enum:
```graphql
  enum EpicDataType {
    DEMOGRAPHICS
    VITALS
    LABS
    MEDICATIONS
    DIAGNOSES
    ALLERGIES
  }
```

**Step 3: Update the `createClinicalSnapshot` resolver**

Add the AllergyIntolerance imports at the top of the file alongside the other transform imports:
```typescript
import { ..., AllergyOut, transformAllergyIntolerances } from "./services/transforms";
import type { FHIRAllergyIntolerance } from "./clients/epic-fhir-client";
```

In the `createClinicalSnapshot` resolver, add to the `Promise.allSettled` array (after `fhirClient.getConditions`):

```typescript
          fhirClient.getAllergyIntolerances(epicPatientId, requestId),
```

Destructure it:
```typescript
      const [patientResult, vitalsResult, labsResult, medsResult, conditionsResult, allergyResult] =
        await Promise.allSettled([...]);
```

Add allergy transform block after the conditions block:
```typescript
      // Transform allergies
      let allergies: AllergyOut[] = [];
      if (allergyResult.status === "fulfilled") {
        const allergyIntolerances =
          allergyResult.value.data.entry?.map((e) => e.resource) || [];
        allergies = transformAllergyIntolerances(allergyIntolerances);
      }
```

Update snapshotData:
```typescript
      const snapshotData: SnapshotData = {
        demographics,
        vitals,
        labs,
        medications,
        diagnoses,
        allergies,
      };
```

Add allergy cache update after the existing cache updates:
```typescript
      await setCached("allergies", epicPatientId, allergies);
```

**Step 4: Update the `epicPatientData` resolver**

Add allergy cache check to the initial cache-read block:
```typescript
      const [
        cachedDemographics,
        cachedVitals,
        cachedLabs,
        cachedMedications,
        cachedDiagnoses,
        cachedAllergies,
      ] = await Promise.all([
        getCached<PatientDemographicsOut>("patient", epicPatientId),
        getCached<VitalOut[]>("vitals", epicPatientId),
        getCached<LabResultOut[]>("labs", epicPatientId),
        getCached<MedicationOut[]>("medications", epicPatientId),
        getCached<DiagnosisOut[]>("conditions", epicPatientId),
        getCached<AllergyOut[]>("allergies", epicPatientId),
      ]);
```

Update the full-cache-hit check to include `cachedAllergies`.

Add allergy fetch to the `Promise.allSettled` block:
```typescript
          // Allergies
          cachedAllergies
            ? Promise.resolve(cachedAllergies)
            : (async (): Promise<AllergyOut[]> => {
                const result = await fhirClient.getAllergyIntolerances(epicPatientId, requestId);
                const allergyIntolerances = result.data.entry?.map((e) => e.resource) || [];
                const transformed = transformAllergyIntolerances(allergyIntolerances);
                await setCached("allergies", epicPatientId, transformed);
                return transformed;
              })(),
```

Destructure and handle the 6th result.

Update `dataTypeLabels` to include `"ALLERGIES"`.

Update the return object to include `allergies`.

**Step 5: Commit**

```bash
git add apps/epic-api-service/src/index.ts
git commit -m "feat: expose allergies in GraphQL schema and resolvers"
```

---

### Task 8: Test the Full Flow

**Step 1: Rebuild and re-run**

```bash
# Rebuild epic-api-service with the new code
docker compose up -d --build epic-api-service

# Run the migration to create snapshot_allergies table
make migrate

# Seed SQL (adds new patients)
make seed-epic-sql

# Create snapshots for all patients (now includes allergies)
make seed-epic-data
```

**Step 2: Verify patients were seeded**

```bash
echo '{"query":"{ patients { id firstName lastName epicPatientId } }"}' > /tmp/q.json
curl -s http://localhost:4000/graphql -H "Content-Type: application/json" -d @/tmp/q.json | jq .
```

Expected: 8-10 patients with `epicPatientId` set.

**Step 3: Verify snapshot with allergies**

```bash
echo '{"query":"{ latestSnapshot(epicPatientId: \"erXuFYUfucBZaryVksYEcMg3\") { id snapshotVersion vitals { type value unit } labs { code { text } status } medications { name status } diagnoses { display clinicalStatus { coding { display } } } allergies { code { coding { display } } clinicalStatus { coding { display } } criticality reactions { manifestations { coding { display } } severity } } } }"}' > /tmp/q.json
curl -s http://localhost:4006/graphql -H "Content-Type: application/json" -d @/tmp/q.json | jq .
```

Expected: Snapshot with vitals, labs, medications, diagnoses, AND allergies arrays.

**Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "feat: complete expanded Epic sandbox seed with allergies"
```
