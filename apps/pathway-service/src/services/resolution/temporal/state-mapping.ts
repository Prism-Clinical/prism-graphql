import { ClinicalState, StateBasis } from './fact-model';

type StateOut = { clinicalState: ClinicalState; stateBasis: StateBasis };
type ValidityOut = { recordValidity: 'VALID' | 'INVALID' | 'UNKNOWN'; validityBasis: string };

const COND_ACTIVE = new Set(['active', 'recurrence', 'relapse']);
const COND_INACTIVE = new Set(['inactive', 'remission', 'resolved']);

export function deriveConditionState(i: { clinicalStatus: string | null; hasAbatement: boolean }): StateOut {
  const s = i.clinicalStatus?.toLowerCase() ?? null;
  if (i.hasAbatement) {
    if (s && COND_ACTIVE.has(s)) return { clinicalState: 'CONFLICT', stateBasis: 'ABATEMENT' };
    return { clinicalState: 'INACTIVE', stateBasis: 'ABATEMENT' };
  }
  if (s === null) return { clinicalState: 'ACTIVE', stateBasis: 'MISSING_STATUS_FAIL_OPEN' };
  if (COND_ACTIVE.has(s)) return { clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  if (COND_INACTIVE.has(s)) return { clinicalState: 'INACTIVE', stateBasis: 'FHIR_STATUS' };
  return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' };
}

// MedicationRequest.status is REQUIRED in FHIR — a missing value is anomalous, not a fail-open case.
export function deriveMedicationState(i: { status: string | null }): StateOut {
  const s = i.status?.toLowerCase() ?? null;
  if (s === null) return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' };
  if (s === 'active') return { clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  if (s === 'on-hold') return { clinicalState: 'ON_HOLD', stateBasis: 'FHIR_STATUS' };
  if (s === 'stopped' || s === 'completed' || s === 'cancelled') return { clinicalState: 'INACTIVE', stateBasis: 'FHIR_STATUS' };
  return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' }; // draft, unknown (entered-in-error dropped by validity)
}

export function deriveAllergyState(i: { clinicalStatus: string | null }): StateOut {
  const s = i.clinicalStatus?.toLowerCase() ?? null;
  if (s === null) return { clinicalState: 'ACTIVE', stateBasis: 'MISSING_STATUS_FAIL_OPEN' };
  if (s === 'active') return { clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  if (s === 'inactive' || s === 'resolved') return { clinicalState: 'INACTIVE', stateBasis: 'FHIR_STATUS' };
  return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' };
}

const VER_INVALID = new Set(['refuted', 'entered-in-error']);
const VER_VALID = new Set(['confirmed']); // affirmatively confirmed
const VER_UNKNOWN = new Set(['unconfirmed', 'provisional', 'differential']);
const OBS_VALID = new Set(['final', 'amended', 'corrected']);
const OBS_INVALID = new Set(['cancelled', 'entered-in-error']);
const OBS_UNKNOWN = new Set(['registered', 'preliminary', 'unknown']);

export function deriveValidity(i: {
  kind: 'condition' | 'allergy' | 'medication_order' | 'lab' | 'vital';
  verificationStatus?: string | null;
  observationStatus?: string | null;
  medStatus?: string | null;
}): ValidityOut {
  if (i.kind === 'condition' || i.kind === 'allergy') {
    const v = i.verificationStatus?.toLowerCase() ?? null;
    if (v && VER_INVALID.has(v)) return { recordValidity: 'INVALID', validityBasis: `verification:${v}` };
    if (v && VER_UNKNOWN.has(v)) return { recordValidity: 'UNKNOWN', validityBasis: `verification:${v}` };
    if (v === null || VER_VALID.has(v)) return { recordValidity: 'VALID', validityBasis: v ? `verification:${v}` : 'verification:absent' };
    return { recordValidity: 'UNKNOWN', validityBasis: `verification:${v}` };
  }
  if (i.kind === 'medication_order') {
    const s = i.medStatus?.toLowerCase() ?? null;
    if (s === 'entered-in-error') return { recordValidity: 'INVALID', validityBasis: 'medication:entered-in-error' };
    if (s === null) return { recordValidity: 'UNKNOWN', validityBasis: 'medication:absent' };
    return { recordValidity: 'VALID', validityBasis: `medication:${s}` };
  }
  // lab / vital
  const o = i.observationStatus?.toLowerCase() ?? null;
  if (o && OBS_INVALID.has(o)) return { recordValidity: 'INVALID', validityBasis: `observation:${o}` };
  if (o && OBS_VALID.has(o)) return { recordValidity: 'VALID', validityBasis: `observation:${o}` };
  if (o && OBS_UNKNOWN.has(o)) return { recordValidity: 'UNKNOWN', validityBasis: `observation:${o}` };
  if (o === null && i.kind === 'vital') return { recordValidity: 'VALID', validityBasis: 'vital:present' };
  return { recordValidity: 'UNKNOWN', validityBasis: o ? `observation:${o}` : 'observation:absent' };
}
