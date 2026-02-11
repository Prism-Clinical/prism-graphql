/**
 * Service JWT Authentication
 *
 * JWT-based service-to-service authentication.
 */

import * as crypto from 'crypto';
import { ServiceTokenClaims, ServiceIdentity } from '../types';
import { ServiceJWTConfig, ServiceAuthResult, ServiceAuthErrorCode } from './types';

/**
 * Service JWT Manager
 *
 * Handles creation and validation of service-to-service JWT tokens.
 */
export class ServiceJWTManager {
  private config: ServiceJWTConfig;

  constructor(config: ServiceJWTConfig) {
    this.config = config;
  }

  /**
   * Create a service token for calling another service
   */
  createToken(targetService: string, permissions: string[], correlationId?: string): string {
    const now = Math.floor(Date.now() / 1000);
    const jti = crypto.randomUUID();

    const claims: ServiceTokenClaims = {
      iss: this.config.identity.serviceName,
      sub: this.config.identity.serviceName,
      aud: targetService,
      iat: now,
      exp: now + this.config.expirationSeconds,
      jti,
      permissions,
      correlationId,
    };

    return this.signToken(claims);
  }

  /**
   * Validate an incoming service token
   */
  validateToken(token: string, expectedAudience?: string): ServiceAuthResult {
    try {
      const claims = this.verifyAndDecodeToken(token);

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (claims.exp < now) {
        return {
          authenticated: false,
          error: 'Token has expired',
          errorCode: ServiceAuthErrorCode.TOKEN_EXPIRED,
        };
      }

      // Check audience if specified
      if (expectedAudience && claims.aud !== expectedAudience) {
        if (
          this.config.allowedAudiences &&
          !this.config.allowedAudiences.includes(claims.aud)
        ) {
          return {
            authenticated: false,
            error: `Invalid audience: expected ${expectedAudience}, got ${claims.aud}`,
            errorCode: ServiceAuthErrorCode.INVALID_AUDIENCE,
          };
        }
      }

      const identity: ServiceIdentity = {
        serviceName: claims.sub,
        instanceId: claims.jti,
        version: 'unknown',
        environment: process.env.NODE_ENV || 'development',
      };

      return {
        authenticated: true,
        identity,
        claims,
      };
    } catch (error) {
      return {
        authenticated: false,
        error: error instanceof Error ? error.message : 'Token validation failed',
        errorCode: ServiceAuthErrorCode.INVALID_TOKEN,
      };
    }
  }

  /**
   * Check if token has required permissions
   */
  hasPermission(claims: ServiceTokenClaims, requiredPermission: string): boolean {
    return claims.permissions.includes(requiredPermission) || claims.permissions.includes('*');
  }

  /**
   * Check if token has any of the required permissions
   */
  hasAnyPermission(claims: ServiceTokenClaims, requiredPermissions: string[]): boolean {
    return requiredPermissions.some((p) => this.hasPermission(claims, p));
  }

  /**
   * Check if token has all required permissions
   */
  hasAllPermissions(claims: ServiceTokenClaims, requiredPermissions: string[]): boolean {
    return requiredPermissions.every((p) => this.hasPermission(claims, p));
  }

  /**
   * Sign a token using configured algorithm
   */
  private signToken(claims: ServiceTokenClaims): string {
    const header = {
      alg: this.config.algorithm,
      typ: 'JWT',
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(claims));

    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const signature = this.sign(signatureInput);

    return `${signatureInput}.${signature}`;
  }

  /**
   * Verify and decode a token
   */
  private verifyAndDecodeToken(token: string): ServiceTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [encodedHeader, encodedPayload, signature] = parts;

    // Verify header
    const header = JSON.parse(this.base64UrlDecode(encodedHeader));
    if (header.alg !== this.config.algorithm) {
      throw new Error(`Invalid algorithm: expected ${this.config.algorithm}, got ${header.alg}`);
    }

    // Verify signature
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    if (!this.verifySignature(signatureInput, signature)) {
      throw new Error('Invalid signature');
    }

    // Decode payload
    const claims = JSON.parse(this.base64UrlDecode(encodedPayload)) as ServiceTokenClaims;

    return claims;
  }

  /**
   * Sign data using configured algorithm
   */
  private sign(data: string): string {
    switch (this.config.algorithm) {
      case 'HS256': {
        const hmac = crypto.createHmac('sha256', this.config.signingKey);
        hmac.update(data);
        return this.base64UrlEncode(hmac.digest());
      }
      case 'RS256': {
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(data);
        return this.base64UrlEncode(sign.sign(this.config.signingKey));
      }
      case 'ES256': {
        const sign = crypto.createSign('SHA256');
        sign.update(data);
        return this.base64UrlEncode(sign.sign(this.config.signingKey));
      }
      default:
        throw new Error(`Unsupported algorithm: ${this.config.algorithm}`);
    }
  }

  /**
   * Verify signature using configured algorithm
   */
  private verifySignature(data: string, signature: string): boolean {
    const key = this.config.verifyKey || this.config.signingKey;

    switch (this.config.algorithm) {
      case 'HS256': {
        const hmac = crypto.createHmac('sha256', key);
        hmac.update(data);
        const expected = this.base64UrlEncode(hmac.digest());
        return crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expected)
        );
      }
      case 'RS256': {
        const verify = crypto.createVerify('RSA-SHA256');
        verify.update(data);
        return verify.verify(key, this.base64UrlDecode(signature), 'base64');
      }
      case 'ES256': {
        const verify = crypto.createVerify('SHA256');
        verify.update(data);
        return verify.verify(key, this.base64UrlDecode(signature), 'base64');
      }
      default:
        return false;
    }
  }

  /**
   * Base64URL encode
   */
  private base64UrlEncode(data: string | Buffer): string {
    const base64 = Buffer.isBuffer(data)
      ? data.toString('base64')
      : Buffer.from(data).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Base64URL decode
   */
  private base64UrlDecode(data: string): string {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4;
    const padded = padding ? base64 + '='.repeat(4 - padding) : base64;
    return Buffer.from(padded, 'base64').toString('utf8');
  }
}

/**
 * Create a service JWT manager with default configuration
 */
export function createServiceJWTManager(config: Partial<ServiceJWTConfig> & {
  signingKey: string;
  identity: ServiceIdentity;
}): ServiceJWTManager {
  const fullConfig: ServiceJWTConfig = {
    algorithm: 'HS256',
    expirationSeconds: 300, // 5 minutes
    ...config,
  };

  return new ServiceJWTManager(fullConfig);
}

/**
 * Extract service token from request headers
 */
export function extractServiceToken(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers['authorization'] || headers['Authorization'];
  if (!authHeader) {
    return null;
  }

  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!headerValue.startsWith('Bearer ')) {
    return null;
  }

  return headerValue.slice(7);
}
