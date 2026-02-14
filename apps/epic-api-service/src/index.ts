/**
 * Epic API Service
 *
 * GraphQL subgraph for Epic EHR integration.
 * - Fetches patient data from Epic FHIR APIs and normalizes it for the federated graph.
 * - Redis cache for live FHIR data (short TTL, always-fresh pass-through)
 * - PostgreSQL immutable snapshots for clinical audit trail
 * - Feature extraction service integration with graceful fallback
 */

import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";
import gql from "graphql-tag";
import { Pool } from "pg";
import { Redis } from "ioredis";
import { AxiosError } from "axios";
import {
  getExtractionClient,
  getFhirClient,
  FHIRObservation,
  FHIRMedication,
  FHIRMedicationRequest,
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
  type PatientDemographicsOut,
  type VitalOut,
  type LabResultOut,
  type MedicationOut,
  type DiagnosisOut,
} from "./services/transforms";
import { initializeCache, getCached, setCached, getCachedMedicationRef, setCachedMedicationRef, invalidatePatientCache, type CacheResource } from "./services/cache";
import { initializeDatabase, createSnapshot, getLatestSnapshot, getSnapshotHistory, getSnapshot, type SnapshotData, type ClinicalSnapshotFull, type SnapshotSummary } from "./services/database";

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
  lastSync: string;
  errors: DataFetchError[];
}

interface DataFetchError {
  dataType: string;
  message: string;
  code?: string;
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

const typeDefs = gql`
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
  }

  type SnapshotResult {
    snapshot: ClinicalSnapshot!
    isNew: Boolean!
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
  }

  enum SnapshotTrigger {
    VISIT
    CARE_PLAN_CREATION
    MANUAL_REFRESH
    SCHEDULED
  }

  # =========================================================================
  # Queries & Mutations
  # =========================================================================

  type Query {
    epicPatientData(epicPatientId: ID!): EpicPatientData
    epicConnectionStatus: EpicConnectionStatus!
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

const resolvers = {
  Query: {
    async epicPatientData(
      _: unknown,
      { epicPatientId }: { epicPatientId: string }
    ): Promise<EpicPatientData> {
      const requestId = generateRequestId();
      const fhirClient = getFhirClient();
      const errors: DataFetchError[] = [];

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
      ] = await Promise.all([
        getCached<PatientDemographicsOut>("patient", epicPatientId),
        getCached<VitalOut[]>("vitals", epicPatientId),
        getCached<LabResultOut[]>("labs", epicPatientId),
        getCached<MedicationOut[]>("medications", epicPatientId),
        getCached<DiagnosisOut[]>("conditions", epicPatientId),
      ]);

      // If everything is cached, return immediately
      if (
        cachedDemographics &&
        cachedVitals &&
        cachedLabs &&
        cachedMedications &&
        cachedDiagnoses
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
          lastSync: new Date().toISOString(),
          errors: [],
        };
      }

      // -----------------------------------------------------------------------
      // Fetch missing data from Epic in parallel
      // -----------------------------------------------------------------------
      const fetchPromises: Promise<void>[] = [];

      let demographics: PatientDemographicsOut | null =
        cachedDemographics || null;
      let vitals: VitalOut[] = cachedVitals || [];
      let labs: LabResultOut[] = cachedLabs || [];
      let medications: MedicationOut[] = cachedMedications || [];
      let diagnoses: DiagnosisOut[] = cachedDiagnoses || [];

      // Demographics
      if (!cachedDemographics) {
        fetchPromises.push(
          (async () => {
            try {
              const result = await fhirClient.getPatient(
                epicPatientId,
                requestId
              );
              demographics = transformPatient(result.data);
              await setCached("patient", epicPatientId, demographics);
            } catch (error) {
              errors.push({
                dataType: "DEMOGRAPHICS",
                message: extractErrorMessage(error),
                code: extractErrorCode(error),
              });
            }
          })()
        );
      }

      // Vitals
      if (!cachedVitals) {
        fetchPromises.push(
          (async () => {
            try {
              const result = await fhirClient.getObservations(
                epicPatientId,
                "vital-signs",
                requestId
              );
              const observations: FHIRObservation[] =
                result.data.entry?.map((e) => e.resource) || [];

              if (observations.length > 0) {
                // Use extraction service with fallback
                const extractionResult =
                  await getExtractionClient().extractVitalsWithFallback(
                    observations,
                    requestId
                  );

                // Transform raw observations for full schema data
                const transformed = transformVitals(observations);
                // Merge normalized values from extraction service
                vitals = transformed.map((v) => {
                  const extracted = extractionResult.result.vitals.find(
                    (ev) => ev.type === v.type && ev.timestamp === v.recordedDate
                  );
                  if (extracted && extractionResult.fromService) {
                    return {
                      ...v,
                      value: extracted.normalizedValue,
                      unit: extracted.normalizedUnit,
                      isNormalized: true,
                    };
                  }
                  return v;
                });
              }
              await setCached("vitals", epicPatientId, vitals);
            } catch (error) {
              errors.push({
                dataType: "VITALS",
                message: extractErrorMessage(error),
                code: extractErrorCode(error),
              });
            }
          })()
        );
      }

      // Labs
      if (!cachedLabs) {
        fetchPromises.push(
          (async () => {
            try {
              const result = await fhirClient.getLabObservations(
                epicPatientId,
                requestId
              );
              const observations: FHIRObservation[] =
                result.data.entry?.map((e) => e.resource) || [];
              labs = transformLabResults(observations);
              await setCached("labs", epicPatientId, labs);
            } catch (error) {
              errors.push({
                dataType: "LABS",
                message: extractErrorMessage(error),
                code: extractErrorCode(error),
              });
            }
          })()
        );
      }

      // Medications
      if (!cachedMedications) {
        fetchPromises.push(
          (async () => {
            try {
              const result = await fhirClient.getMedicationRequests(
                epicPatientId,
                requestId
              );
              const medRequests = result.data.entry?.map((e) => e.resource) || [];
              const resolvedMeds = await resolveMedicationReferences(medRequests, fhirClient, requestId);
              medications = transformMedications(medRequests, resolvedMeds);
              await setCached("medications", epicPatientId, medications);
            } catch (error) {
              errors.push({
                dataType: "MEDICATIONS",
                message: extractErrorMessage(error),
                code: extractErrorCode(error),
              });
            }
          })()
        );
      }

      // Diagnoses
      if (!cachedDiagnoses) {
        fetchPromises.push(
          (async () => {
            try {
              const result = await fhirClient.getConditions(
                epicPatientId,
                requestId
              );
              const conditions = result.data.entry?.map((e) => e.resource) || [];
              diagnoses = transformConditions(conditions);
              await setCached("conditions", epicPatientId, diagnoses);
            } catch (error) {
              errors.push({
                dataType: "DIAGNOSES",
                message: extractErrorMessage(error),
                code: extractErrorCode(error),
              });
            }
          })()
        );
      }

      await Promise.all(fetchPromises);

      logger.info("Epic patient data fetch completed", {
        requestId,
        epicPatientId,
        hasErrors: errors.length > 0,
        errorCount: errors.length,
        vitalCount: vitals.length,
        labCount: labs.length,
        medicationCount: medications.length,
        diagnosisCount: diagnoses.length,
      });

      return {
        epicPatientId,
        demographics,
        vitals,
        labs,
        medications,
        diagnoses,
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

    async latestSnapshot(
      _: unknown,
      { epicPatientId }: { epicPatientId: string }
    ): Promise<ClinicalSnapshotFull | null> {
      return getLatestSnapshot(epicPatientId);
    },

    async snapshotHistory(
      _: unknown,
      { epicPatientId, limit }: { epicPatientId: string; limit?: number }
    ): Promise<SnapshotSummary[]> {
      return getSnapshotHistory(epicPatientId, limit ?? 20);
    },

    async snapshot(
      _: unknown,
      { snapshotId }: { snapshotId: string }
    ): Promise<ClinicalSnapshotFull | null> {
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
      const requestId = generateRequestId();
      const fhirClient = getFhirClient();

      logger.info("Creating clinical snapshot", {
        requestId,
        epicPatientId,
        trigger,
      });

      // Always fetch fresh data for snapshots (bypass cache)
      const [patientResult, vitalsResult, labsResult, medsResult, conditionsResult] =
        await Promise.allSettled([
          fhirClient.getPatient(epicPatientId, requestId),
          fhirClient.getObservations(epicPatientId, "vital-signs", requestId),
          fhirClient.getLabObservations(epicPatientId, requestId),
          fhirClient.getMedicationRequests(epicPatientId, requestId),
          fhirClient.getConditions(epicPatientId, requestId),
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

      const snapshotData: SnapshotData = {
        demographics,
        vitals,
        labs,
        medications,
        diagnoses,
      };

      const snapshot = await createSnapshot(
        epicPatientId,
        trigger,
        snapshotData
      );

      // Also update the cache with fresh data
      if (demographics) await setCached("patient", epicPatientId, demographics);
      if (vitals.length > 0) await setCached("vitals", epicPatientId, vitals);
      if (labs.length > 0) await setCached("labs", epicPatientId, labs);
      if (medications.length > 0) await setCached("medications", epicPatientId, medications);
      if (diagnoses.length > 0) await setCached("conditions", epicPatientId, diagnoses);

      logger.info("Clinical snapshot created successfully", {
        requestId,
        epicPatientId,
        snapshotId: snapshot.id,
        snapshotVersion: snapshot.snapshotVersion,
      });

      return { snapshot, isNew: true };
    },
  },
};

// =============================================================================
// HELPERS
// =============================================================================

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

function extractErrorMessage(error: unknown): string {
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

function extractErrorCode(error: unknown): string | undefined {
  if (error instanceof AxiosError) {
    if (error.response) {
      return `HTTP_${error.response.status}`;
    }
    return error.code;
  }
  return undefined;
}

// =============================================================================
// SERVER
// =============================================================================

async function main(): Promise<void> {
  try {
    // Initialize PostgreSQL
    const pgPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        "postgresql://postgres:postgres@localhost:5432/prism",
      max: 10,
    });

    // Initialize Redis
    const redisClient = new Redis(
      process.env.REDIS_URL || "redis://localhost:6379",
      {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      }
    );
    await redisClient.connect();

    // Initialize services
    initializeDatabase(pgPool, redisClient);
    initializeCache(redisClient);

    logger.info("Database and cache initialized");

    const server = new ApolloServer({
      schema: buildSubgraphSchema({
        typeDefs,
        resolvers,
      }),
    });

    const { url } = await startStandaloneServer(server, {
      listen: { port: parseInt(process.env.PORT || "4006") },
    });

    logger.info(`Epic API Service ready at ${url}`, {
      epicAuthEnabled: process.env.EPIC_AUTH_ENABLED === "true",
      epicBaseUrl: process.env.EPIC_BASE_URL || "http://epic-mock:8080",
    });
  } catch (error) {
    logger.error(
      "Failed to start Epic API service",
      error instanceof Error ? error : undefined
    );
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error(
    "Failed to start Epic API service",
    error instanceof Error ? error : undefined
  );
  process.exit(1);
});
