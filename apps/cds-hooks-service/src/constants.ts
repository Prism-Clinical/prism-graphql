/**
 * Centralized constants for CDS Hooks Service
 *
 * This file contains all configuration constants used across the service.
 * Externalizing these values makes them easier to maintain and adjust.
 */

/**
 * Response limits
 */
export const MAX_CARDS = 10;

/**
 * Timeout values (in milliseconds)
 */
export const FHIR_TIMEOUT_MS = 10000;
export const MAX_RESPONSE_TIME_MS = 2000;

/**
 * Rate limiting configuration
 */
export const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 100;
export const RATE_LIMIT_HEALTH_MAX_REQUESTS = 1000; // Higher limit for health endpoints

/**
 * Cache configuration
 */
export const CACHE_TTL_SECONDS = 300; // 5 minutes
export const CACHE_KEY_PREFIX = 'cds-hooks:';

/**
 * CDS Hooks indicator severity order (lower = more severe)
 */
export const INDICATOR_SEVERITY_ORDER = {
  critical: 0,
  warning: 1,
  info: 2,
} as const;

/**
 * Source labels
 */
export const SOURCE_LABELS = {
  PRISM_CDS: 'Prism CDS',
  PRISM_CARE_PLAN: 'Prism Care Plan',
  PRISM_ORDER_REVIEW: 'Prism Order Review',
  PRISM_MEDICATION_SAFETY: 'Prism Medication Safety',
} as const;

/**
 * Clinical guideline sources
 */
export const GUIDELINE_SOURCES = {
  ADA: {
    label: 'ADA Standards of Care',
    url: 'https://diabetesjournals.org/care',
  },
  JNC: {
    label: 'JNC Guidelines',
    url: 'https://www.heart.org',
  },
  ACC_AHA_HF: {
    label: 'ACC/AHA HF Guidelines',
    url: 'https://www.heart.org',
  },
  GOLD: {
    label: 'GOLD Guidelines',
    url: 'https://goldcopd.org',
  },
  KDIGO: {
    label: 'KDIGO Guidelines',
    url: 'https://kdigo.org',
  },
  GINA: {
    label: 'GINA Guidelines',
    url: 'https://ginasthma.org',
  },
  USPSTF: {
    label: 'USPSTF',
    url: 'https://www.uspreventiveservicestaskforce.org',
  },
} as const;
