/**
 * EXPERIMENTAL, NONCLINICAL. I7 second sub-slice: single-query Need existence and deferral.
 *
 * Normative source: first-program-implementation-contract.md §8, “Needs generation (I7)”,
 * *Single-query existence and deferral*; evidence-query contract §6.1–§6.2.
 *
 * One explicitly requested complete query of an authentic CompiledPackage, evaluated once from one
 * captured input. Identity (experimentalNeedIdentity) and evidence (query-bound selection and
 * experimentalQueryEvidence) are both computed here, from the same package object, query, subject,
 * bindings and records, so one evaluation's evidence can never be paired with another's identity.
 *
 * The result is current-evaluation state only: no lifecycle transition, obligation, fulfillment,
 * program-level materiality, fulfiller selection or acquisition. Causes are reported exactly as S6
 * attributes them (including the EA-083/EA-092 limitation) and must not drive acquisition.
 */
import { compiledKind, detach } from './compile/compile';
import type { CompiledPackage } from './compile/types';
import { QuerySelectionConfigurationError, selectForQuery } from './bound';
import { captureInput, type RawExecutionInput } from './execute/raw';
import { NeedIdentityConfigurationError, needIdentity, readFields, type NeedKey, type UnresolvedBinding } from './identity';
import type { Cause } from './execute/types';
import { QueryEvidenceConfigurationError, queryEvidence, type QueryEvidenceResult } from './s6/evidence';

/** Invalid API input. Never a Need, a deferral or a patient-evidence cause. */
export class QueryNeedConfigurationError extends Error {}

export interface QueryNeedInput extends RawExecutionInput {
  /** A CompiledPackage produced by experimentalCompile in this process (not a copy; not a preview). */
  readonly package: CompiledPackage;
  /** The ID of one of its EvidenceQuery declarations: the explicitly requested query. */
  readonly query: string;
}

export type QueryNeed =
  | { readonly kind: 'none' }
  | { readonly kind: 'evidence'; readonly key: NeedKey; readonly causes: readonly Cause[] }
  | { readonly kind: 'deferred'; readonly unresolvedBindings: readonly UnresolvedBinding[] };

export interface QueryNeedResult {
  readonly experimental: 'nonclinical-query-need-v0';
  readonly query: { readonly package: string; readonly id: string };
  /** The evaluated snapshot's ID. */
  readonly snapshot: string;
  /** The unchanged experimentalQueryEvidence result of this evaluation: evidence and S6 trace. */
  readonly queryEvidence: QueryEvidenceResult;
  readonly need: QueryNeed;
  /** Never decided here; their absence never means "none required". */
  readonly notImplemented: readonly ['Obligations', 'Lifecycle', 'FulfilledBy', 'ProgramMateriality', 'Acquisition'];
}

const INPUT_FIELDS = ['package', 'query', 'subject', 'revisions', 'retractions', 'contextEncounter', 'contextEpisode', 'snapshot'];
const NOT_IMPLEMENTED = ['Obligations', 'Lifecycle', 'FulfilledBy', 'ProgramMateriality', 'Acquisition'] as const;

/**
 * Validation order: input shape (each field read once); package kind; runtime capture (records,
 * retractions and bindings copied once, snapshot validated); identity checks (query ownership,
 * subject, bindings); selection and evidence checks. Only then is the outcome chosen.
 */
export function queryNeed(input: QueryNeedInput): QueryNeedResult {
  const fail = (m: string): never => {
    throw new QueryNeedConfigurationError(m);
  };
  const f = readFields(input, INPUT_FIELDS, 'the evidence and the Need key come only from the package and this evaluation', fail);
  const pkg = f.get('package') as CompiledPackage;
  const kind = compiledKind(pkg);
  if (kind === 'PreviewPackage') fail('preview packages are rejected: authoring holes never produce Needs, and this slice evaluates complete queries only');
  if (kind !== 'CompiledPackage') fail('package must be a CompiledPackage produced by experimentalCompile in this process');
  const query = f.get('query') as string;

  // One captured input, used for both identity and evidence.
  const run = captureInput(
    { subject: f.get('subject'), revisions: f.get('revisions'), retractions: f.get('retractions'), contextEncounter: f.get('contextEncounter'), contextEpisode: f.get('contextEpisode'), snapshot: f.get('snapshot') } as RawExecutionInput,
    fail,
  );
  let identity: ReturnType<typeof needIdentity>;
  let evaluation: QueryEvidenceResult;
  try {
    identity = needIdentity({ package: pkg, query, subject: run.subject, contextEpisode: run.contextEpisode, contextEncounter: run.contextEncounter });
    const s4 = selectForQuery({ ...run, package: pkg, query });
    evaluation = queryEvidence({ package: pkg, query, s4 });
  } catch (e) {
    if (e instanceof NeedIdentityConfigurationError || e instanceof QuerySelectionConfigurationError || e instanceof QueryEvidenceConfigurationError) return fail(e.message);
    throw e;
  }

  const ev = evaluation.evidence;
  let need: QueryNeed;
  if (ev.status === 'Known') need = { kind: 'none' };
  else if ('key' in identity) need = { kind: 'evidence', key: identity.key, causes: ev.causes };
  else if ('unresolvedBindings' in identity) need = { kind: 'deferred', unresolvedBindings: identity.unresolvedBindings };
  // Unreachable: a CompiledPackage holds complete contracts only.
  else throw new Error('complete query without contract identity');

  return detach({
    experimental: 'nonclinical-query-need-v0',
    query: { package: pkg.packageId, id: query },
    snapshot: evaluation.snapshot,
    queryEvidence: evaluation,
    need,
    notImplemented: NOT_IMPLEMENTED,
  } as QueryNeedResult);
}
