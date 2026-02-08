/**
 * Epic API Service
 *
 * GraphQL subgraph for Epic EHR integration.
 * Fetches patient data from Epic FHIR APIs and normalizes it for the federated graph.
 *
 * Improvements:
 * - Proper TypeScript types (no `any`)
 * - Explicit error handling with error field in responses
 * - Uses FeatureExtractionClient with graceful fallback
 * - Structured logging
 * - Request correlation
 */

import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";
import gql from "graphql-tag";
import axios, { AxiosError } from "axios";
import {
  getExtractionClient,
  FHIRObservation,
} from "./clients";
import { createLogger } from "./clients/logger";
import { generateRequestId } from "./clients/http-utils";

// =============================================================================
// TYPES
// =============================================================================

interface PatientDemographics {
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  mrn: string;
}

interface Vital {
  type: string;
  value: number;
  unit: string;
  recordedDate: string;
  isNormalized: boolean;
}

interface Medication {
  name: string;
  status: string;
  dosage: string;
}

interface Diagnosis {
  code: string;
  display: string;
  recordedDate: string;
}

interface EpicPatientData {
  epicPatientId: string;
  demographics: PatientDemographics | null;
  vitals: Vital[];
  medications: Medication[];
  diagnoses: Diagnosis[];
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

// FHIR Bundle types
interface FHIRBundleEntry<T> {
  resource: T;
}

interface FHIRBundle<T> {
  entry?: FHIRBundleEntry<T>[];
}

interface FHIRPatient {
  name?: Array<{
    given?: string[];
    family?: string;
  }>;
  gender?: string;
  birthDate?: string;
  identifier?: Array<{
    value?: string;
  }>;
}

interface FHIRMedicationRequest {
  medicationCodeableConcept?: {
    coding?: Array<{
      display?: string;
    }>;
  };
  status?: string;
  dosageInstruction?: Array<{
    text?: string;
  }>;
}

interface FHIRCondition {
  code?: {
    coding?: Array<{
      code?: string;
      display?: string;
    }>;
  };
  recordedDate?: string;
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

  type EpicPatientData @key(fields: "epicPatientId") {
    epicPatientId: ID!
    demographics: PatientDemographics
    vitals: [Vital!]!
    medications: [Medication!]!
    diagnoses: [Diagnosis!]!
    lastSync: String
    errors: [DataFetchError!]!
  }

  type PatientDemographics {
    firstName: String
    lastName: String
    gender: String
    dateOfBirth: String
    mrn: String
  }

  type Vital {
    type: String!
    value: Float!
    unit: String!
    recordedDate: String!
    isNormalized: Boolean!
  }

  type Medication {
    name: String!
    status: String!
    dosage: String
  }

  type Diagnosis {
    code: String!
    display: String!
    recordedDate: String!
  }

  type DataFetchError {
    dataType: String!
    message: String!
    code: String
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

  type SyncError {
    dataType: String!
    message: String!
  }

  enum EpicDataType {
    DEMOGRAPHICS
    VITALS
    MEDICATIONS
    DIAGNOSES
  }

  type Query {
    epicPatientData(epicPatientId: ID!): EpicPatientData
    epicConnectionStatus: EpicConnectionStatus!
  }

  type Mutation {
    syncPatientDataFromEpic(
      epicPatientId: ID!
      dataTypes: [EpicDataType!]!
    ): SyncResult!
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
      const epicBaseUrl = process.env.EPIC_BASE_URL || "http://epic-mock:8080";
      const errors: DataFetchError[] = [];

      logger.info("Fetching Epic patient data", { requestId, epicPatientId });

      // Fetch all data in parallel
      const [patientResult, vitalsResult, medsResult, conditionsResult] =
        await Promise.allSettled([
          axios.get<FHIRPatient>(`${epicBaseUrl}/Patient/${epicPatientId}`),
          axios.get<FHIRBundle<FHIRObservation>>(`${epicBaseUrl}/Observation`, {
            params: {
              patient: `Patient/${epicPatientId}`,
              category: "vital-signs",
            },
          }),
          axios.get<FHIRBundle<FHIRMedicationRequest>>(
            `${epicBaseUrl}/MedicationRequest`,
            {
              params: { patient: `Patient/${epicPatientId}` },
            }
          ),
          axios.get<FHIRBundle<FHIRCondition>>(`${epicBaseUrl}/Condition`, {
            params: { patient: `Patient/${epicPatientId}` },
          }),
        ]);

      // Process demographics
      let demographics: PatientDemographics | null = null;
      if (patientResult.status === "fulfilled") {
        const patient = patientResult.value.data;
        demographics = {
          firstName: patient.name?.[0]?.given?.[0] || "",
          lastName: patient.name?.[0]?.family || "",
          gender: patient.gender || "",
          dateOfBirth: patient.birthDate || "",
          mrn: patient.identifier?.[0]?.value || "",
        };
      } else {
        errors.push({
          dataType: "DEMOGRAPHICS",
          message: extractErrorMessage(patientResult.reason),
          code: extractErrorCode(patientResult.reason),
        });
      }

      // Process vitals with extraction service
      let vitals: Vital[] = [];
      if (vitalsResult.status === "fulfilled") {
        const rawEntries = vitalsResult.value.data.entry || [];
        const observations: FHIRObservation[] = rawEntries.map(
          (entry) => entry.resource
        );

        if (observations.length > 0) {
          const extractionResult =
            await getExtractionClient().extractVitalsWithFallback(
              observations,
              requestId
            );

          vitals = extractionResult.result.vitals.map((v) => ({
            type: v.type,
            value: v.normalizedValue,
            unit: v.normalizedUnit,
            recordedDate: v.timestamp || "",
            isNormalized: extractionResult.fromService,
          }));

          if (!extractionResult.fromService) {
            logger.warn("Using fallback vitals extraction", {
              requestId,
              epicPatientId,
              serviceError: extractionResult.serviceError,
            });
          }
        }
      } else {
        errors.push({
          dataType: "VITALS",
          message: extractErrorMessage(vitalsResult.reason),
          code: extractErrorCode(vitalsResult.reason),
        });
      }

      // Process medications
      let medications: Medication[] = [];
      if (medsResult.status === "fulfilled") {
        medications =
          medsResult.value.data.entry?.map((entry) => ({
            name:
              entry.resource.medicationCodeableConcept?.coding?.[0]?.display ||
              "Unknown",
            status: entry.resource.status || "unknown",
            dosage: entry.resource.dosageInstruction?.[0]?.text || "",
          })) || [];
      } else {
        errors.push({
          dataType: "MEDICATIONS",
          message: extractErrorMessage(medsResult.reason),
          code: extractErrorCode(medsResult.reason),
        });
      }

      // Process diagnoses
      let diagnoses: Diagnosis[] = [];
      if (conditionsResult.status === "fulfilled") {
        diagnoses =
          conditionsResult.value.data.entry?.map((entry) => ({
            code: entry.resource.code?.coding?.[0]?.code || "",
            display: entry.resource.code?.coding?.[0]?.display || "Unknown",
            recordedDate: entry.resource.recordedDate || "",
          })) || [];
      } else {
        errors.push({
          dataType: "DIAGNOSES",
          message: extractErrorMessage(conditionsResult.reason),
          code: extractErrorCode(conditionsResult.reason),
        });
      }

      logger.info("Epic patient data fetch completed", {
        requestId,
        epicPatientId,
        hasErrors: errors.length > 0,
        errorCount: errors.length,
        vitalCount: vitals.length,
        medicationCount: medications.length,
        diagnosisCount: diagnoses.length,
      });

      return {
        epicPatientId,
        demographics,
        vitals,
        medications,
        diagnoses,
        lastSync: new Date().toISOString(),
        errors,
      };
    },

    async epicConnectionStatus(): Promise<EpicConnectionStatus> {
      const start = Date.now();
      const epicBaseUrl = process.env.EPIC_BASE_URL || "http://epic-mock:8080";

      try {
        await axios.get(`${epicBaseUrl}/health`, { timeout: 5000 });
        const responseTime = Date.now() - start;

        return {
          connected: true,
          lastConnectionTest: new Date().toISOString(),
          responseTime,
          errors: [],
        };
      } catch (error) {
        const responseTime = Date.now() - start;
        return {
          connected: false,
          lastConnectionTest: new Date().toISOString(),
          responseTime,
          errors: [extractErrorMessage(error)],
        };
      }
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

      const epicBaseUrl = process.env.EPIC_BASE_URL || "http://epic-mock:8080";

      // Process each data type
      const syncPromises = dataTypes.map(async (dataType) => {
        try {
          switch (dataType) {
            case "DEMOGRAPHICS": {
              await axios.get(`${epicBaseUrl}/Patient/${epicPatientId}`);
              return { dataType, records: 1, success: true };
            }
            case "VITALS": {
              const response = await axios.get<FHIRBundle<FHIRObservation>>(
                `${epicBaseUrl}/Observation`,
                {
                  params: {
                    patient: `Patient/${epicPatientId}`,
                    category: "vital-signs",
                  },
                }
              );
              return {
                dataType,
                records: response.data.entry?.length || 0,
                success: true,
              };
            }
            case "MEDICATIONS": {
              const response = await axios.get<
                FHIRBundle<FHIRMedicationRequest>
              >(`${epicBaseUrl}/MedicationRequest`, {
                params: { patient: `Patient/${epicPatientId}` },
              });
              return {
                dataType,
                records: response.data.entry?.length || 0,
                success: true,
              };
            }
            case "DIAGNOSES": {
              const response = await axios.get<FHIRBundle<FHIRCondition>>(
                `${epicBaseUrl}/Condition`,
                {
                  params: { patient: `Patient/${epicPatientId}` },
                }
              );
              return {
                dataType,
                records: response.data.entry?.length || 0,
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
  },
};

// =============================================================================
// HELPERS
// =============================================================================

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
    const server = new ApolloServer({
      schema: buildSubgraphSchema({
        typeDefs,
        resolvers,
      }),
    });

    const { url } = await startStandaloneServer(server, {
      listen: { port: parseInt(process.env.PORT || "4006") },
    });

    logger.info(`Epic API Service ready at ${url}`);
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
