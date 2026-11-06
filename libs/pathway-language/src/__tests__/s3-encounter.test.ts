/**
 * EXPERIMENTAL, NONCLINICAL. Independent tests of the S3 same-encounter check. Expectations are
 * derived by hand from the contract (evidence-query-to-predicate-contract.md §1.2, §1.6, §2.2,
 * §2.4) and from S1/S2 behaviour already fixed by their own tests; none is copied from output.
 * Encounter syntax beyond "a JSON string" is undefined (README), so no test asserts it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  EncounterCheckConfigurationError,
  S2ConfigurationError,
  SAME_ENCOUNTER_RULE,
  experimentalCheckEncounterScope,
  experimentalIdentifyCandidates,
  experimentalResolveRevisionHistory,
  type EncounterBinding,
  type EncounterCheckResult,
  type JsonValue,
  type KeyEncounterScope,
  type PossibleEncounterScope,
  type S1Result,
  type ValueSetExpansion,
} from '../index';
import { FIXTURE_DIR } from './support/fixture-runner';

const ENV = { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] } as const;
const PIN = 'demo-vs/item-x@1';
const VS: ValueSetExpansion = { id: PIN, expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] };
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
const N1: EncounterBinding = { known: 'N1' };

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
function check(revisions: JsonValue[], retractions: JsonValue[] = [], ctx: EncounterBinding = N1): EncounterCheckResult {
  return checkS1(s1Of(revisions, retractions), ctx);
}
const checkS1 = (s1: S1Result, ctx: EncounterBinding = N1): EncounterCheckResult =>
  experimentalCheckEncounterScope({ s1, valueSet: PIN, expansion: VS, rule: SAME_ENCOUNTER_RULE, contextEncounter: ctx });
function key(r: EncounterCheckResult, k: string): KeyEncounterScope {
  const found = r.keys.find((x) => `${x.key.source}/${x.key.localId}` === k);
  if (!found) throw new Error(`key ${k} missing`);
  return found;
}
/** `s1/r1@1 Matches`, `s1/r1@1 Unresolved[Missing@record/FieldAbsent:encounter]`, `… NotEvaluated`, markers; `#n` = variant index. */
function show(p: PossibleEncounterScope, digests: string[] = []): string {
  if (p.kind !== 'node') return p.kind;
  const r = p.node.revision;
  const id = `${r.source}/${r.localId}@${r.revision}` + (p.node.digest ? `#${digests.indexOf(p.node.digest)}` : '');
  const e = p.encounter;
  return e.outcome === 'Unresolved' ? `${id} Unresolved[${e.findings.map((f) => `${f.cause}@${f.origin}/${f.reason}`).join(',')}]` : `${id} ${e.outcome}`;
}
const shown = (r: EncounterCheckResult, k: string) => key(r, k).possibilities.map((p) => show(p));

describe('same-encounter check: one current revision', () => {
  it('known record encounter equal to the known evaluation encounter → Matches', () => {
    expect(shown(check([rev('s1', 'r1', '1')]), 's1/r1')).toEqual(['s1/r1@1 Matches']);
  });

  it('different known encounters → DoesNotMatch (OtherEncounter), with both identifiers (case 9)', () => {
    const p = key(check([rev('s1', 'r5', '1', { encounter: 'N0' })]), 's1/r5').possibilities[0];
    expect(p).toMatchObject({ encounter: { outcome: 'DoesNotMatch', reason: 'OtherEncounter', recordEncounter: 'N0', contextEncounter: 'N1' } });
  });

  it('compares identifiers exactly: no case folding, no trimming (case 107)', () => {
    for (const encounter of ['n1', ' N1', 'N1\t', '\u00a0N1']) {
      expect(shown(check([rev('s1', 'r5', '1', { encounter })]), 's1/r5')).toEqual(['s1/r5@1 DoesNotMatch']);
    }
  });

  it('absent record encounter → Unresolved{Missing} attributed to the record (cases 10, 11)', () => {
    expect(shown(check([rev('s1', 'r4', '1', { encounter: undefined })]), 's1/r4')).toEqual(['s1/r4@1 Unresolved[Missing@record/FieldAbsent:encounter]']);
  });

  it.each([
    ['number', 7],
    ['null (malformed, not absent)', null],
    ['object', { id: 'N1' }],
    ['empty string (case 105)', ''],
    ['ASCII whitespace-only (case 106)', '   '],
    ['Unicode whitespace-only (case 106)', '\u00a0\u2003'],
    ['line terminators only', '\n\u2028'],
  ] as [string, JsonValue][])('malformed record encounter (%s) → Unresolved{Invalid}', (_n, encounter) => {
    expect(shown(check([rev('s1', 'r4', '1', { encounter })]), 's1/r4')).toEqual(['s1/r4@1 Unresolved[Invalid@record/FieldMalformed:encounter]']);
  });

  it('unresolved evaluation encounter keeps its own causes, in Stage A order, even when the record encounter is known', () => {
    const ctx: EncounterBinding = { unknown: ['Conflicting', 'Missing'] };
    const expected = ['Unresolved[Missing@context.encounter/ContextUnknown:encounter,Conflicting@context.encounter/ContextUnknown:encounter]'];
    expect(shown(check([rev('s1', 'r1', '1')], [], ctx), 's1/r1')).toEqual(expected.map((e) => `s1/r1@1 ${e}`));
    // A known but different record encounter cannot be a mismatch against an unknown context.
    expect(shown(check([rev('s1', 'r1', '1', { encounter: 'N0' })], [], ctx), 's1/r1')).toEqual(expected.map((e) => `s1/r1@1 ${e}`));
  });

  it('independent record and context problems accumulate, each with its own origin (contract §2.2)', () => {
    expect(shown(check([rev('s1', 'r4', '1', { encounter: undefined })], [], { unknown: ['Conflicting'] }), 's1/r4')).toEqual([
      's1/r4@1 Unresolved[Missing@record/FieldAbsent:encounter,Conflicting@context.encounter/ContextUnknown:encounter]',
    ]);
    expect(shown(check([rev('s1', 'r4', '1', { encounter: 7 })], [], { unknown: ['Unavailable'] }), 's1/r4')).toEqual([
      's1/r4@1 Unresolved[Invalid@record/FieldMalformed:encounter,Unavailable@context.encounter/ContextUnknown:encounter]',
    ]);
  });
});

describe('same-encounter check: S1 and S2 boundaries', () => {
  it('unresolved history: one matching and one nonmatching possibility, no winner, S1 causes kept', () => {
    const k = key(check([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { encounter: 'N0', supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]), 's1/r1');
    expect(k.possibilities.map((p) => show(p))).toEqual(['s1/r1@1 Matches', 's1/r1@2 DoesNotMatch']);
    expect(k.inheritedS1Causes).toEqual(['Missing']);
    expect(k.inheritedS1Defects.map((d) => d.reason)).toEqual(['CorrectionAuthorityMissing']);
    expect(k.s1Status).toBe('UnresolvedRevision');
  });

  it('digest-qualified variants with different encounters are checked separately; the payload conflict stays', () => {
    const s1 = s1Of([rev('s1', 'r14', '1'), rev('s1', 'r14', '1', { encounter: 'N0', provenance: { acquisition: 'a1' } })]);
    const k = key(checkS1(s1), 's1/r14');
    const digests = s1.keys[0]!.revisions[0]!.variants.map((v) => v.digest);
    const outcomes = new Map(k.possibilities.map((p) => [p.kind === 'node' ? p.node.digest : p.kind, p.kind === 'node' ? p.encounter.outcome : p.kind]));
    expect([...outcomes.values()].sort()).toEqual(['DoesNotMatch', 'Matches']);
    expect(new Set(outcomes.keys())).toEqual(new Set(digests));
    expect(k.inheritedS1Causes).toEqual(['Conflicting']);
    expect(k.inheritedS1Defects.map((d) => d.reason)).toEqual(['PayloadConflict']);
  });

  it('unresolved S2 candidacy alongside a decidable encounter: both kept, neither clears the other', () => {
    const other = { system: 'other-cs', code: 'item-x' };
    const match = key(check([rev('s1', 'r10', '1', { concept: other })]), 's1/r10').possibilities[0];
    expect(match).toMatchObject({ candidacy: 'Unresolved', s2Findings: [{ cause: 'Unavailable', reason: 'TerminologyUnavailable' }], encounter: { outcome: 'Matches' } });
    const miss = key(check([rev('s1', 'r10', '1', { concept: other, encounter: 'N0' })]), 's1/r10');
    expect(miss.possibilities[0]).toMatchObject({ candidacy: 'Unresolved', s2Findings: [{ cause: 'Unavailable' }], encounter: { outcome: 'DoesNotMatch' } });
    expect(miss.candidate).toBe(true);
  });

  it('out-of-domain possibilities are NotEvaluated, never an encounter mismatch or Missing (case 24 shape)', () => {
    const y = { system: 'demo-cs', code: 'item-y' };
    expect(shown(check([rev('s1', 'r8', '1', { concept: y, encounter: 'N0' })]), 's1/r8')).toEqual(['s1/r8@1 NotEvaluated']);
    expect(shown(check([rev('s1', 'r8', '1', { concept: y, encounter: undefined })]), 's1/r8')).toEqual(['s1/r8@1 NotEvaluated']);
    expect(key(check([rev('s1', 'r8', '1', { concept: y })]), 's1/r8').possibilities[0]).toMatchObject({
      candidacy: 'OutOfDomain',
      encounter: { outcome: 'NotEvaluated', reason: 'OutOfDomain' },
    });
  });

  it('`excluded` and `unknown` are carried unchanged (cases 31 and 26 shapes)', () => {
    expect(shown(check([rev('s1', 'r42', '1')], [retr('x42', 'r42', sup('s1', 'r42', '1'), { actor: 'u2' })]), 's1/r42')).toEqual([
      's1/r42@1 Matches',
      'excluded',
    ]);
    expect(shown(check([rev('s1', 'r9', '2', { encounter: 'N0', supersedes: sup('s1', 'r9', '1'), author: AMEND })]), 's1/r9')).toEqual([
      's1/r9@2 DoesNotMatch',
      'unknown',
    ]);
  });

  it('authorized correction to another encounter: only the current revision is checked (case 25)', () => {
    expect(shown(check([rev('s1', 'r16', '1'), rev('s1', 'r16', '2', { encounter: 'N0', supersedes: sup('s1', 'r16', '1'), author: AMEND })]), 's1/r16')).toEqual([
      's1/r16@2 DoesNotMatch',
    ]);
  });

  it('Retracted and NoRecord keys have no possibility and no finding (cases 32, 22)', () => {
    const retracted = key(check([rev('s1', 'r1', '1')], [retr('x1', 'r1', sup('s1', 'r1', '1'))]), 's1/r1');
    expect(retracted).toMatchObject({ s1Status: 'Retracted', candidate: false, possibilities: [], inheritedS1Causes: [] });
    const r = check([rev('s1', 'r1', '1'), rev('s2', 'r21', '1', { supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(key(r, 's2/r21')).toMatchObject({ s1Status: 'NoRecord', candidate: false, possibilities: [] });
  });
});

describe('same-encounter check: S1 and S2 always come from one snapshot (review of b8eb6fe)', () => {
  const before = s1Of([rev('s1', 'r1', '1')]); // revision 1, encounter N1
  const staleS2 = experimentalIdentifyCandidates({ s1: before, valueSet: PIN, expansion: VS });
  const stale = (after: S1Result) => () =>
    experimentalCheckEncounterScope({ s1: after, s2: staleS2, valueSet: PIN, expansion: VS, rule: SAME_ENCOUNTER_RULE, contextEncounter: N1 } as never);

  it('before any change, revision 1 matches N1', () => {
    expect(shown(checkS1(before), 's1/r1')).toEqual(['s1/r1@1 Matches']);
  });

  it('correction: the reviewer’s reproduction is rejected, and the current revision 2 (N0) is what gets checked', () => {
    const after = s1Of([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { encounter: 'N0', supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(stale(after)).toThrow(EncounterCheckConfigurationError);
    expect(shown(checkS1(after), 's1/r1')).toEqual(['s1/r1@2 DoesNotMatch']);
  });

  it('retraction: an old S2 cannot be supplied, and the retracted key contributes nothing', () => {
    const after = s1Of([rev('s1', 'r1', '1')], [retr('x1', 'r1', sup('s1', 'r1', '1'))]);
    expect(stale(after)).toThrow(EncounterCheckConfigurationError);
    expect(key(checkS1(after), 's1/r1')).toMatchObject({ s1Status: 'Retracted', possibilities: [] });
  });

  it('changed payload under the same RevisionRef: each variant is read from the new S1, never from an old classification', () => {
    const replaced = s1Of([rev('s1', 'r1', '1', { encounter: 'N0' })]);
    expect(stale(replaced)).toThrow(EncounterCheckConfigurationError);
    expect(shown(checkS1(replaced), 's1/r1')).toEqual(['s1/r1@1 DoesNotMatch']);
    const conflicted = s1Of([rev('s1', 'r1', '1'), rev('s1', 'r1', '1', { encounter: 'N0', provenance: { acquisition: 'a1' } })]);
    expect(stale(conflicted)).toThrow(EncounterCheckConfigurationError);
    const k = key(checkS1(conflicted), 's1/r1');
    expect(k.possibilities.map((p) => (p.kind === 'node' ? p.encounter.outcome : p.kind)).sort()).toEqual(['DoesNotMatch', 'Matches']);
    expect(k.possibilities.every((p) => p.kind === 'node' && p.node.digest !== undefined)).toBe(true);
    expect(k.inheritedS1Causes).toEqual(['Conflicting']);
  });

  it('candidacy changes with the snapshot too: a correction out of domain is NotEvaluated, not a stale match', () => {
    const after = s1Of([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { concept: { system: 'demo-cs', code: 'item-y' }, supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(shown(checkS1(after), 's1/r1')).toEqual(['s1/r1@2 NotEvaluated']);
  });
});

describe('same-encounter check: determinism and purity', () => {
  const revisions = [
    rev('s1', 'r1', '1'),
    rev('s1', 'r1', '2', { encounter: 'N0', supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } }),
    rev('s1', 'r14', '1'),
    rev('s1', 'r14', '1', { encounter: 7 }),
    rev('s2', 'r9', '2', { encounter: undefined, supersedes: sup('s2', 'r9', '1'), author: AMEND }),
    rev('s1', 'r8', '1', { concept: { system: 'demo-cs', code: 'item-y' } }),
  ];
  const retractions = [retr('x1', 'r1', sup('s1', 'r1', '2'), { actor: 'u2' })];
  const base = check(revisions, retractions);

  it('is invariant under input permutation and identical duplicate occurrences', () => {
    expect(check([...revisions].reverse(), [...retractions])).toEqual(base);
    expect(check([revisions[3]!, ...revisions, revisions[0]!], [...retractions, ...retractions])).toEqual(base);
  });

  it('is invariant under the order of keys in the S1 result', () => {
    const s1 = s1Of(revisions, retractions);
    expect(checkS1({ ...s1, keys: [...s1.keys].reverse() })).toEqual(base);
  });

  it('does not mutate deep-frozen inputs', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object') {
        Object.values(o).forEach(deepFreeze);
        Object.freeze(o);
      }
      return o;
    };
    const s1 = deepFreeze(s1Of(revisions, retractions));
    const expansion = deepFreeze(JSON.parse(JSON.stringify(VS)));
    const rule = deepFreeze(JSON.parse(JSON.stringify(SAME_ENCOUNTER_RULE)));
    const ctx = deepFreeze({ known: 'N1' });
    const before = JSON.stringify([s1, expansion, rule, ctx]);
    expect(experimentalCheckEncounterScope({ s1, valueSet: PIN, expansion, rule, contextEncounter: ctx })).toEqual(base);
    expect(JSON.stringify([s1, expansion, rule, ctx])).toBe(before);
  });
});

describe('same-encounter check: rule and configuration input', () => {
  const s1 = s1Of([rev('s1', 'r1', '1', { encounter: 7 })]);
  const run = (over: Record<string, unknown>) => () =>
    experimentalCheckEncounterScope({ s1, valueSet: PIN, expansion: VS, rule: SAME_ENCOUNTER_RULE, contextEncounter: N1, ...over } as never);

  it('consumes the authored rule exactly as the pinned query states it', () => {
    const query = JSON.parse(readFileSync(join(FIXTURE_DIR, 'query', 'q.demo.json'), 'utf8'));
    expect(query.query.contract.admissible.encounter).toEqual(SAME_ENCOUNTER_RULE);
    expect(run({ rule: query.query.contract.admissible.encounter })).not.toThrow();
  });

  it.each([
    ['no rule (never an invisible default)', { rule: undefined }],
    ['the episode rule', { rule: { eq: [{ field: ['c', 'episode'] }, { ref: 'ctx.episode' }] } }],
    ['operands swapped (not interpreted, only recognized)', { rule: { eq: [{ ref: 'ctx.encounter' }, { field: ['c', 'encounter'] }] } }],
    ['another operator', { rule: { ne: [{ field: ['c', 'encounter'] }, { ref: 'ctx.encounter' }] } }],
    ['context encounter missing', { contextEncounter: undefined }],
    ['known encounter not a string', { contextEncounter: { known: 5 } }],
    ['known encounter empty (contract §2.4)', { contextEncounter: { known: '' } }],
    ['known encounter whitespace-only', { contextEncounter: { known: ' \u2003' } }],
    ['unknown with no causes', { contextEncounter: { unknown: [] } }],
    ['unknown with an unrecognized cause', { contextEncounter: { unknown: ['Bogus'] } }],
    ['unknown with a repeated cause', { contextEncounter: { unknown: ['Missing', 'Missing'] } }],
    ['both known and unknown', { contextEncounter: { known: 'N1', unknown: ['Missing'] } }],
    ['not an S1 result', { s1: { keys: [] } }],
    ['a precomputed S2 (it could be from another snapshot)', { s2: experimentalIdentifyCandidates({ s1, valueSet: PIN, expansion: VS }) }],
    ['any other unexpected field', { snapshot: 'snap-1' }],
  ])('%s → EncounterCheckConfigurationError', (_n, over) => {
    expect(run(over)).toThrow(EncounterCheckConfigurationError);
  });

  it.each([
    ['mismatched pin', { expansion: { ...VS, id: 'demo-vs/item-x@2' } }],
    ['missing expansion', { expansion: undefined }],
  ])('S2 parameters are validated by S2 (%s → S2ConfigurationError)', (_n, over) => {
    expect(run(over)).toThrow(S2ConfigurationError);
  });

  it('a malformed RECORD encounter is patient uncertainty, not a configuration error', () => {
    expect(run({})).not.toThrow();
    expect(shown(run({})() as EncounterCheckResult, 's1/r1')).toEqual(['s1/r1@1 Unresolved[Invalid@record/FieldMalformed:encounter]']);
  });
});
