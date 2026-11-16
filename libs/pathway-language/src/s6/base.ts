/**
 * EXPERIMENTAL, NONCLINICAL. S6 step A: the base result (evidence-query contract §4.2 step A,
 * "Step A boundary").
 *
 * For ONE query-bound evaluation: S (Supporting) and R (Refuting) from the selected keys' own
 * classifications, G from the same evaluation's gap relevance, then rules 1–5 and rule 5's base
 * causes. Classifications, possible classes and gaps are all derived here from the authentic S4
 * result; none is accepted from the caller.
 *
 * The result is intermediate: a provisional Known can still become Unresolved in step B
 * (materiality), and an Unresolved base's final causes come from step C. Neither step runs here,
 * so this is never an Evidence<Boolean> and never reaches the program executor.
 */
import { detach } from '../compile/compile';
import { compareCodePoints } from '../s1/resolve';
import type { NodeRef, RecordKey } from '../s1/types';
import type { KeySelection, SelectionStatus } from '../s4/types';
import { classifyRecord } from '../s5/classify';
import { CriteriaConfigurationError } from '../s5/criteria';
import { possibleClasses } from '../s5/possible-classes';
import type { EvidenceClass } from '../s5/types';
import { gapRelevance, GapRelevanceConfigurationError, type GapRef, type GapRelevanceInput } from './gaps';

/** Invalid API input. Never a base result or patient uncertainty. */
export class BaseResultConfigurationError extends Error {}

/** The same three fields as gap relevance: everything else comes from the bound evaluation. */
export type BaseResultInput = GapRelevanceInput;

export type BaseRule = 1 | 2 | 3 | 4 | 5;

/** Base causes only (§4.2 step A), with the README's S6 `query`-origin reasons. Never a gap cause. */
export type BaseCause =
  | { readonly cause: 'Conflicting'; readonly reason: 'AssertionConflict'; readonly refs: readonly NodeRef[] }
  | { readonly cause: 'Missing'; readonly reason: 'NoInDomainRecord' }
  | { readonly cause: 'Inadmissible'; readonly reason: 'InadmissibleSeen'; readonly keys: readonly RecordKey[] }
  | { readonly cause: 'InsufficientEvidence'; readonly reason: 'NonInformativeSeen'; readonly keys: readonly RecordKey[] };

/** What one key is for step A (contract "Rule 5 decision table"). */
export type BaseKeyRole =
  | 'Supporting'
  | 'Refuting'
  | 'NonInformative'
  /** Selected but Unclassified: an unresolved record, never in S or R. */
  | 'Unclassified'
  | 'InadmissibleCandidate'
  | 'UnresolvedCandidate'
  | 'UnresolvedNotCandidate'
  /**
   * §2.8: a current revision with unresolved candidacy and a definite mismatch. An unresolved
   * candidate (decided on review, 2026-11-02): potentially in domain, never a base Inadmissible.
   */
  | 'CandidacyUnresolvedBesideInadmissible'
  | 'OutOfDomain'
  | 'Retracted'
  | 'NoRecord';

export interface BaseKey {
  readonly key: RecordKey;
  readonly status: SelectionStatus;
  /** S2 key candidacy: some possibility could be in domain (§2.3). */
  readonly candidate: boolean;
  readonly role: BaseKeyRole;
  /** The selected current revision (selected keys only). */
  readonly node?: NodeRef;
  /** Unresolved records only: read for rule 5's condition, never for materiality. */
  readonly possibleClasses?: readonly EvidenceClass[];
  readonly inDomainSeen: boolean;
  readonly inadmissibleSeen: boolean;
  readonly nonInformativeSeen: boolean;
}

export interface BaseResult {
  readonly experimental: 'nonclinical-s6-base-result-v0';
  readonly stage: 'S6';
  /** Step A only: no materiality (step B), cause union or attribution (step C). */
  readonly step: 'A';
  readonly scope: 'base-result';
  readonly packageId: string;
  readonly query: string;
  readonly snapshot: string;
  readonly rule: BaseRule;
  /** Provisional: step B can still turn a Known base into Unresolved. */
  readonly base: { readonly status: 'Known'; readonly value: boolean } | { readonly status: 'Unresolved' };
  /** S and R: exact revision and variant identity, RevisionRef then digest order. */
  readonly supporting: readonly NodeRef[];
  readonly refuting: readonly NodeRef[];
  /** G, and the gaps proven irrelevant (no effect), from the same evaluation's gap relevance. */
  readonly relevantGaps: readonly GapRef[];
  readonly irrelevantGaps: readonly GapRef[];
  /**
   * Base causes only, Stage A order. Rule 1: Conflicting. Rules 2–3: none. Rule 4: none: its
   * causes come only from step C (`causes: 'DeferredToStepC'`). Rule 5: those decided below.
   */
  readonly baseCauses: readonly BaseCause[];
  readonly causes: 'Conflict' | 'NoneForKnown' | 'DeferredToStepC' | 'Rule5';
  /** Every S4 key, RecordKey order. */
  readonly keys: readonly BaseKey[];
  readonly notRun: readonly ['StepB:Materiality', 'StepC:Causes', 'Evidence', 'Needs'];
}

const INPUT_FIELDS = ['package', 'query', 's4'];

const nodeTuple = (n: NodeRef) => [n.revision.source, n.revision.localId, n.revision.revision, n.digest ?? ''];
export function compareNodes(a: NodeRef, b: NodeRef): number {
  const x = nodeTuple(a);
  const y = nodeTuple(b);
  for (let i = 0; i < x.length; i++) {
    const c = compareCodePoints(x[i]!, y[i]!);
    if (c !== 0) return c;
  }
  return 0;
}

/** §2.8: a current revision, unresolved only by candidacy, whose combined S3 result is Inadmissible. */
const candidacyBesideInadmissible = (k: KeySelection) =>
  k.status === 'Unresolved' &&
  k.s1Status === 'Current' &&
  k.unresolvedBy.length === 1 &&
  k.unresolvedBy[0] === 'CandidacyUnresolved' &&
  k.possibilities.some((p) => p.kind === 'node' && p.selection.disposition === 'NotSelected' && p.selection.blockers.includes('Inadmissible'));

export function baseResult(input: BaseResultInput): BaseResult {
  if (input === null || typeof input !== 'object') throw new BaseResultConfigurationError('input must be an object');
  const extra = Object.keys(input).filter((k) => !INPUT_FIELDS.includes(k));
  // In particular classifications, possible classes, gap decisions, payloads or query settings.
  if (extra.length > 0) throw new BaseResultConfigurationError(`unexpected input field(s) ${extra.join(', ')}; classifications and gaps come only from the query-bound evaluation`);
  let gaps;
  try {
    // Checks the package, query, S4 binding and snapshot, exactly as gap relevance does.
    gaps = gapRelevance({ package: input.package, query: input.query, s4: input.s4 });
  } catch (e) {
    if (e instanceof GapRelevanceConfigurationError || e instanceof CriteriaConfigurationError) throw new BaseResultConfigurationError(e.message);
    throw e;
  }
  const { s4 } = input;
  const own = { package: input.package, query: input.query, s4 };
  const classesOf = (k: KeySelection) => possibleClasses({ ...own, key: k }).possibleClasses;

  const keys = s4.keys.map((k): BaseKey => {
    const common = { key: k.key, status: k.status, candidate: k.candidate };
    const none = { inDomainSeen: false, inadmissibleSeen: false, nonInformativeSeen: false } as const;
    switch (k.status) {
      case 'Selected': {
        const p = k.possibilities.find((x) => x.kind === 'node' && x.selection.disposition === 'Selected');
        if (!p || p.kind !== 'node') throw new Error('invariant: a Selected key has a selected revision');
        const r = classifyRecord({ ...own, possibility: p });
        if (r.outcome !== 'Evaluated') throw new Error('invariant: a selected revision is evaluated');
        const c = r.classification.class;
        if (c === 'Unclassified') {
          return { ...common, role: 'Unclassified', node: p.node, possibleClasses: classesOf(k), inDomainSeen: true, inadmissibleSeen: false, nonInformativeSeen: false };
        }
        return { ...common, role: c, node: p.node, inDomainSeen: true, inadmissibleSeen: false, nonInformativeSeen: c === 'NonInformative' };
      }
      case 'Inadmissible':
        return { ...common, role: 'InadmissibleCandidate', inDomainSeen: true, inadmissibleSeen: true, nonInformativeSeen: false };
      case 'Unresolved': {
        const pc = classesOf(k);
        // 7.5: a key no possibility of which could be in domain is not seen at all.
        if (!k.candidate) return { ...common, role: 'UnresolvedNotCandidate', possibleClasses: pc, ...none };
        // An unresolved candidate, the §2.8 case included: potentially in domain, never a base
        // Inadmissible (only a definite current in-domain revision is), and InsufficientEvidence
        // exactly when it could only be non-informative or excluded.
        const onlyUninformative = pc.length > 0 && pc.every((c) => c === 'NonInformative' || c === 'excluded');
        const role = candidacyBesideInadmissible(k) ? 'CandidacyUnresolvedBesideInadmissible' : 'UnresolvedCandidate';
        return { ...common, role, possibleClasses: pc, inDomainSeen: true, inadmissibleSeen: false, nonInformativeSeen: onlyUninformative };
      }
      default:
        return { ...common, role: k.status, ...none };
    }
  });

  const supporting = keys.filter((k) => k.role === 'Supporting').map((k) => k.node!).sort(compareNodes);
  const refuting = keys.filter((k) => k.role === 'Refuting').map((k) => k.node!).sort(compareNodes);
  const g = gaps.relevant;
  const S = supporting.length > 0;
  const R = refuting.length > 0;

  let rule: BaseRule;
  let baseCauses: BaseCause[] = [];
  let causes: BaseResult['causes'];
  if (S && R) {
    rule = 1;
    causes = 'Conflict';
    // Both sides stay: neither is chosen, counted or weighted.
    baseCauses = [{ cause: 'Conflicting', reason: 'AssertionConflict', refs: [...supporting, ...refuting].sort(compareNodes) }];
  } else if ((S || R) && g.length === 0) {
    rule = S ? 2 : 3;
    causes = 'NoneForKnown';
  } else if (S || R) {
    // A relevant gap could hold the opposing assertion (symmetric): no Known, and no base cause.
    rule = 4;
    causes = 'DeferredToStepC';
  } else {
    rule = 5;
    causes = 'Rule5';
    const keysWhere = (f: (k: BaseKey) => boolean) => keys.filter(f).map((k) => k.key);
    const inadmissible = keysWhere((k) => k.inadmissibleSeen);
    const uninformative = keysWhere((k) => k.nonInformativeSeen);
    if (keysWhere((k) => k.inDomainSeen).length === 0) baseCauses.push({ cause: 'Missing', reason: 'NoInDomainRecord' });
    if (inadmissible.length > 0) baseCauses.push({ cause: 'Inadmissible', reason: 'InadmissibleSeen', keys: inadmissible });
    if (uninformative.length > 0) baseCauses.push({ cause: 'InsufficientEvidence', reason: 'NonInformativeSeen', keys: uninformative });
  }

  return detach({
    experimental: 'nonclinical-s6-base-result-v0',
    stage: 'S6',
    step: 'A',
    scope: 'base-result',
    packageId: gaps.packageId,
    query: gaps.query,
    snapshot: gaps.snapshot,
    rule,
    base: rule === 2 ? { status: 'Known', value: true } : rule === 3 ? { status: 'Known', value: false } : { status: 'Unresolved' },
    supporting,
    refuting,
    relevantGaps: g,
    irrelevantGaps: gaps.irrelevant,
    baseCauses,
    causes,
    keys,
    notRun: ['StepB:Materiality', 'StepC:Causes', 'Evidence', 'Needs'],
  } as BaseResult);
}

