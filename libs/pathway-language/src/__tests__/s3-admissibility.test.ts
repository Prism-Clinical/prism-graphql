/**
 * EXPERIMENTAL, NONCLINICAL. Independent tests of combined S3 admissibility per possible revision
 * (evidence-query-to-predicate-contract.md §2.7, cases 119–124). Every expected combined outcome,
 * reason list and finding list is written out by hand below; none is computed from the rule table
 * or copied from output.
 */
import {
  AdmissibilityCheckConfigurationError,
  AssertionKindCheckConfigurationError,
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  EncounterCheckConfigurationError,
  EpisodeCheckConfigurationError,
  S2ConfigurationError,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCheckAdmissibility,
  experimentalCheckEncounterScope,
  experimentalIdentifyCandidates,
  experimentalResolveRevisionHistory,
  type AdmissibilityCheckResult,
  type EncounterBinding,
  type EpisodeBinding,
  type JsonValue,
  type KeyAdmissibility,
  type PossibleAdmissibility,
  type S1Result,
  type ValueSetExpansion,
} from '../index';

const ENV = { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] } as const;
const PIN = 'demo-vs/item-x@1';
const VS: ValueSetExpansion = { id: PIN, expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] };
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
const CD = 'ClinicianDocumented';
const PR = 'PatientReport';
/** The three rules; this set allows ClinicianDocumented only, so PatientReport is a recognized mismatch. */
const ADM = { encounter: SAME_ENCOUNTER_RULE, episode: SAME_EPISODE_RULE, assertionKind: { in: [CD] } };
const N1: EncounterBinding = { known: 'N1' };
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
    assertionKind: CD,
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
const run = (s1: S1Result, over: Record<string, unknown> = {}): AdmissibilityCheckResult =>
  experimentalCheckAdmissibility({ s1, valueSet: PIN, expansion: VS, admissible: ADM, contextEncounter: N1, contextEpisode: E1, ...over } as never);
const check = (revisions: JsonValue[], retractions: JsonValue[] = [], over: Record<string, unknown> = {}) => run(s1Of(revisions, retractions), over);
function key(r: AdmissibilityCheckResult, k: string): KeyAdmissibility {
  const found = r.keys.find((x) => `${x.key.source}/${x.key.localId}` === k);
  if (!found) throw new Error(`key ${k} missing`);
  return found;
}
type Node = Extract<PossibleAdmissibility, { kind: 'node'; candidacy: 'InDomain' | 'Unresolved' }>;
function node(p: PossibleAdmissibility | undefined): Node {
  if (!p || p.kind !== 'node' || p.candidacy === 'OutOfDomain') throw new Error(`not a checked node: ${JSON.stringify(p)}`);
  return p;
}
/** `Admissible`, `Inadmissible[OtherEncounter]{Missing:episode/record/FieldAbsent:episode}`, … */
function show(p: PossibleAdmissibility): string {
  if (p.kind !== 'node') return p.kind;
  const a = p.admissibility;
  if (a.outcome === 'Admissible' || a.outcome === 'NotEvaluated') return a.outcome;
  const f = a.findings.map((x) => `${x.cause}:${x.rule}/${x.origin}/${x.reason}`).join(',');
  return a.outcome === 'Inadmissible' ? `Inadmissible[${a.reasons.join(',')}]{${f}}` : `UnresolvedAdmissibility{${f}}`;
}
const shown = (r: AdmissibilityCheckResult, k: string) => key(r, k).possibilities.map(show);

// ---- the 27 combinations -------------------------------------------------------------------

/** Field value producing each per-rule outcome, under N1 / E1 / {in: [ClinicianDocumented]}. */
const FIELD = {
  encounter: { M: 'N1', D: 'N0', U: undefined },
  episode: { M: 'E1', D: 'E0', U: undefined },
  assertionKind: { M: CD, D: PR, U: undefined },
} as const;
const AKNA = 'AssertionKindNotAllowed';
const OENC = 'OtherEncounter';
const OEPI = 'OtherEpisode';
const F_AK = 'Missing:assertionKind/record/FieldAbsent:assertionKind';
const F_ENC = 'Missing:encounter/record/FieldAbsent:encounter';
const F_EPI = 'Missing:episode/record/FieldAbsent:episode';
const ADMISSIBLE = 'Admissible';
const inad = (reasons: string[], findings: string[] = []) => `Inadmissible[${reasons.join(',')}]{${findings.join(',')}}`;
const unres = (findings: string[]) => `UnresolvedAdmissibility{${findings.join(',')}}`;

// encounter, episode, assertionKind → expected combined result (written by hand).
const TABLE: [string, string][] = [
  ['MMM', ADMISSIBLE],
  ['MMD', inad([AKNA])],
  ['MMU', unres([F_AK])],
  ['MDM', inad([OEPI])],
  ['MDD', inad([AKNA, OEPI])],
  ['MDU', inad([OEPI], [F_AK])],
  ['MUM', unres([F_EPI])],
  ['MUD', inad([AKNA], [F_EPI])],
  ['MUU', unres([F_AK, F_EPI])],
  ['DMM', inad([OENC])],
  ['DMD', inad([AKNA, OENC])],
  ['DMU', inad([OENC], [F_AK])],
  ['DDM', inad([OENC, OEPI])],
  ['DDD', inad([AKNA, OENC, OEPI])],
  ['DDU', inad([OENC, OEPI], [F_AK])],
  ['DUM', inad([OENC], [F_EPI])],
  ['DUD', inad([AKNA, OENC], [F_EPI])],
  ['DUU', inad([OENC], [F_AK, F_EPI])],
  ['UMM', unres([F_ENC])],
  ['UMD', inad([AKNA], [F_ENC])],
  ['UMU', unres([F_AK, F_ENC])],
  ['UDM', inad([OEPI], [F_ENC])],
  ['UDD', inad([AKNA, OEPI], [F_ENC])],
  ['UDU', inad([OEPI], [F_AK, F_ENC])],
  ['UUM', unres([F_ENC, F_EPI])],
  ['UUD', inad([AKNA], [F_ENC, F_EPI])],
  ['UUU', unres([F_AK, F_ENC, F_EPI])],
];
const LETTER = { Matches: 'M', DoesNotMatch: 'D', Unresolved: 'U' } as const;

describe('combined admissibility: all 27 rule-outcome combinations (contract §2.7)', () => {
  it('the table covers each combination exactly once', () => {
    expect(new Set(TABLE.map(([c]) => c)).size).toBe(27);
  });

  it.each(TABLE)('%s (encounter, episode, assertionKind) → %s, with every rule outcome kept', (combo, expected) => {
    const [e, p, k] = combo.split('') as ('M' | 'D' | 'U')[];
    const r = check([rev('s1', 'r1', '1', { encounter: FIELD.encounter[e!], episode: FIELD.episode[p!], assertionKind: FIELD.assertionKind[k!] })]);
    const n = node(key(r, 's1/r1').possibilities[0]);
    expect(show(n)).toBe(expected);
    // Each individual outcome is preserved as the rule produced it.
    expect(`${LETTER[n.rules.encounter.outcome]}${LETTER[n.rules.episode.outcome]}${LETTER[n.rules.assertionKind.outcome]}`).toBe(combo);
    if (n.rules.encounter.outcome === 'DoesNotMatch') expect(n.rules.encounter).toMatchObject({ reason: OENC, recordEncounter: 'N0', contextEncounter: 'N1' });
    if (n.rules.episode.outcome === 'DoesNotMatch') expect(n.rules.episode).toMatchObject({ reason: OEPI, recordEpisode: 'E0', contextEpisode: 'E1' });
    if (n.rules.assertionKind.outcome === 'DoesNotMatch') expect(n.rules.assertionKind).toMatchObject({ reason: AKNA, recordKind: PR });
    // Causes: Missing exactly when some rule is unresolved (every U here is an absent field).
    const a = n.admissibility;
    const causes = a.outcome === 'Inadmissible' || a.outcome === 'UnresolvedAdmissibility' ? a.causes : [];
    expect(causes).toEqual(combo.includes('U') ? ['Missing'] : []);
  });
});

describe('combined admissibility: reasons and findings', () => {
  it('multiple unresolved causes and origins are kept, in Stage A then rule order (case 122)', () => {
    const r = check([rev('s1', 'r1', '1', { encounter: undefined, assertionKind: null })], [], { contextEpisode: { unknown: ['Invalid', 'Conflicting'] } });
    expect(shown(r, 's1/r1')).toEqual([
      unres([
        F_ENC,
        'Conflicting:episode/context.episode/ContextUnknown:episode',
        'Invalid:assertionKind/record/FieldMalformed:assertionKind',
        'Invalid:episode/context.episode/ContextUnknown:episode',
      ]),
    ]);
    const a = node(key(r, 's1/r1').possibilities[0]).admissibility;
    expect(a.outcome === 'UnresolvedAdmissibility' && a.causes).toEqual(['Missing', 'Conflicting', 'Invalid']);
  });

  it('a mismatch beside malformed evidence keeps the malformed findings, never relabelled (case 121)', () => {
    const r = check([rev('s1', 'r1', '1', { episode: 'E0', encounter: 7, assertionKind: 'x' })]);
    expect(shown(r, 's1/r1')).toEqual([inad([OEPI], ['Invalid:assertionKind/record/FieldMalformed:assertionKind', 'Invalid:encounter/record/FieldMalformed:encounter'])]);
    const a = node(key(r, 's1/r1').possibilities[0]).admissibility;
    expect(a.outcome === 'Inadmissible' && a.causes).toEqual(['Invalid']);
    expect(a.outcome === 'Inadmissible' && a.causes).not.toContain('Inadmissible');
  });

  it('a mismatch beside an unresolved context keeps the context causes and their origin', () => {
    const r = check([rev('s1', 'r1', '1', { encounter: 'N0' })], [], { contextEpisode: { unknown: ['Conflicting'] } });
    expect(shown(r, 's1/r1')).toEqual([inad([OENC], ['Conflicting:episode/context.episode/ContextUnknown:episode'])]);
  });

  it('reason and finding order does not depend on which rule is evaluated first or on input order', () => {
    const a = check([rev('s1', 'r1', '1', { encounter: 'N0', episode: 'E0', assertionKind: PR })]);
    const reordered = run(s1Of([rev('s1', 'r1', '1', { encounter: 'N0', episode: 'E0', assertionKind: PR })]), {
      admissible: { assertionKind: { in: [CD] }, episode: SAME_EPISODE_RULE, encounter: SAME_ENCOUNTER_RULE },
    });
    expect(reordered).toEqual(a);
    expect(shown(a, 's1/r1')).toEqual([inad([AKNA, OENC, OEPI])]);
  });
});

describe('combined admissibility: per possibility, never across possibilities', () => {
  it('unresolved history: possibilities with different outcomes; an admissible one is not made current (case 123)', () => {
    const k = key(
      check([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { encounter: 'N0', episode: undefined, supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]),
      's1/r1',
    );
    expect(k.possibilities.map(show)).toEqual([ADMISSIBLE, inad([OENC], [F_EPI])]);
    expect(k).toMatchObject({ s1Status: 'UnresolvedRevision', inheritedS1Causes: ['Missing'] });
    expect(k.inheritedS1Defects.map((d) => d.reason)).toEqual(['CorrectionAuthorityMissing']);
    expect(Object.keys(k)).not.toContain('admissibility');
  });

  it('never joins one possibility’s match with another’s: each rule fails on a different revision', () => {
    // @1 fails only the encounter rule, @2 only the episode rule. A cross-possibility join could find
    // a matching encounter (from @2) and a matching episode (from @1) and call something admissible.
    const k = key(
      check([rev('s1', 'r1', '1', { encounter: 'N0' }), rev('s1', 'r1', '2', { episode: 'E0', supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]),
      's1/r1',
    );
    expect(k.possibilities.map(show)).toEqual([inad([OENC]), inad([OEPI])]);
  });

  it('digest-qualified variants are assessed independently (case 124)', () => {
    const s1 = s1Of([rev('s1', 'r1', '1'), rev('s1', 'r1', '1', { assertionKind: 'x', provenance: { acquisition: 'a1' } })]);
    const k = key(run(s1), 's1/r1');
    expect(k.possibilities.map(show).sort()).toEqual([ADMISSIBLE, unres(['Invalid:assertionKind/record/FieldMalformed:assertionKind'])].sort());
    expect(new Set(k.possibilities.map((p) => (p.kind === 'node' ? p.node.digest : p.kind)))).toEqual(new Set(s1.keys[0]!.revisions[0]!.variants.map((v) => v.digest)));
    expect(k.inheritedS1Causes).toEqual(['Conflicting']);
  });

  it('a later authorized correction changes admissibility: only the current revision is assessed', () => {
    expect(shown(check([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { encounter: 'N0', supersedes: sup('s1', 'r1', '1'), author: AMEND })]), 's1/r1')).toEqual([inad([OENC])]);
    expect(shown(check([rev('s1', 'r1', '1', { encounter: 'N0' }), rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: AMEND })]), 's1/r1')).toEqual([ADMISSIBLE]);
  });

  it('unresolved S2 candidacy stays attached beside the combined result', () => {
    const p = node(key(check([rev('s1', 'r1', '1', { concept: { system: 'other-cs', code: 'item-x' }, episode: 'E0' })]), 's1/r1').possibilities[0]);
    expect(p).toMatchObject({ candidacy: 'Unresolved', s2Findings: [{ cause: 'Unavailable', reason: 'TerminologyUnavailable' }] });
    expect(show(p)).toBe(inad([OEPI]));
  });

  it('out of domain is NotEvaluated, never Inadmissible, even when every rule would mismatch', () => {
    const y = { system: 'demo-cs', code: 'item-y' };
    const p = key(check([rev('s1', 'r1', '1', { concept: y, encounter: 'N0', episode: 'E0', assertionKind: PR })]), 's1/r1').possibilities[0];
    expect(p).toEqual({ kind: 'node', node: expect.anything(), candidacy: 'OutOfDomain', admissibility: { outcome: 'NotEvaluated', reason: 'OutOfDomain' } });
  });

  it('`excluded` and `unknown` are carried; Retracted and NoRecord keys contribute nothing', () => {
    expect(shown(check([rev('s1', 'r1', '1')], [retr('x1', 'r1', sup('s1', 'r1', '1'), { actor: 'u2' })]), 's1/r1')).toEqual([ADMISSIBLE, 'excluded']);
    expect(shown(check([rev('s1', 'r9', '2', { encounter: 'N0', supersedes: sup('s1', 'r9', '1'), author: AMEND })]), 's1/r9')).toEqual([inad([OENC]), 'unknown']);
    expect(key(check([rev('s1', 'r1', '1')], [retr('x1', 'r1', sup('s1', 'r1', '1'))]), 's1/r1')).toMatchObject({ s1Status: 'Retracted', possibilities: [] });
    const r = check([rev('s1', 'r1', '1'), rev('s2', 'r21', '1', { supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(key(r, 's2/r21')).toMatchObject({ s1Status: 'NoRecord', candidate: false, possibilities: [] });
  });
});

describe('combined admissibility: configuration, snapshot, determinism and detachment', () => {
  const s1 = s1Of([rev('s1', 'r1', '1', { encounter: 'N0', episode: 'E0', assertionKind: PR })]); // every rule would mismatch

  it.each([
    ['no admissible object', { admissible: undefined }, AdmissibilityCheckConfigurationError],
    ['an empty admissible object (no default rules)', { admissible: {} }, AdmissibilityCheckConfigurationError],
    ['a missing assertionKind rule', { admissible: { encounter: SAME_ENCOUNTER_RULE, episode: SAME_EPISODE_RULE } }, AdmissibilityCheckConfigurationError],
    ['a missing episode rule', { admissible: { encounter: SAME_ENCOUNTER_RULE, assertionKind: { in: [CD] } } }, AdmissibilityCheckConfigurationError],
    ['an extra rule', { admissible: { ...ADM, subject: { eq: [] } } }, AdmissibilityCheckConfigurationError],
    ['an array', { admissible: [ADM] }, AdmissibilityCheckConfigurationError],
    ['a precomputed S2', { s2: {} }, AdmissibilityCheckConfigurationError],
    ['a precomputed encounter result', { encounter: {} }, AdmissibilityCheckConfigurationError],
    ['an unexpected field', { rules: ADM }, AdmissibilityCheckConfigurationError],
    ['an invalid encounter rule', { admissible: { ...ADM, encounter: SAME_EPISODE_RULE } }, EncounterCheckConfigurationError],
    ['an invalid episode rule', { admissible: { ...ADM, episode: { eq: [] } } }, EpisodeCheckConfigurationError],
    ['an invalid assertionKind rule', { admissible: { ...ADM, assertionKind: { in: ['PhoneCall'] } } }, AssertionKindCheckConfigurationError],
    ['a malformed context encounter', { contextEncounter: { known: '' } }, EncounterCheckConfigurationError],
    ['a malformed context episode', { contextEpisode: { unknown: [] } }, EpisodeCheckConfigurationError],
    ['a missing context episode', { contextEpisode: undefined }, EpisodeCheckConfigurationError],
    ['a mismatched pin', { expansion: { ...VS, id: 'demo-vs/item-x@2' } }, S2ConfigurationError],
  ])('%s throws, even though every rule would mismatch', (_n, over, cls) => {
    expect(() => run(s1, over)).toThrow(cls);
  });

  it('a non-object input → AdmissibilityCheckConfigurationError', () => {
    expect(() => experimentalCheckAdmissibility(null as never)).toThrow(AdmissibilityCheckConfigurationError);
  });

  it('every rule reads the supplied S1: an old S2 or rule result cannot be combined with a corrected S1', () => {
    const before = s1Of([rev('s1', 'r1', '1')]);
    const after = s1Of([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { encounter: 'N0', supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    const staleS2 = experimentalIdentifyCandidates({ s1: before, valueSet: PIN, expansion: VS });
    const staleEnc = experimentalCheckEncounterScope({ s1: before, valueSet: PIN, expansion: VS, rule: SAME_ENCOUNTER_RULE, contextEncounter: N1 });
    expect(() => run(after, { s2: staleS2 })).toThrow(AdmissibilityCheckConfigurationError);
    expect(() => run(after, { encounterResult: staleEnc })).toThrow(AdmissibilityCheckConfigurationError);
    expect(shown(run(before), 's1/r1')).toEqual([ADMISSIBLE]);
    expect(shown(run(after), 's1/r1')).toEqual([inad([OENC])]);
  });

  const revisions = [
    rev('s1', 'r1', '1'),
    rev('s1', 'r1', '2', { encounter: 'N0', episode: undefined, supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } }),
    rev('s1', 'r14', '1'),
    rev('s1', 'r14', '1', { assertionKind: 'x' }),
    rev('s2', 'r9', '2', { episode: 'E0', assertionKind: PR, supersedes: sup('s2', 'r9', '1'), author: AMEND }),
    rev('s1', 'r8', '1', { concept: { system: 'demo-cs', code: 'item-y' } }),
  ];
  const retractions = [retr('x1', 'r1', sup('s1', 'r1', '2'), { actor: 'u2' })];
  const base = check(revisions, retractions);

  it('is invariant under input permutation, identical duplicates and S1 key order', () => {
    expect(check([...revisions].reverse(), [...retractions])).toEqual(base);
    expect(check([revisions[3]!, ...revisions, revisions[0]!], [...retractions, ...retractions])).toEqual(base);
    const s = s1Of(revisions, retractions);
    expect(run({ ...s, keys: [...s.keys].reverse() })).toEqual(base);
  });

  it('does not mutate deep-frozen inputs', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object') {
        Object.values(o).forEach(deepFreeze);
        Object.freeze(o);
      }
      return o;
    };
    const s = deepFreeze(s1Of(revisions, retractions));
    const admissible = deepFreeze(JSON.parse(JSON.stringify(ADM)));
    const ctxE = deepFreeze({ known: 'E1' });
    const ctxN = deepFreeze({ known: 'N1' });
    const before = JSON.stringify([s, admissible, ctxE, ctxN]);
    expect(experimentalCheckAdmissibility({ s1: s, valueSet: PIN, expansion: VS, admissible, contextEncounter: ctxN, contextEpisode: ctxE })).toEqual(base);
    expect(JSON.stringify([s, admissible, ctxE, ctxN])).toBe(before);
  });

  it('the result is detached from later edits to inputs, and deep-frozen', () => {
    const s = s1Of(revisions, retractions);
    const admissible = JSON.parse(JSON.stringify(ADM));
    const ctxE = { unknown: ['Conflicting'] };
    const r = experimentalCheckAdmissibility({ s1: s, valueSet: PIN, expansion: VS, admissible, contextEncounter: N1, contextEpisode: ctxE as EpisodeBinding });
    const snapshot = JSON.stringify(r);
    admissible.assertionKind.in.push(PR);
    ctxE.unknown.push('Missing');
    (s.keys[0]!.causes as string[]).push('Invalid');
    expect(JSON.stringify(r)).toBe(snapshot);
    const n = node(key(r, 's1/r1').possibilities[0]);
    expect(Object.isFrozen(n.rules.encounter)).toBe(true);
    expect(() => (r.keys as unknown[]).push({})).toThrow(TypeError);
  });
});
