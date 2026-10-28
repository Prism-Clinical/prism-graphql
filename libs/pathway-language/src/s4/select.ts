/**
 * EXPERIMENTAL, NONCLINICAL. S4 selection (evidence-query contract §2.8).
 *
 * Pure: reads one combined S3 result and decides, per key, from its S1 status and its
 * possibilities' S2 candidacy and combined S3 admissibility. Never selects by position, order,
 * digest or recency, never combines possibilities, evaluates no criterion and decides no
 * materiality. Everything earlier stages recorded is carried unchanged. Detached and deep-frozen.
 */
import { detach } from '../compile/compile';
import { compareCodePoints } from '../s1/resolve';
import { isAdmissibilityResult } from '../s3/admissibility';
import type { KeyAdmissibility, PossibleAdmissibility } from '../s3/types';
import type { Blocker, KeySelection, PossibleSelection, SelectionInput, SelectionResult, SelectionStatus, UnresolvedBy } from './types';

/** Invalid API input. Never used for patient-evidence uncertainty. */
export class SelectionConfigurationError extends Error {}

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
    // Unresolved candidacy keeps the key unresolved even beside Inadmissible (contract §2.8, proposed rule).
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
  const keys = input.s3.keys
    .map(selectKey)
    .sort((a, b) => compareCodePoints(a.key.source, b.key.source) || compareCodePoints(a.key.localId, b.key.localId));
  const selected = keys.flatMap((k) => {
    const p = k.possibilities[0];
    return k.status === 'Selected' && p && p.kind === 'node' ? [{ key: k.key, node: p.node }] : [];
  });
  return detach({
    experimental: 'nonclinical-s4-selection-v0',
    stage: 'S4',
    valueSet: input.s3.valueSet,
    keys,
    selected,
    unresolved: keys.filter((k) => k.status === 'Unresolved').map((k) => k.key),
    inadmissible: keys.filter((k) => k.status === 'Inadmissible').map((k) => k.key),
  });
}
