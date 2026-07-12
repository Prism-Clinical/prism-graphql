type Primitive = number | string | boolean;

function isPrimitive(v: unknown): v is Primitive {
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
}

/** Trimester from gestational age in weeks: 1 (<14), 2 (14–27), 3 (>=28). */
function trimesterFromWeeks(weeks: number): number {
  if (weeks < 14) return 1;
  if (weeks < 28) return 2;
  return 3;
}

export function normalizePatientAttributes(raw: unknown): Record<string, Primitive> | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const out: Record<string, Primitive> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isPrimitive(v)) out[k] = v;
  }
  const ga = out.gestational_age_weeks;
  if (typeof ga === 'number' && Number.isFinite(ga) && out.trimester === undefined) {
    out.trimester = trimesterFromWeeks(ga);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
