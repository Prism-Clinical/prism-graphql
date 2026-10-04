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
  /**
   * What the medication IS, for pathway gates that match by ingredient or
   * class (migration 071). ABSENT on a row normalised before that migration:
   * such a row knows one ingredient only, and must read as "not classified
   * yet" — never as "contains nothing else".
   */
  classification?: MedicationClassification;
}

/** Every ingredient of a medication, and the ATC classes of the product itself. */
export interface MedicationClassification {
  /** Every ingredient (TTY=IN) RxCUI. A prenatal multivitamin has a dozen. */
  ingredientRxcuis: string[];
  ingredientNames: string[];
  /**
   * ATC level 1–4 classes of the PRODUCT (RxClass `ATCPROD`), e.g. `J07BB` for
   * any influenza vaccine, `B03AA` for an oral iron salt, `B03AE` for a
   * prenatal vitamin that contains iron. EMPTY means "RxNav has no product
   * class for this entry" — unknown, not "in no class".
   */
  productAtcClasses: string[];
}

export interface NormalizationCacheRow {
  inputText: string;
  inputSystem: string;
  inputCode: string;
  ingredientRxcui: string | null;
  ingredientName: string | null;
  atcClasses: string[];
  /** NULL on a row normalised before migration 071. */
  ingredientRxcuis: string[] | null;
  ingredientNames: string[] | null;
  productAtcClasses: string[] | null;
  normalizedAt: Date;
}
