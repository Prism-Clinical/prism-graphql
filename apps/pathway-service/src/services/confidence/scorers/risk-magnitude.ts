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
  defaultDirectPropagate,
} from '../types';
import { getLinkedCodesBySystem } from '../code-lookup';

const NO_DATA_SCORE = 0.50;
const FLOOR_SCORE = 0.10;
const PROCEDURE_DEFAULT_SCORE = 0.60;

/**
 * Inverse risk scoring: higher risk → lower confidence.
 * Formula: max(0.10, 1.0 - (log10(risk * 1000 + 1) / 3.0))
 * No data → 0.50.
 *
 * Node-type-aware defaults when `base_rate` is absent:
 * - Medication: checks patient allergies for RXNORM code match → 0.10 if allergy found
 * - Procedure: defaults to 0.60 (moderate inherent risk)
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
    const { node, patientContext, graphContext } = params;

    // Look for risk value in node properties
    const riskValue = node.properties.base_rate as number | undefined
      ?? node.properties.risk_value as number | undefined;

    if (riskValue !== undefined && riskValue !== null) {
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

    // Node-type-aware defaults when base_rate is absent
    if (node.nodeType === 'Medication') {
      // Check patient allergies for the medication's RXNORM codes
      const rxnormCodes = getLinkedCodesBySystem(node, graphContext, 'RXNORM');
      if (rxnormCodes.length > 0) {
        const allergyMatch = rxnormCodes.some(rx =>
          patientContext.allergies.some(a => a.code === rx.code)
        );
        if (allergyMatch) {
          return {
            score: FLOOR_SCORE,
            missingInputs: [],
            metadata: { reason: 'allergy_match', allergyDetected: true },
          };
        }
      }
    }

    if (node.nodeType === 'Procedure') {
      return {
        score: PROCEDURE_DEFAULT_SCORE,
        missingInputs: ['risk_value'],
        metadata: { reason: 'procedure_default' },
      };
    }

    return {
      score: NO_DATA_SCORE,
      missingInputs: ['risk_value'],
      metadata: { reason: 'no_risk_data' },
    };
  }

  propagate(params: PropagationParams): PropagationResult {
    return defaultDirectPropagate(params);
  }
}
