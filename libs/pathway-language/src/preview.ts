/**
 * EXPERIMENTAL, NONCLINICAL. Query-bound preview evaluation of whole-criterion holes
 * (evidence-query contract §3.5 "Preview evaluation", §6.1; cases 50 and 52).
 *
 * Takes an authentic PreviewPackage, one EvidenceQuery ID and runtime inputs only. For a query whose
 * `establishes` or `refutes` (or both) is a hole, S1–S4 run from the query's complete settings
 * exactly as query-bound selection runs them, and each eligible possibility gets its complete
 * criterion evaluated from its own bound payload and a `Marker` for its hole. For a whole-contract
 * hole no stage runs. Nothing is classified; no possible classes, materiality, evidence result or
 * Need exists; publication stays blocked. The S4 result never leaves this function, so no
 * caller-supplied, copied or foreign stage result or possibility can enter.
 */
import { checkInputFields, PREVIEW_INPUT_FIELDS, selectWithSettings, type QuerySelectionInput } from './bound';
import { compiledKind, contractHoles, detach } from './compile/compile';
import type { CriterionSlot, IncompleteExplicitAssertionContract, PreviewPackage } from './compile/types';
import { compareCodePoints } from './s1/resolve';
import type { Defect, KeyStatus, NodeRef, RecordKey, S1Cause } from './s1/types';
import type { Disposition, PossibleSelection, SelectionResult, SelectionStatus, UnresolvedBy } from './s4/types';
import { selectionEvidence } from './s4/select';
import { evaluateCriterion, ineligibility } from './s5/criteria';
import type { CriteriaResult, CriterionName, CriterionResult } from './s5/types';

/** Invalid API input, including a non-preview package or an override. Never patient uncertainty. */
export class PreviewEvaluationConfigurationError extends Error {}

export interface PreviewQueryInput extends Omit<QuerySelectionInput, 'package' | 'snapshot'> {
  /** A PreviewPackage produced by experimentalCompilePreview in this process. */
  readonly package: PreviewPackage;
}

/** A criterion replaced by an authoring hole: incomplete authoring, never patient data. */
export interface CriterionMarker {
  readonly criterion: CriterionName;
  /** JSON Pointer of the `hole` member in the package source. */
  readonly source: string;
  readonly result: { readonly value: 'Marker'; readonly hole: string };
  readonly because: 'AuthoringHole';
}

/** A complete criterion's §3.4 result (patient data: True, False or Unknown with findings), or a marker. */
export type PreviewCriterion = CriterionResult | CriterionMarker;

export type PreviewRecord =
  | {
      readonly outcome: 'Evaluated';
      readonly node: NodeRef;
      /** The S4 disposition, unchanged. */
      readonly disposition: Disposition;
      readonly establishes: PreviewCriterion;
      readonly refutes: PreviewCriterion;
    }
  /** As in §3.5: no payload is read and no criterion value, marker or not, is produced. */
  | { readonly outcome: 'NotEvaluated'; readonly reason: Extract<CriteriaResult, { outcome: 'NotEvaluated' }>['reason']; readonly node?: NodeRef };

/** One S4 key, its facts unchanged, with each possibility's preview criteria. */
export interface PreviewKey {
  readonly key: RecordKey;
  readonly s1Status: KeyStatus;
  readonly candidate: boolean;
  readonly inheritedS1Causes: readonly S1Cause[];
  readonly inheritedS1Defects: readonly Defect[];
  readonly status: SelectionStatus;
  readonly unresolvedBy: readonly UnresolvedBy[];
  /** In S4 order. `possibility` is S4's own (candidacy, admissibility, disposition and their findings). */
  readonly possibilities: readonly { readonly possibility: PossibleSelection; readonly record: PreviewRecord }[];
}

interface PreviewCommon {
  readonly experimental: 'nonclinical-preview-query-v0';
  readonly mode: 'preview';
  readonly packageId: string;
  readonly query: string;
  /** The query is incomplete authoring: there is no Evidence<Boolean>, classification or Need. */
  readonly queryStatus: 'Incomplete';
  readonly publication: 'Blocked';
  /** The compiler's query-level marker, shown whatever the snapshot holds or what is eligible. */
  readonly marker: { readonly holes: readonly string[] };
}

export type PreviewQueryResult =
  | (PreviewCommon & { readonly contract: 'WholeContractHole'; readonly stagesRun: readonly [] })
  | (PreviewCommon & {
      readonly contract: 'IncompleteCriteria';
      readonly stagesRun: readonly ['S1', 'S2', 'S3', 'S4', 'S5'];
      /** The compiled obligation, unchanged: evaluating a sibling criterion proves nothing. */
      readonly disjointness: IncompleteExplicitAssertionContract['disjointness'];
      /** Which slot is a hole and which is complete. */
      readonly criteria: { readonly [K in CriterionName]: { readonly kind: 'complete'; readonly source: string } | { readonly kind: 'hole'; readonly hole: string; readonly source: string } };
      /** S4's own summary lists (RecordKey order). */
      readonly selection: Pick<SelectionResult, 'valueSet' | 'selected' | 'unresolved' | 'inadmissible'>;
      readonly keys: readonly PreviewKey[];
    });

const slotOf = (s: CriterionSlot) => (s.kind === 'hole' ? { kind: 'hole' as const, hole: s.hole, source: s.location } : { kind: 'complete' as const, source: s.criterion.location });

function criterion(name: CriterionName, s: CriterionSlot, payload: Parameters<typeof evaluateCriterion>[2]): PreviewCriterion {
  if (s.kind === 'hole') return { criterion: name, source: s.location, result: { value: 'Marker', hole: s.hole }, because: 'AuthoringHole' };
  return evaluateCriterion(name, s.criterion, payload);
}

function record(s4: SelectionResult, p: PossibleSelection, c: IncompleteExplicitAssertionContract): PreviewRecord {
  const skip = ineligibility(p);
  if (skip) return { outcome: 'NotEvaluated', ...skip };
  if (p.kind !== 'node') throw new Error('invariant: a marker is never eligible');
  // This possibility's own payload, bound by S3/S4 of this very evaluation (§2.8 handoff).
  const payload = selectionEvidence(s4, p);
  return { outcome: 'Evaluated', node: p.node, disposition: p.selection, establishes: criterion('establishes', c.establishes, payload), refutes: criterion('refutes', c.refutes, payload) };
}

export function evaluatePreviewQuery(input: PreviewQueryInput): PreviewQueryResult {
  const fail = (m: string): never => {
    throw new PreviewEvaluationConfigurationError(m);
  };
  checkInputFields(input, fail, PREVIEW_INPUT_FIELDS);
  const kind = compiledKind(input.package);
  if (kind === 'CompiledPackage') fail('a CompiledPackage is evaluated through the normal entry points; preview evaluation takes a PreviewPackage');
  if (kind !== 'PreviewPackage') fail('package must be a PreviewPackage produced by experimentalCompilePreview in this process');
  const pkg = input.package;
  const decl = pkg.declarations.find((d) => d.id === input.query);
  if (!decl || decl.kind !== 'EvidenceQuery') return fail(`query ${JSON.stringify(input.query)} is not an EvidenceQuery of the package`);
  const contract = decl.contract;
  // Scope restriction of this slice, not a semantic limit: per-record preview of a complete query
  // would need no S6; only its final query result does.
  if (contract.kind === 'explicit-assertion-v0') return fail(`query ${decl.id} has a complete contract: this preview entry point covers only queries with authoring holes (a scope restriction)`);
  const marker = pkg.markers.find((m) => m.output === decl.id);
  const holes = [...contractHoles(contract)].sort(compareCodePoints);
  if (!marker || marker.holes.join('\u0000') !== holes.join('\u0000')) throw new Error(`invariant: query ${decl.id} marker differs from its contract holes`);
  const common: PreviewCommon = {
    experimental: 'nonclinical-preview-query-v0',
    mode: 'preview',
    packageId: pkg.packageId,
    query: decl.id,
    queryStatus: 'Incomplete',
    publication: 'Blocked',
    marker: { holes },
  };
  if (contract.kind === 'hole') {
    // Retrieval, admissibility and criteria are all undecided (§6.1): no stage runs. Runtime input is still checked.
    if (typeof input.subject !== 'string') fail('subject must be a string');
    if (!Array.isArray(input.revisions) || !Array.isArray(input.retractions)) fail('revisions and retractions must be arrays');
    return detach({ ...common, contract: 'WholeContractHole', stagesRun: [] });
  }
  const { s4 } = selectWithSettings(contract, pkg.valueSets, input, fail);
  return detach({
    ...common,
    contract: 'IncompleteCriteria',
    stagesRun: ['S1', 'S2', 'S3', 'S4', 'S5'],
    disjointness: contract.disjointness,
    criteria: { establishes: slotOf(contract.establishes), refutes: slotOf(contract.refutes) },
    selection: { valueSet: s4.valueSet, selected: s4.selected, unresolved: s4.unresolved, inadmissible: s4.inadmissible },
    keys: s4.keys.map((k) => ({
      key: k.key,
      s1Status: k.s1Status,
      candidate: k.candidate,
      inheritedS1Causes: k.inheritedS1Causes,
      inheritedS1Defects: k.inheritedS1Defects,
      status: k.status,
      unresolvedBy: k.unresolvedBy,
      possibilities: k.possibilities.map((p) => ({ possibility: p, record: record(s4, p, contract) })),
    })),
  });
}
