/**
 * EXPERIMENTAL, NONCLINICAL. Public types for S2 candidate identification.
 *
 * Normative source: docs/superpowers/records/pathway-language/evidence-query-to-predicate-contract.md
 * (§1.2 `concept`, §1.7, §2 table row S2, §4.2 step B, §5.1) and the explicit-assertion-v0 fixtures'
 * `query/q.demo.json`. S2 decides only whether evidence *could concern* the queried concept; it
 * says nothing about what the evidence establishes. No clinical meaning; not for patient care.
 */
import type { Defect, KeyStatus, NodeRef, RecordKey, S1Cause, S1Result } from '../s1/types';

/** A code as compared by S2: system and code, compared exactly (Stage A §3, CANONICALIZATION.md §4). */
export interface Code {
  readonly system: string;
  readonly code: string;
}

/**
 * A pinned, immutable value-set expansion, in the fixtures' `valueSets` entry format plus its
 * identity. `id` includes the version (e.g. `demo-vs/item-x@1`) and is compared exactly with the
 * query's pin; there is no "latest" resolution. Membership is decidable only for `coveredSystems`.
 */
export interface ValueSetExpansion {
  readonly id: string;
  readonly expansion: readonly Code[];
  readonly coveredSystems: readonly string[];
}

export interface S2Input {
  /** The experimental S1 result, used as the revision-history boundary. Never mutated. */
  readonly s1: S1Result;
  /** The query contract's `retrieve.valueSet` pin. */
  readonly valueSet: string;
  /** The supplied expansion; its `id` must equal `valueSet`. */
  readonly expansion: ValueSetExpansion;
}

/** Causes S2 itself can introduce (contract §1.7, §2 row S2). */
export type S2Cause = 'Missing' | 'Unavailable' | 'Invalid';

export type S2Reason =
  /** Well-formed code from a system the expansion does not cover (contract §1.7). */
  | 'TerminologyUnavailable'
  /** `concept`, `concept.system` or `concept.code` present but not of the declared type. */
  | 'CodeMalformed'
  /** Required concept information absent. Provisional label: see README "S2 interpretations". */
  | 'FieldAbsent:concept'
  | 'FieldAbsent:concept.system'
  | 'FieldAbsent:concept.code';

export interface S2Finding {
  readonly cause: S2Cause;
  readonly reason: S2Reason;
}

/** S2 classification of one possible current node (a revision, or one variant of a conflicted revision). */
export type NodeCandidacy =
  | { readonly kind: 'node'; readonly node: NodeRef; readonly candidacy: 'InDomain'; readonly reason: 'CodeInExpansion'; readonly code: Code }
  | {
      readonly kind: 'node';
      readonly node: NodeRef;
      readonly candidacy: 'OutOfDomain';
      /** Nonmembership is established only inside a covered system. */
      readonly reason: 'CodeNotInExpansion';
      readonly code: Code;
    }
  | { readonly kind: 'node'; readonly node: NodeRef; readonly candidacy: 'Unresolved'; readonly findings: readonly S2Finding[] };

/**
 * One entry of S1's `possibleCurrent`, carried through S2.
 * - `excluded` stays excluded: possibly not a current record for this query; never in domain.
 * - `unknown` stays possibly in domain: possibly a current revision with any content.
 */
export type PossibleCandidacy = NodeCandidacy | { readonly kind: 'excluded' } | { readonly kind: 'unknown' };

export type AnyCause = S1Cause | S2Cause;

export interface KeyCandidacy {
  readonly key: RecordKey;
  /** S1 status, unchanged. `Retracted` and `NoRecord` contribute no possibility (and no negative conclusion). */
  readonly s1Status: KeyStatus;
  /** S1's active causes and defects, unchanged and still attributed to S1. Never dropped by S2. */
  readonly inheritedCauses: readonly S1Cause[];
  readonly inheritedDefects: readonly Defect[];
  /** `Current`: the current node. `UnresolvedRevision`: every possible current, in S1 order. Else empty. */
  readonly possibilities: readonly PossibleCandidacy[];
  /**
   * Contract §2 row S2: true if ANY possibility could be in domain (`InDomain`, `Unresolved` or
   * `unknown`). It includes unresolved possibilities and does NOT mean membership is established.
   */
  readonly candidate: boolean;
  /** Inherited causes ∪ every possibility's S2 causes, Stage A §4.1 order. No materiality filter. */
  readonly causes: readonly AnyCause[];
}

export interface S2Result {
  readonly experimental: 'nonclinical-s2-v0';
  /** The expansion pin every classification was made against. */
  readonly valueSet: string;
  /** One entry per S1 key, by `RecordKey` (code point order). */
  readonly keys: readonly KeyCandidacy[];
}
