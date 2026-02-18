/**
 * Epic FHIR Client
 *
 * Authenticated HTTP client for Epic FHIR APIs.
 * Features:
 * - Automatic Bearer token injection when auth is enabled
 * - Transparent passthrough when auth is disabled (mock compatibility)
 * - Convenience methods for common FHIR resource queries
 * - Structured logging with request correlation
 * - Dependency injection support for testing
 */

import axios, { AxiosResponse } from "axios";
import { Logger, createLogger } from "./logger";
import { getAuthClient } from "./epic-auth-client";

// =============================================================================
// TYPES — FHIR R4 Primitives
// =============================================================================

export interface EpicFhirClientConfig {
  baseUrl: string;
  authEnabled: boolean;
  timeout: number;
}

export interface FHIRCoding {
  system?: string;
  code?: string;
  display?: string;
  version?: string;
  userSelected?: boolean;
}

export interface FHIRCodeableConcept {
  coding?: FHIRCoding[];
  text?: string;
}

export interface FHIRReference {
  reference?: string;
  type?: string;
  display?: string;
}

export interface FHIRPeriod {
  start?: string;
  end?: string;
}

export interface FHIRIdentifier {
  use?: string;
  type?: FHIRCodeableConcept;
  system?: string;
  value?: string;
  period?: FHIRPeriod;
}

export interface FHIRHumanName {
  use?: string;
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
  period?: FHIRPeriod;
}

export interface FHIRContactPoint {
  system?: string;
  value?: string;
  use?: string;
  rank?: number;
  period?: FHIRPeriod;
}

export interface FHIRAddress {
  use?: string;
  type?: string;
  text?: string;
  line?: string[];
  city?: string;
  district?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  period?: FHIRPeriod;
}

export interface FHIRExtension {
  url: string;
  valueString?: string;
  valueCoding?: FHIRCoding;
  valueCode?: string;
  extension?: FHIRExtension[];
}

export interface FHIRAnnotation {
  text: string;
  time?: string;
  authorReference?: FHIRReference;
  authorString?: string;
}

// =============================================================================
// TYPES — FHIR Bundle
// =============================================================================

interface FHIRBundleEntry<T> {
  resource: T;
}

export interface FHIRBundle<T> {
  resourceType?: string;
  type?: string;
  total?: number;
  entry?: FHIRBundleEntry<T>[];
  link?: Array<{
    relation: string;
    url: string;
  }>;
}

// =============================================================================
// TYPES — FHIR Patient (R4)
// =============================================================================

export interface FHIRPatientContact {
  relationship?: FHIRCodeableConcept[];
  name?: FHIRHumanName;
  telecom?: FHIRContactPoint[];
  address?: FHIRAddress;
  gender?: string;
  organization?: FHIRReference;
  period?: FHIRPeriod;
}

export interface FHIRPatientCommunication {
  language: FHIRCodeableConcept;
  preferred?: boolean;
}

export interface FHIRPatient {
  resourceType?: string;
  id?: string;
  identifier?: FHIRIdentifier[];
  active?: boolean;
  name?: FHIRHumanName[];
  telecom?: FHIRContactPoint[];
  gender?: string;
  birthDate?: string;
  deceasedBoolean?: boolean;
  deceasedDateTime?: string;
  address?: FHIRAddress[];
  maritalStatus?: FHIRCodeableConcept;
  contact?: FHIRPatientContact[];
  communication?: FHIRPatientCommunication[];
  generalPractitioner?: FHIRReference[];
  extension?: FHIRExtension[];
}

// =============================================================================
// TYPES — FHIR MedicationRequest (R4)
// =============================================================================

export interface FHIRDosage {
  sequence?: number;
  text?: string;
  timing?: {
    repeat?: {
      frequency?: number;
      period?: number;
      periodUnit?: string;
      boundsPeriod?: FHIRPeriod;
      when?: string[];
    };
    code?: FHIRCodeableConcept;
  };
  asNeededBoolean?: boolean;
  asNeededCodeableConcept?: FHIRCodeableConcept;
  site?: FHIRCodeableConcept;
  route?: FHIRCodeableConcept;
  method?: FHIRCodeableConcept;
  doseAndRate?: Array<{
    type?: FHIRCodeableConcept;
    doseQuantity?: { value: number; unit: string; system?: string; code?: string };
    doseRange?: {
      low?: { value: number; unit: string };
      high?: { value: number; unit: string };
    };
    rateQuantity?: { value: number; unit: string };
  }>;
  maxDosePerPeriod?: {
    numerator?: { value: number; unit: string };
    denominator?: { value: number; unit: string };
  };
  maxDosePerAdministration?: { value: number; unit: string };
}

export interface FHIRMedicationRequest {
  resourceType?: string;
  id?: string;
  status?: string;
  statusReason?: FHIRCodeableConcept;
  intent?: string;
  category?: FHIRCodeableConcept[];
  priority?: string;
  medicationCodeableConcept?: FHIRCodeableConcept;
  medicationReference?: FHIRReference;
  subject?: FHIRReference;
  encounter?: FHIRReference;
  authoredOn?: string;
  requester?: FHIRReference;
  reasonCode?: FHIRCodeableConcept[];
  reasonReference?: FHIRReference[];
  note?: FHIRAnnotation[];
  dosageInstruction?: FHIRDosage[];
  dispenseRequest?: {
    validityPeriod?: FHIRPeriod;
    numberOfRepeatsAllowed?: number;
    quantity?: { value: number; unit: string; system?: string; code?: string };
    expectedSupplyDuration?: { value: number; unit: string };
  };
  substitution?: {
    allowedBoolean?: boolean;
    allowedCodeableConcept?: FHIRCodeableConcept;
    reason?: FHIRCodeableConcept;
  };
  courseOfTherapyType?: FHIRCodeableConcept;
}

// =============================================================================
// TYPES — FHIR Condition (R4)
// =============================================================================

export interface FHIRCondition {
  resourceType?: string;
  id?: string;
  clinicalStatus?: FHIRCodeableConcept;
  verificationStatus?: FHIRCodeableConcept;
  category?: FHIRCodeableConcept[];
  severity?: FHIRCodeableConcept;
  code?: FHIRCodeableConcept;
  bodySite?: FHIRCodeableConcept[];
  subject?: FHIRReference;
  encounter?: FHIRReference;
  onsetDateTime?: string;
  onsetAge?: { value: number; unit: string };
  onsetPeriod?: FHIRPeriod;
  onsetString?: string;
  abatementDateTime?: string;
  abatementAge?: { value: number; unit: string };
  abatementPeriod?: FHIRPeriod;
  abatementString?: string;
  recordedDate?: string;
  recorder?: FHIRReference;
  asserter?: FHIRReference;
  stage?: Array<{
    summary?: FHIRCodeableConcept;
    assessment?: FHIRReference[];
    type?: FHIRCodeableConcept;
  }>;
  evidence?: Array<{
    code?: FHIRCodeableConcept[];
    detail?: FHIRReference[];
  }>;
  note?: FHIRAnnotation[];
}

// =============================================================================
// TYPES — FHIR Medication (for resolving medicationReference)
// =============================================================================

export interface FHIRMedication {
  resourceType?: string;
  id?: string;
  code?: FHIRCodeableConcept;
  status?: string;
  form?: FHIRCodeableConcept;
}

// =============================================================================
// TYPES — FHIR AllergyIntolerance (R4)
// =============================================================================

export interface FHIRAllergyIntoleranceReaction {
  substance?: FHIRCodeableConcept;
  manifestation: FHIRCodeableConcept[];
  description?: string;
  onset?: string;
  severity?: string;
  exposureRoute?: FHIRCodeableConcept;
  note?: FHIRAnnotation[];
}

export interface FHIRAllergyIntolerance {
  resourceType?: string;
  id?: string;
  clinicalStatus?: FHIRCodeableConcept;
  verificationStatus?: FHIRCodeableConcept;
  type?: string;
  category?: string[];
  criticality?: string;
  code?: FHIRCodeableConcept;
  patient?: FHIRReference;
  encounter?: FHIRReference;
  onsetDateTime?: string;
  onsetAge?: { value: number; unit: string };
  onsetString?: string;
  recordedDate?: string;
  recorder?: FHIRReference;
  asserter?: FHIRReference;
  lastOccurrence?: string;
  note?: FHIRAnnotation[];
  reaction?: FHIRAllergyIntoleranceReaction[];
}

// =============================================================================
// CLIENT IMPLEMENTATION
// =============================================================================

export class EpicFhirClient {
  private readonly config: EpicFhirClientConfig;
  private readonly logger: Logger;

  constructor(config?: Partial<EpicFhirClientConfig>) {
    this.config = {
      baseUrl:
        config?.baseUrl ||
        process.env.EPIC_BASE_URL ||
        "http://epic-mock:8080",
      authEnabled:
        config?.authEnabled ??
        process.env.EPIC_AUTH_ENABLED === "true",
      timeout:
        config?.timeout ??
        parseInt(process.env.EPIC_TIMEOUT || "30000"),
    };
    this.logger = createLogger("epic-fhir-client");
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: "application/fhir+json",
    };

    if (this.config.authEnabled) {
      const token = await getAuthClient().getAccessToken();
      headers["Authorization"] = `Bearer ${token}`;
    }

    return headers;
  }

  async get<T>(
    path: string,
    params?: Record<string, string>,
    requestId?: string
  ): Promise<AxiosResponse<T>> {
    const headers = await this.getHeaders();
    const url = `${this.config.baseUrl}/${path}`;

    this.logger.debug("FHIR request", {
      requestId,
      method: "GET",
      path,
      authEnabled: this.config.authEnabled,
    });

    return axios.get<T>(url, {
      params,
      headers,
      timeout: this.config.timeout,
    });
  }

  async getPatient(
    patientId: string,
    requestId?: string
  ): Promise<AxiosResponse<FHIRPatient>> {
    return this.get<FHIRPatient>(`Patient/${patientId}`, undefined, requestId);
  }

  async getObservations(
    patientId: string,
    category: string,
    requestId?: string
  ): Promise<AxiosResponse<FHIRBundle<import("./feature-extraction-client").FHIRObservation>>> {
    return this.get(`Observation`, { patient: patientId, category }, requestId);
  }

  async getMedicationRequests(
    patientId: string,
    requestId?: string
  ): Promise<AxiosResponse<FHIRBundle<FHIRMedicationRequest>>> {
    return this.get(`MedicationRequest`, { patient: patientId }, requestId);
  }

  async getConditions(
    patientId: string,
    requestId?: string
  ): Promise<AxiosResponse<FHIRBundle<FHIRCondition>>> {
    return this.get(`Condition`, { patient: patientId }, requestId);
  }

  async getAllergyIntolerances(
    patientId: string,
    requestId?: string
  ): Promise<AxiosResponse<FHIRBundle<FHIRAllergyIntolerance>>> {
    return this.get(`AllergyIntolerance`, { patient: patientId }, requestId);
  }

  async getLabObservations(
    patientId: string,
    requestId?: string
  ): Promise<AxiosResponse<FHIRBundle<import("./feature-extraction-client").FHIRObservation>>> {
    return this.get(`Observation`, { patient: patientId, category: "laboratory" }, requestId);
  }

  async getMedication(
    medicationReference: string,
    requestId?: string
  ): Promise<AxiosResponse<FHIRMedication>> {
    return this.get<FHIRMedication>(medicationReference, undefined, requestId);
  }

  async searchPatients(
    params: {
      name?: string;
      family?: string;
      given?: string;
      birthdate?: string;
      gender?: string;
      identifier?: string;
      _count?: number;
    },
    requestId?: string
  ): Promise<AxiosResponse<FHIRBundle<FHIRPatient>>> {
    const searchParams: Record<string, string> = {};
    if (params.name) searchParams.name = params.name;
    if (params.family) searchParams.family = params.family;
    if (params.given) searchParams.given = params.given;
    if (params.birthdate) searchParams.birthdate = params.birthdate;
    if (params.gender) searchParams.gender = params.gender;
    if (params.identifier) searchParams.identifier = params.identifier;
    if (params._count !== undefined) searchParams._count = String(params._count);

    return this.get<FHIRBundle<FHIRPatient>>("Patient", searchParams, requestId);
  }

  async healthCheck(): Promise<{
    connected: boolean;
    responseTime: number;
    errors: string[];
  }> {
    const start = Date.now();
    try {
      // For Epic sandbox, check the metadata endpoint instead of /health
      const endpoint = this.config.authEnabled ? "metadata" : "health";
      await axios.get(`${this.config.baseUrl}/${endpoint}`, {
        timeout: 5000,
      });
      return {
        connected: true,
        responseTime: Date.now() - start,
        errors: [],
      };
    } catch (error) {
      return {
        connected: false,
        responseTime: Date.now() - start,
        errors: [
          error instanceof Error ? error.message : "Unknown error",
        ],
      };
    }
  }
}

// =============================================================================
// SINGLETON WITH RESET FOR TESTING
// =============================================================================

let fhirClient: EpicFhirClient | null = null;

export function getFhirClient(): EpicFhirClient {
  if (!fhirClient) {
    fhirClient = new EpicFhirClient();
  }
  return fhirClient;
}

export function resetFhirClient(): void {
  fhirClient = null;
}

export function setFhirClient(client: EpicFhirClient): void {
  fhirClient = client;
}
