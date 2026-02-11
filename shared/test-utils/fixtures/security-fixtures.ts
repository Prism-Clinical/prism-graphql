/**
 * Security Test Fixtures
 *
 * Test data for security-related unit and integration tests.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Sample PHI data for testing encryption and classification
 */
export const samplePHIData = {
  directPHI: {
    firstName: 'John',
    lastName: 'Doe',
    mrn: 'MRN-12345678',
    dateOfBirth: '1985-05-15',
    ssn: '123-45-6789',
    email: 'john.doe@email.com',
    phone: '555-123-4567',
    address: {
      street: '123 Main Street',
      city: 'Springfield',
      state: 'IL',
      zipCode: '62701',
    },
  },

  indirectPHI: {
    age: 38,
    zipCode: '62701',
    gender: 'male',
    ethnicity: 'Caucasian',
  },

  sensitivePHI: {
    diagnoses: ['I10', 'E11.9', 'F32.1'],
    medications: [
      { name: 'Metformin', dosage: '500mg', frequency: 'twice daily' },
      { name: 'Lisinopril', dosage: '10mg', frequency: 'daily' },
    ],
    symptoms: ['fatigue', 'increased thirst', 'frequent urination'],
    mentalHealthNotes: 'Patient reports mild depression symptoms',
    hivStatus: 'negative',
    substanceUseHistory: 'None reported',
  },

  nonPHI: {
    requestId: uuidv4(),
    timestamp: new Date().toISOString(),
    serviceName: 'careplan-service',
    environment: 'test',
    version: '1.0.0',
  },
};

/**
 * Sample transcripts for testing sanitization and extraction
 */
export const sampleTranscripts = {
  cleanTranscript: `
    Provider: Good morning, how are you feeling today?
    Patient: I've been experiencing some chest pain for the past two days.
    Provider: Can you describe the pain? Is it sharp or dull?
    Patient: It's more of a dull ache, especially when I exert myself.
    Provider: I see. Have you noticed any shortness of breath?
    Patient: Yes, especially when climbing stairs.
    Provider: Let me check your blood pressure. It's 145 over 90, which is elevated.
  `,

  transcriptWithPHI: `
    Provider: Hello, John Doe. I see your date of birth is May 15, 1985.
    Your medical record number is MRN-12345678.
    Patient: Yes, that's correct. My phone number is 555-123-4567 if you need to reach me.
    Provider: I have your address as 123 Main Street, Springfield, IL 62701.
    Patient: That's right.
    Provider: And your social security number ending in 6789 for insurance verification.
  `,

  transcriptWithInjection: `
    Patient: My symptoms are: '; DROP TABLE patients; --
    Also, I've been feeling <script>alert('XSS')</script> tired lately.
    Provider: ${'{'.repeat(100)}INJECTION${')'.repeat(100)}
    Patient: {"__proto__": {"admin": true}}
  `,

  transcriptWithSpecialChars: `
    Provider: How are you feeling?
    Patient: I've been experiencing \x00 null bytes \x1f control chars.
    Also some unicode: 你好 مرحبا שלום
    And emojis: 😊 💊 🏥
    Provider: Let's normalize this text properly.
  `,

  emptyTranscript: '',

  oversizedTranscript: 'A'.repeat(200000), // 200KB of 'A's
};

/**
 * Sample ICD-10 codes for validation testing
 */
export const icd10Codes = {
  validCodes: [
    'I10',      // Essential (primary) hypertension
    'I25.10',   // Atherosclerotic heart disease of native coronary artery
    'E11.9',    // Type 2 diabetes mellitus without complications
    'J45.20',   // Mild intermittent asthma, uncomplicated
    'F32.1',    // Major depressive disorder, single episode, moderate
    'M54.5',    // Low back pain
    'K21.0',    // Gastro-esophageal reflux disease with esophagitis
  ],

  invalidCodes: [
    'INVALID',
    '12345',
    'I10.999',  // Too many digits
    'XX1.1',    // Invalid letter
    '',
    null,
    undefined,
  ],

  dangerousCodes: [
    "I10'; DROP TABLE--",
    '<script>alert("xss")</script>',
    '${7*7}',
    '{{constructor.constructor("return this")()}}',
  ],
};

/**
 * Sample JWT tokens for authentication testing
 */
export const sampleTokens = {
  validProviderToken: {
    iss: 'prism-auth-service',
    sub: 'user-123',
    aud: 'prism-graphql',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000),
    jti: uuidv4(),
    roles: ['PROVIDER'],
    permissions: ['read:patients', 'write:careplans', 'read:recommendations'],
    institutionId: 'inst-123',
  },

  validCareCoordinatorToken: {
    iss: 'prism-auth-service',
    sub: 'user-456',
    aud: 'prism-graphql',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: uuidv4(),
    roles: ['CARE_COORDINATOR'],
    permissions: ['read:patients', 'write:careplans'],
    institutionId: 'inst-123',
  },

  validAdminToken: {
    iss: 'prism-auth-service',
    sub: 'admin-001',
    aud: 'prism-graphql',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: uuidv4(),
    roles: ['ADMIN', 'PROVIDER'],
    permissions: ['*'],
    institutionId: 'inst-123',
  },

  expiredToken: {
    iss: 'prism-auth-service',
    sub: 'user-789',
    aud: 'prism-graphql',
    exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    iat: Math.floor(Date.now() / 1000) - 7200,
    jti: uuidv4(),
    roles: ['PROVIDER'],
    permissions: ['read:patients'],
    institutionId: 'inst-123',
  },

  invalidAudienceToken: {
    iss: 'prism-auth-service',
    sub: 'user-999',
    aud: 'other-service',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: uuidv4(),
    roles: ['PROVIDER'],
    permissions: ['read:patients'],
    institutionId: 'inst-123',
  },

  validServiceToken: {
    iss: 'careplan-service',
    sub: 'careplan-service',
    aud: 'audio-intelligence',
    exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
    iat: Math.floor(Date.now() / 1000),
    jti: uuidv4(),
    permissions: ['extract:entities'],
    serviceType: 'internal',
  },

  expiredServiceToken: {
    iss: 'careplan-service',
    sub: 'careplan-service',
    aud: 'audio-intelligence',
    exp: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
    iat: Math.floor(Date.now() / 1000) - 600,
    jti: uuidv4(),
    permissions: ['extract:entities'],
    serviceType: 'internal',
  },
};

/**
 * Sample audit events for testing
 */
export const sampleAuditEvents = {
  phiAccessEvent: {
    eventType: 'PHI_ACCESS',
    userId: 'user-123',
    userRole: 'PROVIDER',
    patientId: 'patient-456',
    resourceType: 'Patient',
    resourceId: 'patient-456',
    action: 'READ',
    phiAccessed: true,
    phiFields: ['firstName', 'lastName', 'dateOfBirth', 'mrn'],
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    requestId: uuidv4(),
    correlationId: uuidv4(),
    outcome: 'SUCCESS',
  },

  carePlanCreationEvent: {
    eventType: 'RESOURCE_CREATED',
    userId: 'user-123',
    userRole: 'PROVIDER',
    patientId: 'patient-456',
    resourceType: 'CarePlan',
    resourceId: uuidv4(),
    action: 'CREATE',
    phiAccessed: true,
    phiFields: ['goals', 'interventions', 'medications'],
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0',
    requestId: uuidv4(),
    correlationId: uuidv4(),
    outcome: 'SUCCESS',
  },

  unauthorizedAccessEvent: {
    eventType: 'UNAUTHORIZED_ACCESS',
    userId: 'user-789',
    userRole: 'CARE_COORDINATOR',
    patientId: 'patient-999',
    resourceType: 'Patient',
    resourceId: 'patient-999',
    action: 'READ',
    phiAccessed: false,
    phiFields: [],
    ipAddress: '192.168.1.200',
    userAgent: 'Mozilla/5.0',
    requestId: uuidv4(),
    correlationId: uuidv4(),
    outcome: 'DENIED',
    failureReason: 'User not authorized to access this patient',
  },

  authFailureEvent: {
    eventType: 'AUTH_FAILURE',
    ipAddress: '10.0.0.50',
    userAgent: 'curl/7.68.0',
    requestId: uuidv4(),
    outcome: 'FAILURE',
    failureReason: 'Invalid authentication token',
    metadata: {
      attemptedResource: '/graphql',
      tokenError: 'Token expired',
    },
  },
};

/**
 * Sample security events for testing
 */
export const sampleSecurityEvents = {
  injectionAttempt: {
    type: 'INJECTION_ATTEMPT',
    severity: 'CRITICAL',
    userId: 'user-123',
    ipAddress: '10.0.0.100',
    details: {
      injectionType: 'SQL',
      targetField: 'conditionCodes',
      payload: "'; DROP TABLE--",
    },
  },

  bruteForceAttempt: {
    type: 'BRUTE_FORCE',
    severity: 'HIGH',
    ipAddress: '10.0.0.100',
    details: {
      failureCount: 15,
      timeWindowMinutes: 15,
      targetEndpoint: '/auth/login',
    },
  },

  rateLimitExceeded: {
    type: 'RATE_LIMIT_EXCEEDED',
    severity: 'MEDIUM',
    userId: 'user-456',
    ipAddress: '192.168.1.50',
    details: {
      endpoint: 'generateCarePlan',
      limit: 10,
      window: '1m',
      actualCount: 25,
    },
  },

  unusualAccessPattern: {
    type: 'UNUSUAL_ACCESS_PATTERN',
    severity: 'HIGH',
    userId: 'user-789',
    details: {
      pattern: 'HIGH_VOLUME_PHI_ACCESS',
      patientCount: 150,
      timeWindowMinutes: 60,
      normalBaseline: 20,
    },
  },
};

/**
 * Sample encryption keys and values for testing
 */
export const encryptionTestData = {
  samplePlaintext: 'This is a test message containing PHI: John Doe, DOB: 1985-05-15',
  sampleIV: Buffer.from('0123456789abcdef', 'hex'),
  sampleKey: Buffer.from('0123456789abcdef0123456789abcdef', 'hex'), // 256-bit key

  fieldEncryptionCases: [
    { field: 'Patient.firstName', value: 'John', level: 'DIRECT' },
    { field: 'Patient.lastName', value: 'Doe', level: 'DIRECT' },
    { field: 'Patient.dateOfBirth', value: '1985-05-15', level: 'DIRECT' },
    { field: 'CarePlan.goals', value: 'Reduce blood pressure', level: 'SENSITIVE' },
  ],
};

/**
 * Generate sample pipeline input for testing
 */
export function generatePipelineInput(overrides: Partial<{
  visitId: string;
  patientId: string;
  transcriptText: string;
  conditionCodes: string[];
  idempotencyKey: string;
  correlationId: string;
}> = {}) {
  return {
    visitId: overrides.visitId || uuidv4(),
    patientId: overrides.patientId || uuidv4(),
    transcriptText: overrides.transcriptText || sampleTranscripts.cleanTranscript,
    conditionCodes: overrides.conditionCodes || icd10Codes.validCodes.slice(0, 3),
    idempotencyKey: overrides.idempotencyKey || uuidv4(),
    correlationId: overrides.correlationId || uuidv4(),
  };
}

/**
 * Generate sample user context for testing
 */
export function generateUserContext(role: 'PROVIDER' | 'CARE_COORDINATOR' | 'ADMIN' = 'PROVIDER') {
  const tokens = {
    PROVIDER: sampleTokens.validProviderToken,
    CARE_COORDINATOR: sampleTokens.validCareCoordinatorToken,
    ADMIN: sampleTokens.validAdminToken,
  };

  return {
    userId: tokens[role].sub,
    roles: tokens[role].roles,
    permissions: tokens[role].permissions,
    institutionId: tokens[role].institutionId,
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Test)',
    requestId: uuidv4(),
    correlationId: uuidv4(),
  };
}
