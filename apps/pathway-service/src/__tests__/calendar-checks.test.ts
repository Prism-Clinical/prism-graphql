/**
 * Calendar checks — both read the calendar date of the SESSION CLOCK
 * (`evaluationAsOf`), never the wall clock.
 *
 * [DECISION — Josh 2026-10-04], on routine prenatal vaccines: "can we add a
 * calendar check?"
 *
 *  1. `{ "attribute": "encounter.date", "operator": "in_season", "from": "09-01", "to": "01-31" }`
 *     — is today inside a season? Inclusive `MM-DD` bounds, wrapping the year
 *     end when `from` is after `to`. Engine-supplied: no patient data, never
 *     missing, never a question.
 *
 *  2. `"horizon": { "since": "07-01" }` — a lookback that opens at 00:00 on the
 *     most recent occurrence of that month-day on or before the clock.
 *     Per-condition only, like PREGNANCY.
 */

jest.mock('../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import {
  DefaultBehavior,
  GateCondition,
  GateProperties,
  GateType,
  NodeStatus,
} from '../services/resolution/types';
import {
  EvaluationTemporalContext,
  makeEvaluationTemporalContext,
  resolveHorizon,
  sessionCalendarDate,
  sinceWindowFrom,
} from '../services/resolution/temporal/evaluation-context';
import {
  parseHorizonValue,
  parsePathwayTemporalDefaults,
  resolveEffectivePolicy,
} from '../services/resolution/temporal/cascade';
import { inSeason, parseMonthDay } from '../services/resolution/temporal/calendar';
import {
  calendarConditionError,
  isCalendarCondition,
} from '../services/resolution/temporal/condition-adapter';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { askFor } from '../services/resolution/unresolved-prompt';
import { scoreReachability } from '../services/resolution/reachability';
import { sweepableConditions } from '../resolvers/helpers/resolution-context';
import { validatePathwayJson } from '../services/import/validator';
import { conditionProblem } from '../services/compiler/gates';
import { buildDatumRegistry, resolveDatums } from '../services/compiler/datums';
import { checkTemporal } from '../services/compiler/temporal';
import type { CompileError, DatumKey, DatumSpec } from '../services/compiler/model';
import type { PathwayJson } from '../services/import/types';
import type { GraphEdge, GraphNode, PatientContext } from '../services/confidence/types';
import { clonePathway } from './fixtures/reference-pathway';
import { makeGraphContext } from './fixtures/reference-patient-context';

const at = (day: string, time = '12:00:00.000') => `${day}T${time}Z`;

function patient(extra: Record<string, unknown> = {}): PatientContext {
  return {
    patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...extra,
  } as unknown as PatientContext;
}

function contextAt(asOf: string, version = 'v1', timezone?: string): EvaluationTemporalContext {
  const ctx = makeEvaluationTemporalContext({ evaluationAsOf: asOf, temporalPolicyVersion: version });
  // The type admits only 'UTC' today; a stored context carrying a zone is the
  // case the calendar functions are written for.
  return timezone ? ({ ...ctx, timezone } as unknown as EvaluationTemporalContext) : ctx;
}

function deps(asOf: string, p: PatientContext = patient(), version = 'v1', timezone?: string): GateEvaluationDeps {
  const temporalContext = contextAt(asOf, version, timezone);
  return {
    temporalContext,
    pathwayDefaults: {},
    factStore:
      version === 'v1' ? assembleContext({ mode: 'SYNTHETIC', patientContext: p } as never, temporalContext) : [],
    patientContext: p,
    resolutionState: new Map(),
    gateAnswers: new Map(),
    gateId: 'gate-1',
    codeMap: new Map(),
  };
}

const gateOf = (condition: Record<string, unknown>): GateProperties =>
  ({
    title: 'Gate', gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
    condition: condition as unknown as GateCondition,
  }) as GateProperties;

const season = (from: string, to: string) => ({ attribute: 'encounter.date', operator: 'in_season', from, to });
const RSV = season('09-01', '01-31');

const inSeasonOn = async (day: string, condition: Record<string, unknown>, version = 'v1', tz?: string, time?: string) =>
  evaluateGate(gateOf(condition), deps(at(day, time), patient(), version, tz));

function withCondition(condition: Record<string, unknown>): PathwayJson {
  const pw = clonePathway();
  pw.nodes.push({
    id: 'gate-t',
    type: 'Gate' as never,
    properties: { title: 'T', gate_type: 'patient_attribute', default_behavior: 'skip', condition },
  });
  pw.edges.push({ from: 'step-1-1', to: 'gate-t', type: 'HAS_GATE' as never });
  pw.edges.push({ from: 'gate-t', to: 'step-1-2', type: 'BRANCHES_TO' as never });
  return pw;
}

// ═══ 1. in_season ═════════════════════════════════════════════════════

describe('encounter.date in_season', () => {
  describe('a season that wraps the year end (09-01 to 01-31)', () => {
    it.each([
      ['2026-08-31', false, 'the day before it opens'],
      ['2026-09-01', true, 'the opening day (inclusive)'],
      ['2026-10-04', true, 'mid-season'],
      ['2026-12-31', true, 'Dec 31'],
      ['2027-01-01', true, 'Jan 1'],
      ['2027-01-31', true, 'the closing day (inclusive)'],
      ['2027-02-01', false, 'the day after it closes'],
      ['2027-06-15', false, 'mid-summer'],
    ])('%s → %s (%s)', async (day, expected) => {
      const r = await inSeasonOn(day, RSV);
      expect(r.satisfied).toBe(expected);
    });
  });

  describe('a season inside one year (03-01 to 05-31)', () => {
    const spring = season('03-01', '05-31');
    it.each([
      ['2026-02-28', false],
      ['2026-03-01', true],
      ['2026-04-15', true],
      ['2026-05-31', true],
      ['2026-06-01', false],
      ['2026-12-31', false],
      ['2027-01-01', false],
    ])('%s → %s', async (day, expected) => {
      expect((await inSeasonOn(day, spring)).satisfied).toBe(expected);
    });
  });

  it('from equal to to is that one day', async () => {
    const day = season('07-04', '07-04');
    expect((await inSeasonOn('2026-07-03', day)).satisfied).toBe(false);
    expect((await inSeasonOn('2026-07-04', day)).satisfied).toBe(true);
    expect((await inSeasonOn('2026-07-05', day)).satisfied).toBe(false);
  });

  describe('Feb 29', () => {
    it('a clock ON Feb 29 is inside a season that spans it, and is a bound like any other', async () => {
      expect((await inSeasonOn('2028-02-29', season('02-01', '03-15'))).satisfied).toBe(true);
      expect((await inSeasonOn('2028-02-29', season('02-29', '02-29'))).satisfied).toBe(true);
      expect((await inSeasonOn('2028-02-29', season('03-01', '02-28'))).satisfied).toBe(false);
    });

    it('to: "02-29" ends on Feb 28 in a year without one, and on Feb 29 in a leap year', async () => {
      const untilLeapDay = season('01-01', '02-29');
      expect((await inSeasonOn('2027-02-28', untilLeapDay)).satisfied).toBe(true);
      expect((await inSeasonOn('2027-03-01', untilLeapDay)).satisfied).toBe(false);
      expect((await inSeasonOn('2028-02-29', untilLeapDay)).satisfied).toBe(true);
      expect((await inSeasonOn('2028-03-01', untilLeapDay)).satisfied).toBe(false);
    });

    it('from: "02-29" starts on Mar 1 in a year without one, and on Feb 29 in a leap year', async () => {
      const fromLeapDay = season('02-29', '03-15');
      expect((await inSeasonOn('2027-02-28', fromLeapDay)).satisfied).toBe(false);
      expect((await inSeasonOn('2027-03-01', fromLeapDay)).satisfied).toBe(true);
      expect((await inSeasonOn('2028-02-28', fromLeapDay)).satisfied).toBe(false);
      expect((await inSeasonOn('2028-02-29', fromLeapDay)).satisfied).toBe(true);
    });
  });

  it('is ALWAYS definite: no missing-data signal, no uncertainty, and the reason names the date and season', async () => {
    const inside = await inSeasonOn('2026-10-04', RSV);
    expect(inside).toEqual({
      satisfied: true,
      reason: 'Session date 2026-10-04 is within the season 09-01 to 01-31',
      contextFieldsRead: ['encounter.date'],
      indeterminate: false,
      uncertainty: [],
    });
    const outside = await inSeasonOn('2026-06-15', RSV);
    expect(outside.reason).toBe('Session date 2026-06-15 is outside the season 09-01 to 01-31');
    expect(outside.dataUnavailable).toBeUndefined();
    expect(outside.unresolvedConditions).toBeUndefined();
  });

  it('reads the session clock, not the wall clock — the same answer on replay, whenever it is replayed', async () => {
    jest.useFakeTimers();
    try {
      const answers: boolean[] = [];
      for (const wallClock of ['2020-06-15T00:00:00Z', '2026-10-04T00:00:00Z', '2031-02-20T00:00:00Z']) {
        jest.setSystemTime(new Date(wallClock));
        answers.push((await inSeasonOn('2026-10-04', RSV)).satisfied);
        answers.push((await inSeasonOn('2026-06-15', RSV)).satisfied);
      }
      expect(answers).toEqual([true, false, true, false, true, false]);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('timezone', () => {
    it('UTC (every session today): the date is the clock\'s UTC date, to the last second', async () => {
      expect((await inSeasonOn('2026-08-31', RSV, 'v1', undefined, '23:59:59.000')).satisfied).toBe(false);
      expect((await inSeasonOn('2026-09-01', RSV, 'v1', undefined, '00:00:00.000')).satisfied).toBe(true);
    });

    it('a context carrying an IANA zone gets that zone\'s date', async () => {
      // 2026-09-01T02:00Z is still Aug 31 in New York (UTC−4): out of season there.
      expect((await inSeasonOn('2026-09-01', RSV, 'v1', undefined, '02:00:00.000')).satisfied).toBe(true);
      const ny = await inSeasonOn('2026-09-01', RSV, 'v1', 'America/New_York', '02:00:00.000');
      expect(ny.satisfied).toBe(false);
      expect(ny.reason).toBe('Session date 2026-08-31 is outside the season 09-01 to 01-31');
      // 2027-02-01T03:00Z is Jan 31 in New York (UTC−5): still in season there.
      expect((await inSeasonOn('2027-02-01', RSV, 'v1', undefined, '03:00:00.000')).satisfied).toBe(false);
      expect((await inSeasonOn('2027-02-01', RSV, 'v1', 'America/New_York', '03:00:00.000')).satisfied).toBe(true);
      // Year wrap: 2027-01-01T03:00Z is Dec 31 2026 there.
      expect(sessionCalendarDate(contextAt('2027-01-01T03:00:00.000Z', 'v1', 'America/New_York'))).toEqual({
        year: 2026, month: 12, day: 31,
      });
    });

    it('a zone the runtime cannot resolve is a context error, not a guess', () => {
      expect(() => sessionCalendarDate(contextAt(at('2026-10-04'), 'v1', 'Mars/Olympus'))).toThrow(
        /not a timezone this runtime can resolve/,
      );
    });
  });

  // ── inside compound gates and nested groups ──

  describe('in a compound gate', () => {
    const HAS = { field: 'conditions', operator: 'includes_code', value: 'Z34.90', system: 'ICD-10', horizon: 'LIFETIME' };
    const pregnant = patient({ conditionCodes: [{ code: 'Z34.90', system: 'ICD-10' }] });
    const compound = (conditions: unknown[], operator = 'AND') =>
      ({ title: 'G', gate_type: GateType.COMPOUND, default_behavior: DefaultBehavior.SKIP, operator, conditions }) as unknown as GateProperties;

    it('ANDs with a chart condition, at the top level and inside a nested group', async () => {
      const flat = compound([HAS, RSV]);
      const nested = compound([HAS, { operator: 'OR', conditions: [RSV, season('04-01', '04-30')] }]);
      for (const gate of [flat, nested]) {
        expect((await evaluateGate(gate, deps(at('2026-10-04'), pregnant))).satisfied).toBe(true);
        const out = await evaluateGate(gate, deps(at('2026-06-15'), pregnant));
        expect(out.satisfied).toBe(false);
        expect(out.indeterminate).toBe(false);
        expect(out.unresolvedConditions).toBeUndefined();
      }
    });

    it('is a DEFINITE value: out of season settles an AND even beside a condition with missing data', async () => {
      const needsAge = { attribute: 'patient.gestational_age_weeks', operator: 'greater_or_equal', value: 32 };
      const gate = compound([RSV, needsAge]);
      // Out of season: the missing gestational age cannot change the answer — nothing is asked.
      const settled = await evaluateGate(gate, deps(at('2026-06-15')));
      expect(settled.satisfied).toBe(false);
      expect(settled.dataUnavailable).toBe(false);
      expect(settled.unresolvedConditions).toBeUndefined();
      // In season: the gestational age is the one thing unresolved — never the date.
      const open = await evaluateGate(gate, deps(at('2026-10-04')));
      expect(open.dataUnavailable).toBe(true);
      expect(open.unresolvedConditions).toEqual([needsAge]);
    });
  });

  // ── never asks ──

  describe('never a question', () => {
    const node = (id: string, type: string, props: Record<string, unknown> = {}): GraphNode =>
      ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } });
    const edge = (sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge =>
      ({ id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} });

    async function traverse(asOf: string, condition: Record<string, unknown>) {
      const temporalContext = contextAt(asOf);
      const engine = new TraversalEngine(
        { computeNodeConfidence: jest.fn().mockResolvedValue({ confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED' }) } as never,
        { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
        temporalContext,
        {},
        assembleContext({ mode: 'SYNTHETIC', patientContext: patient() } as never, temporalContext),
        new Map(),
      );
      const nodes = [
        node('root', 'Pathway'),
        node('gate', 'Gate', { ...gateOf(condition), on_unresolved: 'ask' }),
        node('step', 'Step'),
      ];
      const edges = [edge('root', 'gate', 'HAS_GATE'), edge('gate', 'step', 'BRANCHES_TO')];
      return engine.traverse(makeGraphContext(nodes, edges), patient(), new Map());
    }

    it('with an EMPTY chart and on_unresolved "ask", the gate decides either way and asks nothing', async () => {
      const inside = await traverse(at('2026-10-04'), RSV);
      expect(inside.resolutionState.get('step')!.status).toBe(NodeStatus.INCLUDED);
      expect(inside.pendingQuestions).toEqual([]);

      const outside = await traverse(at('2026-06-15'), RSV);
      expect(outside.resolutionState.get('gate')!.status).toBe(NodeStatus.GATED_OUT);
      expect(outside.resolutionState.get('gate')!.excludeReason).toBe(
        'Session date 2026-06-15 is outside the season 09-01 to 01-31',
      );
      expect(outside.pendingQuestions).toEqual([]);
    });

    it('askFor has no question for it, whatever path reaches it', () => {
      expect(askFor(RSV as unknown as GateCondition, new Map())).toBeNull();
    });
  });

  // ── grammar: one parser, at import, compile, preflight and evaluation ──

  describe('grammar', () => {
    it.each([['09-01', '01-31'], ['01-01', '12-31'], ['02-29', '02-29'], ['12-31', '01-01']])(
      'import accepts from %s to %s',
      (from, to) => {
        const result = validatePathwayJson(withCondition(season(from, to)));
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
      },
    );

    it('import accepts it inside a compound gate and a nested group, with display and note', () => {
      const pw = withCondition({});
      const gate = pw.nodes.find((n) => n.id === 'gate-t')!;
      gate.properties = {
        title: 'T', gate_type: 'compound', default_behavior: 'skip', operator: 'AND',
        conditions: [
          { ...RSV, display: 'RSV season', note: 'CDC: Sept–Jan' },
          { operator: 'OR', conditions: [season('10-01', '03-31'), { field: 'conditions', operator: 'includes_code', value: 'Z34.90', system: 'ICD-10', horizon: 'LIFETIME' }] },
        ],
      };
      const result = validatePathwayJson(pw);
      expect(result.errors).toEqual([]);
    });

    it.each([
      ['a month of 13', season('13-01', '01-31'), 'month must be 01–12'],
      ['Feb 30', season('09-01', '02-30'), 'day must be 01–29 for month 02'],
      ['single digits', season('9-1', '01-31'), 'two digits each'],
      ['day 00', season('09-00', '01-31'), 'day must be 01–30'],
      ['Apr 31', season('04-31', '05-01'), 'day must be 01–30 for month 04'],
      ['a full date', season('2026-09-01', '01-31'), 'two digits each'],
      ['a number', { ...RSV, from: 901 }, 'must be a month-day string'],
      ['a missing "to"', { attribute: 'encounter.date', operator: 'in_season', from: '09-01' }, 'needs "to"'],
      ['a missing "from"', { attribute: 'encounter.date', operator: 'in_season', to: '01-31' }, 'needs "from"'],
      ['another operator', { ...RSV, operator: 'equals' }, 'takes operator "in_season" only'],
      ['another encounter attribute', { ...RSV, attribute: 'encounter.month' }, 'has one attribute, "encounter.date"'],
      ['a value', { ...RSV, value: '10-04' }, 'unknown key "value"'],
      ['a horizon', { ...RSV, horizon: 'DAY' }, 'unknown key "horizon"'],
    ])('import rejects %s', (_label, condition, fragment) => {
      const result = validatePathwayJson(withCondition(condition as Record<string, unknown>));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining(fragment));
      expect(result.errors).toContainEqual(expect.stringContaining('Gate "gate-t" condition[0]'));
    });

    it('in_season is refused on any other attribute', () => {
      const result = validatePathwayJson(withCondition({ attribute: 'patient.trimester', operator: 'in_season', from: '09-01', to: '01-31' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('operator "in_season" is not a valid attribute operator'));
    });

    it('the compiler, session preflight and the evaluator refuse exactly what import refuses', async () => {
      const bad = season('13-01', '01-31');
      const message = calendarConditionError(bad)!;
      expect(message).toContain('month must be 01–12');
      expect(conditionProblem(bad)).toBe(message);
      expect(conditionProblem(RSV)).toBeNull();

      const gateNode = (c: Record<string, unknown>): GraphNode =>
        ({ id: 'g', nodeIdentifier: 'g', nodeType: 'Gate', properties: gateOf(c) as unknown as Record<string, unknown> });
      expect(() => sweepableConditions([gateNode(bad)], 'v1', new Map())).toThrow(message);
      expect(sweepableConditions([gateNode(RSV)], 'v1', new Map())).toEqual([]);
      await expect(inSeasonOn('2026-10-04', bad)).rejects.toThrow(message);
    });

    it('parseMonthDay and inSeason, directly', () => {
      expect(parseMonthDay('02-29')).toEqual({ month: 2, day: 29 });
      expect(parseMonthDay('2-29')).toHaveProperty('problem');
      expect(parseMonthDay(' 02-29')).toHaveProperty('problem');
      expect(inSeason({ month: 12, day: 31 }, { month: 9, day: 1 }, { month: 1, day: 31 })).toBe(true);
      expect(inSeason({ month: 2, day: 1 }, { month: 9, day: 1 }, { month: 1, day: 31 })).toBe(false);
      expect(isCalendarCondition(RSV)).toBe(true);
      expect(isCalendarCondition({ attribute: 'patient.trimester', operator: 'equals', value: 3 })).toBe(false);
    });
  });

  // ── compiler and reachability ──

  describe('compiled as always resolvable', () => {
    it('reads no datum', () => {
      const datums = new Map<DatumKey, DatumSpec>();
      const errors: CompileError[] = [];
      const codeMap = new Map();
      resolveDatums('g', [RSV, { operator: 'OR', conditions: [season('03-01', '05-31')] }], codeMap, buildDatumRegistry(codeMap), datums, errors);
      expect(errors).toEqual([]);
      expect([...datums.values()]).toEqual([]);
    });

    it('needs no encounter anchor and raises no temporal error', () => {
      const errors: CompileError[] = [];
      const nodes = [{ id: 'g', type: 'Gate', properties: gateOf(RSV) as unknown as Record<string, unknown> }];
      expect(checkTemporal(nodes, new Map(), {}, errors)).toBe(false);
      expect(errors).toEqual([]);
    });

    it('reachability: ALWAYS_EVALUABLE on an empty chart, with nothing missing', () => {
      const gate: GraphNode = { id: 'g', nodeIdentifier: 'g', nodeType: 'Gate', properties: gateOf(RSV) as unknown as Record<string, unknown> };
      const score = scoreReachability([gate], patient(), new Map());
      expect(score.gateExplanations[0]).toMatchObject({ classification: 'ALWAYS_EVALUABLE', missingData: [] });
      expect(score.alwaysEvaluableGates).toBe(1);
    });
  });

  it('legacy-v0 refuses it — in season or out — instead of reading it as an unknown attribute', async () => {
    for (const day of ['2026-10-04', '2026-06-15']) {
      const r = await inSeasonOn(day, RSV, 'legacy-v0');
      expect(r.satisfied).toBe(false);
      expect(r.reason).toBe('in_season requires the v1 temporal kernel; legacy-v0 cannot evaluate it');
      expect(r.contextFieldsRead).toEqual(['encounter.date']);
    }
  });
});

// ═══ 2. horizon: { since: "MM-DD" } ═══════════════════════════════════

describe('horizon { since: "MM-DD" }', () => {
  const SINCE_JULY = { since: '07-01' };
  const FLU = 'FLU-VAX';

  describe('the window opens at the most recent occurrence on or before the clock', () => {
    it.each([
      ['2026-06-30', '2025-07-01', 'the day before: the PREVIOUS year\'s'],
      ['2026-07-01', '2026-07-01', 'the day itself: this year\'s'],
      ['2026-07-02', '2026-07-01', 'the day after'],
      ['2026-10-04', '2026-07-01', 'later in the year'],
      ['2026-12-31', '2026-07-01', 'Dec 31'],
      ['2027-01-01', '2026-07-01', 'Jan 1 of the next year'],
    ])('clock %s → since %s (%s)', (day, opened) => {
      const ctx = contextAt(at(day));
      expect(sinceWindowFrom(SINCE_JULY, ctx)).toEqual({ lowerBound: `${opened}T00:00:00.000Z`, date: opened });
      expect(resolveHorizon(SINCE_JULY, ctx)).toEqual({ lowerBound: `${opened}T00:00:00.000Z`, upperBound: at(day) });
    });

    it('at 00:00:00 on the day the window is this year\'s; one second earlier it is last year\'s', () => {
      expect(sinceWindowFrom(SINCE_JULY, contextAt('2026-07-01T00:00:00.000Z')).date).toBe('2026-07-01');
      expect(sinceWindowFrom(SINCE_JULY, contextAt('2026-06-30T23:59:59.000Z')).date).toBe('2025-07-01');
    });

    it('since "02-29" opens on Feb 29 in a leap year and on Mar 1 in a year without one', () => {
      const leap = { since: '02-29' };
      expect(sinceWindowFrom(leap, contextAt(at('2028-02-29'))).date).toBe('2028-02-29');
      expect(sinceWindowFrom(leap, contextAt(at('2028-06-01'))).date).toBe('2028-02-29');
      expect(sinceWindowFrom(leap, contextAt(at('2027-06-01'))).date).toBe('2027-03-01');
      // Feb 28 2028 is before it: back to 2027, which has none → Mar 1 2027.
      expect(sinceWindowFrom(leap, contextAt(at('2028-02-28'))).date).toBe('2027-03-01');
    });

    it('a context carrying an IANA zone opens the window at that zone\'s midnight', () => {
      // 2026-07-01T02:00Z is Jun 30 in New York: the window is still last year's,
      // and it opened at New York midnight (04:00Z in July).
      const ny = contextAt('2026-07-01T02:00:00.000Z', 'v1', 'America/New_York');
      expect(sinceWindowFrom(SINCE_JULY, ny)).toEqual({ lowerBound: '2025-07-01T04:00:00.000Z', date: '2025-07-01' });
      expect(sinceWindowFrom(SINCE_JULY, contextAt('2026-07-01T02:00:00.000Z')).date).toBe('2026-07-01');
      // A winter opening date: New York midnight is 05:00Z.
      expect(sinceWindowFrom({ since: '01-15' }, contextAt('2026-03-01T12:00:00.000Z', 'v1', 'America/New_York')).lowerBound)
        .toBe('2026-01-15T05:00:00.000Z');
    });
  });

  // Labs are point facts, so they show the bound cleanly.
  const labOn = (date?: string) => patient({ labResults: [{ code: 'X', system: 'LOINC', value: 1, ...(date ? { date } : {}) }] });
  const labCond = (operator: string, extra: Record<string, unknown> = {}) =>
    ({ field: 'labs', operator, value: 'X', system: 'LOINC', horizon: SINCE_JULY, ...extra });
  const run = (day: string, condition: Record<string, unknown>, p: PatientContext, version = 'v1') =>
    evaluateGate(gateOf(condition), deps(at(day), p, version));

  describe('membership', () => {
    it.each([
      // clock Jun 30 2026 → window since 2025-07-01
      ['2026-06-30', '2025-07-01', true, 'on last year\'s opening day'],
      ['2026-06-30', '2025-06-30', false, 'the day before last year\'s opening day'],
      ['2026-06-30', '2026-03-10', true, 'this spring'],
      // clock Jul 1 2026 → window since 2026-07-01: yesterday is LAST season
      ['2026-07-01', '2026-06-30', false, 'yesterday, now last season'],
      ['2026-07-01', '2026-03-10', false, 'this spring, now last season'],
      ['2026-07-01', '2026-07-01', true, 'today, the opening day'],
      // clock Oct 4 2026
      ['2026-10-04', '2026-07-01', true, 'on the opening day'],
      ['2026-10-04', '2026-06-30', false, 'the day before the opening day'],
      ['2026-10-04', '2025-11-02', false, 'last season'],
    ])('clock %s, fact dated %s → includes_code %s (%s); not_includes_code is the mirror', async (day, date, expected) => {
      const has = await run(day, labCond('includes_code'), labOn(date));
      const hasNot = await run(day, labCond('not_includes_code'), labOn(date));
      expect(has.satisfied).toBe(expected);
      expect(hasNot.satisfied).toBe(!expected);
      expect(has.indeterminate).toBe(false);
      expect(hasNot.indeterminate).toBe(false);
    });

    it('the reason names the window, and no patient datum is added to what the gate read', async () => {
      const has = await run('2026-10-04', labCond('includes_code'), labOn('2026-08-15'));
      expect(has.reason).toBe('Patient has matching code X in labs since 2026-07-01 (this season)');
      expect(has.contextFieldsRead).toEqual(['labs']);
      const hasNot = await run('2026-06-30', labCond('not_includes_code'), labOn('2025-06-30'));
      expect(hasNot.reason).toBe('No matching code X found in patient labs since 2025-07-01 (this season)');
    });

    it('needs nothing from the patient: an empty chart decides, and nothing is unresolved', async () => {
      const r = await run('2026-10-04', labCond('not_includes_code'), patient());
      expect(r.satisfied).toBe(true);
      expect(r.dataUnavailable).toBeUndefined();
    });
  });

  it('a threshold reads the newest value this season and ignores last season\'s', async () => {
    const p = patient({ labResults: [
      { code: 'X', system: 'LOINC', value: 3, date: '2026-05-01' },
      { code: 'X', system: 'LOINC', value: 9, date: '2026-08-01' },
    ] });
    const cond = labCond('less_than', { threshold: 5 });
    const after = await run('2026-10-04', cond, p);
    expect(after.satisfied).toBe(false);
    expect(after.reason).toBe('labs value 9 >= 5 since 2026-07-01 (this season)');
    // Clock Jun 30: the May value is in THAT season's window, and is the newest on or before the clock.
    const before = await run('2026-06-30', cond, patient({ labResults: [{ code: 'X', system: 'LOINC', value: 3, date: '2026-05-01' }] }));
    expect(before.satisfied).toBe(true);
  });

  describe('count_in_window — "given this season" for an administration event', () => {
    const given = { field: 'medications', operator: 'count_in_window', value: FLU, system: 'CVX', count_threshold: 1, status: 'any', horizon: SINCE_JULY };
    const owed = { ...given, count_comparison: 'less_than' };
    const vaccinated = (...dates: string[]) => patient({ medications: dates.map((date) => ({ code: FLU, system: 'CVX', date })) });

    it.each([
      ['2026-10-04', ['2026-09-15'], true],
      ['2026-10-04', ['2025-10-20'], false],
      ['2026-10-04', ['2025-10-20', '2026-07-01'], true],
      ['2026-06-30', ['2025-10-20'], true],
      ['2026-06-30', ['2025-06-30'], false],
      ['2026-07-01', ['2026-06-30'], false],
      ['2026-07-01', ['2025-10-20'], false],
    ])('clock %s, given on %j → given this season %s; "still owed" is the mirror', async (day, dates, expected) => {
      const g = await run(day, given, vaccinated(...(dates as string[])));
      const o = await run(day, owed, vaccinated(...(dates as string[])));
      expect(g.satisfied).toBe(expected);
      expect(o.satisfied).toBe(!expected);
    });

    it('the reason reads naturally', async () => {
      expect((await run('2026-10-04', given, vaccinated('2026-09-15'))).reason).toBe(
        `Found 1 matching ${FLU} in medications since 2026-07-01 (this season) (≥1)`,
      );
      expect((await run('2026-10-04', given, vaccinated('2025-10-20'))).reason).toBe(
        `Found 0 matching ${FLU} in medications since 2026-07-01 (this season) (<1)`,
      );
    });

    it('WHY count, not includes_code, for an event: membership is interval overlap, and an open record from 2024 overlaps every season', async () => {
      const oldOpenRecord = vaccinated('2024-10-01');
      const membership = { field: 'medications', operator: 'includes_code', value: FLU, system: 'CVX', status: 'any', horizon: SINCE_JULY };
      expect((await run('2026-10-04', membership, oldOpenRecord)).satisfied).toBe(true);
      expect((await run('2026-10-04', given, oldOpenRecord)).satisfied).toBe(false);
      // The same is true of {days:N}: this is the kernel's rule, not the since-horizon's.
      expect((await run('2026-10-04', { ...membership, horizon: { days: 95 } }, oldOpenRecord)).satisfied).toBe(true);
    });
  });

  it('dated and undated facts are treated exactly as a {days:N} window of the same width treats them', async () => {
    // Clock Oct 4 12:00 → since Jul 1 00:00 is 95.5 days; {days:95} opens Jul 1 12:00.
    // Facts are dated well inside, well outside, or not at all, so the half day never matters.
    const charts = [
      labOn(undefined), labOn('2026-08-15'), labOn('2025-08-15'),
      patient({ medications: [{ code: 'X', system: 'LOINC' }] }),
      patient({ medications: [{ code: 'X', system: 'LOINC', date: '2026-08-15' }] }),
      patient({ medications: [{ code: 'X', system: 'LOINC', date: '2024-08-15' }] }),
      patient({ medications: [{ code: 'X', system: 'LOINC', date: '2024-08-15', endDate: '2024-09-01' }] }),
    ];
    const conditions = [
      labCond('includes_code'), labCond('not_includes_code'), labCond('less_than', { threshold: 5 }),
      labCond('count_in_window', { count_threshold: 1 }),
      { field: 'medications', operator: 'includes_code', value: 'X', system: 'LOINC', status: 'any', horizon: SINCE_JULY },
      { field: 'medications', operator: 'count_in_window', value: 'X', system: 'LOINC', status: 'any', count_threshold: 1, horizon: SINCE_JULY },
    ];
    for (const chart of charts) {
      for (const condition of conditions) {
        const since = await run('2026-10-04', condition, chart);
        const days = await run('2026-10-04', { ...condition, horizon: { days: 95 } }, chart);
        expect({ s: since.satisfied, i: since.indeterminate, d: since.dataUnavailable, u: since.uncertainty })
          .toEqual({ s: days.satisfied, i: days.indeterminate, d: days.dataUnavailable, u: days.uncertainty });
      }
    }
    // Stated outright: an undated fact satisfies membership and never counts toward an aggregate.
    expect((await run('2026-10-04', labCond('includes_code'), labOn(undefined))).satisfied).toBe(true);
    expect((await run('2026-10-04', labCond('count_in_window', { count_threshold: 1 }), labOn(undefined))).satisfied).toBe(false);
  });

  it('a lab.* attribute condition honours it too', async () => {
    const codeMap = new Map([['lab.x', { attributeName: 'lab.x', namespace: 'lab', system: 'LOINC', code: 'X', valueType: 'number' }]]);
    const attr = { attribute: 'lab.x', operator: 'less_than', value: 5, horizon: SINCE_JULY };
    const p = patient({ labResults: [
      { code: 'X', system: 'LOINC', value: 3, date: '2026-05-01' },
      { code: 'X', system: 'LOINC', value: 9, date: '2026-08-01' },
    ] });
    const r = await evaluateGate(gateOf(attr), { ...deps(at('2026-10-04'), p), codeMap: codeMap as never });
    expect(r.satisfied).toBe(false);
    expect(r.reason).toContain('since 2026-07-01 (this season)');
  });

  describe('grammar', () => {
    it.each(['07-01', '01-01', '12-31', '02-29'])('import accepts { since: "%s" }', (since) => {
      for (const condition of [labCond('includes_code', { horizon: { since } }), labCond('not_includes_code', { horizon: { since } }), labCond('count_in_window', { horizon: { since }, count_threshold: 1 })]) {
        const result = validatePathwayJson(withCondition(condition));
        expect(result.errors).toEqual([]);
      }
    });

    it.each([
      ['a month of 13', { since: '13-01' }, 'month must be 01–12'],
      ['Feb 30', { since: '02-30' }, 'day must be 01–29 for month 02'],
      ['single digits', { since: '9-1' }, 'two digits each'],
      ['a full date', { since: '2026-07-01' }, 'two digits each'],
      ['a number', { since: 701 }, 'must be a month-day string'],
      ['since AND days', { since: '07-01', days: 90 }, 'takes no other key'],
    ])('import rejects %s', (_label, horizon, fragment) => {
      const result = validatePathwayJson(withCondition(labCond('includes_code', { horizon })));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining(fragment));
    });

    it('is exclusive with window_days, like any horizon', () => {
      const result = validatePathwayJson(withCondition(labCond('count_in_window', { window_days: 30 })));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('not both'));
    });

    it('parseHorizonValue normalizes it and still accepts every other form', () => {
      expect(parseHorizonValue({ since: '07-01' }, 'h')).toEqual({ since: '07-01' });
      expect(parseHorizonValue({ days: 90 }, 'h')).toEqual({ days: 90 });
      expect(parseHorizonValue('QUARTER', 'h')).toBe('QUARTER');
    });

    it('is per-condition only: a pathway-level default is refused', () => {
      expect(() => parsePathwayTemporalDefaults({ default_horizons: { medications: { since: '07-01' } } })).toThrow(
        /\{ since \} is a per-condition horizon/,
      );
      expect(() => resolveEffectivePolicy('medications', 'v1', { horizons: { medications: { since: '07-01' } } })).toThrow(
        /\{ since \} is a per-condition horizon/,
      );
      // PREGNANCY's own refusal is unchanged.
      expect(() => parsePathwayTemporalDefaults({ default_horizons: { labs: 'PREGNANCY' } })).toThrow(
        /PREGNANCY is a per-condition horizon/,
      );
    });
  });

  it('the compiler: no temporal error, no encounter anchor, and no datum beyond the condition\'s own', () => {
    const errors: CompileError[] = [];
    const nodes = [{ id: 'g', type: 'Gate', properties: gateOf(labCond('not_includes_code')) as unknown as Record<string, unknown> }];
    expect(checkTemporal(nodes, new Map(), {}, errors)).toBe(false);
    expect(errors).toEqual([]);

    const datums = new Map<DatumKey, DatumSpec>();
    const codeMap = new Map();
    resolveDatums('g', [labCond('not_includes_code'), labCond('less_than', { threshold: 5 })], codeMap, buildDatumRegistry(codeMap), datums, errors);
    expect(errors).toEqual([]);
    expect([...datums.keys()]).toEqual(['lab:LOINC:X']);
  });

  it('reachability: a membership read with it stays ALWAYS_EVALUABLE — the window needs no patient data', () => {
    const gate: GraphNode = { id: 'g', nodeIdentifier: 'g', nodeType: 'Gate', properties: gateOf(labCond('not_includes_code')) as unknown as Record<string, unknown> };
    expect(scoreReachability([gate], patient(), new Map()).gateExplanations[0].classification).toBe('ALWAYS_EVALUABLE');
  });

  it('legacy-v0 refuses it rather than reading the whole history', async () => {
    for (const operator of ['includes_code', 'not_includes_code', 'count_in_window']) {
      const r = await run('2026-10-04', labCond(operator, { count_threshold: 1 }), labOn('2019-01-01'), 'legacy-v0');
      expect(r.satisfied).toBe(false);
      expect(r.reason).toBe('horizon { since } requires the v1 temporal kernel; legacy-v0 cannot evaluate it');
    }
    // Every other horizon is untouched under legacy.
    const year = await run('2026-10-04', labCond('includes_code', { horizon: 'YEAR' }), labOn('2019-01-01'), 'legacy-v0');
    expect(year.satisfied).toBe(true);
  });
});
