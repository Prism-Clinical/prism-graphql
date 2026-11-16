/**
 * EXPERIMENTAL, NONCLINICAL. S6 step C: the cause union and its attribution (evidence-query
 * contract §4.2 step C, "Step C boundary").
 *
 * For ONE query-bound evaluation: computes steps A and B internally and, when the status after
 * step B is Unresolved, the union of (1) the step A base causes, (2) every relevant gap's findings
 * and (3) every material record's origin causes: its active S1 defects and the S2, S3 and S5
 * findings of each of its possible current revisions or variants. Every cause keeps its own
 * origin, stage and reason. Immaterial records and irrelevant gaps add nothing. Materiality is
 * read from step B, never recomputed.
 *
 * Nothing here is an Evidence<Boolean>: no candidateEvidenceIds, Needs or program execution.
 */
import { detach } from '../compile/compile';
import { canonicalJson } from '../s1/payload';
import { compareCodePoints } from '../s1/resolve';
import type { DefectSubject, JsonValue, NodeRef, RecordKey, RevisionRef } from '../s1/types';
import { CONTEXT_CAUSES } from '../s3/scope';
import type { ContextCause } from '../s3/types';
import { possibleClasses } from '../s5/possible-classes';
import { compareNodes } from './base';
import { gapRelevance, type GapId } from './gaps';
import { materiality, MaterialityConfigurationError, type MaterialityInput, type MaterialityResult } from './materiality';

/** Invalid API input. Never a cause or patient uncertainty. */
export class CauseAttributionConfigurationError extends Error {}

/** Exactly the step A and B input: everything else comes from the bound evaluation. */
export type CauseAttributionInput = MaterialityInput;

/** Stage A §4.1 causes (the same six as the executor's `Cause`). */
export type Cause = ContextCause;
export type AttributionStage = 'S1' | 'S2' | 'S3' | 'S5' | 'S6' | 'coverage' | 'gap';

/** Where a cause comes from. Structured: labels are for display only. */
export type AttributionOrigin =
  /** A step A base cause (policy level). */
  | { readonly kind: 'query' }
  /** An active S1 defect of a material record's key, with the defect's own identity. */
  | { readonly kind: 'record'; readonly key: RecordKey; readonly defect: { readonly subject: DefectSubject; readonly involves: readonly RevisionRef[] } }
  /** An S2, S3 or S5 finding of one exact revision or variant of a material record. */
  | { readonly kind: 'revision'; readonly node: NodeRef }
  /** An unknown evaluation-context binding, as an S3 rule read it (`refs`: the revisions affected). */
  | { readonly kind: 'context'; readonly binding: 'encounter' | 'episode' }
  /** A relevant gap (contract §4.1), by its structured identity. */
  | { readonly kind: 'gap'; readonly gap: GapId };

export interface Attribution {
  readonly cause: Cause;
  readonly stage: AttributionStage;
  readonly reason: string;
  readonly origin: AttributionOrigin;
  /** Rule 1: S ∪ R. Context origin: every affected revision or variant. NodeRef order. */
  readonly refs?: readonly NodeRef[];
  /** Base `Inadmissible` / `InsufficientEvidence`: the keys seen. RecordKey order. */
  readonly keys?: readonly RecordKey[];
  /** Collision-safe identity: RFC 8785 bytes of every field above. */
  readonly id: string;
  /** Display only (conformance README notation); may coincide for distinct entries. */
  readonly label: string;
}

export interface CauseAttributionResult {
  readonly experimental: 'nonclinical-s6-causes-v0';
  readonly stage: 'S6';
  readonly step: 'C';
  readonly scope: 'cause-attribution';
  readonly packageId: string;
  readonly query: string;
  readonly snapshot: string;
  /** The step B result, unchanged (it holds the step A result). */
  readonly stepB: MaterialityResult;
  /** Step B's status, unchanged: step C never changes it. */
  readonly status: MaterialityResult['after'];
  /** `NotApplicable` exactly when the status is Known: no cause is aggregated or attributed. */
  readonly aggregation: 'Applies' | 'NotApplicable';
  /** Distinct causes, Stage A order. */
  readonly causes: readonly Cause[];
  /** Cause order, then label, then reason, then id. */
  readonly attribution: readonly Attribution[];
  readonly notRun: readonly ['Evidence', 'CandidateEvidenceIds', 'Needs'];
}

const INPUT_FIELDS = ['package', 'query', 's4'];
const keyLabel = (k: RecordKey) => `${k.source}/${k.localId}`;
const nodeLabel = (n: NodeRef) => `${keyLabel(n.revision)}@${n.revision.revision}${n.digest ? `#${n.digest}` : ''}`;

export function causeAttribution(input: CauseAttributionInput): CauseAttributionResult {
  if (input === null || typeof input !== 'object') throw new CauseAttributionConfigurationError('input must be an object');
  const extra = Object.keys(input).filter((k) => !INPUT_FIELDS.includes(k));
  // In particular materiality decisions, causes, base or stage results, snapshots or query settings.
  if (extra.length > 0) throw new CauseAttributionConfigurationError(`unexpected input field(s) ${extra.join(', ')}; causes come only from the query-bound evaluation`);
  const own = { package: input.package, query: input.query, s4: input.s4 };
  let b: MaterialityResult;
  try {
    b = materiality(own);
  } catch (e) {
    if (e instanceof MaterialityConfigurationError) throw new CauseAttributionConfigurationError(e.message);
    throw e;
  }
  const common = { experimental: 'nonclinical-s6-causes-v0', stage: 'S6', step: 'C', scope: 'cause-attribution', packageId: b.packageId, query: b.query, snapshot: b.snapshot, stepB: b, status: b.after } as const;
  const notRun = ['Evidence', 'CandidateEvidenceIds', 'Needs'] as const;
  if (b.after.status === 'Known') return detach({ ...common, aggregation: 'NotApplicable', causes: [], attribution: [], notRun } as CauseAttributionResult);

  const entries = new Map<string, Attribution>();
  // The label is derived from the origin (a gap's from its GapRef), so the two cannot disagree.
  const add = (e: Omit<Attribution, 'id' | 'label'>, gapLabel?: string) => {
    const o = e.origin;
    const label = o.kind === 'query' ? 'query' : o.kind === 'record' ? keyLabel(o.key) : o.kind === 'revision' ? nodeLabel(o.node) : o.kind === 'context' ? `context.${o.binding}` : gapLabel!;
    const id = canonicalJson(e as unknown as JsonValue);
    entries.set(id, { ...e, id, label });
  };
  // Context findings: one entry per (binding, cause, reason), every affected revision in refs.
  const context = new Map<string, { binding: 'encounter' | 'episode'; cause: Cause; reason: string; refs: NodeRef[] }>();

  // 1. Base causes (step A), origin `query`.
  for (const c of b.stepA.baseCauses) {
    const e = { cause: c.cause, stage: 'S6' as const, reason: c.reason, origin: { kind: 'query' as const } };
    add('refs' in c ? { ...e, refs: c.refs } : 'keys' in c ? { ...e, keys: c.keys } : e);
  }

  // 2. Every relevant gap's findings (§4.1), from the same evaluation.
  for (const g of gapRelevance(own).gaps) {
    if (!g.relevant) continue;
    for (const f of g.findings) add({ cause: f.cause, stage: g.kind === 'CoverageCell' ? 'coverage' : 'gap', reason: f.reason, origin: { kind: 'gap', gap: g.ref.identity } }, g.ref.label);
  }

  // 3. Every material record's origin causes, over ALL its possible currents (not only the
  //    possibility or class that made it material).
  for (const m of b.records) {
    if (!m.material) continue;
    const k = input.s4.keys.find((x) => x.key.source === m.key.source && x.key.localId === m.key.localId);
    if (!k) throw new Error('invariant: a material record is a key of the bound S4 result');
    for (const d of k.inheritedS1Defects) {
      add({ cause: d.cause, stage: 'S1', reason: d.reason, origin: { kind: 'record', key: k.key, defect: { subject: d.subject, involves: d.involves } } });
    }
    for (const { possibility: p, record } of possibleClasses({ ...own, key: k }).possibilities) {
      if (p.kind !== 'node' || p.candidacy === 'OutOfDomain') continue;
      const at = { kind: 'revision' as const, node: p.node };
      for (const f of p.s2Findings) add({ cause: f.cause, stage: 'S2', reason: f.reason, origin: at });
      // S3 findings, including those retained beside a definite mismatch (§2.7).
      const s3 = p.admissibility.outcome === 'Admissible' ? [] : p.admissibility.findings;
      for (const f of s3) {
        if (f.origin === 'record') {
          add({ cause: f.cause, stage: 'S3', reason: f.reason, origin: at });
          continue;
        }
        const binding = f.origin === 'context.encounter' ? 'encounter' : 'episode';
        const ck = JSON.stringify([binding, f.cause, f.reason]);
        const entry = context.get(ck) ?? { binding, cause: f.cause, reason: f.reason, refs: [] };
        entry.refs.push(p.node);
        context.set(ck, entry);
      }
      if (record.outcome !== 'Evaluated') continue;
      for (const c of [record.establishes, record.refutes]) {
        if (c.result.value !== 'Unknown') continue;
        for (const f of c.result.findings) add({ cause: f.cause, stage: 'S5', reason: f.reason, origin: at });
      }
    }
  }
  for (const c of context.values()) {
    const refs = c.refs.sort(compareNodes).filter((n, i, a) => i === 0 || compareNodes(a[i - 1]!, n) !== 0);
    add({ cause: c.cause, stage: 'S3', reason: c.reason, origin: { kind: 'context', binding: c.binding }, refs });
  }

  const order = (x: Attribution, y: Attribution) =>
    CONTEXT_CAUSES.indexOf(x.cause) - CONTEXT_CAUSES.indexOf(y.cause) || compareCodePoints(x.label, y.label) || compareCodePoints(x.reason, y.reason) || compareCodePoints(x.id, y.id);
  const attribution = [...entries.values()].sort(order);
  const seen = new Set(attribution.map((a) => a.cause));
  return detach({ ...common, aggregation: 'Applies', causes: CONTEXT_CAUSES.filter((c) => seen.has(c)), attribution, notRun } as CauseAttributionResult);
}
