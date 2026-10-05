/**
 * EXPERIMENTAL, NONCLINICAL. S2 candidate identification (contract §2, row S2).
 *
 * Pure: no I/O, no clock, no input mutation. Reads only S1's result and a supplied expansion.
 * Never reconstructs history, never reconsiders superseded or rejected revisions, never picks a
 * winner among possible currents, and applies no S5/S6 materiality filter.
 */
import type { JsonValue, KeyResolution, NodeRef, PossibleCurrent, S1Result } from '../s1/types';
import { compareCodePoints, type JsonObject } from '../s1/resolve';
import { isObject } from '../s1/payload';
import type { AnyCause, Code, KeyCandidacy, NodeCandidacy, PossibleCandidacy, S2Finding, S2Input, S2Result, ValueSetExpansion } from './types';

/** Invalid program or configuration input. Never used for patient-evidence problems. */
export class S2ConfigurationError extends Error {}

const CAUSE_ORDER: readonly AnyCause[] = ['Missing', 'Conflicting', 'Unavailable', 'Invalid']; // Stage A §4.1
const own = (o: JsonObject, k: string): JsonValue | undefined => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
/**
 * Identifier syntax for the fictional model (contract §2.3): a string with at least one character
 * outside Unicode White_Space. Never trimmed or otherwise normalized.
 */
const identifier = (v: unknown): v is string => typeof v === 'string' && /\P{White_Space}/u.test(v);

function checkExpansion(pin: unknown, e: ValueSetExpansion): void {
  if (!identifier(pin)) throw new S2ConfigurationError('value-set pin must be a well-formed identifier');
  if (!e || e.id !== pin) throw new S2ConfigurationError(`expansion ${JSON.stringify(e?.id)} does not match pin ${JSON.stringify(pin)}`);
  if (!Array.isArray(e.coveredSystems) || !e.coveredSystems.every(identifier)) {
    throw new S2ConfigurationError('coveredSystems must be an array of well-formed identifiers');
  }
  if (!Array.isArray(e.expansion)) throw new S2ConfigurationError('expansion must be an array of codes');
  for (const c of e.expansion) {
    if (!isObject(c) || !identifier(c['system']) || !identifier(c['code'])) {
      throw new S2ConfigurationError(`malformed expansion entry ${JSON.stringify(c)}`);
    }
    if (!e.coveredSystems.includes(c['system'])) throw new S2ConfigurationError(`expansion code in uncovered system ${c['system']}`);
  }
}

/** The payload S1 retained for a node: its variant's RFC 8785 bytes, parsed. Never re-derived from input rows. */
function payloadOf(k: KeyResolution, node: NodeRef): JsonObject {
  const rev = k.revisions.find(
    (r) => r.ref.source === node.revision.source && r.ref.localId === node.revision.localId && r.ref.revision === node.revision.revision,
  );
  const variants = node.digest === undefined ? rev?.variants : rev?.variants.filter((v) => v.digest === node.digest);
  if (variants?.length !== 1) throw new S2ConfigurationError(`S1 result has no unique variant for node ${JSON.stringify(node)}`);
  return JSON.parse((variants[0] as { canonicalPayload: string }).canonicalPayload) as JsonObject;
}

function classify(node: NodeRef, payload: JsonObject, e: ValueSetExpansion): NodeCandidacy {
  const findings: S2Finding[] = [];
  const concept = own(payload, 'concept');
  let code: Code | null = null;
  if (concept === undefined) findings.push({ cause: 'Missing', reason: 'FieldAbsent:concept' });
  else if (!isObject(concept)) findings.push({ cause: 'Invalid', reason: 'CodeMalformed' });
  else {
    const system = own(concept, 'system');
    const value = own(concept, 'code');
    if (system === undefined) findings.push({ cause: 'Missing', reason: 'FieldAbsent:concept.system' });
    if (value === undefined) findings.push({ cause: 'Missing', reason: 'FieldAbsent:concept.code' });
    if ((system !== undefined && !identifier(system)) || (value !== undefined && !identifier(value))) {
      findings.push({ cause: 'Invalid', reason: 'CodeMalformed' });
    }
    if (identifier(system) && identifier(value)) code = { system, code: value };
  }
  if (!code) return { kind: 'node', node, candidacy: 'Unresolved', findings };
  // Membership is decidable only inside a covered system; an uncovered system is not nonmembership.
  if (!e.coveredSystems.includes(code.system)) {
    return { kind: 'node', node, candidacy: 'Unresolved', findings: [{ cause: 'Unavailable', reason: 'TerminologyUnavailable' }] };
  }
  const c = code;
  // Exact comparison of system and code: no normalization, synonyms or cross-system matching.
  return e.expansion.some((x) => x.system === c.system && x.code === c.code)
    ? { kind: 'node', node, candidacy: 'InDomain', reason: 'CodeInExpansion', code: c }
    : { kind: 'node', node, candidacy: 'OutOfDomain', reason: 'CodeNotInExpansion', code: c };
}

export function identifyCandidates(input: S2Input): S2Result {
  if (input?.s1?.experimental !== 'nonclinical-s1-v0') throw new S2ConfigurationError('s1 must be an experimental S1 result');
  checkExpansion(input.valueSet, input.expansion);

  const keys = input.s1.keys.map((k): KeyCandidacy => {
    let possible: readonly PossibleCurrent[] = [];
    if (k.status === 'Current' && k.current) possible = [{ kind: 'node', node: k.current }];
    else if (k.status === 'UnresolvedRevision') possible = k.possibleCurrent;
    // Retracted / NoRecord: no current revision, and no negative conclusion either.

    const possibilities = possible.map((p): PossibleCandidacy => (p.kind === 'node' ? classify(p.node, payloadOf(k, p.node), input.expansion) : { kind: p.kind }));
    const causes = new Set<AnyCause>(k.causes);
    for (const p of possibilities) if (p.kind === 'node' && p.candidacy === 'Unresolved') p.findings.forEach((f) => causes.add(f.cause));
    return {
      key: k.key,
      s1Status: k.status,
      inheritedCauses: k.causes,
      inheritedDefects: k.activeDefects,
      possibilities,
      candidate: possibilities.some((p) => p.kind === 'unknown' || (p.kind === 'node' && p.candidacy !== 'OutOfDomain')),
      causes: CAUSE_ORDER.filter((c) => causes.has(c)),
    };
  });

  return {
    experimental: 'nonclinical-s2-v0',
    valueSet: input.valueSet,
    keys: keys.sort((a, b) => compareCodePoints(a.key.source, b.key.source) || compareCodePoints(a.key.localId, b.key.localId)),
  };
}
