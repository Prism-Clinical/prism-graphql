/**
 * EXPERIMENTAL, NONCLINICAL. Public types for ONE S3 admissibility check: same-encounter scope.
 *
 * Normative source: docs/superpowers/records/pathway-language/evidence-query-to-predicate-contract.md
 * §1.2 (`encounter: Field<EncounterRef>`), §1.6 (evaluation context), §2.2 (the `encounter` rule)
 * and §2.4. This is not the S3 result: matching the encounter does not make a record admissible,
 * and no per-key admissibility decision, evidence result or Need is produced.
 */
import type { Defect, KeyStatus, NodeRef, RecordKey, S1Cause, S1Result } from '../s1/types';
import type { S2Finding, S2Result } from '../s2/types';

/** Stage A §4.1 causes, as an evaluation-context binding may carry them (contract §1.6). */
export type ContextCause = 'Missing' | 'Conflicting' | 'Unavailable' | 'Invalid' | 'Inadmissible' | 'InsufficientEvidence';

/** The evaluation encounter, in the fixtures' context notation (contract §7.1). */
export type EncounterBinding = { readonly known: string } | { readonly unknown: readonly ContextCause[] };

/**
 * The authored rule this check consumes, exactly as written in the query contract's
 * `admissible.encounter` (contract §7.1). It is recognized, not interpreted: any other shape is
 * a configuration error.
 */
export const SAME_ENCOUNTER_RULE = { eq: [{ field: ['c', 'encounter'] }, { ref: 'ctx.encounter' }] } as const;

export interface EncounterCheckInput {
  readonly s1: S1Result;
  /** S2 result computed from the same `s1`. */
  readonly s2: S2Result;
  /** The authored `admissible.encounter` node; must equal SAME_ENCOUNTER_RULE. */
  readonly rule: unknown;
  readonly contextEncounter: EncounterBinding;
}

/** A finding introduced by this check, attributed to the record or to the context binding. */
export type EncounterFinding =
  | { readonly cause: 'Missing'; readonly origin: 'record'; readonly reason: 'FieldAbsent:encounter' }
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
