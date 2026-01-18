/**
 * Authentication Types
 *
 * Shared type definitions for authentication across PRISM services.
 */

/**
 * User roles in the PRISM system
 */
export enum UserRole {
  ADMIN = 'ADMIN',
  PHYSICIAN = 'PHYSICIAN',
  NURSE = 'NURSE',
  PHARMACIST = 'PHARMACIST',
  CARE_COORDINATOR = 'CARE_COORDINATOR',
  PATIENT = 'PATIENT',
  SYSTEM = 'SYSTEM',
}

/**
 * Decoded JWT payload structure
 */
export interface JWTPayload {
  /** User ID */
  sub: string;
  /** User's email address */
  email?: string;
  /** User's full name */
  name?: string;
  /** User's roles */
  roles: UserRole[];
  /** Institution ID */
  institutionId?: string;
  /** Provider ID (if user is a provider) */
  providerId?: string;
  /** Token issued at timestamp */
  iat: number;
  /** Token expiration timestamp */
  exp: number;
  /** Token issuer */
  iss?: string;
  /** Token audience */
  aud?: string | string[];
}

/**
 * Authenticated user context
 */
export interface AuthenticatedUser {
  /** User ID */
  id: string;
  /** User's email address */
  email?: string;
  /** User's full name */
  name?: string;
  /** User's roles */
  roles: UserRole[];
  /** Institution ID */
  institutionId?: string;
  /** Provider ID (if user is a provider) */
  providerId?: string;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
}

/**
 * Authentication context for GraphQL resolvers
 */
export interface AuthContext {
  /** The authenticated user, or null if not authenticated */
  user: AuthenticatedUser | null;
  /** The raw JWT token */
  token: string | null;
  /** Whether the request is authenticated */
  isAuthenticated: boolean;
}

/**
 * JWT validation options
 */
export interface JWTValidationOptions {
  /** JWT secret or public key */
  secret: string;
  /** Expected issuer */
  issuer?: string;
  /** Expected audience */
  audience?: string | string[];
  /** Algorithms to allow */
  algorithms?: string[];
  /** Whether to ignore expiration (for testing only) */
  ignoreExpiration?: boolean;
}

/**
 * Result of JWT validation
 */
export interface JWTValidationResult {
  /** Whether the token is valid */
  isValid: boolean;
  /** The decoded payload if valid */
  payload?: JWTPayload;
  /** Error message if invalid */
  error?: string;
}
