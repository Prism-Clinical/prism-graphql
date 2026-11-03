/**
 * EXPERIMENTAL, NONCLINICAL. A bounded I6 slice: one compiled program with exactly one complete
 * EvidenceQuery, executed over that query's evidence COMPUTED from raw records (first-program
 * contract §8 I6, "Raw-input execution boundary").
 *
 * The query and every authored setting come from the compiled package; the caller gives only the
 * runtime inputs of query-bound selection. S1–S4 run in `selectForQuery`, S6 in `queryEvidence`, and
 * the program runs in the isolated executor's own evaluator, given that evidence object unchanged.
 *
 * Identity: the evaluator is generic over the reference type, so references stay structured
 * `NodeRef`s (variant digests included) through `evidenceValue`, `all`, Predicates and Findings, and
 * are deduplicated and ordered by `compareNodes` (contract §5.3). Display labels appear only in trace
 * text. No token or string bridge exists.
 *
 * No Need, acquisition, preview or multi-query execution runs here.
 */
import { compiledKind, contractHoles, detach } from '../compile/compile';
import type { CompiledPackage } from '../compile/types';
import { selectForQuery, QuerySelectionConfigurationError, type QuerySelectionInput } from '../bound';
import type { NodeRef } from '../s1/types';
import { compareNodes } from '../s6/base';
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

export interface RawExecutionResult {
  readonly outcome: 'Executed';
  readonly experimental: 'nonclinical-ppl-raw-input-execution-v0';
  readonly scope: 'one-query-program-from-raw-records';
  readonly mode: 'normal';
  readonly packageId: string;
  readonly query: string;
  readonly snapshot: string;
  readonly outputs: { readonly [output: string]: RawProgramOutput };
  readonly findingAttributes: { readonly [findingId: string]: FindingAttributes };
  /** Program trace (contract §4). `result` and `because` are display text; identities are in `outputs`. */
  readonly trace: readonly TraceEntry[];
  /** The `experimentalQueryEvidence` result the program read, unchanged (its S6 trace included). */
  readonly queryEvidence: QueryEvidenceResult;
  readonly notRun: readonly ['Needs', 'Acquisition', 'Preview', 'MultiQuery'];
}

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
  if (queries.length !== 1) fail(`this slice executes exactly one EvidenceQuery; the package has ${queries.length}`);
  const q = queries[0]!;
  if (contractHoles(q.contract).length > 0) fail(`'${q.id}' is not complete`);

  let ev: QueryEvidenceResult;
  try {
    const s4 = selectForQuery({ ...input, package: pkg, query: q.id });
    ev = queryEvidence({ package: pkg, query: q.id, s4 });
  } catch (e) {
    if (e instanceof QuerySelectionConfigurationError || e instanceof QueryEvidenceConfigurationError) fail(e.message);
    throw e;
  }
  const program = evaluateProgram(pkg, new Map([[q.id, ev.evidence]]), NODE_REFS, 'computed');
  return detach({
    outcome: 'Executed',
    experimental: 'nonclinical-ppl-raw-input-execution-v0',
    scope: 'one-query-program-from-raw-records',
    mode: 'normal',
    packageId: pkg.packageId,
    query: q.id,
    snapshot: ev.snapshot,
    ...program,
    queryEvidence: ev,
    notRun: ['Needs', 'Acquisition', 'Preview', 'MultiQuery'],
  } as unknown as RawExecutionResult);
}
