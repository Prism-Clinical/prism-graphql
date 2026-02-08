/**
 * CDS Hooks 2.0 Specification Types
 * Based on: https://cds-hooks.hl7.org/2.0/
 */

/**
 * CDS Service Definition - used in discovery response
 */
export interface CDSServiceDefinition {
  /** Unique identifier for this CDS Service */
  id: string;
  /** Hook type this service responds to */
  hook: CDSHookType;
  /** Human-readable title */
  title: string;
  /** Human-readable description */
  description: string;
  /** Whether this service uses custom prefetch templates */
  prefetch?: Record<string, string>;
  /** Optional usage requirements for the EHR */
  usageRequirements?: string;
}

/**
 * Discovery Response returned by GET /cds-services
 */
export interface CDSDiscoveryResponse {
  services: CDSServiceDefinition[];
}

/**
 * Supported CDS Hook types per HL7 specification
 */
export type CDSHookType =
  | 'patient-view'
  | 'order-select'
  | 'order-sign'
  | 'order-review'
  | 'medication-prescribe'
  | 'encounter-start'
  | 'encounter-discharge';

/**
 * CDS Hook Request from EHR
 */
export interface CDSHookRequest {
  /** Unique identifier for this hook invocation */
  hookInstance: string;
  /** URL for FHIR server if prefetch data needs to be fetched */
  fhirServer?: string;
  /** Hook type being invoked */
  hook: CDSHookType;
  /** FHIR authorization for server access */
  fhirAuthorization?: FHIRAuthorization;
  /** Context specific to the hook type */
  context: HookContext;
  /** Pre-fetched FHIR resources */
  prefetch?: Record<string, unknown>;
}

/**
 * FHIR Authorization token info
 */
export interface FHIRAuthorization {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  subject: string;
}

/**
 * Hook-specific context types
 */
export interface PatientViewContext {
  userId: string;
  patientId: string;
  encounterId?: string;
}

export interface OrderReviewContext {
  userId: string;
  patientId: string;
  encounterId?: string;
  draftOrders: {
    resourceType: 'Bundle';
    entry: Array<{ resource: unknown }>;
  };
}

export interface MedicationPrescribeContext {
  userId: string;
  patientId: string;
  encounterId?: string;
  medications: {
    resourceType: 'Bundle';
    entry: Array<{ resource: unknown }>;
  };
}

export type HookContext =
  | PatientViewContext
  | OrderReviewContext
  | MedicationPrescribeContext;

/**
 * CDS Hook Response containing cards
 */
export interface CDSHookResponse {
  cards: CDSCard[];
  systemActions?: CDSSystemAction[];
}

/**
 * CDS Card - visual output shown to clinician
 */
export interface CDSCard {
  /** Unique identifier */
  uuid?: string;
  /** Brief summary for card header */
  summary: string;
  /** Detailed information (markdown supported) */
  detail?: string;
  /** Visual indicator: info, warning, critical, or hard-stop */
  indicator: CDSIndicator;
  /** Source of the information */
  source: CDSSource;
  /** Actions the user can take */
  suggestions?: CDSSuggestion[];
  /** Links to external resources */
  links?: CDSLink[];
  /** Override reasons if applicable */
  overrideReasons?: CDSOverrideReason[];
  /** Selection behavior for suggestions */
  selectionBehavior?: 'at-most-one' | 'any';
}

export type CDSIndicator = 'info' | 'warning' | 'critical';

export interface CDSSource {
  label: string;
  url?: string;
  icon?: string;
  topic?: CDSCoding;
}

export interface CDSSuggestion {
  label: string;
  uuid?: string;
  isRecommended?: boolean;
  actions?: CDSAction[];
}

export interface CDSAction {
  type: 'create' | 'update' | 'delete';
  description: string;
  resource?: unknown;
  resourceId?: string;
}

export interface CDSLink {
  label: string;
  url: string;
  type: 'absolute' | 'smart';
  appContext?: string;
}

export interface CDSOverrideReason {
  code?: CDSCoding;
  display: string;
}

export interface CDSSystemAction {
  type: 'create' | 'update' | 'delete';
  description: string;
  resource?: unknown;
  resourceId?: string;
}

export interface CDSCoding {
  system: string;
  code: string;
  display?: string;
}

/**
 * Error response format
 */
export interface CDSErrorResponse {
  error: string;
  message: string;
  details?: string[];
}
