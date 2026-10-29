/**
 * EXPERIMENTAL, NONCLINICAL. Independent tests of the I1 compiler. Programs are built here, not
 * copied from the acceptance examples, and every expected code and JSON Pointer is derived from
 * first-program-implementation-contract.md §2, §5 (location rules), §6 and §7.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CriteriaConfigurationError,
  DEMO_AUTHORITY_RULE,
  QuerySelectionConfigurationError,
  SAME_ENCOUNTER_RULE,
  experimentalClassifyRecord,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalEvaluateCriteria,
  experimentalExecutePreviewWithSuppliedQueryResults,
  experimentalExecuteWithSuppliedQueryResults,
  experimentalPossibleClasses,
  experimentalSelectForQuery,
  type CompiledPackage,
  type CompileResult,
  type IncompleteExplicitAssertionContract,
  type JsonValue,
  type PreviewCompileResult,
  type PreviewPackage,
} from '../index';
import { FIXTURE_DIR } from './support/fixture-runner';

type J = { [k: string]: any };
const eq = (field: string, rhs: J) => ({ eq: [{ field: ['c', field] }, rhs] });
const contract = (): J => ({
  retrieve: { type: 'demo-model/DemoAssessment@0.1', sources: ['src-a', 'src-b'], valueSet: 'vs/alpha@3' },
  corrections: { authority: DEMO_AUTHORITY_RULE },
  admissible: {
    episode: eq('episode', { ref: 'ctx.episode' }),
    encounter: JSON.parse(JSON.stringify(SAME_ENCOUNTER_RULE)),
    assertionKind: { in: ['PatientReport'] },
  },
  policy: 'explicit-assertion-v0',
  establishes: eq('assertion', { enum: 'AssertionValue.Affirmed' }),
  refutes: eq('assertion', { enum: 'AssertionValue.Denied' }),
  obligations: [{ disjoint: ['refutes', 'establishes'] }],
});
const hole = (id: string, type: string, extra: J = {}) => ({ hole: { id, type, explains: `undecided: ${id}`, ...extra } });
/** A complete program: nodes [0] query `ev`, [1] predicate `pv`, [2] finding `fd`; applicability `scope`. */
function program(): J {
  return {
    ppl: { languageVersion: 'ppl-1', capabilityProfileVersion: 'ppl-core-v0' },
    package: { id: 'test.pkg', state: 'Draft' },
    references: [{ id: 'ref-1', kind: 'EvidenceReference', file: 'x.txt', sha256: 'a'.repeat(64), lines: [3, 4], quote: { '3': 'line three' } }],
    valueSets: { 'vs/alpha@3': { expansion: [{ system: 'cs', code: 'c1' }], coveredSystems: ['cs'] } },
    applicability: { id: 'scope', kind: 'Predicate', expr: { all: [] } },
    nodes: [
      { id: 'ev', kind: 'EvidenceQuery', subject: 'patient', output: 'Evidence<Boolean>', contract: contract() },
      { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: 'ev' } } },
      { id: 'fd', kind: 'Finding', status: { all: [{ ref: 'scope' }, { ref: 'pv' }] }, label: 'L', cites: ['ref-1'] },
    ],
  };
}
const with_ = (f: (p: J) => void): J => {
  const p = program();
  f(p);
  return p;
};
const diags = (r: CompileResult | PreviewCompileResult) => r.diagnostics.map((d) => [d.code, d.location, ...(d.hole ? [d.hole] : [])]);
const edges = (r: CompileResult) =>
  (r.outcome === 'Compiled' ? r.package.dependencyEdges : r.dependencyEdges ?? []).map((e) => `${e.reader}->${e.read}`).sort();
/** Both modes fail with exactly these structural diagnostics. */
function invalid(p: J, ...expected: (string[])[]): void {
  const c = experimentalCompile(p as JsonValue);
  const v = experimentalCompilePreview(p as JsonValue);
  expect(c).toMatchObject({ outcome: 'CompileFailure', wellFormed: false });
  expect(v).toMatchObject({ outcome: 'CompileFailure', wellFormed: false });
  expect(diags(c).sort()).toEqual([...expected].sort());
  expect(diags(v)).toEqual(diags(c));
}

describe('I1 compiler: complete programs', () => {
  it('compiles a complete program, derives reader -> read edges, orders dependencies first', () => {
    const r = experimentalCompile(program() as JsonValue);
    expect(r.outcome).toBe('Compiled');
    expect(edges(r)).toEqual(['fd->pv', 'fd->scope', 'pv->ev']);
    if (r.outcome !== 'Compiled') return;
    const pos = (id: string) => r.package.declarations.findIndex((d) => d.id === id);
    expect(pos('ev')).toBeLessThan(pos('pv'));
    expect(pos('pv')).toBeLessThan(pos('fd'));
    expect(pos('scope')).toBeLessThan(pos('fd'));
    expect(r.package).toMatchObject({ kind: 'CompiledPackage', applicabilityId: 'scope', holes: [] });
    const q = r.package.declarations.find((d) => d.id === 'ev');
    expect(q).toMatchObject({ contract: { kind: 'explicit-assertion-v0', establishes: { field: 'assertion', value: 'Affirmed' }, refutes: { value: 'Denied' } } });
  });

  it('is independent of declaration order and identifiers (forward references allowed)', () => {
    const base = experimentalCompile(program() as JsonValue);
    const reordered = with_((p) => p.nodes.reverse());
    const r = experimentalCompile(reordered as JsonValue);
    expect(r.outcome).toBe('Compiled');
    if (r.outcome !== 'Compiled' || base.outcome !== 'Compiled') return;
    expect(r.package.declarations.map((d) => d.id)).toEqual(base.package.declarations.map((d) => d.id));
    expect(edges(r)).toEqual(edges(base));
    const renamed = JSON.parse(JSON.stringify(program()).replace(/"ev"/g, '"query.z"').replace(/"pv"/g, '"pred.a"'));
    expect(edges(experimentalCompile(renamed))).toEqual(['fd->pred.a', 'fd->scope', 'pred.a->query.z']);
  });

  it('deduplicates repeated edges but keeps every authoring location', () => {
    const r = experimentalCompile(with_((p) => (p.nodes[2].status = { all: [{ ref: 'pv' }, { ref: 'scope' }, { ref: 'pv' }] })) as JsonValue);
    expect(r.outcome).toBe('Compiled');
    if (r.outcome !== 'Compiled') return;
    const e = r.package.dependencyEdges.filter((x) => x.reader === 'fd' && x.read === 'pv');
    expect(e).toEqual([{ reader: 'fd', read: 'pv', locations: ['/nodes/2/status/all/0', '/nodes/2/status/all/2'] }]);
  });

  it('never turns citations or context bindings into executable edges', () => {
    expect(edges(experimentalCompile(program() as JsonValue))).not.toContain('fd->ref-1');
    expect(edges(experimentalCompile(program() as JsonValue)).some((e) => e.includes('ctx.'))).toBe(false);
  });

  it('does not mutate a deep-frozen source', () => {
    const freeze = (o: any): any => (o && typeof o === 'object' ? Object.freeze(Object.values(o).forEach(freeze) ?? o) : o);
    const p = freeze(with_((x) => (x.nodes[2].urgency = hole('H-U', 'UrgencyRequirement'))));
    const before = JSON.stringify(p);
    expect(() => experimentalCompile(p)).not.toThrow();
    expect(() => experimentalCompilePreview(p)).not.toThrow();
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('I1 compiler: packages are detached from the source and frozen (review of 3ecd664)', () => {
  const frozenDeep = (v: unknown): boolean =>
    v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v as object).every(frozenDeep));
  /** Every kind of retained content: rules, arrays, value sets, references, labels, hole fields. */
  const edit = (p: J) => {
    p.nodes[0].contract.admissible.encounter.eq[1].ref = 'ctx.unsupported';
    p.nodes[0].contract.admissible.episode.eq[0].field[1] = 'subject';
    p.nodes[0].contract.admissible.assertionKind.in.push('Hearsay');
    p.nodes[0].contract.retrieve.sources.push('src-z');
    p.nodes[0].contract.establishes.eq[1].enum = 'AssertionValue.Denied';
    p.valueSets['vs/alpha@3'].expansion[0].code = 'changed';
    p.references[0].quote['3'] = 'changed';
    p.nodes[2].label = 'changed';
    p.nodes[2].cites.push('ref-x');
    if (p.nodes[2].urgency) p.nodes[2].urgency.hole.explains = 'changed';
  };

  it('editing the source after normal compilation leaves the package unchanged', () => {
    const p = program();
    const r = experimentalCompile(p as JsonValue);
    expect(r.outcome).toBe('Compiled');
    const before = JSON.stringify(r);
    edit(p);
    expect(JSON.stringify(r)).toBe(before);
    const q = r.outcome === 'Compiled' ? r.package.declarations.find((d) => d.id === 'ev') : undefined;
    expect(q && q.kind === 'EvidenceQuery' && q.contract.kind === 'explicit-assertion-v0' && q.contract.admissible.encounter).toEqual(SAME_ENCOUNTER_RULE);
  });

  it('editing the source after preview compilation leaves the package unchanged', () => {
    const p = with_((x) => (x.nodes[2].urgency = hole('H-U', 'UrgencyRequirement')));
    const r = experimentalCompilePreview(p as JsonValue);
    expect(r.outcome).toBe('PreviewPackage');
    const before = JSON.stringify(r);
    edit(p);
    expect(JSON.stringify(r)).toBe(before);
  });

  it('results are deep-frozen at runtime; mutation attempts throw', () => {
    const c = experimentalCompile(program() as JsonValue);
    const v = experimentalCompilePreview(with_((x) => (x.applicability.expr = hole('H-A', 'Decision'))) as JsonValue);
    const h = experimentalCompile(with_((x) => (x.applicability.expr = hole('H-A', 'Decision'))) as JsonValue);
    const f = experimentalCompile(with_((x) => delete x.applicability) as JsonValue);
    for (const r of [c, v, h, f]) expect(frozenDeep(r)).toBe(true);
    if (c.outcome !== 'Compiled') throw new Error('expected Compiled');
    expect(() => (c.package.declarations as unknown[]).push({})).toThrow(TypeError);
    expect(() => ((c.package.valueSets as J)['vs/alpha@3'].expansion = [])).toThrow(TypeError);
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'value-set and declaration identifier %j survive compilation and serialization as own keys',
    (name) => {
      // Built from JSON text, as a parser would, so `__proto__` is an ordinary own member.
      const text = JSON.stringify(program()).split('"vs/alpha@3"').join(JSON.stringify(name)).split('"pv"').join(JSON.stringify(name));
      const r = experimentalCompile(JSON.parse(text));
      expect(r.outcome).toBe('Compiled');
      if (r.outcome !== 'Compiled') return;
      const vs = r.package.valueSets;
      expect(Object.prototype.hasOwnProperty.call(vs, name)).toBe(true);
      expect(Object.keys(vs)).toEqual([name]);
      const roundTrip = JSON.parse(JSON.stringify(vs));
      expect(Object.prototype.hasOwnProperty.call(roundTrip, name)).toBe(true);
      expect(roundTrip[name]).toEqual({ id: name, expansion: [{ system: 'cs', code: 'c1' }], coveredSystems: ['cs'] });
      expect(r.package.declarations.map((d) => d.id)).toContain(name);
      expect(r.package.dependencyEdges.map((e) => `${e.reader}->${e.read}`)).toEqual(expect.arrayContaining([`fd->${name}`, `${name}->ev`]));
    },
  );
});

describe('I1 compiler: source structure', () => {
  it('missing applicability is SOURCE_INVALID at the root and is never defaulted', () => {
    invalid(with_((p) => delete p.applicability && (p.nodes[2].status = { all: [{ ref: 'pv' }] })), ['SOURCE_INVALID', '']);
    // A reference naming no declaration is its own error under the contract, not a cascade.
    invalid(with_((p) => delete p.applicability), ['SOURCE_INVALID', ''], ['UNDEFINED_REFERENCE', '/nodes/2/status/all/0/ref']);
  });
  it('unsupported language version is SOURCE_INVALID', () => {
    invalid(with_((p) => (p.ppl.languageVersion = 'ppl-2')), ['SOURCE_INVALID', '/ppl/languageVersion']);
  });
  it('unknown executable properties, forms and kinds are UNKNOWN_EXECUTABLE_PROPERTY', () => {
    invalid(with_((p) => (p.nodes[1].weight = 2)), ['UNKNOWN_EXECUTABLE_PROPERTY', '/nodes/1/weight']);
    invalid(with_((p) => (p.nodes[1].expr = { maybe: { ref: 'ev' } })), ['UNKNOWN_EXECUTABLE_PROPERTY', '/nodes/1/expr/maybe']);
    invalid(with_((p) => (p.nodes[1].kind = 'Widget')), ['UNKNOWN_EXECUTABLE_PROPERTY', '/nodes/1/kind']);
    invalid(with_((p) => (p.layout = {})), ['UNKNOWN_EXECUTABLE_PROPERTY', '/layout']);
  });
  it('a known Stage A kind outside the subset is UNSUPPORTED_CONSTRUCT', () => {
    invalid(with_((p) => p.nodes.push({ id: 'r', kind: 'Recommendation' })), ['UNSUPPORTED_CONSTRUCT', '/nodes/3/kind']);
  });
  it('prose where an expression is required is SOURCE_INVALID', () => {
    invalid(with_((p) => (p.nodes[1].expr = 'the evidence is positive')), ['SOURCE_INVALID', '/nodes/1/expr']);
    invalid(with_((p) => (p.nodes[0].contract.establishes = 'assertion is affirmed')), ['SOURCE_INVALID', '/nodes/0/contract/establishes']);
  });
  it('citation field shapes are checked; files are not read', () => {
    invalid(with_((p) => (p.references[0].sha256 = 'xyz')), ['SOURCE_INVALID', '/references/0/sha256']);
    invalid(with_((p) => (p.references[0].quote = { '9': 'out of range' })), ['SOURCE_INVALID', '/references/0/quote']);
    expect(experimentalCompile(with_((p) => (p.references[0].file = 'does/not/exist.txt')) as JsonValue).outcome).toBe('Compiled');
  });
  it('an invalid value-set expansion is SOURCE_INVALID at its entry (S2 rules)', () => {
    invalid(with_((p) => (p.valueSets['vs/alpha@3'].expansion = [{ system: 'cs', code: ' ' }])), ['SOURCE_INVALID', '/valueSets/vs~1alpha@3']);
  });
});

describe('I1 compiler: identifiers and references', () => {
  it('duplicate identifiers are INVALID_DECLARATION_ID at every occurrence, without cascading', () => {
    invalid(with_((p) => p.nodes.push({ id: 'pv', kind: 'Predicate', expr: { all: [] } })), ['INVALID_DECLARATION_ID', '/nodes/1/id'], ['INVALID_DECLARATION_ID', '/nodes/3/id']);
    invalid(with_((p) => (p.references[0].id = 'pv')), ['INVALID_DECLARATION_ID', '/nodes/1/id'], ['INVALID_DECLARATION_ID', '/references/0/id'], ['UNDEFINED_REFERENCE', '/nodes/2/cites/0']);
  });
  it('the reserved ctx. prefix is INVALID_DECLARATION_ID; references to it add nothing', () => {
    invalid(with_((p) => (p.nodes[1].id = 'ctx.pv') && (p.nodes[2].status.all[1].ref = 'ctx.pv')), ['INVALID_DECLARATION_ID', '/nodes/1/id']);
  });
  it('undefined references and citations are UNDEFINED_REFERENCE at the ref value / cites element', () => {
    invalid(with_((p) => (p.nodes[1].expr.evidenceValue.ref = 'nope')), ['UNDEFINED_REFERENCE', '/nodes/1/expr/evidenceValue/ref']);
    invalid(with_((p) => (p.nodes[2].cites = ['ref-1', 'ref-2'])), ['UNDEFINED_REFERENCE', '/nodes/2/cites/1']);
    invalid(with_((p) => (p.nodes[2].status.all[1].ref = 'ref-1')), ['UNDEFINED_REFERENCE', '/nodes/2/status/all/1/ref']);
    invalid(with_((p) => (p.nodes[2].cites = ['pv'])), ['UNDEFINED_REFERENCE', '/nodes/2/cites/0']);
  });
  it('an undefined value-set pin is UNDEFINED_REFERENCE', () => {
    invalid(with_((p) => (p.nodes[0].contract.retrieve.valueSet = 'vs/beta@1')), ['UNDEFINED_REFERENCE', '/nodes/0/contract/retrieve/valueSet']);
  });
  it('a Finding is not referenceable in this subset', () => {
    invalid(with_((p) => p.nodes.push({ id: 'p2', kind: 'Predicate', expr: { all: [{ ref: 'fd' }] } })), ['UNSUPPORTED_CONSTRUCT', '/nodes/3/expr/all/0/ref']);
  });
  it('cycles are one CYCLIC_EXECUTION_DEPENDENCY at the smallest ref pointer on the cycle', () => {
    invalid(
      with_((p) => p.nodes.push({ id: 'a', kind: 'Predicate', expr: { all: [{ ref: 'b' }] } }, { id: 'b', kind: 'Predicate', expr: { all: [{ ref: 'a' }, { ref: 'pv' }] } })),
      ['CYCLIC_EXECUTION_DEPENDENCY', '/nodes/3/expr/all/0/ref'],
    );
    invalid(with_((p) => p.nodes.push({ id: 'self', kind: 'Predicate', expr: { all: [{ ref: 'self' }] } })), ['CYCLIC_EXECUTION_DEPENDENCY', '/nodes/3/expr/all/0/ref']);
  });
});

describe('I1 compiler: types', () => {
  it('wrong operand types are TYPE_MISMATCH at the operand (no implicit projection or coercion)', () => {
    invalid(with_((p) => (p.nodes[1].expr = { ref: 'ev' })), ['TYPE_MISMATCH', '/nodes/1/expr']);
    invalid(with_((p) => (p.nodes[1].expr = { evidenceValue: { ref: 'scope' } })), ['TYPE_MISMATCH', '/nodes/1/expr/evidenceValue']);
    invalid(with_((p) => (p.nodes[2].status = { all: [{ ref: 'scope' }, { enum: 'AssertionValue.Denied' }] })), ['TYPE_MISMATCH', '/nodes/2/status/all/1']);
    invalid(with_((p) => (p.nodes[2].status = { all: [{ ref: 'scope' }, { all: [{ ref: 'ev' }] }] })), ['TYPE_MISMATCH', '/nodes/2/status/all/1/all/0']);
  });
  it('a hole whose type differs from its position is TYPE_MISMATCH at the hole', () => {
    invalid(with_((p) => (p.applicability.expr = hole('H-1', 'UrgencyRequirement'))), ['TYPE_MISMATCH', '/applicability/expr/hole']);
    invalid(with_((p) => (p.nodes[0].contract = hole('H-2', 'Decision'))), ['TYPE_MISMATCH', '/nodes/0/contract/hole']);
    invalid(with_((p) => (p.nodes[2].urgency = hole('H-3', 'Decision'))), ['TYPE_MISMATCH', '/nodes/2/urgency/hole']);
  });
  it('a missing or blank hole explanation is SOURCE_INVALID', () => {
    invalid(with_((p) => (p.applicability.expr = { hole: { id: 'H-1', type: 'Decision' } })), ['SOURCE_INVALID', '/applicability/expr/hole']);
    invalid(with_((p) => (p.applicability.expr = { hole: { id: 'H-1', type: 'Decision', explains: '  ' } })), ['SOURCE_INVALID', '/applicability/expr/hole/explains']);
  });
  it('holes outside the supported positions are UNSUPPORTED_CONSTRUCT', () => {
    invalid(with_((p) => (p.nodes[1].expr = hole('H-1', 'Decision'))), ['UNSUPPORTED_CONSTRUCT', '/nodes/1/expr']);
    invalid(with_((p) => (p.applicability.expr = { all: [hole('H-1', 'Decision')] })), ['UNSUPPORTED_CONSTRUCT', '/applicability/expr/all/0']);
    // A hole inside a criterion (not replacing all of it) stays unsupported; whole-criterion holes are tested below.
    invalid(with_((p) => (p.nodes[0].contract.establishes = { eq: [{ field: ['c', 'assertion'] }, hole('H-1', 'Decision')] })), ['UNSUPPORTED_CONSTRUCT', '/nodes/0/contract/establishes']);
  });
  it('duplicate hole identifiers are INVALID_DECLARATION_ID at each hole id', () => {
    invalid(
      with_((p) => {
        p.applicability.expr = hole('H-X', 'Decision');
        p.nodes[2].urgency = hole('H-X', 'UrgencyRequirement');
      }),
      ['INVALID_DECLARATION_ID', '/applicability/expr/hole/id'],
      ['INVALID_DECLARATION_ID', '/nodes/2/urgency/hole/id'],
    );
  });
  it('urgency other than a typed hole is UNSUPPORTED_CONSTRUCT', () => {
    invalid(with_((p) => (p.nodes[2].urgency = 'immediate')), ['UNSUPPORTED_CONSTRUCT', '/nodes/2/urgency']);
    invalid(with_((p) => (p.nodes[2].urgency = { level: 'high' })), ['UNSUPPORTED_CONSTRUCT', '/nodes/2/urgency']);
  });
  it('evidenceValue outside a Predicate and unsupported forms are UNSUPPORTED_CONSTRUCT', () => {
    invalid(with_((p) => (p.nodes[2].status = { all: [{ ref: 'scope' }, { evidenceValue: { ref: 'ev' } }] })), ['UNSUPPORTED_CONSTRUCT', '/nodes/2/status/all/1']);
    invalid(with_((p) => (p.nodes[2].status = { any: [{ ref: 'pv' }] })), ['UNSUPPORTED_CONSTRUCT', '/nodes/2/status']);
    invalid(with_((p) => (p.nodes[0].contract.establishes = { call: 'lib.isAffirmed' })), ['UNSUPPORTED_CONSTRUCT', '/nodes/0/contract/establishes']);
  });
});

describe('I1 compiler: query contract and context bindings', () => {
  it('cross-enum equality is TYPE_MISMATCH and suppresses the proof diagnostic', () => {
    invalid(with_((p) => (p.nodes[0].contract.establishes = eq('assertion', { enum: 'AssertionKind.PatientReport' }))), ['TYPE_MISMATCH', '/nodes/0/contract/establishes/eq/1']);
  });
  it('an undeclared field or enum value is UNDEFINED_REFERENCE', () => {
    invalid(with_((p) => (p.nodes[0].contract.refutes = eq('mood', { enum: 'AssertionValue.Denied' }))), ['UNDEFINED_REFERENCE', '/nodes/0/contract/refutes/eq/0/field']);
    invalid(with_((p) => (p.nodes[0].contract.refutes = eq('assertion', { enum: 'AssertionValue.Maybe' }))), ['UNDEFINED_REFERENCE', '/nodes/0/contract/refutes/eq/1/enum']);
  });
  it('criteria are restricted to c.assertion in I1: any other field is UNSUPPORTED_CONSTRUCT at the field operand', () => {
    const kind = eq('assertionKind', { enum: 'AssertionKind.PatientReport' });
    invalid(with_((p) => (p.nodes[0].contract.refutes = kind)), ['UNSUPPORTED_CONSTRUCT', '/nodes/0/contract/refutes/eq/0']);
    invalid(
      with_((p) => {
        p.nodes[0].contract.establishes = eq('assertionKind', { enum: 'AssertionKind.ClinicianDocumented' });
        p.nodes[0].contract.refutes = kind;
      }),
      ['UNSUPPORTED_CONSTRUCT', '/nodes/0/contract/establishes/eq/0'],
      ['UNSUPPORTED_CONSTRUCT', '/nodes/0/contract/refutes/eq/0'],
    );
    invalid(with_((p) => (p.nodes[0].contract.establishes = eq('episode', { enum: 'AssertionValue.Affirmed' }))), ['UNSUPPORTED_CONSTRUCT', '/nodes/0/contract/establishes/eq/0']);
  });
  it('disjointness: equal literals overlap; distinct literals are proved disjoint', () => {
    invalid(with_((p) => (p.nodes[0].contract.refutes = eq('assertion', { enum: 'AssertionValue.Affirmed' }))), ['EXCLUSIVE_BRANCH_OVERLAP', '/nodes/0/contract/obligations/0']);
    expect(experimentalCompile(with_((p) => (p.nodes[0].contract.refutes = eq('assertion', { enum: 'AssertionValue.Indeterminate' }))) as JsonValue).outcome).toBe('Compiled');
  });
  it('the disjoint obligation is required by the policy; other obligations are unsupported', () => {
    invalid(with_((p) => (p.nodes[0].contract.obligations = [])), ['SOURCE_INVALID', '/nodes/0/contract/obligations']);
    invalid(with_((p) => p.nodes[0].contract.obligations.push({ exhaustive: ['establishes'] })), ['UNSUPPORTED_CONSTRUCT', '/nodes/0/contract/obligations/1']);
  });
  it('unknown or misplaced ctx. references are UNSUPPORTED_CONTEXT_REFERENCE, without a shape cascade', () => {
    invalid(with_((p) => (p.nodes[0].contract.admissible.encounter.eq[1].ref = 'ctx.ward')), ['UNSUPPORTED_CONTEXT_REFERENCE', '/nodes/0/contract/admissible/encounter/eq/1/ref']);
    invalid(with_((p) => (p.nodes[0].contract.admissible.episode.eq[1].ref = 'ctx.encounter')), ['UNSUPPORTED_CONTEXT_REFERENCE', '/nodes/0/contract/admissible/episode/eq/1/ref']);
    invalid(with_((p) => (p.nodes[2].status.all[0] = { ref: 'ctx.episode' })), ['UNSUPPORTED_CONTEXT_REFERENCE', '/nodes/2/status/all/0/ref']);
    invalid(with_((p) => (p.nodes[0].contract.establishes = { eq: [{ field: ['c', 'assertion'] }, { ref: 'ctx.encounter' }] })), ['UNSUPPORTED_CONTEXT_REFERENCE', '/nodes/0/contract/establishes/eq/1/ref']);
  });
  it('admissible rules are recognized by exact shape; other rules and values are rejected', () => {
    invalid(with_((p) => (p.nodes[0].contract.admissible.encounter = { eq: [{ ref: 'ctx.encounter' }, { field: ['c', 'encounter'] }] })), ['UNSUPPORTED_CONTEXT_REFERENCE', '/nodes/0/contract/admissible/encounter/eq/0/ref']);
    invalid(with_((p) => (p.nodes[0].contract.admissible.subject = { eq: [] })), ['UNSUPPORTED_CONSTRUCT', '/nodes/0/contract/admissible/subject']);
    invalid(with_((p) => (p.nodes[0].contract.admissible.assertionKind = { in: ['Hearsay'] })), ['TYPE_MISMATCH', '/nodes/0/contract/admissible/assertionKind/in/0']);
    invalid(with_((p) => (p.nodes[0].contract.policy = 'latest-wins')), ['UNSUPPORTED_CONSTRUCT', '/nodes/0/contract/policy']);
  });
});

describe('I1 compiler: holes in normal and preview compilation', () => {
  /** Applicability and contract holes; a second predicate reads the first (transitive propagation). */
  const holed = () =>
    with_((p) => {
      p.applicability.expr = hole('H-SCOPE-T', 'Decision');
      p.nodes[0].contract = hole('H-EV-T', 'EvidenceSelectionContract<Boolean>');
      p.nodes.push({ id: 'pv2', kind: 'Predicate', expr: { all: [{ ref: 'pv' }] } });
      p.nodes[2].urgency = hole('H-URG-T', 'UrgencyRequirement');
      delete p.valueSets;
    });

  it('normal compilation reports exactly one UNRESOLVED_AUTHORING_HOLE per hole and stays well-formed', () => {
    const r = experimentalCompile(holed() as JsonValue);
    expect(r).toMatchObject({ outcome: 'CompileFailure', wellFormed: true });
    expect(diags(r).sort()).toEqual(
      [
        ['UNRESOLVED_AUTHORING_HOLE', '/applicability/expr/hole', 'H-SCOPE-T'],
        ['UNRESOLVED_AUTHORING_HOLE', '/nodes/0/contract/hole', 'H-EV-T'],
        ['UNRESOLVED_AUTHORING_HOLE', '/nodes/2/urgency/hole', 'H-URG-T'],
      ].sort(),
    );
    expect(edges(r)).toEqual(['fd->pv', 'fd->scope', 'pv->ev', 'pv2->pv']);
  });

  it('preview marks transitively, unions hole identities, and blocks publication', () => {
    const r = experimentalCompilePreview(holed() as JsonValue);
    expect(r.outcome).toBe('PreviewPackage');
    if (r.outcome !== 'PreviewPackage') return;
    expect(r.package.kind).toBe('PreviewPackage');
    expect(r.package.publication).toBe('Blocked');
    expect(r.package.markers).toEqual([
      { output: 'ev', holes: ['H-EV-T'] },
      { output: 'fd.status', holes: ['H-EV-T', 'H-SCOPE-T'] },
      { output: 'fd.urgency', holes: ['H-URG-T'] },
      { output: 'pv', holes: ['H-EV-T'] },
      { output: 'pv2', holes: ['H-EV-T'] },
      { output: 'scope', holes: ['H-SCOPE-T'] },
    ]);
    expect(r.package.inspectable).toEqual({ 'fd.label': 'L', 'fd.cites': ['ref-1'] });
  });

  it('an attribute-only hole marks only the attribute, not an otherwise unmarked status', () => {
    const p = with_((x) => (x.nodes[2].urgency = hole('H-ONLY', 'UrgencyRequirement')));
    expect(diags(experimentalCompile(p as JsonValue))).toEqual([['UNRESOLVED_AUTHORING_HOLE', '/nodes/2/urgency/hole', 'H-ONLY']]);
    const r = experimentalCompilePreview(p as JsonValue);
    expect(r.outcome === 'PreviewPackage' && r.package.markers).toEqual([{ output: 'fd.urgency', holes: ['H-ONLY'] }]);
  });

  it('a complete program also preview-compiles, with no markers, and stays a distinct package kind', () => {
    const r = experimentalCompilePreview(program() as JsonValue);
    expect(r.outcome === 'PreviewPackage' && [r.package.kind, r.package.markers]).toEqual(['PreviewPackage', []]);
  });

  it('a structural error in a holed program fails both modes with structural diagnostics only', () => {
    invalid(with_((p) => {
      Object.assign(p, holed());
      p.nodes[3].expr.all[0].ref = 'missing';
    }), ['UNDEFINED_REFERENCE', '/nodes/3/expr/all/0/ref']);
  });
});

describe('I1 compiler: whole-criterion holes (preview only; evidence-query contract §6.1, case 52)', () => {
  const C = '/nodes/0/contract';
  const AFFIRMED = { field: 'assertion', enumType: 'AssertionValue', value: 'Affirmed', location: `${C}/establishes` };
  const DENIED = { field: 'assertion', enumType: 'AssertionValue', value: 'Denied', location: `${C}/refutes` };
  const holedAt = (...ks: ('establishes' | 'refutes')[]) =>
    with_((p) => ks.forEach((k) => (p.nodes[0].contract[k] = hole(`H-${k.toUpperCase()}`, 'Decision', { cites: ['ref-1'] }))));
  const preview = (p: J): PreviewPackage => {
    const r = experimentalCompilePreview(p as JsonValue);
    if (r.outcome !== 'PreviewPackage') throw new Error(`preview failed: ${JSON.stringify(r.diagnostics)}`);
    return r.package;
  };
  const queryContract = (pkg: PreviewPackage) => {
    const q = pkg.declarations.find((d) => d.id === 'ev');
    if (q?.kind !== 'EvidenceQuery') throw new Error('no ev');
    return q.contract;
  };
  const incomplete = (pkg: PreviewPackage): IncompleteExplicitAssertionContract => {
    const c = queryContract(pkg);
    if (c.kind !== 'explicit-assertion-v0-incomplete') throw new Error(`contract kind ${c.kind}`);
    return c;
  };

  it.each([
    [['establishes'], { kind: 'hole', hole: 'H-ESTABLISHES', location: `${C}/establishes/hole` }, { kind: 'complete', criterion: DENIED }],
    [['refutes'], { kind: 'complete', criterion: AFFIRMED }, { kind: 'hole', hole: 'H-REFUTES', location: `${C}/refutes/hole` }],
    [['establishes', 'refutes'], { kind: 'hole', hole: 'H-ESTABLISHES', location: `${C}/establishes/hole` }, { kind: 'hole', hole: 'H-REFUTES', location: `${C}/refutes/hole` }],
  ] as const)('preview keeps the hole and the complete sibling: holes at %j', (at, establishes, refutes) => {
    const pkg = preview(holedAt(...at));
    const c = incomplete(pkg);
    expect(c.establishes).toEqual(establishes);
    expect(c.refutes).toEqual(refutes);
    const holes = at.map((k) => `H-${k.toUpperCase()}`);
    expect(c.disjointness).toEqual({ status: 'Pending', holes, locations: [`${C}/obligations/0`] });
    // Every other setting is validated and kept exactly as in the complete contract.
    const complete = experimentalCompile(program() as JsonValue);
    if (complete.outcome !== 'Compiled') throw new Error('complete');
    const ev = complete.package.declarations.find((d) => d.id === 'ev');
    if (ev?.kind !== 'EvidenceQuery') throw new Error('ev');
    const { kind: _k, establishes: _e, refutes: _r, source: _s, ...settings } = ev.contract;
    expect(c).toMatchObject(settings);
    expect(c.source).toEqual(holedAt(...at).nodes[0].contract);
    // Hole metadata: identity, declared type, explanation, citations and the pointer to the hole member.
    expect(pkg.holes).toEqual(holes.map((id) => ({ id, type: 'Decision', explains: `undecided: ${id}`, cites: ['ref-1'], location: `${C}/${id === 'H-ESTABLISHES' ? 'establishes' : 'refutes'}/hole` })));
    // The query and its dependents are marked, never Unresolved or False.
    expect(pkg.markers).toEqual([
      { output: 'ev', holes },
      { output: 'fd.status', holes },
      { output: 'pv', holes },
    ]);
    expect(pkg.publication).toBe('Blocked');
  });

  it.each([[['establishes']], [['refutes']], [['establishes', 'refutes']]] as const)('normal compilation is blocked, well-formed, one diagnostic per hole: %j', (at) => {
    const r = experimentalCompile(holedAt(...at) as JsonValue);
    expect(r).toMatchObject({ outcome: 'CompileFailure', wellFormed: true });
    expect('package' in r).toBe(false);
    expect(diags(r)).toEqual(at.map((k) => ['UNRESOLVED_AUTHORING_HOLE', `${C}/${k}/hole`, `H-${k.toUpperCase()}`]));
  });

  it('a complete query compiles exactly as before, in both modes', () => {
    const r = experimentalCompile(program() as JsonValue);
    if (r.outcome !== 'Compiled') throw new Error('complete');
    const c = r.package.declarations.find((d) => d.id === 'ev')!;
    if (c.kind !== 'EvidenceQuery') throw new Error('ev');
    expect(Object.keys(c.contract).sort()).toEqual(['admissible', 'authorityRule', 'establishes', 'kind', 'location', 'recordType', 'refutes', 'source', 'sources', 'valueSet']);
    expect([c.contract.kind, c.contract.establishes, c.contract.refutes]).toEqual(['explicit-assertion-v0', AFFIRMED, DENIED]);
    const v = preview(program());
    expect(queryContract(v)).toEqual(c.contract);
    expect([v.holes, v.markers]).toEqual([[], []]);
  });

  it('wrongly typed and malformed criterion holes are errors in both modes', () => {
    const at = (h: unknown) => with_((p) => (p.nodes[0].contract.establishes = h));
    invalid(at(hole('H-1', 'EvidenceSelectionContract<Boolean>')), ['TYPE_MISMATCH', `${C}/establishes/hole`]);
    invalid(at(hole('H-1', 'Evidence<Boolean>')), ['TYPE_MISMATCH', `${C}/establishes/hole`]);
    invalid(at({ hole: { id: 'H-1', type: 'Decision' } }), ['SOURCE_INVALID', `${C}/establishes/hole`]);
    invalid(at({ hole: { id: ' ', type: 'Decision', explains: 'x' } }), ['SOURCE_INVALID', `${C}/establishes/hole/id`]);
    invalid(at({ hole: 'H-1' }), ['SOURCE_INVALID', `${C}/establishes/hole`]);
    invalid(at(hole('H-1', 'Decision', { over: 'candidate' })), ['UNKNOWN_EXECUTABLE_PROPERTY', `${C}/establishes/hole/over`]);
    invalid(at({ ...hole('H-1', 'Decision'), ...eq('assertion', { enum: 'AssertionValue.Affirmed' }) }), ['SOURCE_INVALID', `${C}/establishes`]);
    invalid(at(hole('H-1', 'Decision', { cites: ['nope'] })), ['UNDEFINED_REFERENCE', `${C}/establishes/hole/cites/0`]);
  });

  it('a hole inside a criterion is still unsupported, in either criterion', () => {
    for (const k of ['establishes', 'refutes']) {
      for (const nested of [
        { eq: [{ field: ['c', 'assertion'] }, hole('H-1', 'Decision')] },
        { eq: [hole('H-1', 'Decision'), { enum: 'AssertionValue.Denied' }] },
        { not: hole('H-1', 'Decision') },
        { all: [hole('H-1', 'Decision')] },
      ]) invalid(with_((p) => (p.nodes[0].contract[k] = nested)), ['UNSUPPORTED_CONSTRUCT', `${C}/${k}`]);
    }
  });

  it('a hole never hides an invalid sibling criterion', () => {
    const beside = (refutes: J) =>
      with_((p) => {
        p.nodes[0].contract.establishes = hole('H-1', 'Decision');
        p.nodes[0].contract.refutes = refutes;
      });
    invalid(beside(eq('mood', { enum: 'AssertionValue.Denied' })), ['UNDEFINED_REFERENCE', `${C}/refutes/eq/0/field`]);
    invalid(beside(eq('assertion', { enum: 'AssertionValue.Maybe' })), ['UNDEFINED_REFERENCE', `${C}/refutes/eq/1/enum`]);
    invalid(beside(eq('assertion', { enum: 'AssertionKind.PatientReport' })), ['TYPE_MISMATCH', `${C}/refutes/eq/1`]);
    invalid(beside(eq('assertionKind', { enum: 'AssertionKind.PatientReport' })), ['UNSUPPORTED_CONSTRUCT', `${C}/refutes/eq/0`]);
    invalid(beside({ call: 'lib.isDenied' }), ['UNSUPPORTED_CONSTRUCT', `${C}/refutes`]);
    invalid(beside({ eq: [{ field: ['c', 'assertion'] }, { ref: 'ctx.encounter' }] }), ['UNSUPPORTED_CONTEXT_REFERENCE', `${C}/refutes/eq/1/ref`]);
    invalid(beside({ assertion: 'Denied' }), ['UNKNOWN_EXECUTABLE_PROPERTY', `${C}/refutes/assertion`]);
    invalid(beside('the record is negative' as never), ['SOURCE_INVALID', `${C}/refutes`]);
    // Mirror placement, and the hole's own diagnostic beside the sibling's.
    invalid(
      with_((p) => {
        p.nodes[0].contract.establishes = eq('assertion', { enum: 'AssertionValue.Maybe' });
        p.nodes[0].contract.refutes = { hole: { id: 'H-2', type: 'Decision' } };
      }),
      ['UNDEFINED_REFERENCE', `${C}/establishes/eq/1/enum`],
      ['SOURCE_INVALID', `${C}/refutes/hole`],
    );
  });

  it('unrelated invalid query settings are still rejected beside a criterion hole', () => {
    const holed = (f: (c: J) => void) => with_((p) => {
      p.nodes[0].contract.establishes = hole('H-1', 'Decision');
      f(p.nodes[0].contract);
    });
    invalid(holed((c) => (c.policy = 'latest-wins')), ['UNSUPPORTED_CONSTRUCT', `${C}/policy`]);
    invalid(holed((c) => (c.admissible.subject = { eq: [] })), ['UNSUPPORTED_CONSTRUCT', `${C}/admissible/subject`]);
    invalid(holed((c) => (c.retrieve.valueSet = 'vs/none@1')), ['UNDEFINED_REFERENCE', `${C}/retrieve/valueSet`]);
    invalid(holed((c) => (c.obligations = [])), ['SOURCE_INVALID', `${C}/obligations`]);
    invalid(holed((c) => c.obligations.push({ exhaustive: ['establishes'] })), ['UNSUPPORTED_CONSTRUCT', `${C}/obligations/1`]);
    invalid(holed((c) => delete c.obligations), ['SOURCE_INVALID', C]);
    invalid(holed((c) => (c.extra = 1)), ['UNKNOWN_EXECUTABLE_PROPERTY', `${C}/extra`]);
  });

  it('disjointness: pending with a hole (no value assumed); overlap and proof unchanged when both are complete', () => {
    // Refutes would overlap with any establishes = Denied; with establishes a hole nothing is proved or refuted.
    const c = incomplete(preview(holedAt('establishes')));
    expect(c.disjointness.status).toBe('Pending');
    // Two disjoint entries are both pending.
    const twice = incomplete(preview(with_((p) => {
      p.nodes[0].contract.establishes = hole('H-1', 'Decision');
      p.nodes[0].contract.obligations.push({ disjoint: ['establishes', 'refutes'] });
    })));
    expect(twice.disjointness).toEqual({ status: 'Pending', holes: ['H-1'], locations: [`${C}/obligations/0`, `${C}/obligations/1`] });
    invalid(with_((p) => (p.nodes[0].contract.refutes = eq('assertion', { enum: 'AssertionValue.Affirmed' }))), ['EXCLUSIVE_BRANCH_OVERLAP', `${C}/obligations/0`]);
    expect('disjointness' in (queryContract(preview(program())) as object)).toBe(false);
  });

  it('preview results are detached from the source and deep-frozen', () => {
    const src = holedAt('establishes');
    const pkg = preview(src);
    const before = JSON.stringify(pkg);
    src.nodes[0].contract.establishes.hole.explains = 'changed';
    src.nodes[0].contract.establishes.hole.id = 'H-OTHER';
    src.nodes[0].contract.refutes.eq[1].enum = 'AssertionValue.Affirmed';
    src.nodes[0].contract.obligations.length = 0;
    expect(JSON.stringify(pkg)).toBe(before);
    const c = incomplete(pkg);
    for (const o of [c, c.establishes, c.refutes, c.disjointness, c.disjointness.holes, c.disjointness.locations, pkg.holes[0]]) expect(Object.isFrozen(o)).toBe(true);
    if (c.refutes.kind !== 'complete') throw new Error('refutes');
    expect(Object.isFrozen(c.refutes.criterion)).toBe(true);
    expect(() => ((c.establishes as { hole: string }).hole = 'X')).toThrow(TypeError);
  });

  it('preview execution over supplied results marks the query and refuses a result for it', () => {
    const pkg = preview(holedAt('establishes'));
    const r = experimentalExecutePreviewWithSuppliedQueryResults(pkg, new Map());
    expect(r).toMatchObject({ outcome: 'Executed' });
    if (r.outcome !== 'Executed') return;
    expect(r.outputs['ev']).toEqual({ marker: { holes: ['H-ESTABLISHES'] }, stagesRun: [] });
    const supplied = experimentalExecutePreviewWithSuppliedQueryResults(pkg, new Map([['ev', { status: 'Known', value: true, supportingEvidenceIds: [] }]]) as never);
    expect(supplied).toMatchObject({ outcome: 'ExecutionInputError', errors: [{ code: 'RESULT_FOR_HOLED_QUERY', query: 'ev' }] });
  });
});

describe('Case 52 (EA-052a) as a compiler regression input', () => {
  const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, 'fixtures', 'EA-052a.json'), 'utf8'));
  const inline = fx.query.inline;
  /** The fixture query in a minimal program, as the fixture runner wraps it; `establishes` as given. */
  const wrap = (establishes: J): J => ({
    ppl: { languageVersion: 'ppl-1', capabilityProfileVersion: 'ppl-core-v0' },
    package: { id: 'fixture', state: 'Draft' },
    references: [],
    valueSets: inline.valueSets,
    applicability: { id: 'fixture.scope', kind: 'Predicate', expr: { all: [] } },
    nodes: [{ ...inline.query, subject: 'patient', contract: { ...inline.query.contract, establishes } }, inline.predicate],
  });
  const C = '/nodes/0/contract';
  // P6: the fixture's lower-level hole has no `explains` and an `over` member; an authored hole needs the former and has no such member.
  const authored = { hole: { id: 'H-CRITERION', type: 'Decision', explains: 'Which candidate assertions establish the query is undecided' } };

  it('the fixture hole as written is not an authored program hole (P6)', () => {
    expect(inline.query.contract.establishes).toEqual({ hole: { id: 'H-CRITERION', type: 'Decision', over: 'candidate' } });
    invalid(wrap(inline.query.contract.establishes), ['SOURCE_INVALID', `${C}/establishes/hole`], ['UNKNOWN_EXECUTABLE_PROPERTY', `${C}/establishes/hole/over`]);
  });

  it('with an explanation, preview represents the hole, keeps refutes, and matches the fixture markers', () => {
    const r = experimentalCompilePreview(wrap(authored) as JsonValue);
    if (r.outcome !== 'PreviewPackage') throw new Error(JSON.stringify(r.diagnostics));
    const q = r.package.declarations.find((d) => d.id === 'q.demo');
    if (q?.kind !== 'EvidenceQuery' || q.contract.kind !== 'explicit-assertion-v0-incomplete') throw new Error('q.demo');
    expect(q.contract.establishes).toEqual({ kind: 'hole', hole: 'H-CRITERION', location: `${C}/establishes/hole` });
    expect(q.contract.refutes).toEqual({ kind: 'complete', criterion: { field: 'assertion', enumType: 'AssertionValue', value: 'Denied', location: `${C}/refutes` } });
    expect(q.contract.disjointness).toEqual({ status: 'Pending', holes: ['H-CRITERION'], locations: [`${C}/obligations/0`] });
    expect(r.package.markers).toEqual(fx.expected.markers);
    expect(r.package.publication).toBe(fx.expected.publication);
    expect(diags(experimentalCompile(wrap(authored) as JsonValue))).toEqual([['UNRESOLVED_AUTHORING_HOLE', `${C}/establishes/hole`, 'H-CRITERION']]);
  });

  it('its preview criterion facts stay expected and unevaluated: Marker and True are preview-evaluation work', () => {
    const facts = fx.expected.traceAssertions.filter((t: J) => t.fact === 'criterion');
    expect(facts).toEqual([
      { fact: 'criterion', ref: 's1/r2@1', criterion: 'refutes', value: 'True' },
      { fact: 'criterion', ref: 's1/r2@1', criterion: 'establishes', value: 'Marker' },
    ]);
  });

  it('normal execution entry points reject its preview package; a complete twin is accepted', () => {
    const twin = experimentalCompile(wrap({ eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Affirmed' }] }) as JsonValue);
    const r = experimentalCompilePreview(wrap(authored) as JsonValue);
    if (twin.outcome !== 'Compiled' || r.outcome !== 'PreviewPackage') throw new Error('setup');
    const ctx = { subject: 'P1', revisions: fx.input.records, retractions: [], contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } };
    const s4 = experimentalSelectForQuery({ package: twin.package, query: 'q.demo', ...ctx });
    const key = s4.keys[0]!;
    const possibility = key.possibilities[0]!;
    expect(() => experimentalEvaluateCriteria({ package: twin.package, query: 'q.demo', s4, possibility })).not.toThrow();
    const pre = r.package as never as CompiledPackage;
    expect(() => experimentalSelectForQuery({ package: pre, query: 'q.demo', ...ctx })).toThrow(QuerySelectionConfigurationError);
    expect(() => experimentalSelectForQuery({ package: pre, query: 'q.demo', ...ctx })).toThrow(/preview packages/);
    for (const call of [
      () => experimentalEvaluateCriteria({ package: pre, query: 'q.demo', s4, possibility }),
      () => experimentalClassifyRecord({ package: pre, query: 'q.demo', s4, possibility }),
      () => experimentalPossibleClasses({ package: pre, query: 'q.demo', s4, key }),
    ]) {
      expect(call).toThrow(CriteriaConfigurationError);
      expect(call).toThrow(/preview packages/);
    }
    expect(experimentalExecuteWithSuppliedQueryResults(pre, new Map())).toMatchObject({ outcome: 'ExecutionInputError', errors: [{ code: 'INVALID_PACKAGE' }] });
  });
});
