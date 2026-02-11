/**
 * Service Authentication Types
 *
 * Type definitions for service-to-service authentication.
 */

import { ServiceIdentity, ServiceTokenClaims } from '../types';

/**
 * mTLS configuration
 */
export interface MTLSConfig {
  /** Path to CA certificate */
  caCertPath: string;
  /** Path to service certificate */
  certPath: string;
  /** Path to service private key */
  keyPath: string;
  /** Whether to verify peer certificates */
  verifyPeer: boolean;
  /** Allowed cipher suites */
  cipherSuites?: string[];
  /** Minimum TLS version */
  minVersion: 'TLSv1.2' | 'TLSv1.3';
  /** Certificate revocation list path */
  crlPath?: string;
}

/**
 * Service JWT configuration
 */
export interface ServiceJWTConfig {
  /** Secret or private key for signing */
  signingKey: string;
  /** Public key for verification (if using asymmetric) */
  verifyKey?: string;
  /** Algorithm to use */
  algorithm: 'HS256' | 'RS256' | 'ES256';
  /** Token expiration in seconds */
  expirationSeconds: number;
  /** Service identity */
  identity: ServiceIdentity;
  /** Allowed audiences */
  allowedAudiences?: string[];
}

/**
 * Request signature for tamper detection
 */
export interface RequestSignature {
  /** Signature value (base64) */
  signature: string;
  /** Timestamp of signing */
  timestamp: number;
  /** Algorithm used */
  algorithm: string;
  /** Service that signed */
  signer: string;
}

/**
 * Signed request wrapper
 */
export interface SignedRequest<T = unknown> {
  /** Original request body */
  body: T;
  /** Request signature */
  signature: RequestSignature;
  /** Request ID for idempotency */
  requestId: string;
  /** Correlation ID for tracing */
  correlationId: string;
}

/**
 * Service authentication result
 */
export interface ServiceAuthResult {
  /** Whether authentication succeeded */
  authenticated: boolean;
  /** Authenticated service identity */
  identity?: ServiceIdentity;
  /** Token claims if JWT auth */
  claims?: ServiceTokenClaims;
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: ServiceAuthErrorCode;
}

/**
 * Service authentication error codes
 */
export enum ServiceAuthErrorCode {
  INVALID_CERTIFICATE = 'INVALID_CERTIFICATE',
  CERTIFICATE_EXPIRED = 'CERTIFICATE_EXPIRED',
  CERTIFICATE_REVOKED = 'CERTIFICATE_REVOKED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  INVALID_AUDIENCE = 'INVALID_AUDIENCE',
  MISSING_CREDENTIALS = 'MISSING_CREDENTIALS',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
}

/**
 * Certificate info
 */
export interface CertificateInfo {
  /** Subject common name */
  subject: string;
  /** Issuer common name */
  issuer: string;
  /** Valid from date */
  validFrom: Date;
  /** Valid until date */
  validUntil: Date;
  /** Serial number */
  serialNumber: string;
  /** Fingerprint (SHA256) */
  fingerprint: string;
  /** Whether certificate is valid */
  isValid: boolean;
  /** Days until expiration */
  daysUntilExpiration: number;
}

/**
 * Certificate rotation status
 */
export interface CertificateRotationStatus {
  /** Current certificate info */
  current: CertificateInfo;
  /** Next certificate info (if rotation pending) */
  next?: CertificateInfo;
  /** Rotation scheduled time */
  scheduledRotation?: Date;
  /** Whether rotation is in progress */
  rotationInProgress: boolean;
}
