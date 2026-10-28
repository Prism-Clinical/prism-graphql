/**
 * EXPERIMENTAL, NONCLINICAL. S4 selection (evidence-query contract §2.8).
 *
 * Pure: reads one combined S3 result and decides, per key, from its S1 status and its
 * possibilities' S2 candidacy and combined S3 admissibility. Never selects by position, order,
 * digest or recency, never combines possibilities, evaluates no criterion and decides no
 * materiality. Everything earlier stages recorded is carried unchanged. Detached and deep-frozen.
 */
import { detach } from '../compile/compile';
import { bindEvidence, boundEvidence, EvidenceHandoffError } from '../handoff';
import { compareCodePoints, type JsonObject } from '../s1/resolve';
import { admissibilityEvidence, isAdmissibilityResult } from '../s3/admissibility';
import type { KeyAdmissibility, PossibleAdmissibility } from '../s3/types';
import type { Blocker, KeySelection, PossibleSelection, SelectionInput, SelectionResult, SelectionStatus, UnresolvedBy } from './types';

/** Invalid API input. Never used for patient-evidence uncertainty. */
export class SelectionConfigurationError extends Error {}

const produced = new WeakSet<object>();
/** True only for a result `select` produced in this process (copies and fabrications are not). */
export const isSelectionResult = (v: unknown): v is SelectionResult => typeof v === 'object' && v !== null && produced.has(v);

/**
 * INTERNAL handoff accessor for S5 (contract §2.8, "Evidence handoff"): the exact, deep-frozen
 * payload of one checked revision or variant of `s4`, from the snapshot that produced it. Throws
 * EvidenceHandoffError for a result not produced by `select` in this process, for a possibility of
 * another result, a copy or a fabrication, and for markers and out-of-domain possibilities, which
 * carry no evidence. Access never makes a possibility eligible: its disposition still decides.
 */
export function selectionEvidence(s4: SelectionResult, possibility: PossibleSelection): Readonly<JsonObject> {
  if (typeof s4 !== 'object' || s4 === null || !produced.has(s4)) throw new EvidenceHandoffError('not an S4 result produced in this process');
  return boundEvidence(s4, possibility);
}

type Node = Extract<PossibleAdmissibility, { kind: 'node' }>;

/** The possibility's own blockers (contract §2.8), before the key's history is considered. */
function ownBlockers(p: Node): Blocker[] {
  if (p.candidacy === 'OutOfDomain') return ['OutOfDomain'];
  const b: Blocker[] = [];
  if (p.candidacy === 'Unresolved') b.push('CandidacyUnresolved');
  if (p.admissibility.outcome === 'UnresolvedAdmissibility') b.push('AdmissibilityUnresolved');
  if (p.admissibility.outcome === 'Inadmissible') b.push('Inadmissible');
  return b;
}

function selectKey(k: KeyAdmissibility): KeySelection {
  const historyUnresolved = k.s1Status === 'UnresolvedRevision';
  const possibilities = k.possibilities.map((p): PossibleSelection => {
    if (p.kind !== 'node') return p;
    const blockers = [...ownBlockers(p), ...(historyUnresolved ? (['HistoryUnresolved'] as const) : [])].sort(compareCodePoints);
    return { ...p, selection: blockers.length === 0 ? { disposition: 'Selected' } : { disposition: 'NotSelected', blockers } };
  });
  let status: SelectionStatus;
  let unresolvedBy: UnresolvedBy[] = [];
  if (k.s1Status === 'Retracted' || k.s1Status === 'NoRecord') {
    if (possibilities.length > 0) throw new Error(`invariant: ${k.s1Status} key ${JSON.stringify(k.key)} has possibilities`);
    status = k.s1Status;
  } else if (historyUnresolved) {
    // Whatever its possibilities' outcomes: an admissible one does not resolve history, and all of
    // them being inadmissible does not either. S6 decides whether the uncertainty matters.
    status = 'Unresolved';
    unresolvedBy = ['HistoryUnresolved'];
  } else {
    const p = possibilities[0];
    if (possibilities.length !== 1 || !p || p.kind !== 'node' || p.node.digest !== undefined) {
      throw new Error(`invariant: Current key ${JSON.stringify(k.key)} must have exactly one undigested revision`);
    }
    const b = p.selection.disposition === 'Selected' ? [] : p.selection.blockers;
    unresolvedBy = b.filter((x): x is UnresolvedBy => x === 'AdmissibilityUnresolved' || x === 'CandidacyUnresolved');
    // Unresolved candidacy keeps the key unresolved even beside Inadmissible; both facts stay on the possibility (contract §2.8).
    status = b.length === 0 ? 'Selected' : b.includes('OutOfDomain') ? 'OutOfDomain' : unresolvedBy.length > 0 ? 'Unresolved' : 'Inadmissible';
  }
  return {
    key: k.key,
    s1Status: k.s1Status,
    candidate: k.candidate,
    inheritedS1Causes: k.inheritedS1Causes,
    inheritedS1Defects: k.inheritedS1Defects,
    status,
    unresolvedBy,
    possibilities,
  };
}

export function select(input: SelectionInput): SelectionResult {
  if (input === null || typeof input !== 'object') throw new SelectionConfigurationError('input must be an object');
  const extra = Object.keys(input).filter((k) => k !== 's3');
  // In particular S1, S2 or individual rule results, which could belong to another snapshot.
  if (extra.length > 0) throw new SelectionConfigurationError(`unexpected input field(s) ${extra.join(', ')}`);
  if (!isAdmissibilityResult(input.s3)) {
    throw new SelectionConfigurationError('s3 must be a combined S3 result produced by experimentalCheckAdmissibility in this process');
  }
  const s3 = input.s3;
  const pairs = s3.keys
    .map((src) => ({ src, sel: selectKey(src) }))
    .sort((a, b) => compareCodePoints(a.sel.key.source, b.sel.key.source) || compareCodePoints(a.sel.key.localId, b.sel.key.localId));
  const keys = pairs.map((x) => x.sel);
  const selected = keys.flatMap((k) => {
    const p = k.possibilities[0];
    return k.status === 'Selected' && p && p.kind === 'node' ? [{ key: k.key, node: p.node }] : [];
  });
  const result: SelectionResult = detach({
    experimental: 'nonclinical-s4-selection-v0',
    stage: 'S4',
    valueSet: input.s3.valueSet,
    keys,
    selected,
    unresolved: keys.filter((k) => k.status === 'Unresolved').map((k) => k.key),
    inadmissible: keys.filter((k) => k.status === 'Inadmissible').map((k) => k.key),
  });
  // Re-bind S3's evidence to this result's own possibility objects, position for position.
  result.keys.forEach((k, i) =>
    k.possibilities.forEach((p, j) => {
      const src = pairs[i]?.src.possibilities[j];
      if (!src || src.kind !== p.kind) throw new EvidenceHandoffError('S4 possibilities do not line up with S3');
      if (p.kind === 'node' && p.candidacy !== 'OutOfDomain') bindEvidence(result, p, admissibilityEvidence(s3, src));
    }),
  );
  produced.add(result);
  return result;
}
