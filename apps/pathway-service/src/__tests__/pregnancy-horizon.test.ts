/**
 * `horizon: "PREGNANCY"` — a window whose lower bound is the start of THIS
 * pregnancy.
 *
 * [DECISION — Josh 2026-10-04]: "drawn this pregnancy needs to use the
 * gestational age". Fixed look-backs banded by gestational age (98/196/300
 * days) can reach months before conception, so a screen from before this
 * pregnancy counted as done in it.
 *
 * The lower bound is `evaluationAsOf − gestational_age_weeks × 7 days` — the
 * LMP date, since gestational age is dated from the last menstrual period —
 * floored to the start of that UTC day. The age is read from the EFFECTIVE
 * patient at every evaluation, never pinned on the session. With no usable
 * age the condition is UNRESOLVED and asks for it; it never falls back to
 * LIFETIME or to an empty window.
 *
 * The session answer path (ask → answer → decided) is proved over the real
 * pipeline in `pipeline-pregnancy-horizon.test.ts`.
 */

jest.mock('../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import {
  AnswerType,
  DefaultBehavior,
  GateCondition,
  GateProperties,
  GateType,
  NodeStatus,
} from '../services/resolution/types';
import {
  TemporalContextError,
  makeEvaluationTemporalContext,
  pregnancyWindowFrom,
  resolveHorizon,
} from '../services/resolution/temporal/evaluation-context';
import {
  parsePathwayTemporalDefaults,
  resolveEffectivePolicy,
  toEffectivePolicy,
} from '../services/resolution/temporal/cascade';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { conditionReadsGestationalAge } from '../services/resolution/temporal/condition-adapter';
import { scoreReachability } from '../services/resolution/reachability';
import { validatePathwayJson } from '../services/import/validator';
import { buildDatumRegistry, resolveDatums } from '../services/compiler/datums';
import { checkTemporal } from '../services/compiler/temporal';
import type { CompileError, DatumKey, DatumSpec } from '../services/compiler/model';
import type { PathwayJson } from '../services/import/types';
import type { GraphEdge, GraphNode, PatientContext } from '../services/confidence/types';
import { clonePathway } from './fixtures/reference-pathway';
import { makeGraphContext } from './fixtures/reference-patient-context';

// 28 weeks = 196 days before 2026-10-04 is 2026-03-22: the LMP date.
const AS_OF = '2026-10-04T12:00:00.000Z';
const LMP_28W = '2026-03-22';
const DAY_BEFORE_LMP_28W = '2026-03-21';

const HIV = '75622-1';
const HGB = '718-7';

type Lab = { code: string; system: string; value: number; date?: string };
const lab = (code: string, date: string | undefined, value = 1): Lab => ({
  code, system: 'LOINC', value, ...(date ? { date } : {}),
});

function patient(labs: Lab[], gestationalAgeWeeks?: unknown): PatientContext {
  return {
    patientId: 'pt-1',
    conditionCodes: [],
    medications: [],
    allergies: [],
    labResults: labs,
    ...(gestationalAgeWeeks !== undefined
      ? { patientAttributes: { gestational_age_weeks: gestationalAgeWeeks } }
      : {}),
  } as unknown as PatientContext;
}

function deps(patientContext: PatientContext, version = 'v1', asOf = AS_OF): GateEvaluationDeps {
  const temporalContext = makeEvaluationTemporalContext({
    evaluationAsOf: asOf,
    temporalPolicyVersion: version,
  });
  return {
    temporalContext,
    pathwayDefaults: {},
    factStore:
      version === 'v1'
        ? assembleContext({ mode: 'SYNTHETIC', patientContext } as never, temporalContext)
        : [],
    patientContext,
    resolutionState: new Map(),
    gateAnswers: new Map(),
    gateId: 'gate-1',
    codeMap: new Map(),
  };
}

const gateOf = (condition: Record<string, unknown>, extra: Record<string, unknown> = {}): GateProperties =>
  ({
    title: 'Gate',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: condition as unknown as GateCondition,
    ...extra,
  }) as GateProperties;

const DRAWN = { field: 'labs', operator: 'includes_code', value: HIV, system: 'LOINC', horizon: 'PREGNANCY' };
const NOT_DRAWN = { ...DRAWN, operator: 'not_includes_code' };
const ANEMIC = {
  field: 'labs', operator: 'less_than', value: HGB, system: 'LOINC', threshold: 11, horizon: 'PREGNANCY',
};

const evaluate = (condition: Record<string, unknown>, p: PatientContext, version = 'v1') =>
  evaluateGate(gateOf(condition), deps(p, version));

// ─── (1) membership ───────────────────────────────────────────────────

describe('includes_code with horizon PREGNANCY', () => {
  it('a lab dated inside the pregnancy satisfies it, and the reason names the window', async () => {
    const r = await evaluate(DRAWN, patient([lab(HIV, '2026-06-10')], 28));
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe(
      `Patient has matching code ${HIV} in labs within this pregnancy (since ${LMP_28W}, 28 weeks)`,
    );
    expect(r.dataUnavailable).toBeUndefined();
  });

  it('a lab dated the day before the LMP date does not', async () => {
    const r = await evaluate(DRAWN, patient([lab(HIV, DAY_BEFORE_LMP_28W)], 28));
    expect(r.satisfied).toBe(false);
    // A definite "no": the window was dated, and nothing fell inside it.
    expect(r.indeterminate).toBe(false);
    expect(r.dataUnavailable).toBeUndefined();
    expect(r.reason).toContain(`within this pregnancy (since ${LMP_28W}, 28 weeks)`);
  });

  it('a lab dated ON the LMP date does — the bound is the start of that UTC day', async () => {
    const r = await evaluate(DRAWN, patient([lab(HIV, LMP_28W)], 28));
    expect(r.satisfied).toBe(true);
  });

  it('an undated fact is treated exactly as a {days:N} window treats it — the kernel rule, unchanged', async () => {
    // Membership / scalar: an undated lab is "asserted current" by the
    // assembler and admitted to ANY window, bounded or not. An aggregate
    // excludes it from a bounded window (D8). PREGNANCY adds no rule of its
    // own: whatever {days:196} decides, a 196-day pregnancy decides.
    const undated = patient([lab(HIV, undefined)], 28);
    const count = { field: 'labs', operator: 'count_in_window', value: HIV, system: 'LOINC', count_threshold: 1 };
    for (const base of [DRAWN, NOT_DRAWN, { ...ANEMIC, value: HIV }, count]) {
      const pregnancy = await evaluate({ ...base, horizon: 'PREGNANCY' }, undated);
      const days = await evaluate({ ...base, horizon: { days: 196 } }, undated);
      expect({ s: pregnancy.satisfied, i: pregnancy.indeterminate, d: pregnancy.dataUnavailable, u: pregnancy.uncertainty })
        .toEqual({ s: days.satisfied, i: days.indeterminate, d: days.dataUnavailable, u: days.uncertainty });
    }
    // And the aggregate half of that rule, stated outright: not counted.
    expect((await evaluate({ ...count, horizon: 'PREGNANCY' }, undated)).satisfied).toBe(false);
  });

  it('records the gestational age among what the gate read', async () => {
    const r = await evaluate(DRAWN, patient([lab(HIV, '2026-06-10')], 28));
    expect(r.contextFieldsRead).toEqual(['labs', 'patient.gestational_age_weeks']);
  });

  it('exists is bounded by the pregnancy too', async () => {
    const exists = { field: 'labs', operator: 'exists', value: '', horizon: 'PREGNANCY' };
    expect((await evaluate(exists, patient([lab(HIV, '2026-06-10')], 28))).satisfied).toBe(true);
    expect((await evaluate(exists, patient([lab(HIV, DAY_BEFORE_LMP_28W)], 28))).satisfied).toBe(false);
  });

  it('works on conditions and medications, not only labs', async () => {
    const p = {
      ...patient([], 28),
      conditionCodes: [
        { code: 'O24.4', system: 'ICD-10', date: '2026-07-01' },
        { code: 'O14.0', system: 'ICD-10', date: '2024-02-01', endDate: '2024-06-01' },
        { code: 'I10', system: 'ICD-10', date: '2021-01-01' },
      ],
      medications: [{ code: 'RX-ASA', system: 'RXNORM', date: '2026-05-01' }],
    } as unknown as PatientContext;
    const cond = (value: string) =>
      ({ field: 'conditions', operator: 'includes_code', value, system: 'ICD-10', horizon: 'PREGNANCY', status: 'any' });
    expect((await evaluate(cond('O24.4'), p)).satisfied).toBe(true);
    // Pre-eclampsia that began AND ended before this pregnancy is not in it.
    expect((await evaluate(cond('O14.0'), p)).satisfied).toBe(false);
    // A condition is an INTERVAL: one that began earlier and is still open
    // overlaps the pregnancy, exactly as it overlaps any other bounded window.
    expect((await evaluate(cond('I10'), p)).satisfied).toBe(true);
    const med = {
      field: 'medications', operator: 'includes_code', value: 'RX-ASA', system: 'RXNORM',
      horizon: 'PREGNANCY', status: 'any',
    };
    expect((await evaluate(med, p)).satisfied).toBe(true);
  });
});

// ─── (2) the mirror ───────────────────────────────────────────────────

describe('not_includes_code with horizon PREGNANCY is the mirror', () => {
  it.each([
    ['inside the pregnancy', '2026-06-10', false],
    ['the day before the LMP date', DAY_BEFORE_LMP_28W, true],
    ['on the LMP date', LMP_28W, false],
  ])('a lab dated %s → satisfied %s', async (_label, date, expected) => {
    const r = await evaluate(NOT_DRAWN, patient([lab(HIV, date as string)], 28));
    expect(r.satisfied).toBe(expected);
    expect(r.indeterminate).toBe(false);
    const positive = await evaluate(DRAWN, patient([lab(HIV, date as string)], 28));
    expect(positive.satisfied).toBe(!expected);
  });
});

// ─── (3) scalar ───────────────────────────────────────────────────────

describe('a scalar threshold with horizon PREGNANCY', () => {
  it('reads the newest value inside the pregnancy and ignores an older pre-pregnancy one', async () => {
    const labs = [
      lab(HGB, '2026-01-15', 9.0),   // before this pregnancy: anemic then
      lab(HGB, '2026-05-01', 12.4),  // this pregnancy, older
      lab(HGB, '2026-08-20', 11.8),  // this pregnancy, newest
    ];
    const r = await evaluate(ANEMIC, patient(labs, 28));
    expect(r.satisfied).toBe(false);
    expect(r.reason).toBe(`labs value 11.8 >= 11 within this pregnancy (since ${LMP_28W}, 28 weeks)`);
  });

  it('with ONLY a pre-pregnancy value it has no value — it asks for the lab, it does not use the old one', async () => {
    // The default QUARTER would not see a January value either; LIFETIME would,
    // and would call this patient anemic on a result from before conception.
    const r = await evaluate(ANEMIC, patient([lab(HGB, '2026-01-15', 9.0)], 28));
    expect(r.satisfied).toBe(false);
    expect(r.dataUnavailable).toBe(true);
    expect(r.unresolvedPregnancyConditions).toBeUndefined();
  });

  it('reaches further back than the labs default (QUARTER) when the pregnancy does', async () => {
    // 2026-05-01 is 156 days back: outside QUARTER, inside a 28-week pregnancy.
    const labs = [lab(HGB, '2026-05-01', 9.5)];
    const { horizon: _h, ...quarter } = ANEMIC;
    expect((await evaluate(quarter, patient(labs, 28))).dataUnavailable).toBe(true);
    expect((await evaluate(ANEMIC, patient(labs, 28))).satisfied).toBe(true);
  });

  it('a lab.* attribute condition honours it as well', async () => {
    const codeMap = new Map([
      ['lab.hemoglobin', { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: HGB, valueType: 'number' }],
    ]);
    const attr = { attribute: 'lab.hemoglobin', operator: 'less_than', value: 11, horizon: 'PREGNANCY' };
    const run = async (p: PatientContext) =>
      evaluateGate(gateOf(attr), { ...deps(p), codeMap: codeMap as never });

    const dated = await run(patient([lab(HGB, '2026-01-15', 9.0), lab(HGB, '2026-08-20', 11.8)], 28));
    expect(dated.satisfied).toBe(false);
    expect(dated.reason).toContain(`within this pregnancy (since ${LMP_28W}, 28 weeks)`);
    expect(dated.contextFieldsRead).toEqual(['lab.hemoglobin', 'patient.gestational_age_weeks']);

    const undated = await run(patient([lab(HGB, '2026-08-20', 9.0)]));
    expect(undated.satisfied).toBe(false);
    expect(undated.dataUnavailable).toBe(true);
    expect(undated.unresolvedPregnancyConditions).toHaveLength(1);
  });

  it('count_in_window counts within the pregnancy and says so', async () => {
    const count = {
      field: 'labs', operator: 'count_in_window', value: HGB, system: 'LOINC',
      count_threshold: 2, horizon: 'PREGNANCY',
    };
    const labs = [lab(HGB, '2026-01-15', 9), lab(HGB, '2026-05-01', 12), lab(HGB, '2026-08-20', 11)];
    const r = await evaluate(count, patient(labs, 28));
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe(
      `Found 2 matching ${HGB} in labs within this pregnancy (since ${LMP_28W}, 28 weeks) (≥2)`,
    );
    const missing = await evaluate(count, patient(labs));
    expect(missing.satisfied).toBe(false);
    expect(missing.dataUnavailable).toBe(true);
  });
});

// ─── (4) gestational age missing ──────────────────────────────────────

describe('gestational age missing or unusable', () => {
  const HAS_LAB = [lab(HIV, '2026-06-10')];

  it.each([
    ['absent', undefined],
    ['zero', 0],
    ['negative', -4],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a string', '28'],
    ['absurdly large', 1e12],
  ])('%s → unresolved for patient.gestational_age_weeks, never a verdict, never a throw', async (_l, ga) => {
    for (const condition of [DRAWN, NOT_DRAWN, ANEMIC]) {
      const r = await evaluate(condition, patient(HAS_LAB, ga));
      // Not "yes" (LIFETIME would say yes for DRAWN) and not a definite "no"
      // (a zero-width window would say yes for NOT_DRAWN).
      expect(r.satisfied).toBe(false);
      expect(r.dataUnavailable).toBe(true);
      expect(r.unresolvedPregnancyConditions).toHaveLength(1);
      expect(r.contextFieldsRead).toContain('patient.gestational_age_weeks');
      expect(r.reason).toContain('gestational age (patient.gestational_age_weeks) is missing');
    }
  });

  it('inside a compound, the undated leaf is the one reported — unless a sibling settles the gate', async () => {
    const compound = (operator: string, sibling: Record<string, unknown>) =>
      ({
        title: 'G', gate_type: GateType.COMPOUND, default_behavior: DefaultBehavior.SKIP, operator,
        conditions: [sibling, { operator: 'OR', conditions: [DRAWN] }],
      }) as unknown as GateProperties;
    const has = { field: 'labs', operator: 'includes_code', value: HIV, system: 'LOINC', horizon: 'LIFETIME' };
    const hasNot = { ...has, value: 'NOPE' };

    const open = await evaluateGate(compound('AND', has), deps(patient(HAS_LAB)));
    expect(open.satisfied).toBe(false);
    expect(open.dataUnavailable).toBe(true);
    expect(open.unresolvedPregnancyConditions).toEqual([DRAWN]);

    // A definite false settles the AND: the age cannot change the answer.
    const settled = await evaluateGate(compound('AND', hasNot), deps(patient(HAS_LAB)));
    expect(settled.satisfied).toBe(false);
    expect(settled.dataUnavailable).toBe(false);
    expect(settled.unresolvedPregnancyConditions).toBeUndefined();
  });

  // ── at the traversal: PENDING with ONE question ──

  const node = (id: string, type: string, props: Record<string, unknown> = {}): GraphNode =>
    ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } });
  const edge = (sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge =>
    ({ id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} });
  const confidence = {
    computeNodeConfidence: jest.fn().mockResolvedValue({
      confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED',
    }),
  };

  async function traverse(gates: Array<Record<string, unknown>>, p: PatientContext) {
    const temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
    const nodes = [node('root', 'Pathway')];
    const edges: GraphEdge[] = [];
    gates.forEach((props, i) => {
      nodes.push(node(`gate-${i}`, 'Gate', props), node(`step-${i}`, 'Step'));
      edges.push(edge('root', `gate-${i}`, 'HAS_GATE'), edge(`gate-${i}`, `step-${i}`, 'BRANCHES_TO'));
    });
    const engine = new TraversalEngine(
      confidence as never,
      { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
      temporalContext,
      {},
      assembleContext({ mode: 'SYNTHETIC', patientContext: p } as never, temporalContext),
      new Map(),
    );
    return engine.traverse(makeGraphContext(nodes, edges), p, new Map());
  }

  const gateProps = (condition: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    title: 'HIV screen drawn this pregnancy?',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition,
    ...extra,
  });
  const GA_GATE = gateProps(
    { attribute: 'patient.gestational_age_weeks', operator: 'greater_or_equal', value: 24 },
    { title: 'Past 24 weeks?' },
  );

  it('the gate is PENDING with the question a missing patient.gestational_age_weeks gate asks', async () => {
    const viaHorizon = await traverse([gateProps(DRAWN)], patient(HAS_LAB));
    expect(viaHorizon.resolutionState.get('gate-0')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(viaHorizon.resolutionState.get('step-0')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(viaHorizon.pendingQuestions).toHaveLength(1);

    const viaAttribute = await traverse([GA_GATE], patient(HAS_LAB));
    const { gateId: _g, askedByNodeIds: _a, affectedSubtreeSize: _s, estimatedImpact: _e, ...asked } =
      viaHorizon.pendingQuestions[0];
    expect(viaAttribute.pendingQuestions[0]).toMatchObject(asked);
    expect(asked).toMatchObject({
      datumKey: 'patient.gestational_age_weeks',
      answerType: AnswerType.NUMERIC,
      askTarget: { kind: 'attribute', path: 'patient.gestational_age_weeks' },
      prompt: 'Gestational age (weeks) — current value?',
    });
  });

  it('three gates needing it — two by horizon, one by attribute — share ONE question', async () => {
    const result = await traverse(
      [gateProps(DRAWN), gateProps(NOT_DRAWN), GA_GATE, gateProps(ANEMIC)],
      patient(HAS_LAB),
    );
    expect(result.pendingQuestions).toHaveLength(1);
    expect(result.pendingQuestions[0].datumKey).toBe('patient.gestational_age_weeks');
    expect(result.pendingQuestions[0].askedByNodeIds).toEqual(['gate-0', 'gate-1', 'gate-2', 'gate-3']);
    for (const id of ['gate-0', 'gate-1', 'gate-2', 'gate-3']) {
      expect(result.resolutionState.get(id)!.status).toBe(NodeStatus.PENDING_QUESTION);
    }
  });

  it('an authored gate prompt about the LAB does not label the gestational-age question', async () => {
    const result = await traverse(
      [gateProps(DRAWN, { prompt: 'Has an HIV screen been drawn this pregnancy?' })],
      patient(HAS_LAB),
    );
    expect(result.pendingQuestions[0].prompt).toBe('Gestational age (weeks) — current value?');
  });

  it('on_unresolved "default" takes default_behavior and asks nothing', async () => {
    const result = await traverse([gateProps(DRAWN, { on_unresolved: 'default' })], patient(HAS_LAB));
    expect(result.resolutionState.get('gate-0')!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.pendingQuestions).toHaveLength(0);
  });

  it('with the age on file nothing is asked and both mirrors decide', async () => {
    const result = await traverse([gateProps(DRAWN), gateProps(NOT_DRAWN)], patient(HAS_LAB, 28));
    expect(result.pendingQuestions).toHaveLength(0);
    expect(result.resolutionState.get('step-0')!.status).toBe(NodeStatus.INCLUDED);
    expect(result.resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
  });
});

// ─── (5) the bound moves with gestational age ─────────────────────────

describe('the lower bound follows the gestational age', () => {
  const ctx = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });

  it('10 vs 30 weeks', async () => {
    expect(pregnancyWindowFrom(10, ctx)).toEqual({
      lowerBound: '2026-07-26T00:00:00.000Z', lmpDate: '2026-07-26', weeks: 10,
    });
    expect(pregnancyWindowFrom(30, ctx)).toEqual({
      lowerBound: '2026-03-08T00:00:00.000Z', lmpDate: '2026-03-08', weeks: 30,
    });

    // One lab, drawn 2026-05-01: before a 10-week pregnancy, inside a 30-week one.
    const labs = [lab(HIV, '2026-05-01')];
    const at10 = await evaluate(DRAWN, patient(labs, 10));
    const at30 = await evaluate(DRAWN, patient(labs, 30));
    expect(at10.satisfied).toBe(false);
    expect(at10.reason).toContain('(since 2026-07-26, 10 weeks)');
    expect(at30.satisfied).toBe(true);
    expect(at30.reason).toContain('(since 2026-03-08, 30 weeks)');
  });

  it('fractional weeks are honoured, then floored to the start of the UTC day', () => {
    // 28.5 weeks = 199.5 days before 2026-10-04T12:00Z = 2026-03-19T00:00Z.
    expect(pregnancyWindowFrom(28.5, ctx)!.lmpDate).toBe('2026-03-19');
    // 28 + 3/7 weeks = 199 days → 2026-03-19T12:00Z → that day's start.
    expect(pregnancyWindowFrom(28 + 3 / 7, ctx)!.lowerBound).toBe('2026-03-19T00:00:00.000Z');
  });

  it('the upper bound is the session clock, as for every horizon', async () => {
    // Dated after evaluationAsOf: outside the window however long the pregnancy.
    const r = await evaluate(DRAWN, patient([lab(HIV, '2026-10-20')], 28));
    expect(r.satisfied).toBe(false);
  });

  it('is deterministic: the same inputs give the same result, a different age a different one', async () => {
    const labs = [lab(HIV, '2026-05-01')];
    const a = await evaluate(DRAWN, patient(labs, 30));
    const b = await evaluate(DRAWN, patient(labs, 30));
    const c = await evaluate(DRAWN, patient(labs, 10));
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it('the cascade never resolves PREGNANCY without the derived bound, and refuses a stray one', () => {
    expect(() => resolveHorizon('PREGNANCY', ctx)).toThrow(TemporalContextError);
    const pregnancyTier = resolveEffectivePolicy('labs', 'v1', {}, { horizon: 'PREGNANCY' });
    expect(() => toEffectivePolicy(pregnancyTier, ctx)).toThrow(/PREGNANCY horizon requires/);
    expect(toEffectivePolicy(pregnancyTier, ctx, undefined, '2026-03-22T00:00:00.000Z').horizon).toEqual({
      lowerBound: '2026-03-22T00:00:00.000Z', upperBound: AS_OF,
    });
    const quarterTier = resolveEffectivePolicy('labs', 'v1', {});
    expect(() => toEffectivePolicy(quarterTier, ctx, undefined, '2026-03-22T00:00:00.000Z')).toThrow(
      /not PREGNANCY/,
    );
  });
});

// ─── (6) import validation, and where PREGNANCY may be authored ───────

describe('authoring', () => {
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

  it.each([
    ['includes_code', DRAWN],
    ['not_includes_code', NOT_DRAWN],
    ['a scalar threshold', ANEMIC],
    ['a lab.* attribute', { attribute: 'lab.hemoglobin', operator: 'less_than', value: 11, horizon: 'PREGNANCY' }],
  ])('import accepts "PREGNANCY" on %s', (_label, condition) => {
    const result = validatePathwayJson(withCondition(condition));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('import still rejects an unknown horizon, and a lower-case spelling', () => {
    for (const horizon of ['GESTATION', 'pregnancy']) {
      const result = validatePathwayJson(withCondition({ ...DRAWN, horizon }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('not a horizon'));
    }
  });

  it('import rejects PREGNANCY combined with window_days or window_from', () => {
    const count = { field: 'labs', operator: 'count_in_window', value: HGB, system: 'LOINC' };
    const both = validatePathwayJson(withCondition({ ...count, horizon: 'PREGNANCY', window_days: 30 }));
    expect(both.valid).toBe(false);
    expect(both.errors).toContainEqual(expect.stringContaining('not both'));
  });

  it('PREGNANCY is per-condition only: a pathway-level default is refused', () => {
    expect(() => parsePathwayTemporalDefaults({ default_horizons: { labs: 'PREGNANCY' } })).toThrow(
      /PREGNANCY is a per-condition horizon/,
    );
    // A hand-built defaults object cannot smuggle it past the parser either.
    expect(() => resolveEffectivePolicy('labs', 'v1', { horizons: { labs: 'PREGNANCY' } })).toThrow(
      /PREGNANCY is a per-condition horizon/,
    );
  });

  it('conditionReadsGestationalAge: governed conditions that say PREGNANCY, and only those', () => {
    expect(conditionReadsGestationalAge(DRAWN)).toBe(true);
    expect(conditionReadsGestationalAge({ attribute: 'lab.hemoglobin', operator: 'less_than', value: 11, horizon: 'PREGNANCY' })).toBe(true);
    expect(conditionReadsGestationalAge({ ...DRAWN, horizon: 'YEAR' })).toBe(false);
    expect(conditionReadsGestationalAge({ ...DRAWN, horizon: undefined })).toBe(false);
    // patient.* is not governed by temporal policy: its override is ignored.
    expect(conditionReadsGestationalAge({ attribute: 'patient.trimester', operator: 'equals', value: 3, horizon: 'PREGNANCY' })).toBe(false);
  });
});

// ─── (7) the compiler and reachability know the gate reads the age ────

describe('what a PREGNANCY-horizon gate reads', () => {
  const compile = (readers: Array<[string, Record<string, unknown>[]]>) => {
    const datums = new Map<DatumKey, DatumSpec>();
    const errors: CompileError[] = [];
    const codeMap = new Map();
    const registry = buildDatumRegistry(codeMap);
    for (const [gate, conditions] of readers) resolveDatums(gate, conditions, codeMap, registry, datums, errors);
    return { datums: [...datums.values()].sort((a, b) => (a.key < b.key ? -1 : 1)), errors };
  };

  it('the compiler lists patient.gestational_age_weeks among its datums — even for membership', () => {
    const { datums, errors } = compile([
      ['g-drawn', [DRAWN]],
      ['g-anemic', [{ operator: 'AND', conditions: [ANEMIC] }]],
      ['g-ga', [{ attribute: 'patient.gestational_age_weeks', operator: 'greater_or_equal', value: 24 }]],
      ['g-plain', [{ ...DRAWN, horizon: 'YEAR' }]],
    ]);
    expect(errors).toEqual([]);
    expect(datums).toEqual([
      // One datum, shared with the attribute spelling; g-plain reads no age.
      { key: 'attribute:gestational_age_weeks', domain: 'attribute', valueType: 'number', readBy: ['g-anemic', 'g-drawn', 'g-ga'] },
      { key: `lab:LOINC:${HGB}`, domain: 'lab', valueType: 'number', readBy: ['g-anemic'] },
    ]);
  });

  it('the compiler needs no encounter anchor for it and reports no temporal error', () => {
    const errors: CompileError[] = [];
    const nodes = [{ id: 'g', type: 'Gate', properties: gateOf(DRAWN) as unknown as Record<string, unknown> }];
    expect(checkTemporal(nodes, new Map(), {}, errors)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('reachability: blocked on the gestational age when it is missing, available when it is on file', () => {
    const gate: GraphNode = {
      id: 'g', nodeIdentifier: 'g', nodeType: 'Gate',
      properties: gateOf(DRAWN) as unknown as Record<string, unknown>,
    };
    const without = scoreReachability([gate], patient([lab(HIV, '2026-06-10')]), new Map());
    expect(without.gateExplanations[0]).toMatchObject({
      classification: 'DATA_BLOCKED',
      missingData: [{ attribute: 'patient.gestational_age_weeks' }],
    });
    const withAge = scoreReachability([gate], patient([lab(HIV, '2026-06-10')], 28), new Map());
    expect(withAge.gateExplanations[0].classification).toBe('DATA_AVAILABLE');
  });
});

// ─── (8) legacy-v0 refuses ────────────────────────────────────────────

describe('legacy-v0', () => {
  it.each([
    ['includes_code', DRAWN],
    ['not_includes_code', NOT_DRAWN],
    ['a scalar threshold', ANEMIC],
  ])('refuses %s with horizon PREGNANCY rather than reading the whole history', async (_l, condition) => {
    // The lab is on file and the age is known: legacy would answer from the
    // lifetime bucket. It must say it cannot evaluate this instead.
    const r = await evaluate(condition, patient([lab(HIV, '2019-01-01'), lab(HGB, '2019-01-01', 9)], 28), 'legacy-v0');
    expect(r.satisfied).toBe(false);
    expect(r.reason).toBe('horizon PREGNANCY requires the v1 temporal kernel; legacy-v0 cannot evaluate it');
    // Legacy reports no unresolved signals, for this or anything else.
    expect(r.dataUnavailable).toBeUndefined();
    expect(r.indeterminate).toBeUndefined();
  });

  it('is untouched for every other horizon', async () => {
    const r = await evaluate({ ...DRAWN, horizon: 'YEAR' }, patient([lab(HIV, '2019-01-01')], 28), 'legacy-v0');
    expect(r.satisfied).toBe(true);
  });
});
