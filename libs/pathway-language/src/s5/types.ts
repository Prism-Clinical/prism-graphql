/**
 * EXPERIMENTAL, NONCLINICAL. Public types for per-record S5 criterion evaluation (evidence-query
 * contract §3.5). One possibility's `establishes` and `refutes` values and their traces only: no
 * classification (§3.3), no possible classes, materiality or evidence result (S6).
 */
import type { CompiledPackage } from '../compile/types';
import type { JsonValue, NodeRef, RecordKey } from '../s1/types';
import type { Disposition, PossibleSelection, SelectionResult } from '../s4/types';

export interface CriteriaInput {
  /** A CompiledPackage produced by experimentalCompile in this process. Preview packages are rejected. */
  readonly package: CompiledPackage;
  /** The ID of a complete EvidenceQuery declaration in `package`. */
  readonly query: string;
  /** An S4 result experimentalSelectForQuery produced in this process for exactly `package` and `query`. */
  readonly s4: SelectionResult;
  /** One possibility object of `s4` itself (identity, not equality). */
  readonly possibility: PossibleSelection;
}

export type CriterionName = 'establishes' | 'refutes';

/** Patient-data uncertainty of one criterion (S5 attribution reasons, conformance README). */
export type CriterionFinding =
  | { readonly cause: 'Missing'; readonly origin: 'record'; readonly reason: `FieldAbsent:${string}` }
  | { readonly cause: 'Invalid'; readonly origin: 'record'; readonly reason: `FieldMalformed:${string}` };

/** A `Decision`: Unknown carries its findings (code point order of reason). */
export type CriterionValue = { readonly value: 'True' | 'False' } | { readonly value: 'Unknown'; readonly findings: readonly CriterionFinding[] };

/** One evaluated sub-expression, in evaluation order (operands before their operator). */
export type CriterionStep =
  | {
      readonly form: 'field';
      /** JSON Pointer of the authored operand. */
      readonly source: string;
      readonly path: string;
      /** What the payload holds: a declared enum code, nothing, or a malformed value (verbatim). */
      readonly read: { readonly status: 'Present'; readonly value: string } | { readonly status: 'Absent' } | { readonly status: 'Malformed'; readonly value: JsonValue };
    }
  | { readonly form: 'enum'; readonly source: string; readonly value: string }
  | { readonly form: 'eq'; readonly source: string; readonly result: CriterionValue };

export interface CriterionResult {
  readonly criterion: CriterionName;
  /** JSON Pointer of the criterion in the package source. */
  readonly source: string;
  readonly result: CriterionValue;
  readonly trace: readonly CriterionStep[];
}

interface Common {
  readonly experimental: 'nonclinical-s5-criteria-v0';
  readonly stage: 'S5';
  /** What ran: two criteria over one record. Nothing is classified, selected or resolved. */
  readonly scope: 'one-possibility-criteria';
  readonly packageId: string;
  readonly query: string;
  readonly key: RecordKey;
}

export type CriteriaResult =
  | (Common & {
      readonly outcome: 'Evaluated';
      readonly node: NodeRef;
      /** The S4 disposition, unchanged: evaluation never selects. */
      readonly disposition: Disposition;
      /** Evaluated independently; `refutes` is never derived from `establishes`. */
      readonly establishes: CriterionResult;
      readonly refutes: CriterionResult;
    })
  /** Not a criterion value: no payload is read and no False or Unknown is produced. */
  | (Common & {
      readonly outcome: 'NotEvaluated';
      readonly reason: 'Inadmissible' | 'OutOfDomain' | 'ExcludedMarker' | 'UnknownMarker';
      readonly node?: NodeRef;
    });

/**
 * Per-record classification (contract §3.3). `Unclassified` carries the causes of every `Unknown`
 * criterion (Stage A order); their findings and attribution stay in the criterion results.
 */
export type RecordClass =
  | { readonly class: 'Supporting' | 'Refuting' | 'NonInformative' }
  | { readonly class: 'Unclassified'; readonly causes: readonly CriterionFinding['cause'][] };

interface ClassificationTags {
  readonly experimental: 'nonclinical-s5-classification-v0';
  /** One possibility classified. No possible classes, materiality or evidence result (S6). */
  readonly scope: 'one-possibility-classification';
}

/** A criteria result, unchanged apart from its tags, plus the class when it was evaluated. */
export type ClassificationResult =
  | (Omit<Extract<CriteriaResult, { outcome: 'Evaluated' }>, keyof ClassificationTags> & ClassificationTags & { readonly classification: RecordClass })
  /** No class: an ineligible possibility is never NonInformative or Unclassified. */
  | (Omit<Extract<CriteriaResult, { outcome: 'NotEvaluated' }>, keyof ClassificationTags> & ClassificationTags);
