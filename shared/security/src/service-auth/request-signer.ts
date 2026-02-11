/**
 * Request Signer
 *
 * Sign and verify request bodies to detect tampering.
 */

import * as crypto from 'crypto';
import { RequestSignature, SignedRequest } from './types';

/**
 * Request Signer Configuration
 */
export interface RequestSignerConfig {
  /** Private key for signing (PEM format) */
  privateKey: string;
  /** Public key for verification (PEM format) */
  publicKey: string;
  /** Service name */
  serviceName: string;
  /** Signature algorithm */
  algorithm: 'RSA-SHA256' | 'RSA-SHA384' | 'RSA-SHA512';
  /** Maximum age of signature in seconds */
  maxSignatureAge: number;
}

/**
 * Request Signer
 *
 * Signs outgoing requests and verifies incoming requests.
 */
export class RequestSigner {
  private config: RequestSignerConfig;

  constructor(config: RequestSignerConfig) {
    this.config = config;
  }

  /**
   * Sign a request body
   */
  sign<T>(body: T, requestId: string, correlationId: string): SignedRequest<T> {
    const timestamp = Date.now();
    const bodyString = JSON.stringify(body);
    const dataToSign = `${timestamp}.${requestId}.${bodyString}`;

    const sign = crypto.createSign(this.config.algorithm);
    sign.update(dataToSign);
    const signatureValue = sign.sign(this.config.privateKey, 'base64');

    const signature: RequestSignature = {
      signature: signatureValue,
      timestamp,
      algorithm: this.config.algorithm,
      signer: this.config.serviceName,
    };

    return {
      body,
      signature,
      requestId,
      correlationId,
    };
  }

  /**
   * Verify a signed request
   */
  verify<T>(signedRequest: SignedRequest<T>, publicKey?: string): {
    valid: boolean;
    error?: string;
  } {
    const { body, signature, requestId } = signedRequest;

    // Check signature age
    const age = Date.now() - signature.timestamp;
    if (age > this.config.maxSignatureAge * 1000) {
      return {
        valid: false,
        error: `Signature expired: age ${age}ms exceeds maximum ${this.config.maxSignatureAge * 1000}ms`,
      };
    }

    // Check for future timestamps (clock skew)
    if (signature.timestamp > Date.now() + 60000) {
      return {
        valid: false,
        error: 'Signature timestamp is in the future',
      };
    }

    // Verify signature
    try {
      const bodyString = JSON.stringify(body);
      const dataToVerify = `${signature.timestamp}.${requestId}.${bodyString}`;

      const verify = crypto.createVerify(signature.algorithm);
      verify.update(dataToVerify);

      const key = publicKey || this.config.publicKey;
      const isValid = verify.verify(key, signature.signature, 'base64');

      if (!isValid) {
        return {
          valid: false,
          error: 'Invalid signature',
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Signature verification failed',
      };
    }
  }

  /**
   * Create signature header value for HTTP requests
   */
  createSignatureHeader<T>(body: T, requestId: string): string {
    const timestamp = Date.now();
    const bodyString = JSON.stringify(body);
    const dataToSign = `${timestamp}.${requestId}.${bodyString}`;

    const sign = crypto.createSign(this.config.algorithm);
    sign.update(dataToSign);
    const signatureValue = sign.sign(this.config.privateKey, 'base64');

    // Format: algorithm;timestamp;signer;signature
    return `${this.config.algorithm};${timestamp};${this.config.serviceName};${signatureValue}`;
  }

  /**
   * Verify signature from header
   */
  verifySignatureHeader(
    header: string,
    body: unknown,
    requestId: string,
    trustedSigners: Map<string, string>
  ): { valid: boolean; signer?: string; error?: string } {
    const parts = header.split(';');
    if (parts.length !== 4) {
      return {
        valid: false,
        error: 'Invalid signature header format',
      };
    }

    const [algorithm, timestampStr, signer, signature] = parts;
    const timestamp = parseInt(timestampStr, 10);

    // Check signature age
    const age = Date.now() - timestamp;
    if (age > this.config.maxSignatureAge * 1000) {
      return {
        valid: false,
        error: `Signature expired: age ${age}ms`,
      };
    }

    // Get public key for signer
    const publicKey = trustedSigners.get(signer);
    if (!publicKey) {
      return {
        valid: false,
        error: `Unknown signer: ${signer}`,
      };
    }

    // Verify signature
    try {
      const bodyString = JSON.stringify(body);
      const dataToVerify = `${timestamp}.${requestId}.${bodyString}`;

      const verify = crypto.createVerify(algorithm);
      verify.update(dataToVerify);
      const isValid = verify.verify(publicKey, signature, 'base64');

      if (!isValid) {
        return {
          valid: false,
          error: 'Invalid signature',
        };
      }

      return { valid: true, signer };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }
}

/**
 * Create a request signer with default configuration
 */
export function createRequestSigner(
  privateKey: string,
  publicKey: string,
  serviceName: string
): RequestSigner {
  return new RequestSigner({
    privateKey,
    publicKey,
    serviceName,
    algorithm: 'RSA-SHA256',
    maxSignatureAge: 300, // 5 minutes
  });
}

/**
 * Generate a key pair for request signing
 */
export function generateSigningKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return { privateKey, publicKey };
}

/**
 * Request signature header name
 */
export const REQUEST_SIGNATURE_HEADER = 'X-Request-Signature';

/**
 * Request ID header name
 */
export const REQUEST_ID_HEADER = 'X-Request-ID';

/**
 * Correlation ID header name
 */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID';
