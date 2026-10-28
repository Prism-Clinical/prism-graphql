/**
 * EXPERIMENTAL, NONCLINICAL. Independent tests of S4 selection. Every expected key status,
 * `unresolvedBy` list and blocker list is taken from the decision tables in
 * evidence-query-to-predicate-contract.md §2.8 (cases 125–129) and written out by hand.
 */
import {
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  SelectionConfigurationError,
  experimentalCheckAdmissibility,
  experimentalIdentifyCandidates,
  experimentalResolveRevisionHistory,
  experimentalSelect,
  type AdmissibilityCheckResult,
  type JsonValue,
  type KeySelection,
  type PossibleSelection,
  type S1Result,
  type SelectionResult,
  type ValueSetExpansion,
} from '../index';

const ENV = { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] } as const;
const PIN = 'demo-vs/item-x@1';
const VS: ValueSetExpansion = { id: PIN, expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] };
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
const ADM = { encounter: SAME_ENCOUNTER_RULE, episode: SAME_EPISODE_RULE, assertionKind: { in: ['ClinicianDocumented'] } };
const ITEM_Y = { system: 'demo-cs', code: 'item-y' }; // covered, not in the expansion: out of domain
const OTHER = { system: 'other-cs', code: 'item-x' }; // uncovered system: candidacy unresolved

type Over = Record<string, JsonValue | undefined>;
function rev(source: string, localId: string, revision: string, over: Over = {}): JsonValue {
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
const retr = (id: string, localId: string, target: JsonValue, author: JsonValue = AMEND): JsonValue => ({
  id,
  key: { source: 's1', localId },
  target,
  author,
  provenance: { acquisition: 'a0', sourceRecordRef: `s1:${id}` },
});
const s1Of = (revisions: JsonValue[], retractions: JsonValue[] = []): S1Result =>
  experimentalResolveRevisionHistory({ envelope: ENV, authorityRule: DEMO_AUTHORITY_RULE, revisions, retractions });
const s3Of = (s1: S1Result): AdmissibilityCheckResult =>
  experimentalCheckAdmissibility({ s1, valueSet: PIN, expansion: VS, admissible: ADM, contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } });
const sel = (revisions: JsonValue[], retractions: JsonValue[] = []): SelectionResult => experimentalSelect({ s3: s3Of(s1Of(revisions, retractions)) });
function key(r: SelectionResult, k: string): KeySelection {
  const found = r.keys.find((x) => `${x.key.source}/${x.key.localId}` === k);
  if (!found) throw new Error(`key ${k} missing`);
  return found;
}
/** `Selected`, `NotSelected[HistoryUnresolved,Inadmissible]`, `excluded`, `unknown`. */
const disp = (p: PossibleSelection) =>
  p.kind !== 'node' ? p.kind : p.selection.disposition === 'Selected' ? 'Selected' : `NotSelected[${p.selection.blockers.join(',')}]`;
const summary = (k: KeySelection) => ({ status: k.status, unresolvedBy: k.unresolvedBy, possibilities: k.possibilities.map(disp) });

describe('S4: current-revision rows of the §2.8 key table', () => {
  // [row, record overrides, status, unresolvedBy, the revision's disposition] — from §2.8.
  const ROWS: [string, Over, string, string[], string][] = [
    ['in domain, Admissible', {}, 'Selected', [], 'Selected'],
    ['in domain, UnresolvedAdmissibility', { episode: undefined }, 'Unresolved', ['AdmissibilityUnresolved'], 'NotSelected[AdmissibilityUnresolved]'],
    ['in domain, Inadmissible', { encounter: 'N0' }, 'Inadmissible', [], 'NotSelected[Inadmissible]'],
    ['in domain, Inadmissible beside an unresolved rule', { encounter: 'N0', episode: undefined }, 'Inadmissible', [], 'NotSelected[Inadmissible]'],
    ['candidacy unresolved, Admissible', { concept: OTHER }, 'Unresolved', ['CandidacyUnresolved'], 'NotSelected[CandidacyUnresolved]'],
    [
      'candidacy unresolved, UnresolvedAdmissibility',
      { concept: OTHER, episode: undefined },
      'Unresolved',
      ['AdmissibilityUnresolved', 'CandidacyUnresolved'],
      'NotSelected[AdmissibilityUnresolved,CandidacyUnresolved]',
    ],
    ['candidacy unresolved, Inadmissible (both facts kept)', { concept: OTHER, encounter: 'N0' }, 'Unresolved', ['CandidacyUnresolved'], 'NotSelected[CandidacyUnresolved,Inadmissible]'],
    ['out of domain', { concept: ITEM_Y }, 'OutOfDomain', [], 'NotSelected[OutOfDomain]'],
    ['out of domain, even when every rule would mismatch', { concept: ITEM_Y, encounter: 'N0', episode: 'E0', assertionKind: 'PatientReport' }, 'OutOfDomain', [], 'NotSelected[OutOfDomain]'],
  ];

  it.each(ROWS)('Current, %s → %s', (_row, over, status, unresolvedBy, disposition) => {
    const r = sel([rev('s1', 'r1', '1', over)]);
    expect(summary(key(r, 's1/r1'))).toEqual({ status, unresolvedBy, possibilities: [disposition] });
    expect(r.selected.map((x) => x.key.localId)).toEqual(status === 'Selected' ? ['r1'] : []);
    expect(r.unresolved.map((x) => x.localId)).toEqual(status === 'Unresolved' ? ['r1'] : []);
    expect(r.inadmissible.map((x) => x.localId)).toEqual(status === 'Inadmissible' ? ['r1'] : []);
  });

  it('Retracted and NoRecord keys contribute no possibility and stay distinct', () => {
    const r = sel([rev('s1', 'r7', '1'), rev('s1', 'r1', '1'), rev('s2', 'r8', '1', { supersedes: sup('s1', 'r1', '1'), author: AMEND })], [retr('x7', 'r7', sup('s1', 'r7', '1'))]);
    expect(summary(key(r, 's1/r7'))).toEqual({ status: 'Retracted', unresolvedBy: [], possibilities: [] });
    expect(summary(key(r, 's2/r8'))).toEqual({ status: 'NoRecord', unresolvedBy: [], possibilities: [] });
    expect(key(r, 's1/r1').status).toBe('Selected');
  });

  it('an inadmissible current revision keeps every S3 reason and unresolved finding with its origin', () => {
    const k = key(sel([rev('s1', 'r2', '1', { encounter: 'N0', episode: undefined })]), 's1/r2');
    const p = k.possibilities[0];
    expect(p).toMatchObject({
      admissibility: {
        outcome: 'Inadmissible',
        reasons: ['OtherEncounter'],
        findings: [{ rule: 'episode', cause: 'Missing', origin: 'record', reason: 'FieldAbsent:episode' }],
        causes: ['Missing'],
      },
      rules: { encounter: { outcome: 'DoesNotMatch', recordEncounter: 'N0' }, episode: { outcome: 'Unresolved' } },
    });
  });

  it('unresolved candidacy keeps its S2 findings', () => {
    const p = key(sel([rev('s1', 'r5', '1', { concept: OTHER })]), 's1/r5').possibilities[0];
    expect(p).toMatchObject({ candidacy: 'Unresolved', s2Findings: [{ cause: 'Unavailable', reason: 'TerminologyUnavailable' }] });
  });
});

describe('S4: unresolved history (§2.8 row UnresolvedRevision)', () => {
  const perm = { actor: 'u2' }; // permissions omitted: authority missing

  it('one admissible possibility does not select anything (case 126)', () => {
    const r = sel([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { encounter: 'N0', supersedes: sup('s1', 'r1', '1'), author: perm })]);
    const k = key(r, 's1/r1');
    expect(summary(k)).toEqual({ status: 'Unresolved', unresolvedBy: ['HistoryUnresolved'], possibilities: ['NotSelected[HistoryUnresolved]', 'NotSelected[HistoryUnresolved,Inadmissible]'] });
    expect(r.selected).toEqual([]);
    expect(k.inheritedS1Causes).toEqual(['Missing']);
    expect(k.inheritedS1Defects.map((d) => d.reason)).toEqual(['CorrectionAuthorityMissing']);
  });

  it('every alternative inadmissible: still Unresolved, never resolved or Inadmissible (case 127)', () => {
    const r = sel([rev('s1', 'r1', '1', { episode: 'E0' }), rev('s1', 'r1', '2', { encounter: 'N0', supersedes: sup('s1', 'r1', '1'), author: perm })]);
    expect(summary(key(r, 's1/r1'))).toEqual({
      status: 'Unresolved',
      unresolvedBy: ['HistoryUnresolved'],
      possibilities: ['NotSelected[HistoryUnresolved,Inadmissible]', 'NotSelected[HistoryUnresolved,Inadmissible]'],
    });
    expect(r.inadmissible).toEqual([]);
  });

  it('every alternative out of domain: still Unresolved', () => {
    const r = sel([rev('s1', 'r1', '1', { concept: ITEM_Y }), rev('s1', 'r1', '2', { concept: ITEM_Y, supersedes: sup('s1', 'r1', '1'), author: perm })]);
    expect(summary(key(r, 's1/r1'))).toEqual({
      status: 'Unresolved',
      unresolvedBy: ['HistoryUnresolved'],
      possibilities: ['NotSelected[HistoryUnresolved,OutOfDomain]', 'NotSelected[HistoryUnresolved,OutOfDomain]'],
    });
  });

  it('digest-qualified variants keep their own outcomes (case 128)', () => {
    const s1 = s1Of([rev('s1', 'r1', '1'), rev('s1', 'r1', '1', { encounter: 'N0', provenance: { acquisition: 'a1' } })]);
    const k = key(experimentalSelect({ s3: s3Of(s1) }), 's1/r1');
    expect(k.status).toBe('Unresolved');
    expect(k.possibilities.map(disp).sort()).toEqual(['NotSelected[HistoryUnresolved,Inadmissible]', 'NotSelected[HistoryUnresolved]']);
    expect(new Set(k.possibilities.map((p) => (p.kind === 'node' ? p.node.digest : p.kind)))).toEqual(new Set(s1.keys[0]!.revisions[0]!.variants.map((v) => v.digest)));
    expect(k.inheritedS1Causes).toEqual(['Conflicting']);
  });

  it('`excluded` and `unknown` are carried unchanged (case 129)', () => {
    const r = sel([rev('s1', 'r1', '1'), rev('s1', 'r9', '2', { supersedes: sup('s1', 'r9', '1'), author: AMEND })], [retr('x1', 'r1', sup('s1', 'r1', '1'), perm)]);
    expect(summary(key(r, 's1/r1'))).toEqual({ status: 'Unresolved', unresolvedBy: ['HistoryUnresolved'], possibilities: ['NotSelected[HistoryUnresolved]', 'excluded'] });
    expect(summary(key(r, 's1/r9'))).toEqual({ status: 'Unresolved', unresolvedBy: ['HistoryUnresolved'], possibilities: ['NotSelected[HistoryUnresolved]', 'unknown'] });
    expect(key(r, 's1/r1').possibilities[1]).toEqual({ kind: 'excluded' });
  });

  it('an authorized correction resolves history, so the corrected current revision is selected or not on its own', () => {
    expect(summary(key(sel([rev('s1', 'r1', '1', { encounter: 'N0' }), rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: AMEND })]), 's1/r1'))).toEqual({
      status: 'Selected',
      unresolvedBy: [],
      possibilities: ['Selected'],
    });
  });
});

describe('S4: input boundary, determinism and detachment', () => {
  const revisions = [
    rev('s1', 'r1', '1'),
    rev('s1', 'r2', '1', { encounter: 'N0', episode: undefined }),
    rev('s1', 'r3', '1', { episode: undefined }),
    rev('s1', 'r6', '1', { concept: OTHER, encounter: 'N0' }),
    rev('s1', 'r14', '1'),
    rev('s1', 'r14', '1', { encounter: 'N0', provenance: { acquisition: 'a1' } }),
    rev('s2', 'r9', '2', { supersedes: sup('s2', 'r9', '1'), author: AMEND }),
  ];
  const base = sel(revisions);

  it('summary lists follow the per-key statuses, in RecordKey order', () => {
    expect(base.selected.map((x) => `${x.key.source}/${x.key.localId} ${x.node.revision.revision}`)).toEqual(['s1/r1 1']);
    expect(base.unresolved.map((k) => `${k.source}/${k.localId}`)).toEqual(['s1/r14', 's1/r3', 's1/r6', 's2/r9']);
    expect(base.inadmissible.map((k) => `${k.source}/${k.localId}`)).toEqual(['s1/r2']);
  });

  it('is invariant under input permutation, identical duplicates and S1 key order', () => {
    expect(sel([...revisions].reverse())).toEqual(base);
    expect(sel([revisions[5]!, ...revisions, revisions[0]!])).toEqual(base);
    const s1 = s1Of(revisions);
    expect(experimentalSelect({ s3: s3Of({ ...s1, keys: [...s1.keys].reverse() }) })).toEqual(base);
  });

  it('rejects anything but a combined S3 result produced in this process', () => {
    const s1 = s1Of(revisions);
    const s3 = s3Of(s1);
    const s2 = experimentalIdentifyCandidates({ s1, valueSet: PIN, expansion: VS });
    const bad: [string, unknown][] = [
      ['null', null],
      ['no s3', {}],
      ['an S1 result', { s3: s1 }],
      ['an S2 result', { s3: s2 }],
      ['a structural copy of a real S3 result', { s3: JSON.parse(JSON.stringify(s3)) }],
      ['a frozen relabelled copy', { s3: Object.freeze({ ...s3 }) }],
      ['an extra S1 beside S3', { s3, s1 }],
      ['an extra S2 beside S3', { s3, s2 }],
    ];
    for (const [, input] of bad) expect(() => experimentalSelect(input as never)).toThrow(SelectionConfigurationError);
    expect(() => experimentalSelect({ s3 })).not.toThrow();
  });

  it('does not mutate its input, and its result is detached and deep-frozen', () => {
    const s3 = s3Of(s1Of(revisions));
    const before = JSON.stringify(s3);
    const r = experimentalSelect({ s3 });
    expect(JSON.stringify(s3)).toBe(before);
    expect(r.keys[0]).not.toBe(s3.keys[0]);
    expect(Object.isFrozen(r.keys[0]!.possibilities[0])).toBe(true);
    expect(() => (r.selected as unknown[]).push({})).toThrow(TypeError);
    expect(() => {
      (r.keys[0]!.unresolvedBy as string[]).length = 1;
    }).toThrow(TypeError);
  });
});
