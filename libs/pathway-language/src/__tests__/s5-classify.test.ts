/**
 * EXPERIMENTAL, NONCLINICAL. Per-record S5 classification (evidence-query contract §3.3–§3.5).
 * Every expected class is written from the §3.3 table, never by calling the classifier. Key-level
 * possible classes (§4.2 step B) are not implemented and not asserted here.
 */
import { classify } from '../s5/classify';
import {
  CriteriaConfigurationError,
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCheckAdmissibility,
  experimentalClassifyRecord,
  experimentalCompile,
  experimentalEvaluateCriteria,
  experimentalResolveRevisionHistory,
  experimentalSelect,
  experimentalSelectForQuery,
  type ClassificationResult,
  type CompiledPackage,
  type CriterionValue,
  type JsonValue,
  type PossibleSelection,
  type SelectionResult,
} from '../index';

type J = { [k: string]: any };
const RT = 'demo-model/DemoAssessment@0.1';
const PIN = 'demo-vs/item-x@1';
const EXP = [{ system: 'demo-cs', code: 'item-x' }];
const eq = (value: string) => ({ eq: [{ field: ['c', 'assertion'] }, { enum: `AssertionValue.${value}` }] });
function compiled(establishes = 'Affirmed', refutes = 'Denied', id = 'test.s5c'): CompiledPackage {
  const r = experimentalCompile({
    ppl: { languageVersion: 'ppl-1', capabilityProfileVersion: 'ppl-core-v0' },
    package: { id, state: 'Draft' },
    references: [],
    valueSets: { [PIN]: { expansion: EXP, coveredSystems: ['demo-cs'] } },
    applicability: { id: 'scope', kind: 'Predicate', expr: { all: [] } },
    nodes: [
      {
        id: 'q',
        kind: 'EvidenceQuery',
        subject: 'patient',
        output: 'Evidence<Boolean>',
        contract: {
          retrieve: { type: RT, sources: ['s1', 's2'], valueSet: PIN },
          corrections: { authority: DEMO_AUTHORITY_RULE },
          admissible: { episode: SAME_EPISODE_RULE, encounter: SAME_ENCOUNTER_RULE, assertionKind: { in: ['ClinicianDocumented'] } },
          policy: 'explicit-assertion-v0',
          establishes: eq(establishes),
          refutes: eq(refutes),
          obligations: [{ disjoint: ['establishes', 'refutes'] }],
        },
      },
      { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: 'q' } } },
    ],
  } as JsonValue);
  if (r.outcome !== 'Compiled') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
const PKG = compiled();

function rev(localId: string, revision: string, over: Record<string, JsonValue | undefined> = {}): Record<string, JsonValue> {
  const base: Record<string, JsonValue> = {
    key: { source: 's1', localId },
    revision,
    recordType: RT,
    subject: 'P1',
    episode: 'E1',
    encounter: 'N1',
    concept: { system: 'demo-cs', code: 'item-x' },
    assertion: 'Affirmed',
    assertionKind: 'ClinicianDocumented',
    author: { actor: 'u1', permissions: [] },
    provenance: { acquisition: 'a0', sourceRecordRef: `s1:${localId}:${revision}` },
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base;
}
const sel = (revisions: JsonValue[], retractions: JsonValue[] = [], pkg = PKG): SelectionResult =>
  experimentalSelectForQuery({ package: pkg, query: 'q', subject: 'P1', revisions, retractions, contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } });
const possibilities = (s4: SelectionResult, localId: string) => s4.keys.find((k) => k.key.localId === localId)!.possibilities;
const first = (s4: SelectionResult, localId: string) => possibilities(s4, localId)[0]!;
const run = (s4: SelectionResult, possibility: PossibleSelection, pkg = PKG) => experimentalClassifyRecord({ package: pkg, query: 'q', s4, possibility });
const one = (assertion: JsonValue | undefined, pkg = PKG) => {
  const s4 = sel([rev('r1', '1', { assertion })], [], pkg);
  return run(s4, first(s4, 'r1'), pkg);
};
function cls(r: ClassificationResult): unknown {
  if (r.outcome !== 'Evaluated') throw new Error(`not evaluated: ${r.reason}`);
  return r.classification;
}
const MISSING = [{ cause: 'Missing', origin: 'record', reason: 'FieldAbsent:assertion' }];
const INVALID = [{ cause: 'Invalid', origin: 'record', reason: 'FieldMalformed:assertion' }];

describe('S5 classification: the §3.3 table through the compiler (reachable rows)', () => {
  it('Affirmed → Supporting (True/False); the criteria result is kept whole', () => {
    const r = one('Affirmed');
    expect(r).toMatchObject({
      experimental: 'nonclinical-s5-classification-v0',
      stage: 'S5',
      scope: 'one-possibility-classification',
      packageId: 'test.s5c',
      query: 'q',
      key: { source: 's1', localId: 'r1' },
      outcome: 'Evaluated',
      node: { revision: { source: 's1', localId: 'r1', revision: '1' } },
      disposition: { disposition: 'Selected' },
      classification: { class: 'Supporting' },
    });
    // Exactly what the criterion evaluator returns for the same input, apart from the two tags.
    const s4 = sel([rev('r1', '1')]);
    const p = first(s4, 'r1');
    const { experimental: _e, scope: _s, classification: _c, ...rest } = run(s4, p) as J;
    const { experimental: _e2, scope: _s2, ...criteria } = experimentalEvaluateCriteria({ package: PKG, query: 'q', s4, possibility: p }) as J;
    expect(rest).toEqual(criteria);
  });

  it('Denied → Refuting (False/True)', () => expect(cls(one('Denied'))).toEqual({ class: 'Refuting' }));

  it('Indeterminate → NonInformative (False/False): failing establishes is not refuting', () => expect(cls(one('Indeterminate'))).toEqual({ class: 'NonInformative' }));

  it('absent assertion → Unclassified{Missing}, findings kept in both criteria (never False)', () => {
    const r = one(undefined);
    expect(cls(r)).toEqual({ class: 'Unclassified', causes: ['Missing'] });
    expect(r).toMatchObject({ establishes: { result: { value: 'Unknown', findings: MISSING } }, refutes: { result: { value: 'Unknown', findings: MISSING } } });
  });

  it.each([null, 3, true, {}, [], 'affirmed', 'Affirmed ', ''] as JsonValue[])('malformed assertion %j → Unclassified{Invalid}, findings kept', (assertion) => {
    const r = one(assertion);
    expect(cls(r)).toEqual({ class: 'Unclassified', causes: ['Invalid'] });
    expect(r).toMatchObject({ establishes: { result: { value: 'Unknown', findings: INVALID } }, refutes: { result: { value: 'Unknown', findings: INVALID } } });
  });

  it('swapped authored criteria swap Supporting and Refuting', () => {
    const swapped = compiled('Denied', 'Affirmed');
    expect(cls(one('Affirmed', swapped))).toEqual({ class: 'Refuting' });
    expect(cls(one('Denied', swapped))).toEqual({ class: 'Supporting' });
    expect(cls(one('Indeterminate', swapped))).toEqual({ class: 'NonInformative' });
  });

  it('classification follows the authored expressions: establishes = Indeterminate', () => {
    const pkg = compiled('Indeterminate', 'Denied');
    expect(cls(one('Indeterminate', pkg))).toEqual({ class: 'Supporting' });
    expect(cls(one('Affirmed', pkg))).toEqual({ class: 'NonInformative' });
    expect(cls(one('Denied', pkg))).toEqual({ class: 'Refuting' });
  });

  it('the compiler rejects criteria that could both be True, so True/True cannot be produced', () => {
    expect(() => compiled('Affirmed', 'Affirmed')).toThrow(/EXCLUSIVE_BRANCH_OVERLAP/);
  });
});

describe('S5 classification: the §3.3 table on its own (rows unreachable through the I1 compiler)', () => {
  const T: CriterionValue = { value: 'True' };
  const F: CriterionValue = { value: 'False' };
  const M: CriterionValue = { value: 'Unknown', findings: [{ cause: 'Missing', origin: 'record', reason: 'FieldAbsent:x' }] };
  const I: CriterionValue = { value: 'Unknown', findings: [{ cause: 'Invalid', origin: 'record', reason: 'FieldMalformed:y' }] };
  // Both criteria read c.assertion in I1, so one Unknown means both are Unknown with the same cause.
  it.each([
    ['Unknown/True', M, T, ['Missing']],
    ['Unknown/False', M, F, ['Missing']],
    ['True/Unknown', T, I, ['Invalid']],
    ['False/Unknown', F, I, ['Invalid']],
    ['Unknown/Unknown with different causes (Stage A order)', I, M, ['Missing', 'Invalid']],
  ] as const)('%s → Unclassified with the Unknown criteria’s causes', (_n, e, r, causes) => {
    expect(classify(e, r)).toEqual({ class: 'Unclassified', causes });
  });

  it('True/True is an engine invariant violation, not a class or patient conflict', () => {
    expect(() => classify(T, T)).toThrow(/^invariant: .*disjointness/);
  });
});

describe('S5 classification: identity, disposition and eligibility are preserved', () => {
  it('unresolved-history alternatives are each classified and stay NotSelected', () => {
    const s4 = sel([rev('r1', '1', { assertion: 'Denied' }), rev('r1', '2', { assertion: 'Affirmed', supersedes: { source: 's1', localId: 'r1', revision: '1' }, author: { actor: 'u2' } })]);
    const [p1, p2] = possibilities(s4, 'r1');
    const a = run(s4, p1!);
    const b = run(s4, p2!);
    expect(a).toMatchObject({ node: { revision: { revision: '1' } }, disposition: { disposition: 'NotSelected', blockers: ['HistoryUnresolved'] }, classification: { class: 'Refuting' } });
    expect(b).toMatchObject({ node: { revision: { revision: '2' } }, disposition: { disposition: 'NotSelected', blockers: ['HistoryUnresolved'] }, classification: { class: 'Supporting' } });
    // A Supporting alternative is not made current or selected.
    expect(s4.selected).toEqual([]);
    expect(s4.keys[0]!.status).toBe('Unresolved');
  });

  it('digest-qualified variants keep their own classes and traces', () => {
    const recs = [rev('r1', '1', { assertion: 'Affirmed' }), rev('r1', '1', { assertion: 'Denied', provenance: { acquisition: 'a1' } })];
    const s4 = sel(recs);
    const s1 = experimentalResolveRevisionHistory({ envelope: { recordType: RT, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: recs, retractions: [] });
    const byDigest = new Map(s1.keys[0]!.revisions[0]!.variants.map((v) => [v.digest, JSON.parse(v.canonicalPayload).assertion as string]));
    const ps = possibilities(s4, 'r1');
    expect(ps).toHaveLength(2);
    for (const p of ps) {
      if (p.kind !== 'node') throw new Error('marker');
      const assertion = byDigest.get(p.node.digest!)!;
      const r = run(s4, p);
      expect(r).toMatchObject({
        node: { digest: p.node.digest },
        classification: { class: assertion === 'Affirmed' ? 'Supporting' : 'Refuting' },
        establishes: { trace: [{ read: { status: 'Present', value: assertion } }, {}, {}] },
      });
    }
  });

  it('unresolved admissibility or candidacy: classified, disposition unchanged', () => {
    const s4 = sel([rev('r1', '1', { encounter: undefined, assertion: 'Denied' }), rev('r2', '1', { concept: { system: 'other-cs', code: 'z' } })]);
    expect(run(s4, first(s4, 'r1'))).toMatchObject({ disposition: { blockers: ['AdmissibilityUnresolved'] }, classification: { class: 'Refuting' } });
    expect(run(s4, first(s4, 'r2'))).toMatchObject({ disposition: { blockers: ['CandidacyUnresolved'] }, classification: { class: 'Supporting' } });
  });

  const notEvaluated = (r: ClassificationResult, reason: string) => {
    expect(r).toMatchObject({ outcome: 'NotEvaluated', reason, scope: 'one-possibility-classification' });
    expect(r).not.toHaveProperty('classification');
    expect(r).not.toHaveProperty('establishes');
  };

  it('inadmissible (also beside unresolved candidacy), out-of-domain and marker possibilities get no class', () => {
    const s4 = sel(
      [
        rev('r1', '1', { encounter: 'N0' }),
        rev('r2', '1', { encounter: 'N0', concept: { system: 'other-cs', code: 'z' } }),
        rev('r3', '1', { concept: { system: 'demo-cs', code: 'item-y' } }),
        rev('r4', '1'),
        // Correction of an absent target (CorrectionTargetAbsent): an `excluded` marker beside r5@2.
        rev('r5', '2', { supersedes: { source: 's1', localId: 'r5', revision: '1' }, author: { actor: 'u9', permissions: [DEMO_AMEND_PERMISSION] } }),
      ],
      [{ id: 'x1', key: { source: 's1', localId: 'r4' }, target: { source: 's1', localId: 'r4', revision: '1' }, author: { actor: 'u2' }, provenance: { acquisition: 'a0', sourceRecordRef: 's1:x1' } }],
    );
    notEvaluated(run(s4, first(s4, 'r1')), 'Inadmissible');
    notEvaluated(run(s4, first(s4, 'r2')), 'Inadmissible');
    notEvaluated(run(s4, first(s4, 'r3')), 'OutOfDomain');
    const markers = s4.keys.flatMap((k) => k.possibilities.filter((p) => p.kind !== 'node'));
    const reasons = markers.map((m) => run(s4, m)).map((r) => (r.outcome === 'NotEvaluated' ? r.reason : r.outcome));
    expect(reasons.sort()).toEqual(['ExcludedMarker', 'UnknownMarker']);
  });
});

describe('S5 classification: ownership boundary (unchanged from criterion evaluation)', () => {
  const s4 = sel([rev('r1', '1')]);
  const p = first(s4, 'r1');
  it('rejects another package with the same ID, another query, unbound and copied selections and foreign possibilities', () => {
    expect(() => run(s4, p, compiled())).toThrow(/another compiled package/);
    expect(() => experimentalClassifyRecord({ package: PKG, query: 'pv', s4, possibility: p })).toThrow(/not an EvidenceQuery/);
    const s1 = experimentalResolveRevisionHistory({ envelope: { recordType: RT, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: [rev('r1', '1')], retractions: [] });
    const unbound = experimentalSelect({
      s3: experimentalCheckAdmissibility({ s1, valueSet: PIN, expansion: { id: PIN, expansion: EXP, coveredSystems: ['demo-cs'] }, admissible: { encounter: SAME_ENCOUNTER_RULE, episode: SAME_EPISODE_RULE, assertionKind: { in: ['ClinicianDocumented'] } }, contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } }),
    });
    expect(() => run(unbound, first(unbound, 'r1'))).toThrow(/not bound to a query/);
    expect(() => run({ ...s4 }, p)).toThrow(CriteriaConfigurationError);
    const twin = sel([rev('r1', '1')]);
    expect(() => run(s4, first(twin, 'r1'))).toThrow(/not a possibility of this S4 result/);
    expect(() => run(s4, { ...p } as PossibleSelection)).toThrow(/not a possibility of this S4 result/);
  });

  it('accepts no criterion values or results from the caller', () => {
    const r = run(s4, p) as J;
    for (const extra of [{ establishes: r.establishes }, { refutes: r.refutes }, { criteria: r }, { classification: { class: 'Refuting' } }]) {
      expect(() => experimentalClassifyRecord({ package: PKG, query: 'q', s4, possibility: p, ...extra } as never)).toThrow(/unexpected input field/);
    }
  });

  it('interleaved snapshots with identical record IDs keep their own evidence', () => {
    const a = sel([rev('r1', '1', { assertion: 'Affirmed' })]);
    const d = sel([rev('r1', '1', { assertion: 'Denied' })]);
    expect(d).toEqual(a);
    expect(cls(run(a, first(a, 'r1')))).toEqual({ class: 'Supporting' });
    expect(cls(run(d, first(d, 'r1')))).toEqual({ class: 'Refuting' });
    expect(cls(run(a, first(a, 'r1')))).toEqual({ class: 'Supporting' });
  });
});

describe('S5 classification: immutability and determinism', () => {
  it('output is detached and deep-frozen; the S4 result is unchanged; repeated calls agree', () => {
    const s4 = sel([rev('r1', '1', { assertion: undefined })]);
    const p = first(s4, 'r1');
    const before = JSON.stringify(s4);
    const r = run(s4, p);
    const again = run(s4, p);
    expect(JSON.stringify(s4)).toBe(before);
    expect(again).toEqual(r);
    expect(again).not.toBe(r);
    const frozen = (v: unknown): boolean => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(frozen));
    expect(frozen(r)).toBe(true);
    if (r.outcome !== 'Evaluated' || p.kind !== 'node') throw new Error('not evaluated');
    expect(r.node).not.toBe(p.node);
    expect(Object.keys(r)).toEqual(Object.keys(again));
  });
});
