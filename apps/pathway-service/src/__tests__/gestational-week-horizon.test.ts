/**
 * `horizon: { "since_gestational_week": N }` — the PREGNANCY window, opened N
 * weeks after the LMP date instead of on it.
 *
 * [DECISION — Josh 2026-10-04]: "repeat CBC drawn since 24 weeks",
 * "third-trimester rescreen drawn since 27 weeks", and "a GDM screen drawn
 * before 24 0/7 weeks does not count as the 24–28-week screen".
 *
 * Lower bound = 00:00 UTC on (LMP date + N × 7 days), the LMP date being the
 * one PREGNANCY opens on. Missing gestational age → the shared gestational-age
 * question, exactly as PREGNANCY. Gestational age below N → the window has not
 * opened: nothing can be inside it, so the condition answers DEFINITELY from an
 * empty selection and never asks.
 */

jest.mock('../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { AnswerType, DefaultBehavior, GateCondition, GateProperties, GateType, NodeStatus } from '../services/resolution/types';
import {
  gestationalWeekWindowFrom,
  makeEvaluationTemporalContext,
  pregnancyWindowFrom,
} from '../services/resolution/temporal/evaluation-context';
import { parseHorizonValue, parsePathwayTemporalDefaults, resolveEffectivePolicy } from '../services/resolution/temporal/cascade';
import { conditionReadsGestationalAge, kernelOnlyHorizon } from '../services/resolution/temporal/condition-adapter';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { scoreReachability } from '../services/resolution/reachability';
import { validatePathwayJson } from '../services/import/validator';
import { buildDatumRegistry, resolveDatums } from '../services/compiler/datums';
import { checkTemporal } from '../services/compiler/temporal';
import type { CompileError, DatumKey, DatumSpec } from '../services/compiler/model';
import type { PathwayJson } from '../services/import/types';
import type { GraphEdge, GraphNode, PatientContext } from '../services/confidence/types';
import { clonePathway } from './fixtures/reference-pathway';
import { makeGraphContext } from './fixtures/reference-patient-context';

// Clock 2026-10-04. At 28 weeks the LMP date is 2026-03-22 and week 24 began
// 2026-09-06. At 20 weeks the LMP date is 2026-05-17 and week 24 begins 2026-11-01.
const AS_OF = '2026-10-04T12:00:00.000Z';
const WEEK_24_AT_28W = '2026-09-06';
const DAY_BEFORE_WEEK_24_AT_28W = '2026-09-05';

const CBC = '718-7';
const GCT = '1504-0';
const SINCE_24 = { since_gestational_week: 24 };

type Lab = { code: string; system: string; value: number; date?: string };
const lab = (code: string, date: string | undefined, value = 1): Lab => ({ code, system: 'LOINC', value, ...(date ? { date } : {}) });

function patient(labs: Lab[], gestationalAgeWeeks?: unknown, extra: Record<string, unknown> = {}): PatientContext {
  return {
    patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: labs,
    ...(gestationalAgeWeeks !== undefined ? { patientAttributes: { gestational_age_weeks: gestationalAgeWeeks } } : {}),
    ...extra,
  } as unknown as PatientContext;
}

function deps(p: PatientContext, version = 'v1'): GateEvaluationDeps {
  const temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: version });
  return {
    temporalContext,
    pathwayDefaults: {},
    factStore: version === 'v1' ? assembleContext({ mode: 'SYNTHETIC', patientContext: p } as never, temporalContext) : [],
    patientContext: p,
    resolutionState: new Map(),
    gateAnswers: new Map(),
    gateId: 'gate-1',
    codeMap: new Map(),
  };
}

const gateOf = (condition: Record<string, unknown>, extra: Record<string, unknown> = {}): GateProperties =>
  ({ title: 'Gate', gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP, condition: condition as unknown as GateCondition, ...extra }) as GateProperties;

const cond = (operator: string, code = GCT, extra: Record<string, unknown> = {}) =>
  ({ field: 'labs', operator, value: code, system: 'LOINC', horizon: SINCE_24, ...extra });
const DRAWN = cond('includes_code');
const NOT_DRAWN = cond('not_includes_code');
const COUNT = cond('count_in_window', GCT, { count_threshold: 1 });
const OWED = { ...COUNT, count_comparison: 'less_than' };
const LOW_HGB = cond('less_than', CBC, { threshold: 11 });

const evaluate = (condition: Record<string, unknown>, p: PatientContext, version = 'v1') =>
  evaluateGate(gateOf(condition), deps(p, version));

const ctx = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });

// ─── the window ───────────────────────────────────────────────────────

describe('where the window opens', () => {
  it('N weeks after the LMP date PREGNANCY opens on, at 00:00 UTC', () => {
    expect(pregnancyWindowFrom(28, ctx)!.lowerBound).toBe('2026-03-22T00:00:00.000Z');
    expect(gestationalWeekWindowFrom(SINCE_24, 28, ctx)).toEqual({
      status: 'OPEN',
      window: {
        lowerBound: `${WEEK_24_AT_28W}T00:00:00.000Z`, lmpDate: '2026-03-22', weeks: 28,
        sinceWeek: 24, sinceDate: WEEK_24_AT_28W,
      },
    });
  });

  it('moves with the gestational age', () => {
    expect((gestationalWeekWindowFrom(SINCE_24, 30, ctx) as { window: { sinceDate: string } }).window.sinceDate).toBe('2026-08-23');
    expect((gestationalWeekWindowFrom({ since_gestational_week: 27 }, 30, ctx) as { window: { sinceDate: string } }).window.sinceDate).toBe('2026-09-13');
  });

  it('fractional weeks: 24 3/7 opens three days after week 24', () => {
    const w = gestationalWeekWindowFrom({ since_gestational_week: 24 + 3 / 7 }, 28, ctx);
    expect((w as { window: { sinceDate: string } }).window.sinceDate).toBe('2026-09-09');
    expect((gestationalWeekWindowFrom({ since_gestational_week: 24.5 }, 28, ctx) as { window: { sinceDate: string } }).window.sinceDate).toBe('2026-09-09');
  });

  it('exactly AT week N the window is open, from today', () => {
    const w = gestationalWeekWindowFrom(SINCE_24, 24, ctx);
    expect(w).toMatchObject({ status: 'OPEN', window: { sinceDate: '2026-10-04' } });
  });

  it('below week N it has not opened, and says when it will', () => {
    expect(gestationalWeekWindowFrom(SINCE_24, 20, ctx)).toEqual({ status: 'NOT_OPEN', sinceWeek: 24, opensOn: '2026-11-01', weeks: 20 });
    expect(gestationalWeekWindowFrom(SINCE_24, 23.8, ctx)).toMatchObject({ status: 'NOT_OPEN', opensOn: '2026-10-05' });
  });

  it('no usable gestational age → null, as for PREGNANCY', () => {
    for (const ga of [undefined, 0, -3, Number.NaN, '28', 1e12]) expect(gestationalWeekWindowFrom(SINCE_24, ga, ctx)).toBeNull();
  });
});

// ─── open window: every operator ──────────────────────────────────────

describe('at 28 weeks, since week 24', () => {
  it.each([
    ['inside the window', '2026-09-20', true],
    ['on the day week 24 began', WEEK_24_AT_28W, true],
    ['the day before week 24 began', DAY_BEFORE_WEEK_24_AT_28W, false],
    ['earlier this pregnancy (16 weeks)', '2026-07-12', false],
    ['before this pregnancy', '2026-01-10', false],
  ])('a screen drawn %s (%s) → drawn %s; not-drawn and the count are consistent', async (_l, date, expected) => {
    const p = patient([lab(GCT, date as string)], 28);
    expect((await evaluate(DRAWN, p)).satisfied).toBe(expected);
    expect((await evaluate(NOT_DRAWN, p)).satisfied).toBe(!expected);
    expect((await evaluate(COUNT, p)).satisfied).toBe(expected);
    expect((await evaluate(OWED, p)).satisfied).toBe(!expected);
  });

  it('"a GDM screen drawn before 24 0/7 weeks does not count" — but it is still drawn THIS PREGNANCY', async () => {
    const p = patient([lab(GCT, '2026-07-12')], 28);
    expect((await evaluate(DRAWN, p)).satisfied).toBe(false);
    expect((await evaluate({ ...DRAWN, horizon: 'PREGNANCY' }, p)).satisfied).toBe(true);
  });

  it('a threshold reads the newest value since week 24 and ignores an earlier one', async () => {
    const labs = [lab(CBC, '2026-06-01', 9.5), lab(CBC, '2026-09-20', 11.6)];
    const r = await evaluate(LOW_HGB, patient(labs, 28));
    expect(r.satisfied).toBe(false);
    expect(r.reason).toBe('labs value 11.6 >= 11 since week 24 of this pregnancy (from 2026-09-06; now 28 weeks)');
    // Only the first-trimester value on file: no value SINCE week 24 — the lab is missing, and is asked for.
    const stale = await evaluate(LOW_HGB, patient([lab(CBC, '2026-06-01', 9.5)], 28));
    expect(stale.satisfied).toBe(false);
    expect(stale.dataUnavailable).toBe(true);
    expect(stale.unresolvedPregnancyConditions).toBeUndefined();
  });

  it('reasons name the window, and the gate records the gestational age among what it read', async () => {
    const drawn = await evaluate(DRAWN, patient([lab(GCT, '2026-09-20')], 28));
    expect(drawn.reason).toBe(`Patient has matching code ${GCT} in labs since week 24 of this pregnancy (from 2026-09-06; now 28 weeks)`);
    expect(drawn.contextFieldsRead).toEqual(['labs', 'patient.gestational_age_weeks']);
    const count = await evaluate(COUNT, patient([lab(GCT, '2026-09-20')], 28));
    expect(count.reason).toBe(`Found 1 matching ${GCT} in labs since week 24 of this pregnancy (from 2026-09-06; now 28 weeks) (≥1)`);
  });

  it('dated and undated facts are treated exactly as a {days:N} window of the same width treats them', async () => {
    // Week 24 began 28.5 days before the clock; {days:28} opens half a day later. No fact is dated in between.
    const charts = [
      patient([lab(GCT, undefined)], 28), patient([lab(GCT, '2026-09-20')], 28), patient([lab(GCT, '2026-07-12')], 28),
      patient([], 28, { medications: [{ code: GCT, system: 'LOINC' }] }),
      patient([], 28, { medications: [{ code: GCT, system: 'LOINC', date: '2026-07-12' }] }),
      patient([], 28, { medications: [{ code: GCT, system: 'LOINC', date: '2026-09-20' }] }),
    ];
    const conditions = [
      DRAWN, NOT_DRAWN, COUNT, cond('less_than', GCT, { threshold: 5 }),
      { field: 'medications', operator: 'includes_code', value: GCT, system: 'LOINC', status: 'any', horizon: SINCE_24 },
      { field: 'medications', operator: 'count_in_window', value: GCT, system: 'LOINC', status: 'any', count_threshold: 1, horizon: SINCE_24 },
    ];
    for (const chart of charts) {
      for (const c of conditions) {
        const week = await evaluate(c, chart);
        const days = await evaluate({ ...c, horizon: { days: 28 } }, chart);
        expect({ s: week.satisfied, i: week.indeterminate, d: week.dataUnavailable, u: week.uncertainty })
          .toEqual({ s: days.satisfied, i: days.indeterminate, d: days.dataUnavailable, u: days.uncertainty });
      }
    }
    // Stated outright: an undated lab satisfies membership and never counts.
    expect((await evaluate(DRAWN, patient([lab(GCT, undefined)], 28))).satisfied).toBe(true);
    expect((await evaluate(COUNT, patient([lab(GCT, undefined)], 28))).satisfied).toBe(false);
  });
});

// ─── the window has not opened ────────────────────────────────────────

describe('at 20 weeks, since week 24 — the window has not opened', () => {
  // Everything a later window could contain, plus an undated lab that any OPEN window would admit.
  const full = patient([lab(GCT, '2026-09-20'), lab(GCT, undefined), lab(CBC, '2026-09-20', 9), lab(CBC, '2026-06-01', 9)], 20);

  it.each([
    ['includes_code', DRAWN, false],
    ['not_includes_code', NOT_DRAWN, true],
    ['exists', { field: 'labs', operator: 'exists', value: '', horizon: SINCE_24 }, false],
    ['count at_least 1', COUNT, false],
    ['count less_than 1', OWED, true],
    ['less_than (threshold)', LOW_HGB, false],
    ['greater_than (threshold)', cond('greater_than', CBC, { threshold: 5 }), false],
    ['delta_from_baseline', cond('delta_from_baseline', CBC, { delta_threshold: 1, min_points: 2 }), false],
    ['trend_down', cond('trend_down', CBC, { min_points: 2 }), false],
  ])('%s is DEFINITE: nothing is inside a window that has not begun', async (_l, condition, expected) => {
    const r = await evaluate(condition as Record<string, unknown>, full);
    expect(r.satisfied).toBe(expected);
    // Not missing data, not doubt, nothing to ask — for any operator.
    expect(r.indeterminate).toBe(false);
    expect(r.dataUnavailable).toBeUndefined();
    expect(r.uncertainty).toEqual([]);
    expect(r.unresolvedConditions).toBeUndefined();
    expect(r.unresolvedSeries).toBeUndefined();
    expect(r.unresolvedPregnancyConditions).toBeUndefined();
    expect(r.contextFieldsRead).toContain('patient.gestational_age_weeks');
    expect(r.reason).toContain('since week 24 of this pregnancy, which has not begun (opens 2026-11-01; now 20 weeks)');
  });

  it('the reasons read naturally', async () => {
    expect((await evaluate(NOT_DRAWN, full)).reason).toBe(
      `No matching code ${GCT} found in patient labs since week 24 of this pregnancy, which has not begun (opens 2026-11-01; now 20 weeks)`,
    );
    expect((await evaluate(OWED, full)).reason).toBe(
      `Found 0 matching ${GCT} in labs since week 24 of this pregnancy, which has not begun (opens 2026-11-01; now 20 weeks) (<1)`,
    );
  });

  it('a lab.* attribute condition is definite too', async () => {
    const codeMap = new Map([['lab.hemoglobin', { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: CBC, valueType: 'number' }]]);
    const r = await evaluateGate(
      gateOf({ attribute: 'lab.hemoglobin', operator: 'less_than', value: 11, horizon: SINCE_24 }),
      { ...deps(full), codeMap: codeMap as never },
    );
    expect(r.satisfied).toBe(false);
    expect(r.dataUnavailable).toBeUndefined();
    expect(r.indeterminate).toBe(false);
  });

  it('in a compound it is a definite value: paired with a timing leaf, the step stays closed until week 24', async () => {
    // "At or after 24 weeks AND no screen since week 24" — the authoring pattern.
    const gate = (ga: number, labs: Lab[]) => evaluateGate(
      { title: 'G', gate_type: GateType.COMPOUND, default_behavior: DefaultBehavior.SKIP, operator: 'AND',
        conditions: [{ attribute: 'patient.gestational_age_weeks', operator: 'greater_or_equal', value: 24 }, NOT_DRAWN] } as unknown as GateProperties,
      deps(patient(labs, ga)),
    );
    expect((await gate(20, [])).satisfied).toBe(false);                       // too early
    expect((await gate(28, [])).satisfied).toBe(true);                        // due, not drawn
    expect((await gate(28, [lab(GCT, '2026-07-12')])).satisfied).toBe(true);  // an early screen does not count
    expect((await gate(28, [lab(GCT, '2026-09-20')])).satisfied).toBe(false); // done
  });
});

// ─── gestational age missing ──────────────────────────────────────────

describe('gestational age missing', () => {
  const node = (id: string, type: string, props: Record<string, unknown> = {}): GraphNode =>
    ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } });
  const edge = (sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge =>
    ({ id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} });

  async function traverse(gates: Array<Record<string, unknown>>, p: PatientContext) {
    const temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
    const nodes = [node('root', 'Pathway')];
    const edges: GraphEdge[] = [];
    gates.forEach((props, i) => {
      nodes.push(node(`gate-${i}`, 'Gate', props), node(`step-${i}`, 'Step'));
      edges.push(edge('root', `gate-${i}`, 'HAS_GATE'), edge(`gate-${i}`, `step-${i}`, 'BRANCHES_TO'));
    });
    const engine = new TraversalEngine(
      { computeNodeConfidence: jest.fn().mockResolvedValue({ confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED' }) } as never,
      { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
      temporalContext, {},
      assembleContext({ mode: 'SYNTHETIC', patientContext: p } as never, temporalContext),
      new Map(),
    );
    return engine.traverse(makeGraphContext(nodes, edges), p, new Map());
  }

  it.each([['absent', undefined], ['zero', 0], ['a string', '28']])('%s → unresolved for the gestational age, never a verdict', async (_l, ga) => {
    for (const c of [DRAWN, NOT_DRAWN, OWED, LOW_HGB]) {
      const r = await evaluate(c, patient([lab(GCT, '2026-09-20')], ga));
      expect(r.satisfied).toBe(false);
      expect(r.dataUnavailable).toBe(true);
      expect(r.unresolvedPregnancyConditions).toHaveLength(1);
    }
  });

  it('asks the ONE gestational-age question a PREGNANCY gate and an attribute gate share', async () => {
    const result = await traverse(
      [
        gateOf(NOT_DRAWN) as unknown as Record<string, unknown>,
        gateOf({ ...NOT_DRAWN, horizon: 'PREGNANCY' }) as unknown as Record<string, unknown>,
        gateOf({ attribute: 'patient.gestational_age_weeks', operator: 'greater_or_equal', value: 24 }) as unknown as Record<string, unknown>,
      ],
      patient([lab(GCT, '2026-09-20')]),
    );
    expect(result.pendingQuestions).toHaveLength(1);
    expect(result.pendingQuestions[0]).toMatchObject({
      datumKey: 'patient.gestational_age_weeks', answerType: AnswerType.NUMERIC,
      askedByNodeIds: ['gate-0', 'gate-1', 'gate-2'],
    });
  });

  it('with the age on file BELOW the week, nothing is asked and the gate decides', async () => {
    const result = await traverse(
      [gateOf(DRAWN, { on_unresolved: 'ask' }) as unknown as Record<string, unknown>, gateOf(LOW_HGB, { on_unresolved: 'ask' }) as unknown as Record<string, unknown>],
      patient([], 20),
    );
    expect(result.pendingQuestions).toEqual([]);
    expect(result.resolutionState.get('gate-0')!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
  });
});

// ─── authoring, compiler, reachability, legacy ────────────────────────

describe('authoring', () => {
  function withCondition(condition: Record<string, unknown>): PathwayJson {
    const pw = clonePathway();
    pw.nodes.push({ id: 'gate-t', type: 'Gate' as never, properties: { title: 'T', gate_type: 'patient_attribute', default_behavior: 'skip', condition } });
    pw.edges.push({ from: 'step-1-1', to: 'gate-t', type: 'HAS_GATE' as never });
    pw.edges.push({ from: 'gate-t', to: 'step-1-2', type: 'BRANCHES_TO' as never });
    return pw;
  }

  it.each([24, 27, 0.5, 24.5, 45])('import accepts since_gestational_week %s', (week) => {
    for (const c of [DRAWN, NOT_DRAWN, COUNT, LOW_HGB]) {
      const result = validatePathwayJson(withCondition({ ...c, horizon: { since_gestational_week: week } }));
      expect(result.errors).toEqual([]);
    }
  });

  it.each([
    ['zero (that is PREGNANCY)', { since_gestational_week: 0 }, 'above 0 and at most 45'],
    ['negative', { since_gestational_week: -4 }, 'above 0 and at most 45'],
    ['past 45 weeks (days for weeks)', { since_gestational_week: 168 }, 'above 0 and at most 45'],
    ['a string', { since_gestational_week: '24' }, 'above 0 and at most 45'],
    ['with days', { since_gestational_week: 24, days: 30 }, 'takes no other key'],
    ['with since', { since_gestational_week: 24, since: '07-01' }, 'takes no other key'],
  ])('import rejects %s', (_l, horizon, fragment) => {
    const result = validatePathwayJson(withCondition({ ...DRAWN, horizon }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining(fragment));
  });

  it('is exclusive with window_days, and per-condition only', () => {
    expect(validatePathwayJson(withCondition({ ...COUNT, window_days: 30 })).errors).toContainEqual(expect.stringContaining('not both'));
    expect(parseHorizonValue({ since_gestational_week: 24 }, 'h')).toEqual({ since_gestational_week: 24 });
    expect(() => parsePathwayTemporalDefaults({ default_horizons: { labs: { since_gestational_week: 24 } } })).toThrow(
      /\{ since_gestational_week \} is a per-condition horizon/,
    );
    expect(() => resolveEffectivePolicy('labs', 'v1', { horizons: { labs: { since_gestational_week: 24 } } })).toThrow(
      /\{ since_gestational_week \} is a per-condition horizon/,
    );
  });

  it('the compiler lists the gestational age among the gate\'s datums, with no temporal error', () => {
    expect(conditionReadsGestationalAge(NOT_DRAWN)).toBe(true);
    const datums = new Map<DatumKey, DatumSpec>();
    const errors: CompileError[] = [];
    const codeMap = new Map();
    resolveDatums('g', [NOT_DRAWN], codeMap, buildDatumRegistry(codeMap), datums, errors);
    expect(errors).toEqual([]);
    expect([...datums.values()]).toEqual([
      { key: 'attribute:gestational_age_weeks', domain: 'attribute', valueType: 'number', readBy: ['g'] },
    ]);
    const nodes = [{ id: 'g', type: 'Gate', properties: gateOf(NOT_DRAWN) as unknown as Record<string, unknown> }];
    expect(checkTemporal(nodes, new Map(), {}, errors)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('reachability: blocked on the gestational age when it is missing; available once it is known — below the week too', () => {
    const gate: GraphNode = { id: 'g', nodeIdentifier: 'g', nodeType: 'Gate', properties: gateOf(NOT_DRAWN) as unknown as Record<string, unknown> };
    expect(scoreReachability([gate], patient([]), new Map()).gateExplanations[0]).toMatchObject({
      classification: 'DATA_BLOCKED', missingData: [{ attribute: 'patient.gestational_age_weeks' }],
    });
    expect(scoreReachability([gate], patient([], 28), new Map()).gateExplanations[0].classification).toBe('DATA_AVAILABLE');
    expect(scoreReachability([gate], patient([], 20), new Map()).gateExplanations[0].classification).toBe('DATA_AVAILABLE');
  });

  it('legacy-v0 refuses it', async () => {
    expect(kernelOnlyHorizon(NOT_DRAWN)).toBe('{ since_gestational_week }');
    for (const c of [DRAWN, NOT_DRAWN, OWED]) {
      const r = await evaluate(c, patient([lab(GCT, '2019-01-01')], 28), 'legacy-v0');
      expect(r.satisfied).toBe(false);
      expect(r.reason).toBe('horizon { since_gestational_week } requires the v1 temporal kernel; legacy-v0 cannot evaluate it');
    }
  });
});
