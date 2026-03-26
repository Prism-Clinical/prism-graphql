import { TraversalEngine } from '../services/resolution/traversal-engine';
import {
  NodeStatus,
  GateAnswer,
  GateType,
  DefaultBehavior,
  AnswerType,
} from '../services/resolution/types';
import { GraphNode, GraphEdge } from '../services/confidence/types';
import {
  REFERENCE_PATIENT,
  makeGraphContext,
} from './fixtures/reference-patient-context';

// ─── Helpers ──────────────────────────────────────────────────────────

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}

function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.85,
    breakdown: [
      { signalName: 'data_completeness', score: 0.9, weight: 1.0, weightSource: 'SYSTEM_DEFAULT', missingInputs: [] },
    ],
    resolutionType: 'AUTO_RESOLVED',
  }),
};

const mockThresholds = { autoResolveThreshold: 0.85, suggestThreshold: 0.60 };

function createEngine(): TraversalEngine {
  mockConfidenceEngine.computeNodeConfidence.mockClear();
  mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
    confidence: 0.85,
    breakdown: [
      { signalName: 'data_completeness', score: 0.9, weight: 1.0, weightSource: 'SYSTEM_DEFAULT', missingInputs: [] },
    ],
    resolutionType: 'AUTO_RESOLVED',
  });
  return new TraversalEngine(mockConfidenceEngine, mockThresholds);
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('TraversalEngine', () => {
  describe('simple traversal', () => {
    it('should traverse root → stage → step → medication and include all above threshold', async () => {
      const nodes = [
        node('root', 'Pathway'),
        node('stage-1', 'Stage'),
        node('step-1', 'Step'),
        node('med-1', 'Medication'),
      ];
      const edges = [
        edge('root', 'stage-1'),
        edge('stage-1', 'step-1'),
        edge('step-1', 'med-1'),
      ];
      const graphContext = makeGraphContext(nodes, edges);
      const engine = createEngine();

      const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

      expect(result.resolutionState.size).toBe(4);
      expect(result.resolutionState.get('root')!.status).toBe(NodeStatus.INCLUDED);
      expect(result.resolutionState.get('stage-1')!.status).toBe(NodeStatus.INCLUDED);
      expect(result.resolutionState.get('step-1')!.status).toBe(NodeStatus.INCLUDED);
      expect(result.resolutionState.get('med-1')!.status).toBe(NodeStatus.INCLUDED);
      expect(result.resolutionState.get('med-1')!.confidence).toBe(0.85);
      expect(result.pendingQuestions).toHaveLength(0);
      expect(result.redFlags).toHaveLength(0);
      expect(result.isDegraded).toBe(false);
      expect(result.totalNodesEvaluated).toBe(4);
    });
  });

  describe('exclude below threshold', () => {
    it('should EXCLUDE action nodes with confidence below suggestThreshold', async () => {
      const nodes = [
        node('root', 'Pathway'),
        node('step-1', 'Step'),
        node('med-1', 'Medication'),
        node('med-2', 'Medication'),
      ];
      const edges = [
        edge('root', 'step-1'),
        edge('step-1', 'med-1'),
        edge('step-1', 'med-2'),
      ];
      const graphContext = makeGraphContext(nodes, edges);
      const engine = createEngine();

      // med-1 scores high, med-2 scores low
      mockConfidenceEngine.computeNodeConfidence
        .mockImplementation(async (n: GraphNode) => {
          if (n.nodeIdentifier === 'med-2') {
            return {
              confidence: 0.40,
              breakdown: [
                { signalName: 'data_completeness', score: 0.4, weight: 1.0, weightSource: 'SYSTEM_DEFAULT', missingInputs: ['lab_data'] },
              ],
              resolutionType: 'PROVIDER_DECIDED',
            };
          }
          return {
            confidence: 0.85,
            breakdown: [
              { signalName: 'data_completeness', score: 0.9, weight: 1.0, weightSource: 'SYSTEM_DEFAULT', missingInputs: [] },
            ],
            resolutionType: 'AUTO_RESOLVED',
          };
        });

      const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

      expect(result.resolutionState.get('med-1')!.status).toBe(NodeStatus.INCLUDED);
      expect(result.resolutionState.get('med-2')!.status).toBe(NodeStatus.EXCLUDED);
      expect(result.resolutionState.get('med-2')!.excludeReason).toContain('below suggest threshold');
    });
  });

  describe('gate subtree pruning', () => {
    it('should GATE_OUT gate and entire subtree when patient_attribute gate is not satisfied', async () => {
      const nodes = [
        node('root', 'Pathway'),
        node('stage-1', 'Stage'),
        node('gate-transplant', 'Gate', {
          title: 'Transplant Recipient Screen',
          gate_type: GateType.PATIENT_ATTRIBUTE,
          default_behavior: DefaultBehavior.SKIP,
          condition: {
            field: 'conditions',
            operator: 'includes_code',
            value: 'Z94.*',
            system: 'ICD-10',
          },
        }),
        node('step-immuno', 'Step'),
        node('med-immuno', 'Medication'),
      ];
      const edges = [
        edge('root', 'stage-1'),
        edge('stage-1', 'gate-transplant', 'HAS_GATE'),
        edge('gate-transplant', 'step-immuno', 'BRANCHES_TO'),
        edge('step-immuno', 'med-immuno'),
      ];
      const graphContext = makeGraphContext(nodes, edges);
      const engine = createEngine();

      // REFERENCE_PATIENT does NOT have Z94.* codes
      const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

      expect(result.resolutionState.get('gate-transplant')!.status).toBe(NodeStatus.GATED_OUT);
      expect(result.resolutionState.get('step-immuno')!.status).toBe(NodeStatus.GATED_OUT);
      expect(result.resolutionState.get('med-immuno')!.status).toBe(NodeStatus.GATED_OUT);
      expect(result.resolutionState.get('stage-1')!.status).toBe(NodeStatus.INCLUDED);
    });
  });

  describe('pending question', () => {
    it('should mark gate and subtree as PENDING_QUESTION when question is unanswered', async () => {
      const nodes = [
        node('root', 'Pathway'),
        node('gate-question', 'Gate', {
          title: 'Prior Cesarean Confirmation',
          gate_type: GateType.QUESTION,
          default_behavior: DefaultBehavior.SKIP,
          prompt: 'Was the prior uterine surgery a cesarean delivery?',
          answer_type: AnswerType.BOOLEAN,
        }),
        node('step-cesarean', 'Step'),
        node('med-cesarean', 'Medication'),
      ];
      const edges = [
        edge('root', 'gate-question', 'HAS_GATE'),
        edge('gate-question', 'step-cesarean', 'BRANCHES_TO'),
        edge('step-cesarean', 'med-cesarean'),
      ];
      const graphContext = makeGraphContext(nodes, edges);
      const engine = createEngine();

      // No answers provided
      const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

      expect(result.resolutionState.get('gate-question')!.status).toBe(NodeStatus.PENDING_QUESTION);
      expect(result.resolutionState.get('step-cesarean')!.status).toBe(NodeStatus.PENDING_QUESTION);
      expect(result.resolutionState.get('med-cesarean')!.status).toBe(NodeStatus.PENDING_QUESTION);
      expect(result.pendingQuestions).toHaveLength(1);
      expect(result.pendingQuestions[0].gateId).toBe('gate-question');
      expect(result.pendingQuestions[0].prompt).toBe('Was the prior uterine surgery a cesarean delivery?');
      expect(result.pendingQuestions[0].answerType).toBe(AnswerType.BOOLEAN);
      expect(result.pendingQuestions[0].affectedSubtreeSize).toBe(2);
    });
  });

  describe('dependency tracking', () => {
    it('should record influences/influencedBy for prior_node_result gate', async () => {
      const nodes = [
        node('root', 'Pathway'),
        node('step-a', 'Step'),
        node('gate-dep', 'Gate', {
          title: 'Depends on step-a',
          gate_type: GateType.PRIOR_NODE_RESULT,
          default_behavior: DefaultBehavior.SKIP,
          depends_on: [{ node_id: 'step-a', status: 'INCLUDED' }],
        }),
        node('step-b', 'Step'),
      ];
      const edges = [
        edge('root', 'step-a'),
        edge('root', 'gate-dep', 'HAS_GATE'),
        edge('gate-dep', 'step-b', 'BRANCHES_TO'),
      ];
      const graphContext = makeGraphContext(nodes, edges);
      const engine = createEngine();

      const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

      // step-a should influence gate-dep
      expect(result.dependencyMap.influences.get('step-a')?.has('gate-dep')).toBe(true);
      expect(result.dependencyMap.influencedBy.get('gate-dep')?.has('step-a')).toBe(true);

      // Gate should be satisfied since step-a is INCLUDED (confidence 0.85 >= 0.60)
      expect(result.resolutionState.get('gate-dep')!.status).toBe(NodeStatus.INCLUDED);
      expect(result.resolutionState.get('step-b')!.status).toBe(NodeStatus.INCLUDED);
    });
  });

  describe('all branches excluded red flag', () => {
    it('should emit all_branches_excluded red flag when all DecisionPoint branches are below threshold', async () => {
      const nodes = [
        node('root', 'Pathway'),
        node('dp-1', 'DecisionPoint'),
        node('branch-a', 'Medication'),
        node('branch-b', 'Medication'),
      ];
      const edges = [
        edge('root', 'dp-1'),
        edge('dp-1', 'branch-a', 'BRANCHES_TO'),
        edge('dp-1', 'branch-b', 'BRANCHES_TO'),
      ];
      const graphContext = makeGraphContext(nodes, edges);
      const engine = createEngine();

      // All branches score below suggest threshold
      mockConfidenceEngine.computeNodeConfidence.mockImplementation(async (n: GraphNode) => {
        if (n.nodeIdentifier === 'branch-a' || n.nodeIdentifier === 'branch-b') {
          return {
            confidence: 0.30,
            breakdown: [
              { signalName: 'data_completeness', score: 0.3, weight: 1.0, weightSource: 'SYSTEM_DEFAULT', missingInputs: ['all'] },
            ],
            resolutionType: 'PROVIDER_DECIDED',
          };
        }
        return {
          confidence: 0.85,
          breakdown: [
            { signalName: 'data_completeness', score: 0.9, weight: 1.0, weightSource: 'SYSTEM_DEFAULT', missingInputs: [] },
          ],
          resolutionType: 'AUTO_RESOLVED',
        };
      });

      const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

      expect(result.redFlags).toHaveLength(1);
      expect(result.redFlags[0].type).toBe('all_branches_excluded');
      expect(result.redFlags[0].nodeId).toBe('dp-1');
      expect(result.redFlags[0].branches).toHaveLength(2);
      expect(result.resolutionState.get('branch-a')!.status).toBe(NodeStatus.EXCLUDED);
      expect(result.resolutionState.get('branch-b')!.status).toBe(NodeStatus.EXCLUDED);
    });
  });

  describe('informational nodes', () => {
    it('should include Criterion and Evidence nodes as informational without confidence gating', async () => {
      const nodes = [
        node('root', 'Pathway'),
        node('criterion-1', 'Criterion'),
        node('evidence-1', 'Evidence'),
      ];
      const edges = [
        edge('root', 'criterion-1'),
        edge('root', 'evidence-1'),
      ];
      const graphContext = makeGraphContext(nodes, edges);
      const engine = createEngine();

      const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

      expect(result.resolutionState.get('criterion-1')!.status).toBe(NodeStatus.INCLUDED);
      expect(result.resolutionState.get('criterion-1')!.confidence).toBe(1);
      expect(result.resolutionState.get('evidence-1')!.status).toBe(NodeStatus.INCLUDED);
      expect(result.resolutionState.get('evidence-1')!.confidence).toBe(1);
    });
  });

  describe('no root node', () => {
    it('should return degraded result when no Pathway root node exists', async () => {
      const nodes = [node('stage-1', 'Stage')];
      const graphContext = makeGraphContext(nodes, []);
      const engine = createEngine();

      const result = await engine.traverse(graphContext, REFERENCE_PATIENT, new Map());

      expect(result.isDegraded).toBe(true);
      expect(result.totalNodesEvaluated).toBe(0);
    });
  });
});
