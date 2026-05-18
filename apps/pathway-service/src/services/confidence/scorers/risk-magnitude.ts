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

/**
 * Inverse risk scoring: higher risk → lower confidence.
 * Formula: max(0.10, 1.0 - (log10(risk * 1000 + 1) / 3.0)).
 *
 * When the scorer can't compute a real risk score (no `risk_value` declared,
 * negative payload, etc.) it sets `skipped: true` so the engine excludes it
 * from the weighted average — risk that's genuinely unknown is neither good
 * nor bad for the recommendation, so it shouldn't drag confidence down to
 * 0.5. The UI surfaces this as "Risk profile: Unknown."
 *
 * Node-type-aware non-skip path:
 * - Medication: if any of the med's RXNORM codes match a patient allergy,
 *   score 0.10 and DO contribute (allergy match = known high risk).
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
      // Validate: risk must be non-negative. A bad payload is treated as
      // unknown rather than as a neutral guess, so it doesn't contribute.
      if (riskValue < 0) {
        return {
          score: NO_DATA_SCORE,
          missingInputs: ['risk_value'],
          metadata: { reason: 'negative_risk_value', riskValue },
          skipped: true,
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

    // Node-type-aware fallback: a Medication that matches a patient allergy
    // is meaningfully high-risk (we know it's bad), so this contributes.
    if (node.nodeType === 'Medication') {
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

    // No known risk_value (and no node-type rule fired): risk is genuinely
    // unknown. Skip so it doesn't artificially deflate confidence. The UI
    // surfaces this as "Risk profile: Unknown" with an authoring suggestion
    // to declare risk_value on the node.
    return {
      score: NO_DATA_SCORE,
      missingInputs: ['risk_value'],
      metadata: {
        reason: node.nodeType === 'Procedure' ? 'procedure_no_risk_value' : 'no_risk_data',
      },
      skipped: true,
    };
  }

  propagate(params: PropagationParams): PropagationResult {
    return defaultDirectPropagate(params);
  }
}
