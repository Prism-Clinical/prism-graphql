import type { CDSHookRequest, CDSServiceDefinition, FHIRAuthorization, CDSCard } from '../types';
import { createFHIRClient, type FHIRResource, type FHIRBundle } from '../clients/fhir';
import { serviceById } from '../config/services';
import { createWarningCard } from '../builders/card';
import { SOURCE_LABELS } from '../constants';

/**
 * Prefetch data from FHIR server or provided prefetch
 */
export type PrefetchData = Record<string, FHIRResource | FHIRBundle | null>;

/**
 * Prefetch resolution result
 */
export interface PrefetchResult {
  /** Successfully resolved prefetch data */
  data: PrefetchData;
  /** Keys that failed to fetch */
  errors: Map<string, string>;
  /** Whether all required prefetch was resolved */
  complete: boolean;
}

/**
 * Request context with prefetch data for hook handlers
 */
export interface HookRequestContext {
  /** Original CDS request */
  request: CDSHookRequest;
  /** Resolved prefetch data */
  prefetch: PrefetchData;
  /** Any warnings during prefetch resolution */
  warnings: string[];
}

/**
 * Substitute context variables in prefetch template
 *
 * Replaces {{context.patientId}}, {{context.userId}}, etc. with actual values
 */
function substituteTemplateVariables(
  template: string,
  context: Record<string, unknown>
): string {
  return template.replace(/\{\{context\.(\w+)\}\}/g, (_match, key: string) => {
    const value = context[key];
    return value != null ? String(value) : '';
  });
}

/**
 * Detect which prefetch keys are missing from the request
 */
export function detectMissingPrefetch(
  request: CDSHookRequest,
  service: CDSServiceDefinition
): string[] {
  const prefetchTemplates = service.prefetch ?? {};
  const providedPrefetch = request.prefetch ?? {};

  const missing: string[] = [];

  for (const key of Object.keys(prefetchTemplates)) {
    if (!(key in providedPrefetch) || providedPrefetch[key] == null) {
      missing.push(key);
    }
  }

  return missing;
}

/**
 * Check if prefetch data is required but missing
 */
export function isPrefetchIncomplete(
  request: CDSHookRequest,
  service: CDSServiceDefinition
): boolean {
  const missing = detectMissingPrefetch(request, service);
  return missing.length > 0;
}

/**
 * Resolve prefetch data - fetch missing data from FHIR server
 *
 * This handler:
 * 1. Checks what prefetch data was provided in the request
 * 2. Identifies missing data based on service prefetch templates
 * 3. Fetches missing data from the fhirServer using fhirAuthorization
 * 4. Merges fetched data with provided prefetch
 * 5. Returns complete prefetch data for the hook handler
 */
export async function resolvePrefetch(
  request: CDSHookRequest,
  serviceId: string
): Promise<PrefetchResult> {
  const service = serviceById.get(serviceId);

  if (!service) {
    return {
      data: {},
      errors: new Map([['service', `Unknown service: ${serviceId}`]]),
      complete: false,
    };
  }

  const prefetchTemplates = service.prefetch ?? {};
  const providedPrefetch = request.prefetch ?? {};
  const context = request.context as unknown as Record<string, unknown>;

  const result: PrefetchData = {};
  const errors = new Map<string, string>();

  // Copy provided prefetch data
  for (const [key, value] of Object.entries(providedPrefetch)) {
    result[key] = value as FHIRResource | FHIRBundle;
  }

  // Identify missing keys
  const missingKeys = detectMissingPrefetch(request, service);

  // If no missing keys, we're done
  if (missingKeys.length === 0) {
    return {
      data: result,
      errors,
      complete: true,
    };
  }

  // Check if we can fetch missing data
  if (!request.fhirServer) {
    // No FHIR server to fetch from - mark as incomplete but not error
    for (const key of missingKeys) {
      result[key] = null;
    }
    return {
      data: result,
      errors,
      complete: false,
    };
  }

  // Create FHIR client
  const fhirClient = createFHIRClient(
    request.fhirServer,
    request.fhirAuthorization
  );

  // Fetch missing data in parallel
  const fetchPromises = missingKeys.map(async (key) => {
    const template = prefetchTemplates[key];
    if (!template) {
      return { key, result: null, error: 'No template for key' };
    }

    // Substitute context variables
    const resourceUrl = substituteTemplateVariables(template, context);

    // Fetch the resource
    const fetchResult = await fhirClient.fetch(resourceUrl);

    if (fetchResult.success && fetchResult.data) {
      return { key, result: fetchResult.data, error: null };
    } else {
      return { key, result: null, error: fetchResult.error ?? 'Unknown fetch error' };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);

  // Process fetch results
  for (const { key, result: fetchedData, error } of fetchResults) {
    if (fetchedData) {
      result[key] = fetchedData;
    } else {
      result[key] = null;
      if (error) {
        errors.set(key, error);
      }
    }
  }

  // Check if all required prefetch was resolved
  const complete = Object.values(result).every(v => v != null);

  return {
    data: result,
    errors,
    complete,
  };
}

/**
 * Build hook request context with resolved prefetch
 */
export async function buildHookContext(
  request: CDSHookRequest,
  serviceId: string
): Promise<HookRequestContext> {
  const prefetchResult = await resolvePrefetch(request, serviceId);

  const warnings: string[] = [];

  // Add warnings for fetch errors
  for (const [key, error] of prefetchResult.errors) {
    warnings.push(`Failed to fetch ${key}: ${error}`);
  }

  // Add warning if prefetch is incomplete
  if (!prefetchResult.complete) {
    const missingKeys = Object.entries(prefetchResult.data)
      .filter(([_, v]) => v == null)
      .map(([k]) => k);

    if (missingKeys.length > 0) {
      warnings.push(`Missing prefetch data: ${missingKeys.join(', ')}`);
    }
  }

  return {
    request,
    prefetch: prefetchResult.data,
    warnings,
  };
}

/**
 * Create a warning card for prefetch errors
 */
export function createPrefetchWarningCard(warnings: string[]): CDSCard {
  return createWarningCard(
    'Data fetch warning',
    SOURCE_LABELS.PRISM_CDS,
    warnings.join('\n')
  );
}

/**
 * Check if context should include a warning card for prefetch issues
 */
export function shouldAddPrefetchWarning(context: HookRequestContext): boolean {
  return context.warnings.length > 0;
}
