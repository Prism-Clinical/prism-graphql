/**
 * PRISM Authentication Module
 *
 * Shared authentication utilities for PRISM GraphQL services.
 *
 * @example
 * ```typescript
 * import {
 *   createContextFactory,
 *   hasRole,
 *   UserRole,
 *   AuthContext
 * } from '@prism/auth';
 *
 * // Create context factory for Apollo Server
 * const contextFactory = createContextFactory({
 *   secret: process.env.JWT_SECRET!,
 *   issuer: 'prism-auth',
 * });
 *
 * // Use in Apollo Server setup
 * const server = new ApolloServer({
 *   schema,
 *   context: contextFactory,
 * });
 *
 * // Check roles in resolvers
 * const resolvers = {
 *   Query: {
 *     sensitiveData: (_, args, context: AuthContext) => {
 *       if (!hasRole(context.user, UserRole.PHYSICIAN)) {
 *         throw new Error('Unauthorized');
 *       }
 *       return getSensitiveData();
 *     },
 *   },
 * };
 * ```
 */

// Export all types
export {
  UserRole,
  JWTPayload,
  AuthenticatedUser,
  AuthContext,
  JWTValidationOptions,
  JWTValidationResult,
} from './types';

// Export JWT utilities
export {
  validateToken,
  decodeToken,
  isTokenExpired,
  extractTokenFromHeader,
  createToken,
} from './jwt';

// Export context utilities
export {
  createUserFromPayload,
  createAnonymousContext,
  createAuthContextFromRequest,
  createAuthContextFromToken,
  hasRole,
  hasAnyRole,
  hasAllRoles,
  createContextFactory,
} from './context';
