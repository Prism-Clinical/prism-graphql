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
  defaultTransitivePropagate,
  GraphContext,
} from '../types';
import { getLinkedCodes, getLinkedCodesBySystem } from '../code-lookup';

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
    const { node, patientContext, graphContext } = params;

    switch (node.nodeType) {
      case 'LabTest':
        return this.scoreLabTest(node, patientContext, graphContext);
      case 'Medication':
        return this.scoreMedication(node, patientContext, graphContext);
      case 'Criterion':
        return this.scoreCriterion(node, patientContext, graphContext);
      case 'DecisionPoint':
        return this.scoreDecisionPoint(node, params);
      default:
        // Structural nodes always complete
        return { score: 1.0, missingInputs: [] };
    }
  }

  propagate(params: PropagationParams): PropagationResult {
    return defaultTransitivePropagate(params);
  }

  private scoreLabTest(node: GraphNode, patient: PatientContext, graphContext: GraphContext): SignalScore {
    // Look up LOINC codes from CodeEntry children via HAS_CODE edges
    const loincCodes = getLinkedCodesBySystem(node, graphContext, 'LOINC');

    if (loincCodes.length === 0) {
      return { score: 0.5, missingInputs: ['lab_codes'], metadata: { reason: 'no_loinc_codes_linked' } };
    }

    const total = loincCodes.length * 2; // For each code: result_value + result_date
    let available = 0;
    const missingInputs: string[] = [];

    for (const loinc of loincCodes) {
      const matchingLab = patient.labResults.find(l => l.code === loinc.code);
      if (!matchingLab) {
        missingInputs.push(`result_value:${loinc.code}`, `result_date:${loinc.code}`);
        continue;
      }

      if (matchingLab.value !== undefined && matchingLab.value !== null) {
        available += 1;
      } else {
        missingInputs.push(`result_value:${loinc.code}`);
      }

      if (matchingLab.date) {
        available += 1;
      } else {
        missingInputs.push(`result_date:${loinc.code}`);
      }
    }

    return { score: available / total, missingInputs };
  }

  private scoreMedication(node: GraphNode, patient: PatientContext, graphContext: GraphContext): SignalScore {
    const rxnormCodes = getLinkedCodesBySystem(node, graphContext, 'RXNORM');
    const missingInputs: string[] = [];
    let available = 0;
    let total = 0;

    if (rxnormCodes.length > 0) {
      // Check if patient has the medication in their med list (code match)
      total += rxnormCodes.length;
      for (const rx of rxnormCodes) {
        if (patient.medications.some(m => m.code === rx.code)) {
          available += 1;
        } else {
          missingInputs.push(`medication_match:${rx.code}`);
        }
      }

      // Check allergy data availability (one check for the whole node)
      total += 1;
      if (patient.allergies.length > 0) {
        available += 1;
      } else {
        missingInputs.push('allergies_checked');
      }
    } else {
      // Fall back to name-based matching when no RXNORM codes
      const medName = (node.properties.name as string || '').toLowerCase();
      total = 2;

      if (medName && patient.medications.some(
        m => m.display?.toLowerCase().includes(medName) || medName.includes(m.display?.toLowerCase() || '')
      )) {
        available += 1;
      } else {
        missingInputs.push('medication_match');
      }

      if (patient.allergies.length > 0) {
        available += 1;
      } else {
        missingInputs.push('allergies_checked');
      }
    }

    return { score: total > 0 ? available / total : 0.5, missingInputs };
  }

  private scoreCriterion(node: GraphNode, patient: PatientContext, graphContext: GraphContext): SignalScore {
    // Look up all codes from CodeEntry children — criteria may link to ICD-10, SNOMED, etc.
    const linkedCodes = getLinkedCodes(node, graphContext);

    if (linkedCodes.length === 0) {
      return { score: 0.5, missingInputs: ['code_match'], metadata: { reason: 'no_code_on_criterion' } };
    }

    // Check if any linked code matches patient condition codes (exact or prefix match)
    const hasMatch = linkedCodes.some(lc =>
      patient.conditionCodes.some(
        pc => pc.code === lc.code && pc.system === lc.system
      ) ||
      // Prefix match: patient has a more specific code
      patient.conditionCodes.some(
        pc => pc.system === lc.system && pc.code.startsWith(lc.code)
      )
    );

    if (hasMatch) {
      return { score: 1.0, missingInputs: [] };
    }

    return { score: 0.0, missingInputs: ['code_match'] };
  }

  private scoreDecisionPoint(node: GraphNode, params: ScorerParams): SignalScore {
    const { graphContext, patientContext } = params;
    // Check how many criteria are connected and have data
    const criteria = graphContext.linkedNodes(node.nodeIdentifier, 'HAS_CRITERION');

    if (criteria.length === 0) {
      return { score: 1.0, missingInputs: [] }; // No criteria = nothing to check
    }

    let resolved = 0;
    const missingInputs: string[] = [];

    for (const crit of criteria) {
      const critScore = this.scoreCriterion(crit, patientContext, graphContext);
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
