/**
 * Anemia in pregnancy — Josh's oral-iron response rule as two NESTED compound
 * gates, end to end (fixture: `anemia-nested-response-gates.ts`):
 *
 *   responding    = OR( Δ ≥ 1 since oral-iron start,
 *                       AND(trimester ∈ {1,3}, Hgb ≥ 11),
 *                       AND(trimester 2,       Hgb ≥ 10.5) )
 *   nonresponding = AND( Δ < 1,
 *                        OR(trimester 2,       Hgb < 11),
 *                        OR(trimester ∈ {1,3}, Hgb < 10.5) )
 *
 * Proven here:
 *  1. the two are complements for every result at 0.1 g/dL precision, in every
 *     trimester — and with the trimester unknown they are decided together or
 *     unresolved together, never split;
 *  2. at the START visit (oral iron recommended this session) both close
 *     NOT_YET_DUE when the at-target branch is false, and an Hgb already at
 *     target opens responding at once (accepted by Josh);
 *  3. `on_unresolved: ask` asks for the right datum from a nested leaf — the
 *     trimester, or a missing Hgb — once, and asks nothing when NOT YET DUE
 *     outranks it;
 *  4. a nested `window_from` asks its start date, and the anchor sweep and the
 *     care-plan anchor loader both see nested leaves.
 *
 * Pinned to `v1` with an assembled fact store: anchors resolve only there.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import type { EvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { withTherapyStarts } from '../services/resolution/temporal/anchored-window';
import { readinessOf } from '../services/resolution/pipeline/readiness';
import type { RedFlag, ResolutionState } from '../services/resolution/types';

/** What blocks generation from this state — the pipeline's one readiness rule set (spec C3). */
const validateForGeneration = (state: ResolutionState, redFlags: RedFlag[]) =>
  readinessOf({ state, pendingQuestions: [], redFlags, unavailable: [], scope: 'ROOT', isDegraded: false }).blockers;
import {
  NodeStatus,
  AnswerType,
  GateType,
  GateAnswer,
  GateProperties,
  NodeResult,
} from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';
import { windowFromRoles } from '../resolvers/helpers/therapy-starts';
import { planAnchorAnswer } from '../services/resolution/anchor-answer';
import { sweepableConditions } from '../resolvers/helpers/resolution-context';
import {
  RESPONDING_GATE,
  NONRESPONDING_GATE,
  RESPONDING_GATE_REORDERED,
  NONRESPONDING_GATE_REORDERED,
  ORAL_IRON_WINDOW,
} from './fixtures/anemia-nested-response-gates';

const ROLE = 'oral-iron-repletion';
const KEY = `anchor:medication_start:${ROLE}`;

/** As AGE hands it back: fresh, unshared objects. */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType: string): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

/**
 * The anemia v6 shape (as in `anchored-window-not-yet-due.test.ts`), with the
 * two response gates now the nested compounds. The recheck step's edge is
 * FIRST, so BFS reaches the gates before the oral-iron Medication and the
 * gates must defer for this visit's recommendation.
 */
function anemiaShape(
  resp: Record<string, unknown> = RESPONDING_GATE,
  nonresp: Record<string, unknown> = NONRESPONDING_GATE,
) {
  const nodes = [
    node('root', 'Pathway'),
    node('stage-2-empiric', 'Stage', { title: 'Empiric iron' }),
    node('step-2-3', 'Step', { title: 'Recheck Hgb in 2–4 weeks' }),
    node('lab-10', 'LabTest', { title: 'Hemoglobin recheck' }),
    node('gate-hgb-response', 'Gate', clone(resp)),
    node('step-2-4', 'Step', { title: 'Maintenance' }),
    node('gate-hgb-nonresponse', 'Gate', clone(nonresp)),
    node('step-2-6', 'Step', { title: 'Nonresponse' }),
    node('step-2-1', 'Step', { title: 'Start oral iron' }),
    node('med-1', 'Medication', { title: 'Ferrous sulfate', clinical_role: ROLE }),
  ];
  const edges = [
    edge('root', 'stage-2-empiric', 'HAS_STAGE'),
    edge('stage-2-empiric', 'step-2-3', 'HAS_STEP'),
    edge('step-2-3', 'gate-hgb-response', 'HAS_GATE'),
    edge('gate-hgb-response', 'step-2-4', 'BRANCHES_TO'),
    edge('step-2-3', 'gate-hgb-nonresponse', 'HAS_GATE'),
    edge('gate-hgb-nonresponse', 'step-2-6', 'BRANCHES_TO'),
    edge('step-2-3', 'lab-10', 'HAS_LAB_TEST'),
    edge('stage-2-empiric', 'step-2-1', 'HAS_STEP'),
    edge('step-2-1', 'med-1', 'USES_MEDICATION'),
  ];
  return makeGraphContext(nodes, edges);
}

const confidence = jest.fn();
const mockConfidenceEngine = { computeNodeConfidence: confidence };
beforeEach(() => {
  confidence.mockReset();
  confidence.mockResolvedValue({ confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED' });
});

function patient(labs: Array<[string, number]>, trimester?: number): PatientContext {
  return {
    patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [],
    labResults: labs.map(([date, value]) => ({ code: '718-7', system: 'LOINC', value, date })),
    ...(trimester !== undefined ? { patientAttributes: { trimester } } : {}),
  } as unknown as PatientContext;
}

function temporalAt(asOf: string, carePlan: boolean): EvaluationTemporalContext {
  const ctx = makeEvaluationTemporalContext({ evaluationAsOf: asOf, temporalPolicyVersion: 'v1' });
  return carePlan
    ? withTherapyStarts(ctx, [{
        clinicalRole: ROLE,
        date: '2026-06-01',
        source: { carePlanId: 'cp-1', interventionId: 'i-1', pathwayId: 'pw', nodeId: 'med-1' },
      }])
    : ctx;
}

function engineAt(asOf: string, pc: PatientContext, opts: { carePlan?: boolean } = {}) {
  const temporalContext = temporalAt(asOf, opts.carePlan === true);
  const factStore = assembleContext({ mode: 'SYNTHETIC', patientContext: pc } as never, temporalContext);
  return new TraversalEngine(
    mockConfidenceEngine as never,
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    temporalContext,
    {},
    factStore,
    new Map(),
  );
}

const DAY0 = '2026-06-01T15:00:00.000Z';
const DAY21 = '2026-06-22T15:00:00.000Z';
const BASELINE_DAY = '2026-05-29';
const RECHECK_DAY = '2026-06-20';
const RESP = 'gate-hgb-response';
const NONRESP = 'gate-hgb-nonresponse';

// ─── 1. Complements at the recheck ────────────────────────────────────

/** Evaluate one gate directly — the grid below is thousands of cases. */
async function evalGate(
  props: Record<string, unknown>,
  pc: PatientContext,
  asOf: string,
): Promise<ReturnType<typeof evaluateGate> extends Promise<infer R> ? R : never> {
  const temporalContext = temporalAt(asOf, true);
  const deps: GateEvaluationDeps = {
    temporalContext,
    pathwayDefaults: {},
    factStore: assembleContext({ mode: 'SYNTHETIC', patientContext: pc } as never, temporalContext),
    codeMap: new Map(),
    patientContext: pc,
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
  };
  return evaluateGate(props as unknown as GateProperties, deps);
}

/** The rule itself, in integer tenths — the oracle the gates are held to. */
function oracle(trimester: number, currentT: number, deltaT: number): boolean {
  return deltaT >= 10 || currentT >= (trimester === 2 ? 105 : 110);
}

const TRIMESTERS: Array<number | undefined> = [1, 2, 3, undefined];
const CURRENT_TENTHS = Array.from({ length: 41 }, (_, i) => 90 + i); // 9.0 … 13.0
const DELTA_TENTHS = Array.from({ length: 21 }, (_, i) => -5 + i);   // −0.5 … +1.5

describe('responding and nonresponding are complements (day 21, anchored on the care plan)', () => {
  const resp = clone(RESPONDING_GATE);
  const nonresp = clone(NONRESPONDING_GATE);

  it.each(TRIMESTERS.map((t) => [t ?? 'unknown', t] as const))(
    'trimester %s — every current Hgb 9.0–13.0 × every rise −0.5…+1.5, at 0.1 g/dL',
    async (_label, trimester) => {
      let unresolvedTogether = 0;
      for (const cT of CURRENT_TENTHS) {
        for (const dT of DELTA_TENTHS) {
          const pc = patient([[BASELINE_DAY, (cT - dT) / 10], [RECHECK_DAY, cT / 10]], trimester);
          const r = await evalGate(resp, pc, DAY21);
          const n = await evalGate(nonresp, pc, DAY21);
          const where = `trimester ${trimester} Hgb ${cT / 10} rise ${dT / 10}`;
          expect([where, r.notYetDue, n.notYetDue]).toEqual([where, undefined, undefined]);
          const rOpen = r.dataUnavailable === true || r.indeterminate === true;
          const nOpen = n.dataUnavailable === true || n.indeterminate === true;
          // Never split: both decided, or both unresolved.
          expect([where, rOpen]).toEqual([where, nOpen]);
          if (rOpen) {
            unresolvedTogether++;
            expect([where, r.satisfied, n.satisfied]).toEqual([where, false, false]);
            // Only the trimester can be missing here, and it is what both ask for.
            for (const g of [r, n]) {
              expect(g.unresolvedConditions!.map((c) => (c as { attribute?: string }).attribute))
                .toEqual(expect.arrayContaining(['patient.trimester']));
            }
            continue;
          }
          // Decided: exactly one open …
          expect([where, r.satisfied !== n.satisfied]).toEqual([where, true]);
          // … and the right one, in every trimester the patient could be in.
          for (const t of trimester === undefined ? [1, 2, 3] : [trimester]) {
            expect([where, t, r.satisfied]).toEqual([where, t, oracle(t, cT, dT)]);
          }
        }
      }
      // With the trimester known nothing is ever unresolved; unknown, the
      // literal shape holds exactly when the rise is < 1 and Hgb ≥ 10.5.
      const expected = trimester === undefined
        ? CURRENT_TENTHS.filter((c) => c >= 105).length * DELTA_TENTHS.filter((d) => d < 10).length
        : 0;
      expect(unresolvedTogether).toBe(expected);
    },
  );

  it('the complement holds only on trimester ∈ {1, 2, 3}: an out-of-domain value can open neither', async () => {
    // `in [1, 3]` and `equals 2` are complements on {1, 2, 3} alone. With 4,
    // 2.5 or the STRING "2" (patient attributes keep strings as given) both
    // trimester leaves are definite-false: responding reduces to Δ ≥ 1 and
    // nonresponding to Δ < 1 ∧ Hgb < 10.5, so Δ < 1 with Hgb ≥ 10.5 opens
    // neither gate. Pinned so the scope of the guarantee is explicit.
    for (const trimester of [4, 2.5, '2'] as unknown as number[]) {
      const pc = patient([[BASELINE_DAY, 10.3], [RECHECK_DAY, 10.6]], trimester);
      const r = await evalGate(resp, pc, DAY21);
      const n = await evalGate(nonresp, pc, DAY21);
      expect([trimester, r.satisfied, n.satisfied, r.dataUnavailable, n.dataUnavailable])
        .toEqual([trimester, false, false, undefined, undefined]);
    }
  });

  it('the reordered at-target arm is the same rule, and asks for the trimester only in [10.5, 11)', async () => {
    const r2 = clone(RESPONDING_GATE_REORDERED);
    const n2 = clone(NONRESPONDING_GATE_REORDERED);
    for (const trimester of TRIMESTERS) {
      for (const cT of CURRENT_TENTHS) {
        for (const dT of [-3, 0, 9, 10, 12]) {
          const pc = patient([[BASELINE_DAY, (cT - dT) / 10], [RECHECK_DAY, cT / 10]], trimester);
          const [a, b, a2, b2] = await Promise.all([
            evalGate(clone(RESPONDING_GATE), pc, DAY21), evalGate(clone(NONRESPONDING_GATE), pc, DAY21),
            evalGate(r2, pc, DAY21), evalGate(n2, pc, DAY21),
          ]);
          const open2 = a2.dataUnavailable === true;
          expect(open2).toBe(b2.dataUnavailable === true);
          if (trimester !== undefined) {
            expect([a2.satisfied, b2.satisfied]).toEqual([a.satisfied, b.satisfied]);
          } else {
            expect(open2).toBe(dT < 10 && cT >= 105 && cT < 110);
            if (!open2) expect(a2.satisfied).toBe(b2.satisfied === false);
          }
        }
      }
    }
  });
});

// ─── 2. The start visit ───────────────────────────────────────────────

describe('the start visit — oral iron recommended in this very session', () => {
  it('Hgb below target (T2, 8.2): both close NOT_YET_DUE, nothing asks, the plan generates', async () => {
    const pc = patient([[BASELINE_DAY, 8.2]], 2);
    const r = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, new Map());

    expect(r.pendingQuestions).toEqual([]);
    expect(r.resolutionState.get('med-1')!.status).toBe(NodeStatus.INCLUDED);
    for (const gateId of [RESP, NONRESP]) {
      const g = r.resolutionState.get(gateId)!;
      expect(g.status).toBe(NodeStatus.GATED_OUT);
      expect(g.notYetDue).toBe(true);
      expect(g.indeterminate).toBe(true);
      expect(g.uncertaintyReason).toBe('NOT_YET_DUE');
      expect(g.excludeReason).toMatch(/^NOT_YET_DUE: due on\/after 2026-06-15/);
      expect(g.windowAnchors).toEqual([
        expect.objectContaining({ key: KEY, source: 'SESSION_RECOMMENDATION', date: '2026-06-01', dueOn: '2026-06-15' }),
      ]);
    }
    expect(r.resolutionState.get('step-2-4')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.GATED_OUT);
    expect(validateForGeneration(r.resolutionState, r.redFlags)).toEqual([]);
  });

  it('trimester unknown: NOT YET DUE outranks the missing trimester — nothing asks', async () => {
    for (const hgb of [8.2, 10.7, 12.0]) {
      const pc = patient([[BASELINE_DAY, hgb]]);
      const r = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, new Map());
      expect(r.pendingQuestions).toEqual([]);
      for (const gateId of [RESP, NONRESP]) expect(r.resolutionState.get(gateId)!.notYetDue).toBe(true);
      expect(validateForGeneration(r.resolutionState, r.redFlags)).toEqual([]);
    }
  });

  it('Hgb already at target opens responding at once; nonresponding is a definite no', async () => {
    for (const [trimester, hgb] of [[1, 11.4], [3, 11.0], [2, 10.5]] as const) {
      const pc = patient([[BASELINE_DAY, hgb]], trimester);
      const r = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, new Map());
      expect(r.pendingQuestions).toEqual([]);
      expect(r.resolutionState.get(RESP)!.status).toBe(NodeStatus.INCLUDED);
      expect(r.resolutionState.get('step-2-4')!.status).toBe(NodeStatus.INCLUDED);
      const non = r.resolutionState.get(NONRESP)!;
      expect(non.status).toBe(NodeStatus.GATED_OUT);
      expect(non.notYetDue).toBeUndefined();
      // Decided by the at-target arms' definite false — not closed as NOT YET
      // DUE (the not-due delta is listed among the unsatisfied, as in a flat AND).
      expect(non.excludeReason).toMatch(/^Unsatisfied conditions: /);
      expect(non.indeterminate).toBe(false);
      expect(r.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.GATED_OUT);
    }
  });

  it('every trimester × Hgb 9.0–12.0: open iff at target, otherwise both NOT_YET_DUE', async () => {
    for (const trimester of [1, 2, 3]) {
      for (let cT = 90; cT <= 120; cT++) {
        const pc = patient([[BASELINE_DAY, cT / 10]], trimester);
        const r = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, new Map());
        const atTarget = oracle(trimester, cT, 0);
        const resp = r.resolutionState.get(RESP)!;
        const non = r.resolutionState.get(NONRESP)!;
        const where = `T${trimester} Hgb ${cT / 10}`;
        expect([where, r.pendingQuestions.length]).toEqual([where, 0]);
        expect([where, resp.status]).toEqual([where, atTarget ? NodeStatus.INCLUDED : NodeStatus.GATED_OUT]);
        expect([where, resp.notYetDue]).toEqual([where, atTarget ? undefined : true]);
        expect([where, non.status, non.notYetDue]).toEqual([where, NodeStatus.GATED_OUT, atTarget ? undefined : true]);
      }
    }
  });
});

// ─── 3. Recheck visits, and what gets asked ───────────────────────────

describe('recheck visits — anchored on the care plan the start visit wrote', () => {
  const at21 = (labs: Array<[string, number]>, trimester?: number, shape = anemiaShape()) => {
    const pc = patient(labs, trimester);
    return engineAt(DAY21, pc, { carePlan: true }).traverse(shape, pc, new Map());
  };
  const opened = (r: Awaited<ReturnType<typeof at21>>) =>
    [RESP, NONRESP].filter((g) => r.resolutionState.get(g)!.status === NodeStatus.INCLUDED);

  it.each([
    ['T2, +1.2 (8.2 → 9.4): responding by the rise', 2, 8.2, 9.4, RESP],
    ['T2, +0.4 (8.2 → 8.6): not responding', 2, 8.2, 8.6, NONRESP],
    ['T2, +0.4 to 10.6: responding — at the second-trimester target', 2, 10.2, 10.6, RESP],
    ['T1, +0.4 to 10.6: not responding — below the first-trimester target', 1, 10.2, 10.6, NONRESP],
    ['T3, +0.4 to 11.0: responding — exactly at target', 3, 10.6, 11.0, RESP],
    ['T3, +0.4 to 10.9: not responding', 3, 10.5, 10.9, NONRESP],
  ])('%s', async (_label, trimester, baseline, current, which) => {
    const r = await at21([[BASELINE_DAY, baseline], [RECHECK_DAY, current]], trimester);
    expect(opened(r)).toEqual([which]);
    expect(r.pendingQuestions).toEqual([]);
    expect(r.resolutionState.get(RESP)!.windowAnchors?.[0]).toMatchObject({ source: 'CARE_PLAN', date: '2026-06-01' });
  });

  it('a nested missing patient.* attribute: ONE question, for the trimester', async () => {
    const r = await at21([[BASELINE_DAY, 10.3], [RECHECK_DAY, 10.7]]);
    for (const g of [RESP, NONRESP]) expect(r.resolutionState.get(g)!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({ datumKey: 'patient.trimester' });
  });

  it('a nested missing lab: ONE question, for the most recent Hgb', async () => {
    // Day 49: the rise is known (+0.3, recheck on day 14) but no Hgb falls in
    // the at-target arm's own 28-day horizon, so the nested scalar is missing.
    const pc = patient([[BASELINE_DAY, 8.2], ['2026-06-15', 8.5]], 2);
    const r = await engineAt('2026-07-20T15:00:00.000Z', pc, { carePlan: true })
      .traverse(anemiaShape(), pc, new Map());
    for (const g of [RESP, NONRESP]) expect(r.resolutionState.get(g)!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({
      datumKey: 'LOINC:718-7',
      answerType: AnswerType.NUMERIC,
      prompt: 'Hemoglobin (g/dL) (LOINC 718-7) — most recent value?',
    });
  });

  it('a nested missing lab in a SETTLED branch is not reported as unresolved', async () => {
    // T1, +0.3, no Hgb in the 28-day horizon: the T1/3 arm is open on the
    // missing Hgb, the T2 arm is a definite false whatever its Hgb reads.
    const pc = patient([[BASELINE_DAY, 8.2], ['2026-06-15', 8.5]], 1);
    const gate = clone(RESPONDING_GATE);
    const r = await evalGate(gate, pc, '2026-07-20T15:00:00.000Z');
    expect(r.dataUnavailable).toBe(true);
    expect(r.unresolvedConditions).toHaveLength(1);
    expect(r.unresolvedConditions![0]).toBe(
      (gate.conditions[1] as { conditions: unknown[] }).conditions[1],
    );
  });

  it('no recheck yet on day 21: the nested series rule asks ONE question for the newest Hgb', async () => {
    const r = await at21([[BASELINE_DAY, 8.2]], 2);
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({
      datumKey: 'LOINC:718-7',
      prompt: 'Hemoglobin (g/dL) (LOINC 718-7) — newest result, drawn after 2026-05-29?',
    });
  });

  it('as specified, an unknown trimester is asked for even at Hgb 12 (at target in every trimester)', async () => {
    // Pinned so the cost of the literal shape is visible: the reordered arm
    // (fixture: *_REORDERED) opens responding here without asking.
    const r = await at21([[BASELINE_DAY, 11.8], [RECHECK_DAY, 12.0]]);
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({ datumKey: 'patient.trimester' });

    const r2 = await at21(
      [[BASELINE_DAY, 11.8], [RECHECK_DAY, 12.0]],
      undefined,
      anemiaShape(RESPONDING_GATE_REORDERED, NONRESPONDING_GATE_REORDERED),
    );
    expect(r2.pendingQuestions).toEqual([]);
    expect(opened(r2)).toEqual([RESP]);
  });
});

// ─── 4. A nested window_from ──────────────────────────────────────────

describe('a window_from nested inside a group', () => {
  const NESTED_ANCHOR_GATE = {
    title: 'nested anchor',
    gate_type: GateType.COMPOUND,
    default_behavior: 'skip',
    on_unresolved: 'ask',
    operator: 'AND',
    conditions: [
      { attribute: 'patient.trimester', operator: 'in', value: [1, 2, 3] },
      { operator: 'OR', conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'Z99.9', system: 'ICD-10' },
        { field: 'labs', operator: 'delta_from_baseline', value: '718-7', system: 'LOINC', display: 'Hemoglobin (g/dL)',
          delta_threshold: 1, delta_comparison: 'at_least', min_points: 2, window_from: ORAL_IRON_WINDOW },
      ] },
    ],
  };
  const graph = () => makeGraphContext(
    [
      node('root', 'Pathway'),
      node('stage-1', 'Stage'),
      node('step-1', 'Step'),
      node('gate-nested', 'Gate', clone(NESTED_ANCHOR_GATE)),
      node('step-2', 'Step'),
    ],
    [
      edge('root', 'stage-1', 'HAS_STAGE'),
      edge('stage-1', 'step-1', 'HAS_STEP'),
      edge('step-1', 'gate-nested', 'HAS_GATE'),
      edge('gate-nested', 'step-2', 'BRANCHES_TO'),
    ],
  );

  it('an unresolved nested anchor asks its start DATE', async () => {
    const pc = patient([[BASELINE_DAY, 8.2], [RECHECK_DAY, 9.4]], 2);
    const r = await engineAt(DAY21, pc).traverse(graph(), pc, new Map());
    expect(r.resolutionState.get('gate-nested')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({
      datumKey: KEY, answerType: AnswerType.DATE, prompt: 'When did oral iron start?',
    });
    // Answered, the same gate evaluates from the clinician's date.
    const answers = new Map<string, GateAnswer>([[KEY, { dateValue: '2026-06-01' }]]);
    const r2 = await engineAt(DAY21, pc).traverse(graph(), pc, answers);
    expect(r2.resolutionState.get('gate-nested')!.status).toBe(NodeStatus.INCLUDED);
    expect(r2.resolutionState.get('gate-nested')!.windowAnchors?.[0]).toMatchObject({ source: 'CLINICIAN' });
  });

  it('a start date entered on the gate unprompted (a correction) finds the nested anchor', async () => {
    // No pending question: planAnchorAnswer reads the gate's own window_from
    // keys, which must reach inside the group.
    const pc = patient([[BASELINE_DAY, 8.2], [RECHECK_DAY, 9.4]], 2);
    const answers = new Map<string, GateAnswer>([[KEY, { dateValue: '2026-06-01' }]]);
    const r = await engineAt(DAY21, pc).traverse(graph(), pc, answers);
    const plan = planAnchorAnswer({
      nodeId: 'gate-nested',
      answer: { dateValue: '2026-06-03' },
      pendingQuestions: [],
      nodeProperties: graph().getNode('gate-nested')?.properties as Record<string, unknown> | undefined,
      evaluationAsOf: DAY21,
    });
    expect(plan).toMatchObject({ kind: 'anchor', key: KEY, dateValue: '2026-06-03' });
  });

  it('the care-plan anchor loader and the anchor sweep both see it', () => {
    const g = graph();
    expect([...windowFromRoles(g)]).toEqual([ROLE]);
    const swept = sweepableConditions(g.allNodes, 'v1', new Map());
    expect(swept.map((s) => s.label)).toEqual(['gate-nested / condition 1.0', 'gate-nested / condition 1.1']);
  });
});
