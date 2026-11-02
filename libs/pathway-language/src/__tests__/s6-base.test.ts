/**
 * EXPERIMENTAL, NONCLINICAL. S6 step A base result (evidence-query contract §4.2 step A, "Step A
 * boundary"). Every expected value is written from the contract's five rules and its rule 5 decision
 * table, never by calling the implementation. Materiality (step B), final causes (step C), the
 * evidence result and Needs do not exist here.
 */
import {
  BaseResultConfigurationError,
  DEMO_AUTHORITY_RULE,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalBaseResult,
  experimentalCheckAdmissibility,
  experimentalCompilePreview,
  experimentalResolveRevisionHistory,
  experimentalSelect,
  experimentalSelectForQuery,
  type BaseResult,
  type EvaluationSnapshot,
  type JsonValue,
} from '../index';
import {
  AMEND,
  COMPLETE,
  INADMISSIBLE,
  NONINF,
  OTHER_CS,
  OUT,
  PIN,
  PKG,
  REFUTING,
  SUPPORTING,
  T,
  UNCLASSIFIED,
  compiled,
  fail,
  history,
  program,
  retract,
  rev,
  sel,
  show,
  snap,
  sup,
  type J,
} from './support/s6-records';

const base = (revisions: J[], retractions: J[] = [], snapshot: EvaluationSnapshot = snap()): BaseResult => experimentalBaseResult({ package: PKG, query: 'q', s4: sel(revisions, retractions, snapshot) });
const role = (r: BaseResult, key: string) => r.keys.find((k) => `${k.key.source}/${k.key.localId}` === key)!;
/** The step A facts the contract states, in display form. */
const facts = (r: BaseResult) => ({
  rule: r.rule,
  base: r.base,
  S: r.supporting.map(show),
  R: r.refuting.map(show),
  baseCauses: r.baseCauses.map((c) => c.cause),
  G: r.relevantGaps.map((g) => g.label),
});

describe('S6 step A: rules 1–4 (§4.2)', () => {
  it('1. supporting only, complete coverage, no relevant gap: rule 2, provisional Known(true) referencing S', () => {
    const r = base([SUPPORTING]);
    expect(facts(r)).toEqual({ rule: 2, base: { status: 'Known', value: true }, S: ['s1/r1@1'], R: [], baseCauses: [], G: [] });
    expect(r.causes).toBe('NoneForKnown');
  });

  it('2. refuting only, complete coverage, no relevant gap: rule 3, provisional Known(false) referencing R', () => {
    expect(facts(base([REFUTING]))).toEqual({ rule: 3, base: { status: 'Known', value: false }, S: [], R: ['s1/r2@1'], baseCauses: [], G: [] });
  });

  it('3. supporting and refuting together: rule 1 Conflicting with both sides, with or without a relevant gap', () => {
    const plain = base([SUPPORTING, rev('r2', { assertion: 'Denied' }, 's2')]);
    expect(facts(plain)).toEqual({ rule: 1, base: { status: 'Unresolved' }, S: ['s1/r1@1'], R: ['s2/r2@1'], baseCauses: ['Conflicting'], G: [] });
    expect(plain.baseCauses[0]).toEqual({ cause: 'Conflicting', reason: 'AssertionConflict', refs: [...plain.supporting, ...plain.refuting] });
    // Case 8: the failure is a relevant gap, but only Conflicting is a base cause (Unavailable is step C's).
    const gapped = base([SUPPORTING, rev('r2', { assertion: 'Denied' }, 's2')], [], snap([COMPLETE], [fail('f1', { sources: null })]));
    expect(facts(gapped)).toEqual({ ...facts(plain), G: ['f1'] });
    expect(gapped.causes).toBe('Conflict');
  });

  it('4. one side plus a relevant gap: rule 4, Unresolved with no base cause yet (deferred to step C)', () => {
    for (const [rec, side] of [[SUPPORTING, 'S'], [REFUTING, 'R']] as const) {
      for (const s of [snap([COMPLETE], [fail('f1', { sources: ['s2'] })]), snap([{ ...COMPLETE, sources: ['s1'] }])]) {
        const r = base([rec], [], s);
        expect(r.rule).toBe(4);
        expect(r.base).toEqual({ status: 'Unresolved' });
        expect(r[side === 'S' ? 'supporting' : 'refuting'].map(show)).toEqual([rec === SUPPORTING ? 's1/r1@1' : 's1/r2@1']);
        expect([r.baseCauses, r.causes]).toEqual([[], 'DeferredToStepC']);
        expect(r.relevantGaps.length).toBe(1);
      }
    }
  });

  it('5. a gap proven irrelevant has no effect on the base result', () => {
    const clean = base([SUPPORTING]);
    const r = base([SUPPORTING], [], snap([COMPLETE], [fail('f1', { subject: 'P2' }), fail('f2', { sources: ['s3'] })]));
    expect(facts(r)).toEqual(facts(clean));
    expect(r.irrelevantGaps.map((g) => g.label)).toEqual(['f1', 'f2']);
  });

  it('13. repeated consistent assertions keep every distinct reference; an identical duplicate row adds none (case 3)', () => {
    const r = base([SUPPORTING, rev('r6'), { ...SUPPORTING }, rev('r9', {}, 's2')]);
    expect(facts(r)).toMatchObject({ rule: 2, S: ['s1/r1@1', 's1/r6@1', 's2/r9@1'] });
    // No count or weight: three agreeing records against one refuting record is still a conflict.
    expect(base([SUPPORTING, rev('r6'), rev('r9', {}, 's2'), REFUTING]).rule).toBe(1);
  });
});

describe('S6 step A: rule 5 and its base causes', () => {
  it('6. empty evidence with complete coverage is Unresolved{Missing}, never Known(false); a gap adds no base cause', () => {
    const r = base([]);
    expect(facts(r)).toEqual({ rule: 5, base: { status: 'Unresolved' }, S: [], R: [], baseCauses: ['Missing'], G: [] });
    expect(r.baseCauses[0]).toEqual({ cause: 'Missing', reason: 'NoInDomainRecord' });
    expect(facts(base([], [], snap([], [fail('f1')])))).toEqual({ ...facts(r), G: ['cell:s1', 'cell:s2', 'f1'] });
  });

  it('7. everything retracted or corrected out of domain: Missing (cases 24, 32)', () => {
    const retracted = base([SUPPORTING], [retract('x1', 'r1')]);
    const corrected = base([rev('r8'), rev('r8', { revision: '2', supersedes: sup('r8'), concept: OUT, author: AMEND })]);
    for (const [r, key, k] of [[retracted, 's1/r1', 'Retracted'], [corrected, 's1/r8', 'OutOfDomain']] as const) {
      expect(facts(r)).toMatchObject({ rule: 5, baseCauses: ['Missing'] });
      expect(role(r, key)).toMatchObject({ role: k, inDomainSeen: false, inadmissibleSeen: false, nonInformativeSeen: false });
    }
  });

  it('8. inadmissible-only is Inadmissible; non-informative-only is InsufficientEvidence (cases 9, 6)', () => {
    const i = base([INADMISSIBLE]);
    expect(facts(i)).toMatchObject({ rule: 5, baseCauses: ['Inadmissible'] });
    expect(i.baseCauses[0]).toEqual({ cause: 'Inadmissible', reason: 'InadmissibleSeen', keys: [{ source: 's1', localId: 'r5' }] });
    const n = base([NONINF]);
    expect(facts(n)).toMatchObject({ rule: 5, baseCauses: ['InsufficientEvidence'] });
    expect(n.baseCauses[0]).toEqual({ cause: 'InsufficientEvidence', reason: 'NonInformativeSeen', keys: [{ source: 's1', localId: 'r7' }] });
  });

  it('9. rule 5 causes combine, in Stage A order; Unclassified adds none but counts as an in-domain record seen', () => {
    expect(facts(base([NONINF, INADMISSIBLE])).baseCauses).toEqual(['Inadmissible', 'InsufficientEvidence']);
    expect(facts(base([NONINF, INADMISSIBLE, UNCLASSIFIED])).baseCauses).toEqual(['Inadmissible', 'InsufficientEvidence']);
    // Only an Unclassified record: no base cause at all; its own causes come from step C (case 4).
    const u = base([UNCLASSIFIED]);
    expect(facts(u)).toMatchObject({ rule: 5, baseCauses: [] });
    expect(role(u, 's1/r3')).toMatchObject({ role: 'Unclassified', possibleClasses: ['Supporting', 'Refuting', 'NonInformative'], inDomainSeen: true, nonInformativeSeen: false });
    // Missing and Inadmissible together: an out-of-domain key does not count as seen.
    expect(facts(base([rev('r4', { concept: OUT }), INADMISSIBLE])).baseCauses).toEqual(['Inadmissible']);
  });
});

describe('S6 step A: unresolved records never enter S or R', () => {
  it('10. unresolved history and selected Unclassified records are excluded from S and R', () => {
    const h = base(history('r9', {}, { assertion: 'Denied' }));
    expect(facts(h)).toMatchObject({ rule: 5, S: [], R: [], baseCauses: [] });
    expect(role(h, 's1/r9')).toMatchObject({ role: 'UnresolvedCandidate', possibleClasses: ['Supporting', 'Refuting'], inDomainSeen: true, nonInformativeSeen: false });
    expect(facts(base([UNCLASSIFIED, SUPPORTING]))).toMatchObject({ rule: 2, S: ['s1/r1@1'], R: [] });
  });

  it('11. an unresolved record that could oppose leaves the base provisional Known: materiality is not performed (case 10)', () => {
    const r = base([SUPPORTING, rev('r4', { assertion: 'Denied', encounter: undefined })]);
    expect(facts(r)).toMatchObject({ rule: 2, base: { status: 'Known', value: true }, S: ['s1/r1@1'], R: [] });
    expect(role(r, 's1/r4')).toMatchObject({ role: 'UnresolvedCandidate', possibleClasses: ['Refuting', 'excluded'] });
    expect(r.notRun).toEqual(['StepB:Materiality', 'StepC:Causes', 'Evidence', 'Needs']);
    expect(r.keys.some((k) => 'material' in k)).toBe(false);
  });
});

describe('S6 step A: rule 5 boundary cases (decision table)', () => {
  it('unresolved candidacy alone counts as an in-domain record seen: no Missing (case 13)', () => {
    const r = base([rev('r10', { concept: OTHER_CS })]);
    expect(facts(r)).toMatchObject({ rule: 5, baseCauses: [] });
    expect(role(r, 's1/r10')).toMatchObject({ role: 'UnresolvedCandidate', candidate: true, possibleClasses: ['Supporting', 'excluded'], inDomainSeen: true });
  });

  it('unresolved candidacy beside definite inadmissibility (§2.8, r6) is an unresolved candidate: InsufficientEvidence only (review of 8de77ae)', () => {
    const r6 = rev('r6', { concept: OTHER_CS, encounter: 'N0' });
    const alone = base([r6]);
    // Potentially in domain (no Missing); not a confirmed in-domain inadmissible candidate (no
    // Inadmissible); only possible class excluded (InsufficientEvidence).
    expect(facts(alone)).toMatchObject({ rule: 5, baseCauses: ['InsufficientEvidence'] });
    expect(alone.baseCauses[0]).toEqual({ cause: 'InsufficientEvidence', reason: 'NonInformativeSeen', keys: [{ source: 's1', localId: 'r6' }] });
    // Both facts stay visible: the role names the case, the key is Unresolved by candidacy, and its possible classes are {excluded}.
    expect(role(alone, 's1/r6')).toEqual({
      key: { source: 's1', localId: 'r6' }, status: 'Unresolved', candidate: true, role: 'CandidacyUnresolvedBesideInadmissible',
      possibleClasses: ['excluded'], inDomainSeen: true, inadmissibleSeen: false, nonInformativeSeen: true,
    });
    expect(facts(base([r6, INADMISSIBLE])).baseCauses).toEqual(['Inadmissible', 'InsufficientEvidence']);
    // It cannot oppose an established base: beside a supporting record, rule 2.
    expect(facts(base([r6, SUPPORTING]))).toMatchObject({ rule: 2, S: ['s1/r1@1'], baseCauses: [] });
    expect(facts(base([r6, REFUTING]))).toMatchObject({ rule: 3, R: ['s1/r2@1'] });
  });

  it('excluded-only: an in-domain unresolved candidate is InsufficientEvidence, not Inadmissible (case 127 shape, case 104)', () => {
    const r = base(history('r9', { encounter: 'N0' }, { encounter: 'N0' }));
    expect(facts(r)).toMatchObject({ rule: 5, baseCauses: ['InsufficientEvidence'] });
    expect(role(r, 's1/r9')).toMatchObject({ role: 'UnresolvedCandidate', possibleClasses: ['excluded'], inadmissibleSeen: false });
    // With a NonInformative alternative too: {NonInformative, excluded}.
    expect(facts(base(history('r9', { assertion: 'Indeterminate' }, { encounter: 'N0' }))).baseCauses).toEqual(['InsufficientEvidence']);
    expect(facts(base([rev('r4', { assertion: 'Indeterminate', encounter: undefined })])).baseCauses).toEqual(['InsufficientEvidence']);
  });

  it('excluded-only and not a candidate (every possible current out of domain or excluded): not seen at all (§7.5, case 33)', () => {
    const oodHistory = base(history('r43', { concept: OUT }, { concept: OUT }));
    const oodRetraction = base([rev('r44', { concept: OUT })], [retract('x44', 'r44', { actor: 'u2' })]);
    for (const r of [oodHistory, oodRetraction]) {
      expect(facts(r)).toMatchObject({ rule: 5, baseCauses: ['Missing'] });
      expect(r.keys).toHaveLength(1);
      expect(r.keys[0]).toMatchObject({ status: 'Unresolved', candidate: false, role: 'UnresolvedNotCandidate', inDomainSeen: false, nonInformativeSeen: false });
    }
    expect(oodRetraction.keys[0]!.possibleClasses).toEqual(['excluded']);
    // Invariance: adding such a key leaves any base result unchanged.
    expect(facts(base([NONINF, ...history('r43', { concept: OUT }, { concept: OUT })]))).toEqual(facts(base([NONINF])));
  });

  it('an unknown marker could be in domain: the key is a candidate, so no Missing; its classes include S and R, so no InsufficientEvidence', () => {
    const r = base([rev('r11', { revision: '2', supersedes: sup('r11'), concept: OUT, author: AMEND })]);
    expect(role(r, 's1/r11')).toMatchObject({ role: 'UnresolvedCandidate', candidate: true, possibleClasses: ['Supporting', 'Refuting', 'NonInformative', 'excluded'] });
    expect(facts(r)).toMatchObject({ rule: 5, baseCauses: [] });
  });

  it('empty possible-class sets: retracted and no-record keys have none and are not seen', () => {
    const r = base([SUPPORTING], [retract('x1', 'r1')]);
    expect(role(r, 's1/r1')).toMatchObject({ role: 'Retracted', candidate: false });
    expect(role(r, 's1/r1').possibleClasses).toBeUndefined();
    expect(facts(r).baseCauses).toEqual(['Missing']);
  });
});

describe('S6 step A: determinism, S1-rejected occurrences and ownership', () => {
  it('14. input permutation and identical duplication preserve the result exactly', () => {
    const records = [SUPPORTING, rev('r6'), NONINF, rev('r4', { encounter: undefined, assertion: 'Denied' }), rev('r9', {}, 's2')];
    const failures = [fail('f1', { subject: 'P2' }), fail('f2', { sources: ['s3'] })];
    const a = base(records, [], snap([COMPLETE], failures));
    expect(base([...records].reverse(), [], snap([COMPLETE], [...failures].reverse()))).toEqual(a);
    expect(base([...records, { ...records[1] }, { ...records[0] }], [], snap([COMPLETE], failures))).toEqual(a);
    const conflict = [SUPPORTING, REFUTING, rev('r2', { assertion: 'Denied' }, 's2')];
    expect(base([...conflict].reverse())).toEqual(base(conflict));
  });

  it('15. an S1-rejected malformed occurrence beside a Current supporting revision forces rule 4, never Known', () => {
    const bad = rev('r1', { revision: '2', supersedes: sup('r1'), assertion: 'Denied', author: AMEND, provenance: { acquisition: '\uD800', sourceRecordRef: 's1:r1:2' } });
    const r = base([SUPPORTING, bad]);
    expect(role(r, 's1/r1')).toMatchObject({ status: 'Selected', role: 'Supporting' });
    expect(facts(r)).toEqual({ rule: 4, base: { status: 'Unresolved' }, S: ['s1/r1@1'], R: [], baseCauses: [], G: ['unidentified:revision#1'] });
    expect(r.relevantGaps[0]!.identity).toEqual({ kind: 'RejectedItem', origin: 'S1', occurrence: 'revision', inputIndex: 1 });
  });

  const bad = (input: unknown, pattern: RegExp) => {
    expect(() => experimentalBaseResult(input as never)).toThrow(BaseResultConfigurationError);
    expect(() => experimentalBaseResult(input as never)).toThrow(pattern);
  };

  it('16a. accepts only package, query and an S4 result bound to them with a snapshot', () => {
    const s4 = sel([SUPPORTING]);
    for (const f of ['classifications', 'possibleClasses', 'gaps', 'relevant', 'payload', 'snapshot', 's1', 'contract']) {
      bad({ package: PKG, query: 'q', s4, [f]: [] }, new RegExp(`unexpected input field\\(s\\) ${f}`));
    }
    bad(null, /input must be an object/);
    bad({ package: PKG, query: 'q', s4: sel([SUPPORTING], [], 'none') }, /without a snapshot/);
    bad({ package: PKG, query: 'q', s4: JSON.parse(JSON.stringify(s4)) }, /produced by experimentalSelectForQuery/);
    bad({ package: PKG, query: 'q', s4: { ...s4 } }, /produced by experimentalSelectForQuery/);
    bad({ package: compiled(), query: 'q', s4 }, /another compiled package/);
    bad({ package: PKG, query: 'pv', s4 }, /not an EvidenceQuery/);
    const s1 = experimentalResolveRevisionHistory({ envelope: { recordType: T, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: [], retractions: [] });
    const s3 = experimentalCheckAdmissibility({ s1, valueSet: PIN, expansion: { id: PIN, expansion: [], coveredSystems: [] }, admissible: { encounter: SAME_ENCOUNTER_RULE, episode: SAME_EPISODE_RULE, assertionKind: { in: ['ClinicianDocumented'] } }, contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } });
    bad({ package: PKG, query: 'q', s4: experimentalSelect({ s3 }) }, /not bound to a query/);
    const two = compiled({ ...program(), nodes: [...program().nodes, ...program('q2').nodes.map((n: J) => (n.id === 'pv' ? { ...n, id: 'pv2' } : n))] });
    bad({ package: two, query: 'q2', s4: sel([SUPPORTING], [], snap(), two) }, /selected for query "q", not "q2"/);
  });

  it('16b. preview packages are rejected (no preview support)', () => {
    const p = experimentalCompilePreview({ ...program(), nodes: [{ ...program().nodes[0], contract: { hole: { id: 'H', type: 'EvidenceSelectionContract<Boolean>', explains: 'x' } } }, program().nodes[1]] } as JsonValue);
    if (p.outcome !== 'PreviewPackage') throw new Error('preview');
    bad({ package: p.package, query: 'q', s4: sel([SUPPORTING]) }, /preview packages are not evaluated here/);
  });

  it('16c. interleaved evaluations with identical record IDs each read only their own selection and snapshot', () => {
    const a = sel([SUPPORTING]);
    const b = sel([rev('r1', { assertion: 'Denied' })], [], snap([], [], 'snap-9'));
    const ra = experimentalBaseResult({ package: PKG, query: 'q', s4: a });
    const rb = experimentalBaseResult({ package: PKG, query: 'q', s4: b });
    expect(facts(ra)).toMatchObject({ rule: 2, S: ['s1/r1@1'], G: [] });
    expect(facts(rb)).toMatchObject({ rule: 4, R: ['s1/r1@1'], G: ['cell:s1', 'cell:s2'] });
    expect(rb.snapshot).toBe('snap-9');
    expect(experimentalBaseResult({ package: PKG, query: 'q', s4: a })).toEqual(ra);
  });

  it('17. the output is detached and deeply immutable, and carries no evidence, materiality or Need', () => {
    const records = [rev('r1'), rev('r4', { encounter: undefined })];
    const r = base(records);
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    const before = JSON.stringify(r);
    records[0]!['assertion'] = 'Denied';
    expect(JSON.stringify(r)).toBe(before);
    expect(() => {
      (r.baseCauses as unknown[]).push({ cause: 'Missing' });
    }).toThrow();
    expect(Object.keys(r).sort()).toEqual(
      ['base', 'baseCauses', 'causes', 'experimental', 'irrelevantGaps', 'keys', 'notRun', 'packageId', 'query', 'refuting', 'relevantGaps', 'rule', 'scope', 'snapshot', 'stage', 'step', 'supporting'].sort(),
    );
    expect([r.experimental, r.stage, r.step, r.scope]).toEqual(['nonclinical-s6-base-result-v0', 'S6', 'A', 'base-result']);
  });
});
