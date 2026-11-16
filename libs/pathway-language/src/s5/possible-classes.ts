/**
 * EXPERIMENTAL, NONCLINICAL. Key-level possible classes (evidence-query contract §4.2 step B, §3.7).
 *
 * What ONE key of a query-bound S4 result could contribute: the union of each possibility's
 * contributions, each explained by its basis. Every node possibility is classified through
 * `classifyRecord`, so all S5 ownership checks apply; the key and the selection are also checked
 * here, so an empty or all-marker key is validated too. It never chooses a current revision,
 * changes a selection status, decides materiality or computes an evidence result (S6).
 */
import { detach } from '../compile/compile';
import { compareCodePoints } from '../s1/resolve';
import type { PossibleSelection } from '../s4/types';
import { classifyRecord } from './classify';
import { boundContract, CriteriaConfigurationError } from './criteria';
import type { ClassificationResult, Contribution, EvidenceClass, PossibilityContribution, PossibleClassesInput, PossibleClassesResult } from './types';

const INPUT_FIELDS = ['package', 'query', 's4', 'key'];
/** Canonical order (conformance README, `possibleClasses`). */
const CLASSES: readonly EvidenceClass[] = ['Supporting', 'Refuting', 'NonInformative', 'excluded'];
const ASSERTION_CLASSES = ['Supporting', 'Refuting', 'NonInformative'] as const;

/** The §3.7 contribution table for one possibility and its per-record result. */
function contributions(p: PossibleSelection, r: ClassificationResult): Contribution[] {
  const out: Contribution[] = [];
  if (p.kind === 'excluded') out.push({ class: 'excluded', basis: 'ExcludedMarker' });
  // "Possibly a current revision with any content" (§2.1): any assertion, or not qualifying at all.
  else if (p.kind === 'unknown') out.push(...CLASSES.map((c) => ({ class: c, basis: 'UnknownMarker' as const })));
  else if (r.outcome === 'NotEvaluated') {
    if (r.reason !== 'OutOfDomain' && r.reason !== 'Inadmissible') throw new Error(`invariant: node possibility NotEvaluated(${r.reason})`);
    // A definite mismatch, also beside unresolved candidacy (§2.8): only exclusion.
    out.push({ class: 'excluded', basis: r.reason });
  } else {
    const c = r.classification;
    // Unclassified: only the assertion is unknown; the record's existence and eligibility are not.
    if (c.class === 'Unclassified') out.push(...ASSERTION_CLASSES.map((x) => ({ class: x, basis: 'Unclassified' as const })));
    else out.push({ class: c.class, basis: 'Classified' });
    // Eligibility uncertainty: it could turn out out of domain or inadmissible. History uncertainty
    // adds nothing here: the key's alternatives are its represented possibilities.
    const blockers = p.kind === 'node' && p.selection.disposition === 'NotSelected' ? p.selection.blockers : [];
    for (const b of blockers) if (b === 'CandidacyUnresolved' || b === 'AdmissibilityUnresolved') out.push({ class: 'excluded', basis: b });
  }
  return out.sort((a, b) => CLASSES.indexOf(a.class) - CLASSES.indexOf(b.class) || compareCodePoints(a.basis, b.basis));
}

export function possibleClasses(input: PossibleClassesInput): PossibleClassesResult {
  boundContract(input, INPUT_FIELDS);
  const { s4, key } = input;
  // Ownership by identity, checked here so a key with no possibilities is validated too.
  if (!s4.keys.includes(key)) throw new CriteriaConfigurationError('key is not a key of this S4 result');
  const possibilities = key.possibilities.map((p): PossibilityContribution => {
    const record = classifyRecord({ package: input.package, query: input.query, s4, possibility: p });
    return { possibility: p, record, contributes: contributions(p, record) };
  });
  const seen = new Set(possibilities.flatMap((x) => x.contributes.map((c) => c.class)));
  return detach({
    experimental: 'nonclinical-s5-possible-classes-v0',
    stage: 'S5',
    scope: 'one-key-possible-classes',
    packageId: input.package.packageId,
    query: input.query,
    key: key.key,
    s1Status: key.s1Status,
    status: key.status,
    unresolvedBy: key.unresolvedBy,
    inheritedS1Causes: key.inheritedS1Causes,
    inheritedS1Defects: key.inheritedS1Defects,
    possibleClasses: CLASSES.filter((c) => seen.has(c)),
    possibilities,
  });
}
