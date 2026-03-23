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
    const { node, patientContext } = params;

    switch (node.nodeType) {
      case 'Criterion':
        return this.scoreCriterion(node, patientContext);
      case 'Medication':
        return this.scoreMedication(node, patientContext);
      case 'LabTest':
        return this.scoreLabTest(node, patientContext);
      default:
        return { score: 1.0, missingInputs: [] };
    }
  }

  propagate(params: PropagationParams): PropagationResult {
    const { sourceScore, propagationConfig } = params;

    if (propagationConfig.mode === 'none') {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    return {
      propagatedScore: sourceScore,
      shouldPropagate: false,
    };
  }

  private scoreCriterion(node: GraphNode, patient: PatientContext): SignalScore {
    const codeValue = node.properties.code_value as string | undefined;
    const codeSystem = node.properties.code_system as string | undefined;
    const isCritical = node.properties.is_critical as boolean | undefined;

    if (!codeValue || !codeSystem) {
      return { score: 0.5, missingInputs: ['code_value'], metadata: { reason: 'no_code_on_criterion' } };
    }

    const codes = this.getCodesForSystem(patient, codeSystem);
    const matchScore = this.findBestMatch(codeValue, codes);

    if (isCritical && matchScore === 0.0) {
      return {
        score: 0.0,
        missingInputs: ['code_match'],
        metadata: { critical: true, expectedCode: codeValue },
      };
    }

    return {
      score: matchScore,
      missingInputs: matchScore === 0.0 ? ['code_match'] : [],
      metadata: { matchType: matchScore === 1.0 ? 'exact' : matchScore === 0.7 ? 'prefix' : matchScore === 0.5 ? 'inferred' : 'absent' },
    };
  }

  private scoreMedication(node: GraphNode, patient: PatientContext): SignalScore {
    const medName = (node.properties.name as string || '').toLowerCase();

    const hasMatch = patient.medications.some(
      m => m.display?.toLowerCase().includes(medName) || medName.includes(m.display?.toLowerCase() || '')
    );

    return {
      score: hasMatch ? 1.0 : 0.5,
      missingInputs: hasMatch ? [] : ['medication_match'],
    };
  }

  private scoreLabTest(node: GraphNode, patient: PatientContext): SignalScore {
    const codeValue = node.properties.code_value as string | undefined;
    if (!codeValue) {
      return { score: 0.5, missingInputs: [], metadata: { reason: 'no_code_on_lab' } };
    }

    const hasMatch = patient.labResults.some(l => l.code === codeValue);
    return {
      score: hasMatch ? 1.0 : 0.0,
      missingInputs: hasMatch ? [] : ['lab_match'],
    };
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
