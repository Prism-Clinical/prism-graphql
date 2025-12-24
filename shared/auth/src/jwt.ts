/**
 * JWT Validation Utilities
 *
 * Functions for validating and decoding JWT tokens.
 */

import * as jwt from 'jsonwebtoken';
import {
  JWTPayload,
  JWTValidationOptions,
  JWTValidationResult,
  UserRole,
} from './types';

// Default validation options
const DEFAULT_OPTIONS: Partial<JWTValidationOptions> = {
  algorithms: ['HS256', 'RS256'],
  ignoreExpiration: false,
};

/**
 * Validates a JWT token and returns the decoded payload
 *
 * @param token - The JWT token to validate
 * @param options - Validation options
 * @returns Validation result with payload or error
 */
export function validateToken(
  token: string,
  options: JWTValidationOptions
): JWTValidationResult {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  try {
    const decoded = jwt.verify(token, mergedOptions.secret, {
      algorithms: mergedOptions.algorithms as jwt.Algorithm[],
      issuer: mergedOptions.issuer,
      audience: mergedOptions.audience,
      ignoreExpiration: mergedOptions.ignoreExpiration,
    }) as JWTPayload;

    // Ensure roles is an array
    if (!decoded.roles) {
      decoded.roles = [];
    } else if (!Array.isArray(decoded.roles)) {
      decoded.roles = [decoded.roles as unknown as UserRole];
    }

    return {
      isValid: true,
      payload: decoded,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    return {
      isValid: false,
      error: errorMessage,
    };
  }
}

/**
 * Decodes a JWT token without validation (for debugging/logging)
 *
 * @param token - The JWT token to decode
 * @returns The decoded payload or null if invalid format
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.decode(token) as JWTPayload | null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Checks if a token is expired
 *
 * @param token - The JWT token to check
 * @returns True if the token is expired, false otherwise
 */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return decoded.exp < now;
}

/**
 * Extracts the token from an Authorization header
 *
 * @param authHeader - The Authorization header value
 * @returns The extracted token or null if not found
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  // Support "Bearer <token>" format
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Support raw token (for backwards compatibility)
  if (authHeader.includes('.') && authHeader.split('.').length === 3) {
    return authHeader;
  }

  return null;
}

/**
 * Creates a JWT token (for testing purposes)
 *
 * @param payload - The payload to encode
 * @param secret - The secret to sign with
 * @param expiresIn - Token expiration time (default: 1h)
 * @returns The signed JWT token
 */
export function createToken(
  payload: Partial<JWTPayload>,
  secret: string,
  expiresIn: string = '1h'
): string {
  const defaultPayload: Partial<JWTPayload> = {
    roles: [],
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(
    { ...defaultPayload, ...payload },
    secret,
    { expiresIn }
  );
}
