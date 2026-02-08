/**
 * Care Plan Parser Client
 *
 * HTTP client for the care-plan-parser service in prism-ml-infra.
 * Features:
 * - Retry with exponential backoff for transient failures
 * - Circuit breaker to fail fast when service is down
 * - Structured logging with request correlation
 * - Input validation and size limits
 * - Dependency injection support for testing
 */

import {
  ResilientHttpClient,
  HttpClientOptions,
  HttpError,
  CircuitOpenError,
  PayloadTooLargeError,
} from "./http-utils";
import { Logger, createLogger } from "./logger";
import { DocumentCarePlanInput } from "./types/care-plan-bridge";

// =============================================================================
// TYPES
// =============================================================================

export interface CarePlanParseResult {
  success: boolean;
  carePlan?: {
    metadata: {
      title: string;
      category: string;
      version: string;
      author: string;
      date: string;
      status: string;
      guidelineSource?: string;
      evidenceGrade?: string;
    };
    codes: {
      conditions: Array<{ code: string; system: string; description: string }>;
      medications: Array<{ code: string; system: string; description: string }>;
      labs: Array<{ code: string; system: string; description: string }>;
      procedures: Array<{ code: string; system: string; description: string }>;
    };
    goals: Array<{
      description: string;
      targetValue?: string;
      targetDate?: string;
      priority: string;
      status?: string;
    }>;
    interventions: Array<{
      type: string;
      description: string;
      frequency?: string;
      responsibleParty?: string;
      notes?: string;
    }>;
    clinicalContent: {
      subsections: Array<{ type: string; content: string }>;
    };
  };
  errors?: Array<{ code: string; message: string; line?: number }>;
}

export interface ValidationReport {
  isValid: boolean;
  summary: {
    totalViolations: number;
    errorCount: number;
    warningCount: number;
  };
  violations: Array<{
    rule: string;
    severity: string;
    message: string;
    line?: number;
  }>;
}

export interface CrossReferenceReport {
  isValid: boolean;
  issues: Array<{
    code: string;
    severity: string;
    message: string;
    referencedIn: string[];
  }>;
}

export interface GenerateDocumentResult {
  success: boolean;
  text?: string;
  errors?: Array<{ code: string; message: string }>;
}

export interface ParseAndValidateResult {
  parseResult: CarePlanParseResult;
  validationReport: ValidationReport;
}

export interface ParserClientOptions {
  baseUrl?: string;
  timeout?: number;
  maxPayloadBytes?: number;
}

// =============================================================================
// CLIENT IMPLEMENTATION
// =============================================================================

export class ParserClient {
  private readonly httpClient: ResilientHttpClient;
  private readonly logger: Logger;

  constructor(options?: ParserClientOptions) {
    const baseUrl =
      options?.baseUrl ||
      process.env.CARE_PLAN_PARSER_URL ||
      "http://care-plan-parser:8080";

    this.httpClient = new ResilientHttpClient({
      baseUrl,
      serviceName: "care-plan-parser",
      timeout: options?.timeout ?? 10000,
      maxPayloadBytes: options?.maxPayloadBytes ?? 5 * 1024 * 1024, // 5MB
    });

    this.logger = createLogger("parser-client");
  }

  /**
   * Parse a care plan document text into structured data.
   */
  async parse(text: string, requestId?: string): Promise<CarePlanParseResult> {
    this.logger.debug("Parsing care plan document", {
      requestId,
      textLength: text.length,
    });

    const response = await this.httpClient.post<CarePlanParseResult>(
      "/parse",
      { text },
      requestId
    );

    this.logger.info("Parse completed", {
      requestId,
      success: response.data.success,
      durationMs: response.durationMs,
    });

    return response.data;
  }

  /**
   * Validate a care plan document against rules.
   */
  async validate(
    text: string,
    options?: Record<string, unknown>,
    requestId?: string
  ): Promise<ValidationReport> {
    this.logger.debug("Validating care plan document", {
      requestId,
      textLength: text.length,
    });

    const response = await this.httpClient.post<ValidationReport>(
      "/validate",
      { text, options },
      requestId
    );

    this.logger.info("Validation completed", {
      requestId,
      isValid: response.data.isValid,
      violationCount: response.data.violations.length,
      durationMs: response.durationMs,
    });

    return response.data;
  }

  /**
   * Parse and validate in a single call to avoid duplicate service roundtrips.
   * This is more efficient than calling parse() and validate() separately.
   */
  async parseAndValidate(
    text: string,
    requestId?: string
  ): Promise<ParseAndValidateResult> {
    this.logger.debug("Parse and validate care plan document", {
      requestId,
      textLength: text.length,
    });

    // Check if the service supports combined endpoint
    try {
      const response = await this.httpClient.post<ParseAndValidateResult>(
        "/parse-and-validate",
        { text },
        requestId
      );

      this.logger.info("Parse and validate completed", {
        requestId,
        parseSuccess: response.data.parseResult.success,
        isValid: response.data.validationReport.isValid,
        durationMs: response.durationMs,
      });

      return response.data;
    } catch (error) {
      // Fallback to separate calls if combined endpoint not available
      if (error instanceof HttpError && error.status === 404) {
        this.logger.debug(
          "Combined endpoint not available, falling back to separate calls",
          { requestId }
        );

        const [parseResult, validationReport] = await Promise.all([
          this.parse(text, requestId),
          this.validate(text, undefined, requestId),
        ]);

        return { parseResult, validationReport };
      }
      throw error;
    }
  }

  /**
   * Generate a document from a structured care plan.
   */
  async generate(
    carePlan: DocumentCarePlanInput,
    requestId?: string
  ): Promise<string> {
    this.logger.debug("Generating care plan document", {
      requestId,
      title: carePlan.metadata.title,
    });

    const response = await this.httpClient.post<GenerateDocumentResult>(
      "/generate",
      carePlan,
      requestId
    );

    if (!response.data.success || !response.data.text) {
      const errorMessages =
        response.data.errors?.map((e) => e.message).join(", ") ||
        "Unknown error";
      throw new Error(`Generate failed: ${errorMessages}`);
    }

    this.logger.info("Document generation completed", {
      requestId,
      textLength: response.data.text.length,
      durationMs: response.durationMs,
    });

    return response.data.text;
  }

  /**
   * Check if the parser service is healthy.
   */
  async healthCheck(): Promise<boolean> {
    return this.httpClient.healthCheck();
  }

  /**
   * Reset the circuit breaker (for testing or manual recovery).
   */
  resetCircuitBreaker(): void {
    this.httpClient.resetCircuitBreaker();
  }
}

// =============================================================================
// SINGLETON WITH RESET FOR TESTING
// =============================================================================

let parserClient: ParserClient | null = null;

export function getParserClient(): ParserClient {
  if (!parserClient) {
    parserClient = new ParserClient();
  }
  return parserClient;
}

/**
 * Reset the singleton instance (for testing).
 */
export function resetParserClient(): void {
  parserClient = null;
}

/**
 * Set a custom parser client instance (for testing/DI).
 */
export function setParserClient(client: ParserClient): void {
  parserClient = client;
}

// Re-export error types for consumers
export { HttpError, CircuitOpenError, PayloadTooLargeError };
