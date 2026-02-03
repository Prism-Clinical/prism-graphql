/**
 * Care Plan Parser Client
 *
 * HTTP client for the care-plan-parser service in prism-ml-infra.
 * Follows the same patterns as ValidatorClient.
 */

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

export class ParserClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options?: { baseUrl?: string; timeout?: number }) {
    this.baseUrl =
      options?.baseUrl ||
      process.env.CARE_PLAN_PARSER_URL ||
      "http://care-plan-parser:8080";
    this.timeout = options?.timeout || 5000;
  }

  async parse(text: string): Promise<CarePlanParseResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Parse failed: ${response.status} - ${error}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Parse request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async validate(
    text: string,
    options?: Record<string, unknown>
  ): Promise<ValidationReport> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, options }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Validation failed: ${response.status} - ${error}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Validation request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async generate(carePlan: Record<string, unknown>): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(carePlan),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Generate failed: ${response.status} - ${error}`);
      }

      const result: GenerateDocumentResult = await response.json();
      if (!result.success || !result.text) {
        throw new Error(
          `Generate failed: ${result.errors?.map((e) => e.message).join(", ") || "Unknown error"}`
        );
      }
      return result.text;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Generate request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let parserClient: ParserClient | null = null;

export function getParserClient(): ParserClient {
  if (!parserClient) {
    parserClient = new ParserClient();
  }
  return parserClient;
}
