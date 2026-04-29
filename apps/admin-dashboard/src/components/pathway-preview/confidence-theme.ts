import type { ResolutionType, WeightSource } from '@/types';

/**
 * Maps confidence scores to encounter CSS variable names
 * instead of Tailwind classes. These are used inline via
 * style={{ color: 'var(--ok)' }} etc.
 */

export function confidenceCssColor(score: number): string {
  if (score >= 0.85) return 'var(--ok)';
  if (score >= 0.60) return 'var(--warn)';
  return 'var(--danger)';
}

export function confidenceCssBg(score: number): string {
  if (score >= 0.85) return 'var(--ok-soft)';
  if (score >= 0.60) return 'var(--warn-soft)';
  return 'var(--danger-soft)';
}

export function confidenceCssBorder(score: number): string {
  if (score >= 0.85) return 'var(--ok)';
  if (score >= 0.60) return 'var(--warn)';
  return 'var(--danger)';
}

export function resolutionCssColor(type: ResolutionType): string {
  switch (type) {
    case 'AUTO_RESOLVED': return 'var(--ok)';
    case 'SYSTEM_SUGGESTED': return 'var(--brand)';
    case 'PROVIDER_DECIDED': return 'var(--warn)';
    case 'FORCED_MANUAL': return 'var(--danger)';
    default: return 'var(--ink-3)';
  }
}

export function resolutionCssBg(type: ResolutionType): string {
  switch (type) {
    case 'AUTO_RESOLVED': return 'var(--ok-soft)';
    case 'SYSTEM_SUGGESTED': return 'var(--brand-soft)';
    case 'PROVIDER_DECIDED': return 'var(--warn-soft)';
    case 'FORCED_MANUAL': return 'var(--danger-soft)';
    default: return 'var(--panel-2)';
  }
}

export function resolutionLabel(type: ResolutionType): string {
  switch (type) {
    case 'AUTO_RESOLVED': return 'Auto-Resolved';
    case 'SYSTEM_SUGGESTED': return 'System Suggested';
    case 'PROVIDER_DECIDED': return 'Provider Decision';
    case 'FORCED_MANUAL': return 'Manual Only';
    default: return type;
  }
}

/** Node type tag color using encounter CSS vars */
export function nodeTypeCssColor(type: string): string {
  switch (type) {
    case 'Stage': return 'var(--brand)';
    case 'Step': return 'var(--accent)';
    case 'DecisionPoint': return 'var(--ai)';
    case 'Criterion': return 'var(--inst)';
    case 'Medication': return 'var(--ok)';
    case 'LabTest': return 'var(--brand)';
    case 'Procedure': return 'var(--danger)';
    default: return 'var(--ink-3)';
  }
}

export function weightSourceLabel(source: WeightSource | string): string {
  switch (source) {
    case 'NODE_OVERRIDE': return 'Node Override';
    case 'PATHWAY_OVERRIDE': return 'Pathway Override';
    case 'INSTITUTION_GLOBAL': return 'Institution';
    case 'ORGANIZATION_GLOBAL': return 'Organization';
    case 'SYSTEM_DEFAULT': return 'System Default';
    default: return source;
  }
}

export const SIGNAL_DISPLAY_NAMES: Record<string, string> = {
  data_completeness: 'Data Completeness',
  evidence_strength: 'Evidence Strength',
  match_quality: 'Match Quality',
  risk_magnitude: 'Risk Magnitude',
};

export function nodeTypeCssBg(type: string): string {
  switch (type) {
    case 'Stage': return 'var(--brand-soft)';
    case 'Step': return 'var(--accent-soft)';
    case 'DecisionPoint': return 'var(--ai-soft)';
    case 'Criterion': return 'var(--inst-soft)';
    case 'Medication': return 'var(--ok-soft)';
    case 'LabTest': return 'var(--brand-soft)';
    case 'Procedure': return 'var(--danger-soft)';
    default: return 'var(--panel-2)';
  }
}
