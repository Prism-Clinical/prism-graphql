/**
 * EXPERIMENTAL, NONCLINICAL. Independent tests of the S3 assertionKind check. Expectations are
 * derived by hand from the contract (evidence-query-to-predicate-contract.md §1.2, §1.7, §2, §2.2
 * and §2.6, cases 114–118) and from S1/S2 behaviour fixed by their own tests; none is copied from
 * output. Allowed sets are built in each test, never taken from the demo query.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AssertionKindCheckConfigurationError,
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  S2ConfigurationError,
  SAME_ENCOUNTER_RULE,
  experimentalCheckAssertionKind,
  experimentalCompile,
  experimentalIdentifyCandidates,
  experimentalResolveRevisionHistory,
  type AssertionKindCheckResult,
  type JsonValue,
  type KeyAssertionKindScope,
  type PossibleAssertionKindScope,
  type S1Result,
  type ValueSetExpansion,
} from '../index';
import { FIXTURE_DIR } from './support/fixture-runner';

const ENV = { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] } as const;
const PIN = 'demo-vs/item-x@1';
const VS: ValueSetExpansion = { id: PIN, expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] };
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
const CD = 'ClinicianDocumented';
const PR = 'PatientReport';
const BOTH = { in: [CD, PR] };
const ONLY_CD = { in: [CD] };

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
const checkS1 = (s1: S1Result, rule: unknown = BOTH): AssertionKindCheckResult =>
  experimentalCheckAssertionKind({ s1, valueSet: PIN, expansion: VS, rule });
const check = (revisions: JsonValue[], rule: unknown = BOTH, retractions: JsonValue[] = []) => checkS1(s1Of(revisions, retractions), rule);
function key(r: AssertionKindCheckResult, k: string): KeyAssertionKindScope {
  const found = r.keys.find((x) => `${x.key.source}/${x.key.localId}` === k);
  if (!found) throw new Error(`key ${k} missing`);
  return found;
}
/** `s1/r1@1 Matches`, `s1/r1@1 Unresolved[Missing/FieldAbsent:assertionKind]`, `excluded`, … */
function show(p: PossibleAssertionKindScope): string {
  if (p.kind !== 'node') return p.kind;
  const r = p.node.revision;
  const id = `${r.source}/${r.localId}@${r.revision}`;
  const o = p.assertionKind;
  return o.outcome === 'Unresolved' ? `${id} Unresolved[${o.findings.map((f) => `${f.cause}/${f.reason}`).join(',')}]` : `${id} ${o.outcome}`;
}
const shown = (r: AssertionKindCheckResult, k: string) => key(r, k).possibilities.map(show);
const one = (assertionKind: JsonValue | undefined, rule: unknown = BOTH) => shown(check([rev('s1', 'r1', '1', { assertionKind })], rule), 's1/r1');
const MISSING = ['s1/r1@1 Unresolved[Missing/FieldAbsent:assertionKind]'];
const INVALID = ['s1/r1@1 Unresolved[Invalid/FieldMalformed:assertionKind]'];

describe('assertionKind check: one current revision', () => {
  it.each([CD, PR])('recognized kind %s in the authored set → Matches, carrying the kind', (kind) => {
    expect(key(check([rev('s1', 'r1', '1', { assertionKind: kind })]), 's1/r1').possibilities[0]).toMatchObject({
      candidacy: 'InDomain',
      s2Findings: [],
      assertionKind: { outcome: 'Matches', recordKind: kind },
    });
  });

  it('a recognized kind outside the authored set → DoesNotMatch (AssertionKindNotAllowed) (case 115a)', () => {
    expect(key(check([rev('s1', 'r1', '1', { assertionKind: PR })], ONLY_CD), 's1/r1').possibilities[0]).toMatchObject({
      assertionKind: { outcome: 'DoesNotMatch', reason: 'AssertionKindNotAllowed', recordKind: PR },
    });
  });

  it('the authored set decides membership: the same record under different sets (cases 114, 115)', () => {
    expect(one(PR, BOTH)).toEqual(['s1/r1@1 Matches']);
    expect(one(PR, ONLY_CD)).toEqual(['s1/r1@1 DoesNotMatch']);
    expect(one(PR, { in: [PR] })).toEqual(['s1/r1@1 Matches']);
    expect(one(CD, { in: [PR] })).toEqual(['s1/r1@1 DoesNotMatch']);
    expect(one(CD, ONLY_CD)).toEqual(['s1/r1@1 Matches']);
  });

  it('absent → Unresolved{Missing}: no default kind, never a mismatch (case 116)', () => {
    expect(one(undefined)).toEqual(MISSING);
    expect(one(undefined, ONLY_CD)).toEqual(MISSING);
    expect(one(undefined, { in: [] })).toEqual(MISSING);
  });

  it.each([
    ['null (malformed, not absent; case 117)', null],
    ['number', 7],
    ['boolean', false],
    ['object', { kind: CD }],
    ['array', [CD]],
    ['empty string (case 118c)', ''],
    ['whitespace-only', '   '],
    ['different case (case 118a)', 'patientReport'],
    ['all lower case', 'clinicianDocumented'],
    ['surrounding whitespace (case 118b)', ' PatientReport'],
    ['trailing non-breaking space', 'ClinicianDocumented '],
    ['unrecognized string (case 118d)', 'PhoneCall'],
    ['AssertionValue code (another enum)', 'Affirmed'],
  ] as [string, JsonValue][])('malformed or unrecognized kind (%s) → Unresolved{Invalid}, never AssertionKindNotAllowed', (_n, v) => {
    // Even against a set that excludes every recognized kind: an unrecognized value's true kind is unknown.
    expect(one(v)).toEqual(INVALID);
    expect(one(v, ONLY_CD)).toEqual(INVALID);
    expect(one(v, { in: [] })).toEqual(INVALID);
  });

  it('an explicitly authored empty set allows no recognized kind (contract §2.6)', () => {
    expect(one(CD, { in: [] })).toEqual(['s1/r1@1 DoesNotMatch']);
    expect(one(PR, { in: [] })).toEqual(['s1/r1@1 DoesNotMatch']);
  });

  it('a repeated authored code has no effect on membership (contract §2.6)', () => {
    expect(one(CD, { in: [CD, CD] })).toEqual(['s1/r1@1 Matches']);
    expect(one(PR, { in: [CD, CD] })).toEqual(['s1/r1@1 DoesNotMatch']);
    expect(check([rev('s1', 'r1', '1')], { in: [CD, CD] }).allowedKinds).toEqual([CD, CD]);
  });

  it('the compiler accepts the same empty and repeated sets, so the check and compiler agree', () => {
    const query = JSON.parse(readFileSync(join(FIXTURE_DIR, 'query', 'q.demo.json'), 'utf8'));
    const program = JSON.parse(readFileSync(join(FIXTURE_DIR, '..', '..', 'programs', 'schematic-demo-finding.ppl.json'), 'utf8'));
    const q = program.nodes.find((d: { kind: string }) => d.kind === 'EvidenceQuery');
    for (const set of [[], [CD, CD]]) {
      q.contract.admissible.assertionKind = { in: set };
      const r = experimentalCompile(program);
      expect(r.outcome).toBe('Compiled');
      if (r.outcome === 'Compiled') {
        const c = r.package.declarations.find((d) => d.kind === 'EvidenceQuery');
        const authored = c && c.kind === 'EvidenceQuery' && c.contract.kind === 'explicit-assertion-v0' ? c.contract.admissible.assertionKinds : null;
        expect(authored).toEqual(set);
        expect(() => checkS1(s1Of([rev('s1', 'r1', '1')]), { in: authored })).not.toThrow();
      }
    }
    expect(query.query.contract.admissible.assertionKind).toEqual(BOTH);
  });
});

describe('assertionKind check: S1 and S2 boundaries', () => {
  it('authorized correction that changes the kind: only the current revision is checked', () => {
    const revisions = [rev('s1', 'r1', '1', { assertionKind: CD }), rev('s1', 'r1', '2', { assertionKind: PR, supersedes: sup('s1', 'r1', '1'), author: AMEND })];
    expect(shown(check(revisions, ONLY_CD), 's1/r1')).toEqual(['s1/r1@2 DoesNotMatch']);
    expect(shown(check(revisions, BOTH), 's1/r1')).toEqual(['s1/r1@2 Matches']);
  });

  it('unresolved correction history keeps both alternatives with different outcomes and the S1 defect', () => {
    const k = key(check([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { assertionKind: PR, supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })], ONLY_CD), 's1/r1');
    expect(k.possibilities.map(show)).toEqual(['s1/r1@1 Matches', 's1/r1@2 DoesNotMatch']);
    expect(k).toMatchObject({ s1Status: 'UnresolvedRevision', candidate: true, inheritedS1Causes: ['Missing'] });
    expect(k.inheritedS1Defects.map((d) => d.reason)).toEqual(['CorrectionAuthorityMissing']);
  });

  it('unresolved history whose alternatives are absent and malformed keeps each finding', () => {
    const k = key(
      check([rev('s1', 'r1', '1', { assertionKind: undefined }), rev('s1', 'r1', '2', { assertionKind: 'Other', supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]),
      's1/r1',
    );
    expect(k.possibilities.map(show)).toEqual(['s1/r1@1 Unresolved[Missing/FieldAbsent:assertionKind]', 's1/r1@2 Unresolved[Invalid/FieldMalformed:assertionKind]']);
  });

  it('digest-qualified variants with different kinds are checked separately; the payload conflict stays', () => {
    const s1 = s1Of([rev('s1', 'r14', '1'), rev('s1', 'r14', '1', { assertionKind: PR, provenance: { acquisition: 'a1' } })]);
    const k = key(checkS1(s1, ONLY_CD), 's1/r14');
    expect(k.possibilities.map((p) => (p.kind === 'node' ? p.assertionKind.outcome : p.kind)).sort()).toEqual(['DoesNotMatch', 'Matches']);
    expect(k.possibilities.every((p) => p.kind === 'node' && p.node.digest !== undefined)).toBe(true);
    expect(k.inheritedS1Causes).toEqual(['Conflicting']);
  });

  it('unresolved S2 candidacy is kept alongside a decidable kind', () => {
    const p = key(check([rev('s1', 'r10', '1', { concept: { system: 'other-cs', code: 'item-x' }, assertionKind: PR })], ONLY_CD), 's1/r10').possibilities[0];
    expect(p).toMatchObject({ candidacy: 'Unresolved', s2Findings: [{ cause: 'Unavailable', reason: 'TerminologyUnavailable' }], assertionKind: { outcome: 'DoesNotMatch' } });
  });

  it('out of domain → NotEvaluated, even with an absent or malformed kind', () => {
    const y = { system: 'demo-cs', code: 'item-y' };
    for (const assertionKind of [undefined, 'x', PR]) {
      expect(key(check([rev('s1', 'r8', '1', { concept: y, assertionKind })], ONLY_CD), 's1/r8').possibilities[0]).toMatchObject({
        candidacy: 'OutOfDomain',
        assertionKind: { outcome: 'NotEvaluated', reason: 'OutOfDomain' },
      });
    }
  });

  it('`excluded` and `unknown` are carried unchanged; Retracted and NoRecord keys contribute nothing', () => {
    expect(shown(check([rev('s1', 'r42', '1')], BOTH, [retr('x42', 'r42', sup('s1', 'r42', '1'), { actor: 'u2' })]), 's1/r42')).toEqual(['s1/r42@1 Matches', 'excluded']);
    expect(shown(check([rev('s1', 'r9', '2', { assertionKind: PR, supersedes: sup('s1', 'r9', '1'), author: AMEND })], ONLY_CD), 's1/r9')).toEqual([
      's1/r9@2 DoesNotMatch',
      'unknown',
    ]);
    expect(key(check([rev('s1', 'r1', '1')], BOTH, [retr('x1', 'r1', sup('s1', 'r1', '1'))]), 's1/r1')).toMatchObject({ s1Status: 'Retracted', possibilities: [] });
    const r = check([rev('s1', 'r1', '1'), rev('s2', 'r21', '1', { supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(key(r, 's2/r21')).toMatchObject({ s1Status: 'NoRecord', candidate: false, possibilities: [] });
  });
});

describe('assertionKind check: one snapshot, determinism and detachment', () => {
  const revisions = [
    rev('s1', 'r1', '1'),
    rev('s1', 'r1', '2', { assertionKind: PR, supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } }),
    rev('s1', 'r14', '1'),
    rev('s1', 'r14', '1', { assertionKind: 'x' }),
    rev('s2', 'r9', '2', { assertionKind: undefined, supersedes: sup('s2', 'r9', '1'), author: AMEND }),
    rev('s1', 'r8', '1', { concept: { system: 'demo-cs', code: 'item-y' } }),
  ];
  const retractions = [retr('x1', 'r1', sup('s1', 'r1', '2'), { actor: 'u2' })];
  const base = check(revisions, ONLY_CD, retractions);

  it('a precomputed S2 or any other stage result is rejected; the current S1 is what gets checked', () => {
    const before = s1Of([rev('s1', 'r1', '1')]);
    const after = s1Of([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { assertionKind: PR, supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    const staleS2 = experimentalIdentifyCandidates({ s1: before, valueSet: PIN, expansion: VS });
    expect(() => experimentalCheckAssertionKind({ s1: after, s2: staleS2, valueSet: PIN, expansion: VS, rule: ONLY_CD } as never)).toThrow(AssertionKindCheckConfigurationError);
    expect(() => experimentalCheckAssertionKind({ s1: after, episode: {}, valueSet: PIN, expansion: VS, rule: ONLY_CD } as never)).toThrow(AssertionKindCheckConfigurationError);
    expect(shown(checkS1(before, ONLY_CD), 's1/r1')).toEqual(['s1/r1@1 Matches']);
    expect(shown(checkS1(after, ONLY_CD), 's1/r1')).toEqual(['s1/r1@2 DoesNotMatch']);
  });

  it('is invariant under input permutation, identical duplicates, S1 key order and authored-set order', () => {
    expect(check([...revisions].reverse(), ONLY_CD, [...retractions])).toEqual(base);
    expect(check([revisions[3]!, ...revisions, revisions[0]!], ONLY_CD, [...retractions, ...retractions])).toEqual(base);
    const s1 = s1Of(revisions, retractions);
    expect(checkS1({ ...s1, keys: [...s1.keys].reverse() }, ONLY_CD)).toEqual(base);
    const a = check(revisions, { in: [CD, PR] }, retractions);
    const b = check(revisions, { in: [PR, CD] }, retractions);
    expect(b.keys).toEqual(a.keys);
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
    const rule = deepFreeze({ in: [CD] });
    const before = JSON.stringify([s1, expansion, rule]);
    expect(experimentalCheckAssertionKind({ s1, valueSet: PIN, expansion, rule })).toEqual(base);
    expect(JSON.stringify([s1, expansion, rule])).toBe(before);
  });

  it('the result is detached from later edits to the rule and S1 result, and deep-frozen', () => {
    const s1 = s1Of(revisions, retractions);
    const rule = { in: [CD] };
    const r = checkS1(s1, rule);
    const snapshot = JSON.stringify(r);
    rule.in.push(PR);
    (s1.keys[0]!.causes as string[]).push('Invalid');
    expect(JSON.stringify(r)).toBe(snapshot);
    expect(Object.isFrozen(r.allowedKinds)).toBe(true);
    expect(() => (r.keys as unknown[]).push({})).toThrow(TypeError);
  });
});

describe('assertionKind check: rule and configuration input', () => {
  const s1 = s1Of([rev('s1', 'r1', '1', { assertionKind: 'x' })]);
  const run = (over: Record<string, unknown>) => () => experimentalCheckAssertionKind({ s1, valueSet: PIN, expansion: VS, rule: ONLY_CD, ...over } as never);
  const sparse: unknown[] = [CD];
  sparse[2] = PR;

  it.each([
    ['no rule (never a default set)', { rule: undefined }],
    ['null rule', { rule: null }],
    ['a bare array', { rule: [CD] }],
    ['another rule shape', { rule: SAME_ENCOUNTER_RULE }],
    ['`in` not an array', { rule: { in: CD } }],
    ['`in` missing', { rule: { values: [CD] } }],
    ['an extra member', { rule: { in: [CD], not: [PR] } }],
    ['an unrecognized code', { rule: { in: [CD, 'PhoneCall'] } }],
    ['a code with different case', { rule: { in: ['clinicianDocumented'] } }],
    ['a padded code', { rule: { in: [' ClinicianDocumented'] } }],
    ['an empty-string element', { rule: { in: [''] } }],
    ['a non-string element', { rule: { in: [7] } }],
    ['a null element', { rule: { in: [null] } }],
    ['an undefined element', { rule: { in: [CD, undefined] } }],
    ['a sparse array', { rule: { in: sparse } }],
    ['an enum literal object', { rule: { in: [{ enum: 'AssertionKind.ClinicianDocumented' }] } }],
    ['not an S1 result', { s1: { keys: [] } }],
    ['an unexpected field', { contextEpisode: { known: 'E1' } }],
  ])('%s → AssertionKindCheckConfigurationError', (_n, over) => {
    expect(run(over)).toThrow(AssertionKindCheckConfigurationError);
  });

  it('a non-object input → AssertionKindCheckConfigurationError', () => {
    expect(() => experimentalCheckAssertionKind(null as never)).toThrow(AssertionKindCheckConfigurationError);
  });

  it.each([
    ['mismatched pin', { expansion: { ...VS, id: 'demo-vs/item-x@2' } }],
    ['missing expansion', { expansion: undefined }],
  ])('S2 parameters are validated by S2 (%s → S2ConfigurationError)', (_n, over) => {
    expect(run(over)).toThrow(S2ConfigurationError);
  });

  it('a malformed RECORD kind is patient uncertainty, not a configuration error', () => {
    expect(shown(run({})(), 's1/r1')).toEqual(INVALID);
  });
});
