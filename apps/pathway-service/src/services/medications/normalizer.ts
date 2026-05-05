/**
 * Medication normalization pipeline.
 *
 * Two surfaces:
 *
 *   lookupNormalizedMedication(pool, input)
 *     Cache-only lookup. Returns the pre-warmed normalized medication or
 *     null if missing/unresolved. Fast — used at DDI-check time. Never
 *     calls RxNav.
 *
 *   prewarmMedication(pool, input)
 *     Cache-or-fetch. Resolves to ingredient-level RxCUI + ATC classes
 *     via RxNav, persists to cache, returns. Used at pathway-import and
 *     snapshot-ingestion time. Failures (RxNav has no exact match) are
 *     cached as a NULL row so we don't re-hammer.
 *
 * The split exists because hitting an external API at resolution time is
 * a reliability hazard — the normalization API is up most of the time, but
 * it's not our SLA. By splitting, the hot path becomes a single SELECT and
 * any RxNav outage degrades pre-warm (which is async, retryable, and not
 * patient-blocking) rather than the resolver itself.
 */

import { Pool } from 'pg';
import {
  findRxcuiByString,
  getAtcClasses,
  getIngredientRxcui,
  getRxcuiByNdc,
} from './rxnav-client';
import {
  MedicationInput,
  NormalizationCacheRow,
  NormalizedMedication,
} from './types';

// ─── Cache key canonicalization ───────────────────────────────────────

interface CacheKey {
  text: string;
  system: string;
  code: string;
}

function canonicalKey(input: MedicationInput): CacheKey {
  return {
    text: input.text.toLowerCase().trim(),
    system: input.system ?? '',
    code: input.code ?? '',
  };
}

// ─── Cache CRUD ───────────────────────────────────────────────────────

async function readCache(
  pool: Pool,
  key: CacheKey,
): Promise<NormalizationCacheRow | null> {
  const r = await pool.query(
    `SELECT input_text, input_system, input_code,
            ingredient_rxcui, ingredient_name, atc_classes, normalized_at
       FROM medication_normalization_cache
       WHERE input_text = $1 AND input_system = $2 AND input_code = $3`,
    [key.text, key.system, key.code],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    inputText: row.input_text,
    inputSystem: row.input_system,
    inputCode: row.input_code,
    ingredientRxcui: row.ingredient_rxcui,
    ingredientName: row.ingredient_name,
    atcClasses: row.atc_classes ?? [],
    normalizedAt: row.normalized_at,
  };
}

async function writeCache(
  pool: Pool,
  key: CacheKey,
  result: { rxcui: string; name: string; atcClasses: string[] } | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO medication_normalization_cache
       (input_text, input_system, input_code, ingredient_rxcui, ingredient_name, atc_classes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (input_text, input_system, input_code) DO UPDATE SET
       ingredient_rxcui = EXCLUDED.ingredient_rxcui,
       ingredient_name  = EXCLUDED.ingredient_name,
       atc_classes      = EXCLUDED.atc_classes,
       normalized_at    = NOW()`,
    [
      key.text,
      key.system,
      key.code,
      result?.rxcui ?? null,
      result?.name ?? null,
      result?.atcClasses ?? [],
    ],
  );
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Cache-only lookup. Returns null when the input has not been pre-warmed,
 * OR when pre-warm tried and failed (cached as NULL ingredient_rxcui — the
 * unnormalized admin queue surfaces these for clinician triage).
 */
export async function lookupNormalizedMedication(
  pool: Pool,
  input: MedicationInput,
): Promise<NormalizedMedication | null> {
  const key = canonicalKey(input);
  const row = await readCache(pool, key);
  if (!row || !row.ingredientRxcui) return null;
  return {
    ingredientRxcui: row.ingredientRxcui,
    ingredientName: row.ingredientName ?? row.inputText,
    atcClasses: row.atcClasses,
  };
}

/**
 * Cache-or-fetch. If cached, return as-is. If not cached, call RxNav,
 * persist, return.
 *
 * Two failure modes, distinct on disk:
 *   - "RxNav has no exact match" → persist NULL cache row + return null.
 *     Subsequent calls hit the cache; caller can surface via admin queue.
 *   - "RxNav HTTP / network error" → throw. Nothing is cached, so the
 *     next call retries from scratch. The bulk variant `prewarmMedications`
 *     catches these and counts as failed; individual callers handle as
 *     they see fit.
 */
export async function prewarmMedication(
  pool: Pool,
  input: MedicationInput,
): Promise<NormalizedMedication | null> {
  const key = canonicalKey(input);
  const cached = await readCache(pool, key);
  if (cached) {
    if (!cached.ingredientRxcui) return null;
    return {
      ingredientRxcui: cached.ingredientRxcui,
      ingredientName: cached.ingredientName ?? cached.inputText,
      atcClasses: cached.atcClasses,
    };
  }

  const result = await resolveViaRxNav(input);
  await writeCache(pool, key, result);
  return result
    ? { ingredientRxcui: result.rxcui, ingredientName: result.name, atcClasses: result.atcClasses }
    : null;
}

/**
 * Bulk pre-warm. Per-input failures don't kill the batch — each input either
 * lands as a normalized cache row or a NULL cache row. Returns counts so
 * callers can log batch outcomes.
 */
export async function prewarmMedications(
  pool: Pool,
  inputs: MedicationInput[],
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  for (const input of inputs) {
    try {
      const result = await prewarmMedication(pool, input);
      if (result) succeeded++;
      else failed++;
    } catch {
      // RxNav HTTP error or transient failure. Skip cache write so we retry
      // next time (different from "cache as NULL" which is permanent).
      failed++;
    }
  }
  return { succeeded, failed };
}

// ─── RxNav orchestration ──────────────────────────────────────────────

/**
 * Resolve one medication input via RxNav: starting RxCUI → ingredient RxCUI
 * → ATC classes. Each step can fail (no match, no ingredient, no ATC); a
 * missing ingredient means the whole resolution returns null.
 */
async function resolveViaRxNav(
  input: MedicationInput,
): Promise<{ rxcui: string; name: string; atcClasses: string[] } | null> {
  let startingRxcui: string | null = null;

  if (input.system === 'RxNorm' && input.code) {
    startingRxcui = input.code;
  } else if (input.system === 'NDC' && input.code) {
    startingRxcui = await getRxcuiByNdc(input.code);
  } else {
    startingRxcui = await findRxcuiByString(input.text);
  }

  if (!startingRxcui) return null;

  const ingredient = await getIngredientRxcui(startingRxcui);
  if (!ingredient) return null;

  const atcClasses = await getAtcClasses(ingredient.rxcui);
  return {
    rxcui: ingredient.rxcui,
    name: ingredient.name,
    atcClasses,
  };
}
