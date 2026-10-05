/**
 * EXPERIMENTAL, NONCLINICAL. Runs the S1- and S2-applicable assertions of the committed
 * explicit-assertion-v0 conformance fixtures against the S1 resolver and S2 candidate identification.
 *
 * A fixture is never reported as passing as a whole: only its S1 and S2 assertions are checked.
 * Every other expected field or trace fact is counted as outside the implemented scope.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { payloadIdentity } from '../../s1/payload';
import {
  experimentalIdentifyCandidates,
  experimentalResolveRevisionHistory,
  type JsonValue,
  type KeyResolution,
  type NodeCandidacy,
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
      report.notRun = 'compilation fixture: no S1/S2 input';
      continue;
    }
    const query = (fx.query.inline ?? shared) as Json;
    const contract = query.query?.contract;
    if (!contract || contract.hole) {
      report.notRun = 'query contract is an authoring hole: S1/S2 do not run (contract §6.1)';
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
    const exp = fx.expected as Json;
    for (const t of (exp.traceAssertions ?? []) as Json[]) {
      if (S2_FACTS.has(t.fact)) {
        report.s2Applicable += 1;
        const got = nodes.get(t.ref)?.candidacy;
        if (got === t.value) report.s2Passed += 1;
        else report.failures.push(`candidacy ${t.ref}: ${got ?? 'not classified'}, expected ${t.value}`);
        continue;
      }
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
    // One-way check (contract §5.1): every listed candidate ID has in-domain or unresolved candidacy.
    // The field itself is an S6 output and stays out of scope; the converse is not checked.
    for (const id of (exp.evidence?.candidateEvidenceIds ?? []) as string[]) {
      report.s2CandidateIdsOneWay += 1;
      const c = nodes.get(id)?.candidacy;
      if (c !== 'InDomain' && c !== 'Unresolved') report.failures.push(`candidateEvidenceIds ${id}: S2 candidacy ${c ?? 'none'}`);
    }
    report.outOfScope += countExpected(exp) - ((exp.traceAssertions ?? []) as unknown[]).length;
    const checked = report.s1Applicable + report.s1AttributionOneWay + report.s2Applicable + report.s2AttributionOneWay + report.s2CandidateIdsOneWay;
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

/** Top-level expected fields plus trace assertions; used only to count what S1/S2 do not check. */
function countExpected(exp: Json): number {
  const fields = Object.keys(exp).filter((k) => k !== 'traceAssertions').length;
  return fields + ((exp.traceAssertions ?? []) as unknown[]).length;
}
