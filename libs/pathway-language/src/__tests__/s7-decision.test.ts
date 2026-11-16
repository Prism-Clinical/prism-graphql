/**
 * EXPERIMENTAL, NONCLINICAL. S7: one query's Evidence<Boolean> projected to Decision (evidence-query
 * contract §5.2, "Query decision boundary"). Every expected decision is written from §5.2 and the
 * §4.2 outcome of the records, never by calling the implementation. No Need, program or preview runs.
 */
import {
  QueryDecisionConfigurationError,
  experimentalCompilePreview,
  experimentalExecuteWithSuppliedQueryResults,
  experimentalQueryDecision,
  experimentalQueryEvidence,
  type EvaluationSnapshot,
  type JsonValue,
  type QueryDecisionResult,
  type SuppliedEvidence,
} from '../index';
import { projectEvidence } from '../execute/project';
import { COMPLETE, INADMISSIBLE, NONINF, PKG, REFUTING, SUPPORTING, UNCLASSIFIED, compiled, fail, history, program, rev, sel, show, snap, type J } from './support/s6-records';

const run = (revisions: J[], snapshot: EvaluationSnapshot = snap()): QueryDecisionResult =>
  experimentalQueryDecision({ package: PKG, query: 'q', s4: sel(revisions, [], snapshot) });
const unknown = (...causes: string[]) => ({ value: 'Unknown', causes });
/** Encounter absent: admissibility unresolved; {Refuting, excluded}. */
const canRefute = (id: string) => rev(id, { assertion: 'Denied', encounter: undefined });
/** Encounter absent; {Supporting, excluded}. */
const canSupport = (id: string) => rev(id, { encounter: undefined });

describe('S7 query decision: the §5.2 mapping', () => {
  it('1-2. Known(true) projects to True and Known(false) to False', () => {
    expect(run([SUPPORTING]).decision).toEqual({ value: 'True' });
    expect(run([REFUTING]).decision).toEqual({ value: 'False' });
  });

  it('3. Unresolved projects to Unknown with its exact causes', () => {
    expect(run([INADMISSIBLE]).decision).toEqual(unknown('Inadmissible'));
  });

  it('4. several causes keep their Stage A order; none is dropped or replaced', () => {
    expect(run([UNCLASSIFIED, NONINF]).decision).toEqual(unknown('Missing', 'InsufficientEvidence'));
    expect(run([SUPPORTING, REFUTING, canRefute('r4'), UNCLASSIFIED, INADMISSIBLE, ...history('r8', {}, { assertion: 'Denied' })]).decision).toEqual(unknown('Missing', 'Conflicting'));
  });

  it('5. no evidence under complete coverage is Unknown(Missing), never False', () => {
    expect(run([]).decision).toEqual(unknown('Missing'));
  });

  it('6. conflicting evidence is Unknown(Conflicting), with any other cause kept', () => {
    expect(run([REFUTING, SUPPORTING]).decision).toEqual(unknown('Conflicting'));
    expect(run([REFUTING, SUPPORTING], snap([COMPLETE], [fail('f1')])).decision).toEqual(unknown('Conflicting', 'Unavailable'));
  });

  it('7. a relevant gap beside supporting evidence is Unknown', () => {
    expect(run([SUPPORTING], snap([COMPLETE], [fail('f1')])).decision).toEqual(unknown('Unavailable'));
    expect(run([SUPPORTING], snap([])).decision).toEqual(unknown('InsufficientEvidence'));
  });

  it('8. material uncertainty demoting a Known base is Unknown', () => {
    const r = run([SUPPORTING, canRefute('r4')]);
    expect(r.queryEvidence.trace.stepB.change).toBe('DemotedToUnresolved');
    expect(r.decision).toEqual(unknown('Missing'));
  });

  it('9. immaterial uncertainty beside definitive evidence keeps True or False', () => {
    expect(run([SUPPORTING, canSupport('r12')]).decision).toEqual({ value: 'True' });
    expect(run([REFUTING, canRefute('r4')]).decision).toEqual({ value: 'False' });
  });
});

describe('S7 query decision: evidence and trace retained, ownership, immutability, scope', () => {
  it('10. the evidence, provenance, structured references and attribution are retained unchanged', () => {
    for (const records of [[SUPPORTING, rev('r8', { provenance: undefined })], [SUPPORTING, canRefute('r4'), canSupport('r12')]]) {
      const s4 = sel(records);
      const r = experimentalQueryDecision({ package: PKG, query: 'q', s4 });
      expect(r.queryEvidence).toEqual(experimentalQueryEvidence({ package: PKG, query: 'q', s4 }));
    }
    const k = run([SUPPORTING, rev('r8', { provenance: undefined })]).queryEvidence.evidence;
    expect(k).toEqual({
      status: 'Known',
      value: true,
      supportingEvidenceIds: [{ revision: { source: 's1', localId: 'r1', revision: '1' } }, { revision: { source: 's1', localId: 'r8', revision: '1' } }],
      provenance: [
        { ref: { revision: { source: 's1', localId: 'r1', revision: '1' } }, occurrences: [{ acquisition: 'a0', sourceRecordRef: 's1:r1' }] },
        { ref: { revision: { source: 's1', localId: 'r8', revision: '1' } }, occurrences: [null] },
      ],
    });
    const u = run([SUPPORTING, canRefute('r4'), canSupport('r12')]);
    expect(u.queryEvidence.evidence.status === 'Unresolved' && u.queryEvidence.evidence.candidateEvidenceIds.map(show)).toEqual(['s1/r1@1', 's1/r12@1', 's1/r4@1']);
    expect(u.queryEvidence.trace.attribution.map((a) => [a.cause, a.label, a.stage])).toEqual([['Missing', 's1/r4@1', 'S3']]);
  });

  it('11. interleaved evaluations sharing record IDs keep their own decisions and traces', () => {
    const records = [SUPPORTING, canSupport('r12')];
    const plain = sel(records);
    const gapped = sel(records, [], snap([COMPLETE], [fail('f1')]));
    const a = experimentalQueryDecision({ package: PKG, query: 'q', s4: plain });
    const b = experimentalQueryDecision({ package: PKG, query: 'q', s4: gapped });
    const a2 = experimentalQueryDecision({ package: PKG, query: 'q', s4: plain });
    expect(a.decision).toEqual({ value: 'True' });
    expect(b.decision).toEqual(unknown('Missing', 'Unavailable'));
    expect(a2).toEqual(a);
    expect(a.queryEvidence).toEqual(experimentalQueryEvidence({ package: PKG, query: 'q', s4: plain }));
    expect(b.queryEvidence).toEqual(experimentalQueryEvidence({ package: PKG, query: 'q', s4: gapped }));
  });

  const bad = (input: unknown, pattern: RegExp) => {
    expect(() => experimentalQueryDecision(input as never)).toThrow(QueryDecisionConfigurationError);
    expect(() => experimentalQueryDecision(input as never)).toThrow(pattern);
  };

  it('12. accepts only package, query and an S4 result bound to them with a snapshot; no override', () => {
    const s4 = sel([SUPPORTING]);
    for (const f of ['evidence', 'queryEvidence', 'decision', 'value', 'status', 'causes', 'attribution', 'trace', 'stepC', 'snapshot', 'queryContract']) {
      bad({ package: PKG, query: 'q', s4, [f]: [] }, new RegExp(`unexpected input field\\(s\\) ${f}`));
    }
    bad(null, /input must be an object/);
    bad({ package: PKG, query: 'q', s4: sel([SUPPORTING], [], 'none') }, /without a snapshot/);
    bad({ package: PKG, query: 'q', s4: JSON.parse(JSON.stringify(s4)) }, /produced by experimentalSelectForQuery/);
    bad({ package: PKG, query: 'q', s4: { ...s4 } }, /produced by experimentalSelectForQuery/);
    bad({ package: compiled(), query: 'q', s4 }, /another compiled package/);
    bad({ package: PKG, query: 'pv', s4 }, /not an EvidenceQuery/);
    const p = experimentalCompilePreview({ ...program(), nodes: [{ ...program().nodes[0], contract: { hole: { id: 'H', type: 'EvidenceSelectionContract<Boolean>', explains: 'x' } } }, program().nodes[1]] } as JsonValue);
    if (p.outcome !== 'PreviewPackage') throw new Error('preview');
    bad({ package: p.package, query: 'q', s4 }, /preview packages are not evaluated here/);
  });

  it('13-14. detached and deeply immutable; no Needs, program execution or preview output', () => {
    const records = [SUPPORTING, canRefute('r4')];
    const r = experimentalQueryDecision({ package: PKG, query: 'q', s4: sel(records) });
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    const before = JSON.stringify(r);
    records[1]!['assertion'] = 'Affirmed';
    expect(JSON.stringify(r)).toBe(before);
    expect(Object.keys(r).sort()).toEqual(['decision', 'experimental', 'notRun', 'packageId', 'query', 'queryEvidence', 'scope', 'snapshot', 'stage'].sort());
    expect([r.experimental, r.stage, r.scope, r.packageId, r.query, r.snapshot, r.notRun]).toEqual(['nonclinical-query-decision-v0', 'S7', 'query-decision', 'test.s6a', 'q', 'snap-1', ['Needs', 'ProgramExecution']]);
    for (const f of ['needs', 'outputs', 'markers', 'publication', 'marker']) expect(JSON.stringify(r)).not.toContain(`"${f}"`);
  });
});

describe('S7 query decision: parity with the isolated executor (shared projection)', () => {
  const supplied: [SuppliedEvidence, unknown][] = [
    [{ status: 'Known', value: true, supportingEvidenceIds: ['s1/r1@1'] }, { value: 'True' }],
    [{ status: 'Known', value: false, supportingEvidenceIds: ['s1/r2@1'] }, { value: 'False' }],
    [{ status: 'Unresolved', causes: ['Missing', 'Conflicting'], candidateEvidenceIds: ['s1/r1@1'] }, unknown('Missing', 'Conflicting')],
  ];
  it.each(supplied)('evidenceValue and the S7 projection agree for %j', (evidence, expected) => {
    const ex = experimentalExecuteWithSuppliedQueryResults(PKG, new Map([['q', evidence]]));
    if (ex.outcome !== 'Executed') throw new Error(JSON.stringify(ex));
    expect((ex.outputs['pv'] as { decision: unknown }).decision).toEqual(expected);
    expect(projectEvidence(evidence)).toEqual(expected);
  });
});
