/**
 * DDI orchestration layer.
 *
 * Sits between the engine (pure SQL lookups) and the resolver (graph mutation
 * + persistence). Responsibilities:
 *   1. For each candidate medication, normalize-by-cache to ingredient RxCUI
 *      + ATC classes (cache-only — Decision 3).
 *   2. For each candidate, run drug↔drug checks against patient meds and
 *      drug↔allergy checks against patient allergies.
 *   3. (Multi-pathway only) Run drug↔drug checks across the candidate set —
 *      see runCrossRecommendationDdi.
 *   4. Sort findings into suppress vs warn buckets per Decision 5:
 *        CONTRAINDICATED + SEVERE → SUPPRESS
 *        MODERATE                 → WARN
 *        MINOR                    → ignore (logged, not surfaced)
 *
 * Returns a structured result the caller can apply to its session shape
 * (single-pathway: mutate resolutionState; multi-pathway: prune from merge
 * input). Pure-ish — only side effect is the cache-read on the pool.
 */

import { Pool } from 'pg';
import { PatientContext } from '../confidence/types';
import {
  checkDrugAllergy,
  checkDrugDrugInteraction,
  AllergyMatchResult,
  DdiSeverity,
  InteractionResult,
} from './ddi-engine';
import { lookupNormalizedMedication } from './normalizer';
import { NormalizedMedication } from './types';

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

export interface DdiPassResult {
  findings: DdiFinding[];
  /** recommendationIds whose action is SUPPRESS — caller drops them. */
  suppressedRecommendationIds: Set<string>;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Run DDI checks against patient context only (used by single-pathway flow
 * and the pre-merge stage of multi-pathway flow). Each candidate is checked
 * against every patient med and every patient allergy.
 */
export async function runPatientContextDdi(
  pool: Pool,
  candidates: DdiCandidate[],
  patientContext: PatientContext,
): Promise<DdiPassResult> {
  if (candidates.length === 0) {
    return { findings: [], suppressedRecommendationIds: new Set() };
  }

  // Resolve everything from cache up-front so the inner loops are sync-cheap.
  const candidateNorms = await normalizeCandidates(pool, candidates);
  const patientMedNorms = await normalizePatientMeds(pool, patientContext);

  const findings: DdiFinding[] = [];
  const suppressed = new Set<string>();

  for (const c of candidates) {
    const norm = candidateNorms.get(c.recommendationId);
    if (!norm) continue; // unnormalized — skipped, surfaced via admin queue

    const cEngine = toEngineDrug(norm);
    // ── drug ↔ patient meds ──
    for (const pm of patientMedNorms) {
      const result = await checkDrugDrugInteraction(pool, cEngine, toEngineDrug(pm.norm));
      const finding = buildDrugDrugFinding(c, norm, result, {
        kind: 'PATIENT_MEDICATION',
        rxcui: pm.norm.ingredientRxcui,
        name: pm.norm.ingredientName,
      });
      if (!finding) continue;
      findings.push(finding);
      if (finding.action === 'SUPPRESS') suppressed.add(c.recommendationId);
    }

    // ── drug ↔ patient allergies ──
    const allergyHits = await checkDrugAllergy(
      pool,
      cEngine,
      (patientContext.allergies ?? [])
        .filter((a) => a.system === 'SNOMED')
        .map((a) => ({ snomedCode: a.code })),
    );
    for (const hit of allergyHits) {
      findings.push({
        recommendationId: c.recommendationId,
        drugName: c.drugName,
        action: 'SUPPRESS',
        severity: hit.severity,
        category: 'ALLERGY',
        mechanism: null,
        clinicalAdvice: `Drug class ${hit.matchedDrugAtcClass} matches patient allergy "${hit.snomedDisplay}"`,
        source: {
          kind: 'PATIENT_ALLERGY',
          snomedCode: hit.snomedCode,
          snomedDisplay: hit.snomedDisplay,
        },
        meta: c.meta,
      });
      suppressed.add(c.recommendationId);
    }
  }

  return { findings, suppressedRecommendationIds: suppressed };
}

/**
 * Cross-recommendation DDI check used post-merge in the multi-pathway flow.
 * For every (i, j) pair of merged medications from different pathways, check
 * drug↔drug. Same-pathway pairs are excluded — those would have already
 * surfaced in per-pathway authoring.
 */
export async function runCrossRecommendationDdi(
  pool: Pool,
  candidates: Array<DdiCandidate & { sourcePathwayId: string }>,
): Promise<DdiPassResult> {
  if (candidates.length < 2) {
    return { findings: [], suppressedRecommendationIds: new Set() };
  }

  const norms = await normalizeCandidates(pool, candidates);
  const findings: DdiFinding[] = [];
  const suppressed = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    const aNorm = norms.get(a.recommendationId);
    if (!aNorm) continue;

    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (a.sourcePathwayId === b.sourcePathwayId) continue;
      const bNorm = norms.get(b.recommendationId);
      if (!bNorm) continue;

      const result = await checkDrugDrugInteraction(pool, toEngineDrug(aNorm), toEngineDrug(bNorm));
      // Surface a finding on BOTH sides so each recommendation knows the
      // other is a problem. Pair finding mirrors so the UX doesn't have to
      // dedupe across recommendations.
      const fA = buildDrugDrugFinding(a, aNorm, result, {
        kind: 'OTHER_RECOMMENDATION',
        recommendationId: b.recommendationId,
        drugName: b.drugName,
      });
      if (fA) {
        findings.push(fA);
        if (fA.action === 'SUPPRESS') suppressed.add(a.recommendationId);
      }
      const fB = buildDrugDrugFinding(b, bNorm, result, {
        kind: 'OTHER_RECOMMENDATION',
        recommendationId: a.recommendationId,
        drugName: a.drugName,
      });
      if (fB) {
        findings.push(fB);
        if (fB.action === 'SUPPRESS') suppressed.add(b.recommendationId);
      }
    }
  }

  return { findings, suppressedRecommendationIds: suppressed };
}

// ─── Internals ────────────────────────────────────────────────────────

async function normalizeCandidates(
  pool: Pool,
  candidates: DdiCandidate[],
): Promise<Map<string, NormalizedMedication>> {
  const out = new Map<string, NormalizedMedication>();
  for (const c of candidates) {
    const norm = await lookupNormalizedMedication(pool, {
      text: c.drugName,
      system: c.system,
      code: c.code,
    });
    if (norm) out.set(c.recommendationId, norm);
  }
  return out;
}

async function normalizePatientMeds(
  pool: Pool,
  pc: PatientContext,
): Promise<Array<{ original: { code: string; system: string }; norm: NormalizedMedication }>> {
  const meds = pc.medications ?? [];
  const out: Array<{ original: { code: string; system: string }; norm: NormalizedMedication }> = [];
  for (const m of meds) {
    const norm = await lookupNormalizedMedication(pool, {
      text: m.display ?? m.code,
      system: m.system,
      code: m.code,
    });
    if (norm) out.push({ original: { code: m.code, system: m.system }, norm });
  }
  return out;
}

function buildDrugDrugFinding(
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

function toEngineDrug(norm: NormalizedMedication): { rxcui: string; atcClasses: string[] } {
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

// Re-export types so consumers don't have to import from two places.
export type { AllergyMatchResult } from './ddi-engine';
