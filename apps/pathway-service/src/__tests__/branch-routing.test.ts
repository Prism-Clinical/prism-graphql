/**
 * A gate with several branch targets takes the one the answer selects.
 *
 * Modelled on the live case: gate-etiology on vaginal-discharge-pregnancy-v1
 * has five SELECT options and five treatment branches. Today, answering with
 * any one of them opens ALL FIVE — a plan carrying metronidazole AND a topical
 * azole AND metronidazole again AND STI hand-off AND "reassurance, no
 * antimicrobial".
 */

import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import {
  NodeStatus,
  GateType,
  DefaultBehavior,
  AnswerType,
  GateAnswer,
} from '../services/resolution/types';
import { GraphNode, GraphEdge, PatientContext } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-08-31T12:00:00.000Z';

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(
  sourceId: string,
  targetId: string,
  edgeType = 'HAS_CHILD',
  properties: Record<string, unknown> = {},
): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties };
}

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.9, breakdown: [], resolutionType: 'AUTO_RESOLVED',
  }),
};

const PATIENT = {
  patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [],
} as unknown as PatientContext;

function engine() {
  return new TraversalEngine(
    mockConfidenceEngine as never,
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF, temporalPolicyVersion: 'legacy-v0',
    }),
    {}, [], new Map(),
  );
}

const ETIOLOGIES = ['BV', 'VVC', 'Trichomoniasis'] as const;

/** The live shape: one SELECT gate, one treatment branch per option. */
function etiologyGraph() {
  return makeGraphContext(
    [
      node('root', 'Pathway'),
      node('gate-etiology', 'Gate', {
        title: 'Established aetiology?',
        gate_type: GateType.QUESTION,
        default_behavior: DefaultBehavior.SKIP,
        answer_type: AnswerType.SELECT,
        options: [...ETIOLOGIES],
      }),
      node('step-bv', 'Step', { title: 'Treat bacterial vaginosis' }),
      node('step-vvc', 'Step', { title: 'Treat vulvovaginal candidiasis' }),
      node('step-trich', 'Step', { title: 'Treat trichomoniasis' }),
      node('ev-1', 'EvidenceCitation', { reference_number: 1, title: 'ACOG', evidence_level: 'A' }),
    ],
    [
      edge('root', 'gate-etiology', 'HAS_GATE'),
      edge('gate-etiology', 'step-bv', 'BRANCHES_TO', { when: { equals: 'BV' } }),
      edge('gate-etiology', 'step-vvc', 'BRANCHES_TO', { when: { equals: 'VVC' } }),
      edge('gate-etiology', 'step-trich', 'BRANCHES_TO', { when: { equals: 'Trichomoniasis' } }),
      // Not a branch — must be traversed regardless of routing.
      edge('gate-etiology', 'ev-1', 'CITES_EVIDENCE'),
    ],
  );
}

function answers(gateId: string, a: GateAnswer) {
  return new Map<string, GateAnswer>([[gateId, a]]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
    confidence: 0.9, breakdown: [], resolutionType: 'AUTO_RESOLVED',
  });
});

describe('routing a SELECT answer to one branch', () => {
  // THE SAFETY CASE.
  it('takes only the selected treatment', async () => {
    const r = await engine().traverse(
      etiologyGraph(), PATIENT,
      answers('gate-etiology', { selectedOption: 'Trichomoniasis' }),
    );

    expect(r.resolutionState.get('step-trich')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-bv')!.status).not.toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-vvc')!.status).not.toBe(NodeStatus.INCLUDED);
  });

  it('says why the other treatments are absent', async () => {
    const r = await engine().traverse(
      etiologyGraph(), PATIENT,
      answers('gate-etiology', { selectedOption: 'Trichomoniasis' }),
    );

    const reason = r.resolutionState.get('step-bv')!.excludeReason ?? '';
    expect(reason).toMatch(/not selected/i);
  });

  it('traverses non-branch children regardless of routing', async () => {
    const r = await engine().traverse(
      etiologyGraph(), PATIENT,
      answers('gate-etiology', { selectedOption: 'BV' }),
    );

    // Evidence is not a route; routing must not swallow it.
    expect(r.resolutionState.get('ev-1')!.status).toBe(NodeStatus.INCLUDED);
  });
});

describe('routing a BOOLEAN answer', () => {
  function boolGraph() {
    return makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-b', 'Gate', {
          title: 'Pregnant?',
          gate_type: GateType.QUESTION,
          default_behavior: DefaultBehavior.SKIP,
          answer_type: AnswerType.BOOLEAN,
        }),
        node('step-yes', 'Step', { title: 'Antenatal pathway' }),
        node('step-no', 'Step', { title: 'Standard pathway' }),
      ],
      [
        edge('root', 'gate-b', 'HAS_GATE'),
        edge('gate-b', 'step-yes', 'BRANCHES_TO', { when: { equals: true } }),
        edge('gate-b', 'step-no', 'BRANCHES_TO', { when: { equals: false } }),
      ],
    );
  }

  it('routes true and false to different branches', async () => {
    const yes = await engine().traverse(boolGraph(), PATIENT, answers('gate-b', { booleanValue: true }));
    expect(yes.resolutionState.get('step-yes')!.status).toBe(NodeStatus.INCLUDED);
    expect(yes.resolutionState.get('step-no')!.status).not.toBe(NodeStatus.INCLUDED);
  });
});

describe('routing a NUMERIC answer by range', () => {
  function rangeGraph() {
    return makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-n', 'Gate', {
          title: 'Haemoglobin?',
          gate_type: GateType.QUESTION,
          default_behavior: DefaultBehavior.SKIP,
          answer_type: AnswerType.NUMERIC,
        }),
        node('step-severe', 'Step', { title: 'Transfuse' }),
        node('step-mild', 'Step', { title: 'Oral iron' }),
        node('step-none', 'Step', { title: 'No anaemia' }),
      ],
      [
        edge('root', 'gate-n', 'HAS_GATE'),
        edge('gate-n', 'step-severe', 'BRANCHES_TO', { when: { lt: 7 } }),
        edge('gate-n', 'step-mild', 'BRANCHES_TO', { when: { gte: 7, lt: 11 } }),
        edge('gate-n', 'step-none', 'BRANCHES_TO', { when: { gte: 11 } }),
      ],
    );
  }

  it.each([
    [6, 'step-severe'],
    [9, 'step-mild'],
    [13, 'step-none'],
  ])('routes %s to %s', async (value, expected) => {
    const r = await engine().traverse(rangeGraph(), PATIENT, answers('gate-n', { numericValue: value }));
    expect(r.resolutionState.get(expected)!.status).toBe(NodeStatus.INCLUDED);
    for (const other of ['step-severe', 'step-mild', 'step-none'].filter(s => s !== expected)) {
      expect(r.resolutionState.get(other)!.status).not.toBe(NodeStatus.INCLUDED);
    }
  });

  // The boundary is the whole reason ranges are half-open.
  it('routes the lower bound INTO its own range', async () => {
    const r = await engine().traverse(rangeGraph(), PATIENT, answers('gate-n', { numericValue: 7 }));
    expect(r.resolutionState.get('step-mild')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-severe')!.status).not.toBe(NodeStatus.INCLUDED);
  });
});

describe('single-target gates are untouched', () => {
  // Every gate on the ACTIVE anaemia pathway is single-target. Routing must be
  // invisible to them, mapping or no mapping.
  it('traverses the one branch with no `when` at all', async () => {
    const g = makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-1', 'Gate', {
          title: 'Anaemic?',
          gate_type: GateType.QUESTION,
          default_behavior: DefaultBehavior.SKIP,
          answer_type: AnswerType.BOOLEAN,
        }),
        node('step-1', 'Step', { title: 'Treat' }),
      ],
      [edge('root', 'gate-1', 'HAS_GATE'), edge('gate-1', 'step-1', 'BRANCHES_TO')],
    );
    const r = await engine().traverse(g, PATIENT, answers('gate-1', { booleanValue: true }));
    expect(r.resolutionState.get('step-1')!.status).toBe(NodeStatus.INCLUDED);
  });
});
