# Encounter + Appointment FHIR Resource Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add FHIR Encounter and Appointment resources to the Epic pipeline, syncing them into the visits table so the dashboard, visit workflow, and care plan pipeline have real Epic data.

**Architecture:** Encounters and Appointments are fetched from Epic FHIR, transformed, and upserted into the existing `visits` table (not into snapshot_* tables). New columns on `visits` enable deduplication via `epic_encounter_id`/`epic_appointment_id`. The data also surfaces in `EpicPatientData` and `ClinicalSnapshot` GraphQL responses.

**Tech Stack:** TypeScript 5, PostgreSQL 15, Apollo Server 4, Redis 7, FHIR R4

---

### Task 1: Database Migration — Add Epic columns to visits table

**Files:**
- Create: `shared/data-layer/migrations/032_add_epic_encounter_columns.sql`

**Step 1: Write the migration SQL**

```sql
-- UP

-- Epic sync identifiers
ALTER TABLE visits ADD COLUMN IF NOT EXISTS epic_encounter_id VARCHAR(100);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS epic_appointment_id VARCHAR(100);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS epic_identifier VARCHAR(200);

-- Clinical context from FHIR
ALTER TABLE visits ADD COLUMN IF NOT EXISTS encounter_class VARCHAR(50);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS reason_codes JSONB;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS priority VARCHAR(20);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS location_display VARCHAR(500);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS participant_details JSONB;

-- Appointment-specific
ALTER TABLE visits ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS patient_instructions TEXT;

-- Sync tracking
ALTER TABLE visits ADD COLUMN IF NOT EXISTS epic_last_synced_at TIMESTAMP WITH TIME ZONE;

-- Unique indexes for deduplication (upsert ON CONFLICT targets)
CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_epic_encounter_id
  ON visits (epic_encounter_id) WHERE epic_encounter_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_epic_appointment_id
  ON visits (epic_appointment_id) WHERE epic_appointment_id IS NOT NULL;

-- DOWN
ALTER TABLE visits DROP COLUMN IF EXISTS epic_encounter_id;
ALTER TABLE visits DROP COLUMN IF EXISTS epic_appointment_id;
ALTER TABLE visits DROP COLUMN IF EXISTS epic_identifier;
ALTER TABLE visits DROP COLUMN IF EXISTS encounter_class;
ALTER TABLE visits DROP COLUMN IF EXISTS reason_codes;
ALTER TABLE visits DROP COLUMN IF EXISTS priority;
ALTER TABLE visits DROP COLUMN IF EXISTS location_display;
ALTER TABLE visits DROP COLUMN IF EXISTS participant_details;
ALTER TABLE visits DROP COLUMN IF EXISTS cancellation_reason;
ALTER TABLE visits DROP COLUMN IF EXISTS patient_instructions;
ALTER TABLE visits DROP COLUMN IF EXISTS epic_last_synced_at;

DROP INDEX IF EXISTS idx_visits_epic_encounter_id;
DROP INDEX IF EXISTS idx_visits_epic_appointment_id;
```

**Step 2: Run the migration**

Run: `cd /home/claude/workspace/prism-graphql && make migrate`
Expected: Migration 032 applied successfully.

**Step 3: Verify the columns exist**

Run: `cd /home/claude/workspace/prism-graphql && docker exec prism-postgres psql -U postgres -d healthcare_federation -c "\d visits" | grep -E "epic_|encounter_|reason_|priority|location_|participant_|cancellation_|patient_instructions"`
Expected: All 11 new columns listed.

**Step 4: Commit**

```bash
git add shared/data-layer/migrations/032_add_epic_encounter_columns.sql
git commit -m "feat: add Epic encounter/appointment columns to visits table (migration 032)"
```

---

### Task 2: FHIR Types — FHIREncounter and FHIRAppointment

**Files:**
- Modify: `apps/epic-api-service/src/clients/epic-fhir-client.ts` (insert after line 316, before line 318 "CLIENT IMPLEMENTATION")

**Step 1: Write failing test**

Create: `apps/epic-api-service/src/__tests__/fhir-types.test.ts`

```typescript
import type {
  FHIREncounter,
  FHIRAppointment,
} from "../clients/epic-fhir-client";

describe("FHIR Encounter type", () => {
  it("should represent a finished ambulatory encounter", () => {
    const encounter: FHIREncounter = {
      resourceType: "Encounter",
      id: "enc-123",
      status: "finished",
      class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
      type: [{ coding: [{ system: "http://snomed.info/sct", code: "185349003", display: "Encounter for check up" }], text: "Annual Physical" }],
      subject: { reference: "Patient/abc", display: "Test Patient" },
      period: { start: "2026-01-15T09:00:00Z", end: "2026-01-15T10:00:00Z" },
      participant: [{ individual: { display: "Dr. Smith" } }],
      reasonCode: [{ coding: [{ code: "Z00.00", display: "General adult medical examination" }], text: "Annual checkup" }],
      identifier: [{ system: "urn:oid:1.2.840.114350", value: "VN12345" }],
      priority: { coding: [{ code: "R", display: "routine" }] },
      location: [{ location: { display: "Room 204, Building A" } }],
    };
    expect(encounter.id).toBe("enc-123");
    expect(encounter.status).toBe("finished");
    expect(encounter.class.code).toBe("AMB");
  });
});

describe("FHIR Appointment type", () => {
  it("should represent a booked appointment", () => {
    const appointment: FHIRAppointment = {
      resourceType: "Appointment",
      id: "apt-456",
      status: "booked",
      serviceType: [{ coding: [{ code: "394802001", display: "General medicine" }], text: "General Medicine" }],
      start: "2026-03-01T14:00:00Z",
      end: "2026-03-01T14:30:00Z",
      participant: [
        { actor: { reference: "Patient/abc", display: "Test Patient" }, status: "accepted" },
        { actor: { reference: "Practitioner/doc1", display: "Dr. Smith" }, status: "accepted" },
      ],
      reasonCode: [{ text: "Follow-up visit" }],
      description: "Follow-up for diabetes management",
      cancelationReason: undefined,
      patientInstruction: "Please fast for 8 hours before appointment",
      identifier: [{ system: "urn:oid:1.2.840.114350", value: "APT-789" }],
      priority: 0,
    };
    expect(appointment.id).toBe("apt-456");
    expect(appointment.status).toBe("booked");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/fhir-types.test.ts --no-coverage`
Expected: FAIL — `FHIREncounter` and `FHIRAppointment` are not exported.

**Step 3: Add the FHIR types**

Modify: `apps/epic-api-service/src/clients/epic-fhir-client.ts`

Insert after line 316 (after the closing `}` of `FHIRAllergyIntolerance`), before line 318 (`// CLIENT IMPLEMENTATION`):

```typescript

// =============================================================================
// TYPES — FHIR Encounter (R4)
// =============================================================================

export interface FHIREncounterLocation {
  location: FHIRReference;
  status?: string;
  period?: FHIRPeriod;
}

export interface FHIREncounterParticipant {
  type?: FHIRCodeableConcept[];
  period?: FHIRPeriod;
  individual?: FHIRReference;
}

export interface FHIREncounter {
  resourceType?: string;
  id?: string;
  identifier?: FHIRIdentifier[];
  status: string;
  class: FHIRCoding;
  type?: FHIRCodeableConcept[];
  priority?: FHIRCodeableConcept;
  subject?: FHIRReference;
  participant?: FHIREncounterParticipant[];
  period?: FHIRPeriod;
  reasonCode?: FHIRCodeableConcept[];
  location?: FHIREncounterLocation[];
  serviceProvider?: FHIRReference;
}

// =============================================================================
// TYPES — FHIR Appointment (R4)
// =============================================================================

export interface FHIRAppointmentParticipant {
  actor?: FHIRReference;
  status: string;
  type?: FHIRCodeableConcept[];
}

export interface FHIRAppointment {
  resourceType?: string;
  id?: string;
  identifier?: FHIRIdentifier[];
  status: string;
  serviceType?: FHIRCodeableConcept[];
  start?: string;
  end?: string;
  participant?: FHIRAppointmentParticipant[];
  reasonCode?: FHIRCodeableConcept[];
  description?: string;
  cancelationReason?: FHIRCodeableConcept;
  patientInstruction?: string;
  priority?: number;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/fhir-types.test.ts --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/epic-api-service/src/clients/epic-fhir-client.ts apps/epic-api-service/src/__tests__/fhir-types.test.ts
git commit -m "feat: add FHIREncounter and FHIRAppointment types to FHIR client"
```

---

### Task 3: FHIR Client Methods — getEncounters() and getAppointments()

**Files:**
- Modify: `apps/epic-api-service/src/clients/epic-fhir-client.ts` (add methods after `getAllergyIntolerances` at line 411)

**Step 1: Write failing test**

Create: `apps/epic-api-service/src/__tests__/fhir-client-encounters.test.ts`

```typescript
import { EpicFhirClient } from "../clients/epic-fhir-client";
import type { FHIREncounter, FHIRAppointment, FHIRBundle } from "../clients/epic-fhir-client";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("EpicFhirClient encounter/appointment methods", () => {
  let client: EpicFhirClient;

  beforeEach(() => {
    client = new EpicFhirClient({ baseUrl: "http://mock:8080", authEnabled: false });
  });

  it("getEncounters fetches encounters for a patient", async () => {
    const mockBundle: FHIRBundle<FHIREncounter> = {
      resourceType: "Bundle",
      type: "searchset",
      total: 1,
      entry: [{
        resource: {
          resourceType: "Encounter",
          id: "enc-1",
          status: "finished",
          class: { code: "AMB", display: "ambulatory" },
        },
      }],
    };
    mockedAxios.create.mockReturnThis();
    mockedAxios.get.mockResolvedValue({ data: mockBundle, status: 200, statusText: "OK", headers: {}, config: {} as any });

    const result = await client.getEncounters("patient-123");
    expect(result.data.entry).toHaveLength(1);
    expect(result.data.entry![0].resource.status).toBe("finished");
  });

  it("getAppointments fetches appointments for a patient", async () => {
    const mockBundle: FHIRBundle<FHIRAppointment> = {
      resourceType: "Bundle",
      type: "searchset",
      total: 1,
      entry: [{
        resource: {
          resourceType: "Appointment",
          id: "apt-1",
          status: "booked",
          participant: [{ actor: { reference: "Patient/patient-123" }, status: "accepted" }],
        },
      }],
    };
    mockedAxios.get.mockResolvedValue({ data: mockBundle, status: 200, statusText: "OK", headers: {}, config: {} as any });

    const result = await client.getAppointments("patient-123");
    expect(result.data.entry).toHaveLength(1);
    expect(result.data.entry![0].resource.status).toBe("booked");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/fhir-client-encounters.test.ts --no-coverage`
Expected: FAIL — `getEncounters` and `getAppointments` methods don't exist.

**Step 3: Add the client methods**

Modify: `apps/epic-api-service/src/clients/epic-fhir-client.ts`

Insert after the `getAllergyIntolerances` method (after line 411), before `getLabObservations`:

```typescript

  async getEncounters(
    patientId: string,
    requestId?: string
  ): Promise<AxiosResponse<FHIRBundle<FHIREncounter>>> {
    return this.get(`Encounter`, { patient: patientId }, requestId);
  }

  async getAppointments(
    patientId: string,
    requestId?: string
  ): Promise<AxiosResponse<FHIRBundle<FHIRAppointment>>> {
    return this.get(`Appointment`, { patient: patientId }, requestId);
  }
```

**Step 4: Run test to verify it passes**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/fhir-client-encounters.test.ts --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/epic-api-service/src/clients/epic-fhir-client.ts apps/epic-api-service/src/__tests__/fhir-client-encounters.test.ts
git commit -m "feat: add getEncounters and getAppointments methods to FHIR client"
```

---

### Task 4: Auth Scope — Add Encounter.rs and Appointment.rs

**Files:**
- Modify: `apps/epic-api-service/src/clients/epic-auth-client.ts` (line 113)

**Step 1: Update the default scope string**

Modify line 113 in `apps/epic-api-service/src/clients/epic-auth-client.ts`:

Old:
```typescript
        "system/Patient.rs system/Observation.rs system/MedicationRequest.rs system/Condition.rs system/AllergyIntolerance.rs",
```

New:
```typescript
        "system/Patient.rs system/Observation.rs system/MedicationRequest.rs system/Condition.rs system/AllergyIntolerance.rs system/Encounter.rs system/Appointment.rs",
```

**Step 2: Verify build passes**

Run: `cd /home/claude/workspace/prism-graphql && npx tsc --noEmit -p apps/epic-api-service/tsconfig.json 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/epic-api-service/src/clients/epic-auth-client.ts
git commit -m "feat: add Encounter.rs and Appointment.rs to Epic OAuth scope"
```

---

### Task 5: Output Types and Transformers — transformEncounters() and transformAppointments()

**Files:**
- Modify: `apps/epic-api-service/src/services/transforms.ts` (add after line 794)

**Step 1: Write failing test**

Create: `apps/epic-api-service/src/__tests__/transforms-encounters.test.ts`

```typescript
import { transformEncounters, transformAppointments } from "../services/transforms";
import type { FHIREncounter, FHIRAppointment } from "../clients/epic-fhir-client";

describe("transformEncounters", () => {
  it("transforms a finished ambulatory encounter", () => {
    const encounters: FHIREncounter[] = [{
      id: "enc-1",
      status: "finished",
      class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
      type: [{ coding: [{ code: "185349003", display: "Encounter for check up" }], text: "Annual Physical" }],
      subject: { reference: "Patient/abc" },
      period: { start: "2026-01-15T09:00:00Z", end: "2026-01-15T10:00:00Z" },
      participant: [{ individual: { display: "Dr. Smith" } }],
      reasonCode: [{ coding: [{ code: "Z00.00" }], text: "Annual checkup" }],
      identifier: [{ system: "urn:oid:1.2.840.114350", value: "VN12345" }],
      priority: { coding: [{ code: "R", display: "routine" }] },
      location: [{ location: { display: "Room 204" } }],
    }];

    const result = transformEncounters(encounters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("enc-1");
    expect(result[0].status).toBe("finished");
    expect(result[0].encounterClass).toBe("AMB");
    expect(result[0].typeDisplay).toBe("Annual Physical");
    expect(result[0].periodStart).toBe("2026-01-15T09:00:00Z");
    expect(result[0].periodEnd).toBe("2026-01-15T10:00:00Z");
    expect(result[0].reasonCodes).toHaveLength(1);
    expect(result[0].reasonCodes[0].text).toBe("Annual checkup");
    expect(result[0].locationDisplay).toBe("Room 204");
    expect(result[0].epicIdentifier).toBe("VN12345");
    expect(result[0].priorityDisplay).toBe("routine");
  });

  it("handles encounters with missing optional fields", () => {
    const encounters: FHIREncounter[] = [{
      status: "planned",
      class: { code: "AMB" },
    }];

    const result = transformEncounters(encounters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBeNull();
    expect(result[0].status).toBe("planned");
    expect(result[0].encounterClass).toBe("AMB");
    expect(result[0].typeDisplay).toBeNull();
    expect(result[0].periodStart).toBeNull();
    expect(result[0].locationDisplay).toBeNull();
    expect(result[0].epicIdentifier).toBeNull();
  });
});

describe("transformAppointments", () => {
  it("transforms a booked appointment", () => {
    const appointments: FHIRAppointment[] = [{
      id: "apt-1",
      status: "booked",
      serviceType: [{ coding: [{ display: "General Medicine" }], text: "General Medicine" }],
      start: "2026-03-01T14:00:00Z",
      end: "2026-03-01T14:30:00Z",
      participant: [
        { actor: { reference: "Patient/abc", display: "Test Patient" }, status: "accepted" },
        { actor: { reference: "Practitioner/doc1", display: "Dr. Smith" }, status: "accepted" },
      ],
      reasonCode: [{ text: "Follow-up visit" }],
      description: "Follow-up for diabetes management",
      patientInstruction: "Fast for 8 hours",
      identifier: [{ system: "urn:oid:1.2.840.114350", value: "APT-789" }],
      priority: 0,
    }];

    const result = transformAppointments(appointments);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("apt-1");
    expect(result[0].status).toBe("booked");
    expect(result[0].serviceTypeDisplay).toBe("General Medicine");
    expect(result[0].start).toBe("2026-03-01T14:00:00Z");
    expect(result[0].end).toBe("2026-03-01T14:30:00Z");
    expect(result[0].description).toBe("Follow-up for diabetes management");
    expect(result[0].patientInstruction).toBe("Fast for 8 hours");
    expect(result[0].epicIdentifier).toBe("APT-789");
  });

  it("handles appointments with cancelation reason", () => {
    const appointments: FHIRAppointment[] = [{
      id: "apt-2",
      status: "cancelled",
      cancelationReason: { coding: [{ display: "Patient request" }], text: "Patient requested cancellation" },
      participant: [{ actor: { reference: "Patient/abc" }, status: "declined" }],
    }];

    const result = transformAppointments(appointments);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("cancelled");
    expect(result[0].cancellationReason).toBe("Patient requested cancellation");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/transforms-encounters.test.ts --no-coverage`
Expected: FAIL — `transformEncounters` and `transformAppointments` are not exported.

**Step 3: Add output types and transformer functions**

Modify: `apps/epic-api-service/src/services/transforms.ts`

Insert after line 303 (after `AllergyOut` type, before the helper functions section):

```typescript

// =============================================================================
// Output: Encounter
// =============================================================================

export interface EncounterOut {
  id: string | null;
  status: string;
  encounterClass: string;
  classDisplay: string | null;
  typeDisplay: string | null;
  typeCoding: CodeableConceptOut | null;
  periodStart: string | null;
  periodEnd: string | null;
  reasonCodes: CodeableConceptOut[];
  participants: { role: CodeableConceptOut | null; individual: ReferenceInfo | null }[];
  locationDisplay: string | null;
  serviceProvider: ReferenceInfo | null;
  epicIdentifier: string | null;
  priorityDisplay: string | null;
}

// =============================================================================
// Output: Appointment
// =============================================================================

export interface AppointmentOut {
  id: string | null;
  status: string;
  serviceTypeDisplay: string | null;
  serviceTypeCoding: CodeableConceptOut | null;
  start: string | null;
  end: string | null;
  reasonCodes: CodeableConceptOut[];
  participants: { actor: ReferenceInfo | null; status: string }[];
  description: string | null;
  cancellationReason: string | null;
  patientInstruction: string | null;
  epicIdentifier: string | null;
  priority: number | null;
}
```

Then insert after line 794 (after `transformAllergyIntolerances` function, at end of file):

```typescript

// =============================================================================
// Transform: Encounters
// =============================================================================

export function transformEncounters(
  encounters: FHIREncounter[]
): EncounterOut[] {
  return encounters.map((enc) => ({
    id: enc.id || null,
    status: enc.status,
    encounterClass: enc.class?.code || "unknown",
    classDisplay: enc.class?.display || null,
    typeDisplay: enc.type?.[0]?.text || enc.type?.[0]?.coding?.[0]?.display || null,
    typeCoding: enc.type?.[0] ? transformCodeableConcept(enc.type[0]) : null,
    periodStart: enc.period?.start || null,
    periodEnd: enc.period?.end || null,
    reasonCodes: transformCodeableConceptArray(enc.reasonCode || []),
    participants: (enc.participant || []).map((p) => ({
      role: p.type?.[0] ? transformCodeableConcept(p.type[0]) : null,
      individual: transformReference(p.individual),
    })),
    locationDisplay: enc.location?.[0]?.location?.display || null,
    serviceProvider: transformReference(enc.serviceProvider),
    epicIdentifier: enc.identifier?.[0]?.value || null,
    priorityDisplay: enc.priority?.coding?.[0]?.display || null,
  }));
}

// =============================================================================
// Transform: Appointments
// =============================================================================

export function transformAppointments(
  appointments: FHIRAppointment[]
): AppointmentOut[] {
  return appointments.map((apt) => ({
    id: apt.id || null,
    status: apt.status,
    serviceTypeDisplay: apt.serviceType?.[0]?.text || apt.serviceType?.[0]?.coding?.[0]?.display || null,
    serviceTypeCoding: apt.serviceType?.[0] ? transformCodeableConcept(apt.serviceType[0]) : null,
    start: apt.start || null,
    end: apt.end || null,
    reasonCodes: transformCodeableConceptArray(apt.reasonCode || []),
    participants: (apt.participant || []).map((p) => ({
      actor: transformReference(p.actor),
      status: p.status,
    })),
    description: apt.description || null,
    cancellationReason: apt.cancelationReason?.text || apt.cancelationReason?.coding?.[0]?.display || null,
    patientInstruction: apt.patientInstruction || null,
    epicIdentifier: apt.identifier?.[0]?.value || null,
    priority: apt.priority ?? null,
  }));
}
```

Also add the import at the top of `transforms.ts` (ensure `FHIREncounter` and `FHIRAppointment` are imported from the FHIR client):

```typescript
import type { FHIREncounter, FHIRAppointment } from "../clients/epic-fhir-client";
```

**Step 4: Run test to verify it passes**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/transforms-encounters.test.ts --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/epic-api-service/src/services/transforms.ts apps/epic-api-service/src/__tests__/transforms-encounters.test.ts
git commit -m "feat: add EncounterOut/AppointmentOut types and transform functions"
```

---

### Task 6: Cache Layer — Add ENCOUNTERS and APPOINTMENTS TTLs

**Files:**
- Modify: `apps/epic-api-service/src/services/cache.ts`

**Step 1: Update CACHE_TTL, CacheResource type, and invalidation**

In `apps/epic-api-service/src/services/cache.ts`:

1. Add to `CACHE_TTL` object (line 27-35):
```typescript
export const CACHE_TTL = {
  PATIENT: 600,
  VITALS: 300,
  LABS: 300,
  MEDICATIONS: 600,
  CONDITIONS: 600,
  ALLERGIES: 600,
  ENCOUNTERS: 300,      // 5 minutes — encounter status can change
  APPOINTMENTS: 300,    // 5 minutes — appointments can be rescheduled
  MEDICATION_REF: 3600,
} as const;
```

2. Update `CacheResource` type (line 37-43):
```typescript
export type CacheResource =
  | "patient"
  | "vitals"
  | "labs"
  | "medications"
  | "conditions"
  | "allergies"
  | "encounters"
  | "appointments";
```

3. Update `setCached` TTL map (line 84-91):
```typescript
    const ttlMap: Record<CacheResource, number> = {
      patient: CACHE_TTL.PATIENT,
      vitals: CACHE_TTL.VITALS,
      labs: CACHE_TTL.LABS,
      medications: CACHE_TTL.MEDICATIONS,
      conditions: CACHE_TTL.CONDITIONS,
      allergies: CACHE_TTL.ALLERGIES,
      encounters: CACHE_TTL.ENCOUNTERS,
      appointments: CACHE_TTL.APPOINTMENTS,
    };
```

4. Update `invalidatePatientCache` resources array (line 107-114):
```typescript
  const resources: CacheResource[] = [
    "patient",
    "vitals",
    "labs",
    "medications",
    "conditions",
    "allergies",
    "encounters",
    "appointments",
  ];
```

**Step 2: Verify build passes**

Run: `cd /home/claude/workspace/prism-graphql && npx tsc --noEmit -p apps/epic-api-service/tsconfig.json 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/epic-api-service/src/services/cache.ts
git commit -m "feat: add encounters and appointments to cache layer"
```

---

### Task 7: Database Sync — syncEncountersToVisits() and syncAppointmentsToVisits()

**Files:**
- Modify: `apps/epic-api-service/src/services/database.ts`

These functions upsert FHIR encounter/appointment data into the visits table. They need a `patientId` (local UUID) and `providerId`/`hospitalId` to fill required columns on visits.

**Step 1: Write failing test**

Create: `apps/epic-api-service/src/__tests__/database-sync-encounters.test.ts`

```typescript
import { syncEncountersToVisits, syncAppointmentsToVisits } from "../services/database";
import type { EncounterOut, AppointmentOut } from "../services/transforms";

// These tests validate the SQL generation logic. Integration tests
// against a real DB should run separately.
describe("syncEncountersToVisits", () => {
  it("should be an exported async function", () => {
    expect(typeof syncEncountersToVisits).toBe("function");
  });
});

describe("syncAppointmentsToVisits", () => {
  it("should be an exported async function", () => {
    expect(typeof syncAppointmentsToVisits).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/database-sync-encounters.test.ts --no-coverage`
Expected: FAIL — `syncEncountersToVisits` is not exported.

**Step 3: Add sync functions**

Modify: `apps/epic-api-service/src/services/database.ts`

First, add the import for the new output types near the top imports:

```typescript
import type { EncounterOut, AppointmentOut } from "./transforms";
```

Then add the following functions at the end of the file (before any export statements):

```typescript
// =============================================================================
// Encounter/Appointment → Visits Sync
// =============================================================================

const ENCOUNTER_STATUS_MAP: Record<string, string> = {
  planned: "SCHEDULED",
  arrived: "CHECKED_IN",
  "in-progress": "IN_PROGRESS",
  finished: "COMPLETED",
  cancelled: "CANCELLED",
  onleave: "IN_PROGRESS",
  "entered-in-error": "CANCELLED",
  unknown: "SCHEDULED",
};

const ENCOUNTER_TYPE_MAP: Record<string, string> = {
  "encounter for check up": "ROUTINE_CHECK",
  "annual physical": "ROUTINE_CHECK",
  "follow up": "FOLLOW_UP",
  "follow-up": "FOLLOW_UP",
  consultation: "CONSULTATION",
  emergency: "EMERGENCY",
  procedure: "PROCEDURE",
  surgery: "SURGERY",
  diagnostic: "DIAGNOSTIC",
  therapy: "THERAPY",
};

function mapEncounterType(typeDisplay: string | null): string {
  if (!typeDisplay) return "CONSULTATION";
  const key = typeDisplay.toLowerCase();
  for (const [pattern, visitType] of Object.entries(ENCOUNTER_TYPE_MAP)) {
    if (key.includes(pattern)) return visitType;
  }
  return "CONSULTATION";
}

export async function syncEncountersToVisits(
  patientId: string,
  providerId: string,
  hospitalId: string,
  encounters: EncounterOut[]
): Promise<{ synced: number; errors: string[] }> {
  const db = ensureInitialized();
  let synced = 0;
  const errors: string[] = [];

  for (const enc of encounters) {
    if (!enc.id) continue;
    try {
      await db.query(
        `INSERT INTO visits (
          patient_id, provider_id, hospital_id,
          epic_encounter_id, epic_identifier,
          status, type, encounter_class,
          scheduled_at, started_at, completed_at,
          chief_complaint, reason_codes, priority,
          location_display, participant_details,
          case_ids, epic_last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, NOW())
        ON CONFLICT (epic_encounter_id) WHERE epic_encounter_id IS NOT NULL
        DO UPDATE SET
          status = EXCLUDED.status,
          type = EXCLUDED.type,
          encounter_class = EXCLUDED.encounter_class,
          started_at = EXCLUDED.started_at,
          completed_at = EXCLUDED.completed_at,
          chief_complaint = EXCLUDED.chief_complaint,
          reason_codes = EXCLUDED.reason_codes,
          priority = EXCLUDED.priority,
          location_display = EXCLUDED.location_display,
          participant_details = EXCLUDED.participant_details,
          epic_last_synced_at = NOW(),
          updated_at = NOW()`,
        [
          patientId,
          providerId,
          hospitalId,
          enc.id,
          enc.epicIdentifier,
          ENCOUNTER_STATUS_MAP[enc.status] || "SCHEDULED",
          mapEncounterType(enc.typeDisplay),
          enc.encounterClass,
          enc.periodStart || new Date().toISOString(),
          enc.status === "in-progress" || enc.status === "finished" ? enc.periodStart : null,
          enc.status === "finished" ? enc.periodEnd : null,
          enc.reasonCodes[0]?.text || null,
          enc.reasonCodes.length > 0 ? JSON.stringify(enc.reasonCodes) : null,
          enc.priorityDisplay,
          enc.locationDisplay,
          enc.participants.length > 0 ? JSON.stringify(enc.participants) : null,
          "[]",
        ]
      );
      synced++;
    } catch (error) {
      errors.push(`Encounter ${enc.id}: ${(error as Error).message}`);
    }
  }

  return { synced, errors };
}

export async function syncAppointmentsToVisits(
  patientId: string,
  providerId: string,
  hospitalId: string,
  appointments: AppointmentOut[]
): Promise<{ synced: number; errors: string[] }> {
  const db = ensureInitialized();
  let synced = 0;
  const errors: string[] = [];

  for (const apt of appointments) {
    if (!apt.id) continue;
    try {
      const status = apt.status === "cancelled" ? "CANCELLED"
        : apt.status === "noshow" ? "NO_SHOW"
        : "SCHEDULED";

      await db.query(
        `INSERT INTO visits (
          patient_id, provider_id, hospital_id,
          epic_appointment_id, epic_identifier,
          status, type,
          scheduled_at,
          chief_complaint, reason_codes, priority,
          patient_instructions, cancellation_reason,
          participant_details,
          case_ids, epic_last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, NOW())
        ON CONFLICT (epic_appointment_id) WHERE epic_appointment_id IS NOT NULL
        DO UPDATE SET
          status = EXCLUDED.status,
          scheduled_at = EXCLUDED.scheduled_at,
          chief_complaint = EXCLUDED.chief_complaint,
          reason_codes = EXCLUDED.reason_codes,
          priority = EXCLUDED.priority,
          patient_instructions = EXCLUDED.patient_instructions,
          cancellation_reason = EXCLUDED.cancellation_reason,
          participant_details = EXCLUDED.participant_details,
          epic_last_synced_at = NOW(),
          updated_at = NOW()`,
        [
          patientId,
          providerId,
          hospitalId,
          apt.id,
          apt.epicIdentifier,
          status,
          mapEncounterType(apt.serviceTypeDisplay),
          apt.start || new Date().toISOString(),
          apt.reasonCodes[0]?.text || apt.description || null,
          apt.reasonCodes.length > 0 ? JSON.stringify(apt.reasonCodes) : null,
          apt.priority !== null ? String(apt.priority) : null,
          apt.patientInstruction,
          apt.cancellationReason,
          apt.participants.length > 0 ? JSON.stringify(apt.participants) : null,
          "[]",
        ]
      );
      synced++;
    } catch (error) {
      errors.push(`Appointment ${apt.id}: ${(error as Error).message}`);
    }
  }

  return { synced, errors };
}
```

**Note:** The `ensureInitialized()` helper is already used in the file. Verify it returns the `Pool` instance. If it returns void and throws, use the module-level `db` variable that `initializeDatabase` sets instead.

**Step 4: Run test to verify it passes**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/database-sync-encounters.test.ts --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/epic-api-service/src/services/database.ts apps/epic-api-service/src/__tests__/database-sync-encounters.test.ts
git commit -m "feat: add syncEncountersToVisits and syncAppointmentsToVisits upsert functions"
```

---

### Task 8: GraphQL Schema — Add Encounter/Appointment types to epic-api-service

**Files:**
- Modify: `apps/epic-api-service/src/index.ts`

**Step 1: Add GraphQL type definitions**

In the schema string (the `gql` template literal), add the following:

1. After the `ClinicalSnapshot` type (line 456), add:

```graphql
  # =========================================================================
  # Encounters & Appointments
  # =========================================================================

  type EpicEncounter {
    id: ID
    status: String!
    encounterClass: String!
    classDisplay: String
    typeDisplay: String
    periodStart: String
    periodEnd: String
    reasonCodes: [CodeableConcept!]!
    participants: [EncounterParticipant!]!
    locationDisplay: String
    epicIdentifier: String
    priorityDisplay: String
  }

  type EncounterParticipant {
    role: CodeableConcept
    individual: ReferenceInfo
  }

  type EpicAppointment {
    id: ID
    status: String!
    serviceTypeDisplay: String
    start: String
    end: String
    reasonCodes: [CodeableConcept!]!
    participants: [AppointmentParticipant!]!
    description: String
    cancellationReason: String
    patientInstruction: String
    epicIdentifier: String
    priority: Int
  }

  type AppointmentParticipant {
    actor: ReferenceInfo
    status: String!
  }
```

**Note:** `CodeableConcept` and `ReferenceInfo` types should already be defined in the schema. If not, check existing type definitions — they may be named differently (e.g., `CodeableConceptType`). Use the names already in the schema.

2. Add `encounters` and `appointments` fields to `EpicPatientData` type (line 533-543):

```graphql
  type EpicPatientData @key(fields: "epicPatientId") {
    epicPatientId: ID!
    demographics: PatientDemographics
    vitals: [Vital!]!
    labs: [LabResult!]!
    medications: [Medication!]!
    diagnoses: [Diagnosis!]!
    allergies: [Allergy!]!
    encounters: [EpicEncounter!]!
    appointments: [EpicAppointment!]!
    lastSync: String
    errors: [DataFetchError!]!
  }
```

3. Add to `EpicDataType` enum (line 560-567):

```graphql
  enum EpicDataType {
    DEMOGRAPHICS
    VITALS
    LABS
    MEDICATIONS
    DIAGNOSES
    ALLERGIES
    ENCOUNTERS
    APPOINTMENTS
  }
```

4. Update the TypeScript `EpicPatientData` interface (line 45-55):

```typescript
interface EpicPatientData {
  epicPatientId: string;
  demographics: PatientDemographicsOut | null;
  vitals: VitalOut[];
  labs: LabResultOut[];
  medications: MedicationOut[];
  diagnoses: DiagnosisOut[];
  allergies: AllergyOut[];
  encounters: EncounterOut[];
  appointments: AppointmentOut[];
  lastSync: string;
  errors: DataFetchError[];
}
```

5. Add imports at the top for `EncounterOut`, `AppointmentOut`, `transformEncounters`, `transformAppointments` from `./services/transforms`.

6. Add imports for `FHIREncounter`, `FHIRAppointment` from `./clients/epic-fhir-client`.

**Step 2: Verify build passes**

Run: `cd /home/claude/workspace/prism-graphql && npx tsc --noEmit -p apps/epic-api-service/tsconfig.json 2>&1 | head -30`
Expected: Type errors in resolvers (because they don't return encounters/appointments yet). Fix in next step.

**Step 3: Commit**

```bash
git add apps/epic-api-service/src/index.ts
git commit -m "feat: add Encounter/Appointment GraphQL types and update EpicPatientData schema"
```

---

### Task 9: Resolver Updates — Wire encounters/appointments into epicPatientData and createClinicalSnapshot

**Files:**
- Modify: `apps/epic-api-service/src/index.ts`

**Step 1: Update `epicPatientData` query resolver**

In the `epicPatientData` resolver (starts at line 636):

1. Add encounters/appointments to the cache-first check (around line 649-663):

```typescript
      const [
        cachedDemographics,
        cachedVitals,
        cachedLabs,
        cachedMedications,
        cachedDiagnoses,
        cachedAllergies,
        cachedEncounters,
        cachedAppointments,
      ] = await Promise.all([
        getCached<PatientDemographicsOut>("patient", epicPatientId),
        getCached<VitalOut[]>("vitals", epicPatientId),
        getCached<LabResultOut[]>("labs", epicPatientId),
        getCached<MedicationOut[]>("medications", epicPatientId),
        getCached<DiagnosisOut[]>("conditions", epicPatientId),
        getCached<AllergyOut[]>("allergies", epicPatientId),
        getCached<EncounterOut[]>("encounters", epicPatientId),
        getCached<AppointmentOut[]>("appointments", epicPatientId),
      ]);
```

2. Update the full-cache-hit check (around line 666-689):

```typescript
      if (
        cachedDemographics &&
        cachedVitals &&
        cachedLabs &&
        cachedMedications &&
        cachedDiagnoses &&
        cachedAllergies &&
        cachedEncounters &&
        cachedAppointments
      ) {
        logger.info("Full cache hit for patient data", { requestId, epicPatientId });
        return {
          epicPatientId,
          demographics: cachedDemographics,
          vitals: cachedVitals,
          labs: cachedLabs,
          medications: cachedMedications,
          diagnoses: cachedDiagnoses,
          allergies: cachedAllergies,
          encounters: cachedEncounters,
          appointments: cachedAppointments,
          lastSync: new Date().toISOString(),
          errors: [],
        };
      }
```

3. Add encounters/appointments fetch to the `Promise.allSettled` block (around line 695-774):

Add two more entries to the allSettled array:

```typescript
          // Encounters
          cachedEncounters
            ? Promise.resolve(cachedEncounters)
            : (async (): Promise<EncounterOut[]> => {
                const result = await fhirClient.getEncounters(epicPatientId, requestId);
                const encounterResources: FHIREncounter[] = result.data.entry?.map((e) => e.resource) || [];
                const transformed = transformEncounters(encounterResources);
                await setCached("encounters", epicPatientId, transformed);
                return transformed;
              })(),

          // Appointments
          cachedAppointments
            ? Promise.resolve(cachedAppointments)
            : (async (): Promise<AppointmentOut[]> => {
                const result = await fhirClient.getAppointments(epicPatientId, requestId);
                const appointmentResources: FHIRAppointment[] = result.data.entry?.map((e) => e.resource) || [];
                const transformed = transformAppointments(appointmentResources);
                await setCached("appointments", epicPatientId, transformed);
                return transformed;
              })(),
```

4. Update the destructured results and error handling (around line 779-798):

```typescript
      const dataTypeLabels = ["DEMOGRAPHICS", "VITALS", "LABS", "MEDICATIONS", "DIAGNOSES", "ALLERGIES", "ENCOUNTERS", "APPOINTMENTS"] as const;
```

Add to the result extraction:

```typescript
      const encounters = encounterResult.status === "fulfilled" ? encounterResult.value : [];
      const appointments = appointmentResult.status === "fulfilled" ? appointmentResult.value : [];
```

5. Update the return value (around line 812-822):

```typescript
      return {
        epicPatientId,
        demographics,
        vitals,
        labs,
        medications,
        diagnoses,
        allergies,
        encounters,
        appointments,
        lastSync: new Date().toISOString(),
        errors,
      };
```

**Step 2: Update `createClinicalSnapshot` mutation resolver**

In the `createClinicalSnapshot` resolver (starts at line 1074):

1. Add encounter/appointment fetches to `Promise.allSettled` (line 1092-1100):

```typescript
      const [patientResult, vitalsResult, labsResult, medsResult, conditionsResult, allergyResult, encounterResult, appointmentResult] =
        await Promise.allSettled([
          fhirClient.getPatient(epicPatientId, requestId),
          fhirClient.getObservations(epicPatientId, "vital-signs", requestId),
          fhirClient.getLabObservations(epicPatientId, requestId),
          fhirClient.getMedicationRequests(epicPatientId, requestId),
          fhirClient.getConditions(epicPatientId, requestId),
          fhirClient.getAllergyIntolerances(epicPatientId, requestId),
          fhirClient.getEncounters(epicPatientId, requestId),
          fhirClient.getAppointments(epicPatientId, requestId),
        ]);
```

2. Add encounter/appointment transform blocks (after allergies transform, around line 1146):

```typescript
      // Transform encounters
      let encounters: EncounterOut[] = [];
      if (encounterResult.status === "fulfilled") {
        const encounterResources: FHIREncounter[] =
          encounterResult.value.data.entry?.map((e) => e.resource) || [];
        encounters = transformEncounters(encounterResources);
      }

      // Transform appointments
      let appointments: AppointmentOut[] = [];
      if (appointmentResult.status === "fulfilled") {
        const appointmentResources: FHIRAppointment[] =
          appointmentResult.value.data.entry?.map((e) => e.resource) || [];
        appointments = transformAppointments(appointmentResources);
      }
```

3. After snapshot creation (after line 1161), add encounter/appointment sync to visits:

```typescript
      // Sync encounters and appointments into visits table
      if (encounters.length > 0 || appointments.length > 0) {
        // Look up the local patient ID and default provider/hospital
        const localPatientId = await getEpicPatientIdByPatientId(epicPatientId);
        // Note: getEpicPatientIdByPatientId actually does reverse lookup.
        // We need a function that finds local patient_id from epic_patient_id.
        // For now use a direct query:
        const patientRow = await db.query(
          "SELECT id FROM patients WHERE epic_patient_id = $1 LIMIT 1",
          [epicPatientId]
        );
        if (patientRow.rows.length > 0) {
          const localPid = patientRow.rows[0].id;
          // Use seed provider/hospital as defaults
          const providerRow = await db.query("SELECT id FROM providers LIMIT 1");
          const hospitalRow = await db.query("SELECT id FROM institutions LIMIT 1");
          const defaultProviderId = providerRow.rows[0]?.id;
          const defaultHospitalId = hospitalRow.rows[0]?.id;

          if (defaultProviderId && defaultHospitalId) {
            if (encounters.length > 0) {
              const encResult = await syncEncountersToVisits(localPid, defaultProviderId, defaultHospitalId, encounters);
              logger.info("Encounters synced to visits", { synced: encResult.synced, errors: encResult.errors });
            }
            if (appointments.length > 0) {
              const aptResult = await syncAppointmentsToVisits(localPid, defaultProviderId, defaultHospitalId, appointments);
              logger.info("Appointments synced to visits", { synced: aptResult.synced, errors: aptResult.errors });
            }
          }
        }
      }
```

4. Update cache writes (line 1163-1170):

```typescript
      await setCached("encounters", epicPatientId, encounters);
      await setCached("appointments", epicPatientId, appointments);
```

**Step 3: Add imports**

Add to the imports at the top of `index.ts`:

```typescript
import {
  // ... existing imports ...
  EncounterOut,
  AppointmentOut,
  transformEncounters,
  transformAppointments,
} from "./services/transforms";

import type { FHIREncounter, FHIRAppointment } from "./clients/epic-fhir-client";
import { syncEncountersToVisits, syncAppointmentsToVisits } from "./services/database";
```

**Step 4: Verify build passes**

Run: `cd /home/claude/workspace/prism-graphql && npx tsc --noEmit -p apps/epic-api-service/tsconfig.json 2>&1 | head -30`
Expected: No errors (or only pre-existing ones).

**Step 5: Commit**

```bash
git add apps/epic-api-service/src/index.ts
git commit -m "feat: wire encounters/appointments into epicPatientData and createClinicalSnapshot resolvers"
```

---

### Task 10: Providers Service — Update Visit type and VisitService for new columns

**Files:**
- Modify: `apps/providers-service/schema.graphql`
- Modify: `apps/providers-service/src/services/database.ts`

**Step 1: Update GraphQL Visit type**

In `apps/providers-service/schema.graphql`, update the `Visit` type (line 18-34):

```graphql
type Visit @key(fields: "id") {
  id: ID!
  patientId: ID!
  hospitalId: ID!
  providerId: ID!
  caseIds: [ID!]!
  type: VisitType!
  status: VisitStatus!
  scheduledAt: DateTime!
  startedAt: DateTime
  completedAt: DateTime
  duration: Int
  notes: String
  chiefComplaint: String
  audioUri: String
  audioUploadedAt: DateTime
  epicEncounterId: String
  epicAppointmentId: String
  epicIdentifier: String
  encounterClass: String
  reasonCodes: JSON
  priority: String
  locationDisplay: String
  participantDetails: JSON
  cancellationReason: String
  patientInstructions: String
  epicLastSyncedAt: DateTime
}
```

Also add `scalar JSON` near the top if it doesn't exist already. Check first.

**Step 2: Update Visit TypeScript interface**

In `apps/providers-service/src/services/database.ts`, update the `Visit` interface (line 56-79):

```typescript
export interface Visit {
  id: string;
  patientId: string;
  hospitalId: string;
  providerId: string;
  caseIds: string[];
  type: VisitType;
  status: VisitStatus;
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  notes?: string;
  chiefComplaint?: string;
  recordingKey?: string;
  recordingEndedAt?: Date;
  conditionCodes?: string[];
  carePlanRequestId?: string;
  carePlanRequestedAt?: Date;
  audioUri?: string;
  audioUploadedAt?: Date;
  epicEncounterId?: string;
  epicAppointmentId?: string;
  epicIdentifier?: string;
  encounterClass?: string;
  reasonCodes?: unknown;
  priority?: string;
  locationDisplay?: string;
  participantDetails?: unknown;
  cancellationReason?: string;
  patientInstructions?: string;
  epicLastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

**Step 3: Update all SELECT queries to include new columns**

Every query in VisitService that does `SELECT ... FROM visits` needs the new columns. The queries to update are in these methods:

- `createVisit` (line 370-377)
- `getVisitById` (line 400-407)
- `getVisitsForProvider` (line 429-436)
- `getVisitsForPatient` (line 462-469)
- `updateVisit` (line 523-528)
- `getVisitsForProviderOnDate` (line 580-588)

Add these columns to each RETURNING/SELECT clause:

```sql
epic_encounter_id as "epicEncounterId",
epic_appointment_id as "epicAppointmentId",
epic_identifier as "epicIdentifier",
encounter_class as "encounterClass",
reason_codes as "reasonCodes",
priority,
location_display as "locationDisplay",
participant_details as "participantDetails",
cancellation_reason as "cancellationReason",
patient_instructions as "patientInstructions",
epic_last_synced_at as "epicLastSyncedAt"
```

Also update the `allowedFields` array and `dbKey` mapping in `updateVisit` (line 492) to include the new fields:

```typescript
const allowedFields = [
  'type', 'status', 'scheduledAt', 'startedAt', 'completedAt', 'duration', 'notes',
  'chiefComplaint', 'recordingKey', 'recordingEndedAt', 'conditionCodes',
  'carePlanRequestId', 'carePlanRequestedAt', 'audioUri', 'audioUploadedAt',
  'epicEncounterId', 'epicAppointmentId', 'epicIdentifier', 'encounterClass',
  'reasonCodes', 'priority', 'locationDisplay', 'participantDetails',
  'cancellationReason', 'patientInstructions', 'epicLastSyncedAt'
];
```

And add to the `dbKey` mapping:

```typescript
key === 'epicEncounterId' ? 'epic_encounter_id' :
key === 'epicAppointmentId' ? 'epic_appointment_id' :
key === 'epicIdentifier' ? 'epic_identifier' :
key === 'encounterClass' ? 'encounter_class' :
key === 'reasonCodes' ? 'reason_codes' :
key === 'locationDisplay' ? 'location_display' :
key === 'participantDetails' ? 'participant_details' :
key === 'cancellationReason' ? 'cancellation_reason' :
key === 'patientInstructions' ? 'patient_instructions' :
key === 'epicLastSyncedAt' ? 'epic_last_synced_at' :
```

**Step 4: Verify build passes**

Run: `cd /home/claude/workspace/prism-graphql && npx tsc --noEmit -p apps/providers-service/tsconfig.json 2>&1 | head -30`
Expected: No errors.

**Step 5: Run existing tests**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/providers-service --no-coverage 2>&1 | tail -20`
Expected: All existing tests still pass.

**Step 6: Commit**

```bash
git add apps/providers-service/schema.graphql apps/providers-service/src/services/database.ts
git commit -m "feat: add Epic encounter/appointment fields to Visit type and VisitService"
```

---

### Task 11: Mock Service — Enhance Encounter mock, add Appointment endpoint

**Files:**
- Modify: `apps/epic-mock-service/src/index.ts`

**Step 1: Enhance the Encounter mock response**

Replace the current Encounter endpoint (line 696-741) with a richer response:

```typescript
// Encounter endpoints
app.get('/Encounter', (req, res) => {
  const { patient } = req.query;

  if (!patient) {
    return res.status(400).json({ error: 'Patient parameter required' });
  }

  setTimeout(() => {
    return res.json({
      resourceType: 'Bundle',
      id: uuidv4(),
      type: 'searchset',
      total: 3,
      entry: [
        {
          resource: {
            resourceType: 'Encounter',
            id: `enc-${patient}-001`,
            identifier: [{ system: 'urn:oid:1.2.840.114350', value: 'VN-2026-0042' }],
            status: 'finished',
            class: {
              system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
              code: 'AMB',
              display: 'ambulatory'
            },
            type: [{
              coding: [{ system: 'http://snomed.info/sct', code: '185349003', display: 'Encounter for check up' }],
              text: 'Annual Physical'
            }],
            priority: { coding: [{ code: 'R', display: 'routine' }] },
            subject: { reference: `Patient/${patient}`, display: 'Test Patient' },
            period: {
              start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
              end: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString()
            },
            participant: [{
              type: [{ coding: [{ code: 'ATND', display: 'attender' }] }],
              individual: { reference: 'Practitioner/prov-001', display: 'Dr. Smith, Family Medicine' }
            }],
            reasonCode: [{
              coding: [{ system: 'http://snomed.info/sct', code: '185349003', display: 'General examination' }],
              text: 'Annual wellness exam'
            }],
            location: [{ location: { display: 'Room 204, Building A' } }],
          }
        },
        {
          resource: {
            resourceType: 'Encounter',
            id: `enc-${patient}-002`,
            identifier: [{ system: 'urn:oid:1.2.840.114350', value: 'VN-2026-0058' }],
            status: 'finished',
            class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
            type: [{ coding: [{ code: '185389009', display: 'Follow-up visit' }], text: 'Follow-up' }],
            subject: { reference: `Patient/${patient}` },
            period: {
              start: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
              end: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString()
            },
            participant: [{
              individual: { display: 'Dr. Smith, Family Medicine' }
            }],
            reasonCode: [{ text: 'Diabetes follow-up' }],
            location: [{ location: { display: 'Room 102' } }],
          }
        },
        {
          resource: {
            resourceType: 'Encounter',
            id: `enc-${patient}-003`,
            status: 'in-progress',
            class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
            type: [{ text: 'Consultation' }],
            subject: { reference: `Patient/${patient}` },
            period: { start: new Date().toISOString() },
            participant: [{ individual: { display: 'Dr. Jones, Endocrinology' } }],
            reasonCode: [{ text: 'Blood sugar management' }],
          }
        },
      ]
    });
  }, 130 + Math.random() * 270);
});
```

**Step 2: Add Appointment endpoint**

Add after the Encounter endpoint (before the health check at line 743):

```typescript
// Appointment endpoints
app.get('/Appointment', (req, res) => {
  const { patient } = req.query;

  if (!patient) {
    return res.status(400).json({ error: 'Patient parameter required' });
  }

  setTimeout(() => {
    return res.json({
      resourceType: 'Bundle',
      id: uuidv4(),
      type: 'searchset',
      total: 2,
      entry: [
        {
          resource: {
            resourceType: 'Appointment',
            id: `apt-${patient}-001`,
            identifier: [{ system: 'urn:oid:1.2.840.114350', value: 'APT-2026-0103' }],
            status: 'booked',
            serviceType: [{
              coding: [{ system: 'http://snomed.info/sct', code: '394802001', display: 'General medicine' }],
              text: 'General Medicine'
            }],
            start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
            participant: [
              { actor: { reference: `Patient/${patient}`, display: 'Test Patient' }, status: 'accepted' },
              { actor: { reference: 'Practitioner/prov-001', display: 'Dr. Smith' }, status: 'accepted' },
            ],
            reasonCode: [{ text: 'Lab results review' }],
            description: 'Review recent lab results and adjust medications',
            patientInstruction: 'Please bring your medication list and glucose log.',
            priority: 0,
          }
        },
        {
          resource: {
            resourceType: 'Appointment',
            id: `apt-${patient}-002`,
            identifier: [{ system: 'urn:oid:1.2.840.114350', value: 'APT-2026-0104' }],
            status: 'booked',
            serviceType: [{ text: 'Diagnostic' }],
            start: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
            participant: [
              { actor: { reference: `Patient/${patient}` }, status: 'accepted' },
              { actor: { reference: 'Practitioner/prov-002', display: 'Dr. Jones, Endocrinology' }, status: 'accepted' },
            ],
            reasonCode: [{ text: 'A1C monitoring' }],
            description: 'Quarterly diabetes monitoring',
          }
        },
      ]
    });
  }, 100 + Math.random() * 200);
});
```

**Step 3: Verify mock service builds**

Run: `cd /home/claude/workspace/prism-graphql && npx tsc --noEmit -p apps/epic-mock-service/tsconfig.json 2>&1 | head -20`
Expected: No errors (or the service may not have its own tsconfig — in that case just verify the file has valid syntax).

**Step 4: Commit**

```bash
git add apps/epic-mock-service/src/index.ts
git commit -m "feat: enhance Encounter mock and add Appointment endpoint to mock service"
```

---

### Task 12: Seed Script — Trigger encounter sync during snapshot creation

The seed script (`seed-epic-snapshots.sh`) already calls `createClinicalSnapshot` for each patient. Since Task 9 updated that resolver to also sync encounters/appointments into the visits table, **no changes are needed to the seed scripts themselves**.

However, we should verify end-to-end:

**Step 1: Rebuild and restart the stack**

Run: `cd /home/claude/workspace/prism-graphql && make compose-down && make compose-up`
Expected: All services start healthy.

**Step 2: Run migration**

Run: `cd /home/claude/workspace/prism-graphql && make migrate`
Expected: Migration 032 applied.

**Step 3: Seed data**

Run: `cd /home/claude/workspace/prism-graphql && make seed-epic-data`
Expected: Patients seeded, snapshots created, encounters synced into visits.

**Step 4: Verify encounters in visits table**

Run: `cd /home/claude/workspace/prism-graphql && docker exec prism-postgres psql -U postgres -d healthcare_federation -c "SELECT id, status, type, epic_encounter_id, epic_appointment_id, encounter_class, location_display FROM visits WHERE epic_encounter_id IS NOT NULL OR epic_appointment_id IS NOT NULL;"`
Expected: Rows with Epic encounter/appointment IDs, class "AMB", location text.

**Step 5: Query via GraphQL**

Run:
```bash
curl -s http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ epicPatientData(epicPatientId: \"erXuFYUfucBZaryVksYEcMg3\") { encounters { id status encounterClass typeDisplay periodStart locationDisplay } appointments { id status serviceTypeDisplay start description } } }"}' | jq .
```
Expected: JSON with encounters and appointments arrays populated.

**Step 6: Final commit (if any seed changes were needed)**

```bash
git commit -m "chore: verify encounter/appointment pipeline end-to-end"
```

---

## Execution Checklist

| Task | Description | Depends On |
|------|-------------|------------|
| 1 | Migration 032: 11 new columns on visits | — |
| 2 | FHIR types: FHIREncounter, FHIRAppointment | — |
| 3 | Client methods: getEncounters(), getAppointments() | 2 |
| 4 | Auth scope: Add Encounter.rs, Appointment.rs | — |
| 5 | Transformers: transformEncounters(), transformAppointments() | 2 |
| 6 | Cache: Add ENCOUNTERS/APPOINTMENTS TTLs | — |
| 7 | DB sync: syncEncountersToVisits(), syncAppointmentsToVisits() | 1, 5 |
| 8 | GraphQL schema: EpicPatientData, enums, new types | 5 |
| 9 | Resolvers: Wire into epicPatientData + createClinicalSnapshot | 3, 5, 6, 7, 8 |
| 10 | Providers service: Visit type + VisitService updates | 1 |
| 11 | Mock service: Richer Encounter + new Appointment endpoint | — |
| 12 | E2E verification: Stack rebuild, seed, query | All |

**Parallelizable:** Tasks 1, 2, 4, 6, 11 can all run in parallel. Tasks 3 and 5 depend on 2. Task 7 depends on 1 + 5. Tasks 8/9 depend on most prior tasks. Task 10 depends on 1. Task 12 depends on all.
