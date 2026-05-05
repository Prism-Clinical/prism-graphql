import { Pool } from 'pg';
import { MatchedPathway, MatchedCodeSetMember } from './types';
import { findAncestors } from '../codes/icd10-hierarchy';

/**
 * Phase 3 lattice collapse: drop matched pathways whose match scenario is
 * strictly less specific than another matched pathway's. After collapse, the
 * remaining pathways are mutually non-comparable — none is dominated by
 * another in the lattice.
 *
 * Domination rule (asymmetric):
 *   Pathway A is dominated by pathway B iff every member of A's most-specific
 *   matched set has an ancestor-or-equal member in B's most-specific matched
 *   set (within the same coding system), AND the inverse does NOT hold
 *   (i.e., they are not mutually equivalent).
 *
 * Worked examples:
 *   - A {I10}, B {I10, E11}     → A dominated (same I10, B adds E11)
 *   - A {E11}, B {E11.65}       → A dominated (E11 is ICD-10 ancestor of E11.65)
 *   - A {E11}, B {E11.65, I10}  → A dominated (E11 covers via E11.65 ancestor)
 *   - A {I10}, B {Migraine}     → neither dominated (different conditions)
 *   - A {E11.0}, B {E11.65}     → neither dominated (siblings under E11)
 *   - A and B literally equal   → neither dominated (kept both for conflict layer)
 *
 * Returns the surviving pathways (input minus dominated ones), preserving
 * relative order. ICD-10 ancestor lookups are cached per call to avoid
 * repeated DB round-trips when many pathways share roots.
 */
export async function collapseLattice(
  pool: Pool,
  matched: MatchedPathway[],
): Promise<MatchedPathway[]> {
  if (matched.length <= 1) return matched;

  // Pre-compute the "coverage" set for each pathway: its mostSpecificMatchedSet
  // members PLUS, for ICD-10 codes, every ancestor (so descendant comparison
  // is a single membership check).
  const coverages = new Map<string, Set<string>>();
  const ancestorCache = new Map<string, string[]>();

  for (const m of matched) {
    const coverage = new Set<string>();
    for (const member of m.mostSpecificMatchedSet.members) {
      coverage.add(memberKey(member));
      if (member.system === 'ICD-10') {
        const ancestors = await getAncestorsCached(pool, member.code, ancestorCache);
        for (const a of ancestors) {
          coverage.add(`ICD-10|${a}`);
        }
      }
    }
    coverages.set(m.pathway.id, coverage);
  }

  // For each pair, determine dominance.
  const dominated = new Set<string>();
  for (const a of matched) {
    if (dominated.has(a.pathway.id)) continue;
    for (const b of matched) {
      if (a.pathway.id === b.pathway.id) continue;
      if (dominated.has(b.pathway.id)) continue;
      if (isDominatedBy(a, b, coverages)) {
        dominated.add(a.pathway.id);
        break;
      }
    }
  }

  return matched.filter((m) => !dominated.has(m.pathway.id));
}

function memberKey(m: MatchedCodeSetMember): string {
  return `${m.system}|${m.code}`;
}

async function getAncestorsCached(
  pool: Pool,
  code: string,
  cache: Map<string, string[]>,
): Promise<string[]> {
  const cached = cache.get(code);
  if (cached !== undefined) return cached;
  const ancestors = await findAncestors(pool, code);
  cache.set(code, ancestors);
  return ancestors;
}

/**
 * A is dominated by B if A's matched-set members are all "covered" by B's
 * matched-set + ancestors, and B is NOT also covered by A's matched-set +
 * ancestors (so they aren't mutually equivalent).
 */
function isDominatedBy(
  a: MatchedPathway,
  b: MatchedPathway,
  coverages: Map<string, Set<string>>,
): boolean {
  const aMembers = a.mostSpecificMatchedSet.members;
  const bMembers = b.mostSpecificMatchedSet.members;
  const aCoverage = coverages.get(a.pathway.id)!;
  const bCoverage = coverages.get(b.pathway.id)!;

  // Every A member must be in B's coverage (literal or ancestor-of).
  const aCoveredByB = aMembers.every((m) => bCoverage.has(memberKey(m)));
  if (!aCoveredByB) return false;

  // For asymmetry: B must NOT also be fully covered by A. Otherwise they are
  // mutually equivalent (literally same codes, or same code modulo ancestors).
  const bCoveredByA = bMembers.every((m) => aCoverage.has(memberKey(m)));
  if (bCoveredByA) return false;

  return true;
}
