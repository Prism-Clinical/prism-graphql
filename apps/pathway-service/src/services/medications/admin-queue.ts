/**
 * Admin queue for unnormalized medications.
 *
 * Drug names that failed RxNav normalization land as NULL ingredient_rxcui
 * rows in medication_normalization_cache. This module surfaces those for
 * clinician triage and supports manual resolution (clinician supplies the
 * correct RxCUI; system fetches ATC classes and rewrites the cache).
 */

import { Pool } from 'pg';
import { getAtcClasses, getIngredientRxcui } from './rxnav-client';

export interface UnnormalizedMedication {
  inputText: string;
  inputSystem: string | null;
  inputCode: string | null;
  attemptedAt: Date;
}

export interface ManuallyResolvedMedication {
  inputText: string;
  inputSystem: string | null;
  inputCode: string | null;
  ingredientRxcui: string;
  ingredientName: string;
  atcClasses: string[];
}

/** List every cache row whose normalization failed (ingredient_rxcui IS NULL). */
export async function listUnnormalizedMedications(
  pool: Pool,
): Promise<UnnormalizedMedication[]> {
  const r = await pool.query(
    `SELECT input_text, input_system, input_code, normalized_at
       FROM medication_normalization_cache
       WHERE ingredient_rxcui IS NULL
       ORDER BY normalized_at DESC`,
  );
  return r.rows.map((row) => ({
    inputText: row.input_text,
    inputSystem: row.input_system === '' ? null : row.input_system,
    inputCode: row.input_code === '' ? null : row.input_code,
    attemptedAt: row.normalized_at,
  }));
}

/**
 * Clinician-supplied resolution: given a free-text or coded input that
 * couldn't be normalized, accept an authoritative RxCUI from the clinician
 * and rewrite the cache entry. ATC classes are fetched from RxNav
 * automatically.
 *
 * Throws on RxNav failure — a manual resolution should not silently produce
 * an entry without ATC classes (clinician needs to know if RxNav can't
 * confirm the supplied RxCUI).
 */
export async function manuallyResolveMedicationNormalization(
  pool: Pool,
  args: {
    inputText: string;
    inputSystem?: string;
    inputCode?: string;
    rxcui: string;
  },
): Promise<ManuallyResolvedMedication> {
  // Verify the RxCUI walks to an ingredient (catches bad clinician input).
  const ingredient = await getIngredientRxcui(args.rxcui);
  if (!ingredient) {
    throw new Error(
      `RxCUI "${args.rxcui}" did not resolve to an ingredient. Verify the RxCUI is correct.`,
    );
  }
  const atcClasses = await getAtcClasses(ingredient.rxcui);

  const inputText = args.inputText.toLowerCase().trim();
  const inputSystem = args.inputSystem ?? '';
  const inputCode = args.inputCode ?? '';

  await pool.query(
    `INSERT INTO medication_normalization_cache
       (input_text, input_system, input_code, ingredient_rxcui, ingredient_name, atc_classes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (input_text, input_system, input_code) DO UPDATE SET
       ingredient_rxcui = EXCLUDED.ingredient_rxcui,
       ingredient_name  = EXCLUDED.ingredient_name,
       atc_classes      = EXCLUDED.atc_classes,
       normalized_at    = NOW()`,
    [inputText, inputSystem, inputCode, ingredient.rxcui, ingredient.name, atcClasses],
  );

  return {
    inputText,
    inputSystem: inputSystem === '' ? null : inputSystem,
    inputCode: inputCode === '' ? null : inputCode,
    ingredientRxcui: ingredient.rxcui,
    ingredientName: ingredient.name,
    atcClasses,
  };
}
