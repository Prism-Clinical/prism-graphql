/**
 * mTLS Certificate Management
 *
 * Mutual TLS authentication for service-to-service communication.
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as tls from 'tls';
import { MTLSConfig, CertificateInfo, CertificateRotationStatus, ServiceAuthResult, ServiceAuthErrorCode } from './types';
import { ServiceIdentity } from '../types';

/**
 * mTLS Manager
 *
 * Handles certificate loading, validation, and rotation for mTLS authentication.
 */
export class MTLSManager {
  private config: MTLSConfig;
  private caCert: string | null = null;
  private cert: string | null = null;
  private key: string | null = null;
  private crl: string | null = null;
  private pendingCert: string | null = null;
  private pendingKey: string | null = null;
  private rotationScheduled: Date | null = null;

  constructor(config: MTLSConfig) {
    this.config = config;
  }

  /**
   * Load certificates from configured paths
   */
  async loadCertificates(): Promise<void> {
    try {
      this.caCert = await fs.promises.readFile(this.config.caCertPath, 'utf8');
      this.cert = await fs.promises.readFile(this.config.certPath, 'utf8');
      this.key = await fs.promises.readFile(this.config.keyPath, 'utf8');

      if (this.config.crlPath) {
        try {
          this.crl = await fs.promises.readFile(this.config.crlPath, 'utf8');
        } catch {
          console.warn('CRL file not found, continuing without CRL');
        }
      }
    } catch (error) {
      throw new Error(`Failed to load certificates: ${error}`);
    }
  }

  /**
   * Get TLS options for creating secure connections
   */
  getTLSOptions(): tls.TlsOptions {
    if (!this.caCert || !this.cert || !this.key) {
      throw new Error('Certificates not loaded. Call loadCertificates() first.');
    }

    const options: tls.TlsOptions = {
      ca: this.caCert,
      cert: this.cert,
      key: this.key,
      requestCert: this.config.verifyPeer,
      rejectUnauthorized: this.config.verifyPeer,
      minVersion: this.config.minVersion,
    };

    if (this.config.cipherSuites) {
      options.ciphers = this.config.cipherSuites.join(':');
    }

    if (this.crl) {
      options.crl = this.crl;
    }

    return options;
  }

  /**
   * Get HTTPS agent options for making client requests
   */
  getHTTPSAgentOptions(): {
    ca: string;
    cert: string;
    key: string;
    rejectUnauthorized: boolean;
    minVersion: string;
  } {
    if (!this.caCert || !this.cert || !this.key) {
      throw new Error('Certificates not loaded. Call loadCertificates() first.');
    }

    return {
      ca: this.caCert,
      cert: this.cert,
      key: this.key,
      rejectUnauthorized: this.config.verifyPeer,
      minVersion: this.config.minVersion,
    };
  }

  /**
   * Verify a peer certificate
   */
  verifyPeerCertificate(peerCert: tls.PeerCertificate): ServiceAuthResult {
    if (!peerCert) {
      return {
        authenticated: false,
        error: 'No peer certificate provided',
        errorCode: ServiceAuthErrorCode.MISSING_CREDENTIALS,
      };
    }

    // Check if certificate is valid
    const now = new Date();
    const validFrom = new Date(peerCert.valid_from);
    const validTo = new Date(peerCert.valid_to);

    if (now < validFrom) {
      return {
        authenticated: false,
        error: 'Certificate not yet valid',
        errorCode: ServiceAuthErrorCode.INVALID_CERTIFICATE,
      };
    }

    if (now > validTo) {
      return {
        authenticated: false,
        error: 'Certificate has expired',
        errorCode: ServiceAuthErrorCode.CERTIFICATE_EXPIRED,
      };
    }

    // Check CRL if available
    if (this.crl && this.isCertificateRevoked(peerCert)) {
      return {
        authenticated: false,
        error: 'Certificate has been revoked',
        errorCode: ServiceAuthErrorCode.CERTIFICATE_REVOKED,
      };
    }

    // Extract service identity from certificate
    const identity = this.extractIdentityFromCert(peerCert);

    return {
      authenticated: true,
      identity,
    };
  }

  /**
   * Get current certificate info
   */
  getCertificateInfo(): CertificateInfo | null {
    if (!this.cert) {
      return null;
    }

    return this.parseCertificateInfo(this.cert);
  }

  /**
   * Get certificate rotation status
   */
  getRotationStatus(): CertificateRotationStatus | null {
    const current = this.getCertificateInfo();
    if (!current) {
      return null;
    }

    return {
      current,
      next: this.pendingCert ? this.parseCertificateInfo(this.pendingCert) : undefined,
      scheduledRotation: this.rotationScheduled || undefined,
      rotationInProgress: this.pendingCert !== null,
    };
  }

  /**
   * Schedule certificate rotation
   */
  async scheduleRotation(newCertPath: string, newKeyPath: string, rotateAt: Date): Promise<void> {
    this.pendingCert = await fs.promises.readFile(newCertPath, 'utf8');
    this.pendingKey = await fs.promises.readFile(newKeyPath, 'utf8');
    this.rotationScheduled = rotateAt;

    // Schedule the actual rotation
    const delay = rotateAt.getTime() - Date.now();
    if (delay > 0) {
      setTimeout(() => this.executeRotation(), delay);
    } else {
      await this.executeRotation();
    }
  }

  /**
   * Execute certificate rotation
   */
  async executeRotation(): Promise<void> {
    if (!this.pendingCert || !this.pendingKey) {
      throw new Error('No pending certificates for rotation');
    }

    // Backup current certificates
    const backupCert = this.cert;
    const backupKey = this.key;

    try {
      // Apply new certificates
      this.cert = this.pendingCert;
      this.key = this.pendingKey;

      // Clear pending state
      this.pendingCert = null;
      this.pendingKey = null;
      this.rotationScheduled = null;

      console.log('Certificate rotation completed successfully');
    } catch (error) {
      // Rollback on error
      this.cert = backupCert;
      this.key = backupKey;
      throw new Error(`Certificate rotation failed: ${error}`);
    }
  }

  /**
   * Cancel pending rotation
   */
  cancelRotation(): void {
    this.pendingCert = null;
    this.pendingKey = null;
    this.rotationScheduled = null;
  }

  /**
   * Check if a certificate is revoked
   */
  private isCertificateRevoked(cert: tls.PeerCertificate): boolean {
    if (!this.crl) {
      return false;
    }

    // Parse CRL and check if certificate serial is in revoked list
    // This is a simplified check - production should use proper CRL parsing
    const serialNumber = cert.serialNumber;
    return this.crl.includes(serialNumber);
  }

  /**
   * Extract service identity from certificate
   */
  private extractIdentityFromCert(cert: tls.PeerCertificate): ServiceIdentity {
    // Parse common name for service name
    const cn = cert.subject?.CN || 'unknown';

    // Parse OU for additional info
    const ou = cert.subject?.OU || '';

    return {
      serviceName: cn,
      instanceId: cert.serialNumber,
      version: 'unknown',
      environment: ou || process.env.NODE_ENV || 'development',
    };
  }

  /**
   * Parse certificate info from PEM string
   */
  private parseCertificateInfo(certPem: string): CertificateInfo {
    // Use crypto to parse certificate
    const cert = new crypto.X509Certificate(certPem);

    const validFrom = new Date(cert.validFrom);
    const validTo = new Date(cert.validTo);
    const now = new Date();

    const isValid = now >= validFrom && now <= validTo;
    const daysUntilExpiration = Math.floor(
      (validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      subject: cert.subject,
      issuer: cert.issuer,
      validFrom,
      validUntil: validTo,
      serialNumber: cert.serialNumber,
      fingerprint: cert.fingerprint256,
      isValid,
      daysUntilExpiration,
    };
  }
}

/**
 * Create mTLS manager with default configuration
 */
export function createMTLSManager(
  caCertPath: string,
  certPath: string,
  keyPath: string
): MTLSManager {
  return new MTLSManager({
    caCertPath,
    certPath,
    keyPath,
    verifyPeer: true,
    minVersion: 'TLSv1.3',
  });
}

/**
 * Default cipher suites for TLS 1.3
 */
export const TLS_13_CIPHER_SUITES = [
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'TLS_AES_128_GCM_SHA256',
];

/**
 * Recommended cipher suites for TLS 1.2 (fallback)
 */
export const TLS_12_CIPHER_SUITES = [
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
];
