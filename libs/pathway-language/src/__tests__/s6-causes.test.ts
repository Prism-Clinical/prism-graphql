/**
 * EXPERIMENTAL, NONCLINICAL. S6 step C: the cause union and its attribution (evidence-query contract
 * §4.2 step C, "Step C boundary"). Every expected entry is written from the contract: base causes
 * (step A), relevant gap findings (§4.1) and the origin causes of MATERIAL records only (step B),
 * in §5.3 order. No final Evidence<Boolean>, candidateEvidenceIds or Needs exist here.
 */
import {
  CauseAttributionConfigurationError,
  DEMO_AUTHORITY_RULE,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCauseAttribution,
  experimentalCheckAdmissibility,
  experimentalCompilePreview,
  experimentalMateriality,
  experimentalResolveRevisionHistory,
  experimentalSelect,
  experimentalSelectForQuery,
  type CauseAttributionResult,
  type EvaluationSnapshot,
  type JsonValue,
} from '../index';
import { AMEND, COMPLETE, NONINF, OTHER_CS, PIN, PKG, REFUTING, SUPPORTING, T, UNCLASSIFIED, INADMISSIBLE, compiled, fail, history, program, rev, sel, show, snap, sup, type J } from './support/s6-records';

const run = (revisions: J[], retractions: J[] = [], snapshot: EvaluationSnapshot = snap()): CauseAttributionResult =>
  experimentalCauseAttribution({ package: PKG, query: 'q', s4: sel(revisions, retractions, snapshot) });
/** Fixture notation: [cause, origin label, stage, reason] plus refs (or keys) when present. */
const entries = (r: CauseAttributionResult) =>
  r.attribution.map((a) => [a.cause, a.label, a.stage, a.reason, ...(a.refs ? [a.refs.map(show)] : []), ...(a.keys ? [a.keys.map((k) => `${k.source}/${k.localId}`)] : [])]);
const rejectedSnap = (items: J[]): EvaluationSnapshot => ({ id: 'snap-1', coverage: [COMPLETE], failures: [], rejectedItems: items });
const rej = (id: string): J => ({ id, appliesTo: { snapshot: 'snap-1' }, reason: 'UnparseableItem' });

// Unresolved records with known possible classes (§3.7), one per key.
/** Encounter absent: S3 Missing FieldAbsent:encounter; {Refuting, excluded}. */
const canRefute = (id: string) => rev(id, { assertion: 'Denied', encounter: undefined });
/** Encounter absent; {Supporting, excluded}. */
const canSupport = (id: string) => rev(id, { encounter: undefined });
/** Encounter absent; {NonInformative, excluded}: immaterial under every row. */
const nonInfOrExcluded = (id: string) => rev(id, { assertion: 'Indeterminate', encounter: undefined });

describe('S6 step C: the three sources of the cause union (§4.2 step C)', () => {
  it('1. base causes only: Missing, Inadmissible and InsufficientEvidence keep their query origin', () => {
    expect(entries(run([]))).toEqual([['Missing', 'query', 'S6', 'NoInDomainRecord']]);
    expect(entries(run([INADMISSIBLE]))).toEqual([['Inadmissible', 'query', 'S6', 'InadmissibleSeen', ['s1/r5']]]);
    const r = run([NONINF]);
    expect(entries(r)).toEqual([['InsufficientEvidence', 'query', 'S6', 'NonInformativeSeen', ['s1/r7']]]);
    expect([r.status, r.aggregation, r.causes]).toEqual([{ status: 'Unresolved' }, 'Applies', ['InsufficientEvidence']]);
  });

  it('2. an established conflict is Conflicting with both the supporting and the refuting reference', () => {
    const r = run([REFUTING, SUPPORTING]);
    expect(entries(r)).toEqual([['Conflicting', 'query', 'S6', 'AssertionConflict', ['s1/r1@1', 's1/r2@1']]]);
    expect(r.causes).toEqual(['Conflicting']);
  });

  it('3. relevant coverage-cell, acquisition-failure and rejected-item gaps add their own findings', () => {
    // Rule 4 (one side and a relevant gap): no base cause; every cause comes from the gaps.
    expect(entries(run([SUPPORTING], [], snap([])))).toEqual([
      ['InsufficientEvidence', 'cell:s1', 'coverage', 'CellAbsent'],
      ['InsufficientEvidence', 'cell:s2', 'coverage', 'CellAbsent'],
    ]);
    expect(entries(run([SUPPORTING], [], snap([COMPLETE], [fail('f1')])))).toEqual([['Unavailable', 'f1', 'gap', 'AcquisitionFailed']]);
    expect(entries(run([SUPPORTING], [], rejectedSnap([rej('ri1')])))).toEqual([['Invalid', 'ri1', 'gap', 'ItemRejected']]);
  });

  it('4. two relevant gaps with the same cause: one cause, two distinct origins', () => {
    const r = run([SUPPORTING], [], snap([COMPLETE], [fail('f2'), fail('f1')]));
    expect(r.causes).toEqual(['Unavailable']);
    expect(entries(r)).toEqual([
      ['Unavailable', 'f1', 'gap', 'AcquisitionFailed'],
      ['Unavailable', 'f2', 'gap', 'AcquisitionFailed'],
    ]);
    expect(new Set(r.attribution.map((a) => a.id)).size).toBe(2);
  });

  it('5-6. material records carry their S1, S2, S3 and S5 origin causes; a selected Unclassified record its criterion causes', () => {
    const r = run([
      NONINF, // rule 5 base: InsufficientEvidence
      ...history('r8', {}, { assertion: 'Denied' }), // S1: correction authority missing; {Supporting, Refuting}
      rev('r9', { concept: OTHER_CS }), // S2: uncovered system; {Supporting, excluded}
      canRefute('r4'), // S3: encounter absent
      UNCLASSIFIED, // selected, Unclassified: S5 assertion absent (both criteria)
    ]);
    expect(r.stepB.material.map((k) => k.localId)).toEqual(['r3', 'r4', 'r8', 'r9']);
    expect(entries(r)).toEqual([
      ['Missing', 's1/r3@1', 'S5', 'FieldAbsent:assertion'],
      ['Missing', 's1/r4@1', 'S3', 'FieldAbsent:encounter'],
      ['Missing', 's1/r8', 'S1', 'CorrectionAuthorityMissing'],
      ['Unavailable', 's1/r9@1', 'S2', 'TerminologyUnavailable'],
      ['InsufficientEvidence', 'query', 'S6', 'NonInformativeSeen', ['s1/r7']],
    ]);
    expect(r.causes).toEqual(['Missing', 'Unavailable', 'InsufficientEvidence']);
    const s1 = r.attribution.find((a) => a.stage === 'S1')!;
    expect(s1.origin).toMatchObject({ kind: 'record', key: { source: 's1', localId: 'r8' } });
  });

  it('7. several simultaneous causes on one material key all stay, each with its own stage and reason', () => {
    const r = run([rev('r10', { concept: OTHER_CS, encounter: undefined, episode: 7, assertion: undefined })]);
    expect(entries(r)).toEqual([
      // Same cause and origin: reason order (§5.3), whatever the stage.
      ['Missing', 's1/r10@1', 'S5', 'FieldAbsent:assertion'],
      ['Missing', 's1/r10@1', 'S3', 'FieldAbsent:encounter'],
      ['Unavailable', 's1/r10@1', 'S2', 'TerminologyUnavailable'],
      ['Invalid', 's1/r10@1', 'S3', 'FieldMalformed:episode'],
    ]);
    expect(r.causes).toEqual(['Missing', 'Unavailable', 'Invalid']);
  });

  it('8. distinct revisions and variants of one key keep their own attribution', () => {
    // Two revisions (history unresolved): each finding stays on its own revision.
    const h = run(history('r8', { encounter: undefined }, { episode: 5 }));
    expect(entries(h)).toEqual([
      ['Missing', 's1/r8', 'S1', 'CorrectionAuthorityMissing'],
      ['Missing', 's1/r8@1', 'S3', 'FieldAbsent:encounter'],
      ['Invalid', 's1/r8@2', 'S3', 'FieldMalformed:episode'],
    ]);
    // Two payloads under one revision (PayloadConflict): each S5 finding stays on its own variant.
    const absent = rev('r11', { assertion: undefined });
    const malformed = rev('r11', { assertion: 'Perhaps', provenance: { acquisition: 'a1', sourceRecordRef: 's1:r11' } });
    const s1 = experimentalResolveRevisionHistory({ envelope: { recordType: T, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: [absent, malformed] as JsonValue[], retractions: [] });
    const variants = s1.keys[0]!.revisions[0]!.variants;
    const digestOf = (has: boolean) => variants.find((v) => v.canonicalPayload.includes('"assertion"') === has)!.digest;
    const v = run([absent, malformed]);
    expect(entries(v)).toEqual(
      [
        ['Missing', `s1/r11@1#${digestOf(false)}`, 'S5', 'FieldAbsent:assertion'],
        ['Conflicting', 's1/r11', 'S1', 'PayloadConflict'],
        ['Invalid', `s1/r11@1#${digestOf(true)}`, 'S5', 'FieldMalformed:assertion'],
      ],
    );
  });

  it('materiality is per key: every possible current of a material record is attributed, not only the one that could oppose', () => {
    // @1 could support (encounter absent); @2 is definitely inadmissible (other encounter) with an
    // unresolved episode finding retained beside the mismatch (§2.7). The key is material through
    // @1 alone; @2's retained S3 finding is still one of its origin causes (§4.2 step C).
    const r = run(history('r15', { encounter: undefined }, { encounter: 'N0', episode: 5 }));
    expect(r.stepB.records.map((x) => [x.key.localId, x.material, x.satisfiedBy])).toEqual([['r15', true, ['Supporting']]]);
    expect(entries(r)).toEqual([
      ['Missing', 's1/r15', 'S1', 'CorrectionAuthorityMissing'],
      ['Missing', 's1/r15@1', 'S3', 'FieldAbsent:encounter'],
      ['Invalid', 's1/r15@2', 'S3', 'FieldMalformed:episode'],
    ]);
  });

  it('9. immaterial records and irrelevant gaps add nothing (they stay in the earlier traces)', () => {
    const irrelevant = snap([COMPLETE], [fail('f9', { subject: 'P2' })]);
    const r = run([NONINF, nonInfOrExcluded('r13')], [], irrelevant);
    expect(entries(r)).toEqual([['InsufficientEvidence', 'query', 'S6', 'NonInformativeSeen', ['s1/r13', 's1/r7']]]);
    expect(r.stepB.immaterial.map((k) => k.localId)).toEqual(['r13']);
    expect(r.stepB.stepA.irrelevantGaps.map((g) => g.label)).toEqual(['f9']);
  });

  it('10. Conflicting stays beside gap and material-record causes; nothing overwrites it', () => {
    const r = run([SUPPORTING, REFUTING, canRefute('r4')], [], snap([COMPLETE], [fail('f1')]));
    expect(entries(r)).toEqual([
      ['Missing', 's1/r4@1', 'S3', 'FieldAbsent:encounter'],
      ['Conflicting', 'query', 'S6', 'AssertionConflict', ['s1/r1@1', 's1/r2@1']],
      ['Unavailable', 'f1', 'gap', 'AcquisitionFailed'],
    ]);
    expect(r.causes).toEqual(['Missing', 'Conflicting', 'Unavailable']);
  });

  it('11. a base made Unresolved by a gap (rule 4) uses step B\'s Unresolved row: both one-sided records are material', () => {
    const r = run([SUPPORTING, canRefute('r4'), canSupport('r12')], [], snap([COMPLETE], [fail('f1')]));
    expect([r.stepB.stepA.rule, r.stepB.row, r.stepB.material.map((k) => k.localId)]).toEqual([4, 'Unresolved', ['r12', 'r4']]);
    expect(entries(r)).toEqual([
      ['Missing', 's1/r12@1', 'S3', 'FieldAbsent:encounter'],
      ['Missing', 's1/r4@1', 'S3', 'FieldAbsent:encounter'],
      ['Unavailable', 'f1', 'gap', 'AcquisitionFailed'],
    ]);
  });
});

describe('S6 step C: settled boundaries', () => {
  it('12. original base Known(true): after demotion, a supporting-only record stays immaterial and adds nothing, in either order', () => {
    for (const records of [[SUPPORTING, canRefute('r4'), canSupport('r12')], [canSupport('r12'), canRefute('r4'), SUPPORTING]]) {
      const r = run(records);
      expect([r.stepB.change, r.status]).toEqual(['DemotedToUnresolved', { status: 'Unresolved' }]);
      expect(entries(r)).toEqual([['Missing', 's1/r4@1', 'S3', 'FieldAbsent:encounter']]);
    }
    // Same keys with the roles swapped: only the refuting-capable key, now r12, is attributed.
    expect(entries(run([SUPPORTING, canSupport('r4'), canRefute('r12')]))).toEqual([['Missing', 's1/r12@1', 'S3', 'FieldAbsent:encounter']]);
  });

  it('12. symmetric: original base Known(false): a refuting-only record stays immaterial and adds nothing', () => {
    for (const records of [[REFUTING, canSupport('r12'), canRefute('r4')], [canRefute('r4'), canSupport('r12'), REFUTING]]) {
      expect(entries(run(records))).toEqual([['Missing', 's1/r12@1', 'S3', 'FieldAbsent:encounter']]);
    }
  });

  it('13. an S1-rejected malformed correction beside a Current supporting revision: its relevant Invalid gap', () => {
    // The correction holds a lone surrogate: not representable, so S1 rejects the whole occurrence.
    const correction = rev('r1', { revision: '2', supersedes: sup('r1'), author: AMEND, assertion: 'Denied', note: '\uD800' });
    const r = run([SUPPORTING, correction]);
    expect([r.stepB.stepA.rule, r.stepB.stepA.supporting.map(show)]).toEqual([4, ['s1/r1@1']]);
    expect(entries(r)).toEqual([['Invalid', 'unidentified:revision#1', 'gap', 'ItemRejected']]);
    expect(r.attribution[0]!.origin).toEqual({ kind: 'gap', gap: { kind: 'RejectedItem', origin: 'S1', occurrence: 'revision', inputIndex: 1 } });
  });

  it('14. unresolved candidacy beside inadmissibility: the base InsufficientEvidence only; its candidacy cause is not added', () => {
    const r = run([rev('r14', { concept: OTHER_CS, encounter: 'N0' })]);
    expect(r.stepB.immaterial.map((k) => k.localId)).toEqual(['r14']);
    expect(entries(r)).toEqual([['InsufficientEvidence', 'query', 'S6', 'NonInformativeSeen', ['s1/r14']]]);
  });

  it('15. a status still Known after step B: aggregation is not applicable, even beside agreeing uncertainty and irrelevant gaps', () => {
    const r = run([SUPPORTING, canSupport('r12')], [], snap([COMPLETE], [fail('f9', { subject: 'P2' })]));
    expect([r.status, r.aggregation, r.causes, r.attribution]).toEqual([{ status: 'Known', value: true }, 'NotApplicable', [], []]);
  });

  it('EA-083 shape: a fork recorded at step 5 stays active beside missing retraction authority', () => {
    const r = run(forkRecords(false), [unauthorRetraction]);
    expect(entries(r)).toEqual([
      ['Missing', 's1/r1', 'S1', 'RetractionAuthorityMissing'],
      ['Conflicting', 's1/r1', 'S1', 'Fork'],
    ]);
  });

  it('EA-092 shape (documented S1 limitation of the narrow fork fallback): Missing only, no Conflicting; reproduced, not repaired here', () => {
    // Same two possible current heads as EA-083 (Affirmed @2a, Denied @2b), but the fork was
    // suppressed at step 5 by @1's payload conflict, now historical; the fallback needs no active
    // defect, and RetractionAuthorityMissing stays active. Step C attributes exactly S1's active defects.
    const r = run(forkRecords(true), [unauthorRetraction]);
    expect(entries(r)).toEqual([['Missing', 's1/r1', 'S1', 'RetractionAuthorityMissing']]);
    expect(r.causes).toEqual(['Missing']);
  });
});

/** EA-083 / EA-092 shapes: @1, then authorized @2a (Affirmed) and @2b (Denied) both superseding it. */
const forkRecords = (conflictedFirst: boolean): J[] => [
  rev('r1'),
  ...(conflictedFirst ? [rev('r1', { assertion: 'Denied', provenance: { acquisition: 'a1', sourceRecordRef: 's1:r1:1' } })] : []),
  rev('r1', { revision: '2a', supersedes: sup('r1'), author: AMEND }),
  rev('r1', { revision: '2b', supersedes: sup('r1'), author: AMEND, assertion: 'Denied' }),
];
/** A retraction of @2b with no permissions stated: authority missing. */
const unauthorRetraction: J = { id: 'x1', key: { source: 's1', localId: 'r1' }, target: { source: 's1', localId: 'r1', revision: '2b' }, author: { actor: 'u2' }, provenance: { acquisition: 'a0', sourceRecordRef: 's1:x1' } };

describe('S6 step C: determinism, identity, ownership and immutability', () => {
  it('16. input permutation and identical duplicate occurrences give the same result, in canonical order', () => {
    const records = [SUPPORTING, REFUTING, canRefute('r4'), UNCLASSIFIED, ...history('r8', {}, { assertion: 'Denied' })];
    const s = snap([COMPLETE], [fail('f2'), fail('f1')]);
    const a = run(records, [], s);
    expect(run([...records].reverse(), [], snap([COMPLETE], [fail('f1'), fail('f2')]))).toEqual(a);
    expect(run([...records, { ...records[2] }, { ...records[0] }], [], s)).toEqual(a);
    expect(entries(a)).toEqual([
      ['Missing', 's1/r3@1', 'S5', 'FieldAbsent:assertion'],
      ['Missing', 's1/r4@1', 'S3', 'FieldAbsent:encounter'],
      ['Missing', 's1/r8', 'S1', 'CorrectionAuthorityMissing'],
      ['Conflicting', 'query', 'S6', 'AssertionConflict', ['s1/r1@1', 's1/r2@1']],
      ['Unavailable', 'f1', 'gap', 'AcquisitionFailed'],
      ['Unavailable', 'f2', 'gap', 'AcquisitionFailed'],
    ]);
  });

  it('17. colliding display labels keep distinct structured identities', () => {
    // A stated rejected item whose id equals the label of S1's own unidentified occurrence #1.
    const r = run([SUPPORTING, { recordType: T, subject: 'P1' }], [], rejectedSnap([rej('unidentified:revision#1')]));
    expect(entries(r)).toEqual([
      ['Invalid', 'unidentified:revision#1', 'gap', 'ItemRejected'],
      ['Invalid', 'unidentified:revision#1', 'gap', 'ItemRejected'],
    ]);
    expect(r.attribution.map((a) => (a.origin.kind === 'gap' ? a.origin.gap.origin : null)).sort()).toEqual(['S1', 'snapshot']);
    expect(new Set(r.attribution.map((a) => a.id)).size).toBe(2);
    expect(r.causes).toEqual(['Invalid']);
  });

  it('context findings: one entry per binding, cause and reason, listing the affected revisions of material keys only (sorted, deduplicated)', () => {
    const s4 = experimentalSelectForQuery({
      package: PKG,
      query: 'q',
      subject: 'P1',
      // r7 has the same context finding but can only be NonInformative or excluded: immaterial, so not in refs.
      revisions: [rev('r4', { assertion: 'Denied' }), rev('r12'), rev('r7', { assertion: 'Indeterminate' })] as JsonValue[],
      retractions: [],
      contextEncounter: { known: 'N1' },
      contextEpisode: { unknown: ['Conflicting'] },
      snapshot: snap(),
    });
    const r = experimentalCauseAttribution({ package: PKG, query: 'q', s4 });
    expect(r.stepB.immaterial.map((k) => k.localId)).toEqual(['r7']);
    expect(entries(r)).toEqual([
      ['Conflicting', 'context.episode', 'S3', 'ContextUnknown:episode', ['s1/r12@1', 's1/r4@1']],
      ['InsufficientEvidence', 'query', 'S6', 'NonInformativeSeen', ['s1/r7']],
    ]);
    expect(r.attribution[0]!.origin).toEqual({ kind: 'context', binding: 'episode' });
  });

  it('18. interleaved evaluations sharing record IDs keep their own gaps and records', () => {
    const records = [SUPPORTING, canRefute('r12')];
    const plain = sel(records);
    const gapped = sel(records, [], snap([COMPLETE], [fail('f1')], 'snap-9'));
    const a = experimentalCauseAttribution({ package: PKG, query: 'q', s4: plain });
    const b = experimentalCauseAttribution({ package: PKG, query: 'q', s4: gapped });
    expect(entries(a)).toEqual([['Missing', 's1/r12@1', 'S3', 'FieldAbsent:encounter']]);
    // snap-9's statements apply to snap-1, so none is current: both cells are Absent there.
    expect([b.snapshot, entries(b)]).toEqual([
      'snap-9',
      [['Missing', 's1/r12@1', 'S3', 'FieldAbsent:encounter'], ['InsufficientEvidence', 'cell:s1', 'coverage', 'CellAbsent'], ['InsufficientEvidence', 'cell:s2', 'coverage', 'CellAbsent']],
    ]);
    expect(experimentalCauseAttribution({ package: PKG, query: 'q', s4: plain })).toEqual(a);
  });

  const bad = (input: unknown, pattern: RegExp) => {
    expect(() => experimentalCauseAttribution(input as never)).toThrow(CauseAttributionConfigurationError);
    expect(() => experimentalCauseAttribution(input as never)).toThrow(pattern);
  };

  it('18. accepts only package, query and an S4 result bound to them with a snapshot; no override is accepted', () => {
    const s4 = sel([SUPPORTING]);
    for (const f of ['causes', 'attribution', 'material', 'materiality', 'stepA', 'stepB', 'base', 'gaps', 'snapshot', 'possibleClasses', 'queryContract']) {
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

  it('19. the output is detached and deeply immutable, keeps step B unchanged, and has no final evidence, candidate IDs or Needs', () => {
    const records = [SUPPORTING, canRefute('r4')];
    const s4 = sel(records);
    const r = experimentalCauseAttribution({ package: PKG, query: 'q', s4 });
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    const before = JSON.stringify(r);
    records[1]!['assertion'] = 'Affirmed';
    expect(JSON.stringify(r)).toBe(before);
    expect(() => {
      (r.attribution as unknown[]).push({});
    }).toThrow();
    expect(r.stepB).toEqual(experimentalMateriality({ package: PKG, query: 'q', s4 }));
    expect(Object.keys(r).sort()).toEqual(['aggregation', 'attribution', 'causes', 'experimental', 'notRun', 'packageId', 'query', 'scope', 'snapshot', 'stage', 'status', 'step', 'stepB'].sort());
    expect([r.experimental, r.stage, r.step, r.scope, r.notRun]).toEqual(['nonclinical-s6-causes-v0', 'S6', 'C', 'cause-attribution', ['Evidence', 'CandidateEvidenceIds', 'Needs']]);
    for (const f of ['evidence', 'candidateEvidenceIds', 'needs', 'supportingEvidenceIds']) expect(JSON.stringify(r)).not.toContain(`"${f}"`);
  });
});
