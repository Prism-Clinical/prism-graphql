/**
 * EXPERIMENTAL, NONCLINICAL. I7 single-query Need existence and deferral
 * (first-program-implementation-contract.md §8, *Single-query existence and deferral*).
 *
 * Expected outcomes come from the outcome table and evidence-query contract §6.2–§6.3 (rows 1–3:
 * {Missing, InsufficientEvidence}, then {Missing, Unavailable, InsufficientEvidence}, then
 * {Conflicting}, all under the same key). Expected keys are stated structurally; their digest is
 * experimentalNeedIdentity's, whose own expectations are independent (identity.test.ts).
 */
import {
  experimentalCompile,
  experimentalCompilePreview,
  experimentalNeedIdentity,
  experimentalQueryNeed as qn,
  QueryNeedConfigurationError,
  type CompiledPackage,
  type JsonValue,
  type NeedKey,
  type QueryNeedInput,
  type QueryNeedResult,
} from '../index';
import { COMPLETE, CTX, PKG, fail as failure, program, rev, snap, type J } from './support/s6-records';

const SNAP1 = snap([]); // §6.3 row 1: no records, no coverage statement
const SNAP2 = snap([], [failure('f1', { sources: ['s2'], appliesTo: { snapshot: 'snap-2' } })], 'snap-2'); // row 2: failure f1 on s2
const R1 = rev('r1');
const R2 = rev('r2', { assertion: 'Denied' }, 's2');
const SNAP3 = { ...snap([{ ...COMPLETE, appliesTo: { snapshot: 'snap-3' } }], [], 'snap-3') }; // row 3

type Over = Partial<Record<keyof QueryNeedInput, unknown>>;
const input = (over: Over = {}): QueryNeedInput => ({ package: PKG, query: 'q', revisions: [], retractions: [], snapshot: SNAP1, ...CTX, ...over } as QueryNeedInput);
const run = (over: Over = {}) => qn(input(over));
const evidenceNeed = (r: QueryNeedResult) => {
  if (r.need.kind !== 'evidence') throw new Error(`expected an evidence Need, got ${JSON.stringify(r.need)}`);
  return r.need;
};
const keyOf = (over: Over = {}) => evidenceNeed(run(over)).key;
const identity = (pkg: CompiledPackage, query: string, ctx: J = CTX): NeedKey => {
  const r = experimentalNeedIdentity({ package: pkg, query, subject: ctx.subject, contextEpisode: ctx.contextEpisode, contextEncounter: ctx.contextEncounter });
  if (!('key' in r)) throw new Error('no key');
  return r.key;
};
function compiled(p: J): CompiledPackage {
  const r = experimentalCompile(p as JsonValue);
  if (r.outcome !== 'Compiled') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
const withPackage = (id: string, p: J = program()) => ({ ...p, package: { ...p.package, id } });
const withAssertionKinds = (kinds: string[], p: J = program()) => {
  const q = p.nodes[0];
  return { ...p, nodes: [{ ...q, contract: { ...q.contract, admissible: { ...q.contract.admissible, assertionKind: { in: kinds } } } }, ...p.nodes.slice(1)] };
};

describe('outcome table', () => {
  test('Known(true) and Known(false): no evidence Need', () => {
    const t = run({ revisions: [R1], snapshot: snap() });
    expect(t.queryEvidence.evidence).toMatchObject({ status: 'Known', value: true });
    expect(t.need).toEqual({ kind: 'none' });
    const f = run({ revisions: [rev('r9', { assertion: 'Denied' })], snapshot: snap() });
    expect(f.queryEvidence.evidence).toMatchObject({ status: 'Known', value: false });
    expect(f.need).toEqual({ kind: 'none' });
  });

  test('Unresolved with known bindings: package-qualified key and the exact current causes', () => {
    const r = run();
    expect(r.queryEvidence.evidence).toMatchObject({ status: 'Unresolved', causes: ['Missing', 'InsufficientEvidence'] });
    expect(r.need).toEqual({
      kind: 'evidence',
      key: { query: { package: 'test.s6a', id: 'q' }, contractDigest: { scheme: 'ppl-query-contract-digest/0', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }, subject: 'P1', episode: 'E1', encounter: 'N1' },
      causes: ['Missing', 'InsufficientEvidence'],
    });
    expect(evidenceNeed(r).key).toEqual(identity(PKG, 'q'));
    expect(r.query).toEqual({ package: 'test.s6a', id: 'q' });
    expect(r.snapshot).toBe('snap-1');
    expect(r.notImplemented).toEqual(['Obligations', 'Lifecycle', 'FulfilledBy', 'ProgramMateriality', 'Acquisition']);
  });

  test('§6.3 rows 1–3: causes and snapshots change, the key does not', () => {
    const rows = [run(), run({ snapshot: SNAP2 }), run({ revisions: [R1, R2], snapshot: SNAP3 })];
    expect(rows.map((r) => evidenceNeed(r).causes)).toEqual([['Missing', 'InsufficientEvidence'], ['Missing', 'Unavailable', 'InsufficientEvidence'], ['Conflicting']]);
    expect(rows.map((r) => r.snapshot)).toEqual(['snap-1', 'snap-2', 'snap-3']);
    const keys = rows.map((r) => evidenceNeed(r).key);
    expect(keys[1]).toEqual(keys[0]);
    expect(keys[2]).toEqual(keys[0]);
    // State never enters the key.
    for (const k of keys) expect(Object.keys(k).sort()).toEqual(['contractDigest', 'encounter', 'episode', 'query', 'subject']);
  });

  test('a different contract, namespace, query, subject, episode or encounter changes the key as specified', () => {
    const base = keyOf();
    const other = (k: NeedKey) => expect(k).not.toEqual(base);
    // Contract: another assertionKind set (§6.3 row 5 / case 115): new digest.
    const ak = keyOf({ package: compiled(withAssertionKinds(['ClinicianDocumented', 'PatientReport'])) });
    expect(ak.contractDigest).not.toEqual(base.contractDigest);
    // Namespace: same contract, new package: same digest, new key.
    const ns = keyOf({ package: compiled(withPackage('test.other')) });
    expect(ns.contractDigest).toEqual(base.contractDigest);
    expect(ns.query).toEqual({ package: 'test.other', id: 'q' });
    // Query ID.
    const qid = keyOf({ package: compiled(program('q2')), query: 'q2' });
    expect(qid.query).toEqual({ package: 'test.s6a', id: 'q2' });
    expect(qid.contractDigest).toEqual(base.contractDigest);
    const subject = keyOf({ subject: 'P2' });
    expect(subject.subject).toBe('P2');
    const episode = keyOf({ contextEpisode: { known: 'E2' } });
    expect(episode.episode).toBe('E2');
    const encounter = keyOf({ contextEncounter: { known: 'N2' } }); // §6.3 row 6
    expect(encounter.encounter).toBe('N2');
    [ak, ns, qid, subject, episode, encounter].forEach(other);
  });
});

describe('deferral', () => {
  test('unknown episode, unknown encounter and both: no key, every binding in order', () => {
    const ep = run({ revisions: [R1], snapshot: snap(), contextEpisode: { unknown: ['Conflicting'] } });
    expect(ep.queryEvidence.evidence).toMatchObject({ status: 'Unresolved', causes: ['Conflicting'] }); // case 12
    expect(ep.need).toEqual({ kind: 'deferred', unresolvedBindings: ['episode'] });
    const en = run({ revisions: [R1], snapshot: snap(), contextEncounter: { unknown: ['Conflicting'] } });
    expect(en.queryEvidence.evidence).toMatchObject({ status: 'Unresolved', causes: ['Conflicting'] }); // case 102
    expect(en.need).toEqual({ kind: 'deferred', unresolvedBindings: ['encounter'] });
    const both = run({ revisions: [R1], snapshot: snap(), contextEpisode: { unknown: ['Conflicting'] }, contextEncounter: { unknown: ['Missing'] } });
    expect(both.queryEvidence.evidence).toMatchObject({ status: 'Unresolved', causes: ['Missing', 'Conflicting'] });
    expect(both.need).toEqual({ kind: 'deferred', unresolvedBindings: ['episode', 'encounter'] });
    for (const r of [ep, en, both]) expect(JSON.stringify(r.need)).not.toContain('key');
  });
});

describe('configuration errors, never Needs or deferrals', () => {
  const bad = (over: Over | unknown, msg: RegExp, raw = false) => {
    const call = () => qn((raw ? over : input(over as Over)) as QueryNeedInput);
    expect(call).toThrow(QueryNeedConfigurationError);
    expect(call).toThrow(msg);
  };
  test('malformed bindings', () => {
    for (const b of [{}, { known: '' }, { unknown: [] }, { unknown: ['Bogus'] }, { known: 'E1', unknown: ['Missing'] }, null]) {
      bad({ contextEpisode: b }, /contextEpisode/);
      bad({ contextEncounter: b }, /contextEncounter/);
    }
    bad({ contextEpisode: Object.defineProperty({}, 'known', { get: () => 'E1', enumerable: true }) }, /accessor/);
  });
  test('no caller-supplied evidence, stage result, key, digest, causes or namespace', () => {
    const r = run();
    for (const extra of ['s4', 'evidence', 'queryEvidence', 'need', 'key', 'contractDigest', 'causes', 'namespace', 'packageId', 'valueSet'])
      bad({ [extra]: extra === 'key' ? evidenceNeed(r).key : extra === 'queryEvidence' ? r.queryEvidence : 'x' }, /unexpected input field/);
    bad(null, /input must be an object/, true);
    const { snapshot: _s, ...noSnapshot } = input();
    bad(noSnapshot, /missing input field\(s\) snapshot/, true);
    bad({ snapshot: { id: 'snap-1', coverage: [] } }, /snapshot must state/);
  });
  test('copied, fabricated, foreign-query and preview packages', () => {
    bad({ package: { ...PKG } }, /CompiledPackage produced by experimentalCompile/);
    bad({ package: JSON.parse(JSON.stringify(PKG)) }, /CompiledPackage produced by experimentalCompile/);
    bad({ query: 'pv' }, /not an EvidenceQuery/);
    bad({ query: 'q2' }, /not an EvidenceQuery/); // a query of another package
    const pv = experimentalCompilePreview({ ...program(), applicability: { id: 'scope', kind: 'Predicate', expr: { hole: { id: 'H-S', type: 'Decision', explains: 'x' } } } } as JsonValue);
    if (pv.outcome !== 'PreviewPackage') throw new Error('preview did not compile');
    bad({ package: pv.package }, /preview packages are rejected/);
    const holed = experimentalCompilePreview({ ...program(), nodes: [{ ...program().nodes[0], contract: { ...program().nodes[0].contract, establishes: { hole: { id: 'H-E', type: 'Decision', explains: 'x' } } } }, ...program().nodes.slice(1)] } as JsonValue);
    if (holed.outcome !== 'PreviewPackage') throw new Error('preview did not compile');
    bad({ package: holed.package }, /preview packages are rejected/);
  });
});

describe('one evaluation per call', () => {
  test('interleaved evaluations with identical query IDs stay isolated', () => {
    const A = PKG;
    const B = compiled(withPackage('test.b', withAssertionKinds(['ClinicianDocumented', 'PatientReport'])));
    const kA = identity(A, 'q');
    const kB = identity(B, 'q', { ...CTX, subject: 'P2' });
    const a1 = run({ package: A });
    const b1 = run({ package: B, subject: 'P2', snapshot: snap([], [failure('f1', { sources: ['s2'], subject: 'P2', appliesTo: { snapshot: 'snap-2' } })], 'snap-2') });
    const a2 = run({ package: A, revisions: [R1], snapshot: snap() });
    const b2 = run({ package: B, subject: 'P2', revisions: [R1, R2], snapshot: SNAP3 });
    const a3 = run({ package: A, snapshot: SNAP2 });
    expect(evidenceNeed(a1)).toEqual({ kind: 'evidence', key: kA, causes: ['Missing', 'InsufficientEvidence'] });
    expect(evidenceNeed(b1)).toEqual({ kind: 'evidence', key: kB, causes: ['Missing', 'Unavailable', 'InsufficientEvidence'] });
    expect(a2.need).toEqual({ kind: 'none' });
    // Records for P1 are outside B's P2 envelope; no coverage for P2: never A's or b1's evidence.
    expect(evidenceNeed(b2).key).toEqual(kB);
    expect(evidenceNeed(b2).causes).not.toContain('Conflicting');
    expect(evidenceNeed(a3)).toEqual({ kind: 'evidence', key: kA, causes: ['Missing', 'Unavailable', 'InsufficientEvidence'] });
    expect([a1, a2, a3].map((r) => r.query.package)).toEqual(['test.s6a', 'test.s6a', 'test.s6a']);
    expect([b1, b2].map((r) => r.queryEvidence.snapshot)).toEqual(['snap-2', 'snap-3']);
  });

  test('two queries of one package each get their own key and evidence', () => {
    const p = program();
    const q2 = { ...p.nodes[0], id: 'q2', contract: { ...p.nodes[0].contract, retrieve: { ...p.nodes[0].contract.retrieve, sources: ['s1'] } } };
    const pkg = compiled({ ...p, nodes: [...p.nodes, q2, { id: 'pv2', kind: 'Predicate', expr: { evidenceValue: { ref: 'q2' } } }] });
    const r1 = run({ package: pkg, query: 'q', revisions: [R1, R2], snapshot: SNAP3 });
    const r2 = run({ package: pkg, query: 'q2', revisions: [R1, R2], snapshot: SNAP3 });
    expect(evidenceNeed(r1)).toEqual({ kind: 'evidence', key: identity(pkg, 'q'), causes: ['Conflicting'] }); // s2/r2 is in q's sources
    expect(r2.need).toEqual({ kind: 'none' }); // q2 reads only s1: Known(true)
    expect(identity(pkg, 'q2')).not.toEqual(identity(pkg, 'q'));
    // Both Unresolved (§6.3 row 1): each query's own key, never the other's.
    const u1 = run({ package: pkg, query: 'q' });
    const u2 = run({ package: pkg, query: 'q2' });
    expect(evidenceNeed(u1).key).toEqual(identity(pkg, 'q'));
    expect(evidenceNeed(u2).key).toEqual(identity(pkg, 'q2'));
    expect(u2.query).toEqual({ package: 'test.s6a', id: 'q2' });
  });
});

describe('ownership', () => {
  test('results are detached and deep-frozen; caller inputs are unchanged and not frozen', () => {
    const records = [rev('r1'), rev('r2', { assertion: 'Denied' }, 's2')];
    const ctxEp = { known: 'E1' };
    const inp = input({ revisions: records, snapshot: SNAP3, contextEpisode: ctxEp });
    const before = JSON.stringify(inp);
    const r = qn(inp);
    expect(JSON.stringify(inp)).toBe(before);
    expect([records, records[0], ctxEp, inp].some(Object.isFrozen)).toBe(false);
    const deepFrozen = (v: unknown): boolean => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(deepFrozen));
    expect(deepFrozen(r)).toBe(true);
    ctxEp.known = 'E9';
    records[0]!.assertion = 'Denied';
    expect(evidenceNeed(r).key.episode).toBe('E1');
    expect(evidenceNeed(r).causes).toEqual(['Conflicting']);
  });
});
