/**
 * Which answers select a branch.
 *
 * A gate's `BRANCHES_TO` edges are already the routing table — they name where
 * each branch goes. What was missing is which ANSWER takes which edge, so that
 * lives here, on the edge it governs. A gate property holding
 * `{option: targetId}` would duplicate the edge set and let the two disagree.
 *
 * Ranges are half-open, `[gte, lt)`, because that is what makes totality
 * checkable: `[-inf, 7) [7, 11) [11, inf)` tiles the line with no gap and no
 * overlap, and no value sits in two.
 */

export type BranchWhen =
  /** SELECT option, or BOOLEAN. */
  | { equals: string | boolean }
  /** NUMERIC, half-open `[gte, lt)`. An absent bound is unbounded that side. */
  | { gte?: number; lt?: number };

export function isEqualsWhen(w: BranchWhen): w is { equals: string | boolean } {
  return 'equals' in w;
}

/**
 * Read a raw `when` off an edge's properties.
 *
 * Returns `null` for anything uninterpretable rather than guessing — a guess
 * here routes a patient down a treatment arm.
 */
export function parseBranchWhen(raw: unknown): BranchWhen | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;

  const r = raw as Record<string, unknown>;

  if ('equals' in r) {
    const v = r.equals;
    if (typeof v === 'string' || typeof v === 'boolean') return { equals: v };
    return null;
  }

  const hasGte = r.gte !== undefined && r.gte !== null;
  const hasLt = r.lt !== undefined && r.lt !== null;
  if (!hasGte && !hasLt) return null;
  if (hasGte && typeof r.gte !== 'number') return null;
  if (hasLt && typeof r.lt !== 'number') return null;

  const out: { gte?: number; lt?: number } = {};
  if (hasGte) out.gte = r.gte as number;
  if (hasLt) out.lt = r.lt as number;
  if (out.gte !== undefined && out.lt !== undefined && out.gte >= out.lt) return null;
  return out;
}

/**
 * Check that a set of numeric ranges tiles `(-inf, inf)` exactly.
 *
 * Returns an error string, or `null` when the cover is total. Gaps and
 * overlaps are reported separately because they are different authoring
 * mistakes: a gap means some answers route nowhere, an overlap means some
 * route to two branches at once.
 */
export function checkNumericCover(
  ranges: Array<{ gte?: number; lt?: number }>,
): string | null {
  if (ranges.length === 0) return 'no numeric ranges declared';

  const sorted = [...ranges].sort(
    (a, b) => (a.gte ?? -Infinity) - (b.gte ?? -Infinity),
  );

  if (sorted[0].gte !== undefined) {
    return `no branch covers values below ${sorted[0].gte}`;
  }
  if (sorted[sorted.length - 1].lt !== undefined) {
    return `no branch covers values at or above ${sorted[sorted.length - 1].lt}`;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const end = sorted[i].lt;
    const nextStart = sorted[i + 1].gte;
    if (end === undefined) {
      return `a branch is unbounded above but is not the last range`;
    }
    if (nextStart === undefined) {
      return `two branches are unbounded below`;
    }
    if (nextStart > end) return `no branch covers [${end}, ${nextStart})`;
    if (nextStart < end) return `branches overlap on [${nextStart}, ${end})`;
  }

  return null;
}
