/**
 * EXPERIMENTAL, NONCLINICAL. One S3 admissibility check: same-encounter scope (contract §2.2, §2.4).
 *
 * Pure: no I/O, no clock, no input mutation. Computes S2's classifications from the supplied S1
 * (so the two always come from one snapshot) and reads the payloads S1 retained. Never rebuilds history, never picks among possible currents, applies no other
 * admissibility rule and no S4–S6 selection, criteria or materiality.
 */
import { canonicalJson, retainedPayload } from '../s1/payload';
import { compareCodePoints, type JsonObject } from '../s1/resolve';
import type { KeyResolution } from '../s1/types';
import { identifyCandidates } from '../s2/identify';
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
const INPUT_FIELDS = ['s1', 'valueSet', 'expansion', 'rule', 'contextEncounter'];
/**
 * EncounterRef syntax (contract §2.4), defined for encounters on its own: a string with at least
 * one character outside Unicode White_Space. Never trimmed or otherwise normalized.
 */
const encounterRef = (v: unknown): v is string => typeof v === 'string' && /\P{White_Space}/u.test(v);

function checkContext(b: EncounterBinding): void {
  const fail = () => {
    throw new EncounterCheckConfigurationError(`malformed evaluation encounter ${JSON.stringify(b)}`);
  };
  if (b === null || typeof b !== 'object' || Object.keys(b).length !== 1) fail();
  if ('known' in b) {
    if (!encounterRef(b.known)) fail();
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
  if (!present) findings.push({ cause: 'Missing', origin: 'record', reason: 'FieldAbsent:encounter' });
  else if (!encounterRef(value)) findings.push({ cause: 'Invalid', origin: 'record', reason: 'FieldMalformed:encounter' });
  if ('unknown' in ctx) {
    for (const cause of CONTEXT_CAUSES) {
      if (ctx.unknown.includes(cause)) findings.push({ cause, origin: 'context.encounter', reason: 'ContextUnknown:encounter' });
    }
  }
  if (findings.length > 0 || !encounterRef(value) || !('known' in ctx)) return { outcome: 'Unresolved', findings };
  // Exact comparison: no normalization of either identifier.
  return value === ctx.known
    ? { outcome: 'Matches', recordEncounter: value }
    : { outcome: 'DoesNotMatch', reason: 'OtherEncounter', recordEncounter: value, contextEncounter: ctx.known };
}

export function checkEncounterScope(input: EncounterCheckInput): EncounterCheckResult {
  if (input === null || typeof input !== 'object') throw new EncounterCheckConfigurationError('input must be an object');
  const extra = Object.keys(input).filter((k) => !INPUT_FIELDS.includes(k));
  // In particular a precomputed `s2`: it could come from another snapshot than `s1`.
  if (extra.length > 0) throw new EncounterCheckConfigurationError(`unexpected input field(s) ${extra.join(', ')}`);
  const { s1, valueSet, expansion, rule, contextEncounter } = input;
  if (s1?.experimental !== 'nonclinical-s1-v0') throw new EncounterCheckConfigurationError('s1 must be an experimental S1 result');
  let ruleBytes: string | null = null;
  try {
    ruleBytes = canonicalJson(rule as never);
  } catch {
    // unrepresentable rule: rejected below
  }
  if (ruleBytes !== RULE) throw new EncounterCheckConfigurationError(`unsupported encounter rule ${JSON.stringify(rule)}; expected ${RULE}`);
  checkContext(contextEncounter);
  // S2 from this very S1 (it throws S2ConfigurationError for a bad pin or expansion).
  const s2 = identifyCandidates({ s1, valueSet, expansion });

  const s1Keys = new Map<string, KeyResolution>(s1.keys.map((k) => [JSON.stringify([k.key.source, k.key.localId]), k]));

  const keys = s2.keys.map((k2): KeyEncounterScope => {
    const k1 = s1Keys.get(JSON.stringify([k2.key.source, k2.key.localId]));
    if (!k1) throw new Error(`invariant: S2 key ${JSON.stringify(k2.key)} not in its own S1`);
    const possibilities = k2.possibilities.map((p: PossibleCandidacy): PossibleEncounterScope => {
      if (p.kind !== 'node') return { kind: p.kind };
      if (p.candidacy === 'OutOfDomain') return { kind: 'node', node: p.node, candidacy: 'OutOfDomain', encounter: { outcome: 'NotEvaluated', reason: 'OutOfDomain' } };
      const payload = retainedPayload(k1, p.node);
      if (!payload) throw new Error(`invariant: no unique retained variant for node ${JSON.stringify(p.node)}`);
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
