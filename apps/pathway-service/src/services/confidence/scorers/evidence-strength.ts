// apps/pathway-service/src/services/confidence/scorers/evidence-strength.ts

import {
  SignalScorer,
  ScoringType,
  GraphNode,
  SignalDefinition,
  RequiredInput,
  SignalScore,
  ScorerParams,
} from '../types';

// Default evidence level score mappings (can be overridden via scoring_rules.mappings)
const DEFAULT_EVIDENCE_SCORES: Record<string, number> = {
  'Level A': 0.95,
  'Level B': 0.80,
  'Level C': 0.65,
  'Expert Consensus': 0.60,
};

const DEFAULT_SCORE = 0.30;

/**
 * Maps evidence levels to confidence scores. Looks for evidence_level on the node
 * itself (for EvidenceCitation nodes) or on linked EvidenceCitation nodes via
 * CITES_EVIDENCE edges. Uses the highest evidence level when multiple citations exist.
 *
 * Propagation: none. Evidence quality is intrinsic to the node.
 */
export class EvidenceStrengthScorer implements SignalScorer {
  readonly scoringType = ScoringType.MAPPING_LOOKUP;

  declareRequiredInputs(node: GraphNode, _signalConfig: SignalDefinition): RequiredInput[] {
    return [
      { name: 'evidence_level', source: node.nodeType === 'EvidenceCitation' ? 'graph_node' : 'linked_node', required: false },
    ];
  }

  score(params: ScorerParams): SignalScore {
    const { node, signalDefinition, graphContext } = params;

    const mappings = (signalDefinition.scoringRules.mappings as Record<string, number>) ?? DEFAULT_EVIDENCE_SCORES;
    const defaultScore = (signalDefinition.scoringRules.default_score as number) ?? DEFAULT_SCORE;

    // Collect evidence levels: from the node itself + from linked EvidenceCitation nodes
    const evidenceLevels: string[] = [];

    // Direct property on the node (for EvidenceCitation nodes)
    const directLevel = node.properties.evidence_level as string | undefined;
    if (directLevel) {
      evidenceLevels.push(directLevel);
    }

    // Linked EvidenceCitation nodes via CITES_EVIDENCE edges
    const linkedCitations = graphContext.linkedNodes(node.nodeIdentifier, 'CITES_EVIDENCE');
    for (const citation of linkedCitations) {
      const level = citation.properties.evidence_level as string | undefined;
      if (level) {
        evidenceLevels.push(level);
      }
    }

    // Admin-provided evidence entries
    if (params.adminEvidenceEntries) {
      const nodeEvidence = params.adminEvidenceEntries
        .filter(e => e.nodeIdentifier === node.nodeIdentifier);
      for (const entry of nodeEvidence) {
        evidenceLevels.push(entry.evidenceLevel);
      }
    }

    if (evidenceLevels.length === 0) {
      return {
        score: defaultScore,
        missingInputs: ['evidence_level'],
        metadata: { reason: 'no_evidence_citations' },
      };
    }

    // Use the highest evidence level score
    let bestScore = defaultScore;
    let bestLevel: string = 'default';
    for (const level of evidenceLevels) {
      const levelScore = mappings[level] ?? defaultScore;
      if (levelScore > bestScore) {
        bestScore = levelScore;
        bestLevel = level;
      }
    }

    return {
      score: bestScore,
      missingInputs: [],
      metadata: { evidenceLevels, bestLevel },
    };
  }

  // No propagate method — evidence quality is intrinsic (mode: none)
}
