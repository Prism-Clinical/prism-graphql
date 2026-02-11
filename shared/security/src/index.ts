/**
 * PRISM Security Module
 *
 * HIPAA-compliant security infrastructure for PHI protection.
 *
 * @example
 * ```typescript
 * import {
 *   PHILevel,
 *   phiClassifier,
 *   FieldEncryptor,
 *   auditLogger,
 *   transcriptSanitizer,
 *   rateLimiter,
 * } from '@prism/security';
 *
 * // Classify PHI fields
 * const result = phiClassifier.classifyField('Patient.firstName');
 * if (result.handling.encrypt) {
 *   // Encrypt the field
 * }
 *
 * // Encrypt PHI data
 * const encryptor = new FieldEncryptor({ masterKey, keyId });
 * const encrypted = encryptor.encrypt(value, 'Patient.firstName');
 *
 * // Log PHI access
 * await auditLogger.logAccess({
 *   eventType: AuditEventType.PHI_ACCESS,
 *   userId: context.userId,
 *   // ...
 * });
 *
 * // Sanitize transcript input
 * const sanitized = transcriptSanitizer.sanitize(transcriptText);
 * if (sanitized.warnings.some(w => w.code === 'POTENTIAL_INJECTION')) {
 *   // Flag for review
 * }
 *
 * // Check rate limit
 * const { allowed } = await rateLimiter.consume('generateCarePlan', userId);
 * if (!allowed) {
 *   throw new Error('Rate limit exceeded');
 * }
 * ```
 */

// Core types
export * from './types';

// PHI Classification
export {
  // Types
  PHIFieldDefinition,
  PHIFieldRegistry,
  PHIHandlingContext,
  PHIClassificationResult,
  PHIHandlingRecommendation,
  PHIAccessRequest,
  PHIAccessDecision,
  PHIAccessAuditEntry,
  PHIDirectiveArgs,
  // Registry
  PHI_REGISTRY,
  getPHIFieldDefinition,
  isPHIField,
  getFieldsByLevel,
  getFieldsForEntity,
  registerPHIField,
  getAllPHIFields,
  getEncryptionRequiredFields,
  getNoLogFields,
  getNoMLFields,
  // Classifier
  PHIClassifier,
  phiClassifier,
  classifyPHIField,
  makePHIAccessDecision,
} from './phi-classification';

// Service Authentication
export {
  // Types
  MTLSConfig,
  ServiceJWTConfig,
  RequestSignature,
  SignedRequest,
  ServiceAuthResult,
  ServiceAuthErrorCode,
  CertificateInfo,
  CertificateRotationStatus,
  // mTLS
  MTLSManager,
  createMTLSManager,
  TLS_13_CIPHER_SUITES,
  TLS_12_CIPHER_SUITES,
  // Service JWT
  ServiceJWTManager,
  createServiceJWTManager,
  extractServiceToken,
  // Request Signing
  RequestSigner,
  RequestSignerConfig,
  createRequestSigner,
  generateSigningKeyPair,
  REQUEST_SIGNATURE_HEADER,
  REQUEST_ID_HEADER,
  CORRELATION_ID_HEADER,
} from './service-auth';

// Encryption
export {
  // Field Encryption
  FieldEncryptor,
  FieldEncryptionConfig,
  generateMasterKey,
  createFieldEncryptor,
  isEncryptedValue,
  // Cache Encryption
  CacheEncryptionManager,
  CacheEncryptionConfig,
  createCacheEncryptionManager,
  // Key Management
  KeyManager,
  KeyMetadata,
  KeyPurpose,
  KeyRotationSchedule,
  KeyStorage,
  InMemoryKeyStorage,
  createKeyManager,
  DEFAULT_ROTATION_SCHEDULES,
  KEY_ENV_VARS,
} from './encryption';

// Audit Logging
export {
  // Types
  AuditLogEntry,
  AuditLogQuery,
  AuditLogQueryResult,
  AuditConfig,
  AuditExportFormat,
  AuditExportRequest,
  AuditStatistics,
  // Logger
  AuditLogger,
  auditLogger,
  createAuditLogger,
} from './audit';

// Sanitization
export {
  // Transcript
  TranscriptSanitizer,
  transcriptSanitizer,
  SanitizedText,
  // ICD-10
  ICD10Validator,
  icd10Validator,
  // General
  InputSanitizer,
  inputSanitizer,
  // Rate Limiting
  RateLimiter,
  rateLimiter,
  createRateLimiter,
  checkRateLimit,
  RATE_LIMIT_PRESETS,
  // Validators
  validateUUID,
  validateEmail,
  validatePhone,
  validateDate,
  validateMRN,
  validateRequiredString,
  validateOptionalString,
  validateEnum,
  validateArray,
  combineValidationResults,
} from './sanitization';
