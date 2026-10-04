/**
 * `on_declined: "traverse"` — "Not available" opens the gate.
 *
 * Josh, 2026-10-04: "Not available" on "already taking a prenatal vitamin?"
 * means recommend it. A `patient.*` condition is never true on absence, so
 * without this a declined question closed both the "yes" and the "no" gate and
 * nothing was recommended.
 */
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { NodeStatus, DefaultBehavior, GateType, GateAnswer, declinedKeyFor } from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType: string): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}
const gate = (id: string, value: boolean, extra: Record<string, unknown> = {}) => node(id, 'Gate', {
  gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP, on_unresolved: 'ask',
  condition: { attribute: 'patient.on_prenatal_vitamin', operator: 'equals', value },
  ...extra,
});

const graph = (startExtra: Record<string, unknown>) => makeGraphContext(
  [
    node('root', 'Pathway'), node('stage', 'Stage'), node('step', 'Step'),
    gate('gate-taking', true), node('step-continue', 'Step'),
    gate('gate-not-taking', false, startExtra), node('step-start', 'Step'), node('med-vitamin', 'Medication'),
  ],
  [
    edge('root', 'stage', 'HAS_STAGE'), edge('stage', 'step', 'HAS_STEP'),
    edge('step', 'gate-taking', 'HAS_GATE'), edge('gate-taking', 'step-continue', 'BRANCHES_TO'),
    edge('step', 'gate-not-taking', 'HAS_GATE'), edge('gate-not-taking', 'step-start', 'BRANCHES_TO'),
    edge('step-start', 'med-vitamin', 'USES_MEDICATION'),
  ],
);

const confidence = { computeNodeConfidence: jest.fn().mockResolvedValue({ confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED' }) };

async function run(attrs: Record<string, unknown>, startExtra: Record<string, unknown>, declined = false) {
  const pc = { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [], patientAttributes: attrs } as unknown as PatientContext;
  const temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: '2026-10-04T13:00:00.000Z', temporalPolicyVersion: 'v1' });
  const factStore = assembleContext({ mode: 'SYNTHETIC', patientContext: pc } as never, temporalContext);
  const engine = new TraversalEngine(confidence as never, { autoResolveThreshold: 0.85, suggestThreshold: 0.6 }, temporalContext, {}, factStore, new Map());
  const first = await engine.traverse(graph(startExtra), pc, new Map());
  if (!declined) return first;
  const answers = new Map<string, GateAnswer>();
  answers.set(declinedKeyFor(first.pendingQuestions[0].datumKey!), { notAvailable: true } as GateAnswer);
  return engine.traverse(graph(startExtra), pc, answers);
}
const status = (r: Awaited<ReturnType<typeof run>>, id: string) => r.resolutionState.get(id)?.status;

describe('on_declined: traverse', () => {
  const OPENS = { on_declined: 'traverse' };

  it('unanswered: asks once, opens nothing', async () => {
    const r = await run({}, OPENS);
    expect(r.pendingQuestions).toHaveLength(1);
    expect(status(r, 'med-vitamin')).not.toBe(NodeStatus.INCLUDED);
  });

  it('"Not available": the gate opens and the vitamin is recommended; the other gate stays closed', async () => {
    const r = await run({}, OPENS, true);
    expect(r.pendingQuestions).toEqual([]);
    expect(status(r, 'gate-not-taking')).toBe(NodeStatus.INCLUDED);
    expect(status(r, 'med-vitamin')).toBe(NodeStatus.INCLUDED);
    expect(status(r, 'gate-taking')).toBe(NodeStatus.GATED_OUT);
    expect(status(r, 'step-continue')).not.toBe(NodeStatus.INCLUDED);
  });

  it('without on_declined, "Not available" closes both — the behaviour this replaces', async () => {
    const r = await run({}, {}, true);
    expect(status(r, 'med-vitamin')).not.toBe(NodeStatus.INCLUDED);
    expect(status(r, 'step-continue')).not.toBe(NodeStatus.INCLUDED);
  });

  it('an answered "yes" is a definite no for the gate: on_declined does not open it', async () => {
    const r = await run({ on_prenatal_vitamin: true }, OPENS);
    expect(status(r, 'gate-not-taking')).toBe(NodeStatus.GATED_OUT);
    expect(status(r, 'step-continue')).toBe(NodeStatus.INCLUDED);
  });

  it('an answered "no" opens it as any satisfied gate opens', async () => {
    const r = await run({ on_prenatal_vitamin: false }, OPENS);
    expect(status(r, 'med-vitamin')).toBe(NodeStatus.INCLUDED);
  });
});
