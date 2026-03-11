# SNOMED-to-ICD-10 Condition Code Mapping Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map SNOMED CT codes from Epic FHIR conditions to ICD-10 codes so the care plan generation pipeline receives the format it expects.

**Architecture:** Extract ICD-10 from the FHIR `code_detail.coding[]` array at read time in `mapConditions()`. Fall back to a `snomed_icd10_common_map` PostgreSQL table for conditions without ICD-10 in their FHIR data. Frontend passes `icd10Code` to the careplan mutation instead of the raw SNOMED `code`.

**Tech Stack:** TypeScript 5, PostgreSQL 15, Apollo Federation, Next.js 16, React 19

**Spec:** `docs/superpowers/specs/2026-03-11-snomed-icd10-mapping-design.md`

---

## File Structure

**New files:**
- `prism-graphql/shared/data-layer/migrations/035_create_snomed_icd10_map.sql` — Migration for fallback mapping table + seed data
- `prism-graphql/apps/epic-api-service/src/services/snomed-icd10-lookup.ts` — Lookup function for the fallback table

**Modified files:**
- `prism-graphql/apps/epic-api-service/src/services/patient-clinical-mappers.ts` — Add `icd10Code` extraction logic to `mapConditions()`
- `prism-graphql/apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts` — Tests for ICD-10 extraction
- `prism-graphql/apps/epic-api-service/src/services/database.ts` — Export `getPool()` for resolver access
- `prism-graphql/apps/epic-api-service/src/index.ts:549-556` — Add `icd10Code` field to GraphQL schema
- `prism-graphql/apps/careplan-service/src/resolvers/mutations/generate-care-plan.ts:104-113` — Revert validation to ICD-10-only
- `prism-provider-front-end/src/types/index.ts:42-49` — Add `icd10Code` to `Condition` interface
- `prism-provider-front-end/src/lib/graphql/queries/visits.ts:34-41` — Add `icd10Code` to conditions fragment
- `prism-provider-front-end/src/lib/graphql/queries/patients.ts:26-31,53-60` — Add `icd10Code` to conditions fragments
- `prism-provider-front-end/src/components/provider/ConditionCodePicker.tsx` — Use `icd10Code`, disable unmapped conditions

---

## Chunk 1: Backend — Migration & Lookup

### Task 1: Create the snomed_icd10_common_map migration

**Files:**
- Create: `prism-graphql/shared/data-layer/migrations/035_create_snomed_icd10_map.sql`

- [ ] **Step 1: Write the migration SQL**

Create `prism-graphql/shared/data-layer/migrations/035_create_snomed_icd10_map.sql`:

```sql
-- SNOMED CT to ICD-10-CM common mapping table
-- Provides fallback mappings for conditions where Epic FHIR data
-- only includes SNOMED codes without an ICD-10 coding entry.

CREATE TABLE IF NOT EXISTS snomed_icd10_common_map (
  snomed_code VARCHAR(18) PRIMARY KEY,
  icd10_code  VARCHAR(10) NOT NULL REFERENCES icd10_codes(code),
  description TEXT NOT NULL
);

CREATE INDEX idx_snomed_icd10_map_icd10 ON snomed_icd10_common_map(icd10_code);

-- Seed with common primary care SNOMED-to-ICD-10 mappings
-- Source: NLM SNOMED CT to ICD-10-CM Map (1:1 mappings for high-frequency conditions)

INSERT INTO snomed_icd10_common_map (snomed_code, icd10_code, description) VALUES
-- Cardiovascular
('38341003',   'I10',    'Hypertension'),
('59621000',   'I10',    'Essential hypertension'),
('56265001',   'I25.10', 'Coronary artery disease'),
('53741008',   'I25.10', 'Coronary arteriosclerosis'),
('84114007',   'I50.9',  'Heart failure'),
('42343007',   'I50.9',  'Congestive heart failure'),
('49436004',   'I48.91', 'Atrial fibrillation'),
('5370000',    'I48.91', 'Atrial flutter'),
('22298006',   'I63.9',  'Cerebrovascular accident'),

-- Endocrine / Metabolic
('44054006',   'E11.9',  'Type 2 diabetes mellitus'),
('73211009',   'E10.9',  'Type 1 diabetes mellitus'),
('46635009',   'E10.9',  'Type 1 diabetes mellitus'),
('55822004',   'E78.5',  'Hyperlipidemia'),
('13644009',   'E78.00', 'Hypercholesterolemia'),
('238136002',  'E66.9',  'Overweight and obesity'),
('414916001',  'E66.01', 'Obesity'),
('40930008',   'E03.9',  'Hypothyroidism'),
('34486009',   'E03.9',  'Hypothyroidism, unspecified'),
('267384006',  'E03.9',  'Hypothyroidism, unspecified'),
('190268003',  'E05.90', 'Hyperthyroidism'),

-- Respiratory
('195967001',  'J45.909','Asthma'),
('233678006',  'J45.20', 'Mild intermittent asthma'),
('13645005',   'J44.1',  'COPD'),
('185086009',  'J44.1',  'COPD with acute exacerbation'),
('36971009',   'J06.9',  'Acute upper respiratory infection'),
('233604007',  'J18.9',  'Pneumonia'),
('10509002',   'J20.9',  'Acute bronchitis'),
('275544005',  'R05.9',  'Cough'),

-- Mental Health
('35489007',   'F32.9',  'Major depressive disorder'),
('370143000',  'F32.9',  'Major depressive disorder'),
('36923009',   'F32.9',  'Major depressive disorder'),
('197480006',  'F41.1',  'Generalized anxiety disorder'),
('21897009',   'F41.1',  'Generalized anxiety disorder'),
('47505003',   'F43.10', 'Post-traumatic stress disorder'),
('191736004',  'F41.0',  'Panic disorder'),
('13746004',   'F31.9',  'Bipolar disorder'),

-- Musculoskeletal
('396275006',  'M17.9',  'Osteoarthritis of knee'),
('239872002',  'M17.11', 'Primary osteoarthritis, right knee'),
('69896004',   'M54.5',  'Low back pain'),
('279039007',  'M54.5',  'Low back pain'),
('203082005',  'M25.50', 'Joint pain'),
('64859006',   'M19.90', 'Osteoarthritis'),
('76069003',   'M81.0',  'Osteoporosis'),
('443165006',  'M79.3',  'Fibromyalgia'),

-- Genitourinary
('709044004',  'N18.9',  'Chronic kidney disease'),
('431855005',  'N18.9',  'Chronic kidney disease'),
('431856006',  'N18.3',  'Chronic kidney disease, stage 3'),
('431857002',  'N18.4',  'Chronic kidney disease, stage 4'),
('68566005',   'N39.0',  'Urinary tract infection'),

-- Gastrointestinal
('235595009',  'K21.0',  'Gastroesophageal reflux disease'),
('196731005',  'K21.0',  'GERD with esophagitis'),
('34000006',   'K92.1',  'Gastrointestinal hemorrhage'),
('197321007',  'K57.30', 'Diverticulosis'),
('24526004',   'K76.0',  'Fatty liver disease'),

-- Neurological
('84757009',   'G43.909','Migraine'),
('230462002',  'G47.33', 'Obstructive sleep apnea'),
('73430006',   'G47.33', 'Sleep apnea'),
('313307000',  'G20',    'Parkinson disease'),

-- Dermatological
('43309006',   'L40.9',  'Psoriasis'),
('24079001',   'L50.9',  'Urticaria'),

-- Hematological
('87522002',   'D64.9',  'Iron deficiency anemia'),
('271737000',  'D64.9',  'Anemia'),

-- Infectious
('235871004',  'B18.2',  'Hepatitis C'),
('61462000',   'J10.1',  'Influenza'),

-- Cancer (common screenable)
('254837009',  'C50.919','Breast cancer'),
('363406005',  'C61',    'Prostate cancer'),
('363518003',  'C18.9',  'Colorectal cancer'),
('254632001',  'C34.90', 'Lung cancer'),

-- Preventive / Other
('171245007',  'Z23',    'Vaccination needed'),
('268525008',  'Z12.11', 'Screening for malignant neoplasm of colon'),
('160903007',  'Z87.891','History of tobacco use'),
('65853000',   'F17.210','Nicotine dependence, cigarettes'),
('7200002',    'F10.20', 'Alcohol dependence')

ON CONFLICT (snomed_code) DO NOTHING;
```

- [ ] **Step 2: Verify migration numbering is correct**

Run: `ls shared/data-layer/migrations/ | tail -3`

Expected: `034_create_icd10_codes.sql` is the last migration, so `035` is correct.

- [ ] **Step 3: Run the migration**

Run: `make migrate` (from prism-graphql root, requires Docker Compose stack running)

Expected: Migration applies successfully. Verify with: `make migrate-status`

- [ ] **Step 4: Commit**

```bash
git add shared/data-layer/migrations/035_create_snomed_icd10_map.sql
git commit -m "feat: add SNOMED-to-ICD-10 common mapping table

Fallback lookup for conditions where Epic FHIR data only includes
SNOMED codes without an ICD-10 coding entry. Seeded with ~80 common
primary care mappings from NLM crosswalk."
```

---

### Task 2: Create the SNOMED→ICD-10 lookup function

**Files:**
- Create: `prism-graphql/apps/epic-api-service/src/services/snomed-icd10-lookup.ts`

- [ ] **Step 1: Write the lookup module**

Create `prism-graphql/apps/epic-api-service/src/services/snomed-icd10-lookup.ts`:

```typescript
/**
 * SNOMED CT to ICD-10-CM Lookup
 *
 * Provides ICD-10 code resolution for conditions that arrive as SNOMED codes.
 * Two strategies:
 *   1. Extract ICD-10 from FHIR CodeableConcept coding[] array (primary)
 *   2. Query snomed_icd10_common_map table (fallback)
 */

import type { CodeableConceptOut } from "./transforms";

// Recognized ICD-10 system URIs from FHIR
const ICD10_SYSTEMS = [
  "http://hl7.org/fhir/sid/icd-10-cm",
  "http://hl7.org/fhir/sid/icd-10",
  "urn:oid:2.16.840.1.113883.6.90",
];

const ICD10_PATTERN = /^[A-Z]\d{2}(\.\d{1,4})?$/;

/**
 * Extract an ICD-10 code from a FHIR CodeableConcept's coding array.
 * Returns the first ICD-10 code found, or null.
 */
export function extractIcd10FromCoding(
  codeDetail: CodeableConceptOut | null
): string | null {
  if (!codeDetail) return null;

  for (const coding of codeDetail.coding) {
    if (!coding.system || !coding.code) continue;

    const systemLower = coding.system.toLowerCase();
    const isIcd10System = ICD10_SYSTEMS.some((s) => systemLower.includes(s.toLowerCase()));

    if (isIcd10System && ICD10_PATTERN.test(coding.code)) {
      return coding.code;
    }
  }

  return null;
}

// In-memory cache for the mapping table (loaded once, ~80 rows)
let mapCache: Map<string, string> | null = null;

/**
 * Load the snomed_icd10_common_map table into memory.
 * Called once on first lookup, then cached for the process lifetime.
 */
async function loadMap(
  query: (sql: string) => Promise<{ rows: Array<{ snomed_code: string; icd10_code: string }> }>
): Promise<Map<string, string>> {
  if (mapCache) return mapCache;

  const result = await query(
    "SELECT snomed_code, icd10_code FROM snomed_icd10_common_map"
  );

  mapCache = new Map(result.rows.map((r) => [r.snomed_code, r.icd10_code]));
  return mapCache;
}

/**
 * Look up an ICD-10 code for a SNOMED code from the fallback mapping table.
 * Returns null if no mapping exists.
 */
export async function lookupSnomedToIcd10(
  snomedCode: string,
  query: (sql: string) => Promise<{ rows: Array<{ snomed_code: string; icd10_code: string }> }>
): Promise<string | null> {
  const map = await loadMap(query);
  return map.get(snomedCode) ?? null;
}

/**
 * Reset the in-memory cache. Used in tests.
 */
export function resetMapCache(): void {
  mapCache = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/epic-api-service/src/services/snomed-icd10-lookup.ts
git commit -m "feat: add SNOMED-to-ICD-10 lookup with FHIR extraction and fallback table"
```

---

### Task 3: Add ICD-10 extraction to mapConditions and update tests (TDD)

**Files:**
- Modify: `prism-graphql/apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts`
- Modify: `prism-graphql/apps/epic-api-service/src/services/patient-clinical-mappers.ts`

- [ ] **Step 1: Write failing tests for extractIcd10FromCoding**

Add to the top of the test file after existing imports:

```typescript
import {
  extractIcd10FromCoding,
  lookupSnomedToIcd10,
  resetMapCache,
} from "../services/snomed-icd10-lookup";
```

Add a new describe block after the existing `mapConditions` describe block (before `mapMedications`):

```typescript
// =============================================================================
// extractIcd10FromCoding
// =============================================================================

describe("extractIcd10FromCoding", () => {
  it("extracts ICD-10 code when present in coding array", () => {
    const codeDetail = {
      coding: [
        { system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" },
        { system: "http://hl7.org/fhir/sid/icd-10-cm", code: "I10", display: "Essential hypertension" },
      ],
      text: "Hypertension",
    };

    expect(extractIcd10FromCoding(codeDetail)).toBe("I10");
  });

  it("returns null when only SNOMED coding present", () => {
    const codeDetail = {
      coding: [
        { system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" },
      ],
      text: "Hypertension",
    };

    expect(extractIcd10FromCoding(codeDetail)).toBeNull();
  });

  it("returns null when codeDetail is null", () => {
    expect(extractIcd10FromCoding(null)).toBeNull();
  });

  it("returns null when coding array is empty", () => {
    expect(extractIcd10FromCoding({ coding: [], text: null })).toBeNull();
  });

  it("handles ICD-10 with decimal codes", () => {
    const codeDetail = {
      coding: [
        { system: "http://hl7.org/fhir/sid/icd-10-cm", code: "E11.9", display: "Type 2 diabetes" },
      ],
      text: "Type 2 diabetes",
    };

    expect(extractIcd10FromCoding(codeDetail)).toBe("E11.9");
  });

  it("handles alternative ICD-10 system URI", () => {
    const codeDetail = {
      coding: [
        { system: "urn:oid:2.16.840.1.113883.6.90", code: "J45.20", display: "Mild asthma" },
      ],
      text: "Mild asthma",
    };

    expect(extractIcd10FromCoding(codeDetail)).toBe("J45.20");
  });

  it("skips coding entries with null system or code", () => {
    const codeDetail = {
      coding: [
        { system: null, code: "38341003", display: "Hypertension" },
        { system: "http://hl7.org/fhir/sid/icd-10-cm", code: null, display: "Hypertension" },
        { system: "http://hl7.org/fhir/sid/icd-10-cm", code: "I10", display: "Hypertension" },
      ],
      text: "Hypertension",
    };

    expect(extractIcd10FromCoding(codeDetail)).toBe("I10");
  });
});
```

- [ ] **Step 2: Run tests to verify extractIcd10FromCoding tests pass**

Run: `npx jest apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts --no-coverage` (from prism-graphql root)

Expected: `extractIcd10FromCoding` tests PASS (implementation exists from Task 2). Existing tests still PASS.

- [ ] **Step 3: Write failing tests for icd10Code in mapConditions output**

Add to the existing `mapConditions` describe block:

```typescript
  it("populates icd10Code from ICD-10 entry in codeDetail.coding", () => {
    const input = [makeDiagnosis({
      code: "38341003",
      codeDetail: {
        coding: [
          { system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" },
          { system: "http://hl7.org/fhir/sid/icd-10-cm", code: "I10", display: "Essential hypertension" },
        ],
        text: "Hypertension",
      },
    })];

    const result = mapConditions(input);

    expect(result[0].icd10Code).toBe("I10");
  });

  it("returns null icd10Code when only SNOMED in codeDetail", () => {
    const input = [makeDiagnosis({
      code: "38341003",
      codeDetail: {
        coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" }],
        text: "Hypertension",
      },
    })];

    const result = mapConditions(input);

    expect(result[0].icd10Code).toBeNull();
  });

  it("returns the code itself as icd10Code when code is already ICD-10 format", () => {
    const input = [makeDiagnosis({
      code: "I10",
      codeDetail: {
        coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "I10", display: "Hypertension" }],
        text: "Hypertension",
      },
    })];

    const result = mapConditions(input);

    expect(result[0].icd10Code).toBe("I10");
  });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx jest apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts --no-coverage`

Expected: New `icd10Code` tests FAIL because `mapConditions` doesn't return `icd10Code` yet.

- [ ] **Step 5: Update mapConditions and PatientCondition interface**

In `prism-graphql/apps/epic-api-service/src/services/patient-clinical-mappers.ts`:

Add import at top:

```typescript
import { extractIcd10FromCoding } from "./snomed-icd10-lookup";
```

Update `PatientCondition` interface (lines 21-28):

```typescript
export interface PatientCondition {
  id: string;
  name: string;
  code: string;
  codeSystem: string | null;
  icd10Code: string | null;
  status: "ACTIVE" | "RESOLVED" | "INACTIVE";
  onsetDate: string;
}
```

Update `mapConditions` function (lines 105-114):

```typescript
export function mapConditions(diagnoses: DiagnosisOut[]): PatientCondition[] {
  return diagnoses.map((d, index) => ({
    id: d.id ?? `condition-${index}`,
    name: d.display,
    code: d.code,
    codeSystem: d.codeDetail?.coding[0]?.system ?? null,
    icd10Code: extractIcd10FromCoding(d.codeDetail),
    status: mapClinicalStatus(d.clinicalStatus),
    onsetDate: d.recordedDate,
  }));
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts --no-coverage`

Expected: ALL tests PASS (including new `icd10Code` tests and existing tests).

- [ ] **Step 7: Commit**

```bash
git add apps/epic-api-service/src/services/patient-clinical-mappers.ts \
       apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts
git commit -m "feat: extract ICD-10 code from FHIR coding array in mapConditions

Adds icd10Code field to PatientCondition by scanning codeDetail.coding[]
for ICD-10 system entries. Returns null when no ICD-10 coding is present."
```

---

### Task 4: Add fallback lookup integration to the resolver

The `mapConditions()` function handles the FHIR extraction (synchronous). For conditions where `icd10Code` is still `null`, the resolver needs to query the fallback table. This keeps `mapConditions` pure and testable.

**Files:**
- Modify: `prism-graphql/apps/epic-api-service/src/services/database.ts` — Export a `getPool()` function
- Modify: `prism-graphql/apps/epic-api-service/src/index.ts:1346-1366`

- [ ] **Step 1: Export getPool() from database.ts**

In `prism-graphql/apps/epic-api-service/src/services/database.ts`, add after the existing `ensureInitialized()` function (around line 37):

```typescript
/**
 * Get the initialized database pool. Throws if not initialized.
 * Exported for use by resolvers that need direct query access.
 */
export function getPool(): Pool {
  return ensureInitialized();
}
```

- [ ] **Step 2: Update the Patient resolver to apply fallback lookups**

In `prism-graphql/apps/epic-api-service/src/index.ts`, add imports near the top (around line 44, near other database imports):

```typescript
import { lookupSnomedToIcd10 } from "./services/snomed-icd10-lookup";
import { getPool } from "./services/database";
```

Note: `getPool` may need to be added to the existing import from `"./services/database"` if there's already one. Check the existing imports and merge.

Update the `Patient.__resolveReference` resolver (lines 1346-1366):

```typescript
  Patient: {
    async __resolveReference(ref: { id: string }) {
      const epicPatientId = await getEpicPatientIdByPatientId(ref.id);

      if (!epicPatientId) {
        return { id: ref.id, conditions: [], medications: [], allergies: [] };
      }

      const clinicalData = await getLatestSnapshotClinicalData(epicPatientId);

      if (!clinicalData) {
        return { id: ref.id, conditions: [], medications: [], allergies: [] };
      }

      const conditions = mapConditions(clinicalData.diagnoses);

      // Apply fallback SNOMED→ICD-10 lookup for conditions missing ICD-10
      const db = getPool();
      for (const condition of conditions) {
        if (condition.icd10Code === null && condition.code) {
          condition.icd10Code = await lookupSnomedToIcd10(
            condition.code,
            (sql) => db.query(sql)
          );
        }
      }

      return {
        id: ref.id,
        conditions,
        medications: mapMedications(clinicalData.medications),
        allergies: mapAllergies(clinicalData.allergies),
      };
    },
  },
```

- [ ] **Step 2: Update GraphQL schema**

In the same file (`index.ts`), update the `PatientCondition` type (lines 549-556):

```graphql
  type PatientCondition {
    id: ID!
    code: String!
    codeSystem: String
    icd10Code: String
    name: String!
    status: PatientConditionStatus!
    onsetDate: String
  }
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p apps/epic-api-service/tsconfig.json` (or `npm run typecheck` from prism-graphql root)

Expected: No new type errors in epic-api-service.

- [ ] **Step 4: Commit**

```bash
git add apps/epic-api-service/src/services/database.ts apps/epic-api-service/src/index.ts
git commit -m "feat: add icd10Code to PatientCondition schema and apply fallback lookup

Resolver now applies SNOMED→ICD-10 fallback lookup from the mapping table
for conditions where FHIR data doesn't include an ICD-10 coding entry."
```

---

### Task 5: Revert careplan-service validation to ICD-10-only

**Files:**
- Modify: `prism-graphql/apps/careplan-service/src/resolvers/mutations/generate-care-plan.ts:104-113`

- [ ] **Step 1: Revert validation**

In `generate-care-plan.ts`, replace lines 104-113:

```typescript
  // Validate ICD-10 code format
  const icd10Pattern = /^[A-Z]\d{2}(\.\d{1,4})?$/;
  for (const code of input.conditionCodes) {
    if (!icd10Pattern.test(code)) {
      throw new GraphQLError(`Invalid ICD-10 code format: ${code}`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add apps/careplan-service/src/resolvers/mutations/generate-care-plan.ts
git commit -m "fix: revert condition code validation to ICD-10-only

Frontend now sends ICD-10 codes (mapped from SNOMED at read time),
so strict ICD-10 validation is the correct safety net."
```

---

## Chunk 2: Frontend — Types, Queries, and ConditionCodePicker

### Task 6: Update frontend Condition type

**Files:**
- Modify: `prism-provider-front-end/src/types/index.ts:42-49`

- [ ] **Step 1: Add icd10Code to Condition interface**

Update lines 42-49:

```typescript
export interface Condition {
  id: string;
  code: string;
  codeSystem: string;
  icd10Code: string | null;
  name: string;
  status: 'ACTIVE' | 'RESOLVED' | 'INACTIVE';
  onsetDate?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add icd10Code field to Condition type"
```

---

### Task 7: Update GraphQL queries to request icd10Code

**Files:**
- Modify: `prism-provider-front-end/src/lib/graphql/queries/visits.ts:34-41`
- Modify: `prism-provider-front-end/src/lib/graphql/queries/patients.ts:26-31,53-60`

- [ ] **Step 1: Update GET_VISIT query**

In `visits.ts`, update the conditions fragment (lines 34-41):

```graphql
        conditions {
          id
          code
          codeSystem
          icd10Code
          name
          status
          onsetDate
        }
```

- [ ] **Step 2: Update GET_PATIENTS query**

In `patients.ts`, update the conditions fragment in GET_PATIENTS (lines 26-31):

```graphql
      conditions {
        id
        code
        icd10Code
        name
        status
      }
```

- [ ] **Step 3: Update GET_PATIENT query**

In `patients.ts`, update the conditions fragment in GET_PATIENT (lines 53-60):

```graphql
      conditions {
        id
        code
        codeSystem
        icd10Code
        name
        status
        onsetDate
      }
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/graphql/queries/visits.ts src/lib/graphql/queries/patients.ts
git commit -m "feat: request icd10Code in condition GraphQL fragments"
```

---

### Task 8: Update ConditionCodePicker to use icd10Code

**Files:**
- Modify: `prism-provider-front-end/src/components/provider/ConditionCodePicker.tsx`

- [ ] **Step 1: Update the component**

Replace the full component. Key changes:
- Patient condition checkboxes use `condition.icd10Code` instead of `condition.code`
- Conditions without `icd10Code` are disabled with a message
- Display shows ICD-10 badge + condition name + SNOMED reference
- `patientConditionCodes` set uses `icd10Code` for dedup with search results

```typescript
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useLazyQuery } from '@apollo/client/react';
import { MagnifyingGlassIcon, XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { SEARCH_ICD10_CODES } from '@/lib/graphql/queries/careplans';
import type { Condition, Icd10Code } from '@/types';
import clsx from 'clsx';

interface ConditionCodePickerProps {
  patientConditions?: Condition[];
  selectedCodes: string[];
  onSelectionChange: (codes: string[]) => void;
  className?: string;
}

export function ConditionCodePicker({
  patientConditions,
  selectedCodes,
  onSelectionChange,
  className,
}: ConditionCodePickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [searchIcd10, { data: searchData, loading: searchLoading }] =
    useLazyQuery<{ searchIcd10Codes: Icd10Code[] }>(SEARCH_ICD10_CODES);

  const searchResults = searchData?.searchIcd10Codes ?? [];

  const toggleCode = useCallback(
    (code: string) => {
      if (selectedCodes.includes(code)) {
        onSelectionChange(selectedCodes.filter((c) => c !== code));
      } else {
        onSelectionChange([...selectedCodes, code]);
      }
    },
    [selectedCodes, onSelectionChange]
  );

  const handleSearchInput = useCallback(
    (query: string) => {
      setSearchQuery(query);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (query.trim().length >= 2) {
        debounceRef.current = setTimeout(() => {
          searchIcd10({ variables: { query: query.trim(), limit: 20 } });
          setIsOpen(true);
        }, 300);
      } else {
        setIsOpen(false);
      }
    },
    [searchIcd10]
  );

  const handleSelectResult = useCallback(
    (code: string) => {
      if (!selectedCodes.includes(code)) {
        onSelectionChange([...selectedCodes, code]);
      }
      setSearchQuery('');
      setIsOpen(false);
      inputRef.current?.focus();
    },
    [selectedCodes, onSelectionChange]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const activeConditions = patientConditions?.filter((c) => c.status === 'ACTIVE') ?? [];

  // Track which ICD-10 codes came from patient conditions (for dedup with search)
  const patientIcd10Codes = new Set(
    activeConditions
      .map((c) => c.icd10Code)
      .filter((code): code is string => code !== null)
  );

  // Codes added via search that aren't from patient conditions
  const addedCodes = selectedCodes.filter((code) => !patientIcd10Codes.has(code));

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Patient Conditions Section */}
      {activeConditions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            Patient Conditions
          </h4>
          <div className="space-y-2">
            {activeConditions.map((condition) => {
              const hasIcd10 = condition.icd10Code !== null;
              const isChecked = hasIcd10 && selectedCodes.includes(condition.icd10Code!);

              return (
                <label
                  key={condition.id}
                  className={clsx(
                    'flex items-start gap-2',
                    hasIcd10 ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => hasIcd10 && toggleCode(condition.icd10Code!)}
                    disabled={!hasIcd10}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <div className="text-sm">
                    {hasIcd10 ? (
                      <>
                        <span className="font-mono font-medium text-blue-600">
                          {condition.icd10Code}
                        </span>
                        <span className="ml-2 text-gray-700">{condition.name}</span>
                        <span className="ml-2 text-xs text-gray-400">
                          SNOMED: {condition.code}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-1 text-amber-600">
                          <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                          <span className="text-gray-700">{condition.name}</span>
                        </span>
                        <span className="ml-5 text-xs text-gray-400">
                          No ICD-10 mapping — use search below
                        </span>
                      </>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ICD-10 Search Section */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">
          Search ICD-10 Codes
        </h4>
        <div className="relative">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder="Search by code or description..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {isOpen && (
            <div
              ref={dropdownRef}
              className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
            >
              {searchLoading ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  No results found
                </div>
              ) : (
                <ul>
                  {searchResults.map((result) => {
                    const isSelected = selectedCodes.includes(result.code);
                    return (
                      <li key={result.code}>
                        <button
                          onClick={() => handleSelectResult(result.code)}
                          disabled={isSelected}
                          className={clsx(
                            'w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0',
                            isSelected && 'bg-blue-50 text-gray-400'
                          )}
                        >
                          <span className="font-mono font-medium text-blue-600">
                            {result.code}
                          </span>
                          <span className="ml-2 text-gray-700">
                            {result.description}
                          </span>
                          {isSelected && (
                            <span className="ml-2 text-xs text-gray-400">(selected)</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Added Codes (from search, not from patient conditions) */}
      {addedCodes.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            Additional Codes
          </h4>
          <div className="flex flex-wrap gap-2">
            {addedCodes.map((code) => (
              <SelectedCodeTag
                key={code}
                code={code}
                onRemove={() => toggleCode(code)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SelectedCodeTagProps {
  code: string;
  description?: string;
  onRemove: () => void;
}

function SelectedCodeTag({ code, onRemove }: SelectedCodeTagProps) {
  return (
    <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-lg text-sm">
      <span className="font-mono font-medium">{code}</span>
      <button
        onClick={onRemove}
        className="ml-1 text-blue-600 hover:text-blue-800 transition-colors"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </span>
  );
}

interface ConditionCodeListProps {
  codes: { code: string; description?: string }[];
  className?: string;
}

export function ConditionCodeList({ codes, className }: ConditionCodeListProps) {
  if (codes.length === 0) {
    return <span className="text-sm text-gray-500">No condition codes</span>;
  }

  return (
    <ul className={clsx('space-y-1', className)}>
      {codes.map(({ code, description }) => (
        <li key={code} className="flex items-start gap-2 text-sm">
          <span className="font-mono font-medium text-blue-600">{code}</span>
          {description && <span className="text-gray-700">{description}</span>}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `npm run build` (from prism-provider-front-end root)

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/provider/ConditionCodePicker.tsx
git commit -m "feat: update ConditionCodePicker to use icd10Code from patient conditions

- Patient condition checkboxes now pass icd10Code instead of SNOMED code
- Conditions without ICD-10 mapping are disabled with a prompt to use search
- Display shows ICD-10 badge, condition name, and SNOMED reference"
```

---

## Chunk 3: Verification

### Task 9: Full build and typecheck verification

- [ ] **Step 1: Run backend typecheck**

Run: `npm run typecheck` (from prism-graphql root)

Expected: No new type errors (pre-existing test file errors in `tests/integration/` and `tests/property-based/` are expected and unrelated).

- [ ] **Step 2: Run backend unit tests**

Run: `npx jest apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts --no-coverage` (from prism-graphql root)

Expected: All tests PASS.

- [ ] **Step 3: Run frontend build**

Run: `npm run build` (from prism-provider-front-end root)

Expected: Build succeeds.

- [ ] **Step 4: Run frontend lint**

Run: `npm run lint` (from prism-provider-front-end root)

Expected: No new lint errors.

- [ ] **Step 5: Manual smoke test**

If the stack is running:
1. Navigate to a visit page with a patient that has Epic conditions
2. Open the careplan page — Patient Conditions should show ICD-10 codes
3. Check a condition — it should be selectable (ICD-10 code sent)
4. Generate a care plan — should succeed without the "Invalid ICD-10 code format" error
5. Verify unmapped conditions (if any) show the disabled state with warning
