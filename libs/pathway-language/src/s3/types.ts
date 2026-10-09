/**
 * EXPERIMENTAL, NONCLINICAL. Public types for ONE S3 admissibility check: same-encounter scope.
 *
 * Normative source: docs/superpowers/records/pathway-language/evidence-query-to-predicate-contract.md
 * §1.2 (`encounter: Field<EncounterRef>`), §1.6 (evaluation context), §2.2 (the `encounter` rule)
 * and §2.4. This is not the S3 result: matching the encounter does not make a record admissible,
 * and no per-key admissibility decision, evidence result or Need is produced.
 */
import type { Defect, KeyStatus, NodeRef, RecordKey, S1Cause, S1Result } from '../s1/types';
import type { S2Finding, ValueSetExpansion } from '../s2/types';

/** Stage A §4.1 causes, as an evaluation-context binding may carry them (contract §1.6). */
export type ContextCause = 'Missing' | 'Conflicting' | 'Unavailable' | 'Invalid' | 'Inadmissible' | 'InsufficientEvidence';

/**
 * The evaluation encounter, in the fixtures' context notation (contract §7.1). A `known` value
 * must be a well-formed EncounterRef (contract §2.4), or the input is a configuration error.
 */
export type EncounterBinding = { readonly known: string } | { readonly unknown: readonly ContextCause[] };

/**
 * The authored rule this check consumes, exactly as written in the query contract's
 * `admissible.encounter` (contract §7.1). It is recognized, not interpreted: any other shape is
 * a configuration error.
 */
export const SAME_ENCOUNTER_RULE = { eq: [{ field: ['c', 'encounter'] }, { ref: 'ctx.encounter' }] } as const;

/**
 * There is deliberately no S2 parameter. The check runs S2 itself on the supplied `s1` with the
 * supplied pin and expansion, so it cannot combine S1 and S2 results from different snapshots
 * (review of b8eb6fe). Any other input field is rejected.
 */
export interface EncounterCheckInput {
  readonly s1: S1Result;
  /** S2 parameters: the query's `retrieve.valueSet` pin and the supplied expansion (contract §2.3). */
  readonly valueSet: string;
  readonly expansion: ValueSetExpansion;
  /** The authored `admissible.encounter` node; must equal SAME_ENCOUNTER_RULE. */
  readonly rule: unknown;
  readonly contextEncounter: EncounterBinding;
}

/** A finding introduced by this check, attributed to the record or to the context binding. */
export type EncounterFinding =
  | { readonly cause: 'Missing'; readonly origin: 'record'; readonly reason: 'FieldAbsent:encounter' }
  /** Not a well-formed EncounterRef: non-string, `null`, empty or whitespace-only (contract §2.4). */
  | { readonly cause: 'Invalid'; readonly origin: 'record'; readonly reason: 'FieldMalformed:encounter' }
  | { readonly cause: ContextCause; readonly origin: 'context.encounter'; readonly reason: 'ContextUnknown:encounter' };

export type EncounterOutcome =
  | { readonly outcome: 'Matches'; readonly recordEncounter: string }
  | { readonly outcome: 'DoesNotMatch'; readonly reason: 'OtherEncounter'; readonly recordEncounter: string; readonly contextEncounter: string }
  | { readonly outcome: 'Unresolved'; readonly findings: readonly EncounterFinding[] };

/**
 * One S1 possible current, carried through S2 and this check.
 * - In-domain or candidacy-unresolved nodes are checked; S2 findings stay separate (`s2Findings`).
 * - Out-of-domain nodes are not checked; they are NOT encounter mismatches.
 * - `excluded` and `unknown` are carried unchanged.
 */
export type PossibleEncounterScope =
  | {
      readonly kind: 'node';
      readonly node: NodeRef;
      readonly candidacy: 'InDomain' | 'Unresolved';
      readonly s2Findings: readonly S2Finding[];
      readonly encounter: EncounterOutcome;
    }
  | {
      readonly kind: 'node';
      readonly node: NodeRef;
      readonly candidacy: 'OutOfDomain';
      readonly encounter: { readonly outcome: 'NotEvaluated'; readonly reason: 'OutOfDomain' };
    }
  | { readonly kind: 'excluded' }
  | { readonly kind: 'unknown' };

export interface KeyEncounterScope {
  readonly key: RecordKey;
  readonly s1Status: KeyStatus;
  /** S2's key-level candidacy, unchanged. */
  readonly candidate: boolean;
  /** S1's active causes and defects, unchanged. An encounter match never clears them. */
  readonly inheritedS1Causes: readonly S1Cause[];
  readonly inheritedS1Defects: readonly Defect[];
  /** S2's possibilities in S1 order. Empty for `Retracted` and `NoRecord`. */
  readonly possibilities: readonly PossibleEncounterScope[];
}

export interface EncounterCheckResult {
  readonly experimental: 'nonclinical-s3-encounter-v0';
  readonly check: 'same-encounter';
  readonly valueSet: string;
  readonly contextEncounter: EncounterBinding;
  /** One entry per key, by `RecordKey`. Deliberately no key-level admissibility decision. */
  readonly keys: readonly KeyEncounterScope[];
}

// ---------------------------------------------------------------------------------------------
// ONE more S3 admissibility check: same-episode scope (contract §1.2, §1.6, §2.2, §2.5). Not the
// S3 result either: a match does not make a record admissible.

/**
 * The evaluation episode, in the fixtures' context notation (contract §7.1). A `known` value must
 * be a well-formed EpisodeRef (contract §2.5), or the input is a configuration error.
 */
export type EpisodeBinding = { readonly known: string } | { readonly unknown: readonly ContextCause[] };

/**
 * The authored rule this check consumes, exactly as written in the query contract's
 * `admissible.episode` (contract §7.1). Recognized, not interpreted.
 */
export const SAME_EPISODE_RULE = { eq: [{ field: ['c', 'episode'] }, { ref: 'ctx.episode' }] } as const;

/** As EncounterCheckInput: no S2 parameter, any other input field is rejected. */
export interface EpisodeCheckInput {
  readonly s1: S1Result;
  readonly valueSet: string;
  readonly expansion: ValueSetExpansion;
  /** The authored `admissible.episode` node; must equal SAME_EPISODE_RULE. */
  readonly rule: unknown;
  readonly contextEpisode: EpisodeBinding;
}

export type EpisodeFinding =
  /** Contract §2.5: the record's field is absent. */
  | { readonly cause: 'Missing'; readonly origin: 'record'; readonly reason: 'FieldAbsent:episode' }
  /** Contract §2.5: not a well-formed EpisodeRef: non-string, `null`, empty or whitespace-only. */
  | { readonly cause: 'Invalid'; readonly origin: 'record'; readonly reason: 'FieldMalformed:episode' }
  /** Contract §2.5: the context episode's own causes, unchanged (cases 12, 113). */
  | { readonly cause: ContextCause; readonly origin: 'context.episode'; readonly reason: 'ContextUnknown:episode' };

export type EpisodeOutcome =
  | { readonly outcome: 'Matches'; readonly recordEpisode: string }
  | { readonly outcome: 'DoesNotMatch'; readonly reason: 'OtherEpisode'; readonly recordEpisode: string; readonly contextEpisode: string }
  | { readonly outcome: 'Unresolved'; readonly findings: readonly EpisodeFinding[] };

/** As PossibleEncounterScope. Out-of-domain nodes are NOT episode mismatches. */
export type PossibleEpisodeScope =
  | {
      readonly kind: 'node';
      readonly node: NodeRef;
      readonly candidacy: 'InDomain' | 'Unresolved';
      readonly s2Findings: readonly S2Finding[];
      readonly episode: EpisodeOutcome;
    }
  | {
      readonly kind: 'node';
      readonly node: NodeRef;
      readonly candidacy: 'OutOfDomain';
      readonly episode: { readonly outcome: 'NotEvaluated'; readonly reason: 'OutOfDomain' };
    }
  | { readonly kind: 'excluded' }
  | { readonly kind: 'unknown' };

export interface KeyEpisodeScope {
  readonly key: RecordKey;
  readonly s1Status: KeyStatus;
  readonly candidate: boolean;
  /** S1's active causes and defects, unchanged. An episode match never clears them. */
  readonly inheritedS1Causes: readonly S1Cause[];
  readonly inheritedS1Defects: readonly Defect[];
  readonly possibilities: readonly PossibleEpisodeScope[];
}

/** Detached and deep-frozen. Deliberately no key-level admissibility decision. */
export interface EpisodeCheckResult {
  readonly experimental: 'nonclinical-s3-episode-v0';
  readonly check: 'same-episode';
  readonly valueSet: string;
  readonly contextEpisode: EpisodeBinding;
  readonly keys: readonly KeyEpisodeScope[];
}

// ---------------------------------------------------------------------------------------------
// ONE more S3 admissibility check: the assertionKind rule (contract §2.2, §2.6). Not the S3 result:
// a match does not make a record admissible, and it never says whether the assertion supports or
// refutes anything (S5).

/**
 * The authored `admissible.assertionKind` node, as written: `{in: [AssertionKind codes]}`. Any
 * other shape, a code outside the pinned enum, or a sparse/undefined element is a configuration
 * error. Duplicates have no effect; an explicitly authored empty set allows no kind (§2.6).
 */
export interface AssertionKindCheckInput {
  readonly s1: S1Result;
  readonly valueSet: string;
  readonly expansion: ValueSetExpansion;
  readonly rule: unknown;
}

export type AssertionKindFinding =
  | { readonly cause: 'Missing'; readonly origin: 'record'; readonly reason: 'FieldAbsent:assertionKind' }
  /** Not exactly a pinned AssertionKind code: non-string, `null`, or any unrecognized string. */
  | { readonly cause: 'Invalid'; readonly origin: 'record'; readonly reason: 'FieldMalformed:assertionKind' };

export type AssertionKindOutcome =
  | { readonly outcome: 'Matches'; readonly recordKind: string }
  /** A RECOGNIZED kind outside the authored set. Never used for an unrecognized string. */
  | { readonly outcome: 'DoesNotMatch'; readonly reason: 'AssertionKindNotAllowed'; readonly recordKind: string }
  | { readonly outcome: 'Unresolved'; readonly findings: readonly AssertionKindFinding[] };

export type PossibleAssertionKindScope =
  | {
      readonly kind: 'node';
      readonly node: NodeRef;
      readonly candidacy: 'InDomain' | 'Unresolved';
      readonly s2Findings: readonly S2Finding[];
      readonly assertionKind: AssertionKindOutcome;
    }
  | {
      readonly kind: 'node';
      readonly node: NodeRef;
      readonly candidacy: 'OutOfDomain';
      readonly assertionKind: { readonly outcome: 'NotEvaluated'; readonly reason: 'OutOfDomain' };
    }
  | { readonly kind: 'excluded' }
  | { readonly kind: 'unknown' };

export interface KeyAssertionKindScope {
  readonly key: RecordKey;
  readonly s1Status: KeyStatus;
  readonly candidate: boolean;
  /** S1's active causes and defects, unchanged. A match never clears them. */
  readonly inheritedS1Causes: readonly S1Cause[];
  readonly inheritedS1Defects: readonly Defect[];
  readonly possibilities: readonly PossibleAssertionKindScope[];
}

/** Detached and deep-frozen. Deliberately no key-level admissibility decision. */
export interface AssertionKindCheckResult {
  readonly experimental: 'nonclinical-s3-assertion-kind-v0';
  readonly check: 'assertion-kind';
  readonly valueSet: string;
  /** The authored codes, as written (a repeated code is kept here but has no effect). */
  readonly allowedKinds: readonly string[];
  readonly keys: readonly KeyAssertionKindScope[];
}
