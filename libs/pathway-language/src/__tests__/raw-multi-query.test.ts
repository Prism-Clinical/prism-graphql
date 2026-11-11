/**
 * EXPERIMENTAL, NONCLINICAL. A bounded I6 slice: normal execution of a program with several complete
 * EvidenceQueries over ONE raw-record snapshot (first-program contract §8, "Raw-input execution
 * boundary", multi-query). Each query is computed under its own authored contract; the program
 * evaluator combines them. Expected values are written from the evidence-query contract (§2–§5) and
 * the executor semantics (contract §3: `evidenceValue`, Kleene `all`, Findings), never by calling the
 * implementation.
 *
 * Contract differences the compiler can express (and so the ones used here): source scope, value-set
 * pin, assertionKind admissibility and the establishes/refutes criteria. Record type, the correction
 * authority rule and the episode/encounter rules have one supported value each, so queries cannot
 * differ in them.
 */
import * as evidenceModule from '../s6/evidence';
import {
  RawExecutionConfigurationError,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalExecuteFromRawRecords,
  experimentalExecutePreviewFromRawRecords,
  experimentalQueryEvidence,
  experimentalSelectForQuery,
  RawPreviewConfigurationError,
  DEMO_AUTHORITY_RULE,
  experimentalResolveRevisionHistory as resolve,
  type CompiledPackage,
  type EvaluationSnapshot,
  type JsonValue,
  type NodeRef,
  type RawExecutionResult,
  type RawMultiQueryExecutionResult,
} from '../index';
import { AMEND, COMPLETE, CTX, REFUTING, SUPPORTING, compiled, fail, program, rev, show, snap, sup, type J } from './support/s6-records';

const BASE: J = program().nodes[0].contract;
/** The base contract with some settings replaced (sources, assertionKinds, inverted criteria). */
const contract = (o: { sources?: string[]; kinds?: string[]; inverted?: boolean } = {}): J => ({
  ...BASE,
  retrieve: { ...BASE.retrieve, ...(o.sources ? { sources: o.sources } : {}) },
  admissible: { ...BASE.admissible, ...(o.kinds ? { assertionKind: { in: o.kinds } } : {}) },
  ...(o.inverted ? { establishes: BASE.refutes, refutes: BASE.establishes } : {}),
});
const query = (id: string, c: J): J => ({ id, kind: 'EvidenceQuery', subject: 'patient', output: 'Evidence<Boolean>', contract: c });
/** qa, qb; `pa`/`pb` = evidenceValue; `both = all(ref pa, ref pb)`; Finding `f = all(ref scope, ref both)`. */
const source = (a: J = contract(), b: J = contract(), ids: [string, string] = ['qa', 'qb'], swap = false): J => {
  const qs = [query(ids[0], a), query(ids[1], b)];
  return {
    ...program(),
    package: { id: 'test.i6.multi', state: 'Draft' },
    nodes: [
      ...(swap ? qs.reverse() : qs),
      { id: 'pa', kind: 'Predicate', expr: { evidenceValue: { ref: ids[0] } } },
      { id: 'pb', kind: 'Predicate', expr: { evidenceValue: { ref: ids[1] } } },
      { id: 'both', kind: 'Predicate', expr: { all: [{ ref: 'pa' }, { ref: 'pb' }] } },
      { id: 'f', kind: 'Finding', status: { all: [{ ref: 'scope' }, { ref: 'both' }] }, label: 'Schematic two-query finding (nonclinical)' },
    ],
  };
};
const S1_ONLY = contract({ sources: ['s1'] });
const S2_ONLY = contract({ sources: ['s2'] });

const input = (revisions: J[], snapshot: EvaluationSnapshot = snap(), retractions: J[] = []) => ({ ...CTX, revisions: revisions as JsonValue[], retractions: retractions as JsonValue[], snapshot });
const multi = (r: RawExecutionResult): RawMultiQueryExecutionResult => {
  if (r.scope !== 'multi-query-program-from-raw-records') throw new Error(`expected the multi-query shape, got ${r.scope}`);
  return r;
};
const run = (pkg: CompiledPackage, revisions: J[], snapshot?: EvaluationSnapshot) => multi(experimentalExecuteFromRawRecords(pkg, input(revisions, snapshot)));

const node = (localId: string, revision = '1', source = 's1', digest?: string): NodeRef => ({ revision: { source, localId, revision }, ...(digest ? { digest } : {}) });
const ids = (o: unknown) => {
  const x = o as { supportingEvidenceIds?: NodeRef[]; candidateEvidenceIds?: NodeRef[] };
  return x.supportingEvidenceIds ?? x.candidateEvidenceIds;
};
/** Decision outputs of pa, pb, both and f in display notation (identities are checked separately). */
const decisions = (r: RawExecutionResult) =>
  Object.fromEntries(['pa', 'pb', 'both', 'f'].map((k) => {
    const o = r.outputs[k] as { decision?: unknown; status?: unknown };
    return [k, [o.decision ?? o.status, ids(o)!.map(show)]];
  }));
const evidenceOf = (r: RawMultiQueryExecutionResult, q: string) => r.queryEvidenceResults.find((x) => x.query === q)!;
const TRUE = { value: 'True' };
const FALSE = { value: 'False' };
const unknown = (...causes: string[]) => ({ value: 'Unknown', causes });
const s2 = (localId: string, over: J = {}) => rev(localId, over, 's2');

describe('multi-query raw execution: Kleene composition of independently computed queries', () => {
  it('1, 6. both True: True; a revision cited by both queries is deduplicated, and both query traces are kept', () => {
    const r = run(compiled(source()), [SUPPORTING]);
    expect(decisions(r)).toEqual({ pa: [TRUE, ['s1/r1@1']], pb: [TRUE, ['s1/r1@1']], both: [TRUE, ['s1/r1@1']], f: [TRUE, ['s1/r1@1']] });
    expect(r.queries).toEqual(['qa', 'qb']);
    expect(r.queryEvidenceResults.map((x) => x.query)).toEqual(['qa', 'qb']);
    for (const q of ['qa', 'qb']) {
      const ev = evidenceOf(r, q);
      expect(ev.evidence).toEqual({ status: 'Known', value: true, supportingEvidenceIds: [node('r1')], provenance: [{ ref: node('r1'), occurrences: [{ acquisition: 'a0', sourceRecordRef: 's1:r1' }] }] });
      expect(ev.trace.query).toBe(q);
      expect(r.outputs[q]).toEqual({ evidence: ev.evidence, origin: 'computed' });
      expect(r.trace.find((t) => t.output === q)?.result).toBe('Known(true, [s1/r1@1])');
    }
    // Two separate S6 traces, not one object shared.
    expect(evidenceOf(r, 'qa').trace).not.toBe(evidenceOf(r, 'qb').trace);
  });

  it('2. True and False: False, with only the False operand’s references', () => {
    const r = run(compiled(source(S1_ONLY, S2_ONLY)), [SUPPORTING, s2('r2', { assertion: 'Denied' })]);
    expect(decisions(r)).toEqual({ pa: [TRUE, ['s1/r1@1']], pb: [FALSE, ['s2/r2@1']], both: [FALSE, ['s2/r2@1']], f: [FALSE, ['s2/r2@1']] });
  });

  it('3. True and Unknown: Unknown, with causes and candidates from the Unknown operand only', () => {
    const r = run(compiled(source(S1_ONLY, S2_ONLY)), [SUPPORTING, s2('r7', { assertion: 'Indeterminate' })]);
    // EA-006: a lone non-informative record under complete coverage is InsufficientEvidence (NonInformativeSeen).
    expect(evidenceOf(r, 'qb').evidence).toEqual({ status: 'Unresolved', causes: ['InsufficientEvidence'], candidateEvidenceIds: [node('r7', '1', 's2')] });
    const u = unknown('InsufficientEvidence');
    expect(decisions(r)).toEqual({ pa: [TRUE, ['s1/r1@1']], pb: [u, ['s2/r7@1']], both: [u, ['s2/r7@1']], f: [u, ['s2/r7@1']] });
  });

  it('4. False and Unknown: False; the uncertainty stays visible in its own query result', () => {
    const r = run(compiled(source(S1_ONLY, S2_ONLY)), [REFUTING]);
    expect(decisions(r)).toEqual({ pa: [FALSE, ['s1/r2@1']], pb: [unknown('Missing'), []], both: [FALSE, ['s1/r2@1']], f: [FALSE, ['s1/r2@1']] });
    expect(r.outputs['qb']).toEqual({ evidence: { status: 'Unresolved', causes: ['Missing'], candidateEvidenceIds: [] }, origin: 'computed' });
    expect(evidenceOf(r, 'qb').trace.attribution.map((a) => [a.cause, a.reason])).toEqual([['Missing', 'NoInDomainRecord']]);
  });

  it('5, 12. both Unknown: causes and candidates are the union; one shared failure statement is judged per query scope', () => {
    // Failure f1 covers s1 only. qa reads s1 and s2; qb reads s2 only.
    const r = run(compiled(source(contract(), S2_ONLY)), [SUPPORTING, rev('r12', { encounter: undefined })], snap([COMPLETE], [fail('f1')]));
    expect(evidenceOf(r, 'qa').evidence).toEqual({ status: 'Unresolved', causes: ['Missing', 'Unavailable'], candidateEvidenceIds: [node('r1'), node('r12')] });
    expect(evidenceOf(r, 'qb').evidence).toEqual({ status: 'Unresolved', causes: ['Missing'], candidateEvidenceIds: [] });
    expect(decisions(r)['f']).toEqual([unknown('Missing', 'Unavailable'), ['s1/r1@1', 's1/r12@1']]);
  });

  it('12. one shared coverage statement is judged per query scope', () => {
    // Coverage Complete for s1 only: qa (s1, s2) lacks coverage of s2; qb (s1) is fully covered.
    const s1Only = { ...COMPLETE, id: 'cov-s1', sources: ['s1'] };
    const r = run(compiled(source(contract(), S1_ONLY)), [SUPPORTING], snap([s1Only]));
    expect(evidenceOf(r, 'qa').evidence).toEqual({ status: 'Unresolved', causes: ['InsufficientEvidence'], candidateEvidenceIds: [node('r1')] });
    expect(evidenceOf(r, 'qb').evidence).toMatchObject({ status: 'Known', value: true, supportingEvidenceIds: [node('r1')] });
    expect(decisions(r)['f']).toEqual([unknown('InsufficientEvidence'), ['s1/r1@1']]);
    expect(r.snapshot).toBe('snap-1');
    for (const q of ['qa', 'qb']) expect(evidenceOf(r, q).snapshot).toBe('snap-1');
  });
});

describe('multi-query raw execution: per-query contracts over one shared input', () => {
  it('9. same value-set pin, different admissibility: independent results from the same record', () => {
    const report = rev('r6', { assertionKind: 'PatientReport' });
    const r = run(compiled(source(contract(), contract({ kinds: ['ClinicianDocumented', 'PatientReport'] }))), [report]);
    expect(evidenceOf(r, 'qa').evidence).toEqual({ status: 'Unresolved', causes: ['Inadmissible'], candidateEvidenceIds: [node('r6')] });
    expect(evidenceOf(r, 'qb').evidence).toMatchObject({ status: 'Known', value: true, supportingEvidenceIds: [node('r6')] });
    expect(decisions(r)['f']).toEqual([unknown('Inadmissible'), ['s1/r6@1']]);
  });

  it('10. different source scopes do not share resolved history', () => {
    // s2/r20: revision 1 Affirmed, then an authorized same-source amendment to Denied.
    const history = [s2('r20'), s2('r20', { revision: '2', supersedes: { ...sup('r20'), source: 's2' }, author: AMEND, assertion: 'Denied' })];
    const r = run(compiled(source(contract(), S1_ONLY)), [...history, SUPPORTING]);
    // qa reads s1 and s2: r1 supports, the current s2/r20@2 refutes: Conflicting.
    expect(evidenceOf(r, 'qa').evidence).toEqual({ status: 'Unresolved', causes: ['Conflicting'], candidateEvidenceIds: [node('r1'), node('r20', '2', 's2')] });
    // qb reads s1 only: s2/r20 is outside its envelope.
    expect(evidenceOf(r, 'qb').evidence).toMatchObject({ status: 'Known', value: true, supportingEvidenceIds: [node('r1')] });
    expect(evidenceOf(r, 'qb').trace.stepB.stepA.supporting).toEqual([node('r1')]);
  });

  it('11. different establishes/refutes give each query its own answer from the same records', () => {
    const r = run(compiled(source(contract(), contract({ inverted: true }))), [SUPPORTING]);
    expect(decisions(r)).toEqual({ pa: [TRUE, ['s1/r1@1']], pb: [FALSE, ['s1/r1@1']], both: [FALSE, ['s1/r1@1']], f: [FALSE, ['s1/r1@1']] });
  });

  it('9-11. each query result equals its standalone query-bound evaluation of the same inputs', () => {
    const pkg = compiled(source(contract(), contract({ sources: ['s1'], kinds: ['ClinicianDocumented', 'PatientReport'], inverted: true })));
    const records = [SUPPORTING, rev('r6', { assertionKind: 'PatientReport' }), s2('r2', { assertion: 'Denied' })];
    const r = run(pkg, records);
    for (const q of ['qa', 'qb']) {
      const s4 = experimentalSelectForQuery({ package: pkg, query: q, ...input(records) });
      expect(evidenceOf(r, q)).toEqual(experimentalQueryEvidence({ package: pkg, query: q, s4 }));
    }
  });
});

describe('multi-query raw execution: identity', () => {
  it('7. distinct structured identities with identical display labels stay distinct across queries', () => {
    // s1 localId `a@1` revision `1` and s1 localId `a` revision `1@1`: both display as s1/a@1@1.
    const r = run(compiled(source(contract(), contract({ kinds: ['ClinicianDocumented', 'PatientReport'] }))), [rev('a@1'), rev('a', { revision: '1@1', assertionKind: 'PatientReport' })]);
    // qa admits only the ClinicianDocumented one (the other is inadmissible and could only support: immaterial).
    expect(evidenceOf(r, 'qa').evidence).toMatchObject({ status: 'Known', supportingEvidenceIds: [node('a@1')] });
    expect(evidenceOf(r, 'qb').evidence).toMatchObject({ status: 'Known', supportingEvidenceIds: [node('a', '1@1'), node('a@1')] });
    expect(ids(r.outputs['f'])).toEqual([node('a', '1@1'), node('a@1')]);
    expect(ids(r.outputs['f'])!.map(show)).toEqual(['s1/a@1@1', 's1/a@1@1']);
  });

  it('8. variant digests survive cross-query propagation', () => {
    const records = [rev('r11'), rev('r11', { assertion: 'Denied', provenance: { acquisition: 'a1', sourceRecordRef: 's1:r11' } })];
    const r = run(compiled(source(contract(), S1_ONLY)), records);
    const qa = evidenceOf(r, 'qa').evidence;
    if (qa.status !== 'Unresolved') throw new Error('expected Unresolved');
    expect(qa.candidateEvidenceIds).toHaveLength(2);
    expect(qa.candidateEvidenceIds.every((n) => n.revision.localId === 'r11' && /^[0-9a-f]{64}$/.test(n.digest ?? ''))).toBe(true);
    expect(evidenceOf(r, 'qb').evidence).toEqual(qa);
    expect(decisions(r)['f']![0]).toEqual(unknown('Conflicting'));
    for (const k of ['pa', 'pb', 'both', 'f']) expect(ids(r.outputs[k])).toEqual(qa.candidateEvidenceIds);
  });

  it('13. query IDs such as __proto__, constructor and toString stay ordinary identifiers', () => {
    const pkg = compiled({
      ...program(),
      package: { id: 'test.i6.names', state: 'Draft' },
      nodes: [
        query('__proto__', contract()),
        query('constructor', contract({ inverted: true })),
        { id: 'toString', kind: 'Predicate', expr: { all: [{ evidenceValue: { ref: '__proto__' } }, { evidenceValue: { ref: 'constructor' } }] } },
        { id: 'f', kind: 'Finding', status: { all: [{ ref: 'scope' }, { ref: 'toString' }] }, label: 'Schematic finding (nonclinical)' },
      ],
    });
    const r = run(pkg, [SUPPORTING]);
    expect(r.queries).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf(r.outputs)).toBe(Object.prototype);
    for (const k of ['__proto__', 'constructor', 'toString']) expect(Object.prototype.hasOwnProperty.call(r.outputs, k)).toBe(true);
    expect((r.outputs['__proto__'] as J).evidence).toMatchObject({ status: 'Known', value: true });
    expect((r.outputs['constructor'] as J).evidence).toMatchObject({ status: 'Known', value: false });
    expect((r.outputs['toString'] as J).decision).toEqual(FALSE);
    expect(evidenceOf(r, '__proto__').evidence).toMatchObject({ value: true });
    expect(evidenceOf(r, 'constructor').evidence).toMatchObject({ value: false });
  });
});

describe('multi-query raw execution: determinism, ownership and failure', () => {
  it('14. declaration order and raw-record permutation do not change semantic results', () => {
    const records = [SUPPORTING, s2('r2', { assertion: 'Denied' }), rev('r7', { assertion: 'Indeterminate' }), rev('r12', { encounter: undefined })];
    const a = run(compiled(source(contract(), S1_ONLY)), records);
    expect(run(compiled(source(contract(), S1_ONLY)), [...records].reverse())).toEqual(a);
    const swapped = run(compiled(source(contract(), S1_ONLY, ['qa', 'qb'], true)), records);
    expect(swapped.queries).toEqual(a.queries);
    expect(swapped.queryEvidenceResults).toEqual(a.queryEvidenceResults);
    expect(swapped.outputs).toEqual(a.outputs);
    expect(swapped.trace.map((t) => [t.output, t.result])).toEqual(expect.arrayContaining(a.trace.map((t) => [t.output, t.result])));
  });

  it('15. interleaved evaluations with identical query IDs and record labels keep their own evidence', () => {
    const p1 = compiled(source());
    const p2 = compiled(source(contract(), contract({ inverted: true })));
    const a = run(p1, [SUPPORTING]);
    const b = run(p2, [SUPPORTING]);
    const c = run(p1, [REFUTING]);
    const a2 = run(p1, [SUPPORTING]);
    expect(decisions(a)['f']).toEqual([TRUE, ['s1/r1@1']]);
    expect(decisions(b)['f']).toEqual([FALSE, ['s1/r1@1']]);
    expect(decisions(c)['f']).toEqual([FALSE, ['s1/r2@1']]);
    expect(a2).toEqual(a);
    expect(evidenceOf(b, 'qb').evidence).toMatchObject({ value: false });
  });

  it('16. a failure evaluating one query fails the whole call: no partial program, never patient Unknown', () => {
    const pkg = compiled(source());
    const real = evidenceModule.queryEvidence;
    const spy = jest.spyOn(evidenceModule, 'queryEvidence');
    try {
      spy.mockImplementation((i) => {
        if (i.query === 'qb') throw new evidenceModule.QueryEvidenceConfigurationError('qb is misconfigured');
        return real(i);
      });
      expect(() => experimentalExecuteFromRawRecords(pkg, input([SUPPORTING]))).toThrow(RawExecutionConfigurationError);
      spy.mockImplementation((i) => {
        if (i.query === 'qb') throw new Error('invariant: engine defect');
        return real(i);
      });
      // An engine error is not reclassified as configuration or as patient uncertainty.
      expect(() => experimentalExecuteFromRawRecords(pkg, input([SUPPORTING]))).toThrow(/^invariant: engine defect$/);
      expect(() => experimentalExecuteFromRawRecords(pkg, input([SUPPORTING]))).not.toThrow(RawExecutionConfigurationError);
    } finally {
      spy.mockRestore();
    }
    expect(decisions(run(pkg, [SUPPORTING]))['f']).toEqual([TRUE, ['s1/r1@1']]);
  });

  const bad = (pkg: unknown, inp: unknown, pattern: RegExp) => {
    expect(() => experimentalExecuteFromRawRecords(pkg as never, inp as never)).toThrow(RawExecutionConfigurationError);
    expect(() => experimentalExecuteFromRawRecords(pkg as never, inp as never)).toThrow(pattern);
  };

  it('19. ownership: preview, copied and fabricated packages, zero queries, supplied answers and per-query overrides are rejected', () => {
    const pkg = compiled(source());
    const ok = input([SUPPORTING]);
    for (const f of ['query', 'queries', 'queryEvidence', 'queryEvidenceResults', 'suppliedQueryResults', 'evidence', 'decision', 'decisions', 's1', 's4', 'stageResults', 'evidenceIds', 'tokens', 'refs', 'identities', 'snapshots', 'contexts', 'perQuery', 'overrides', 'qa', 'qb', 'sources', 'authorityRule', 'valueSet', 'admissible', 'establishes', 'refutes']) {
      bad(pkg, { ...ok, [f]: {} }, new RegExp(`unexpected input field\\(s\\) ${f}`));
    }
    // A per-query snapshot map is not a snapshot.
    bad(pkg, { ...ok, snapshot: { qa: snap(), qb: snap() } }, /unexpected snapshot field/);
    bad(pkg, { ...CTX, revisions: [], retractions: [] }, /a snapshot is required/);
    bad(JSON.parse(JSON.stringify(pkg)), ok, /produced by experimentalCompile/);
    bad({ ...pkg }, ok, /produced by experimentalCompile/);
    bad(Object.assign(Object.create(Object.getPrototypeOf(pkg)), pkg), ok, /produced by experimentalCompile/);
    bad(experimentalCompile(source() as JsonValue), ok, /produced by experimentalCompile/);
    bad(compiled({ ...source(), nodes: [{ id: 'f', kind: 'Finding', status: { all: [{ ref: 'scope' }] }, label: 'x' }] }), ok, /one or more EvidenceQueries; the package has 0/);
    const p = experimentalCompilePreview({ ...source(), nodes: [...source().nodes, { id: 'g', kind: 'Finding', status: { all: [] }, label: 'y', urgency: { hole: { id: 'H-U', type: 'UrgencyRequirement', explains: 'x' } } }] } as JsonValue);
    if (p.outcome !== 'PreviewPackage') throw new Error('preview');
    bad(p.package, ok, /preview packages are not executed here/);
  });

  it('18, 21. multi-query preview stays unsupported; the preview entry point is unchanged', () => {
    const p = experimentalCompilePreview({ ...source(), nodes: [...source().nodes, { id: 'g', kind: 'Finding', status: { all: [] }, label: 'y', urgency: { hole: { id: 'H-U', type: 'UrgencyRequirement', explains: 'x' } } }] } as JsonValue);
    if (p.outcome !== 'PreviewPackage') throw new Error('preview');
    expect(() => experimentalExecutePreviewFromRawRecords(p.package, input([SUPPORTING]))).toThrow(RawPreviewConfigurationError);
    expect(() => experimentalExecutePreviewFromRawRecords(p.package, input([SUPPORTING]))).toThrow(/exactly one EvidenceQuery; the package has 2/);
  });

  it('17. a one-query program keeps the one-query result shape exactly', () => {
    const r = experimentalExecuteFromRawRecords(compiled({ ...program(), nodes: [...program().nodes] }), input([SUPPORTING]));
    expect(r.scope).toBe('one-query-program-from-raw-records');
    expect(Object.keys(r).sort()).toEqual(['experimental', 'findingAttributes', 'mode', 'notRun', 'outcome', 'outputs', 'packageId', 'query', 'queryEvidence', 'scope', 'snapshot', 'trace'].sort());
    expect(r.notRun).toEqual(['Needs', 'Acquisition', 'Preview', 'MultiQuery']);
  });

  it('20, 21. detached and deeply immutable after the inputs change; no Needs, acquisition or preview output', () => {
    const records = [SUPPORTING, s2('r2', { assertion: 'Denied' })];
    const sn = snap();
    const r = run(compiled(source(contract(), S1_ONLY)), records, sn);
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    const before = JSON.stringify(r);
    records[0]!['assertion'] = 'Denied';
    (records[1]!['key'] as J)['localId'] = 'changed';
    records.push(rev('r99'));
    (sn.coverage as J[]).length = 0;
    expect(JSON.stringify(r)).toBe(before);
    expect(Object.keys(r).sort()).toEqual(['experimental', 'findingAttributes', 'mode', 'notRun', 'outcome', 'outputs', 'packageId', 'queries', 'queryEvidenceResults', 'scope', 'snapshot', 'trace'].sort());
    expect([r.outcome, r.experimental, r.scope, r.mode, r.packageId, r.snapshot, r.notRun]).toEqual(['Executed', 'nonclinical-ppl-raw-input-execution-v0', 'multi-query-program-from-raw-records', 'normal', 'test.i6.multi', 'snap-1', ['Needs', 'Acquisition', 'Preview']]);
    for (const f of ['needs', 'markers', 'publication', 'inspectable', 'marker', 'acquisition"', 'query"']) expect(Object.keys(r)).not.toContain(f);
    expect(JSON.stringify(r)).not.toMatch(/"needs"|"markers"|"publication"/);
  });
});

describe('multi-query raw execution: one stable evaluation input (review of e366fce)', () => {
  const TWIN = () => compiled(source());
  /** A record whose `assertion` getter returns Affirmed for its first two reads, then Denied (the review counterexample). */
  const flipping = () => {
    let reads = 0;
    const r = rev('r1');
    delete r['assertion'];
    Object.defineProperty(r, 'assertion', { enumerable: true, get: () => (++reads <= 2 ? 'Affirmed' : 'Denied') });
    return { r, reads: () => reads };
  };

  it('rejects an accessor record without invoking it (the review counterexample)', () => {
    const { r, reads } = flipping();
    expect(() => experimentalExecuteFromRawRecords(TWIN(), input([r]))).toThrow(RawExecutionConfigurationError);
    expect(() => experimentalExecuteFromRawRecords(TWIN(), input([r]))).toThrow(/revisions\[0\]\.assertion is an accessor/);
    expect(reads()).toBe(0);
  });

  it('rejects accessors anywhere in records, retractions, list slots and contexts, never invoking them', () => {
    let calls = 0;
    const getter = { enumerable: true, get: () => { calls += 1; return 's1'; } };
    const nested = rev('r1');
    nested['key'] = Object.defineProperty({ localId: 'r1' }, 'source', getter);
    const slot: J[] = [];
    Object.defineProperty(slot, 0, getter);
    const retraction = Object.defineProperty({ id: 'x1', key: { source: 's1', localId: 'r1' } }, 'target', getter);
    const ctx = Object.defineProperty({}, 'known', getter);
    const pkg = TWIN();
    const cases: [unknown, RegExp][] = [
      [input([nested]), /revisions\[0\]\.key\.source is an accessor/],
      [{ ...input([]), revisions: slot }, /revisions\[0\] is an accessor/],
      [input([SUPPORTING], snap(), [retraction]), /retractions\[0\]\.target is an accessor/],
      [{ ...input([SUPPORTING]), contextEncounter: ctx }, /contextEncounter\.known is an accessor/],
    ];
    for (const [inp, msg] of cases) {
      expect(() => experimentalExecuteFromRawRecords(pkg, inp as never)).toThrow(RawExecutionConfigurationError);
      expect(() => experimentalExecuteFromRawRecords(pkg, inp as never)).toThrow(msg);
    }
    expect(calls).toBe(0);
  });

  it('rejects function values without invoking them: a function-valued toJSON (review of 32121be)', () => {
    let calls = 0;
    const fn = () => (++calls === 1 ? 'Affirmed' : 'Denied');
    const counterexample = rev('r1', { assertion: { toJSON: fn } });
    expect(() => experimentalExecuteFromRawRecords(TWIN(), input([counterexample]))).toThrow(RawExecutionConfigurationError);
    expect(() => experimentalExecuteFromRawRecords(TWIN(), input([counterexample]))).toThrow(/revisions\[0\]\.assertion\.toJSON is a function/);
    const pkg = TWIN();
    const cases: [unknown, RegExp][] = [
      [input([rev('r1', { assertion: fn })]), /revisions\[0\]\.assertion is a function/],
      [input([rev('r1', { key: { source: 's1', localId: 'r1', toJSON: fn } })]), /revisions\[0\]\.key\.toJSON is a function/],
      [input([fn as unknown as J]), /revisions\[0\] is a function/],
      [input([SUPPORTING], snap(), [{ id: 'x1', key: { source: 's1', localId: 'r1' }, target: { toJSON: fn } }]), /retractions\[0\]\.target\.toJSON is a function/],
      [{ ...input([SUPPORTING]), contextEncounter: { toJSON: fn } }, /contextEncounter\.toJSON is a function/],
      [{ ...input([SUPPORTING]), contextEpisode: { nested: [fn] } }, /contextEpisode\.nested\[0\] is a function/],
    ];
    for (const [inp, msg] of cases) {
      expect(() => experimentalExecuteFromRawRecords(pkg, inp as never)).toThrow(RawExecutionConfigurationError);
      expect(() => experimentalExecuteFromRawRecords(pkg, inp as never)).toThrow(msg);
    }
    expect(calls).toBe(0);
  });

  it('a data member named toJSON stays ordinary data: accepted, and each query equals its standalone evaluation', () => {
    const pkg = TWIN();
    const records = [rev('r1', { extra: { toJSON: 'Denied' } }), rev('r2', { assertion: { toJSON: 'Denied' } })];
    const r = run(pkg, records);
    for (const q of ['qa', 'qb']) {
      const s4 = experimentalSelectForQuery({ package: pkg, query: q, ...input(records) });
      expect(evidenceOf(r, q)).toEqual(experimentalQueryEvidence({ package: pkg, query: q, s4 }));
    }
  });

  it('rejects non-plain prototypes, which could carry inherited accessors', () => {
    let calls = 0;
    class Rec { get assertion() { calls += 1; return 'Affirmed'; } }
    const inherited = Object.assign(new Rec(), rev('r1', { assertion: undefined }));
    expect(() => experimentalExecuteFromRawRecords(TWIN(), input([inherited]))).toThrow(/revisions\[0\] is not a plain object/);
    class List extends Array {}
    expect(() => experimentalExecuteFromRawRecords(TWIN(), { ...input([]), revisions: List.from([SUPPORTING]) } as never)).toThrow(/revisions must be a plain array/);
    expect(calls).toBe(0);
  });

  it('reads each value once: a proxy that changes its answer between reads gives every query the same data', () => {
    let descriptorReads = 0;
    const record = new Proxy(rev('r1'), {
      getOwnPropertyDescriptor(t, k) {
        const d = Reflect.getOwnPropertyDescriptor(t, k);
        if (k !== 'assertion' || !d) return d;
        descriptorReads += 1;
        return { ...d, value: descriptorReads === 1 ? 'Affirmed' : 'Denied' };
      },
    });
    const r = run(TWIN(), [record]);
    expect(descriptorReads).toBe(1);
    expect(evidenceOf(r, 'qa').evidence).toEqual(evidenceOf(r, 'qb').evidence);
    expect(decisions(r)['f']).toEqual([TRUE, ['s1/r1@1']]);
  });

  it('S1 judges the captured records exactly as the originals: malformed occurrences keep their rejection', () => {
    const cyc = rev('c1');
    cyc['extra'] = { back: cyc };
    const root: J = {};
    let deep = root;
    for (let i = 0; i < 40; i += 1) deep = deep['n'] = {};
    const nonEnumerableKey = rev('n1');
    Object.defineProperty(nonEnumerableKey, 'key', { value: { source: 's1', localId: 'n1' }, enumerable: false });
    const shared = { acquisition: 'a0', sourceRecordRef: 's1:sh' };
    const records = [
      cyc, rev('d1', { extra: root }), rev('s1x', { assertion: '\uD800' }), rev('nan', { extra: NaN }), nonEnumerableKey,
      5, null, undefined, Object.assign(Object.create(null), rev('np')), rev('sh1', { provenance: shared }), rev('sh2', { provenance: shared }), SUPPORTING,
    ] as J[];
    const sparse = [...records];
    delete sparse[7];
    const retractions = [{ id: 'x1', key: { source: 's1', localId: 'c1' }, target: sup('c1'), author: AMEND, extra: { n: { n: {} } } }] as J[];
    const cycR = retractions[0]!;
    (cycR['extra'] as J)['n']['n']['up'] = cycR;
    const pkg = compiled(source(contract(), S1_ONLY));
    const bound = require('../bound') as typeof import('../bound');
    const spy = jest.spyOn(bound, 'selectForQuery');
    try {
      const r = multi(experimentalExecuteFromRawRecords(pkg, input(sparse, snap(), retractions)));
      expect(spy).toHaveBeenCalledTimes(2);
      const T0 = program().nodes[0].contract.retrieve.type as string;
      const s1 = (revisions: unknown, rets: unknown) => resolve({ envelope: { recordType: T0, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: revisions as JsonValue[], retractions: rets as JsonValue[] });
      for (const [arg] of spy.mock.calls) {
        // The copies, not the caller's objects, and the same S1 verdicts (unidentified reasons included).
        expect(arg.revisions).not.toBe(sparse);
        expect(Object.prototype.hasOwnProperty.call(arg.revisions, 7)).toBe(false);
        expect(s1(arg.revisions, arg.retractions)).toEqual(s1(sparse, retractions));
      }
      // Each query equals its standalone evaluation over the caller's original objects.
      for (const q of ['qa', 'qb']) {
        const s4 = experimentalSelectForQuery({ package: pkg, query: q, ...input(sparse, snap(), retractions) });
        expect(evidenceOf(r, q)).toEqual(experimentalQueryEvidence({ package: pkg, query: q, s4 }));
      }
    } finally {
      spy.mockRestore();
    }
    // Caller-owned objects are neither frozen nor changed.
    for (const x of [cyc, root, shared, sparse, retractions[0]]) expect(Object.isFrozen(x)).toBe(false);
    expect(cyc['extra'].back).toBe(cyc);
  });
});
