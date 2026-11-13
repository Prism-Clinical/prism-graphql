/**
 * EXPERIMENTAL, NONCLINICAL. Query-bound preview evaluation of whole-criterion holes
 * (evidence-query contract §3.5 "Preview evaluation", §6.1; cases 50 and 52). Expected values come
 * from the contract tables and the fixtures, never from calling the evaluator.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CriteriaConfigurationError,
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  PreviewEvaluationConfigurationError,
  QuerySelectionConfigurationError,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalClassifyRecord,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalEvaluateCriteria,
  experimentalEvaluatePreviewQuery,
  experimentalPossibleClasses,
  experimentalResolveRevisionHistory,
  experimentalSelectForQuery,
  type CompiledPackage,
  type JsonValue,
  type PreviewKey,
  type PreviewPackage,
  type PreviewQueryResult,
  type PreviewRecord,
} from '../index';
import { FIXTURE_DIR } from './support/fixture-runner';

type J = { [k: string]: any };
const ENV = { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] } as const;
const PIN = 'demo-vs/item-x@1';
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
const C = '/nodes/0/contract';
const eq = (value: string) => ({ eq: [{ field: ['c', 'assertion'] }, { enum: value }] });
const hole = (id: string) => ({ hole: { id, type: 'Decision', explains: `${id} is undecided` } });
const AFF = eq('AssertionValue.Affirmed');
const DEN = eq('AssertionValue.Denied');

function query(id: string, establishes: J, refutes: J): J {
  return {
    id,
    kind: 'EvidenceQuery',
    subject: 'patient',
    output: 'Evidence<Boolean>',
    contract: {
      retrieve: { type: ENV.recordType, sources: [...ENV.sources], valueSet: PIN },
      corrections: { authority: DEMO_AUTHORITY_RULE },
      admissible: { episode: SAME_EPISODE_RULE, encounter: SAME_ENCOUNTER_RULE, assertionKind: { in: ['ClinicianDocumented'] } },
      policy: 'explicit-assertion-v0',
      establishes,
      refutes,
      obligations: [{ disjoint: ['establishes', 'refutes'] }],
    },
  };
}
function program(establishes: J, refutes: J, extra: J[] = []): J {
  return {
    ppl: { languageVersion: 'ppl-1', capabilityProfileVersion: 'ppl-core-v0' },
    package: { id: 'test.preview', state: 'Draft' },
    references: [],
    valueSets: { [PIN]: { expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] } },
    applicability: { id: 'scope', kind: 'Predicate', expr: { all: [] } },
    nodes: [query('q', establishes, refutes), { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: 'q' } } }, ...extra],
  };
}
function preview(p: J): PreviewPackage {
  const r = experimentalCompilePreview(p as JsonValue);
  if (r.outcome !== 'PreviewPackage') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
const EST_HOLE = preview(program(hole('H-E'), DEN));
const REF_HOLE = preview(program(AFF, hole('H-R')));
const BOTH = preview(program(hole('H-E'), hole('H-R')));

type Over = Record<string, JsonValue | undefined>;
function rev(source: string, localId: string, revision: string, over: Over = {}): Record<string, JsonValue> {
  const base: Record<string, JsonValue> = {
    key: { source, localId },
    revision,
    recordType: ENV.recordType,
    subject: 'P1',
    episode: 'E1',
    encounter: 'N1',
    concept: { system: 'demo-cs', code: 'item-x' },
    assertion: 'Affirmed',
    assertionKind: 'ClinicianDocumented',
    author: { actor: 'u1', permissions: [] },
    provenance: { acquisition: 'a0', sourceRecordRef: `${source}:${localId}:${revision}` },
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base;
}
const sup = (source: string, localId: string, revision: string) => ({ source, localId, revision });
const CTX = { subject: 'P1', contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } } as const;
const run = (pkg: PreviewPackage, revisions: JsonValue[], retractions: JsonValue[] = [], q = 'q') =>
  experimentalEvaluatePreviewQuery({ package: pkg, query: q, revisions, retractions, ...CTX });

type Incomplete = Extract<PreviewQueryResult, { contract: 'IncompleteCriteria' }>;
function incomplete(r: PreviewQueryResult): Incomplete {
  if (r.contract !== 'IncompleteCriteria') throw new Error(r.contract);
  return r;
}
function keyOf(r: PreviewQueryResult, k: string): PreviewKey {
  const found = incomplete(r).keys.find((x) => `${x.key.source}/${x.key.localId}` === k);
  if (!found) throw new Error(`key ${k} missing`);
  return found;
}
const recordOf = (r: PreviewQueryResult, k: string, i = 0): PreviewRecord => keyOf(r, k).possibilities[i]!.record;
/** [establishes, refutes] values of an evaluated record: True/False/Unknown or Marker. */
function values(r: PreviewRecord): [string, string] {
  if (r.outcome !== 'Evaluated') throw new Error(`not evaluated: ${r.reason}`);
  return [r.establishes.result.value, r.refutes.result.value];
}
const MISSING = { value: 'Unknown', findings: [{ cause: 'Missing', origin: 'record', reason: 'FieldAbsent:assertion' }] };
const INVALID = { value: 'Unknown', findings: [{ cause: 'Invalid', origin: 'record', reason: 'FieldMalformed:assertion' }] };
const marker = (criterion: string, id: string) => ({ criterion, source: `${C}/${criterion}/hole`, result: { value: 'Marker', hole: id }, because: 'AuthoringHole' });
/** Every property name anywhere in `v`. */
const names = (v: unknown): Set<string> => {
  const out = new Set<string>();
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) (out.add(k), walk(y));
  };
  walk(v);
  return out;
};
const CLINICAL = ['classification', 'possibleClasses', 'contributes', 'evidence', 'needs', 'need', 'material', 'materiality', 'decision', 'supportingEvidenceIds'];

/** A fixture's query exactly as written, wrapped in a minimal program as the fixture runner wraps it. */
function fixture(id: string) {
  const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, 'fixtures', `${id}.json`), 'utf8'));
  const inline = fx.query.inline;
  const pkg = preview({
    ppl: { languageVersion: 'ppl-1', capabilityProfileVersion: 'ppl-core-v0' },
    package: { id: 'fixture', state: 'Draft' },
    references: [],
    valueSets: inline.valueSets,
    applicability: { id: 'fixture.scope', kind: 'Predicate', expr: { all: [] } },
    nodes: [{ ...inline.query, subject: 'patient' }, inline.predicate],
  });
  const c = fx.input.context;
  const result = experimentalEvaluatePreviewQuery({
    package: pkg,
    query: inline.query.id,
    subject: c.subject,
    revisions: fx.input.records,
    retractions: fx.input.retractions,
    contextEncounter: c.encounter,
    contextEpisode: c.episode,
  });
  return { fx, pkg, result, stagesRun: fx.expected.traceAssertions.find((t: J) => t.fact === 'stagesRun')?.value };
}

describe('preview evaluation: the case 50 and 52 fixtures as written', () => {
  it('EA-052a: establishes is a Marker and refutes is True for s1/r2@1; S1–S4 facts kept', () => {
    const { fx, result, stagesRun } = fixture('EA-052a');
    const r = incomplete(result);
    expect(r.stagesRun).toEqual(stagesRun);
    expect(r).toMatchObject({ mode: 'preview', queryStatus: 'Incomplete', publication: fx.expected.publication, marker: { holes: ['H-CRITERION'] } });
    expect(r.disjointness).toEqual({ status: 'Pending', holes: ['H-CRITERION'], locations: [`${C}/obligations/0`] });
    expect(r.criteria).toEqual({ establishes: { kind: 'hole', hole: 'H-CRITERION', source: `${C}/establishes/hole` }, refutes: { kind: 'complete', source: `${C}/refutes` } });
    const k = keyOf(r, 's1/r2');
    expect(k).toMatchObject({ s1Status: 'Current', status: 'Selected', unresolvedBy: [] });
    const p = k.possibilities[0]!;
    expect(p.possibility).toMatchObject({ kind: 'node', node: { revision: { source: 's1', localId: 'r2', revision: '1' } }, admissibility: { outcome: 'Admissible' }, selection: { disposition: 'Selected' } });
    expect(p.record).toEqual({
      outcome: 'Evaluated',
      node: { revision: { source: 's1', localId: 'r2', revision: '1' } },
      disposition: { disposition: 'Selected' },
      establishes: marker('establishes', 'H-CRITERION'),
      refutes: {
        criterion: 'refutes',
        source: `${C}/refutes`,
        result: { value: 'True' },
        trace: [
          { form: 'field', source: `${C}/refutes/eq/0`, path: 'c.assertion', read: { status: 'Present', value: 'Denied' } },
          { form: 'enum', source: `${C}/refutes/eq/1`, value: 'AssertionValue.Denied' },
          { form: 'eq', source: `${C}/refutes`, result: { value: 'True' } },
        ],
      },
    });
    expect(r.selection).toEqual({ valueSet: 'demo-vs/item-x@1', selected: [{ key: { source: 's1', localId: 'r2' }, node: { revision: { source: 's1', localId: 'r2', revision: '1' } } }], unresolved: [], inadmissible: [] });
  });

  it('EA-052b: an empty snapshot keeps the hole visible and invents no patient criterion result', () => {
    const { fx, result, stagesRun } = fixture('EA-052b');
    expect(fx.input.records).toEqual([]);
    const r = incomplete(result);
    expect(r.stagesRun).toEqual(stagesRun);
    expect(r.marker).toEqual({ holes: ['H-CRITERION'] });
    expect(r.criteria.establishes).toEqual({ kind: 'hole', hole: 'H-CRITERION', source: `${C}/establishes/hole` });
    expect(r.disjointness.status).toBe('Pending');
    expect(r.keys).toEqual([]);
    expect(r.publication).toBe('Blocked');
    for (const n of CLINICAL) expect(names(r).has(n)).toBe(false);
  });

  it('EA-050: a whole-contract hole is a query marker; no evidence stage runs, even with a record present', () => {
    const { fx, result, stagesRun } = fixture('EA-050');
    expect(fx.input.records.length).toBeGreaterThan(0);
    expect(stagesRun).toEqual([]);
    expect(result).toEqual({
      experimental: 'nonclinical-preview-query-v0',
      mode: 'preview',
      packageId: 'fixture',
      query: 'q.demo',
      queryStatus: 'Incomplete',
      publication: 'Blocked',
      marker: { holes: ['H-EVIDENCE'] },
      contract: 'WholeContractHole',
      stagesRun: [],
    });
  });
});

describe('preview evaluation: each slot independently', () => {
  it('refutes holed, establishes complete', () => {
    const r = run(REF_HOLE, [rev('s1', 'r1', '1', { assertion: 'Affirmed' }), rev('s1', 'r2', '1', { assertion: 'Denied' })]);
    expect(values(recordOf(r, 's1/r1'))).toEqual(['True', 'Marker']);
    expect(values(recordOf(r, 's1/r2'))).toEqual(['False', 'Marker']);
    const rec = recordOf(r, 's1/r1');
    if (rec.outcome !== 'Evaluated') throw new Error('not evaluated');
    expect(rec.refutes).toEqual(marker('refutes', 'H-R'));
    expect(incomplete(r).marker).toEqual({ holes: ['H-R'] });
  });

  it('both criteria holed: two markers per eligible record, nothing patient-valued', () => {
    const r = run(BOTH, [rev('s1', 'r1', '1')]);
    const rec = recordOf(r, 's1/r1');
    expect(rec).toMatchObject({ outcome: 'Evaluated', establishes: marker('establishes', 'H-E'), refutes: marker('refutes', 'H-R') });
    expect(incomplete(r).marker).toEqual({ holes: ['H-E', 'H-R'] });
    expect(incomplete(r).criteria).toEqual({ establishes: { kind: 'hole', hole: 'H-E', source: `${C}/establishes/hole` }, refutes: { kind: 'hole', hole: 'H-R', source: `${C}/refutes/hole` } });
    expect(incomplete(r).disjointness).toEqual({ status: 'Pending', holes: ['H-E', 'H-R'], locations: [`${C}/obligations/0`] });
  });

  it('the complete sibling gives True, False and Unknown by §3.4; the hole stays a Marker in every case', () => {
    const r = run(EST_HOLE, [
      rev('s1', 'r1', '1', { assertion: 'Denied' }),
      rev('s1', 'r2', '1', { assertion: 'Affirmed' }),
      rev('s1', 'r3', '1', { assertion: 'Indeterminate' }),
      rev('s1', 'r4', '1', { assertion: undefined }),
      rev('s1', 'r5', '1', { assertion: 'denied' }),
      rev('s1', 'r6', '1', { assertion: null }),
    ]);
    expect(['r1', 'r2', 'r3'].map((k) => values(recordOf(r, `s1/${k}`)))).toEqual([
      ['Marker', 'True'],
      ['Marker', 'False'],
      ['Marker', 'False'],
    ]);
    for (const [k, expected, read] of [
      ['r4', MISSING, { status: 'Absent' }],
      ['r5', INVALID, { status: 'Malformed', value: 'denied' }],
      ['r6', INVALID, { status: 'Malformed', value: null }],
    ] as const) {
      const rec = recordOf(r, `s1/${k}`);
      if (rec.outcome !== 'Evaluated') throw new Error(k);
      expect(rec.establishes).toEqual(marker('establishes', 'H-E'));
      expect(rec.refutes.result).toEqual(expected);
      expect('trace' in rec.refutes && rec.refutes.trace[0]).toMatchObject({ form: 'field', read });
    }
  });

  it('a hole is never Unknown, False or a finding: only the complete criterion carries patient findings', () => {
    const r = run(EST_HOLE, [rev('s1', 'r1', '1', { assertion: undefined })]);
    const rec = recordOf(r, 's1/r1');
    if (rec.outcome !== 'Evaluated') throw new Error('not evaluated');
    expect(rec.establishes.result).toEqual({ value: 'Marker', hole: 'H-E' });
    expect(rec.establishes).not.toHaveProperty('trace');
    expect(JSON.stringify(rec.establishes)).not.toMatch(/Unknown|False|Missing|Invalid|findings/);
  });
});

describe('preview evaluation: eligibility (§3.5) and S4 facts unchanged', () => {
  it('inadmissible, out-of-domain and marker possibilities get no criterion value; the query marker stays', () => {
    const r = run(
      EST_HOLE,
      [
        rev('s1', 'r1', '1', { encounter: 'N0', assertion: 'Denied' }),
        rev('s1', 'r2', '1', { encounter: 'N0', concept: { system: 'other-cs', code: 'z' } }),
        rev('s1', 'r8', '1', { concept: { system: 'demo-cs', code: 'item-y' } }),
        rev('s1', 'r9', '2', { supersedes: sup('s1', 'r9', '1'), author: AMEND }),
      ],
    );
    expect(recordOf(r, 's1/r1')).toEqual({ outcome: 'NotEvaluated', reason: 'Inadmissible', node: { revision: { source: 's1', localId: 'r1', revision: '1' } } });
    expect(recordOf(r, 's1/r2')).toMatchObject({ outcome: 'NotEvaluated', reason: 'Inadmissible' });
    expect(keyOf(r, 's1/r2').possibilities[0]!.possibility).toMatchObject({ selection: { blockers: ['CandidacyUnresolved', 'Inadmissible'] } });
    expect(recordOf(r, 's1/r8')).toMatchObject({ outcome: 'NotEvaluated', reason: 'OutOfDomain' });
    const markers = incomplete(r).keys.flatMap((k) => k.possibilities.filter((p) => p.possibility.kind !== 'node').map((p) => p.record));
    expect(markers.map((m) => (m.outcome === 'NotEvaluated' ? m.reason : m.outcome)).sort()).toEqual(['UnknownMarker']);
    for (const k of incomplete(r).keys) for (const p of k.possibilities) if (p.record.outcome === 'NotEvaluated') expect(names(p.record).has('establishes') || names(p.record).has('refutes')).toBe(false);
    expect(incomplete(r).selection.selected).toEqual([]);
    expect(incomplete(r).marker).toEqual({ holes: ['H-E'] });
  });

  it('an excluded marker possibility is NotEvaluated', () => {
    const r = run(
      EST_HOLE,
      [rev('s1', 'r1', '1')],
      [{ id: 'x1', key: { source: 's1', localId: 'r1' }, target: sup('s1', 'r1', '1'), author: { actor: 'u2' }, provenance: { acquisition: 'a0', sourceRecordRef: 's1:x1' } }],
    );
    const recs = incomplete(r).keys.flatMap((k) => k.possibilities.filter((p) => p.possibility.kind === 'excluded').map((p) => p.record));
    expect(recs).toEqual([{ outcome: 'NotEvaluated', reason: 'ExcludedMarker' }]);
  });

  it('history, candidacy or admissibility uncertainty alone: the sibling is evaluated and the disposition kept', () => {
    const r = run(EST_HOLE, [
      rev('s1', 'r1', '1', { encounter: undefined, assertion: 'Denied' }),
      rev('s1', 'r2', '1', { concept: { system: 'other-cs', code: 'z' }, assertion: 'Affirmed' }),
      rev('s1', 'r3', '1', { assertion: 'Denied' }),
      rev('s1', 'r3', '2', { assertion: 'Affirmed', supersedes: sup('s1', 'r3', '1'), author: { actor: 'u2' } }),
    ]);
    expect(recordOf(r, 's1/r1')).toMatchObject({ disposition: { disposition: 'NotSelected', blockers: ['AdmissibilityUnresolved'] }, refutes: { result: { value: 'True' } } });
    expect(recordOf(r, 's1/r2')).toMatchObject({ disposition: { disposition: 'NotSelected', blockers: ['CandidacyUnresolved'] }, refutes: { result: { value: 'False' } } });
    const k3 = keyOf(r, 's1/r3');
    expect(k3).toMatchObject({ s1Status: 'UnresolvedRevision', status: 'Unresolved', unresolvedBy: ['HistoryUnresolved'] });
    expect(k3.possibilities.map((p) => values(p.record))).toEqual([
      ['Marker', 'True'],
      ['Marker', 'False'],
    ]);
    expect(incomplete(r).selection.selected).toEqual([]);
    expect(incomplete(r).selection.unresolved.map((k) => k.localId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('digest-qualified variants are each evaluated on their own payload', () => {
    const recs = [rev('s1', 'r1', '1', { assertion: 'Affirmed' }), rev('s1', 'r1', '1', { assertion: 'Denied', provenance: { acquisition: 'a1' } })];
    const expected = new Map(
      experimentalResolveRevisionHistory({ envelope: ENV, authorityRule: DEMO_AUTHORITY_RULE, revisions: recs, retractions: [] })
        .keys[0]!.revisions[0]!.variants.map((v) => [v.digest, JSON.parse(v.canonicalPayload).assertion === 'Denied' ? 'True' : 'False']),
    );
    const ps = keyOf(run(EST_HOLE, recs), 's1/r1').possibilities;
    expect(ps).toHaveLength(2);
    expect(new Set(ps.map((p) => values(p.record)[1])).size).toBe(2);
    for (const p of ps) {
      if (p.possibility.kind !== 'node' || p.record.outcome !== 'Evaluated') throw new Error('not evaluated');
      expect(p.record.node.digest).toBe(p.possibility.node.digest);
      expect(values(p.record)).toEqual(['Marker', expected.get(p.possibility.node.digest!)]);
    }
  });

  it('two snapshots with identical record IDs, interleaved: each result reads its own assertion', () => {
    const a = () => run(EST_HOLE, [rev('s1', 'r1', '1', { assertion: 'Denied' })]);
    const b = () => run(EST_HOLE, [rev('s1', 'r1', '1', { assertion: 'Affirmed' })]);
    const [ra, rb, ra2] = [a(), b(), a()];
    expect(values(recordOf(ra, 's1/r1'))).toEqual(['Marker', 'True']);
    expect(values(recordOf(rb, 's1/r1'))).toEqual(['Marker', 'False']);
    expect(ra2).toEqual(ra);
  });

  it('an authorized correction: the current revision’s payload is read, not the superseded one', () => {
    const r = run(EST_HOLE, [rev('s1', 'r1', '1', { assertion: 'Denied' }), rev('s1', 'r1', '2', { assertion: 'Affirmed', supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(recordOf(r, 's1/r1')).toMatchObject({ node: { revision: { revision: '2' } }, refutes: { result: { value: 'False' } } });
  });

  it('S4 facts equal normal query-bound selection over the twin complete query', () => {
    const twin = experimentalCompile(program(AFF, DEN) as JsonValue);
    if (twin.outcome !== 'Compiled') throw new Error('twin');
    const revisions = [rev('s1', 'r1', '1', { encounter: undefined }), rev('s1', 'r2', '1', { encounter: 'N0' }), rev('s1', 'r3', '1')];
    const s4 = experimentalSelectForQuery({ package: twin.package, query: 'q', revisions, retractions: [], ...CTX });
    const r = incomplete(run(EST_HOLE, revisions));
    expect(r.selection).toEqual({ valueSet: s4.valueSet, selected: s4.selected, unresolved: s4.unresolved, inadmissible: s4.inadmissible });
    expect(r.keys.map(({ possibilities, ...k }) => ({ ...k, possibilities: possibilities.map((p) => p.possibility) }))).toEqual(s4.keys);
  });
});

describe('preview evaluation: no clinical conclusion', () => {
  it('no classification, possible classes, evidence result, materiality or Need anywhere in the output', () => {
    for (const pkg of [EST_HOLE, REF_HOLE, BOTH]) {
      const r = run(pkg, [rev('s1', 'r1', '1'), rev('s1', 'r2', '1', { assertion: 'Denied' }), rev('s1', 'r3', '1', { assertion: undefined })]);
      for (const n of CLINICAL) expect(names(r).has(n)).toBe(false);
      expect(r).toMatchObject({ queryStatus: 'Incomplete', publication: 'Blocked' });
    }
  });

  it('pending disjointness is unchanged by evaluating the sibling; the package contract is untouched', () => {
    const q = EST_HOLE.declarations.find((d) => d.id === 'q');
    const before = JSON.stringify(q);
    const r = incomplete(run(EST_HOLE, [rev('s1', 'r1', '1', { assertion: 'Denied' })]));
    expect(r.disjointness).toEqual({ status: 'Pending', holes: ['H-E'], locations: [`${C}/obligations/0`] });
    expect(JSON.stringify(q)).toBe(before);
  });

  it('normal selection, criteria, classification and possible classes still reject preview packages', () => {
    const pre = EST_HOLE as never as CompiledPackage;
    expect(() => experimentalSelectForQuery({ package: pre, query: 'q', revisions: [], retractions: [], ...CTX })).toThrow(QuerySelectionConfigurationError);
    const twin = experimentalCompile(program(AFF, DEN) as JsonValue);
    if (twin.outcome !== 'Compiled') throw new Error('twin');
    const s4 = experimentalSelectForQuery({ package: twin.package, query: 'q', revisions: [rev('s1', 'r1', '1')], retractions: [], ...CTX });
    const key = s4.keys[0]!;
    for (const call of [
      () => experimentalEvaluateCriteria({ package: pre, query: 'q', s4, possibility: key.possibilities[0]! }),
      () => experimentalClassifyRecord({ package: pre, query: 'q', s4, possibility: key.possibilities[0]! }),
      () => experimentalPossibleClasses({ package: pre, query: 'q', s4, key }),
    ]) expect(call).toThrow(CriteriaConfigurationError);
  });
});

describe('preview evaluation: input boundary and ownership', () => {
  const bad = (input: unknown, pattern: RegExp) => {
    expect(() => experimentalEvaluatePreviewQuery(input as never)).toThrow(PreviewEvaluationConfigurationError);
    expect(() => experimentalEvaluatePreviewQuery(input as never)).toThrow(pattern);
  };
  const base = { package: EST_HOLE, query: 'q', revisions: [], retractions: [], ...CTX };

  it('accepts only a PreviewPackage the compiler produced in this process', () => {
    const twin = experimentalCompile(program(AFF, DEN) as JsonValue);
    if (twin.outcome !== 'Compiled') throw new Error('twin');
    bad({ ...base, package: twin.package }, /CompiledPackage is evaluated through the normal entry points/);
    bad({ ...base, package: JSON.parse(JSON.stringify(EST_HOLE)) }, /PreviewPackage produced by experimentalCompilePreview/);
    bad({ ...base, package: { ...EST_HOLE } }, /PreviewPackage produced by experimentalCompilePreview/);
    bad({ ...base, package: null }, /PreviewPackage produced/);
  });

  it('the query must be an EvidenceQuery of that package', () => {
    bad({ ...base, query: 'missing' }, /not an EvidenceQuery of the package/);
    bad({ ...base, query: 'pv' }, /not an EvidenceQuery of the package/);
    const other = preview({ ...program(hole('H-E'), DEN), nodes: [{ ...query('q2', hole('H-X'), DEN) }, { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: 'q2' } } }] });
    bad({ ...base, package: other }, /"q" is not an EvidenceQuery/);
    expect(incomplete(run(other, [], [], 'q2')).marker).toEqual({ holes: ['H-X'] });
  });

  it('a complete query inside a PreviewPackage is rejected: a scope restriction of this entry point', () => {
    const mixed = preview(program(hole('H-E'), DEN, [query('qc', AFF, DEN)]));
    expect(mixed.declarations.find((d) => d.id === 'qc')).toMatchObject({ contract: { kind: 'explicit-assertion-v0' } });
    bad({ ...base, package: mixed, query: 'qc' }, /query qc has a complete contract: this preview entry point covers only queries with authoring holes \(a scope restriction\)/);
    expect(incomplete(run(mixed, [rev('s1', 'r1', '1', { assertion: 'Denied' })])).keys).toHaveLength(1);
  });

  it('caller overrides and precomputed stage results are rejected', () => {
    for (const f of ['valueSet', 'expansion', 'admissible', 'envelope', 'authorityRule', 's1', 's3', 's4', 'possibility', 'establishes', 'refutes', 'payload']) {
      bad({ ...base, [f]: {} }, new RegExp(`unexpected input field\\(s\\) ${f}`));
    }
    bad(null, /input must be an object/);
    bad({ ...base, subject: 1 }, /subject must be a string/);
    bad({ ...base, revisions: {} }, /revisions and retractions must be arrays/);
    const whole = fixtureWhole();
    bad({ ...base, package: whole, query: 'q.demo', s4: {} }, /unexpected input field/);
    bad({ ...base, package: whole, query: 'q.demo', revisions: 'x' }, /revisions and retractions must be arrays/);
  });

  it('its output is data, not a stage result: copied keys or possibilities are rejected by S5', () => {
    const twin = experimentalCompile(program(AFF, DEN) as JsonValue);
    if (twin.outcome !== 'Compiled') throw new Error('twin');
    const s4 = experimentalSelectForQuery({ package: twin.package, query: 'q', revisions: [rev('s1', 'r1', '1')], retractions: [], ...CTX });
    const r = incomplete(run(EST_HOLE, [rev('s1', 'r1', '1')]));
    const copied = r.keys[0]!.possibilities[0]!.possibility;
    expect(copied).toEqual(s4.keys[0]!.possibilities[0]);
    expect(() => experimentalEvaluateCriteria({ package: twin.package, query: 'q', s4, possibility: copied })).toThrow(/not a possibility of this S4 result/);
    const fake = { ...s4, keys: r.keys.map((k) => ({ ...k, possibilities: k.possibilities.map((p) => p.possibility) })) };
    expect(() => experimentalEvaluateCriteria({ package: twin.package, query: 'q', s4: fake as never, possibility: copied })).toThrow(/S4 result produced by experimentalSelectForQuery/);
  });

  it('two preview compilations of one source are distinct packages with equal, independent results', () => {
    const again = preview(program(hole('H-E'), DEN));
    expect(again).not.toBe(EST_HOLE);
    const revisions = [rev('s1', 'r1', '1', { assertion: 'Denied' })];
    expect(run(again, revisions)).toEqual(run(EST_HOLE, revisions));
  });
});

function fixtureWhole(): PreviewPackage {
  return fixture('EA-050').pkg;
}

describe('preview evaluation: immutability and determinism', () => {
  it('output is detached and deep-frozen; later input mutation cannot alter it', () => {
    const revisions = [rev('s1', 'r1', '1', { assertion: 'Denied' })];
    const r = run(EST_HOLE, revisions);
    const snapshot = JSON.stringify(r);
    (revisions[0] as J).assertion = 'Affirmed';
    (revisions as J[]).push(rev('s1', 'r2', '1'));
    expect(JSON.stringify(r)).toBe(snapshot);
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    expect(values(recordOf(run(EST_HOLE, revisions), 's1/r1'))).toEqual(['Marker', 'False']);
  });

  it('mutating the authored source after compilation cannot alter evaluation', () => {
    const src = program(hole('H-E'), DEN);
    const pkg = preview(src);
    src.nodes[0].contract.refutes = AFF;
    src.nodes[0].contract.establishes = DEN;
    expect(values(recordOf(run(pkg, [rev('s1', 'r1', '1', { assertion: 'Denied' })]), 's1/r1'))).toEqual(['Marker', 'True']);
  });

  it('repeated evaluation gives equal results', () => {
    const revisions = [rev('s1', 'r1', '1'), rev('s1', 'r1', '1', { assertion: 'Denied', provenance: { acquisition: 'a1' } })];
    expect(run(EST_HOLE, revisions)).toEqual(run(EST_HOLE, revisions));
  });
});
