import type { PatientContext, CodeEntry, LabResult } from '../../confidence/types';
import { TemporalContextError } from './evaluation-context';

export type ResolutionModeKind = 'LIVE' | 'SYNTHETIC' | 'REPLAY';

/** The SYNTHETIC-only fields an authorized simulator may assert. */
export interface SyntheticCodeEntry extends CodeEntry {
  endDate?: string;
  clinicalState?: string;
  recordValidity?: string;
  sourceId?: string;
}

export interface SyntheticLabResult extends LabResult {
  /** Labs carry no clinical state — supplying one is rejected, not ignored. */
  recordValidity?: string;
  sourceId?: string;
}

export interface SyntheticPatientContext
  extends Omit<PatientContext, 'conditionCodes' | 'medications' | 'allergies' | 'labResults'> {
  conditionCodes: SyntheticCodeEntry[];
  medications: SyntheticCodeEntry[];
  allergies: SyntheticCodeEntry[];
  labResults: SyntheticLabResult[];
}

/**
 * Exactly one mode per resolution, and the payload lives INSIDE the variant.
 *
 * This is the trust boundary. A LIVE resolution cannot carry caller-supplied
 * clinical facts because the type has nowhere to put them — which is stronger
 * than validating a shared payload after the fact, since validation can be
 * forgotten at a new call site and a missing union member cannot.
 */
export type ResolutionInput =
  | { mode: 'SYNTHETIC'; patientContext: SyntheticPatientContext }
  | { mode: 'LIVE'; snapshotId: string }
  | { mode: 'REPLAY'; sessionId: string };

/**
 * Only an admin may assert synthetic clinical facts.
 *
 * DEFENCE IN DEPTH ONLY — NOT a security boundary. `userRole` is read from an
 * unverified `x-user-role` header that defaults to PROVIDER (index.ts:44), so
 * any caller can claim any role. This check is correct and belongs here, and
 * it secures nothing until real authentication exists. Do not cite it as an
 * access control.
 */
export function assertSyntheticAuthorized(role: string | undefined): void {
  if (role !== 'ADMIN') {
    throw new TemporalContextError(
      `SYNTHETIC resolution requires an ADMIN role (got: ${role ?? 'none'})`,
      'INVALID_RESOLUTION_INPUT',
    );
  }
}
