/**
 * An unresolved `window_from` anchor PENDS with a DATE question, and the
 * clinician's date — asked for or volunteered — re-anchors every gate on the
 * class.
 *
 * Pinned to `v1` with an assembled fact store: anchors resolve only on the
 * kernel path.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { withTherapyStarts } from '../services/resolution/temporal/anchored-window';
import { planAnchorAnswer } from '../services/resolution/anchor-answer';
import { validateAnswerAgainstGate } from '../services/resolution/answer-validation';
import {
  NodeStatus,
  AnswerType,
  DefaultBehavior,
  GateType,
  GateAnswer,
  GateProperties,
} from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSchema, graphql } from 'graphql';
import { normalizeAnswerType } from '../services/resolution/answer-validation';

const AS_OF = '2026-09-01T12:00:00.000Z';
const KEY = 'anchor:medication_start:oral-iron-repletion';

const ORAL_IRON = {
  event: 'medication_start',
  clinical_role: 'oral-iron-repletion',
  label: 'oral iron',
  codes: [{ system: 'RXNORM', code: 'RX-FE-SULFATE' }],
};

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED',
  }),
};

const RESPONDER: PatientContext = {
  patientId: 'pt-1',
  conditionCodes: [],
  medications: [],
  allergies: [],
  labResults: [
    { code: '718-7', system: 'LOINC', value: 12.8, date: '2026-03-01' },
    { code: '718-7', system: 'LOINC', value: 8.2, date: '2026-06-01' },
    { code: '718-7', system: 'LOINC', value: 9.0, date: '2026-07-01' },
    { code: '718-7', system: 'LOINC', value: 9.9, date: '2026-08-15' },
  ],
} as unknown as PatientContext;

function engineFor(patientContext: PatientContext) {
  const temporalContext = makeEvaluationTemporalContext({
    evaluationAsOf: AS_OF,
    temporalPolicyVersion: 'v1',
  });
  const factStore = assembleContext({ mode: 'SYNTHETIC', patientContext } as never, temporalContext);
  return new TraversalEngine(
    mockConfidenceEngine as never,
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    temporalContext,
    {},
    factStore,
    new Map(),
  );
}

function responseGate(extra: Record<string, unknown> = {}) {
  return {
    title: 'Responding to oral iron?',
    gate_type: GateType.COMPOUND,
    default_behavior: DefaultBehavior.SKIP,
    on_unresolved: 'ask',
    operator: 'OR',
    conditions: [
      { field: 'labs', operator: 'greater_than', value: '718-7', system: 'LOINC', threshold: 10.9, horizon: { days: 90 } },
      {
        field: 'labs', operator: 'trend_up', value: '718-7', system: 'LOINC',
        slope_threshold: 0.015, min_points: 2, window_from: ORAL_IRON,
      },
    ],
    ...extra,
  };
}

/** root → gate-a → step-a, root → gate-b → step-b: two gates on the same class. */
function twoGates(extraA: Record<string, unknown> = {}) {
  const nodes = [
    node('root', 'Pathway'),
    node('gate-a', 'Gate', responseGate(extraA)),
    node('step-a', 'Step', { title: 'Continue oral iron' }),
    node('gate-b', 'Gate', responseGate({ title: 'Responding (second gate)?' })),
    node('step-b', 'Step', { title: 'Recheck in 4 weeks' }),
  ];
  const edges = [
    edge('root', 'gate-a', 'HAS_GATE'),
    edge('gate-a', 'step-a', 'BRANCHES_TO'),
    edge('root', 'gate-b', 'HAS_GATE'),
    edge('gate-b', 'step-b', 'BRANCHES_TO'),
  ];
  return makeGraphContext(nodes, edges);
}

beforeEach(() => {
  mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
    confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED',
  });
});

describe('an unresolved anchor pends with a DATE question', () => {
  it('holds the gate and asks once, for the start date, on behalf of every gate on the class', async () => {
    const result = await engineFor(RESPONDER).traverse(twoGates(), RESPONDER, new Map());

    expect(result.resolutionState.get('gate-a')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(result.resolutionState.get('step-a')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(result.resolutionState.get('gate-a')!.indeterminate).toBe(true);

    expect(result.pendingQuestions).toHaveLength(1);
    const q = result.pendingQuestions[0];
    expect(q).toMatchObject({
      gateId: 'gate-a',
      askedByNodeIds: ['gate-a', 'gate-b'],
      datumKey: KEY,
      prompt: 'When did oral iron start?',
      answerType: AnswerType.DATE,
      askTarget: { kind: 'anchor', key: KEY },
    });
  });

  it('takes default_behavior instead when the author set on_unresolved: default', async () => {
    const graph = makeGraphContext(
      [node('root', 'Pathway'), node('gate-a', 'Gate', responseGate({ on_unresolved: 'default' })), node('step-a', 'Step')],
      [edge('root', 'gate-a', 'HAS_GATE'), edge('gate-a', 'step-a', 'BRANCHES_TO')],
    );
    const result = await engineFor(RESPONDER).traverse(graph, RESPONDER, new Map());
    expect(result.pendingQuestions).toEqual([]);
    expect(result.resolutionState.get('gate-a')!.status).toBe(NodeStatus.GATED_OUT);
  });

  it('asks nothing when the definite sibling decides the gate', async () => {
    const atTarget = {
      ...RESPONDER,
      labResults: [{ code: '718-7', system: 'LOINC', value: 11.5, date: '2026-08-20' }],
    } as unknown as PatientContext;
    const result = await engineFor(atTarget).traverse(twoGates(), atTarget, new Map());
    expect(result.pendingQuestions).toEqual([]);
    expect(result.resolutionState.get('gate-a')!.status).toBe(NodeStatus.INCLUDED);
  });
});

describe('the clinician date resolves it', () => {
  it('a stored anchor date opens both gates and records where the window opened', async () => {
    const answers = new Map<string, GateAnswer>([[KEY, { dateValue: '2026-06-01' }]]);
    const result = await engineFor(RESPONDER).traverse(twoGates(), RESPONDER, answers);

    expect(result.pendingQuestions).toEqual([]);
    for (const id of ['gate-a', 'gate-b', 'step-a', 'step-b']) {
      expect(result.resolutionState.get(id)!.status).toBe(NodeStatus.INCLUDED);
    }
    expect(result.resolutionState.get('gate-a')!.windowAnchors).toEqual([
      expect.objectContaining({ key: KEY, date: '2026-06-01', source: 'CLINICIAN' }),
    ]);
  });

  it('answering the pending question re-anchors every asking gate', async () => {
    const engine = engineFor(RESPONDER);
    const graph = twoGates();
    const first = await engine.traverse(graph, RESPONDER, new Map());

    const plan = planAnchorAnswer({
      nodeId: 'gate-a',
      answer: { dateValue: '2026-06-01' },
      pendingQuestions: first.pendingQuestions,
      nodeProperties: graph.getNode('gate-a')?.properties as Record<string, unknown> | undefined,
      evaluationAsOf: AS_OF,
    });
    expect(plan).toMatchObject({ kind: 'anchor', key: KEY, dateValue: '2026-06-01' });

    // What answerPendingDecision does with the plan: store under the ANCHOR
    // key and re-evaluate.
    const answers = new Map<string, GateAnswer>([[KEY, { dateValue: '2026-06-01' }]]);
    const second = await engineFor(RESPONDER).traverse(graph, RESPONDER, answers);
    expect(second.pendingQuestions).toEqual([]);
    expect(second.resolutionState.get('gate-b')!.status).toBe(NodeStatus.INCLUDED);
    expect(second.resolutionState.get('step-a')!.status).toBe(NodeStatus.INCLUDED);
    // Never written under a gate id.
    expect(answers.has('gate-a')).toBe(false);
  });

  it('a care-plan anchor pinned on the session context is used without asking', async () => {
    const temporalContext = withTherapyStarts(
      makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' }),
      [{
        clinicalRole: 'oral-iron-repletion',
        date: '2026-06-01',
        source: { carePlanId: 'cp-1', interventionId: 'i-1', pathwayId: 'pw', nodeId: 'med-2' },
      }],
    );
    const engine = new TraversalEngine(
      mockConfidenceEngine as never,
      { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
      temporalContext,
      {},
      assembleContext({ mode: 'SYNTHETIC', patientContext: RESPONDER } as never, temporalContext),
      new Map(),
    );
    const result = await engine.traverse(twoGates(), RESPONDER, new Map());
    expect(result.pendingQuestions).toEqual([]);
    expect(result.resolutionState.get('gate-a')!.windowAnchors?.[0]).toMatchObject({
      source: 'CARE_PLAN', date: '2026-06-01',
    });
  });
});

// ─── Three outcomes from chart data (the anemia response check) ──────

const DELTA_COND = (comparison: 'at_least' | 'less_than') => ({
  field: 'labs', operator: 'delta_from_baseline', value: '718-7', system: 'LOINC',
  display: 'Hemoglobin (g/dL)', delta_threshold: 1.0, delta_comparison: comparison, min_points: 2,
  window_from: { ...ORAL_IRON, baseline_days: 28 },
});

/** step-2-3 → gate-hgb-response → step-2-4; step-2-3 → gate-hgb-nonresponse → step-2-6. */
function responseAndNonresponse() {
  return makeGraphContext(
    [
      node('root', 'Pathway'),
      node('step-2-3', 'Step', { title: 'Response assessment' }),
      node('gate-hgb-response', 'Gate', {
        title: 'Responding to oral iron', gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP, on_unresolved: 'ask', condition: DELTA_COND('at_least'),
      }),
      node('step-2-4', 'Step', { title: 'Maintenance & surveillance' }),
      node('gate-hgb-nonresponse', 'Gate', {
        title: 'Not responding to oral iron', gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP, on_unresolved: 'ask', condition: DELTA_COND('less_than'),
      }),
      node('step-2-6', 'Step', { title: 'Nonresponse management' }),
    ],
    [
      edge('root', 'step-2-3', 'HAS_STEP'),
      edge('step-2-3', 'gate-hgb-response', 'HAS_GATE'),
      edge('gate-hgb-response', 'step-2-4', 'BRANCHES_TO'),
      edge('step-2-3', 'gate-hgb-nonresponse', 'HAS_GATE'),
      edge('gate-hgb-nonresponse', 'step-2-6', 'BRANCHES_TO'),
    ],
  );
}

function hgbPatient(labs: Array<[string, number]>): PatientContext {
  return {
    patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [],
    labResults: labs.map(([date, value]) => ({ code: '718-7', system: 'LOINC', value, date })),
  } as unknown as PatientContext;
}

describe('response check: responding / not responding / not yet rechecked', () => {
  const started = new Map<string, GateAnswer>([[KEY, { dateValue: '2026-06-01' }]]);

  it('responding: rise ≥ 1 since the start (from the pre-treatment baseline) → maintenance only', async () => {
    const pc = hgbPatient([['2026-05-29', 8.2], ['2026-06-26', 9.3]]);
    const r = await engineFor(pc).traverse(responseAndNonresponse(), pc, started);
    expect(r.resolutionState.get('step-2-4')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.pendingQuestions).toEqual([]);
  });

  it('not responding: rise < 1 with enough data → nonresponse management only', async () => {
    const pc = hgbPatient([['2026-05-29', 8.2], ['2026-06-26', 8.6]]);
    const r = await engineFor(pc).traverse(responseAndNonresponse(), pc, started);
    expect(r.resolutionState.get('step-2-4')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.resolutionState.get('step-2-6')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.pendingQuestions).toEqual([]);
  });

  it('not yet rechecked: only the baseline → BOTH held, ONE question for a newer Hgb', async () => {
    const pc = hgbPatient([['2026-05-29', 8.2]]);
    const r = await engineFor(pc).traverse(responseAndNonresponse(), pc, started);
    for (const id of ['gate-hgb-response', 'step-2-4', 'gate-hgb-nonresponse', 'step-2-6']) {
      expect(r.resolutionState.get(id)!.status).toBe(NodeStatus.PENDING_QUESTION);
    }
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({
      datumKey: 'LOINC:718-7',
      answerType: AnswerType.NUMERIC,
      prompt: 'Hemoglobin (g/dL) (LOINC 718-7) — newest result, drawn after 2026-05-29?',
      askTarget: { kind: 'lab', code: '718-7', system: 'LOINC' },
      askedByNodeIds: ['gate-hgb-response', 'gate-hgb-nonresponse'],
    });
  });

  it('no start date yet: both held on ONE date question', async () => {
    const pc = hgbPatient([['2026-05-29', 8.2], ['2026-06-26', 9.3]]);
    const r = await engineFor(pc).traverse(responseAndNonresponse(), pc, new Map());
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0]).toMatchObject({ datumKey: KEY, answerType: AnswerType.DATE });
  });

  it('on_unresolved: default keeps the pre-change outcome — the gate takes default_behavior, nothing is asked', async () => {
    const pc = hgbPatient([['2026-05-29', 8.2]]);
    const graph = makeGraphContext(
      [
        node('root', 'Pathway'),
        node('g', 'Gate', {
          gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
          on_unresolved: 'default', condition: DELTA_COND('at_least'),
        }),
        node('s', 'Step'),
      ],
      [edge('root', 'g', 'HAS_GATE'), edge('g', 's', 'BRANCHES_TO')],
    );
    const r = await engineFor(pc).traverse(graph, pc, started);
    expect(r.pendingQuestions).toEqual([]);
    expect(r.resolutionState.get('g')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.resolutionState.get('s')!.status).toBe(NodeStatus.GATED_OUT);
  });
});

describe('planAnchorAnswer', () => {
  async function pendingSession() {
    const graph = twoGates();
    const first = await engineFor(RESPONDER).traverse(graph, RESPONDER, new Map());
    return { graph, first };
  }

  it('lets the clinician EDIT a resolved anchor with a dateValue on the gate', async () => {
    const graph = twoGates();
    const answers = new Map<string, GateAnswer>([[KEY, { dateValue: '2026-06-01' }]]);
    const resolved = await engineFor(RESPONDER).traverse(graph, RESPONDER, answers);
    expect(resolved.pendingQuestions).toEqual([]);

    const plan = planAnchorAnswer({
      nodeId: 'gate-b',
      answer: { dateValue: '2026-06-10' },
      pendingQuestions: resolved.pendingQuestions,
      nodeProperties: graph.getNode('gate-b')?.properties as Record<string, unknown> | undefined,
      evaluationAsOf: AS_OF,
    });
    expect(plan).toMatchObject({ kind: 'anchor', key: KEY, dateValue: '2026-06-10' });
  });

  it.each<[string, Partial<GateAnswer>, string]>([
    ['a date after the session clock', { dateValue: '2026-09-02' }, "after this session's evaluation date"],
    ['a non-calendar date', { dateValue: '2026-06' }, 'must be a calendar date'],
    ['a date plus another value', { dateValue: '2026-06-01', booleanValue: true }, 'dateValue alone'],
    ['a number instead of a date', { numericValue: 3 }, 'dateValue alone; got numericValue'],
  ])('refuses %s', async (_label, answer, fragment) => {
    const { graph, first } = await pendingSession();
    const plan = planAnchorAnswer({
      nodeId: 'gate-a',
      answer,
      pendingQuestions: first.pendingQuestions,
      nodeProperties: graph.getNode('gate-a')?.properties as Record<string, unknown> | undefined,
      evaluationAsOf: AS_OF,
    });
    expect(plan.kind).toBe('problem');
    expect(plan.kind === 'problem' && plan.message).toContain(fragment);
  });

  it('refuses a dateValue on a gate with no window_from, and ignores ordinary answers', () => {
    const graph = makeGraphContext(
      [node('q', 'Gate', { gate_type: 'question', prompt: 'Pregnant?', answer_type: 'boolean' })],
      [],
    );
    const common = {
      nodeId: 'q', pendingQuestions: [], nodeProperties: graph.getNode('q')?.properties as Record<string, unknown> | undefined, evaluationAsOf: AS_OF,
    };
    const dated = planAnchorAnswer({ ...common, answer: { dateValue: '2026-06-01' } });
    expect(dated.kind === 'problem' && dated.message).toContain('has no window_from condition');
    expect(planAnchorAnswer({ ...common, answer: { booleanValue: true } })).toEqual({ kind: 'none' });
  });

  it('the gate-schema check refuses a stray dateValue', () => {
    const gate = { gate_type: 'question', answer_type: 'boolean' } as unknown as GateProperties;
    expect(validateAnswerAgainstGate({ dateValue: '2026-06-01' }, gate)).toContain(
      'dateValue answers only a treatment start-date question',
    );
    const untyped = { gate_type: 'question' } as unknown as GateProperties;
    expect(validateAnswerAgainstGate({ dateValue: '2026-06-01' }, untyped)).not.toBeNull();
  });
});

describe('the DATE answer type crosses the GraphQL boundary', () => {
  const SDL = readFileSync(join(__dirname, '../../schema.graphql'), 'utf-8');

  it('the AnswerType enum serializes DATE, and a stored DATE survives normalisation', async () => {
    const enumSdl = SDL.match(/enum AnswerType \{[^}]*\}/)![0];
    const probe = buildSchema(`${enumSdl}\ntype Query { answerType: AnswerType }`);
    const result = await graphql({ schema: probe, source: '{ answerType }', rootValue: { answerType: 'DATE' } });
    expect(result.errors).toBeUndefined();
    expect(normalizeAnswerType('DATE')).toBe(AnswerType.DATE);
    // Not the BOOLEAN fallback an unknown value gets — which would render a
    // start-date question as a yes/no.
    expect(normalizeAnswerType('date')).toBe(AnswerType.DATE);
  });

  it('GateAnswerInput accepts dateValue', () => {
    expect(SDL.match(/input GateAnswerInput \{[\s\S]*?\n\}/)![0]).toMatch(/\n  dateValue: String\n/);
  });
});
