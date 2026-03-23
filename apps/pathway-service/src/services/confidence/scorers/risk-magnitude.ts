import {
  SignalScorer,
  ScoringType,
  GraphNode,
  SignalDefinition,
  RequiredInput,
  SignalScore,
  ScorerParams,
  PropagationParams,
  PropagationResult,
} from '../types';

const NO_DATA_SCORE = 0.50;
const FLOOR_SCORE = 0.10;

/**
 * Inverse risk scoring: higher risk → lower confidence.
 * Formula: max(0.10, 1.0 - (log10(risk * 1000 + 1) / 3.0))
 * No data → 0.50.
 *
 * Reads `base_rate` from node properties (set on Criterion nodes by the pathway author).
 *
 * Propagation: direct (high-risk interventions flag the immediate decision point only).
 */
export class RiskMagnitudeScorer implements SignalScorer {
  readonly scoringType = ScoringType.RISK_INVERSE;

  declareRequiredInputs(node: GraphNode, _signalConfig: SignalDefinition): RequiredInput[] {
    if (node.nodeType === 'Criterion' || node.nodeType === 'Medication' || node.nodeType === 'Procedure') {
      return [
        { name: 'risk_value', source: 'graph_node', required: false },
      ];
    }
    return [];
  }

  score(params: ScorerParams): SignalScore {
    const { node } = params;

    // Look for risk value in node properties
    const riskValue = node.properties.base_rate as number | undefined
      ?? node.properties.risk_value as number | undefined;

    if (riskValue === undefined || riskValue === null) {
      return {
        score: NO_DATA_SCORE,
        missingInputs: ['risk_value'],
        metadata: { reason: 'no_risk_data' },
      };
    }

    // Validate: risk must be non-negative
    if (riskValue < 0) {
      return {
        score: NO_DATA_SCORE,
        missingInputs: ['risk_value'],
        metadata: { reason: 'negative_risk_value', riskValue },
      };
    }

    // Formula: clamp(0.10, 1.0 - (log10(risk * 1000 + 1) / 3.0), 1.0)
    const rawScore = 1.0 - (Math.log10(riskValue * 1000 + 1) / 3.0);
    const score = Math.min(1.0, Math.max(FLOOR_SCORE, rawScore));

    return {
      score: Math.round(score * 100) / 100, // Round to 2 decimal places
      missingInputs: [],
      metadata: { riskValue, rawScore },
    };
  }

  propagate(params: PropagationParams): PropagationResult {
    const { sourceScore, propagationConfig } = params;

    if (propagationConfig.mode === 'none') {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    return {
      propagatedScore: sourceScore,
      shouldPropagate: false, // direct = one hop
    };
  }
}
