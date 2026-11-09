/**
 * EXPERIMENTAL, NONCLINICAL. A bounded I6 slice: a PreviewPackage whose only EvidenceQuery is
 * COMPLETE, with authoring holes elsewhere, previewed from raw records (first-program contract §8,
 * "Raw-input preview boundary"). Expected values come from the contracts (evidence-query §4.2, §5.1,
 * §5.2; first-program §3, §4 and §7), never from calling the implementation.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { selectForPreviewCompleteQuery } from '../bound';
import {
  DEMO_AUTHORITY_RULE,
  RawExecutionConfigurationError,
  RawPreviewConfigurationError,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalEvaluateCriteria,
  experimentalExecuteFromRawRecords,
  experimentalExecutePreviewFromRawRecords,
  experimentalExecutePreviewWithSuppliedQueryResults,
  experimentalGapRelevance,
  experimentalQueryEvidence,
  experimentalResolveRevisionHistory,
  experimentalSelectForQuery,
  type EvaluationSnapshot,
  type JsonValue,
  type NodeRef,
  type PreviewPackage,
  type RawPreviewCompleteResult,
  type RawPreviewResult,
  type SuppliedEvidence,
} from '../index';
import { PROGRAM_DIR } from './support/program-runner';
import { COMPLETE, CTX, REFUTING, SUPPORTING, T, compiled, fail, program, rev, show, snap, type J } from './support/s6-records';

const hole = (id: string, type = 'Decision') => ({ hole: { id, type, explains: `${id} is undecided` } });
const Q0 = program().nodes[0] as J;

/**
 * Applicability `scope = ⟨H-S⟩`; one complete query `q`; `pv = evidenceValue(ref q)`;
 * `p2 = all(ref pv, ref pv)`; Finding `f = all(ref p2)` with a holed urgency (H-U); `ph = all(ref pv,
 * ref scope)`; Finding `g = all(ref ph)`. Neither hole is part of the query.
 */
const NODES: J[] = [
  Q0,
  { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: 'q' } } },
  { id: 'p2', kind: 'Predicate', expr: { all: [{ ref: 'pv' }, { ref: 'pv' }] } },
  { id: 'f', kind: 'Finding', status: { all: [{ ref: 'p2' }] }, label: 'Schematic finding (nonclinical)', urgency: hole('H-U', 'UrgencyRequirement') },
  { id: 'ph', kind: 'Predicate', expr: { all: [{ ref: 'pv' }, { ref: 'scope' }] } },
  { id: 'g', kind: 'Finding', status: { all: [{ ref: 'ph' }] }, label: 'Dependent finding (nonclinical)' },
];
const SCOPE_HOLE = { id: 'scope', kind: 'Predicate', expr: hole('H-S') };
const source = (nodes: J[] = NODES, applicability: J = SCOPE_HOLE): J => ({ ...program(), package: { id: 'test.i6c', state: 'Draft' }, applicability, nodes });
/** The same query, predicates and Finding status, authored completely (unconditional scope, no urgency, no H-S dependents). */
const { urgency: _u, ...F_NO_URGENCY } = NODES[3]!;
const EQUIVALENT = compiled(source([Q0, NODES[1]!, NODES[2]!, F_NO_URGENCY], { id: 'scope', kind: 'Predicate', expr: { all: [] } }));

function preview(p: J): PreviewPackage {
  const r = experimentalCompilePreview(p as JsonValue);
  if (r.outcome !== 'PreviewPackage') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
const PKG = preview(source());
const EST_HOLE = preview(source([{ ...Q0, contract: { ...Q0.contract, establishes: hole('H-E') } }, ...NODES.slice(1)]));
const WHOLE = preview(source([{ ...Q0, contract: hole('H-C', 'EvidenceSelectionContract<Boolean>') }, ...NODES.slice(1)]));

const input = (revisions: J[], snapshot: EvaluationSnapshot = snap(), retractions: J[] = []) => ({ ...CTX, revisions: revisions as JsonValue[], retractions: retractions as JsonValue[], snapshot });
const complete = (r: RawPreviewResult): RawPreviewCompleteResult => {
  if (r.queryAuthoring !== 'Complete') throw new Error(`expected the complete-query branch, got ${r.queryAuthoring}`);
  return r;
};
const run = (revisions: J[], snapshot?: EvaluationSnapshot, pkg: PreviewPackage = PKG) => complete(experimentalExecutePreviewFromRawRecords(pkg, input(revisions, snapshot)));

const node = (localId: string, revision = '1', digest?: string): NodeRef => ({ revision: { source: 's1', localId, revision }, ...(digest ? { digest } : {}) });
const marker = (...holes: string[]) => ({ marker: { holes } });
const TRUE = { value: 'True' };
const FALSE = { value: 'False' };
const unknown = (...causes: string[]) => ({ value: 'Unknown', causes });
const ids = (o: unknown) => {
  const x = o as { supportingEvidenceIds?: NodeRef[]; candidateEvidenceIds?: NodeRef[] };
  return x.supportingEvidenceIds ?? x.candidateEvidenceIds;
};
/** Decision outputs in display notation (identities are checked separately). Markers stay markers. */
const view = (r: RawPreviewResult) =>
  Object.fromEntries(['pv', 'p2', 'f', 'ph', 'g'].map((k) => {
    const o = r.outputs[k] as J;
    const v = o.decision ?? o.status ?? o;
    return [k, v.marker ? v : [v, ids(o)!.map(show)]];
  }));
const evidence = (r: RawPreviewCompleteResult) => {
  const e = r.queryEvidence.evidence;
  return e.status === 'Known' ? ['Known', e.value, e.supportingEvidenceIds.map(show)] : ['Unresolved', e.causes, e.candidateEvidenceIds.map(show)];
};
const traceOf = (r: { readonly trace: RawPreviewResult["trace"] }, o: string) => r.trace.find((t) => t.output === o)!;
/** Every output that depends on the applicability hole H-S, whatever the patient evidence (`view` notation). */
const HOLED = { ph: marker('H-S'), g: marker('H-S') };

describe('raw-input preview, complete query: patient evidence beside unrelated authoring holes', () => {
  it('1, 5. Known(true): the query, predicates and Finding status are True while the urgency stays a marker', () => {
    const r = run([SUPPORTING]);
    expect(evidence(r)).toEqual(['Known', true, ['s1/r1@1']]);
    expect(view(r)).toEqual({ pv: [TRUE, ['s1/r1@1']], p2: [TRUE, ['s1/r1@1']], f: [TRUE, ['s1/r1@1']], ...HOLED });
    expect(r.outputs['f']).toEqual({ status: TRUE, supportingEvidenceIds: [node('r1')], urgency: marker('H-U') });
    expect(r.outputs['g']).toEqual({ status: marker('H-S') });
    expect([traceOf(r, 'f.status').result, traceOf(r, 'f.urgency').result]).toEqual(['True', 'Marker[H-U]']);
  });

  it('2, 6. Known(false): False beside an authoring marker is still the marker (no Boolean simplification)', () => {
    const r = run([REFUTING]);
    expect(evidence(r)).toEqual(['Known', false, ['s1/r2@1']]);
    expect(view(r)).toEqual({ pv: [FALSE, ['s1/r2@1']], p2: [FALSE, ['s1/r2@1']], f: [FALSE, ['s1/r2@1']], ...HOLED });
    expect(traceOf(r, 'ph').result).toBe('Marker[H-S]');
    expect(r.outputs['scope']).toEqual(marker('H-S'));
    expect(traceOf(r, 'ph').because).toMatch(/Boolean simplification never removes a marker/);
  });

  it('3. no record under complete coverage: Unresolved{Missing} patient evidence, never False and never a marker', () => {
    const r = run([]);
    expect(evidence(r)).toEqual(['Unresolved', ['Missing'], []]);
    expect(view(r)).toEqual({ pv: [unknown('Missing'), []], p2: [unknown('Missing'), []], f: [unknown('Missing'), []], ...HOLED });
    expect(r.queryEvidence.trace.attribution.map((a) => [a.cause, a.label, a.stage, a.reason])).toEqual([['Missing', 'query', 'S6', 'NoInDomainRecord']]);
  });

  it('4, 9. conflicts and relevant snapshot gaps (coverage, failure, rejected item) propagate normally', () => {
    expect(view(run([REFUTING, SUPPORTING]))['f']).toEqual([unknown('Conflicting'), ['s1/r1@1', 's1/r2@1']]);
    expect(view(run([SUPPORTING], snap([COMPLETE], [fail('f1')])))['f']).toEqual([unknown('Unavailable'), ['s1/r1@1']]);
    expect(view(run([REFUTING], snap([])))['f']).toEqual([unknown('InsufficientEvidence'), ['s1/r2@1']]);
    const rejected = run([SUPPORTING], { id: 'snap-1', coverage: [COMPLETE], failures: [], rejectedItems: [{ id: 'ri1', appliesTo: { snapshot: 'snap-1' }, reason: 'UnparseableItem' }] });
    expect(view(rejected)['f']).toEqual([unknown('Invalid'), ['s1/r1@1']]);
    expect(rejected.queryEvidence.trace.attribution.map((a) => [a.cause, a.label, a.stage, a.reason])).toEqual([['Invalid', 'ri1', 'gap', 'ItemRejected']]);
    // Statements for another snapshot are not current and change nothing.
    expect(view(run([SUPPORTING], snap([COMPLETE], [fail('f1', { appliesTo: { snapshot: 'snap-0' } })])))['f']).toEqual([TRUE, ['s1/r1@1']]);
  });

  it('7, 11. publication stays blocked; authoring state, patient evidence and stages are reported explicitly', () => {
    for (const records of [[SUPPORTING], [REFUTING], []]) {
      const r = run(records);
      expect([r.publication, r.mode, r.queryAuthoring, r.snapshotStatements, r.stagesRun, r.notRun]).toEqual(['Blocked', 'preview', 'Complete', 'ReadByS6', ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], ['Needs', 'Acquisition', 'MultiQuery']]);
      // The query output is evidence (never a marker), and its trace says it was computed, not authored-incomplete.
      expect(Object.keys(r.outputs['q']!).sort()).toEqual(['evidence', 'origin']);
      const t = traceOf(r, 'q');
      expect(t.because).toMatch(/computed by the evidence-query pipeline \(S1–S6\)/);
      expect(t.because).not.toMatch(/authoring hole|no S6/);
      expect([r.markers, r.inspectable]).toEqual([PKG.markers, PKG.inspectable]);
    }
    // Unresolved patient evidence is the Complete branch; an authoring hole is the Incomplete branch.
    const holed = experimentalExecutePreviewFromRawRecords(EST_HOLE, input([]));
    expect([holed.queryAuthoring, holed.snapshotStatements, holed.publication]).toEqual(['Incomplete', 'ValidatedNotRead', 'Blocked']);
    expect(holed.outputs['q']).toEqual({ ...marker('H-E'), stagesRun: ['S1', 'S2', 'S3', 'S4', 'S5'] });
    expect(traceOf(run([]), 'q').result).toBe('Unresolved{Missing}');
    expect(traceOf(holed, 'q').result).toBe('Marker[H-E]');
    expect([...PKG.markers].sort((a, b) => (a.output < b.output ? -1 : 1))).toEqual([{ output: 'f.urgency', holes: ['H-U'] }, { output: 'g.status', holes: ['H-S'] }, { output: 'ph', holes: ['H-S'] }, { output: 'scope', holes: ['H-S'] }]);
  });

  it('8. query evidence equals normal evaluation of the equivalently authored complete program on identical inputs', () => {
    const cases: [J[], EvaluationSnapshot?][] = [[[SUPPORTING]], [[REFUTING]], [[]], [[REFUTING, SUPPORTING]], [[SUPPORTING], snap([COMPLETE], [fail('f1')])], [[SUPPORTING, rev('r4', { assertion: 'Denied', encounter: undefined })]]];
    for (const [records, sn] of cases) {
      const p = run(records, sn);
      const n = experimentalExecuteFromRawRecords(EQUIVALENT, input(records, sn));
      if (n.scope !== 'one-query-program-from-raw-records') throw new Error(n.scope);
      expect(p.queryEvidence).toEqual(n.queryEvidence);
      for (const k of ['q', 'pv', 'p2']) expect(p.outputs[k]).toEqual(n.outputs[k]);
      expect({ ...(p.outputs['f'] as J), urgency: undefined }).toEqual({ ...(n.outputs['f'] as J), urgency: undefined });
      for (const o of ['q', 'pv', 'p2', 'f.status']) expect(traceOf(p, o)).toEqual(traceOf(n, o));
    }
  });

  it('12. structured identities, variant digests, provenance and attribution refs survive the integration', () => {
    const variants = [rev('r11'), rev('r11', { assertion: 'Denied', provenance: { acquisition: 'a1', sourceRecordRef: 's1:r11' } })];
    const digests = experimentalResolveRevisionHistory({ envelope: { recordType: T, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: variants as JsonValue[], retractions: [] })
      .keys[0]!.revisions[0]!.variants.map((v) => v.digest).sort();
    expect(digests).toHaveLength(2);
    const r = run(variants);
    const expected = digests.map((d) => node('r11', '1', d));
    expect((r.outputs['f'] as J).status).toEqual(unknown('Conflicting'));
    for (const k of ['pv', 'p2', 'f']) expect(ids(r.outputs[k])).toEqual(expected);
    // A variant conflict within one revision is attributed at S1 to that structured revision identity.
    const rv = { source: 's1', localId: 'r11', revision: '1' };
    expect(r.queryEvidence.trace.attribution.map((a) => [a.cause, a.stage, a.reason, a.origin])).toEqual([
      ['Conflicting', 'S1', 'PayloadConflict', { kind: 'record', key: { source: 's1', localId: 'r11' }, defect: { subject: { kind: 'revision', ref: rv }, involves: [rv] } }],
    ]);
    // Distinct identities with one display label stay distinct; Known provenance is the computed one.
    const k = run([rev('a@1'), rev('a', { revision: '1@1' })]);
    expect(ids(k.outputs['f'])).toEqual([node('a', '1@1'), node('a@1', '1')]);
    const e = k.queryEvidence.evidence;
    expect(e.status === 'Known' && e.provenance.map((p) => [p.ref, p.occurrences])).toEqual([
      [node('a', '1@1'), [{ acquisition: 'a0', sourceRecordRef: 's1:a' }]],
      [node('a@1', '1'), [{ acquisition: 'a0', sourceRecordRef: 's1:a@1' }]],
    ]);
    expect((k.outputs['q'] as J).evidence).toEqual(e);
  });

  it('13. interleaved normal and preview evaluations with identical IDs keep their own evidence', () => {
    const denied = [rev('r1', { assertion: 'Denied' })];
    const a = run([SUPPORTING]);
    const n = experimentalExecuteFromRawRecords(EQUIVALENT, input(denied));
    const b = run([SUPPORTING], snap([COMPLETE], [fail('f1')]));
    const a2 = run([SUPPORTING]);
    expect(view(a)['f']).toEqual([TRUE, ['s1/r1@1']]);
    expect((n.outputs['f'] as J).status).toEqual(FALSE);
    expect(view(b)['f']).toEqual([unknown('Unavailable'), ['s1/r1@1']]);
    expect(a2).toEqual(a);
  });

  it('18. input permutation and duplicate occurrences preserve results and reference order', () => {
    const records = [rev('r8'), REFUTING, SUPPORTING, rev('r4', { assertion: 'Denied', encounter: undefined })];
    const a = run(records);
    expect(run([...records].reverse())).toEqual(a);
    expect(run([...records, { ...records[0] }])).toEqual(a);
    expect(ids(a.outputs['f'])).toEqual([node('r1'), node('r2'), node('r4'), node('r8')]);
  });

  it('19. detached and deeply immutable after the original inputs change', () => {
    const records = [rev('r1'), rev('r2', { assertion: 'Denied' })];
    const sn = snap([{ ...COMPLETE }]);
    const r = run(records, sn);
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    const before = JSON.stringify(r);
    records[0]!['assertion'] = 'Denied';
    (records[1]!['key'] as J)['localId'] = 'changed';
    (sn.coverage as J[]).length = 0;
    expect(JSON.stringify(r)).toBe(before);
    expect(Object.keys(r).sort()).toEqual(['experimental', 'findingAttributes', 'inspectable', 'markers', 'mode', 'notRun', 'outcome', 'outputs', 'packageId', 'publication', 'query', 'queryAuthoring', 'queryEvidence', 'remainingScope', 'scope', 'snapshot', 'snapshotStatements', 'stagesRun', 'trace'].sort());
    expect(r.remainingScope).toMatch(/zero or several queries, Needs and acquisition are not executed/);
    expect(JSON.stringify(r)).not.toMatch(/"previewQuery"|"needs"|"acquisition"/);
  });
});

describe('raw-input preview, complete query: ownership of the preview selection', () => {
  const ok = input([SUPPORTING]);
  const bad = (pkg: unknown, inp: unknown, pattern: RegExp) => {
    expect(() => experimentalExecutePreviewFromRawRecords(pkg as never, inp as never)).toThrow(RawPreviewConfigurationError);
    expect(() => experimentalExecutePreviewFromRawRecords(pkg as never, inp as never)).toThrow(pattern);
  };
  const throws = (f: () => unknown, pattern: RegExp) => expect(f).toThrow(pattern);
  const sel = (pkg: unknown, query = 'q') => selectForPreviewCompleteQuery(pkg as PreviewPackage, query, ok, (m) => {
    throw new Error(m);
  });

  it('14. copied, fabricated, foreign and relabelled packages are rejected; public stages still reject preview packages', () => {
    bad(JSON.parse(JSON.stringify(PKG)), ok, /produced by experimentalCompilePreview/);
    bad({ ...PKG }, ok, /produced by experimentalCompilePreview/);
    bad({ ...PKG, kind: 'CompiledPackage' }, ok, /produced by experimentalCompilePreview/);
    bad(EQUIVALENT, ok, /a CompiledPackage is executed by experimentalExecuteFromRawRecords/);
    expect(() => experimentalExecuteFromRawRecords({ ...PKG, kind: 'CompiledPackage' } as never, ok)).toThrow(RawExecutionConfigurationError);
    expect(() => experimentalExecuteFromRawRecords(PKG as never, ok)).toThrow(/preview packages are not executed here/);
    // The public query-bound stages keep rejecting a PreviewPackage, even with a complete query.
    throws(() => experimentalSelectForQuery({ package: PKG as never, query: 'q', ...ok }), /preview packages are not evaluated here/);
    const s4 = experimentalSelectForQuery({ package: EQUIVALENT, query: 'q', ...ok });
    throws(() => experimentalQueryEvidence({ package: PKG as never, query: 'q', s4 }), /preview packages are not evaluated here/);
    throws(() => experimentalGapRelevance({ package: PKG as never, query: 'q', s4 }), /preview packages are not evaluated here/);
    // The capability is never part of a result: no object reachable from one is an accepted S4 result.
    const r = run([SUPPORTING]);
    const objects: unknown[] = [];
    const walk = (x: unknown) => {
      if (x && typeof x === 'object') {
        objects.push(x);
        Object.values(x).forEach(walk);
      }
    };
    walk(r);
    for (const o of objects) expect(() => experimentalQueryEvidence({ package: PKG as never, query: 'q', s4: o as never })).toThrow();
    // The internal selection itself accepts only an authentic PreviewPackage.
    throws(() => sel(EQUIVALENT), /expected a PreviewPackage/);
    throws(() => sel({ ...PKG }), /expected a PreviewPackage/);
  });

  it('15. a preview selection for another package or query cannot be substituted', () => {
    const twin = preview(source()); // same source, another package object
    const s4 = sel(PKG);
    expect(experimentalQueryEvidence({ package: PKG as never, query: 'q', s4 }).evidence.status).toBe('Known');
    throws(() => experimentalQueryEvidence({ package: twin as never, query: 'q', s4 }), /preview packages are not evaluated here/);
    throws(() => experimentalQueryEvidence({ package: EQUIVALENT, query: 'q', s4 }), /s4 was selected for another compiled package/);
    const two = preview(source([...NODES, { ...Q0, id: 'q2' }]));
    const s4q = sel(two, 'q');
    throws(() => experimentalQueryEvidence({ package: two as never, query: 'q2', s4: s4q }), /preview packages are not evaluated here/);
    throws(() => experimentalEvaluateCriteria({ package: two as never, query: 'q2', s4: s4q, possibility: s4q.keys[0]!.possibilities[0]! }), /preview packages are not evaluated here/);
    // A normal selection never unlocks a preview package.
    const n4 = experimentalSelectForQuery({ package: EQUIVALENT, query: 'q', ...ok });
    throws(() => experimentalEvaluateCriteria({ package: PKG as never, query: 'q', s4: n4, possibility: n4.keys[0]!.possibilities[0]! }), /preview packages are not evaluated here/);
  });

  it('16. holed queries cannot enter the complete-query path', () => {
    throws(() => sel(EST_HOLE), /has an authoring hole; only a complete query is evaluated/);
    throws(() => sel(WHOLE), /has an authoring hole; only a complete query is evaluated/);
    throws(() => sel(PKG, 'pv'), /is not an EvidenceQuery/);
    for (const pkg of [EST_HOLE, WHOLE]) expect(experimentalExecutePreviewFromRawRecords(pkg, ok).queryAuthoring).toBe('Incomplete');
  });

  it('17. caller-supplied results, markers, stage outputs and authored-setting overrides remain rejected', () => {
    for (const f of ['query', 'suppliedQueryResults', 'queryEvidence', 'evidence', 'previewQuery', 'markers', 'decision', 's1', 's4', 'stagesRun', 'queryAuthoring', 'tokens', 'establishes', 'refutes', 'valueSet', 'sources', 'authorityRule', 'admissible', 'policy']) {
      bad(PKG, { ...ok, [f]: [] }, new RegExp(`unexpected input field\\(s\\) ${f}`));
    }
    bad(PKG, { ...CTX, revisions: [], retractions: [] }, /a snapshot is required/);
    bad(PKG, { ...ok, snapshot: { id: 'snap-1', coverage: [] } }, /snapshot must state/);
    bad(PKG, { ...ok, subject: 7 }, /subject/);
    bad(preview(source([...NODES, { ...Q0, id: 'q2' }])), ok, /exactly one EvidenceQuery; the package has 2/);
    bad(preview(source([{ id: 'f', kind: 'Finding', status: { all: [{ ref: 'scope' }] }, label: 'x', urgency: hole('H-U', 'UrgencyRequirement') }])), ok, /exactly one EvidenceQuery; the package has 0/);
  });

  it('10, 20. holed preview, normal raw execution, isolated execution and PPL-04 are unchanged', () => {
    // Holed queries: unchanged partial path, snapshot statements not read (a failure changes nothing).
    const w = experimentalExecutePreviewFromRawRecords(WHOLE, input([SUPPORTING], snap([COMPLETE], [fail('f1')])));
    expect([w.queryAuthoring, w.stagesRun, w.outputs['q'], w.outputs['f'], w.outputs['ph']]).toEqual(['Incomplete', [], { ...marker('H-C'), stagesRun: [] }, { status: marker('H-C'), urgency: marker('H-U') }, marker('H-C', 'H-S')]);
    expect(experimentalExecutePreviewFromRawRecords(EST_HOLE, input([SUPPORTING], snap([COMPLETE], [fail('f1')])))).toEqual(experimentalExecutePreviewFromRawRecords(EST_HOLE, input([SUPPORTING])));
    // Isolated preview of the same package with the computed evidence supplied: same program values.
    const r = run([REFUTING, SUPPORTING]);
    const e = r.queryEvidence.evidence;
    const supplied: SuppliedEvidence = e.status === 'Known'
      ? { status: 'Known', value: e.value, supportingEvidenceIds: e.supportingEvidenceIds.map(show) }
      : { status: 'Unresolved', causes: e.causes, candidateEvidenceIds: e.candidateEvidenceIds.map(show) };
    const iso = experimentalExecutePreviewWithSuppliedQueryResults(PKG, new Map([['q', supplied]]));
    if (iso.outcome !== 'Executed') throw new Error(JSON.stringify(iso));
    for (const k of ['scope', 'pv', 'p2', 'f', 'ph', 'g']) {
      const o = r.outputs[k] as J;
      const refs = o.supportingEvidenceIds ? { supportingEvidenceIds: o.supportingEvidenceIds.map(show) } : o.candidateEvidenceIds ? { candidateEvidenceIds: o.candidateEvidenceIds.map(show) } : {};
      expect({ ...o, ...refs }).toEqual(iso.outputs[k]);
    }
    expect(r.trace.filter((t) => t.output !== 'q')).toEqual(iso.trace.filter((t) => t.output !== 'q'));
    // Normal raw execution of a compiled program is unchanged.
    expect((experimentalExecuteFromRawRecords(EQUIVALENT, input([SUPPORTING])).outputs['f'] as J).status).toEqual(TRUE);
    expect(experimentalCompile(source() as JsonValue).outcome).toBe('CompileFailure');
    // PPL-04 (whole-contract hole) still previews on the incomplete branch.
    const ex = JSON.parse(readFileSync(join(PROGRAM_DIR, 'examples', 'PPL-04.json'), 'utf8')) as J;
    const i = ex.input;
    const p4 = experimentalExecutePreviewFromRawRecords(preview(JSON.parse(readFileSync(join(PROGRAM_DIR, 'examples', ex.program.file), 'utf8'))), {
      subject: i.context.subject, revisions: i.records, retractions: i.retractions, contextEncounter: i.context.encounter, contextEpisode: i.context.episode,
      snapshot: { id: i.snapshot, coverage: i.coverage, failures: i.failures, rejectedItems: i.rejectedItems },
    });
    expect([p4.queryAuthoring, p4.outputs]).toEqual(['Incomplete', ex.expected.outputs]);
  });
});
