import type { PatientContext } from '../confidence/types';
import type { MatchedPathway } from './types';

/**
 * Which matched pathways apply to THIS patient, beyond their diagnosis codes.
 *
 * [DECISION — Josh 2026-10-03] "Pregnant pathways should only apply to
 * pregnant women." An OBSTETRIC pathway whose trigger family is not itself a
 * pregnancy code — iron deficiency anemia (D50), bacteriuria (R82.71), an
 * elevated blood-pressure reading (R03.0) — matched any patient carrying that
 * code. It now needs the patient to be pregnant.
 *
 * This is the first slice of pathway classification (pregnant / adult /
 * pediatric — see pathways/TODO.md). The class is read from the pathway's
 * `category`; adult vs pediatric, and choosing between a pregnancy pathway and
 * a general one, are not built.
 */

/** ICD-10-CM families that say the patient is pregnant, beyond chapter 15 (O00–O9A). */
const PREGNANCY_Z_FAMILIES = ['Z33', 'Z34', 'Z3A'];

/**
 * Pregnant, on what the chart holds:
 *  - a chapter-15 code (O…: pregnancy, childbirth and the puerperium — the
 *    obstetric pathways run through the postpartum handoff, so the puerperium
 *    counts), or Z33 (pregnant state), Z34 (supervision of normal pregnancy),
 *    Z3A (weeks of gestation); or
 *  - a recorded gestational age or trimester.
 */
export function isPregnant(patient: PatientContext): boolean {
  const coded = (patient.conditionCodes ?? []).some((c) => {
    if (!/^ICD-?10/i.test(c.system)) return false;
    const code = c.code.toUpperCase();
    return code.startsWith('O') || PREGNANCY_Z_FAMILIES.some((f) => code.startsWith(f));
  });
  if (coded) return true;
  const attrs = (patient as { patientAttributes?: Record<string, unknown> }).patientAttributes ?? {};
  return typeof attrs.gestational_age_weeks === 'number' || typeof attrs.trimester === 'number';
}

/** Matched pathways, minus obstetric ones for a patient who is not pregnant. */
export function applicablePathways(matched: MatchedPathway[], patient: PatientContext): MatchedPathway[] {
  if (isPregnant(patient)) return matched;
  return matched.filter((m) => m.pathway.category !== 'OBSTETRIC');
}
