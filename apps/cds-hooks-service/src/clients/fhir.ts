import type { FHIRAuthorization } from '../types';

/**
 * FHIR Resource types commonly used in CDS Hooks
 */
export interface FHIRResource {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * FHIR Bundle structure
 */
export interface FHIRBundle {
  resourceType: 'Bundle';
  type?: string;
  total?: number;
  entry?: Array<{
    resource?: FHIRResource;
    fullUrl?: string;
  }>;
}

/**
 * FHIR fetch result
 */
export interface FHIRFetchResult {
  success: boolean;
  data?: FHIRResource | FHIRBundle;
  error?: string;
  statusCode?: number;
}

/**
 * FHIR Client options
 */
export interface FHIRClientOptions {
  baseUrl: string;
  authorization?: FHIRAuthorization;
  timeout?: number;
}

/**
 * FHIR Client for fetching resources from EHR FHIR servers
 *
 * Used to fetch prefetch data when not provided by the EHR in the CDS request.
 * Handles authorization using the fhirAuthorization token from the request.
 */
export class FHIRClient {
  private baseUrl: string;
  private authorization?: FHIRAuthorization;
  private timeout: number;

  constructor(options: FHIRClientOptions) {
    // Ensure baseUrl doesn't end with a slash
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.authorization = options.authorization;
    this.timeout = options.timeout ?? 10000;
  }

  /**
   * Build authorization header from FHIR authorization
   */
  private getAuthHeaders(): Record<string, string> {
    if (!this.authorization) {
      return {};
    }

    return {
      Authorization: `${this.authorization.token_type} ${this.authorization.access_token}`,
    };
  }

  /**
   * Fetch a single FHIR resource by URL
   */
  async fetch(resourceUrl: string): Promise<FHIRFetchResult> {
    try {
      // Handle relative and absolute URLs
      const url = resourceUrl.startsWith('http')
        ? resourceUrl
        : `${this.baseUrl}/${resourceUrl}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/fhir+json',
          'Content-Type': 'application/fhir+json',
          ...this.getAuthHeaders(),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `FHIR fetch failed: ${response.status} ${response.statusText}`,
          statusCode: response.status,
        };
      }

      const data = (await response.json()) as FHIRResource | FHIRBundle;

      return {
        success: true,
        data,
        statusCode: response.status,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: 'FHIR fetch timed out',
          statusCode: 408,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown FHIR fetch error',
      };
    }
  }

  /**
   * Fetch a resource by type and ID
   */
  async fetchResource(resourceType: string, id: string): Promise<FHIRFetchResult> {
    return this.fetch(`${resourceType}/${id}`);
  }

  /**
   * Search for resources with query parameters
   */
  async search(resourceType: string, params: Record<string, string>): Promise<FHIRFetchResult> {
    const queryString = new URLSearchParams(params).toString();
    return this.fetch(`${resourceType}?${queryString}`);
  }
}

/**
 * Create a FHIR client from a CDS request
 */
export function createFHIRClient(
  fhirServer: string,
  fhirAuthorization?: FHIRAuthorization
): FHIRClient {
  return new FHIRClient({
    baseUrl: fhirServer,
    authorization: fhirAuthorization,
  });
}
