/**
 * EXPERIMENTAL, NONCLINICAL. Independent tests of I2 isolated program-expression execution.
 * Programs are compiled here with their own identifiers. Every EvidenceQuery result is SUPPLIED,
 * so these are isolated tests, not end-to-end runs. Expectations are derived by hand from
 * first-program-implementation-contract.md §3 (evidenceValue, Kleene n-ary all, supports), §4 and §7.
 */
import {
  DEMO_AUTHORITY_RULE,
  SAME_ENCOUNTER_RULE,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalExecutePreviewWithSuppliedQueryResults,
  experimentalExecuteWithSuppliedQueryResults,
  type CompiledPackage,
  type JsonValue,
  type PreviewPackage,
  type SuppliedEvidence,
} from '../index';

type J = { [k: string]: any };
const contract = (): J => ({
  retrieve: { type: 'demo-model/DemoAssessment@0.1', sources: ['sa'], valueSet: 'vs/x@1' },
  corrections: { authority: DEMO_AUTHORITY_RULE },
  admissible: {
    episode: { eq: [{ field: ['c', 'episode'] }, { ref: 'ctx.episode' }] },
    encounter: JSON.parse(JSON.stringify(SAME_ENCOUNTER_RULE)),
    assertionKind: { in: ['ClinicianDocumented'] },
  },
  policy: 'explicit-assertion-v0',
  establishes: { eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Affirmed' }] },
  refutes: { eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Denied' }] },
  obligations: [{ disjoint: ['establishes', 'refutes'] }],
});
const query = (id: string): J => ({ id, kind: 'EvidenceQuery', subject: 'patient', output: 'Evidence<Boolean>', contract: contract() });
const holedQuery = (id: string, hole: string): J => ({ ...query(id), contract: { hole: { id: hole, type: 'EvidenceSelectionContract<Boolean>', explains: 'undecided' } } });
const pred = (id: string, expr: J): J => ({ id, kind: 'Predicate', expr });
const finding = (id: string, status: J, extra: J = {}): J => ({ id, kind: 'Finding', status, label: `label of ${id}`, ...extra });
const ev = (q: string) => ({ evidenceValue: { ref: q } });
const ref = (id: string) => ({ ref: id });
const all = (...xs: J[]) => ({ all: xs });
function source(nodes: J[], applicabilityExpr: J = { all: [] }): J {
  return {
    ppl: { languageVersion: 'ppl-1', capabilityProfileVersion: 'ppl-core-v0' },
    package: { id: 'exec.test', state: 'Draft' },
    valueSets: { 'vs/x@1': { expansion: [{ system: 'cs', code: 'c' }], coveredSystems: ['cs'] } },
    applicability: { id: 'scope', kind: 'Predicate', expr: applicabilityExpr },
    nodes,
  };
}
function compiled(src: J): CompiledPackage {
  const r = experimentalCompile(src as JsonValue);
  if (r.outcome !== 'Compiled') throw new Error(`expected Compiled: ${JSON.stringify(r.diagnostics)}`);
  return r.package;
}
function preview(src: J): PreviewPackage {
  const r = experimentalCompilePreview(src as JsonValue);
  if (r.outcome !== 'PreviewPackage') throw new Error(`expected PreviewPackage: ${JSON.stringify(r.diagnostics)}`);
  return r.package;
}
const T = (...ids: string[]): SuppliedEvidence => ({ status: 'Known', value: true, supportingEvidenceIds: ids });
const F = (...ids: string[]): SuppliedEvidence => ({ status: 'Known', value: false, supportingEvidenceIds: ids });
const U = (causes: readonly string[], ...ids: string[]): SuppliedEvidence => ({ status: "Unresolved", causes, candidateEvidenceIds: ids }) as SuppliedEvidence;
const run = (pkg: CompiledPackage, entries: [string, SuppliedEvidence][]) => experimentalExecuteWithSuppliedQueryResults(pkg, new Map(entries));
const outputsOf = (r: ReturnType<typeof run>): J => {
  if (r.outcome !== 'Executed') throw new Error(`expected Executed: ${JSON.stringify(r.errors)}`);
  return r.outputs as J;
};
const codes = (r: { outcome: string; errors?: readonly { code: string; query?: string }[] }) => (r.errors ?? []).map((e) => [e.code, e.query ?? null]);

describe('I2: evidenceValue projection (contract §5.2)', () => {
  const pkg = compiled(source([query('qt'), query('qf'), query('qu'), pred('pt', ev('qt')), pred('pf', ev('qf')), pred('pu', ev('qu'))]));
  const out = outputsOf(run(pkg, [['qt', T('s1/r1@1')], ['qf', F('s1/r2@1')], ['qu', U(['Conflicting'], 's1/r3@1')]]));

  it('Known(true) → True, Known(false) → False, Unresolved(C) → Unknown(C), each with the same IDs', () => {
    expect(out['pt']).toEqual({ decision: { value: 'True' }, supportingEvidenceIds: ['s1/r1@1'] });
    expect(out['pf']).toEqual({ decision: { value: 'False' }, supportingEvidenceIds: ['s1/r2@1'] });
    expect(out['pu']).toEqual({ decision: { value: 'Unknown', causes: ['Conflicting'] }, candidateEvidenceIds: ['s1/r3@1'] });
  });

  it('supplied query results are echoed as supplied, never as computed', () => {
    expect(out['qt']).toEqual({ evidence: T('s1/r1@1'), origin: 'supplied' });
  });

  it('deduplicates and orders IDs by (source, localId, revision, digest) and causes in Stage A order', () => {
    const o = outputsOf(run(pkg, [
      ['qt', T('s2/a@1', 's1/b@2', 's1/b@2', 's1/a@2', 's1/a@10')],
      ['qf', F('s1/r2@1')],
      ['qu', U(['Unavailable', 'Missing', 'Missing'], 's1/z@1', 's1/y@1')],
    ]));
    // Revision IDs are opaque strings: "10" sorts before "2" by code point.
    expect(o['pt'].supportingEvidenceIds).toEqual(['s1/a@10', 's1/a@2', 's1/b@2', 's2/a@1']);
    expect(o['pu']).toEqual({ decision: { value: 'Unknown', causes: ['Missing', 'Unavailable'] }, candidateEvidenceIds: ['s1/y@1', 's1/z@1'] });
  });
});

describe('I2: n-ary Kleene all (contract §3; Stage A §4.3)', () => {
  const vals = { T: 'qt', F: 'qf', U: 'qu', V: 'qv' } as const;
  // Hand-derived table: any False → False; else any Unknown → Unknown; else True.
  const table: [string, string, 'True' | 'False' | 'Unknown'][] = [
    ['T', 'T', 'True'], ['T', 'F', 'False'], ['T', 'U', 'Unknown'],
    ['F', 'T', 'False'], ['F', 'F', 'False'], ['F', 'U', 'False'],
    ['U', 'T', 'Unknown'], ['U', 'F', 'False'], ['U', 'V', 'Unknown'],
  ];
  const nodes = [
    ...Object.values(vals).map(query),
    ...Object.entries(vals).map(([k, q]) => pred(`p${k}`, ev(q))),
    ...table.map(([a, b]) => pred(`c_${a}_${b}`, all(ref(`p${a}`), ref(`p${b}`)))),
    pred('one', all(ref('pT'))),
    pred('none', all()),
    pred('three', all(ref('pT'), ref('pU'), ref('pV'))),
    pred('twoFalse', all(ref('pF'), ref('pT'), ref('pF2'))),
    query('qf2'),
    pred('pF2', ev('qf2')),
  ];
  const pkg = compiled(source(nodes));
  const supplied: [string, SuppliedEvidence][] = [
    ['qt', T('s1/t@1')], ['qf', F('s1/f@1')], ['qu', U(['Missing'], 's1/u@1')], ['qv', U(['Invalid', 'Missing'], 's1/v@1', 's1/u@1')], ['qf2', F('s1/f@2')],
  ];
  const r = run(pkg, supplied);
  const out = outputsOf(r);

  it.each(table)('all(%s, %s) = %s', (a, b, expected) => {
    expect(out[`c_${a}_${b}`].decision.value).toBe(expected);
  });

  it('False with Unknown: support only from the False operand; no causes or candidates', () => {
    expect(out['c_F_U']).toEqual({ decision: { value: 'False' }, supportingEvidenceIds: ['s1/f@1'] });
    expect(out['c_U_F']).toEqual(out['c_F_U']);
  });

  it('unions: two False supports; Unknown causes and candidate IDs (deduplicated); True supports', () => {
    expect(out['twoFalse']).toEqual({ decision: { value: 'False' }, supportingEvidenceIds: ['s1/f@1', 's1/f@2'] });
    expect(out['c_U_V']).toEqual({ decision: { value: 'Unknown', causes: ['Missing', 'Invalid'] }, candidateEvidenceIds: ['s1/u@1', 's1/v@1'] });
    expect(out['three']).toEqual(out['c_U_V']);
    expect(out['c_T_T']).toEqual({ decision: { value: 'True' }, supportingEvidenceIds: ['s1/t@1'] });
  });

  it('zero and one operand: all() is True with empty support; all(x) is x', () => {
    expect(out['none']).toEqual({ decision: { value: 'True' }, supportingEvidenceIds: [] });
    expect(out['scope']).toEqual({ decision: { value: 'True' }, supportingEvidenceIds: [] });
    expect(out['one']).toEqual(out['pT']);
  });

  it('keeps every operand trace, including the nondecisive Unknown beside a decisive False', () => {
    if (r.outcome !== 'Executed') throw new Error();
    const t = r.trace.find((e) => e.output === 'c_F_U');
    expect(t?.source).toBe(`/nodes/${nodes.findIndex((n) => n.id === 'c_F_U')}/expr`);
    expect(t?.steps.map((s) => [s.form, s.uses, s.result])).toEqual([
      ['ref', ['pF'], 'False'],
      ['ref', ['pU'], 'Unknown(Missing)'],
      ['all', ['pF', 'pU'], 'False'],
    ]);
    expect(t?.steps.every((s) => s.source.startsWith(t.source) && s.because.length > 0)).toBe(true);
  });
});

describe('I2: references, Findings and determinism', () => {
  const nodes = [
    query('qa'), query('qb'),
    pred('pa', ev('qa')), pred('pb', ev('qb')),
    pred('p2', all(ref('pa'), ref('pa'), ref('pb'))),
    pred('p3', all(ref('p2'))),
    finding('fd', all(ref('scope'), ref('p3')), { heading: 'H', cites: ['src-1'] }),
  ];
  const src = { ...source(nodes), references: [{ id: 'src-1', kind: 'EvidenceReference', file: 'f.txt', sha256: 'b'.repeat(64), lines: [1, 1], quote: { '1': 'q' } }] };
  const pkg = compiled(src);

  it('repeated and transitive references; Finding status with attributes kept separately', () => {
    const r = run(pkg, [['qa', T('s1/a@1')], ['qb', T('s1/b@1', 's1/a@1')]]);
    const out = outputsOf(r);
    expect(out['p3']).toEqual({ decision: { value: 'True' }, supportingEvidenceIds: ['s1/a@1', 's1/b@1'] });
    expect(out['fd']).toEqual({ status: { value: 'True' }, supportingEvidenceIds: ['s1/a@1', 's1/b@1'] });
    expect(r.outcome === 'Executed' && r.findingAttributes).toEqual({ fd: { label: 'label of fd', heading: 'H', cites: ['src-1'] } });
  });

  it('a False Finding is only that Finding being false', () => {
    const r = run(pkg, [['qa', T('s1/a@1')], ['qb', F('s1/b@1')]]);
    expect(outputsOf(r)['fd']).toEqual({ status: { value: 'False' }, supportingEvidenceIds: ['s1/b@1'] });
    if (r.outcome !== 'Executed') return;
    expect(Object.keys(r.outputs).sort()).toEqual(['fd', 'p2', 'p3', 'pa', 'pb', 'qa', 'qb', 'scope']);
  });

  it('is invariant under supplied-map order and ID order', () => {
    const a = run(pkg, [['qa', T('s1/a@1', 's1/c@1')], ['qb', U(['Missing', 'Conflicting'], 's1/x@1', 's1/w@1')]]);
    const b = run(pkg, [['qb', U(['Conflicting', 'Missing'], 's1/w@1', 's1/x@1')], ['qa', T('s1/c@1', 's1/a@1')]]);
    expect(b).toEqual(a);
  });
});

describe('I2: execution input is validated, never turned into patient uncertainty', () => {
  const pkg = compiled(source([query('qa'), query('qb'), pred('pa', ev('qa')), pred('pb', ev('qb'))]));

  it('a missing result is MISSING_QUERY_RESULT, never Unresolved{Missing}', () => {
    expect(codes(run(pkg, [['qa', T('s1/a@1')]]))).toEqual([['MISSING_QUERY_RESULT', 'qb']]);
  });

  it('unknown IDs and non-query IDs are UNEXPECTED_QUERY_RESULT; all errors are reported together', () => {
    expect(codes(run(pkg, [['qa', T('s1/a@1')], ['qb', T('s1/b@1')], ['nope', T('s1/c@1')], ['pa', T('s1/d@1')]]))).toEqual([
      ['UNEXPECTED_QUERY_RESULT', 'nope'],
      ['UNEXPECTED_QUERY_RESULT', 'pa'],
    ]);
  });

  it.each([
    ['wrong value type', { status: 'Known', value: 'yes', supportingEvidenceIds: [] }],
    ['empty cause set', { status: 'Unresolved', causes: [], candidateEvidenceIds: [] }],
    ['unknown cause', { status: 'Unresolved', causes: ['Maybe'], candidateEvidenceIds: [] }],
    ['extra member', { status: 'Known', value: true, supportingEvidenceIds: [], provenance: 'x' }],
    ['malformed evidence ID', { status: 'Known', value: true, supportingEvidenceIds: ['record-1'] }],
    ['unknown status', { status: 'Maybe' }],
    ['not an object', 'Known'],
  ])('%s is MALFORMED_QUERY_RESULT', (_n, bad) => {
    expect(codes(run(pkg, [['qa', bad as SuppliedEvidence], ['qb', T('s1/b@1')]]))).toEqual([['MALFORMED_QUERY_RESULT', 'qa']]);
  });

  it('a plain object instead of a Map is INVALID_QUERY_RESULTS', () => {
    expect(codes(experimentalExecuteWithSuppliedQueryResults(pkg, { qa: T('s1/a@1'), qb: T('s1/b@1') } as never))).toEqual([['INVALID_QUERY_RESULTS', null]]);
  });

  it('normal execution rejects preview packages, compile failures and unfrozen look-alikes; preview rejects ordinary packages', () => {
    const prev = preview(source([query('qa'), pred('pa', ev('qa'))]));
    expect(codes(experimentalExecuteWithSuppliedQueryResults(prev as never, new Map()))).toEqual([['INVALID_PACKAGE', null]]);
    const failed = experimentalCompile(source([pred('pa', ev('missing'))]) as JsonValue);
    expect(codes(experimentalExecuteWithSuppliedQueryResults(failed as never, new Map()))).toEqual([['INVALID_PACKAGE', null]]);
    expect(codes(experimentalExecuteWithSuppliedQueryResults(JSON.parse(JSON.stringify(pkg)), new Map()))).toEqual([['INVALID_PACKAGE', null]]);
    expect(codes(experimentalExecutePreviewWithSuppliedQueryResults(pkg as never, new Map()))).toEqual([['INVALID_PACKAGE', null]]);
  });
});

describe('I2: preview execution (contract §7)', () => {
  it('authoring holes stay markers; unresolved patient evidence stays Unknown(causes); they never mix', () => {
    const pkg = preview(source([holedQuery('qh', 'H-Q'), query('qu'), pred('ph', ev('qh')), pred('pu', ev('qu'))]));
    const r = experimentalExecutePreviewWithSuppliedQueryResults(pkg, new Map([['qu', U(['Missing'])]]));
    if (r.outcome !== 'Executed') throw new Error(JSON.stringify(r.errors));
    const out = r.outputs as J;
    expect(out['qh']).toEqual({ marker: { holes: ['H-Q'] }, stagesRun: [] });
    expect(out['ph']).toEqual({ marker: { holes: ['H-Q'] } });
    expect(out['pu']).toEqual({ decision: { value: 'Unknown', causes: ['Missing'] }, candidateEvidenceIds: [] });
    expect(r.publication).toBe('Blocked');
    expect(r.mode).toBe('preview');
  });

  it('a result supplied for a holed query is rejected, not used to fill the hole', () => {
    const pkg = preview(source([holedQuery('qh', 'H-Q'), pred('ph', ev('qh'))]));
    expect(codes(experimentalExecutePreviewWithSuppliedQueryResults(pkg, new Map([['qh', T('s1/a@1')]])))).toEqual([['RESULT_FOR_HOLED_QUERY', 'qh']]);
  });

  it('markers survive an otherwise decisive False operand (no Boolean simplification)', () => {
    const pkg = preview(source([holedQuery('qh', 'H-Q'), query('qf'), pred('ph', ev('qh')), pred('pf', ev('qf')), pred('mix', all(ref('pf'), ref('ph'))), finding('fd', all(ref('scope'), ref('pf')))], {
      hole: { id: 'H-S', type: 'Decision', explains: 'undecided scope' },
    }));
    const r = experimentalExecutePreviewWithSuppliedQueryResults(pkg, new Map([['qf', F('s1/f@1')]]));
    if (r.outcome !== 'Executed') throw new Error(JSON.stringify(r.errors));
    const out = r.outputs as J;
    expect(out['mix']).toEqual({ marker: { holes: ['H-Q'] } });
    expect(out['fd']).toEqual({ status: { marker: { holes: ['H-S'] } } });
    expect(out['pf']).toEqual({ decision: { value: 'False' }, supportingEvidenceIds: ['s1/f@1'] });
    const t = r.trace.find((e) => e.output === 'mix');
    expect(t?.steps.map((s) => s.result)).toEqual(['False', 'Marker[H-Q]', 'Marker[H-Q]']);
  });

  it('an attribute-only hole marks only the attribute; the status evaluates; attributes stay inspectable', () => {
    const pkg = preview(source([query('qa'), pred('pa', ev('qa')), finding('fd', all(ref('scope'), ref('pa')), { urgency: { hole: { id: 'H-U', type: 'UrgencyRequirement', explains: 'undecided' } } })]));
    const r = experimentalExecutePreviewWithSuppliedQueryResults(pkg, new Map([['qa', T('s1/a@1')]]));
    if (r.outcome !== 'Executed') throw new Error(JSON.stringify(r.errors));
    expect((r.outputs as J)['fd']).toEqual({ status: { value: 'True' }, supportingEvidenceIds: ['s1/a@1'], urgency: { marker: { holes: ['H-U'] } } });
    expect(r.inspectable).toEqual({ 'fd.label': 'label of fd' });
    expect(r.trace.find((e) => e.output === 'fd.urgency')?.source).toBe('/nodes/2/urgency');
  });
});

describe('I2: special identifiers, frozen results and later edits', () => {
  it.each(['__proto__', 'constructor', 'toString'])('identifier %j works as a query, predicate and finding ID', (name) => {
    const text = JSON.stringify(source([query('QID'), pred('PID', ev('QID')), finding('FID', all(ref('PID')))]));
    const named = (suffix: string) => JSON.stringify(`${name}${suffix}`);
    const src = JSON.parse(text.split('"QID"').join(JSON.stringify(name)).split('"PID"').join(named('.p')).split('"FID"').join(named('.f')));
    const r = run(compiled(src), [[name, T('s1/a@1')]]);
    const out = outputsOf(r);
    expect(Object.prototype.hasOwnProperty.call(out, name)).toBe(true);
    expect(JSON.parse(JSON.stringify(out))[`${name}.f`]).toEqual({ status: { value: 'True' }, supportingEvidenceIds: ['s1/a@1'] });
  });

  it('accepts frozen inputs; later edits to the supplied map, evidence or source do not change the result; results are frozen', () => {
    const src = source([query('qa'), pred('pa', ev('qa'))]);
    const pkg = compiled(src);
    const evidence = { status: 'Known', value: true, supportingEvidenceIds: ['s1/a@1'] } as J;
    const map = new Map<string, SuppliedEvidence>([['qa', evidence as SuppliedEvidence]]);
    const r = experimentalExecuteWithSuppliedQueryResults(pkg, map);
    const before = JSON.stringify(r);
    evidence['supportingEvidenceIds'].push('s9/z@1');
    evidence['value'] = false;
    map.set('qa', F('s1/b@1'));
    src.nodes[1].expr = { all: [] };
    expect(JSON.stringify(r)).toBe(before);
    const deepFrozen = (v: unknown): boolean => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v as object).every(deepFrozen));
    expect(deepFrozen(r)).toBe(true);
    const frozenInput = Object.freeze({ status: 'Known', value: true, supportingEvidenceIds: Object.freeze(['s1/a@1']) }) as SuppliedEvidence;
    expect(outputsOf(experimentalExecuteWithSuppliedQueryResults(pkg, new Map([['qa', frozenInput]])))['pa'].decision.value).toBe('True');
  });
});
