/**
 * Answering one gate must not re-open another through a node they share.
 *
 * Citations and code entries are shared across a pathway: many steps, stages
 * and DecisionPoints CITE one guideline, many lab tests carry one LOINC code.
 * `answerGateQuestion` seeded the answered gate's whole containment closure,
 * those shared leaves included, and `promote()` then re-entered at any Gate or
 * DecisionPoint parent of a seed — so a DecisionPoint that merely cited the
 * same guideline was walked as a root, outside the gate that had closed it,
 * and came back PENDING_QUESTION. The provider was asked to choose a branch
 * inside a work-up the pathway had already ruled out.
 *
 * Minimal forms of the two authored repros (gestational hypertension:
 * aspirin "yes" re-opened DP-1; UTI in pregnancy: "no GBS" did the same), each
 * run in both edge orders and under both seedings, plus the same defect
 * reached without an answer: a DecisionPoint gated out from above, re-seeded
 * because its recorded scorer inputs changed.
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { containmentClosure } from '../services/resolution/graph-containment';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { NodeStatus, GateType, DefaultBehavior, GateAnswer } from '../services/resolution/types';
import { GraphNode, GraphEdge, GraphContext, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-09-24T12:00:00.000Z';

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType: string): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

const PATIENT = {
  patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [],
} as unknown as PatientContext;

function engine() {
  return new TraversalEngine(
    {
      computeNodeConfidence: jest.fn().mockResolvedValue({
        confidence: 0.9, breakdown: [], resolutionType: 'AUTO_RESOLVED',
      }),
    } as never,
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'legacy-v0' }),
    {}, [], new Map(),
  );
}

const question = (title: string) => ({
  title, gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: 'BOOLEAN',
});
const YES = { booleanValue: true } as GateAnswer;
const NO = { booleanValue: false } as GateAnswer;

function graphOf(nodes: GraphNode[], edges: GraphEdge[], reverse: boolean): GraphContext {
  return makeGraphContext(nodes, reverse ? [...edges].reverse() : edges);
}

const ORDERS = [['file', false], ['reversed', true]] as const;
const SEEDINGS = ['gate', 'closure'] as const;

/** Re-resolve after an answer, seeded as the mutation seeds it (or as it used to). */
async function answer(
  eng: TraversalEngine, g: GraphContext, first: Awaited<ReturnType<TraversalEngine['traverse']>>,
  answers: Map<string, GateAnswer>, gateId: string, value: GateAnswer, seeding: 'gate' | 'closure',
) {
  answers.set(gateId, value);
  const seed = seeding === 'gate' ? new Set([gateId]) : containmentClosure(g, [gateId]);
  return eng.resolveIncrementally(
    seed, first.resolutionState, first.dependencyMap, g, PATIENT, answers,
    { pendingQuestions: first.pendingQuestions, redFlags: first.redFlags, alsoDropGateIds: [gateId] },
  );
}

describe('a DecisionPoint that cites a leaf the answered gate shares', () => {
  /**
   * gestational hypertension, reduced:
   *
   *   root ─ gate-aspirin ─ step-baseline ─ lab-panel ─ code-shared
   *      │                               └─ ev-shared
   *      └─ gate-workup ─ step-workup ─ dp ─ step-x / step-y ─ code-shared
   *                                     └─ ev-shared (CITES)
   *
   * gate-workup is answered "no" up front (BP normal): the fork is gated out.
   * gate-aspirin is then answered "yes". Nothing about the work-up changed.
   */
  const nodes = [
    node('root', 'Pathway'),
    node('gate-aspirin', 'Gate', question('Aspirin indicated?')),
    node('step-baseline', 'Step'),
    node('lab-panel', 'LabTest'),
    node('gate-workup', 'Gate', question('Hypertension confirmed?')),
    node('step-workup', 'Step'),
    node('dp', 'DecisionPoint'),
    node('step-x', 'Step'),
    node('step-y', 'Step'),
    node('lab-x', 'LabTest'),
    node('ev-shared', 'EvidenceCitation'),
    node('code-shared', 'CodeEntry'),
  ];
  const edges = [
    edge('root', 'gate-aspirin', 'HAS_GATE'),
    edge('gate-aspirin', 'step-baseline', 'BRANCHES_TO'),
    edge('step-baseline', 'lab-panel', 'HAS_LAB_TEST'),
    edge('step-baseline', 'ev-shared', 'CITES_EVIDENCE'),
    edge('lab-panel', 'code-shared', 'HAS_CODE'),
    edge('root', 'gate-workup', 'HAS_GATE'),
    edge('gate-workup', 'step-workup', 'BRANCHES_TO'),
    edge('step-workup', 'dp', 'HAS_DECISION_POINT'),
    edge('dp', 'ev-shared', 'CITES_EVIDENCE'),
    edge('dp', 'step-x', 'BRANCHES_TO'),
    edge('dp', 'step-y', 'BRANCHES_TO'),
    edge('step-x', 'lab-x', 'HAS_LAB_TEST'),
    edge('lab-x', 'code-shared', 'HAS_CODE'),
  ];

  for (const [order, reverse] of ORDERS) {
    for (const seeding of SEEDINGS) {
      it(`stays gated out, and asks nothing [${order} order, ${seeding} seed]`, async () => {
        const g = graphOf(nodes, edges, reverse);
        const answers = new Map<string, GateAnswer>([['gate-workup', NO]]);
        const eng = engine();
        const first = await eng.traverse(g, PATIENT, answers);
        expect(first.resolutionState.get('dp')!.status).toBe(NodeStatus.GATED_OUT);
        expect(first.pendingQuestions.map(q => q.gateId)).toEqual(['gate-aspirin']);

        const r = await answer(eng, g, first, answers, 'gate-aspirin', YES, seeding);

        expect(first.resolutionState.get('step-baseline')!.status).toBe(NodeStatus.INCLUDED);
        for (const id of ['gate-workup', 'step-workup', 'dp', 'step-x', 'step-y', 'lab-x']) {
          expect([id, first.resolutionState.get(id)?.status]).toEqual([id, NodeStatus.GATED_OUT]);
        }
        expect(r.pendingQuestions).toEqual([]);
        // The shared leaves belong to the baseline step, which is open.
        expect(first.resolutionState.get('ev-shared')!.status).toBe(NodeStatus.INCLUDED);
        expect(first.resolutionState.get('code-shared')!.status).toBe(NodeStatus.INCLUDED);
      });
    }
  }
});

describe('a shared leaf beneath the gate that closes', () => {
  /**
   * UTI in pregnancy, reduced:
   *
   *   root ─ step-culture ─ ev-shared            (always open)
   *      └─ gate-gbs ─ step-gbs ─ ev-shared      (closes on "no")
   *      └─ gate-positive ─ step-treat ─ dp ─ step-a / step-b
   *                                       └─ ev-shared
   *
   * Culture negative: gate-positive is answered "no" up front. "No GBS" then
   * closes gate-gbs, whose step cites the same guideline the open culture
   * step does.
   */
  const nodes = [
    node('root', 'Pathway'),
    node('step-culture', 'Step'),
    node('gate-gbs', 'Gate', question('GBS identified?')),
    node('step-gbs', 'Step'),
    node('gate-positive', 'Gate', question('Culture positive?')),
    node('step-treat', 'Step'),
    node('dp', 'DecisionPoint'),
    node('step-a', 'Step'),
    node('step-b', 'Step'),
    node('ev-shared', 'EvidenceCitation'),
  ];
  const edges = [
    edge('root', 'step-culture', 'HAS_STAGE'),
    edge('step-culture', 'ev-shared', 'CITES_EVIDENCE'),
    edge('root', 'gate-gbs', 'HAS_GATE'),
    edge('gate-gbs', 'step-gbs', 'BRANCHES_TO'),
    edge('step-gbs', 'ev-shared', 'CITES_EVIDENCE'),
    edge('root', 'gate-positive', 'HAS_GATE'),
    edge('gate-positive', 'step-treat', 'BRANCHES_TO'),
    edge('step-treat', 'dp', 'HAS_DECISION_POINT'),
    edge('dp', 'ev-shared', 'CITES_EVIDENCE'),
    edge('dp', 'step-a', 'BRANCHES_TO'),
    edge('dp', 'step-b', 'BRANCHES_TO'),
  ];

  for (const [order, reverse] of ORDERS) {
    for (const seeding of SEEDINGS) {
      it(`closes its own step only [${order} order, ${seeding} seed]`, async () => {
        const g = graphOf(nodes, edges, reverse);
        const answers = new Map<string, GateAnswer>([['gate-positive', NO]]);
        const eng = engine();
        const first = await eng.traverse(g, PATIENT, answers);

        const r = await answer(eng, g, first, answers, 'gate-gbs', NO, seeding);

        expect(first.resolutionState.get('step-gbs')!.status).toBe(NodeStatus.GATED_OUT);
        expect(first.resolutionState.get('step-culture')!.status).toBe(NodeStatus.INCLUDED);
        // Still cited by the open culture step, so not the closing gate's to sweep.
        expect(first.resolutionState.get('ev-shared')!.status).toBe(NodeStatus.INCLUDED);
        // And the fork in the gated-out treatment stage stays shut.
        for (const id of ['dp', 'step-a', 'step-b']) {
          expect([id, first.resolutionState.get(id)?.status]).toEqual([id, NodeStatus.GATED_OUT]);
        }
        expect(r.pendingQuestions).toEqual([]);
      });
    }
  }
});

describe('a leaf beneath a provider-overridden step, when the gate above closes', () => {
  /**
   * root ─ gate-shut ─ step-over (overridden INCLUDED) ─ med-1
   *                                                   └─ sched-1 (Schedule)
   *                                                   └─ ev-1 ─ also cited by step-open (not overridden)
   *
   * The override is a decision about step-over alone, so the gate's sweep
   * closes what lies beneath it. An overridden host is INCLUDED, but it is not
   * a live host for its leaves: a Schedule it held must not come back
   * INCLUDED — an INCLUDED Schedule is projected into the care plan.
   */
  const nodes = [
    node('root', 'Pathway'),
    node('gate-shut', 'Gate', question('Symptomatic?')),
    node('step-over', 'Step'),
    node('med-1', 'Medication'),
    node('sched-1', 'Schedule'),
    node('ev-1', 'EvidenceCitation'),
    node('step-open', 'Step'),
  ];
  const edges = [
    edge('root', 'gate-shut', 'HAS_GATE'),
    edge('gate-shut', 'step-over', 'BRANCHES_TO'),
    edge('step-over', 'med-1', 'USES_MEDICATION'),
    edge('step-over', 'sched-1', 'HAS_SCHEDULE'),
    edge('step-over', 'ev-1', 'CITES_EVIDENCE'),
    edge('root', 'step-open', 'HAS_STAGE'),
    edge('step-open', 'ev-1', 'CITES_EVIDENCE'),
  ];

  for (const [order, reverse] of ORDERS) {
    it(`closes the leaves the override does not cover [${order} order]`, async () => {
      const g = graphOf(nodes, edges, reverse);
      const answers = new Map<string, GateAnswer>([['gate-shut', YES]]);
      const eng = engine();
      const first = await eng.traverse(g, PATIENT, answers);
      first.resolutionState.get('step-over')!.providerOverride = {
        action: 'INCLUDE', reason: 'clinical judgement',
        originalStatus: NodeStatus.INCLUDED, originalConfidence: 0.9,
      } as never;

      // The answer is withdrawn: the gate shuts.
      await eng.resolveIncrementally(
        new Set(['gate-shut']), first.resolutionState, first.dependencyMap, g, PATIENT, new Map(),
      );

      expect(first.resolutionState.get('step-over')!.providerOverride).toBeDefined();
      expect(first.resolutionState.get('med-1')!.status).not.toBe(NodeStatus.INCLUDED);
      expect(first.resolutionState.get('sched-1')!.status).not.toBe(NodeStatus.INCLUDED);
      // Still cited by a step nobody overrode, which is open.
      expect(first.resolutionState.get('ev-1')!.status).toBe(NodeStatus.INCLUDED);
    });
  }
});

describe('a DecisionPoint gated out from above, seeded on its own', () => {
  /**
   * root ─ gate-workup ─ step-workup ─ dp ─ step-x / step-y
   *
   * Opened once, the fork pends and records the inputs its branch scores read.
   * The gate is then answered "no", which gates the fork out — but the
   * dependency map still lists those inputs, so the next `addPatientContext`
   * that touches them seeds the fork by itself. A closed DecisionPoint was
   * treated as having closed itself, re-disposed as a root with nothing above
   * it consulted, and pended again.
   */
  const nodes = [
    node('root', 'Pathway'),
    node('gate-workup', 'Gate', question('Hypertension confirmed?')),
    node('step-workup', 'Step'),
    node('dp', 'DecisionPoint'),
    node('step-x', 'Step'),
    node('step-y', 'Step'),
  ];
  const edges = [
    edge('root', 'gate-workup', 'HAS_GATE'),
    edge('gate-workup', 'step-workup', 'BRANCHES_TO'),
    edge('step-workup', 'dp', 'HAS_DECISION_POINT'),
    edge('dp', 'step-x', 'BRANCHES_TO'),
    edge('dp', 'step-y', 'BRANCHES_TO'),
  ];

  for (const [order, reverse] of ORDERS) {
    it(`stays gated out [${order} order]`, async () => {
      const g = graphOf(nodes, edges, reverse);
      const answers = new Map<string, GateAnswer>([['gate-workup', YES]]);
      const eng = engine();
      const first = await eng.traverse(g, PATIENT, answers);
      expect(first.resolutionState.get('dp')!.status).toBe(NodeStatus.PENDING_QUESTION);

      const closed = await answer(eng, g, first, answers, 'gate-workup', NO, 'gate');
      expect(first.resolutionState.get('dp')!.status).toBe(NodeStatus.GATED_OUT);
      expect(closed.pendingQuestions).toEqual([]);

      // New context moves the fork's branch scores: the fork alone is seeded.
      const r = await eng.resolveIncrementally(
        new Set(['dp']), first.resolutionState, first.dependencyMap, g, PATIENT, answers,
        { pendingQuestions: closed.pendingQuestions, redFlags: closed.redFlags },
      );

      for (const id of ['gate-workup', 'step-workup', 'dp', 'step-x', 'step-y']) {
        expect([id, first.resolutionState.get(id)?.status]).toEqual([id, NodeStatus.GATED_OUT]);
      }
      expect(r.pendingQuestions).toEqual([]);
    });
  }
});
