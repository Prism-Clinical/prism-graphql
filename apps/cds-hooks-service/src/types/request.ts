import { z } from 'zod';
import type { CDSHookType } from './cds-hooks';

/**
 * UUID v4 validation regex
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Supported hook types as a Zod enum
 */
export const hookTypeSchema = z.enum([
  'patient-view',
  'order-select',
  'order-sign',
  'order-review',
  'medication-prescribe',
  'encounter-start',
  'encounter-discharge',
]);

/**
 * FHIR Authorization schema
 */
export const fhirAuthorizationSchema = z.object({
  access_token: z.string().min(1, 'access_token is required'),
  token_type: z.string().min(1, 'token_type is required'),
  expires_in: z.number().positive('expires_in must be positive'),
  scope: z.string().min(1, 'scope is required'),
  subject: z.string().min(1, 'subject is required'),
});

/**
 * FHIR Bundle schema (simplified for prefetch validation)
 */
export const fhirBundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  entry: z.array(z.object({
    resource: z.record(z.unknown()).optional(),
  })).optional(),
});

/**
 * Base context schema (common fields)
 */
export const baseContextSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  patientId: z.string().min(1, 'patientId is required'),
  encounterId: z.string().optional(),
});

/**
 * Patient-view hook context
 */
export const patientViewContextSchema = baseContextSchema;

/**
 * Order-review hook context
 */
export const orderReviewContextSchema = baseContextSchema.extend({
  draftOrders: fhirBundleSchema,
});

/**
 * Medication-prescribe hook context
 */
export const medicationPrescribeContextSchema = baseContextSchema.extend({
  medications: fhirBundleSchema,
});

/**
 * Get context schema for a specific hook type
 */
export function getContextSchemaForHook(hook: CDSHookType): z.ZodObject<z.ZodRawShape> {
  switch (hook) {
    case 'patient-view':
      return patientViewContextSchema;
    case 'order-review':
      return orderReviewContextSchema;
    case 'medication-prescribe':
      return medicationPrescribeContextSchema;
    default:
      // For unsupported hooks, use base context
      return baseContextSchema;
  }
}

/**
 * Base CDS Hook request schema (validates structure without context specifics)
 */
export const baseCDSRequestSchema = z.object({
  hookInstance: z.string()
    .regex(UUID_REGEX, 'hookInstance must be a valid UUID v4'),
  hook: hookTypeSchema,
  fhirServer: z.string().url('fhirServer must be a valid URL').optional(),
  fhirAuthorization: fhirAuthorizationSchema.optional(),
  context: z.record(z.unknown()),
  prefetch: z.record(z.unknown()).optional(),
});

/**
 * Full CDS Hook request schema factory
 * Creates a complete schema based on the hook type
 */
export function createCDSRequestSchema(hook: CDSHookType) {
  const contextSchema = getContextSchemaForHook(hook);

  return z.object({
    hookInstance: z.string()
      .regex(UUID_REGEX, 'hookInstance must be a valid UUID v4'),
    hook: z.literal(hook),
    fhirServer: z.string().url('fhirServer must be a valid URL').optional(),
    fhirAuthorization: fhirAuthorizationSchema.optional(),
    context: contextSchema,
    prefetch: z.record(z.unknown()).optional(),
  });
}

/**
 * Type representing the base CDS request (before context validation)
 */
export type BaseCDSRequest = z.infer<typeof baseCDSRequestSchema>;

/**
 * Validation error details
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  errors?: ValidationErrorDetail[];
}

/**
 * Extract validation errors from Zod error
 */
export function extractValidationErrors(error: z.ZodError): ValidationErrorDetail[] {
  return error.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));
}
