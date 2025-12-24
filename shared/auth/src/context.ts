/**
 * GraphQL Context Utilities
 *
 * Functions for creating authenticated GraphQL context.
 */

import { IncomingMessage } from 'http';
import {
  AuthContext,
  AuthenticatedUser,
  JWTPayload,
  JWTValidationOptions,
  UserRole,
} from './types';
import { extractTokenFromHeader, validateToken } from './jwt';

/**
 * Creates an authenticated user from a JWT payload
 *
 * @param payload - The decoded JWT payload
 * @returns The authenticated user object
 */
export function createUserFromPayload(payload: JWTPayload): AuthenticatedUser {
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    roles: payload.roles || [],
    institutionId: payload.institutionId,
    providerId: payload.providerId,
    isAuthenticated: true,
  };
}

/**
 * Creates an unauthenticated/anonymous user context
 *
 * @returns An anonymous auth context
 */
export function createAnonymousContext(): AuthContext {
  return {
    user: null,
    token: null,
    isAuthenticated: false,
  };
}

/**
 * Creates auth context from an HTTP request
 *
 * @param req - The incoming HTTP request
 * @param options - JWT validation options
 * @returns The auth context
 */
export function createAuthContextFromRequest(
  req: IncomingMessage,
  options: JWTValidationOptions
): AuthContext {
  const authHeader = req.headers.authorization;
  const token = extractTokenFromHeader(authHeader);

  if (!token) {
    return createAnonymousContext();
  }

  const result = validateToken(token, options);

  if (!result.isValid || !result.payload) {
    return createAnonymousContext();
  }

  return {
    user: createUserFromPayload(result.payload),
    token,
    isAuthenticated: true,
  };
}

/**
 * Creates auth context from a token string
 *
 * @param token - The JWT token
 * @param options - JWT validation options
 * @returns The auth context
 */
export function createAuthContextFromToken(
  token: string | null | undefined,
  options: JWTValidationOptions
): AuthContext {
  if (!token) {
    return createAnonymousContext();
  }

  const result = validateToken(token, options);

  if (!result.isValid || !result.payload) {
    return createAnonymousContext();
  }

  return {
    user: createUserFromPayload(result.payload),
    token,
    isAuthenticated: true,
  };
}

/**
 * Checks if a user has a specific role
 *
 * @param user - The authenticated user
 * @param role - The role to check
 * @returns True if the user has the role
 */
export function hasRole(user: AuthenticatedUser | null, role: UserRole): boolean {
  if (!user || !user.isAuthenticated) {
    return false;
  }
  return user.roles.includes(role);
}

/**
 * Checks if a user has any of the specified roles
 *
 * @param user - The authenticated user
 * @param roles - The roles to check
 * @returns True if the user has any of the roles
 */
export function hasAnyRole(
  user: AuthenticatedUser | null,
  roles: UserRole[]
): boolean {
  if (!user || !user.isAuthenticated) {
    return false;
  }
  return roles.some((role) => user.roles.includes(role));
}

/**
 * Checks if a user has all of the specified roles
 *
 * @param user - The authenticated user
 * @param roles - The roles to check
 * @returns True if the user has all of the roles
 */
export function hasAllRoles(
  user: AuthenticatedUser | null,
  roles: UserRole[]
): boolean {
  if (!user || !user.isAuthenticated) {
    return false;
  }
  return roles.every((role) => user.roles.includes(role));
}

/**
 * Creates a context factory function for Apollo Server
 *
 * @param options - JWT validation options
 * @returns A context factory function
 */
export function createContextFactory(options: JWTValidationOptions) {
  return async ({ req }: { req: IncomingMessage }): Promise<AuthContext> => {
    return createAuthContextFromRequest(req, options);
  };
}
