# CISS Federation Integration Tests

This document describes all integration tests for the CISS (Clinical Information and Support System) services.

## Overview

The CISS integration tests verify that Apollo Federation is working correctly across all four CISS services:

| Service | Port | Purpose |
|---------|------|---------|
| transcription-service | 4007 | Audio transcription management |
| rag-service | 4008 | Guideline retrieval & RAG synthesis |
| safety-service | 4009 | Safety validation & review queue |
| careplan-service | 4010 | Care plan structuring |

## Prerequisites

Before running the tests, ensure all services are running:

```bash
docker compose up -d
```

Verify services are healthy:

```bash
docker compose ps
```

## Running Tests

```bash
# Run all integration tests
npm run test:integration

# Run only CISS federation tests
npx jest tests/integration/ciss-federation.test.ts

# Run with verbose output
npx jest tests/integration/ciss-federation.test.ts --verbose

# Run with coverage
npx jest tests/integration/ciss-federation.test.ts --coverage
```

---

## Test Suites

### 1. Service Health Checks

Verifies that each service is running and responding to GraphQL requests.

| Test | Description | Expected Result |
|------|-------------|-----------------|
| `should verify gateway is healthy` | Sends `{ __typename }` query to gateway (port 4000) | Returns `{ data: { __typename: "Query" } }` |
| `should verify transcription-service is healthy` | Sends `{ __typename }` query to port 4007 | Returns `{ data: { __typename: "Query" } }` |
| `should verify rag-service is healthy` | Sends `{ __typename }` query to port 4008 | Returns `{ data: { __typename: "Query" } }` |
| `should verify safety-service is healthy` | Sends `{ __typename }` query to port 4009 | Returns `{ data: { __typename: "Query" } }` |
| `should verify careplan-service is healthy` | Sends `{ __typename }` query to port 4010 | Returns `{ data: { __typename: "Query" } }` |

---

### 2. Schema Federation

Verifies that CISS types are properly included in the federated supergraph schema.

| Test | Description | Types Verified |
|------|-------------|----------------|
| `should include Transcription types in federated schema` | Introspects schema for transcription types | `Transcription`, `TranscriptionConnection`, `TranscriptionStatus`, `TranscriptResult`, `ExtractedEntity` |
| `should include RAG/Guideline types in federated schema` | Introspects schema for RAG types | `Guideline`, `GuidelineConnection`, `RAGSynthesis`, `GuidelineCategory`, `GuidelineSource` |
| `should include Safety types in federated schema` | Introspects schema for safety types | `SafetyCheck`, `SafetyCheckConnection`, `ReviewQueueItem`, `SafetyValidationResult`, `SafetySeverity` |
| `should include CarePlan types in federated schema` | Introspects schema for care plan types | `CarePlan`, `CarePlanConnection`, `CarePlanGoal`, `CarePlanIntervention`, `CarePlanTemplate` |

---

### 3. Transcription Service Queries

Tests the transcription-service query resolvers.

#### `should query transcriptions list`

```graphql
query GetTranscriptions {
  transcriptions {
    edges {
      node {
        id
        status
        audioUri
        createdAt
      }
      cursor
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
    }
    totalCount
  }
}
```

**Expected:** Returns connection with edges, pageInfo, and totalCount.

#### `should query transcriptions with filter`

```graphql
query GetTranscriptionsByStatus($status: TranscriptionStatus) {
  transcriptions(filter: { status: $status }) {
    edges {
      node {
        id
        status
      }
    }
    totalCount
  }
}
```

**Variables:** `{ "status": "PENDING" }`

**Expected:** Returns filtered transcriptions by status.

---

### 4. RAG Service Queries

Tests the rag-service query resolvers for guidelines.

#### `should query guidelines list`

```graphql
query GetGuidelines {
  guidelines {
    edges {
      node {
        id
        title
        source
        category
        evidenceGrade
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
    totalCount
  }
}
```

**Expected:** Returns connection with guideline nodes.

#### `should query guidelines with filter`

```graphql
query GetGuidelinesByCategory($category: GuidelineCategory) {
  guidelines(filter: { category: $category }) {
    edges {
      node {
        id
        title
        category
      }
    }
    totalCount
  }
}
```

**Variables:** `{ "category": "TREATMENT" }`

**Valid Categories:** `SCREENING`, `PREVENTION`, `TREATMENT`, `MONITORING`, `LIFESTYLE`, `IMMUNIZATION`

---

### 5. Safety Service Queries

Tests the safety-service query resolvers.

#### `should query safety checks list`

```graphql
query GetSafetyChecks {
  safetyChecks {
    edges {
      node {
        id
        checkType
        status
        severity
        title
        description
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
    totalCount
  }
}
```

**Expected:** Returns connection with safety check nodes.

#### `should query review queue`

```graphql
query GetReviewQueue {
  reviewQueue {
    edges {
      node {
        id
        status
        priority
        isOverdue
        slaDeadline
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
    totalCount
  }
}
```

**Expected:** Returns connection with review queue items.

---

### 6. CarePlan Service Queries

Tests the careplan-service query resolvers.

#### `should query care plans list`

```graphql
query GetCarePlans {
  carePlans {
    edges {
      node {
        id
        title
        status
        startDate
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
    totalCount
  }
}
```

**Expected:** Returns connection with care plan nodes.

#### `should query care plan templates`

```graphql
query GetCarePlanTemplates {
  carePlanTemplates {
    edges {
      node {
        id
        name
        category
        isActive
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
    totalCount
  }
}
```

**Expected:** Returns connection with template nodes.

---

### 7. Cross-Service Federation (Patient -> CISS)

Tests that the Patient type extensions work correctly across service boundaries. These verify Apollo Federation's entity resolution.

#### `should resolve Patient.transcriptions via federation`

```graphql
query GetPatientWithTranscriptions($id: ID!) {
  patient(id: $id) {
    id
    firstName
    lastName
    transcriptions {
      edges {
        node {
          id
          status
        }
      }
      totalCount
    }
  }
}
```

**Services Involved:** patients-service -> transcription-service

**Expected:** Patient data from patients-service with transcriptions resolved from transcription-service.

#### `should resolve Patient.carePlans via federation`

```graphql
query GetPatientWithCarePlans($id: ID!) {
  patient(id: $id) {
    id
    firstName
    carePlans {
      edges {
        node {
          id
          title
          status
        }
      }
      totalCount
    }
    activeCarePlan {
      id
      title
    }
  }
}
```

**Services Involved:** patients-service -> careplan-service

#### `should resolve Patient.safetyChecks via federation`

```graphql
query GetPatientWithSafetyChecks($id: ID!) {
  patient(id: $id) {
    id
    firstName
    safetyChecks {
      edges {
        node {
          id
          checkType
          severity
          status
          title
        }
      }
      totalCount
    }
    activeSafetyAlerts {
      id
      title
      description
    }
  }
}
```

**Services Involved:** patients-service -> safety-service

#### `should resolve Patient.applicableGuidelines via federation`

```graphql
query GetPatientWithGuidelines($id: ID!) {
  patient(id: $id) {
    id
    firstName
    applicableGuidelines {
      edges {
        node {
          id
          title
          category
        }
      }
      totalCount
    }
    ragSyntheses {
      id
      queryType
      status
    }
  }
}
```

**Services Involved:** patients-service -> rag-service

---

### 8. CISS Mutations

Tests that mutations are accessible through the federated gateway.

#### `should submit a transcription`

```graphql
mutation SubmitTranscription($input: TranscribeAudioInput!) {
  submitTranscription(input: $input) {
    id
    status
    audioUri
    patient {
      id
    }
  }
}
```

**Variables:**
```json
{
  "input": {
    "patientId": "test-patient-id",
    "audioUri": "gs://test-bucket/test-audio.wav",
    "speakerCount": 2
  }
}
```

#### `should request a RAG synthesis`

```graphql
mutation RequestRAGSynthesis($input: RAGQueryInput!) {
  requestRAGSynthesis(input: $input) {
    id
    status
    queryType
    patient {
      id
    }
  }
}
```

**Variables:**
```json
{
  "input": {
    "patientId": "test-patient-id",
    "queryType": "BY_CONDITION",
    "conditionCodes": ["E11.9"]
  }
}
```

**Valid Query Types:** `BY_CONDITION`, `BY_MEDICATION`, `BY_DEMOGRAPHICS`, `BY_GUIDELINE_ID`

#### `should validate safety`

```graphql
mutation ValidateSafety($input: SafetyValidationInput!) {
  validateSafety(input: $input) {
    isValid
    checks {
      id
      checkType
      severity
      status
      title
      description
    }
    blockers {
      id
      title
      description
    }
    warnings {
      id
      title
      description
    }
    requiresReview
  }
}
```

**Variables:**
```json
{
  "input": {
    "patientId": "test-patient-id",
    "medicationCodes": ["RxNorm:123456"],
    "checkTypes": ["DRUG_INTERACTION", "ALLERGY_CONFLICT"]
  }
}
```

**Valid Check Types:** `DRUG_INTERACTION`, `ALLERGY_CONFLICT`, `CONTRAINDICATION`, `DOSAGE_VALIDATION`, `DUPLICATE_THERAPY`, `AGE_APPROPRIATENESS`, `PREGNANCY_SAFETY`, `RENAL_ADJUSTMENT`, `HEPATIC_ADJUSTMENT`

#### `should create a care plan`

```graphql
mutation CreateCarePlan($input: CreateCarePlanInput!) {
  createCarePlan(input: $input) {
    id
    title
    status
    patient {
      id
    }
    goals {
      id
      description
    }
    interventions {
      id
      type
      description
    }
  }
}
```

**Variables:**
```json
{
  "input": {
    "patientId": "test-patient-id",
    "title": "Test Care Plan",
    "conditionCodes": ["E11.9"],
    "startDate": "2024-01-01T00:00:00Z"
  }
}
```

---

### 9. Error Handling

Tests that errors are properly returned.

#### `should return proper error for non-existent transcription`

```graphql
query GetTranscription($id: ID!) {
  transcription(id: $id) {
    id
    status
  }
}
```

**Variables:** `{ "id": "non-existent-id" }`

**Expected:** Returns `{ data: { transcription: null } }` (no errors)

#### `should return proper error for non-existent care plan`

```graphql
query GetCarePlan($id: ID!) {
  carePlan(id: $id) {
    id
    title
  }
}
```

**Variables:** `{ "id": "non-existent-id" }`

**Expected:** Returns `{ data: { carePlan: null } }` (no errors)

#### `should validate required mutation inputs`

Tests that GraphQL validation errors are returned for missing required fields.

```graphql
mutation SubmitTranscription($input: TranscribeAudioInput!) {
  submitTranscription(input: $input) {
    id
  }
}
```

**Variables:** `{ "input": { "audioUri": "gs://test-bucket/test.wav" } }` (missing required `patientId`)

**Expected:** Returns GraphQL validation error for missing required field.

---

## Test Utilities

### GraphQL Client

Located at `shared/test-utils/graphql-client.ts`

```typescript
import { createGraphQLClient, gatewayClient } from '../../shared/test-utils/graphql-client';

// Use pre-configured gateway client
const result = await gatewayClient.request(query, variables);

// Or create custom client
const client = createGraphQLClient({ url: 'http://localhost:4007' });
const isHealthy = await client.healthCheck();
const types = await client.getSchemaTypes();
```

### Service URLs

```typescript
import { SERVICE_URLS } from '../../shared/test-utils/graphql-client';

// Available URLs:
// SERVICE_URLS.GATEWAY - http://localhost:4000
// SERVICE_URLS.TRANSCRIPTION - http://localhost:4007
// SERVICE_URLS.RAG - http://localhost:4008
// SERVICE_URLS.SAFETY - http://localhost:4009
// SERVICE_URLS.CAREPLAN - http://localhost:4010
```

---

## Troubleshooting

### Tests fail with connection errors

Ensure Docker services are running:

```bash
docker compose up -d
docker compose ps
```

### Tests fail with schema errors

Regenerate types and rebuild:

```bash
docker compose build --no-cache
docker compose up -d
```

### Gateway shows "unhealthy" but tests pass

The Docker health check timeout may be too short. Services are likely working if tests pass.

### Cross-service tests skip with patient creation error

This is expected if the patients table requires fields not provided in the test. The test gracefully skips and logs the reason.
