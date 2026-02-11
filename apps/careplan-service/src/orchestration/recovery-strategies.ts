/**
 * Recovery Strategies
 *
 * Fallback and recovery strategies for pipeline failures.
 */

import {
  ExtractedEntities,
  CarePlanRecommendation,
  DraftCarePlan,
  RedFlag,
  RedFlagSeverity,
  DraftGoal,
  DraftIntervention,
} from './types';

/**
 * Fallback extraction result when extraction fails
 */
export function getFallbackExtractionResult(): ExtractedEntities {
  return {
    symptoms: [],
    medications: [],
    vitals: [],
    procedures: [],
    diagnoses: [],
    allergies: [],
    extractedAt: new Date(),
    modelVersion: 'fallback',
  };
}

/**
 * Fallback red flag indicating manual review needed
 */
export function getManualReviewRedFlag(): RedFlag {
  return {
    severity: RedFlagSeverity.MEDIUM,
    description: 'Entity extraction failed. Manual review of transcript recommended.',
    category: 'system',
    confidence: 1.0,
    recommendedAction: 'Please manually review the transcript for clinical entities.',
  };
}

/**
 * Default template recommendations when recommender fails
 */
export function getDefaultTemplateRecommendations(
  conditionCodes: string[]
): CarePlanRecommendation[] {
  // Map common ICD-10 code prefixes to generic templates
  const recommendations: CarePlanRecommendation[] = [];

  for (const code of conditionCodes) {
    const prefix = code.substring(0, 3).toUpperCase();

    // Map to common condition categories
    if (prefix.startsWith('E11') || prefix.startsWith('E10')) {
      recommendations.push({
        templateId: 'fallback-diabetes',
        title: 'Diabetes Management (Fallback)',
        confidence: 0.5,
        matchedConditions: [code],
        reasoning: 'Fallback recommendation based on ICD-10 code category',
      });
    } else if (prefix.startsWith('I10') || prefix.startsWith('I11')) {
      recommendations.push({
        templateId: 'fallback-hypertension',
        title: 'Hypertension Management (Fallback)',
        confidence: 0.5,
        matchedConditions: [code],
        reasoning: 'Fallback recommendation based on ICD-10 code category',
      });
    } else if (prefix.startsWith('J44') || prefix.startsWith('J45')) {
      recommendations.push({
        templateId: 'fallback-respiratory',
        title: 'Respiratory Disease Management (Fallback)',
        confidence: 0.5,
        matchedConditions: [code],
        reasoning: 'Fallback recommendation based on ICD-10 code category',
      });
    } else if (prefix.startsWith('M54') || prefix.startsWith('M79')) {
      recommendations.push({
        templateId: 'fallback-pain',
        title: 'Pain Management (Fallback)',
        confidence: 0.5,
        matchedConditions: [code],
        reasoning: 'Fallback recommendation based on ICD-10 code category',
      });
    } else if (prefix.startsWith('F32') || prefix.startsWith('F33')) {
      recommendations.push({
        templateId: 'fallback-depression',
        title: 'Depression Management (Fallback)',
        confidence: 0.5,
        matchedConditions: [code],
        reasoning: 'Fallback recommendation based on ICD-10 code category',
      });
    }
  }

  // If no specific matches, return a generic recommendation
  if (recommendations.length === 0) {
    recommendations.push({
      templateId: 'fallback-general',
      title: 'General Care Plan (Fallback)',
      confidence: 0.3,
      matchedConditions: conditionCodes,
      reasoning: 'Fallback recommendation - ML service unavailable',
    });
  }

  // Add a flag indicating these are fallback recommendations
  return recommendations.map((r) => ({
    ...r,
    title: r.title,
    reasoning: `[FALLBACK] ${r.reasoning}`,
  }));
}

/**
 * Generate a minimal draft care plan when draft generation fails
 */
export function getFallbackDraftCarePlan(
  conditionCodes: string[],
  templateId?: string
): DraftCarePlan {
  const goals: DraftGoal[] = [
    {
      description: 'Conduct comprehensive assessment and develop personalized care plan',
      priority: 'HIGH',
      guidelineReference: 'Manual review required',
    },
    {
      description: 'Schedule follow-up appointment within 2 weeks',
      priority: 'MEDIUM',
      targetDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  ];

  const interventions: DraftIntervention[] = [
    {
      type: 'FOLLOW_UP',
      description: 'Schedule follow-up visit for care plan review',
      scheduledDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      patientInstructions: 'Please schedule a follow-up appointment.',
    },
    {
      type: 'EDUCATION',
      description: 'Provide patient education materials',
      patientInstructions: 'Review educational materials provided by your care team.',
    },
  ];

  return {
    id: `fallback-draft-${Date.now()}`,
    title: 'Care Plan Draft (Requires Review)',
    conditionCodes,
    templateId,
    goals,
    interventions,
    generatedAt: new Date(),
    confidence: 0.3,
    requiresReview: true,
  };
}

/**
 * Skip personalization and use condition-only matching
 */
export function skipPersonalization(): {
  embedding: null;
  useConditionOnlyMatching: boolean;
} {
  return {
    embedding: null,
    useConditionOnlyMatching: true,
  };
}

/**
 * Merge fallback results with partial results
 */
export function mergeWithFallback<T>(
  partial: Partial<T> | undefined,
  fallback: T
): T {
  if (!partial) return fallback;
  return { ...fallback, ...partial };
}

/**
 * Create degradation notice for clients
 */
export interface DegradationNotice {
  /** Services that degraded */
  affectedServices: string[];
  /** Impact on results */
  impact: string;
  /** Suggested actions */
  suggestedActions: string[];
  /** Whether manual review is recommended */
  manualReviewRecommended: boolean;
}

/**
 * Generate degradation notice based on failed services
 */
export function generateDegradationNotice(
  degradedServices: string[],
  fallbacksUsed: string[]
): DegradationNotice {
  const impacts: string[] = [];
  const actions: string[] = [];
  let manualReviewRecommended = false;

  for (const service of degradedServices) {
    switch (service) {
      case 'audio-intelligence':
        impacts.push('Entity extraction not available');
        actions.push('Review transcript manually for clinical entities');
        manualReviewRecommended = true;
        break;

      case 'careplan-recommender':
        impacts.push('Template recommendations may be less accurate');
        actions.push('Consider browsing all available templates');
        break;

      case 'rag-embeddings':
        impacts.push('Personalization not available');
        actions.push('Results based on condition codes only');
        break;

      case 'pdf-parser':
        impacts.push('PDF import not available');
        actions.push('Try again later or enter care plan manually');
        break;
    }
  }

  if (fallbacksUsed.length > 0) {
    impacts.push(`Fallback responses used for: ${fallbacksUsed.join(', ')}`);
    actions.push('Review results carefully before accepting');
    manualReviewRecommended = true;
  }

  return {
    affectedServices: degradedServices,
    impact: impacts.join('. '),
    suggestedActions: actions,
    manualReviewRecommended,
  };
}

/**
 * Safety validation fallback
 */
export interface SafetyValidationResult {
  /** Whether content passed safety checks */
  passed: boolean;
  /** Safety concerns found */
  concerns: string[];
  /** Whether to block the response */
  shouldBlock: boolean;
}

/**
 * Conservative safety validation when service is unavailable
 * Returns passed=true but with requiresReview flag
 */
export function getConservativeSafetyResult(): SafetyValidationResult {
  return {
    passed: true,
    concerns: ['Safety validation service unavailable - manual review required'],
    shouldBlock: false,
  };
}

/**
 * Combine red flags from multiple sources
 */
export function combineRedFlags(
  extractionFlags: RedFlag[],
  safetyFlags: RedFlag[],
  systemFlags: RedFlag[]
): RedFlag[] {
  const allFlags = [...extractionFlags, ...safetyFlags, ...systemFlags];

  // Sort by severity (critical first)
  const severityOrder: RedFlagSeverity[] = [
    RedFlagSeverity.CRITICAL,
    RedFlagSeverity.HIGH,
    RedFlagSeverity.MEDIUM,
    RedFlagSeverity.LOW,
  ];

  return allFlags.sort((a, b) => {
    return severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
  });
}

/**
 * Determine if result requires manual review based on flags and degradation
 */
export function requiresManualReview(
  redFlags: RedFlag[],
  degradedServices: string[],
  draftConfidence?: number
): boolean {
  // Critical red flags always require review
  if (redFlags.some((f) => f.severity === RedFlagSeverity.CRITICAL)) {
    return true;
  }

  // Audio intelligence degradation requires review
  if (degradedServices.includes('audio-intelligence')) {
    return true;
  }

  // Low confidence drafts require review
  if (draftConfidence !== undefined && draftConfidence < 0.5) {
    return true;
  }

  // Multiple high severity flags require review
  const highSeverityCount = redFlags.filter(
    (f) => f.severity === RedFlagSeverity.HIGH
  ).length;
  if (highSeverityCount >= 2) {
    return true;
  }

  return false;
}
