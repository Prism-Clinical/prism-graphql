/**
 * EXPERIMENTAL, NONCLINICAL. Runs the S1-, S2- and individual-S3-rule-applicable assertions of
 * the committed explicit-assertion-v0 conformance fixtures against the S1 resolver, S2 candidate
 * identification, the S3 same-encounter, same-episode and assertionKind checks, and their combined
 * per-revision admissibility (contract §2.7).
 *
 * A fixture is never reported as passing as a whole: only its S1, S2 and S3 assertions are
 * checked. `stage` fixtures (stage-v1) assert S1–S3 only and carry no downstream expectation. Complete S3 `admissibility` facts are never checked as such.
 * Every other expected field or trace fact is counted as outside the implemented scope.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { payloadIdentity } from '../../s1/payload';
import { isDeepStrictEqual } from 'node:util';
import {
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCheckAssertionKind,
  experimentalCheckAdmissibility,
  type PossibleAdmissibility,
  type PossibleAssertionKindScope,
  experimentalCheckEncounterScope,
  experimentalCheckEpisodeScope,
  experimentalIdentifyCandidates,
  experimentalResolveRevisionHistory,
  type JsonValue,
  type KeyResolution,
  type EncounterBinding,
  type EpisodeBinding,
  type NodeCandidacy,
  type PossibleEncounterScope,
  type PossibleEpisodeScope,
  type PossibleCurrent,
  type S1Result,
  type S2Result,
} from '../../index';

export const FIXTURE_DIR = join(__dirname, '..', '..', '..', '..', '..', 'docs', 'superpowers', 'records', 'pathway-language', 'conformance', 'explicit-assertion-v0');

/** Trace facts that S1 decides (README "Trace-assertion vocabulary"). */
const S1_FACTS = new Set(['keyResult', 'variants', 'occurrences', 'rejected', 'outOfEnvelope', 'outsideEnvelope']);
/** Diagnostic codes produced by S1. Others (ContradictoryAttestation, InsufficientlyScopedStatement) are coverage-stage. */
const S1_DIAGNOSTICS = new Set(['HistoricalDefect', 'CrossKeyCorrection', 'UndeclaredField']);
/** Trace facts that S2 decides. */
const S2_FACTS = new Set(['candidacy']);

type Json = { [k: string]: any }; // fixture documents are untyped JSON

export interface FixtureReport {
  id: string;
  kind: string;
  s1Applicable: number;
  s1Passed: number;
  s1AttributionOneWay: number;
  s2Applicable: number;
  s2Passed: number;
  s2AttributionOneWay: number;
  /** One-way: each expected `candidateEvidenceIds` entry must be an S2 InDomain/Unresolved node. */
  s2CandidateIdsOneWay: number;
  encounterApplicable: number;
  encounterPassed: number;
  /** One-way implications from complete S3 facts (`admissibility`, S3 encounter attributions). */
  encounterOneWay: number;
  episodeApplicable: number;
  episodePassed: number;
  /** One-way implications from complete S3 facts (`admissibility`, S3 episode attributions). */
  episodeOneWay: number;
  assertionKindApplicable: number;
  assertionKindPassed: number;
  /** One-way implications from complete S3 facts (`admissibility`, S3 assertionKind attributions). */
  assertionKindOneWay: number;
  /** Combined S3 `admissibility` facts (contract §2.7), checked directly. */
  admissibilityApplicable: number;
  admissibilityPassed: number;
  outOfScope: number;
  failures: string[];
  notRun: string | null;
}

// Display strings are used only to compare with the fixtures' notation (README "Identifier notation").
const showKey = (k: { source: string; localId: string }) => `${k.source}/${k.localId}`;
const showRev = (r: { source: string; localId: string; revision: string }) => `${showKey(r)}@${r.revision}`;
const showPossible = (p: PossibleCurrent) =>
  p.kind === 'node' ? showRev(p.node.revision) + (p.node.digest ? `#${p.node.digest}` : '') : p.kind;

function keyOf(result: S1Result, ref: string): KeyResolution | undefined {
  return result.keys.find((k) => showKey(k.key) === ref.split('@')[0]);
}

function checkFact(t: Json, r: S1Result): string | null {
  const fail = (msg: string) => `${t.fact} ${t.ref ?? t.code ?? ''}: ${msg}`;
  switch (t.fact) {
    case 'keyResult': {
      const k = keyOf(r, t.ref);
      if (!k) return fail('key not resolved');
      if (k.status !== t.value) return fail(`status ${k.status}, expected ${t.value}`);
      if ('current' in t && (k.current ? showRev(k.current.revision) : null) !== t.current) return fail(`current ${JSON.stringify(k.current)}`);
      if ('causes' in t && JSON.stringify(k.causes) !== JSON.stringify(t.causes)) return fail(`causes ${JSON.stringify(k.causes)}`);
      if ('possibleCurrent' in t) {
        const got = k.possibleCurrent.map(showPossible);
        if (JSON.stringify(got) !== JSON.stringify(t.possibleCurrent)) return fail(`possibleCurrent ${JSON.stringify(got)}`);
      }
      return null;
    }
    case 'variants': {
      const rev = keyOf(r, t.ref)?.revisions.find((x) => showRev(x.ref) === t.ref);
      const got = (rev?.variants ?? []).map((v) => `${t.ref}#${v.digest}`);
      return JSON.stringify(got) === JSON.stringify(t.value) ? null : fail(`variants ${JSON.stringify(got)}`);
    }
    case 'occurrences': {
      const rev = keyOf(r, t.ref)?.revisions.find((x) => showRev(x.ref) === t.ref);
      const ok = rev && rev.variants.length === 1 && rev.variants[0]?.occurrences.length === t.count;
      return ok ? null : fail(`expected one variant with ${t.count} occurrences`);
    }
    case 'rejected': {
      const hit = r.rejections.find(
        (x) => (x.item.kind === 'revision' ? showRev(x.item.ref) : `${x.item.ref.source}:${x.item.ref.id}`) === t.ref && x.reason === t.reason,
      );
      return hit ? null : fail(`no rejection ${t.reason}`);
    }
    case 'outOfEnvelope': {
      const rev = keyOf(r, t.ref)?.revisions.find((x) => showRev(x.ref) === t.ref);
      return rev?.state === 'outOfEnvelope' ? null : fail(`state ${rev?.state}`);
    }
    case 'outsideEnvelope':
      return r.outsideEnvelope.some((o) => o.kind === 'revision' && showRev(o.ref) === t.ref) ? null : fail('not outside envelope');
    case 'diagnostic': {
      if (t.code === 'HistoricalDefect') {
        const k = keyOf(r, t.ref);
        const hit = k?.historicalDefects.find(
          (d) =>
            d.cause === t.cause &&
            d.reason === t.reason &&
            (d.subject.kind === 'revision' ? showRev(d.subject.ref) : d.subject.kind === 'key' ? showKey(d.subject.ref) : '') === t.ref,
        );
        return hit ? null : fail(`no historical ${t.reason}`);
      }
      if (t.code === 'CrossKeyCorrection') {
        return keyOf(r, t.ref)?.diagnostics.some((d) => d.code === 'CrossKeyCorrection') ? null : fail('missing diagnostic');
      }
      if (t.code === 'UndeclaredField') {
        const rev = keyOf(r, t.ref)?.revisions.find((x) => showRev(x.ref) === t.ref);
        const hit = rev?.variants.some((v) => v.occurrences.some((o) => o.undeclaredPaths.includes(t.path)));
        return hit ? null : fail(`no undeclared ${t.path}`);
      }
      return fail('unexpected S1 diagnostic code');
    }
    default:
      return fail('not an S1 fact');
  }
}

const showNode = (n: NodeCandidacy) => showRev(n.node.revision) + (n.node.digest ? `#${n.node.digest}` : '');
/** Every S2-classified node, by its fixture notation (`RevisionRef`, or `RevisionRef#digest` for a variant). */
function s2Nodes(r: S2Result): Map<string, NodeCandidacy> {
  const m = new Map<string, NodeCandidacy>();
  for (const k of r.keys) for (const p of k.possibilities) if (p.kind === 'node') m.set(showNode(p), p);
  return m;
}

/**
 * A combined `admissibility` fact (README "Trace-assertion vocabulary"): `value` exactly; `reason`
 * (one) or `reasons` (all, code point order) is the complete set of mismatch reasons; `causes` is
 * the set of retained unresolved findings' causes, for any value.
 */
function checkAdmissibilityFact(t: Json, p: Extract<PossibleAdmissibility, { kind: 'node' }> | undefined): string | null {
  if (!p) return `admissibility ${t.ref}: not assessed`;
  const a = p.admissibility;
  if (a.outcome !== t.value) return `admissibility ${t.ref}: ${a.outcome}, expected ${t.value}`;
  const reasons = a.outcome === 'Inadmissible' ? a.reasons : [];
  const want = 'reasons' in t ? t.reasons : 'reason' in t ? [t.reason] : null;
  if (want && JSON.stringify(reasons) !== JSON.stringify(want)) return `admissibility ${t.ref}: reasons ${JSON.stringify(reasons)}`;
  const causes = a.outcome === 'Inadmissible' || a.outcome === 'UnresolvedAdmissibility' ? a.causes : [];
  if ('causes' in t && JSON.stringify(causes) !== JSON.stringify(t.causes)) return `admissibility ${t.ref}: causes ${JSON.stringify(causes)}`;
  return null;
}
const ASSERTION_KIND_REASONS = new Set(['FieldAbsent:assertionKind', 'FieldMalformed:assertionKind']);
const EPISODE_REASONS = new Set(['FieldAbsent:episode', 'FieldMalformed:episode', 'ContextUnknown:episode']);
/** Trace `causes` are sets, listed in Stage A §4.1 order. */
const STAGE_A = ['Missing', 'Conflicting', 'Unavailable', 'Invalid', 'Inadmissible', 'InsufficientEvidence'];
const causeSet = (fs: readonly { cause: string }[]): string[] => STAGE_A.filter((c) => fs.some((f) => f.cause === c));
const ENCOUNTER_REASONS = new Set(['FieldAbsent:encounter', 'FieldMalformed:encounter', 'ContextUnknown:encounter']);
type EncounterNode = Extract<PossibleEncounterScope, { kind: 'node' }>;
function encounterNodes(r: ReturnType<typeof experimentalCheckEncounterScope>): Map<string, EncounterNode> {
  const m = new Map<string, EncounterNode>();
  for (const k of r.keys) for (const p of k.possibilities) if (p.kind === 'node') m.set(showRev(p.node.revision) + (p.node.digest ? `#${p.node.digest}` : ''), p);
  return m;
}
const outcomeOf = (p: EncounterNode | undefined): string => p?.encounter.outcome ?? 'not checked';
function checkEncounterFact(t: Json, enc: Map<string, EncounterNode> | null): string | null {
  if (!enc) return `encounterScope ${t.ref}: the query does not author the same-encounter rule`;
  const p = enc.get(t.ref);
  if (outcomeOf(p) !== t.value) return `encounterScope ${t.ref}: ${outcomeOf(p)}, expected ${t.value}`;
  if ('causes' in t) {
    const got = p?.encounter.outcome === 'Unresolved' ? causeSet(p.encounter.findings) : [];
    if (JSON.stringify(got) !== JSON.stringify(t.causes)) return `encounterScope ${t.ref}: causes ${JSON.stringify(got)}`;
  }
  return null;
}

export function runFixtures(dir: string = FIXTURE_DIR): { reports: FixtureReport[]; noApplicableAssertions: string[] } {
  const shared = JSON.parse(readFileSync(join(dir, 'query', 'q.demo.json'), 'utf8')) as Json;
  const reports: FixtureReport[] = [];
  const missing: string[] = [];
  for (const name of readdirSync(join(dir, 'fixtures')).sort()) {
    const fx = JSON.parse(readFileSync(join(dir, 'fixtures', name), 'utf8')) as Json;
    const report: FixtureReport = {
      id: fx.id,
      kind: fx.kind,
      s1Applicable: 0,
      s1Passed: 0,
      s1AttributionOneWay: 0,
      s2Applicable: 0,
      s2Passed: 0,
      s2AttributionOneWay: 0,
      s2CandidateIdsOneWay: 0,
      encounterApplicable: 0,
      encounterPassed: 0,
      encounterOneWay: 0,
      episodeApplicable: 0,
      episodePassed: 0,
      episodeOneWay: 0,
      assertionKindApplicable: 0,
      assertionKindPassed: 0,
      assertionKindOneWay: 0,
      admissibilityApplicable: 0,
      admissibilityPassed: 0,
      outOfScope: 0,
      failures: [],
      notRun: null,
    };
    reports.push(report);
    if (fx.kind === 'canonicalization') {
      checkCanonicalization(fx, report);
      continue;
    }
    if (fx.kind === 'compilation') {
      report.notRun = 'compilation fixture: no evidence input';
      continue;
    }
    const query = (fx.query.inline ?? shared) as Json;
    const contract = query.query?.contract;
    if (!contract || contract.hole) {
      report.notRun = 'query contract is an authoring hole: no stage runs (contract §6.1)';
      report.outOfScope = countExpected(fx.expected);
      continue;
    }
    const result = experimentalResolveRevisionHistory({
      envelope: { recordType: contract.retrieve.type, subject: fx.input.context.subject, sources: contract.retrieve.sources },
      authorityRule: contract.corrections.authority,
      revisions: fx.input.records as JsonValue[],
      retractions: fx.input.retractions as JsonValue[],
    });
    const pin = contract.retrieve.valueSet as string;
    const s2 = experimentalIdentifyCandidates({ s1: result, valueSet: pin, expansion: { id: pin, ...query.valueSets[pin] } });
    const nodes = s2Nodes(s2);
    // The encounter check runs only where the query authors exactly the rule it implements.
    const enc = isDeepStrictEqual(contract.admissible?.encounter, SAME_ENCOUNTER_RULE)
      ? encounterNodes(
          experimentalCheckEncounterScope({
            s1: result,
            valueSet: pin,
            expansion: { id: pin, ...query.valueSets[pin] },
            rule: contract.admissible.encounter,
            contextEncounter: fx.input.context.encounter as EncounterBinding,
          }),
        )
      : null;
    // Likewise the episode check, only where the query authors exactly SAME_EPISODE_RULE.
    const epi = isDeepStrictEqual(contract.admissible?.episode, SAME_EPISODE_RULE)
      ? experimentalCheckEpisodeScope({
          s1: result,
          valueSet: pin,
          expansion: { id: pin, ...query.valueSets[pin] },
          rule: contract.admissible.episode,
          contextEpisode: fx.input.context.episode as EpisodeBinding,
        })
      : null;
    const episodeNodes = new Map<string, Extract<PossibleEpisodeScope, { kind: 'node' }>>();
    for (const k of epi?.keys ?? []) for (const p of k.possibilities) if (p.kind === 'node') episodeNodes.set(showRev(p.node.revision) + (p.node.digest ? `#${p.node.digest}` : ''), p);
    const episodeOutcome = (ref: string) => episodeNodes.get(ref)?.episode.outcome ?? 'not checked';
    // The assertionKind check runs wherever the query authors the rule; an invalid rule throws (a fixture defect).
    const akr = contract.admissible?.assertionKind === undefined
      ? null
      : experimentalCheckAssertionKind({ s1: result, valueSet: pin, expansion: { id: pin, ...query.valueSets[pin] }, rule: contract.admissible.assertionKind });
    const akNodes = new Map<string, Extract<PossibleAssertionKindScope, { kind: 'node' }>>();
    for (const k of akr?.keys ?? []) for (const p of k.possibilities) if (p.kind === 'node') akNodes.set(showRev(p.node.revision) + (p.node.digest ? `#${p.node.digest}` : ''), p);
    const akOutcome = (ref: string) => akNodes.get(ref)?.assertionKind.outcome ?? 'not checked';
    // Combined S3 (contract §2.7) wherever the query authors the three rules; config errors throw.
    const adm = contract.admissible
      ? experimentalCheckAdmissibility({
          s1: result,
          valueSet: pin,
          expansion: { id: pin, ...query.valueSets[pin] },
          admissible: contract.admissible,
          contextEncounter: fx.input.context.encounter as EncounterBinding,
          contextEpisode: fx.input.context.episode as EpisodeBinding,
        })
      : null;
    const admNodes = new Map<string, Extract<PossibleAdmissibility, { kind: 'node' }>>();
    for (const k of adm?.keys ?? []) for (const p of k.possibilities) if (p.kind === 'node') admNodes.set(showRev(p.node.revision) + (p.node.digest ? `#${p.node.digest}` : ''), p);
    const exp = fx.expected as Json;
    for (const t of (exp.traceAssertions ?? []) as Json[]) {
      if (t.fact === 'admissibility') {
        report.admissibilityApplicable += 1;
        const f = checkAdmissibilityFact(t, adm ? admNodes.get(t.ref) : undefined);
        if (f) report.failures.push(f);
        else report.admissibilityPassed += 1;
        // Falls through: the per-rule one-way implications below still apply.
      }
      if (t.fact === 'assertionKindScope') {
        report.assertionKindApplicable += 1;
        const p = akNodes.get(t.ref);
        const got = akr ? akOutcome(t.ref) : 'the query does not author the assertionKind rule';
        const causes = p?.assertionKind.outcome === 'Unresolved' ? causeSet(p.assertionKind.findings) : [];
        if (got !== t.value) report.failures.push(`assertionKindScope ${t.ref}: ${got}, expected ${t.value}`);
        else if ('causes' in t && JSON.stringify(causes) !== JSON.stringify(t.causes)) report.failures.push(`assertionKindScope ${t.ref}: causes ${JSON.stringify(causes)}`);
        else report.assertionKindPassed += 1;
        continue;
      }
      if (t.fact === 'episodeScope') {
        report.episodeApplicable += 1;
        const p = episodeNodes.get(t.ref);
        const got = epi ? episodeOutcome(t.ref) : 'the query does not author the same-episode rule';
        const causes = p?.episode.outcome === 'Unresolved' ? causeSet(p.episode.findings) : [];
        if (got !== t.value) report.failures.push(`episodeScope ${t.ref}: ${got}, expected ${t.value}`);
        else if ('causes' in t && JSON.stringify(causes) !== JSON.stringify(t.causes)) report.failures.push(`episodeScope ${t.ref}: causes ${JSON.stringify(causes)}`);
        else report.episodePassed += 1;
        continue;
      }
      if (t.fact === 'encounterScope') {
        report.encounterApplicable += 1;
        const f = checkEncounterFact(t, enc);
        if (f) report.failures.push(f);
        else report.encounterPassed += 1;
        continue;
      }
      if (t.fact === 'admissibility' && enc) {
        // Complete S3 fact: out of scope as such, but two values imply the encounter outcome.
        const implied = t.value === 'Admissible' ? 'Matches' : t.value === 'Inadmissible' && t.reason === 'OtherEncounter' ? 'DoesNotMatch' : null;
        if (implied) {
          report.encounterOneWay += 1;
          const got = outcomeOf(enc.get(t.ref));
          if (got !== implied) report.failures.push(`admissibility ${t.value} ${t.ref}: encounter check ${got}, implied ${implied}`);
        }
      }
      if (t.fact === 'admissibility' && akr) {
        const implied = t.value === 'Admissible' ? 'Matches' : t.value === 'Inadmissible' && t.reason === 'AssertionKindNotAllowed' ? 'DoesNotMatch' : null;
        if (implied) {
          report.assertionKindOneWay += 1;
          const got = akOutcome(t.ref);
          if (got !== implied) report.failures.push(`admissibility ${t.value} ${t.ref}: assertionKind check ${got}, implied ${implied}`);
        }
      }
      if (t.fact === 'admissibility' && epi) {
        // Same implication for the episode rule: Admissible means every rule holds.
        const implied = t.value === 'Admissible' ? 'Matches' : t.value === 'Inadmissible' && t.reason === 'OtherEpisode' ? 'DoesNotMatch' : null;
        if (implied) {
          report.episodeOneWay += 1;
          const got = episodeOutcome(t.ref);
          if (got !== implied) report.failures.push(`admissibility ${t.value} ${t.ref}: episode check ${got}, implied ${implied}`);
        }
      }
      if (S2_FACTS.has(t.fact)) {
        report.s2Applicable += 1;
        const got = nodes.get(t.ref)?.candidacy;
        if (got === t.value) report.s2Passed += 1;
        else report.failures.push(`candidacy ${t.ref}: ${got ?? 'not classified'}, expected ${t.value}`);
        continue;
      }
      if (t.fact === 'admissibility') continue;
      const s1 = S1_FACTS.has(t.fact) || (t.fact === 'diagnostic' && S1_DIAGNOSTICS.has(t.code));
      if (!s1) {
        report.outOfScope += 1;
        continue;
      }
      report.s1Applicable += 1;
      const f = checkFact(t, result);
      if (f) report.failures.push(f);
      else report.s1Passed += 1;
    }
    // One-way check: an S1-stage cause attribution must be an active S1 defect of that key.
    // (Absence of attribution proves nothing: attribution also depends on S5/S6 materiality.)
    for (const a of (exp.causeAttribution ?? []) as Json[]) {
      if (a.stage !== 'S1') continue;
      report.s1AttributionOneWay += 1;
      const k = keyOf(result, a.origin);
      if (!k?.activeDefects.some((d) => d.cause === a.cause && d.reason === a.reason)) {
        report.failures.push(`causeAttribution ${a.cause}/${a.reason} @${a.origin}: not an active S1 defect`);
      }
    }
    // One-way check: an S2-stage cause attribution must be an S2 finding on that revision (any variant).
    // (Absence proves nothing: attribution of S2 causes also depends on S5/S6 materiality.)
    for (const a of (exp.causeAttribution ?? []) as Json[]) {
      if (a.stage !== 'S2') continue;
      report.s2AttributionOneWay += 1;
      const hit = [...nodes.entries()].some(
        ([id, n]) => id.split('#')[0] === a.origin && n.candidacy === 'Unresolved' && n.findings.some((f) => f.cause === a.cause && f.reason === a.reason),
      );
      if (!hit) report.failures.push(`causeAttribution ${a.cause}/${a.reason} @${a.origin}: not an S2 finding`);
    }
    // One-way: an S3 attribution with an encounter reason must be a finding of the encounter check.
    for (const a of (exp.causeAttribution ?? []) as Json[]) {
      if (a.stage !== 'S3' || !ENCOUNTER_REASONS.has(a.reason) || !enc) continue;
      report.encounterOneWay += 1;
      const refs = (a.origin === 'context.encounter' ? a.refs : [a.origin]) as string[];
      for (const ref of refs) {
        const p = [...enc.entries()].filter(([id]) => id === ref || id.split('#')[0] === ref).map(([, v]) => v);
        const hit = p.some(
          (x) => x.kind === 'node' && x.encounter.outcome === 'Unresolved' && x.encounter.findings.some((f) => f.cause === a.cause && f.reason === a.reason),
        );
        if (!hit) report.failures.push(`causeAttribution ${a.cause}/${a.reason} @${ref}: not an encounter-check finding`);
      }
    }
    // One-way: an S3 attribution with an assertionKind reason must be a finding of that check.
    for (const a of (exp.causeAttribution ?? []) as Json[]) {
      if (a.stage !== 'S3' || !ASSERTION_KIND_REASONS.has(a.reason) || !akr) continue;
      report.assertionKindOneWay += 1;
      const hit = [...akNodes.entries()].some(
        ([id, x]) => (id === a.origin || id.split('#')[0] === a.origin) && x.assertionKind.outcome === 'Unresolved' && x.assertionKind.findings.some((f) => f.cause === a.cause && f.reason === a.reason),
      );
      if (!hit) report.failures.push(`causeAttribution ${a.cause}/${a.reason} @${a.origin}: not an assertionKind-check finding`);
    }
    // One-way: an S3 attribution with an episode reason must be a finding of the episode check.
    for (const a of (exp.causeAttribution ?? []) as Json[]) {
      if (a.stage !== 'S3' || !EPISODE_REASONS.has(a.reason) || !epi) continue;
      report.episodeOneWay += 1;
      const refs = (a.origin === 'context.episode' ? a.refs : [a.origin]) as string[];
      for (const ref of refs) {
        const hit = [...episodeNodes.entries()].some(
          ([id, x]) => (id === ref || id.split('#')[0] === ref) && x.episode.outcome === 'Unresolved' && x.episode.findings.some((f) => f.cause === a.cause && f.reason === a.reason),
        );
        if (!hit) report.failures.push(`causeAttribution ${a.cause}/${a.reason} @${ref}: not an episode-check finding`);
      }
    }
    // One-way check (contract §5.1): every listed candidate ID has in-domain or unresolved candidacy.
    // The field itself is an S6 output and stays out of scope; the converse is not checked.
    for (const id of (exp.evidence?.candidateEvidenceIds ?? []) as string[]) {
      report.s2CandidateIdsOneWay += 1;
      const c = nodes.get(id)?.candidacy;
      if (c !== 'InDomain' && c !== 'Unresolved') report.failures.push(`candidateEvidenceIds ${id}: S2 candidacy ${c ?? 'none'}`);
    }
    report.outOfScope += countExpected(exp) - ((exp.traceAssertions ?? []) as unknown[]).length;
    const checked =
      report.s1Applicable +
      report.s1AttributionOneWay +
      report.s2Applicable +
      report.s2AttributionOneWay +
      report.s2CandidateIdsOneWay +
      report.encounterApplicable +
      report.encounterOneWay +
      report.episodeApplicable +
      report.episodeOneWay +
      report.assertionKindApplicable +
      report.assertionKindOneWay +
      report.admissibilityApplicable;
    if (checked === 0) missing.push(fx.id);
  }
  return { reports, noApplicableAssertions: missing };
}

/** S1 step 1 payload equality (CANONICALIZATION.md) against the resolver's payload module. */
function checkCanonicalization(fx: Json, report: FixtureReport): void {
  const raws = (fx.input.rawOccurrences as string[]).map((s) => JSON.parse(s) as Json);
  const ids = raws.map((o) => payloadIdentity(o, 'revision'));
  for (const v of fx.expected.variants as Json[]) {
    for (const o of v.occurrences as number[]) {
      report.s1Applicable += 2;
      const id = ids[o];
      if (id?.canonical === v.canonicalBytes) report.s1Passed += 1;
      else report.failures.push(`occurrence ${o}: canonical bytes ${id?.canonical}`);
      if (id?.digest === v.digest) report.s1Passed += 1;
      else report.failures.push(`occurrence ${o}: digest ${id?.digest}`);
    }
  }
  report.s1Applicable += 1;
  const groups = new Set(ids.map((i) => i.digest)).size;
  if (groups === (fx.expected.variants as unknown[]).length) report.s1Passed += 1;
  else report.failures.push(`variant partition: ${groups} distinct payloads`);
  for (const u of fx.expected.undeclaredFields as Json[]) {
    report.s1Applicable += 1;
    if (JSON.stringify(ids[u.occurrence]?.undeclaredPaths) === JSON.stringify([...u.paths].sort())) report.s1Passed += 1;
    else report.failures.push(`undeclared paths of occurrence ${u.occurrence}`);
  }
}

/** Top-level expected fields plus trace assertions; used only to count what is not checked. */
function countExpected(exp: Json): number {
  // `stages` only declares a partial-stage fixture's scope; it is not an expectation.
  const fields = Object.keys(exp).filter((k) => k !== 'traceAssertions' && k !== 'stages').length;
  return fields + ((exp.traceAssertions ?? []) as unknown[]).length;
}
