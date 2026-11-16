/**
 * EXPERIMENTAL, NONCLINICAL. A bounded I6 slice: raw-input preview of a PreviewPackage with SEVERAL
 * EvidenceQueries over one captured runtime input (first-program contract §8, "Raw-input preview
 * boundary", multi-query). Each query keeps its own authoring state: a complete query is computed by
 * the full S1–S6 pipeline, a criterion-holed query runs S1–S5 with a Marker for its hole slot, and a
 * whole-contract hole runs no stage. One program evaluator combines them. Expected values are written
 * from the contracts (evidence-query §2–§5, first-program §3, §7 and §8), never by calling the
 * implementation; parity with the standalone complete-query and partial-preview paths supplements them.
 */
import { selectForPreviewCompleteQuery } from '../bound';
import * as boundModule from '../bound';
import * as evidenceModule from '../s6/evidence';
import * as previewModule from '../preview';
import {
  RawExecutionConfigurationError,
  RawPreviewConfigurationError,
  experimentalCompilePreview,
  experimentalEvaluatePreviewQuery,
  experimentalExecuteFromRawRecords,
  experimentalExecutePreviewFromRawRecords,
  experimentalQueryEvidence,
  type EvaluationSnapshot,
  type JsonValue,
  type NodeRef,
  type PreviewPackage,
  type RawPreviewMultiQueryResult,
  type RawPreviewQueryResult,
  type RawPreviewResult,
} from '../index';
import { COMPLETE, CTX, REFUTING, SUPPORTING, fail, program, rev, show, snap, type J } from './support/s6-records';

const BASE: J = program().nodes[0].contract;
const contract = (o: { sources?: string[]; kinds?: string[]; inverted?: boolean } = {}): J => ({
  ...BASE,
  retrieve: { ...BASE.retrieve, ...(o.sources ? { sources: o.sources } : {}) },
  admissible: { ...BASE.admissible, ...(o.kinds ? { assertionKind: { in: o.kinds } } : {}) },
  ...(o.inverted ? { establishes: BASE.refutes, refutes: BASE.establishes } : {}),
});
const hole = (id: string, type = 'Decision') => ({ hole: { id, type, explains: `${id} is undecided (nonclinical)` } });
const EST = (c: J, h = 'H-E'): J => ({ ...c, establishes: hole(h) });
const REF = (c: J, h = 'H-R'): J => ({ ...c, refutes: hole(h) });
const WHOLE = (h = 'H-W'): J => hole(h, 'EvidenceSelectionContract<Boolean>');
const C = contract();

const query = (id: string, c: J): J => ({ id, kind: 'EvidenceQuery', subject: 'patient', output: 'Evidence<Boolean>', contract: c });
/**
 * qa, qb; `pa`/`pb` = evidenceValue; `both = all(ref pa, ref pb)`; Finding `f = all(ref scope, ref both)`;
 * independent Findings `ga = all(ref scope, ref pa)` and `gb = all(ref scope, ref pb)`.
 */
const source = (a: J, b: J, o: { ids?: [string, string]; swap?: boolean; urgency?: boolean } = {}): J => {
  const [ia, ib] = o.ids ?? ['qa', 'qb'];
  const qs = [query(ia, a), query(ib, b)];
  return {
    ...program(),
    package: { id: 'test.i6.multi-preview', state: 'Draft' },
    nodes: [
      ...(o.swap ? qs.reverse() : qs),
      { id: 'pa', kind: 'Predicate', expr: { evidenceValue: { ref: ia } } },
      { id: 'pb', kind: 'Predicate', expr: { evidenceValue: { ref: ib } } },
      { id: 'both', kind: 'Predicate', expr: { all: [{ ref: 'pa' }, { ref: 'pb' }] } },
      { id: 'f', kind: 'Finding', status: { all: [{ ref: 'scope' }, { ref: 'both' }] }, label: 'Both queries (nonclinical)', ...(o.urgency ? { urgency: hole('H-U', 'UrgencyRequirement') } : {}) },
      { id: 'ga', kind: 'Finding', status: { all: [{ ref: 'scope' }, { ref: 'pa' }] }, label: 'Query a only (nonclinical)' },
      { id: 'gb', kind: 'Finding', status: { all: [{ ref: 'scope' }, { ref: 'pb' }] }, label: 'Query b only (nonclinical)' },
    ],
  };
};
function preview(p: J): PreviewPackage {
  const r = experimentalCompilePreview(p as JsonValue);
  if (r.outcome !== 'PreviewPackage') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
const input = (revisions: J[], snapshot: EvaluationSnapshot = snap(), retractions: J[] = []) => ({ ...CTX, revisions: revisions as JsonValue[], retractions: retractions as JsonValue[], snapshot });
const multi = (r: RawPreviewResult): RawPreviewMultiQueryResult => {
  if (r.scope !== 'multi-query-program-preview-from-raw-records') throw new Error(`expected the multi-query preview shape, got ${r.scope}`);
  return r;
};
const run = (pkg: PreviewPackage, revisions: J[], snapshot?: EvaluationSnapshot, retractions?: J[]) => multi(experimentalExecutePreviewFromRawRecords(pkg, input(revisions, snapshot, retractions)));
const thrower = (m: string): never => {
  throw new Error(m);
};

const node = (localId: string, revision = '1', source = 's1', digest?: string): NodeRef => ({ revision: { source, localId, revision }, ...(digest ? { digest } : {}) });
const marker = (...holes: string[]) => ({ marker: { holes } });
const S1_S5 = ['S1', 'S2', 'S3', 'S4', 'S5'];
const S1_S6 = [...S1_S5, 'S6'];
const HOLED_NOT_RUN = ['Classification', 'PossibleClasses', 'S6', 'QueryEvidence'];
const entry = (r: RawPreviewMultiQueryResult, q: string): RawPreviewQueryResult => r.queryPreviewResults.find((x) => x.query === q)!;
const evidenceOf = (r: RawPreviewMultiQueryResult, q: string) => {
  const e = entry(r, q);
  if (e.queryAuthoring !== 'Complete') throw new Error(`${q} is not complete`);
  return e.queryEvidence;
};
const partialOf = (r: RawPreviewMultiQueryResult, q: string) => {
  const e = entry(r, q);
  if (e.queryAuthoring !== 'Incomplete') throw new Error(`${q} is not incomplete`);
  return e.previewQuery;
};
/** Per-record criterion values of a criterion-holed query: [establishes, refutes], or the outcome when not evaluated. */
const criteria = (r: RawPreviewMultiQueryResult, q: string) => {
  const pq = partialOf(r, q);
  if (pq.contract !== 'IncompleteCriteria') return {};
  return Object.fromEntries(pq.keys.flatMap((k) => k.possibilities.map((p) => {
    const rec = p.record;
    const v = (c: { result: { value: string; hole?: string } }) => (c.result.value === 'Marker' ? `Marker[${c.result.hole}]` : c.result.value);
    return [`${k.key.source}/${k.key.localId}`, rec.outcome === 'Evaluated' ? [v(rec.establishes), v(rec.refutes)] : rec.outcome];
  })));
};
/** The standalone complete-query preview path over the caller's original input. */
const standaloneEvidence = (pkg: PreviewPackage, q: string, inp: ReturnType<typeof input>) =>
  experimentalQueryEvidence({ package: pkg as never, query: q, s4: selectForPreviewCompleteQuery(pkg, q, inp, thrower) });
/** The standalone partial-preview path over the caller's original input. */
const standalonePartial = (pkg: PreviewPackage, q: string, inp: ReturnType<typeof input>) => {
  const { snapshot: _s, ...runtime } = inp;
  return experimentalEvaluatePreviewQuery({ ...runtime, package: pkg, query: q });
};
const TRUE = { value: 'True' };
const FALSE = { value: 'False' };
const status = (r: RawPreviewMultiQueryResult, f: string) => (r.outputs[f] as { status: unknown }).status;
const traceOf = (r: RawPreviewMultiQueryResult, o: string) => r.trace.find((t) => t.output === o)!;
const isDeepFrozen = (v: unknown, seen = new Set<unknown>()): boolean => {
  if (v === null || typeof v !== 'object' || seen.has(v)) return true;
  seen.add(v);
  return Object.isFrozen(v) && Object.values(v).every((x) => isDeepFrozen(x, seen));
};

describe('multi-query raw preview: complete and incomplete queries over one captured input', () => {
  it('1. two complete queries in a PreviewPackage: each computed by S1–S6, with or without an unrelated hole', () => {
    for (const urgency of [false, true]) {
      const pkg = preview(source(C, contract({ sources: ['s1'] }), { urgency }));
      const inp = input([SUPPORTING]);
      const r = multi(experimentalExecutePreviewFromRawRecords(pkg, inp));
      expect([r.scope, r.mode, r.publication, r.queries, r.notRun]).toEqual(['multi-query-program-preview-from-raw-records', 'preview', 'Blocked', ['qa', 'qb'], ['Needs', 'Acquisition']]);
      for (const q of ['qa', 'qb']) {
        const e = entry(r, q);
        expect([e.queryAuthoring, e.snapshotStatements, e.stagesRun, e.notRun]).toEqual(['Complete', 'ReadByS6', S1_S6, []]);
        // s1/r1 Affirmed, its cell s1 Complete: Known(true) with s1/r1 as support (contract §4.2 rule 2).
        expect(evidenceOf(r, q).evidence).toMatchObject({ status: 'Known', value: true, supportingEvidenceIds: [node('r1')] });
        expect(evidenceOf(r, q)).toEqual(standaloneEvidence(pkg, q, inp));
        expect(r.outputs[q]).toEqual({ evidence: evidenceOf(r, q).evidence, origin: 'computed' });
      }
      expect(r.outputs['both']).toEqual({ decision: TRUE, supportingEvidenceIds: [node('r1')] });
      expect(r.outputs['f']).toEqual({ status: TRUE, supportingEvidenceIds: [node('r1')], ...(urgency ? { urgency: marker('H-U') } : {}) });
      expect(r.markers).toEqual(urgency ? [{ output: 'f.urgency', holes: ['H-U'] }] : []);
    }
  });

  it('2, 6. a complete query beside a criterion-holed one: False and the marker stay apart; all(False, marker) keeps the marker', () => {
    const pkg = preview(source(C, EST(C)));
    const inp = input([REFUTING]);
    const r = multi(experimentalExecutePreviewFromRawRecords(pkg, inp));
    // qa: s1/r2 Denied, complete coverage: Known(false) (rule 3).
    expect(evidenceOf(r, 'qa').evidence).toMatchObject({ status: 'Known', value: false, supportingEvidenceIds: [node('r2')] });
    expect(r.outputs['pa']).toEqual({ decision: FALSE, supportingEvidenceIds: [node('r2')] });
    // qb: S1–S5 from its own complete settings; refutes True for s1/r2, establishes a Marker; nothing classified.
    const qb = entry(r, 'qb');
    expect([qb.queryAuthoring, qb.snapshotStatements, qb.stagesRun, qb.notRun]).toEqual(['Incomplete', 'ValidatedNotRead', S1_S5, HOLED_NOT_RUN]);
    expect(criteria(r, 'qb')).toEqual({ 's1/r2': ['Marker[H-E]', 'True'] });
    expect(partialOf(r, 'qb')).toEqual(standalonePartial(pkg, 'qb', inp));
    expect('queryEvidence' in qb).toBe(false);
    expect(r.outputs['qb']).toEqual({ ...marker('H-E'), stagesRun: S1_S5 });
    expect(r.outputs['pb']).toEqual(marker('H-E'));
    // 6. Kleene False would decide all(); a marker is never simplified away, even beside False.
    expect(r.outputs['both']).toEqual(marker('H-E'));
    expect(traceOf(r, 'both').result).toBe('Marker[H-E]');
    expect(status(r, 'f')).toEqual(marker('H-E'));
    // 5. The Finding that reads only qa stays determinate.
    expect(r.outputs['ga']).toEqual({ status: FALSE, supportingEvidenceIds: [node('r2')] });
    expect(r.outputs['gb']).toEqual({ status: marker('H-E') });
  });

  it('3. a complete query beside a whole-contract hole: the hole runs no stage, whatever the records hold', () => {
    const pkg = preview(source(C, WHOLE()));
    const inp = input([SUPPORTING, REFUTING]);
    const r = run(pkg, [SUPPORTING, REFUTING]);
    const qb = entry(r, 'qb');
    expect([qb.queryAuthoring, qb.snapshotStatements, qb.stagesRun, qb.notRun]).toEqual(['Incomplete', 'ValidatedNotRead', [], [...S1_S5, ...HOLED_NOT_RUN]]);
    expect(partialOf(r, 'qb').contract).toBe('WholeContractHole');
    expect(partialOf(r, 'qb')).toEqual(standalonePartial(pkg, 'qb', inp));
    expect(partialOf(r, 'qb')).toEqual(partialOf(run(pkg, []), 'qb'));
    expect(r.outputs['qb']).toEqual({ ...marker('H-W'), stagesRun: [] });
    expect(traceOf(r, 'qb').because).toMatch(/no evidence stage runs/);
    // qa: Affirmed s1/r1 and Denied s1/r2 in its scope: Unresolved{Conflicting} (EA-007's rule).
    expect(evidenceOf(r, 'qa').evidence).toEqual({ status: 'Unresolved', causes: ['Conflicting'], candidateEvidenceIds: [node('r1'), node('r2')] });
    expect(evidenceOf(r, 'qa')).toEqual(standaloneEvidence(pkg, 'qa', inp));
  });

  it('4. several incomplete queries of different hole kinds: each runs only its permitted stages; no evidence exists', () => {
    const cases: [J, J, string[], string[], Record<string, unknown>, Record<string, unknown>][] = [
      // refutes hole beside a whole-contract hole
      [REF(C), WHOLE(), S1_S5, [], { 's1/r1': ['True', 'Marker[H-R]'] }, {}],
      // establishes hole beside a refutes hole
      [EST(C), REF(C), S1_S5, S1_S5, { 's1/r1': ['Marker[H-E]', 'False'] }, { 's1/r1': ['True', 'Marker[H-R]'] }],
    ];
    for (const [a, b, ranA, ranB, critA, critB] of cases) {
      const pkg = preview(source(a, b));
      const inp = input([SUPPORTING]);
      const r = run(pkg, [SUPPORTING]);
      expect(r.queryPreviewResults.map((e) => [e.query, e.queryAuthoring, e.snapshotStatements, e.stagesRun])).toEqual([
        ['qa', 'Incomplete', 'ValidatedNotRead', ranA],
        ['qb', 'Incomplete', 'ValidatedNotRead', ranB],
      ]);
      expect([criteria(r, 'qa'), criteria(r, 'qb')]).toEqual([critA, critB]);
      for (const q of ['qa', 'qb']) expect(partialOf(r, q)).toEqual(standalonePartial(pkg, q, inp));
      const [ha, hb] = [partialOf(r, 'qa').marker.holes, partialOf(r, 'qb').marker.holes];
      expect(r.outputs['both']).toEqual(marker(...[...ha, ...hb].sort()));
      for (const g of ['ga', 'gb', 'f']) expect(Object.keys(r.outputs[g]!)).toEqual(['status']);
      expect(r.queryPreviewResults.some((e) => 'queryEvidence' in e)).toBe(false);
    }
  });

  it('5, 7. unresolved patient evidence beside an authoring hole: an independent Finding is Unknown(Conflicting), the dependent one a marker with no cause', () => {
    const pkg = preview(source(C, WHOLE()));
    const r = run(pkg, [SUPPORTING, REFUTING]);
    // qa is COMPLETE although its evidence is Unresolved: authoring state never comes from the evidence.
    expect(entry(r, 'qa').queryAuthoring).toBe('Complete');
    expect(r.outputs['ga']).toEqual({ status: { value: 'Unknown', causes: ['Conflicting'] }, candidateEvidenceIds: [node('r1'), node('r2')] });
    // The hole is incomplete authoring: a marker, with no patient cause or candidate attached.
    expect(r.outputs['f']).toEqual({ status: marker('H-W') });
    expect(r.outputs['both']).toEqual(marker('H-W'));
    expect(JSON.stringify(r.outputs['f'])).not.toMatch(/Conflicting|causes|candidate/);
    // ...and the patient cause names no hole.
    expect(JSON.stringify(r.outputs['ga'])).not.toMatch(/H-W|marker/);
    // The same independent Finding, determinate True and False beside the hole.
    expect(run(pkg, [SUPPORTING]).outputs['ga']).toEqual({ status: TRUE, supportingEvidenceIds: [node('r1')] });
    expect(run(pkg, [REFUTING]).outputs['ga']).toEqual({ status: FALSE, supportingEvidenceIds: [node('r2')] });
  });
});

describe('multi-query raw preview: per-query settings and identities', () => {
  it('8. different contracts over the same input: each query uses only its own settings', () => {
    const records = [SUPPORTING, rev('x2', { assertion: 'Denied' }, 's2')];
    // Sources: qa sees s1 only (Known(true)); the criterion-holed qb sees s2 only (refutes True for s2/x2).
    const pkg = preview(source(contract({ sources: ['s1'] }), EST(contract({ sources: ['s2'] }))));
    const r = run(pkg, records);
    expect(evidenceOf(r, 'qa').evidence).toMatchObject({ status: 'Known', value: true, supportingEvidenceIds: [node('r1')] });
    expect(criteria(r, 'qb')).toEqual({ 's2/x2': ['Marker[H-E]', 'True'] });
    // Inverted criteria: the same Affirmed record supports qa and refutes qb.
    const inv = run(preview(source(C, contract({ inverted: true }), { urgency: true })), [SUPPORTING]);
    expect(evidenceOf(inv, 'qa').evidence).toMatchObject({ status: 'Known', value: true });
    expect(evidenceOf(inv, 'qb').evidence).toMatchObject({ status: 'Known', value: false, supportingEvidenceIds: [node('r1')] });
    expect(status(inv, 'f')).toEqual(FALSE);
  });

  it('9. the same value-set pin with different admissibility rules', () => {
    const report = rev('r6', { assertionKind: 'PatientReport' });
    const pkg = preview(source(C, contract({ kinds: ['ClinicianDocumented', 'PatientReport'] }), { urgency: true }));
    const r = run(pkg, [report]);
    expect(evidenceOf(r, 'qa').evidence).toEqual({ status: 'Unresolved', causes: ['Inadmissible'], candidateEvidenceIds: [node('r6')] });
    expect(evidenceOf(r, 'qb').evidence).toMatchObject({ status: 'Known', value: true, supportingEvidenceIds: [node('r6')] });
    // Holed versions: the inadmissible possibility is not evaluated; the admissible one is.
    const h = run(preview(source(REF(C), EST(contract({ kinds: ['ClinicianDocumented', 'PatientReport'] })))), [report]);
    expect([criteria(h, 'qa'), criteria(h, 'qb')]).toEqual([{ 's1/r6': 'NotEvaluated' }, { 's1/r6': ['Marker[H-E]', 'False'] }]);
  });

  it('10, 13. declaration order does not matter; results follow code-point order; __proto__ and constructor are ordinary IDs', () => {
    const records = [SUPPORTING, REFUTING];
    const a = run(preview(source(C, EST(C), { ids: ['qz', 'Qa'] })), records);
    const b = run(preview(source(C, EST(C), { ids: ['qz', 'Qa'], swap: true })), records);
    expect(a.queries).toEqual(['Qa', 'qz']); // U+0051 before U+0071
    // Same semantics; source pointers name each declaration's own position, so they move with it.
    const located = (o: unknown) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'source' || k === 'locations' ? undefined : v)));
    expect([b.queries, located(b.queryPreviewResults), b.outputs]).toEqual([a.queries, located(a.queryPreviewResults), a.outputs]);
    expect(b.trace.map((t) => [t.output, t.result])).toEqual(expect.arrayContaining(a.trace.map((t) => [t.output, t.result])));
    // Raw-record permutation changes nothing at all.
    expect(run(preview(source(C, EST(C), { ids: ['qz', 'Qa'] })), [...records].reverse())).toEqual(a);
    const odd = run(preview(source(EST(C), C, { ids: ['constructor', '__proto__'] })), [SUPPORTING]);
    expect(odd.queries).toEqual(['__proto__', 'constructor']);
    expect(odd.queryPreviewResults.map((e) => [e.query, e.queryAuthoring])).toEqual([['__proto__', 'Complete'], ['constructor', 'Incomplete']]);
    expect(Object.prototype.hasOwnProperty.call(odd.outputs, '__proto__')).toBe(true);
    expect(evidenceOf(odd, '__proto__').evidence).toMatchObject({ status: 'Known', value: true });
  });

  it('11. structured identities and variant digests survive composition', () => {
    // Two variants of s1/r11@1 (Affirmed, Denied): Conflicting between digest-qualified identities.
    const records = [rev('r11'), rev('r11', { assertion: 'Denied', provenance: { acquisition: 'a1', sourceRecordRef: 's1:r11' } })];
    const r = run(preview(source(C, WHOLE())), records);
    const qa = evidenceOf(r, 'qa').evidence;
    if (qa.status !== 'Unresolved') throw new Error('expected Unresolved');
    expect(qa.causes).toEqual(['Conflicting']);
    expect(qa.candidateEvidenceIds.every((n) => n.revision.localId === 'r11' && /^[0-9a-f]{64}$/.test(n.digest ?? ''))).toBe(true);
    expect((r.outputs['ga'] as unknown as { candidateEvidenceIds: NodeRef[] }).candidateEvidenceIds).toEqual(qa.candidateEvidenceIds);
    // Identical display labels, distinct structured identities.
    const d = run(preview(source(contract({ kinds: ['ClinicianDocumented', 'PatientReport'] }), WHOLE())), [rev('a@1'), rev('a', { revision: '1@1', assertionKind: 'PatientReport' })]);
    const ids = (d.outputs['ga'] as unknown as { supportingEvidenceIds: NodeRef[] }).supportingEvidenceIds;
    expect(ids).toEqual([node('a', '1@1'), node('a@1')]);
    expect(ids.map(show)).toEqual(['s1/a@1@1', 's1/a@1@1']);
  });

  it('12. interleaved evaluations with identical query IDs and different snapshots share nothing', () => {
    const pkg = preview(source(C, EST(C)));
    const failing = snap([COMPLETE], [fail('f1')], 'snap-2');
    const first = run(pkg, [SUPPORTING]);
    const other = run(pkg, [REFUTING], failing);
    const again = run(pkg, [SUPPORTING]);
    expect(again).toEqual(first);
    expect(other.snapshot).toBe('snap-2');
    expect(evidenceOf(first, 'qa').evidence).toMatchObject({ status: 'Known', value: true, supportingEvidenceIds: [node('r1')] });
    expect(criteria(first, 'qb')).toEqual({ 's1/r1': ['Marker[H-E]', 'False'] });
    expect(criteria(other, 'qb')).toEqual({ 's1/r2': ['Marker[H-E]', 'True'] });
    expect(evidenceOf(other, 'qa')).toEqual(standaloneEvidence(pkg, 'qa', input([REFUTING], failing)));
  });
});

describe('multi-query raw preview: ownership, capture, failure and shape', () => {
  const PKG = preview(source(C, EST(C)));
  const ok = input([SUPPORTING]);
  const bad = (pkg: unknown, inp: unknown, pattern: RegExp) => {
    expect(() => experimentalExecutePreviewFromRawRecords(pkg as never, inp as never)).toThrow(RawPreviewConfigurationError);
    expect(() => experimentalExecutePreviewFromRawRecords(pkg as never, inp as never)).toThrow(pattern);
  };

  it('13. copied, fabricated and wrong-kind packages, supplied answers and per-query overrides are rejected', () => {
    bad(JSON.parse(JSON.stringify(PKG)), ok, /produced by experimentalCompilePreview/);
    bad({ ...PKG }, ok, /produced by experimentalCompilePreview/);
    bad({ ...PKG, kind: 'CompiledPackage' }, ok, /produced by experimentalCompilePreview/);
    for (const f of ['query', 'queries', 'queryPreviewResults', 'queryEvidence', 'previewQuery', 'suppliedQueryResults', 'markers', 'stagesRun', 'queryAuthoring', 'qa', 'qb', 'establishes', 'sources', 'admissible']) {
      bad(PKG, { ...ok, [f]: [] }, new RegExp(`unexpected input field\\(s\\) ${f}`));
    }
    expect(() => experimentalExecuteFromRawRecords(PKG as never, ok)).toThrow(RawExecutionConfigurationError);
  });

  it('16. a configuration error in one query fails the whole call; an engine error is not reclassified', () => {
    const pkg = preview(source(C, C));
    const real = evidenceModule.queryEvidence;
    const spy = jest.spyOn(evidenceModule, 'queryEvidence');
    try {
      spy.mockImplementation((i) => {
        if (i.query === 'qb') throw new evidenceModule.QueryEvidenceConfigurationError('qb is misconfigured');
        return real(i);
      });
      expect(() => run(pkg, [SUPPORTING])).toThrow(RawPreviewConfigurationError);
      spy.mockImplementation((i) => {
        if (i.query === 'qb') throw new Error('invariant: engine defect');
        return real(i);
      });
      expect(() => run(pkg, [SUPPORTING])).toThrow(/^invariant: engine defect$/);
    } finally {
      spy.mockRestore();
    }
    const realPreview = previewModule.evaluatePreviewQuery;
    const spyP = jest.spyOn(previewModule, 'evaluatePreviewQuery');
    try {
      spyP.mockImplementation((i) => {
        if (i.query === 'qb') throw new previewModule.PreviewEvaluationConfigurationError('qb is misconfigured');
        return realPreview(i);
      });
      expect(() => run(PKG, [SUPPORTING])).toThrow(RawPreviewConfigurationError);
    } finally {
      spyP.mockRestore();
    }
  });

  it('14. one captured input reaches every query branch: no getter or function is invoked, nothing is reread or mutated', () => {
    const pkg = preview(source(C, EST(C), { ids: ['qa', 'qb'] }));
    const three = preview({ ...source(C, EST(C)), nodes: [...source(C, EST(C)).nodes, query('qc', WHOLE())] });
    let calls = 0;
    const getter = rev('r1');
    delete getter['assertion'];
    Object.defineProperty(getter, 'assertion', { enumerable: true, get: () => (++calls, 'Affirmed') });
    const fn = () => (++calls === 1 ? 'Affirmed' : 'Denied');
    for (const p of [pkg, three]) {
      bad(p, input([getter]), /revisions\[0\]\.assertion is an accessor/);
      bad(p, input([rev('r1', { assertion: { toJSON: fn } })]), /revisions\[0\]\.assertion\.toJSON is a function/);
      bad(p, { ...input([SUPPORTING]), contextEpisode: { known: 'E1', toJSON: fn } }, /contextEpisode\.toJSON is a function/);
    }
    expect(calls).toBe(0);

    // A proxy answering differently on each read is read once, so the complete and holed queries agree.
    let reads = 0;
    const flipping = new Proxy(rev('r1'), {
      getOwnPropertyDescriptor(t, k) {
        const d = Reflect.getOwnPropertyDescriptor(t, k);
        if (k !== 'assertion' || !d) return d;
        reads += 1;
        return { ...d, value: reads === 1 ? 'Affirmed' : 'Denied' };
      },
    });
    const r = run(three, [flipping]);
    expect(reads).toBe(1);
    expect(r).toEqual(run(three, [rev('r1')]));

    // Every branch receives the same captured arrays, never the caller's.
    const records = [SUPPORTING];
    const inp = input(records);
    const sel = jest.spyOn(boundModule, 'selectForPreviewCompleteQuery');
    const pre = jest.spyOn(previewModule, 'evaluatePreviewQuery');
    try {
      experimentalExecutePreviewFromRawRecords(three, inp);
      const seen = [...sel.mock.calls.map((c) => c[2].revisions), ...pre.mock.calls.map((c) => c[0].revisions)];
      expect([sel.mock.calls.length, pre.mock.calls.length]).toEqual([1, 2]);
      expect(seen.every((x) => x === seen[0])).toBe(true);
      expect(seen[0]).not.toBe(records);
      expect(Object.isFrozen(seen[0])).toBe(true);
    } finally {
      sel.mockRestore();
      pre.mockRestore();
    }
    expect(Object.isFrozen(records)).toBe(false);
    expect(Object.isFrozen(SUPPORTING)).toBe(false);
  });

  it('15. detached and deeply frozen; later changes to the inputs change nothing', () => {
    const records = [rev('r1')];
    const inp = input(records);
    const r = multi(experimentalExecutePreviewFromRawRecords(PKG, inp));
    const before = JSON.stringify(r);
    expect(isDeepFrozen(r)).toBe(true);
    records[0]!['assertion'] = 'Denied';
    records.push(REFUTING);
    expect(JSON.stringify(r)).toBe(before);
    expect(() => {
      (r.queryPreviewResults as RawPreviewQueryResult[]).push(r.queryPreviewResults[0]!);
    }).toThrow();
  });

  it('16. a one-query preview keeps the one-query shape exactly', () => {
    const one = preview({ ...program(), nodes: [query('q', EST(C)), { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: 'q' } } }] });
    const r = experimentalExecutePreviewFromRawRecords(one, ok);
    if (r.scope !== 'one-query-program-preview-from-raw-records' || r.queryAuthoring !== 'Incomplete') throw new Error(r.scope);
    expect(Object.keys(r).sort()).toEqual(['experimental', 'findingAttributes', 'inspectable', 'markers', 'mode', 'notRun', 'outcome', 'outputs', 'packageId', 'previewQuery', 'publication', 'query', 'queryAuthoring', 'remainingScope', 'scope', 'snapshot', 'snapshotStatements', 'stagesRun', 'trace'].sort());
    expect([r.query, r.stagesRun, r.notRun]).toEqual(['q', S1_S5, [...HOLED_NOT_RUN, 'Needs', 'Acquisition', 'MultiQuery']]);
    expect(Object.keys(run(PKG, [SUPPORTING])).sort()).toEqual(['experimental', 'findingAttributes', 'inspectable', 'markers', 'mode', 'notRun', 'outcome', 'outputs', 'packageId', 'publication', 'queries', 'queryPreviewResults', 'remainingScope', 'scope', 'snapshot', 'trace'].sort());
  });

  it('17. zero-query programs stay rejected', () => {
    const none = preview({ ...program(), nodes: [{ id: 'f', kind: 'Finding', status: { all: [{ ref: 'scope' }] }, label: 'x', urgency: hole('H-U', 'UrgencyRequirement') }] });
    bad(none, ok, /one or more EvidenceQueries; the package has 0/);
  });
});
