/**
 * Redis Cache Layer for Epic FHIR Data
 *
 * Short-TTL cache for transformed FHIR data.
 * Cache failures are non-fatal (logged and ignored).
 */

import { Redis } from "ioredis";
import { createLogger } from "../clients/logger";

const logger = createLogger("epic-cache");

let redis: Redis | null = null;

export function initializeCache(redisClient: Redis): void {
  redis = redisClient;
}

function ensureCacheInitialized(): Redis {
  if (!redis) {
    throw new Error("Cache not initialized. Call initializeCache() first.");
  }
  return redis;
}

// TTL constants (seconds)
export const CACHE_TTL = {
  PATIENT: 600, // 10 minutes
  VITALS: 300, // 5 minutes
  LABS: 300, // 5 minutes
  MEDICATIONS: 600, // 10 minutes
  CONDITIONS: 600, // 10 minutes
  MEDICATION_REF: 3600, // 1 hour (reference data is stable)
} as const;

export type CacheResource =
  | "patient"
  | "vitals"
  | "labs"
  | "medications"
  | "conditions";

function cacheKey(resource: CacheResource, epicPatientId: string): string {
  return `epic:${resource}:${epicPatientId}`;
}

function medicationRefKey(reference: string): string {
  return `epic:medication-ref:${reference}`;
}

export async function getCached<T>(
  resource: CacheResource,
  epicPatientId: string
): Promise<T | null> {
  const r = ensureCacheInitialized();
  const key = cacheKey(resource, epicPatientId);
  try {
    const cached = await r.get(key);
    if (cached) {
      logger.debug("Cache hit", { resource, epicPatientId });
      return JSON.parse(cached) as T;
    }
    logger.debug("Cache miss", { resource, epicPatientId });
    return null;
  } catch (error) {
    logger.warn("Cache read error", {
      resource,
      epicPatientId,
      error: (error as Error).message,
    });
    return null;
  }
}

export async function setCached<T>(
  resource: CacheResource,
  epicPatientId: string,
  data: T
): Promise<void> {
  const r = ensureCacheInitialized();
  const key = cacheKey(resource, epicPatientId);
  const ttlMap: Record<CacheResource, number> = {
    patient: CACHE_TTL.PATIENT,
    vitals: CACHE_TTL.VITALS,
    labs: CACHE_TTL.LABS,
    medications: CACHE_TTL.MEDICATIONS,
    conditions: CACHE_TTL.CONDITIONS,
  };
  try {
    await r.setex(key, ttlMap[resource], JSON.stringify(data));
  } catch (error) {
    logger.warn("Cache write error", {
      resource,
      epicPatientId,
      error: (error as Error).message,
    });
  }
}

export async function invalidatePatientCache(
  epicPatientId: string
): Promise<void> {
  const r = ensureCacheInitialized();
  const resources: CacheResource[] = [
    "patient",
    "vitals",
    "labs",
    "medications",
    "conditions",
  ];
  const keys = resources.map((res) => cacheKey(res, epicPatientId));
  try {
    await r.del(...keys);
    logger.debug("Cache invalidated", { epicPatientId });
  } catch (error) {
    logger.warn("Cache invalidation error", {
      epicPatientId,
      error: (error as Error).message,
    });
  }
}

export async function getCachedMedicationRef<T>(
  reference: string
): Promise<T | null> {
  const r = ensureCacheInitialized();
  try {
    const cached = await r.get(medicationRefKey(reference));
    return cached ? (JSON.parse(cached) as T) : null;
  } catch {
    return null;
  }
}

export async function setCachedMedicationRef<T>(
  reference: string,
  data: T
): Promise<void> {
  const r = ensureCacheInitialized();
  try {
    await r.setex(
      medicationRefKey(reference),
      CACHE_TTL.MEDICATION_REF,
      JSON.stringify(data)
    );
  } catch {
    /* non-critical */
  }
}
