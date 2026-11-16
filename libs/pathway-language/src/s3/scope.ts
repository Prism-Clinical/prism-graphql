/**
 * EXPERIMENTAL, NONCLINICAL. What the S3 same-encounter and same-episode checks share, and only
 * that: input-boundary checks and the walk over S2's possibilities. Each rule's own syntax,
 * comparison and findings stay in its own module.
 */
import { canonicalJson, retainedPayload } from '../s1/payload';
import { compareCodePoints, type JsonObject } from '../s1/resolve';
import type { Defect, KeyResolution, KeyStatus, RecordKey, S1Cause, S1Result } from '../s1/types';
import { identifyCandidates } from '../s2/identify';
import type { NodeCandidacy, ValueSetExpansion } from '../s2/types';
import type { ContextCause } from './types';

/** Stage A §4.1 order. */
export const CONTEXT_CAUSES: readonly ContextCause[] = ['Missing', 'Conflicting', 'Unavailable', 'Invalid', 'Inadmissible', 'InsufficientEvidence'];

/** A rule check that accepts exactly one authored node, by canonical bytes. */
export function exactRule(expected: unknown): (rule: unknown) => string | null {
  const bytes = canonicalJson(expected as never);
  return (rule) => {
    try {
      if (canonicalJson(rule as never) === bytes) return null;
    } catch {
      // unrepresentable rule: rejected below
    }
    return `unsupported rule ${JSON.stringify(rule)}; expected ${bytes}`;
  };
}

/**
 * Throws `fail` unless `input` is an object with only `fields` and carries an S1 result, and
 * `ruleProblem(rule)` finds nothing. Rules are recognized, never interpreted.
 */
export function checkScopeInput(
  input: unknown,
  fields: readonly string[],
  rule: unknown,
  ruleProblem: (rule: unknown) => string | null,
  fail: (m: string) => never,
): void {
  if (input === null || typeof input !== 'object') fail('input must be an object');
  const extra = Object.keys(input).filter((k) => !fields.includes(k));
  // In particular a precomputed `s2`: it could come from another snapshot than `s1`.
  if (extra.length > 0) fail(`unexpected input field(s) ${extra.join(', ')}`);
  if ((input as { s1?: S1Result }).s1?.experimental !== 'nonclinical-s1-v0') fail('s1 must be an experimental S1 result');
  const problem = ruleProblem(rule);
  if (problem !== null) fail(problem);
}

export interface ScopedKey<P> {
  readonly key: RecordKey;
  readonly s1Status: KeyStatus;
  readonly candidate: boolean;
  readonly inheritedS1Causes: readonly S1Cause[];
  readonly inheritedS1Defects: readonly Defect[];
  readonly possibilities: readonly (P | { readonly kind: 'excluded' } | { readonly kind: 'unknown' })[];
}

/**
 * Runs S2 on this very S1 (so the two always come from one snapshot) and maps each node
 * possibility through `node`, with the payload S1 retained for it. `excluded` and `unknown` are
 * carried unchanged. Keys are in `RecordKey` order.
 */
export function scopeKeys<P>(
  s1: S1Result,
  valueSet: string,
  expansion: ValueSetExpansion,
  node: (p: NodeCandidacy, payload: JsonObject) => P,
): { valueSet: string; keys: ScopedKey<P>[] } {
  const s2 = identifyCandidates({ s1, valueSet, expansion });
  const s1Keys = new Map<string, KeyResolution>(s1.keys.map((k) => [JSON.stringify([k.key.source, k.key.localId]), k]));
  const keys = s2.keys.map((k2): ScopedKey<P> => {
    const k1 = s1Keys.get(JSON.stringify([k2.key.source, k2.key.localId]));
    if (!k1) throw new Error(`invariant: S2 key ${JSON.stringify(k2.key)} not in its own S1`);
    return {
      key: k2.key,
      s1Status: k1.status,
      candidate: k2.candidate,
      inheritedS1Causes: k1.causes,
      inheritedS1Defects: k1.activeDefects,
      possibilities: k2.possibilities.map((p) => {
        if (p.kind !== 'node') return { kind: p.kind };
        const payload = retainedPayload(k1, p.node);
        if (!payload) throw new Error(`invariant: no unique retained variant for node ${JSON.stringify(p.node)}`);
        return node(p, payload);
      }),
    };
  });
  keys.sort((a, b) => compareCodePoints(a.key.source, b.key.source) || compareCodePoints(a.key.localId, b.key.localId));
  return { valueSet: s2.valueSet, keys };
}
