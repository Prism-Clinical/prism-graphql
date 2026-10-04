/**
 * Lab measures that stand in for one another.
 *
 * [DECISION — Josh 2026-10-04]: "the ability to choose whether to input
 * hemoglobin vs hematocrit".
 *
 *  1. A hematocrit is used wherever a hemoglobin is needed, as an ESTIMATED
 *     hemoglobin = hematocrit ÷ 3, shown as estimated. (And the reverse, so a
 *     gate that reads the hematocrit code resolves from a hemoglobin and
 *     nobody is asked for the second measure.) A code read directly is still
 *     read directly when it is on file.
 *  2. Both on file: whichever is most recent decides; on the same date, the
 *     measured value.
 *  3. One question with a switch: entering either answers it.
 *
 * This module is the registry and the arithmetic, and nothing else. The
 * derivation itself happens once, at fact assembly (`context-assembler.ts`),
 * so every operator, horizon and ordering rule sees an estimated value as an
 * ordinary dated fact and none of them needs to know about equivalence.
 */

/** One way of reporting a quantity: a coded lab with its display name and unit. */
export interface LabMeasure {
  code: string;
  system: string;
  display: string;
  unit: string;
}

interface GroupMember extends LabMeasure {
  /** This measure's value for ONE unit of the group's primary measure. */
  perPrimary: number;
  /** Other spellings of `unit` a chart may carry, lower-case, no spaces. */
  unitAliases: readonly string[];
  /**
   * The values this measure can plausibly take IN ITS REGISTERED UNIT. A value
   * outside it is the same lab in another unit — a hematocrit of 0.27 (L/L), a
   * hemoglobin of 105 (g/L) — and converting it would manufacture a
   * catastrophic estimate (a hemoglobin of 0.1).
   */
  plausible: { min: number; max: number };
}

/**
 * The equivalence groups. The FIRST member is the primary measure — the one
 * pathways are authored on, and the one the group's shared question is keyed
 * by. One group today.
 */
const GROUPS: readonly (readonly GroupMember[])[] = Object.freeze([
  Object.freeze([
    { code: '718-7', system: 'LOINC', display: 'Hemoglobin', unit: 'g/dL', perPrimary: 1, unitAliases: ['g/dl', 'gm/dl'], plausible: { min: 1.5, max: 25 } },
    // The "rule of three": hematocrit (%) ≈ 3 × hemoglobin (g/dL).
    { code: '4544-3', system: 'LOINC', display: 'Hematocrit', unit: '%', perPrimary: 3, unitAliases: ['%', 'percent', 'pct'], plausible: { min: 5, max: 75 } },
  ]),
]);

const sameSystem = (a: string | undefined, b: string): boolean =>
  (a ?? 'LOINC').toUpperCase() === b.toUpperCase();

function groupOf(code: string, system: string | undefined): readonly GroupMember[] | null {
  return GROUPS.find((g) => g.some((m) => m.code === code && sameSystem(system, m.system))) ?? null;
}

const measureOf = ({ code, system, display, unit }: GroupMember): LabMeasure => ({ code, system, display, unit });

/**
 * Every measure that can answer a request for this lab — the lab itself FIRST,
 * then its equivalents — or `null` when it has none.
 */
export function equivalenceGroupOf(code: string, system?: string): LabMeasure[] | null {
  const group = groupOf(code, system);
  if (!group) return null;
  const asked = group.find((m) => m.code === code)!;
  return [asked, ...group.filter((m) => m !== asked)].map(measureOf);
}

/** The registered display name and unit of a lab, or `null` when it is in no group. */
export function labMeasureFor(code: string, system?: string): LabMeasure | null {
  const member = groupOf(code, system)?.find((m) => m.code === code);
  return member ? measureOf(member) : null;
}

/** Are these two labs the same quantity (the same lab, or members of one group)? */
export function areEquivalentLabs(
  a: { code: string; system?: string },
  b: { code: string; system?: string },
): boolean {
  if (a.code === b.code && sameSystem(a.system, b.system ?? 'LOINC')) return true;
  const group = groupOf(a.code, a.system);
  return group !== null && group.some((m) => m.code === b.code && sameSystem(b.system, m.system));
}

/**
 * The identity of the DATUM a lab request is for: `<system>:<code>` of the
 * group's primary measure, or of the lab itself when it has no equivalents.
 *
 * A gate needing hemoglobin and a gate needing hematocrit need the same thing
 * from the provider, so they share one question; and "I don't have it" is
 * recorded against this key, so a declined hemoglobin is not asked again as a
 * hematocrit.
 */
export function labDatumKey(code: string, system = 'LOINC'): string {
  const primary = groupOf(code, system)?.[0];
  return primary ? `${primary.system}:${primary.code}` : `${system}:${code}`;
}

/**
 * May an estimate be derived from this measured value?
 *
 * Only when it is certainly in the measure's REGISTERED unit: its unit, when
 * the chart gives one, is that unit (or a known spelling of it), and the value
 * is one that unit can plausibly hold. No unit conversion is attempted — a
 * value that fails this is simply not estimated from, so the gate reads what
 * it read before equivalents existed (and asks, if it has nothing else).
 */
export function canDeriveFrom(lab: { code: string; system?: string; value: number; unit?: string }): boolean {
  const member = groupOf(lab.code, lab.system)?.find((m) => m.code === lab.code);
  if (!member || !Number.isFinite(lab.value)) return false;
  if (lab.unit !== undefined && lab.unit !== '') {
    const unit = lab.unit.toLowerCase().replace(/\s+/g, '');
    if (!member.unitAliases.includes(unit)) return false;
  }
  return lab.value >= member.plausible.min && lab.value <= member.plausible.max;
}

/** The group-wide identity of a lab, for "is this the same quantity" lookups. */
export function labGroupKey(code: string, system = 'LOINC'): string {
  return labDatumKey(code, system);
}

/**
 * Convert a value between two measures of one group, rounded to one decimal —
 * the precision both are reported at. `null` when they are not equivalent.
 */
export function convertLabValue(
  value: number,
  from: { code: string; system?: string },
  to: { code: string; system?: string },
): number | null {
  const group = groupOf(from.code, from.system);
  const source = group?.find((m) => m.code === from.code);
  const target = group?.find((m) => m.code === to.code && sameSystem(to.system, m.system));
  if (!source || !target || !Number.isFinite(value)) return null;
  return Math.round((value / source.perPrimary) * target.perPrimary * 10) / 10;
}

/** What an estimated value was estimated from. */
export interface DerivedFrom {
  code: string;
  system: string;
  /** The value as MEASURED — exact, never rounded. */
  value: number;
  unit: string;
  display: string;
}

/** "27%" / "9 g/dL". */
function withUnit(value: number, unit: string): string {
  return unit === '%' ? `${value}%` : `${value} ${unit}`;
}

/** "estimated from hematocrit 27%". */
export function describeDerivation(from: DerivedFrom): string {
  return `estimated from ${from.display.toLowerCase()} ${withUnit(from.value, from.unit)}`;
}
