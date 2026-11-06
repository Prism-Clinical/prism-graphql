/**
 * EXPERIMENTAL, NONCLINICAL. Public types of isolated program-expression execution (I2).
 *
 * Normative source: first-program-implementation-contract.md §3 (expression semantics), §4 (output
 * shapes), §7 (preview) and §8 (I2). EvidenceQuery results are SUPPLIED by the caller, never
 * computed: this is not end-to-end pathway evaluation and evaluates no patient records.
 */

/** Stage A §4.1 causes, in their canonical order. */
export type Cause = 'Missing' | 'Conflicting' | 'Unavailable' | 'Invalid' | 'Inadmissible' | 'InsufficientEvidence';

/**
 * `Evidence<Boolean>` in the settled fixture shape (evidence-query contract §5.1). IDs use the
 * fixture notation `source/localId@revision` or `…#<64 hex digest>`.
 */
export type SuppliedEvidence =
  | { readonly status: 'Known'; readonly value: boolean; readonly supportingEvidenceIds: readonly string[] }
  | { readonly status: 'Unresolved'; readonly causes: readonly Cause[]; readonly candidateEvidenceIds: readonly string[] };

/** One explicit result per complete EvidenceQuery, keyed by its declaration ID. */
export type SuppliedQueryResults = ReadonlyMap<string, SuppliedEvidence>;

export type DecisionValue =
  | { readonly value: 'True' | 'False' }
  | { readonly value: 'Unknown'; readonly causes: readonly Cause[] };

export interface Marker {
  readonly holes: readonly string[];
}

/** Per-declaration outputs (contract §4). Decisions carry supporting (True/False) or candidate (Unknown) IDs. */
export type DecisionOutput =
  | { readonly decision: DecisionValue; readonly supportingEvidenceIds: readonly string[] }
  | { readonly decision: DecisionValue; readonly candidateEvidenceIds: readonly string[] }
  | { readonly marker: Marker };

export type QueryOutput =
  /** The caller-supplied result, normalized (sets deduplicated and ordered). Not computed here. */
  | { readonly evidence: SuppliedEvidence; readonly origin: 'supplied' }
  /** A holed query in preview: no evidence stage runs and nothing is read. */
  | { readonly marker: Marker; readonly stagesRun: readonly [] };

export type FindingOutput = (
  | { readonly status: DecisionValue; readonly supportingEvidenceIds: readonly string[] }
  | { readonly status: DecisionValue; readonly candidateEvidenceIds: readonly string[] }
  | { readonly status: { readonly marker: Marker } }
) & { readonly urgency?: { readonly marker: Marker } };

export type ProgramOutput = DecisionOutput | QueryOutput | FindingOutput;

/** One evaluated sub-expression, tied to its authored JSON Pointer. */
export interface TraceStep {
  readonly source: string;
  readonly form: 'ref' | 'evidenceValue' | 'all' | 'hole';
  readonly result: string;
  /** The outputs, supplied results or holes this step read. */
  readonly uses: readonly string[];
  readonly because: string;
}

/** One entry per evaluated output (contract §4): `output`, `source`, `result`, `because`, plus its steps. */
export interface TraceEntry {
  readonly output: string;
  readonly source: string;
  readonly result: string;
  readonly because: string;
  readonly steps: readonly TraceStep[];
}

export interface FindingAttributes {
  readonly label: string;
  readonly heading: string | null;
  readonly cites: readonly string[];
}

export type ExecutionInputErrorCode =
  | 'INVALID_PACKAGE'
  | 'INVALID_QUERY_RESULTS'
  | 'MISSING_QUERY_RESULT'
  | 'UNEXPECTED_QUERY_RESULT'
  | 'MALFORMED_QUERY_RESULT'
  | 'RESULT_FOR_HOLED_QUERY';

export interface ExecutionInputError {
  readonly code: ExecutionInputErrorCode;
  readonly query?: string;
  readonly message: string;
}

export interface ExecutionCommon {
  readonly experimental: 'nonclinical-ppl-isolated-execution-v0';
  /** States what ran: program expressions only; every EvidenceQuery result was supplied. */
  readonly scope: 'program-expressions-with-supplied-query-results';
  readonly packageId: string;
  /** Keyed by output name: `<id>` for applicability, Predicate and EvidenceQuery; `<id>` for a Finding (status and attributes). */
  readonly outputs: { readonly [output: string]: ProgramOutput };
  readonly findingAttributes: { readonly [findingId: string]: FindingAttributes };
  readonly trace: readonly TraceEntry[];
}

export type ExecutionResult =
  | (ExecutionCommon & { readonly outcome: 'Executed'; readonly mode: 'normal' })
  | { readonly outcome: 'ExecutionInputError'; readonly errors: readonly ExecutionInputError[] };

export type PreviewExecutionResult =
  | (ExecutionCommon & {
      readonly outcome: 'Executed';
      readonly mode: 'preview';
      readonly publication: 'Blocked';
      readonly markers: readonly { readonly output: string; readonly holes: readonly string[] }[];
      readonly inspectable: { readonly [output: string]: unknown };
    })
  | { readonly outcome: 'ExecutionInputError'; readonly errors: readonly ExecutionInputError[] };
