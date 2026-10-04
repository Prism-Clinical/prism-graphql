/**
 * Hemoglobin / hematocrit as equivalent measures.
 *
 * [DECISION — Josh 2026-10-04]: "the ability to choose whether to input
 * hemoglobin vs hematocrit".
 *  1. A hematocrit is used wherever a hemoglobin is needed, as an ESTIMATED
 *     hemoglobin = hematocrit ÷ 3, shown as estimated (and the reverse).
 *  2. Both on file: the most recent decides; on the same date, the measured one.
 *  3. One question with a switch (proved over the pipeline in
 *     `pipeline-lab-equivalents.test.ts`).
 *
 * The estimate is derived once, at fact assembly, so every operator and
 * horizon sees it as an ordinary dated fact.
 */

jest.mock('../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { DefaultBehavior, GateCondition, GateProperties, GateType, NodeStatus } from '../services/resolution/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import type { ObservationFact } from '../services/resolution/temporal/fact-model';
import {
  areEquivalentLabs,
  convertLabValue,
  describeDerivation,
  equivalenceGroupOf,
  labDatumKey,
} from '../services/resolution/lab-equivalents';
import { askFor } from '../services/resolution/unresolved-prompt';
import { mergeAdditionalContext } from '../services/resolution/effective-context';
import { scoreReachability } from '../services/resolution/reachability';
import { buildDatumRegistry, resolveDatums } from '../services/compiler/datums';
import type { CompileError, DatumKey, DatumSpec } from '../services/compiler/model';
import type { GraphEdge, GraphNode, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-10-04T12:00:00.000Z';
const HGB = '718-7';
const HCT = '4544-3';
const HGB_MEASURE = { code: HGB, system: 'LOINC', display: 'Hemoglobin', unit: 'g/dL' };
const HCT_MEASURE = { code: HCT, system: 'LOINC', display: 'Hematocrit', unit: '%' };

type Lab = { code: string; system: string; value: number; date?: string; providerAsserted?: boolean };
const hgb = (value: number, date?: string, extra: Partial<Lab> = {}): Lab => ({ code: HGB, system: 'LOINC', value, ...(date ? { date } : {}), ...extra });
const hct = (value: number, date?: string, extra: Partial<Lab> = {}): Lab => ({ code: HCT, system: 'LOINC', value, ...(date ? { date } : {}), ...extra });

function patient(labs: Lab[], attrs?: Record<string, unknown>): PatientContext {
  return {
    patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: labs,
    ...(attrs ? { patientAttributes: attrs } : {}),
  } as unknown as PatientContext;
}

const ctxFor = (version = 'v1') => makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: version });
const storeOf = (p: PatientContext) => assembleContext({ mode: 'SYNTHETIC', patientContext: p } as never, ctxFor());

function deps(p: PatientContext, version = 'v1'): GateEvaluationDeps {
  const temporalContext = ctxFor(version);
  return {
    temporalContext, pathwayDefaults: {},
    factStore: version === 'v1' ? assembleContext({ mode: 'SYNTHETIC', patientContext: p } as never, temporalContext) : [],
    patientContext: p, resolutionState: new Map(), gateAnswers: new Map(), gateId: 'gate-1', codeMap: new Map(),
  };
}
const gateOf = (condition: Record<string, unknown>, extra: Record<string, unknown> = {}): GateProperties =>
  ({ title: 'Gate', gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP, condition: condition as unknown as GateCondition, ...extra }) as GateProperties;
const evaluate = (condition: Record<string, unknown>, p: PatientContext, version = 'v1') => evaluateGate(gateOf(condition), deps(p, version));

const lab = (operator: string, code: string, extra: Record<string, unknown> = {}) =>
  ({ field: 'labs', operator, value: code, system: 'LOINC', horizon: 'LIFETIME', ...extra });
const HGB_LOW = lab('less_than', HGB, { threshold: 11 });
const HCT_LOW = lab('less_than', HCT, { threshold: 27 });
const NO_HGB = lab('not_includes_code', HGB);
const HAS_HGB = lab('includes_code', HGB);

// ─── the registry ─────────────────────────────────────────────────────

describe('the registry', () => {
  it('one group: hemoglobin ⇄ hematocrit, the asked lab first', () => {
    expect(equivalenceGroupOf(HGB, 'LOINC')).toEqual([HGB_MEASURE, HCT_MEASURE]);
    expect(equivalenceGroupOf(HCT)).toEqual([HCT_MEASURE, HGB_MEASURE]);
    expect(equivalenceGroupOf('2276-4', 'LOINC')).toBeNull();
    expect(equivalenceGroupOf(HGB, 'SNOMED')).toBeNull();
    expect(areEquivalentLabs({ code: HGB }, { code: HCT })).toBe(true);
    expect(areEquivalentLabs({ code: HGB }, { code: '2276-4' })).toBe(false);
  });

  it('the rule of three, both ways, to one decimal', () => {
    expect(convertLabValue(27, HCT_MEASURE, HGB_MEASURE)).toBe(9);
    expect(convertLabValue(33.5, HCT_MEASURE, HGB_MEASURE)).toBe(11.2);
    expect(convertLabValue(9.1, HGB_MEASURE, HCT_MEASURE)).toBe(27.3);
    expect(convertLabValue(8.5, HGB_MEASURE, HCT_MEASURE)).toBe(25.5);
    expect(convertLabValue(5, HGB_MEASURE, { code: '2276-4', system: 'LOINC' })).toBeNull();
  });

  it('both codes are ONE datum — the primary measure\'s key; other labs keep their own', () => {
    expect(labDatumKey(HGB, 'LOINC')).toBe('LOINC:718-7');
    expect(labDatumKey(HCT, 'LOINC')).toBe('LOINC:718-7');
    expect(labDatumKey('2276-4', 'LOINC')).toBe('LOINC:2276-4');
  });

  it('describes an estimate in words', () => {
    expect(describeDerivation({ code: HCT, system: 'LOINC', value: 27, unit: '%', display: 'Hematocrit' })).toBe('estimated from hematocrit 27%');
    expect(describeDerivation({ code: HGB, system: 'LOINC', value: 8.5, unit: 'g/dL', display: 'Hemoglobin' })).toBe('estimated from hemoglobin 8.5 g/dL');
  });
});

// ─── derived facts ────────────────────────────────────────────────────

describe('derived at fact assembly', () => {
  const labsOf = (p: PatientContext) => storeOf(p).filter((f) => f.kind === 'lab') as ObservationFact[];

  it('a hematocrit yields an estimated hemoglobin: same date, provenance and validity; the exact source kept', () => {
    const facts = labsOf(patient([hct(27.4, '2026-09-20')]));
    expect(facts).toHaveLength(2);
    const [measured, estimate] = facts;
    expect(measured).toMatchObject({ factId: 'lab:0', code: HCT, value: 27.4 });
    expect(measured.derivedFrom).toBeUndefined();
    expect(estimate).toMatchObject({
      factId: 'lab:0~718-7', code: HGB, system: 'LOINC', value: 9.1, unit: 'g/dL', display: 'Hemoglobin',
      interval: measured.interval, recordValidity: measured.recordValidity, provenance: measured.provenance,
      derivedFrom: { code: HCT, system: 'LOINC', value: 27.4, unit: '%', display: 'Hematocrit' },
    });
  });

  it('never renumbers a measured fact, and is the same on every assembly', () => {
    const p = patient([hct(27, '2026-09-20'), { code: '2276-4', system: 'LOINC', value: 12, date: '2026-09-20' }, hgb(10, '2026-09-25')]);
    const ids = labsOf(p).map((f) => f.factId);
    expect(ids).toEqual(['lab:0', 'lab:1', 'lab:2', 'lab:0~718-7', 'lab:2~4544-3']);
    expect(storeOf(p)).toEqual(storeOf(p));
  });

  it('the measured value stands where the two cannot be ordered: same day, or either undated', () => {
    const estimates = (labs: Lab[]) => labsOf(patient(labs)).filter((f) => f.derivedFrom).map((f) => `${f.code}=${f.value}`);
    expect(estimates([hgb(12, '2026-09-20'), hct(27, '2026-09-20')])).toEqual([]);          // same day
    expect(estimates([hgb(12), hct(27)])).toEqual([]);                                       // both undated
    expect(estimates([hgb(12, '2026-09-20'), hct(27)])).toEqual([]);                         // undated source / dated rival, both ways
    expect(estimates([hgb(12, '2026-09-01'), hct(27, '2026-09-20')])).toEqual(['4544-3=36', '718-7=9']); // different days: both
    expect(estimates([hct(27)])).toEqual(['718-7=9']);                                       // nothing to tie with
  });

  it('a provider\'s answer is always estimated — it is the newest by construction', () => {
    const facts = labsOf(patient([hgb(12), hgb(11.5), hct(27, AS_OF, { providerAsserted: true })]));
    const estimate = facts.find((f) => f.derivedFrom)!;
    expect(estimate).toMatchObject({ code: HGB, value: 9, provenance: { sourceType: 'PROVIDER_ASSERTED' } });
  });

  it('a value in another unit is never converted: no estimate, so the gate reads what it read before', async () => {
    const estimatesOf = (l: Record<string, unknown>) => labsOf(patient([l as never])).filter((f) => f.derivedFrom);
    // A hematocrit as a volume fraction would "estimate" a hemoglobin of 0.1.
    expect(estimatesOf({ code: HCT, system: 'LOINC', value: 0.27, unit: 'L/L', date: '2026-09-20' })).toEqual([]);
    expect(estimatesOf({ code: HCT, system: 'LOINC', value: 0.27, date: '2026-09-20' })).toEqual([]);   // no unit: implausible as %
    expect(estimatesOf({ code: HCT, system: 'LOINC', value: 27, unit: 'L/L', date: '2026-09-20' })).toEqual([]); // a stated other unit
    // A hemoglobin in g/L would "estimate" a hematocrit of 315.
    expect(estimatesOf({ code: HGB, system: 'LOINC', value: 105, unit: 'g/L', date: '2026-09-20' })).toEqual([]);
    expect(estimatesOf({ code: HGB, system: 'LOINC', value: 105, date: '2026-09-20' })).toEqual([]);
    // The registered unit, in the spellings a chart uses, is estimated from.
    for (const unit of ['%', 'percent', ' % ']) expect(estimatesOf({ code: HCT, system: 'LOINC', value: 27, unit, date: '2026-09-20' })).toHaveLength(1);
    for (const unit of ['g/dL', 'G/DL', 'g/dl']) expect(estimatesOf({ code: HGB, system: 'LOINC', value: 9, unit, date: '2026-09-20' })).toHaveLength(1);
    // And the severe-anemia read is NOT opened by the fraction: there is no hemoglobin, so it is asked for.
    const r = await evaluate(lab('less_than', HGB, { threshold: 7 }), patient([{ code: HCT, system: 'LOINC', value: 0.27, unit: 'L/L', date: '2026-09-20' } as never]));
    expect(r.satisfied).toBe(false);
    expect(r.dataUnavailable).toBe(true);
  });

  it('labs with no registered equivalent, and non-numeric results, derive nothing', () => {
    const p = patient([{ code: '2276-4', system: 'LOINC', value: 12 }, { code: HCT, system: 'LOINC' } as never]);
    expect(labsOf(p).filter((f) => f.derivedFrom)).toEqual([]);
  });
});

// ─── every consumer ───────────────────────────────────────────────────

describe('hematocrit only on file (27%, dated)', () => {
  const p = patient([hct(27, '2026-09-20')]);

  it('718-7 less_than 11 is true, with the estimate in the reason, and nothing is missing', async () => {
    const r = await evaluate(HGB_LOW, p);
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe('labs value 9 (estimated from hematocrit 27%) < 11');
    expect(r.dataUnavailable).toBeUndefined();
    expect(r.indeterminate).toBe(false);
  });

  it('"no hemoglobin on file" is false — and "a hemoglobin is on file" true, saying how', async () => {
    const none = await evaluate(NO_HGB, p);
    expect(none.satisfied).toBe(false);
    expect(none.indeterminate).toBe(false);
    expect(none.reason).toBe(`Patient has matching code ${HGB} in labs (estimated from hematocrit 27%)`);
    expect((await evaluate(HAS_HGB, p)).satisfied).toBe(true);
  });

  it('the hematocrit itself is still read directly, with no note', async () => {
    const r = await evaluate(lab('less_than', HCT, { threshold: 30 }), p);
    expect(r.reason).toBe('labs value 27 < 30');
  });
});

describe('hemoglobin only on file', () => {
  it('a 4544-3 leaf resolves from it', async () => {
    const r = await evaluate(HCT_LOW, patient([hgb(8.5, '2026-09-20')]));
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe('labs value 25.5 (estimated from hemoglobin 8.5 g/dL) < 27');
    expect(r.dataUnavailable).toBeUndefined();
  });

  it('an ordinary hemoglobin read is byte-for-byte what it always was', async () => {
    expect((await evaluate(HGB_LOW, patient([hgb(8.5, '2026-09-20')]))).reason).toBe('labs value 8.5 < 11');
  });

  it('the referral gate (Hgb < 9 OR Hct < 27) decides from the hemoglobin alone — nothing is unresolved', async () => {
    const referral = {
      title: 'Referral', gate_type: GateType.COMPOUND, default_behavior: DefaultBehavior.SKIP, operator: 'OR',
      conditions: [lab('less_than', HGB, { threshold: 9 }), HCT_LOW],
    } as unknown as GateProperties;
    const mild = await evaluateGate(referral, deps(patient([hgb(10.5, '2026-09-20')])));
    expect(mild.satisfied).toBe(false);
    expect(mild.dataUnavailable).toBeUndefined();
    expect(mild.unresolvedConditions).toBeUndefined();
    expect((await evaluateGate(referral, deps(patient([hgb(8.5, '2026-09-20')])))).satisfied).toBe(true);
    // And from a hematocrit alone.
    expect((await evaluateGate(referral, deps(patient([hct(26, '2026-09-20')])))).satisfied).toBe(true);
  });
});

describe('both on file — the most recent decides', () => {
  it('hematocrit newer: the estimate decides', async () => {
    const r = await evaluate(HGB_LOW, patient([hgb(12, '2026-09-01'), hct(27, '2026-09-20')]));
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe('labs value 9 (estimated from hematocrit 27%) < 11');
  });

  it('hemoglobin newer: the hemoglobin decides', async () => {
    const r = await evaluate(HGB_LOW, patient([hct(27, '2026-09-01'), hgb(12, '2026-09-20')]));
    expect(r.satisfied).toBe(false);
    expect(r.reason).toBe('labs value 12 >= 11');
  });

  it('the same date: the measured hemoglobin decides (and the measured hematocrit, for a hematocrit leaf)', async () => {
    const p = patient([hct(27, '2026-09-20'), hgb(12, '2026-09-20')]);
    const h = await evaluate(HGB_LOW, p);
    expect(h.satisfied).toBe(false);
    expect(h.reason).toBe('labs value 12 >= 11');
    expect((await evaluate(lab('less_than', HCT, { threshold: 30 }), p)).reason).toBe('labs value 27 < 30');
  });

  it('undated (the simulator): the measured value of each code decides, exactly as before', async () => {
    const p = patient([hct(27), hgb(12)]);
    const h = await evaluate(HGB_LOW, p);
    expect(h.reason).toBe('labs value 12 >= 11');
    expect(h.indeterminate).toBe(false);
    // A dated hemoglobin beside an undated hematocrit is not made ambiguous by an estimate.
    const mixed = await evaluate(HGB_LOW, patient([hct(27), hgb(12, '2026-09-20')]));
    expect(mixed.reason).toBe('labs value 12 >= 11');
    // An undated hematocrit alone is used.
    expect((await evaluate(HGB_LOW, patient([hct(27)]))).reason).toBe('labs value 9 (estimated from hematocrit 27%) < 11');
  });
});

describe('aggregates', () => {
  it('count_in_window counts a hematocrit draw as a hemoglobin measurement — a same-day pair once', async () => {
    const count = lab('count_in_window', HGB, { count_threshold: 2 });
    delete (count as Record<string, unknown>).horizon;
    const windowed = { ...count, window_days: 60 };
    expect((await evaluate(windowed, patient([hct(27, '2026-09-01'), hgb(10, '2026-09-20')]))).reason)
      .toBe(`Found 2 matching ${HGB} in labs within last 60 days (≥2) (1 estimated from an equivalent measure)`);
    expect((await evaluate(windowed, patient([hct(30, '2026-09-20'), hgb(10, '2026-09-20')]))).reason)
      .toBe(`Found 1 matching ${HGB} in labs within last 60 days (<2)`);
  });

  it('delta_from_baseline across an estimated and a measured value, saying which was which', async () => {
    const rise = lab('delta_from_baseline', HGB, { delta_threshold: 1, delta_comparison: 'at_least', min_points: 2 });
    const r = await evaluate(rise, patient([hct(27, '2026-09-01'), hgb(10.2, '2026-09-25')]));
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe(`${HGB} delta 1.2000 (baseline 9 (estimated from hematocrit 27%), current 10.2) satisfies ≥ 1`);
    // Two hematocrits measure a hemoglobin change as well.
    const two = await evaluate(rise, patient([hct(27, '2026-09-01'), hct(31.5, '2026-09-25')]));
    expect(two.satisfied).toBe(true);
    expect(two.reason).toContain('baseline 9 (estimated from hematocrit 27%), current 10.5 (estimated from hematocrit 31.5%)');
    // A measured pair reads exactly as before.
    const measured = await evaluate(rise, patient([hgb(9, '2026-09-01'), hgb(10.2, '2026-09-25')]));
    expect(measured.reason).toBe(`${HGB} delta 1.2000 (baseline 9, current 10.2) satisfies ≥ 1`);
  });

  it('a trend says how many of its points were estimated', async () => {
    const trend = lab('trend_up', HGB, { min_points: 3 });
    const r = await evaluate(trend, patient([hct(27, '2026-08-01'), hgb(10, '2026-09-01'), hgb(11, '2026-09-25')]));
    expect(r.satisfied).toBe(true);
    expect(r.reason).toContain('(1 of 3 values estimated from an equivalent measure)');
  });
});

describe('horizons', () => {
  // 28 weeks at the clock: this pregnancy began 2026-03-22; week 24 began 2026-09-06.
  const at28 = (labs: Lab[]) => patient(labs, { gestational_age_weeks: 28 });

  it('a PREGNANCY-horizon hemoglobin gate is satisfied by a hematocrit drawn this pregnancy — and not by an earlier one', async () => {
    const drawn = lab('includes_code', HGB, { horizon: 'PREGNANCY' });
    const inside = await evaluate(drawn, at28([hct(33, '2026-06-10')]));
    expect(inside.satisfied).toBe(true);
    expect(inside.reason).toBe(
      `Patient has matching code ${HGB} in labs (estimated from hematocrit 33%) within this pregnancy (since 2026-03-22, 28 weeks)`,
    );
    expect((await evaluate(drawn, at28([hct(33, '2026-03-21')]))).satisfied).toBe(false);
    // The threshold over the same window.
    const low = await evaluate({ ...HGB_LOW, horizon: 'PREGNANCY' }, at28([hct(30, '2026-06-10')]));
    expect(low.reason).toBe('labs value 10 (estimated from hematocrit 30%) < 11 within this pregnancy (since 2026-03-22, 28 weeks)');
  });

  it('since a gestational week, since a date, and a day window bound an estimate like any fact', async () => {
    const p = at28([hct(30, '2026-08-20')]);
    expect((await evaluate({ ...NO_HGB, horizon: { since_gestational_week: 24 } }, p)).satisfied).toBe(true);
    expect((await evaluate({ ...NO_HGB, horizon: { since_gestational_week: 20 } }, p)).satisfied).toBe(false);
    expect((await evaluate({ ...NO_HGB, horizon: { since: '09-01' } }, p)).satisfied).toBe(true);
    expect((await evaluate({ ...NO_HGB, horizon: { since: '07-01' } }, p)).satisfied).toBe(false);
    expect((await evaluate({ ...NO_HGB, horizon: 'MONTH' }, p)).satisfied).toBe(true);
    expect((await evaluate({ ...NO_HGB, horizon: 'QUARTER' }, p)).satisfied).toBe(false);
  });
});

describe('provider answers', () => {
  it('an answer given as a hematocrit settles an ambiguous hemoglobin', async () => {
    // Two undated hemoglobins cannot be ordered: the gate asks.
    const ambiguous = await evaluate(HGB_LOW, patient([hgb(12), hgb(9.5)]));
    expect(ambiguous.indeterminate).toBe(true);
    // The provider answers 27% hematocrit, dated at the session clock.
    const answered = await evaluate(HGB_LOW, patient([hgb(12), hgb(9.5), hct(27, AS_OF, { providerAsserted: true })]));
    expect(answered.indeterminate).toBe(false);
    expect(answered.reason).toBe('labs value 9 (estimated from hematocrit 27%) < 11');
  });

  it('a new answer in EITHER measure replaces the earlier one', () => {
    const first = mergeAdditionalContext(undefined, { labResults: [hgb(9, AS_OF, { providerAsserted: true })] } as never);
    const corrected = mergeAdditionalContext(first, { labResults: [hct(33, AS_OF, { providerAsserted: true })] } as never);
    expect(corrected.labResults).toEqual([hct(33, AS_OF, { providerAsserted: true })]);
    // A chart value is never replaced by an answer.
    const chart = mergeAdditionalContext({ labResults: [hgb(9, '2026-09-01')] } as never, { labResults: [hct(33, AS_OF, { providerAsserted: true })] } as never);
    expect(chart.labResults).toHaveLength(2);
  });
});

it('legacy-v0 does no derivation: a hematocrit is not a hemoglobin there', async () => {
  const r = await evaluate(HGB_LOW, patient([hct(27, '2026-09-20')]), 'legacy-v0');
  expect(r.satisfied).toBe(false);
  expect(r.reason).toBe(`No numeric value found for labs:${HGB}`);
  expect((await evaluate(NO_HGB, patient([hct(27, '2026-09-20')]), 'legacy-v0')).satisfied).toBe(true);
});

// ─── the question ─────────────────────────────────────────────────────

describe('the question', () => {
  const node = (id: string, type: string, props: Record<string, unknown> = {}): GraphNode =>
    ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } });
  const edge = (sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge =>
    ({ id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} });

  async function traverse(conditions: Array<Record<string, unknown>>, p: PatientContext, gateAnswers = new Map()) {
    const temporalContext = ctxFor();
    const nodes = [node('root', 'Pathway')];
    const edges: GraphEdge[] = [];
    conditions.forEach((c, i) => {
      nodes.push(node(`gate-${i}`, 'Gate', { ...gateOf(c), on_unresolved: 'ask' }), node(`step-${i}`, 'Step'));
      edges.push(edge('root', `gate-${i}`, 'HAS_GATE'), edge(`gate-${i}`, `step-${i}`, 'BRANCHES_TO'));
    });
    const engine = new TraversalEngine(
      { computeNodeConfidence: jest.fn().mockResolvedValue({ confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED' }) } as never,
      { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
      temporalContext, {}, assembleContext({ mode: 'SYNTHETIC', patientContext: p } as never, temporalContext), new Map(),
    );
    return engine.traverse(makeGraphContext(nodes, edges), p, gateAnswers);
  }

  it('askFor: both codes ask under one datum key, each offering the alternatives with itself first', () => {
    expect(askFor(HGB_LOW as unknown as GateCondition)).toMatchObject({
      datumKey: 'LOINC:718-7', target: { kind: 'lab', code: HGB, system: 'LOINC' }, alternatives: [HGB_MEASURE, HCT_MEASURE],
    });
    expect(askFor(HCT_LOW as unknown as GateCondition)).toMatchObject({
      datumKey: 'LOINC:718-7', target: { kind: 'lab', code: HCT, system: 'LOINC' }, alternatives: [HCT_MEASURE, HGB_MEASURE],
    });
    const other = askFor(lab('less_than', '2276-4', { threshold: 30 }) as unknown as GateCondition)!;
    expect(other.datumKey).toBe('LOINC:2276-4');
    expect(other.alternatives).toBeUndefined();
  });

  it('neither on file: a hemoglobin gate and a hematocrit gate ask ONE question', async () => {
    const result = await traverse([HGB_LOW, HCT_LOW], patient([]));
    expect(result.pendingQuestions).toHaveLength(1);
    expect(result.pendingQuestions[0]).toMatchObject({
      gateId: 'gate-0', datumKey: 'LOINC:718-7', askedByNodeIds: ['gate-0', 'gate-1'],
      askTarget: { kind: 'lab', code: HGB, system: 'LOINC' },
      alternatives: [HGB_MEASURE, HCT_MEASURE],
    });
    expect(result.pendingQuestions[0].lastOnFile).toBeUndefined();
  });

  it('either on file: nothing is asked by either gate', async () => {
    for (const labs of [[hct(27, '2026-09-20')], [hgb(9, '2026-09-20')]]) {
      const result = await traverse([HGB_LOW, HCT_LOW], patient(labs));
      expect(result.pendingQuestions).toEqual([]);
    }
  });

  it('lastOnFile is the newest across the measures, described as the measure it IS', async () => {
    // Both too old for a 30-day window; the hematocrit is the newer.
    const recent = { ...HGB_LOW, horizon: 'MONTH' };
    const result = await traverse([recent], patient([hgb(10, '2026-05-01'), hct(31, '2026-07-15')]));
    expect(result.pendingQuestions[0].lastOnFile).toEqual({
      value: 31, date: '2026-07-15', code: HCT, system: 'LOINC', display: 'Hematocrit', unit: '%',
    });
    // The same date: the asked lab.
    const same = await traverse([recent], patient([hct(31, '2026-07-15'), hgb(10, '2026-07-15')]));
    expect(same.pendingQuestions[0].lastOnFile).toMatchObject({ value: 10, code: HGB, unit: 'g/dL' });
  });

  it('a lab with no equivalents asks exactly as before: no alternatives, lastOnFile unchanged', async () => {
    const result = await traverse([lab('less_than', '2276-4', { threshold: 30, horizon: 'MONTH' })], patient([{ code: '2276-4', system: 'LOINC', value: 12, date: '2026-05-01' }]));
    expect(result.pendingQuestions[0].alternatives).toBeUndefined();
    expect(result.pendingQuestions[0].lastOnFile).toEqual({ value: 12, date: '2026-05-01' });
  });

  it('declined: "Not available" for the group stops BOTH gates asking', async () => {
    const declined = new Map([['declined:LOINC:718-7', { notAvailable: true }]]);
    const result = await traverse([HGB_LOW, HCT_LOW], patient([]), declined as never);
    expect(result.pendingQuestions).toEqual([]);
    expect(result.resolutionState.get('gate-0')!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
  });
});

// ─── compiler and reachability ────────────────────────────────────────

describe('what a gate reads', () => {
  it('the compiler: a hemoglobin gate and a hematocrit gate read ONE datum', () => {
    const datums = new Map<DatumKey, DatumSpec>();
    const errors: CompileError[] = [];
    const codeMap = new Map();
    const registry = buildDatumRegistry(codeMap);
    resolveDatums('g-hgb', [HGB_LOW], codeMap, registry, datums, errors);
    resolveDatums('g-hct', [HCT_LOW], codeMap, registry, datums, errors);
    resolveDatums('g-ferritin', [lab('less_than', '2276-4', { threshold: 30 })], codeMap, registry, datums, errors);
    expect(errors).toEqual([]);
    expect([...datums.values()].sort((a, b) => (a.key < b.key ? -1 : 1))).toEqual([
      { key: 'lab:LOINC:2276-4', domain: 'lab', valueType: 'number', readBy: ['g-ferritin'] },
      { key: 'lab:LOINC:718-7', domain: 'lab', valueType: 'number', readBy: ['g-hct', 'g-hgb'] },
    ]);
  });

  it('reachability: a hemoglobin gate has its data when only a hematocrit is on file', () => {
    const gate: GraphNode = { id: 'g', nodeIdentifier: 'g', nodeType: 'Gate', properties: gateOf(HGB_LOW) as unknown as Record<string, unknown> };
    expect(scoreReachability([gate], patient([hct(27)]), new Map()).gateExplanations[0].classification).toBe('DATA_AVAILABLE');
    expect(scoreReachability([gate], patient([]), new Map()).gateExplanations[0].classification).toBe('DATA_BLOCKED');
    expect(scoreReachability([gate], patient([{ code: '2276-4', system: 'LOINC', value: 12 }]), new Map()).gateExplanations[0].classification).toBe('DATA_BLOCKED');
  });
});
