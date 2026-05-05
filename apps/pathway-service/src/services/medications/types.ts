/**
 * Shared types for the medication / DDI subsystem.
 */

export interface MedicationInput {
  /** Free-text drug name. Always required (used as cache key). */
  text: string;
  /** Coding system, if the input is coded. 'RxNorm' | 'NDC' | undefined for free-text. */
  system?: string;
  /** Code value. */
  code?: string;
}

export interface NormalizedMedication {
  ingredientRxcui: string;
  ingredientName: string;
  /** Full-precision ATC level-5 codes (e.g. 'C07AB02'). Class lookups slice prefixes. */
  atcClasses: string[];
}

export interface NormalizationCacheRow {
  inputText: string;
  inputSystem: string;
  inputCode: string;
  ingredientRxcui: string | null;
  ingredientName: string | null;
  atcClasses: string[];
  normalizedAt: Date;
}
