import {
  transformPatient,
  transformVitals,
  transformLabResults,
  transformMedications,
  transformConditions,
} from "../services/transforms";
import type { FHIRPatient, FHIRMedicationRequest, FHIRCondition, FHIRMedication } from "../clients/epic-fhir-client";
import type { FHIRObservation } from "../clients/feature-extraction-client";

// =============================================================================
// transformPatient
// =============================================================================

describe("transformPatient", () => {
  it("extracts basic demographics from a full patient", () => {
    const fhir: FHIRPatient = {
      id: "abc123",
      active: true,
      name: [
        { use: "official", family: "Smith", given: ["Jane", "Marie"], prefix: ["Dr."], suffix: ["MD"] },
        { use: "nickname", given: ["Janie"] },
      ],
      gender: "female",
      birthDate: "1990-03-15",
      identifier: [
        { system: "http://hospital.smarthealthit.org", value: "12345", type: { coding: [{ code: "MR" }] } },
        { system: "http://hl7.org/fhir/sid/us-ssn", value: "999-99-1234" },
      ],
      telecom: [
        { system: "phone", value: "555-1234", use: "home", rank: 1 },
        { system: "email", value: "jane@example.com", use: "work" },
      ],
      address: [
        {
          use: "home",
          type: "physical",
          line: ["123 Main St", "Apt 4"],
          city: "Boston",
          state: "MA",
          postalCode: "02101",
          country: "US",
        },
      ],
      maritalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus", code: "M", display: "Married" }], text: "Married" },
      deceasedBoolean: false,
    };

    const result = transformPatient(fhir);

    expect(result.firstName).toBe("Jane");
    expect(result.lastName).toBe("Smith");
    expect(result.gender).toBe("female");
    expect(result.dateOfBirth).toBe("1990-03-15");
    expect(result.mrn).toBe("12345");
    expect(result.active).toBe(true);
    expect(result.deceasedBoolean).toBe(false);
    expect(result.deceasedDateTime).toBeNull();
    expect(result.maritalStatus).toEqual({
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus", code: "M", display: "Married" }],
      text: "Married",
    });
  });

  it("uses official name when available", () => {
    const fhir: FHIRPatient = {
      name: [
        { use: "usual", family: "Doe", given: ["John"] },
        { use: "official", family: "Doe-Smith", given: ["Jonathan"] },
      ],
    };

    const result = transformPatient(fhir);
    expect(result.firstName).toBe("Jonathan");
    expect(result.lastName).toBe("Doe-Smith");
  });

  it("falls back to first name when no official name", () => {
    const fhir: FHIRPatient = {
      name: [{ family: "Doe", given: ["John"] }],
    };

    const result = transformPatient(fhir);
    expect(result.firstName).toBe("John");
    expect(result.lastName).toBe("Doe");
  });

  it("finds MRN identifier by type code MR", () => {
    const fhir: FHIRPatient = {
      identifier: [
        { system: "http://other", value: "other-id" },
        { system: "http://hospital", value: "MRN-001", type: { coding: [{ code: "MR" }] } },
      ],
    };

    const result = transformPatient(fhir);
    expect(result.mrn).toBe("MRN-001");
  });

  it("finds MRN identifier by Epic system OID", () => {
    const fhir: FHIRPatient = {
      identifier: [
        { system: "urn:oid:1.2.840.114350.1.13", value: "E1234" },
      ],
    };

    const result = transformPatient(fhir);
    expect(result.mrn).toBe("E1234");
  });

  it("handles missing optional fields gracefully", () => {
    const fhir: FHIRPatient = {};

    const result = transformPatient(fhir);

    expect(result.firstName).toBe("");
    expect(result.lastName).toBe("");
    expect(result.gender).toBe("");
    expect(result.dateOfBirth).toBe("");
    expect(result.mrn).toBe("");
    expect(result.active).toBeNull();
    expect(result.deceasedBoolean).toBeNull();
    expect(result.deceasedDateTime).toBeNull();
    expect(result.maritalStatus).toBeNull();
    expect(result.raceEthnicity).toBeNull();
    expect(result.identifiers).toEqual([]);
    expect(result.names).toEqual([]);
    expect(result.telecom).toEqual([]);
    expect(result.addresses).toEqual([]);
    expect(result.emergencyContacts).toEqual([]);
    expect(result.communications).toEqual([]);
    expect(result.generalPractitioner).toEqual([]);
  });

  it("transforms telecom contacts", () => {
    const fhir: FHIRPatient = {
      telecom: [
        { system: "phone", value: "555-0100", use: "home", rank: 1 },
        { system: "email", value: "test@example.com", use: "work" },
      ],
    };

    const result = transformPatient(fhir);
    expect(result.telecom).toHaveLength(2);
    expect(result.telecom[0]).toEqual({ system: "phone", value: "555-0100", use: "home", rank: 1 });
    expect(result.telecom[1]).toEqual({ system: "email", value: "test@example.com", use: "work", rank: null });
  });

  it("transforms addresses", () => {
    const fhir: FHIRPatient = {
      address: [
        { use: "home", line: ["100 Oak Ave"], city: "Springfield", state: "IL", postalCode: "62701", country: "US" },
      ],
    };

    const result = transformPatient(fhir);
    expect(result.addresses).toHaveLength(1);
    expect(result.addresses[0].line).toEqual(["100 Oak Ave"]);
    expect(result.addresses[0].city).toBe("Springfield");
    expect(result.addresses[0].state).toBe("IL");
  });

  it("transforms emergency contacts", () => {
    const fhir: FHIRPatient = {
      contact: [
        {
          relationship: [{ coding: [{ code: "C", display: "Emergency Contact" }] }],
          name: { family: "Smith", given: ["Bob"] },
          telecom: [{ system: "phone", value: "555-9999" }],
          gender: "male",
        },
      ],
    };

    const result = transformPatient(fhir);
    expect(result.emergencyContacts).toHaveLength(1);
    expect(result.emergencyContacts[0].name?.family).toBe("Smith");
    expect(result.emergencyContacts[0].gender).toBe("male");
  });

  it("transforms communications", () => {
    const fhir: FHIRPatient = {
      communication: [
        { language: { coding: [{ code: "en", display: "English" }] }, preferred: true },
        { language: { coding: [{ code: "es", display: "Spanish" }] } },
      ],
    };

    const result = transformPatient(fhir);
    expect(result.communications).toHaveLength(2);
    expect(result.communications[0].preferred).toBe(true);
    expect(result.communications[1].preferred).toBeNull();
  });

  it("extracts US Core race and ethnicity extensions", () => {
    const fhir: FHIRPatient = {
      extension: [
        {
          url: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race",
          extension: [
            { url: "ombCategory", valueCoding: { system: "urn:oid:2.16.840.1.113883.6.238", code: "2106-3", display: "White" } },
            { url: "text", valueString: "White" },
          ],
        },
        {
          url: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity",
          extension: [
            { url: "ombCategory", valueCoding: { system: "urn:oid:2.16.840.1.113883.6.238", code: "2186-5", display: "Not Hispanic or Latino" } },
            { url: "text", valueString: "Not Hispanic or Latino" },
          ],
        },
      ],
    };

    const result = transformPatient(fhir);
    expect(result.raceEthnicity).not.toBeNull();
    expect(result.raceEthnicity!.race).toHaveLength(1);
    expect(result.raceEthnicity!.race[0].display).toBe("White");
    expect(result.raceEthnicity!.raceText).toBe("White");
    expect(result.raceEthnicity!.ethnicity).toHaveLength(1);
    expect(result.raceEthnicity!.ethnicityText).toBe("Not Hispanic or Latino");
  });

  it("returns null raceEthnicity when no extensions present", () => {
    const fhir: FHIRPatient = {
      extension: [{ url: "http://other/extension" }],
    };

    const result = transformPatient(fhir);
    expect(result.raceEthnicity).toBeNull();
  });
});

// =============================================================================
// transformVitals
// =============================================================================

describe("transformVitals", () => {
  it("transforms single-value observations", () => {
    const observations: FHIRObservation[] = [
      {
        resourceType: "Observation",
        id: "obs-1",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }] },
        valueQuantity: { value: 72, unit: "beats/min" },
        effectiveDateTime: "2024-01-15T10:00:00Z",
        issued: "2024-01-15T10:05:00Z",
      },
    ];

    const result = transformVitals(observations);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("Heart rate");
    expect(result[0].value).toBe(72);
    expect(result[0].unit).toBe("beats/min");
    expect(result[0].recordedDate).toBe("2024-01-15T10:00:00Z");
    expect(result[0].status).toBe("final");
    expect(result[0].category).toBe("vital-signs");
    expect(result[0].isNormalized).toBe(false);
    expect(result[0].issuedDate).toBe("2024-01-15T10:05:00Z");
    expect(result[0].code!.coding[0].code).toBe("8867-4");
  });

  it("transforms component-based observations (blood pressure)", () => {
    const observations: FHIRObservation[] = [
      {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure" }] },
        effectiveDateTime: "2024-01-15T10:00:00Z",
        component: [
          {
            code: { coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }] },
            valueQuantity: { value: 120, unit: "mmHg" },
          },
          {
            code: { coding: [{ system: "http://loinc.org", code: "8462-4", display: "Diastolic blood pressure" }] },
            valueQuantity: { value: 80, unit: "mmHg" },
          },
        ],
      },
    ];

    const result = transformVitals(observations);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("Systolic blood pressure");
    expect(result[0].value).toBe(120);
    expect(result[1].type).toBe("Diastolic blood pressure");
    expect(result[1].value).toBe(80);
  });

  it("skips observations without value or components", () => {
    const observations: FHIRObservation[] = [
      {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "0000", display: "No value" }] },
      },
    ];

    const result = transformVitals(observations);
    expect(result).toHaveLength(0);
  });

  it("transforms interpretation and reference ranges", () => {
    const observations: FHIRObservation[] = [
      {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }] },
        valueQuantity: { value: 100, unit: "beats/min" },
        effectiveDateTime: "2024-01-15T10:00:00Z",
        interpretation: [{ coding: [{ code: "H", display: "High" }] }],
        referenceRange: [{ low: { value: 60, unit: "beats/min" }, high: { value: 100, unit: "beats/min" } }],
      },
    ];

    const result = transformVitals(observations);

    expect(result[0].interpretation).toHaveLength(1);
    expect(result[0].interpretation[0].coding[0].code).toBe("H");
    expect(result[0].referenceRange).toHaveLength(1);
    expect(result[0].referenceRange[0].low).toBe(60);
    expect(result[0].referenceRange[0].high).toBe(100);
  });

  it("handles empty observation array", () => {
    const result = transformVitals([]);
    expect(result).toEqual([]);
  });

  it("transforms performer and encounter references", () => {
    const observations: FHIRObservation[] = [
      {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "8310-5", display: "Temperature" }] },
        valueQuantity: { value: 98.6, unit: "F" },
        effectiveDateTime: "2024-01-15T10:00:00Z",
        performer: [{ reference: "Practitioner/123", display: "Dr. Smith" }],
        encounter: { reference: "Encounter/456", display: "Office Visit" },
      },
    ];

    const result = transformVitals(observations);
    expect(result[0].performer).toHaveLength(1);
    expect(result[0].performer[0].display).toBe("Dr. Smith");
    expect(result[0].encounter?.display).toBe("Office Visit");
  });
});

// =============================================================================
// transformLabResults
// =============================================================================

describe("transformLabResults", () => {
  it("transforms lab observations with valueQuantity", () => {
    const observations: FHIRObservation[] = [
      {
        resourceType: "Observation",
        id: "lab-1",
        status: "final",
        category: [{ coding: [{ code: "laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "2345-7", display: "Glucose" }], text: "Glucose" },
        valueQuantity: { value: 95, unit: "mg/dL" },
        effectiveDateTime: "2024-01-15T10:00:00Z",
        issued: "2024-01-15T12:00:00Z",
      },
    ];

    const result = transformLabResults(observations);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("lab-1");
    expect(result[0].status).toBe("final");
    expect(result[0].category).toBe("laboratory");
    expect(result[0].code.coding[0].display).toBe("Glucose");
    expect(result[0].valueQuantity).toBe(95);
    expect(result[0].valueUnit).toBe("mg/dL");
    expect(result[0].effectiveDateTime).toBe("2024-01-15T10:00:00Z");
    expect(result[0].issuedDate).toBe("2024-01-15T12:00:00Z");
  });

  it("transforms lab observations with valueString", () => {
    const observations: FHIRObservation[] = [
      {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "630-4", display: "Culture" }] },
        valueString: "No growth",
      },
    ];

    const result = transformLabResults(observations);
    expect(result[0].valueString).toBe("No growth");
    expect(result[0].valueQuantity).toBeNull();
  });

  it("transforms lab observations with valueCodeableConcept", () => {
    const observations: FHIRObservation[] = [
      {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "882-1", display: "Blood type" }] },
        valueCodeableConcept: { coding: [{ code: "A+", display: "A positive" }], text: "A+" },
      },
    ];

    const result = transformLabResults(observations);
    expect(result[0].valueCodeableConcept).not.toBeNull();
    expect(result[0].valueCodeableConcept!.text).toBe("A+");
  });

  it("transforms interpretation and reference ranges for labs", () => {
    const observations: FHIRObservation[] = [
      {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "718-7", display: "Hemoglobin" }] },
        valueQuantity: { value: 11.0, unit: "g/dL" },
        interpretation: [{ coding: [{ code: "L", display: "Low" }] }],
        referenceRange: [{ low: { value: 12.0, unit: "g/dL" }, high: { value: 16.0, unit: "g/dL" }, text: "12.0 - 16.0" }],
      },
    ];

    const result = transformLabResults(observations);
    expect(result[0].interpretation[0].coding[0].code).toBe("L");
    expect(result[0].referenceRange[0].low).toBe(12.0);
    expect(result[0].referenceRange[0].high).toBe(16.0);
    expect(result[0].referenceRange[0].text).toBe("12.0 - 16.0");
  });

  it("transforms notes", () => {
    const observations: FHIRObservation[] = [
      {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "58410-2", display: "CBC" }] },
        note: [{ text: "Fasting sample" }, { text: "Repeat in 2 weeks" }],
      },
    ];

    const result = transformLabResults(observations);
    expect(result[0].notes).toEqual(["Fasting sample", "Repeat in 2 weeks"]);
  });

  it("handles empty observation array", () => {
    const result = transformLabResults([]);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// transformMedications
// =============================================================================

describe("transformMedications", () => {
  it("transforms medication with medicationCodeableConcept", () => {
    const medRequests: FHIRMedicationRequest[] = [
      {
        id: "med-1",
        status: "active",
        intent: "order",
        medicationCodeableConcept: {
          coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "197361", display: "Lisinopril 10 MG" }],
          text: "Lisinopril 10mg",
        },
        dosageInstruction: [{ text: "Take one tablet daily", sequence: 1 }],
        authoredOn: "2024-01-01",
      },
    ];

    const result = transformMedications(medRequests, new Map());

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Lisinopril 10mg");
    expect(result[0].status).toBe("active");
    expect(result[0].intent).toBe("order");
    expect(result[0].id).toBe("med-1");
    expect(result[0].dosage).toBe("Take one tablet daily");
    expect(result[0].authoredOn).toBe("2024-01-01");
    expect(result[0].medicationCode).not.toBeNull();
    expect(result[0].medicationReference).toBeNull();
  });

  it("resolves medication from medicationReference", () => {
    const medRequests: FHIRMedicationRequest[] = [
      {
        id: "med-2",
        status: "active",
        intent: "order",
        medicationReference: { reference: "Medication/abc", display: "Fallback Name" },
      },
    ];

    const resolvedMeds = new Map<string, FHIRMedication>();
    resolvedMeds.set("Medication/abc", {
      resourceType: "Medication",
      id: "abc",
      code: { coding: [{ display: "Metformin 500mg" }], text: "Metformin 500mg" },
    });

    const result = transformMedications(medRequests, resolvedMeds);

    expect(result[0].name).toBe("Metformin 500mg");
    expect(result[0].medicationReference).not.toBeNull();
    expect(result[0].medicationReference!.reference).toBe("Medication/abc");
  });

  it("falls back to reference display when medication not resolved", () => {
    const medRequests: FHIRMedicationRequest[] = [
      {
        status: "active",
        intent: "order",
        medicationReference: { reference: "Medication/xyz", display: "Aspirin" },
      },
    ];

    const result = transformMedications(medRequests, new Map());
    expect(result[0].name).toBe("Aspirin");
  });

  it("returns 'Unknown' when no medication info available", () => {
    const medRequests: FHIRMedicationRequest[] = [
      { status: "active", intent: "order" },
    ];

    const result = transformMedications(medRequests, new Map());
    expect(result[0].name).toBe("Unknown");
  });

  it("transforms full dosage instructions", () => {
    const medRequests: FHIRMedicationRequest[] = [
      {
        status: "active",
        intent: "order",
        medicationCodeableConcept: { text: "Test Med" },
        dosageInstruction: [
          {
            sequence: 1,
            text: "Take 2 tablets twice daily",
            route: { coding: [{ display: "Oral" }] },
            method: { coding: [{ display: "Swallow" }] },
            doseAndRate: [{ doseQuantity: { value: 2, unit: "tablet" } }],
          },
        ],
      },
    ];

    const result = transformMedications(medRequests, new Map());
    expect(result[0].dosageInstructions).toHaveLength(1);
    expect(result[0].dosageInstructions[0].sequence).toBe(1);
    expect(result[0].dosageInstructions[0].text).toBe("Take 2 tablets twice daily");
    expect(result[0].dosageInstructions[0].route!.coding[0].display).toBe("Oral");
    expect(result[0].dosageInstructions[0].doseQuantity).toBe(2);
    expect(result[0].dosageInstructions[0].doseUnit).toBe("tablet");
  });

  it("transforms dispense request", () => {
    const medRequests: FHIRMedicationRequest[] = [
      {
        status: "active",
        intent: "order",
        medicationCodeableConcept: { text: "Test Med" },
        dispenseRequest: {
          numberOfRepeatsAllowed: 3,
          quantity: { value: 30, unit: "tablet" },
          expectedSupplyDuration: { value: 30, unit: "day" },
        },
      },
    ];

    const result = transformMedications(medRequests, new Map());
    expect(result[0].dispenseRequest).not.toBeNull();
    expect(result[0].dispenseRequest!.numberOfRepeatsAllowed).toBe(3);
    expect(result[0].dispenseRequest!.quantity).toBe(30);
    expect(result[0].dispenseRequest!.expectedSupplyDuration).toBe(30);
  });

  it("transforms notes", () => {
    const medRequests: FHIRMedicationRequest[] = [
      {
        status: "active",
        intent: "order",
        medicationCodeableConcept: { text: "Test Med" },
        note: [{ text: "Patient allergic to generic" }],
      },
    ];

    const result = transformMedications(medRequests, new Map());
    expect(result[0].notes).toEqual(["Patient allergic to generic"]);
  });

  it("handles empty medication array", () => {
    const result = transformMedications([], new Map());
    expect(result).toEqual([]);
  });
});

// =============================================================================
// transformConditions
// =============================================================================

describe("transformConditions", () => {
  it("transforms a full condition", () => {
    const conditions: FHIRCondition[] = [
      {
        id: "cond-1",
        clinicalStatus: { coding: [{ code: "active", display: "Active" }] },
        verificationStatus: { coding: [{ code: "confirmed", display: "Confirmed" }] },
        category: [{ coding: [{ code: "encounter-diagnosis", display: "Encounter Diagnosis" }] }],
        severity: { coding: [{ code: "moderate", display: "Moderate" }] },
        code: { coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" }] },
        onsetDateTime: "2020-06-15",
        recordedDate: "2020-06-20",
        recorder: { reference: "Practitioner/123", display: "Dr. Jones" },
      },
    ];

    const result = transformConditions(conditions);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cond-1");
    expect(result[0].code).toBe("38341003");
    expect(result[0].display).toBe("Hypertension");
    expect(result[0].recordedDate).toBe("2020-06-20");
    expect(result[0].clinicalStatus!.coding[0].code).toBe("active");
    expect(result[0].verificationStatus!.coding[0].code).toBe("confirmed");
    expect(result[0].severity!.coding[0].display).toBe("Moderate");
    expect(result[0].onsetDateTime).toBe("2020-06-15");
    expect(result[0].recorder!.display).toBe("Dr. Jones");
  });

  it("transforms condition with onset/abatement variants", () => {
    const conditions: FHIRCondition[] = [
      {
        code: { coding: [{ code: "123", display: "Test" }] },
        onsetAge: { value: 45, unit: "years" },
        abatementString: "Resolved after treatment",
        recordedDate: "2024-01-01",
      },
    ];

    const result = transformConditions(conditions);
    expect(result[0].onsetAge).toBe(45);
    expect(result[0].onsetDateTime).toBeNull();
    expect(result[0].abatementString).toBe("Resolved after treatment");
    expect(result[0].abatementDateTime).toBeNull();
  });

  it("transforms stage and evidence", () => {
    const conditions: FHIRCondition[] = [
      {
        code: { coding: [{ code: "254637007", display: "Breast cancer" }] },
        stage: [
          {
            summary: { coding: [{ display: "Stage II" }] },
            type: { coding: [{ display: "Clinical" }] },
          },
        ],
        evidence: [
          {
            code: [{ coding: [{ display: "Mammogram abnormal" }] }],
            detail: [{ reference: "Observation/mammogram-1" }],
          },
        ],
      },
    ];

    const result = transformConditions(conditions);
    expect(result[0].stage).toHaveLength(1);
    expect(result[0].stage[0].summary!.coding[0].display).toBe("Stage II");
    expect(result[0].evidence).toHaveLength(1);
    expect(result[0].evidence[0].code).toHaveLength(1);
  });

  it("handles minimal condition data", () => {
    const conditions: FHIRCondition[] = [
      { code: { coding: [{ code: "123" }] } },
    ];

    const result = transformConditions(conditions);
    expect(result[0].code).toBe("123");
    expect(result[0].display).toBe("Unknown");
    expect(result[0].recordedDate).toBe("");
    expect(result[0].clinicalStatus).toBeNull();
    expect(result[0].category).toEqual([]);
    expect(result[0].stage).toEqual([]);
    expect(result[0].evidence).toEqual([]);
    expect(result[0].notes).toEqual([]);
  });

  it("transforms notes", () => {
    const conditions: FHIRCondition[] = [
      {
        code: { coding: [{ code: "123", display: "Test" }] },
        note: [{ text: "Chronic condition" }, { text: "Family history noted" }],
      },
    ];

    const result = transformConditions(conditions);
    expect(result[0].notes).toEqual(["Chronic condition", "Family history noted"]);
  });

  it("handles empty conditions array", () => {
    const result = transformConditions([]);
    expect(result).toEqual([]);
  });
});
