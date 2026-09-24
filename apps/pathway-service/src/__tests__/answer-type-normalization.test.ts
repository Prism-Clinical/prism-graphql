/**
 * A lowercase `answer_type` must not reach the GraphQL `AnswerType` enum.
 *
 * Authored pathways write `answer_type: "boolean"`. The engine copied that
 * string straight onto the pending question, and the enum serializer then
 * failed the WHOLE resolution with `Enum "AnswerType" cannot represent value:
 * "boolean"` — every patient matching routine-prenatal (Z34.x) or the
 * vaginal-discharge draft got an error instead of a session.
 *
 * Normalised on write (the engine) AND on read (the formatters), because
 * sessions stored before the fix already hold the lowercase value.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSchema, graphql } from 'graphql';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { normalizeAnswerType } from '../services/resolution/answer-validation';
import { formatSessionForGraphQL } from '../resolvers/Query';
import {
  AnswerType,
  DefaultBehavior,
  GateType,
  ResolutionSession,
  SessionStatus,
} from '../services/resolution/types';
import { GraphNode, GraphEdge } from '../services/confidence/types';
import { REFERENCE_PATIENT, makeGraphContext } from './fixtures/reference-patient-context';

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}
function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

function engine(): TraversalEngine {
  return new TraversalEngine(
    {
      computeNodeConfidence: jest.fn().mockResolvedValue({
        confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED',
      }),
    },
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    makeEvaluationTemporalContext({
      evaluationAsOf: '2026-07-30T12:00:00.000Z', temporalPolicyVersion: 'legacy-v0',
    }),
    {},
    [],
    new Map(),
  );
}

/**
 * The real `AnswerType` enum, lifted out of schema.graphql, behind a one-field
 * query — so the assertion is the same serializer that failed in production,
 * not a restatement of it.
 */
const ENUM_SDL = readFileSync(join(__dirname, '../../schema.graphql'), 'utf-8')
  .match(/enum AnswerType \{[^}]*\}/)![0];
const probe = buildSchema(`${ENUM_SDL}\ntype Query { answerType: AnswerType }`);

async function serialize(value: unknown) {
  return graphql({ schema: probe, source: '{ answerType }', rootValue: { answerType: value } });
}

describe('answer_type normalisation', () => {
  it('the enum serializer really does reject a lowercase value (the production failure)', async () => {
    const result = await serialize('boolean');
    expect(result.errors?.[0]?.message).toMatch(/cannot represent value: "boolean"/);
  });

  it('a question gate authored with lowercase answer_type yields an enum-legal pending question', async () => {
    const graph = makeGraphContext(
      [
        node('root', 'Pathway'),
        node('gate-q', 'Gate', {
          gate_type: GateType.QUESTION,
          default_behavior: DefaultBehavior.SKIP,
          prompt: 'Any symptoms?',
          answer_type: 'boolean',
        }),
        node('step-a', 'Step'),
      ],
      [edge('root', 'gate-q', 'HAS_GATE'), edge('gate-q', 'step-a', 'BRANCHES_TO')],
    );

    const result = await engine().traverse(graph, REFERENCE_PATIENT, new Map());

    expect(result.pendingQuestions).toHaveLength(1);
    expect(result.pendingQuestions[0].answerType).toBe(AnswerType.BOOLEAN);
    const out = await serialize(result.pendingQuestions[0].answerType);
    expect(out.errors).toBeUndefined();
    expect(out.data).toEqual({ answerType: 'BOOLEAN' });
  });

  it('a stored session holding a lowercase answerType is normalised on read', async () => {
    const session = {
      id: 's1',
      pathwayId: 'p1',
      pathwayVersion: '1',
      patientId: 'pt',
      providerId: 'pr',
      status: SessionStatus.ACTIVE,
      resolutionState: new Map(),
      pendingQuestions: [
        { gateId: 'g1', prompt: 'Which?', answerType: 'select', options: ['a', 'b'],
          affectedSubtreeSize: 1, estimatedImpact: 'low' },
        { gateId: 'g2', prompt: 'How much?', answerType: 'numeric',
          affectedSubtreeSize: 1, estimatedImpact: 'low' },
      ],
      redFlags: [],
      totalNodesEvaluated: 0,
      traversalDurationMs: 0,
    } as unknown as ResolutionSession;

    const formatted = formatSessionForGraphQL(session);
    expect(formatted.pendingQuestions.map(q => q.answerType)).toEqual([
      AnswerType.SELECT, AnswerType.NUMERIC,
    ]);
    for (const q of formatted.pendingQuestions) {
      expect((await serialize(q.answerType)).errors).toBeUndefined();
    }
  });

  it.each([
    ['boolean', AnswerType.BOOLEAN],
    ['BOOLEAN', AnswerType.BOOLEAN],
    ['Select', AnswerType.SELECT],
    [' numeric ', AnswerType.NUMERIC],
    [undefined, AnswerType.BOOLEAN],
    [null, AnswerType.BOOLEAN],
    ['free_text', AnswerType.BOOLEAN],
  ])('normalizeAnswerType(%p) → %p', (raw, expected) => {
    expect(normalizeAnswerType(raw)).toBe(expected);
  });
});
