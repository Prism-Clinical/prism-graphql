/**
 * EXPERIMENTAL, NONCLINICAL. Key-level possible classes (evidence-query contract §4.2 step B, §3.7).
 * Every expected set and basis is written from the §3.7 contribution table, never by calling the
 * implementation. Materiality, base causes and evidence results (S6) are not asserted.
 */
import {
  CriteriaConfigurationError,
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCheckAdmissibility,
  experimentalClassifyRecord,
  experimentalCompile,
  experimentalPossibleClasses,
  experimentalResolveRevisionHistory,
  experimentalSelect,
  experimentalSelectForQuery,
  type CompiledPackage,
  type JsonValue,
  type KeySelection,
  type PossibleClassesResult,
  type SelectionResult,
} from '../index';

const RT = 'demo-model/DemoAssessment@0.1';
const PIN = 'demo-vs/item-x@1';
const EXP = [{ system: 'demo-cs', code: 'item-x' }];
const ADM = { encounter: SAME_ENCOUNTER_RULE, episode: SAME_EPISODE_RULE, assertionKind: { in: ['ClinicianDocumented'] } };
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
function compiled(id = 'test.s5p'): CompiledPackage {
  const eq = (v: string) => ({ eq: [{ field: ['c', 'assertion'] }, { enum: `AssertionValue.${v}` }] });
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
          admissible: ADM,
          policy: 'explicit-assertion-v0',
          establishes: eq('Affirmed'),
          refutes: eq('Denied'),
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

type Over = Record<string, JsonValue | undefined>;
function rev(localId: string, revision: string, over: Over = {}): Record<string, JsonValue> {
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
const sup = (localId: string, revision: string) => ({ source: 's1', localId, revision });
/** An unauthorized correction: history stays unresolved between @1 and @2. */
const unauthorized = (localId: string, over: Over = {}) => rev(localId, '2', { supersedes: sup(localId, '1'), author: { actor: 'u2' }, ...over });
const retraction = (id: string, localId: string, author: JsonValue) => ({ id, key: { source: 's1', localId }, target: sup(localId, '1'), author, provenance: { acquisition: 'a0', sourceRecordRef: `s1:${id}` } });

const sel = (revisions: JsonValue[], retractions: JsonValue[] = [], pkg = PKG): SelectionResult =>
  experimentalSelectForQuery({ package: pkg, query: 'q', subject: 'P1', revisions, retractions, contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } });
const keyOf = (s4: SelectionResult, k: string): KeySelection => {
  const found = s4.keys.find((x) => `${x.key.source}/${x.key.localId}` === k);
  if (!found) throw new Error(`key ${k} missing`);
  return found;
};
const run = (s4: SelectionResult, k: string, pkg = PKG) => experimentalPossibleClasses({ package: pkg, query: 'q', s4, key: keyOf(s4, k) });
const pc = (revisions: JsonValue[], k = 's1/r1', retractions: JsonValue[] = []) => run(sel(revisions, retractions), k);
/** [classes] and, per possibility, its [class, basis] pairs. */
const brief = (r: PossibleClassesResult) => ({ classes: r.possibleClasses, per: r.possibilities.map((p) => p.contributes.map((c) => `${c.class}:${c.basis}`)) });
const ALL_ASSERTION = ['Supporting:Unclassified', 'Refuting:Unclassified', 'NonInformative:Unclassified'];

describe('possible classes: one definite record', () => {
  it.each([
    ['Affirmed', 'Supporting'],
    ['Denied', 'Refuting'],
    ['Indeterminate', 'NonInformative'],
  ])('a selected %s record contributes only %s; the key stays Selected', (assertion, cls) => {
    const r = pc([rev('r1', '1', { assertion })]);
    expect(brief(r)).toEqual({ classes: [cls], per: [[`${cls}:Classified`]] });
    expect(r).toMatchObject({ status: 'Selected', s1Status: 'Current', unresolvedBy: [], key: { source: 's1', localId: 'r1' } });
  });

  it.each([
    ['absent', undefined, 'Missing'],
    ['malformed', 'affirmed', 'Invalid'],
  ] as const)('an %s assertion is Unclassified: every assertion class, never excluded (EA-004)', (_n, assertion, cause) => {
    const r = pc([rev('r1', '1', { assertion })]);
    expect(brief(r)).toEqual({ classes: ['Supporting', 'Refuting', 'NonInformative'], per: [ALL_ASSERTION] });
    // The record keeps its intermediate class and the criterion findings that explain it.
    expect(r.possibilities[0]!.record).toMatchObject({ classification: { class: 'Unclassified', causes: [cause] }, establishes: { result: { value: 'Unknown' } } });
  });
});

describe('possible classes: unresolved history uses the represented possibilities only', () => {
  it('Affirmed and Denied alternatives: {Supporting, Refuting}, no invented excluded', () => {
    const r = pc([rev('r1', '1', { assertion: 'Denied' }), unauthorized('r1')]);
    expect(brief(r)).toEqual({ classes: ['Supporting', 'Refuting'], per: [['Refuting:Classified'], ['Supporting:Classified']] });
    expect(r).toMatchObject({ status: 'Unresolved', unresolvedBy: ['HistoryUnresolved'] });
  });

  it('two alternatives with the same class: deduplicated, both still explained, history not resolved', () => {
    const s4 = sel([rev('r1', '1'), unauthorized('r1')]);
    const r = run(s4, 's1/r1');
    expect(brief(r)).toEqual({ classes: ['Supporting'], per: [['Supporting:Classified'], ['Supporting:Classified']] });
    // A singleton set is not an established result: nothing is selected or made current.
    expect(r).toMatchObject({ status: 'Unresolved', unresolvedBy: ['HistoryUnresolved'] });
    expect(r).not.toHaveProperty('selected');
    expect(s4.selected).toEqual([]);
    expect(r.possibilities.map((p) => p.record.outcome === 'Evaluated' && p.record.disposition)).toEqual([
      { disposition: 'NotSelected', blockers: ['HistoryUnresolved'] },
      { disposition: 'NotSelected', blockers: ['HistoryUnresolved'] },
    ]);
  });

  it('digest-qualified variants keep their own classes, payloads and digests', () => {
    const recs = [rev('r1', '1', { assertion: 'Affirmed' }), rev('r1', '1', { assertion: 'Denied', provenance: { acquisition: 'a1' } })];
    const r = pc(recs);
    expect(r.possibleClasses).toEqual(['Supporting', 'Refuting']);
    const s1 = experimentalResolveRevisionHistory({ envelope: { recordType: RT, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: recs, retractions: [] });
    const byDigest = new Map(s1.keys[0]!.revisions[0]!.variants.map((v) => [v.digest, JSON.parse(v.canonicalPayload).assertion === 'Affirmed' ? 'Supporting' : 'Refuting']));
    expect(r.possibilities).toHaveLength(2);
    for (const p of r.possibilities) {
      if (p.possibility.kind !== 'node') throw new Error('marker');
      const digest = p.possibility.node.digest!;
      expect(p.contributes).toEqual([{ class: byDigest.get(digest), basis: 'Classified' }]);
      expect(p.record).toMatchObject({ node: { digest } });
    }
  });

  it('an admissible alternative beside an inadmissible variant: {Supporting, excluded} (case 104)', () => {
    const r = pc([rev('r1', '1'), rev('r1', '1', { encounter: 'N0' })]);
    expect(r.possibleClasses).toEqual(['Supporting', 'excluded']);
    expect(r.possibilities.flatMap((p) => p.contributes.map((c) => `${c.class}:${c.basis}`)).sort()).toEqual(['Supporting:Classified', 'excluded:Inadmissible']);
  });

  it('every alternative inadmissible or out of domain: {excluded}, each traced to its own reason', () => {
    const r = pc([rev('r1', '1', { encounter: 'N0' }), unauthorized('r1', { concept: { system: 'demo-cs', code: 'item-y' } })]);
    expect(brief(r)).toEqual({ classes: ['excluded'], per: [['excluded:Inadmissible'], ['excluded:OutOfDomain']] });
    expect(r.possibilities.map((p) => p.record.outcome === 'NotEvaluated' && p.record.reason)).toEqual(['Inadmissible', 'OutOfDomain']);
  });
});

describe('possible classes: eligibility uncertainty versus assertion uncertainty', () => {
  it('unresolved candidacy beside a definite class adds excluded, traced to CandidacyUnresolved', () => {
    const r = pc([rev('r1', '1', { concept: { system: 'other-cs', code: 'z' } })]);
    expect(brief(r)).toEqual({ classes: ['Supporting', 'excluded'], per: [['Supporting:Classified', 'excluded:CandidacyUnresolved']] });
    expect(r.possibilities[0]!.possibility).toMatchObject({ candidacy: 'Unresolved', s2Findings: [{ cause: 'Unavailable' }] });
  });

  it('unresolved admissibility beside a definite class adds excluded, traced to AdmissibilityUnresolved (EA-010)', () => {
    const r = pc([rev('r1', '1', { assertion: 'Denied', encounter: undefined })]);
    expect(brief(r)).toEqual({ classes: ['Refuting', 'excluded'], per: [['Refuting:Classified', 'excluded:AdmissibilityUnresolved']] });
    expect(r.possibilities[0]!.possibility).toMatchObject({ admissibility: { outcome: 'UnresolvedAdmissibility', causes: ['Missing'] } });
  });

  it('both eligibility uncertainties: one excluded class, two bases', () => {
    const r = pc([rev('r1', '1', { encounter: undefined, concept: { system: 'other-cs', code: 'z' } })]);
    expect(brief(r)).toEqual({ classes: ['Supporting', 'excluded'], per: [['Supporting:Classified', 'excluded:AdmissibilityUnresolved', 'excluded:CandidacyUnresolved']] });
  });

  it('Unclassified with unresolved admissibility: every assertion class and excluded', () => {
    const r = pc([rev('r1', '1', { assertion: undefined, encounter: undefined })]);
    expect(brief(r)).toEqual({ classes: ['Supporting', 'Refuting', 'NonInformative', 'excluded'], per: [[...ALL_ASSERTION, 'excluded:AdmissibilityUnresolved']] });
  });

  it('unresolved candidacy beside a definite mismatch: only {excluded} (§2.8), both blockers kept', () => {
    const r = pc([rev('r1', '1', { encounter: 'N0', concept: { system: 'other-cs', code: 'z' } })]);
    expect(brief(r)).toEqual({ classes: ['excluded'], per: [['excluded:Inadmissible']] });
    expect(r.possibilities[0]!.possibility).toMatchObject({ selection: { blockers: ['CandidacyUnresolved', 'Inadmissible'] } });
    expect(r).toMatchObject({ status: 'Unresolved', unresolvedBy: ['CandidacyUnresolved'] });
  });

  it('a definitely inadmissible or out-of-domain current revision: {excluded}', () => {
    expect(brief(pc([rev('r1', '1', { encounter: 'N0' })]))).toEqual({ classes: ['excluded'], per: [['excluded:Inadmissible']] });
    expect(brief(pc([rev('r1', '1', { concept: { system: 'demo-cs', code: 'item-y' } })]))).toEqual({ classes: ['excluded'], per: [['excluded:OutOfDomain']] });
  });
});

describe('possible classes: markers and keys without possibilities', () => {
  it('an excluded marker contributes excluded; the represented revision its own class (EA-085)', () => {
    const r = pc([rev('r1', '1')], 's1/r1', [retraction('x1', 'r1', { actor: 'u2' })]);
    expect(brief(r)).toEqual({ classes: ['Supporting', 'excluded'], per: [['Supporting:Classified'], ['excluded:ExcludedMarker']] });
    expect(r.possibilities[1]!.record).toMatchObject({ outcome: 'NotEvaluated', reason: 'ExcludedMarker' });
  });

  it('an unknown marker (any content) contributes every class, including excluded', () => {
    const r = pc([rev('r1', '2', { assertion: 'Denied', supersedes: sup('r1', '1'), author: AMEND })]);
    expect(brief(r)).toEqual({
      classes: ['Supporting', 'Refuting', 'NonInformative', 'excluded'],
      per: [['Refuting:Classified'], ['Supporting:UnknownMarker', 'Refuting:UnknownMarker', 'NonInformative:UnknownMarker', 'excluded:UnknownMarker']],
    });
  });

  it('Retracted and NoRecord keys contribute nothing', () => {
    const s4 = sel(
      [rev('r1', '1'), rev('r2', '1'), { ...rev('r2', '2', { supersedes: sup('r2', '1'), author: AMEND }), key: { source: 's2', localId: 'r2' } }],
      [retraction('x1', 'r1', AMEND)],
    );
    expect(run(s4, 's1/r1')).toMatchObject({ status: 'Retracted', s1Status: 'Retracted', possibleClasses: [], possibilities: [] });
    expect(run(s4, 's2/r2')).toMatchObject({ status: 'NoRecord', s1Status: 'NoRecord', possibleClasses: [], possibilities: [] });
  });
});

describe('possible classes: determinism and identity', () => {
  it('input order does not matter', () => {
    const recs = [rev('r1', '1', { assertion: 'Denied' }), unauthorized('r1'), rev('r1', '1', { assertion: 'Denied', encounter: 'N0' }), rev('r2', '1')];
    const rets = [retraction('x1', 'r1', { actor: 'u3' })];
    const a = pc(recs, 's1/r1', rets);
    const b = pc([...recs].reverse(), 's1/r1', rets);
    expect(b).toEqual(a);
    expect(a.possibleClasses).toEqual(['Supporting', 'Refuting', 'excluded']);
  });

  it('two snapshots with identical key IDs, interleaved, keep their own contributions', () => {
    const a = sel([rev('r1', '1', { assertion: 'Affirmed' })]);
    const d = sel([rev('r1', '1', { assertion: 'Denied' })]);
    expect(d).toEqual(a);
    expect(run(a, 's1/r1').possibleClasses).toEqual(['Supporting']);
    expect(run(d, 's1/r1').possibleClasses).toEqual(['Refuting']);
    expect(run(a, 's1/r1').possibleClasses).toEqual(['Supporting']);
  });

  it('output is detached and deep-frozen, attribution is complete, and the S4 result is unchanged', () => {
    const s4 = sel([rev('r1', '1', { assertion: undefined, encounter: undefined }), unauthorized('r1', { assertion: 'Denied' })]);
    const before = JSON.stringify(s4);
    const r = run(s4, 's1/r1');
    expect(JSON.stringify(s4)).toBe(before);
    const frozen = (v: unknown): boolean => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(frozen));
    expect(frozen(r)).toBe(true);
    const key = keyOf(s4, 's1/r1');
    expect(r.possibilities).toHaveLength(key.possibilities.length);
    key.possibilities.forEach((p, i) => {
      const entry = r.possibilities[i]!;
      expect(entry.possibility).toEqual(p); // S2/S3 findings and disposition, unchanged
      expect(entry.possibility).not.toBe(p);
      expect(entry.record).toEqual(experimentalClassifyRecord({ package: PKG, query: 'q', s4, possibility: p })); // criteria, traces, findings
      expect(entry.contributes.length).toBeGreaterThan(0);
    });
    // S1, S2–S3 and S5 causes stay apart: key-level S1 history, possibility-level admissibility, record-level criteria.
    expect(r).toMatchObject({ unresolvedBy: ['HistoryUnresolved'], inheritedS1Causes: ['Missing'], inheritedS1Defects: [{ reason: 'CorrectionAuthorityMissing' }] });
    expect(r.possibilities[0]).toMatchObject({ possibility: { admissibility: { causes: ['Missing'] } }, record: { classification: { causes: ['Missing'] } } });
    expect(run(s4, 's1/r1')).toEqual(r);
  });
});

describe('possible classes: ownership boundary', () => {
  const s4 = sel([rev('r1', '1'), rev('r2', '1'), rev('r3', '1', { encounter: 'N0' })], [retraction('x1', 'r2', AMEND)]);
  const call = (input: Record<string, unknown>) => () => experimentalPossibleClasses({ package: PKG, query: 'q', s4, key: keyOf(s4, 's1/r1'), ...input } as never);

  it.each([
    ['a key with a possibility', 's1/r1'],
    ['an empty (Retracted) key', 's1/r2'],
    ['an entirely excluded key', 's1/r3'],
  ])('rejects a foreign package, another query, copies and unbound selections for %s', (_n, k) => {
    const key = keyOf(s4, k);
    expect(call({ key, package: compiled() })).toThrow(/another compiled package/);
    expect(call({ key, query: 'pv' })).toThrow(/not an EvidenceQuery/);
    expect(call({ key, s4: { ...s4 } })).toThrow(CriteriaConfigurationError);
    const twin = sel([rev('r1', '1'), rev('r2', '1'), rev('r3', '1', { encounter: 'N0' })], [retraction('x1', 'r2', AMEND)]);
    expect(twin).toEqual(s4);
    expect(call({ key: keyOf(twin, k) })).toThrow(/not a key of this S4 result/);
    expect(call({ key: { ...key } })).toThrow(/not a key of this S4 result/);
    const s1 = experimentalResolveRevisionHistory({ envelope: { recordType: RT, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: [rev('r1', '1'), rev('r2', '1'), rev('r3', '1', { encounter: 'N0' })], retractions: [retraction('x1', 'r2', AMEND)] });
    const unbound = experimentalSelect({ s3: experimentalCheckAdmissibility({ s1, valueSet: PIN, expansion: { id: PIN, expansion: EXP, coveredSystems: ['demo-cs'] }, admissible: ADM, contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } }) });
    expect(call({ s4: unbound, key: keyOf(unbound, k) })).toThrow(/not bound to a query/);
  });

  it('accepts no caller-supplied classes, classifications, criteria, possibilities or evidence', () => {
    for (const extra of [{ possibleClasses: ['Refuting'] }, { classifications: [] }, { criteria: {} }, { possibility: keyOf(s4, 's1/r1').possibilities[0] }, { payload: {} }, { s3: {} }]) {
      expect(call(extra)).toThrow(/unexpected input field/);
    }
    expect(call({})).not.toThrow();
  });
});
