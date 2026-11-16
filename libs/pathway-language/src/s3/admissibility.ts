/**
 * EXPERIMENTAL, NONCLINICAL. Combined S3 admissibility of each possible revision (contract §2.7).
 *
 * Runs the three individual checks (§2.4–§2.6) on the same S1 result, S2 parameters and context,
 * then combines their outcomes within each revision or variant: all match → Admissible; any
 * mismatch → Inadmissible (unresolved findings kept); otherwise UnresolvedAdmissibility. Picks no
 * current revision, produces no key-level outcome, and decides no materiality (S4–S6).
 */
import { detach } from '../compile/compile';
import { bindEvidence, boundEvidence, EvidenceHandoffError } from '../handoff';
import { retainedPayload } from '../s1/payload';
import { compareCodePoints, type JsonObject } from '../s1/resolve';
import type { KeyResolution, NodeRef } from '../s1/types';
import { checkAssertionKind } from './assertion-kind';
import { checkEncounterScope } from './encounter';
import { checkEpisodeScope } from './episode';
import { CONTEXT_CAUSES } from './scope';
import type {
  AdmissibilityCheckInput,
  AdmissibilityCheckResult,
  AdmissibilityFinding,
  AssertionKindOutcome,
  CombinedAdmissibility,
  EncounterOutcome,
  EpisodeOutcome,
  KeyAdmissibility,
  MismatchReason,
  PossibleAdmissibility,
} from './types';

/**
 * Every result this module produced in this process. Later stages accept only these exact objects:
 * tags, shape and frozenness are not proof that a result came from one S1 snapshot (as for compiled
 * packages, I2).
 */
const produced = new WeakSet<object>();
export const isAdmissibilityResult = (v: unknown): v is AdmissibilityCheckResult => typeof v === 'object' && v !== null && produced.has(v);

/** INTERNAL handoff accessor (contract §2.8): the exact payload of one checked possibility of `s3`. */
export function admissibilityEvidence(s3: AdmissibilityCheckResult, possibility: PossibleAdmissibility): Readonly<JsonObject> {
  if (!isAdmissibilityResult(s3)) throw new EvidenceHandoffError('not a combined S3 result produced in this process');
  return boundEvidence(s3, possibility);
}

/** Invalid input to the combined check itself (the individual checks keep their own error classes). */
export class AdmissibilityCheckConfigurationError extends Error {}

const INPUT_FIELDS = ['s1', 'valueSet', 'expansion', 'admissible', 'contextEncounter', 'contextEpisode'];
const RULES = ['assertionKind', 'encounter', 'episode'] as const;
const nodeId = (n: NodeRef) => JSON.stringify([n.revision.source, n.revision.localId, n.revision.revision, n.digest ?? null]);

type RuleOutcomes = { readonly encounter: EncounterOutcome; readonly episode: EpisodeOutcome; readonly assertionKind: AssertionKindOutcome };

/** Contract §2.7 for ONE possibility's rule outcomes. */
export function combine(rules: RuleOutcomes): CombinedAdmissibility {
  const reasons: MismatchReason[] = [];
  const findings: AdmissibilityFinding[] = [];
  for (const rule of RULES) {
    const o = rules[rule];
    if (o.outcome === 'DoesNotMatch') reasons.push(o.reason);
    if (o.outcome === 'Unresolved') for (const f of o.findings) findings.push({ rule, ...f } as AdmissibilityFinding);
  }
  // Fixed orders (contract §2.7), never evaluation order.
  reasons.sort(compareCodePoints);
  findings.sort(
    (a, b) =>
      CONTEXT_CAUSES.indexOf(a.cause) - CONTEXT_CAUSES.indexOf(b.cause) ||
      compareCodePoints(a.rule, b.rule) ||
      compareCodePoints(a.origin, b.origin) ||
      compareCodePoints(a.reason, b.reason),
  );
  const causes = CONTEXT_CAUSES.filter((c) => findings.some((f) => f.cause === c));
  if (reasons.length > 0) return { outcome: 'Inadmissible', reasons, findings, causes };
  if (findings.length > 0) return { outcome: 'UnresolvedAdmissibility', findings, causes };
  return { outcome: 'Admissible' };
}

export function checkAdmissibility(input: AdmissibilityCheckInput): AdmissibilityCheckResult {
  const fail = (m: string): never => {
    throw new AdmissibilityCheckConfigurationError(m);
  };
  if (input === null || typeof input !== 'object') fail('input must be an object');
  const extra = Object.keys(input).filter((k) => !INPUT_FIELDS.includes(k));
  // In particular a precomputed `s2` or individual rule result: it could come from another snapshot, contract or context.
  if (extra.length > 0) fail(`unexpected input field(s) ${extra.join(', ')}`);
  const { s1, valueSet, expansion, admissible, contextEncounter, contextEpisode } = input;
  if (admissible === null || typeof admissible !== 'object' || Array.isArray(admissible)) fail('admissible must be the authored admissible object');
  const authored = Object.keys(admissible as object).sort(compareCodePoints);
  // Exactly the three rules of this subset: none supplied by default, no other rule accepted.
  if (JSON.stringify(authored) !== JSON.stringify([...RULES])) fail(`admissible must author exactly ${RULES.join(', ')}; got ${authored.join(', ') || 'none'}`);
  const a = admissible as Record<(typeof RULES)[number], unknown>;

  // All three from the same s1 and S2 parameters; each validates its own rule and context first.
  const enc = checkEncounterScope({ s1, valueSet, expansion, rule: a.encounter, contextEncounter });
  const epi = checkEpisodeScope({ s1, valueSet, expansion, rule: a.episode, contextEpisode });
  const ak = checkAssertionKind({ s1, valueSet, expansion, rule: a.assertionKind });

  // Evidence for the handoff (contract §2.8), taken now, from the S1 result the three checks read.
  const s1Keys = new Map<string, KeyResolution>(s1.keys.map((k) => [JSON.stringify([k.key.source, k.key.localId]), k]));
  const evidence: (JsonObject | undefined)[][] = [];
  const byNode = <T extends { kind: string; node?: NodeRef }>(ps: readonly T[]) => new Map(ps.flatMap((p) => (p.node ? [[nodeId(p.node), p] as const] : [])));
  const keys = enc.keys.map((ke, i): KeyAdmissibility => {
    const kp = epi.keys[i];
    const kk = ak.keys[i];
    if (!kp || !kk || JSON.stringify(kp.key) !== JSON.stringify(ke.key) || JSON.stringify(kk.key) !== JSON.stringify(ke.key)) {
      throw new Error('invariant: the three checks disagree on keys of one S1 result');
    }
    const ep = byNode(kp.possibilities);
    const kn = byNode(kk.possibilities);
    const k1 = s1Keys.get(JSON.stringify([ke.key.source, ke.key.localId]));
    if (!k1) throw new EvidenceHandoffError(`key ${JSON.stringify(ke.key)} is not in the S1 result`);
    const keyEvidence: (JsonObject | undefined)[] = [];
    evidence.push(keyEvidence);
    const possibilities = ke.possibilities.map((p): PossibleAdmissibility => {
      keyEvidence.push(undefined);
      if (p.kind !== 'node') return { kind: p.kind };
      if (p.candidacy === 'OutOfDomain') return { kind: 'node', node: p.node, candidacy: 'OutOfDomain', admissibility: { outcome: 'NotEvaluated', reason: 'OutOfDomain' } };
      // Joined on the SAME node identity (revision and digest): never across possibilities.
      const pe = ep.get(nodeId(p.node));
      const pk = kn.get(nodeId(p.node));
      if (!pe || !pk || pe.kind !== 'node' || pk.kind !== 'node' || pe.candidacy === 'OutOfDomain' || pk.candidacy === 'OutOfDomain') {
        throw new Error(`invariant: node ${nodeId(p.node)} not checked by every rule`);
      }
      const rules = { encounter: p.encounter, episode: pe.episode, assertionKind: pk.assertionKind };
      // Exact revision and digest; S1 keeps one variant per digest. Never another payload.
      const payload = retainedPayload(k1, p.node);
      if (!payload) throw new EvidenceHandoffError(`no unique retained payload for ${nodeId(p.node)}`);
      keyEvidence[keyEvidence.length - 1] = payload;
      return { kind: 'node', node: p.node, candidacy: p.candidacy, s2Findings: p.s2Findings, rules, admissibility: combine(rules) };
    });
    return {
      key: ke.key,
      s1Status: ke.s1Status,
      candidate: ke.candidate,
      inheritedS1Causes: ke.inheritedS1Causes,
      inheritedS1Defects: ke.inheritedS1Defects,
      possibilities,
    };
  });
  const result: AdmissibilityCheckResult = detach({
    experimental: 'nonclinical-s3-admissibility-v0',
    check: 'admissibility',
    valueSet: enc.valueSet,
    contextEncounter,
    contextEpisode,
    allowedKinds: ak.allowedKinds,
    keys,
  });
  result.keys.forEach((k, i) => k.possibilities.forEach((p, j) => {
    const payload = evidence[i]?.[j];
    if (payload) bindEvidence(result, p, payload);
  }));
  produced.add(result);
  return result;
}
