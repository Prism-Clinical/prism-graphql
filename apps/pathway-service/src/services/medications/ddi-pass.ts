/**
 * DDI finding shapes, and the one piece of DDI logic the evaluation pipeline
 * shares: turning an interaction result into a finding.
 *
 * The orchestration that used to live here (runPatientContextDdi,
 * runCrossRecommendationDdi) queried the database per pass and silently
 * skipped a drug it could not normalise. The pipeline reads one safety
 * reference per snapshot instead (C4) and reports an unnormalised drug
 * (D14): see services/resolution/pipeline/safety.ts.
 *
 * Findings sort into suppress vs warn per Decision 5:
 *   CONTRAINDICATED + SEVERE → SUPPRESS
 *   MODERATE                 → WARN
 *   MINOR                    → dropped (not surfaced)
 */

import type { DdiSeverity, InteractionResult } from './ddi-engine';
import type { NormalizedMedication } from './types';

// ─── Inputs ───────────────────────────────────────────────────────────

export interface DdiCandidate {
  /** Stable identifier for the recommendation in the caller's domain. */
  recommendationId: string;
  /** Display name (used in findings even when normalization fails). */
  drugName: string;
  /** Optional code system / code, like MedicationInput. */
  system?: string;
  code?: string;
  /** Caller-attached metadata, threaded through unchanged. */
  meta?: Record<string, unknown>;
}

// ─── Findings ─────────────────────────────────────────────────────────

export type DdiAction = 'SUPPRESS' | 'WARN';

export type DdiSource =
  | { kind: 'PATIENT_MEDICATION'; rxcui: string; name: string }
  | { kind: 'PATIENT_ALLERGY'; snomedCode: string; snomedDisplay: string }
  | { kind: 'OTHER_RECOMMENDATION'; recommendationId: string; drugName: string };

export interface DdiFinding {
  recommendationId: string;
  drugName: string;
  action: DdiAction;
  severity: DdiSeverity;
  /** Reason category — directly maps to GraphQL SuppressionReason / warning kind. */
  category: 'DDI_CONTRAINDICATED' | 'DDI_SEVERE' | 'DDI_MODERATE' | 'ALLERGY';
  mechanism: string | null;
  clinicalAdvice: string | null;
  source: DdiSource;
  meta?: Record<string, unknown>;
}

// ─── Finding construction ─────────────────────────────────────────────

export function buildDrugDrugFinding(
  candidate: DdiCandidate,
  candidateNorm: NormalizedMedication,
  result: InteractionResult | null,
  source: DdiSource,
): DdiFinding | null {
  if (!result) return null;
  const action = severityToAction(result.severity);
  if (!action) return null; // MINOR: ignored
  return {
    recommendationId: candidate.recommendationId,
    drugName: candidate.drugName,
    action,
    severity: result.severity,
    category:
      result.severity === 'CONTRAINDICATED' ? 'DDI_CONTRAINDICATED'
        : result.severity === 'SEVERE'      ? 'DDI_SEVERE'
        : 'DDI_MODERATE',
    mechanism: result.mechanism,
    clinicalAdvice: result.clinicalAdvice,
    source,
    meta: candidate.meta,
  };
}

export function toEngineDrug(norm: NormalizedMedication): { rxcui: string; atcClasses: string[] } {
  return { rxcui: norm.ingredientRxcui, atcClasses: norm.atcClasses };
}

function severityToAction(severity: DdiSeverity): DdiAction | null {
  switch (severity) {
    case 'CONTRAINDICATED':
    case 'SEVERE':
      return 'SUPPRESS';
    case 'MODERATE':
      return 'WARN';
    case 'MINOR':
      return null;
  }
}
