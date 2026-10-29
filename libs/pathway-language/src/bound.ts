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
 */
import { compiledKind } from './compile/compile';
import type { CompiledPackage, ExplicitAssertionContract } from './compile/types';
import { resolveRevisionHistory } from './s1/resolve';
import type { JsonValue } from './s1/types';
import { checkAdmissibility } from './s3/admissibility';
import type { EncounterBinding, EpisodeBinding } from './s3/types';
import { select } from './s4/select';
import type { SelectionResult } from './s4/types';

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
}

const INPUT_FIELDS = ['package', 'query', 'subject', 'revisions', 'retractions', 'contextEncounter', 'contextEpisode'];

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
  if (input === null || typeof input !== 'object') fail('input must be an object');
  const extra = Object.keys(input).filter((k) => !INPUT_FIELDS.includes(k));
  // In particular valueSet, expansion, admissible, envelope, authorityRule, s1 or s3: authored
  // configuration comes only from the compiled query, and no precomputed stage result is accepted.
  if (extra.length > 0) fail(`unexpected input field(s) ${extra.join(', ')}; authored configuration comes only from the compiled query`);
  const contract = queryContract(input.package, input.query, fail);
  if (typeof input.subject !== 'string') fail('subject must be a string');
  if (!Array.isArray(input.revisions) || !Array.isArray(input.retractions)) fail('revisions and retractions must be arrays');
  const s1 = resolveRevisionHistory({
    envelope: { recordType: contract.recordType, subject: input.subject, sources: contract.sources },
    authorityRule: contract.authorityRule as never,
    revisions: input.revisions,
    retractions: input.retractions,
  });
  const s3 = checkAdmissibility({
    s1,
    valueSet: contract.valueSet,
    expansion: input.package.valueSets[contract.valueSet]!,
    // The compiled rules: encounter and episode verbatim, assertionKind as its validated `in` list.
    admissible: { encounter: contract.admissible.encounter, episode: contract.admissible.episode, assertionKind: { in: contract.admissible.assertionKinds } },
    contextEncounter: input.contextEncounter,
    contextEpisode: input.contextEpisode,
  });
  const s4 = select({ s3 });
  bindings.set(s4, { package: input.package, query: input.query });
  return s4;
}
