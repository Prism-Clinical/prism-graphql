/**
 * FHIR-to-GraphQL Transform Functions
 *
 * Pure functions that transform raw FHIR R4 resources into the expanded
 * GraphQL types used by epic-api-service. Used for both live queries
 * (via cache layer) and snapshot creation.
 */

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

import type {
  FHIRObservation,
  FHIRObservationReferenceRange,
  FHIRObservationComponent,
} from "../clients/feature-extraction-client";

// =============================================================================
// GraphQL Output Types
// =============================================================================

export interface CodingValue {
  system: string | null;
  code: string | null;
  display: string | null;
}

export interface CodeableConceptOut {
  coding: CodingValue[];
  text: string | null;
}

export interface ReferenceInfo {
  reference: string | null;
  display: string | null;
  type: string | null;
}

export interface PeriodOut {
  start: string | null;
  end: string | null;
}

export interface PatientIdentifierOut {
  use: string | null;
  system: string | null;
  value: string | null;
  type: CodeableConceptOut | null;
}

export interface PatientNameOut {
  use: string | null;
  family: string | null;
  given: string[];
  prefix: string[];
  suffix: string[];
  text: string | null;
}

export interface ContactPointOut {
  system: string | null;
  value: string | null;
  use: string | null;
  rank: number | null;
}

export interface AddressOut {
  use: string | null;
  type: string | null;
  line: string[];
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  text: string | null;
}

export interface EmergencyContactOut {
  relationship: CodeableConceptOut[];
  name: PatientNameOut | null;
  telecom: ContactPointOut[];
  gender: string | null;
}

export interface CommunicationOut {
  language: CodeableConceptOut;
  preferred: boolean | null;
}

export interface RaceEthnicityOut {
  race: CodingValue[];
  ethnicity: CodingValue[];
  raceText: string | null;
  ethnicityText: string | null;
}

export interface PatientDemographicsOut {
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  mrn: string;
  active: boolean | null;
  deceasedBoolean: boolean | null;
  deceasedDateTime: string | null;
  maritalStatus: CodeableConceptOut | null;
  raceEthnicity: RaceEthnicityOut | null;
  identifiers: PatientIdentifierOut[];
  names: PatientNameOut[];
  telecom: ContactPointOut[];
  addresses: AddressOut[];
  emergencyContacts: EmergencyContactOut[];
  communications: CommunicationOut[];
  generalPractitioner: ReferenceInfo[];
}

export interface ReferenceRangeOut {
  low: number | null;
  lowUnit: string | null;
  high: number | null;
  highUnit: string | null;
  text: string | null;
}

export interface ObservationComponentOut {
  code: CodeableConceptOut;
  valueQuantity: number | null;
  valueUnit: string | null;
  valueString: string | null;
  interpretation: CodeableConceptOut[];
  referenceRange: ReferenceRangeOut[];
}

export interface VitalOut {
  type: string;
  value: number;
  unit: string;
  recordedDate: string;
  isNormalized: boolean;
  code: CodeableConceptOut | null;
  status: string | null;
  category: string | null;
  interpretation: CodeableConceptOut[];
  referenceRange: ReferenceRangeOut[];
  bodySite: CodeableConceptOut | null;
  method: CodeableConceptOut | null;
  performer: ReferenceInfo[];
  encounter: ReferenceInfo | null;
  issuedDate: string | null;
  components: ObservationComponentOut[];
}

export interface LabResultOut {
  id: string | null;
  code: CodeableConceptOut;
  status: string;
  category: string | null;
  effectiveDateTime: string | null;
  issuedDate: string | null;
  valueQuantity: number | null;
  valueUnit: string | null;
  valueString: string | null;
  valueCodeableConcept: CodeableConceptOut | null;
  interpretation: CodeableConceptOut[];
  referenceRange: ReferenceRangeOut[];
  performer: ReferenceInfo[];
  encounter: ReferenceInfo | null;
  specimen: ReferenceInfo | null;
  bodySite: CodeableConceptOut | null;
  hasMember: ReferenceInfo[];
  components: ObservationComponentOut[];
  notes: string[];
}

export interface DosageInstructionOut {
  sequence: number | null;
  text: string | null;
  timing: string | null;
  asNeeded: boolean | null;
  asNeededReason: CodeableConceptOut | null;
  route: CodeableConceptOut | null;
  method: CodeableConceptOut | null;
  site: CodeableConceptOut | null;
  doseQuantity: number | null;
  doseUnit: string | null;
  doseRangeLow: number | null;
  doseRangeHigh: number | null;
  rateQuantity: number | null;
  rateUnit: string | null;
  maxDosePerPeriod: string | null;
  maxDosePerAdministration: number | null;
  maxDosePerAdministrationUnit: string | null;
}

export interface DispenseRequestOut {
  validityPeriod: PeriodOut | null;
  numberOfRepeatsAllowed: number | null;
  quantity: number | null;
  quantityUnit: string | null;
  expectedSupplyDuration: number | null;
  expectedSupplyDurationUnit: string | null;
}

export interface MedicationSubstitutionOut {
  allowed: boolean | null;
  reason: CodeableConceptOut | null;
}

export interface MedicationOut {
  name: string;
  status: string;
  dosage: string | null;
  id: string | null;
  medicationCode: CodeableConceptOut | null;
  medicationReference: ReferenceInfo | null;
  intent: string | null;
  category: CodeableConceptOut[];
  priority: string | null;
  authoredOn: string | null;
  requester: ReferenceInfo | null;
  encounter: ReferenceInfo | null;
  reasonCode: CodeableConceptOut[];
  reasonReference: ReferenceInfo[];
  dosageInstructions: DosageInstructionOut[];
  dispenseRequest: DispenseRequestOut | null;
  substitution: MedicationSubstitutionOut | null;
  courseOfTherapyType: CodeableConceptOut | null;
  notes: string[];
}

export interface ConditionStageOut {
  summary: CodeableConceptOut | null;
  type: CodeableConceptOut | null;
}

export interface ConditionEvidenceOut {
  code: CodeableConceptOut[];
  detail: ReferenceInfo[];
}

export interface DiagnosisOut {
  code: string;
  display: string;
  recordedDate: string;
  id: string | null;
  clinicalStatus: CodeableConceptOut | null;
  verificationStatus: CodeableConceptOut | null;
  category: CodeableConceptOut[];
  severity: CodeableConceptOut | null;
  codeDetail: CodeableConceptOut | null;
  bodySite: CodeableConceptOut[];
  encounter: ReferenceInfo | null;
  onsetDateTime: string | null;
  onsetAge: number | null;
  onsetString: string | null;
  abatementDateTime: string | null;
  abatementAge: number | null;
  abatementString: string | null;
  recorder: ReferenceInfo | null;
  asserter: ReferenceInfo | null;
  stage: ConditionStageOut[];
  evidence: ConditionEvidenceOut[];
  notes: string[];
}

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

// =============================================================================
// Helper Functions
// =============================================================================

function transformCodeableConcept(
  cc?: FHIRCodeableConcept | null
): CodeableConceptOut | null {
  if (!cc) return null;
  return {
    coding: (cc.coding || []).map(transformCoding),
    text: cc.text || null,
  };
}

function transformCoding(c: FHIRCoding): CodingValue {
  return {
    system: c.system || null,
    code: c.code || null,
    display: c.display || null,
  };
}

function transformReference(ref?: FHIRReference | null): ReferenceInfo | null {
  if (!ref) return null;
  return {
    reference: ref.reference || null,
    display: ref.display || null,
    type: ref.type || null,
  };
}

function transformReferenceArray(
  refs?: Array<{ reference?: string; display?: string; type?: string }> | null
): ReferenceInfo[] {
  if (!refs) return [];
  return refs.map((r) => ({
    reference: r.reference || null,
    display: r.display || null,
    type: (r as FHIRReference).type || null,
  }));
}

function transformCodeableConceptArray(
  ccs?: FHIRCodeableConcept[] | null
): CodeableConceptOut[] {
  if (!ccs) return [];
  return ccs.map((cc) => transformCodeableConcept(cc)!);
}

function transformReferenceRange(
  rr?: FHIRObservationReferenceRange[] | null
): ReferenceRangeOut[] {
  if (!rr) return [];
  return rr.map((r) => ({
    low: r.low?.value ?? null,
    lowUnit: r.low?.unit || null,
    high: r.high?.value ?? null,
    highUnit: r.high?.unit || null,
    text: r.text || null,
  }));
}

function transformComponents(
  comps?: FHIRObservationComponent[] | null
): ObservationComponentOut[] {
  if (!comps) return [];
  return comps.map((c) => ({
    code: {
      coding: (c.code?.coding || []).map(transformCoding),
      text: c.code?.text || null,
    },
    valueQuantity: c.valueQuantity?.value ?? null,
    valueUnit: c.valueQuantity?.unit || null,
    valueString: c.valueString || null,
    interpretation: transformCodeableConceptArray(c.interpretation),
    referenceRange: transformReferenceRange(c.referenceRange),
  }));
}

function extractRaceEthnicity(
  extensions?: FHIRExtension[]
): RaceEthnicityOut | null {
  if (!extensions) return null;

  const raceExt = extensions.find(
    (e) =>
      e.url ===
      "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race"
  );
  const ethnicityExt = extensions.find(
    (e) =>
      e.url ===
      "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity"
  );

  if (!raceExt && !ethnicityExt) return null;

  const extractCodings = (ext?: FHIRExtension): CodingValue[] => {
    if (!ext?.extension) return [];
    return ext.extension
      .filter((e) => e.url === "ombCategory" || e.url === "detailed")
      .filter((e) => e.valueCoding)
      .map((e) => ({
        system: e.valueCoding!.system || null,
        code: e.valueCoding!.code || null,
        display: e.valueCoding!.display || null,
      }));
  };

  const extractText = (ext?: FHIRExtension): string | null => {
    if (!ext?.extension) return null;
    const textExt = ext.extension.find((e) => e.url === "text");
    return textExt?.valueString || null;
  };

  return {
    race: extractCodings(raceExt),
    ethnicity: extractCodings(ethnicityExt),
    raceText: extractText(raceExt),
    ethnicityText: extractText(ethnicityExt),
  };
}

function formatTimingText(dosage: FHIRDosage): string | null {
  const repeat = dosage.timing?.repeat;
  if (!repeat) return dosage.timing?.code?.text || null;

  const parts: string[] = [];
  if (repeat.frequency && repeat.period && repeat.periodUnit) {
    parts.push(
      `${repeat.frequency} time(s) per ${repeat.period} ${repeat.periodUnit}`
    );
  }
  if (repeat.when?.length) {
    parts.push(`when: ${repeat.when.join(", ")}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

// =============================================================================
// Transform: Patient
// =============================================================================

export function transformPatient(fhir: FHIRPatient): PatientDemographicsOut {
  const officialName = fhir.name?.find((n) => n.use === "official") || fhir.name?.[0];
  const mrnIdentifier = fhir.identifier?.find(
    (id) =>
      id.type?.coding?.some((c) => c.code === "MR") ||
      id.system?.includes("1.2.840.114350")
  ) || fhir.identifier?.[0];

  return {
    firstName: officialName?.given?.[0] || "",
    lastName: officialName?.family || "",
    gender: fhir.gender || "",
    dateOfBirth: fhir.birthDate || "",
    mrn: mrnIdentifier?.value || "",
    active: fhir.active ?? null,
    deceasedBoolean: fhir.deceasedBoolean ?? null,
    deceasedDateTime: fhir.deceasedDateTime || null,
    maritalStatus: transformCodeableConcept(fhir.maritalStatus),
    raceEthnicity: extractRaceEthnicity(fhir.extension),
    identifiers: (fhir.identifier || []).map((id) => ({
      use: id.use || null,
      system: id.system || null,
      value: id.value || null,
      type: transformCodeableConcept(id.type),
    })),
    names: (fhir.name || []).map((n) => ({
      use: n.use || null,
      family: n.family || null,
      given: n.given || [],
      prefix: n.prefix || [],
      suffix: n.suffix || [],
      text: n.text || null,
    })),
    telecom: (fhir.telecom || []).map((t) => ({
      system: t.system || null,
      value: t.value || null,
      use: t.use || null,
      rank: t.rank ?? null,
    })),
    addresses: (fhir.address || []).map((a) => ({
      use: a.use || null,
      type: a.type || null,
      line: a.line || [],
      city: a.city || null,
      state: a.state || null,
      postalCode: a.postalCode || null,
      country: a.country || null,
      text: a.text || null,
    })),
    emergencyContacts: (fhir.contact || []).map((c) => ({
      relationship: transformCodeableConceptArray(c.relationship),
      name: c.name
        ? {
            use: c.name.use || null,
            family: c.name.family || null,
            given: c.name.given || [],
            prefix: c.name.prefix || [],
            suffix: c.name.suffix || [],
            text: c.name.text || null,
          }
        : null,
      telecom: (c.telecom || []).map((t) => ({
        system: t.system || null,
        value: t.value || null,
        use: t.use || null,
        rank: t.rank ?? null,
      })),
      gender: c.gender || null,
    })),
    communications: (fhir.communication || []).map((c) => ({
      language: transformCodeableConcept(c.language)!,
      preferred: c.preferred ?? null,
    })),
    generalPractitioner: transformReferenceArray(fhir.generalPractitioner),
  };
}

// =============================================================================
// Transform: Vitals
// =============================================================================

export function transformVitals(observations: FHIRObservation[]): VitalOut[] {
  const vitals: VitalOut[] = [];

  for (const obs of observations) {
    const display = obs.code?.coding?.[0]?.display || obs.code?.text || "Unknown";
    const value = obs.valueQuantity?.value;
    const unit = obs.valueQuantity?.unit || "";
    const category = obs.category?.[0]?.coding?.[0]?.code || null;

    const baseFields = {
      code: {
        coding: (obs.code?.coding || []).map(transformCoding),
        text: obs.code?.text || null,
      },
      status: obs.status || null,
      category,
      interpretation: transformCodeableConceptArray(obs.interpretation),
      referenceRange: transformReferenceRange(obs.referenceRange),
      bodySite: transformCodeableConcept(obs.bodySite),
      method: transformCodeableConcept(obs.method),
      performer: transformReferenceArray(obs.performer),
      encounter: transformReference(obs.encounter),
      issuedDate: obs.issued || null,
      components: transformComponents(obs.component),
      isNormalized: false,
    };

    if (value !== undefined) {
      vitals.push({
        type: display,
        value,
        unit,
        recordedDate: obs.effectiveDateTime || "",
        ...baseFields,
      });
    } else if (obs.component) {
      for (const comp of obs.component) {
        const compDisplay = comp.code?.coding?.[0]?.display || comp.code?.text || "Unknown";
        const compValue = comp.valueQuantity?.value;
        const compUnit = comp.valueQuantity?.unit || "";
        if (compValue !== undefined) {
          vitals.push({
            type: compDisplay,
            value: compValue,
            unit: compUnit,
            recordedDate: obs.effectiveDateTime || "",
            ...baseFields,
          });
        }
      }
    }
  }

  return vitals;
}

// =============================================================================
// Transform: Lab Results
// =============================================================================

export function transformLabResults(
  observations: FHIRObservation[]
): LabResultOut[] {
  return observations.map((obs) => ({
    id: obs.id || null,
    code: {
      coding: (obs.code?.coding || []).map(transformCoding),
      text: obs.code?.text || null,
    },
    status: obs.status,
    category: obs.category?.[0]?.coding?.[0]?.code || null,
    effectiveDateTime: obs.effectiveDateTime || null,
    issuedDate: obs.issued || null,
    valueQuantity: obs.valueQuantity?.value ?? null,
    valueUnit: obs.valueQuantity?.unit || null,
    valueString: obs.valueString || null,
    valueCodeableConcept: transformCodeableConcept(obs.valueCodeableConcept),
    interpretation: transformCodeableConceptArray(obs.interpretation),
    referenceRange: transformReferenceRange(obs.referenceRange),
    performer: transformReferenceArray(obs.performer),
    encounter: transformReference(obs.encounter),
    specimen: transformReference(obs.specimen),
    bodySite: transformCodeableConcept(obs.bodySite),
    hasMember: transformReferenceArray(obs.hasMember),
    components: transformComponents(obs.component),
    notes: (obs.note || []).map((n) => n.text),
  }));
}

// =============================================================================
// Transform: Medications
// =============================================================================

export function transformMedications(
  medRequests: FHIRMedicationRequest[],
  resolvedMeds: Map<string, FHIRMedication>
): MedicationOut[] {
  return medRequests.map((med) => {
    // Resolve medication name from either CodeableConcept or Reference
    let name = "Unknown";
    let medicationCode: CodeableConceptOut | null = null;
    let medicationRef: ReferenceInfo | null = null;

    if (med.medicationCodeableConcept) {
      name =
        med.medicationCodeableConcept.text ||
        med.medicationCodeableConcept.coding?.[0]?.display ||
        "Unknown";
      medicationCode = transformCodeableConcept(med.medicationCodeableConcept);
    } else if (med.medicationReference) {
      medicationRef = transformReference(med.medicationReference);
      // Try to get name from resolved medication
      const refKey = med.medicationReference.reference;
      if (refKey && resolvedMeds.has(refKey)) {
        const resolved = resolvedMeds.get(refKey)!;
        name =
          resolved.code?.text ||
          resolved.code?.coding?.[0]?.display ||
          med.medicationReference.display ||
          "Unknown";
        medicationCode = transformCodeableConcept(resolved.code);
      } else {
        name = med.medicationReference.display || "Unknown";
      }
    }

    return {
      name,
      status: med.status || "unknown",
      dosage: med.dosageInstruction?.[0]?.text || null,
      id: med.id || null,
      medicationCode,
      medicationReference: medicationRef,
      intent: med.intent || null,
      category: transformCodeableConceptArray(med.category),
      priority: med.priority || null,
      authoredOn: med.authoredOn || null,
      requester: transformReference(med.requester),
      encounter: transformReference(med.encounter),
      reasonCode: transformCodeableConceptArray(med.reasonCode),
      reasonReference: transformReferenceArray(med.reasonReference),
      dosageInstructions: (med.dosageInstruction || []).map((d) => ({
        sequence: d.sequence ?? null,
        text: d.text || null,
        timing: formatTimingText(d),
        asNeeded: d.asNeededBoolean ?? null,
        asNeededReason: transformCodeableConcept(d.asNeededCodeableConcept),
        route: transformCodeableConcept(d.route),
        method: transformCodeableConcept(d.method),
        site: transformCodeableConcept(d.site),
        doseQuantity: d.doseAndRate?.[0]?.doseQuantity?.value ?? null,
        doseUnit: d.doseAndRate?.[0]?.doseQuantity?.unit || null,
        doseRangeLow: d.doseAndRate?.[0]?.doseRange?.low?.value ?? null,
        doseRangeHigh: d.doseAndRate?.[0]?.doseRange?.high?.value ?? null,
        rateQuantity: d.doseAndRate?.[0]?.rateQuantity?.value ?? null,
        rateUnit: d.doseAndRate?.[0]?.rateQuantity?.unit || null,
        maxDosePerPeriod: d.maxDosePerPeriod
          ? `${d.maxDosePerPeriod.numerator?.value || "?"} ${d.maxDosePerPeriod.numerator?.unit || ""} per ${d.maxDosePerPeriod.denominator?.value || "?"} ${d.maxDosePerPeriod.denominator?.unit || ""}`
          : null,
        maxDosePerAdministration: d.maxDosePerAdministration?.value ?? null,
        maxDosePerAdministrationUnit:
          d.maxDosePerAdministration?.unit || null,
      })),
      dispenseRequest: med.dispenseRequest
        ? {
            validityPeriod: med.dispenseRequest.validityPeriod
              ? {
                  start: med.dispenseRequest.validityPeriod.start || null,
                  end: med.dispenseRequest.validityPeriod.end || null,
                }
              : null,
            numberOfRepeatsAllowed:
              med.dispenseRequest.numberOfRepeatsAllowed ?? null,
            quantity: med.dispenseRequest.quantity?.value ?? null,
            quantityUnit: med.dispenseRequest.quantity?.unit || null,
            expectedSupplyDuration:
              med.dispenseRequest.expectedSupplyDuration?.value ?? null,
            expectedSupplyDurationUnit:
              med.dispenseRequest.expectedSupplyDuration?.unit || null,
          }
        : null,
      substitution: med.substitution
        ? {
            allowed: med.substitution.allowedBoolean ?? null,
            reason: transformCodeableConcept(med.substitution.reason),
          }
        : null,
      courseOfTherapyType: transformCodeableConcept(med.courseOfTherapyType),
      notes: (med.note || []).map((n) => n.text),
    };
  });
}

// =============================================================================
// Transform: Conditions / Diagnoses
// =============================================================================

export function transformConditions(
  conditions: FHIRCondition[]
): DiagnosisOut[] {
  return conditions.map((cond) => ({
    code: cond.code?.coding?.[0]?.code || "",
    display: cond.code?.coding?.[0]?.display || cond.code?.text || "Unknown",
    recordedDate: cond.recordedDate || "",
    id: cond.id || null,
    clinicalStatus: transformCodeableConcept(cond.clinicalStatus),
    verificationStatus: transformCodeableConcept(cond.verificationStatus),
    category: transformCodeableConceptArray(cond.category),
    severity: transformCodeableConcept(cond.severity),
    codeDetail: transformCodeableConcept(cond.code),
    bodySite: transformCodeableConceptArray(cond.bodySite),
    encounter: transformReference(cond.encounter),
    onsetDateTime: cond.onsetDateTime || null,
    onsetAge: cond.onsetAge?.value ?? null,
    onsetString: cond.onsetString || null,
    abatementDateTime: cond.abatementDateTime || null,
    abatementAge: cond.abatementAge?.value ?? null,
    abatementString: cond.abatementString || null,
    recorder: transformReference(cond.recorder),
    asserter: transformReference(cond.asserter),
    stage: (cond.stage || []).map((s) => ({
      summary: transformCodeableConcept(s.summary),
      type: transformCodeableConcept(s.type),
    })),
    evidence: (cond.evidence || []).map((e) => ({
      code: transformCodeableConceptArray(e.code),
      detail: transformReferenceArray(e.detail),
    })),
    notes: (cond.note || []).map((n) => n.text),
  }));
}

// =============================================================================
// Transform: Allergy Intolerances
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
