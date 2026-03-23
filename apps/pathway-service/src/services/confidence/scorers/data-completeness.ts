// apps/pathway-service/src/services/confidence/scorers/data-completeness.ts

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
  PatientContext,
} from '../types';

/**
 * Scores data availability for a node. Node-type-specific required inputs:
 * - LabTest: result_value, result_date
 * - Medication: allergies_checked, interactions_checked
 * - DecisionPoint: criteria inputs resolved
 * - Stage/Step/EvidenceCitation/etc.: always 1.0 (structural nodes, no data dependency)
 *
 * Propagation: transitive_with_decay (default). Missing upstream data degrades downstream.
 */
export class DataCompletenessScorer implements SignalScorer {
  readonly scoringType = ScoringType.DATA_PRESENCE;

  declareRequiredInputs(node: GraphNode, _signalConfig: SignalDefinition): RequiredInput[] {
    switch (node.nodeType) {
      case 'LabTest':
        return [
          { name: 'result_value', source: 'patient_context', required: true },
          { name: 'result_date', source: 'patient_context', required: false },
        ];
      case 'Medication':
        return [
          { name: 'allergies_checked', source: 'patient_context', required: true },
          { name: 'interactions_checked', source: 'patient_context', required: false },
        ];
      case 'DecisionPoint':
        return [
          { name: 'criteria_resolved', source: 'graph_node', required: true },
        ];
      case 'Criterion':
        return [
          { name: 'code_match', source: 'patient_context', required: true },
        ];
      default:
        // Structural nodes (Stage, Step, EvidenceCitation, etc.) — no data dependency
        return [];
    }
  }

  score(params: ScorerParams): SignalScore {
    const { node, patientContext } = params;

    switch (node.nodeType) {
      case 'LabTest':
        return this.scoreLabTest(node, patientContext);
      case 'Medication':
        return this.scoreMedication(node, patientContext);
      case 'Criterion':
        return this.scoreCriterion(node, patientContext);
      case 'DecisionPoint':
        return this.scoreDecisionPoint(node, params);
      default:
        // Structural nodes always complete
        return { score: 1.0, missingInputs: [] };
    }
  }

  propagate(params: PropagationParams): PropagationResult {
    const { sourceScore, propagationConfig, hopDistance } = params;

    if (propagationConfig.mode === 'none') {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    if (propagationConfig.mode === 'direct') {
      return {
        propagatedScore: sourceScore,
        shouldPropagate: false, // direct = one hop only
      };
    }

    // transitive_with_decay
    const maxHops = propagationConfig.maxHops ?? 3;
    if (hopDistance > maxHops) {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    const decay = propagationConfig.decayFactor ?? 0.8;
    return {
      propagatedScore: sourceScore * decay,
      shouldPropagate: hopDistance < maxHops,
    };
  }

  private scoreLabTest(node: GraphNode, patient: PatientContext): SignalScore {
    const codeValue = node.properties.code_value as string | undefined;
    const missingInputs: string[] = [];
    const total = 2; // result_value + result_date
    let available = 0;

    if (!codeValue) {
      return { score: 0.0, missingInputs: ['result_value', 'result_date'] };
    }

    const matchingLab = patient.labResults.find(l => l.code === codeValue);
    if (!matchingLab) {
      return { score: 0.0, missingInputs: ['result_value', 'result_date'] };
    }

    if (matchingLab.value !== undefined && matchingLab.value !== null) {
      available += 1;
    } else {
      missingInputs.push('result_value');
    }

    if (matchingLab.date) {
      available += 1;
    } else {
      missingInputs.push('result_date');
    }

    return { score: available / total, missingInputs };
  }

  private scoreMedication(node: GraphNode, patient: PatientContext): SignalScore {
    const missingInputs: string[] = [];
    let available = 0;
    const total = 2;

    // Check if allergies have been assessed (patient has allergy data)
    if (patient.allergies.length > 0) {
      available += 1;
    } else {
      missingInputs.push('allergies_checked');
    }

    // Check if medication interactions are assessable (patient has medication list)
    if (patient.medications.length > 0) {
      available += 1;
    } else {
      missingInputs.push('interactions_checked');
    }

    return { score: available / total, missingInputs };
  }

  private scoreCriterion(node: GraphNode, patient: PatientContext): SignalScore {
    const codeValue = node.properties.code_value as string | undefined;
    const codeSystem = node.properties.code_system as string | undefined;

    if (!codeValue || !codeSystem) {
      return { score: 0.5, missingInputs: ['code_match'], metadata: { reason: 'no_code_on_criterion' } };
    }

    const hasMatch = patient.conditionCodes.some(
      c => c.code === codeValue && c.system === codeSystem
    );

    if (hasMatch) {
      return { score: 1.0, missingInputs: [] };
    }

    return { score: 0.0, missingInputs: ['code_match'] };
  }

  private scoreDecisionPoint(node: GraphNode, params: ScorerParams): SignalScore {
    const { graphContext } = params;
    // Check how many criteria are connected and have data
    const criteria = graphContext.linkedNodes(node.nodeIdentifier, 'HAS_CRITERION');

    if (criteria.length === 0) {
      return { score: 1.0, missingInputs: [] }; // No criteria = nothing to check
    }

    let resolved = 0;
    const missingInputs: string[] = [];

    for (const crit of criteria) {
      const critScore = this.scoreCriterion(crit, params.patientContext);
      if (critScore.score > 0) {
        resolved++;
      } else {
        missingInputs.push(`criterion_${crit.nodeIdentifier}`);
      }
    }

    return {
      score: resolved / criteria.length,
      missingInputs,
    };
  }
}
