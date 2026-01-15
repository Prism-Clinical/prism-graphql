# Care Plan Document Format Specification

**Version:** 1.0
**Last Updated:** 2024-01-03
**Purpose:** Standardized format for care plan documents that enables reliable automated parsing without AI/LLM.

---

## Overview

This specification defines a structured text format for care plan documents that:
- Is human-readable when rendered as PDF
- Can be reliably parsed using regex patterns
- Supports all required medical codes (ICD-10, SNOMED, RxNorm, LOINC, CPT)
- Separates structured data from clinical narrative content

---

## Document Structure

A compliant care plan document consists of the following sections in order:

```
1. DOCUMENT HEADER (required)
2. METADATA (required)
3. CONDITION CODES (required)
4. MEDICATION CODES (optional)
5. LAB CODES (optional)
6. PROCEDURE CODES (optional)
7. GOALS (required, minimum 1)
8. INTERVENTIONS (required, minimum 1)
9. CLINICAL CONTENT (optional)
10. DOCUMENT FOOTER (required)
```

---

## Section Specifications

### 1. Document Header

**Format:**
```
================================================================================
CARE PLAN DOCUMENT
================================================================================
```

**Rules:**
- Exactly 80 `=` characters on delimiter lines
- Text "CARE PLAN DOCUMENT" centered or left-aligned
- Must be first non-empty content in document

---

### 2. Metadata Section

**Format:**
```
[METADATA]
Title: <string, required>
Category: <enum, required>
Version: <semver, required>
Last Updated: <YYYY-MM-DD, required>
Author: <string, optional>
Guideline Source: <string, optional>
Evidence Grade: <A|B|C|D, optional>
```

**Category Values:**
- `CHRONIC_DISEASE` - Ongoing condition management
- `ACUTE_CARE` - Short-term illness/injury
- `PREVENTIVE_CARE` - Screening and prevention
- `POST_PROCEDURE` - Post-operative/procedure care
- `MEDICATION_MANAGEMENT` - Drug therapy optimization
- `LIFESTYLE_MODIFICATION` - Behavioral interventions
- `MENTAL_HEALTH` - Psychiatric/psychological care
- `PEDIATRIC` - Child-specific care
- `GERIATRIC` - Elderly-specific care

**Example:**
```
[METADATA]
Title: Strep Throat (GAS Pharyngitis) Care Pathway
Category: ACUTE_CARE
Version: 1.0
Last Updated: 2024-01-15
Author: Clinical Guidelines Committee
Guideline Source: CDC/IDSA Guidelines 2023
Evidence Grade: A
```

---

### 3. Code Sections

All code sections use the same table format.

**Format:**
```
[SECTION_NAME]
| Code       | System    | Description                         |
|------------|-----------|-------------------------------------|
| <code>     | <system>  | <description>                       |
```

**Section Names:**
- `[CONDITION CODES]` - ICD-10 and SNOMED codes for diagnoses
- `[MEDICATION CODES]` - RxNorm codes for medications
- `[LAB CODES]` - LOINC codes for laboratory tests
- `[PROCEDURE CODES]` - CPT codes for procedures

**System Values:**
- `ICD-10` - International Classification of Diseases, 10th revision
- `SNOMED` - SNOMED CT codes
- `RxNorm` - RxNorm medication codes
- `LOINC` - Logical Observation Identifiers Names and Codes
- `CPT` - Current Procedural Terminology

**Table Rules:**
- Header row must contain exactly: Code, System, Description
- Separator row uses `-` characters
- Pipe `|` characters delimit columns
- Whitespace around values is trimmed
- Empty sections should be omitted entirely

**Example:**
```
[CONDITION CODES]
| Code       | System    | Description                         |
|------------|-----------|-------------------------------------|
| J02.0      | ICD-10    | Streptococcal pharyngitis           |
| 43878008   | SNOMED    | Streptococcal sore throat           |
| 195668008  | SNOMED    | Acute pharyngitis                   |

[MEDICATION CODES]
| Code       | System    | Description                         |
|------------|-----------|-------------------------------------|
| 834061     | RxNorm    | Penicillin V Potassium 500 MG       |
| 308192     | RxNorm    | Amoxicillin 500 MG Oral Capsule     |
| 197511     | RxNorm    | Azithromycin 250 MG Oral Tablet     |
```

---

### 4. Goals Section

**Format:**
```
[GOALS]
GOAL-<NNN>:
  Description: <string, required>
  Target Value: <string, optional>
  Target Days: <integer, optional>
  Priority: <HIGH|MEDIUM|LOW, required>
  Guideline: <string, optional>
```

**Rules:**
- Goal IDs must be sequential: GOAL-001, GOAL-002, etc.
- Each field on its own line, indented with 2 spaces
- Description is required and should be actionable
- Priority must be one of: HIGH, MEDIUM, LOW

**Example:**
```
[GOALS]
GOAL-001:
  Description: Achieve complete symptom resolution
  Target Value: Symptom-free
  Target Days: 3
  Priority: HIGH
  Guideline: CDC Strep Treatment Guidelines

GOAL-002:
  Description: Complete full antibiotic course
  Target Value: 100% adherence
  Target Days: 10
  Priority: HIGH

GOAL-003:
  Description: Prevent suppurative complications
  Target Value: No complications
  Target Days: 14
  Priority: MEDIUM
```

---

### 5. Interventions Section

**Format:**
```
[INTERVENTIONS]
INT-<NNN>:
  Type: <enum, required>
  Description: <string, required>
  Medication Code: <string, conditional>
  Dosage: <string, conditional>
  Frequency: <string, conditional>
  Procedure Code: <string, conditional>
  Referral Specialty: <string, conditional>
  Schedule Days: <integer, optional>
  Instructions: <string, optional>
  Guideline: <string, optional>
```

**Type Values:**
- `MEDICATION` - Drug therapy (requires Medication Code, Dosage, Frequency)
- `PROCEDURE` - Medical procedure (requires Procedure Code)
- `MONITORING` - Ongoing assessment
- `EDUCATION` - Patient education
- `LIFESTYLE` - Behavioral modification
- `REFERRAL` - Specialist referral (requires Referral Specialty)
- `FOLLOW_UP` - Follow-up visit

**Frequency Abbreviations:**
- `QD` - Once daily
- `BID` - Twice daily
- `TID` - Three times daily
- `QID` - Four times daily
- `Q4H` - Every 4 hours
- `Q6H` - Every 6 hours
- `PRN` - As needed
- `ONCE` - Single administration

**Example:**
```
[INTERVENTIONS]
INT-001:
  Type: PROCEDURE
  Description: Rapid Antigen Detection Test (RADT) for Group A Strep
  Procedure Code: 87880
  Schedule Days: 0
  Instructions: Perform at initial presentation; swab both tonsils and posterior pharynx

INT-002:
  Type: MEDICATION
  Description: Penicillin V Potassium for bacterial eradication
  Medication Code: 834061
  Dosage: 500mg
  Frequency: BID
  Schedule Days: 10
  Instructions: Take on empty stomach for best absorption
  Guideline: First-line therapy per IDSA guidelines

INT-003:
  Type: EDUCATION
  Description: Antibiotic adherence counseling
  Schedule Days: 0
  Instructions: Emphasize completing full 10-day course even if symptoms resolve
```

---

### 6. Clinical Content Section

Free-form clinical narrative organized into subsections.

**Format:**
```
[CLINICAL CONTENT]
--- SUBSECTION NAME ---
<narrative text>

--- ANOTHER SUBSECTION ---
<narrative text>
```

**Standard Subsections:**
- `OVERVIEW` - General description of the condition/pathway
- `SYMPTOMS` - Signs and symptoms
- `DIAGNOSIS` - Diagnostic criteria and approach
- `TREATMENT` - Treatment approach summary
- `COMPLICATIONS` - Potential complications
- `FOLLOW_UP` - Follow-up recommendations
- `PATIENT_EDUCATION` - Patient teaching points
- `REFERENCES` - Clinical references

**Rules:**
- Subsection headers use `--- NAME ---` format
- Narrative text can include bullet points (using `-` prefix)
- This section is used for RAG context but not structured parsing

**Example:**
```
[CLINICAL CONTENT]
--- OVERVIEW ---
Streptococcal pharyngitis (strep throat) is an acute bacterial infection of the
oropharynx caused by Group A Streptococcus (GAS). It accounts for 15-30% of
pharyngitis cases in children and 5-15% in adults.

--- SYMPTOMS ---
- Sudden onset sore throat
- Fever (>38.0°C / 100.4°F)
- Tonsillar exudates
- Tender anterior cervical lymphadenopathy
- Absence of cough (Centor criteria)
- Headache
- Abdominal pain (especially in children)

--- DIAGNOSIS ---
Diagnosis requires microbiological confirmation:
1. Rapid Antigen Detection Test (RADT) - Results in 5-10 minutes
2. Throat culture - Gold standard, results in 24-48 hours

Use RADT for initial testing. If negative in high-suspicion cases, confirm with
throat culture in children/adolescents.
```

---

### 7. Document Footer

**Format:**
```
================================================================================
END OF DOCUMENT
================================================================================
```

---

## Complete Example

See: `care-plans/strep-throat-care-plan.txt`

---

## Parsing Implementation

### Regex Patterns

**Document Header:**
```regex
^={10,}\s*\n\s*CARE PLAN DOCUMENT\s*\n={10,}
```

**Section Headers:**
```regex
^\[([A-Z\s]+)\]\s*$
```

**Metadata Fields:**
```regex
^([A-Za-z\s]+):\s*(.+)$
```

**Code Table Rows:**
```regex
^\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|
```

**Goal/Intervention Blocks:**
```regex
^(GOAL|INT)-(\d{3}):\s*$
```

**Goal/Intervention Fields:**
```regex
^\s{2}([A-Za-z\s]+):\s*(.+)$
```

**Clinical Subsections:**
```regex
^---\s*([A-Z_]+)\s*---$
```

---

## Validation Rules

A valid care plan document must:

1. Start with the document header
2. Contain a `[METADATA]` section with required fields
3. Contain at least one `[CONDITION CODES]` entry
4. Contain at least one `[GOALS]` entry
5. Contain at least one `[INTERVENTIONS]` entry
6. End with the document footer
7. Use valid enum values for Category, Priority, Type
8. Have sequential IDs for goals (GOAL-001, GOAL-002...)
9. Have sequential IDs for interventions (INT-001, INT-002...)

---

## File Naming Convention

```
<condition-slug>-care-plan.txt
```

Examples:
- `strep-throat-care-plan.txt`
- `type-2-diabetes-care-plan.txt`
- `hypertension-care-plan.txt`
- `post-appendectomy-care-plan.txt`

---

## Version History

| Version | Date       | Changes                          |
|---------|------------|----------------------------------|
| 1.0     | 2024-01-03 | Initial specification release    |
