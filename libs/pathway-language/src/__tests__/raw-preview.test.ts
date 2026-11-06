/**
 * EXPERIMENTAL, NONCLINICAL. A bounded I6 slice: a PreviewPackage whose only EvidenceQuery has an
 * authoring hole, previewed from raw records (first-program contract §8, "Raw-input preview
 * boundary"). Expected values come from the contracts (evidence-query §3.5 preview evaluation, §6.1;
 * first-program §3 and §7), never from calling the implementation.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEMO_AUTHORITY_RULE,
  RawExecutionConfigurationError,
  RawPreviewConfigurationError,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalEvaluatePreviewQuery,
  experimentalExecuteFromRawRecords,
  experimentalExecutePreviewFromRawRecords,
  experimentalExecutePreviewWithSuppliedQueryResults,
  experimentalResolveRevisionHistory,
  type EvaluationSnapshot,
  type JsonValue,
  type NodeRef,
  type PreviewPackage,
  type PreviewQueryResult,
  type RawPreviewIncompleteResult,
  type RawPreviewResult,
} from '../index';
import { PROGRAM_DIR } from './support/program-runner';
import { COMPLETE, CTX, REFUTING, SUPPORTING, T, compiled, program, rev, snap, type J } from './support/s6-records';

const hole = (id: string, type = 'Decision') => ({ hole: { id, type, explains: `${id} is undecided` } });
const Q0 = program().nodes[0] as J;
const HOLED_CONTRACT = hole('H-C', 'EvidenceSelectionContract<Boolean>');
const EST = { ...Q0.contract, establishes: hole('H-E') };
const REF = { ...Q0.contract, refutes: hole('H-R') };
const BOTH = { ...Q0.contract, establishes: hole('H-E'), refutes: hole('H-R') };

/**
 * One query `q`; `pv = evidenceValue(ref q)`; `p2 = all(ref pv, ref pv)`; Finding `f = all(ref scope, ref p2)`;
 * Finding `g = all(ref scope)` (independent of the query) with a holed urgency attribute.
 */
const source = (contract: J, extra: J[] = []): J => ({
  ...program(),
  package: { id: 'test.i6p', state: 'Draft' },
  nodes: [
    { ...Q0, contract },
    { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: 'q' } } },
    { id: 'p2', kind: 'Predicate', expr: { all: [{ ref: 'pv' }, { ref: 'pv' }] } },
    { id: 'f', kind: 'Finding', status: { all: [{ ref: 'scope' }, { ref: 'p2' }] }, label: 'Schematic finding (nonclinical)' },
    { id: 'g', kind: 'Finding', status: { all: [{ ref: 'scope' }] }, label: 'Independent finding (nonclinical)', urgency: hole('H-U', 'UrgencyRequirement') },
    ...extra,
  ],
});
function preview(p: J): PreviewPackage {
  const r = experimentalCompilePreview(p as JsonValue);
  if (r.outcome !== 'PreviewPackage') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
const WHOLE = preview(source(HOLED_CONTRACT));
const EST_HOLE = preview(source(EST));
const REF_HOLE = preview(source(REF));
const BOTH_HOLES = preview(source(BOTH));

const input = (revisions: J[], snapshot: EvaluationSnapshot = snap(), retractions: J[] = []) => ({ ...CTX, revisions: revisions as JsonValue[], retractions: retractions as JsonValue[], snapshot });
/** Every package here has a holed query: the result must be the incomplete-authoring branch. */
const holed = (r: RawPreviewResult): RawPreviewIncompleteResult => {
  if (r.queryAuthoring !== 'Incomplete') throw new Error(`expected the incomplete-authoring branch, got ${r.queryAuthoring}`);
  return r;
};
const run = (pkg: PreviewPackage, revisions: J[], snapshot?: EvaluationSnapshot) => holed(experimentalExecutePreviewFromRawRecords(pkg, input(revisions, snapshot)));

const node = (localId: string, revision = '1', digest?: string): NodeRef => ({ revision: { source: 's1', localId, revision }, ...(digest ? { digest } : {}) });
const marker = (...holes: string[]) => ({ marker: { holes } });
const TRUE_EMPTY = { decision: { value: 'True' }, supportingEvidenceIds: [] };
const G = { status: { value: 'True' }, supportingEvidenceIds: [], urgency: marker('H-U') };
const S1_S5 = ['S1', 'S2', 'S3', 'S4', 'S5'];
const LATER = ['Classification', 'PossibleClasses', 'S6', 'QueryEvidence', 'Needs', 'Acquisition', 'MultiQuery'];

/** Program outputs expected for a holed query with holes `hs` whose preview ran `stages`. */
const expectedOutputs = (hs: string[], stages: string[]) => ({
  scope: TRUE_EMPTY,
  q: { ...marker(...hs), stagesRun: stages },
  pv: marker(...hs),
  p2: marker(...hs),
  f: { status: marker(...hs) },
  g: G,
});
type Incomplete = Extract<PreviewQueryResult, { contract: 'IncompleteCriteria' }>;
const incomplete = (r: RawPreviewIncompleteResult): Incomplete => {
  if (r.previewQuery.contract !== 'IncompleteCriteria') throw new Error(r.previewQuery.contract);
  return r.previewQuery;
};
/** [establishes, refutes] per evaluated key, `source/localId` → values. */
const criteria = (r: RawPreviewIncompleteResult) =>
  Object.fromEntries(incomplete(r).keys.map((k) => {
    const rec = k.possibilities[0]!.record;
    return [`${k.key.source}/${k.key.localId}`, rec.outcome === 'Evaluated' ? [rec.establishes.result.value, rec.refutes.result.value] : rec.outcome];
  }));
const traceOf = (r: RawPreviewResult, o: string) => r.trace.find((t) => t.output === o)!;

describe('raw-input preview: PPL-04 and the supported hole shapes', () => {
  it('1. PPL-04 from its own raw inputs: every expected output and trace result', () => {
    const ex = JSON.parse(readFileSync(join(PROGRAM_DIR, 'examples', 'PPL-04.json'), 'utf8')) as J;
    const pkg = preview(JSON.parse(readFileSync(join(PROGRAM_DIR, 'examples', ex.program.file), 'utf8')));
    const i = ex.input;
    const r = holed(experimentalExecutePreviewFromRawRecords(pkg, {
      subject: i.context.subject,
      revisions: i.records,
      retractions: i.retractions,
      contextEncounter: i.context.encounter,
      contextEpisode: i.context.episode,
      snapshot: { id: i.snapshot, coverage: i.coverage, failures: i.failures, rejectedItems: i.rejectedItems },
    }));
    expect(r.outputs).toEqual(ex.expected.outputs);
    for (const t of ex.expected.trace) expect([traceOf(r, t.output).source, traceOf(r, t.output).result]).toEqual([t.source, t.result]);
    expect(r.previewQuery).toMatchObject({ contract: 'WholeContractHole', stagesRun: [], queryStatus: 'Incomplete', marker: { holes: ['H-EVIDENCE'] } });
    expect([r.publication, r.snapshot, r.stagesRun]).toEqual(['Blocked', 'snap-g1', []]);
  });

  it('2. whole-contract hole: markers kept, no evidence stage runs, nothing is read', () => {
    const r = run(WHOLE, [SUPPORTING, REFUTING]);
    expect(r.outputs).toEqual(expectedOutputs(['H-C'], []));
    expect(r.previewQuery).toEqual({
      experimental: 'nonclinical-preview-query-v0', mode: 'preview', packageId: 'test.i6p', query: 'q',
      queryStatus: 'Incomplete', publication: 'Blocked', marker: { holes: ['H-C'] }, contract: 'WholeContractHole', stagesRun: [],
    });
    expect(r.stagesRun).toEqual([]);
    expect(r.notRun).toEqual([...S1_S5, ...LATER]);
    expect(traceOf(r, 'q').because).toMatch(/no evidence stage runs and nothing is read/);
    // The records were not read: no record ID appears anywhere in the result.
    expect(JSON.stringify(r)).not.toMatch(/"r1"|"r2"/);
  });

  it('3. establishes holed, refutes complete: the refutes results stay inspectable per record', () => {
    const r = run(EST_HOLE, [SUPPORTING, REFUTING]);
    expect(r.outputs).toEqual(expectedOutputs(['H-E'], S1_S5));
    // Affirmed r1: refutes (Denied?) False; Denied r2: refutes True. establishes is a marker for both.
    expect(criteria(r)).toEqual({ 's1/r1': ['Marker', 'False'], 's1/r2': ['Marker', 'True'] });
    expect(incomplete(r).criteria).toEqual({ establishes: { kind: 'hole', hole: 'H-E', source: '/nodes/0/contract/establishes/hole' }, refutes: { kind: 'complete', source: '/nodes/0/contract/refutes' } });
    expect(r.stagesRun).toEqual(S1_S5);
    expect(r.notRun).toEqual(LATER);
  });

  it('4. refutes holed, establishes complete', () => {
    const r = run(REF_HOLE, [SUPPORTING, REFUTING]);
    expect(r.outputs).toEqual(expectedOutputs(['H-R'], S1_S5));
    expect(criteria(r)).toEqual({ 's1/r1': ['True', 'Marker'], 's1/r2': ['False', 'Marker'] });
  });

  it('5. both criteria holed: selection still runs, every criterion is a marker', () => {
    const r = run(BOTH_HOLES, [SUPPORTING, REFUTING]);
    expect(r.outputs).toEqual(expectedOutputs(['H-E', 'H-R'], S1_S5));
    expect(criteria(r)).toEqual({ 's1/r1': ['Marker', 'Marker'], 's1/r2': ['Marker', 'Marker'] });
  });

  it('6. empty records: the query and dependent markers remain', () => {
    for (const [pkg, hs, stages] of [[WHOLE, ['H-C'], []], [EST_HOLE, ['H-E'], S1_S5], [BOTH_HOLES, ['H-E', 'H-R'], S1_S5]] as const) {
      const r = run(pkg, [], snap([]));
      expect(r.outputs).toEqual(expectedOutputs([...hs], [...stages]));
    }
    expect(incomplete(run(EST_HOLE, [])).keys).toEqual([]);
  });

  it('7. malformed or conflicting patient evidence never turns an authoring marker into Unknown', () => {
    const variants = [rev('r11'), rev('r11', { assertion: 'Denied', provenance: { acquisition: 'a1', sourceRecordRef: 's1:r11' } })];
    const records = [...variants, rev('r3', { assertion: 'NotAnAssertion' }), rev('r9', { encounter: undefined }), { key: 'malformed' }];
    for (const [pkg, hs] of [[WHOLE, ['H-C']], [EST_HOLE, ['H-E']], [REF_HOLE, ['H-R']]] as const) {
      const r = run(pkg, records, snap([], [{ id: 'f1', attempt: 'a-f1', appliesTo: { snapshot: 'snap-1' }, outcome: 'Failed', recordType: T, subject: 'P1', sources: ['s1'] }]));
      expect(r.outputs).toEqual(expectedOutputs([...hs], pkg === WHOLE ? [] : S1_S5));
      for (const o of ['q', 'pv', 'p2', 'f']) expect(JSON.stringify(r.outputs[o])).not.toMatch(/Unknown|False|causes/);
    }
    // The complete sibling still reports patient-data uncertainty where it applies (r3's unclassifiable assertion).
    expect(criteria(run(EST_HOLE, records))['s1/r3']).toEqual(['Marker', 'Unknown']);
  });

  it('8. Boolean simplification never erases a marker (True from raw preview; False through the same evaluator)', () => {
    // Raw: all(True, marker) and all(marker, marker) both stay markers (f and p2 above). A False operand
    // beside the marker needs a second, complete query: outside this one-query slice, so the same
    // evaluator is checked through isolated preview with that query's False supplied.
    const r = run(EST_HOLE, [SUPPORTING]);
    expect(traceOf(r, 'f.status').result).toBe('Marker[H-E]');
    const two = preview(source(EST, [
      { ...Q0, id: 'q2' },
      { id: 'p3', kind: 'Predicate', expr: { evidenceValue: { ref: 'q2' } } },
      { id: 'h', kind: 'Finding', status: { all: [{ ref: 'p3' }, { ref: 'pv' }] }, label: 'False beside a marker' },
    ]));
    const iso = experimentalExecutePreviewWithSuppliedQueryResults(two, new Map([['q2', { status: 'Known', value: false, supportingEvidenceIds: ['s1/r2@1'] }]]));
    if (iso.outcome !== 'Executed') throw new Error(JSON.stringify(iso));
    expect(iso.outputs['h']).toEqual({ status: marker('H-E') });
    expect(() => run(two, [])).toThrow(/exactly one EvidenceQuery; the package has 2/);
  });

  it('9. an independently evaluated Finding keeps its status when only its urgency is holed', () => {
    for (const pkg of [WHOLE, EST_HOLE, BOTH_HOLES]) {
      const r = run(pkg, [SUPPORTING]);
      expect(r.outputs['g']).toEqual(G);
      expect(traceOf(r, 'g.status').result).toBe('True');
      expect(traceOf(r, 'g.urgency').result).toBe('Marker[H-U]');
      expect(r.findingAttributes['g']).toEqual({ label: 'Independent finding (nonclinical)', heading: null, cites: [] });
    }
  });
});

describe('raw-input preview: partial query results, traces, identity and ownership', () => {
  it('10. previewQuery equals standalone preview-query evaluation of the same inputs', () => {
    const records = [SUPPORTING, REFUTING, rev('r9', { encounter: undefined })];
    for (const pkg of [WHOLE, EST_HOLE, REF_HOLE, BOTH_HOLES]) {
      const standalone = experimentalEvaluatePreviewQuery({ package: pkg, query: 'q', ...CTX, revisions: records as JsonValue[], retractions: [] });
      expect(run(pkg, records).previewQuery).toEqual(standalone);
    }
  });

  it('11. the trace states what actually ran: S1–S5 for criterion holes, nothing for a whole-contract hole', () => {
    const c = traceOf(run(EST_HOLE, [SUPPORTING]), 'q');
    expect(c.result).toBe('Marker[H-E]');
    expect(c.because).toMatch(/ran S1, S2, S3, S4, S5 on this evaluation's records/);
    expect(c.because).toMatch(/no S6 result or Evidence<Boolean>/);
    expect(c.because).not.toMatch(/no evidence stage runs/);
    expect(traceOf(run(WHOLE, [SUPPORTING]), 'q').because).not.toMatch(/S1/);
    // Dependent entries keep the marker semantics of the isolated evaluator.
    expect(traceOf(run(EST_HOLE, [SUPPORTING]), 'pv').because).toMatch(/authoring hole, so the marker is kept/);
  });

  it('12. exact revision and variant identities survive in the partial query result', () => {
    const variants = [rev('r11'), rev('r11', { assertion: 'Denied', provenance: { acquisition: 'a1', sourceRecordRef: 's1:r11' } })];
    const digests = experimentalResolveRevisionHistory({ envelope: { recordType: T, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: variants as JsonValue[], retractions: [] })
      .keys[0]!.revisions[0]!.variants.map((v) => v.digest).sort();
    expect(digests).toHaveLength(2);
    const nodes = (r: RawPreviewIncompleteResult) => incomplete(r).keys.flatMap((k) => k.possibilities.map((p) => (p.record.outcome === 'Evaluated' ? p.record.node : p.record.node ?? null)));
    expect(nodes(run(EST_HOLE, variants))).toEqual(digests.map((d) => node('r11', '1', d)));
    // localId `a@1` at revision 1 and localId `a` at revision `1@1` share a display label and stay distinct.
    expect(nodes(run(EST_HOLE, [rev('a@1'), rev('a', { revision: '1@1' })]))).toEqual([node('a', '1@1'), node('a@1', '1')]);
  });

  it('13. interleaved evaluations with identical IDs keep their own partial results', () => {
    const a = run(EST_HOLE, [SUPPORTING]);
    const b = run(EST_HOLE, [rev('r1', { assertion: 'Denied' })]);
    const a2 = run(EST_HOLE, [SUPPORTING]);
    expect(criteria(a)).toEqual({ 's1/r1': ['Marker', 'False'] });
    expect(criteria(b)).toEqual({ 's1/r1': ['Marker', 'True'] });
    expect(a2).toEqual(a);
  });

  it('14. input permutation and duplicate occurrences preserve outputs and ordering', () => {
    const records = [rev('r8'), REFUTING, SUPPORTING, rev('r4', { encounter: undefined })];
    const a = run(REF_HOLE, records);
    expect(run(REF_HOLE, [...records].reverse())).toEqual(a);
    expect(run(REF_HOLE, [...records, { ...records[0] }])).toEqual(a);
    expect(Object.keys(criteria(a))).toEqual(['s1/r1', 's1/r2', 's1/r4', 's1/r8']);
  });

  const bad = (pkg: unknown, inp: unknown, pattern: RegExp) => {
    expect(() => experimentalExecutePreviewFromRawRecords(pkg as never, inp as never)).toThrow(RawPreviewConfigurationError);
    expect(() => experimentalExecutePreviewFromRawRecords(pkg as never, inp as never)).toThrow(pattern);
  };

  it('15. authenticity, unsupported scope and overrides are rejected as configuration errors', () => {
    const ok = input([SUPPORTING]);
    for (const f of ['query', 'suppliedQueryResults', 'previewQuery', 'markers', 'marker', 'decision', 'evidence', 's1', 's4', 'stagesRun', 'tokens', 'establishes', 'refutes', 'valueSet', 'sources', 'authorityRule', 'admissible', 'policy']) {
      bad(EST_HOLE, { ...ok, [f]: [] }, new RegExp(`unexpected input field\\(s\\) ${f}`));
    }
    bad(EST_HOLE, null, /input must be an object/);
    bad(EST_HOLE, { ...CTX, revisions: [], retractions: [] }, /a snapshot is required/);
    bad(EST_HOLE, { ...ok, snapshot: { id: 'snap-1', coverage: [] } }, /snapshot must state/);
    bad(EST_HOLE, { ...ok, subject: 7 }, /subject/);
    bad(WHOLE, { ...ok, revisions: 'none' }, /revisions and retractions must be arrays/);
    bad(compiled(), ok, /a CompiledPackage is executed by experimentalExecuteFromRawRecords/);
    bad(JSON.parse(JSON.stringify(EST_HOLE)), ok, /produced by experimentalCompilePreview/);
    bad({ ...EST_HOLE }, ok, /produced by experimentalCompilePreview/);
    bad(experimentalCompilePreview(source(EST) as JsonValue), ok, /produced by experimentalCompilePreview/);
    // Zero queries (the hole is elsewhere) and two holed queries. A complete query in a PreviewPackage is
    // no longer rejected: raw-preview-complete.test.ts covers it.
    const scopeHole = (nodes: J[]) => preview({ ...program(), applicability: { id: 'scope', kind: 'Predicate', expr: hole('H-S') }, nodes });
    bad(scopeHole([{ id: 'f', kind: 'Finding', status: { all: [{ ref: 'scope' }] }, label: 'x' }]), ok, /exactly one EvidenceQuery; the package has 0/);
    bad(preview(source(EST, [{ ...Q0, id: 'q2', contract: REF }])), ok, /exactly one EvidenceQuery; the package has 2/);
    expect(experimentalExecutePreviewFromRawRecords(scopeHole(program().nodes), ok).queryAuthoring).toBe('Complete');
    const errors = [RawPreviewConfigurationError, RawExecutionConfigurationError];
    expect(new Set(errors).size).toBe(2);
  });

  it('16. detached and deeply immutable after the original inputs change', () => {
    const records = [rev('r1'), rev('r2', { assertion: 'Denied' })];
    const sn = snap([{ ...COMPLETE }]);
    const r = run(EST_HOLE, records, sn);
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    const before = JSON.stringify(r);
    records[0]!['assertion'] = 'Denied';
    (records[1]!['key'] as J)['localId'] = 'changed';
    (sn.coverage as J[]).length = 0;
    expect(JSON.stringify(r)).toBe(before);
  });

  it('17. normal raw execution and isolated preview are unchanged', () => {
    // Isolated preview of the same package: same program outputs, except that the holed query ran nothing there.
    for (const pkg of [WHOLE, EST_HOLE]) {
      const iso = experimentalExecutePreviewWithSuppliedQueryResults(pkg, new Map());
      if (iso.outcome !== 'Executed') throw new Error(JSON.stringify(iso));
      const raw = run(pkg, [SUPPORTING]);
      expect(iso.outputs['q']).toEqual({ ...marker(pkg === WHOLE ? 'H-C' : 'H-E'), stagesRun: [] });
      expect({ ...raw.outputs, q: null }).toEqual({ ...iso.outputs, q: null });
      expect(raw.trace.filter((t) => t.output !== 'q')).toEqual(iso.trace.filter((t) => t.output !== 'q'));
      expect(raw.findingAttributes).toEqual(iso.findingAttributes);
      expect([raw.markers, raw.inspectable]).toEqual([iso.markers, iso.inspectable]);
    }
    expect(traceOf(experimentalExecutePreviewWithSuppliedQueryResults(EST_HOLE, new Map()) as never, 'q').because).toMatch(/no evidence stage runs in isolated execution/);
    // Normal raw execution still rejects preview packages and still runs compiled ones.
    expect(() => experimentalExecuteFromRawRecords(EST_HOLE as never, input([]))).toThrow(/preview packages are not executed here/);
    expect(experimentalExecuteFromRawRecords(compiled(), input([SUPPORTING])).outputs['pv']).toEqual({ decision: { value: 'True' }, supportingEvidenceIds: [node('r1')] });
    expect(experimentalCompile(source(EST) as JsonValue).outcome).toBe('CompileFailure');
  });

  it('18. no final evidence, Needs, acquisition or multi-query result is introduced', () => {
    for (const pkg of [WHOLE, EST_HOLE, BOTH_HOLES]) {
      const r = run(pkg, [SUPPORTING, REFUTING, rev('r4', { encounter: undefined })]);
      expect(Object.keys(r).sort()).toEqual(['experimental', 'findingAttributes', 'inspectable', 'markers', 'mode', 'notRun', 'outcome', 'outputs', 'packageId', 'previewQuery', 'publication', 'query', 'queryAuthoring', 'remainingScope', 'scope', 'snapshot', 'snapshotStatements', 'stagesRun', 'trace'].sort());
      expect([r.outcome, r.experimental, r.scope, r.mode, r.publication, r.snapshotStatements]).toEqual(['Executed', 'nonclinical-ppl-raw-input-preview-v0', 'one-query-program-preview-from-raw-records', 'preview', 'Blocked', 'ValidatedNotRead']);
      const text = JSON.stringify(r);
      for (const f of ['evidence', 'queryEvidence', 'needs', 'possibleClasses', 'classification', 'attribution', 'materiality', 'provenance"']) expect(text).not.toContain(`"${f}${f.endsWith('"') ? '' : '"'}`);
      expect(r.notRun).toEqual(expect.arrayContaining(['S6', 'QueryEvidence', 'Needs', 'Acquisition', 'MultiQuery']));
      expect(r.remainingScope).toMatch(/zero or several queries, Needs and acquisition are not executed/);
    }
  });
});
