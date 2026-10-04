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
  getIngredients,
  getProductAtcClasses,
  getRxcuiByNdc,
  getTermType,
} from './rxnav-client';
import {
  MedicationClassification,
  MedicationInput,
  NormalizationCacheRow,
  NormalizedMedication,
} from './types';

/** What one RxNav resolution yields. `null` = RxNav has no match for the input. */
interface Resolved {
  rxcui: string;
  name: string;
  atcClasses: string[];
  ingredients: Array<{ rxcui: string; name: string }>;
  productRxcui: string;
  productTty: string | null;
  productAtcClasses: string[];
}

/**
 * A cached row as the service's `NormalizedMedication`, or null for an
 * unmappable one. `classification` is set only when the row carries the
 * migration-071 columns.
 */
export function normalizedOf(row: {
  inputText: string;
  ingredientRxcui: string | null;
  ingredientName: string | null;
  atcClasses: string[];
  ingredientRxcuis: string[] | null;
  ingredientNames: string[] | null;
  productAtcClasses: string[] | null;
}): NormalizedMedication | null {
  if (!row.ingredientRxcui) return null;
  const classification: MedicationClassification | undefined = row.ingredientRxcuis
    ? {
        ingredientRxcuis: row.ingredientRxcuis,
        ingredientNames: row.ingredientNames ?? [],
        productAtcClasses: row.productAtcClasses ?? [],
      }
    : undefined;
  return {
    ingredientRxcui: row.ingredientRxcui,
    ingredientName: row.ingredientName ?? row.inputText,
    atcClasses: row.atcClasses,
    ...(classification ? { classification } : {}),
  };
}

/**
 * Does this cached row still need resolving? A row normalised before migration
 * 071 knows one ingredient and no product class: it is re-resolved the next
 * time the medication is pre-warmed. An unmappable row is final, as before —
 * RxNav already said it has no match, and asking again on every evaluation
 * would hammer it for every free-text name.
 */
export function isStaleRow(row: Pick<NormalizationCacheRow, 'ingredientRxcui' | 'ingredientRxcuis'>): boolean {
  return row.ingredientRxcui !== null && row.ingredientRxcuis === null;
}

// ─── Cache key canonicalization ───────────────────────────────────────

export interface CacheKey {
  text: string;
  system: string;
  code: string;
}

export function canonicalKey(input: MedicationInput): CacheKey {
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
            ingredient_rxcui, ingredient_name, atc_classes,
            ingredient_rxcuis, ingredient_names, product_atc_classes, normalized_at
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
    ingredientRxcuis: row.ingredient_rxcuis ?? null,
    ingredientNames: row.ingredient_names ?? null,
    productAtcClasses: row.product_atc_classes ?? null,
    normalizedAt: row.normalized_at,
  };
}

async function writeCache(
  pool: Pool,
  key: CacheKey,
  result: Resolved | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO medication_normalization_cache
       (input_text, input_system, input_code, ingredient_rxcui, ingredient_name, atc_classes,
        ingredient_rxcuis, ingredient_names, product_rxcui, product_tty, product_atc_classes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (input_text, input_system, input_code) DO UPDATE SET
       ingredient_rxcui    = EXCLUDED.ingredient_rxcui,
       ingredient_name     = EXCLUDED.ingredient_name,
       atc_classes         = EXCLUDED.atc_classes,
       ingredient_rxcuis   = EXCLUDED.ingredient_rxcuis,
       ingredient_names    = EXCLUDED.ingredient_names,
       product_rxcui       = EXCLUDED.product_rxcui,
       product_tty         = EXCLUDED.product_tty,
       product_atc_classes = EXCLUDED.product_atc_classes,
       normalized_at       = NOW()`,
    [
      key.text,
      key.system,
      key.code,
      result?.rxcui ?? null,
      result?.name ?? null,
      result?.atcClasses ?? [],
      result ? result.ingredients.map((i) => i.rxcui) : null,
      result ? result.ingredients.map((i) => i.name) : null,
      result?.productRxcui ?? null,
      result?.productTty ?? null,
      result ? result.productAtcClasses : null,
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
  return row ? normalizedOf(row) : null;
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
  // A row from before migration 071 is re-resolved once, to learn every
  // ingredient and the product classes; a network failure on the way leaves
  // the old row in place (nothing is written), so drug-safety data is never
  // lost to a refresh.
  if (cached && !isStaleRow(cached)) return normalizedOf(cached);

  const result = await resolveViaRxNav(input);
  // A stale row that RxNav cannot resolve from the INPUT was resolved some
  // other way — by a clinician, through the admin queue. Keep it: overwriting
  // it with "unmappable" would throw away their answer.
  if (!result && cached) return normalizedOf(cached);
  await writeCache(pool, key, result);
  return result
    ? normalizedOf({
        inputText: key.text,
        ingredientRxcui: result.rxcui,
        ingredientName: result.name,
        atcClasses: result.atcClasses,
        ingredientRxcuis: result.ingredients.map((i) => i.rxcui),
        ingredientNames: result.ingredients.map((i) => i.name),
        productAtcClasses: result.productAtcClasses,
      })
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
): Promise<Resolved | null> {
  let startingRxcui: string | null = null;

  // Compared case-insensitively: charts and pathways send 'RXNORM', and an
  // exact 'RxNorm' sent every coded medication down the free-text lookup,
  // where it failed and was cached as unmappable — invisible to safety checks.
  const system = input.system?.toLowerCase();
  if (system === 'rxnorm' && input.code) {
    startingRxcui = input.code;
  } else if (system === 'ndc' && input.code) {
    startingRxcui = await getRxcuiByNdc(input.code);
  } else {
    startingRxcui = await findRxcuiByString(input.text);
  }

  if (!startingRxcui) return null;

  // The FIRST ingredient and its classes are what the drug-safety checks are
  // keyed on, exactly as before; every ingredient and the product's own
  // classes are what a pathway gate matches on (migration 071).
  const ingredient = await getIngredientRxcui(startingRxcui);
  if (!ingredient) return null;

  const [atcClasses, allIngredients, productTty] = await Promise.all([
    getAtcClasses(ingredient.rxcui),
    getIngredients(startingRxcui),
    getTermType(startingRxcui),
  ]);
  // Never fewer than the one the safety checks use.
  const ingredients = allIngredients && allIngredients.length > 0 ? allIngredients : [ingredient];
  const productAtcClasses = (await getProductAtcClasses(startingRxcui, productTty ?? null)) ?? [];
  return {
    rxcui: ingredient.rxcui,
    name: ingredient.name,
    atcClasses,
    ingredients,
    productRxcui: startingRxcui,
    productTty: productTty ?? null,
    productAtcClasses,
  };
}

// ─── Before an evaluation ─────────────────────────────────────────────

/** How long an evaluation waits for RxNav before going ahead without it. */
export const CHART_NORMALIZATION_DEADLINE_MS = 4_000;

/**
 * Make the patient's CHART medications' normalisations available before an
 * evaluation reads the cache.
 *
 * A pathway gate may match a medication by ingredient or class, and that needs
 * the medication normalised WHEN THE GATE IS EVALUATED — the fire-and-forget
 * pre-warm leaves a medication first seen this request unnormalised until the
 * next one. So the medications the cache does not hold yet (or holds in the
 * pre-071 shape) are resolved here, awaited, before the evaluation's snapshot
 * is opened — never inside gate evaluation, which stays free of I/O.
 *
 * Bounded by ONE deadline for the whole batch: RxNav is not our SLA. When it
 * is slow or down the evaluation proceeds without the missing rows — the
 * medication is then UNIDENTIFIED to a class gate, which asks the provider
 * about it rather than guessing — and lookups already in flight finish in the
 * background and are cached for next time.
 *
 * Chart medications ONLY. A pathway's own free-text Medication nodes and
 * write-ins keep the non-blocking pre-warm: awaiting names RxNav has no exact
 * match for would add its latency to every evaluation and identify nothing.
 *
 * Never throws: normalisation is an enrichment, and its failure must not fail
 * an evaluation.
 */
export async function ensureChartMedicationsNormalized(
  pool: Pick<Pool, 'query'>,
  inputs: MedicationInput[],
  deadlineMs = CHART_NORMALIZATION_DEADLINE_MS,
): Promise<{ attempted: number; timedOut: boolean }> {
  try {
    const keys = [...new Map(inputs.map((m) => {
      const k = canonicalKey(m);
      return [`${k.text}|${k.system}|${k.code}`, { key: k, input: m }];
    })).values()];
    if (keys.length === 0) return { attempted: 0, timedOut: false };

    const r = await pool.query(
      `SELECT input_text, input_system, input_code, ingredient_rxcui, ingredient_rxcuis
         FROM medication_normalization_cache
        WHERE (input_text, input_system, input_code) IN (
          SELECT t, s, c FROM unnest($1::text[], $2::text[], $3::text[]) AS u(t, s, c))`,
      [keys.map((k) => k.key.text), keys.map((k) => k.key.system), keys.map((k) => k.key.code)],
    );
    const settled = new Set<string>();
    for (const row of r.rows) {
      if (isStaleRow({ ingredientRxcui: row.ingredient_rxcui ?? null, ingredientRxcuis: row.ingredient_rxcuis ?? null })) continue;
      settled.add(`${row.input_text}|${row.input_system}|${row.input_code}`);
    }
    const missing = keys.filter((k) => !settled.has(`${k.key.text}|${k.key.system}|${k.key.code}`)).map((k) => k.input);
    if (missing.length === 0) return { attempted: 0, timedOut: false };

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(() => resolve('deadline'), deadlineMs);
    });
    // Not cancelled at the deadline: the lookups finish and are cached.
    const work = prewarmMedications(pool as Pool, missing).then(() => 'done' as const);
    work.catch((): void => undefined);
    const outcome = await Promise.race([work, deadline]);
    if (timer) clearTimeout(timer);
    return { attempted: missing.length, timedOut: outcome === 'deadline' };
  } catch (err) {
    console.warn('[normalize] chart medications not normalised before evaluation:', err instanceof Error ? err.message : err);
    return { attempted: 0, timedOut: false };
  }
}
