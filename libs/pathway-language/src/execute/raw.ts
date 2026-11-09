/**
 * EXPERIMENTAL, NONCLINICAL. Bounded I6 slices: one compiled program with one or more complete
 * EvidenceQueries, executed over their evidence COMPUTED from raw records (first-program contract
 * §8 I6, "Raw-input execution boundary").
 *
 * The queries and every authored setting come from the compiled package; the caller gives only one
 * runtime envelope, shared by every query. For each query, S1–S4 run in `selectForQuery` from that
 * query's own contract, and S6 in `queryEvidence`; nothing is shared between queries except the
 * runtime inputs. The program runs in the isolated executor's own evaluator, given those evidence
 * objects unchanged.
 *
 * Identity: the evaluator is generic over the reference type, so references stay structured
 * `NodeRef`s (variant digests included) through `evidenceValue`, `all`, Predicates and Findings, and
 * are deduplicated and ordered by `compareNodes` (contract §5.3). Display labels appear only in trace
 * text. No token or string bridge exists.
 *
 * No Need, acquisition or multi-query preview runs here.
 *
 * `executePreviewFromRawRecords` is the preview counterpart (first-program contract §8, "Raw-input
 * preview boundary"): one PreviewPackage with exactly one query. A holed query runs the existing
 * preview-query evaluator and stays a marker (no Evidence<Boolean>). A complete query runs the full
 * S1–S6 pipeline through a private selection bound to the exact preview package and query
 * (`selectForPreviewCompleteQuery`). Either way the same program evaluator keeps every authoring
 * marker through its dependent expressions, and publication stays blocked.
 */
import { compiledKind, contractHoles, detach } from '../compile/compile';
import type { CompiledPackage } from '../compile/types';
import { checkSnapshot, selectForPreviewCompleteQuery, selectForQuery, QuerySelectionConfigurationError, type EvaluationSnapshot, type QuerySelectionInput } from '../bound';
import type { PreviewPackage } from '../compile/types';
import { evaluatePreviewQuery, PreviewEvaluationConfigurationError, type PreviewQueryResult } from '../preview';
import type { NodeRef } from '../s1/types';
import { compareNodes } from '../s6/base';
import { compareCodePoints } from '../s1/resolve';
import { queryEvidence, QueryEvidenceConfigurationError, type QueryEvidence, type QueryEvidenceResult } from '../s6/evidence';
import { evaluateProgram, type RefOps } from './execute';
import type { DecisionValue, FindingAttributes, Marker, TraceEntry } from './types';

/** Invalid API input or unsupported program scope. Never patient uncertainty. */
export class RawExecutionConfigurationError extends Error {}

/** The runtime inputs of query-bound selection. The query, sources, authority, terminology, admissibility, criteria and policy come from the package. */
export type RawExecutionInput = Omit<QuerySelectionInput, 'package' | 'query' | 'snapshot'> & { readonly snapshot: NonNullable<QuerySelectionInput['snapshot']> };

/** Decision outputs with structured references. */
export type RawDecisionOutput =
  | { readonly decision: DecisionValue; readonly supportingEvidenceIds: readonly NodeRef[] }
  | { readonly decision: DecisionValue; readonly candidateEvidenceIds: readonly NodeRef[] };
export type RawFindingOutput = (
  | { readonly status: DecisionValue; readonly supportingEvidenceIds: readonly NodeRef[] }
  | { readonly status: DecisionValue; readonly candidateEvidenceIds: readonly NodeRef[] }
) & { readonly urgency?: { readonly marker: Marker } };
/** The query's output is the computed evidence object itself (with `provenance` when Known). */
export type RawQueryOutput = { readonly evidence: QueryEvidence; readonly origin: 'computed' };
export type RawProgramOutput = RawDecisionOutput | RawFindingOutput | RawQueryOutput;

interface RawExecutionCommon {
  readonly outcome: 'Executed';
  readonly experimental: 'nonclinical-ppl-raw-input-execution-v0';
  readonly mode: 'normal';
  readonly packageId: string;
  /** The one snapshot ID every query read. */
  readonly snapshot: string;
  readonly outputs: { readonly [output: string]: RawProgramOutput };
  readonly findingAttributes: { readonly [findingId: string]: FindingAttributes };
  /** Program trace (contract §4). `result` and `because` are display text; identities are in `outputs`. */
  readonly trace: readonly TraceEntry[];
}

/**
 * Discriminated by `scope`. A one-query program keeps the original shape exactly; a program with
 * several queries has no singular `query`/`queryEvidence` and lists every query's result instead.
 */
export type RawExecutionResult = RawExecutionCommon & (
  | {
      readonly scope: 'one-query-program-from-raw-records';
      readonly query: string;
      /** The `experimentalQueryEvidence` result the program read, unchanged (its S6 trace included). */
      readonly queryEvidence: QueryEvidenceResult;
      readonly notRun: readonly ['Needs', 'Acquisition', 'Preview', 'MultiQuery'];
    }
  | {
      readonly scope: 'multi-query-program-from-raw-records';
      /** Every EvidenceQuery ID of the package, code-point order. */
      readonly queries: readonly string[];
      /**
       * One `experimentalQueryEvidence` result per query, unchanged (its own `query`, evidence,
       * provenance and S6 trace), in the order of `queries`. A list, not an object keyed by ID.
       */
      readonly queryEvidenceResults: readonly QueryEvidenceResult[];
      readonly notRun: readonly ['Needs', 'Acquisition', 'Preview'];
    }
);
export type RawSingleQueryExecutionResult = Extract<RawExecutionResult, { readonly scope: 'one-query-program-from-raw-records' }>;
export type RawMultiQueryExecutionResult = Extract<RawExecutionResult, { readonly scope: 'multi-query-program-from-raw-records' }>;

const RUNTIME_FIELDS = ['subject', 'revisions', 'retractions', 'contextEncounter', 'contextEpisode', 'snapshot'];

const nodeLabel = (n: NodeRef) => `${n.revision.source}/${n.revision.localId}@${n.revision.revision}${n.digest ? `#${n.digest}` : ''}`;
/** Structured identity (§5.3 tuple, digest included); the label is display only. */
const NODE_REFS: RefOps<NodeRef> = { compare: compareNodes, label: nodeLabel };

export function executeFromRawRecords(pkg: CompiledPackage, input: RawExecutionInput): RawExecutionResult {
  const fail = (m: string): never => {
    throw new RawExecutionConfigurationError(m);
  };
  const kind = compiledKind(pkg);
  if (kind === 'PreviewPackage') fail('preview packages are not executed here');
  if (kind !== 'CompiledPackage') fail('expected a CompiledPackage produced by experimentalCompile in this process');
  if (input === null || typeof input !== 'object') fail('input must be an object');
  const extra = Object.keys(input).filter((k) => !RUNTIME_FIELDS.includes(k));
  // In particular a query, supplied results, evidence, decisions, stage results, IDs or authored settings.
  if (extra.length > 0) fail(`unexpected input field(s) ${extra.join(', ')}; the query and its answer come only from the package and the raw records`);
  if (input.snapshot === undefined) fail('a snapshot is required: query evidence needs its coverage, failure and rejected-item statements');
  const queries = pkg.declarations.filter((d) => d.kind === 'EvidenceQuery');
  if (queries.length === 0) fail('this slice executes one or more EvidenceQueries; the package has 0');
  for (const q of queries) if (contractHoles(q.contract).length > 0) fail(`'${q.id}' is not complete`);
  if (!Array.isArray(input.revisions) || !Array.isArray(input.retractions)) fail('revisions and retractions must be arrays');

  // One evaluation input for every query: the snapshot validated and detached once, and the record
  // lists fixed once (slice keeps array holes, so S1 still sees them). Records and contexts are read
  // by each query's own S1/S3, which validate and detach what they keep.
  const shared = Object.freeze({
    subject: input.subject,
    revisions: Object.freeze(input.revisions.slice()),
    retractions: Object.freeze(input.retractions.slice()),
    contextEncounter: input.contextEncounter,
    contextEpisode: input.contextEpisode,
    snapshot: checkSnapshot(input.snapshot, fail),
  });

  // Every query, each from its own contract: a fresh selection and S6 per query, nothing reused.
  // Any configuration error fails the whole call; no partial program is returned.
  const results: QueryEvidenceResult[] = [];
  try {
    for (const q of queries) {
      const s4 = selectForQuery({ ...shared, package: pkg, query: q.id });
      results.push(queryEvidence({ package: pkg, query: q.id, s4 }));
    }
  } catch (e) {
    if (e instanceof QuerySelectionConfigurationError || e instanceof QueryEvidenceConfigurationError) fail(e.message);
    throw e;
  }
  // A Map: query IDs such as `__proto__` stay ordinary keys.
  const program = evaluateProgram(pkg, new Map(results.map((r) => [r.query, r.evidence])), NODE_REFS, 'computed');
  const common = {
    outcome: 'Executed',
    experimental: 'nonclinical-ppl-raw-input-execution-v0',
    mode: 'normal',
    packageId: pkg.packageId,
    snapshot: shared.snapshot.id,
    ...program,
  } as const;
  if (results.length === 1) {
    return detach({ ...common, scope: 'one-query-program-from-raw-records', query: results[0]!.query, queryEvidence: results[0]!, notRun: ['Needs', 'Acquisition', 'Preview', 'MultiQuery'] } as unknown as RawExecutionResult);
  }
  const ordered = [...results].sort((a, b) => compareCodePoints(a.query, b.query));
  return detach({
    ...common,
    scope: 'multi-query-program-from-raw-records',
    queries: ordered.map((r) => r.query),
    queryEvidenceResults: ordered,
    notRun: ['Needs', 'Acquisition', 'Preview'],
  } as unknown as RawExecutionResult);
}

// ---------- preview (bounded I6 slice: one query, holed or complete)

/** Invalid API input or unsupported preview scope. Never an authoring marker and never patient uncertainty. */
export class RawPreviewConfigurationError extends Error {}

/** A holed query's program output: its marker and the stages its preview-query evaluation actually ran. */
export type RawPreviewQueryOutput = { readonly marker: Marker; readonly stagesRun: readonly [] | readonly ['S1', 'S2', 'S3', 'S4', 'S5'] };
export type RawPreviewOutput =
  | RawPreviewQueryOutput
  | RawQueryOutput
  | { readonly marker: Marker }
  | RawDecisionOutput
  | RawFindingOutput
  | { readonly status: { readonly marker: Marker }; readonly urgency?: { readonly marker: Marker } };

/** Not run for a holed query. Evidence stages missing from `stagesRun` are listed first. */
const PREVIEW_NOT_RUN = ['Classification', 'PossibleClasses', 'S6', 'QueryEvidence', 'Needs', 'Acquisition', 'MultiQuery'] as const;
const COMPLETE_STAGES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const;

interface RawPreviewCommon {
  readonly outcome: 'Executed';
  readonly experimental: 'nonclinical-ppl-raw-input-preview-v0';
  readonly scope: 'one-query-program-preview-from-raw-records';
  readonly mode: 'preview';
  readonly publication: 'Blocked';
  readonly packageId: string;
  readonly query: string;
  /** The snapshot ID. */
  readonly snapshot: string;
  /** The compiler's static markers and inspectable attributes, unchanged. */
  readonly markers: PreviewPackage['markers'];
  readonly inspectable: PreviewPackage['inspectable'];
  readonly outputs: { readonly [output: string]: RawPreviewOutput };
  readonly findingAttributes: { readonly [findingId: string]: FindingAttributes };
  /** Program trace. The query's entry states what ran; its stage results are in `previewQuery` or `queryEvidence`. */
  readonly trace: readonly TraceEntry[];
  readonly notRun: readonly string[];
  readonly remainingScope: string;
}

/**
 * Discriminated by the query's AUTHORING state, read from the compiled contract; never by whether
 * its evidence is Known (a complete query can be Unresolved for this patient).
 */
export type RawPreviewResult = RawPreviewCommon & (
  | {
      /** The query has an authoring hole: partial results and markers only, no Evidence<Boolean>. */
      readonly queryAuthoring: 'Incomplete';
      /** Validated as input only: no S6 coverage resolution ran. */
      readonly snapshotStatements: 'ValidatedNotRead';
      /** The `experimentalEvaluatePreviewQuery` result of these inputs, unchanged (structured NodeRefs). */
      readonly previewQuery: PreviewQueryResult;
      readonly stagesRun: PreviewQueryResult['stagesRun'];
    }
  | {
      /** The query is complete: its evidence was computed by the full pipeline. */
      readonly queryAuthoring: 'Complete';
      /** Coverage, failure and rejected-item statements were read by S6 gap relevance. */
      readonly snapshotStatements: 'ReadByS6';
      /** The query evidence result the program read, unchanged (its S6 trace included). */
      readonly queryEvidence: QueryEvidenceResult;
      readonly stagesRun: typeof COMPLETE_STAGES;
    }
);

export function executePreviewFromRawRecords(pkg: PreviewPackage, input: RawExecutionInput): RawPreviewResult {
  const fail = (m: string): never => {
    throw new RawPreviewConfigurationError(m);
  };
  const kind = compiledKind(pkg);
  if (kind === 'CompiledPackage') fail('a CompiledPackage is executed by experimentalExecuteFromRawRecords; this entry point takes a PreviewPackage');
  if (kind !== 'PreviewPackage') fail('expected a PreviewPackage produced by experimentalCompilePreview in this process');
  if (input === null || typeof input !== 'object') fail('input must be an object');
  const extra = Object.keys(input).filter((k) => !RUNTIME_FIELDS.includes(k));
  // In particular a query, supplied results, markers, decisions, stage results, token maps or authored settings.
  if (extra.length > 0) fail(`unexpected input field(s) ${extra.join(', ')}; the query, its markers and settings come only from the package`);
  if (input.snapshot === undefined) fail('a snapshot is required');
  const snapshot: EvaluationSnapshot = checkSnapshot(input.snapshot, fail);
  const queries = pkg.declarations.filter((d) => d.kind === 'EvidenceQuery');
  if (queries.length !== 1) fail(`this slice previews exactly one EvidenceQuery; the package has ${queries.length}`);
  const q = queries[0]!;
  const common = {
    outcome: 'Executed',
    experimental: 'nonclinical-ppl-raw-input-preview-v0',
    scope: 'one-query-program-preview-from-raw-records',
    mode: 'preview',
    publication: 'Blocked',
    packageId: pkg.packageId,
    query: q.id,
    snapshot: snapshot.id,
    markers: pkg.markers,
    inspectable: pkg.inspectable,
  } as const;
  const remainingScope = 'Exactly one EvidenceQuery, holed or complete. Programs with zero or several queries, Needs and acquisition are not executed here.';

  // The branch is the query's authoring state only; holes elsewhere in the program do not affect it.
  if (contractHoles(q.contract).length === 0) {
    let ev: QueryEvidenceResult;
    try {
      const s4 = selectForPreviewCompleteQuery(pkg, q.id, { ...input, snapshot }, fail);
      // Type-level only: the runtime gate (queryContract) accepts this PreviewPackage solely with the s4 bound to it above.
      ev = queryEvidence({ package: pkg as unknown as CompiledPackage, query: q.id, s4 });
    } catch (e) {
      if (e instanceof QuerySelectionConfigurationError || e instanceof QueryEvidenceConfigurationError) fail(e.message);
      throw e;
    }
    const program = evaluateProgram<NodeRef>(pkg, new Map([[q.id, ev.evidence]]), NODE_REFS, 'computed');
    return detach({
      ...common,
      ...program,
      queryAuthoring: 'Complete',
      snapshotStatements: 'ReadByS6',
      queryEvidence: ev,
      stagesRun: COMPLETE_STAGES,
      notRun: ['Needs', 'Acquisition', 'MultiQuery'],
      remainingScope,
    } as unknown as RawPreviewResult);
  }

  let pq: PreviewQueryResult;
  try {
    const { snapshot: _validated, ...runtime } = input;
    pq = evaluatePreviewQuery({ ...runtime, package: pkg, query: q.id });
  } catch (e) {
    if (e instanceof PreviewEvaluationConfigurationError || e instanceof QuerySelectionConfigurationError) fail(e.message);
    throw e;
  }
  // No query evidence exists: the only query is holed, so the evaluator receives none and keeps the marker.
  const program = evaluateProgram<NodeRef>(pkg, new Map(), NODE_REFS, 'computed', new Map([[q.id, pq.stagesRun]]));
  const ran: readonly string[] = pq.stagesRun;
  return detach({
    ...common,
    ...program,
    queryAuthoring: 'Incomplete',
    snapshotStatements: 'ValidatedNotRead',
    previewQuery: pq,
    stagesRun: pq.stagesRun,
    notRun: [...['S1', 'S2', 'S3', 'S4', 'S5'].filter((x) => !ran.includes(x)), ...PREVIEW_NOT_RUN],
    remainingScope,
  } as unknown as RawPreviewResult);
}
export type RawPreviewIncompleteResult = Extract<RawPreviewResult, { readonly queryAuthoring: 'Incomplete' }>;
export type RawPreviewCompleteResult = Extract<RawPreviewResult, { readonly queryAuthoring: 'Complete' }>;
