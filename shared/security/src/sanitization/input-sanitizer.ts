/**
 * Input Sanitizer
 *
 * Sanitize and validate input data to prevent injection attacks.
 * Implements defense-in-depth with multiple detection layers.
 */

import { ValidationResult, ValidationError, ValidationWarning } from '../types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum allowed lengths for various input types
 */
export const MAX_LENGTHS = {
  transcriptText: 100 * 1024, // 100KB
  requestBody: 1024 * 1024, // 1MB
  fileUpload: 10 * 1024 * 1024, // 10MB
  stringField: 10000, // 10K characters
  icd10Code: 10, // ICD-10 codes are max 7 chars + padding
  arrayLength: 1000, // Max array items
  objectDepth: 10, // Max nesting depth
} as const;

/**
 * Injection pattern with metadata for confidence scoring
 */
interface InjectionPattern {
  pattern: RegExp;
  type: InjectionType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-1, how confident we are this is malicious
  description: string;
}

/**
 * Types of injection attacks we detect
 */
export type InjectionType =
  | 'SQL_INJECTION'
  | 'NOSQL_INJECTION'
  | 'COMMAND_INJECTION'
  | 'PATH_TRAVERSAL'
  | 'XSS'
  | 'PROMPT_INJECTION'
  | 'LDAP_INJECTION'
  | 'XML_INJECTION';

/**
 * SQL injection patterns with metadata
 */
const SQL_INJECTION_PATTERNS: InjectionPattern[] = [
  {
    pattern: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b\s+.*\b(FROM|INTO|TABLE|DATABASE)\b)/i,
    type: 'SQL_INJECTION',
    severity: 'critical',
    confidence: 0.9,
    description: 'SQL DML/DDL statement detected',
  },
  {
    pattern: /\bUNION\s+(ALL\s+)?SELECT\b/i,
    type: 'SQL_INJECTION',
    severity: 'critical',
    confidence: 0.95,
    description: 'UNION-based SQL injection',
  },
  {
    pattern: /'\s*(OR|AND)\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i,
    type: 'SQL_INJECTION',
    severity: 'high',
    confidence: 0.85,
    description: 'Tautology-based SQL injection',
  },
  {
    pattern: /;\s*(DROP|DELETE|TRUNCATE|ALTER)\s+/i,
    type: 'SQL_INJECTION',
    severity: 'critical',
    confidence: 0.9,
    description: 'Stacked query injection',
  },
  {
    pattern: /(--|#|\/\*)\s*$/m,
    type: 'SQL_INJECTION',
    severity: 'medium',
    confidence: 0.6,
    description: 'SQL comment terminator',
  },
  {
    pattern: /\b(EXEC|EXECUTE)\s*\(/i,
    type: 'SQL_INJECTION',
    severity: 'high',
    confidence: 0.8,
    description: 'SQL execution attempt',
  },
  {
    pattern: /\bWAITFOR\s+DELAY\b/i,
    type: 'SQL_INJECTION',
    severity: 'high',
    confidence: 0.85,
    description: 'Time-based blind SQL injection',
  },
  {
    pattern: /\bBENCHMARK\s*\(/i,
    type: 'SQL_INJECTION',
    severity: 'high',
    confidence: 0.85,
    description: 'MySQL time-based injection',
  },
];

/**
 * NoSQL injection patterns
 */
const NOSQL_INJECTION_PATTERNS: InjectionPattern[] = [
  {
    pattern: /\$where\s*:/i,
    type: 'NOSQL_INJECTION',
    severity: 'critical',
    confidence: 0.9,
    description: 'MongoDB $where injection',
  },
  {
    pattern: /\$(gt|gte|lt|lte|ne|in|nin|regex|exists|type|mod|all|elemMatch)\s*:/i,
    type: 'NOSQL_INJECTION',
    severity: 'high',
    confidence: 0.75,
    description: 'MongoDB operator injection',
  },
  {
    pattern: /\$or\s*:\s*\[/i,
    type: 'NOSQL_INJECTION',
    severity: 'high',
    confidence: 0.8,
    description: 'MongoDB $or bypass attempt',
  },
];

/**
 * Command injection patterns
 */
const COMMAND_INJECTION_PATTERNS: InjectionPattern[] = [
  {
    pattern: /[;&|]\s*(rm|cat|ls|pwd|whoami|id|uname|curl|wget|nc|netcat|bash|sh|python|perl|ruby|php)\b/i,
    type: 'COMMAND_INJECTION',
    severity: 'critical',
    confidence: 0.9,
    description: 'Command chaining with common utilities',
  },
  {
    pattern: /;\s*rm\s+-rf?\s/i,
    type: 'COMMAND_INJECTION',
    severity: 'critical',
    confidence: 0.95,
    description: 'Destructive rm command',
  },
  {
    pattern: /`[^`]+`/,
    type: 'COMMAND_INJECTION',
    severity: 'high',
    confidence: 0.7,
    description: 'Backtick command substitution',
  },
  {
    pattern: /\$\([^)]+\)/,
    type: 'COMMAND_INJECTION',
    severity: 'high',
    confidence: 0.7,
    description: 'Command substitution',
  },
  {
    pattern: /\|\s*(cat|less|more|head|tail|grep|awk|sed)\b/i,
    type: 'COMMAND_INJECTION',
    severity: 'high',
    confidence: 0.75,
    description: 'Pipe to common commands',
  },
];

/**
 * XSS patterns
 */
const XSS_PATTERNS: InjectionPattern[] = [
  {
    pattern: /<script\b[^>]*>[\s\S]*?<\/script>/i,
    type: 'XSS',
    severity: 'critical',
    confidence: 0.95,
    description: 'Script tag injection',
  },
  {
    pattern: /javascript\s*:/i,
    type: 'XSS',
    severity: 'high',
    confidence: 0.85,
    description: 'JavaScript protocol handler',
  },
  {
    pattern: /on(load|error|click|mouse\w+|key\w+|focus|blur|change|submit)\s*=/i,
    type: 'XSS',
    severity: 'high',
    confidence: 0.8,
    description: 'Event handler injection',
  },
  {
    pattern: /<(iframe|object|embed|applet|form|input|button|textarea|select|link|meta|base|style)\b/i,
    type: 'XSS',
    severity: 'medium',
    confidence: 0.6,
    description: 'Potentially dangerous HTML tags',
  },
  {
    pattern: /\bdata\s*:/i,
    type: 'XSS',
    severity: 'medium',
    confidence: 0.5,
    description: 'Data URI scheme',
  },
  {
    pattern: /&#x?[0-9a-f]+;/i,
    type: 'XSS',
    severity: 'low',
    confidence: 0.3,
    description: 'HTML entity encoding (may be obfuscation)',
  },
];

/**
 * Path traversal patterns
 */
const PATH_TRAVERSAL_PATTERNS: InjectionPattern[] = [
  {
    pattern: /\.\.[\/\\]/,
    type: 'PATH_TRAVERSAL',
    severity: 'high',
    confidence: 0.8,
    description: 'Directory traversal sequence',
  },
  {
    pattern: /(%2e%2e|%252e%252e)[\/\\%]/i,
    type: 'PATH_TRAVERSAL',
    severity: 'high',
    confidence: 0.85,
    description: 'URL-encoded traversal',
  },
  {
    pattern: /\/(etc\/passwd|etc\/shadow|windows\/system32)/i,
    type: 'PATH_TRAVERSAL',
    severity: 'critical',
    confidence: 0.95,
    description: 'System file access attempt',
  },
];

/**
 * Prompt injection patterns for ML services
 */
const PROMPT_INJECTION_PATTERNS: InjectionPattern[] = [
  // Direct instruction override
  {
    pattern: /ignore\s+(previous|all|above|prior|earlier)\s+(instructions?|prompts?|context|rules?)/i,
    type: 'PROMPT_INJECTION',
    severity: 'critical',
    confidence: 0.9,
    description: 'Instruction override attempt',
  },
  {
    pattern: /disregard\s+(your|the|all|any)\s+(instructions?|rules?|guidelines?|constraints?)/i,
    type: 'PROMPT_INJECTION',
    severity: 'critical',
    confidence: 0.9,
    description: 'Instruction disregard attempt',
  },
  {
    pattern: /you\s+(are|must|should|will)\s+now\s+(be|act|become|pretend)/i,
    type: 'PROMPT_INJECTION',
    severity: 'high',
    confidence: 0.85,
    description: 'Identity override attempt',
  },
  {
    pattern: /new\s+(instructions?|prompt|role|persona|identity)\s*:/i,
    type: 'PROMPT_INJECTION',
    severity: 'critical',
    confidence: 0.9,
    description: 'New instruction injection',
  },
  {
    pattern: /system\s+(prompt|message|instruction)\s*:/i,
    type: 'PROMPT_INJECTION',
    severity: 'critical',
    confidence: 0.95,
    description: 'System prompt injection',
  },
  // Role manipulation
  {
    pattern: /you\s+are\s+(a|an|the)\s+(different|new|another|evil|malicious)/i,
    type: 'PROMPT_INJECTION',
    severity: 'high',
    confidence: 0.85,
    description: 'Role reassignment attempt',
  },
  {
    pattern: /pretend\s+(to\s+be|you're|you\s+are|that|like)/i,
    type: 'PROMPT_INJECTION',
    severity: 'high',
    confidence: 0.8,
    description: 'Pretense instruction',
  },
  {
    pattern: /act\s+as\s+(if|a|an|the|though)/i,
    type: 'PROMPT_INJECTION',
    severity: 'medium',
    confidence: 0.7,
    description: 'Acting instruction',
  },
  {
    pattern: /roleplay\s+as/i,
    type: 'PROMPT_INJECTION',
    severity: 'high',
    confidence: 0.8,
    description: 'Roleplay instruction',
  },
  // Boundary escape
  {
    pattern: /\[INST\]|\[\/INST\]|\[SYSTEM\]|\[USER\]|\[ASSISTANT\]/i,
    type: 'PROMPT_INJECTION',
    severity: 'critical',
    confidence: 0.95,
    description: 'LLM boundary marker injection',
  },
  {
    pattern: /<<SYS>>|<\/SYS>>|<\|im_start\|>|<\|im_end\|>/i,
    type: 'PROMPT_INJECTION',
    severity: 'critical',
    confidence: 0.95,
    description: 'Model-specific boundary injection',
  },
  {
    pattern: /###\s*(instruction|system|user|assistant|human|ai)\s*:/i,
    type: 'PROMPT_INJECTION',
    severity: 'high',
    confidence: 0.85,
    description: 'Markdown-style role injection',
  },
  // Data extraction attempts
  {
    pattern: /reveal\s+(your|the)\s+(prompt|instructions?|system|configuration|secrets?)/i,
    type: 'PROMPT_INJECTION',
    severity: 'high',
    confidence: 0.85,
    description: 'Prompt extraction attempt',
  },
  {
    pattern: /show\s+me\s+(your|the)\s+(prompt|instructions?|original|full)/i,
    type: 'PROMPT_INJECTION',
    severity: 'high',
    confidence: 0.8,
    description: 'Prompt reveal attempt',
  },
  {
    pattern: /what\s+(are|is|were)\s+your\s+(prompt|instructions?|initial|original)/i,
    type: 'PROMPT_INJECTION',
    severity: 'medium',
    confidence: 0.7,
    description: 'Prompt inquiry',
  },
  // Jailbreak patterns
  {
    pattern: /DAN\s+mode|jailbreak|unlock\s+mode|developer\s+mode|god\s+mode/i,
    type: 'PROMPT_INJECTION',
    severity: 'critical',
    confidence: 0.95,
    description: 'Known jailbreak pattern',
  },
  {
    pattern: /you\s+are\s+now\s+\w+/i,
    type: 'PROMPT_INJECTION',
    severity: 'high',
    confidence: 0.8,
    description: 'Identity reassignment pattern',
  },
  {
    pattern: /what\s+(are|is|were)\s+(your|the)\s+(system\s+)?(instructions?|prompt)/i,
    type: 'PROMPT_INJECTION',
    severity: 'medium',
    confidence: 0.75,
    description: 'System prompt inquiry',
  },
  {
    pattern: /hypothetically|theoretically|for\s+educational\s+purposes/i,
    type: 'PROMPT_INJECTION',
    severity: 'low',
    confidence: 0.4,
    description: 'Potential circumvention framing',
  },
];

/**
 * All injection patterns combined
 */
const ALL_INJECTION_PATTERNS: InjectionPattern[] = [
  ...SQL_INJECTION_PATTERNS,
  ...NOSQL_INJECTION_PATTERNS,
  ...COMMAND_INJECTION_PATTERNS,
  ...XSS_PATTERNS,
  ...PATH_TRAVERSAL_PATTERNS,
  ...PROMPT_INJECTION_PATTERNS,
];

// ============================================================================
// Injection Detection Result Types
// ============================================================================

/**
 * Result of injection detection
 */
export interface InjectionDetectionResult {
  /** Whether any injection was detected */
  detected: boolean;
  /** Types of injection detected */
  types: InjectionType[];
  /** Overall confidence score (0-1) */
  confidence: number;
  /** Maximum severity found */
  maxSeverity: 'low' | 'medium' | 'high' | 'critical' | 'none';
  /** Individual matches with details */
  matches: InjectionMatch[];
  /** Should this be blocked? (based on confidence threshold) */
  shouldBlock: boolean;
  /** Should this be flagged for review? */
  shouldReview: boolean;
}

/**
 * Individual injection pattern match
 */
export interface InjectionMatch {
  type: InjectionType;
  pattern: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  matchedText?: string;
  position?: number;
}

/**
 * Sanitized text result
 */
export interface SanitizedText {
  /** Sanitized text */
  text: string;
  /** Alias for compatibility */
  sanitizedText: string;
  /** Whether sanitization was applied */
  wasModified: boolean;
  /** Characters removed */
  removedChars: number;
  /** Warnings generated */
  warnings: ValidationWarning[];
  /** Injection detection result if detected */
  injectionResult?: InjectionDetectionResult;
}

// ============================================================================
// Injection Detector
// ============================================================================

/**
 * Configuration for injection detector
 */
export interface InjectionDetectorConfig {
  /** Confidence threshold for blocking (default: 0.8) */
  blockThreshold?: number;
  /** Confidence threshold for review flag (default: 0.5) */
  reviewThreshold?: number;
  /** Enable specific detection types */
  detectSQL?: boolean;
  detectNoSQL?: boolean;
  detectXSS?: boolean;
  detectCommandInjection?: boolean;
  detectPathTraversal?: boolean;
  detectPromptInjection?: boolean;
  detectJSONInjection?: boolean;
}

const DEFAULT_DETECTOR_CONFIG: Required<InjectionDetectorConfig> = {
  blockThreshold: 0.8,
  reviewThreshold: 0.5,
  detectSQL: true,
  detectNoSQL: true,
  detectXSS: true,
  detectCommandInjection: true,
  detectPathTraversal: true,
  detectPromptInjection: true,
  detectJSONInjection: true,
};

/**
 * Injection Detector
 *
 * Detects potential injection attacks with confidence scoring.
 */
export class InjectionDetector {
  private readonly config: Required<InjectionDetectorConfig>;
  private readonly patterns: InjectionPattern[];

  constructor(config: InjectionDetectorConfig = {}) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };

    // Build pattern list based on config
    this.patterns = [];
    if (this.config.detectSQL) this.patterns.push(...SQL_INJECTION_PATTERNS);
    if (this.config.detectNoSQL) this.patterns.push(...NOSQL_INJECTION_PATTERNS);
    if (this.config.detectXSS) this.patterns.push(...XSS_PATTERNS);
    if (this.config.detectCommandInjection) this.patterns.push(...COMMAND_INJECTION_PATTERNS);
    if (this.config.detectPathTraversal) this.patterns.push(...PATH_TRAVERSAL_PATTERNS);
    if (this.config.detectPromptInjection) this.patterns.push(...PROMPT_INJECTION_PATTERNS);
  }

  /**
   * Detect injection attempts in text
   */
  detect(text: string): InjectionDetectionResult {
    const matches: InjectionMatch[] = [];
    const types = new Set<InjectionType>();
    let maxConfidence = 0;
    let maxSeverity: 'low' | 'medium' | 'high' | 'critical' | 'none' = 'none';

    // Normalize text for detection
    const normalizedText = text.normalize('NFC');

    for (const patternDef of this.patterns) {
      const match = patternDef.pattern.exec(normalizedText);
      if (match) {
        matches.push({
          type: patternDef.type,
          pattern: patternDef.pattern.source,
          severity: patternDef.severity,
          confidence: patternDef.confidence,
          description: patternDef.description,
          matchedText: match[0].substring(0, 100), // Limit matched text length
          position: match.index,
        });

        types.add(patternDef.type);
        maxConfidence = Math.max(maxConfidence, patternDef.confidence);
        maxSeverity = this.getHigherSeverity(maxSeverity, patternDef.severity);
      }
    }

    // Calculate aggregate confidence
    const aggregateConfidence = this.calculateAggregateConfidence(matches);

    return {
      detected: matches.length > 0,
      types: Array.from(types),
      confidence: aggregateConfidence,
      maxSeverity,
      matches,
      shouldBlock: aggregateConfidence >= this.config.blockThreshold,
      shouldReview: aggregateConfidence >= this.config.reviewThreshold && !matches.some(m => m.severity === 'critical'),
    };
  }

  /**
   * Calculate aggregate confidence from multiple matches
   */
  private calculateAggregateConfidence(matches: InjectionMatch[]): number {
    if (matches.length === 0) return 0;

    // Use formula: 1 - product(1 - confidence_i)
    // This gives higher confidence when multiple patterns match
    let product = 1;
    for (const match of matches) {
      product *= (1 - match.confidence);
    }
    return 1 - product;
  }

  /**
   * Compare severities and return the higher one
   */
  private getHigherSeverity(
    a: 'low' | 'medium' | 'high' | 'critical' | 'none',
    b: 'low' | 'medium' | 'high' | 'critical'
  ): 'low' | 'medium' | 'high' | 'critical' {
    const order = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
    return order[a] >= order[b] ? (a === 'none' ? b : a as 'low' | 'medium' | 'high' | 'critical') : b;
  }
}

// ============================================================================
// Transcript Sanitizer
// ============================================================================

/**
 * Configuration for transcript sanitizer
 */
export interface TranscriptSanitizerConfig {
  /** Maximum allowed length */
  maxLength?: number;
  /** Remove control characters */
  removeControlChars?: boolean;
  /** Normalize unicode */
  normalizeUnicode?: boolean;
  /** Detect injection attempts */
  detectInjection?: boolean;
  /** Injection detector config */
  injectionConfig?: InjectionDetectorConfig;
}

/**
 * Transcript Sanitizer
 *
 * Sanitizes transcript text for safe processing.
 */
export class TranscriptSanitizer {
  private readonly config: Required<Omit<TranscriptSanitizerConfig, 'injectionConfig'>>;
  private readonly injectionDetector: InjectionDetector | null;

  constructor(config: TranscriptSanitizerConfig = {}) {
    this.config = {
      maxLength: config.maxLength ?? MAX_LENGTHS.transcriptText,
      removeControlChars: config.removeControlChars ?? true,
      normalizeUnicode: config.normalizeUnicode ?? true,
      detectInjection: config.detectInjection ?? true,
    };

    this.injectionDetector = this.config.detectInjection
      ? new InjectionDetector(config.injectionConfig ?? { detectPromptInjection: true })
      : null;
  }

  /**
   * Sanitize transcript text
   */
  sanitize(text: string): SanitizedText {
    const warnings: ValidationWarning[] = [];
    let sanitized = text;
    let removedChars = 0;

    // Validate input type
    if (typeof text !== 'string') {
      return {
        text: '',
        sanitizedText: '',
        wasModified: true,
        removedChars: 0,
        warnings: [{
          field: 'transcriptText',
          code: 'INVALID_TYPE',
          message: 'Input must be a string',
        }],
      };
    }

    // Normalize unicode first (important for consistent pattern matching)
    if (this.config.normalizeUnicode) {
      sanitized = sanitized.normalize('NFC');
    }

    // Check length
    if (sanitized.length > this.config.maxLength) {
      sanitized = sanitized.substring(0, this.config.maxLength);
      removedChars += text.length - this.config.maxLength;
      warnings.push({
        field: 'transcriptText',
        code: 'TRUNCATED',
        message: `Transcript truncated from ${text.length} to ${this.config.maxLength} characters`,
      });
    }

    // Remove control characters (except newlines, tabs, carriage returns)
    if (this.config.removeControlChars) {
      const beforeControl = sanitized.length;
      sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      if (sanitized.length < beforeControl) {
        removedChars += beforeControl - sanitized.length;
        warnings.push({
          field: 'transcriptText',
          code: 'CONTROL_CHARS_REMOVED',
          message: 'Control characters were removed from transcript',
        });
      }
    }

    // Detect injection attempts
    let injectionResult: InjectionDetectionResult | undefined;
    if (this.injectionDetector) {
      injectionResult = this.injectionDetector.detect(sanitized);
      if (injectionResult.detected) {
        warnings.push({
          field: 'transcriptText',
          code: 'POTENTIAL_INJECTION',
          message: `Potential ${injectionResult.types.join(', ')} detected (confidence: ${(injectionResult.confidence * 100).toFixed(1)}%)`,
        });
      }
    }

    return {
      text: sanitized,
      sanitizedText: sanitized,
      wasModified: removedChars > 0,
      removedChars,
      warnings,
      injectionResult,
    };
  }

  /**
   * Detect prompt injection attempts (legacy method for compatibility)
   */
  detectPromptInjection(text: string): { detected: boolean; patterns: string[] } {
    if (!this.injectionDetector) {
      return { detected: false, patterns: [] };
    }

    const result = this.injectionDetector.detect(text);
    const promptMatches = result.matches.filter(m => m.type === 'PROMPT_INJECTION');

    return {
      detected: promptMatches.length > 0,
      patterns: promptMatches.map(m => m.pattern),
    };
  }
}

// ============================================================================
// ICD-10 Code Validator
// ============================================================================

/**
 * Configuration for ICD-10 validator
 */
export interface ICD10ValidatorConfig {
  /** Allowed codes (if set, only these codes are valid) */
  allowedCodes?: string[];
  /** Strict mode - reject codes not in allowlist (vs warn) */
  strictMode?: boolean;
  /** Maximum codes allowed per request */
  maxCodes?: number;
}

/**
 * ICD-10 Code Validator
 *
 * Validates ICD-10 diagnosis codes against format and allowlist.
 */
export class ICD10Validator {
  private allowedCodes: Set<string> | null = null;
  private readonly strictMode: boolean;
  private readonly maxCodes: number;

  constructor(config: ICD10ValidatorConfig = {}) {
    this.strictMode = config.strictMode ?? false;
    this.maxCodes = config.maxCodes ?? MAX_LENGTHS.arrayLength;

    if (config.allowedCodes) {
      this.setAllowedCodes(config.allowedCodes);
    }
  }

  /**
   * Set allowed codes from a list
   */
  setAllowedCodes(codes: string[]): void {
    this.allowedCodes = new Set(codes.map((c) => this.normalizeCode(c)));
  }

  /**
   * Check if a code is in the allowlist
   */
  isAllowed(code: string): boolean {
    if (!this.allowedCodes) return true;
    return this.allowedCodes.has(this.normalizeCode(code));
  }

  /**
   * Validate ICD-10 codes
   */
  validate(codes: string[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const validCodes: string[] = [];

    // Check input type
    if (!Array.isArray(codes)) {
      errors.push({
        field: 'conditionCodes',
        code: 'INVALID_TYPE',
        message: 'Condition codes must be an array',
      });
      return { isValid: false, errors, warnings };
    }

    // Check array length
    if (codes.length > this.maxCodes) {
      errors.push({
        field: 'conditionCodes',
        code: 'TOO_MANY_CODES',
        message: `Maximum ${this.maxCodes} codes allowed, received ${codes.length}`,
      });
      return { isValid: false, errors, warnings };
    }

    // Check for duplicates
    const seen = new Set<string>();

    for (const code of codes) {
      const validationResult = this.validateSingleCode(code);

      if (validationResult.error) {
        errors.push(validationResult.error);
      } else if (validationResult.normalizedCode) {
        // Check for duplicates
        if (seen.has(validationResult.normalizedCode)) {
          warnings.push({
            field: 'conditionCodes',
            code: 'DUPLICATE_CODE',
            message: `Duplicate code: ${validationResult.normalizedCode}`,
          });
          continue;
        }
        seen.add(validationResult.normalizedCode);

        if (validationResult.warning) {
          warnings.push(validationResult.warning);
        }
        validCodes.push(validationResult.normalizedCode);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue: validCodes,
    };
  }

  /**
   * Normalize a code for comparison
   */
  private normalizeCode(code: string): string {
    return code.toUpperCase().trim().replace(/[.\-\s]/g, '');
  }

  /**
   * Format code with standard decimal placement
   */
  private formatCode(normalized: string): string {
    return normalized.length > 3
      ? `${normalized.slice(0, 3)}.${normalized.slice(3)}`
      : normalized;
  }

  /**
   * Validate a single ICD-10 code
   */
  private validateSingleCode(code: string): {
    normalizedCode?: string;
    error?: ValidationError;
    warning?: ValidationWarning;
  } {
    // Check input type
    if (typeof code !== 'string') {
      return {
        error: {
          field: 'conditionCodes',
          code: 'INVALID_TYPE',
          message: 'Each code must be a string',
          rejectedValue: String(code),
        },
      };
    }

    // Normalize: uppercase, trim, remove common separators
    const normalized = this.normalizeCode(code);

    // Check for empty code
    if (normalized.length === 0) {
      return {
        error: {
          field: 'conditionCodes',
          code: 'EMPTY_CODE',
          message: 'Empty code not allowed',
          rejectedValue: code,
        },
      };
    }

    // Check length (ICD-10-CM codes are 3-7 characters)
    if (normalized.length < 3 || normalized.length > 7) {
      return {
        error: {
          field: 'conditionCodes',
          code: 'INVALID_LENGTH',
          message: `Invalid ICD-10 code length (${normalized.length}): ${code}. Must be 3-7 characters.`,
          rejectedValue: code,
        },
      };
    }

    // Check format: starts with letter, followed by digits, optional alphanumeric suffix
    // ICD-10-CM format: [A-Z][0-9]{2}(.[A-Z0-9]{1,4})?
    const icd10Pattern = /^[A-TV-Z]\d{2}[A-Z0-9]{0,4}$/;
    if (!icd10Pattern.test(normalized)) {
      return {
        error: {
          field: 'conditionCodes',
          code: 'INVALID_FORMAT',
          message: `Invalid ICD-10 code format: ${code}. Must start with letter A-T or V-Z, followed by 2 digits and up to 4 alphanumeric characters.`,
          rejectedValue: code,
        },
      };
    }

    // Check against allowlist if configured
    if (this.allowedCodes && !this.allowedCodes.has(normalized)) {
      if (this.strictMode) {
        return {
          error: {
            field: 'conditionCodes',
            code: 'NOT_IN_ALLOWLIST',
            message: `ICD-10 code ${this.formatCode(normalized)} not in approved list`,
            rejectedValue: code,
          },
        };
      }
      return {
        warning: {
          field: 'conditionCodes',
          code: 'NOT_IN_ALLOWLIST',
          message: `ICD-10 code ${this.formatCode(normalized)} not in approved list`,
        },
        normalizedCode: this.formatCode(normalized),
      };
    }

    return { normalizedCode: this.formatCode(normalized) };
  }
}

// ============================================================================
// General Input Sanitizer
// ============================================================================

/**
 * Configuration for input sanitizer
 */
export interface InputSanitizerConfig {
  /** Maximum string length (default: 10000) */
  maxStringLength?: number;
  /** Maximum array length (default: 1000) */
  maxArrayLength?: number;
  /** Maximum object depth (default: 10) */
  maxObjectDepth?: number;
  /** Enable injection detection */
  detectInjection?: boolean;
  /** Injection detector config */
  injectionConfig?: InjectionDetectorConfig;
}

/**
 * General Input Sanitizer
 *
 * Sanitizes general input for injection prevention.
 */
export class InputSanitizer {
  private readonly config: Required<Omit<InputSanitizerConfig, 'injectionConfig'>>;
  private readonly injectionDetector: InjectionDetector;

  constructor(config: InputSanitizerConfig = {}) {
    this.config = {
      maxStringLength: config.maxStringLength ?? MAX_LENGTHS.stringField,
      maxArrayLength: config.maxArrayLength ?? MAX_LENGTHS.arrayLength,
      maxObjectDepth: config.maxObjectDepth ?? MAX_LENGTHS.objectDepth,
      detectInjection: config.detectInjection ?? true,
    };

    this.injectionDetector = new InjectionDetector(config.injectionConfig);
  }

  /**
   * Sanitize a string field
   */
  sanitizeString(value: string, fieldName: string, maxLength?: number): SanitizedText {
    const warnings: ValidationWarning[] = [];
    let sanitized = typeof value === 'string' ? value : String(value);
    let removedChars = 0;

    // Normalize unicode first
    sanitized = sanitized.normalize('NFC');

    // Check length
    const max = maxLength ?? this.config.maxStringLength;
    if (sanitized.length > max) {
      sanitized = sanitized.substring(0, max);
      removedChars += value.length - max;
      warnings.push({
        field: fieldName,
        code: 'TRUNCATED',
        message: `${fieldName} truncated to ${max} characters`,
      });
    }

    // Remove control characters (except standard whitespace)
    const beforeControl = sanitized.length;
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    if (sanitized.length < beforeControl) {
      removedChars += beforeControl - sanitized.length;
      warnings.push({
        field: fieldName,
        code: 'CONTROL_CHARS_REMOVED',
        message: `Control characters removed from ${fieldName}`,
      });
    }

    // Check for injection patterns
    let injectionResult: InjectionDetectionResult | undefined;
    if (this.config.detectInjection) {
      injectionResult = this.injectionDetector.detect(sanitized);
      if (injectionResult.detected) {
        warnings.push({
          field: fieldName,
          code: 'POTENTIAL_INJECTION',
          message: `Potential ${injectionResult.types.join(', ')} detected in ${fieldName}`,
        });
      }
    }

    return {
      text: sanitized,
      sanitizedText: sanitized,
      wasModified: removedChars > 0,
      removedChars,
      warnings,
      injectionResult,
    };
  }

  /**
   * Sanitize an object recursively
   */
  sanitizeObject<T extends Record<string, unknown>>(
    obj: T,
    maxDepth?: number
  ): { sanitized: T; warnings: ValidationWarning[] } {
    const warnings: ValidationWarning[] = [];
    const effectiveMaxDepth = maxDepth ?? this.config.maxObjectDepth;

    const sanitize = (value: unknown, path: string, depth: number): unknown => {
      // Check depth limit
      if (depth > effectiveMaxDepth) {
        warnings.push({
          field: path,
          code: 'MAX_DEPTH_EXCEEDED',
          message: `Maximum object depth exceeded at ${path}`,
        });
        return null;
      }

      // Handle null/undefined
      if (value === null || value === undefined) {
        return value;
      }

      // Handle strings
      if (typeof value === 'string') {
        const result = this.sanitizeString(value, path);
        warnings.push(...result.warnings);
        return result.text;
      }

      // Handle arrays
      if (Array.isArray(value)) {
        if (value.length > this.config.maxArrayLength) {
          warnings.push({
            field: path,
            code: 'ARRAY_TOO_LONG',
            message: `Array at ${path} truncated from ${value.length} to ${this.config.maxArrayLength} items`,
          });
          return value.slice(0, this.config.maxArrayLength).map((item, i) =>
            sanitize(item, `${path}[${i}]`, depth + 1)
          );
        }
        return value.map((item, i) => sanitize(item, `${path}[${i}]`, depth + 1));
      }

      // Handle objects
      if (typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value)) {
          // Sanitize key as well
          const sanitizedKey = key.replace(/[\x00-\x1F\x7F]/g, '');
          const newPath = path ? `${path}.${sanitizedKey}` : sanitizedKey;
          result[sanitizedKey] = sanitize(val, newPath, depth + 1);
        }
        return result;
      }

      // Handle primitives (numbers, booleans)
      return value;
    };

    const sanitized = sanitize(obj, '', 0) as T;
    return { sanitized, warnings };
  }

  /**
   * Check if value contains injection patterns
   */
  containsInjection(value: string): boolean {
    const result = this.injectionDetector.detect(value);
    return result.detected;
  }

  /**
   * Get detailed injection detection result
   */
  detectInjection(value: string): InjectionDetectionResult {
    return this.injectionDetector.detect(value);
  }
}

// ============================================================================
// Singleton Instances (with defaults)
// ============================================================================

/**
 * Default transcript sanitizer instance
 */
export const transcriptSanitizer = new TranscriptSanitizer();

/**
 * Default ICD-10 validator instance
 */
export const icd10Validator = new ICD10Validator();

/**
 * Default input sanitizer instance
 */
export const inputSanitizer = new InputSanitizer();

/**
 * Default injection detector instance
 */
export const injectionDetector = new InjectionDetector();
