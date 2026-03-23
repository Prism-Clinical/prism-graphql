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

interface CustomRule {
  condition: 'code_present' | 'field_exists' | 'value_in_range' | 'field_equals';
  params: Record<string, unknown>;
  score: number;
}

/**
 * Generic scorer for institution-defined custom rules.
 * Evaluates rules[] in order, returns the score of the first matching rule
 * or default_score if none match.
 *
 * Supported conditions:
 * - code_present: { system, codes[] } — patient has any of the codes
 * - field_exists: { field_path } — dotted path exists in patient context
 * - value_in_range: { field_path, min?, max? } — numeric field in range
 * - field_equals: { field_path, value } — field matches exact value
 */
export class CustomRulesScorer implements SignalScorer {
  readonly scoringType = ScoringType.CUSTOM_RULES;

  declareRequiredInputs(_node: GraphNode, _signalConfig: SignalDefinition): RequiredInput[] {
    return [
      { name: 'patient_context', source: 'patient_context', required: false },
    ];
  }

  score(params: ScorerParams): SignalScore {
    const { signalDefinition, patientContext } = params;
    const rules = (signalDefinition.scoringRules.rules as CustomRule[]) ?? [];
    const defaultScore = (signalDefinition.scoringRules.default_score as number) ?? 0.5;

    for (const rule of rules) {
      if (this.evaluateCondition(rule, patientContext)) {
        return {
          score: rule.score,
          missingInputs: [],
          metadata: { matchedRule: rule.condition, params: rule.params },
        };
      }
    }

    return {
      score: defaultScore,
      missingInputs: [],
      metadata: { reason: 'no_rules_matched' },
    };
  }

  propagate(params: PropagationParams): PropagationResult {
    const { sourceScore, propagationConfig, hopDistance } = params;

    if (propagationConfig.mode === 'none') {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    if (propagationConfig.mode === 'direct') {
      return { propagatedScore: sourceScore, shouldPropagate: false };
    }

    // transitive_with_decay
    const maxHops = propagationConfig.maxHops ?? 3;
    if (hopDistance > maxHops) {
      return { propagatedScore: 0, shouldPropagate: false };
    }

    const decay = propagationConfig.decayFactor ?? 0.8;
    return {
      propagatedScore: sourceScore * Math.pow(decay, hopDistance),
      shouldPropagate: hopDistance < maxHops,
    };
  }

  private evaluateCondition(rule: CustomRule, patient: PatientContext): boolean {
    switch (rule.condition) {
      case 'code_present':
        return this.evalCodePresent(rule.params, patient);
      case 'field_exists':
        return this.evalFieldExists(rule.params, patient);
      case 'value_in_range':
        return this.evalValueInRange(rule.params, patient);
      case 'field_equals':
        return this.evalFieldEquals(rule.params, patient);
      default:
        return false;
    }
  }

  private evalCodePresent(params: Record<string, unknown>, patient: PatientContext): boolean {
    const system = params.system as string;
    const codes = params.codes as string[];
    if (!system || !codes) return false;

    const allCodes = [
      ...patient.conditionCodes,
      ...patient.medications,
      ...patient.allergies,
      ...patient.labResults.map(l => ({ code: l.code, system: l.system })),
    ];

    return allCodes.some(c => c.system === system && codes.includes(c.code));
  }

  private evalFieldExists(params: Record<string, unknown>, patient: PatientContext): boolean {
    const fieldPath = params.field_path as string;
    if (!fieldPath) return false;
    return this.getNestedValue(patient as unknown as Record<string, unknown>, fieldPath) !== undefined;
  }

  private evalValueInRange(params: Record<string, unknown>, patient: PatientContext): boolean {
    const fieldPath = params.field_path as string;
    if (!fieldPath) return false;

    const value = this.getNestedValue(patient as unknown as Record<string, unknown>, fieldPath);
    if (typeof value !== 'number') return false;

    const min = params.min as number | undefined;
    const max = params.max as number | undefined;

    if (min !== undefined && value < min) return false;
    if (max !== undefined && value > max) return false;

    return true;
  }

  private evalFieldEquals(params: Record<string, unknown>, patient: PatientContext): boolean {
    const fieldPath = params.field_path as string;
    const expectedValue = params.value;
    if (!fieldPath) return false;

    const actual = this.getNestedValue(patient as unknown as Record<string, unknown>, fieldPath);
    return actual === expectedValue;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
