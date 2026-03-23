// apps/pathway-service/src/__tests__/evidence-strength-scorer.test.ts

import { EvidenceStrengthScorer } from '../services/confidence/scorers/evidence-strength';
import {
  GraphNode,
  GraphEdge,
  GraphContext,
  SignalDefinition,
  ScoringType,
} from '../services/confidence/types';
import { REFERENCE_PATIENT } from './fixtures/reference-patient-context';

function makeSignalDef(): SignalDefinition {
  return {
    id: '00000000-0000-4000-a000-000000000002',
    name: 'evidence_strength',
    displayName: 'Evidence Strength',
    description: 'Maps evidence levels',
    scoringType: ScoringType.MAPPING_LOOKUP,
    scoringRules: {
      mappings: {
        'Level A': 0.95,
        'Level B': 0.80,
        'Level C': 0.65,
        'Expert Consensus': 0.60,
      },
      default_score: 0.30,
    },
    propagationConfig: { mode: 'none' },
    scope: 'SYSTEM',
    defaultWeight: 0.25,
    isActive: true,
  };
}

function makeGraphContext(nodes: GraphNode[], edges: GraphEdge[]): GraphContext {
  return {
    allNodes: nodes,
    allEdges: edges,
    incomingEdges: (nodeId) => edges.filter(e => e.targetId === nodeId),
    outgoingEdges: (nodeId) => edges.filter(e => e.sourceId === nodeId),
    getNode: (nodeId) => nodes.find(n => n.nodeIdentifier === nodeId),
    linkedNodes: (nodeId, edgeType) => {
      const targetIds = edges
        .filter(e => e.sourceId === nodeId && e.edgeType === edgeType)
        .map(e => e.targetId);
      return nodes.filter(n => targetIds.includes(n.nodeIdentifier));
    },
  };
}

describe('EvidenceStrengthScorer', () => {
  const scorer = new EvidenceStrengthScorer();

  it('should have scoringType MAPPING_LOOKUP', () => {
    expect(scorer.scoringType).toBe(ScoringType.MAPPING_LOOKUP);
  });

  it('should score 0.95 for a node with Level A evidence', () => {
    const evidenceNode: GraphNode = {
      id: 'age-ev1', nodeIdentifier: 'ev-1', nodeType: 'EvidenceCitation',
      properties: { evidence_level: 'Level A', title: 'ACOG Bulletin' },
    };
    const dpNode: GraphNode = {
      id: 'age-dp1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint',
      properties: { title: 'Delivery Decision' },
    };
    const edge: GraphEdge = {
      id: 'e1', edgeType: 'CITES_EVIDENCE', sourceId: 'dp-1', targetId: 'ev-1', properties: {},
    };

    const result = scorer.score({
      node: dpNode,
      signalDefinition: makeSignalDef(),
      patientContext: REFERENCE_PATIENT,
      graphContext: makeGraphContext([dpNode, evidenceNode], [edge]),
    });

    expect(result.score).toBe(0.95);
    expect(result.missingInputs).toHaveLength(0);
  });

  it('should use the highest evidence level when multiple citations exist', () => {
    const evA: GraphNode = {
      id: 'age-ev1', nodeIdentifier: 'ev-1', nodeType: 'EvidenceCitation',
      properties: { evidence_level: 'Level B' },
    };
    const evB: GraphNode = {
      id: 'age-ev2', nodeIdentifier: 'ev-2', nodeType: 'EvidenceCitation',
      properties: { evidence_level: 'Level A' },
    };
    const dpNode: GraphNode = {
      id: 'age-dp1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint',
      properties: { title: 'Decision' },
    };
    const edges: GraphEdge[] = [
      { id: 'e1', edgeType: 'CITES_EVIDENCE', sourceId: 'dp-1', targetId: 'ev-1', properties: {} },
      { id: 'e2', edgeType: 'CITES_EVIDENCE', sourceId: 'dp-1', targetId: 'ev-2', properties: {} },
    ];

    const result = scorer.score({
      node: dpNode,
      signalDefinition: makeSignalDef(),
      patientContext: REFERENCE_PATIENT,
      graphContext: makeGraphContext([dpNode, evA, evB], edges),
    });

    expect(result.score).toBe(0.95); // Takes highest (Level A)
  });

  it('should score 0.30 (default) when no evidence linked', () => {
    const dpNode: GraphNode = {
      id: 'age-dp1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint',
      properties: { title: 'Decision' },
    };

    const result = scorer.score({
      node: dpNode,
      signalDefinition: makeSignalDef(),
      patientContext: REFERENCE_PATIENT,
      graphContext: makeGraphContext([dpNode], []),
    });

    expect(result.score).toBe(0.30);
    expect(result.missingInputs).toContain('evidence_level');
  });

  it('should read evidence_level directly from EvidenceCitation nodes', () => {
    const evNode: GraphNode = {
      id: 'age-ev1', nodeIdentifier: 'ev-1', nodeType: 'EvidenceCitation',
      properties: { evidence_level: 'Level C', title: 'Study' },
    };

    const result = scorer.score({
      node: evNode,
      signalDefinition: makeSignalDef(),
      patientContext: REFERENCE_PATIENT,
      graphContext: makeGraphContext([evNode], []),
    });

    expect(result.score).toBe(0.65);
  });

  it('should not have a propagate method (evidence is intrinsic)', () => {
    expect(scorer.propagate).toBeUndefined();
  });
});
