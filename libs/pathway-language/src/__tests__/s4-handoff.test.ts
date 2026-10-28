/**
 * EXPERIMENTAL, NONCLINICAL. The S3 → S4 → S5 evidence handoff (contract §2.8, "Evidence
 * handoff"). These tests use the internal accessors directly; no criterion is evaluated.
 */
import { EvidenceHandoffError } from '../handoff';
import {
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCheckAdmissibility,
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
import { admissibilityEvidence } from '../s3/admissibility';
import { selectionEvidence } from '../s4/select';

const ENV = { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] } as const;
const PIN = 'demo-vs/item-x@1';
const VS: ValueSetExpansion = { id: PIN, expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] };
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };
const ADM = { encounter: SAME_ENCOUNTER_RULE, episode: SAME_EPISODE_RULE, assertionKind: { in: ['ClinicianDocumented'] } };

type Over = Record<string, JsonValue | undefined>;
function rev(source: string, localId: string, revision: string, over: Over = {}): Record<string, JsonValue> {
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
const nodes = (k: KeySelection) => k.possibilities.filter((p): p is Extract<PossibleSelection, { kind: 'node' }> => p.kind === 'node');
const assertionOf = (r: SelectionResult, p: PossibleSelection) => selectionEvidence(r, p)['assertion'];

describe('evidence handoff: one snapshot per result', () => {
  it('two snapshots with the same identity: equal selections, each retrieving its own assertion', () => {
    const affirmed = sel([rev('s1', 'r1', '1', { assertion: 'Affirmed' })]);
    const denied = sel([rev('s1', 'r1', '1', { assertion: 'Denied' })]);
    expect(denied).toEqual(affirmed); // selection alone cannot tell them apart …
    expect(assertionOf(affirmed, affirmed.keys[0]!.possibilities[0]!)).toBe('Affirmed'); // … the handoff can
    expect(assertionOf(denied, denied.keys[0]!.possibilities[0]!)).toBe('Denied');
  });

  it('resolving a second snapshot never changes what the first result supplies', () => {
    const first = sel([rev('s1', 'r1', '1', { assertion: 'Affirmed' })]);
    const p = first.keys[0]!.possibilities[0]!;
    const before = selectionEvidence(first, p);
    sel([rev('s1', 'r1', '1', { assertion: 'Denied' })]);
    expect(selectionEvidence(first, p)).toBe(before);
    expect(before['assertion']).toBe('Affirmed');
  });

  it('interleaved stages: S4 of the first snapshot, run after S3 of the second, still supplies the first snapshot’s evidence', () => {
    const s3Affirmed = s3Of(s1Of([rev('s1', 'r1', '1', { assertion: 'Affirmed' })]));
    const s3Denied = s3Of(s1Of([rev('s1', 'r1', '1', { assertion: 'Denied' })]));
    const s4Affirmed = experimentalSelect({ s3: s3Affirmed });
    const s4Denied = experimentalSelect({ s3: s3Denied });
    expect(assertionOf(s4Affirmed, s4Affirmed.keys[0]!.possibilities[0]!)).toBe('Affirmed');
    expect(assertionOf(s4Denied, s4Denied.keys[0]!.possibilities[0]!)).toBe('Denied');
  });

  it('a possibility of one result cannot be read through another, even with identical identity and content', () => {
    const a = sel([rev('s1', 'r1', '1')]);
    const b = sel([rev('s1', 'r1', '1')]);
    expect(() => selectionEvidence(b, a.keys[0]!.possibilities[0]!)).toThrow(EvidenceHandoffError);
    expect(() => selectionEvidence(a, b.keys[0]!.possibilities[0]!)).toThrow(EvidenceHandoffError);
  });

  it('copied or fabricated results and possibilities own no evidence', () => {
    const r = sel([rev('s1', 'r1', '1')]);
    const p = r.keys[0]!.possibilities[0]!;
    const copy = JSON.parse(JSON.stringify(r)) as SelectionResult;
    expect(copy).toEqual(r);
    expect(() => selectionEvidence(copy, copy.keys[0]!.possibilities[0]!)).toThrow(EvidenceHandoffError);
    expect(() => selectionEvidence(copy, p)).toThrow(EvidenceHandoffError); // real possibility, fabricated owner
    expect(() => selectionEvidence(r, { ...p } as PossibleSelection)).toThrow(EvidenceHandoffError); // fabricated possibility
    expect(() => selectionEvidence({ ...r }, p)).toThrow(EvidenceHandoffError); // relabelled owner
    expect(() => selectionEvidence(null as never, p)).toThrow(EvidenceHandoffError);
  });

  it('S3 evidence is likewise bound to its own result; S4 gets its own binding, not S3’s objects', () => {
    const s3 = s3Of(s1Of([rev('s1', 'r1', '1', { assertion: 'Denied' })]));
    const s4 = experimentalSelect({ s3 });
    const p3 = s3.keys[0]!.possibilities[0]!;
    const p4 = s4.keys[0]!.possibilities[0]!;
    expect(admissibilityEvidence(s3, p3)['assertion']).toBe('Denied');
    expect(selectionEvidence(s4, p4)['assertion']).toBe('Denied');
    expect(() => selectionEvidence(s4, p3 as never)).toThrow(EvidenceHandoffError);
    expect(() => admissibilityEvidence(s3, p4 as never)).toThrow(EvidenceHandoffError);
  });
});

describe('evidence handoff: exact revision and variant', () => {
  it('digest-qualified variants each retrieve their own payload', () => {
    const r = sel([rev('s1', 'r1', '1', { assertion: 'Affirmed' }), rev('s1', 'r1', '1', { assertion: 'Denied', provenance: { acquisition: 'a1' } })]);
    const ps = nodes(key(r, 's1/r1'));
    expect(ps).toHaveLength(2);
    const byDigest = new Map(ps.map((p) => [p.node.digest, selectionEvidence(r, p)['assertion']]));
    expect([...byDigest.values()].sort()).toEqual(['Affirmed', 'Denied']);
    // And each variant's payload is the one whose digest it carries, not the other.
    const s1 = s1Of([rev('s1', 'r1', '1', { assertion: 'Affirmed' }), rev('s1', 'r1', '1', { assertion: 'Denied', provenance: { acquisition: 'a1' } })]);
    for (const v of s1.keys[0]!.revisions[0]!.variants) {
      expect(byDigest.get(v.digest)).toBe(JSON.parse(v.canonicalPayload).assertion);
    }
  });

  it('an authorized correction supplies the current revision’s payload, not the superseded one', () => {
    const r = sel([rev('s1', 'r1', '1', { assertion: 'Denied' }), rev('s1', 'r1', '2', { assertion: 'Affirmed', supersedes: sup('s1', 'r1', '1'), author: AMEND })]);
    const ps = nodes(key(r, 's1/r1'));
    expect(ps.map((p) => p.node.revision.revision)).toEqual(['2']);
    expect(selectionEvidence(r, ps[0]!)['assertion']).toBe('Affirmed');
  });

  it('unresolved-history alternatives keep separate evidence, and nothing is selected', () => {
    const r = sel([rev('s1', 'r1', '1', { assertion: 'Affirmed' }), rev('s1', 'r1', '2', { assertion: 'Denied', supersedes: sup('s1', 'r1', '1'), author: { actor: 'u2' } })]);
    const k = key(r, 's1/r1');
    expect(k.status).toBe('Unresolved');
    expect(r.selected).toEqual([]);
    expect(nodes(k).map((p) => [p.node.revision.revision, selectionEvidence(r, p)['assertion'], p.selection.disposition])).toEqual([
      ['1', 'Affirmed', 'NotSelected'],
      ['2', 'Denied', 'NotSelected'],
    ]);
  });

  it('inadmissible possibilities keep their evidence for inspection but stay NotSelected', () => {
    const r = sel([rev('s1', 'r1', '1', { encounter: 'N0', assertion: 'Denied' })]);
    const p = key(r, 's1/r1').possibilities[0]!;
    expect(selectionEvidence(r, p)['assertion']).toBe('Denied');
    expect(p).toMatchObject({ selection: { disposition: 'NotSelected', blockers: ['Inadmissible'] } });
    expect(r.selected).toEqual([]);
  });

  it('excluded and unknown markers, and out-of-domain possibilities, supply no payload', () => {
    const r = sel(
      [rev('s1', 'r1', '1'), rev('s1', 'r9', '2', { supersedes: sup('s1', 'r9', '1'), author: AMEND }), rev('s1', 'r8', '1', { concept: { system: 'demo-cs', code: 'item-y' } })],
      [{ id: 'x1', key: { source: 's1', localId: 'r1' }, target: sup('s1', 'r1', '1'), author: { actor: 'u2' }, provenance: { acquisition: 'a0', sourceRecordRef: 's1:x1' } }],
    );
    const markers = r.keys.flatMap((k) => k.possibilities.filter((p) => p.kind !== 'node'));
    expect(markers.map((p) => p.kind).sort()).toEqual(['excluded', 'unknown']);
    for (const m of markers) expect(() => selectionEvidence(r, m)).toThrow(EvidenceHandoffError);
    const ood = key(r, 's1/r8').possibilities[0]!;
    expect(ood).toMatchObject({ candidacy: 'OutOfDomain' });
    expect(() => selectionEvidence(r, ood)).toThrow(EvidenceHandoffError);
  });
});

describe('evidence handoff: immutability', () => {
  it('editing the original revisions or the S1 result after evaluation changes no retained evidence', () => {
    const revision = rev('s1', 'r1', '1', { assertion: 'Affirmed' });
    const s1 = s1Of([revision]);
    const s4 = experimentalSelect({ s3: s3Of(s1) });
    const p = s4.keys[0]!.possibilities[0]!;
    revision['assertion'] = 'Denied';
    const variant = s1.keys[0]!.revisions[0]!.variants[0]! as { canonicalPayload: string };
    variant.canonicalPayload = variant.canonicalPayload.replace('Affirmed', 'Denied');
    expect(selectionEvidence(s4, p)['assertion']).toBe('Affirmed');
  });

  it('returned evidence is deep-frozen, so a consumer cannot alter it for the next one', () => {
    const r = sel([rev('s1', 'r1', '1')]);
    const p = r.keys[0]!.possibilities[0]!;
    const e = selectionEvidence(r, p) as Record<string, unknown>;
    expect(() => {
      e['assertion'] = 'Denied';
    }).toThrow(TypeError);
    expect(() => {
      (e['concept'] as Record<string, unknown>)['code'] = 'item-y';
    }).toThrow(TypeError);
    expect(selectionEvidence(r, p)['assertion']).toBe('Affirmed');
  });

  it('the handoff leaves serialized selection results exactly as before', () => {
    const r = sel([rev('s1', 'r1', '1')]);
    expect(JSON.stringify(r)).not.toContain('Affirmed');
    expect(Object.keys(r.keys[0]!.possibilities[0]!)).toEqual(['kind', 'node', 'candidacy', 's2Findings', 'rules', 'admissibility', 'selection']);
  });
});
