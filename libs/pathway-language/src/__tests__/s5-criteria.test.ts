/**
 * EXPERIMENTAL, NONCLINICAL. Per-record S5 criterion evaluation (evidence-query contract §3.4,
 * §3.5). Every expected value is written from the contract tables, never by calling the evaluator.
 * Classification (§3.3) is not implemented and not asserted here.
 */
import {
  CriteriaConfigurationError,
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCheckAdmissibility,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalEvaluateCriteria,
  experimentalResolveRevisionHistory,
  experimentalSelect,
  experimentalSelectForQuery,
  QuerySelectionConfigurationError,
  type CompiledPackage,
  type CriteriaResult,
  type JsonValue,
  type KeySelection,
  type PossibleSelection,
  type S1Result,
  type SelectionResult,
  type ValueSetExpansion,
} from '../index';

type J = { [k: string]: any };
const ENV = { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] } as const;
const PIN = 'demo-vs/item-x@1';
const VS: ValueSetExpansion = { id: PIN, expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] };
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
const ADM = { encounter: SAME_ENCOUNTER_RULE, episode: SAME_EPISODE_RULE, assertionKind: { in: ['ClinicianDocumented'] } };
const EST = '/nodes/0/contract/establishes';
const REF = '/nodes/0/contract/refutes';

const eq = (field: string, value: string) => ({ eq: [{ field: ['c', field] }, { enum: value }] });
function program(establishes: J = eq('assertion', 'AssertionValue.Affirmed'), refutes: J = eq('assertion', 'AssertionValue.Denied'), pin = PIN): J {
  return {
    ppl: { languageVersion: 'ppl-1', capabilityProfileVersion: 'ppl-core-v0' },
    package: { id: 'test.s5', state: 'Draft' },
    references: [],
    valueSets: { [pin]: { expansion: VS.expansion, coveredSystems: VS.coveredSystems } },
    applicability: { id: 'scope', kind: 'Predicate', expr: { all: [] } },
    nodes: [
      {
        id: 'q',
        kind: 'EvidenceQuery',
        subject: 'patient',
        output: 'Evidence<Boolean>',
        contract: {
          retrieve: { type: ENV.recordType, sources: [...ENV.sources], valueSet: pin },
          corrections: { authority: DEMO_AUTHORITY_RULE },
          admissible: { episode: SAME_EPISODE_RULE, encounter: SAME_ENCOUNTER_RULE, assertionKind: { in: ['ClinicianDocumented'] } },
          policy: 'explicit-assertion-v0',
          establishes,
          refutes,
          obligations: [{ disjoint: ['establishes', 'refutes'] }],
        },
      },
      { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: 'q' } } },
    ],
  };
}
function compiled(p: J = program()): CompiledPackage {
  const r = experimentalCompile(p as JsonValue);
  if (r.outcome !== 'Compiled') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
const PKG = compiled();

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
const s1Of = (revisions: JsonValue[], retractions: JsonValue[] = []): S1Result =>
  experimentalResolveRevisionHistory({ envelope: ENV, authorityRule: DEMO_AUTHORITY_RULE, revisions, retractions });
const s3Of = (s1: S1Result) =>
  experimentalCheckAdmissibility({ s1, valueSet: PIN, expansion: VS, admissible: ADM, contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } });
/** Query-bound selection (contract §3.5): every authored setting comes from `pkg`'s query. */
const sel = (revisions: JsonValue[], retractions: JsonValue[] = [], pkg: CompiledPackage = PKG, query = 'q'): SelectionResult =>
  experimentalSelectForQuery({ package: pkg, query, subject: 'P1', revisions, retractions, contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } });
function key(r: SelectionResult, k: string): KeySelection {
  const found = r.keys.find((x) => `${x.key.source}/${x.key.localId}` === k);
  if (!found) throw new Error(`key ${k} missing`);
  return found;
}
const first = (r: SelectionResult, k: string) => key(r, k).possibilities[0]!;
const run = (s4: SelectionResult, possibility: PossibleSelection, pkg: CompiledPackage = PKG) => experimentalEvaluateCriteria({ package: pkg, query: 'q', s4, possibility });
/** [establishes, refutes] values of an evaluated result. */
function values(r: CriteriaResult): [string, string] {
  if (r.outcome !== 'Evaluated') throw new Error(`not evaluated: ${r.reason}`);
  return [r.establishes.result.value, r.refutes.result.value];
}
const one = (assertion: JsonValue | undefined) => {
  const s4 = sel([rev('s1', 'r1', '1', { assertion })]);
  return run(s4, first(s4, 's1/r1'));
};
const MISSING = { value: 'Unknown', findings: [{ cause: 'Missing', origin: 'record', reason: 'FieldAbsent:assertion' }] };
const INVALID = { value: 'Unknown', findings: [{ cause: 'Invalid', origin: 'record', reason: 'FieldMalformed:assertion' }] };

describe('S5 criteria: contract §3.4 values', () => {
  it('Affirmed: establishes True, refutes False, with the full result and trace (field, enum, eq)', () => {
    expect(one('Affirmed')).toEqual({
      experimental: 'nonclinical-s5-criteria-v0',
      stage: 'S5',
      scope: 'one-possibility-criteria',
      packageId: 'test.s5',
      query: 'q',
      key: { source: 's1', localId: 'r1' },
      outcome: 'Evaluated',
      node: { revision: { source: 's1', localId: 'r1', revision: '1' } },
      disposition: { disposition: 'Selected' },
      establishes: {
        criterion: 'establishes',
        source: EST,
        result: { value: 'True' },
        trace: [
          { form: 'field', source: `${EST}/eq/0`, path: 'c.assertion', read: { status: 'Present', value: 'Affirmed' } },
          { form: 'enum', source: `${EST}/eq/1`, value: 'AssertionValue.Affirmed' },
          { form: 'eq', source: EST, result: { value: 'True' } },
        ],
      },
      refutes: {
        criterion: 'refutes',
        source: REF,
        result: { value: 'False' },
        trace: [
          { form: 'field', source: `${REF}/eq/0`, path: 'c.assertion', read: { status: 'Present', value: 'Affirmed' } },
          { form: 'enum', source: `${REF}/eq/1`, value: 'AssertionValue.Denied' },
          { form: 'eq', source: REF, result: { value: 'False' } },
        ],
      },
    });
  });

  it('Denied: establishes False, refutes True', () => {
    expect(values(one('Denied'))).toEqual(['False', 'True']);
  });

  it('Indeterminate: both False — failing establishes is not refuting', () => {
    expect(values(one('Indeterminate'))).toEqual(['False', 'False']);
  });

  it('absent assertion: both Unknown{Missing, FieldAbsent:assertion}, never False', () => {
    const r = one(undefined);
    if (r.outcome !== 'Evaluated') throw new Error('not evaluated');
    expect(r.establishes.result).toEqual(MISSING);
    expect(r.refutes.result).toEqual(MISSING);
    expect(r.establishes.trace[0]).toEqual({ form: 'field', source: `${EST}/eq/0`, path: 'c.assertion', read: { status: 'Absent' } });
    expect(r.establishes.trace[2]).toEqual({ form: 'eq', source: EST, result: MISSING });
  });

  it.each([
    ['null', null],
    ['a number', 7],
    ['a boolean', true],
    ['an object', { value: 'Affirmed' }],
    ['an array', ['Affirmed']],
    ['an undeclared code', 'Confirmed'],
    ['a differently cased code', 'affirmed'],
    ['a padded code', 'Affirmed '],
    ['an empty string', ''],
  ])('%s: both Unknown{Invalid, FieldMalformed:assertion}, the value shown verbatim', (_n, assertion) => {
    const r = one(assertion as JsonValue);
    if (r.outcome !== 'Evaluated') throw new Error('not evaluated');
    expect(r.establishes.result).toEqual(INVALID);
    expect(r.refutes.result).toEqual(INVALID);
    expect(r.refutes.trace[0]).toEqual({ form: 'field', source: `${REF}/eq/0`, path: 'c.assertion', read: { status: 'Malformed', value: assertion } });
  });

  it('each criterion reads its own compiled literal: swapped criteria swap the values', () => {
    const swapped = compiled(program(eq('assertion', 'AssertionValue.Denied'), eq('assertion', 'AssertionValue.Affirmed')));
    const s4 = sel([rev('s1', 'r1', '1', { assertion: 'Affirmed' })], [], swapped);
    expect(values(run(s4, first(s4, 's1/r1'), swapped))).toEqual(['False', 'True']);
  });

  it('establishes and refutes are independent: an Indeterminate criterion is True only for Indeterminate', () => {
    const pkg = compiled(program(eq('assertion', 'AssertionValue.Indeterminate'), eq('assertion', 'AssertionValue.Denied')));
    const s4 = sel([rev('s1', 'r1', '1', { assertion: 'Indeterminate' }), rev('s1', 'r2', '1', { assertion: 'Affirmed' })], [], pkg);
    expect(values(run(s4, first(s4, 's1/r1'), pkg))).toEqual(['True', 'False']);
    expect(values(run(s4, first(s4, 's1/r2'), pkg))).toEqual(['False', 'False']);
  });

  it('all/any/not and call never reach S5: the compiler rejects them in criterion position (criterion holes are preview-only)', () => {
    const affirmed = eq('assertion', 'AssertionValue.Affirmed');
    for (const establishes of [{ all: [affirmed] }, { any: [affirmed] }, { not: affirmed }, { all: [] }]) {
      const r = experimentalCompile(program(establishes) as JsonValue);
      expect(r.outcome).toBe('CompileFailure');
      expect(r.diagnostics.map((d) => [d.code, d.location])).toEqual([['UNSUPPORTED_CONSTRUCT', EST]]);
    }
  });
});

describe('S5 criteria: exact evidence of the possibility', () => {
  it('digest-qualified variants are each evaluated on their own payload', () => {
    const recs = [rev('s1', 'r1', '1', { assertion: 'Affirmed' }), rev('s1', 'r1', '1', { assertion: 'Denied', provenance: { acquisition: 'a1' } })];
    const s4 = sel(recs);
    // Expected per digest from S1's own canonical payloads, not from the evaluator.
    const expected = new Map(s1Of(recs).keys[0]!.revisions[0]!.variants.map((v) => [v.digest, JSON.parse(v.canonicalPayload).assertion === 'Affirmed' ? ['True', 'False'] : ['False', 'True']]));
    const ps = key(s4, 's1/r1').possibilities;
    expect(ps).toHaveLength(2);
    for (const p of ps) {
      if (p.kind !== 'node') throw new Error('marker');
      const r = run(s4, p);
      expect(r).toMatchObject({ node: { digest: p.node.digest }, disposition: { disposition: 'NotSelected', blockers: ['HistoryUnresolved'] } });
      expect(values(r)).toEqual(expected.get(p.node.digest!));
    }
  });

  it('an authorized correction: the current revision’s payload is evaluated, not the superseded one', () => {
    const s4 = sel([rev('s1', 'r1', '1', { assertion: 'Denied' }), rev('s1', 'r1', '2', { assertion: 'Affirmed', supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    const r = run(s4, first(s4, 's1/r1'));
    expect(r).toMatchObject({ node: { revision: { revision: '2' } } });
    expect(values(r)).toEqual(['True', 'False']);
  });

  it('two snapshots with identical record IDs, interleaved: each result evaluates its own assertion', () => {
    const s4A = sel([rev('s1', 'r1', '1', { assertion: 'Affirmed' })]);
    const s4D = sel([rev('s1', 'r1', '1', { assertion: 'Denied' })]);
    expect(s4D).toEqual(s4A); // selection alone cannot tell them apart
    expect(values(run(s4A, first(s4A, 's1/r1')))).toEqual(['True', 'False']);
    expect(values(run(s4D, first(s4D, 's1/r1')))).toEqual(['False', 'True']);
    expect(values(run(s4A, first(s4A, 's1/r1')))).toEqual(['True', 'False']);
  });

  it('unresolved history: alternatives are evaluated, and nothing is selected or changed', () => {
    const s4 = sel([rev('s1', 'r1', '1', { assertion: 'Affirmed' }), rev('s1', 'r1', '2', { assertion: undefined, supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]);
    const before = JSON.stringify(s4);
    const [p1, p2] = key(s4, 's1/r1').possibilities;
    expect(values(run(s4, p1!))).toEqual(['True', 'False']);
    const r2 = run(s4, p2!);
    expect(r2).toMatchObject({ outcome: 'Evaluated', establishes: { result: MISSING }, refutes: { result: MISSING } });
    expect(JSON.stringify(s4)).toBe(before);
    expect(s4.selected).toEqual([]);
    expect(key(s4, 's1/r1').status).toBe('Unresolved');
  });

  it('unresolved admissibility or candidacy alone: evaluated, disposition carried unchanged', () => {
    const s4 = sel([
      rev('s1', 'r1', '1', { encounter: undefined, assertion: 'Affirmed' }),
      rev('s1', 'r2', '1', { concept: { system: 'other-cs', code: 'z' }, assertion: 'Denied' }),
    ]);
    const a = run(s4, first(s4, 's1/r1'));
    expect(a).toMatchObject({ disposition: { disposition: 'NotSelected', blockers: ['AdmissibilityUnresolved'] } });
    expect(values(a)).toEqual(['True', 'False']);
    const c = run(s4, first(s4, 's1/r2'));
    expect(c).toMatchObject({ disposition: { disposition: 'NotSelected', blockers: ['CandidacyUnresolved'] } });
    expect(values(c)).toEqual(['False', 'True']);
  });
});

describe('S5 criteria: ineligible possibilities are NotEvaluated, never False or Unknown', () => {
  const notEvaluated = (r: CriteriaResult, reason: string) => {
    expect(r).toMatchObject({ outcome: 'NotEvaluated', reason });
    expect(r).not.toHaveProperty('establishes');
    expect(r).not.toHaveProperty('refutes');
  };

  it('a definitely inadmissible revision, also with unresolved candidacy', () => {
    const s4 = sel([
      rev('s1', 'r1', '1', { encounter: 'N0', assertion: 'Affirmed' }),
      rev('s1', 'r2', '1', { encounter: 'N0', concept: { system: 'other-cs', code: 'z' }, assertion: 'Denied' }),
    ]);
    notEvaluated(run(s4, first(s4, 's1/r1')), 'Inadmissible');
    expect(first(s4, 's1/r2')).toMatchObject({ selection: { blockers: ['CandidacyUnresolved', 'Inadmissible'] } });
    notEvaluated(run(s4, first(s4, 's1/r2')), 'Inadmissible');
  });

  it('an inadmissible alternative of an unresolved-history key', () => {
    const s4 = sel([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { encounter: 'N0', supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]);
    const [p1, p2] = key(s4, 's1/r1').possibilities;
    expect(values(run(s4, p1!))).toEqual(['True', 'False']);
    notEvaluated(run(s4, p2!), 'Inadmissible');
  });

  it('out-of-domain possibilities and excluded/unknown markers', () => {
    const s4 = sel(
      [rev('s1', 'r1', '1'), rev('s1', 'r9', '2', { supersedes: sup('s1', 'r9', '1'), author: AMEND }), rev('s1', 'r8', '1', { concept: { system: 'demo-cs', code: 'item-y' } })],
      [{ id: 'x1', key: { source: 's1', localId: 'r1' }, target: sup('s1', 'r1', '1'), author: { actor: 'u2' }, provenance: { acquisition: 'a0', sourceRecordRef: 's1:x1' } }],
    );
    notEvaluated(run(s4, first(s4, 's1/r8')), 'OutOfDomain');
    const markers = s4.keys.flatMap((k) => k.possibilities.filter((p) => p.kind !== 'node'));
    expect(markers.map((m) => run(s4, m)).map((r) => (r.outcome === 'NotEvaluated' ? r.reason : r.outcome)).sort()).toEqual(['ExcludedMarker', 'UnknownMarker']);
  });
});

describe('S5 criteria: input boundary', () => {
  const s4 = sel([rev('s1', 'r1', '1')]);
  const p = first(s4, 's1/r1');
  const reject = (input: unknown, message: RegExp) => expect(() => experimentalEvaluateCriteria(input as never)).toThrow(message);

  it('accepts only a CompiledPackage the compiler produced in this process', () => {
    const preview = experimentalCompilePreview(program() as JsonValue);
    if (preview.outcome !== 'PreviewPackage') throw new Error('preview');
    expect(() => run(s4, p, preview.package as never)).toThrow(CriteriaConfigurationError);
    reject({ package: preview.package, query: 'q', s4, possibility: p }, /preview packages/);
    reject({ package: JSON.parse(JSON.stringify(PKG)), query: 'q', s4, possibility: p }, /CompiledPackage produced/);
    reject({ package: { ...PKG }, query: 'q', s4, possibility: p }, /CompiledPackage produced/);
  });

  it('the query must be an EvidenceQuery declaration of the package', () => {
    reject({ package: PKG, query: 'pv', s4, possibility: p }, /not an EvidenceQuery/);
    reject({ package: PKG, query: 'nope', s4, possibility: p }, /not an EvidenceQuery/);
  });

  it('accepts no payload, snapshot or earlier-stage input', () => {
    reject({ package: PKG, query: 'q', s4, possibility: p, payload: { assertion: 'Denied' } }, /unexpected input field\(s\) payload/);
    reject({ package: PKG, query: 'q', s4, possibility: p, snapshot: [] }, /unexpected input field\(s\) snapshot/);
    reject(null, /input must be an object/);
  });

  it('s4 must be an authentic S4 result (copies are rejected)', () => {
    reject({ package: PKG, query: 'q', s4: JSON.parse(JSON.stringify(s4)), possibility: p }, /experimentalSelectForQuery/);
    reject({ package: PKG, query: 'q', s4: { ...s4 }, possibility: p }, /experimentalSelectForQuery/);
  });

  it('the possibility must be this result’s own object: copies and identical foreign ones are rejected', () => {
    const twin = sel([rev('s1', 'r1', '1')]);
    expect(twin).toEqual(s4);
    expect(() => run(s4, first(twin, 's1/r1'))).toThrow(/not a possibility of this S4 result/);
    expect(() => run(s4, { ...p } as PossibleSelection)).toThrow(CriteriaConfigurationError);
    expect(() => run(s4, { kind: 'excluded' })).toThrow(CriteriaConfigurationError);
  });
});

describe('S5 criteria: query-to-evidence binding (contract §3.5)', () => {
  /** The same program, but the query allows no assertion kind (an explicit empty set allows none, §2.6). */
  const strictProgram = () => {
    const p = program();
    p.nodes[0].contract.admissible.assertionKind = { in: [] };
    return p;
  };
  const STRICT = compiled(strictProgram());
  /** One package with two queries: `q` (ClinicianDocumented allowed) and `q0` (none allowed). */
  const TWO = (() => {
    const p = program();
    const q0 = strictProgram().nodes[0];
    p.nodes.push({ ...q0, id: 'q0' }, { id: 'pv0', kind: 'Predicate', expr: { evidenceValue: { ref: 'q0' } } });
    return compiled(p);
  })();
  const RECS = [rev('s1', 'r1', '1', { assertion: 'Affirmed', assertionKind: 'ClinicianDocumented' })];
  const notEvaluated = { outcome: 'NotEvaluated', reason: 'Inadmissible' };

  it('the reported counterexample: a selection under permissive rules is rejected for a same-pin query that allows no kind', () => {
    const s4 = sel(RECS);
    // Everything the old check compared agrees: package ID and value-set pin.
    expect(STRICT.packageId).toBe(PKG.packageId);
    expect(s4.valueSet).toBe('demo-vs/item-x@1');
    expect(() => run(s4, first(s4, 's1/r1'), STRICT)).toThrow(CriteriaConfigurationError);
    expect(() => run(s4, first(s4, 's1/r1'), STRICT)).toThrow(/another compiled package/);
  });

  it('a bound query evaluates its own selected evidence', () => {
    const s4 = sel(RECS);
    const r = run(s4, first(s4, 's1/r1'));
    expect(r).toMatchObject({ outcome: 'Evaluated', disposition: { disposition: 'Selected' } });
    expect(values(r)).toEqual(['True', 'False']);
  });

  it('the second query, run through its own rules, excludes the record (AssertionKindNotAllowed → Inadmissible)', () => {
    const s4 = sel(RECS, [], STRICT);
    expect(key(s4, 's1/r1').status).toBe('Inadmissible');
    expect(first(s4, 's1/r1')).toMatchObject({
      admissibility: { outcome: 'Inadmissible', reasons: ['AssertionKindNotAllowed'] },
      selection: { disposition: 'NotSelected', blockers: ['Inadmissible'] },
    });
    expect(run(s4, first(s4, 's1/r1'), STRICT)).toMatchObject(notEvaluated);
  });

  it('packages with identical package IDs, even identical recompilations, cannot exchange results', () => {
    const twin = compiled(program());
    expect(twin).toEqual(PKG);
    const s4 = sel(RECS);
    expect(() => run(s4, first(s4, 's1/r1'), twin)).toThrow(/another compiled package/);
    const s4Twin = sel(RECS, [], twin);
    expect(() => run(s4Twin, first(s4Twin, 's1/r1'))).toThrow(/another compiled package/);
    expect(values(run(s4Twin, first(s4Twin, 's1/r1'), twin))).toEqual(['True', 'False']);
  });

  it('different queries of one package cannot exchange results', () => {
    const s4q = sel(RECS, [], TWO, 'q');
    const s4q0 = sel(RECS, [], TWO, 'q0');
    const evalAs = (s4: SelectionResult, query: string) => experimentalEvaluateCriteria({ package: TWO, query, s4, possibility: first(s4, 's1/r1') });
    expect(() => evalAs(s4q, 'q0')).toThrow(/selected for query "q", not "q0"/);
    expect(() => evalAs(s4q0, 'q')).toThrow(/selected for query "q0", not "q"/);
    expect(values(evalAs(s4q, 'q'))).toEqual(['True', 'False']);
    expect(evalAs(s4q0, 'q0')).toMatchObject(notEvaluated);
  });

  it('caller-supplied rules, expansions, envelopes, authority or stage results are rejected', () => {
    const base = { package: PKG, query: 'q', subject: 'P1', revisions: RECS, retractions: [], contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } };
    const overrides: Record<string, unknown> = {
      valueSet: PIN,
      expansion: VS,
      admissible: { ...ADM, assertionKind: { in: [] } },
      rule: SAME_ENCOUNTER_RULE,
      envelope: ENV,
      sources: ['s1', 's9'],
      recordType: ENV.recordType,
      authorityRule: DEMO_AUTHORITY_RULE,
      s1: s1Of(RECS),
      s3: s3Of(s1Of(RECS)),
    };
    for (const [field, value] of Object.entries(overrides)) {
      expect(() => experimentalSelectForQuery({ ...base, [field]: value } as never)).toThrow(QuerySelectionConfigurationError);
      expect(() => experimentalSelectForQuery({ ...base, [field]: value } as never)).toThrow(new RegExp(`unexpected input field\\(s\\) ${field};`));
    }
  });

  it('S1 is built from the query: records outside its sources or for another subject acquire no binding', () => {
    // Source s9 is not among the query's sources; P2 is not the subject: S1 leaves both outside the envelope.
    const s4 = sel([rev('s9', 'r1', '1'), rev('s1', 'r2', '1', { subject: 'P2' })]);
    expect(s4.keys).toEqual([]);
    // An S1 result resolved under another envelope cannot be supplied at all (previous test), and
    // the authentic S4 built from it through the standalone stages is unbound:
    const foreign = experimentalResolveRevisionHistory({ envelope: { ...ENV, sources: ['s9'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: [rev('s9', 'r1', '1')], retractions: [] });
    const unbound = experimentalSelect({ s3: s3Of(foreign) });
    expect(key(unbound, 's9/r1').status).toBe('Selected');
    expect(() => run(unbound, first(unbound, 's9/r1'))).toThrow(/not bound to a query/);
  });

  it('interleaved evaluations keep both their query ownership and their exact snapshot payloads', () => {
    const swapped = compiled(program(eq('assertion', 'AssertionValue.Denied'), eq('assertion', 'AssertionValue.Affirmed')));
    const s4A = sel([rev('s1', 'r1', '1', { assertion: 'Affirmed' })]);
    const s4D = sel([rev('s1', 'r1', '1', { assertion: 'Denied' })], [], swapped);
    expect(s4D).toEqual(s4A); // identical IDs and selection outcomes
    const pA = first(s4A, 's1/r1');
    const pD = first(s4D, 's1/r1');
    expect(values(run(s4A, pA))).toEqual(['True', 'False']); // Affirmed under establishes=Affirmed
    expect(values(run(s4D, pD, swapped))).toEqual(['True', 'False']); // Denied under establishes=Denied
    expect(() => run(s4A, pA, swapped)).toThrow(/another compiled package/);
    expect(() => run(s4D, pD)).toThrow(/another compiled package/);
    expect(values(run(s4A, pA))).toEqual(['True', 'False']);
    const d = run(s4D, pD, swapped);
    if (d.outcome !== 'Evaluated') throw new Error('not evaluated');
    expect(d.establishes.trace[0]).toMatchObject({ read: { status: 'Present', value: 'Denied' } });
  });

  it('copies, fabrications and unbound standalone results are rejected', () => {
    const s4 = sel(RECS);
    const p = first(s4, 's1/r1');
    const standalone = experimentalSelect({ s3: s3Of(s1Of(RECS)) });
    expect(standalone).toEqual(s4);
    expect(() => run(standalone, first(standalone, 's1/r1'))).toThrow(/not bound to a query/);
    expect(() => run(JSON.parse(JSON.stringify(s4)), p)).toThrow(/experimentalSelectForQuery/);
    expect(() => run({ ...s4 }, p)).toThrow(/experimentalSelectForQuery/);
    expect(() => run(s4, { ...p } as PossibleSelection)).toThrow(/not a possibility of this S4 result/);
  });

  it('the bound entry point accepts only an authentic package and an EvidenceQuery ID', () => {
    const preview = experimentalCompilePreview(program() as JsonValue);
    if (preview.outcome !== 'PreviewPackage') throw new Error('preview');
    const call = (pkg: unknown, query: string) => () =>
      experimentalSelectForQuery({ package: pkg as CompiledPackage, query, subject: 'P1', revisions: RECS, retractions: [], contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } });
    expect(call(preview.package, 'q')).toThrow(/preview packages/);
    expect(call(JSON.parse(JSON.stringify(PKG)), 'q')).toThrow(/CompiledPackage produced/);
    expect(call(PKG, 'pv')).toThrow(/not an EvidenceQuery/);
    expect(call(PKG, 'q')).not.toThrow();
  });
});

describe('S5 criteria: immutability and determinism', () => {
  it('output is detached and deep-frozen; the S4 result is unchanged', () => {
    const s4 = sel([rev('s1', 'r1', '1')]);
    const p = first(s4, 's1/r1');
    const before = JSON.stringify(s4);
    const r = run(s4, p);
    expect(JSON.stringify(s4)).toBe(before);
    if (r.outcome !== 'Evaluated' || p.kind !== 'node') throw new Error('not evaluated');
    expect(r.node).not.toBe(p.node);
    expect(r.disposition).not.toBe(p.selection);
    const frozen = (v: unknown): boolean => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(frozen));
    expect(frozen(r)).toBe(true);
  });

  it('repeated evaluation gives equal results with the same trace order', () => {
    const s4 = sel([rev('s1', 'r1', '1', { assertion: 'Denied' })]);
    const a = run(s4, first(s4, 's1/r1'));
    const b = run(s4, first(s4, 's1/r1'));
    expect(b).toEqual(a);
    expect(a).not.toBe(b);
    if (a.outcome !== 'Evaluated') throw new Error('not evaluated');
    expect(a.refutes.trace.map((s) => s.form)).toEqual(['field', 'enum', 'eq']);
  });
});
