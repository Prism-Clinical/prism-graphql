/**
 * Epic API Service
 *
 * GraphQL subgraph for Epic EHR integration.
 * - Fetches patient data from Epic FHIR APIs and normalizes it for the federated graph.
 * - Redis cache for live FHIR data (short TTL, always-fresh pass-through)
 * - PostgreSQL immutable snapshots for clinical audit trail
 * - Feature extraction service integration with graceful fallback
 */

import gql from "graphql-tag";
import { AxiosError } from "axios";
import {
  getExtractionClient,
  getFhirClient,
  FHIRObservation,
  FHIRMedication,
  FHIRMedicationRequest,
  FHIREncounter,
  FHIRAppointment,
  EpicFhirClient,
} from "./clients";
import { createLogger } from "./clients/logger";
import { generateRequestId } from "./clients/http-utils";
import {
  transformPatient,
  transformVitals,
  transformLabResults,
  transformMedications,
  transformConditions,
  transformAllergyIntolerances,
  transformEncounters,
  transformAppointments,
  type PatientDemographicsOut,
  type VitalOut,
  type LabResultOut,
  type MedicationOut,
  type DiagnosisOut,
  type AllergyOut,
  type EncounterOut,
  type AppointmentOut,
} from "./services/transforms";
import { getCached, setCached, getCachedMedicationRef, setCachedMedicationRef, invalidatePatientCache } from "./services/cache";
import { createSnapshot, getLatestSnapshot, getSnapshotHistory, getSnapshot, getEpicPatientIdByPatientId, getLatestSnapshotClinicalData, type SnapshotData, type ClinicalSnapshotFull, type SnapshotSummary } from "./services/database";
import { mapConditions, mapMedications, mapAllergies } from "./services/patient-clinical-mappers";

// =============================================================================
// TYPES
// =============================================================================

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

interface DataFetchError {
  dataType: string;
  message: string;
  code?: string;
}

interface EpicPatientSearchInput {
  name?: string;
  family?: string;
  given?: string;
  birthdate?: string;
  gender?: string;
  identifier?: string;
  _count?: number;
}

interface EpicPatientSearchResult {
  epicPatientId: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  mrn: string | null;
}

interface EpicPatientSearchResponse {
  results: EpicPatientSearchResult[];
  totalCount: number;
}

interface EpicConnectionStatus {
  connected: boolean;
  lastConnectionTest: string;
  responseTime: number;
  errors: string[];
}

interface SyncResult {
  success: boolean;
  syncedDataTypes: string[];
  totalRecords: number;
  processingTime: number;
  errors: SyncError[];
}

interface SyncError {
  dataType: string;
  message: string;
}

// =============================================================================
// LOGGER
// =============================================================================

const logger = createLogger("epic-api-service");

// =============================================================================
// SCHEMA
// =============================================================================

export const typeDefs = gql`
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.10"
      import: ["@key", "@external", "@shareable"]
    )

  # =========================================================================
  # Shared types
  # =========================================================================

  type CodingValue {
    system: String
    code: String
    display: String
  }

  type CodeableConcept {
    coding: [CodingValue!]!
    text: String
  }

  type ReferenceInfo {
    reference: String
    display: String
    type: String
  }

  type Period {
    start: String
    end: String
  }

  # =========================================================================
  # Patient Demographics
  # =========================================================================

  type PatientIdentifier {
    use: String
    system: String
    value: String
    type: CodeableConcept
  }

  type PatientName {
    use: String
    family: String
    given: [String!]!
    prefix: [String!]!
    suffix: [String!]!
    text: String
  }

  type ContactPoint {
    system: String
    value: String
    use: String
    rank: Int
  }

  type Address {
    use: String
    type: String
    line: [String!]!
    city: String
    state: String
    postalCode: String
    country: String
    text: String
  }

  type EmergencyContact {
    relationship: [CodeableConcept!]!
    name: PatientName
    telecom: [ContactPoint!]!
    gender: String
  }

  type Communication {
    language: CodeableConcept!
    preferred: Boolean
  }

  type RaceEthnicity {
    race: [CodingValue!]!
    ethnicity: [CodingValue!]!
    raceText: String
    ethnicityText: String
  }

  type PatientDemographics {
    firstName: String
    lastName: String
    gender: String
    dateOfBirth: String
    mrn: String
    active: Boolean
    deceasedBoolean: Boolean
    deceasedDateTime: String
    maritalStatus: CodeableConcept
    raceEthnicity: RaceEthnicity
    identifiers: [PatientIdentifier!]!
    names: [PatientName!]!
    telecom: [ContactPoint!]!
    addresses: [Address!]!
    emergencyContacts: [EmergencyContact!]!
    communications: [Communication!]!
    generalPractitioner: [ReferenceInfo!]!
  }

  # =========================================================================
  # Vitals
  # =========================================================================

  type ReferenceRange {
    low: Float
    lowUnit: String
    high: Float
    highUnit: String
    text: String
  }

  type ObservationComponent {
    code: CodeableConcept!
    valueQuantity: Float
    valueUnit: String
    valueString: String
    interpretation: [CodeableConcept!]!
    referenceRange: [ReferenceRange!]!
  }

  type Vital {
    type: String!
    value: Float!
    unit: String!
    recordedDate: String!
    isNormalized: Boolean!
    code: CodeableConcept
    status: String
    category: String
    interpretation: [CodeableConcept!]!
    referenceRange: [ReferenceRange!]!
    bodySite: CodeableConcept
    method: CodeableConcept
    performer: [ReferenceInfo!]!
    encounter: ReferenceInfo
    issuedDate: String
    components: [ObservationComponent!]!
  }

  # =========================================================================
  # Lab Results
  # =========================================================================

  type LabResult {
    id: String
    code: CodeableConcept!
    status: String!
    category: String
    effectiveDateTime: String
    issuedDate: String
    valueQuantity: Float
    valueUnit: String
    valueString: String
    valueCodeableConcept: CodeableConcept
    interpretation: [CodeableConcept!]!
    referenceRange: [ReferenceRange!]!
    performer: [ReferenceInfo!]!
    encounter: ReferenceInfo
    specimen: ReferenceInfo
    bodySite: CodeableConcept
    hasMember: [ReferenceInfo!]!
    components: [ObservationComponent!]!
    notes: [String!]!
  }

  # =========================================================================
  # Medications
  # =========================================================================

  type DosageInstruction {
    sequence: Int
    text: String
    timing: String
    asNeeded: Boolean
    asNeededReason: CodeableConcept
    route: CodeableConcept
    method: CodeableConcept
    site: CodeableConcept
    doseQuantity: Float
    doseUnit: String
    doseRangeLow: Float
    doseRangeHigh: Float
    rateQuantity: Float
    rateUnit: String
    maxDosePerPeriod: String
    maxDosePerAdministration: Float
    maxDosePerAdministrationUnit: String
  }

  type DispenseRequest {
    validityPeriod: Period
    numberOfRepeatsAllowed: Int
    quantity: Float
    quantityUnit: String
    expectedSupplyDuration: Float
    expectedSupplyDurationUnit: String
  }

  type MedicationSubstitution {
    allowed: Boolean
    reason: CodeableConcept
  }

  type Medication {
    name: String!
    status: String!
    dosage: String
    id: String
    medicationCode: CodeableConcept
    medicationReference: ReferenceInfo
    intent: String
    category: [CodeableConcept!]!
    priority: String
    authoredOn: String
    requester: ReferenceInfo
    encounter: ReferenceInfo
    reasonCode: [CodeableConcept!]!
    reasonReference: [ReferenceInfo!]!
    dosageInstructions: [DosageInstruction!]!
    dispenseRequest: DispenseRequest
    substitution: MedicationSubstitution
    courseOfTherapyType: CodeableConcept
    notes: [String!]!
  }

  # =========================================================================
  # Diagnoses / Conditions
  # =========================================================================

  type ConditionStage {
    summary: CodeableConcept
    type: CodeableConcept
  }

  type ConditionEvidence {
    code: [CodeableConcept!]!
    detail: [ReferenceInfo!]!
  }

  type Diagnosis {
    code: String!
    display: String!
    recordedDate: String!
    id: String
    clinicalStatus: CodeableConcept
    verificationStatus: CodeableConcept
    category: [CodeableConcept!]!
    severity: CodeableConcept
    codeDetail: CodeableConcept
    bodySite: [CodeableConcept!]!
    encounter: ReferenceInfo
    onsetDateTime: String
    onsetAge: Float
    onsetString: String
    abatementDateTime: String
    abatementAge: Float
    abatementString: String
    recorder: ReferenceInfo
    asserter: ReferenceInfo
    stage: [ConditionStage!]!
    evidence: [ConditionEvidence!]!
    notes: [String!]!
  }

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

  # =========================================================================
  # Error types
  # =========================================================================

  type DataFetchError {
    dataType: String!
    message: String!
    code: String
  }

  type SyncError {
    dataType: String!
    message: String!
  }

  # =========================================================================
  # Clinical Snapshots
  # =========================================================================

  type ClinicalSnapshot {
    id: ID!
    epicPatientId: String!
    snapshotVersion: Int!
    triggerEvent: String!
    createdAt: String!
    demographics: PatientDemographics
    vitals: [Vital!]!
    labs: [LabResult!]!
    medications: [Medication!]!
    diagnoses: [Diagnosis!]!
    allergies: [Allergy!]!
  }

  type SnapshotSummary {
    id: ID!
    epicPatientId: String!
    snapshotVersion: Int!
    triggerEvent: String!
    createdAt: String!
    vitalCount: Int!
    labCount: Int!
    medicationCount: Int!
    diagnosisCount: Int!
    allergyCount: Int!
  }

  type SnapshotResult {
    snapshot: ClinicalSnapshot!
    isNew: Boolean!
  }

  # =========================================================================
  # Patient Federation Extension (simplified clinical data)
  # =========================================================================

  enum PatientConditionStatus {
    ACTIVE
    RESOLVED
    INACTIVE
  }

  enum PatientMedicationStatus {
    ACTIVE
    DISCONTINUED
  }

  enum AllergySeverity {
    MILD
    MODERATE
    SEVERE
  }

  type PatientCondition {
    id: ID!
    code: String!
    codeSystem: String
    name: String!
    status: PatientConditionStatus!
    onsetDate: String
  }

  type PatientMedication {
    id: ID!
    name: String!
    dosage: String
    frequency: String
    status: PatientMedicationStatus!
    prescribedDate: String
  }

  type PatientAllergy {
    id: ID!
    allergen: String!
    reaction: String
    severity: AllergySeverity!
  }

  extend type Patient @key(fields: "id") {
    id: ID! @external
    conditions: [PatientCondition!]!
    medications: [PatientMedication!]!
    allergies: [PatientAllergy!]!
  }

  # =========================================================================
  # Main types
  # =========================================================================

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

  type EpicConnectionStatus {
    connected: Boolean!
    lastConnectionTest: String!
    responseTime: Int!
    errors: [String!]!
  }

  type SyncResult {
    success: Boolean!
    syncedDataTypes: [String!]!
    totalRecords: Int!
    processingTime: Int!
    errors: [SyncError!]!
  }

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

  enum SnapshotTrigger {
    VISIT
    CARE_PLAN_CREATION
    MANUAL_REFRESH
    SCHEDULED
  }

  # =========================================================================
  # Patient Search
  # =========================================================================

  input EpicPatientSearchInput {
    name: String
    family: String
    given: String
    birthdate: String
    gender: String
    identifier: String
    _count: Int
  }

  type EpicPatientSearchResult {
    epicPatientId: ID!
    firstName: String
    lastName: String
    dateOfBirth: String
    gender: String
    mrn: String
  }

  type EpicPatientSearchResponse {
    results: [EpicPatientSearchResult!]!
    totalCount: Int!
  }

  # =========================================================================
  # Queries & Mutations
  # =========================================================================

  type Query {
    epicPatientData(epicPatientId: ID!): EpicPatientData
    epicConnectionStatus: EpicConnectionStatus!
    searchEpicPatients(input: EpicPatientSearchInput!): EpicPatientSearchResponse!
    latestSnapshot(epicPatientId: ID!): ClinicalSnapshot
    snapshotHistory(epicPatientId: ID!, limit: Int): [SnapshotSummary!]!
    snapshot(snapshotId: ID!): ClinicalSnapshot
  }

  type Mutation {
    syncPatientDataFromEpic(
      epicPatientId: ID!
      dataTypes: [EpicDataType!]!
    ): SyncResult!

    createClinicalSnapshot(
      epicPatientId: ID!
      trigger: SnapshotTrigger!
    ): SnapshotResult!
  }
`;

// =============================================================================
// RESOLVERS
// =============================================================================

export const resolvers = {
  Query: {
    async epicPatientData(
      _: unknown,
      { epicPatientId }: { epicPatientId: string }
    ): Promise<EpicPatientData> {
      validateResourceId(epicPatientId, "epicPatientId");
      const requestId = generateRequestId();
      const fhirClient = getFhirClient();

      logger.info("Fetching Epic patient data", { requestId, epicPatientId });

      // -----------------------------------------------------------------------
      // Cache-first: check Redis for each resource
      // -----------------------------------------------------------------------
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

      // If everything is cached, return immediately
      if (
        cachedDemographics &&
        cachedVitals &&
        cachedLabs &&
        cachedMedications &&
        cachedDiagnoses &&
        cachedAllergies
      ) {
        logger.info("Full cache hit for patient data", {
          requestId,
          epicPatientId,
        });
        return {
          epicPatientId,
          demographics: cachedDemographics,
          vitals: cachedVitals,
          labs: cachedLabs,
          medications: cachedMedications,
          diagnoses: cachedDiagnoses,
          allergies: cachedAllergies,
          lastSync: new Date().toISOString(),
          errors: [],
        };
      }

      // -----------------------------------------------------------------------
      // Fetch missing data from Epic in parallel using allSettled
      // Each fetcher returns its typed result; failures are captured below.
      // -----------------------------------------------------------------------
      const [demoResult, vitalsResult, labsResult, medsResult, dxResult, allergyResult] =
        await Promise.allSettled([
          // Demographics
          cachedDemographics
            ? Promise.resolve(cachedDemographics)
            : (async (): Promise<PatientDemographicsOut> => {
                const result = await fhirClient.getPatient(epicPatientId, requestId);
                const demo = transformPatient(result.data);
                await setCached("patient", epicPatientId, demo);
                return demo;
              })(),

          // Vitals
          cachedVitals
            ? Promise.resolve(cachedVitals)
            : (async (): Promise<VitalOut[]> => {
                const result = await fhirClient.getObservations(epicPatientId, "vital-signs", requestId);
                const observations: FHIRObservation[] = result.data.entry?.map((e) => e.resource) || [];
                let transformed = transformVitals(observations);
                if (observations.length > 0) {
                  const extractionResult = await getExtractionClient().extractVitalsWithFallback(observations, requestId);
                  transformed = transformed.map((v) => {
                    const extracted = extractionResult.result.vitals.find(
                      (ev) => ev.type === v.type && ev.timestamp === v.recordedDate
                    );
                    if (extracted && extractionResult.fromService) {
                      return { ...v, value: extracted.normalizedValue, unit: extracted.normalizedUnit, isNormalized: true };
                    }
                    return v;
                  });
                }
                await setCached("vitals", epicPatientId, transformed);
                return transformed;
              })(),

          // Labs
          cachedLabs
            ? Promise.resolve(cachedLabs)
            : (async (): Promise<LabResultOut[]> => {
                const result = await fhirClient.getLabObservations(epicPatientId, requestId);
                const observations: FHIRObservation[] = result.data.entry?.map((e) => e.resource) || [];
                const transformed = transformLabResults(observations);
                await setCached("labs", epicPatientId, transformed);
                return transformed;
              })(),

          // Medications
          cachedMedications
            ? Promise.resolve(cachedMedications)
            : (async (): Promise<MedicationOut[]> => {
                const result = await fhirClient.getMedicationRequests(epicPatientId, requestId);
                const medRequests = result.data.entry?.map((e) => e.resource) || [];
                const resolvedMeds = await resolveMedicationReferences(medRequests, fhirClient, requestId);
                const transformed = transformMedications(medRequests, resolvedMeds);
                await setCached("medications", epicPatientId, transformed);
                return transformed;
              })(),

          // Diagnoses
          cachedDiagnoses
            ? Promise.resolve(cachedDiagnoses)
            : (async (): Promise<DiagnosisOut[]> => {
                const result = await fhirClient.getConditions(epicPatientId, requestId);
                const conditions = result.data.entry?.map((e) => e.resource) || [];
                const transformed = transformConditions(conditions);
                await setCached("conditions", epicPatientId, transformed);
                return transformed;
              })(),

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
        ]);

      // -----------------------------------------------------------------------
      // Extract results — collect errors for any rejected fetches
      // -----------------------------------------------------------------------
      const errors: DataFetchError[] = [];
      const dataTypeLabels = ["DEMOGRAPHICS", "VITALS", "LABS", "MEDICATIONS", "DIAGNOSES", "ALLERGIES"] as const;
      const results = [demoResult, vitalsResult, labsResult, medsResult, dxResult, allergyResult];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "rejected") {
          errors.push({
            dataType: dataTypeLabels[i],
            message: extractErrorMessage(r.reason),
            code: extractErrorCode(r.reason),
          });
        }
      }

      const demographics = demoResult.status === "fulfilled" ? demoResult.value : null;
      const vitals = vitalsResult.status === "fulfilled" ? vitalsResult.value : [];
      const labs = labsResult.status === "fulfilled" ? labsResult.value : [];
      const medications = medsResult.status === "fulfilled" ? medsResult.value : [];
      const diagnoses = dxResult.status === "fulfilled" ? dxResult.value : [];
      const allergies = allergyResult.status === "fulfilled" ? allergyResult.value : [];

      logger.info("Epic patient data fetch completed", {
        requestId,
        epicPatientId,
        hasErrors: errors.length > 0,
        errorCount: errors.length,
        vitalCount: vitals.length,
        labCount: labs.length,
        medicationCount: medications.length,
        diagnosisCount: diagnoses.length,
        allergyCount: allergies.length,
      });

      return {
        epicPatientId,
        demographics,
        vitals,
        labs,
        medications,
        diagnoses,
        allergies,
        lastSync: new Date().toISOString(),
        errors,
      };
    },

    async epicConnectionStatus(): Promise<EpicConnectionStatus> {
      const result = await getFhirClient().healthCheck();
      return {
        connected: result.connected,
        lastConnectionTest: new Date().toISOString(),
        responseTime: result.responseTime,
        errors: result.errors,
      };
    },

    async searchEpicPatients(
      _: unknown,
      { input }: { input: EpicPatientSearchInput }
    ): Promise<EpicPatientSearchResponse> {
      validateSearchInput(input);

      const requestId = generateRequestId();
      const fhirClient = getFhirClient();

      logger.info("Searching Epic patients", {
        requestId,
        searchFields: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined),
      });

      try {
        const result = await fhirClient.searchPatients(input, requestId);
        const entries = result.data.entry || [];

        const results: EpicPatientSearchResult[] = entries.map((entry) => {
          const patient = entry.resource;
          const officialName = patient.name?.find((n) => n.use === "official") || patient.name?.[0];
          const mrnIdentifier = patient.identifier?.find(
            (id) => id.type?.coding?.some((c) => c.code === "MR")
          );

          return {
            epicPatientId: patient.id || "",
            firstName: officialName?.given?.[0] || null,
            lastName: officialName?.family || null,
            dateOfBirth: patient.birthDate || null,
            gender: patient.gender || null,
            mrn: mrnIdentifier?.value || null,
          };
        });

        logger.info("Epic patient search completed", {
          requestId,
          resultCount: results.length,
        });

        return { results, totalCount: result.data.total ?? results.length };
      } catch (error) {
        const errorMessage = extractErrorMessage(error);
        logger.error(
          "Epic patient search failed",
          error instanceof Error ? error : new Error(errorMessage),
          { requestId, code: extractErrorCode(error) }
        );
        throw new Error(`Epic patient search failed: ${errorMessage}`);
      }
    },

    async latestSnapshot(
      _: unknown,
      { epicPatientId }: { epicPatientId: string }
    ): Promise<ClinicalSnapshotFull | null> {
      validateResourceId(epicPatientId, "epicPatientId");
      return getLatestSnapshot(epicPatientId);
    },

    async snapshotHistory(
      _: unknown,
      { epicPatientId, limit }: { epicPatientId: string; limit?: number }
    ): Promise<SnapshotSummary[]> {
      validateResourceId(epicPatientId, "epicPatientId");
      return getSnapshotHistory(epicPatientId, limit ?? 20);
    },

    async snapshot(
      _: unknown,
      { snapshotId }: { snapshotId: string }
    ): Promise<ClinicalSnapshotFull | null> {
      validateResourceId(snapshotId, "snapshotId");
      return getSnapshot(snapshotId);
    },
  },

  Mutation: {
    async syncPatientDataFromEpic(
      _: unknown,
      {
        epicPatientId,
        dataTypes,
      }: { epicPatientId: string; dataTypes: string[] }
    ): Promise<SyncResult> {
      validateResourceId(epicPatientId, "epicPatientId");
      const requestId = generateRequestId();
      const start = Date.now();
      const syncedDataTypes: string[] = [];
      const errors: SyncError[] = [];
      let totalRecords = 0;

      logger.info("Syncing patient data from Epic", {
        requestId,
        epicPatientId,
        dataTypes,
      });

      const fhirClient = getFhirClient();

      // Invalidate cache for this patient so fresh data is fetched
      await invalidatePatientCache(epicPatientId);

      const syncPromises = dataTypes.map(async (dataType) => {
        try {
          switch (dataType) {
            case "DEMOGRAPHICS": {
              const result = await fhirClient.getPatient(epicPatientId, requestId);
              const transformed = transformPatient(result.data);
              await setCached("patient", epicPatientId, transformed);
              return { dataType, records: 1, success: true };
            }
            case "VITALS": {
              const result = await fhirClient.getObservations(
                epicPatientId,
                "vital-signs",
                requestId
              );
              const observations: FHIRObservation[] =
                result.data.entry?.map((e) => e.resource) || [];
              const transformed = transformVitals(observations);
              await setCached("vitals", epicPatientId, transformed);
              return {
                dataType,
                records: transformed.length,
                success: true,
              };
            }
            case "LABS": {
              const result = await fhirClient.getLabObservations(
                epicPatientId,
                requestId
              );
              const observations: FHIRObservation[] =
                result.data.entry?.map((e) => e.resource) || [];
              const transformed = transformLabResults(observations);
              await setCached("labs", epicPatientId, transformed);
              return {
                dataType,
                records: transformed.length,
                success: true,
              };
            }
            case "MEDICATIONS": {
              const result = await fhirClient.getMedicationRequests(
                epicPatientId,
                requestId
              );
              const medRequests = result.data.entry?.map((e) => e.resource) || [];
              const resolvedMeds = await resolveMedicationReferences(medRequests, fhirClient, requestId);
              const transformed = transformMedications(medRequests, resolvedMeds);
              await setCached("medications", epicPatientId, transformed);
              return {
                dataType,
                records: transformed.length,
                success: true,
              };
            }
            case "DIAGNOSES": {
              const result = await fhirClient.getConditions(
                epicPatientId,
                requestId
              );
              const conditions = result.data.entry?.map((e) => e.resource) || [];
              const transformed = transformConditions(conditions);
              await setCached("conditions", epicPatientId, transformed);
              return {
                dataType,
                records: transformed.length,
                success: true,
              };
            }
            case "ALLERGIES": {
              const result = await fhirClient.getAllergyIntolerances(
                epicPatientId,
                requestId
              );
              const allergyIntolerances = result.data.entry?.map((e) => e.resource) || [];
              const transformed = transformAllergyIntolerances(allergyIntolerances);
              await setCached("allergies", epicPatientId, transformed);
              return {
                dataType,
                records: transformed.length,
                success: true,
              };
            }
            default:
              return {
                dataType,
                records: 0,
                success: false,
                error: `Unknown data type: ${dataType}`,
              };
          }
        } catch (error) {
          return {
            dataType,
            records: 0,
            success: false,
            error: extractErrorMessage(error),
          };
        }
      });

      const results = await Promise.all(syncPromises);

      for (const result of results) {
        if (result.success) {
          syncedDataTypes.push(result.dataType);
          totalRecords += result.records;
        } else {
          errors.push({
            dataType: result.dataType,
            message: result.error || "Unknown error",
          });
        }
      }

      const processingTime = Date.now() - start;

      logger.info("Patient data sync completed", {
        requestId,
        epicPatientId,
        success: errors.length === 0,
        syncedDataTypes,
        totalRecords,
        processingTime,
        errorCount: errors.length,
      });

      return {
        success: errors.length === 0,
        syncedDataTypes,
        totalRecords,
        processingTime,
        errors,
      };
    },

    async createClinicalSnapshot(
      _: unknown,
      {
        epicPatientId,
        trigger,
      }: { epicPatientId: string; trigger: string }
    ): Promise<{ snapshot: ClinicalSnapshotFull; isNew: boolean }> {
      validateResourceId(epicPatientId, "epicPatientId");
      const requestId = generateRequestId();
      const fhirClient = getFhirClient();

      logger.info("Creating clinical snapshot", {
        requestId,
        epicPatientId,
        trigger,
      });

      // Always fetch fresh data for snapshots (bypass cache)
      const [patientResult, vitalsResult, labsResult, medsResult, conditionsResult, allergyResult] =
        await Promise.allSettled([
          fhirClient.getPatient(epicPatientId, requestId),
          fhirClient.getObservations(epicPatientId, "vital-signs", requestId),
          fhirClient.getLabObservations(epicPatientId, requestId),
          fhirClient.getMedicationRequests(epicPatientId, requestId),
          fhirClient.getConditions(epicPatientId, requestId),
          fhirClient.getAllergyIntolerances(epicPatientId, requestId),
        ]);

      // Transform demographics
      let demographics: PatientDemographicsOut | null = null;
      if (patientResult.status === "fulfilled") {
        demographics = transformPatient(patientResult.value.data);
      }

      // Transform vitals
      let vitals: VitalOut[] = [];
      if (vitalsResult.status === "fulfilled") {
        const observations: FHIRObservation[] =
          vitalsResult.value.data.entry?.map((e) => e.resource) || [];
        vitals = transformVitals(observations);
      }

      // Transform labs
      let labs: LabResultOut[] = [];
      if (labsResult.status === "fulfilled") {
        const observations: FHIRObservation[] =
          labsResult.value.data.entry?.map((e) => e.resource) || [];
        labs = transformLabResults(observations);
      }

      // Transform medications (with reference resolution)
      let medications: MedicationOut[] = [];
      if (medsResult.status === "fulfilled") {
        const medRequests = medsResult.value.data.entry?.map((e) => e.resource) || [];
        const resolvedMeds = await resolveMedicationReferences(medRequests, fhirClient, requestId);
        medications = transformMedications(medRequests, resolvedMeds);
      }

      // Transform diagnoses
      let diagnoses: DiagnosisOut[] = [];
      if (conditionsResult.status === "fulfilled") {
        const conditions =
          conditionsResult.value.data.entry?.map((e) => e.resource) || [];
        diagnoses = transformConditions(conditions);
      }

      // Transform allergies
      let allergies: AllergyOut[] = [];
      if (allergyResult.status === "fulfilled") {
        const allergyIntolerances =
          allergyResult.value.data.entry?.map((e) => e.resource) || [];
        allergies = transformAllergyIntolerances(allergyIntolerances);
      }

      const snapshotData: SnapshotData = {
        demographics,
        vitals,
        labs,
        medications,
        diagnoses,
        allergies,
      };

      const snapshot = await createSnapshot(
        epicPatientId,
        trigger,
        snapshotData
      );

      // Always update the cache with fresh data (including empty arrays)
      // so subsequent reads don't trigger unnecessary FHIR fetches.
      if (demographics) await setCached("patient", epicPatientId, demographics);
      await setCached("vitals", epicPatientId, vitals);
      await setCached("labs", epicPatientId, labs);
      await setCached("medications", epicPatientId, medications);
      await setCached("conditions", epicPatientId, diagnoses);
      await setCached("allergies", epicPatientId, allergies);

      logger.info("Clinical snapshot created successfully", {
        requestId,
        epicPatientId,
        snapshotId: snapshot.id,
        snapshotVersion: snapshot.snapshotVersion,
      });

      return { snapshot, isNew: true };
    },
  },

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

      return {
        id: ref.id,
        conditions: mapConditions(clinicalData.diagnoses),
        medications: mapMedications(clinicalData.medications),
        allergies: mapAllergies(clinicalData.allergies),
      };
    },
  },
};

// =============================================================================
// HELPERS
// =============================================================================

/** Maximum allowed length for FHIR resource IDs. */
const MAX_ID_LENGTH = 128;

/** Pattern for valid FHIR resource IDs (alphanumeric, hyphens, dots). */
const VALID_ID_PATTERN = /^[A-Za-z0-9\-._]+$/;

/**
 * Validate a FHIR resource ID. Throws a GraphQL-friendly error if invalid.
 */
export function validateResourceId(id: string, label: string): void {
  if (!id || id.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  if (id.length > MAX_ID_LENGTH) {
    throw new Error(`${label} exceeds maximum length of ${MAX_ID_LENGTH} characters`);
  }
  if (!VALID_ID_PATTERN.test(id)) {
    throw new Error(`${label} contains invalid characters`);
  }
}

/**
 * Resolve medicationReferences from a list of MedicationRequests.
 * Deduplicates references, checks cache first, fetches missing ones,
 * and caches newly resolved medications.
 */
async function resolveMedicationReferences(
  medRequests: FHIRMedicationRequest[],
  fhirClient: EpicFhirClient,
  requestId: string
): Promise<Map<string, FHIRMedication>> {
  const resolvedMeds = new Map<string, FHIRMedication>();
  const refsToResolve = medRequests
    .filter((m) => m.medicationReference?.reference)
    .map((m) => m.medicationReference!.reference!);
  const uniqueRefs = [...new Set(refsToResolve)];

  await Promise.all(
    uniqueRefs.map(async (ref) => {
      const cached = await getCachedMedicationRef<FHIRMedication>(ref);
      if (cached) {
        resolvedMeds.set(ref, cached);
        return;
      }
      try {
        const medResult = await fhirClient.getMedication(ref, requestId);
        resolvedMeds.set(ref, medResult.data);
        await setCachedMedicationRef(ref, medResult.data);
      } catch (err) {
        logger.warn("Failed to resolve medication reference", {
          requestId,
          reference: ref,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })
  );

  return resolvedMeds;
}

/** Maximum allowed length for search string parameters. */
const MAX_SEARCH_STRING_LENGTH = 200;

/** Maximum allowed value for _count. */
const MAX_COUNT = 50;

/** Pattern for valid date strings (YYYY-MM-DD). */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Pattern to reject control characters. */
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

/**
 * Validate search input. Throws if:
 * - No search params provided
 * - String params exceed length or contain control chars
 * - birthdate is not YYYY-MM-DD
 * - _count exceeds maximum
 */
export function validateSearchInput(input: EpicPatientSearchInput): void {
  const stringFields: (keyof EpicPatientSearchInput)[] = ["name", "family", "given", "birthdate", "gender", "identifier"];
  const providedFields = stringFields.filter((k) => input[k] !== undefined && input[k] !== "");

  if (providedFields.length === 0) {
    throw new Error("At least one search parameter is required");
  }

  for (const field of providedFields) {
    const value = input[field] as string;
    if (value.length > MAX_SEARCH_STRING_LENGTH) {
      throw new Error(`${field} exceeds maximum length of ${MAX_SEARCH_STRING_LENGTH} characters`);
    }
    if (CONTROL_CHAR_PATTERN.test(value)) {
      throw new Error(`${field} contains invalid characters`);
    }
  }

  if (input.birthdate !== undefined && input.birthdate !== "") {
    if (!DATE_PATTERN.test(input.birthdate)) {
      throw new Error("birthdate must be in YYYY-MM-DD format");
    }
  }

  if (input._count !== undefined) {
    if (input._count < 1 || input._count > MAX_COUNT) {
      throw new Error(`_count must be between 1 and ${MAX_COUNT}`);
    }
  }
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      return `HTTP ${error.response.status}: ${error.response.statusText}`;
    }
    if (error.code === "ECONNREFUSED") {
      return "Connection refused - service may be down";
    }
    if (error.code === "ETIMEDOUT") {
      return "Request timed out";
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

export function extractErrorCode(error: unknown): string | undefined {
  if (error instanceof AxiosError) {
    if (error.response) {
      return `HTTP_${error.response.status}`;
    }
    return error.code;
  }
  return undefined;
}

