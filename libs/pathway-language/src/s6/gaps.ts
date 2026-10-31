/**
 * EXPERIMENTAL, NONCLINICAL. S6 gap relevance (evidence-query contract §1.5, §4.1): the first I5 slice.
 *
 * For ONE query-bound evaluation: combines the current snapshot's coverage statements into one
 * status per envelope cell, and decides for every gap (each non-Complete cell, each current
 * acquisition failure, each current rejected item, including S1's unattributable retractions and
 * unidentified occurrences) whether it is Relevant or Irrelevant, with the dimension checks behind
 * that decision. It computes no base result, decides no materiality, attributes no final causes,
 * produces no Evidence<Boolean> and emits no Need. A relevant gap is not itself Missing or Conflicting.
 *
 * Every input comes from one evaluation: the query scope and correction policy from the compiled
 * query, and the subject, snapshot statements and S1 rejected items from the private record that
 * experimentalSelectForQuery made for the S4 result passed in. Nothing is reattached by identifier.
 *
 * Identity: every gap and statement has a structured identity (kind, origin, original ID, payload
 * digest) and a collision-safe `key` (its RFC 8785 bytes). `label` is for display only and may
 * coincide across kinds (a failure named `cell:s1` and the coverage cell for s1).
 */
import { createHash } from 'node:crypto';
import { queryContract, selectionEvaluation, selectionQuery, type EvaluationSnapshot } from '../bound';
import { detach } from '../compile/compile';
import type { CompiledPackage } from '../compile/types';
import { canonicalJson } from '../s1/payload';
import { compareCodePoints } from '../s1/resolve';
import { DEMO_AUTHORITY_RULE, type JsonValue, type RecordKey, type RetractionRef } from '../s1/types';
import { CONTEXT_CAUSES } from '../s3/scope';
import type { ContextCause } from '../s3/types';
import { isSelectionResult } from '../s4/select';
import type { SelectionResult } from '../s4/types';

/** Invalid API input. Never a gap, a relevance value or patient uncertainty. */
export class GapRelevanceConfigurationError extends Error {}

export interface GapRelevanceInput {
  readonly package: CompiledPackage;
  readonly query: string;
  /** An S4 result experimentalSelectForQuery produced in this process for exactly `package` and `query`, with a `snapshot`. */
  readonly s4: SelectionResult;
}

/**
 * Correction-authority rules that accept a correction or retraction only from the record's own
 * source (contract §1.1, §1.3). Under them a gap whose stated sources are disjoint from the declared
 * set can hold no occurrence of an enveloped key. Any other rule makes source disjointness prove nothing.
 */
const SAME_SOURCE_AUTHORITY: ReadonlySet<string> = new Set([DEMO_AUTHORITY_RULE]);

export type CellStatus = 'Complete' | 'Incomplete' | 'Unknown' | 'Absent';
export type GapDimension = 'recordType' | 'subject' | 'sources' | 'valueSet' | 'episode' | 'encounter';
export type DimensionVerdict =
  /** Omitted or null: proves nothing. */
  | 'Unstated'
  /** Present but not well-formed: proves nothing and adds Invalid. */
  | 'Malformed'
  /** Record type or subject equal to the envelope's. */
  | 'Matches'
  /** Record type or subject stated and different: proves irrelevance. */
  | 'Differs'
  /** Sources sharing at least one declared source. */
  | 'Overlaps'
  /** Sources disjoint from the declared set under a same-source correction rule: proves irrelevance. */
  | 'Disjoint'
  /** Sources disjoint, but the correction rule could accept a revision from them: proves nothing. */
  | 'DisjointCorrectionPossible'
  /** Value set, episode or encounter stated: never proves, a correction may move a record across it. */
  | 'NeverProves';

export interface DimensionCheck {
  readonly dimension: GapDimension;
  readonly verdict: DimensionVerdict;
  /** The stated value, verbatim; absent when unstated. */
  readonly value?: JsonValue;
  readonly proves: boolean;
}

export type GapReason = 'CellIncomplete' | 'CellUnknown' | 'CellAbsent' | 'CellMalformedStatement' | 'AcquisitionFailed' | 'ItemRejected';
export interface GapFinding {
  readonly cause: ContextCause;
  readonly reason: GapReason;
}

/** A received statement: its list, its original `id`, and the SHA-256 of its RFC 8785 bytes. */
export interface StatementId {
  readonly kind: 'coverage' | 'failure' | 'rejectedItem';
  readonly id: string;
  readonly digest: string;
}

/** Structured gap identity. Two gaps are the same gap only if these are equal. */
export type GapId =
  | { readonly kind: 'CoverageCell'; readonly origin: 'coverage'; readonly source: string }
  | { readonly kind: 'AcquisitionFailure' | 'RejectedItem'; readonly origin: 'snapshot'; readonly statement: StatementId }
  | { readonly kind: 'RejectedItem'; readonly origin: 'S1'; readonly retraction: RetractionRef }
  | { readonly kind: 'RejectedItem'; readonly origin: 'S1'; readonly occurrence: 'revision' | 'retraction'; readonly inputIndex: number };

/** A gap's identity with its collision-safe key (RFC 8785 bytes of the identity) and display label. */
export interface GapRef {
  readonly identity: GapId;
  readonly key: string;
  /** Display only: `cell:<source>`, the statement id (`id#<digest>` when another statement shares the id), `<source>:<id>`, `unidentified:<kind>#<index>`. */
  readonly label: string;
}

export interface StatementRef {
  readonly identity: StatementId;
  readonly key: string;
  readonly label: string;
}

export interface CoverageCell {
  readonly ref: GapRef;
  readonly recordType: string;
  readonly subject: string;
  readonly source: string;
  readonly status: CellStatus;
  /** Current, well-formed, fully scoped `Complete` statements naming this cell. */
  readonly establishedBy: readonly StatementRef[];
  /** Current statements that are Incomplete, Unknown or malformed and not excluded by a stated dimension. */
  readonly affectedBy: readonly { readonly statement: StatementRef; readonly as: 'Incomplete' | 'Unknown' | 'Malformed' }[];
}

/** The S1-side origin of a rejected item: never an S1 correction-history defect. */
export type S1RejectedItem =
  | { readonly kind: 'UnattributableRetraction'; readonly retraction: RetractionRef; readonly cause: 'Missing' | 'Invalid' }
  | { readonly kind: 'UnidentifiedOccurrence'; readonly occurrence: 'revision' | 'retraction'; readonly inputIndex: number; readonly reason: string };

interface GapCommon {
  readonly ref: GapRef;
  readonly relevant: boolean;
  /** Distinct causes, Stage A order. */
  readonly causes: readonly ContextCause[];
  readonly findings: readonly GapFinding[];
}

export type Gap =
  | (GapCommon & {
      readonly kind: 'CoverageCell';
      readonly origin: 'coverage';
      readonly relevant: true;
      /** Cells lie inside the envelope (§4.1): always relevant. Incomplete, Unknown and Absent alike. */
      readonly basis: 'InsideEnvelope';
      readonly cell: CoverageCell;
    })
  | (GapCommon & {
      readonly kind: 'AcquisitionFailure' | 'RejectedItem';
      /** `snapshot`: a stated failure or rejected item; `S1`: found by this evaluation's S1 run. */
      readonly origin: 'snapshot' | 'S1';
      /** Irrelevant only when a verified dimension proves it disjoint from the envelope. */
      readonly basis: 'ProvenDisjoint' | 'NotProvenDisjoint';
      /** Every dimension that proves irrelevance (empty when relevant). */
      readonly provenBy: readonly GapDimension[];
      readonly dimensions: readonly DimensionCheck[];
      /** Malformed or unrecognized members (Invalid added); never dropped. */
      readonly malformed: readonly string[];
      /** Identical occurrences merged into this item (RFC 8785 equality). */
      readonly occurrences: number;
      /** The statement as received (origin `snapshot`), or the S1 rejected item. */
      readonly item: JsonValue | S1RejectedItem;
    });

export interface StatementTrace {
  readonly ref: StatementRef;
  readonly current: boolean;
  /** Malformed members, and members outside the contract §1.5 format (rejected, never ignored). */
  readonly malformed: readonly string[];
  readonly occurrences: number;
  readonly item: JsonValue;
}

export type GapDiagnostic =
  /** A cell claimed Complete beside an Incomplete/Unknown/malformed statement, or beside a missing S1 target in that cell (§1.5, §2.1). */
  | { readonly code: 'ContradictoryAttestation'; readonly ref: GapRef; readonly basis: 'AffectingStatement'; readonly establishedBy: readonly StatementRef[]; readonly affectedBy: readonly StatementRef[] }
  | { readonly code: 'ContradictoryAttestation'; readonly ref: GapRef; readonly basis: 'MissingTarget'; readonly establishedBy: readonly StatementRef[]; readonly keys: readonly RecordKey[] }
  /** A `Complete` statement with an unstated dimension establishes nothing (§1.5). */
  | { readonly code: 'InsufficientlyScopedStatement'; readonly ref: StatementRef; readonly unstated: readonly ('recordType' | 'subject' | 'sources')[] };

export interface GapRelevanceResult {
  readonly experimental: 'nonclinical-s6-gap-relevance-v0';
  readonly stage: 'S6';
  /** Gap relevance only: no base result, materiality, final causes, Evidence<Boolean> or Need. */
  readonly scope: 'gap-relevance';
  readonly packageId: string;
  readonly query: string;
  readonly snapshot: string;
  /** The query scope the decisions were made against (compiled query plus evaluation subject). */
  readonly envelope: {
    readonly recordType: string;
    readonly subject: string;
    readonly sources: readonly string[];
    readonly authorityRule: string;
    /** Whether source disjointness can prove irrelevance under this correction rule. */
    readonly sourceDisjointnessProves: boolean;
  };
  /** One per declared source, in declared-source code point order. */
  readonly cells: readonly CoverageCell[];
  /** Coverage cells, then failures, then rejected items; code point order of label, then key, within each. */
  readonly gaps: readonly Gap[];
  readonly relevant: readonly GapRef[];
  readonly irrelevant: readonly GapRef[];
  /** Every received statement: coverage, then failures, then rejected items; label then key order within each. */
  readonly statements: readonly StatementTrace[];
  /** Statements whose `appliesTo.snapshot` names another snapshot: traced and ignored (§1.5). */
  readonly notCurrent: readonly StatementRef[];
  readonly diagnostics: readonly GapDiagnostic[];
}

/**
 * The §1.5 formats. Every member is recognized; `attestedBy`, `attempt` and `reason` are the
 * designated non-semantic metadata. Any other member makes the statement malformed: ignoring an
 * unknown scope restriction could accept a broader claim than intended.
 */
const FORMATS = {
  coverage: ['id', 'appliesTo', 'recordType', 'subject', 'sources', 'status', 'attestedBy'],
  failure: ['id', 'attempt', 'appliesTo', 'outcome', 'recordType', 'subject', 'sources', 'valueSet', 'episode', 'encounter'],
  rejectedItem: ['id', 'appliesTo', 'reason', 'recordType', 'subject', 'sources'],
} as const;
const KIND_ORDER = ['CoverageCell', 'AcquisitionFailure', 'RejectedItem'] as const;

type Obj = { readonly [k: string]: JsonValue };
const own = (o: object, k: string | number) => Object.prototype.hasOwnProperty.call(o, k);
const has = (o: Obj, k: string) => own(o, k) && o[k] !== null;
/** A nonempty array of strings, every slot checked explicitly (a sparse slot is not a string). */
function isNonEmptyStrings(v: JsonValue | undefined): v is string[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  for (let i = 0; i < v.length; i++) if (!own(v, i) || typeof v[i] !== 'string') return false;
  return true;
}
const orderCauses = (cs: Iterable<ContextCause>) => {
  const set = new Set(cs);
  return CONTEXT_CAUSES.filter((c) => set.has(c));
};
const gapRef = (identity: GapId, label: string): GapRef => ({ identity, key: canonicalJson(identity as unknown as JsonValue), label });

/** One statement after duplicate handling: identical occurrences merge; same id with different content stays apart. */
interface Entry {
  readonly ref: StatementRef;
  readonly item: Obj;
  readonly occurrences: number;
  readonly current: boolean;
  readonly malformed: string[];
}

function entries(kind: keyof typeof FORMATS, items: readonly JsonValue[], snapshot: string): Entry[] {
  const groups = new Map<string, Map<string, { item: Obj; n: number }>>();
  for (const raw of items) {
    const item = raw as Obj;
    const bytes = canonicalJson(item);
    const byId = groups.get(item['id'] as string) ?? new Map<string, { item: Obj; n: number }>();
    groups.set(item['id'] as string, byId);
    const g = byId.get(bytes);
    if (g) g.n += 1;
    else byId.set(bytes, { item, n: 1 });
  }
  const out: Entry[] = [];
  for (const [id, byId] of groups) {
    for (const [bytes, { item, n }] of byId) {
      const digest = createHash('sha256').update(bytes, 'utf8').digest('hex');
      const identity: StatementId = { kind, id, digest };
      const malformed: string[] = [];
      const applies = item['appliesTo'];
      const appliesOk = applies !== null && typeof applies === 'object' && !Array.isArray(applies) && Object.keys(applies).length === 1 && typeof (applies as Obj)['snapshot'] === 'string';
      // A statement whose currency cannot be read is kept as current and malformed: never dropped.
      if (!appliesOk) malformed.push('appliesTo');
      for (const d of ['recordType', 'subject'] as const) if (has(item, d) && typeof item[d] !== 'string') malformed.push(d);
      if (has(item, 'sources') && !isNonEmptyStrings(item['sources'])) malformed.push('sources');
      if (kind === 'coverage') {
        if (!['Complete', 'Incomplete', 'Unknown'].includes(item['status'] as string)) malformed.push('status');
        if (typeof item['attestedBy'] !== 'string') malformed.push('attestedBy');
      } else if (kind === 'failure') {
        if (!['Failed', 'TimedOut', 'Refused'].includes(item['outcome'] as string)) malformed.push('outcome');
        if (typeof item['attempt'] !== 'string') malformed.push('attempt');
        for (const d of ['valueSet', 'episode', 'encounter'] as const) if (has(item, d) && typeof item[d] !== 'string') malformed.push(d);
      } else if (typeof item['reason'] !== 'string') malformed.push('reason');
      // Unrecognized members are rejected (the statement is malformed), never ignored.
      malformed.push(...Object.keys(item).filter((k) => !(FORMATS[kind] as readonly string[]).includes(k)));
      out.push({
        ref: { identity, key: canonicalJson(identity as unknown as JsonValue), label: byId.size === 1 ? id : `${id}#${digest}` },
        item,
        occurrences: n,
        current: !appliesOk || (applies as Obj)['snapshot'] === snapshot,
        malformed: malformed.sort(compareCodePoints),
      });
    }
  }
  return out.sort((a, b) => compareCodePoints(a.ref.label, b.ref.label) || compareCodePoints(a.ref.key, b.ref.key));
}

interface Scope {
  readonly recordType: string;
  readonly subject: string;
  readonly sources: readonly string[];
  readonly sourceDisjointnessProves: boolean;
}

/** §4.1 dimension table for a failure or rejected item. Malformed members count as unstated. */
function dimensions(item: Obj, malformed: readonly string[], scope: Scope, extra: readonly ('valueSet' | 'episode' | 'encounter')[]): DimensionCheck[] {
  const check = (dimension: GapDimension, decide: (v: JsonValue) => DimensionVerdict): DimensionCheck => {
    if (!has(item, dimension)) return { dimension, verdict: 'Unstated', proves: false };
    const value = item[dimension]!;
    if (malformed.includes(dimension)) return { dimension, verdict: 'Malformed', value, proves: false };
    const verdict = decide(value);
    return { dimension, verdict, value, proves: verdict === 'Differs' || verdict === 'Disjoint' };
  };
  return [
    check('recordType', (v) => (v === scope.recordType ? 'Matches' : 'Differs')),
    check('subject', (v) => (v === scope.subject ? 'Matches' : 'Differs')),
    check('sources', (v) => ((v as string[]).some((s) => scope.sources.includes(s)) ? 'Overlaps' : scope.sourceDisjointnessProves ? 'Disjoint' : 'DisjointCorrectionPossible')),
    ...extra.map((d) => check(d, () => 'NeverProves')),
  ];
}

function itemGap(kind: 'AcquisitionFailure' | 'RejectedItem', origin: 'snapshot' | 'S1', ref: GapRef, dims: DimensionCheck[], findings: GapFinding[], malformed: readonly string[], occurrences: number, item: JsonValue | S1RejectedItem): Gap {
  const provenBy = dims.filter((d) => d.proves).map((d) => d.dimension);
  return {
    kind,
    origin,
    ref,
    relevant: provenBy.length === 0,
    basis: provenBy.length === 0 ? 'NotProvenDisjoint' : 'ProvenDisjoint',
    provenBy,
    dimensions: dims,
    malformed,
    occurrences,
    causes: orderCauses(findings.map((f) => f.cause)),
    findings,
    item,
  };
}

function bound(input: GapRelevanceInput) {
  const fail = (m: string): never => {
    throw new GapRelevanceConfigurationError(m);
  };
  if (input === null || typeof input !== 'object') fail('input must be an object');
  const extra = Object.keys(input).filter((k) => !['package', 'query', 's4'].includes(k));
  // In particular coverage, failures, rejected items, a subject or an S1 result: they come only from the evaluation.
  if (extra.length > 0) fail(`unexpected input field(s) ${extra.join(', ')}; gap information comes only from the query-bound evaluation`);
  const contract = queryContract(input.package, input.query, fail);
  if (!isSelectionResult(input.s4)) fail('s4 must be an S4 result produced by experimentalSelectForQuery in this process');
  const b = selectionQuery(input.s4);
  if (!b) fail('s4 is not bound to a query: only experimentalSelectForQuery results are accepted');
  if (b!.package !== input.package) fail('s4 was selected for another compiled package');
  if (b!.query !== input.query) fail(`s4 was selected for query ${JSON.stringify(b!.query)}, not ${JSON.stringify(input.query)}`);
  const evaluation = selectionEvaluation(input.s4)!;
  if (evaluation.settings !== contract) throw new Error('invariant: evaluation settings differ from the bound contract');
  if (!evaluation.snapshot) fail('s4 was selected without a snapshot: coverage, failures and rejected items must be supplied to experimentalSelectForQuery (no information is never complete coverage)');
  return { contract, evaluation: { ...evaluation, snapshot: evaluation.snapshot as EvaluationSnapshot } };
}

export function gapRelevance(input: GapRelevanceInput): GapRelevanceResult {
  const { contract, evaluation } = bound(input);
  const { snapshot, subject, s1 } = evaluation;
  const scope: Scope = {
    recordType: contract.recordType,
    subject,
    sources: [...contract.sources].sort(compareCodePoints),
    sourceDisjointnessProves: SAME_SOURCE_AUTHORITY.has(contract.authorityRule),
  };
  const coverage = entries('coverage', snapshot.coverage, snapshot.id);
  const failures = entries('failure', snapshot.failures, snapshot.id);
  const rejected = entries('rejectedItem', snapshot.rejectedItems, snapshot.id);
  const diagnostics: GapDiagnostic[] = [];

  // §1.5 combination per cell. A missing statement never establishes anything: no statement → Absent.
  const current = coverage.filter((c) => c.current);
  for (const c of current) {
    if (c.malformed.length > 0 || c.item['status'] !== 'Complete') continue;
    const unstated = (['recordType', 'subject', 'sources'] as const).filter((d) => !has(c.item, d));
    if (unstated.length > 0) diagnostics.push({ code: 'InsufficientlyScopedStatement', ref: c.ref, unstated });
  }
  /** Does a well-formed stated dimension of `c` exclude the cell for `source`? Malformed dimensions exclude nothing. */
  const excludes = (c: Entry, source: string) =>
    (has(c.item, 'recordType') && !c.malformed.includes('recordType') && c.item['recordType'] !== scope.recordType) ||
    (has(c.item, 'subject') && !c.malformed.includes('subject') && c.item['subject'] !== scope.subject) ||
    (has(c.item, 'sources') && !c.malformed.includes('sources') && !(c.item['sources'] as string[]).includes(source));
  const cellGaps: Gap[] = [];
  const cells = scope.sources.map((source): CoverageCell => {
    const ref = gapRef({ kind: 'CoverageCell', origin: 'coverage', source }, `cell:${source}`);
    const establishedBy = current
      .filter((c) => c.malformed.length === 0 && c.item['status'] === 'Complete' && has(c.item, 'recordType') && has(c.item, 'subject') && has(c.item, 'sources') && !excludes(c, source))
      .map((c) => c.ref);
    const affectedBy = current
      .filter((c) => (c.malformed.length > 0 || c.item['status'] === 'Incomplete' || c.item['status'] === 'Unknown') && !excludes(c, source))
      .map((c) => ({ statement: c.ref, as: c.malformed.length > 0 ? ('Malformed' as const) : (c.item['status'] as 'Incomplete' | 'Unknown') }));
    const status: CellStatus = affectedBy.some((a) => a.as === 'Incomplete') ? 'Incomplete' : affectedBy.length > 0 ? 'Unknown' : establishedBy.length > 0 ? 'Complete' : 'Absent';
    const cell: CoverageCell = { ref, recordType: scope.recordType, subject: scope.subject, source, status, establishedBy, affectedBy };
    if (status !== 'Complete' && establishedBy.length > 0) {
      diagnostics.push({ code: 'ContradictoryAttestation', ref, basis: 'AffectingStatement', establishedBy, affectedBy: affectedBy.map((a) => a.statement) });
    }
    // §2.1: a Complete claim for the cell beside a correction or retraction target absent from the snapshot.
    const missingTarget = s1.keys.filter(
      (k) => k.key.source === source && [...k.activeDefects, ...k.historicalDefects].some((d) => d.reason === 'CorrectionTargetAbsent' || d.reason === 'RetractionTargetAbsent'),
    );
    if (establishedBy.length > 0 && missingTarget.length > 0) {
      diagnostics.push({ code: 'ContradictoryAttestation', ref, basis: 'MissingTarget', establishedBy, keys: missingTarget.map((k) => k.key) });
    }
    if (status !== 'Complete') {
      const findings: GapFinding[] = [{ cause: 'InsufficientEvidence', reason: status === 'Incomplete' ? 'CellIncomplete' : status === 'Unknown' ? 'CellUnknown' : 'CellAbsent' }];
      if (affectedBy.some((a) => a.as === 'Malformed')) findings.push({ cause: 'Invalid', reason: 'CellMalformedStatement' });
      cellGaps.push({ kind: 'CoverageCell', origin: 'coverage', ref, relevant: true, basis: 'InsideEnvelope', cell, causes: orderCauses(findings.map((f) => f.cause)), findings });
    }
    return cell;
  });

  const itemGaps: Gap[] = [];
  const statementGapRef = (kind: 'AcquisitionFailure' | 'RejectedItem', e: Entry) => gapRef({ kind, origin: 'snapshot', statement: e.ref.identity }, e.ref.label);
  for (const f of failures.filter((x) => x.current)) {
    const findings: GapFinding[] = [{ cause: 'Unavailable', reason: 'AcquisitionFailed' }];
    if (f.malformed.length > 0) findings.push({ cause: 'Invalid', reason: 'AcquisitionFailed' });
    itemGaps.push(itemGap('AcquisitionFailure', 'snapshot', statementGapRef('AcquisitionFailure', f), dimensions(f.item, f.malformed, scope, ['valueSet', 'episode', 'encounter']), findings, f.malformed, f.occurrences, f.item));
  }
  for (const r of rejected.filter((x) => x.current)) {
    itemGaps.push(itemGap('RejectedItem', 'snapshot', statementGapRef('RejectedItem', r), dimensions(r.item, r.malformed, scope, []), [{ cause: 'Invalid', reason: 'ItemRejected' }], r.malformed, r.occurrences, r.item));
  }
  // S1's own rejected items (§2.1 step 6; §1.7). Their dimensions are their known fields: a
  // retraction states its source only; an occurrence without identity states none.
  for (const u of s1.unattributableRetractions) {
    const item: S1RejectedItem = { kind: 'UnattributableRetraction', retraction: u.ref, cause: u.cause };
    const ref = gapRef({ kind: 'RejectedItem', origin: 'S1', retraction: u.ref }, `${u.ref.source}:${u.ref.id}`);
    itemGaps.push(itemGap('RejectedItem', 'S1', ref, dimensions({ sources: [u.ref.source] }, [], scope, []), [{ cause: u.cause, reason: 'ItemRejected' }], [], 1, item));
  }
  for (const u of s1.unidentified) {
    const item: S1RejectedItem = { kind: 'UnidentifiedOccurrence', occurrence: u.kind, inputIndex: u.inputIndex, reason: u.reason };
    // ponytail: positional identity (no identity exists); the decision itself never depends on order.
    const ref = gapRef({ kind: 'RejectedItem', origin: 'S1', occurrence: u.kind, inputIndex: u.inputIndex }, `unidentified:${u.kind}#${u.inputIndex}`);
    itemGaps.push(itemGap('RejectedItem', 'S1', ref, dimensions({}, [], scope, []), [{ cause: 'Invalid', reason: 'ItemRejected' }], [], 1, item));
  }
  const gaps = [...cellGaps, ...itemGaps].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compareCodePoints(a.ref.label, b.ref.label) || compareCodePoints(a.ref.key, b.ref.key));
  const statements: StatementTrace[] = [...coverage, ...failures, ...rejected].map((e) => ({ ref: e.ref, current: e.current, malformed: e.malformed, occurrences: e.occurrences, item: e.item }));
  return detach({
    experimental: 'nonclinical-s6-gap-relevance-v0',
    stage: 'S6',
    scope: 'gap-relevance',
    packageId: input.package.packageId,
    query: input.query,
    snapshot: snapshot.id,
    envelope: { recordType: scope.recordType, subject: scope.subject, sources: scope.sources, authorityRule: contract.authorityRule, sourceDisjointnessProves: scope.sourceDisjointnessProves },
    cells,
    gaps,
    relevant: gaps.filter((g) => g.relevant).map((g) => g.ref),
    irrelevant: gaps.filter((g) => !g.relevant).map((g) => g.ref),
    statements,
    notCurrent: statements.filter((s) => !s.current).map((s) => s.ref),
    diagnostics,
  });
}
