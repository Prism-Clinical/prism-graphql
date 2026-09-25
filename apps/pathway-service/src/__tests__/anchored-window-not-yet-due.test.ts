/**
 * NOT YET DUE — `window_from.min_days_since_anchor`, and the visit that
 * STARTS the drug.
 *
 * Josh's rule: nonresponse is a Hgb rise < 1 g/dL after 2–4 weeks of oral
 * iron. Without a minimum, any recheck decided — a day-5 recheck with +0.3
 * escalated. And on the visit that starts oral iron there is no care plan and
 * no dated order yet, so the response gates asked "when did oral iron start?"
 * and then for a recheck that cannot exist; `validateForGeneration` refuses a
 * session with a pending question, so that visit's care plan was blocked.
 *
 * Two changes, proven on the anemia shape end to end:
 *
 *  1. `min_days_since_anchor: N` — fewer than N days after the resolved anchor,
 *     the condition is NOT YET DUE: the gate closes with a distinct reason and
 *     asks nothing. Neither response branch opens; nothing blocks the plan.
 *  2. SESSION_RECOMMENDATION — when no clinician date, care plan or order
 *     anchors the class, but THIS traversal includes the pathway's own
 *     Medication node(s) of the class, the anchor is the session clock. A
 *     treatment starting now has had no time to act: not yet due.
 *
 * Pinned to `v1` with an assembled fact store: anchors resolve only there.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import type { EvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { parseWindowFrom, withTherapyStarts } from '../services/resolution/temporal/anchored-window';
import { TemporalContextError } from '../services/resolution/temporal/evaluation-context';
import { validateForGeneration } from '../services/resolution/care-plan-generator';
import {
  NodeStatus,
  AnswerType,
  DefaultBehavior,
  GateType,
  GateAnswer,
} from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';
import { readFileSync } from 'fs';
import { join } from 'path';

const KEY = 'anchor:medication_start:oral-iron-repletion';
const ROLE = 'oral-iron-repletion';

const ORAL_IRON = {
  event: 'medication_start',
  clinical_role: ROLE,
  label: 'oral iron',
  codes: [{ system: 'RXNORM', code: 'RX-FE-SULFATE' }],
  baseline_days: 28,
  min_days_since_anchor: 14,
};

const DELTA = (comparison: 'at_least' | 'less_than', windowFrom: Record<string, unknown> = ORAL_IRON) => ({
  field: 'labs', operator: 'delta_from_baseline', value: '718-7', system: 'LOINC',
  display: 'Hemoglobin (g/dL)', delta_threshold: 1.0, delta_comparison: comparison, min_points: 2,
  window_from: windowFrom,
});

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType: string): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

function responseGate(title: string, condition: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return node(title, 'Gate', {
    title,
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    on_unresolved: 'ask',
    condition,
    ...extra,
  });
}

/**
 * The anemia v6 shape: stage-2-empiric holds the oral iron step and the
 * recheck step; the recheck step hosts two single-target gates on ONE
 * anchored delta.
 *
 * The recheck step's edge is FIRST, so BFS reaches both gates BEFORE the
 * medication — the gate cannot know yet whether this visit recommends oral
 * iron, and must wait for it (the deferral this file exists to prove).
 */
function anemiaShape(opts: {
  gateExtra?: Record<string, unknown>;
  respCondition?: Record<string, unknown>;
  nonrespCondition?: Record<string, unknown>;
  /** Put an oral-iron Medication INSIDE the maintenance branch too. */
  ironInMaintenance?: boolean;
  /** Omit the oral-iron step entirely. */
  noIronStep?: boolean;
} = {}) {
  const nodes = [
    node('root', 'Pathway'),
    node('stage-2-empiric', 'Stage', { title: 'Empiric iron' }),
    node('step-2-3', 'Step', { title: 'Recheck Hgb in 2–4 weeks' }),
    node('lab-10', 'LabTest', { title: 'Hemoglobin recheck' }),
    responseGate('gate-hgb-response', opts.respCondition ?? DELTA('at_least'), opts.gateExtra),
    node('step-2-4', 'Step', { title: 'Maintenance' }),
    responseGate('gate-hgb-nonresponse', opts.nonrespCondition ?? DELTA('less_than'), opts.gateExtra),
    node('step-2-6', 'Step', { title: 'Nonresponse' }),
  ];
  const edges = [
    edge('root', 'stage-2-empiric', 'HAS_STAGE'),
    edge('stage-2-empiric', 'step-2-3', 'HAS_STEP'),
    edge('step-2-3', 'gate-hgb-response', 'HAS_GATE'),
    edge('gate-hgb-response', 'step-2-4', 'BRANCHES_TO'),
    edge('step-2-3', 'gate-hgb-nonresponse', 'HAS_GATE'),
    edge('gate-hgb-nonresponse', 'step-2-6', 'BRANCHES_TO'),
    edge('step-2-3', 'lab-10', 'HAS_LAB_TEST'),
  ];
  if (!opts.noIronStep) {
    nodes.push(
      node('step-2-1', 'Step', { title: 'Start oral iron' }),
      node('med-1', 'Medication', { title: 'Ferrous sulfate', clinical_role: ROLE }),
    );
    edges.push(
      edge('stage-2-empiric', 'step-2-1', 'HAS_STEP'),
      edge('step-2-1', 'med-1', 'USES_MEDICATION'),
    );
  }
  if (opts.ironInMaintenance) {
    nodes.push(node('med-11', 'Medication', { title: 'Continue oral iron', clinical_role: ROLE }));
    edges.push(edge('step-2-4', 'med-11', 'USES_MEDICATION'));
  }
  return makeGraphContext(nodes, edges);
}

const confidence = jest.fn();
const mockConfidenceEngine = { computeNodeConfidence: confidence };
beforeEach(() => {
  confidence.mockReset();
  confidence.mockResolvedValue({ confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED' });
});

function hgb(labs: Array<[string, number]>): PatientContext {
  return {
    patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [],
    labResults: labs.map(([date, value]) => ({ code: '718-7', system: 'LOINC', value, date })),
  } as unknown as PatientContext;
}

/** Oral iron recommended by THIS pathway's care plan on 2026-06-01. */
function carePlanFrom(ctx: EvaluationTemporalContext, date = '2026-06-01') {
  return withTherapyStarts(ctx, [{
    clinicalRole: ROLE,
    date,
    source: { carePlanId: 'cp-1', interventionId: 'i-1', pathwayId: 'pw', nodeId: 'med-1' },
  }]);
}

function engineAt(
  asOf: string,
  pc: PatientContext,
  opts: { carePlan?: boolean } = {},
) {
  let temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: asOf, temporalPolicyVersion: 'v1' });
  if (opts.carePlan) temporalContext = carePlanFrom(temporalContext);
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
const DAY5 = '2026-06-06T15:00:00.000Z';
const DAY14 = '2026-06-15T09:00:00.000Z';
const DAY21 = '2026-06-22T15:00:00.000Z';
const BASELINE: [string, number] = ['2026-05-29', 8.2];

// ─── Grammar ──────────────────────────────────────────────────────────

describe('min_days_since_anchor grammar', () => {
  it('parses a positive integer on the selector', () => {
    expect(parseWindowFrom(ORAL_IRON, 'w').minDaysSinceAnchor).toBe(14);
    expect(parseWindowFrom({ ...ORAL_IRON, min_days_since_anchor: undefined }, 'w').minDaysSinceAnchor)
      .toBeUndefined();
  });

  it.each([0, -1, 1.5, '14', null, 40000])('refuses %p', (bad) => {
    expect(() => parseWindowFrom({ ...ORAL_IRON, min_days_since_anchor: bad }, 'w'))
      .toThrow(TemporalContextError);
    expect(() => parseWindowFrom({ ...ORAL_IRON, min_days_since_anchor: bad }, 'w'))
      .toThrow(/min_days_since_anchor/);
  });
});

// ─── The anemia response check, visit by visit ───────────────────────

describe('the start visit — the drug is recommended in this very session', () => {
  it('both gates close NOT_YET_DUE, nothing asks, and the care plan can be generated', async () => {
    const pc = hgb([BASELINE]);
    const r = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, new Map());

    expect(r.pendingQuestions).toEqual([]);
    expect(r.resolutionState.get('med-1')!.status).toBe(NodeStatus.INCLUDED);
    // The recheck step and its lab carry the plan forward.
    expect(r.resolutionState.get('step-2-3')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('lab-10')!.status).toBe(NodeStatus.INCLUDED);

    for (const gateId of ['gate-hgb-response', 'gate-hgb-nonresponse']) {
      const g = r.resolutionState.get(gateId)!;
      expect(g.status).toBe(NodeStatus.GATED_OUT);
      expect(g.notYetDue).toBe(true);
      // Not conflated with a definite "no": undecided, for a named reason.
      expect(g.indeterminate).toBe(true);
      expect(g.uncertaintyReason).toBe('NOT_YET_DUE');
      expect(g.excludeReason).toMatch(/^NOT_YET_DUE: due on\/after 2026-06-15/);
      expect(g.windowAnchors).toEqual([
        expect.objectContaining({
          key: KEY, date: '2026-06-01', source: 'SESSION_RECOMMENDATION', dueOn: '2026-06-15',
        }),
      ]);
    }
    for (const stepId of ['step-2-4', 'step-2-6']) {
      const s = r.resolutionState.get(stepId)!;
      expect(s.status).toBe(NodeStatus.GATED_OUT);
      expect(s.excludeReason).toContain('NOT_YET_DUE');
    }

    expect(validateForGeneration(r.resolutionState, r.redFlags)).toEqual([]);
  });

  it('records the medication → gate influence, so a later change to the drug re-decides the gate', async () => {
    const pc = hgb([BASELINE]);
    const r = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, new Map());
    expect([...(r.dependencyMap.influences.get('med-1') ?? [])].sort())
      .toEqual(['gate-hgb-nonresponse', 'gate-hgb-response']);
  });

  it('NOT_YET_DUE closes the gate even under default_behavior: traverse', async () => {
    const pc = hgb([BASELINE]);
    const r = await engineAt(DAY0, pc).traverse(
      anemiaShape({ gateExtra: { default_behavior: DefaultBehavior.TRAVERSE } }), pc, new Map(),
    );
    expect(r.resolutionState.get('step-2-4')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.pendingQuestions).toEqual([]);
  });

  it('a session-recommended start is never due at that visit, even without min_days_since_anchor', async () => {
    const noMin = { ...ORAL_IRON, min_days_since_anchor: undefined };
    const pc = hgb([BASELINE, ['2026-06-01', 8.3]]);
    const r = await engineAt(DAY0, pc).traverse(
      anemiaShape({ respCondition: DELTA('at_least', noMin), nonrespCondition: DELTA('less_than', noMin) }),
      pc,
      new Map(),
    );
    const g = r.resolutionState.get('gate-hgb-nonresponse')!;
    expect(g.notYetDue).toBe(true);
    expect(g.excludeReason).toMatch(/^NOT_YET_DUE: due on\/after 2026-06-02/);
    expect(r.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.pendingQuestions).toEqual([]);
  });

  it('a Medication inside the gate\'s own branch cannot anchor it — no self-anchoring', async () => {
    const pc = hgb([BASELINE]);
    const r = await engineAt(DAY0, pc).traverse(
      anemiaShape({ noIronStep: true, ironInMaintenance: true }), pc, new Map(),
    );
    // med-11 lives under gate-hgb-response; with no OTHER oral iron in the
    // session, the anchor is unresolved and the date question stands.
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({ datumKey: KEY, answerType: AnswerType.DATE });
  });

  it('the start visit reached incrementally (DP pends, clinician picks empiric iron) closes NOT_YET_DUE too', async () => {
    // step-1-7 → dp-1 ⇒ stage-2-empiric | step-1-2. Both branches score 0.85,
    // so the one_of fork pends; answering it re-disposes the chosen branch —
    // meds and gates together — in ONE incremental pass.
    const shape = anemiaShape();
    const nodes = [
      ...shape.allNodes.filter((n) => n.nodeIdentifier !== 'root'),
      node('root', 'Pathway'),
      node('step-1-7', 'Step', { title: 'Choose' }),
      node('dp-1', 'DecisionPoint', { title: 'Empiric iron vs workup', branch_mode: 'one_of' }),
      node('step-1-2', 'Step', { title: 'Confirmatory studies' }),
    ];
    const edges = [
      ...shape.allNodes.flatMap((n) => shape.outgoingEdges(n.nodeIdentifier))
        .filter((e) => e.sourceId !== 'root'),
      edge('root', 'step-1-7', 'HAS_STEP'),
      edge('step-1-7', 'dp-1', 'HAS_DECISION_POINT'),
      edge('dp-1', 'stage-2-empiric', 'BRANCHES_TO'),
      edge('dp-1', 'step-1-2', 'BRANCHES_TO'),
    ];
    const graph = makeGraphContext(nodes, edges);
    const pc = hgb([BASELINE]);
    const engine = engineAt(DAY0, pc);

    const first = await engine.traverse(graph, pc, new Map());
    expect(first.resolutionState.get('dp-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(first.pendingQuestions.map((q) => q.gateId)).toEqual(['dp-1']);

    const answers = new Map<string, GateAnswer>([['dp-1', { selectedOption: 'stage-2-empiric' }]]);
    const second = await engine.resolveIncrementally(
      new Set(['dp-1']),
      first.resolutionState,
      first.dependencyMap,
      graph,
      pc,
      answers,
      { pendingQuestions: first.pendingQuestions, redFlags: first.redFlags, alsoDropGateIds: ['dp-1'] },
    );
    const state = first.resolutionState;
    expect(second.pendingQuestions).toEqual([]);
    expect(state.get('med-1')!.status).toBe(NodeStatus.INCLUDED);
    for (const gateId of ['gate-hgb-response', 'gate-hgb-nonresponse']) {
      expect(state.get(gateId)!.status).toBe(NodeStatus.GATED_OUT);
      expect(state.get(gateId)!.notYetDue).toBe(true);
    }
    expect(validateForGeneration(state, second.redFlags)).toEqual([]);
  });
});

describe('recheck visits — anchored on the care plan the start visit wrote', () => {
  it('day 5: still not due, whatever the recheck says, and nothing asks', async () => {
    const pc = hgb([BASELINE, ['2026-06-05', 8.5]]);
    const r = await engineAt(DAY5, pc, { carePlan: true }).traverse(anemiaShape(), pc, new Map());
    // The drug is still recommended at this visit — and the anchor is still
    // the care plan's day 0, not today.
    expect(r.resolutionState.get('med-1')!.status).toBe(NodeStatus.INCLUDED);
    for (const gateId of ['gate-hgb-response', 'gate-hgb-nonresponse']) {
      const g = r.resolutionState.get(gateId)!;
      expect(g.status).toBe(NodeStatus.GATED_OUT);
      expect(g.notYetDue).toBe(true);
      expect(g.windowAnchors?.[0]).toMatchObject({ source: 'CARE_PLAN', date: '2026-06-01', dueOn: '2026-06-15' });
    }
    expect(r.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.pendingQuestions).toEqual([]);
    expect(validateForGeneration(r.resolutionState, r.redFlags)).toEqual([]);
  });

  it('day 14 exactly is due', async () => {
    // Drawn the day before: a same-day, day-precision result straddles the
    // morning clock and is (correctly) not provably inside the window.
    const pc = hgb([BASELINE, ['2026-06-14', 9.4]]);
    const r = await engineAt(DAY14, pc, { carePlan: true }).traverse(anemiaShape(), pc, new Map());
    expect(r.resolutionState.get('gate-hgb-response')!.notYetDue).toBeUndefined();
    expect(r.resolutionState.get('step-2-4')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('day 21 with +1.2 g/dL: responding — maintenance opens, nonresponse closes as a definite no', async () => {
    const pc = hgb([BASELINE, ['2026-06-20', 9.4]]);
    const r = await engineAt(DAY21, pc, { carePlan: true }).traverse(anemiaShape(), pc, new Map());
    expect(r.resolutionState.get('med-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('gate-hgb-response')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-2-4')!.status).toBe(NodeStatus.INCLUDED);
    const non = r.resolutionState.get('gate-hgb-nonresponse')!;
    expect(non.status).toBe(NodeStatus.GATED_OUT);
    expect(non.notYetDue).toBeUndefined();
    expect(non.excludeReason).not.toContain('NOT_YET_DUE');
    expect(non.windowAnchors?.[0]).toMatchObject({ source: 'CARE_PLAN', date: '2026-06-01' });
    expect(r.pendingQuestions).toEqual([]);
  });

  it('day 21 with +0.4 g/dL: not responding — nonresponse opens', async () => {
    const pc = hgb([BASELINE, ['2026-06-20', 8.6]]);
    const r = await engineAt(DAY21, pc, { carePlan: true }).traverse(anemiaShape(), pc, new Map());
    expect(r.resolutionState.get('step-2-4')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.pendingQuestions).toEqual([]);
  });

  it('day 21 with no recheck: due, so the series rule applies — ONE question for the newest Hgb', async () => {
    const pc = hgb([BASELINE]);
    const r = await engineAt(DAY21, pc, { carePlan: true }).traverse(anemiaShape(), pc, new Map());
    for (const id of ['gate-hgb-response', 'gate-hgb-nonresponse']) {
      expect(r.resolutionState.get(id)!.status).toBe(NodeStatus.PENDING_QUESTION);
      expect(r.resolutionState.get(id)!.notYetDue).toBeUndefined();
    }
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({
      datumKey: 'LOINC:718-7',
      answerType: AnswerType.NUMERIC,
      prompt: 'Hemoglobin (g/dL) (LOINC 718-7) — newest result, drawn after 2026-05-29?',
    });
  });

  it('a clinician date outranks the care plan and moves the due date', async () => {
    const pc = hgb([BASELINE, ['2026-06-20', 9.4]]);
    const answers = new Map<string, GateAnswer>([[KEY, { dateValue: '2026-06-10' }]]);
    const r = await engineAt(DAY21, pc, { carePlan: true }).traverse(anemiaShape(), pc, answers);
    const g = r.resolutionState.get('gate-hgb-response')!;
    expect(g.notYetDue).toBe(true);
    expect(g.windowAnchors?.[0]).toMatchObject({ source: 'CLINICIAN', date: '2026-06-10', dueOn: '2026-06-24' });
  });
});

describe('no anchor at all', () => {
  it('drug not recommended this session and no record: the date question, as before', async () => {
    confidence.mockImplementation(async (n: GraphNode) => ({
      confidence: n.nodeIdentifier === 'med-1' ? 0.3 : 0.85, breakdown: [],
    }));
    const pc = hgb([BASELINE, ['2026-06-20', 9.4]]);
    const r = await engineAt(DAY21, pc).traverse(anemiaShape(), pc, new Map());
    expect(r.resolutionState.get('med-1')!.status).toBe(NodeStatus.EXCLUDED);
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({
      datumKey: KEY, answerType: AnswerType.DATE, prompt: 'When did oral iron start?',
    });
    expect(r.resolutionState.get('gate-hgb-response')!.notYetDue).toBeUndefined();
  });
});

describe('NOT YET DUE inside a compound gate', () => {
  const TARGET = {
    field: 'labs', operator: 'greater_than', value: '718-7', system: 'LOINC', threshold: 10.95,
    horizon: { days: 7 }, display: 'Hemoglobin (g/dL)',
  };

  it('OR: a definite true sibling still decides (Hgb at target on day 5 → responding)', async () => {
    const pc = hgb([BASELINE, ['2026-06-05', 11.2]]);
    const graph = anemiaShape({
      respCondition: undefined,
      gateExtra: {},
    });
    const resp = graph.getNode('gate-hgb-response')!;
    Object.assign(resp.properties, {
      gate_type: GateType.COMPOUND, operator: 'OR', condition: undefined,
      conditions: [DELTA('at_least'), TARGET],
    });
    const r = await engineAt(DAY5, pc, { carePlan: true }).traverse(graph, pc, new Map());
    expect(r.resolutionState.get('gate-hgb-response')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-2-4')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('AND: not-yet-due outranks a missing sibling — it does not ask for the trimester', async () => {
    const pc = hgb([BASELINE, ['2026-06-05', 8.4]]);
    const graph = anemiaShape();
    const non = graph.getNode('gate-hgb-nonresponse')!;
    Object.assign(non.properties, {
      gate_type: GateType.COMPOUND, operator: 'AND', condition: undefined,
      conditions: [
        DELTA('less_than'),
        { attribute: 'patient.trimester', operator: 'equals', value: 2 },
      ],
    });
    const r = await engineAt(DAY5, pc, { carePlan: true }).traverse(graph, pc, new Map());
    const g = r.resolutionState.get('gate-hgb-nonresponse')!;
    expect(g.status).toBe(NodeStatus.GATED_OUT);
    expect(g.notYetDue).toBe(true);
    expect(g.excludeReason).toMatch(/^NOT_YET_DUE/);
    expect(r.pendingQuestions).toEqual([]);
  });

  it('AND: a definite false sibling decides — a plain "no", not NOT_YET_DUE', async () => {
    const pc = hgb([BASELINE, ['2026-06-05', 11.4]]);
    const graph = anemiaShape();
    const non = graph.getNode('gate-hgb-nonresponse')!;
    Object.assign(non.properties, {
      gate_type: GateType.COMPOUND, operator: 'AND', condition: undefined,
      conditions: [DELTA('less_than'), { ...TARGET, operator: 'less_than', threshold: 11 }],
    });
    const r = await engineAt(DAY5, pc, { carePlan: true }).traverse(graph, pc, new Map());
    const g = r.resolutionState.get('gate-hgb-nonresponse')!;
    expect(g.status).toBe(NodeStatus.GATED_OUT);
    expect(g.notYetDue).toBeUndefined();
  });
});

describe('NOT YET DUE crosses the GraphQL boundary', () => {
  const SDL = readFileSync(join(__dirname, '../../schema.graphql'), 'utf-8');
  it('ResolvedNode.notYetDue and WindowAnchor.dueOn are in the schema', () => {
    expect(SDL.match(/type ResolvedNode \{[\s\S]*?\n\}/)![0]).toMatch(/\n  notYetDue: Boolean\n/);
    expect(SDL.match(/type WindowAnchor \{[\s\S]*?\n\}/)![0]).toMatch(/\n  dueOn: String\n/);
  });
});

// ─── A recheck with nothing stored: ask, never assume a start ───────

/**
 * Decision 2026-09-24: a nonresponder must not be silently missed. The pathway
 * recommends oral iron at every visit that reaches the recheck step, so a
 * recheck with no care plan, no dated order and no clinician date used to
 * anchor on "this visit" and close NOT_YET_DUE — asking nothing. Now, when the
 * chart says the course is already under way (an Hgb old enough that the
 * check would be due had iron started that day, or an order of the class with
 * no usable date), the anchor is UNRESOLVED and the gate asks for the date.
 */
describe('a recheck with no stored start asks for the date instead of closing NOT_YET_DUE', () => {
  function patient(opts: {
    labs?: Array<[string, number]>;
    medications?: Array<Record<string, unknown>>;
  }): PatientContext {
    return { ...hgb(opts.labs ?? []), medications: opts.medications ?? [] } as PatientContext;
  }
  const RESPONSE_GATES = ['gate-hgb-response', 'gate-hgb-nonresponse'];

  function expectDateQuestion(r: Awaited<ReturnType<TraversalEngine['traverse']>>) {
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({
      datumKey: KEY, answerType: AnswerType.DATE, prompt: 'When did oral iron start?',
    });
    for (const id of RESPONSE_GATES) {
      const g = r.resolutionState.get(id)!;
      expect(g.status).toBe(NodeStatus.PENDING_QUESTION);
      expect(g.notYetDue).toBeUndefined();
    }
    // The drug is still recommended at this visit.
    expect(r.resolutionState.get('med-1')!.status).toBe(NodeStatus.INCLUDED);
  }

  it('start visit with no prior Hgb: NOT_YET_DUE, nothing asked, generation not blocked', async () => {
    const pc = patient({});
    const r = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, new Map());
    expect(r.pendingQuestions).toEqual([]);
    for (const id of RESPONSE_GATES) {
      const g = r.resolutionState.get(id)!;
      expect(g.status).toBe(NodeStatus.GATED_OUT);
      expect(g.notYetDue).toBe(true);
      expect(g.windowAnchors?.[0]).toMatchObject({ source: 'SESSION_RECOMMENDATION', date: '2026-06-01' });
    }
    expect(validateForGeneration(r.resolutionState, r.redFlags)).toEqual([]);
  });

  it('start visit whose diagnostic Hgb is 3 days old: still a start visit, nothing asked', async () => {
    const pc = patient({ labs: [BASELINE] });
    const r = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, new Map());
    expect(r.pendingQuestions).toEqual([]);
    expect(r.resolutionState.get('gate-hgb-nonresponse')!.notYetDue).toBe(true);
  });

  it('day-21 recheck, Hgb dated 21 days earlier, no anchor source: asks "When did oral iron start?"', async () => {
    const pc = patient({ labs: [['2026-06-01', 8.2], ['2026-06-20', 8.6]] });
    const r = await engineAt(DAY21, pc).traverse(anemiaShape(), pc, new Map());
    expectDateQuestion(r);
    const g = r.resolutionState.get('gate-hgb-nonresponse')!;
    expect(g.windowAnchors ?? []).toEqual([]);
    expect(g.uncertaintyReason).toBe('ANCHOR_UNRESOLVED');
    // Neither response branch is opened on a guess.
    expect(r.resolutionState.get('step-2-4')!.status).not.toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-2-6')!.status).not.toBe(NodeStatus.INCLUDED);
    // The medication → gate influence is kept: a change to the drug re-decides the gate.
    expect([...(r.dependencyMap.influences.get('med-1') ?? [])].sort()).toEqual([...RESPONSE_GATES].sort());
    // The audit trail says why this visit was not read as the start.
    expect(g.excludeReason).toMatch(/oral iron is recommended at this visit, but the chart holds a LOINC 718-7 result from 2026-06-01, at least 14 days before this visit/);
  });

  it('the same recheck with the old Hgb alone (not yet rechecked) asks for the date first', async () => {
    const pc = patient({ labs: [['2026-06-01', 8.2]] });
    const r = await engineAt(DAY21, pc).traverse(anemiaShape(), pc, new Map());
    expectDateQuestion(r);
  });

  it('…answered with a clinician date 21 days ago and +0.4 g/dL: not responding', async () => {
    const pc = patient({ labs: [['2026-06-01', 8.2], ['2026-06-20', 8.6]] });
    const answers = new Map<string, GateAnswer>([[KEY, { dateValue: '2026-06-01' }]]);
    const r = await engineAt(DAY21, pc).traverse(anemiaShape(), pc, answers);
    expect(r.pendingQuestions).toEqual([]);
    expect(r.resolutionState.get('gate-hgb-nonresponse')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-2-4')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.resolutionState.get('gate-hgb-nonresponse')!.windowAnchors?.[0])
      .toMatchObject({ source: 'CLINICIAN', date: '2026-06-01', dueOn: '2026-06-15' });
    expect(validateForGeneration(r.resolutionState, r.redFlags)).toEqual([]);
  });

  it('…answered incrementally, lands where a full traversal with the date lands', async () => {
    const pc = patient({ labs: [['2026-06-01', 8.2], ['2026-06-20', 8.6]] });
    const graph = anemiaShape();
    const engine = engineAt(DAY21, pc);
    const first = await engine.traverse(graph, pc, new Map());
    expectDateQuestion(first);

    // As `answerPendingDecision` does for an anchor answer: stored under the
    // ANCHOR key, the asking gates re-disposed.
    const q = first.pendingQuestions[0];
    const answers = new Map<string, GateAnswer>([[KEY, { dateValue: '2026-06-01' }]]);
    const roots = new Set([q.gateId, ...(q.askedByNodeIds ?? [])]);
    const second = await engine.resolveIncrementally(
      roots, first.resolutionState, first.dependencyMap, graph, pc, answers,
      { pendingQuestions: first.pendingQuestions, redFlags: first.redFlags, alsoDropGateIds: [...roots] },
    );
    const full = await engineAt(DAY21, pc).traverse(graph, pc, new Map(answers));
    expect(second.pendingQuestions).toEqual([]);
    for (const id of new Set([...first.resolutionState.keys(), ...full.resolutionState.keys()])) {
      expect([id, first.resolutionState.get(id)?.status]).toEqual([id, full.resolutionState.get(id)?.status]);
    }
    expect(first.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('with a stored care plan: anchored on it, nothing asked', async () => {
    const pc = patient({ labs: [['2026-06-01', 8.2], ['2026-06-20', 8.6]] });
    const r = await engineAt(DAY21, pc, { carePlan: true }).traverse(anemiaShape(), pc, new Map());
    expect(r.pendingQuestions).toEqual([]);
    expect(r.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('gate-hgb-nonresponse')!.windowAnchors?.[0])
      .toMatchObject({ source: 'CARE_PLAN' });
  });

  it('with a dated order of the class: anchored on it, nothing asked', async () => {
    const pc = patient({
      labs: [['2026-06-01', 8.2], ['2026-06-20', 8.6]],
      medications: [{ system: 'RXNORM', code: 'RX-FE-SULFATE', date: '2026-06-01' }],
    });
    const r = await engineAt(DAY21, pc).traverse(anemiaShape(), pc, new Map());
    expect(r.pendingQuestions).toEqual([]);
    expect(r.resolutionState.get('gate-hgb-nonresponse')!.windowAnchors?.[0])
      .toMatchObject({ source: 'MEDICATION_ORDER', date: '2026-06-01' });
  });

  it.each([
    ['undated', {}],
    ['month-precision', { date: '2026-05' }],
  ])('an order of the class with an %s start: on it since an unknown date — asks', async (_, extra) => {
    const pc = patient({
      labs: [BASELINE],
      medications: [{ system: 'RXNORM', code: 'RX-FE-SULFATE', ...extra }],
    });
    // Day 0 and a 3-day-old Hgb: only the order says the course is under way.
    const r = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, new Map());
    expectDateQuestion(r);
  });

  it('boundary is the due rule: an Hgb exactly min_days old asks, one day younger does not', async () => {
    // DAY14 is 2026-06-15; 2026-06-01 + 14 days is due on 2026-06-15.
    const due = patient({ labs: [['2026-06-01', 8.2]] });
    expectDateQuestion(await engineAt(DAY14, due).traverse(anemiaShape(), due, new Map()));

    const young = patient({ labs: [['2026-06-02', 8.2]] });
    const r = await engineAt(DAY14, young).traverse(anemiaShape(), young, new Map());
    expect(r.pendingQuestions).toEqual([]);
    expect(r.resolutionState.get('gate-hgb-nonresponse')!.notYetDue).toBe(true);
    expect(r.resolutionState.get('gate-hgb-nonresponse')!.windowAnchors?.[0])
      .toMatchObject({ source: 'SESSION_RECOMMENDATION' });
  });

  it('the known cost: a start visit with an older routine Hgb is asked; today\'s date closes it NOT_YET_DUE', async () => {
    const pc = patient({ labs: [['2026-02-10', 12.4], BASELINE] });
    const first = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, new Map());
    expectDateQuestion(first);

    const answers = new Map<string, GateAnswer>([[KEY, { dateValue: '2026-06-01' }]]);
    const r = await engineAt(DAY0, pc).traverse(anemiaShape(), pc, answers);
    expect(r.pendingQuestions).toEqual([]);
    for (const id of RESPONSE_GATES) {
      const g = r.resolutionState.get(id)!;
      expect(g.status).toBe(NodeStatus.GATED_OUT);
      expect(g.notYetDue).toBe(true);
      expect(g.windowAnchors?.[0]).toMatchObject({ source: 'CLINICIAN', date: '2026-06-01', dueOn: '2026-06-15' });
    }
    expect(validateForGeneration(r.resolutionState, r.redFlags)).toEqual([]);
  });

  it('without min_days_since_anchor an old Hgb is not evidence — the start-visit reading stands', async () => {
    const noMin = { ...ORAL_IRON, min_days_since_anchor: undefined };
    const pc = patient({ labs: [['2026-03-01', 11.9], BASELINE] });
    const r = await engineAt(DAY0, pc).traverse(
      anemiaShape({ respCondition: DELTA('at_least', noMin), nonrespCondition: DELTA('less_than', noMin) }),
      pc,
      new Map(),
    );
    expect(r.pendingQuestions).toEqual([]);
    expect(r.resolutionState.get('gate-hgb-nonresponse')!.notYetDue).toBe(true);
  });

  it('on_unresolved: default takes default_behavior instead of asking', async () => {
    const pc = patient({ labs: [['2026-06-01', 8.2], ['2026-06-20', 8.6]] });
    const r = await engineAt(DAY21, pc).traverse(
      anemiaShape({ gateExtra: { on_unresolved: 'default' } }), pc, new Map(),
    );
    expect(r.pendingQuestions).toEqual([]);
    for (const id of RESPONSE_GATES) {
      expect(r.resolutionState.get(id)!.notYetDue).toBeUndefined();
      expect(r.resolutionState.get(id)!.status).not.toBe(NodeStatus.PENDING_QUESTION);
    }
  });

  describe('inside a compound gate', () => {
    const TARGET = {
      field: 'labs', operator: 'greater_than', value: '718-7', system: 'LOINC', threshold: 10.95,
      horizon: { days: 7 }, display: 'Hemoglobin (g/dL)',
    };
    function compound(graph: ReturnType<typeof anemiaShape>, id: string, op: 'AND' | 'OR', conditions: unknown[]) {
      Object.assign(graph.getNode(id)!.properties, {
        gate_type: GateType.COMPOUND, operator: op, condition: undefined, conditions,
      });
    }

    it('OR: Hgb at target settles "responding" — the unresolved anchor is not asked', async () => {
      const pc = patient({ labs: [['2026-06-01', 8.2], ['2026-06-20', 11.2]] });
      const graph = anemiaShape();
      compound(graph, 'gate-hgb-response', 'OR', [DELTA('at_least'), TARGET]);
      compound(graph, 'gate-hgb-nonresponse', 'AND', [DELTA('less_than'), { ...TARGET, operator: 'less_than', threshold: 11 }]);
      const r = await engineAt(DAY21, pc).traverse(graph, pc, new Map());
      expect(r.resolutionState.get('gate-hgb-response')!.status).toBe(NodeStatus.INCLUDED);
      expect(r.resolutionState.get('gate-hgb-nonresponse')!.status).toBe(NodeStatus.GATED_OUT);
      expect(r.pendingQuestions).toEqual([]);
    });

    it('nested groups: below target and no anchor — ONE date question for both gates', async () => {
      const pc = patient({ labs: [['2026-06-01', 8.2], ['2026-06-20', 8.6]] });
      const graph = anemiaShape();
      compound(graph, 'gate-hgb-response', 'OR', [{ operator: 'AND', conditions: [DELTA('at_least')] }, TARGET]);
      compound(graph, 'gate-hgb-nonresponse', 'AND', [
        { operator: 'OR', conditions: [DELTA('less_than')] },
        { ...TARGET, operator: 'less_than', threshold: 11 },
      ]);
      const r = await engineAt(DAY21, pc).traverse(graph, pc, new Map());
      expectDateQuestion(r);
    });
  });
});
