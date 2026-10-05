/**
 * EXPERIMENTAL, NONCLINICAL. Independent S1 tests. Every expectation below is derived by hand
 * from the contract (evidence-query-to-predicate-contract.md §1.1–1.4, §2.1) and
 * CANONICALIZATION.md; none is copied from resolver output.
 */
import {
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  experimentalResolveRevisionHistory,
  type JsonValue,
  type KeyResolution,
  type S1Result,
} from '../index';

const ENV = { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] } as const;
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
const NO_PERM = { actor: 'u2', permissions: [] as string[] };
const NO_AUTH_FIELD = { actor: 'u2' };

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
const retr = (id: string, source: string, localId: string, target: JsonValue, author: JsonValue = AMEND): JsonValue => ({
  id,
  key: { source, localId },
  target,
  author,
  provenance: { acquisition: 'a0', sourceRecordRef: `${source}:${id}` },
});

function run(revisions: JsonValue[], retractions: JsonValue[] = []): S1Result {
  return experimentalResolveRevisionHistory({ envelope: ENV, authorityRule: DEMO_AUTHORITY_RULE, revisions, retractions });
}
const show = (r: { source: string; localId: string; revision: string }) => `${r.source}/${r.localId}@${r.revision}`;
function key(result: S1Result, k: string): KeyResolution {
  const found = result.keys.find((x) => `${x.key.source}/${x.key.localId}` === k);
  if (!found) throw new Error(`key ${k} not resolved`);
  return found;
}
/** Compact view of a key result: status, current, causes, possible currents (variants as #n), defect reasons. */
function view(result: S1Result, k: string) {
  const r = key(result, k);
  const digests = r.revisions.flatMap((x) => x.variants.map((v) => v.digest));
  return {
    status: r.status,
    current: r.current ? show(r.current.revision) : null,
    causes: r.causes,
    possible: r.possibleCurrent.map((p) =>
      p.kind === 'node' ? show(p.node.revision) + (p.node.digest ? `#${digests.indexOf(p.node.digest)}` : '') : p.kind,
    ),
    active: r.activeDefects.map((d) => d.reason),
    historical: r.historicalDefects.map((d) => d.reason),
  };
}

describe('step 1: identity, payload equality, variants', () => {
  it('identical payloads with different key order and provenance are one variant (CANONICALIZATION §1, §6)', () => {
    const a = rev('s1', 'r1', '1');
    const b = { ...(rev('s1', 'r1', '1', { provenance: { acquisition: 'a9', sourceRecordRef: 'native-7' } }) as object) };
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as JsonValue;
    const r = run([a, reordered]);
    expect(view(r, 's1/r1')).toMatchObject({ status: 'Current', current: 's1/r1@1' });
    const variants = key(r, 's1/r1').revisions[0]?.variants ?? [];
    expect(variants).toHaveLength(1);
    expect(variants[0]?.occurrences.map((o) => (o.provenance as { acquisition: string }).acquisition)).toEqual(['a0', 'a9']);
  });

  it('different payloads under one RevisionRef are a conflicted revision (step 1)', () => {
    const r = run([rev('s1', 'r1', '1'), rev('s1', 'r1', '1', { assertion: 'Denied' })]);
    expect(view(r, 's1/r1')).toEqual({
      status: 'UnresolvedRevision',
      current: null,
      causes: ['Conflicting'],
      possible: ['s1/r1@1#0', 's1/r1@1#1'],
      active: ['PayloadConflict'],
      historical: [],
    });
  });

  it('a malformed value with a `toJSON` member has one identity regardless of member order (CAN-12)', () => {
    const occ = (assertion: string) => JSON.parse(JSON.stringify(rev('s1', 'r1', '1')).replace('"assertion":"Affirmed"', `"assertion":${assertion}`)) as JsonValue;
    const r = run([occ('{"toJSON":"x","b":"1","a":"2"}'), occ('{"a":"2","b":"1","toJSON":"x"}')]);
    expect(view(r, 's1/r1')).toMatchObject({ status: 'Current', current: 's1/r1@1', active: [] });
    expect(key(r, 's1/r1').revisions[0]?.variants[0]?.occurrences).toHaveLength(2);
  });

  it('numbers 1 and 1.0 are equal under RFC 8785; 1 and 2 differ (CANONICALIZATION §4)', () => {
    expect(key(run([rev('s1', 'r1', '1', { assertion: 1 }), rev('s1', 'r1', '1', { assertion: 1.0 })]), 's1/r1').status).toBe('Current');
    expect(key(run([rev('s1', 'r1', '1', { assertion: 1 }), rev('s1', 'r1', '1', { assertion: 2 })]), 's1/r1').status).toBe('UnresolvedRevision');
  });

  it('absent and null differ (CANONICALIZATION §3)', () => {
    const r = run([rev('s1', 'r1', '1', { assertion: undefined }), rev('s1', 'r1', '1', { assertion: null })]);
    expect(view(r, 's1/r1').active).toEqual(['PayloadConflict']);
  });

  it('permission sets compare as sets; undeclared fields are diagnostics, not payload', () => {
    const a = rev('s1', 'r1', '1', { author: { actor: 'u1', permissions: ['p', DEMO_AMEND_PERMISSION] } });
    const b = rev('s1', 'r1', '1', { author: { actor: 'u1', permissions: [DEMO_AMEND_PERMISSION, 'p', 'p'] }, note: 'x' });
    const v = key(run([a, b]), 's1/r1').revisions[0]?.variants ?? [];
    expect(v).toHaveLength(1);
    expect(v[0]?.occurrences.flatMap((o) => o.undeclaredPaths)).toEqual(['note']);
  });

  it('local identifiers are source-scoped (§1.1)', () => {
    const r = run([rev('s1', 'r30', '1'), rev('s2', 'r30', '1', { assertion: 'Denied' })]);
    expect(view(r, 's1/r30').status).toBe('Current');
    expect(view(r, 's2/r30').status).toBe('Current');
  });

  it('occurrences without identity or not representable are listed, not evaluated', () => {
    const r = run([{ revision: '1' }, rev('s1', 'r1', '1', { assertion: '\uD800' })]);
    expect(r.unidentified.map((u) => u.inputIndex)).toEqual([0, 1]);
    expect(r.keys).toEqual([]);
  });
});

describe('steps 2–3: envelope membership, boundaries and correction edges', () => {
  it('authorized correction supersedes (row "Otherwise")', () => {
    const r = run([rev('s1', 'r1', '1', { assertion: 'Denied' }), rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(view(r, 's1/r1')).toMatchObject({ status: 'Current', current: 's1/r1@2' });
  });

  it('unauthorized correction is rejected; unknown permission codes neither grant nor block (§1.3)', () => {
    for (const author of [NO_PERM, { actor: 'u2', permissions: ['other.permission'] }]) {
      const r = run([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { assertion: 'Denied', supersedes: sup('s1', 'r1', '1'), author })]);
      expect(view(r, 's1/r1')).toMatchObject({ status: 'Current', current: 's1/r1@1' });
      expect(r.rejections.map((x) => x.reason)).toEqual(['Unauthorized']);
    }
  });

  it.each([
    ['permissions absent', NO_AUTH_FIELD, 'Missing', 'CorrectionAuthorityMissing'],
    ['author absent', undefined, 'Missing', 'CorrectionAuthorityMissing'],
    ['permissions not a set', { actor: 'u2', permissions: 'yes' }, 'Invalid', 'CorrectionAuthorityMalformed'],
    ['author not an object', 'u2', 'Invalid', 'CorrectionAuthorityMalformed'],
  ] as const)('undeterminable authority (%s) keeps both revisions possible', (_n, author, cause, reason) => {
    const r = run([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { assertion: 'Denied', supersedes: sup('s1', 'r1', '1'), author: author as JsonValue | undefined })]);
    expect(view(r, 's1/r1')).toEqual({
      status: 'UnresolvedRevision', current: null, causes: [cause], possible: ['s1/r1@1', 's1/r1@2'], active: [reason], historical: [],
    });
  });

  it('subject-changing revision is out of envelope; the valid target is unchanged (step 2)', () => {
    const r = run([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { subject: 'P2', supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(view(r, 's1/r1')).toMatchObject({ status: 'Current', current: 's1/r1@1', active: [] });
    expect(key(r, 's1/r1').revisions.find((x) => x.ref.revision === '2')?.state).toBe('outOfEnvelope');
  });

  it('a correction of an out-of-envelope revision is rejected as a boundary violation (step 3)', () => {
    const r = run([rev('s1', 'r9', '1', { subject: 'P2' }), rev('s1', 'r9', '2', { supersedes: sup('s1', 'r9', '1'), author: AMEND })]);
    expect(view(r, 's1/r9').status).toBe('NoRecord');
    expect(r.rejections.map((x) => x.reason)).toEqual(['SubjectChanged']);
  });

  it('cross-local-ID correction is rejected; the target is unchanged and diagnosed', () => {
    const r = run([rev('s1', 'r1', '1'), rev('s1', 'r70', '1', { assertion: 'Denied', supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(view(r, 's1/r1')).toMatchObject({ status: 'Current', current: 's1/r1@1' });
    expect(view(r, 's1/r70').status).toBe('NoRecord');
    expect(key(r, 's1/r1').diagnostics.map((d) => d.code)).toEqual(['CrossKeyCorrection']);
  });

  it('undeterminable membership is Missing + excluded, and its edge is undeterminable', () => {
    const r = run([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { assertion: 'Denied', subject: undefined, supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    expect(view(r, 's1/r1')).toMatchObject({ causes: ['Missing'], possible: ['s1/r1@1', 's1/r1@2', 'excluded'] });
  });

  it.each([
    ['incomplete reference', { localId: 'r1', revision: '1' }, 'Missing', 'CorrectionRefIncomplete', ['s1/r1@1', 's1/r1@2']],
    ['malformed reference', 'r1@1', 'Invalid', 'CorrectionRefMalformed', ['s1/r1@1', 's1/r1@2']],
    ['absent target', sup('s1', 'r1', '0'), 'Missing', 'CorrectionTargetAbsent', ['s1/r1@1', 's1/r1@2', 'unknown']],
  ] as const)('%s', (_n, supersedes, cause, reason, possible) => {
    const r = run([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { supersedes: supersedes as JsonValue, author: AMEND })]);
    expect(view(r, 's1/r1')).toMatchObject({ status: 'UnresolvedRevision', causes: [cause], active: [reason], possible });
  });

  it('self-supersession is Invalid and never used as support', () => {
    const r = run([rev('s1', 'r40', '1', { supersedes: sup('s1', 'r40', '1'), author: AMEND })]);
    expect(view(r, 's1/r40')).toMatchObject({ status: 'UnresolvedRevision', causes: ['Invalid'], possible: ['s1/r40@1'], active: ['SelfSupersession'] });
  });
});

describe('step 4: cycles', () => {
  it('a three-revision cycle is Invalid and all members stay possible', () => {
    const r = run([
      rev('s1', 'r41', 'a', { supersedes: sup('s1', 'r41', 'c'), author: AMEND }),
      rev('s1', 'r41', 'b', { supersedes: sup('s1', 'r41', 'a'), author: AMEND }),
      rev('s1', 'r41', 'c', { supersedes: sup('s1', 'r41', 'b'), author: AMEND }),
    ]);
    expect(view(r, 's1/r41')).toMatchObject({ causes: ['Invalid'], possible: ['s1/r41@a', 's1/r41@b', 's1/r41@c'], active: ['Cycle'] });
  });

  it('a valid chain stays valid: @1 ← @2 ← @3 gives Current(@3)', () => {
    const r = run([
      rev('s1', 'r1', '1'),
      rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: AMEND }),
      rev('s1', 'r1', '3', { supersedes: sup('s1', 'r1', '2'), author: AMEND }),
    ]);
    expect(view(r, 's1/r1')).toMatchObject({ status: 'Current', current: 's1/r1@3' });
  });
});

describe('steps 5–7: forks, retractions and history resolution', () => {
  const fork = () => [
    rev('s1', 'r1', '1'),
    rev('s1', 'r1', '2a', { supersedes: sup('s1', 'r1', '1'), author: AMEND }),
    rev('s1', 'r1', '2b', { assertion: 'Denied', supersedes: sup('s1', 'r1', '1'), author: AMEND }),
  ];
  const retract2b = (author: JsonValue = AMEND) => [retr('x1', 's1', 'r1', sup('s1', 'r1', '2b'), author)];

  it('fork before retraction is Conflicting', () => {
    expect(view(run(fork()), 's1/r1')).toMatchObject({ causes: ['Conflicting'], possible: ['s1/r1@2a', 's1/r1@2b'], active: ['Fork'] });
  });
  it('authorized retraction of one branch makes the fork historical', () => {
    expect(view(run(fork(), retract2b()), 's1/r1')).toEqual({
      status: 'Current', current: 's1/r1@2a', causes: [], possible: [], active: [], historical: ['Fork'],
    });
  });
  it('unauthorized retraction is rejected; the fork stays active', () => {
    const r = run(fork(), retract2b(NO_PERM));
    expect(view(r, 's1/r1')).toMatchObject({ causes: ['Conflicting'], active: ['Fork'] });
    expect(r.rejections.map((x) => x.reason)).toEqual(['Unauthorized']);
  });
  it('retraction with unknown authority keeps the fork and adds its own defect', () => {
    expect(view(run(fork(), retract2b(NO_AUTH_FIELD)), 's1/r1')).toMatchObject({
      causes: ['Missing', 'Conflicting'], possible: ['s1/r1@2a', 's1/r1@2b', 'excluded'], active: ['RetractionAuthorityMissing', 'Fork'],
    });
  });

  const conflicted = () => [rev('s1', 'r1', '1'), rev('s1', 'r1', '1', { assertion: 'Denied' })];
  it('a valid correction resolves a payload conflict; the conflict stays historical', () => {
    expect(view(run([...conflicted(), rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: AMEND })]), 's1/r1')).toEqual({
      status: 'Current', current: 's1/r1@2', causes: [], possible: [], active: [], historical: ['PayloadConflict'],
    });
  });
  it('resolution of one conflict leaves another active defect active', () => {
    const r = run([...conflicted(), rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: AMEND })], [retr('x2', 's1', 'r1', sup('s1', 'r1', '2'), NO_AUTH_FIELD)]);
    expect(view(r, 's1/r1')).toMatchObject({ causes: ['Missing'], possible: ['s1/r1@2', 'excluded'], active: ['RetractionAuthorityMissing'], historical: ['PayloadConflict'] });
  });
  it('an authorized retraction of the conflicted revision leaves Retracted', () => {
    expect(view(run(conflicted(), [retr('x1', 's1', 'r1', sup('s1', 'r1', '1'))]), 's1/r1')).toMatchObject({ status: 'Retracted', historical: ['PayloadConflict'] });
  });

  // Cases 85–87: retracting a correction does not erase uncertainty about its supersession effect.
  const corr = (author: JsonValue) => [rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { assertion: 'Denied', supersedes: sup('s1', 'r1', '1'), author })];
  const x2 = [retr('x2', 's1', 'r1', sup('s1', 'r1', '2'))];
  it('85: unknown authority, then retracted → Unresolved{Missing}, possible {@1, excluded}', () => {
    expect(view(run(corr(NO_AUTH_FIELD), x2), 's1/r1')).toEqual({
      status: 'UnresolvedRevision', current: null, causes: ['Missing'], possible: ['s1/r1@1', 'excluded'], active: ['CorrectionAuthorityMissing'], historical: [],
    });
  });
  it('86: known-authorized, then retracted → Retracted (no reinstatement)', () => {
    expect(view(run(corr(AMEND), x2), 's1/r1').status).toBe('Retracted');
  });
  it('87: known-unauthorized, then retracted → @1 Current; the retraction has no effect', () => {
    const r = run(corr(NO_PERM), x2);
    expect(view(r, 's1/r1')).toMatchObject({ status: 'Current', current: 's1/r1@1' });
    expect(key(r, 's1/r1').diagnostics.map((d) => d.code)).toEqual(['RetractionTargetsRejectedRevision']);
  });

  it('unknown-authority correction superseded by a valid later correction: no `excluded` (step 7)', () => {
    const r = run([...corr(NO_AUTH_FIELD), rev('s1', 'r1', '3', { supersedes: sup('s1', 'r1', '2'), author: AMEND })]);
    expect(view(r, 's1/r1')).toMatchObject({ causes: ['Missing'], possible: ['s1/r1@1', 's1/r1@3'], active: ['CorrectionAuthorityMissing'] });
  });
  it('undeterminable-membership correction, then retracted: uncertainty stays (step 2 + step 7)', () => {
    const r = run([rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { subject: undefined, supersedes: sup('s1', 'r1', '1'), author: AMEND })], x2);
    expect(view(r, 's1/r1')).toMatchObject({ causes: ['Missing'], possible: ['s1/r1@1', 'excluded'], active: ['EnvelopeFieldAbsent'] });
  });
  it('retraction of a superseded revision has no effect; absent target is Missing + excluded', () => {
    const chain = [rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: AMEND })];
    expect(view(run(chain, [retr('x1', 's1', 'r1', sup('s1', 'r1', '1'))]), 's1/r1')).toMatchObject({ status: 'Current', current: 's1/r1@2' });
    expect(view(run(chain, [retr('x1', 's1', 'r1', sup('s1', 'r1', '9'))]), 's1/r1')).toMatchObject({ causes: ['Missing'], possible: ['s1/r1@2', 'excluded'] });
  });
  it('conflicting retraction occurrences and unattributable retractions', () => {
    const r = run([rev('s1', 'r1', '1')], [retr('x1', 's1', 'r1', sup('s1', 'r1', '1')), retr('x1', 's1', 'r1', sup('s1', 'r1', '1'), NO_PERM), retr('x9', 's1', 'r1', { localId: 'r1' })]);
    expect(view(r, 's1/r1')).toMatchObject({ causes: ['Conflicting'], possible: ['s1/r1@1', 'excluded'], active: ['RetractionConflict'] });
    expect(r.unattributableRetractions).toEqual([{ ref: { source: 's1', id: 'x9' }, cause: 'Missing' }]);
  });

  // Step 7 fork fallback: conflicted @1, superseded by two authorized corrections. Step 5 records
  // no fork (PayloadConflict exists); step 7 makes PayloadConflict historical; two heads remain.
  const conflictedFork = () => [...conflicted(), ...fork().slice(1)];
  it('88: two heads left with no active defect are a Fork (Conflicting); PayloadConflict stays historical', () => {
    const r = run(conflictedFork());
    expect(view(r, 's1/r1')).toEqual({
      status: 'UnresolvedRevision', current: null, causes: ['Conflicting'], possible: ['s1/r1@2a', 's1/r1@2b'], active: ['Fork'], historical: ['PayloadConflict'],
    });
    const k = key(r, 's1/r1');
    expect(k.activeDefects).toEqual([
      { cause: 'Conflicting', reason: 'Fork', subject: { kind: 'key', ref: { source: 's1', localId: 'r1' } }, involves: [sup('s1', 'r1', '2a'), sup('s1', 'r1', '2b')], additions: [] },
    ]);
    expect(k.historicalDefects.map((d) => [d.reason, d.subject])).toEqual([['PayloadConflict', { kind: 'revision', ref: sup('s1', 'r1', '1') }]]);
  });
  it('89: authorized retraction of one surviving head leaves the other Current; no fork', () => {
    expect(view(run(conflictedFork(), retract2b()), 's1/r1')).toEqual({
      status: 'Current', current: 's1/r1@2a', causes: [], possible: [], active: [], historical: ['PayloadConflict'],
    });
  });
  it('90: authorized retraction of both surviving heads is Retracted; @1 is not reinstated', () => {
    const r = run(conflictedFork(), [...retract2b(), retr('x2', 's1', 'r1', sup('s1', 'r1', '2a'))]);
    expect(view(r, 's1/r1')).toEqual({ status: 'Retracted', current: null, causes: [], possible: [], active: [], historical: ['PayloadConflict'] });
    expect(key(r, 's1/r1').revisions.map((x) => [x.ref.revision, x.state])).toEqual([['1', 'superseded'], ['2a', 'retracted'], ['2b', 'retracted']]);
  });
  it('91: unauthorized retraction of one head is rejected; the fallback Fork keeps the key unresolved', () => {
    const r = run(conflictedFork(), retract2b(NO_PERM));
    expect(view(r, 's1/r1')).toEqual({
      status: 'UnresolvedRevision', current: null, causes: ['Conflicting'], possible: ['s1/r1@2a', 's1/r1@2b'], active: ['Fork'], historical: ['PayloadConflict'],
    });
    expect(r.rejections.map((x) => x.reason)).toEqual(['Unauthorized']);
  });
  it('92: undeterminable retraction authority stays active, so the fallback adds no Fork', () => {
    // An active defect remains, so the concrete fallback (no active defect at all) does not apply.
    expect(view(run(conflictedFork(), retract2b(NO_AUTH_FIELD)), 's1/r1')).toEqual({
      status: 'UnresolvedRevision', current: null, causes: ['Missing'], possible: ['s1/r1@2a', 's1/r1@2b', 'excluded'], active: ['RetractionAuthorityMissing'], historical: ['PayloadConflict'],
    });
  });
  it('a fork recorded at step 5 is not duplicated by the fallback', () => {
    expect(key(run(fork()), 's1/r1').activeDefects.filter((d) => d.reason === 'Fork')).toHaveLength(1);
    expect(key(run(fork(), retract2b(NO_PERM)), 's1/r1').activeDefects.map((d) => d.reason)).toEqual(['Fork']);
  });
});

describe('undeclared fields named like inherited JavaScript properties', () => {
  /** Inserts `"name": value` as an own JSON property (JSON.parse, never an object literal). */
  const withField = (occ: JsonValue, name: string, value: JsonValue, at: 'top' | 'concept'): JsonValue => {
    const member = `${JSON.stringify(name)}:${JSON.stringify(value)}`;
    const text = JSON.stringify(occ);
    return JSON.parse(at === 'top' ? `{${member},${text.slice(1)}` : text.replace('"concept":{', `"concept":{${member},`)) as JsonValue;
  };
  const cases = ['constructor', '__proto__', 'toString', 'hasOwnProperty'].flatMap((name) =>
    (['extra', { x: 1 }] as JsonValue[]).flatMap((value) => (['top', 'concept'] as const).map((at) => [name, value, at] as const)),
  );
  /** The result without undeclared-field diagnostics, occurrence lists or input positions. */
  const semantic = (r: S1Result) =>
    JSON.parse(JSON.stringify(r, (k, v) => (['occurrences', 'inputIndex'].includes(k) ? undefined : v))) as unknown;

  it.each(cases)('%s = %j (%s) is a diagnostic only: no crash, no payload, no conflict', (name, value, at) => {
    const plain = rev('s1', 'r1', '1');
    const extra = withField(plain, name, value, at);
    const path = at === 'top' ? name : `concept.${name}`;
    expect(Object.prototype.hasOwnProperty.call(at === 'top' ? extra : (extra as { concept: object }).concept, name)).toBe(true);
    const r = run([plain, extra]);
    expect(semantic(r)).toEqual(semantic(run([plain, plain])));
    const [variant, ...more] = key(r, 's1/r1').revisions[0]?.variants ?? [];
    expect(more).toEqual([]);
    expect(variant?.canonicalPayload).not.toContain(name);
    expect(variant?.occurrences.map((o) => o.undeclaredPaths)).toEqual([[], [path]]);
    expect(variant?.occurrences[1]?.undeclaredFields).toEqual([{ path, value }]);
  });

  it.each(cases)('%s = %j (%s) on a retraction is a diagnostic only', (name, value, at) => {
    const x = retr('x1', 's1', 'r1', sup('s1', 'r1', '1'));
    const extra = at === 'top' ? withField(x, name, value, 'top') : JSON.parse(JSON.stringify(x).replace('"target":{', `"target":{${JSON.stringify(name)}:${JSON.stringify(value)},`));
    const r = run([rev('s1', 'r1', '1')], [x, extra]);
    expect(semantic(r)).toEqual(semantic(run([rev('s1', 'r1', '1')], [x, x])));
    expect(r.retractions[0]?.variants).toHaveLength(1);
    expect(r.retractions[0]?.variants[0]?.occurrences[1]?.undeclaredPaths).toEqual([at === 'top' ? name : `target.${name}`]);
  });

  it('a declared field still participates in payload identity', () => {
    expect(key(run([rev('s1', 'r1', '1'), rev('s1', 'r1', '1', { episode: 'E2' })]), 's1/r1').activeDefects.map((d) => d.reason)).toEqual(['PayloadConflict']);
  });
});

describe('retraction trace', () => {
  const r1 = () => [rev('s1', 'r1', '1')];
  const prov = (id: string, acquisition = 'a0') => ({ acquisition, sourceRecordRef: `s1:${id}` });
  const occ = (provenance: JsonValue, undeclaredPaths: string[] = [], undeclaredFields: unknown[] = []) => ({ provenance, undeclaredPaths, undeclaredFields, inputIndex: expect.any(Number) });

  it('a valid retraction producing Retracted is traceable to its id, target, authority and provenance', () => {
    const r = run(r1(), [retr('x1', 's1', 'r1', sup('s1', 'r1', '1'))]);
    expect(key(r, 's1/r1').status).toBe('Retracted');
    expect(r.retractions).toEqual([
      {
        ref: { source: 's1', id: 'x1' },
        key: { source: 's1', localId: 'r1' },
        authority: 'Authorized',
        effect: { kind: 'Removed' },
        variants: [{ key: { source: 's1', localId: 'r1' }, digest: expect.stringMatching(/^[0-9a-f]{64}$/), canonicalPayload: expect.any(String), target: sup('s1', 'r1', '1'), occurrences: [occ(prov('x1'))] }],
      },
    ]);
    const payload = JSON.parse(r.retractions[0]?.variants[0]?.canonicalPayload ?? 'null') as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['author', 'key', 'target']); // CANONICALIZATION §1: no id, no provenance
  });

  it('identical duplicates keep every occurrence and change no semantic result', () => {
    const x = retr('x1', 's1', 'r1', sup('s1', 'r1', '1'));
    const again = { ...(x as object), provenance: prov('x1', 'a1'), note: 'n' } as JsonValue;
    const single = run(r1(), [x]);
    const dup = run(r1(), [again, x]);
    const semantic = (r: S1Result) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'occurrences' ? undefined : v))) as unknown;
    expect(semantic(dup)).toEqual(semantic(single));
    expect(dup.retractions[0]?.variants[0]?.occurrences).toEqual([occ(prov('x1')), occ(prov('x1', 'a1'), ['note'], [{ path: 'note', value: 'n' }])]);
  });

  it('conflicting variants stay separately inspectable, with authority not evaluated', () => {
    const r = run(r1(), [retr('x1', 's1', 'r1', sup('s1', 'r1', '1')), retr('x1', 's1', 'r1', sup('s1', 'r1', '9'), NO_PERM)]);
    const [t] = r.retractions;
    expect(t?.authority).toBe('NotEvaluated');
    expect(t?.effect).toEqual({ kind: 'Defect', cause: 'Conflicting', reason: 'RetractionConflict' });
    expect(t?.variants.map((v) => v.target).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual([sup('s1', 'r1', '1'), sup('s1', 'r1', '9')]);
    expect(t?.variants.every((v) => v.occurrences.length === 1)).toBe(true);
  });

  const chain = () => [rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: AMEND })];
  it.each([
    ['already-superseded target', chain(), sup('s1', 'r1', '1'), AMEND, 'Authorized', { kind: 'NoEffect', reason: 'TargetSuperseded' }],
    ['unauthorized', r1(), sup('s1', 'r1', '1'), NO_PERM, 'Unauthorized', { kind: 'Rejected', reason: 'Unauthorized' }],
    ['authority missing', r1(), sup('s1', 'r1', '1'), NO_AUTH_FIELD, 'Missing', { kind: 'Defect', cause: 'Missing', reason: 'RetractionAuthorityMissing' }],
    ['authority malformed', r1(), sup('s1', 'r1', '1'), { actor: 'u2', permissions: 'yes' }, 'Malformed', { kind: 'Defect', cause: 'Invalid', reason: 'RetractionAuthorityMalformed' }],
    ['rejected target', [rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: NO_PERM })], sup('s1', 'r1', '2'), AMEND, 'NotEvaluated', { kind: 'NoEffect', reason: 'TargetRejected' }],
    ['out-of-envelope target', [rev('s1', 'r1', '1'), rev('s1', 'r1', '2', { subject: 'P2' })], sup('s1', 'r1', '2'), AMEND, 'NotEvaluated', { kind: 'NoEffect', reason: 'TargetOutOfEnvelope' }],
    ['absent target revision', r1(), sup('s1', 'r1', '9'), AMEND, 'NotEvaluated', { kind: 'Defect', cause: 'Missing', reason: 'RetractionTargetAbsent' }],
    ['target key outside the envelope', [rev('s1', 'r5', '1', { subject: 'P2' })], sup('s1', 'r5', '1'), AMEND, 'NotEvaluated', { kind: 'NoEffect', reason: 'TargetKeyOutsideEnvelope' }],
  ] as const)('%s', (_n, revisions, target, author, authority, effect) => {
    const localId = (target as { localId: string }).localId;
    const r = run([...revisions], [retr('x1', 's1', localId, target, author)]);
    expect(r.retractions.map((x) => [x.authority, x.effect, x.variants.map((v) => v.target)])).toEqual([[authority, effect, [target]]]);
  });

  it.each([
    ['absent target fields', { localId: 'r1' }, 'Absent', 'Missing'],
    ['malformed target', 'r1@1', 'Malformed', 'Invalid'],
  ] as const)('%s: no target is invented', (_n, target, shown, cause) => {
    const r = run(r1(), [retr('x1', 's1', 'r1', target)]);
    expect(r.retractions.map((x) => [x.authority, x.effect, x.variants.map((v) => v.target)])).toEqual([['NotEvaluated', { kind: 'Unattributable', cause }, [shown]]]);
  });

  it('cross-key retraction keeps its own key and the target it names', () => {
    const r = run(r1(), [retr('x60', 's2', 'r60', sup('s1', 'r1', '1'))]);
    expect(r.retractions.map((x) => [x.key, x.authority, x.effect, x.variants[0]?.target])).toEqual([
      [{ source: 's2', localId: 'r60' }, 'NotEvaluated', { kind: 'Rejected', reason: 'CrossKeyRetraction' }, sup('s1', 'r1', '1')],
    ]);
  });

  it('variants naming different keys: the key is per variant and the group says Disagreed, in any input order', () => {
    // One retraction identity (s1, x1); one occurrence names key s1/r1, the other s1/r2.
    const rets = [retr('x1', 's1', 'r1', sup('s1', 'r1', '1')), retr('x1', 's1', 'r2', sup('s1', 'r1', '1'))];
    const revs = [rev('s1', 'r1', '1'), rev('s1', 'r2', '1')];
    const strip = (r: S1Result) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'inputIndex' ? undefined : v))) as unknown;
    const forward = run(revs, rets);
    expect(strip(run(revs, [...rets].reverse()))).toEqual(strip(forward));
    const [t, ...more] = forward.retractions;
    expect(more).toEqual([]);
    expect(t?.key).toBe('Disagreed');
    expect(t?.variants.map((v) => v.key.localId).sort()).toEqual(['r1', 'r2']);
    expect(t?.effect).toEqual({ kind: 'Defect', cause: 'Conflicting', reason: 'RetractionConflict' });
    expect(view(forward, 's1/r1')).toMatchObject({ causes: ['Conflicting'], active: ['RetractionConflict'] });
  });

  it('retraction traces and their occurrence order do not depend on input order', () => {
    const rets = [
      retr('x1', 's1', 'r1', sup('s1', 'r1', '1')),
      { ...(retr('x1', 's1', 'r1', sup('s1', 'r1', '1')) as object), note: 'b' } as JsonValue,
      { ...(retr('x1', 's1', 'r1', sup('s1', 'r1', '1')) as object), note: 'a' } as JsonValue,
      retr('x2', 's1', 'r2', sup('s1', 'r2', '1'), NO_AUTH_FIELD),
      retr('x2', 's1', 'r2', sup('s1', 'r2', '1')),
      retr('x3', 's1', 'r2', { localId: 'r2' }),
    ];
    const revs = [rev('s1', 'r1', '1'), rev('s1', 'r2', '1')];
    const strip = (r: S1Result) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'inputIndex' ? undefined : v))) as unknown;
    const baseline = strip(run(revs, rets));
    expect(strip(run([...revs].reverse(), [...rets].reverse()))).toEqual(baseline);
    expect(strip(run(revs, [...rets.slice(2), ...rets.slice(0, 2)]))).toEqual(baseline);
  });
});

describe('envelope, determinism and purity', () => {
  it('undeclared sources and other-subject keys are outside the envelope', () => {
    const r = run([rev('s3', 'r1', '1'), rev('s1', 'r5', '1', { subject: 'P2' })]);
    expect(r.keys).toEqual([]);
    expect(r.outsideEnvelope.map((o) => (o.kind === 'revision' ? show(o.ref) : o.ref.id))).toEqual(['s1/r5@1', 's3/r1@1']);
  });

  it('rejects an unsupported authority rule (configuration error, not patient data)', () => {
    expect(() =>
      experimentalResolveRevisionHistory({ envelope: ENV, authorityRule: 'other' as typeof DEMO_AUTHORITY_RULE, revisions: [], retractions: [] }),
    ).toThrow(/Unsupported authority rule/);
  });

  const mixed = (): [JsonValue[], JsonValue[]] => [
    [
      rev('s1', 'r1', '1'),
      rev('s1', 'r1', '1', { assertion: 'Denied', provenance: { acquisition: 'a1', sourceRecordRef: 'x' } }),
      rev('s1', 'r1', '2', { supersedes: sup('s1', 'r1', '1'), author: AMEND }),
      rev('s1', 'r2', '1'),
      rev('s1', 'r2', '2a', { supersedes: sup('s1', 'r2', '1'), author: AMEND }),
      rev('s1', 'r2', '2b', { assertion: 'Denied', supersedes: sup('s1', 'r2', '1'), author: AMEND }),
      rev('s1', 'r3', 'a', { supersedes: sup('s1', 'r3', 'b'), author: AMEND }),
      rev('s1', 'r3', 'b', { supersedes: sup('s1', 'r3', 'a'), author: AMEND }),
      rev('s2', 'r4', '1'),
      rev('s2', 'r4', '2', { supersedes: sup('s2', 'r4', '1'), author: NO_AUTH_FIELD }),
      rev('s2', 'r9', '1', { supersedes: sup('s1', 'r2', '1'), author: AMEND }),
    ],
    [retr('x1', 's1', 'r2', sup('s1', 'r2', '2b')), retr('x2', 's2', 'r4', sup('s2', 'r4', '2'))],
  ];
  /** Representation-only fields that legitimately follow input positions. */
  const stripIndices = (r: S1Result) =>
    JSON.parse(JSON.stringify(r, (k, v) => (k === 'inputIndex' ? undefined : v))) as unknown;

  it('input permutation changes nothing but input indices', () => {
    const [revs, rets] = mixed();
    const baseline = stripIndices(run(revs, rets));
    const permutations: [JsonValue[], JsonValue[]][] = [
      [[...revs].reverse(), [...rets].reverse()],
      [[...revs.slice(5), ...revs.slice(0, 5)], rets],
      [revs.filter((_, i) => i % 2 === 1).concat(revs.filter((_, i) => i % 2 === 0)), [...rets].reverse()],
    ];
    for (const [p, q] of permutations) expect(stripIndices(run(p, q))).toEqual(baseline);
  });

  it('an identical duplicate occurrence changes only that variant’s occurrence list', () => {
    const [revs, rets] = mixed();
    const base = run(revs, rets);
    const dup = run([...revs, revs[3] as JsonValue], rets);
    const strip = (r: S1Result) =>
      JSON.parse(JSON.stringify(r, (k, v) => (k === 'occurrences' || k === 'inputIndex' ? undefined : v))) as unknown;
    expect(strip(dup)).toEqual(strip(base));
    expect(key(dup, 's1/r2').revisions.find((x) => x.ref.revision === '1')?.variants[0]?.occurrences).toHaveLength(2);
  });

  it('does not mutate its input', () => {
    const [revs, rets] = mixed();
    const deepFreeze = (o: unknown): unknown => {
      if (o && typeof o === 'object') {
        Object.values(o).forEach(deepFreeze);
        Object.freeze(o);
      }
      return o;
    };
    const before = JSON.stringify([revs, rets]);
    deepFreeze(revs);
    deepFreeze(rets);
    expect(() => run(revs, rets)).not.toThrow();
    expect(JSON.stringify([revs, rets])).toBe(before);
  });

  it('mixed history resolves per key as the contract specifies', () => {
    const [revs, rets] = mixed();
    const r = run(revs, rets);
    expect(view(r, 's1/r1')).toMatchObject({ status: 'Current', current: 's1/r1@2', historical: ['PayloadConflict'] });
    expect(view(r, 's1/r2')).toMatchObject({ status: 'Current', current: 's1/r2@2a', historical: ['Fork'] });
    expect(view(r, 's1/r3')).toMatchObject({ causes: ['Invalid'], active: ['Cycle'] });
    expect(view(r, 's2/r4')).toMatchObject({ causes: ['Missing'], possible: ['s2/r4@1', 'excluded'] });
    expect(view(r, 's2/r9').status).toBe('NoRecord');
  });
});
