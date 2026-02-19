import {
  mapConditions,
  mapMedications,
  mapAllergies,
} from "../services/patient-clinical-mappers";
import type {
  DiagnosisOut,
  MedicationOut,
  AllergyOut,
  CodeableConceptOut,
  DosageInstructionOut,
  AllergyReactionOut,
} from "../services/transforms";

// =============================================================================
// Test Helper Factories
// =============================================================================

function makeDiagnosis(overrides: Partial<DiagnosisOut> = {}): DiagnosisOut {
  return {
    code: "38341003",
    display: "Hypertension",
    recordedDate: "2024-01-15",
    id: "cond-1",
    clinicalStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active", display: "Active" }],
      text: "Active",
    },
    verificationStatus: null,
    category: [],
    severity: null,
    codeDetail: {
      coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" }],
      text: "Hypertension",
    },
    bodySite: [],
    encounter: null,
    onsetDateTime: "2020-06-15",
    onsetAge: null,
    onsetString: null,
    abatementDateTime: null,
    abatementAge: null,
    abatementString: null,
    recorder: null,
    asserter: null,
    stage: [],
    evidence: [],
    notes: [],
    ...overrides,
  };
}

function makeMedication(overrides: Partial<MedicationOut> = {}): MedicationOut {
  return {
    name: "Lisinopril 10mg",
    status: "active",
    dosage: "Take one tablet daily",
    id: "med-1",
    medicationCode: {
      coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "197361", display: "Lisinopril 10 MG" }],
      text: "Lisinopril 10mg",
    },
    medicationReference: null,
    intent: "order",
    category: [],
    priority: null,
    authoredOn: "2024-01-01",
    requester: null,
    encounter: null,
    reasonCode: [],
    reasonReference: [],
    dosageInstructions: [
      {
        sequence: 1,
        text: "Take one tablet daily",
        timing: "1 time(s) per 1 d",
        asNeeded: null,
        asNeededReason: null,
        route: null,
        method: null,
        site: null,
        doseQuantity: 10,
        doseUnit: "mg",
        doseRangeLow: null,
        doseRangeHigh: null,
        rateQuantity: null,
        rateUnit: null,
        maxDosePerPeriod: null,
        maxDosePerAdministration: null,
        maxDosePerAdministrationUnit: null,
      },
    ],
    dispenseRequest: null,
    substitution: null,
    courseOfTherapyType: null,
    notes: [],
    ...overrides,
  };
}

function makeAllergy(overrides: Partial<AllergyOut> = {}): AllergyOut {
  return {
    id: "allergy-1",
    code: {
      coding: [{ system: "http://snomed.info/sct", code: "7980", display: "Penicillin" }],
      text: "Penicillin",
    },
    clinicalStatus: {
      coding: [{ system: null, code: "active", display: "Active" }],
      text: "Active",
    },
    verificationStatus: null,
    type: "allergy",
    categories: ["medication"],
    criticality: "high",
    onsetDateTime: null,
    onsetAge: null,
    onsetString: null,
    recordedDate: "2024-01-15",
    lastOccurrence: null,
    recorder: null,
    asserter: null,
    encounter: null,
    reactions: [
      {
        substance: null,
        manifestations: [
          {
            coding: [{ system: null, code: null, display: "Hives" }],
            text: "Hives",
          },
        ],
        description: null,
        onset: null,
        severity: "severe",
        exposureRoute: null,
      },
    ],
    notes: [],
    ...overrides,
  };
}

// =============================================================================
// mapConditions
// =============================================================================

describe("mapConditions", () => {
  it("maps diagnosis with clinicalStatus code 'active' to ACTIVE", () => {
    const input = [makeDiagnosis({
      clinicalStatus: {
        coding: [{ system: null, code: "active", display: "Active" }],
        text: "Active",
      },
    })];

    const result = mapConditions(input);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("ACTIVE");
  });

  it("maps diagnosis with clinicalStatus code 'resolved' to RESOLVED", () => {
    const input = [makeDiagnosis({
      clinicalStatus: {
        coding: [{ system: null, code: "resolved", display: "Resolved" }],
        text: "Resolved",
      },
    })];

    const result = mapConditions(input);

    expect(result[0].status).toBe("RESOLVED");
  });

  it("maps null clinicalStatus to INACTIVE", () => {
    const input = [makeDiagnosis({ clinicalStatus: null })];

    const result = mapConditions(input);

    expect(result[0].status).toBe("INACTIVE");
  });

  it("maps unknown clinicalStatus code to INACTIVE", () => {
    const input = [makeDiagnosis({
      clinicalStatus: {
        coding: [{ system: null, code: "something-else", display: null }],
        text: null,
      },
    })];

    const result = mapConditions(input);

    expect(result[0].status).toBe("INACTIVE");
  });

  it("maps clinicalStatus with empty coding array to INACTIVE", () => {
    const input = [makeDiagnosis({
      clinicalStatus: { coding: [], text: null },
    })];

    const result = mapConditions(input);

    expect(result[0].status).toBe("INACTIVE");
  });

  it("uses condition id as id when present", () => {
    const input = [makeDiagnosis({ id: "cond-42" })];

    const result = mapConditions(input);

    expect(result[0].id).toBe("cond-42");
  });

  it("falls back to condition-${index} when id is null", () => {
    const input = [
      makeDiagnosis({ id: null }),
      makeDiagnosis({ id: null }),
    ];

    const result = mapConditions(input);

    expect(result[0].id).toBe("condition-0");
    expect(result[1].id).toBe("condition-1");
  });

  it("uses codeDetail.coding[0].system as codeSystem", () => {
    const input = [makeDiagnosis({
      codeDetail: {
        coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" }],
        text: "Hypertension",
      },
    })];

    const result = mapConditions(input);

    expect(result[0].codeSystem).toBe("http://snomed.info/sct");
  });

  it("returns null codeSystem when codeDetail is null", () => {
    const input = [makeDiagnosis({ codeDetail: null })];

    const result = mapConditions(input);

    expect(result[0].codeSystem).toBeNull();
  });

  it("returns null codeSystem when codeDetail has empty coding", () => {
    const input = [makeDiagnosis({
      codeDetail: { coding: [], text: null },
    })];

    const result = mapConditions(input);

    expect(result[0].codeSystem).toBeNull();
  });

  it("maps display, code, and recordedDate through unchanged", () => {
    const input = [makeDiagnosis({
      display: "Type 2 Diabetes",
      code: "E11",
      recordedDate: "2023-05-10",
    })];

    const result = mapConditions(input);

    expect(result[0].name).toBe("Type 2 Diabetes");
    expect(result[0].code).toBe("E11");
    expect(result[0].onsetDate).toBe("2023-05-10");
  });

  it("returns empty array for empty input", () => {
    const result = mapConditions([]);

    expect(result).toEqual([]);
  });
});

// =============================================================================
// mapMedications
// =============================================================================

describe("mapMedications", () => {
  it("joins all dosageInstructions texts with ' \\u00b7 ' for dosage", () => {
    const input = [makeMedication({
      dosageInstructions: [
        makeDosageInstruction({ text: "Take one tablet" }),
        makeDosageInstruction({ text: "With food" }),
        makeDosageInstruction({ text: "In the morning" }),
      ],
    })];

    const result = mapMedications(input);

    expect(result[0].dosage).toBe("Take one tablet \u00b7 With food \u00b7 In the morning");
  });

  it("joins all dosageInstructions timings with ' \\u00b7 ' for frequency", () => {
    const input = [makeMedication({
      dosageInstructions: [
        makeDosageInstruction({ timing: "Once daily" }),
        makeDosageInstruction({ timing: "In the evening" }),
      ],
    })];

    const result = mapMedications(input);

    expect(result[0].frequency).toBe("Once daily \u00b7 In the evening");
  });

  it("filters out null text values before joining dosage", () => {
    const input = [makeMedication({
      dosageInstructions: [
        makeDosageInstruction({ text: "Take one tablet" }),
        makeDosageInstruction({ text: null }),
        makeDosageInstruction({ text: "Before bed" }),
      ],
    })];

    const result = mapMedications(input);

    expect(result[0].dosage).toBe("Take one tablet \u00b7 Before bed");
  });

  it("filters out null timing values before joining frequency", () => {
    const input = [makeMedication({
      dosageInstructions: [
        makeDosageInstruction({ timing: null }),
        makeDosageInstruction({ timing: "Twice daily" }),
      ],
    })];

    const result = mapMedications(input);

    expect(result[0].frequency).toBe("Twice daily");
  });

  it("returns null dosage when dosageInstructions is empty", () => {
    const input = [makeMedication({ dosageInstructions: [] })];

    const result = mapMedications(input);

    expect(result[0].dosage).toBeNull();
  });

  it("returns null frequency when dosageInstructions is empty", () => {
    const input = [makeMedication({ dosageInstructions: [] })];

    const result = mapMedications(input);

    expect(result[0].frequency).toBeNull();
  });

  it("returns null dosage when all texts are null", () => {
    const input = [makeMedication({
      dosageInstructions: [
        makeDosageInstruction({ text: null }),
        makeDosageInstruction({ text: null }),
      ],
    })];

    const result = mapMedications(input);

    expect(result[0].dosage).toBeNull();
  });

  it("returns null frequency when all timings are null", () => {
    const input = [makeMedication({
      dosageInstructions: [
        makeDosageInstruction({ timing: null }),
      ],
    })];

    const result = mapMedications(input);

    expect(result[0].frequency).toBeNull();
  });

  it("maps status 'active' to ACTIVE", () => {
    const input = [makeMedication({ status: "active" })];

    const result = mapMedications(input);

    expect(result[0].status).toBe("ACTIVE");
  });

  it("maps status 'stopped' to DISCONTINUED", () => {
    const input = [makeMedication({ status: "stopped" })];

    const result = mapMedications(input);

    expect(result[0].status).toBe("DISCONTINUED");
  });

  it("maps status 'completed' to DISCONTINUED", () => {
    const input = [makeMedication({ status: "completed" })];

    const result = mapMedications(input);

    expect(result[0].status).toBe("DISCONTINUED");
  });

  it("maps unknown status to DISCONTINUED", () => {
    const input = [makeMedication({ status: "unknown" })];

    const result = mapMedications(input);

    expect(result[0].status).toBe("DISCONTINUED");
  });

  it("passes through name and id", () => {
    const input = [makeMedication({ name: "Metformin 500mg", id: "med-42" })];

    const result = mapMedications(input);

    expect(result[0].name).toBe("Metformin 500mg");
    expect(result[0].id).toBe("med-42");
  });

  it("returns empty array for empty input", () => {
    const result = mapMedications([]);

    expect(result).toEqual([]);
  });
});

// =============================================================================
// mapAllergies
// =============================================================================

describe("mapAllergies", () => {
  it("uses code.text as allergen when available", () => {
    const input = [makeAllergy({
      code: {
        coding: [{ system: null, code: null, display: "Penicillin V" }],
        text: "Penicillin",
      },
    })];

    const result = mapAllergies(input);

    expect(result[0].allergen).toBe("Penicillin");
  });

  it("falls back to joining code.coding displays when code.text is null", () => {
    const input = [makeAllergy({
      code: {
        coding: [
          { system: null, code: null, display: "Penicillin V" },
          { system: null, code: null, display: "Amoxicillin" },
        ],
        text: null,
      },
    })];

    const result = mapAllergies(input);

    expect(result[0].allergen).toBe("Penicillin V \u00b7 Amoxicillin");
  });

  it("returns 'Unknown allergen' when code is null", () => {
    const input = [makeAllergy({ code: null })];

    const result = mapAllergies(input);

    expect(result[0].allergen).toBe("Unknown allergen");
  });

  it("returns 'Unknown allergen' when code has no text and no coding displays", () => {
    const input = [makeAllergy({
      code: {
        coding: [{ system: null, code: "12345", display: null }],
        text: null,
      },
    })];

    const result = mapAllergies(input);

    expect(result[0].allergen).toBe("Unknown allergen");
  });

  it("joins all reaction manifestation texts across all reactions", () => {
    const input = [makeAllergy({
      reactions: [
        {
          substance: null,
          manifestations: [
            { coding: [], text: "Hives" },
            { coding: [], text: "Swelling" },
          ],
          description: null,
          onset: null,
          severity: null,
          exposureRoute: null,
        },
        {
          substance: null,
          manifestations: [
            { coding: [], text: "Anaphylaxis" },
          ],
          description: null,
          onset: null,
          severity: null,
          exposureRoute: null,
        },
      ],
    })];

    const result = mapAllergies(input);

    expect(result[0].reaction).toBe("Hives \u00b7 Swelling \u00b7 Anaphylaxis");
  });

  it("falls back to manifestation coding[0].display when text is null", () => {
    const input = [makeAllergy({
      reactions: [
        {
          substance: null,
          manifestations: [
            { coding: [{ system: null, code: null, display: "Rash" }], text: null },
          ],
          description: null,
          onset: null,
          severity: null,
          exposureRoute: null,
        },
      ],
    })];

    const result = mapAllergies(input);

    expect(result[0].reaction).toBe("Rash");
  });

  it("skips manifestations with neither text nor coding display", () => {
    const input = [makeAllergy({
      reactions: [
        {
          substance: null,
          manifestations: [
            { coding: [], text: null },
            { coding: [{ system: null, code: null, display: "Hives" }], text: null },
          ],
          description: null,
          onset: null,
          severity: null,
          exposureRoute: null,
        },
      ],
    })];

    const result = mapAllergies(input);

    expect(result[0].reaction).toBe("Hives");
  });

  it("returns null reaction when no reactions exist", () => {
    const input = [makeAllergy({ reactions: [] })];

    const result = mapAllergies(input);

    expect(result[0].reaction).toBeNull();
  });

  it("maps criticality 'high' to SEVERE", () => {
    const input = [makeAllergy({ criticality: "high" })];

    const result = mapAllergies(input);

    expect(result[0].severity).toBe("SEVERE");
  });

  it("maps criticality 'low' to MILD", () => {
    const input = [makeAllergy({ criticality: "low" })];

    const result = mapAllergies(input);

    expect(result[0].severity).toBe("MILD");
  });

  it("maps criticality null to MODERATE", () => {
    const input = [makeAllergy({ criticality: null })];

    const result = mapAllergies(input);

    expect(result[0].severity).toBe("MODERATE");
  });

  it("maps unknown criticality to MODERATE", () => {
    const input = [makeAllergy({ criticality: "unable-to-assess" })];

    const result = mapAllergies(input);

    expect(result[0].severity).toBe("MODERATE");
  });

  it("passes through id", () => {
    const input = [makeAllergy({ id: "allergy-99" })];

    const result = mapAllergies(input);

    expect(result[0].id).toBe("allergy-99");
  });

  it("returns empty array for empty input", () => {
    const result = mapAllergies([]);

    expect(result).toEqual([]);
  });
});

// =============================================================================
// Helper for creating partial DosageInstructionOut
// =============================================================================

function makeDosageInstruction(
  overrides: Partial<DosageInstructionOut> = {}
): DosageInstructionOut {
  return {
    sequence: null,
    text: "Take one tablet daily",
    timing: "1 time(s) per 1 d",
    asNeeded: null,
    asNeededReason: null,
    route: null,
    method: null,
    site: null,
    doseQuantity: null,
    doseUnit: null,
    doseRangeLow: null,
    doseRangeHigh: null,
    rateQuantity: null,
    rateUnit: null,
    maxDosePerPeriod: null,
    maxDosePerAdministration: null,
    maxDosePerAdministrationUnit: null,
    ...overrides,
  };
}
