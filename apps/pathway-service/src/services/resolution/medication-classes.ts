/**
 * Matching a chart medication by what it IS, not by product code.
 *
 * Josh, 2026-10-04: "Match the vaccine, not the brand" — any influenza vaccine
 * product counts as an influenza vaccine, whatever the brand or season, with
 * no yearly code-list edits.
 *
 * A `medications` condition may name a CLASS in `system`:
 *
 *   { "field": "medications", "operator": "count_in_window", "value": "1657128",
 *     "system": "RXNORM_INGREDIENT", "display": "an influenza vaccine", … }
 *
 *   - `RXNORM_INGREDIENT` — `value` is an ingredient RxCUI; a chart medication
 *     matches when its normalisation contains that ingredient.
 *   - `ATC` — `value` is an ATC code of level 1–4; a chart medication matches
 *     when one of its PRODUCT-level classes starts with it.
 *
 * Dates and clinical status are the chart entry's; only the identity comes
 * from normalisation. The identity is three-valued, and the third value is the
 * point: a medication that could not be identified is UNKNOWN — never "not in
 * the class" — and a gate whose answer depends on it asks the provider about
 * that entry by name.
 *
 * This module is the vocabulary, the grammar check and the membership test.
 * It does no I/O: identities arrive through a lookup the evaluation is given.
 */

import type { MedicationInput } from '../medications/types';

export const MEDICATION_CLASS_SYSTEMS = ['RXNORM_INGREDIENT', 'ATC'] as const;
export type MedicationClassSystem = (typeof MEDICATION_CLASS_SYSTEMS)[number];

/** The operators a class condition may use: the ones that ask "is one on the list" or "how many". */
export const MEDICATION_CLASS_OPERATORS = ['includes_code', 'not_includes_code', 'count_in_window'] as const;

/** What a chart medication was identified as. */
export interface MedicationIdentity {
  ingredientRxcuis: string[];
  ingredientNames: string[];
  /** ATC level 1–4 classes of the product. EMPTY = no product class known. */
  productAtcClasses: string[];
}

/** `null` = the medication could not be identified. */
export type MedicationIdentityLookup = (input: MedicationInput) => MedicationIdentity | null;

export function isMedicationClassSystem(system: unknown): system is MedicationClassSystem {
  return typeof system === 'string' && (MEDICATION_CLASS_SYSTEMS as readonly string[]).includes(system);
}

/** Is this a coded condition that matches by ingredient or class? Takes `unknown`: read off untyped JSON too. */
export function isMedicationClassCondition(condition: unknown): boolean {
  if (!condition || typeof condition !== 'object') return false;
  const c = condition as Record<string, unknown>;
  return typeof c.field === 'string' && isMedicationClassSystem(c.system);
}

/** ATC levels 1–4: `J`, `J07`, `J07B`, `J07BB`. Level 5 (`J07BB02`) is not available from RxClass. */
const ATC_LEVELS_1_TO_4 = /^[A-Z](\d{2}([A-Z]{1,2})?)?$/;

/**
 * Why a class condition cannot be evaluated as written, or `null`.
 *
 * One predicate for the import validator (which pushes the message) and the
 * condition adapter (which throws it) — so import, session preflight and
 * evaluation refuse exactly the same conditions.
 */
export function medicationClassConditionError(condition: unknown): string | null {
  if (!isMedicationClassCondition(condition)) return null;
  const c = condition as Record<string, unknown>;
  const system = c.system as MedicationClassSystem;
  if (c.field !== 'medications') {
    return (
      `system "${system}" matches a MEDICATION by ingredient or class and is valid only on ` +
      `field "medications" (got field ${JSON.stringify(c.field)})`
    );
  }
  if (!(MEDICATION_CLASS_OPERATORS as readonly string[]).includes(String(c.operator))) {
    return (
      `system "${system}" works with ${MEDICATION_CLASS_OPERATORS.join(' / ')} only ` +
      `(got operator ${JSON.stringify(c.operator)})`
    );
  }
  if (typeof c.value !== 'string') return `system "${system}" needs a string "value"`;
  if (system === 'RXNORM_INGREDIENT' && !/^\d+$/.test(c.value)) {
    return `an RXNORM_INGREDIENT value is an ingredient RxCUI — digits only (got ${JSON.stringify(c.value)})`;
  }
  if (system === 'ATC' && !ATC_LEVELS_1_TO_4.test(c.value)) {
    return (
      `an ATC value is a class of level 1–4, e.g. "J07BB" or "B03A" (got ${JSON.stringify(c.value)}) — ` +
      `level-5 codes such as "J07BB02" are not available for products and would never match`
    );
  }
  // The class in words is what the provider is asked about when a medication
  // on the list cannot be identified: "Does it count as an influenza vaccine?"
  if (typeof c.display !== 'string' || c.display.trim() === '') {
    return (
      `a condition matching by ${system} needs a "display" naming the class in words ` +
      `(e.g. "an influenza vaccine") — it is the question asked about a medication that cannot be identified`
    );
  }
  if (c.window_from !== undefined) return `window_from cannot be combined with system "${system}"`;
  return null;
}

/** How a chart entry is keyed for normalisation — the SAME key the safety checks and the cache use. */
export function medicationEntryInput(entry: { code: string; system: string; display?: string }): MedicationInput {
  return { text: entry.display ?? entry.code, system: entry.system, code: entry.code };
}

export type ClassMembership = 'MEMBER' | 'NOT' | 'UNKNOWN';

/**
 * Is this chart medication in the class?
 *
 *  - No identity → UNKNOWN. (Except the trivial case: the entry is coded AS the
 *    ingredient asked for.)
 *  - `ATC` with no product class on record → UNKNOWN too: RxNav classifies
 *    most products but not all (Nuvaxovid has no ATC class at all), and "no
 *    class recorded" must not read as "in no class".
 */
export function classMembership(
  identity: MedicationIdentity | null,
  entry: { code: string; system: string },
  system: MedicationClassSystem,
  value: string,
): ClassMembership {
  if (system === 'RXNORM_INGREDIENT') {
    if (entry.system.toLowerCase() === 'rxnorm' && entry.code === value) return 'MEMBER';
    if (!identity) return 'UNKNOWN';
    return identity.ingredientRxcuis.includes(value) ? 'MEMBER' : 'NOT';
  }
  if (!identity || identity.productAtcClasses.length === 0) return 'UNKNOWN';
  return identity.productAtcClasses.some((c) => c.startsWith(value)) ? 'MEMBER' : 'NOT';
}

/** Where a provider's "is this entry in the class" answer lives in a session's gate answers. */
export const MEDICATION_CLASS_KEY_PREFIX = 'medclass:';

/**
 * The identity of ONE question: this class, about this chart entry. Every gate
 * on the same class shares it, so the provider is asked once per entry.
 */
export function medicationClassKey(system: string, value: string, entryKey: string): string {
  return `${MEDICATION_CLASS_KEY_PREFIX}${system}:${value}:${entryKey}`;
}

/** The class in words: the authored `display`, else the system and value. */
export function medicationClassLabel(condition: { system?: string; value: string; display?: string }): string {
  const display = typeof condition.display === 'string' ? condition.display.trim() : '';
  return display !== '' ? display : `${condition.system} ${condition.value}`;
}

/** A chart medication a class condition could not classify. */
export interface UnidentifiedMedication {
  /** `medicationClassKey` — the question's datum key and the answer's storage key. */
  key: string;
  /** The entry as the chart names it. */
  label: string;
}
