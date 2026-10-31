/**
 * EXPERIMENTAL, NONCLINICAL. One S3 admissibility check: the assertionKind rule (contract §2.2,
 * §2.6). Not the S3 result, and not S5: it checks what KIND of assertion a record makes, never
 * whether that assertion supports or refutes anything.
 *
 * Pure: no I/O, no clock, no input mutation. Runs S2 on the supplied S1 (one snapshot) and reads
 * the payloads S1 retained. The result is detached and deep-frozen.
 */
import { ENUMS, detach } from '../compile/compile';
import type { JsonObject } from '../s1/resolve';
import { checkScopeInput, scopeKeys } from './scope';
import type { AssertionKindCheckInput, AssertionKindCheckResult, AssertionKindOutcome, PossibleAssertionKindScope } from './types';

/** Invalid program, rule or configuration input. Never used for patient-evidence problems. */
export class AssertionKindCheckConfigurationError extends Error {}

/** The pinned `demo-model@0.1` AssertionKind codes, shared with the compiler. */
const KINDS = ENUMS.get('AssertionKind')!;
const INPUT_FIELDS = ['s1', 'valueSet', 'expansion', 'rule'];
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/** A recognized kind is exactly a pinned code: no trimming, case folding or normalization. */
const recognized = (v: unknown): v is string => typeof v === 'string' && KINDS.includes(v);

/** The authored codes, or why the rule is not `{in: [AssertionKind codes]}` (contract §2.6). */
function allowedKinds(rule: unknown): string[] | string {
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule) || Object.keys(rule).length !== 1 || !own(rule, 'in')) {
    return `unsupported assertionKind rule ${JSON.stringify(rule)}; expected {"in": [AssertionKind codes]}`;
  }
  const list: unknown = (rule as { in: unknown }).in;
  if (!Array.isArray(list)) return 'assertionKind rule `in` must be an array';
  const out: string[] = [];
  // Index loop, not every()/forEach(): a sparse hole or `undefined` element must be rejected.
  for (let i = 0; i < list.length; i++) {
    if (!(i in list) || !recognized(list[i])) return `assertionKind rule element ${i} (${JSON.stringify(list[i])}) is not an AssertionKind code`;
    out.push(list[i]);
  }
  return out;
}

/** Contract §2.6 for one record payload. */
function compare(payload: JsonObject, allowed: readonly string[]): AssertionKindOutcome {
  if (!own(payload, 'assertionKind')) return { outcome: 'Unresolved', findings: [{ cause: 'Missing', origin: 'record', reason: 'FieldAbsent:assertionKind' }] };
  const value = payload['assertionKind'];
  // An unrecognized string is malformed: its true kind is unknown, so it is never "not allowed".
  if (!recognized(value)) return { outcome: 'Unresolved', findings: [{ cause: 'Invalid', origin: 'record', reason: 'FieldMalformed:assertionKind' }] };
  return allowed.includes(value) ? { outcome: 'Matches', recordKind: value } : { outcome: 'DoesNotMatch', reason: 'AssertionKindNotAllowed', recordKind: value };
}

export function checkAssertionKind(input: AssertionKindCheckInput): AssertionKindCheckResult {
  const fail = (m: string): never => {
    throw new AssertionKindCheckConfigurationError(m);
  };
  let allowed: string[] = [];
  checkScopeInput(input, INPUT_FIELDS, input?.rule, (rule) => {
    const r = allowedKinds(rule);
    if (typeof r === 'string') return r;
    allowed = r;
    return null;
  }, fail);
  const { s1, valueSet, expansion } = input;
  const { valueSet: pin, keys } = scopeKeys(s1, valueSet, expansion, (p, payload): PossibleAssertionKindScope =>
    p.candidacy === 'OutOfDomain'
      ? { kind: 'node', node: p.node, candidacy: 'OutOfDomain', assertionKind: { outcome: 'NotEvaluated', reason: 'OutOfDomain' } }
      : { kind: 'node', node: p.node, candidacy: p.candidacy, s2Findings: p.candidacy === 'Unresolved' ? p.findings : [], assertionKind: compare(payload, allowed) },
  );
  return detach({ experimental: 'nonclinical-s3-assertion-kind-v0', check: 'assertion-kind', valueSet: pin, allowedKinds: allowed, keys });
}
