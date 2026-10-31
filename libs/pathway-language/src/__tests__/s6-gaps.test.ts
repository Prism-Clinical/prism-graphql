/**
 * EXPERIMENTAL, NONCLINICAL. S6 gap relevance (evidence-query contract §1.5, §4.1). Every expected
 * value is written from the contract's cell-combination and relevance tables, never by calling the
 * implementation. No base result, materiality, final cause set, evidence result or Need exists here.
 */
import {
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  GapRelevanceConfigurationError,
  MAX_JSON_DEPTH,
  PreviewEvaluationConfigurationError,
  QuerySelectionConfigurationError,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalEvaluatePreviewQuery,
  experimentalGapRelevance,
  experimentalResolveRevisionHistory,
  experimentalCheckAdmissibility,
  experimentalSelect,
  experimentalSelectForQuery,
  type CompiledPackage,
  type EvaluationSnapshot,
  type Gap,
  type GapRelevanceResult,
  type JsonValue,
  type SelectionResult,
} from '../index';

type J = { [k: string]: any };
const T = 'demo-model/DemoAssessment@0.1';
const PIN = 'demo-vs/item-x@1';
const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };

function program(id = 'q'): J {
  return {
    ppl: { languageVersion: 'ppl-1', capabilityProfileVersion: 'ppl-core-v0' },
    package: { id: 'test.s6', state: 'Draft' },
    references: [],
    valueSets: { [PIN]: { expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] } },
    applicability: { id: 'scope', kind: 'Predicate', expr: { all: [] } },
    nodes: [
      {
        id,
        kind: 'EvidenceQuery',
        subject: 'patient',
        output: 'Evidence<Boolean>',
        contract: {
          retrieve: { type: T, sources: ['s1', 's2'], valueSet: PIN },
          corrections: { authority: DEMO_AUTHORITY_RULE },
          admissible: { episode: SAME_EPISODE_RULE, encounter: SAME_ENCOUNTER_RULE, assertionKind: { in: ['ClinicianDocumented'] } },
          policy: 'explicit-assertion-v0',
          establishes: { eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Affirmed' }] },
          refutes: { eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Denied' }] },
          obligations: [{ disjoint: ['establishes', 'refutes'] }],
        },
      },
      { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: id } } },
    ],
  };
}
function compiled(p: J = program()): CompiledPackage {
  const r = experimentalCompile(p as JsonValue);
  if (r.outcome !== 'Compiled') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
const PKG = compiled();

function rev(localId: string, over: J = {}): J {
  const base: J = {
    key: { source: 's1', localId },
    revision: '1',
    recordType: T,
    subject: 'P1',
    episode: 'E1',
    encounter: 'N1',
    concept: { system: 'demo-cs', code: 'item-x' },
    assertion: 'Affirmed',
    assertionKind: 'ClinicianDocumented',
    author: { actor: 'u1', permissions: [] },
    provenance: { acquisition: 'a0', sourceRecordRef: `s1:${localId}` },
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base;
}
const cov = (id: string, status: string, over: J = {}): J => {
  const c: J = { id, appliesTo: { snapshot: 'snap-1' }, recordType: T, subject: 'P1', sources: ['s1', 's2'], status, attestedBy: 'demo-adapter@1', ...over };
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete c[k];
  return c;
};
const COMPLETE = cov('cov-all', 'Complete');
const fail = (id: string, over: J = {}): J => {
  const f: J = { id, attempt: `a-${id}`, appliesTo: { snapshot: 'snap-1' }, outcome: 'Failed', recordType: T, subject: 'P1', sources: ['s1'], ...over };
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete f[k];
  return f;
};
const rej = (id: string, over: J = {}): J => ({ id, appliesTo: { snapshot: 'snap-1' }, reason: 'UnparseableItem', ...over });
const snap = (coverage: J[] = [COMPLETE], failures: J[] = [], rejectedItems: J[] = [], id = 'snap-1'): EvaluationSnapshot => ({ id, coverage, failures, rejectedItems });
const CTX = { subject: 'P1', contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } } as const;
const sel = (snapshot: EvaluationSnapshot | undefined, revisions: J[] = [rev('r1')], retractions: J[] = [], pkg = PKG, query = 'q'): SelectionResult =>
  experimentalSelectForQuery({ package: pkg, query, revisions: revisions as JsonValue[], retractions: retractions as JsonValue[], ...CTX, ...(snapshot ? { snapshot } : {}) });
const run = (snapshot: EvaluationSnapshot, revisions?: J[], retractions?: J[]) => experimentalGapRelevance({ package: PKG, query: 'q', s4: sel(snapshot, revisions, retractions) });
const gap = (r: GapRelevanceResult, ref: string): Gap => {
  const gs = r.gaps.filter((x) => x.ref.label === ref);
  const g = gs[0];
  if (!g || gs.length > 1) throw new Error(`gap ${ref}: ${gs.length} matches among ${r.gaps.map((x) => x.ref.label)}`);
  return g;
};
/** Display labels of gap or statement references (identity is checked separately where it matters). */
const labels = (xs: readonly { readonly label: string }[]) => xs.map((x) => x.label);
const cell = (r: GapRelevanceResult, source: string) => r.cells.find((c) => c.source === source)!;
const verdicts = (g: Gap) => (g.kind === 'CoverageCell' ? {} : Object.fromEntries(g.dimensions.map((d) => [d.dimension, d.verdict])));

describe('S6 gap relevance: coverage cells (§1.5 combination, §4.1)', () => {
  it('Complete coverage for every declared source and no failure: no gap at all', () => {
    const r = run(snap());
    expect(r.cells.map((c) => [c.ref.label, c.status, labels(c.establishedBy)])).toEqual([
      ['cell:s1', 'Complete', ['cov-all']],
      ['cell:s2', 'Complete', ['cov-all']],
    ]);
    expect([r.gaps, r.relevant, r.irrelevant, r.diagnostics]).toEqual([[], [], [], []]);
  });

  it('same-scope Incomplete, Unknown and Absent are each a relevant InsufficientEvidence gap; the original state stays visible', () => {
    for (const [coverage, s2, reason] of [
      [[cov('covA', 'Complete', { sources: ['s1'] }), cov('covB', 'Incomplete', { sources: ['s2'] })], 'Incomplete', 'CellIncomplete'],
      [[cov('covA', 'Complete', { sources: ['s1'] }), cov('covB', 'Unknown', { sources: ['s2'] })], 'Unknown', 'CellUnknown'],
      [[cov('covA', 'Complete', { sources: ['s1'] })], 'Absent', 'CellAbsent'],
    ] as const) {
      const r = run(snap([...coverage]));
      expect(cell(r, 's1').status).toBe('Complete');
      expect(cell(r, 's2').status).toBe(s2);
      expect(labels(r.relevant)).toEqual(['cell:s2']);
      expect(gap(r, 'cell:s2')).toMatchObject({ kind: 'CoverageCell', relevant: true, basis: 'InsideEnvelope', causes: ['InsufficientEvidence'], findings: [{ cause: 'InsufficientEvidence', reason }], cell: { status: s2 } });
    }
  });

  it('absent coverage is detected per declared source: no statement, or only statements for another cell, is never Complete', () => {
    const none = run(snap([]));
    expect(none.cells.map((c) => c.status)).toEqual(['Absent', 'Absent']);
    expect(labels(none.relevant)).toEqual(['cell:s1', 'cell:s2']);
    const elsewhere = run(snap([cov('covP2', 'Complete', { subject: 'P2' }), cov('covO', 'Complete', { recordType: 'demo-model/Other@0.1' }), cov('covS3', 'Complete', { sources: ['s3'] })]));
    expect(elsewhere.cells.map((c) => c.status)).toEqual(['Absent', 'Absent']);
    expect(elsewhere.diagnostics).toEqual([]);
  });

  it('a Complete statement with an unstated dimension establishes nothing and is traced as insufficiently scoped (case 40)', () => {
    const r = run(snap([cov('covA', 'Complete', { subject: undefined })]));
    expect(r.cells.map((c) => c.status)).toEqual(['Absent', 'Absent']);
    expect(r.diagnostics).toMatchObject([{ code: 'InsufficientlyScopedStatement', ref: { label: 'covA', identity: { kind: 'coverage', id: 'covA' } }, unstated: ['subject'] }]);
    const n = run(snap([cov('covA', 'Complete', { sources: null })]));
    expect(n.diagnostics).toMatchObject([{ code: 'InsufficientlyScopedStatement', ref: { label: 'covA' }, unstated: ['sources'] }]);
  });

  it('Complete never overrides Incomplete or Unknown; the contradiction is traced (cases 35–38)', () => {
    const r = run(snap([cov('covA', 'Complete', { sources: ['s1'] }), cov('covB', 'Unknown', { sources: ['s1', 's2'] })]));
    expect(r.cells.map((c) => c.status)).toEqual(['Unknown', 'Unknown']);
    expect(r.diagnostics).toMatchObject([{ code: 'ContradictoryAttestation', ref: { label: 'cell:s1', identity: { kind: 'CoverageCell', source: 's1' } }, basis: 'AffectingStatement', establishedBy: [{ label: 'covA' }], affectedBy: [{ label: 'covB' }] }]);
    const both = run(snap([cov('covB', 'Complete'), cov('covC', 'Incomplete', { sources: ['s2'] }), cov('covD', 'Unknown', { sources: ['s2'] })]));
    expect(cell(both, 's2')).toMatchObject({ status: 'Incomplete', affectedBy: [{ statement: { label: 'covC' }, as: 'Incomplete' }, { statement: { label: 'covD' }, as: 'Unknown' }] });
  });

  it('a malformed statement is Unknown for every cell it might affect and adds Invalid; never dropped or read as Complete', () => {
    const r = run(snap([cov('covA', 'Complete', { sources: ['s1'] }), cov('covB', 'Done', { sources: ['s2'] })]));
    expect(cell(r, 's2')).toMatchObject({ status: 'Unknown', affectedBy: [{ statement: { label: 'covB' }, as: 'Malformed' }] });
    expect(gap(r, 'cell:s2')).toMatchObject({ causes: ['Invalid', 'InsufficientEvidence'], findings: [{ cause: 'InsufficientEvidence', reason: 'CellUnknown' }, { cause: 'Invalid', reason: 'CellMalformedStatement' }] });
    expect(r.statements.find((s) => s.ref.label === 'covB')).toMatchObject({ malformed: ['status'], current: true });
    // A malformed Complete (no attestedBy) establishes nothing, and its well-formed subject still excludes other subjects.
    const m = run(snap([cov('covA', 'Complete', { attestedBy: undefined })]));
    expect(m.cells.map((c) => c.status)).toEqual(['Unknown', 'Unknown']);
    const other = run(snap([COMPLETE, cov('covX', 'Done', { subject: 'P2' })]));
    expect(other.cells.map((c) => c.status)).toEqual(['Complete', 'Complete']);
    // Unreadable currency is kept as current and malformed.
    const noSnap = run(snap([COMPLETE, cov('covY', 'Incomplete', { appliesTo: undefined })]));
    expect(noSnap.cells.map((c) => c.status)).toEqual(['Unknown', 'Unknown']);
  });

  it('a statement for another snapshot is traced as not current and ignored (case 44)', () => {
    const r = run(snap([cov('cov-all', 'Complete', { appliesTo: { snapshot: 'snap-0' } })], [fail('f1', { appliesTo: { snapshot: 'snap-0' } })]));
    expect(r.cells.map((c) => c.status)).toEqual(['Absent', 'Absent']);
    expect(labels(r.notCurrent)).toEqual(['cov-all', 'f1']);
    expect(r.gaps.map((g) => g.ref.label)).toEqual(['cell:s1', 'cell:s2']);
  });

  it('a Complete claim beside a missing correction target in that cell is a contradictory attestation; the cell stays Complete (case 26)', () => {
    const r = run(snap(), [rev('r9', { revision: '2', supersedes: { source: 's1', localId: 'r9', revision: '1' }, author: AMEND })]);
    expect(r.cells.map((c) => c.status)).toEqual(['Complete', 'Complete']);
    expect(r.diagnostics).toMatchObject([{ code: 'ContradictoryAttestation', ref: { label: 'cell:s1' }, basis: 'MissingTarget', establishedBy: [{ label: 'cov-all' }], keys: [{ source: 's1', localId: 'r9' }] }]);
    // The S1 history defect stays an S1 defect: it is not a gap.
    expect(r.gaps).toEqual([]);
  });
});

describe('S6 gap relevance: failures and rejected items (§4.1 dimension table)', () => {
  it('an acquisition failure is its own relevant gap despite Complete coverage (case 41)', () => {
    const r = run(snap([COMPLETE], [fail('f1', { sources: ['s2'] })]));
    expect(cell(r, 's2').status).toBe('Complete');
    expect(gap(r, 'f1')).toMatchObject({ kind: 'AcquisitionFailure', origin: 'snapshot', relevant: true, basis: 'NotProvenDisjoint', provenBy: [], causes: ['Unavailable'], findings: [{ cause: 'Unavailable', reason: 'AcquisitionFailed' }] });
    expect(verdicts(gap(r, 'f1'))).toEqual({ recordType: 'Matches', subject: 'Matches', sources: 'Overlaps', valueSet: 'Unstated', episode: 'Unstated', encounter: 'Unstated' });
    expect(labels(r.relevant)).toEqual(['f1']);
  });

  it('a different record type, a different subject or disjoint sources each prove irrelevance; irrelevant gaps stay inspectable', () => {
    const r = run(snap([COMPLETE], [fail('fT', { recordType: 'demo-model/OtherAssessment@0.1' }), fail('fP', { subject: 'P2' }), fail('fS', { sources: ['s3'] })]));
    expect(labels(r.relevant)).toEqual([]);
    expect(labels(r.irrelevant)).toEqual(['fP', 'fS', 'fT']);
    expect(gap(r, 'fT')).toMatchObject({ relevant: false, basis: 'ProvenDisjoint', provenBy: ['recordType'], causes: ['Unavailable'] });
    expect(gap(r, 'fP')).toMatchObject({ relevant: false, provenBy: ['subject'] });
    expect(gap(r, 'fS')).toMatchObject({ relevant: false, provenBy: ['sources'] });
    expect(verdicts(gap(r, 'fS')).sources).toBe('Disjoint');
    expect(r.envelope).toEqual({ recordType: T, subject: 'P1', sources: ['s1', 's2'], authorityRule: DEMO_AUTHORITY_RULE, sourceDisjointnessProves: true });
    expect(gap(r, 'fT')).toMatchObject({ item: fail('fT', { recordType: 'demo-model/OtherAssessment@0.1' }) });
  });

  it('sources that overlap the declared set, even partly, prove nothing', () => {
    const r = run(snap([COMPLETE], [fail('f1', { sources: ['s2', 's3'] })]));
    expect(gap(r, 'f1')).toMatchObject({ relevant: true, provenBy: [] });
    expect(verdicts(gap(r, 'f1')).sources).toBe('Overlaps');
  });

  it('an unstated record type, subject or source proves nothing (case 49)', () => {
    for (const d of ['recordType', 'subject', 'sources']) {
      const r = run(snap([COMPLETE], [fail('f1', { [d]: undefined, ...(d === 'subject' ? {} : { subject: 'P1' }) })]));
      expect(gap(r, 'f1')).toMatchObject({ relevant: true, provenBy: [] });
      expect(verdicts(gap(r, 'f1'))[d]).toBe('Unstated');
    }
    const nul = run(snap([COMPLETE], [fail('f1', { subject: null })]));
    expect(verdicts(gap(nul, 'f1')).subject).toBe('Unstated');
    const bare = run(snap([COMPLETE], [{ id: 'f1', attempt: 'a', appliesTo: { snapshot: 'snap-1' }, outcome: 'TimedOut' }]));
    expect(gap(bare, 'f1')).toMatchObject({ relevant: true, provenBy: [] });
  });

  it('several dimensions: one valid proving dimension suffices, and every proving dimension is named', () => {
    const one = run(snap([COMPLETE], [fail('f1', { subject: undefined, recordType: 'demo-model/OtherAssessment@0.1', sources: ['s1'] })]));
    expect(gap(one, 'f1')).toMatchObject({ relevant: false, provenBy: ['recordType'] });
    const two = run(snap([COMPLETE], [fail('f1', { subject: 'P2', sources: ['s9'] })]));
    expect(gap(two, 'f1')).toMatchObject({ relevant: false, provenBy: ['subject', 'sources'] });
  });

  it('a different concept/value set, episode or encounter never proves irrelevance (case 48)', () => {
    const r = run(snap([COMPLETE], [fail('f1', { valueSet: 'demo-vs/item-y@1', episode: 'E9', encounter: 'N9' })]));
    expect(gap(r, 'f1')).toMatchObject({ relevant: true, provenBy: [] });
    expect(verdicts(gap(r, 'f1'))).toMatchObject({ valueSet: 'NeverProves', episode: 'NeverProves', encounter: 'NeverProves' });
  });

  it('a malformed dimension proves nothing and adds Invalid; a malformed failure is still a gap', () => {
    const r = run(snap([COMPLETE], [fail('f1', { subject: 7, outcome: 'Exploded' })]));
    expect(gap(r, 'f1')).toMatchObject({ relevant: true, malformed: ['outcome', 'subject'], causes: ['Unavailable', 'Invalid'] });
    expect(verdicts(gap(r, 'f1')).subject).toBe('Malformed');
    const empty = run(snap([COMPLETE], [fail('f1', { sources: [] })]));
    expect(gap(empty, 'f1')).toMatchObject({ relevant: true, malformed: ['sources'] });
    // A valid proving dimension still proves beside a malformed member.
    const still = run(snap([COMPLETE], [fail('f1', { subject: 'P2', outcome: 'Exploded' })]));
    expect(gap(still, 'f1')).toMatchObject({ relevant: false, provenBy: ['subject'], causes: ['Unavailable', 'Invalid'] });
  });

  it('rejected items: a definite boundary proves irrelevance; an undetermined one stays relevant with Invalid', () => {
    const r = run(snap([COMPLETE], [], [rej('x1', { recordType: T, subject: 'P2', sources: ['s1'] }), rej('x2'), rej('x3', { recordType: T, subject: 'P1' })]));
    expect(gap(r, 'x1')).toMatchObject({ kind: 'RejectedItem', origin: 'snapshot', relevant: false, provenBy: ['subject'], causes: ['Invalid'], findings: [{ cause: 'Invalid', reason: 'ItemRejected' }] });
    expect(gap(r, 'x2')).toMatchObject({ relevant: true, provenBy: [] });
    expect(verdicts(gap(r, 'x2'))).toEqual({ recordType: 'Unstated', subject: 'Unstated', sources: 'Unstated' });
    expect(gap(r, 'x3')).toMatchObject({ relevant: true });
    expect(labels(r.relevant)).toEqual(['x2', 'x3']);
  });

  it('S1 rejected items from this evaluation: unattributable retractions (Missing / Invalid) and unidentified occurrences are relevant gaps', () => {
    const retractions = [
      { id: 'x60', key: { source: 's2', localId: 'r1' }, target: { source: 's2', localId: 'r1' }, author: AMEND, provenance: { acquisition: 'a0', sourceRecordRef: 's2:x60' } },
      { id: 'x61', key: { source: 's1', localId: 'r1' }, target: { source: 's1', localId: 7, revision: '1' }, author: AMEND, provenance: { acquisition: 'a0', sourceRecordRef: 's1:x61' } },
    ];
    const r = run(snap(), [rev('r1'), { recordType: T, subject: 'P1' }], retractions);
    expect(gap(r, 's2:x60')).toMatchObject({ kind: 'RejectedItem', origin: 'S1', relevant: true, causes: ['Missing'], item: { kind: 'UnattributableRetraction', retraction: { source: 's2', id: 'x60' }, cause: 'Missing' } });
    expect(verdicts(gap(r, 's2:x60'))).toEqual({ recordType: 'Unstated', subject: 'Unstated', sources: 'Overlaps' });
    expect(gap(r, 's1:x61')).toMatchObject({ origin: 'S1', relevant: true, causes: ['Invalid'] });
    expect(gap(r, 'unidentified:revision#1')).toMatchObject({ origin: 'S1', relevant: true, causes: ['Invalid'], item: { kind: 'UnidentifiedOccurrence', occurrence: 'revision', inputIndex: 1 } });
    expect(labels(r.relevant)).toEqual(['s1:x61', 's2:x60', 'unidentified:revision#1']);
  });

  it('S1 boundary rejections and correction-history defects are not gaps', () => {
    const r = run(snap(), [
      rev('r1'),
      rev('r1', { revision: '2', supersedes: { source: 's1', localId: 'r1', revision: '1' }, subject: 'P2', author: AMEND }),
      rev('r2', { revision: '2', supersedes: { source: 's2', localId: 'r2', revision: '1' }, author: AMEND }),
      rev('r3'),
      rev('r3', { revision: '1', assertion: 'Denied', provenance: { acquisition: 'a1' } }),
    ]);
    expect(r.gaps).toEqual([]);
  });
});

describe('S6 gap relevance: simultaneous gaps, order and duplicates', () => {
  const coverage = [cov('covA', 'Complete', { sources: ['s1'] }), cov('covB', 'Incomplete', { sources: ['s2'] }), cov('covZ', 'Complete', { appliesTo: { snapshot: 'snap-0' } })];
  const failures = [fail('f2', { subject: 'P2' }), fail('f1', { sources: ['s1'] }), fail('f3', { sources: ['s3'] })];
  const rejected = [rej('x2', { subject: 'P1' }), rej('x1', { recordType: 'demo-model/Other@0.1' })];

  it('every simultaneous gap and failure is kept, each with its own decision', () => {
    const r = run(snap(coverage, failures, rejected));
    expect(r.gaps.map((g) => [g.ref.label, g.kind, g.relevant])).toEqual([
      ['cell:s2', 'CoverageCell', true],
      ['f1', 'AcquisitionFailure', true],
      ['f2', 'AcquisitionFailure', false],
      ['f3', 'AcquisitionFailure', false],
      ['x1', 'RejectedItem', false],
      ['x2', 'RejectedItem', true],
    ]);
    expect(labels(r.relevant)).toEqual(['cell:s2', 'f1', 'x2']);
    expect(labels(r.irrelevant)).toEqual(['f2', 'f3', 'x1']);
    expect(labels(r.notCurrent)).toEqual(['covZ']);
  });

  it('input permutation changes nothing', () => {
    const a = run(snap(coverage, failures, rejected));
    const b = run(snap([...coverage].reverse(), [failures[2]!, failures[0]!, failures[1]!], [...rejected].reverse()));
    expect(b).toEqual(a);
  });

  it('identical duplicates merge (occurrences counted); the same id with different content keeps both, as id#digest', () => {
    const dup = run(snap([COMPLETE], [fail('f1', { sources: ['s3'] }), fail('f1', { sources: ['s3'] })]));
    expect(dup.gaps).toHaveLength(1);
    expect(gap(dup, 'f1')).toMatchObject({ relevant: false, occurrences: 2 });
    const clash = run(snap([COMPLETE], [fail('f1', { sources: ['s3'] }), fail('f1', { sources: ['s1'] })]));
    expect(clash.gaps.map((g) => [g.ref.label.replace(/[0-9a-f]{64}$/, 'D'), g.relevant]).sort()).toEqual([
      ['f1#D', false],
      ['f1#D', true],
    ]);
    expect(labels(clash.relevant)).toHaveLength(1);
    const reversed = run(snap([COMPLETE], [fail('f1', { sources: ['s1'] }), fail('f1', { sources: ['s3'] })]));
    expect(reversed).toEqual(clash);
  });
});

describe('S6 gap relevance: ownership of the evaluation', () => {
  const bad = (input: unknown, pattern: RegExp) => {
    expect(() => experimentalGapRelevance(input as never)).toThrow(GapRelevanceConfigurationError);
    expect(() => experimentalGapRelevance(input as never)).toThrow(pattern);
  };

  it('accepts only package, query and an S4 result bound to them with a snapshot', () => {
    const s4 = sel(snap());
    for (const f of ['coverage', 'failures', 'rejectedItems', 'snapshot', 'subject', 's1', 'gaps']) bad({ package: PKG, query: 'q', s4, [f]: [] }, new RegExp(`unexpected input field\\(s\\) ${f}`));
    bad(null, /input must be an object/);
    bad({ package: PKG, query: 'q', s4: sel(undefined) }, /without a snapshot/);
    bad({ package: PKG, query: 'q', s4: JSON.parse(JSON.stringify(s4)) }, /produced by experimentalSelectForQuery/);
    bad({ package: compiled(), query: 'q', s4 }, /another compiled package/);
    bad({ package: PKG, query: 'pv', s4 }, /not an EvidenceQuery/);
  });

  it('another query of the same package, or a standalone selection, is rejected', () => {
    const two = compiled({ ...program(), nodes: [...program().nodes, ...program('q2').nodes.map((n: J) => (n.id === 'pv' ? { ...n, id: 'pv2' } : n))] });
    const s4 = experimentalSelectForQuery({ package: two, query: 'q', revisions: [], retractions: [], ...CTX, snapshot: snap() });
    bad({ package: two, query: 'q2', s4 }, /selected for query "q", not "q2"/);
    const s1 = experimentalResolveRevisionHistory({ envelope: { recordType: T, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: [], retractions: [] });
    const s3 = experimentalCheckAdmissibility({ s1, valueSet: PIN, expansion: { id: PIN, expansion: [], coveredSystems: [] }, admissible: { encounter: SAME_ENCOUNTER_RULE, episode: SAME_EPISODE_RULE, assertionKind: { in: ['ClinicianDocumented'] } }, contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } });
    bad({ package: PKG, query: 'q', s4: experimentalSelect({ s3 }) }, /not bound to a query/);
  });

  it('preview packages are outside this slice, and preview evaluation takes no snapshot', () => {
    const p = experimentalCompilePreview({ ...program(), nodes: [{ ...program().nodes[0], contract: { hole: { id: 'H', type: 'EvidenceSelectionContract<Boolean>', explains: 'x' } } }, program().nodes[1]] } as JsonValue);
    if (p.outcome !== 'PreviewPackage') throw new Error('preview');
    bad({ package: p.package, query: 'q', s4: sel(snap()) }, /preview packages are not evaluated here/);
    expect(() => experimentalEvaluatePreviewQuery({ package: p.package, query: 'q', revisions: [], retractions: [], ...CTX, snapshot: snap() } as never)).toThrow(PreviewEvaluationConfigurationError);
  });

  it('the snapshot is validated structurally at selection; an omitted list is never read as empty', () => {
    const badSel = (snapshot: unknown, pattern: RegExp) => expect(() => sel(snapshot as never)).toThrow(pattern);
    badSel({ id: 'snap-1', coverage: [], failures: [] }, /must state rejectedItems explicitly/);
    badSel({ id: 'snap-1', coverage: [], failures: [], rejectedItems: [], extra: 1 }, /unexpected snapshot field\(s\) extra/);
    badSel({ id: 1, coverage: [], failures: [], rejectedItems: [] }, /snapshot.id must be a string/);
    badSel({ id: 's', coverage: {}, failures: [], rejectedItems: [] }, /snapshot.coverage must be an array/);
    badSel({ id: 's', coverage: [{ status: 'Complete' }], failures: [], rejectedItems: [] }, /snapshot.coverage\[0\] must be an object with a string id/);
    badSel({ id: 's', coverage: [], failures: ['f1'], rejectedItems: [] }, /snapshot.failures\[0\]/);
    expect(() => sel({ id: 's', coverage: [], failures: [], rejectedItems: [] })).not.toThrow(QuerySelectionConfigurationError);
  });

  it('the snapshot does not change selection', () => {
    expect(sel(snap([], [fail('f1')]))).toEqual(sel(undefined));
  });

  it('interleaved evaluations with identical record IDs keep their own statements and S1 items', () => {
    const a = sel(snap([COMPLETE], [fail('f1', { subject: 'P2' })]));
    const b = sel(snap([], [fail('f1')], [], 'snap-9'), [rev('r1'), { recordType: T }]);
    const ra = experimentalGapRelevance({ package: PKG, query: 'q', s4: a });
    const rb = experimentalGapRelevance({ package: PKG, query: 'q', s4: b });
    expect(labels(ra.relevant)).toEqual([]);
    expect(rb.snapshot).toBe('snap-9');
    expect(labels(rb.notCurrent)).toEqual(['f1']);
    expect(labels(rb.relevant)).toEqual(['cell:s1', 'cell:s2', 'unidentified:revision#1']);
    expect(experimentalGapRelevance({ package: PKG, query: 'q', s4: a })).toEqual(ra);
  });

  it('the subject comes from the same evaluation: another subject makes P1 failures irrelevant and P2 ones relevant', () => {
    const s4 = experimentalSelectForQuery({ package: PKG, query: 'q', revisions: [], retractions: [], ...CTX, subject: 'P2', snapshot: snap([cov('c', 'Complete', { subject: 'P2' })], [fail('f1'), fail('f2', { subject: 'P2' })]) });
    const r = experimentalGapRelevance({ package: PKG, query: 'q', s4 });
    expect([r.envelope.subject, labels(r.relevant), labels(r.irrelevant)]).toEqual(['P2', ['f2'], ['f1']]);
  });
});

describe('S6 gap relevance: no clinical conclusion; immutability', () => {
  it('no evidence result, base result, materiality, final causes or Need is emitted', () => {
    const r = run(snap([cov('c', 'Incomplete')], [fail('f1')], [rej('x1')]));
    const names = new Set<string>();
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) (names.add(k), walk(v));
    };
    walk(r);
    for (const n of ['evidence', 'baseResult', 'material', 'materiality', 'needs', 'need', 'decision', 'supportingEvidenceIds', 'candidateEvidenceIds', 'causeAttribution', 'rule']) expect(names.has(n)).toBe(false);
    expect(r.scope).toBe('gap-relevance');
  });

  it('later edits to the snapshot, records or output cannot change a completed result', () => {
    const failures = [fail('f1', { subject: 'P2' })];
    const s = snap([COMPLETE], failures);
    const s4 = sel(s);
    failures[0]!.subject = 'P1';
    (s.coverage as J[]).length = 0;
    const r = experimentalGapRelevance({ package: PKG, query: 'q', s4 });
    expect([labels(r.relevant), labels(r.irrelevant), r.cells.map((c) => c.status)]).toEqual([[], ['f1'], ['Complete', 'Complete']]);
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    expect(experimentalGapRelevance({ package: PKG, query: 'q', s4 })).toEqual(r);
  });
});

describe('S6 gap relevance: review of 8e6c46f — JSON validity, identity, unrecognized members', () => {
  const badSel = (snapshot: unknown, pattern: RegExp) => {
    expect(() => sel(snapshot as never)).toThrow(QuerySelectionConfigurationError);
    expect(() => sel(snapshot as never)).toThrow(pattern);
  };

  it('a sparse source array is a configuration error at selection, never valid disjoint sources', () => {
    badSel(snap([COMPLETE], [fail('f1', { sources: new Array(1) })]), /snapshot\.failures\[0\]\.sources: sparse array/);
    // eslint-disable-next-line no-sparse-arrays
    badSel(snap([COMPLETE], [fail('f1', { sources: [, 's3'] })]), /sparse array/);
    badSel(snap([cov('c', 'Complete', { sources: new Array(2) })]), /snapshot\.coverage\[0\]\.sources: sparse array/);
    badSel(snap(new Array(1) as J[]), /snapshot\.coverage: sparse array/);
  });

  it('other non-JSON values are rejected before canonicalization', () => {
    const extra = Object.assign(['s1'], { scope: 'x' });
    const accessor = Object.defineProperty(fail('f1'), 'subject', { get: () => 'P2', enumerable: true });
    class Statement {
      id = 'f1';
    }
    for (const [failure, pattern] of [
      [fail('f1', { sources: extra }), /extra array member/],
      [accessor, /accessor/],
      [new Statement(), /not a plain object/],
      [{ ...fail('f1'), subject: undefined as unknown as string, encounter: 'N1' }, /undefined is not JSON/],
      [fail('f1', { attempt: Number.NaN }), /non-finite number/],
      [{ ...fail('f1'), [Symbol('s')]: 1 }, /symbol key/],
      [fail('f1', { subject: '\uD800' }), /lone surrogate/],
    ] as const) badSel(snap([COMPLETE], [failure as J]), pattern);
  });

  it('cyclic statements are a configuration error with the cycle path, not a stack overflow (review of 3e0f967)', () => {
    const self = fail('f1');
    self['appliesTo'] = self;
    badSel(snap([COMPLETE], [self]), /snapshot\.failures\[0\]\.appliesTo: cycle \(refers back to snapshot\.failures\[0\]\)/);
    const a: J = { snapshot: 'snap-1' };
    const b: J = { back: a };
    a['via'] = [b];
    badSel(snap([COMPLETE], [fail('f1', { appliesTo: a })]), /snapshot\.failures\[0\]\.appliesTo\.via\[0\]\.back: cycle \(refers back to snapshot\.failures\[0\]\.appliesTo\)/);
    const list: J[] = [COMPLETE];
    list.push(list as unknown as J);
    badSel(snap(list), /snapshot\.coverage\[1\]: cycle \(refers back to snapshot\.coverage\)/);
  });

  it('nesting is limited to MAX_JSON_DEPTH levels below the list, counting the statement as level 1 (review of f8801bf)', () => {
    expect(MAX_JSON_DEPTH).toBe(32);
    // `levels` containers, outermost first: deep(1) is {}.
    const deep = (levels: number, array = false): J => {
      let v: J = {};
      for (let i = 1; i < levels; i++) v = (array ? [v] : { d: v }) as J;
      return v;
    };
    // Statement (level 1) + 31 containers: the deepest is level 32, exactly at the limit.
    expect(() => sel(snap([COMPLETE], [fail('f1', { extra: deep(31) })]))).not.toThrow();
    expect(() => sel(snap([COMPLETE], [fail('f1', { extra: deep(31, true) })]))).not.toThrow();
    // One level beyond: the path names the first container past the limit.
    badSel(snap([COMPLETE], [fail('f1', { extra: deep(32) })]), new RegExp(`^snapshot\\.failures\\[0\\]\\.extra${'\\.d'.repeat(31)}: nested more than 32 levels deep`));
    badSel(snap([COMPLETE], [fail('f1', { extra: deep(32, true) })]), new RegExp(`^snapshot\\.failures\\[0\\]\\.extra${'\\[0\\]'.repeat(31)}: nested more than 32 levels deep`));
    // Very deep input is a configuration error, not a stack overflow.
    badSel(snap([deep(200_000)]), /^snapshot\.coverage\[0\](\.d){32}: nested more than 32 levels deep/);
    badSel(snap([COMPLETE], [fail('f1', { extra: deep(200_000, true) })]), /nested more than 32 levels deep/);
  });

  it('an object shared by separate branches, forming no cycle, is accepted', () => {
    const sources = ['s3'];
    const applies = { snapshot: 'snap-1' };
    const r = run(snap([{ ...COMPLETE, appliesTo: applies }], [fail('f1', { sources, appliesTo: applies }), fail('f2', { sources, subject: 'P2', appliesTo: applies })]));
    expect(labels(r.irrelevant)).toEqual(['f1', 'f2']);
    expect(r.cells.map((c) => c.status)).toEqual(['Complete', 'Complete']);
    const shared = { snapshot: 'snap-1' };
    expect(() => sel(snap([COMPLETE], [fail('f1', { appliesTo: shared, sources: ['s1'] }), fail('f2', { appliesTo: shared })]))).not.toThrow();
  });

  it('the reported order dependence is gone: an empty source list is malformed and relevant in either order', () => {
    const a = run(snap([COMPLETE], [fail('f1', { sources: [] }), fail('f1', { sources: ['s3'] })]));
    const b = run(snap([COMPLETE], [fail('f1', { sources: ['s3'] }), fail('f1', { sources: [] })]));
    expect(b).toEqual(a);
    const byMalformed = a.gaps.map((g) => (g.kind === 'CoverageCell' ? null : [g.malformed, g.relevant]));
    expect(byMalformed).toEqual(expect.arrayContaining([[['sources'], true], [[], false]]));
    expect(a.relevant).toHaveLength(1);
  });

  it('identities never collide: a failure named cell:s1 is distinct from the coverage cell for s1', () => {
    const r = run(snap([cov('covS2', 'Complete', { sources: ['s2'] })], [fail('cell:s1', { subject: 'P2' })]));
    expect(labels(r.relevant)).toEqual(['cell:s1']);
    expect(labels(r.irrelevant)).toEqual(['cell:s1']);
    expect(r.relevant[0]!.identity).toEqual({ kind: 'CoverageCell', origin: 'coverage', source: 's1' });
    expect(r.irrelevant[0]!.identity).toMatchObject({ kind: 'AcquisitionFailure', origin: 'snapshot', statement: { kind: 'failure', id: 'cell:s1' } });
    expect(r.relevant[0]!.key).not.toBe(r.irrelevant[0]!.key);
  });

  it('keys are unique across gaps and statements, and relevant and irrelevant never share one', () => {
    const r = run(
      snap([cov('f1', 'Complete'), cov('s1:x61', 'Unknown', { sources: ['s2'] })], [fail('f1', { subject: 'P2' }), fail('s1:x61')], [rej('f1'), rej('cell:s2', { subject: 'P2' })]),
      [rev('r1')],
      [{ id: 'x61', key: { source: 's1', localId: 'r1' }, target: { source: 's1', localId: 'r1' }, author: AMEND, provenance: { acquisition: 'a0', sourceRecordRef: 's1:x61' } }],
    );
    const keys = r.gaps.map((g) => g.ref.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(r.relevant.map((x) => x.key).filter((k) => r.irrelevant.some((y) => y.key === k))).toEqual([]);
    expect(new Set(r.statements.map((s) => s.ref.key)).size).toBe(r.statements.length);
    // Same label, different gaps: a failure, an S1 retraction and a coverage statement all named s1:x61.
    expect(r.gaps.filter((g) => g.ref.label === 's1:x61').map((g) => [g.kind, g.origin])).toEqual([
      ['AcquisitionFailure', 'snapshot'],
      ['RejectedItem', 'S1'],
    ]);
  });

  it('same-id conflicting statements have unambiguous identities carrying their digests', () => {
    const r = run(snap([COMPLETE], [fail('f1', { sources: ['s3'] }), fail('f1', { sources: ['s1'] })]));
    const ids = r.gaps.map((g) => (g.ref.identity as { statement: { id: string; digest: string } }).statement);
    expect(ids.map((x) => x.id)).toEqual(['f1', 'f1']);
    expect(new Set(ids.map((x) => x.digest)).size).toBe(2);
    expect(r.gaps.every((g) => g.ref.label === `f1#${(g.ref.identity as { statement: { digest: string } }).statement.digest}`)).toBe(true);
  });

  it('unrecognized members are rejected: the statement is malformed, never a narrower or broader claim', () => {
    const c = run(snap([cov('cov-all', 'Complete', { concept: { system: 'demo-cs', code: 'item-x' } })]));
    expect(c.cells.map((x) => x.status)).toEqual(['Unknown', 'Unknown']);
    expect(c.statements[0]).toMatchObject({ malformed: ['concept'] });
    expect(gap(c, 'cell:s1').causes).toEqual(['Invalid', 'InsufficientEvidence']);
    const f = run(snap([COMPLETE], [fail('f1', { subject: 'P2', note: 'x' })]));
    expect(gap(f, 'f1')).toMatchObject({ relevant: false, provenBy: ['subject'], malformed: ['note'], causes: ['Unavailable', 'Invalid'] });
    const a = run(snap([cov('cov-all', 'Complete', { appliesTo: { snapshot: 'snap-1', scope: 'x' } })]));
    expect(a.statements[0]).toMatchObject({ malformed: ['appliesTo'], current: true });
    expect(a.cells.map((x) => x.status)).toEqual(['Unknown', 'Unknown']);
  });
});

describe('S1 occurrence nesting: depth and cycles in revisions and retractions (review of 055552f)', () => {
  // `levels` containers, outermost first: deep(1) is {}.
  const deep = (levels: number, array = false): J => {
    let v: J = {};
    for (let i = 1; i < levels; i++) v = (array ? [v] : { d: v }) as J;
    return v;
  };
  const s1 = (revisions: J[], retractions: J[] = []) =>
    experimentalResolveRevisionHistory({ envelope: { recordType: T, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: revisions as JsonValue[], retractions: retractions as JsonValue[] });
  const retraction = (over: J = {}): J => ({ id: 'x1', key: { source: 's1', localId: 'r1' }, target: { source: 's1', localId: 'r1', revision: '1' }, author: AMEND, provenance: { acquisition: 'a0', sourceRecordRef: 's1:x1' }, ...over });
  const status = (r: ReturnType<typeof s1>) => r.keys.map((k) => [`${k.key.source}/${k.key.localId}`, k.status]);
  const tooDeep = (path: string, segment: string, n: number) => `not representable: ${path}${segment.repeat(n)}: nested more than 32 levels deep`;

  /** Each case through standalone S1 and through query-bound selection with gap relevance. */
  function both(revisions: J[], retractions: J[], unidentified: { kind: 'revision' | 'retraction'; inputIndex: number; reason: string | RegExp }[], keys: (string | null)[][]) {
    const r = s1(revisions, retractions);
    // S1 order: by kind (code point), then input index.
    expect(r.unidentified).toHaveLength(unidentified.length);
    unidentified.forEach((u, i) => expect(r.unidentified[i]).toEqual({ kind: u.kind, inputIndex: u.inputIndex, reason: typeof u.reason === 'string' ? u.reason : expect.stringMatching(u.reason) }));
    expect(status(r)).toEqual(keys);
    // Query-bound: never a configuration error; each rejected occurrence is a relevant Invalid gap.
    const g = run(snap(), revisions, retractions);
    const expected = unidentified.map((u) => `unidentified:${u.kind}#${u.inputIndex}`);
    expect(labels(g.relevant)).toEqual(expected);
    for (const l of expected) expect(gap(g, l)).toMatchObject({ kind: 'RejectedItem', origin: 'S1', relevant: true, causes: ['Invalid'] });
  }

  it('exactly at the limit (the occurrence is level 1, the deepest container level 32) is accepted and retained', () => {
    both([rev('r1', { note: deep(31) }), rev('r2', { note: deep(31, true) })], [], [], [['s1/r1', 'Current'], ['s1/r2', 'Current']]);
    // Retained metadata: provenance (level 2) with an undeclared member reaching level 32.
    const prov = { acquisition: 'a0', sourceRecordRef: 's1:r1', extra: deep(30) };
    const r = s1([rev('r1', { provenance: prov })]);
    expect(r.unidentified).toEqual([]);
    expect(JSON.stringify(r.keys[0]!.revisions[0]!.variants[0]!.occurrences[0]!.provenance)).toBe(JSON.stringify(prov));
    both([rev('r1', { provenance: prov, concept: { system: 'demo-cs', code: deep(30) } })], [retraction({ note: deep(31) })], [], [['s1/r1', 'Retracted']]);
  });

  it('one level beyond is a rejected occurrence naming the first container past the limit, in payload, metadata or undeclared fields', () => {
    both(
      [rev('r1'), rev('r2', { note: deep(32) }), rev('r3', { provenance: { acquisition: 'a0', sourceRecordRef: 's1:r3', extra: deep(31, true) } }), rev('r4', { concept: { system: 'demo-cs', code: deep(31) } })],
      [retraction({ note: deep(32) })],
      [
        { kind: 'retraction', inputIndex: 0, reason: tooDeep('retractions[0].note', '.d', 31) },
        { kind: 'revision', inputIndex: 1, reason: tooDeep('revisions[1].note', '.d', 31) },
        { kind: 'revision', inputIndex: 2, reason: tooDeep('revisions[2].provenance.extra', '[0]', 30) },
        { kind: 'revision', inputIndex: 3, reason: tooDeep('revisions[3].concept.code', '.d', 30) },
      ],
      // The rejected retraction does not apply: r1 stays Current, and only the relevant gap records the loss.
      [['s1/r1', 'Current']],
    );
  });

  it('very deep input is a rejected occurrence, not a stack overflow or configuration error', () => {
    both(
      [rev('r1', { note: deep(200_000) }), rev('r2', { provenance: { acquisition: 'a0', sourceRecordRef: 's1:r2', extra: deep(200_000, true) } })],
      [retraction({ note: deep(200_000) })],
      [
        { kind: 'retraction', inputIndex: 0, reason: tooDeep('retractions[0].note', '.d', 31) },
        { kind: 'revision', inputIndex: 0, reason: tooDeep('revisions[0].note', '.d', 31) },
        { kind: 'revision', inputIndex: 1, reason: tooDeep('revisions[1].provenance.extra', '[0]', 30) },
      ],
      [],
    );
  });

  it('cycles are rejected occurrences with the path of both ends', () => {
    const self = rev('r2');
    self['note'] = self;
    const prov: J = { acquisition: 'a0', sourceRecordRef: 's1:r3' };
    prov['self'] = prov;
    const target: J = { source: 's1', localId: 'r1', revision: '1' };
    target['extra'] = { back: target };
    both(
      [rev('r1'), self, rev('r3', { provenance: prov })],
      [retraction({ target })],
      [
        { kind: 'retraction', inputIndex: 0, reason: 'not representable: retractions[0].target.extra.back: cycle (refers back to retractions[0].target)' },
        { kind: 'revision', inputIndex: 1, reason: 'not representable: revisions[1].note: cycle (refers back to revisions[1])' },
        { kind: 'revision', inputIndex: 2, reason: 'not representable: revisions[2].provenance.self: cycle (refers back to revisions[2].provenance)' },
      ],
      [['s1/r1', 'Current']],
    );
  });

  it('objects shared across occurrences and fields, forming no cycle, are accepted', () => {
    const prov = { acquisition: 'a0', sourceRecordRef: 's1:shared' };
    const note = { text: ['a', 'b'] };
    both([rev('r1', { provenance: prov, note, note2: note }), rev('r2', { provenance: prov, concept: { system: 'demo-cs', code: 'item-x' } })], [retraction({ provenance: prov, note })], [], [['s1/r1', 'Retracted'], ['s1/r2', 'Current']]);
  });
});
