/**
 * EXPERIMENTAL, NONCLINICAL. The final `Evidence<Boolean>` of one query (evidence-query contract
 * §5.1, "Query evidence boundary"). Every expected value is written from §4.2 (status and S/R) and
 * §5.1 (candidate membership), never by calling the implementation. No decision, Needs, predicate
 * projection or program execution exist here.
 */
import {
  DEMO_AUTHORITY_RULE,
  QueryEvidenceConfigurationError,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCauseAttribution,
  experimentalCheckAdmissibility,
  experimentalCompilePreview,
  experimentalQueryEvidence,
  experimentalResolveRevisionHistory,
  experimentalSelect,
  type EvaluationSnapshot,
  type JsonValue,
  type QueryEvidenceResult,
} from '../index';
import { AMEND, COMPLETE, INADMISSIBLE, NONINF, OTHER_CS, OUT, PIN, PKG, REFUTING, SUPPORTING, T, UNCLASSIFIED, compiled, fail, history, program, retract, rev, sel, show, snap, sup, type J } from './support/s6-records';

const run = (revisions: J[], retractions: J[] = [], snapshot: EvaluationSnapshot = snap()): QueryEvidenceResult =>
  experimentalQueryEvidence({ package: PKG, query: 'q', s4: sel(revisions, retractions, snapshot) });
/** The evidence in fixture notation (display only). */
const ev = (r: QueryEvidenceResult) => {
  const e = r.evidence;
  return e.status === 'Known'
    ? { status: 'Known', value: e.value, supportingEvidenceIds: e.supportingEvidenceIds.map(show) }
    : { status: 'Unresolved', causes: e.causes, candidateEvidenceIds: e.candidateEvidenceIds.map(show) };
};
const unresolved = (causes: string[], ids: string[]) => ({ status: 'Unresolved', causes, candidateEvidenceIds: ids });

/** Encounter absent: admissibility unresolved; {Refuting, excluded}. */
const canRefute = (id: string) => rev(id, { assertion: 'Denied', encounter: undefined });
/** Encounter absent; {Supporting, excluded}. */
const canSupport = (id: string) => rev(id, { encounter: undefined });
const s1Variants = (records: J[]) =>
  experimentalResolveRevisionHistory({ envelope: { recordType: T, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: records as JsonValue[], retractions: [] }).keys[0]!.revisions[0]!.variants;

describe('final Evidence<Boolean>: Known results (§4.2 rules 2–3)', () => {
  it('1. Known(true) with one and with several distinct supporting revisions, each with its provenance', () => {
    const one = run([SUPPORTING]);
    expect(ev(one)).toEqual({ status: 'Known', value: true, supportingEvidenceIds: ['s1/r1@1'] });
    const two = run([rev('r8'), SUPPORTING]);
    expect(ev(two)).toEqual({ status: 'Known', value: true, supportingEvidenceIds: ['s1/r1@1', 's1/r8@1'] });
    if (two.evidence.status !== 'Known') throw new Error('Known');
    expect(two.evidence.provenance.map((p) => [show(p.ref), p.occurrences])).toEqual([
      ['s1/r1@1', [{ acquisition: 'a0', sourceRecordRef: 's1:r1' }]],
      ['s1/r8@1', [{ acquisition: 'a0', sourceRecordRef: 's1:r8' }]],
    ]);
    expect(Object.keys(two.evidence).sort()).toEqual(['provenance', 'status', 'supportingEvidenceIds', 'value']);
  });

  it('2. Known(false) from explicit refuting revisions only', () => {
    expect(ev(run([REFUTING, rev('r9', { assertion: 'Denied' })]))).toEqual({ status: 'Known', value: false, supportingEvidenceIds: ['s1/r2@1', 's1/r9@1'] });
  });

  it('3. repeated identical occurrences add no reference; occurrences differing only in provenance keep both provenances (case 59)', () => {
    const r = run([SUPPORTING, { ...SUPPORTING }, { ...SUPPORTING }]);
    expect(r.evidence).toEqual(run([SUPPORTING]).evidence);
    const b = run([SUPPORTING, { ...SUPPORTING, provenance: { acquisition: 'a1', sourceRecordRef: 's1:r1' } }]);
    if (b.evidence.status !== 'Known') throw new Error('Known');
    expect(b.evidence.supportingEvidenceIds.map(show)).toEqual(['s1/r1@1']);
    expect(b.evidence.provenance[0]!.occurrences).toEqual([{ acquisition: 'a0', sourceRecordRef: 's1:r1' }, { acquisition: 'a1', sourceRecordRef: 's1:r1' }]);
  });

  it('missing provenance is kept explicitly as null, never dropped or manufactured (decided on review, 2026-11-02)', () => {
    const r = run([rev('r1', { provenance: undefined }), { ...SUPPORTING, provenance: { acquisition: 'a1', sourceRecordRef: 's1:r1' } }]);
    if (r.evidence.status !== 'Known') throw new Error('Known');
    // §5.3 occurrence order: a missing acquisition sorts first.
    expect(r.evidence.provenance).toEqual([{ ref: { revision: { source: 's1', localId: 'r1', revision: '1' } }, occurrences: [null, { acquisition: 'a1', sourceRecordRef: 's1:r1' }] }]);
    const none = run([rev('r1', { provenance: undefined })]);
    expect(none.evidence.status === 'Known' && none.evidence.provenance[0]!.occurrences).toEqual([null]);
  });

  it('a Known result never lists a merely possible supporting revision', () => {
    // r12 could support but is unresolved: Known(true) stands on r1 alone (r12 is immaterial).
    expect(ev(run([SUPPORTING, canSupport('r12')]))).toEqual({ status: 'Known', value: true, supportingEvidenceIds: ['s1/r1@1'] });
  });
});

describe('final Evidence<Boolean>: Unresolved results and candidate membership (§5.1)', () => {
  it('4. no evidence under complete coverage stays Unresolved{Missing}, never false', () => {
    expect(ev(run([]))).toEqual(unresolved(['Missing'], []));
  });

  it('5. an established conflict keeps both sides as candidates and Conflicting', () => {
    expect(ev(run([REFUTING, SUPPORTING]))).toEqual(unresolved(['Conflicting'], ['s1/r1@1', 's1/r2@1']));
  });

  it('6. a relevant gap prevents Known beside a supporting or a refuting revision', () => {
    expect(ev(run([SUPPORTING], [], snap([COMPLETE], [fail('f1')])))).toEqual(unresolved(['Unavailable'], ['s1/r1@1']));
    expect(ev(run([REFUTING], [], snap([])))).toEqual(unresolved(['InsufficientEvidence'], ['s1/r2@1']));
  });

  it('7-8. material uncertainty demotes a Known base with step C\'s causes; immaterial unresolved records stay candidates', () => {
    const r = run([SUPPORTING, canRefute('r4'), canSupport('r12')]);
    expect(ev(r)).toEqual(unresolved(['Missing'], ['s1/r1@1', 's1/r12@1', 's1/r4@1']));
    expect(r.trace.stepB.immaterial.map((k) => k.localId)).toEqual(['r12']);
    expect(r.evidence.status === 'Unresolved' && r.evidence.causes).toEqual(r.trace.causes);
  });

  it('9. selected Unclassified and NonInformative records are candidates', () => {
    expect(ev(run([UNCLASSIFIED, NONINF]))).toEqual(unresolved(['Missing', 'InsufficientEvidence'], ['s1/r3@1', 's1/r7@1']));
  });

  it('10-11. a definitely inadmissible in-domain revision, and unresolved candidacy beside a definite mismatch, are candidates', () => {
    expect(ev(run([INADMISSIBLE]))).toEqual(unresolved(['Inadmissible'], ['s1/r5@1']));
    expect(ev(run([rev('r14', { concept: OTHER_CS, encounter: 'N0' })]))).toEqual(unresolved(['InsufficientEvidence'], ['s1/r14@1']));
  });

  it('12. out-of-domain possibilities are not candidates, also within an unresolved key', () => {
    expect(ev(run([rev('r20', { concept: OUT })]))).toEqual(unresolved(['Missing'], []));
    expect(ev(run(history('r21', {}, { concept: OUT })))).toEqual(unresolved(['Missing'], ['s1/r21@1']));
  });

  it('13. retracted keys and superseded historical revisions are not candidates', () => {
    expect(ev(run([NONINF, rev('r22')], [retract('x22', 'r22')]))).toEqual(unresolved(['InsufficientEvidence'], ['s1/r7@1']));
    // @2 validly corrects @1: only @2 is current (admissibility unresolved, so the result is Unresolved).
    const corrected = [rev('r23'), rev('r23', { revision: '2', supersedes: sup('r23'), author: AMEND, encounter: undefined })];
    expect(ev(run(corrected))).toEqual(unresolved(['Missing'], ['s1/r23@2']));
  });

  it('14. several possible current revisions, and conflicting payload variants, keep their exact identities', () => {
    expect(ev(run(history('r8', {}, { assertion: 'Denied' })))).toEqual(unresolved(['Missing'], ['s1/r8@1', 's1/r8@2']));
    const records = [rev('r11'), rev('r11', { assertion: 'Denied', provenance: { acquisition: 'a1', sourceRecordRef: 's1:r11' } })];
    const digests = s1Variants(records).map((v) => v.digest).sort();
    const r = run(records);
    expect(ev(r)).toEqual(unresolved(['Conflicting'], digests.map((d) => `s1/r11@1#${d}`)));
    if (r.evidence.status !== 'Unresolved') throw new Error('Unresolved');
    expect(r.evidence.candidateEvidenceIds.map((n) => n.digest)).toEqual(digests);
  });

  it('15. unknown and excluded markers never become identities', () => {
    // @2 corrects an absent @1 out of domain: possible currents {@2 out of domain, unknown}.
    const unknownOnly = run([rev('r25', { revision: '2', supersedes: sup('r25'), concept: OUT, author: AMEND })]);
    expect(ev(unknownOnly)).toEqual(unresolved(['Missing'], []));
    // Retraction authority missing: possible currents {@1, excluded}.
    const withExcluded = run([rev('r24')], [retract('x24', 'r24', { actor: 'u2' })]);
    expect(ev(withExcluded)).toEqual(unresolved(['Missing'], ['s1/r24@1']));
    for (const r of [unknownOnly, withExcluded]) {
      if (r.evidence.status !== 'Unresolved') throw new Error('Unresolved');
      for (const n of r.evidence.candidateEvidenceIds) expect(Object.keys(n.revision).sort()).toEqual(['localId', 'revision', 'source']);
    }
  });

  it('16-17. an unidentified rejected occurrence adds its gap cause but no candidate; a candidate need not carry a cause', () => {
    const r = run([SUPPORTING, { recordType: T, subject: 'P1', assertion: 'Denied' }]);
    expect(ev(r)).toEqual(unresolved(['Invalid'], ['s1/r1@1']));
    // The only cause is the gap's; the candidate s1/r1@1 contributes none.
    expect(r.trace.attribution.map((a) => [a.label, a.origin.kind])).toEqual([['unidentified:revision#1', 'gap']]);
  });
});

describe('final Evidence<Boolean>: determinism, identity, ownership and immutability', () => {
  // §5.3 orders by (source, localId, revision, digest), not by label: s1/r1@1 precedes s1/r12@1.
  it('18. input permutation and duplicate occurrences preserve the result and its order', () => {
    const records = [SUPPORTING, REFUTING, canRefute('r4'), UNCLASSIFIED, INADMISSIBLE, ...history('r8', {}, { assertion: 'Denied' })];
    const a = run(records);
    expect(run([...records].reverse())).toEqual(a);
    expect(run([...records, { ...records[3] }, { ...records[0] }])).toEqual(a);
    expect(ev(a)).toEqual(unresolved(['Missing', 'Conflicting'], ['s1/r1@1', 's1/r2@1', 's1/r3@1', 's1/r4@1', 's1/r5@1', 's1/r8@1', 's1/r8@2']));
  });

  it('19. identities whose display labels collide stay distinct', () => {
    // localId `a@1` at revision `1`, and localId `a` at revision `1@1`: both display as s1/a@1@1.
    const r = run([rev('a@1', { assertion: 'Indeterminate' }), rev('a', { revision: '1@1', assertion: 'Indeterminate' })]);
    if (r.evidence.status !== 'Unresolved') throw new Error('Unresolved');
    expect(r.evidence.candidateEvidenceIds.map(show)).toEqual(['s1/a@1@1', 's1/a@1@1']);
    expect(r.evidence.candidateEvidenceIds.map((n) => n.revision)).toEqual([
      { source: 's1', localId: 'a', revision: '1@1' },
      { source: 's1', localId: 'a@1', revision: '1' },
    ]);
  });

  it('20. interleaved evaluations sharing record IDs keep their own results', () => {
    const records = [SUPPORTING, canSupport('r12')];
    const plain = sel(records);
    const gapped = sel(records, [], snap([COMPLETE], [fail('f1')]));
    const a = experimentalQueryEvidence({ package: PKG, query: 'q', s4: plain });
    const b = experimentalQueryEvidence({ package: PKG, query: 'q', s4: gapped });
    expect(ev(a)).toEqual({ status: 'Known', value: true, supportingEvidenceIds: ['s1/r1@1'] });
    expect(ev(b)).toEqual(unresolved(['Missing', 'Unavailable'], ['s1/r1@1', 's1/r12@1']));
    expect(experimentalQueryEvidence({ package: PKG, query: 'q', s4: plain })).toEqual(a);
  });

  const bad = (input: unknown, pattern: RegExp) => {
    expect(() => experimentalQueryEvidence(input as never)).toThrow(QueryEvidenceConfigurationError);
    expect(() => experimentalQueryEvidence(input as never)).toThrow(pattern);
  };

  it('20. accepts only package, query and an S4 result bound to them with a snapshot; no override is accepted', () => {
    const s4 = sel([SUPPORTING]);
    for (const f of ['status', 'value', 'causes', 'attribution', 'supportingEvidenceIds', 'candidateEvidenceIds', 'evidence', 'stepC', 'trace', 'snapshot', 'queryContract']) {
      bad({ package: PKG, query: 'q', s4, [f]: [] }, new RegExp(`unexpected input field\\(s\\) ${f}`));
    }
    bad(null, /input must be an object/);
    bad({ package: PKG, query: 'q', s4: sel([SUPPORTING], [], 'none') }, /without a snapshot/);
    bad({ package: PKG, query: 'q', s4: JSON.parse(JSON.stringify(s4)) }, /produced by experimentalSelectForQuery/);
    bad({ package: PKG, query: 'q', s4: { ...s4 } }, /produced by experimentalSelectForQuery/);
    bad({ package: compiled(), query: 'q', s4 }, /another compiled package/);
    bad({ package: PKG, query: 'pv', s4 }, /not an EvidenceQuery/);
    const two = compiled({ ...program(), nodes: [...program().nodes, ...program('q2').nodes.map((n: J) => (n.id === 'pv' ? { ...n, id: 'pv2' } : n))] });
    bad({ package: two, query: 'q2', s4: sel([SUPPORTING], [], snap(), two) }, /selected for query "q", not "q2"/);
    const s1 = experimentalResolveRevisionHistory({ envelope: { recordType: T, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: [], retractions: [] });
    const s3 = experimentalCheckAdmissibility({ s1, valueSet: PIN, expansion: { id: PIN, expansion: [], coveredSystems: [] }, admissible: { encounter: SAME_ENCOUNTER_RULE, episode: SAME_EPISODE_RULE, assertionKind: { in: ['ClinicianDocumented'] } }, contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } });
    bad({ package: PKG, query: 'q', s4: experimentalSelect({ s3 }) }, /not bound to a query/);
    const p = experimentalCompilePreview({ ...program(), nodes: [{ ...program().nodes[0], contract: { hole: { id: 'H', type: 'EvidenceSelectionContract<Boolean>', explains: 'x' } } }, program().nodes[1]] } as JsonValue);
    if (p.outcome !== 'PreviewPackage') throw new Error('preview');
    bad({ package: p.package, query: 'q', s4: sel([SUPPORTING]) }, /preview packages are not evaluated here/);
  });

  it('21-22. detached, deeply immutable, the step C trace unchanged, and no decision, Needs, projection or execution', () => {
    const records = [SUPPORTING, canRefute('r4')];
    const s4 = sel(records);
    const r = experimentalQueryEvidence({ package: PKG, query: 'q', s4 });
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    const before = JSON.stringify(r);
    records[1]!['assertion'] = 'Affirmed';
    expect(JSON.stringify(r)).toBe(before);
    expect(r.trace).toEqual(experimentalCauseAttribution({ package: PKG, query: 'q', s4 }));
    expect(Object.keys(r).sort()).toEqual(['evidence', 'experimental', 'notRun', 'packageId', 'query', 'scope', 'snapshot', 'stage', 'trace'].sort());
    expect([r.experimental, r.stage, r.scope, r.notRun]).toEqual(['nonclinical-query-evidence-v0', 'S6', 'query-evidence', ['Needs', 'PredicateProjection', 'ProgramExecution']]);
    for (const f of ['needs', 'decision', 'obligations', 'outputs']) expect(JSON.stringify(r)).not.toContain(`"${f}"`);
  });
});
