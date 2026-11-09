/**
 * EXPERIMENTAL, NONCLINICAL. A bounded I6 slice: a one-query program executed over evidence computed
 * from raw records (first-program contract §8 I6, "Raw-input execution boundary"). Expected outputs
 * are written from the evidence-query contract (§4.2, §5.1, §5.2) and the executor semantics
 * (contract §3: `evidenceValue`, Kleene `all`, Findings), never by calling the implementation.
 */
import {
  DEMO_AUTHORITY_RULE,
  RawExecutionConfigurationError,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalExecuteFromRawRecords,
  experimentalExecuteWithSuppliedQueryResults,
  experimentalQueryEvidence,
  experimentalResolveRevisionHistory,
  experimentalSelectForQuery,
  type CompiledPackage,
  type EvaluationSnapshot,
  type JsonValue,
  type NodeRef,
  type RawExecutionResult,
  type RawSingleQueryExecutionResult,
  type SuppliedEvidence,
} from '../index';
import { COMPLETE, CTX, REFUTING, SUPPORTING, T, compiled, fail, program, rev, show, snap, type J } from './support/s6-records';

/** One query `q`; `pv = evidenceValue(ref q)`; `p2 = all(ref pv, ref pv)`; Finding `f = all(ref scope, ref p2)`. */
const source = (applicability: J = { all: [] }): J => {
  const base = program();
  return {
    ...base,
    package: { id: 'test.i6', state: 'Draft' },
    applicability: { id: 'scope', kind: 'Predicate', expr: applicability },
    nodes: [
      ...base.nodes,
      { id: 'p2', kind: 'Predicate', expr: { all: [{ ref: 'pv' }, { ref: 'pv' }] } },
      { id: 'f', kind: 'Finding', status: { all: [{ ref: 'scope' }, { ref: 'p2' }] }, label: 'Schematic finding (nonclinical)' },
    ],
  };
};
const PROG = compiled(source());

const input = (revisions: J[], snapshot: EvaluationSnapshot = snap(), retractions: J[] = []) => ({ ...CTX, revisions: revisions as JsonValue[], retractions: retractions as JsonValue[], snapshot });
/** A one-query program keeps the one-query result shape. */
const single = (r: RawExecutionResult): RawSingleQueryExecutionResult => {
  if (r.scope !== 'one-query-program-from-raw-records') throw new Error(`expected the one-query shape, got ${r.scope}`);
  return r;
};
const run = (revisions: J[], snapshot?: EvaluationSnapshot, pkg: CompiledPackage = PROG): RawSingleQueryExecutionResult => single(experimentalExecuteFromRawRecords(pkg, input(revisions, snapshot)));

const node = (localId: string, revision = '1', digest?: string): NodeRef => ({ revision: { source: 's1', localId, revision }, ...(digest ? { digest } : {}) });
const ids = (o: unknown) => {
  const x = o as { supportingEvidenceIds?: NodeRef[]; candidateEvidenceIds?: NodeRef[] };
  return x.supportingEvidenceIds ?? x.candidateEvidenceIds;
};
/** Decision outputs in display notation (a projection for readability; identities are checked separately). */
const decisions = (r: RawExecutionResult) =>
  Object.fromEntries(['scope', 'pv', 'p2', 'f'].map((k) => {
    const o = r.outputs[k] as { decision?: unknown; status?: unknown };
    return [k, [o.decision ?? o.status, ids(o)!.map(show)]];
  }));
const TRUE = { value: 'True' };
const FALSE = { value: 'False' };
const unknown = (...causes: string[]) => ({ value: 'Unknown', causes });
/** Encounter absent: admissibility unresolved; {Refuting, excluded}. */
const canRefute = (id: string) => rev(id, { assertion: 'Denied', encounter: undefined });
/** Encounter absent; {Supporting, excluded}. */
const canSupport = (id: string) => rev(id, { encounter: undefined });

describe('raw-input execution: program paths from computed evidence', () => {
  it('1. raw supporting evidence takes the True path', () => {
    expect(decisions(run([SUPPORTING]))).toEqual({ scope: [TRUE, []], pv: [TRUE, ['s1/r1@1']], p2: [TRUE, ['s1/r1@1']], f: [TRUE, ['s1/r1@1']] });
  });

  it('2. raw explicit refuting evidence takes the False path; the finding keeps only the deciding operand’s support', () => {
    expect(decisions(run([REFUTING]))).toEqual({ scope: [TRUE, []], pv: [FALSE, ['s1/r2@1']], p2: [FALSE, ['s1/r2@1']], f: [FALSE, ['s1/r2@1']] });
  });

  it('3. no evidence under complete coverage is Unknown(Missing) through the program, never False', () => {
    expect(decisions(run([]))).toEqual({ scope: [TRUE, []], pv: [unknown('Missing'), []], p2: [unknown('Missing'), []], f: [unknown('Missing'), []] });
  });

  it('4. conflicting evidence stays Unknown(Conflicting) through program execution', () => {
    const d = decisions(run([REFUTING, SUPPORTING]));
    expect(d['f']).toEqual([unknown('Conflicting'), ['s1/r1@1', 's1/r2@1']]);
    expect(d['pv']).toEqual(d['f']);
  });

  it('5. a relevant failure or missing coverage prevents a definitive path', () => {
    expect(decisions(run([SUPPORTING], snap([COMPLETE], [fail('f1')])))['f']).toEqual([unknown('Unavailable'), ['s1/r1@1']]);
    expect(decisions(run([REFUTING], snap([])))['f']).toEqual([unknown('InsufficientEvidence'), ['s1/r2@1']]);
  });

  it('6. a material unresolved record demotes the query result before execution', () => {
    const r = run([SUPPORTING, canRefute('r4')]);
    expect(r.queryEvidence.trace.stepB.change).toBe('DemotedToUnresolved');
    expect(decisions(r)['f']).toEqual([unknown('Missing'), ['s1/r1@1', 's1/r4@1']]);
  });

  it('7. an immaterial unresolved record leaves a definitive result unchanged', () => {
    expect(decisions(run([SUPPORTING, canSupport('r12')]))['f']).toEqual([TRUE, ['s1/r1@1']]);
    expect(decisions(run([REFUTING, canRefute('r4')]))['f']).toEqual([FALSE, ['s1/r2@1']]);
  });

  it('8. applicability and Finding semantics match the isolated executor (applicability reading the query predicate too)', () => {
    // Applicability = ref pv: a False applicability decides the Finding with its own support.
    const gated = compiled(source({ ref: 'pv' }));
    expect(decisions(run([REFUTING], undefined, gated))).toEqual({ scope: [FALSE, ['s1/r2@1']], pv: [FALSE, ['s1/r2@1']], p2: [FALSE, ['s1/r2@1']], f: [FALSE, ['s1/r2@1']] });
    // Parity: the same package executed in isolation over the same evidence in fixture notation.
    const cases: J[][] = [[SUPPORTING], [REFUTING], [], [REFUTING, SUPPORTING], [SUPPORTING, canRefute('r4')], [SUPPORTING, rev('r8')]];
    for (const pkg of [PROG, gated]) {
      for (const records of cases) {
        const r = run(records, undefined, pkg);
        const e = r.queryEvidence.evidence;
        const supplied: SuppliedEvidence = e.status === 'Known'
          ? { status: 'Known', value: e.value, supportingEvidenceIds: e.supportingEvidenceIds.map(show) }
          : { status: 'Unresolved', causes: e.causes, candidateEvidenceIds: e.candidateEvidenceIds.map(show) };
        const iso = experimentalExecuteWithSuppliedQueryResults(pkg, new Map([['q', supplied]]));
        if (iso.outcome !== 'Executed') throw new Error(JSON.stringify(iso));
        for (const k of ['scope', 'pv', 'p2', 'f']) {
          const o = r.outputs[k] as J;
          const projected = { ...o, ...(o.supportingEvidenceIds ? { supportingEvidenceIds: o.supportingEvidenceIds.map(show) } : { candidateEvidenceIds: o.candidateEvidenceIds.map(show) }) };
          expect(projected).toEqual(iso.outputs[k]);
        }
        expect(r.findingAttributes).toEqual(iso.findingAttributes);
        // Same trace, except the query entry's provenance sentence.
        expect(r.trace.map((t) => (t.output === 'q' ? { ...t, because: '' } : t))).toEqual(iso.trace.map((t) => (t.output === 'q' ? { ...t, because: '' } : t)));
      }
    }
  });
});

describe('raw-input execution: computed evidence, identity and ownership', () => {
  it('9-10. the program reads exactly the standalone query evidence of the same inputs, provenance included', () => {
    const records = [SUPPORTING, rev('r8', { provenance: undefined })];
    const r = run(records);
    const s4 = experimentalSelectForQuery({ package: PROG, query: 'q', ...input(records) });
    const standalone = experimentalQueryEvidence({ package: PROG, query: 'q', s4 });
    expect(r.queryEvidence).toEqual(standalone);
    expect(r.outputs['q']).toEqual({ evidence: standalone.evidence, origin: 'computed' });
    expect(r.queryEvidence.evidence.status === 'Known' && r.queryEvidence.evidence.provenance.map((p) => p.occurrences)).toEqual([[{ acquisition: 'a0', sourceRecordRef: 's1:r1' }], [null]]);
    expect(ids(r.outputs['f'])).toEqual([node('r1'), node('r8')]);
    expect(r.trace.find((t) => t.output === 'q')).toEqual({ output: 'q', source: '/nodes/0/contract', result: 'Known(true, [s1/r1@1, s1/r8@1])', because: expect.stringContaining('computed by the evidence-query pipeline'), steps: [] });
  });

  it('11. distinct identities with the same display label stay distinct through propagation, union and output', () => {
    // localId `a@1` at revision `1`, and localId `a` at revision `1@1`: both display as s1/a@1@1.
    const r = run([rev('a@1'), rev('a', { revision: '1@1' })]);
    const both = [node('a', '1@1'), node('a@1', '1')];
    for (const k of ['pv', 'p2', 'f']) expect(ids(r.outputs[k])).toEqual(both);
    expect(ids(r.outputs['f'])!.map(show)).toEqual(['s1/a@1@1', 's1/a@1@1']);
    expect((r.outputs['f'] as J).status).toEqual(TRUE);
    // Unknown path: two NonInformative records, both candidates.
    const u = run([rev('a@1', { assertion: 'Indeterminate' }), rev('a', { revision: '1@1', assertion: 'Indeterminate' })]);
    expect(ids(u.outputs['f'])).toEqual(both);
  });

  it('12. variant digests survive selection, evidence, evidenceValue, all and the Finding', () => {
    const records = [rev('r11'), rev('r11', { assertion: 'Denied', provenance: { acquisition: 'a1', sourceRecordRef: 's1:r11' } })];
    const digests = experimentalResolveRevisionHistory({ envelope: { recordType: T, subject: 'P1', sources: ['s1', 's2'] }, authorityRule: DEMO_AUTHORITY_RULE, revisions: records as JsonValue[], retractions: [] })
      .keys[0]!.revisions[0]!.variants.map((v) => v.digest).sort();
    expect(digests).toHaveLength(2);
    const r = run(records);
    const expected = digests.map((d) => node('r11', '1', d));
    expect((r.outputs['f'] as J).status).toEqual(unknown('Conflicting'));
    for (const k of ['pv', 'p2', 'f']) expect(ids(r.outputs[k])).toEqual(expected);
  });

  it('13. repeated identical references deduplicate; distinct ones are all kept', () => {
    const r = run([SUPPORTING, rev('r8'), { ...SUPPORTING }]);
    // p2 = all(pv, pv) unions the same support twice.
    for (const k of ['pv', 'p2', 'f']) expect(ids(r.outputs[k])).toEqual([node('r1'), node('r8')]);
  });

  it('14. interleaved evaluations sharing record IDs keep their own evidence, outputs and traces', () => {
    const records = [SUPPORTING, canSupport('r12')];
    const a = run(records);
    const b = run(records, snap([COMPLETE], [fail('f1')]));
    const a2 = run(records);
    expect(decisions(a)['f']).toEqual([TRUE, ['s1/r1@1']]);
    expect(decisions(b)['f']).toEqual([unknown('Missing', 'Unavailable'), ['s1/r1@1', 's1/r12@1']]);
    expect(a2).toEqual(a);
    expect(b.queryEvidence.trace.causes).toEqual(['Missing', 'Unavailable']);
    expect(a.queryEvidence.trace.aggregation).toBe('NotApplicable');
  });

  it('15. input permutation and duplicate occurrences preserve results and reference order', () => {
    const records = [rev('r8'), REFUTING, SUPPORTING, canRefute('r4')];
    const a = run(records);
    expect(run([...records].reverse())).toEqual(a);
    expect(run([...records, { ...records[0] }])).toEqual(a);
    expect(ids(a.outputs['f'])).toEqual([node('r1'), node('r2'), node('r4'), node('r8')]);
  });

  const bad = (pkg: unknown, inp: unknown, pattern: RegExp) => {
    expect(() => experimentalExecuteFromRawRecords(pkg as never, inp as never)).toThrow(RawExecutionConfigurationError);
    expect(() => experimentalExecuteFromRawRecords(pkg as never, inp as never)).toThrow(pattern);
  };

  it('10, 16. caller answers, overrides, copied or fabricated packages and unsupported scope are rejected', () => {
    const ok = input([SUPPORTING]);
    for (const f of ['query', 'suppliedQueryResults', 'evidence', 'decision', 'queryEvidence', 's1', 's4', 'evidenceIds', 'tokens', 'sources', 'authorityRule', 'valueSet', 'expansion', 'admissible', 'establishes', 'policy']) {
      bad(PROG, { ...ok, [f]: [] }, new RegExp(`unexpected input field\\(s\\) ${f}`));
    }
    bad(PROG, null, /input must be an object/);
    bad(PROG, { ...CTX, revisions: [], retractions: [] }, /a snapshot is required/);
    bad(JSON.parse(JSON.stringify(PROG)), ok, /produced by experimentalCompile/);
    bad({ ...PROG }, ok, /produced by experimentalCompile/);
    bad(experimentalCompile(source() as JsonValue), ok, /produced by experimentalCompile/); // a compile result, not its package
    const p = experimentalCompilePreview({ ...source(), nodes: [{ ...program().nodes[0], contract: { hole: { id: 'H', type: 'EvidenceSelectionContract<Boolean>', explains: 'x' } } }, ...source().nodes.slice(1)] } as JsonValue);
    if (p.outcome !== 'PreviewPackage') throw new Error('preview');
    bad(p.package, ok, /preview packages are not executed here/);
    bad(compiled({ ...source(), nodes: [] }), ok, /one or more EvidenceQueries; the package has 0/);
    // Several complete queries were a scope restriction of the first slice; they now execute (multi-query shape).
    const two = compiled({ ...source(), nodes: [...source().nodes, { ...program().nodes[0], id: 'q2' }] });
    expect(experimentalExecuteFromRawRecords(two, ok).scope).toBe('multi-query-program-from-raw-records');
    bad(PROG, { ...ok, snapshot: { id: 'snap-1', coverage: [] } }, /snapshot must state/);
  });

  it('17, 19. detached and deeply immutable; no Needs, acquisition, preview or multi-query output', () => {
    const records = [SUPPORTING, canRefute('r4')];
    const r = run(records);
    const isDeepFrozen = (x: unknown): boolean => !x || typeof x !== 'object' || (Object.isFrozen(x) && Object.values(x).every(isDeepFrozen));
    expect(isDeepFrozen(r)).toBe(true);
    const before = JSON.stringify(r);
    records[1]!['assertion'] = 'Affirmed';
    (records[0]!['key'] as J)['localId'] = 'changed';
    expect(JSON.stringify(r)).toBe(before);
    expect(Object.keys(r).sort()).toEqual(['experimental', 'findingAttributes', 'mode', 'notRun', 'outcome', 'outputs', 'packageId', 'query', 'queryEvidence', 'scope', 'snapshot', 'trace'].sort());
    expect([r.outcome, r.experimental, r.scope, r.mode, r.packageId, r.query, r.snapshot, r.notRun]).toEqual(['Executed', 'nonclinical-ppl-raw-input-execution-v0', 'one-query-program-from-raw-records', 'normal', 'test.i6', 'q', 'snap-1', ['Needs', 'Acquisition', 'Preview', 'MultiQuery']]);
    for (const f of ['needs', 'markers', 'publication', 'inspectable', 'marker']) expect(JSON.stringify(r)).not.toContain(`"${f}"`);
  });
});
