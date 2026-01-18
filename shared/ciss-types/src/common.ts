/**
 * Common Types
 *
 * Shared types used across all CISS services.
 */

/**
 * Base pagination input
 */
export interface PaginationInput {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

/**
 * Page info for connection pagination
 */
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

/**
 * Generic connection edge
 */
export interface Edge<T> {
  node: T;
  cursor: string;
}

/**
 * Generic connection type
 */
export interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
  totalCount: number;
}

/**
 * Date/time types (these map to GraphQL scalars)
 */
export type DateTime = string;
export type DateOnly = string;

/**
 * UUID type alias
 */
export type UUID = string;

/**
 * Medical code types
 */
export interface MedicalCode {
  code: string;
  system: string;
  display?: string;
}

/**
 * Common audit fields
 */
export interface AuditFields {
  createdAt: DateTime;
  updatedAt: DateTime;
}

/**
 * Entity with patient reference
 */
export interface PatientEntity {
  patientId: UUID;
}

/**
 * Entity with optional encounter reference
 */
export interface EncounterEntity {
  encounterId?: UUID;
}

/**
 * Base entity with ID
 */
export interface BaseEntity {
  id: UUID;
}

/**
 * Helper to create a typed connection
 */
export function createConnection<T>(
  nodes: T[],
  totalCount: number,
  getCursor: (node: T) => string,
  hasNextPage: boolean = false,
  hasPreviousPage: boolean = false
): Connection<T> {
  const edges = nodes.map((node) => ({
    node,
    cursor: getCursor(node),
  }));

  return {
    edges,
    pageInfo: {
      hasNextPage,
      hasPreviousPage,
      startCursor: edges.length > 0 ? edges[0].cursor : undefined,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : undefined,
    },
    totalCount,
  };
}

/**
 * Helper to encode cursor (base64 of ID + offset)
 */
export function encodeCursor(id: string, offset: number): string {
  return Buffer.from(`${id}:${offset}`).toString('base64');
}

/**
 * Helper to decode cursor
 */
export function decodeCursor(cursor: string): { id: string; offset: number } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const [id, offsetStr] = decoded.split(':');
    const offset = parseInt(offsetStr, 10);
    if (id && !isNaN(offset)) {
      return { id, offset };
    }
    return null;
  } catch {
    return null;
  }
}
