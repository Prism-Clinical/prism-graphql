# PHI Classification Guide

This document describes the Protected Health Information (PHI) classification system used in PRISM.

## Classification Levels

### NONE
- **Description**: No PHI - Safe to log, cache, and share freely
- **Examples**: Internal IDs (UUIDs), timestamps, system metadata
- **Handling**: No special restrictions

### INDIRECT
- **Description**: Indirectly identifying information that could contribute to identification when combined
- **Examples**: Age, gender, zip code (first 3 digits)
- **Handling**: May be cached with standard TTL, can be logged, limited sharing

### DIRECT
- **Description**: Directly identifying information - can identify a patient on its own
- **Examples**: Name, MRN, date of birth, email, phone, address, SSN
- **Handling**: Must be encrypted at rest, cannot be logged, restricted sharing

### SENSITIVE
- **Description**: Sensitive health information - protected health data
- **Examples**: Diagnoses, medications, symptoms, treatments, transcripts
- **Handling**: Must be encrypted, short cache TTL, audit all access

## HIPAA 18 Identifiers

PRISM tracks the 18 HIPAA identifiers:

1. Names
2. Geographic data (smaller than state)
3. Dates (except year) related to individual
4. Telephone numbers
5. FAX numbers
6. Email addresses
7. Social Security Numbers
8. Medical record numbers
9. Health plan beneficiary numbers
10. Account numbers
11. Certificate/license numbers
12. Vehicle identifiers and serial numbers
13. Device identifiers and serial numbers
14. Web URLs
15. IP addresses
16. Biometric identifiers
17. Full-face photographs
18. Any unique identifying number or code

## Field Classifications

### Patient Entity
| Field | Level | Handling |
|-------|-------|----------|
| Patient.id | NONE | Internal UUID |
| Patient.firstName | DIRECT | Encrypt, no log |
| Patient.lastName | DIRECT | Encrypt, no log |
| Patient.mrn | DIRECT | Encrypt, no log |
| Patient.dateOfBirth | DIRECT | Encrypt, no log |
| Patient.email | DIRECT | Encrypt, no log |
| Patient.phone | DIRECT | Encrypt, no log |
| Patient.address | DIRECT | Encrypt, no log |
| Patient.age | INDIRECT | May cache |
| Patient.gender | INDIRECT | May cache |

### Care Plan Entity
| Field | Level | Handling |
|-------|-------|----------|
| CarePlan.id | NONE | Internal UUID |
| CarePlan.title | SENSITIVE | May contain condition |
| CarePlan.goals | SENSITIVE | Health information |
| CarePlan.interventions | SENSITIVE | Treatment info |
| CarePlan.conditionCodes | SENSITIVE | ICD-10 codes |

### Transcript Entity
| Field | Level | Handling |
|-------|-------|----------|
| Transcript.text | SENSITIVE | Full PHI |
| Transcript.audioUrl | SENSITIVE | Biometric |

### Extracted Entities
| Field | Level | Handling |
|-------|-------|----------|
| ExtractedEntities.symptoms | SENSITIVE | Health info |
| ExtractedEntities.medications | SENSITIVE | Prescriptions |
| ExtractedEntities.diagnoses | SENSITIVE | Health info |
| ExtractedEntities.procedures | SENSITIVE | Treatment |
| ExtractedEntities.vitals | SENSITIVE | Health metrics |

## Handling Requirements

### Encryption Requirements
- **DIRECT** and **SENSITIVE** fields MUST be encrypted at rest
- Use AES-256-GCM with unique IV per entry
- Keys must be rotated every 90 days
- Envelope encryption with GCP KMS recommended

### Caching Requirements
| Level | Max TTL | Encryption Required |
|-------|---------|---------------------|
| NONE | 1 hour | No |
| INDIRECT | 30 min | No |
| DIRECT | 5 min | Yes |
| SENSITIVE | 5 min | Yes |

### Logging Requirements
- **NONE**: May include in logs
- **INDIRECT**: May include in logs
- **DIRECT**: MUST NOT log values, mask or omit
- **SENSITIVE**: MUST NOT log values, mask or omit

### ML Service Requirements
| Level | Can Send | Minimization |
|-------|----------|--------------|
| NONE | Yes | N/A |
| INDIRECT | Yes | Aggregate when possible |
| DIRECT | No | Strip before sending |
| SENSITIVE | Conditional | Only when required for processing |

## GraphQL Directive Usage

```graphql
directive @phi(level: PHILevel!) on FIELD_DEFINITION

enum PHILevel {
  NONE
  INDIRECT
  DIRECT
  SENSITIVE
}

type Patient {
  id: ID!
  firstName: String! @phi(level: DIRECT)
  lastName: String! @phi(level: DIRECT)
  mrn: String! @phi(level: DIRECT)
  dateOfBirth: Date! @phi(level: DIRECT)
  age: Int @phi(level: INDIRECT)
  gender: Gender @phi(level: INDIRECT)
}

type CarePlan {
  id: ID!
  title: String! @phi(level: SENSITIVE)
  goals: [CarePlanGoal!]! @phi(level: SENSITIVE)
  interventions: [CarePlanIntervention!]! @phi(level: SENSITIVE)
}
```

## Audit Requirements

All PHI access MUST be logged with:
- User ID and role
- Patient ID (if applicable)
- Fields accessed
- Timestamp
- Request ID
- Outcome

Audit logs are immutable and retained for 7 years per HIPAA requirements.

## Data Minimization

When sending data to ML services:
1. Strip all DIRECT identifiers
2. Send only fields required for the operation
3. Use age ranges instead of DOB when possible
4. Anonymize or pseudonymize when feasible

## Compliance Contacts

For PHI classification questions or data handling concerns:
- Security Team: security@prism.health
- Compliance Officer: compliance@prism.health
- Privacy Officer: privacy@prism.health
