/**
 * EXPERIMENTAL, NONCLINICAL. I7 identity sub-slice: contract digest and structured Need key.
 *
 * Normative source: docs/superpowers/records/pathway-language/need-identity-proposal.md (sections
 * 1–3, decisions O1–O5). This constructs an identity only. It does not decide whether a Need exists,
 * evaluate patient evidence, or create Needs, obligations, placeholders or partial keys.
 *
 * Every authored setting and the package namespace come from the authentic compiled package; the
 * caller supplies only the query ID, the subject and the two context bindings. Malformed input is a
 * NeedIdentityConfigurationError, never an unresolved binding or an authoring outcome.
 */
import { createHash } from 'node:crypto';
import { compiledKind, contractHoles, detach } from './compile/compile';
import type { CompiledDeclaration, CompiledPackage, CompiledProgram, ExplicitAssertionContract, PreviewPackage } from './compile/types';
import { capture } from './execute/raw';
import { canonicalJson, jsonValueProblem } from './s1/payload';
import type { JsonValue } from './s1/types';
import type { Code } from './s2/types';
import { checkContext as checkEncounter } from './s3/encounter';
import { checkContext as checkEpisode } from './s3/episode';
import type { EncounterBinding, EpisodeBinding } from './s3/types';

/** Invalid API input. Never patient uncertainty, never an authoring marker. */
export class NeedIdentityConfigurationError extends Error {}

/** Proposal 2.4: the digest scheme. Any change to the projection, normalization or hashing needs a new value. */
export const CONTRACT_DIGEST_SCHEME = 'ppl-query-contract-digest/0';

export interface ContractDigest {
  readonly scheme: typeof CONTRACT_DIGEST_SCHEME;
  /** SHA-256 of the UTF-8 RFC 8785 bytes of the normalized projection, 64 lower-case hex characters. */
  readonly sha256: string;
}

/** Proposal section 3. Identity is the RFC 8785 bytes of this object; no component is joined with a delimiter. */
export interface NeedKey {
  /** The compiled `packageId` (a versionless namespace) and the EvidenceQuery declaration ID. */
  readonly query: { readonly package: string; readonly id: string };
  readonly contractDigest: ContractDigest;
  readonly subject: string;
  readonly episode: string;
  readonly encounter: string;
}

/** Runtime identity bindings only: no digest, projection, namespace or authored setting is accepted. */
export interface NeedIdentityInput {
  /** A CompiledPackage or PreviewPackage produced by the compiler in this process (not a copy). */
  readonly package: CompiledPackage | PreviewPackage;
  /** The ID of an EvidenceQuery declaration of exactly that package. */
  readonly query: string;
  readonly subject: string;
  readonly contextEpisode: EpisodeBinding;
  readonly contextEncounter: EncounterBinding;
}

export type UnresolvedBinding = 'episode' | 'encounter';

/** Proposal section 1: exactly one of the three members. Detached and deep-frozen. */
export type NeedIdentityResult =
  | { readonly key: NeedKey }
  | { readonly noContractIdentity: { readonly holes: readonly string[] } }
  | { readonly unresolvedBindings: readonly UnresolvedBinding[] };

const INPUT_FIELDS = ['package', 'query', 'subject', 'contextEpisode', 'contextEncounter'] as const;

type EvidenceQueryDeclaration = Extract<CompiledDeclaration<ExplicitAssertionContract>, { kind: 'EvidenceQuery' }>;

/** UTF-16 code-unit order (proposal 2.3), never locale-sensitive. */
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedSet = (xs: readonly string[]) => [...new Set(xs)].sort(byCodeUnits);
/** Exact duplicates removed, then sorted by system, then code. */
function normalizedExpansion(xs: readonly Code[]): Code[] {
  const unique = new Map<string, Code>();
  for (const { system, code } of xs) unique.set(JSON.stringify([system, code]), { system, code });
  return [...unique.values()].sort((a, b) => byCodeUnits(a.system, b.system) || byCodeUnits(a.code, b.code));
}
const criterion = (c: ExplicitAssertionContract['establishes']) => ({ field: c.field, enumType: c.enumType, value: c.value });

/**
 * INTERNAL (tests): the normalized digest projection of one complete EvidenceQuery (proposal 2.1,
 * 2.3). Only the listed members; package namespace, query ID, runtime bindings, locations, cites,
 * the frozen source copy and every other declaration are excluded by construction.
 */
export function contractDigestProjection(program: Pick<CompiledProgram, 'languageVersion' | 'capabilityProfileVersion' | 'valueSets'>, decl: EvidenceQueryDeclaration): JsonValue {
  const c = decl.contract;
  const vs = program.valueSets[c.valueSet];
  // Unreachable for a compiled package: the compiler resolves every pin.
  if (!vs) throw new Error(`value set ${c.valueSet} is not in the package`);
  return {
    scheme: CONTRACT_DIGEST_SCHEME,
    languageVersion: program.languageVersion,
    capabilityProfileVersion: program.capabilityProfileVersion,
    declaration: { kind: decl.kind, subject: decl.subject, output: decl.output },
    policy: c.kind,
    retrieve: {
      recordType: c.recordType,
      sources: sortedSet(c.sources),
      valueSet: { id: c.valueSet, expansion: normalizedExpansion(vs.expansion) as unknown as JsonValue[], coveredSystems: sortedSet(vs.coveredSystems) },
    },
    corrections: { authority: c.authorityRule },
    admissible: { episode: c.admissible.episode, encounter: c.admissible.encounter, assertionKind: sortedSet(c.admissible.assertionKinds) },
    establishes: criterion(c.establishes),
    refutes: criterion(c.refutes),
  };
}

/** INTERNAL (tests): proposal 2.4. SHA-256 over the UTF-8 RFC 8785 bytes, as a structured value. */
export function contractDigest(projection: JsonValue): ContractDigest {
  return { scheme: CONTRACT_DIGEST_SCHEME, sha256: createHash('sha256').update(canonicalJson(projection), 'utf8').digest('hex') };
}

/**
 * INTERNAL, shared with query Needs: the own properties of a plain-object input, each read exactly
 * once as a descriptor (no accessor or proxy trap runs twice). Every field in `fields` is required
 * and no other is accepted; `why` explains the rejection of an extra field.
 */
export function readFields(input: unknown, fields: readonly string[], why: string, fail: (m: string) => never): Map<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('input must be an object');
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) fail('input must be a plain object');
  const out = new Map<string, unknown>();
  for (const k of Reflect.ownKeys(input as object)) {
    if (typeof k !== 'string' || !fields.includes(k)) fail(`unexpected input field ${String(k)}; ${why}`);
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (!d || !('value' in d)) return fail(`input.${String(k)} must be a data property`);
    out.set(k as string, d.value);
  }
  const missing = fields.filter((k) => !out.has(k));
  if (missing.length > 0) fail(`missing input field(s) ${missing.join(', ')}`);
  return out;
}

/**
 * Validation order (every configuration check precedes every outcome, so invalid input can never
 * surface as `noContractIdentity` or `unresolvedBindings`):
 * 1. input: a plain object whose own properties are exactly the five fields, all data properties;
 * 2. package: authentic (this exact compiler-produced object);
 * 3. query: a string naming an EvidenceQuery declaration of that package;
 * 4. subject: a string without lone surrogates;
 * 5. contextEpisode, then contextEncounter: plain data (captured once), well-formed per S3 §2.4/§2.5;
 * 6. the compiled package namespace and query ID, then (complete contract only) the whole digest
 *    projection: RFC 8785-representable (no lone surrogate), reported by path.
 * Outcomes, in order: a contract with any hole → noContractIdentity (proposal 1: unresolvedBindings
 * applies only to a complete contract); any `unknown` binding → unresolvedBindings (episode, then
 * encounter); otherwise the key.
 */
export function needIdentity(input: NeedIdentityInput): NeedIdentityResult {
  const fail = (m: string): never => {
    throw new NeedIdentityConfigurationError(m);
  };
  // 1.
  const fields = readFields(input, INPUT_FIELDS, 'identity is derived only from the compiled package', fail);

  // 2–3.
  const pkg = fields.get('package');
  if (compiledKind(pkg) === null) fail('package must be a CompiledPackage or PreviewPackage produced by the compiler in this process');
  const program = pkg as CompiledProgram;
  const query = fields.get('query');
  if (typeof query !== 'string') fail('query must be a string');
  const decl = program.declarations.find((d) => d.id === query);
  if (!decl || decl.kind !== 'EvidenceQuery') return fail(`query ${JSON.stringify(query)} is not an EvidenceQuery of the package`);

  // 4.
  const subject = fields.get('subject');
  if (typeof subject !== 'string') return fail('subject must be a string');
  const subjectProblem = jsonValueProblem(subject, 'subject');
  if (subjectProblem) fail(subjectProblem);

  // 5. Captured once (accessors, functions and non-plain objects rejected); the caller's objects are never frozen or reread.
  const episode = binding(fields.get('contextEpisode'), 'contextEpisode', checkEpisode, fail);
  const encounter = binding(fields.get('contextEncounter'), 'contextEncounter', checkEncounter, fail);

  // 6. Identity-relevant compiled strings. The compiler accepts lone surrogates, which RFC 8785
  // forbids and the canonicalizer would serialize anyway, so they are checked here, by path.
  const queryId = { package: program.packageId, id: decl.id };
  const queryProblem = jsonValueProblem(queryId, 'query');
  if (queryProblem) fail(`${queryProblem}; a Need key needs RFC 8785-representable identity components`);
  const holes = contractHoles(decl.contract);
  if (holes.length > 0) return detach({ noContractIdentity: { holes } });
  const contract = decl as EvidenceQueryDeclaration;
  const projection = contractDigestProjection(program, contract);
  const projectionProblem = jsonValueProblem(projection, 'projection');
  if (projectionProblem) fail(`${projectionProblem}; the contract digest projection must be RFC 8785-representable`);

  const unresolved: UnresolvedBinding[] = [];
  if (!('known' in episode)) unresolved.push('episode');
  if (!('known' in encounter)) unresolved.push('encounter');
  if (unresolved.length > 0) return detach({ unresolvedBindings: unresolved });

  const key: NeedKey = {
    query: queryId,
    contractDigest: contractDigest(projection),
    subject,
    episode: (episode as { known: string }).known,
    encounter: (encounter as { known: string }).known,
  };
  return detach({ key });
}

/** A context binding copied once, then validated by the S3 rule's own syntax check; a copy is returned. */
function binding<B extends object>(v: unknown, name: string, check: (b: B) => void, fail: (m: string) => never): B {
  const b = capture(v, name, fail);
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return fail(`${name} must be an object`);
  // Exactly one own member, `known` or `unknown`, non-enumerable ones included.
  const own = Object.getOwnPropertyNames(b);
  if (own.length !== 1 || (own[0] !== 'known' && own[0] !== 'unknown')) fail(`${name} must have exactly one member, known or unknown`);
  try {
    check(b as B);
  } catch (e) {
    return fail(`${name}: ${(e as Error).message}`);
  }
  if ('known' in b) {
    const problem = jsonValueProblem((b as { known: unknown }).known, `${name}.known`);
    if (problem) fail(problem);
  }
  return b as B;
}
