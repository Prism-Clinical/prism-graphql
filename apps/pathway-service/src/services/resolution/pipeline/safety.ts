import type { PatientContext } from '../../confidence/types';
import { DdiCandidate, buildDrugDrugFinding, toEngineDrug } from '../../medications/ddi-pass';
import { matchDrugAllergyAgainstMappings } from '../../medications/ddi-engine';
import { SafetyReference, interactionBetween, normalizedFor } from '../../medications/safety-reference';
import type { NormalizedMedication } from '../../medications/types';
import type { SafetyUnavailable, ScopedFinding } from './types';

export interface SafetyOutcome {
  findings: ScopedFinding[];
  suppressed: Set<string>;
  unavailable: SafetyUnavailable[];
}

/**
 * Stage 5 — PATIENT scope (spec C3). Each candidate against the patient's
 * medications and allergies. A drug that cannot be normalised is REPORTED
 * (D14), never silently skipped.
 */
export function patientSafety(ref: SafetyReference, candidates: DdiCandidate[], patient: PatientContext): SafetyOutcome {
  const findings: ScopedFinding[] = [];
  const suppressed = new Set<string>();
  const unavailable: SafetyUnavailable[] = [];

  // This patient's allergies only, as ddi-pass does: the reference may cover a wider universe.
  const allergyCodes = new Set((patient.allergies ?? []).filter((a) => a.system === 'SNOMED').map((a) => a.code));
  const allergyMappings = ref.allergyMappings.filter((m) => allergyCodes.has(m.snomedCode));

  const patientMeds: NormalizedMedication[] = [];
  for (const m of patient.medications ?? []) {
    const drugName = m.display ?? m.code;
    const norm = normalizedFor(ref, { text: drugName, system: m.system, code: m.code });
    if (norm) patientMeds.push(norm);
    else unavailable.push({ drugName, source: 'PATIENT_MEDICATION' });
  }

  for (const c of candidates) {
    const norm = normalizedFor(ref, { text: c.drugName, system: c.system, code: c.code });
    if (!norm) {
      unavailable.push({ nodeId: c.recommendationId, drugName: c.drugName, source: 'CANDIDATE' });
      continue;
    }
    const drug = toEngineDrug(norm);

    for (const pm of patientMeds) {
      const f = buildDrugDrugFinding(c, norm, interactionBetween(ref, drug, toEngineDrug(pm)), {
        kind: 'PATIENT_MEDICATION', rxcui: pm.ingredientRxcui, name: pm.ingredientName,
      });
      if (!f) continue;
      findings.push({ ...f, scope: 'PATIENT' });
      if (f.action === 'SUPPRESS') suppressed.add(c.recommendationId);
    }

    for (const hit of matchDrugAllergyAgainstMappings(drug, allergyMappings)) {
      findings.push({
        recommendationId: c.recommendationId,
        drugName: c.drugName,
        action: 'SUPPRESS',
        severity: hit.severity,
        category: 'ALLERGY',
        mechanism: null,
        clinicalAdvice: `Drug class ${hit.matchedDrugAtcClass} matches patient allergy "${hit.snomedDisplay}"`,
        source: { kind: 'PATIENT_ALLERGY', snomedCode: hit.snomedCode, snomedDisplay: hit.snomedDisplay },
        meta: c.meta,
        scope: 'PATIENT',
      });
      suppressed.add(c.recommendationId);
    }
  }

  return { findings, suppressed, unavailable };
}

/** Stage 6 — SET scope, ROOT only (spec C3). Every candidate pair; no same-pathway skip. */
export function pairSafety(ref: SafetyReference, candidates: DdiCandidate[]): { findings: ScopedFinding[]; suppressed: Set<string> } {
  const findings: ScopedFinding[] = [];
  const suppressed = new Set<string>();
  const norms = candidates
    .map((c) => ({ c, norm: normalizedFor(ref, { text: c.drugName, system: c.system, code: c.code }) }))
    .filter((x): x is { c: DdiCandidate; norm: NormalizedMedication } => x.norm !== null);

  for (let i = 0; i < norms.length; i++) {
    for (let j = i + 1; j < norms.length; j++) {
      const a = norms[i];
      const b = norms[j];
      const result = interactionBetween(ref, toEngineDrug(a.norm), toEngineDrug(b.norm));
      const fA = buildDrugDrugFinding(a.c, a.norm, result, { kind: 'OTHER_RECOMMENDATION', recommendationId: b.c.recommendationId, drugName: b.c.drugName });
      const fB = buildDrugDrugFinding(b.c, b.norm, result, { kind: 'OTHER_RECOMMENDATION', recommendationId: a.c.recommendationId, drugName: a.c.drugName });
      for (const f of [fA, fB]) {
        if (!f) continue;
        findings.push({ ...f, scope: 'SET' });
        if (f.action === 'SUPPRESS') suppressed.add(f.recommendationId);
      }
    }
  }
  return { findings, suppressed };
}
