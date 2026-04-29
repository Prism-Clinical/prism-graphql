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
  defaultDirectPropagate,
  GraphContext,
} from '../types';
import { getLinkedCodes, getLinkedCodesBySystem } from '../code-lookup';

/**
 * Scores how well the patient's clinical codes match a node's expected codes.
 * Match levels: exact 1.0, parent prefix 0.7, inferred 0.5, absent 0.0.
 * Critical criteria missing → score capped at 0.5.
 *
 * Propagation: direct (one hop — a poorly matched criterion affects its parent
 * DecisionPoint but doesn't cascade further).
 */
export class PatientMatchQualityScorer implements SignalScorer {
  readonly scoringType = ScoringType.CRITERIA_MATCH;

  declareRequiredInputs(node: GraphNode, _signalConfig: SignalDefinition): RequiredInput[] {
    if (node.nodeType === 'Criterion' || node.nodeType === 'Medication' || node.nodeType === 'LabTest') {
      return [
        { name: 'condition_codes', source: 'patient_context', required: true },
        { name: 'medications', source: 'patient_context', required: false },
        { name: 'lab_results', source: 'patient_context', required: false },
      ];
    }
    return [];
  }

  score(params: ScorerParams): SignalScore {
    const { node, patientContext, graphContext } = params;

    switch (node.nodeType) {
      case 'Criterion':
        return this.scoreCriterion(node, patientContext, graphContext);
      case 'Medication':
        return this.scoreMedication(node, patientContext, graphContext);
      case 'LabTest':
        return this.scoreLabTest(node, patientContext, graphContext);
      default:
        return { score: 1.0, missingInputs: [] };
    }
  }

  propagate(params: PropagationParams): PropagationResult {
    return defaultDirectPropagate(params);
  }

  private scoreCriterion(node: GraphNode, patient: PatientContext, graphContext: GraphContext): SignalScore {
    const isCritical = node.properties.is_critical as boolean | undefined;

    // Use linked CodeEntry codes instead of node.properties.code_value
    const linkedCodes = getLinkedCodes(node, graphContext);

    if (linkedCodes.length === 0) {
      return { score: 0.5, missingInputs: ['code_value'], metadata: { reason: 'no_code_on_criterion' } };
    }

    // Find the best match across all linked codes
    let bestMatchScore = 0.0;
    for (const lc of linkedCodes) {
      const codes = this.getCodesForSystem(patient, lc.system);
      const matchScore = this.findBestMatch(lc.code, codes);
      if (matchScore > bestMatchScore) {
        bestMatchScore = matchScore;
      }
    }

    if (isCritical && bestMatchScore === 0.0) {
      return {
        score: 0.0,
        missingInputs: ['code_match'],
        metadata: { critical: true, expectedCodes: linkedCodes.map(c => c.code) },
      };
    }

    return {
      score: bestMatchScore,
      missingInputs: bestMatchScore === 0.0 ? ['code_match'] : [],
      metadata: { matchType: bestMatchScore === 1.0 ? 'exact' : bestMatchScore === 0.7 ? 'prefix' : bestMatchScore === 0.5 ? 'inferred' : 'absent' },
    };
  }

  private scoreMedication(node: GraphNode, patient: PatientContext, graphContext: GraphContext): SignalScore {
    // Use RXNORM codes from CodeEntry children for exact code matching
    const rxnormCodes = getLinkedCodesBySystem(node, graphContext, 'RXNORM');

    if (rxnormCodes.length > 0) {
      const hasCodeMatch = rxnormCodes.some(rx =>
        patient.medications.some(m => m.code === rx.code)
      );

      return {
        score: hasCodeMatch ? 1.0 : 0.0,
        missingInputs: hasCodeMatch ? [] : ['medication_match'],
        metadata: { matchType: hasCodeMatch ? 'code' : 'absent' },
      };
    }

    // Fall back to display-name matching only when no CodeEntry exists
    const medName = (node.properties.name as string || '').toLowerCase();

    const hasMatch = medName && patient.medications.some(
      m => m.display?.toLowerCase().includes(medName) || medName.includes(m.display?.toLowerCase() || '')
    );

    return {
      score: hasMatch ? 1.0 : 0.5,
      missingInputs: hasMatch ? [] : ['medication_match'],
      metadata: { matchType: hasMatch ? 'name' : 'fallback' },
    };
  }

  private scoreLabTest(node: GraphNode, patient: PatientContext, graphContext: GraphContext): SignalScore {
    // Use LOINC codes from CodeEntry children
    const loincCodes = getLinkedCodesBySystem(node, graphContext, 'LOINC');

    if (loincCodes.length > 0) {
      const hasMatch = loincCodes.some(lc =>
        patient.labResults.some(l => l.code === lc.code)
      );

      return {
        score: hasMatch ? 1.0 : 0.0,
        missingInputs: hasMatch ? [] : ['lab_match'],
        metadata: { matchType: hasMatch ? 'code' : 'absent' },
      };
    }

    return { score: 0.5, missingInputs: [], metadata: { reason: 'no_loinc_codes_linked' } };
  }

  private getCodesForSystem(patient: PatientContext, system: string): string[] {
    const codes: string[] = [];
    for (const c of patient.conditionCodes) {
      if (c.system === system) codes.push(c.code);
    }
    for (const m of patient.medications) {
      if (m.system === system) codes.push(m.code);
    }
    for (const l of patient.labResults) {
      if (l.system === system) codes.push(l.code);
    }
    return codes;
  }

  private findBestMatch(targetCode: string, patientCodes: string[]): number {
    if (patientCodes.includes(targetCode)) {
      return 1.0;
    }

    for (const code of patientCodes) {
      // Patient has more specific code than criterion requires — full match
      if (code.startsWith(targetCode)) {
        return 1.0;
      }
      // Patient has less specific code — partial match
      if (targetCode.startsWith(code)) {
        return 0.7;
      }
    }

    return 0.0;
  }
}
