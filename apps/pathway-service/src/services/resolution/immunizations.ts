/**
 * A patient's immunization record: doses given before today, recorded by the
 * provider, kept in a form that can be sent elsewhere.
 *
 * Josh, 2026-10-05: "for vaccines, we need a way to mark as given previously
 * and to add a date. this needs to be stored in a way that can potentially be
 * transferred." His decisions the same day:
 *
 *   - Stored as an immunization record (CVX, RxNorm alongside, date, marked as
 *     REPORTED rather than given here, who recorded it and when) — the shape
 *     of a FHIR `Immunization`, table `patient_immunizations`.
 *   - The date is a day, a month and year, or unknown. A month counts toward a
 *     season or pregnancy window only when the whole month falls inside it —
 *     which storing the FIRST of the month gives for every "since" window.
 *     Unknown is an undated entry: the pathway's own question ("was it this
 *     season?") then asks.
 *   - A reported, dated dose counts exactly like one on the chart, and is
 *     shown as reported and listed among the sign-off assumptions.
 *
 * Pathways read vaccines off the medication list by RxNorm ingredient
 * (medication-classes.ts). A dose therefore reaches a run as a medication
 * entry coded AS that ingredient — no new gate grammar — and its `sourceId`
 * says it is an immunization, whether it was reported, and how precise its
 * date is, so the run can show and undo it without a second store.
 */

import type { Db } from './session-store';

export const DATE_PRECISIONS = ['DAY', 'MONTH', 'UNKNOWN'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/** What a pathway node or a client names when it says "this vaccine". */
export interface VaccineRef {
  /** CDC CVX code. For a reported dose of unknown product, the "unspecified formulation" code. */
  cvx: string;
  /** The ingredient RxCUI a `medications` gate matches (`system: "RXNORM_INGREDIENT"`). */
  rxnormIngredient: string;
  display: string;
}

/**
 * The vaccines a provider can pick from a list. CVX codes read from the CDC
 * CVX table on 2026-10-05 (the "unspecified" codes are the ones meant for
 * history of unknown product); ingredient RxCUIs are the ones the routine
 * prenatal pathway already matches.
 */
export const KNOWN_VACCINES: readonly VaccineRef[] = [
  { cvx: '88', rxnormIngredient: '1657128', display: 'Influenza vaccine' },
  { cvx: '213', rxnormIngredient: '2468231', display: 'COVID-19 vaccine' },
  { cvx: '115', rxnormIngredient: '798302', display: 'Tdap vaccine' },
  { cvx: '314', rxnormIngredient: '2636589', display: 'RSV vaccine' },
];

/** The authored `immunization` of a Medication or Gate node, or why it is malformed. */
export function parseVaccineRef(raw: unknown): VaccineRef | { problem: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { problem: 'immunization must be an object { cvx, rxnorm_ingredient, display }' };
  }
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (!['cvx', 'rxnorm_ingredient', 'rxnormIngredient', 'display'].includes(k)) {
      return { problem: `immunization has an unknown key "${k}"` };
    }
  }
  const cvx = r.cvx;
  const rx = r.rxnorm_ingredient ?? r.rxnormIngredient;
  if (typeof cvx !== 'string' || !/^\d{1,3}$/.test(cvx)) return { problem: 'immunization.cvx must be a CVX code (digits, as a string)' };
  if (typeof rx !== 'string' || !/^\d+$/.test(rx)) return { problem: 'immunization.rxnorm_ingredient must be an ingredient RxCUI (digits, as a string)' };
  if (typeof r.display !== 'string' || r.display.trim() === '') return { problem: 'immunization.display must name the vaccine in words' };
  return { cvx, rxnormIngredient: rx, display: r.display.trim() };
}

export interface ImmunizationDose extends VaccineRef {
  /** `YYYY-MM-DD` (the first of the month for MONTH); absent for UNKNOWN. */
  date?: string;
  precision: DatePrecision;
  /** Reported history (FHIR `primarySource: false`), as opposed to a dose the source itself gave. */
  reported: boolean;
}

export interface ImmunizationRecord extends ImmunizationDose {
  id: string;
  /** PRISM: recorded here, a row of `patient_immunizations`. CHART: delivered with the chart. */
  origin: 'PRISM' | 'CHART';
  recordedAt?: string;
  recordedBy?: string | null;
  status?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/**
 * A date as the provider gave it: `YYYY-MM-DD`, `YYYY-MM`, or nothing.
 * Throws with a sentence fit to show; never guesses a day.
 */
export function parseOccurrence(
  date: string | null | undefined,
  precision: string | null | undefined,
  asOf: string,
): { date?: string; precision: DatePrecision } {
  const text = (date ?? '').trim();
  if (precision === 'UNKNOWN' || (text === '' && !precision)) {
    if (text !== '') throw new Error('A dose with an unknown date takes no date.');
    return { precision: 'UNKNOWN' };
  }
  let day: string;
  let p: DatePrecision;
  if (DAY.test(text) && precision !== 'MONTH') {
    day = text;
    p = 'DAY';
  } else if (MONTH.test(text) || (DAY.test(text) && precision === 'MONTH')) {
    day = `${text.slice(0, 7)}-01`;
    p = 'MONTH';
  } else {
    throw new Error('Give the date as a day (YYYY-MM-DD), a month (YYYY-MM), or mark it unknown.');
  }
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) throw new Error(`"${text}" is not a date.`);
  if (day > asOf.slice(0, 10)) throw new Error('A dose already given cannot be dated after this visit.');
  return { date: day, precision: p };
}

// ─── As a medication entry ────────────────────────────────────────────

const SOURCE_PREFIX = 'immunization:';

/** The chart-medication entry a run reads for this dose. */
export function immunizationMedicationEntry(rec: Pick<ImmunizationRecord, 'id' | 'origin' | 'rxnormIngredient' | 'display' | 'cvx' | 'date' | 'precision' | 'reported'>): {
  code: string; system: string; display: string; date?: string; sourceId: string;
} {
  return {
    code: rec.rxnormIngredient,
    system: 'RXNORM',
    display: rec.display,
    ...(rec.date ? { date: rec.date } : {}),
    sourceId: `${SOURCE_PREFIX}${rec.origin}:${rec.reported ? 'reported' : 'given'}:${rec.precision}:${rec.cvx}:${rec.id}`,
  };
}

interface ContextMedication { code?: string; system?: string; display?: string; date?: string; sourceId?: string }

/** The immunization behind a medication entry of a stored context, or null for an ordinary medication. */
export function immunizationOfEntry(entry: ContextMedication | null | undefined): ImmunizationRecord | null {
  const sid = entry?.sourceId;
  if (typeof sid !== 'string' || !sid.startsWith(SOURCE_PREFIX) || typeof entry?.code !== 'string') return null;
  const [origin, how, precision, cvx, ...id] = sid.slice(SOURCE_PREFIX.length).split(':');
  if ((origin !== 'PRISM' && origin !== 'CHART') || !(DATE_PRECISIONS as readonly string[]).includes(precision)) return null;
  return {
    id: id.join(':'),
    origin,
    cvx,
    rxnormIngredient: entry.code,
    display: entry.display ?? entry.code,
    ...(typeof entry.date === 'string' ? { date: entry.date.slice(0, 10) } : {}),
    precision: precision as DatePrecision,
    reported: how === 'reported',
  };
}

export const isImmunizationEntry = (entry: ContextMedication | null | undefined): boolean => immunizationOfEntry(entry) !== null;

/** "on 2026-10-01", "in October 2025", "on a date not known". */
export function occurrencePhrase(rec: Pick<ImmunizationDose, 'date' | 'precision'>): string {
  if (!rec.date || rec.precision === 'UNKNOWN') return 'on a date not known';
  if (rec.precision === 'MONTH') {
    const d = new Date(`${rec.date}T00:00:00.000Z`);
    return `in ${d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
  }
  return `on ${rec.date}`;
}

// ─── For transfer ─────────────────────────────────────────────────────

/** The dose as a FHIR R4 `Immunization` resource. */
export function toFhirImmunization(rec: ImmunizationRecord, patientId: string): Record<string, unknown> {
  return {
    resourceType: 'Immunization',
    ...(rec.origin === 'PRISM' ? { id: rec.id } : {}),
    status: rec.status === 'entered-in-error' ? 'entered-in-error' : 'completed',
    vaccineCode: {
      coding: [
        { system: 'http://hl7.org/fhir/sid/cvx', code: rec.cvx, display: rec.display },
        { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: rec.rxnormIngredient },
      ],
      text: rec.display,
    },
    patient: { reference: `Patient/${patientId}` },
    ...(rec.date
      ? { occurrenceDateTime: rec.precision === 'MONTH' ? rec.date.slice(0, 7) : rec.date }
      : { occurrenceString: 'unknown' }),
    ...(rec.recordedAt ? { recorded: rec.recordedAt } : {}),
    primarySource: !rec.reported,
    ...(rec.reported
      ? {
          reportOrigin: {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/immunization-origin', code: 'provider', display: 'Other Provider' }],
          },
        }
      : {}),
  };
}

// ─── Storage ──────────────────────────────────────────────────────────

const COLUMNS = `id, vaccine_cvx, vaccine_display, rxnorm_ingredient, to_char(occurrence_date, 'YYYY-MM-DD') AS occurrence_date,
  occurrence_precision, status, primary_source, recorded_at, recorded_by`;

function fromRow(row: Record<string, unknown>): ImmunizationRecord {
  return {
    id: String(row.id),
    origin: 'PRISM',
    cvx: String(row.vaccine_cvx),
    rxnormIngredient: String(row.rxnorm_ingredient ?? ''),
    display: String(row.vaccine_display),
    ...(row.occurrence_date ? { date: String(row.occurrence_date) } : {}),
    precision: String(row.occurrence_precision) as DatePrecision,
    reported: row.primary_source !== true,
    recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at),
    recordedBy: (row.recorded_by as string | null) ?? null,
    status: String(row.status),
  };
}

/** The patient's doses on record here, oldest first. `entered-in-error` rows only when asked for. */
export async function loadImmunizations(db: Db, patientId: string, includeRetracted = false): Promise<ImmunizationRecord[]> {
  const result = await db.query(
    `SELECT ${COLUMNS} FROM patient_immunizations
      WHERE patient_id = $1 ${includeRetracted ? '' : `AND status = 'completed'`}
      ORDER BY recorded_at, id`,
    [patientId],
  );
  return result.rows.map(fromRow);
}

export async function insertImmunization(db: Db, args: {
  id: string;
  patientId: string;
  dose: ImmunizationDose;
  recordedBy?: string;
  sessionId?: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO patient_immunizations
       (id, patient_id, vaccine_cvx, vaccine_display, rxnorm_ingredient, occurrence_date, occurrence_precision,
        primary_source, report_origin, recorded_by, source_session_id)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, 'provider', $9, $10)`,
    [args.id, args.patientId, args.dose.cvx, args.dose.display, args.dose.rxnormIngredient, args.dose.date ?? null,
      args.dose.precision, !args.dose.reported, args.recordedBy ?? null, args.sessionId ?? null],
  );
}

/** A dose recorded by mistake. The row stays, marked; it is no longer read. */
export async function retractImmunization(db: Db, patientId: string, id: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE patient_immunizations SET status = 'entered-in-error', updated_at = NOW()
      WHERE id = $1 AND patient_id = $2 AND status = 'completed'`,
    [id, patientId],
  );
  return (result.rowCount ?? 0) > 0;
}
