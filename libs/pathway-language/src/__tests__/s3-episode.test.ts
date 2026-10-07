/**
 * EXPERIMENTAL, NONCLINICAL. Independent tests of the S3 same-episode check. Expectations are
 * derived by hand from the contract (evidence-query-to-predicate-contract.md §1.2, §1.6, §1.7,
 * §2, §2.2, §2.4 where it states general context rules) and from S1/S2 behaviour fixed by their
 * own tests; none is copied from output. EpisodeRef syntax is undefined beyond "a JSON string";
 * the blank-string cases assert only that the check stops (README).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  EpisodeCheckConfigurationError,
  EpisodeRefSyntaxUnspecifiedError,
  S2ConfigurationError,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCheckEpisodeScope,
  experimentalIdentifyCandidates,
  experimentalResolveRevisionHistory,
  type EpisodeBinding,
  type EpisodeCheckResult,
  type JsonValue,
  type KeyEpisodeScope,
  type PossibleEpisodeScope,
  type S1Result,
  type ValueSetExpansion,
} from '../index';
import { FIXTURE_DIR } from './support/fixture-runner';

const ENV = { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] } as const;
const PIN = 'demo-vs/item-x@1';
const VS: ValueSetExpansion = { id: PIN, expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] };
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
const E1: EpisodeBinding = { known: 'E1' };

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
const checkS1 = (s1: S1Result, ctx: EpisodeBinding = E1): EpisodeCheckResult =>
  experimentalCheckEpisodeScope({ s1, valueSet: PIN, expansion: VS, rule: SAME_EPISODE_RULE, contextEpisode: ctx });
const check = (revisions: JsonValue[], retractions: JsonValue[] = [], ctx: EpisodeBinding = E1) => checkS1(s1Of(revisions, retractions), ctx);
function key(r: EpisodeCheckResult, k: string): KeyEpisodeScope {
  const found = r.keys.find((x) => `${x.key.source}/${x.key.localId}` === k);
  if (!found) throw new Error(`key ${k} missing`);
  return found;
}
/** `s1/r1@1 Matches`, `s1/r1@1 Unresolved[Missing@record/FieldAbsent:episode]`, `excluded`, … */
function show(p: PossibleEpisodeScope): string {
  if (p.kind !== 'node') return p.kind;
  const r = p.node.revision;
  const id = `${r.source}/${r.localId}@${r.revision}`;
  const e = p.episode;
  return e.outcome === 'Unresolved' ? `${id} Unresolved[${e.findings.map((f) => `${f.cause}@${f.origin}/${f.reason}`).join(',')}]` : `${id} ${e.outcome}`;
}
const shown = (r: EpisodeCheckResult, k: string) => key(r, k).possibilities.map(show);
const ctxFinding = (c: string) => `${c}@context.episode/ContextUnknown:episode`;

describe('same-episode check: one current revision', () => {
  it('equal known episodes → Matches, carrying the record episode', () => {
    const p = key(check([rev('s1', 'r1', '1')]), 's1/r1').possibilities[0];
    expect(p).toMatchObject({ candidacy: 'InDomain', s2Findings: [], episode: { outcome: 'Matches', recordEpisode: 'E1' } });
  });

  it('different known episodes → DoesNotMatch (OtherEpisode), with both identifiers (contract §2.2)', () => {
    const p = key(check([rev('s1', 'r1', '1', { episode: 'E0' })]), 's1/r1').possibilities[0];
    expect(p).toMatchObject({ episode: { outcome: 'DoesNotMatch', reason: 'OtherEpisode', recordEpisode: 'E0', contextEpisode: 'E1' } });
  });

  it('identity is exact: no case folding, no trimming', () => {
    for (const episode of ['e1', ' E1', 'E1\t', ' E1']) {
      expect(shown(check([rev('s1', 'r1', '1', { episode })]), 's1/r1')).toEqual(['s1/r1@1 DoesNotMatch']);
    }
  });

  it('membership is never inferred from the encounter: only the episode field decides', () => {
    // Same episode, other encounter: still Matches. Same encounter, other episode: still DoesNotMatch.
    expect(shown(check([rev('s1', 'r1', '1', { encounter: 'N0' })]), 's1/r1')).toEqual(['s1/r1@1 Matches']);
    expect(shown(check([rev('s1', 'r1', '1', { episode: 'E0' })]), 's1/r1')).toEqual(['s1/r1@1 DoesNotMatch']);
    // An absent episode is Missing even when the encounter equals the context's.
    expect(shown(check([rev('s1', 'r1', '1', { episode: undefined })]), 's1/r1')).toEqual(['s1/r1@1 Unresolved[Missing@record/FieldAbsent:episode]']);
  });

  it('absent record episode → Unresolved{Missing} attributed to the record, never a mismatch (contract §2.2)', () => {
    const p = key(check([rev('s1', 'r1', '1', { episode: undefined })]), 's1/r1').possibilities[0];
    expect(p).toMatchObject({ episode: { outcome: 'Unresolved', findings: [{ cause: 'Missing', origin: 'record', reason: 'FieldAbsent:episode' }] } });
  });

  it.each([
    ['number', 7],
    ['null (malformed, not absent: contract §1.2)', null],
    ['boolean', true],
    ['object', { id: 'E1' }],
    ['array', ['E1']],
  ] as [string, JsonValue][])('wrong-type record episode (%s) → Unresolved{Invalid}, never a mismatch (contract §1.2, §1.7)', (_n, episode) => {
    expect(shown(check([rev('s1', 'r1', '1', { episode })]), 's1/r1')).toEqual(['s1/r1@1 Unresolved[Invalid@record/FieldMalformed:episode]']);
  });

  it('unknown context episode keeps its causes unchanged (case 12): a known record episode cannot decide against it', () => {
    expect(shown(check([rev('s1', 'r1', '1')], [], { unknown: ['Conflicting'] }), 's1/r1')).toEqual([`s1/r1@1 Unresolved[${ctxFinding('Conflicting')}]`]);
    expect(shown(check([rev('s1', 'r1', '1', { episode: 'E0' })], [], { unknown: ['Conflicting'] }), 's1/r1')).toEqual([
      `s1/r1@1 Unresolved[${ctxFinding('Conflicting')}]`,
    ]);
  });

  it('several context causes, given in any order, are all kept in Stage A order and never relabelled', () => {
    const expected = [`s1/r1@1 Unresolved[${ctxFinding('Missing')},${ctxFinding('Conflicting')},${ctxFinding('Invalid')}]`];
    expect(shown(check([rev('s1', 'r1', '1')], [], { unknown: ['Invalid', 'Conflicting', 'Missing'] }), 's1/r1')).toEqual(expected);
    expect(shown(check([rev('s1', 'r1', '1')], [], { unknown: ['Missing', 'Invalid', 'Conflicting'] }), 's1/r1')).toEqual(expected);
  });

  it('record and context problems accumulate, each with its own origin', () => {
    expect(shown(check([rev('s1', 'r1', '1', { episode: undefined })], [], { unknown: ['Conflicting'] }), 's1/r1')).toEqual([
      `s1/r1@1 Unresolved[Missing@record/FieldAbsent:episode,${ctxFinding('Conflicting')}]`,
    ]);
    expect(shown(check([rev('s1', 'r1', '1', { episode: null })], [], { unknown: ['Unavailable'] }), 's1/r1')).toEqual([
      `s1/r1@1 Unresolved[Invalid@record/FieldMalformed:episode,${ctxFinding('Unavailable')}]`,
    ]);
  });
});

describe('same-episode check: unspecified EpisodeRef syntax stops the check', () => {
  it.each([
    ['empty', ''],
    ['ASCII whitespace-only', '   '],
    ['Unicode whitespace-only', '  '],
  ])('%s record episode → EpisodeRefSyntaxUnspecifiedError, not Invalid, Matches or DoesNotMatch', (_n, episode) => {
    expect(() => check([rev('s1', 'r1', '1', { episode })])).toThrow(EpisodeRefSyntaxUnspecifiedError);
    // The gap is the same whatever the context: whether `Invalid` joins the context causes is undecided.
    expect(() => check([rev('s1', 'r1', '1', { episode })], [], { unknown: ['Conflicting'] })).toThrow(EpisodeRefSyntaxUnspecifiedError);
  });

  it.each([['empty', ''], ['whitespace-only', '  ']])('%s known context episode → EpisodeRefSyntaxUnspecifiedError', (_n, known) => {
    expect(() => check([rev('s1', 'r1', '1')], [], { known })).toThrow(EpisodeRefSyntaxUnspecifiedError);
  });

  it('a blank episode on an out-of-domain possibility is never read, so nothing stops', () => {
    const y = { system: 'demo-cs', code: 'item-y' };
    expect(shown(check([rev('s1', 'r8', '1', { concept: y, episode: '' })]), 's1/r8')).toEqual(['s1/r8@1 NotEvaluated']);
  });
});

describe('same-episode check: S1 and S2 boundaries', () => {
  it('unresolved correction history: both revisions checked, no winner, S1 defect kept (case 18 shape)', () => {
    const k = key(check([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { episode: 'E0', supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]), 's1/r1');
    expect(k.possibilities.map(show)).toEqual(['s1/r1@1 Matches', 's1/r1@2 DoesNotMatch']);
    expect(k).toMatchObject({ s1Status: 'UnresolvedRevision', candidate: true, inheritedS1Causes: ['Missing'] });
    expect(k.inheritedS1Defects.map((d) => d.reason)).toEqual(['CorrectionAuthorityMissing']);
  });

  it('unresolved history where neither alternative can be decided keeps both alternatives and every cause', () => {
    const k = key(
      check([rev('s1', 'r1', '1', { episode: undefined }), rev('s1', 'r1', '2', { episode: 7, supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]),
      's1/r1',
    );
    expect(k.possibilities.map(show)).toEqual(['s1/r1@1 Unresolved[Missing@record/FieldAbsent:episode]', 's1/r1@2 Unresolved[Invalid@record/FieldMalformed:episode]']);
    expect(k.inheritedS1Causes).toEqual(['Missing']);
  });

  it('authorized correction to another episode: only the current revision is checked', () => {
    expect(shown(check([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { episode: 'E0', supersedes: sup('s1', 'r1', '1'), author: AMEND })]), 's1/r1')).toEqual([
      's1/r1@2 DoesNotMatch',
    ]);
    // …and the reverse: a correction INTO the episode matches; the superseded revision is not read.
    expect(shown(check([rev('s1', 'r1', '1', { episode: 'E0' }), rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: AMEND })]), 's1/r1')).toEqual([
      's1/r1@2 Matches',
    ]);
  });

  it('digest-qualified variants naming different episodes are checked separately; the payload conflict stays', () => {
    const s1 = s1Of([rev('s1', 'r14', '1'), rev('s1', 'r14', '1', { episode: 'E0', provenance: { acquisition: 'a1' } })]);
    const k = key(checkS1(s1), 's1/r14');
    const digests = new Set(s1.keys[0]!.revisions[0]!.variants.map((v) => v.digest));
    expect(k.possibilities.map((p) => (p.kind === 'node' ? p.episode.outcome : p.kind)).sort()).toEqual(['DoesNotMatch', 'Matches']);
    expect(new Set(k.possibilities.map((p) => (p.kind === 'node' ? p.node.digest : p.kind)))).toEqual(digests);
    expect(k.inheritedS1Causes).toEqual(['Conflicting']);
    expect(k.inheritedS1Defects.map((d) => d.reason)).toEqual(['PayloadConflict']);
  });

  it('`excluded` and `unknown` are carried unchanged next to checked revisions (cases 31, 26 shapes)', () => {
    expect(shown(check([rev('s1', 'r42', '1')], [retr('x42', 'r42', sup('s1', 'r42', '1'), { actor: 'u2' })]), 's1/r42')).toEqual(['s1/r42@1 Matches', 'excluded']);
    expect(shown(check([rev('s1', 'r9', '2', { episode: 'E0', supersedes: sup('s1', 'r9', '1'), author: AMEND })]), 's1/r9')).toEqual([
      's1/r9@2 DoesNotMatch',
      'unknown',
    ]);
  });

  it('unresolved S2 candidacy alongside a decidable episode: both kept; out-of-domain is NotEvaluated, never Missing', () => {
    const p = key(check([rev('s1', 'r10', '1', { concept: { system: 'other-cs', code: 'item-x' }, episode: 'E0' })]), 's1/r10').possibilities[0];
    expect(p).toMatchObject({ candidacy: 'Unresolved', s2Findings: [{ cause: 'Unavailable', reason: 'TerminologyUnavailable' }], episode: { outcome: 'DoesNotMatch' } });
    const y = { system: 'demo-cs', code: 'item-y' };
    expect(key(check([rev('s1', 'r8', '1', { concept: y, episode: undefined })]), 's1/r8').possibilities[0]).toMatchObject({
      candidacy: 'OutOfDomain',
      episode: { outcome: 'NotEvaluated', reason: 'OutOfDomain' },
    });
  });

  it('Retracted and NoRecord keys contribute nothing', () => {
    expect(key(check([rev('s1', 'r1', '1')], [retr('x1', 'r1', sup('s1', 'r1', '1'))]), 's1/r1')).toMatchObject({ s1Status: 'Retracted', possibilities: [] });
    const r = check([rev('s1', 'r1', '1'), rev('s2', 'r21', '1', { supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(key(r, 's2/r21')).toMatchObject({ s1Status: 'NoRecord', candidate: false, possibilities: [] });
  });
});

describe('same-episode check: one snapshot', () => {
  const before = s1Of([rev('s1', 'r1', '1')]);
  const staleS2 = experimentalIdentifyCandidates({ s1: before, valueSet: PIN, expansion: VS });
  const corrected = s1Of([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { episode: 'E0', supersedes: sup('s1', 'r1', '1'), author: AMEND })]);

  it('a precomputed S2 (possibly of another snapshot) is rejected; the current S1 is what gets checked', () => {
    expect(() =>
      experimentalCheckEpisodeScope({ s1: corrected, s2: staleS2, valueSet: PIN, expansion: VS, rule: SAME_EPISODE_RULE, contextEpisode: E1 } as never),
    ).toThrow(EpisodeCheckConfigurationError);
    expect(shown(checkS1(before), 's1/r1')).toEqual(['s1/r1@1 Matches']);
    expect(shown(checkS1(corrected), 's1/r1')).toEqual(['s1/r1@2 DoesNotMatch']);
  });

  it('nor can another stage’s result, such as an encounter check, be supplied alongside', () => {
    expect(() =>
      experimentalCheckEpisodeScope({ s1: before, encounter: {}, valueSet: PIN, expansion: VS, rule: SAME_EPISODE_RULE, contextEpisode: E1 } as never),
    ).toThrow(EpisodeCheckConfigurationError);
  });
});

describe('same-episode check: determinism, purity and detachment', () => {
  const revisions = [
    rev('s1', 'r1', '1'),
    rev('s1', 'r1', '2', { episode: 'E0', supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } }),
    rev('s1', 'r14', '1'),
    rev('s1', 'r14', '1', { episode: 7 }),
    rev('s2', 'r9', '2', { episode: undefined, supersedes: sup('s2', 'r9', '1'), author: AMEND }),
    rev('s1', 'r8', '1', { concept: { system: 'demo-cs', code: 'item-y' } }),
  ];
  const retractions = [retr('x1', 'r1', sup('s1', 'r1', '2'), { actor: 'u2' })];
  const base = check(revisions, retractions);

  it('is invariant under input permutation, identical duplicates and S1 key order', () => {
    expect(check([...revisions].reverse(), [...retractions])).toEqual(base);
    expect(check([revisions[3]!, ...revisions, revisions[0]!], [...retractions, ...retractions])).toEqual(base);
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
    const rule = deepFreeze(JSON.parse(JSON.stringify(SAME_EPISODE_RULE)));
    const ctx = deepFreeze({ known: 'E1' });
    const before = JSON.stringify([s1, expansion, rule, ctx]);
    expect(experimentalCheckEpisodeScope({ s1, valueSet: PIN, expansion, rule, contextEpisode: ctx })).toEqual(base);
    expect(JSON.stringify([s1, expansion, rule, ctx])).toBe(before);
  });

  it('the result is detached: later edits to the S1 result or the context binding cannot reach it', () => {
    const s1 = s1Of(revisions, retractions);
    const ctx = { unknown: ['Conflicting'] };
    const r = checkS1(s1, ctx as EpisodeBinding);
    const snapshot = JSON.stringify(r);
    (s1.keys[0]!.causes as string[]).push('Invalid');
    (s1.keys[0]!.activeDefects as unknown[]).length = 0;
    ctx.unknown.push('Missing');
    expect(JSON.stringify(r)).toBe(snapshot);
  });

  it('the result is deep-frozen', () => {
    expect(Object.isFrozen(base)).toBe(true);
    expect(Object.isFrozen(base.keys[0]!.possibilities)).toBe(true);
    expect(() => (base.keys as unknown[]).push({})).toThrow(TypeError);
    expect(() => {
      (base.keys[0]!.inheritedS1Causes as string[]).length = 0;
    }).toThrow(TypeError);
  });
});

describe('same-episode check: rule and configuration input', () => {
  const s1 = s1Of([rev('s1', 'r1', '1', { episode: 7 })]);
  const run = (over: Record<string, unknown>) => () =>
    experimentalCheckEpisodeScope({ s1, valueSet: PIN, expansion: VS, rule: SAME_EPISODE_RULE, contextEpisode: E1, ...over } as never);

  it('consumes the authored rule exactly as the pinned query states it', () => {
    const query = JSON.parse(readFileSync(join(FIXTURE_DIR, 'query', 'q.demo.json'), 'utf8'));
    expect(query.query.contract.admissible.episode).toEqual(SAME_EPISODE_RULE);
    expect(run({ rule: query.query.contract.admissible.episode })).not.toThrow();
  });

  const sparse: unknown[] = [];
  sparse[1] = 'Missing';
  it.each([
    ['no rule (never an implicit default)', { rule: undefined }],
    ['the encounter rule', { rule: SAME_ENCOUNTER_RULE }],
    ['operands swapped (recognized, not interpreted)', { rule: { eq: [{ ref: 'ctx.episode' }, { field: ['c', 'episode'] }] } }],
    ['another operator', { rule: { ne: [{ field: ['c', 'episode'] }, { ref: 'ctx.episode' }] } }],
    ['context episode missing', { contextEpisode: undefined }],
    ['context episode null', { contextEpisode: null }],
    ['known episode not a string', { contextEpisode: { known: 5 } }],
    ['known episode null', { contextEpisode: { known: null } }],
    ['unknown with no causes', { contextEpisode: { unknown: [] } }],
    ['unknown not an array', { contextEpisode: { unknown: 'Conflicting' } }],
    ['unknown with an unrecognized cause', { contextEpisode: { unknown: ['Bogus'] } }],
    ['unknown with a repeated cause', { contextEpisode: { unknown: ['Conflicting', 'Conflicting'] } }],
    ['unknown with a sparse hole', { contextEpisode: { unknown: sparse } }],
    ['both known and unknown', { contextEpisode: { known: 'E1', unknown: ['Missing'] } }],
    ['an unrecognized binding form', { contextEpisode: { episode: 'E1' } }],
    ['not an S1 result', { s1: { keys: [] } }],
    ['an encounter binding under the wrong name', { contextEncounter: { known: 'N1' } }],
  ])('%s → EpisodeCheckConfigurationError', (_n, over) => {
    expect(run(over)).toThrow(EpisodeCheckConfigurationError);
  });

  it('a non-object input → EpisodeCheckConfigurationError', () => {
    expect(() => experimentalCheckEpisodeScope(null as never)).toThrow(EpisodeCheckConfigurationError);
  });

  it.each([
    ['mismatched pin', { expansion: { ...VS, id: 'demo-vs/item-x@2' } }],
    ['missing expansion', { expansion: undefined }],
  ])('S2 parameters are validated by S2 (%s → S2ConfigurationError)', (_n, over) => {
    expect(run(over)).toThrow(S2ConfigurationError);
  });

  it('a malformed RECORD episode is patient uncertainty, not a configuration error', () => {
    expect(shown(run({})(), 's1/r1')).toEqual(['s1/r1@1 Unresolved[Invalid@record/FieldMalformed:episode]']);
  });
});
