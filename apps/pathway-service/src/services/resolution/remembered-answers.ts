/**
 * Answers a pathway remembers for a patient across encounters.
 *
 * Josh, 2026-10-04: "prenatal vitamin needs to be a sticky answer for that
 * patient (effectively is pt on prenatal > yes)". A gate that asks for a
 * `patient.<attribute>` value may carry
 *
 *   "remember_answer": { "scope": "PREGNANCY", "values": [true] }
 *
 * When the provider's answer is one of `values` (any answer when `values` is
 * absent), it is stored for the patient. At the start of a later encounter it
 * is supplied as that attribute — unless the chart already carries a value,
 * which always wins — for as long as the scope holds:
 *
 *   - PREGNANCY: the answer was given during this pregnancy (on or after the
 *     LMP date derived from gestational age; with no gestational age, within
 *     the last 300 days).
 *   - PATIENT: until answered again.
 *
 * A remembered answer is a convenience, never a fact about the chart: the
 * encounter shows the attribute as supplied, and answering the question again
 * replaces it.
 */

import type { Db } from './session-store';
import { normalizeAttributeValues } from './patient-attributes';

export const REMEMBER_SCOPES = ['PREGNANCY', 'PATIENT'] as const;
export type RememberScope = (typeof REMEMBER_SCOPES)[number];

export interface RememberAnswer {
  scope: RememberScope;
  values?: Array<string | number | boolean>;
}

/** The authored `remember_answer`, or the reason it is malformed. */
export function parseRememberAnswer(raw: unknown): RememberAnswer | { problem: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { problem: 'remember_answer must be an object { scope, values? }' };
  }
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (k !== 'scope' && k !== 'values') return { problem: `remember_answer has an unknown key "${k}"` };
  }
  if (typeof r.scope !== 'string' || !(REMEMBER_SCOPES as readonly string[]).includes(r.scope)) {
    return { problem: `remember_answer.scope must be one of ${REMEMBER_SCOPES.join(' | ')}` };
  }
  if (r.values !== undefined) {
    if (!Array.isArray(r.values) || r.values.length === 0
      || r.values.some((v) => !['string', 'number', 'boolean'].includes(typeof v))) {
      return { problem: 'remember_answer.values must be a non-empty list of strings, numbers or booleans' };
    }
  }
  return { scope: r.scope as RememberScope, ...(r.values ? { values: r.values as RememberAnswer['values'] } : {}) };
}

/** Whether this answer is one the gate asks to remember. */
export function shouldRemember(rule: RememberAnswer, value: unknown): boolean {
  return rule.values === undefined || rule.values.some((v) => v === value);
}

export async function rememberAnswer(db: Db, args: {
  patientId: string;
  attribute: string;
  value: string | number | boolean;
  scope: RememberScope;
  /** The session's evaluation clock — never the wall clock, so a replay records the same day. */
  answeredAsOf: string;
  answeredBy?: string;
  pathwayId?: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO patient_remembered_answers (patient_id, attribute, value, scope, answered_on, answered_by, source_pathway_id)
     VALUES ($1, $2, $3::jsonb, $4, $5::date, $6, $7)
     ON CONFLICT (patient_id, attribute) DO UPDATE
       SET value = EXCLUDED.value, scope = EXCLUDED.scope, answered_on = EXCLUDED.answered_on,
           answered_by = EXCLUDED.answered_by, source_pathway_id = EXCLUDED.source_pathway_id, updated_at = NOW()`,
    [args.patientId, args.attribute, JSON.stringify(args.value), args.scope, args.answeredAsOf.slice(0, 10),
      args.answeredBy ?? null, args.pathwayId ?? null],
  );
}

/** A provider answered the other way: what was remembered no longer holds. */
export async function forgetAnswer(db: Db, patientId: string, attribute: string): Promise<void> {
  await db.query('DELETE FROM patient_remembered_answers WHERE patient_id = $1 AND attribute = $2', [patientId, attribute]);
}

const DAY_MS = 86_400_000;

/** Whether an answer given on `answeredOn` still holds at `asOf` for its scope. */
export function stillHolds(scope: string, answeredOn: string, asOf: string, gestationalAgeWeeks: unknown): boolean {
  if (scope === 'PATIENT') return true;
  if (scope !== 'PREGNANCY') return false;
  const asOfMs = Date.parse(asOf);
  const answeredMs = Date.parse(`${answeredOn.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(answeredMs) || answeredMs > asOfMs) return false;
  const ga = typeof gestationalAgeWeeks === 'number' && Number.isFinite(gestationalAgeWeeks) && gestationalAgeWeeks > 0
    ? gestationalAgeWeeks : null;
  const startMs = ga !== null ? asOfMs - ga * 7 * DAY_MS : asOfMs - 300 * DAY_MS;
  // The whole LMP day counts, as it does for horizon PREGNANCY.
  return answeredMs >= Math.floor(startMs / DAY_MS) * DAY_MS;
}

/**
 * The patient attributes to supply at the start of an encounter: every
 * remembered answer that still holds and that the chart does not already give.
 */
export async function loadRememberedAttributes(db: Db, args: {
  patientId: string;
  asOf: string;
  suppliedAttributes: Record<string, unknown> | undefined;
}): Promise<Record<string, string | number | boolean>> {
  const result = await db.query(
    `SELECT attribute, value, scope, to_char(answered_on, 'YYYY-MM-DD') AS answered_on
       FROM patient_remembered_answers WHERE patient_id = $1`,
    [args.patientId],
  );
  const supplied = args.suppliedAttributes ?? {};
  const out: Record<string, string | number | boolean> = {};
  for (const row of result.rows) {
    const attribute = String(row.attribute);
    if (supplied[attribute] !== undefined && supplied[attribute] !== null) continue;
    if (!stillHolds(String(row.scope), String(row.answered_on), args.asOf, supplied.gestational_age_weeks)) continue;
    out[attribute] = row.value as string | number | boolean;
  }
  // A remembered answer is read in the vocabulary gates compare against — an
  // Rh type stored as "Rh+" before normalisation existed is "positive" now.
  return normalizeAttributeValues(out);
}
