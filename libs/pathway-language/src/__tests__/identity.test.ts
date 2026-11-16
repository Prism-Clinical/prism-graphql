/**
 * EXPERIMENTAL, NONCLINICAL. I7 identity sub-slice (need-identity-proposal.md). Expected bytes,
 * hashes and relationships come from the proposal, never from the production projection: the base
 * bytes are the proposal's hand-derived text, hashed here with node:crypto directly.
 *
 * Not proved here: that a built-in identifier (record type, authority rule, policy, language or
 * profile version) keeps one specified meaning across releases. That is a versioning obligation
 * (proposal 2.2, Rule B), not something a unit test can show.
 */
import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { contractDigestProjection } from '../identity';
import {
  CONTRACT_DIGEST_SCHEME,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalNeedIdentity as id,
  NeedIdentityConfigurationError,
  type CompiledPackage,
  type JsonValue,
  type NeedIdentityInput,
  type NeedIdentityResult,
  type NeedKey,
  type PreviewPackage,
} from '../index';

type J = { [k: string]: any };
const T = 'demo-model/DemoAssessment@0.1';
const PIN = 'demo-vs/item-x@1';

/** The proposal's section 4 base: q.demo in package pkg.a. */
function source(over: { pkg?: string; contract?: J; valueSets?: J; extra?: J[]; first?: J[]; state?: string; label?: string; qid?: string } = {}): J {
  const qid = over.qid ?? 'q.demo';
  return {
    ppl: { languageVersion: 'ppl-1', capabilityProfileVersion: 'ppl-core-v0' },
    package: { id: over.pkg ?? 'pkg.a', state: over.state ?? 'Draft' },
    references: [],
    valueSets: over.valueSets ?? { [PIN]: { expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] } },
    applicability: { id: 'scope', kind: 'Predicate', expr: { all: [] } },
    nodes: [
      ...(over.first ?? []),
      {
        id: qid,
        kind: 'EvidenceQuery',
        subject: 'patient',
        output: 'Evidence<Boolean>',
        contract: {
          retrieve: { type: T, sources: ['s1', 's2'], valueSet: PIN },
          corrections: { authority: 'demo-policy/same-source-amend@1' },
          admissible: {
            episode: { eq: [{ field: ['c', 'episode'] }, { ref: 'ctx.episode' }] },
            encounter: { eq: [{ field: ['c', 'encounter'] }, { ref: 'ctx.encounter' }] },
            assertionKind: { in: ['ClinicianDocumented', 'PatientReport'] },
          },
          policy: 'explicit-assertion-v0',
          establishes: { eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Affirmed' }] },
          refutes: { eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Denied' }] },
          obligations: [{ disjoint: ['establishes', 'refutes'] }],
          ...over.contract,
        },
      },
      { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: qid } } },
      { id: 'f', kind: 'Finding', status: { all: [{ ref: 'pv' }] }, label: over.label ?? 'Schematic finding (nonclinical)' },
      ...(over.extra ?? []),
    ],
  };
}
const RETRIEVE = (r: J) => ({ retrieve: { type: T, sources: ['s1', 's2'], valueSet: PIN, ...r } });
const ADMISSIBLE = (a: J) => ({ admissible: { ...source().nodes[0].contract.admissible, ...a } });

function compiled(p: J): CompiledPackage {
  const r = experimentalCompile(p as JsonValue);
  if (r.outcome !== 'Compiled') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
function preview(p: J): PreviewPackage {
  const r = experimentalCompilePreview(p as JsonValue);
  if (r.outcome !== 'PreviewPackage') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
const CTX = { subject: 'P1', contextEpisode: { known: 'E1' }, contextEncounter: { known: 'N1' } };
const BASE = compiled(source());
const run = (pkg: CompiledPackage | PreviewPackage = BASE, over: Partial<Record<keyof NeedIdentityInput, unknown>> = {}, query = 'q.demo'): NeedIdentityResult =>
  id({ package: pkg, query, ...CTX, ...over } as NeedIdentityInput);
const key = (...a: Parameters<typeof run>): NeedKey => {
  const r = run(...a);
  if (!('key' in r)) throw new Error(`expected a key, got ${JSON.stringify(r)}`);
  return r.key;
};
const bytes = (k: NeedKey) => canonicalize(k) as string;
const digestOf = (p: J) => key(compiled(p)).contractDigest;

/** Proposal section 4, verbatim. */
const BASE_BYTES =
  '{"admissible":{"assertionKind":["ClinicianDocumented","PatientReport"],"encounter":{"eq":[{"field":["c","encounter"]},{"ref":"ctx.encounter"}]},"episode":{"eq":[{"field":["c","episode"]},{"ref":"ctx.episode"}]}},"capabilityProfileVersion":"ppl-core-v0","corrections":{"authority":"demo-policy/same-source-amend@1"},"declaration":{"kind":"EvidenceQuery","output":"Evidence<Boolean>","subject":"patient"},"establishes":{"enumType":"AssertionValue","field":"assertion","value":"Affirmed"},"languageVersion":"ppl-1","policy":"explicit-assertion-v0","refutes":{"enumType":"AssertionValue","field":"assertion","value":"Denied"},"retrieve":{"recordType":"demo-model/DemoAssessment@0.1","sources":["s1","s2"],"valueSet":{"coveredSystems":["demo-cs"],"expansion":[{"code":"item-x","system":"demo-cs"}],"id":"demo-vs/item-x@1"}},"scheme":"ppl-query-contract-digest/0"}';
const BASE_SHA = createHash('sha256').update(Buffer.from(BASE_BYTES, 'utf8')).digest('hex');
const BASE_DIGEST = { scheme: 'ppl-query-contract-digest/0', sha256: BASE_SHA };

describe('base projection and key (proposal sections 2–4)', () => {
  test('the projection serializes to the hand-derived bytes', () => {
    const decl = BASE.declarations.find((d) => d.id === 'q.demo')!;
    expect(canonicalize(contractDigestProjection(BASE, decl as never))).toBe(BASE_BYTES);
  });

  test('the key is package-qualified and its digest is SHA-256 of the hand-derived bytes', () => {
    expect(CONTRACT_DIGEST_SCHEME).toBe('ppl-query-contract-digest/0');
    expect(BASE_SHA).toMatch(/^[0-9a-f]{64}$/);
    expect(run()).toEqual({ key: { query: { package: 'pkg.a', id: 'q.demo' }, contractDigest: BASE_DIGEST, subject: 'P1', episode: 'E1', encounter: 'N1' } });
  });

  test('deterministic: two calls give identical canonical bytes', () => {
    expect(bytes(key())).toBe(bytes(key()));
  });
});

describe('equivalences: same digest and key (X1–X6, X15, X19, X23)', () => {
  const same = (p: J) => expect(key(compiled(p))).toEqual(key());

  test('X1 object-member order of retrieve and admissible', () => {
    const p = source();
    const c = p.nodes[0].contract;
    c.retrieve = { valueSet: PIN, sources: ['s1', 's2'], type: T };
    c.admissible = { assertionKind: c.admissible.assertionKind, encounter: c.admissible.encounter, episode: c.admissible.episode };
    same(p);
  });
  test('X2 sources reordered', () => same(source({ contract: RETRIEVE({ sources: ['s2', 's1'] }) })));
  test('X3 assertionKind reordered and duplicated', () => same(source({ contract: ADMISSIBLE({ assertionKind: { in: ['PatientReport', 'ClinicianDocumented', 'PatientReport'] } }) })));
  test('X4 expansion duplicated and reordered; coveredSystems reordered and duplicated', () => {
    const vs = (expansion: J[], coveredSystems: string[]) => ({ [PIN]: { expansion, coveredSystems } });
    const two = [{ system: 'demo-cs', code: 'item-x' }, { system: 'b-cs', code: 'z' }];
    const a = digestOf(source({ valueSets: vs(two, ['demo-cs', 'b-cs']) }));
    expect(digestOf(source({ valueSets: vs([two[1]!, two[0]!, two[0]!], ['b-cs', 'demo-cs', 'b-cs']) }))).toEqual(a);
    expect(digestOf(source({ valueSets: vs([{ code: 'item-x', system: 'demo-cs' }, { system: 'demo-cs', code: 'item-x' }], ['demo-cs']) }))).toEqual(BASE_DIGEST);
  });
  test('X5 label, package state and node position (every location changes)', () => {
    same(source({ label: 'Another label' }));
    same(source({ state: 'Review' }));
    same(source({ first: [{ id: 'p0', kind: 'Predicate', expr: { all: [] } }] }));
  });
  test('X5 cites and locations are excluded by construction (projection helper)', () => {
    const decl = BASE.declarations.find((d) => d.id === 'q.demo')! as J;
    const moved = { ...decl, cites: ['ref.other'], location: '/nodes/9', contract: { ...decl.contract, location: '/x', source: { other: true }, establishes: { ...decl.contract.establishes, location: '/y' } } };
    expect(canonicalize(contractDigestProjection(BASE, moved as never))).toBe(BASE_BYTES);
  });
  test('X6 another query, predicate and an unpinned value set added', () => {
    const extraQuery = { ...source().nodes[0], id: 'q.other', contract: { ...source().nodes[0].contract, ...RETRIEVE({ sources: ['s9'] }) } };
    const p = source({ extra: [extraQuery, { id: 'p9', kind: 'Predicate', expr: { evidenceValue: { ref: 'q.other' } } }] });
    p.valueSets['demo-vs/unused@1'] = { expansion: [{ system: 'u', code: 'u' }], coveredSystems: ['u'] };
    same(p);
  });
  test('X23 a revised package with the same namespace and contract keeps the key (X15/X19: the API takes no snapshot or build input)', () => {
    same(source({ label: 'revised', extra: [{ id: 'p9', kind: 'Predicate', expr: { all: [] } }] }));
  });
});

describe('executable changes: digest and key differ (X7–X12)', () => {
  const differs = (p: J) => {
    const k = key(compiled(p));
    expect(k.contractDigest.sha256).not.toBe(BASE_SHA);
    expect(bytes(k)).not.toBe(bytes(key()));
  };
  test('X7 establishes value', () => differs(source({ contract: { establishes: { eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Indeterminate' }] } } })));
  test('refutes value', () => differs(source({ contract: { refutes: { eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Indeterminate' }] } } })));
  test('X8 assertionKind subset (d-ak1)', () => differs(source({ contract: ADMISSIBLE({ assertionKind: { in: ['ClinicianDocumented'] } }) })));
  test('X10 same value-set ID, added code (Rule V)', () =>
    differs(source({ valueSets: { [PIN]: { expansion: [{ system: 'demo-cs', code: 'item-x' }, { system: 'demo-cs', code: 'item-y' }], coveredSystems: ['demo-cs'] } } })));
  test('same value-set ID, other covered systems (Rule V)', () =>
    differs(source({ valueSets: { [PIN]: { expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs', 'other-cs'] } } })));
  test('X11 same expansion under another value-set ID', () => {
    const p = source({ contract: RETRIEVE({ valueSet: 'demo-vs/item-x@2' }) });
    p.valueSets = { 'demo-vs/item-x@2': source().valueSets[PIN] };
    differs(p);
  });
  test('X12 another source', () => differs(source({ contract: RETRIEVE({ sources: ['s1', 's2', 's3'] }) })));

  // Settings this compiler subset admits only one value for (X9, X21, record type, policy, versions,
  // declaration signature, admissible rules): tested on the projection helper with internal fixtures.
  test('internal fixtures: every remaining executable member changes the projection', () => {
    const decl = BASE.declarations.find((d) => d.id === 'q.demo')! as J;
    const c = decl.contract;
    const base = canonicalize(contractDigestProjection(BASE, decl as never));
    const variants: [string, J, J][] = [
      ['X9/X21 authority rule', BASE, { ...decl, contract: { ...c, authorityRule: 'demo-policy/other@1' } }],
      ['record type', BASE, { ...decl, contract: { ...c, recordType: 'demo-model/DemoAssessment@0.2' } }],
      ['policy', BASE, { ...decl, contract: { ...c, kind: 'explicit-assertion-v1' } }],
      ['episode rule', BASE, { ...decl, contract: { ...c, admissible: { ...c.admissible, episode: { eq: [{ ref: 'ctx.episode' }, { field: ['c', 'episode'] }] } } } }],
      ['encounter rule', BASE, { ...decl, contract: { ...c, admissible: { ...c.admissible, encounter: { other: true } } } }],
      ['criterion field', BASE, { ...decl, contract: { ...c, establishes: { ...c.establishes, field: 'other' } } }],
      ['criterion enum type', BASE, { ...decl, contract: { ...c, refutes: { ...c.refutes, enumType: 'Other' } } }],
      ['declaration output', BASE, { ...decl, output: 'Evidence<Other>' }],
      ['declaration subject', BASE, { ...decl, subject: 'other' }],
      ['language version', { ...BASE, languageVersion: 'ppl-2' }, decl],
      ['capability profile', { ...BASE, capabilityProfileVersion: 'ppl-core-v1' }, decl],
    ];
    for (const [, program, d] of variants) expect(canonicalize(contractDigestProjection(program as never, d as never))).not.toBe(base);
  });
});

describe('key components (X13, X14, X16, X22)', () => {
  test('X13 subject, episode and encounter each change the key, not the digest', () => {
    for (const over of [{ subject: 'P2' }, { contextEpisode: { known: 'E2' } }, { contextEncounter: { known: 'N2' } }]) {
      const k = key(BASE, over);
      expect(k.contractDigest).toEqual(BASE_DIGEST);
      expect(bytes(k)).not.toBe(bytes(key()));
    }
  });
  test('X14 another query ID with the same contract', () => {
    const k = key(compiled(source({ qid: 'q.demo2' })), {}, 'q.demo2');
    expect(k.contractDigest).toEqual(BASE_DIGEST);
    expect(k.query).toEqual({ package: 'pkg.a', id: 'q.demo2' });
  });
  test('X22 same contract in another package namespace: same digest, different key', () => {
    const b = key(compiled(source({ pkg: 'pkg.b' })));
    expect(b.contractDigest).toEqual(BASE_DIGEST);
    expect(b.query).toEqual({ package: 'pkg.b', id: 'q.demo' });
    expect(bytes(b)).not.toBe(bytes(key()));
  });
  test('X16 separator-containing components stay distinct', () => {
    const a = key(BASE, { subject: 'P1,E1', contextEpisode: { known: 'N1' }, contextEncounter: { known: 'N2' } });
    const b = key(BASE, { subject: 'P1', contextEpisode: { known: 'E1,N1' }, contextEncounter: { known: 'N2' } });
    expect(bytes(a)).not.toBe(bytes(b));
    // Package/query split across a separator: "a.b" + "c" vs "a" + "b.c".
    const p1 = key(compiled(source({ pkg: 'pkg.a.q', qid: 'demo' })), {}, 'demo');
    const p2 = key(compiled(source({ pkg: 'pkg.a', qid: 'q.demo' })));
    expect(bytes(p1)).not.toBe(bytes(p2));
  });
});

describe('preview packages and holes (X18, proposal 2.4)', () => {
  const SCOPE_HOLE = { id: 'scope', kind: 'Predicate', expr: { hole: { id: 'H-S', type: 'Decision', explains: 'scope undecided' } } };
  const hole = (h: string) => ({ hole: { id: h, type: 'Decision', explains: `${h} undecided` } });
  const withHoles = (contract: J) => preview({ ...source({ contract }), applicability: SCOPE_HOLE });

  test('a complete query in a PreviewPackage has the same digest and key as when compiled normally', () => {
    expect(run(preview({ ...source(), applicability: SCOPE_HOLE }))).toEqual(run());
  });
  test('criterion holes in each combination, and a whole-contract hole, give noContractIdentity', () => {
    expect(run(withHoles({ establishes: hole('H-E') }))).toEqual({ noContractIdentity: { holes: ['H-E'] } });
    expect(run(withHoles({ refutes: hole('H-R') }))).toEqual({ noContractIdentity: { holes: ['H-R'] } });
    expect(run(withHoles({ establishes: hole('H-E'), refutes: hole('H-R') }))).toEqual({ noContractIdentity: { holes: ['H-E', 'H-R'] } });
    const whole = preview({ ...source(), nodes: [{ ...source().nodes[0], contract: { hole: { id: 'H-C', type: 'EvidenceSelectionContract<Boolean>', explains: 'x' } } }, ...source().nodes.slice(1)] });
    expect(run(whole)).toEqual({ noContractIdentity: { holes: ['H-C'] } });
  });
  test('a hole takes precedence over unknown bindings (proposal 1: unresolvedBindings needs a complete contract)', () => {
    expect(run(withHoles({ establishes: hole('H-E') }), { contextEpisode: { unknown: ['Missing'] } })).toEqual({ noContractIdentity: { holes: ['H-E'] } });
  });
});

describe('unresolved bindings (X17, X17b)', () => {
  test('one or both unknown, in key order, each once', () => {
    expect(run(BASE, { contextEpisode: { unknown: ['Conflicting'] } })).toEqual({ unresolvedBindings: ['episode'] });
    expect(run(BASE, { contextEncounter: { unknown: ['Missing'] } })).toEqual({ unresolvedBindings: ['encounter'] });
    expect(run(BASE, { contextEncounter: { unknown: ['Missing'] }, contextEpisode: { unknown: ['Missing', 'Invalid'] } })).toEqual({ unresolvedBindings: ['episode', 'encounter'] });
  });
});

describe('configuration errors', () => {
  const bad = (input: unknown, msg: RegExp) => expect(() => id(input as NeedIdentityInput)).toThrow(msg);
  const ok = { package: BASE, query: 'q.demo', ...CTX };
  test('error class', () => expect(() => id(null as never)).toThrow(NeedIdentityConfigurationError));

  test('input shape: object, plain, only the five fields, all present, data properties only', () => {
    bad(null, /input must be an object/);
    bad([], /input must be an object/);
    bad(Object.assign(Object.create({ x: 1 }), ok), /plain object/);
    for (const extra of ['contractDigest', 'projection', 'namespace', 'packageId', 'valueSets', 'episode']) bad({ ...ok, [extra]: 'x' }, /unexpected input field/);
    bad({ ...ok, [Symbol('s')]: 1 }, /unexpected input field/);
    const { subject: _s, ...noSubject } = ok;
    bad(noSubject, /missing input field\(s\) subject/);
    let reads = 0;
    const accessor = { ...ok };
    Object.defineProperty(accessor, 'query', { get: () => (reads += 1, 'q.demo'), enumerable: true });
    bad(accessor, /data property/);
    expect(reads).toBe(0);
  });

  test('authenticity: copies and fabrications are rejected', () => {
    bad({ ...ok, package: { ...BASE } }, /produced by the compiler/);
    bad({ ...ok, package: JSON.parse(JSON.stringify(BASE)) }, /produced by the compiler/);
  });

  test('query ownership: non-string, absent, non-query and other-package IDs', () => {
    bad({ ...ok, query: 1 }, /query must be a string/);
    bad({ ...ok, query: 'q.missing' }, /not an EvidenceQuery/);
    bad({ ...ok, query: 'pv' }, /not an EvidenceQuery/);
    bad({ ...ok, query: 'f' }, /not an EvidenceQuery/);
    bad({ ...ok, package: compiled(source({ qid: 'q.other' })) }, /not an EvidenceQuery/);
  });

  test('subject must be a string without lone surrogates', () => {
    bad({ ...ok, subject: 1 }, /subject must be a string/);
    bad({ ...ok, subject: '\uD800' }, /lone surrogate/);
  });

  test('compiled identity components and digest projection must be RFC 8785-representable (review P2)', () => {
    const LONE = '\uD800';
    const vs = (code: string, extraCovered: string[] = []) => ({ [PIN]: { expansion: [{ system: 'demo-cs', code }], coveredSystems: ['demo-cs', ...extraCovered] } });
    const cases: [CompiledPackage, string, RegExp][] = [
      [compiled(source({ pkg: `pkg.${LONE}` })), 'q.demo', /^query\.package: lone surrogate/],
      [compiled(source({ qid: `q.${LONE}` })), `q.${LONE}`, /^query\.id: lone surrogate/],
      [compiled(source({ valueSets: vs(`item-${LONE}`) })), 'q.demo', /^projection\.retrieve\.valueSet\.expansion\[0\]\.code: lone surrogate/],
      [compiled(source({ valueSets: vs('item-x', [`cs-${LONE}`]) })), 'q.demo', /^projection\.retrieve\.valueSet\.coveredSystems\[0\]: lone surrogate/],
      [compiled(source({ contract: RETRIEVE({ sources: ['s1', `s${LONE}`] }) })), 'q.demo', /^projection\.retrieve\.sources\[1\]: lone surrogate/],
    ];
    for (const [pkg, q, msg] of cases) {
      expect(() => run(pkg, {}, q)).toThrow(NeedIdentityConfigurationError);
      expect(() => run(pkg, {}, q)).toThrow(msg);
      // Never masked by a binding outcome.
      expect(() => run(pkg, { contextEpisode: { unknown: ['Missing'] } }, q)).toThrow(msg);
    }
    // The namespace is checked even when the query has a hole.
    const holed = preview({ ...source({ pkg: `pkg.${LONE}`, contract: { establishes: { hole: { id: 'H-E', type: 'Decision', explains: 'x' } } } }) });
    expect(() => run(holed)).toThrow(/^query\.package: lone surrogate/);
    // A valid surrogate pair is ordinary data.
    expect(key(compiled(source({ pkg: 'pkg.😀' }))).query.package).toBe('pkg.😀');
  });

  test('malformed bindings are configuration errors, never unresolved', () => {
    const malformed: unknown[] = [
      null, 'E1', [], {}, { known: '' }, { known: '  ' }, { known: 1 }, { known: '\uDC00' }, { unknown: [] }, { unknown: ['Bogus'] },
      { unknown: ['Missing', 'Missing'] }, { known: 'E1', unknown: ['Missing'] }, { other: 'E1' },
      Object.defineProperty({ x: 1 }, 'known', { value: 'E1', enumerable: false }),
      Object.assign(Object.create({ inherited: 1 }), { known: 'E1' }),
      { known: () => 'E1' },
    ];
    for (const b of malformed) {
      bad({ ...ok, contextEpisode: b }, /contextEpisode/);
      bad({ ...ok, contextEncounter: b }, /contextEncounter/);
    }
    const getter = Object.defineProperty({}, 'known', { get: () => 'E1', enumerable: true });
    bad({ ...ok, contextEpisode: getter }, /accessor/);
  });

  test('configuration errors precede every outcome: malformed binding with a hole or an unknown binding still throws', () => {
    const holed = preview({ ...source({ contract: { establishes: { hole: { id: 'H-E', type: 'Decision', explains: 'x' } } } }), applicability: { id: 'scope', kind: 'Predicate', expr: { all: [] } } });
    bad({ ...ok, package: holed, contextEncounter: { known: '' } }, /contextEncounter/);
    bad({ ...ok, contextEpisode: { unknown: ['Missing'] }, contextEncounter: { known: '' } }, /contextEncounter/);
  });
});

describe('ownership', () => {
  test('outputs are detached and deeply frozen; caller inputs are unchanged and not frozen', () => {
    const ep = { known: 'E1' };
    const en = { unknown: ['Missing'] as string[] };
    const input = { package: BASE, query: 'q.demo', subject: 'P1', contextEpisode: ep, contextEncounter: { known: 'N1' } };
    const before = JSON.stringify(input);
    const r = id(input as NeedIdentityInput) as { key: NeedKey };
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(ep) || Object.isFrozen(input)).toBe(false);
    for (const o of [r, r.key, r.key.query, r.key.contractDigest]) expect(Object.isFrozen(o)).toBe(true);
    ep.known = 'E9';
    expect(r.key.episode).toBe('E1');

    const u = id({ ...input, contextEncounter: en } as NeedIdentityInput) as { unresolvedBindings: string[] };
    expect(Object.isFrozen(u.unresolvedBindings)).toBe(true);
    expect(Object.isFrozen(en.unknown)).toBe(false);
  });
});
