/**
 * EXPERIMENTAL, NONCLINICAL. One S3 admissibility check: same-encounter scope (contract §2.2, §2.4).
 *
 * Pure: no I/O, no clock, no input mutation. Computes S2's classifications from the supplied S1
 * (so the two always come from one snapshot) and reads the payloads S1 retained. Never rebuilds history, never picks among possible currents, applies no other
 * admissibility rule and no S4–S6 selection, criteria or materiality.
 */
import type { JsonObject } from '../s1/resolve';
import { CONTEXT_CAUSES, checkScopeInput, exactRule, scopeKeys } from './scope';
import {
  SAME_ENCOUNTER_RULE,
  type EncounterBinding,
  type EncounterCheckInput,
  type EncounterCheckResult,
  type EncounterFinding,
  type EncounterOutcome,
  type PossibleEncounterScope,
} from './types';

/** Invalid program, rule or configuration input. Never used for patient-evidence problems. */
export class EncounterCheckConfigurationError extends Error {}

const RULE = exactRule(SAME_ENCOUNTER_RULE);
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
  checkScopeInput(input, INPUT_FIELDS, input?.rule, RULE, (m) => {
    throw new EncounterCheckConfigurationError(m);
  });
  const { s1, valueSet, expansion, contextEncounter } = input;
  checkContext(contextEncounter);
  // S2 runs on this very S1 (it throws S2ConfigurationError for a bad pin or expansion).
  const { valueSet: pin, keys } = scopeKeys(s1, valueSet, expansion, (p, payload): PossibleEncounterScope =>
    p.candidacy === 'OutOfDomain'
      ? { kind: 'node', node: p.node, candidacy: 'OutOfDomain', encounter: { outcome: 'NotEvaluated', reason: 'OutOfDomain' } }
      : {
          kind: 'node',
          node: p.node,
          candidacy: p.candidacy,
          s2Findings: p.candidacy === 'Unresolved' ? p.findings : [],
          encounter: compare(payload, contextEncounter),
        },
  );
  return { experimental: 'nonclinical-s3-encounter-v0', check: 'same-encounter', valueSet: pin, contextEncounter, keys };
}
