/**
 * EXPERIMENTAL, NONCLINICAL. Independent tests of the I1 compiler. Programs are built here, not
 * copied from the acceptance examples, and every expected code and JSON Pointer is derived from
 * first-program-implementation-contract.md §2, §5 (location rules), §6 and §7.
 */
import {
  DEMO_AUTHORITY_RULE,
  SAME_ENCOUNTER_RULE,
  experimentalCompile,
  experimentalCompilePreview,
  type CompileResult,
  type JsonValue,
  type PreviewCompileResult,
} from '../index';

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
    invalid(with_((p) => (p.nodes[0].contract.establishes = hole('H-1', 'Decision'))), ['UNSUPPORTED_CONSTRUCT', '/nodes/0/contract/establishes']);
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
  it('disjointness: equal literals overlap; different fields are an unsupported proof fragment', () => {
    invalid(with_((p) => (p.nodes[0].contract.refutes = eq('assertion', { enum: 'AssertionValue.Affirmed' }))), ['EXCLUSIVE_BRANCH_OVERLAP', '/nodes/0/contract/obligations/0']);
    invalid(with_((p) => (p.nodes[0].contract.refutes = eq('assertionKind', { enum: 'AssertionKind.PatientReport' }))), ['UNSUPPORTED_PROOF_FRAGMENT', '/nodes/0/contract/obligations/0']);
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
