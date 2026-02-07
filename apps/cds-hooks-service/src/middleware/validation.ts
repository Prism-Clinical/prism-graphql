import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  baseCDSRequestSchema,
  createCDSRequestSchema,
  extractValidationErrors,
  hookTypeSchema,
} from '../types/request';
import type { CDSHookType, CDSErrorResponse } from '../types';
import { serviceById } from '../config/services';

/**
 * Validates that the hook type is one of our registered services
 */
function isRegisteredHook(hook: string): hook is CDSHookType {
  const result = hookTypeSchema.safeParse(hook);
  return result.success;
}

/**
 * Validation Error Response
 */
interface ValidationErrorResponse extends CDSErrorResponse {
  validationErrors?: Array<{
    field: string;
    message: string;
    code: string;
  }>;
}

/**
 * CDS Hooks Request Validation Middleware
 *
 * Validates incoming CDS Hook requests per the HL7 CDS Hooks 2.0 specification:
 * - hookInstance must be a valid UUID v4
 * - hook must match a registered service
 * - context must contain required fields for the hook type
 * - prefetch data (if provided) must be valid FHIR resources
 *
 * Returns 400 for invalid requests with detailed error information.
 * Returns 404 if the hook/service is not found.
 */
export function validateCDSRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { serviceId } = req.params;
  const body = req.body as unknown;

  // Check if this is a POST request to a service endpoint
  if (req.method !== 'POST') {
    next();
    return;
  }

  // First, check if the service exists
  if (serviceId && !serviceById.has(serviceId)) {
    const response: CDSErrorResponse = {
      error: 'not_found',
      message: `CDS service '${serviceId}' not found`,
    };
    res.status(404).json(response);
    return;
  }

  // Validate the base request structure first
  const baseValidation = baseCDSRequestSchema.safeParse(body);

  if (!baseValidation.success) {
    const errors = extractValidationErrors(baseValidation.error);
    const response: ValidationErrorResponse = {
      error: 'invalid_request',
      message: 'Request validation failed',
      validationErrors: errors,
    };
    res.status(400).json(response);
    return;
  }

  const { hook } = baseValidation.data;

  // Check if the hook type is registered
  if (!isRegisteredHook(hook)) {
    const response: CDSErrorResponse = {
      error: 'invalid_request',
      message: `Hook type '${hook}' is not supported`,
      details: ['Supported hooks: patient-view, order-review, medication-prescribe'],
    };
    res.status(400).json(response);
    return;
  }

  // Validate against the hook-specific schema
  const hookSchema = createCDSRequestSchema(hook);
  const hookValidation = hookSchema.safeParse(body);

  if (!hookValidation.success) {
    const errors = extractValidationErrors(hookValidation.error);
    const response: ValidationErrorResponse = {
      error: 'invalid_request',
      message: 'Request context validation failed',
      validationErrors: errors,
    };
    res.status(400).json(response);
    return;
  }

  // Attach validated request to locals for use by handlers
  res.locals.validatedRequest = hookValidation.data;

  next();
}

/**
 * Middleware to validate specific service ID against registered services
 */
export function validateServiceId(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { serviceId } = req.params;

  if (!serviceId) {
    next();
    return;
  }

  if (!serviceById.has(serviceId)) {
    const response: CDSErrorResponse = {
      error: 'not_found',
      message: `CDS service '${serviceId}' not found`,
    };
    res.status(404).json(response);
    return;
  }

  next();
}

/**
 * Express error handler for Zod validation errors
 */
export function zodErrorHandler(
  error: Error,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (error instanceof z.ZodError) {
    const errors = extractValidationErrors(error);
    const response: ValidationErrorResponse = {
      error: 'validation_error',
      message: 'Request validation failed',
      validationErrors: errors,
    };
    res.status(400).json(response);
    return;
  }

  next(error);
}
