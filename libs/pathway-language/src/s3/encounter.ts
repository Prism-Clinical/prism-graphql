/**
 * EXPERIMENTAL, NONCLINICAL. One S3 admissibility check: same-encounter scope (contract §2.2, §2.4).
 *
 * Pure: no I/O, no clock, no input mutation. Consumes S2's classifications and the payloads S1
 * retained. Never rebuilds history, never picks among possible currents, applies no other
 * admissibility rule and no S4–S6 selection, criteria or materiality.
 */
import { canonicalJson, retainedPayload } from '../s1/payload';
import { compareCodePoints, type JsonObject } from '../s1/resolve';
import type { KeyResolution } from '../s1/types';
import type { PossibleCandidacy } from '../s2/types';
import {
  SAME_ENCOUNTER_RULE,
  type ContextCause,
  type EncounterBinding,
  type EncounterCheckInput,
  type EncounterCheckResult,
  type EncounterFinding,
  type EncounterOutcome,
  type KeyEncounterScope,
  type PossibleEncounterScope,
} from './types';

/** Invalid program, rule or configuration input. Never used for patient-evidence problems. */
export class EncounterCheckConfigurationError extends Error {}

const CONTEXT_CAUSES: readonly ContextCause[] = ['Missing', 'Conflicting', 'Unavailable', 'Invalid', 'Inadmissible', 'InsufficientEvidence'];
const RULE = canonicalJson(SAME_ENCOUNTER_RULE as never);

function checkContext(b: EncounterBinding): void {
  const fail = () => {
    throw new EncounterCheckConfigurationError(`malformed evaluation encounter ${JSON.stringify(b)}`);
  };
  if (b === null || typeof b !== 'object' || Object.keys(b).length !== 1) fail();
  if ('known' in b) {
    if (typeof b.known !== 'string') fail();
  } else if ('unknown' in b) {
    const cs: unknown = b.unknown;
    if (!Array.isArray(cs) || cs.length === 0 || new Set(cs).size !== cs.length || !cs.every((c) => CONTEXT_CAUSES.includes(c))) fail();
  } else fail();
}

/** Contract §2.2 `encounter` rule for one record payload. Record and context findings accumulate. */
function compare(payload: JsonObject, ctx: EncounterBinding): EncounterOutcome {
  const findings: EncounterFinding[] = [];
  const present = Object.prototype.hasOwnProperty.call(payload, 'encounter');
  const value = present ? payload['encounter'] : undefined;
  // EncounterRef: any JSON string (contract §1.2: a present value of the wrong type is malformed).
  if (!present) findings.push({ cause: 'Missing', origin: 'record', reason: 'FieldAbsent:encounter' });
  else if (typeof value !== 'string') findings.push({ cause: 'Invalid', origin: 'record', reason: 'FieldMalformed:encounter' });
  if ('unknown' in ctx) {
    for (const cause of CONTEXT_CAUSES) {
      if (ctx.unknown.includes(cause)) findings.push({ cause, origin: 'context.encounter', reason: 'ContextUnknown:encounter' });
    }
  }
  if (findings.length > 0 || typeof value !== 'string' || !('known' in ctx)) return { outcome: 'Unresolved', findings };
  // Exact comparison: no normalization of either identifier.
  return value === ctx.known
    ? { outcome: 'Matches', recordEncounter: value }
    : { outcome: 'DoesNotMatch', reason: 'OtherEncounter', recordEncounter: value, contextEncounter: ctx.known };
}

export function checkEncounterScope(input: EncounterCheckInput): EncounterCheckResult {
  const { s1, s2, rule, contextEncounter } = input ?? ({} as EncounterCheckInput);
  if (s1?.experimental !== 'nonclinical-s1-v0') throw new EncounterCheckConfigurationError('s1 must be an experimental S1 result');
  if (s2?.experimental !== 'nonclinical-s2-v0') throw new EncounterCheckConfigurationError('s2 must be an experimental S2 result');
  let ruleBytes: string | null = null;
  try {
    ruleBytes = canonicalJson(rule as never);
  } catch {
    // unrepresentable rule: rejected below
  }
  if (ruleBytes !== RULE) throw new EncounterCheckConfigurationError(`unsupported encounter rule ${JSON.stringify(rule)}; expected ${RULE}`);
  checkContext(contextEncounter);

  const s1Keys = new Map<string, KeyResolution>(s1.keys.map((k) => [JSON.stringify([k.key.source, k.key.localId]), k]));
  if (s1Keys.size !== s2.keys.length) throw new EncounterCheckConfigurationError('s2 was not computed from this s1 (key sets differ)');

  const keys = s2.keys.map((k2): KeyEncounterScope => {
    const k1 = s1Keys.get(JSON.stringify([k2.key.source, k2.key.localId]));
    if (!k1) throw new EncounterCheckConfigurationError(`s2 key ${JSON.stringify(k2.key)} is not in s1`);
    const possibilities = k2.possibilities.map((p: PossibleCandidacy): PossibleEncounterScope => {
      if (p.kind !== 'node') return { kind: p.kind };
      if (p.candidacy === 'OutOfDomain') return { kind: 'node', node: p.node, candidacy: 'OutOfDomain', encounter: { outcome: 'NotEvaluated', reason: 'OutOfDomain' } };
      const payload = retainedPayload(k1, p.node);
      if (!payload) throw new EncounterCheckConfigurationError(`s1 has no unique variant for node ${JSON.stringify(p.node)}`);
      return {
        kind: 'node',
        node: p.node,
        candidacy: p.candidacy,
        s2Findings: p.candidacy === 'Unresolved' ? p.findings : [],
        encounter: compare(payload, contextEncounter),
      };
    });
    return {
      key: k2.key,
      s1Status: k1.status,
      candidate: k2.candidate,
      inheritedS1Causes: k1.causes,
      inheritedS1Defects: k1.activeDefects,
      possibilities,
    };
  });

  return {
    experimental: 'nonclinical-s3-encounter-v0',
    check: 'same-encounter',
    valueSet: s2.valueSet,
    contextEncounter,
    keys: keys.sort((a, b) => compareCodePoints(a.key.source, b.key.source) || compareCodePoints(a.key.localId, b.key.localId)),
  };
}
