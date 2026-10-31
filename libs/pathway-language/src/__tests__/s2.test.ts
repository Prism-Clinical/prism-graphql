/**
 * EXPERIMENTAL, NONCLINICAL. Independent S2 tests. Expectations are derived by hand from the
 * contract (evidence-query-to-predicate-contract.md §1.2, §1.7, §2 row S2, §2.1 step 7, §2.3, §4.2
 * step B) and Stage A §3.1; none is copied from implementation output.
 */
import {
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  S2ConfigurationError,
  experimentalIdentifyCandidates,
  experimentalResolveRevisionHistory,
  type JsonValue,
  type KeyCandidacy,
  type PossibleCandidacy,
  type S1Result,
  type S2Result,
  type ValueSetExpansion,
} from '../index';

const ENV = { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] } as const;
const PIN = 'demo-vs/item-x@1';
// The fixtures' pinned expansion (query/q.demo.json `valueSets`).
const VS: ValueSetExpansion = { id: PIN, expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] };
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
const X = { system: 'demo-cs', code: 'item-x' }; // in the expansion
const Y = { system: 'demo-cs', code: 'item-y' }; // covered system, not in the expansion
const OTHER = { system: 'other-cs', code: 'item-x' }; // uncovered system, same code text

type Over = Record<string, JsonValue | undefined>;
function rev(source: string, localId: string, revision: string, over: Over = {}): JsonValue {
  const base: Record<string, JsonValue> = {
    key: { source, localId },
    revision,
    recordType: ENV.recordType,
    subject: 'P1',
    episode: 'E1',
    encounter: 'N1',
    concept: X,
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
const s2Of = (revisions: JsonValue[], retractions: JsonValue[] = [], expansion: ValueSetExpansion = VS): S2Result =>
  experimentalIdentifyCandidates({ s1: s1Of(revisions, retractions), valueSet: PIN, expansion });

function key(r: S2Result, k: string): KeyCandidacy {
  const found = r.keys.find((x) => `${x.key.source}/${x.key.localId}` === k);
  if (!found) throw new Error(`key ${k} missing`);
  return found;
}
/** Compact view: `s1/r1@1 InDomain`, `s1/r1@1#<n> Unresolved[Unavailable/TerminologyUnavailable]`, `excluded`, `unknown`. */
function show(p: PossibleCandidacy, digests: string[] = []): string {
  if (p.kind !== 'node') return p.kind;
  const r = p.node.revision;
  const id = `${r.source}/${r.localId}@${r.revision}` + (p.node.digest ? `#${digests.indexOf(p.node.digest)}` : '');
  return p.candidacy === 'Unresolved' ? `${id} Unresolved[${p.findings.map((f) => `${f.cause}/${f.reason}`).join(',')}]` : `${id} ${p.candidacy}`;
}
const view = (k: KeyCandidacy) => ({
  s1Status: k.s1Status,
  possibilities: k.possibilities.map((p) => show(p)),
  candidate: k.candidate,
  inheritedCauses: k.inheritedCauses,
  causes: k.causes,
});

describe('S2: single current revision', () => {
  it('in the expansion → InDomain, candidate', () => {
    expect(view(key(s2Of([rev('s1', 'r1', '1')]), 's1/r1'))).toEqual({
      s1Status: 'Current',
      possibilities: ['s1/r1@1 InDomain'],
      candidate: true,
      inheritedCauses: [],
      causes: [],
    });
  });

  it('well-formed code outside the expansion in a covered system → OutOfDomain, not a candidate (case 24 shape)', () => {
    const k = key(s2Of([rev('s1', 'r1', '1', { concept: Y })]), 's1/r1');
    expect(view(k)).toEqual({ s1Status: 'Current', possibilities: ['s1/r1@1 OutOfDomain'], candidate: false, inheritedCauses: [], causes: [] });
    expect(k.possibilities[0]).toMatchObject({ reason: 'CodeNotInExpansion', code: Y });
  });

  it('uncovered code system → Unresolved{Unavailable}, never OutOfDomain or a cross-system match (case 13; Stage A §3.1)', () => {
    expect(view(key(s2Of([rev('s1', 'r10', '1', { concept: OTHER })]), 's1/r10'))).toEqual({
      s1Status: 'Current',
      possibilities: ['s1/r10@1 Unresolved[Unavailable/TerminologyUnavailable]'],
      candidate: true,
      inheritedCauses: [],
      causes: ['Unavailable'],
    });
  });

  it.each([
    ['numeric code (case 14)', { system: 'demo-cs', code: 7 }],
    ['null code', { system: 'demo-cs', code: null }],
    ['non-string system', { system: ['demo-cs'], code: 'item-x' }],
    ['concept null', null],
    ['concept a string', 'demo-cs#item-x'],
    ['empty code (case 98a)', { system: 'demo-cs', code: '' }],
    ['empty system (case 98b)', { system: '', code: 'item-x' }],
    ['ASCII whitespace-only code (case 99a)', { system: 'demo-cs', code: '   ' }],
    ['Unicode whitespace-only code (case 99b)', { system: 'demo-cs', code: '\u00a0\u2003' }],
    ['line-terminator-only system', { system: '\n\u2028', code: 'item-x' }],
  ] as [string, JsonValue][])('malformed concept/code (%s) → Unresolved{Invalid}, not Unavailable', (_n, concept) => {
    expect(view(key(s2Of([rev('s1', 'r15', '1', { concept })]), 's1/r15'))).toEqual({
      s1Status: 'Current',
      possibilities: ['s1/r15@1 Unresolved[Invalid/CodeMalformed]'],
      candidate: true,
      inheritedCauses: [],
      causes: ['Invalid'],
    });
  });

  it('malformed code in an uncovered system is Invalid only: Unavailable needs a well-formed code (§1.7)', () => {
    expect(key(s2Of([rev('s1', 'r15', '1', { concept: { system: 'other-cs', code: 7 } })]), 's1/r15').causes).toEqual(['Invalid']);
    expect(key(s2Of([rev('s1', 'r15', '1', { concept: { system: 'other-cs', code: ' ' } })]), 's1/r15').causes).toEqual(['Invalid']);
  });

  it('surrounding whitespace is kept verbatim, not trimmed: well-formed but a different code (case 100)', () => {
    for (const code of [' item-x', 'item-x\t', '\u00a0item-x']) {
      expect(key(s2Of([rev('s1', 'r100', '1', { concept: { system: 'demo-cs', code } })]), 's1/r100').possibilities.map((p) => show(p))).toEqual([
        's1/r100@1 OutOfDomain',
      ]);
    }
  });

  it('a code containing inner whitespace that IS in the expansion is in domain: only whitespace-only identifiers are rejected', () => {
    const expansion = { ...VS, expansion: [{ system: 'demo-cs', code: 'item x' }] };
    expect(key(s2Of([rev('s1', 'r1', '1', { concept: { system: 'demo-cs', code: 'item x' } })], [], expansion), 's1/r1').possibilities.map((p) => show(p))).toEqual([
      's1/r1@1 InDomain',
    ]);
  });

  it('absent concept → Unresolved{Missing, FieldAbsent:concept}: absence is explicit, never defaulted (§2.3, case 93)', () => {
    expect(view(key(s2Of([rev('s1', 'r3', '1', { concept: undefined })]), 's1/r3'))).toEqual({
      s1Status: 'Current',
      possibilities: ['s1/r3@1 Unresolved[Missing/FieldAbsent:concept]'],
      candidate: true,
      inheritedCauses: [],
      causes: ['Missing'],
    });
  });

  it('absent components are Missing with their field path; absent plus malformed components keep both causes (§2.3, cases 94, 95, 97)', () => {
    const shown = (concept: JsonValue) => key(s2Of([rev('s1', 'r3', '1', { concept })]), 's1/r3').possibilities.map((p) => show(p));
    expect(shown({ code: 'item-x' })).toEqual(['s1/r3@1 Unresolved[Missing/FieldAbsent:concept.system]']);
    expect(shown({ system: 'demo-cs' })).toEqual(['s1/r3@1 Unresolved[Missing/FieldAbsent:concept.code]']);
    expect(shown({})).toEqual(['s1/r3@1 Unresolved[Missing/FieldAbsent:concept.system,Missing/FieldAbsent:concept.code]']);
    expect(shown({ code: 7 })).toEqual(['s1/r3@1 Unresolved[Missing/FieldAbsent:concept.system,Invalid/CodeMalformed]']);
    expect(shown({ system: '', code: ' ' })).toEqual(['s1/r3@1 Unresolved[Invalid/CodeMalformed]']); // one finding: attribution is a set
  });

  it('compares system and code exactly: no case folding, and undeclared concept members (display) play no part', () => {
    expect(key(s2Of([rev('s1', 'r1', '1', { concept: { system: 'demo-cs', code: 'Item-X' } })]), 's1/r1').possibilities.map((p) => show(p))).toEqual([
      's1/r1@1 OutOfDomain',
    ]);
    const withDisplay = { system: 'demo-cs', code: 'item-y', display: 'item-x' };
    expect(key(s2Of([rev('s1', 'r1', '1', { concept: withDisplay })]), 's1/r1').possibilities.map((p) => show(p))).toEqual(['s1/r1@1 OutOfDomain']);
  });
});

describe('S2: revision history from S1', () => {
  it('authorized correction from an included to an excluded concept: only the current revision is classified (case 24)', () => {
    const k = key(s2Of([rev('s1', 'r8', '1'), rev('s1', 'r8', '2', { concept: Y, supersedes: sup('s1', 'r8', '1'), author: AMEND })]), 's1/r8');
    expect(view(k)).toEqual({ s1Status: 'Current', possibilities: ['s1/r8@2 OutOfDomain'], candidate: false, inheritedCauses: [], causes: [] });
  });

  it('the reverse correction (excluded → included) makes the key a candidate via the current revision only', () => {
    const k = key(s2Of([rev('s1', 'r8', '1', { concept: Y }), rev('s1', 'r8', '2', { supersedes: sup('s1', 'r8', '1'), author: AMEND })]), 's1/r8');
    expect(k.possibilities.map((p) => show(p))).toEqual(['s1/r8@2 InDomain']);
  });

  it('unresolved history with an in-domain and an out-of-domain possibility: both kept, no winner, causes inherited (case 18 shape)', () => {
    const k = key(s2Of([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { concept: Y, supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]), 's1/r1');
    expect(view(k)).toEqual({
      s1Status: 'UnresolvedRevision',
      possibilities: ['s1/r1@1 InDomain', 's1/r1@2 OutOfDomain'],
      candidate: true,
      inheritedCauses: ['Missing'],
      causes: ['Missing'],
    });
    expect(k.inheritedDefects.map((d) => [d.cause, d.reason])).toEqual([['Missing', 'CorrectionAuthorityMissing']]);
  });

  it('unresolved history whose concrete possibilities are all out of domain: not a candidate, but S1 causes are NOT dropped (case 33)', () => {
    const k = key(
      s2Of([
        rev('s1', 'r43', '1', { concept: Y }),
        rev('s1', 'r43', '2', { concept: Y, supersedes: sup('s1', 'r43', '3'), author: AMEND }),
        rev('s1', 'r43', '3', { concept: Y, supersedes: sup('s1', 'r43', '2'), author: AMEND }),
      ]),
      's1/r43',
    );
    expect(view(k)).toEqual({
      s1Status: 'UnresolvedRevision',
      possibilities: ['s1/r43@1 OutOfDomain', 's1/r43@2 OutOfDomain', 's1/r43@3 OutOfDomain'],
      candidate: false,
      inheritedCauses: ['Invalid'],
      causes: ['Invalid'],
    });
    expect(k.inheritedDefects.map((d) => d.reason)).toEqual(['Cycle']);
  });

  it('`unknown` stays possibly in domain: a candidate even when the seen revision is out of domain (case 26 shape)', () => {
    const k = key(s2Of([rev('s1', 'r9', '2', { concept: Y, supersedes: sup('s1', 'r9', '1'), author: AMEND })]), 's1/r9');
    expect(view(k)).toEqual({
      s1Status: 'UnresolvedRevision',
      possibilities: ['s1/r9@2 OutOfDomain', 'unknown'],
      candidate: true,
      inheritedCauses: ['Missing'],
      causes: ['Missing'],
    });
  });

  it('`excluded` stays excluded and never makes a key a candidate on its own (case 31 shape)', () => {
    const inDomain = key(s2Of([rev('s1', 'r42', '1')], [retr('x42', 'r42', sup('s1', 'r42', '1'), { actor: 'u2' })]), 's1/r42');
    expect(view(inDomain)).toEqual({
      s1Status: 'UnresolvedRevision',
      possibilities: ['s1/r42@1 InDomain', 'excluded'],
      candidate: true,
      inheritedCauses: ['Missing'],
      causes: ['Missing'],
    });
    const outOfDomain = key(s2Of([rev('s1', 'r42', '1', { concept: Y })], [retr('x42', 'r42', sup('s1', 'r42', '1'), { actor: 'u2' })]), 's1/r42');
    expect(view(outOfDomain)).toMatchObject({ possibilities: ['s1/r42@1 OutOfDomain', 'excluded'], candidate: false, causes: ['Missing'] });
  });

  it('digest-qualified variants under one RevisionRef are classified separately; S1 and S2 causes both kept', () => {
    const s1 = s1Of([rev('s1', 'r14', '1'), rev('s1', 'r14', '1', { concept: OTHER, provenance: { acquisition: 'a1' } })]);
    const k = key(experimentalIdentifyCandidates({ s1, valueSet: PIN, expansion: VS }), 's1/r14');
    const digests = s1.keys[0]!.revisions[0]!.variants.map((v) => v.digest);
    const byDigest = new Map(k.possibilities.map((p) => [p.kind === 'node' ? p.node.digest : p.kind, p]));
    // Each variant classified from its own payload: the item-x variant is InDomain, the other-cs one Unavailable.
    const xDigest = digests.find((d) => (byDigest.get(d) as { candidacy?: string }).candidacy === 'InDomain');
    expect(xDigest).toBeDefined();
    expect(k.possibilities.map((p) => show(p, digests)).sort()).toEqual(
      [`s1/r14@1#${digests.indexOf(xDigest!)} InDomain`, `s1/r14@1#${1 - digests.indexOf(xDigest!)} Unresolved[Unavailable/TerminologyUnavailable]`].sort(),
    );
    expect(k).toMatchObject({ s1Status: 'UnresolvedRevision', candidate: true, inheritedCauses: ['Conflicting'], causes: ['Conflicting', 'Unavailable'] });
    expect(k.inheritedDefects.map((d) => d.reason)).toEqual(['PayloadConflict']);
  });

  it('Retracted and NoRecord contribute no possibility, are not candidates, and carry no S2 cause (cases 32, 22)', () => {
    const retracted = key(s2Of([rev('s1', 'r1', '1')], [retr('x1', 'r1', sup('s1', 'r1', '1'))]), 's1/r1');
    expect(view(retracted)).toEqual({ s1Status: 'Retracted', possibilities: [], candidate: false, inheritedCauses: [], causes: [] });
    const r = s2Of([rev('s1', 'r1', '1'), rev('s2', 'r21', '1', { supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(view(key(r, 's2/r21'))).toEqual({ s1Status: 'NoRecord', possibilities: [], candidate: false, inheritedCauses: [], causes: [] });
    expect(view(key(r, 's1/r1')).possibilities).toEqual(['s1/r1@1 InDomain']);
  });

  it('inherited causes keep their S1 attribution alongside new S2 causes, even when both are Invalid', () => {
    const mixed = key(
      s2Of([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { concept: { system: 'demo-cs', code: 7 }, supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]),
      's1/r1',
    );
    expect(view(mixed)).toEqual({
      s1Status: 'UnresolvedRevision',
      possibilities: ['s1/r1@1 InDomain', 's1/r1@2 Unresolved[Invalid/CodeMalformed]'],
      candidate: true,
      inheritedCauses: ['Missing'],
      causes: ['Missing', 'Invalid'],
    });
    const cycle = key(s2Of([rev('s1', 'r41', '1', { concept: { system: 'demo-cs', code: 7 } }), rev('s1', 'r41', '2', { supersedes: sup('s1', 'r41', '3'), author: AMEND }), rev('s1', 'r41', '3', { supersedes: sup('s1', 'r41', '2'), author: AMEND })]), 's1/r41');
    expect(cycle.causes).toEqual(['Invalid']);
    expect(cycle.inheritedDefects.map((d) => [d.cause, d.reason])).toEqual([['Invalid', 'Cycle']]);
    expect(cycle.possibilities.map((p) => show(p))[0]).toBe('s1/r41@1 Unresolved[Invalid/CodeMalformed]');
  });
});

describe('S2: determinism and purity', () => {
  const revisions = [
    rev('s1', 'r1', '1'),
    rev('s1', 'r1', '2', { concept: Y, supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } }),
    rev('s1', 'r14', '1'),
    rev('s1', 'r14', '1', { concept: OTHER }),
    rev('s2', 'r9', '2', { supersedes: sup('s2', 'r9', '1'), author: AMEND }),
    rev('s1', 'r3', '1', { concept: undefined }),
  ];
  const retractions = [retr('x1', 'r1', sup('s1', 'r1', '2'), { actor: 'u2' })];
  const base = s2Of(revisions, retractions);

  it('is invariant under input permutation and identical duplicate occurrences', () => {
    expect(s2Of([...revisions].reverse(), retractions)).toEqual(base);
    expect(s2Of([revisions[3]!, ...revisions, revisions[0]!, revisions[5]!], [...retractions, ...retractions])).toEqual(base);
  });

  it('is invariant under the order of keys in the S1 result', () => {
    const s1 = s1Of(revisions, retractions);
    const shuffled: S1Result = { ...s1, keys: [...s1.keys].reverse() };
    expect(experimentalIdentifyCandidates({ s1: shuffled, valueSet: PIN, expansion: VS })).toEqual(base);
  });

  it('does not mutate (deep-frozen) inputs', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object') {
        Object.values(o).forEach(deepFreeze);
        Object.freeze(o);
      }
      return o;
    };
    const s1 = deepFreeze(s1Of(revisions, retractions));
    const expansion = deepFreeze({ ...VS, expansion: VS.expansion.map((c) => ({ ...c })), coveredSystems: [...VS.coveredSystems] });
    const before = JSON.stringify([s1, expansion]);
    expect(experimentalIdentifyCandidates({ s1, valueSet: PIN, expansion })).toEqual(base);
    expect(JSON.stringify([s1, expansion])).toBe(before);
  });
});

describe('S2: configuration is validated, never treated as patient evidence', () => {
  const s1 = s1Of([rev('s1', 'r1', '1')]);
  const run = (valueSet: unknown, expansion: unknown, s1In: unknown = s1) => () =>
    experimentalIdentifyCandidates({ s1: s1In, valueSet, expansion } as never);

  it.each([
    ['mismatched pin (other version)', PIN, { ...VS, id: 'demo-vs/item-x@2' }],
    ['missing expansion', PIN, undefined],
    ['missing pin', undefined, VS],
    ['empty pin', '', { ...VS, id: '' }],
    ['expansion without code list', PIN, { id: PIN, coveredSystems: ['demo-cs'] }],
    ['expansion without covered systems', PIN, { id: PIN, expansion: VS.expansion }],
    ['malformed expansion entry', PIN, { ...VS, expansion: [{ system: 'demo-cs', code: 7 }] }],
    ['expansion code in an uncovered system', PIN, { ...VS, expansion: [OTHER] }],
    ['empty expansion code', PIN, { ...VS, expansion: [{ system: 'demo-cs', code: '' }] }],
    ['whitespace-only expansion code', PIN, { ...VS, expansion: [{ system: 'demo-cs', code: '\u2003' }] }],
    ['whitespace-only covered system', PIN, { ...VS, coveredSystems: ['demo-cs', ' '] }],
    ['whitespace-only pin', ' ', { ...VS, id: ' ' }],
  ])('%s → S2ConfigurationError', (_n, valueSet, expansion) => {
    expect(run(valueSet, expansion)).toThrow(S2ConfigurationError);
  });

  it('rejects input that is not an experimental S1 result', () => {
    expect(run(PIN, VS, { keys: [] })).toThrow(S2ConfigurationError);
  });

  it('an explicitly supplied empty expansion is honoured, not an error: covered codes are then OutOfDomain', () => {
    const r = experimentalIdentifyCandidates({ s1, valueSet: PIN, expansion: { id: PIN, expansion: [], coveredSystems: ['demo-cs'] } });
    expect(key(r, 's1/r1').possibilities.map((p) => show(p))).toEqual(['s1/r1@1 OutOfDomain']);
  });

  it('reports the expansion pin used', () => {
    expect(experimentalIdentifyCandidates({ s1, valueSet: PIN, expansion: VS }).valueSet).toBe(PIN);
  });
});
