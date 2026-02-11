/**
 * PDF Parser Client
 *
 * HTTP client for the PDF Parser ML service.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { BaseHttpClient, ServiceClientConfig, RequestOptions, HealthStatus } from '../common';
import {
  ParsedCarePlanResponse,
  ParsePreviewResponse,
  FileValidationResult,
  MAX_FILE_SIZE,
  PDF_MAGIC_BYTES,
} from './types';

/**
 * PDF Parser client configuration
 */
export interface PdfParserClientConfig extends Partial<ServiceClientConfig> {
  /** Base URL of the PDF Parser service */
  baseUrl: string;
  /** Whether to scan for malicious content */
  enableSecurityScan?: boolean;
}

/**
 * PDF Parser Client
 *
 * Provides methods for parsing PDF care plan documents.
 */
export class PdfParserClient extends BaseHttpClient {
  private enableSecurityScan: boolean;

  constructor(config: PdfParserClientConfig) {
    super({
      ...config,
      serviceName: 'pdf-parser',
      timeout: config.timeout ?? 60000, // 1 minute default for file uploads
    });

    this.enableSecurityScan = config.enableSecurityScan ?? true;
  }

  /**
   * Parse a PDF file and extract care plan data
   */
  async parse(
    file: Buffer,
    options?: RequestOptions
  ): Promise<ParsedCarePlanResponse> {
    // Validate file
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const response = await this.uploadFile<Record<string, unknown>>(
      '/api/v1/parse',
      file,
      'file',
      'document.pdf',
      options
    );

    return this.transformParseResponse(response);
  }

  /**
   * Get a quick preview of a PDF without full parsing
   */
  async preview(
    file: Buffer,
    options?: RequestOptions
  ): Promise<ParsePreviewResponse> {
    // Validate file
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const response = await this.uploadFile<ParsePreviewResponse>(
      '/api/v1/preview',
      file,
      'file',
      'document.pdf',
      {
        ...options,
        timeout: options?.timeout ?? 15000, // 15 seconds for preview
      }
    );

    return {
      title: response.title,
      pageCount: response.pageCount,
      textPreview: response.textPreview,
      detectedSections: response.detectedSections,
      codeCounts: response.codeCounts,
      processingTimeMs: response.processingTimeMs,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthStatus> {
    return super.healthCheck();
  }

  /**
   * Validate a PDF file before upload
   */
  validateFile(file: Buffer): FileValidationResult {
    // Check size
    if (file.length > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size ${file.length} bytes exceeds maximum ${MAX_FILE_SIZE} bytes (10MB)`,
        sizeBytes: file.length,
      };
    }

    // Check magic bytes
    if (!this.isPdf(file)) {
      return {
        valid: false,
        error: 'File does not appear to be a valid PDF',
        sizeBytes: file.length,
        mimeType: 'unknown',
      };
    }

    // Security scan
    if (this.enableSecurityScan) {
      const securityResult = this.securityScan(file);
      if (!securityResult.valid) {
        return securityResult;
      }
    }

    return {
      valid: true,
      sizeBytes: file.length,
      mimeType: 'application/pdf',
    };
  }

  /**
   * Check if file is a PDF
   */
  private isPdf(file: Buffer): boolean {
    if (file.length < 4) {
      return false;
    }

    for (let i = 0; i < PDF_MAGIC_BYTES.length; i++) {
      if (file[i] !== PDF_MAGIC_BYTES[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Basic security scan for malicious content
   */
  private securityScan(file: Buffer): FileValidationResult {
    const content = file.toString('latin1');

    // Check for JavaScript
    if (/\/JavaScript\s/i.test(content) || /\/JS\s/i.test(content)) {
      return {
        valid: false,
        error: 'PDF contains JavaScript which is not allowed',
        sizeBytes: file.length,
        mimeType: 'application/pdf',
      };
    }

    // Check for embedded files/attachments
    if (/\/EmbeddedFile/i.test(content)) {
      return {
        valid: false,
        error: 'PDF contains embedded files which are not allowed',
        sizeBytes: file.length,
        mimeType: 'application/pdf',
      };
    }

    // Check for launch actions
    if (/\/Launch\s/i.test(content)) {
      return {
        valid: false,
        error: 'PDF contains launch actions which are not allowed',
        sizeBytes: file.length,
        mimeType: 'application/pdf',
      };
    }

    // Check for URI actions (can be used for data exfiltration)
    const uriCount = (content.match(/\/URI\s/gi) || []).length;
    if (uriCount > 50) {
      return {
        valid: false,
        error: 'PDF contains excessive external links',
        sizeBytes: file.length,
        mimeType: 'application/pdf',
      };
    }

    return {
      valid: true,
      sizeBytes: file.length,
      mimeType: 'application/pdf',
    };
  }

  /**
   * Upload file using multipart form
   */
  private async uploadFile<T>(
    path: string,
    file: Buffer,
    fieldName: string,
    fileName: string,
    options?: RequestOptions
  ): Promise<T> {
    const requestId = options?.requestId || uuidv4();
    const correlationId = options?.correlationId || uuidv4();
    const timeout = options?.timeout ?? this.config.timeout;

    const url = new URL(path, this.config.baseUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    // Build multipart form
    const boundary = `----FormBoundary${uuidv4().replace(/-/g, '')}`;
    const formParts: Buffer[] = [];

    // Add file part
    formParts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
          `Content-Type: application/pdf\r\n\r\n`
      )
    );
    formParts.push(file);
    formParts.push(Buffer.from('\r\n'));

    // End boundary
    formParts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(formParts);

    const headers: Record<string, string> = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length.toString(),
      'Accept': 'application/json',
      'X-Request-ID': requestId,
      'X-Correlation-ID': correlationId,
    };

    return new Promise<T>((resolve, reject) => {
      const req = httpModule.request(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          headers,
          timeout,
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data) as T);
              } catch {
                reject(new Error('Invalid JSON response'));
              }
            } else {
              let errorBody: unknown;
              try {
                errorBody = JSON.parse(data);
              } catch {
                errorBody = data;
              }
              reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(errorBody)}`));
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('Request aborted'));
        });
      }

      req.write(body);
      req.end();
    });
  }

  /**
   * Transform parse response
   */
  private transformParseResponse(data: Record<string, unknown>): ParsedCarePlanResponse {
    return {
      title: data.title as string,
      rawText: data.raw_text as string,
      category: data.category as ParsedCarePlanResponse['category'],
      version: data.version as string | undefined,
      lastUpdated: data.last_updated as string | undefined,
      author: data.author as string | undefined,
      guidelineSource: data.guideline_source as string | undefined,
      evidenceGrade: data.evidence_grade as string | undefined,

      overviewSection: data.overview_section as string | undefined,
      symptomsSection: data.symptoms_section as string | undefined,
      diagnosisSection: data.diagnosis_section as string | undefined,
      treatmentSection: data.treatment_section as string | undefined,
      goalsSection: data.goals_section as string | undefined,
      interventionsSection: data.interventions_section as string | undefined,
      followUpSection: data.follow_up_section as string | undefined,
      patientEducationSection: data.patient_education_section as string | undefined,
      complicationsSection: data.complications_section as string | undefined,

      conditionCodes: this.transformCodes(data.condition_codes as unknown[] || []),
      medicationCodes: this.transformCodes(data.medication_codes as unknown[] || []),
      labCodes: this.transformCodes(data.lab_codes as unknown[] || []),
      procedureCodes: this.transformCodes(data.procedure_codes as unknown[] || []),

      suggestedGoals: ((data.suggested_goals as unknown[]) || []).map(
        (item) => {
          const g = item as Record<string, unknown>;
          return {
            description: g.description as string,
            targetValue: g.target_value as string | undefined,
            targetDays: g.target_days as number | undefined,
            priority: g.priority as 'HIGH' | 'MEDIUM' | 'LOW',
          };
        }
      ),

      suggestedInterventions: ((data.suggested_interventions as unknown[]) || []).map(
        (item) => {
          const i = item as Record<string, unknown>;
          return {
            description: i.description as string,
            type: i.type as ParsedCarePlanResponse['suggestedInterventions'][0]['type'],
            medicationCode: i.medication_code as string | undefined,
            procedureCode: i.procedure_code as string | undefined,
            dosage: i.dosage as string | undefined,
            frequency: i.frequency as string | undefined,
            referralSpecialty: i.referral_specialty as string | undefined,
            scheduleDays: i.schedule_days as number | undefined,
            instructions: i.instructions as string | undefined,
          };
        }
      ),

      isStructuredFormat: data.is_structured_format as boolean,
      extractionConfidence: data.extraction_confidence as number,
      warnings: data.warnings as string[],
      pageCount: data.page_count as number,
      processingTimeMs: data.processing_time_ms as number,
    };
  }

  /**
   * Transform extracted codes
   */
  private transformCodes(codes: unknown[]): ParsedCarePlanResponse['conditionCodes'] {
    return codes.map((item) => {
      const c = item as Record<string, unknown>;
      return {
        code: c.code as string,
        codeSystem: c.code_system as ParsedCarePlanResponse['conditionCodes'][0]['codeSystem'],
        displayText: c.display_text as string | undefined,
        confidence: c.confidence as number,
      };
    });
  }
}

/**
 * Create PDF Parser client
 */
export function createPdfParserClient(
  baseUrl: string,
  options?: Partial<PdfParserClientConfig>
): PdfParserClient {
  return new PdfParserClient({ baseUrl, ...options });
}
