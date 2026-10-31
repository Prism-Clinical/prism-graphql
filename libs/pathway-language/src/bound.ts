/**
 * EXPERIMENTAL, NONCLINICAL. Query-bound evidence selection (evidence-query contract §2.8, §3.5,
 * "Query-to-evidence association").
 *
 * The only way to obtain an S4 result that S5 will evaluate. Every authored setting comes from ONE
 * compiled EvidenceQuery; the caller supplies only runtime inputs (the patient subject, the raw
 * snapshot and the evaluation context). S1 is constructed here because an S1 result retains no
 * envelope or authority provenance that could be verified against a query: record type, sources and
 * the correction authority rule are taken from the contract, never from the caller. The produced
 * S4 result is privately bound to the exact package object and query ID. The standalone stage APIs
 * stay available for isolated tests, but their results carry no binding.
 *
 * Evaluation association (contract §1.5, §4.1): the same call may carry the current snapshot's
 * identity and its coverage, acquisition-failure and rejected-item statements. They are detached
 * and recorded privately against the produced S4 result, together with the subject and the S1
 * result of this very run, so gap relevance reads one evaluation's inputs and never reattaches
 * statements or S1 rejected items afterwards by matching identifiers.
 */
import { compiledKind, detach } from './compile/compile';
import type { CompiledPackage, ExplicitAssertionContract, ExplicitAssertionSettings } from './compile/types';
import { jsonValueProblem } from './s1/payload';
import { resolveRevisionHistory } from './s1/resolve';
import type { JsonValue, S1Result } from './s1/types';
import { checkAdmissibility } from './s3/admissibility';
import type { EncounterBinding, EpisodeBinding } from './s3/types';
import { select } from './s4/select';
import type { SelectionResult } from './s4/types';
import type { ValueSetExpansion } from './s2/types';

/** Invalid API input, including an attempt to override authored configuration. Never patient uncertainty. */
export class QuerySelectionConfigurationError extends Error {}

/** Runtime inputs only: there is no field for a value set, expansion, rule, envelope, authority or earlier-stage result. */
export interface QuerySelectionInput {
  /** A CompiledPackage produced by experimentalCompile in this process. */
  readonly package: CompiledPackage;
  /** The ID of a complete EvidenceQuery declaration in `package`. */
  readonly query: string;
  /** The patient the snapshot is about (the S1 envelope's subject). */
  readonly subject: string;
  readonly revisions: readonly JsonValue[];
  readonly retractions: readonly JsonValue[];
  readonly contextEncounter: EncounterBinding;
  readonly contextEpisode: EpisodeBinding;
  /**
   * Optional: the current snapshot's identity and its coverage, failure and rejected-item
   * statements, in the contract §1.5 format. Required by experimentalGapRelevance. Omitted means
   * the evaluation has no gap information, never that coverage is complete.
   */
  readonly snapshot?: EvaluationSnapshot;
}

/** Contract §1.5 statements of one current snapshot. Each entry must be an object with a string `id`. */
export interface EvaluationSnapshot {
  /** The current snapshot ID; statements whose `appliesTo.snapshot` differs are not current. */
  readonly id: string;
  readonly coverage: readonly JsonValue[];
  readonly failures: readonly JsonValue[];
  readonly rejectedItems: readonly JsonValue[];
}

const INPUT_FIELDS = ['package', 'query', 'subject', 'revisions', 'retractions', 'contextEncounter', 'contextEpisode', 'snapshot'];
/** Preview evaluation takes no gap information (gap relevance is outside preview). */
export const PREVIEW_INPUT_FIELDS = INPUT_FIELDS.filter((f) => f !== 'snapshot');
const SNAPSHOT_FIELDS = ['id', 'coverage', 'failures', 'rejectedItems'] as const;

/** The runtime part of a query-bound input (patient subject, raw snapshot, evaluation context). */
type RuntimeInput = Pick<QuerySelectionInput, 'subject' | 'revisions' | 'retractions' | 'contextEncounter' | 'contextEpisode'>;

/** INTERNAL, shared with preview evaluation: an object with no field outside `fields`. */
export function checkInputFields(input: unknown, fail: (m: string) => never, fields: readonly string[] = INPUT_FIELDS): void {
  if (input === null || typeof input !== 'object') fail('input must be an object');
  const extra = Object.keys(input as object).filter((k) => !fields.includes(k));
  // In particular valueSet, expansion, admissible, envelope, authorityRule, s1 or s3: authored
  // configuration comes only from the compiled query, and no precomputed stage result is accepted.
  if (extra.length > 0) fail(`unexpected input field(s) ${extra.join(', ')}; authored configuration comes only from the compiled query`);
}

/**
 * INTERNAL, shared with preview evaluation: S1–S4 from one query's validated settings and runtime
 * inputs only. S1 is constructed here from the settings, never accepted. The result is unbound.
 */
export function selectWithSettings(settings: ExplicitAssertionSettings, valueSets: { readonly [id: string]: ValueSetExpansion }, input: RuntimeInput, fail: (m: string) => never): { readonly s1: S1Result; readonly s4: SelectionResult } {
  if (typeof input.subject !== 'string') fail('subject must be a string');
  if (!Array.isArray(input.revisions) || !Array.isArray(input.retractions)) fail('revisions and retractions must be arrays');
  const s1 = resolveRevisionHistory({
    envelope: { recordType: settings.recordType, subject: input.subject, sources: settings.sources },
    authorityRule: settings.authorityRule as never,
    revisions: input.revisions,
    retractions: input.retractions,
  });
  const s3 = checkAdmissibility({
    s1,
    valueSet: settings.valueSet,
    expansion: valueSets[settings.valueSet]!,
    // The compiled rules: encounter and episode verbatim, assertionKind as its validated `in` list.
    admissible: { encounter: settings.admissible.encounter, episode: settings.admissible.episode, assertionKind: { in: settings.admissible.assertionKinds } },
    contextEncounter: input.contextEncounter,
    contextEpisode: input.contextEpisode,
  });
  return { s1, s4: select({ s3 }) };
}

/**
 * Structural validation only: these are configuration errors (no identity to trace or deduplicate).
 * Malformed statement *content* (status, outcome, dimensions, appliesTo) is evidence for gap
 * relevance to judge, never a reason to throw or to drop the statement.
 */
function checkSnapshot(v: unknown, fail: (m: string) => never): EvaluationSnapshot {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return fail('snapshot must be an object');
  const keys = Object.keys(v);
  const extra = keys.filter((k) => !(SNAPSHOT_FIELDS as readonly string[]).includes(k));
  if (extra.length > 0) fail(`unexpected snapshot field(s) ${extra.join(', ')}`);
  const missing = SNAPSHOT_FIELDS.filter((k) => !keys.includes(k));
  // A missing list is never read as "no gaps": coverage, failures and rejected items are all explicit.
  if (missing.length > 0) fail(`snapshot must state ${missing.join(', ')} explicitly (an empty list is allowed; an omitted one is not)`);
  const s = v as EvaluationSnapshot;
  if (typeof s.id !== 'string') fail('snapshot.id must be a string');
  for (const f of ['coverage', 'failures', 'rejectedItems'] as const) {
    if (!Array.isArray(s[f])) fail(`snapshot.${f} must be an array`);
    // Strict JSON first, so canonicalization and deduplication only ever see plain JSON values.
    const problem = jsonValueProblem(s[f], `snapshot.${f}`);
    if (problem) fail(`${problem}; snapshot statements must be plain JSON values`);
    s[f].forEach((x, i) => {
      if (x === null || typeof x !== 'object' || Array.isArray(x) || typeof (x as { id?: unknown }).id !== 'string') fail(`snapshot.${f}[${i}] must be an object with a string id`);
    });
  }
  return detach(s);
}

/** What one bound selection was produced from: subject, its own S1 result and, if given, its snapshot statements. */
export interface SelectionEvaluation {
  readonly subject: string;
  readonly settings: ExplicitAssertionSettings;
  readonly s1: S1Result;
  readonly snapshot: EvaluationSnapshot | null;
}
const evaluations = new WeakMap<object, SelectionEvaluation>();

/** INTERNAL: the evaluation inputs recorded for a bound S4 result, or undefined. */
export const selectionEvaluation = (s4: unknown) => (typeof s4 === 'object' && s4 !== null ? evaluations.get(s4) : undefined);

/** The exact package object and query ID each bound S4 result was produced for. */
const bindings = new WeakMap<object, { readonly package: object; readonly query: string }>();

/** INTERNAL: the binding of `s4`, or undefined for an unbound, copied or fabricated result. */
export const selectionQuery = (s4: unknown) => (typeof s4 === 'object' && s4 !== null ? bindings.get(s4) : undefined);

/** The complete contract of `query` in an authentic CompiledPackage, or `fail`. Shared with S5. */
export function queryContract(pkg: unknown, query: unknown, fail: (m: string) => never): ExplicitAssertionContract {
  const kind = compiledKind(pkg);
  // Holes are authoring state, not patient uncertainty: preview is outside this slice (§6.1).
  if (kind === 'PreviewPackage') fail('preview packages are not evaluated here; authoring holes are never Missing or False');
  if (kind !== 'CompiledPackage') fail('package must be a CompiledPackage produced by experimentalCompile in this process');
  const decl = (pkg as CompiledPackage).declarations.find((d) => d.id === query);
  if (!decl || decl.kind !== 'EvidenceQuery') return fail(`query ${JSON.stringify(query)} is not an EvidenceQuery of the package`);
  if (decl.contract.kind !== 'explicit-assertion-v0') return fail(`query ${String(query)} has no complete contract`); // unreachable: compile() checks every contract is complete
  return decl.contract;
}

export function selectForQuery(input: QuerySelectionInput): SelectionResult {
  const fail = (m: string): never => {
    throw new QuerySelectionConfigurationError(m);
  };
  checkInputFields(input, fail);
  const contract = queryContract(input.package, input.query, fail);
  const snapshot = 'snapshot' in input && input.snapshot !== undefined ? checkSnapshot(input.snapshot, fail) : null;
  const { s1, s4 } = selectWithSettings(contract, input.package.valueSets, input, fail);
  bindings.set(s4, { package: input.package, query: input.query });
  evaluations.set(s4, { subject: input.subject, settings: contract, s1, snapshot });
  return s4;
}
