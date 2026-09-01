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

// ─────────────────────────────────────────────────────────────────────

describe('one routing mechanism — an LLM gate routes like any other', () => {
  /**
   * `chosenBranch` was computed, persisted to the audit table, shown to the
   * provider — and never used to route. `LlmGateBranchSpec` carries no target,
   * so there was nothing to route TO. With `when` on the edge there now is: a
   * branch declares `when: { equals: '<branch name>' }` and the model's choice
   * selects it exactly as a provider's selection does.
   *
   * This is the defensible core of the "one decision construct" argument. The
   * SOURCE of an answer varies — provider, model, chart — while how a branch
   * is chosen should not.
   */
  function llmGraph() {
    return makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-llm', 'Gate', {
          title: 'Aetiology from the narrative?',
          gate_type: GateType.LLM_TEXT_ANALYSIS,
          default_behavior: DefaultBehavior.SKIP,
          input_attribute: 'freeformData.narrative.chief_complaint',
          confidence_threshold: 0.75,
          branches: [
            { name: 'bacterial', description: 'Bacterial picture', is_safe_default: true },
            { name: 'fungal', description: 'Fungal picture' },
          ],
        }),
        node('step-bacterial', 'Step', { title: 'Treat bacterial' }),
        node('step-fungal', 'Step', { title: 'Treat fungal' }),
      ],
      [
        edge('root', 'gate-llm', 'HAS_GATE'),
        edge('gate-llm', 'step-bacterial', 'BRANCHES_TO', { when: { equals: 'bacterial' } }),
        edge('gate-llm', 'step-fungal', 'BRANCHES_TO', { when: { equals: 'fungal' } }),
      ],
    );
  }

  function engineWithLlm(verdict: { chosenBranch: string; confidence: number; reasoning: string }) {
    return new TraversalEngine(
      mockConfidenceEngine as never,
      { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
      makeEvaluationTemporalContext({
        evaluationAsOf: AS_OF, temporalPolicyVersion: 'legacy-v0',
      }),
      {}, [], new Map(),
      async () => verdict,
    );
  }

  it('routes to the branch the model chose', async () => {
    const r = await engineWithLlm({
      chosenBranch: 'fungal', confidence: 0.9, reasoning: 'itch, discharge',
    }).traverse(llmGraph(), PATIENT, new Map());

    expect(r.resolutionState.get('step-fungal')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-bacterial')!.status).not.toBe(NodeStatus.INCLUDED);
  });

  it('routes the safe default when the model is below threshold, and still asks', async () => {
    const r = await engineWithLlm({
      chosenBranch: 'fungal', confidence: 0.4, reasoning: 'unclear',
    }).traverse(llmGraph(), PATIENT, new Map());

    // Below threshold the evaluator falls back to the declared safe default...
    expect(r.resolutionState.get('step-bacterial')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('step-fungal')!.status).not.toBe(NodeStatus.INCLUDED);
    // ...and the existing tentative behaviour survives: the provider is still
    // asked to confirm or flip.
    expect(r.pendingQuestions).toHaveLength(1);
    expect(r.pendingQuestions[0].tentative).toBe(true);
  });
});
