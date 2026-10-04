/**
 * `count_comparison: "less_than"` — "fewer than N results since treatment
 * started".
 *
 * Josh, 2026-10-04: a patient a month into oral iron with no hemoglobin drawn
 * since it started was ASKED for a newer hemoglobin; the pathway should
 * instead conclude "response not yet checked" and order the recheck. That
 * state — zero results in the anchored window, once due — had no encoding:
 * `count_in_window` could only say "at least N".
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { conditionControlDomainError } from '../services/resolution/temporal/condition-adapter';
import { NodeStatus, DefaultBehavior, GateType, GateAnswer } from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const KEY = 'anchor:medication_start:oral-iron-repletion';
const WINDOW = {
  event: 'medication_start', clinical_role: 'oral-iron-repletion', label: 'oral iron',
  codes: [{ system: 'RXNORM', code: '198630' }], min_days_since_anchor: 14,
};
const COUNT = (comparison?: 'at_least' | 'less_than') => ({
  field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC',
  count_threshold: 1, ...(comparison ? { count_comparison: comparison } : {}),
  window_from: WINDOW,
});

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType: string): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}
const gate = (id: string, condition: Record<string, unknown>) => node(id, 'Gate', {
  gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
  on_unresolved: 'ask', condition,
});

const graph = (extra: { nodes: GraphNode[]; edges: GraphEdge[] } = { nodes: [], edges: [] }) => makeGraphContext(
  [
    node('root', 'Pathway'),
    node('stage', 'Stage'),
    node('step-on-iron', 'Step'),
    gate('gate-not-rechecked', COUNT('less_than')),
    node('step-recheck', 'Step'),
    node('lab-recheck', 'LabTest'),
    gate('gate-rechecked', COUNT('at_least')),
    node('step-assess', 'Step'),
    ...extra.nodes,
  ],
  [
    edge('root', 'stage', 'HAS_STAGE'),
    edge('stage', 'step-on-iron', 'HAS_STEP'),
    edge('step-on-iron', 'gate-not-rechecked', 'HAS_GATE'),
    edge('gate-not-rechecked', 'step-recheck', 'BRANCHES_TO'),
    edge('step-recheck', 'lab-recheck', 'HAS_LAB_TEST'),
    edge('step-on-iron', 'gate-rechecked', 'HAS_GATE'),
    edge('gate-rechecked', 'step-assess', 'BRANCHES_TO'),
    ...extra.edges,
  ],
);

const confidence = { computeNodeConfidence: jest.fn().mockResolvedValue({ confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED' }) };

function run(asOf: string, labs: Array<[string, number]>, started?: string, g = graph()) {
  const pc = {
    patientId: 'pt-1', conditionCodes: [], allergies: [],
    medications: [{ code: '198630', system: 'RXNORM' }],
    labResults: labs.map(([date, value]) => ({ code: '718-7', system: 'LOINC', value, date })),
  } as unknown as PatientContext;
  const temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: asOf, temporalPolicyVersion: 'v1' });
  const factStore = assembleContext({ mode: 'SYNTHETIC', patientContext: pc } as never, temporalContext);
  const answers = new Map<string, GateAnswer>();
  if (started) answers.set(KEY, { dateValue: started } as GateAnswer);
  return new TraversalEngine(
    confidence as never, { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    temporalContext, {}, factStore, new Map(),
  ).traverse(g, pc, answers);
}

const status = (r: Awaited<ReturnType<typeof run>>, id: string) => r.resolutionState.get(id)?.status;

describe('count_comparison: less_than on an anchored window', () => {
  it('a month into oral iron with only the pre-iron hemoglobin: the recheck opens and nothing is asked', async () => {
    const r = await run('2026-10-04T13:00:00.000Z', [['2026-09-01', 8]], '2026-09-03');
    expect(r.pendingQuestions).toEqual([]);
    expect(status(r, 'gate-not-rechecked')).toBe(NodeStatus.INCLUDED);
    expect(status(r, 'lab-recheck')).toBe(NodeStatus.INCLUDED);
    expect(status(r, 'gate-rechecked')).toBe(NodeStatus.GATED_OUT);
    expect(status(r, 'step-assess')).not.toBe(NodeStatus.INCLUDED);
  });

  it('a hemoglobin drawn since the start: the recheck closes and the assessment opens', async () => {
    const r = await run('2026-10-04T13:00:00.000Z', [['2026-09-01', 8], ['2026-09-28', 9.4]], '2026-09-03');
    expect(r.pendingQuestions).toEqual([]);
    expect(status(r, 'gate-not-rechecked')).toBe(NodeStatus.GATED_OUT);
    expect(status(r, 'gate-rechecked')).toBe(NodeStatus.INCLUDED);
    expect(status(r, 'step-assess')).toBe(NodeStatus.INCLUDED);
  });

  it('before day 14 neither opens: not yet due is not "not rechecked"', async () => {
    const r = await run('2026-09-10T13:00:00.000Z', [['2026-09-01', 8]], '2026-09-03');
    expect(r.pendingQuestions).toEqual([]);
    for (const id of ['gate-not-rechecked', 'gate-rechecked']) {
      expect(status(r, id)).toBe(NodeStatus.GATED_OUT);
      expect(r.resolutionState.get(id)!.notYetDue).toBe(true);
    }
  });

  it('with no start date it asks when oral iron started — once — and not for a hemoglobin', async () => {
    const r = await run('2026-10-04T13:00:00.000Z', [['2026-09-01', 8]]);
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0].prompt).toMatch(/When did oral iron start/);
  });
});

describe('baseline_days on an anchored count — "the rise cannot be measured yet"', () => {
  // Fewer than 2 of { the latest value up to 28 d before the start, every value since }.
  const UNMEASURABLE = { ...COUNT('less_than'), count_threshold: 2, window_from: { ...WINDOW, baseline_days: 28 } };
  const g = () => graph({
    nodes: [gate('gate-unmeasurable', UNMEASURABLE), node('step-recheck-later', 'Step')],
    edges: [
      edge('step-on-iron', 'gate-unmeasurable', 'HAS_GATE'),
      edge('gate-unmeasurable', 'step-recheck-later', 'BRANCHES_TO'),
    ],
  });

  it('one hemoglobin since the start and no baseline: unmeasurable', async () => {
    const r = await run('2026-10-04T13:00:00.000Z', [['2026-10-04', 9]], '2026-09-03', g());
    expect(r.pendingQuestions).toEqual([]);
    expect(status(r, 'step-recheck-later')).toBe(NodeStatus.INCLUDED);
  });

  it('a baseline and a value since the start: measurable', async () => {
    const r = await run('2026-10-04T13:00:00.000Z', [['2026-09-01', 8], ['2026-10-04', 9]], '2026-09-03', g());
    expect(status(r, 'gate-unmeasurable')).toBe(NodeStatus.GATED_OUT);
  });

  it('only ONE baseline counts: two pre-iron values and nothing since is still one point', async () => {
    const r = await run('2026-10-04T13:00:00.000Z', [['2026-08-20', 8.5], ['2026-09-01', 8]], '2026-09-03', g());
    expect(status(r, 'gate-unmeasurable')).toBe(NodeStatus.INCLUDED);
  });

  it('a baseline older than baseline_days does not count', async () => {
    const r = await run('2026-10-04T13:00:00.000Z', [['2026-07-01', 8], ['2026-10-04', 9]], '2026-09-03', g());
    expect(status(r, 'gate-unmeasurable')).toBe(NodeStatus.INCLUDED);
  });
});

describe('count_comparison grammar', () => {
  it('is refused on any other operator, and for any other value', () => {
    expect(conditionControlDomainError({ field: 'labs', operator: 'greater_than', value: '718-7', threshold: 1, count_comparison: 'less_than' }))
      .toMatch(/applies only to count_in_window/);
    expect(conditionControlDomainError({ ...COUNT(), count_comparison: 'fewer' }))
      .toMatch(/must be "at_least" or "less_than"/);
    expect(conditionControlDomainError(COUNT('less_than'))).toBeNull();
  });
});
