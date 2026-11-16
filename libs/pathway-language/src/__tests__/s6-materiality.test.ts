/**
 * EXPERIMENTAL, NONCLINICAL. S6 step B: materiality of unresolved records (evidence-query contract
 * §4.2 step B, "Step B boundary"). Every expected value is written from the step B table applied to
 * the ORIGINAL step A base, never by calling the implementation. Step C (cause union and
 * attribution), the evidence result and Needs do not exist here.
 */
import {
  DEMO_AUTHORITY_RULE,
  MaterialityConfigurationError,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalBaseResult,
  experimentalCheckAdmissibility,
  experimentalCompilePreview,
  experimentalMateriality,
  experimentalResolveRevisionHistory,
  experimentalSelect,
  type EvaluationSnapshot,
  type JsonValue,
  type MaterialityResult,
} from '../index';
import { AMEND, COMPLETE, NONINF, OTHER_CS, OUT, PIN, PKG, REFUTING, SUPPORTING, T, UNCLASSIFIED, compiled, fail, history, program, rev, sel, snap, sup, type J } from './support/s6-records';

const mat = (revisions: J[], retractions: J[] = [], snapshot: EvaluationSnapshot = snap()): MaterialityResult => experimentalMateriality({ package: PKG, query: 'q', s4: sel(revisions, retractions, snapshot) });
const keyOf = (k: { source: string; localId: string }) => `${k.source}/${k.localId}`;
/** Every decision, in RecordKey order: key, material, satisfying classes, immaterial reason. */
const decisions = (r: MaterialityResult) => r.records.map((x) => [keyOf(x.key), x.material, x.satisfiedBy, x.reason ?? null]);
const summary = (r: MaterialityResult) => ({ base: r.stepA.base, row: r.row, after: r.after, change: r.change, material: r.material.map(keyOf), immaterial: r.immaterial.map(keyOf) });

// Unresolved records with known possible classes (§3.7), each on its own key.
/** Encounter omitted: admissibility unresolved. `Denied` → {Refuting, excluded}. */
const canRefute = (id: string) => rev(id, { assertion: 'Denied', encounter: undefined });
/** {Supporting, excluded}. */
const canSupport = (id: string) => rev(id, { encounter: undefined });
/** {NonInformative, excluded}. */
const nonInfOrExcluded = (id: string) => rev(id, { assertion: 'Indeterminate', encounter: undefined });
/** History unresolved, both alternatives inadmissible: {excluded}. */
const excludedOnly = (id: string) => history(id, { encounter: 'N0' }, { encounter: 'N0' });
/** §2.8: unresolved candidacy beside a definite mismatch: {excluded}. */
const candidacyBesideInadmissible = (id: string) => rev(id, { concept: OTHER_CS, encounter: 'N0' });
/** @2 corrects an absent @1 out of domain: possibilities {@2, unknown} → every class. */
const withUnknownMarker = (id: string) => rev(id, { revision: '2', supersedes: sup(id), concept: OUT, author: AMEND });
const ALL = ['Supporting', 'Refuting', 'NonInformative', 'excluded'];

describe('S6 step B: the materiality table (§4.2)', () => {
  it('1. Known(true): a record that could refute is material; one that could only support is not', () => {
    const r = mat([SUPPORTING, canRefute('r4'), canSupport('r12')]);
    expect(summary(r)).toEqual({
      base: { status: 'Known', value: true }, row: 'KnownTrue', after: { status: 'Unresolved' }, change: 'DemotedToUnresolved', material: ['s1/r4'], immaterial: ['s1/r12'],
    });
    expect(decisions(r)).toEqual([
      ['s1/r12', false, [], 'NoRefutingPossibility'],
      ['s1/r4', true, ['Refuting'], null],
    ]);
    expect(r.records.map((x) => x.possibleClasses)).toEqual([['Supporting', 'excluded'], ['Refuting', 'excluded']]);
    // Only supporting possibilities: the provisional Known stays (case 11).
    expect(summary(mat([SUPPORTING, canSupport('r12')]))).toMatchObject({ after: { status: 'Known', value: true }, change: 'Unchanged', material: [], immaterial: ['s1/r12'] });
  });

  it('2. Known(false): a record that could support is material; one that could only refute is not', () => {
    const r = mat([REFUTING, canSupport('r12'), canRefute('r4')]);
    expect(summary(r)).toMatchObject({ base: { status: 'Known', value: false }, row: 'KnownFalse', after: { status: 'Unresolved' }, material: ['s1/r12'], immaterial: ['s1/r4'] });
    expect(decisions(r)).toEqual([
      ['s1/r12', true, ['Supporting'], null],
      ['s1/r4', false, [], 'NoSupportingPossibility'],
    ]);
    expect(summary(mat([REFUTING, canRefute('r4')]))).toMatchObject({ after: { status: 'Known', value: false }, change: 'Unchanged' });
  });

  it('3. Unresolved base: either Supporting or Refuting makes a record material; the base stays Unresolved', () => {
    const r = mat([NONINF, canSupport('r12'), canRefute('r4')]);
    expect(r.stepA.rule).toBe(5);
    expect(summary(r)).toMatchObject({ row: 'Unresolved', after: { status: 'Unresolved' }, change: 'Unchanged', material: ['s1/r12', 's1/r4'], immaterial: [] });
    expect(decisions(r)).toEqual([
      ['s1/r12', true, ['Supporting'], null],
      ['s1/r4', true, ['Refuting'], null],
    ]);
    expect(r.opposingClasses).toEqual(['Supporting', 'Refuting']);
  });

  it('4. an established conflict stays Unresolved with its base Conflicting cause intact', () => {
    const records = [SUPPORTING, rev('r2', { assertion: 'Denied' }, 's2'), canSupport('r12')];
    const r = mat(records);
    expect(summary(r)).toMatchObject({ row: 'Unresolved', after: { status: 'Unresolved' }, change: 'Unchanged', material: ['s1/r12'] });
    expect(r.stepA.baseCauses).toEqual(experimentalBaseResult({ package: PKG, query: 'q', s4: sel(records) }).baseCauses);
    expect(r.stepA.baseCauses.map((c) => c.cause)).toEqual(['Conflicting']);
  });

  it('5. NonInformative-only, excluded-only and mixed possibilities are immaterial under every row', () => {
    const quiet = [nonInfOrExcluded('r20'), ...excludedOnly('r21'), rev('r22', { assertion: 'Indeterminate', encounter: undefined, concept: OTHER_CS })];
    for (const [bases, row, reason] of [
      [[SUPPORTING], 'KnownTrue', 'NoRefutingPossibility'],
      [[REFUTING], 'KnownFalse', 'NoSupportingPossibility'],
      [[NONINF], 'Unresolved', 'NoSupportingOrRefutingPossibility'],
    ] as const) {
      const r = mat([...bases, ...quiet]);
      expect(r.row).toBe(row);
      expect(decisions(r)).toEqual([
        ['s1/r20', false, [], reason],
        ['s1/r21', false, [], reason],
        ['s1/r22', false, [], reason],
      ]);
      expect(r.records.map((x) => x.possibleClasses)).toEqual([['NonInformative', 'excluded'], ['excluded'], ['NonInformative', 'excluded']]);
      expect(r.after).toEqual(r.stepA.base);
    }
  });

  it('6. a selected Unclassified record is an unresolved record and can be material (case 4)', () => {
    const t = mat([SUPPORTING, UNCLASSIFIED]);
    expect(t.records).toEqual([
      { key: { source: 's1', localId: 'r3' }, kind: 'SelectedUnclassified', status: 'Selected', role: 'Unclassified', possibleClasses: ['Supporting', 'Refuting', 'NonInformative'], material: true, satisfiedBy: ['Refuting'] },
    ]);
    expect(t.after).toEqual({ status: 'Unresolved' });
    expect(decisions(mat([REFUTING, UNCLASSIFIED]))).toEqual([['s1/r3', true, ['Supporting'], null]]);
    // Alone (rule 5): material under the Unresolved row by either class.
    expect(decisions(mat([UNCLASSIFIED]))).toEqual([['s1/r3', true, ['Supporting', 'Refuting'], null]]);
  });

  it('7. an unknown marker is assessed through its existing possible classes', () => {
    const r = mat([SUPPORTING, withUnknownMarker('r11')]);
    expect(r.records[0]).toMatchObject({ kind: 'UnresolvedKey', possibleClasses: ALL, material: true, satisfiedBy: ['Refuting'] });
    expect(decisions(mat([REFUTING, withUnknownMarker('r11')]))).toEqual([['s1/r11', true, ['Supporting'], null]]);
  });

  it('8. unresolved history is assessed per key: never resolved, selected or counted as definite evidence', () => {
    const r = mat([SUPPORTING, ...history('r9', {}, { assertion: 'Denied' })]);
    expect(r.records).toEqual([
      { key: { source: 's1', localId: 'r9' }, kind: 'UnresolvedKey', status: 'Unresolved', role: 'UnresolvedCandidate', possibleClasses: ['Supporting', 'Refuting'], material: true, satisfiedBy: ['Refuting'] },
    ]);
    expect(r.stepA.supporting.map((n) => n.revision.localId)).toEqual(['r1']);
    expect(r.stepA.refuting).toEqual([]);
    // Agreeing alternatives cannot oppose Known(true): immaterial, and still unresolved history.
    const agree = mat([SUPPORTING, ...history('r9', {}, {})]);
    expect(agree.records[0]).toMatchObject({ status: 'Unresolved', possibleClasses: ['Supporting'], material: false });
    expect(agree.after).toEqual({ status: 'Known', value: true });
  });

  it('9. unresolved candidacy beside definite inadmissibility is immaterial', () => {
    for (const bases of [[SUPPORTING], [REFUTING], [NONINF], []]) {
      const r = mat([...bases, candidacyBesideInadmissible('r6')]);
      expect(r.records).toHaveLength(1);
      expect(r.records[0]).toMatchObject({ role: 'CandidacyUnresolvedBesideInadmissible', possibleClasses: ['excluded'], material: false });
      expect(r.after).toEqual(r.stepA.base);
    }
  });

  it('10. no unresolved record leaves the base unchanged', () => {
    for (const records of [[SUPPORTING], [REFUTING], [NONINF], []]) {
      const r = mat(records);
      expect([r.records, r.material, r.immaterial, r.change]).toEqual([[], [], [], 'Unchanged']);
      expect(r.after).toEqual(r.stepA.base);
    }
  });

  it('11–12. a base made Unresolved by a gap uses the Unresolved row; gaps are neither reinterpreted nor copied', () => {
    const gap = snap([COMPLETE], [fail('f1', { sources: ['s2'] })]);
    const r = mat([SUPPORTING, canSupport('r12')], [], gap);
    expect(r.stepA.rule).toBe(4);
    expect(r.stepA.relevantGaps.map((g) => g.label)).toEqual(['f1']);
    // Without the gap the same record cannot oppose Known(true); with it, the Unresolved row applies.
    expect(summary(r)).toMatchObject({ row: 'Unresolved', after: { status: 'Unresolved' }, change: 'Unchanged', material: ['s1/r12'] });
    expect(summary(mat([SUPPORTING, canSupport('r12')]))).toMatchObject({ row: 'KnownTrue', material: [], immaterial: ['s1/r12'] });
    // Step A is carried unchanged: no gap cause enters its base causes, and step B adds no cause field.
    expect(r.stepA).toEqual(experimentalBaseResult({ package: PKG, query: 'q', s4: sel([SUPPORTING, canSupport('r12')], [], gap) }));
    expect(r.stepA.baseCauses).toEqual([]);
    expect(Object.keys(r)).not.toContain('causes');
  });
});

describe('S6 step B: every record is assessed against the ORIGINAL base', () => {
  // Key names decide RecordKey order: refuting first in one set, supporting first in the other.
  const known = (first: J, second: J) => [SUPPORTING, first, second];

  it('Known(true): the refuting record is material and the supporting-only one immaterial, in either key or input order', () => {
    const refutingFirst = mat(known(canRefute('a1'), canSupport('z1')));
    expect(decisions(refutingFirst)).toEqual([
      ['s1/a1', true, ['Refuting'], null],
      // Assessed against Known(true), not the Unresolved status a1 already produced.
      ['s1/z1', false, [], 'NoRefutingPossibility'],
    ]);
    const supportingFirst = mat(known(canSupport('a1'), canRefute('z1')));
    expect(decisions(supportingFirst)).toEqual([
      ['s1/a1', false, [], 'NoRefutingPossibility'],
      ['s1/z1', true, ['Refuting'], null],
    ]);
    for (const r of [refutingFirst, supportingFirst]) expect([r.row, r.after, r.change]).toEqual(['KnownTrue', { status: 'Unresolved' }, 'DemotedToUnresolved']);
    expect(mat([canSupport('z1'), canRefute('a1'), SUPPORTING])).toEqual(refutingFirst);
  });

  it('Known(false): the supporting record is material and the refuting-only one immaterial, in either order', () => {
    const supportingFirst = mat([REFUTING, canSupport('a1'), canRefute('z1')]);
    expect(decisions(supportingFirst)).toEqual([
      ['s1/a1', true, ['Supporting'], null],
      ['s1/z1', false, [], 'NoSupportingPossibility'],
    ]);
    const refutingFirst = mat([REFUTING, canRefute('a1'), canSupport('z1')]);
    expect(decisions(refutingFirst)).toEqual([
      ['s1/a1', false, [], 'NoSupportingPossibility'],
      ['s1/z1', true, ['Supporting'], null],
    ]);
    for (const r of [supportingFirst, refutingFirst]) expect([r.row, r.after]).toEqual(['KnownFalse', { status: 'Unresolved' }]);
  });
});

describe('S6 step B: determinism, ownership and immutability', () => {
  it('input permutation and identical duplicate occurrences preserve every decision', () => {
    const records = [SUPPORTING, canRefute('r4'), canSupport('r12'), UNCLASSIFIED, ...history('r9', {}, { assertion: 'Denied' }), withUnknownMarker('r11')];
    const a = mat(records);
    expect(mat([...records].reverse())).toEqual(a);
    expect(mat([...records, { ...records[1] }, { ...records[0] }])).toEqual(a);
    expect(a.material.map(keyOf)).toEqual(['s1/r11', 's1/r3', 's1/r4', 's1/r9']);
    expect(a.immaterial.map(keyOf)).toEqual(['s1/r12']);
  });

  it('interleaved evaluations sharing record IDs keep their own evidence and gaps', () => {
    const records = [SUPPORTING, canSupport('r12')];
    const plain = sel(records);
    const gapped = sel(records, [], snap([COMPLETE], [fail('f1')], 'snap-9'));
    const refuted = sel([SUPPORTING, canRefute('r12')]);
    const a = experimentalMateriality({ package: PKG, query: 'q', s4: plain });
    const b = experimentalMateriality({ package: PKG, query: 'q', s4: gapped });
    const c = experimentalMateriality({ package: PKG, query: 'q', s4: refuted });
    expect([a.row, a.material.map(keyOf)]).toEqual(['KnownTrue', []]);
    expect([b.row, b.material.map(keyOf), b.snapshot]).toEqual(['Unresolved', ['s1/r12'], 'snap-9']);
    expect([c.row, c.material.map(keyOf)]).toEqual(['KnownTrue', ['s1/r12']]);
    expect(experimentalMateriality({ package: PKG, query: 'q', s4: plain })).toEqual(a);
  });

  const bad = (input: unknown, pattern: RegExp) => {
    expect(() => experimentalMateriality(input as never)).toThrow(MaterialityConfigurationError);
    expect(() => experimentalMateriality(input as never)).toThrow(pattern);
  };

  it('accepts only package, query and an S4 result bound to them with a snapshot; no override is accepted', () => {
    const s4 = sel([SUPPORTING]);
    for (const f of ['base', 'stepA', 'material', 'materiality', 'possibleClasses', 'classifications', 'gaps', 'row', 'payload']) {
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

  it('the output is detached and deeply immutable, and has no final evidence, causes or Needs', () => {
    const records = [rev('r1'), canRefute('r4')];
    const r = mat(records);
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    const before = JSON.stringify(r);
    records[1]!['assertion'] = 'Affirmed';
    expect(JSON.stringify(r)).toBe(before);
    expect(() => {
      (r.material as unknown[]).push({ source: 's1', localId: 'x' });
    }).toThrow();
    expect(Object.keys(r).sort()).toEqual(
      ['after', 'change', 'experimental', 'immaterial', 'material', 'notRun', 'opposingClasses', 'packageId', 'query', 'records', 'row', 'scope', 'snapshot', 'stage', 'step', 'stepA'].sort(),
    );
    expect([r.experimental, r.stage, r.step, r.scope, r.notRun]).toEqual(['nonclinical-s6-materiality-v0', 'S6', 'B', 'materiality', ['StepC:Causes', 'Evidence', 'Needs']]);
    // Nowhere, step A included: no final evidence, candidate IDs, Needs or attribution.
    for (const f of ['evidence', 'candidateEvidenceIds', 'needs', 'causeAttribution']) expect(JSON.stringify(r)).not.toContain(`"${f}"`);
  });
});
