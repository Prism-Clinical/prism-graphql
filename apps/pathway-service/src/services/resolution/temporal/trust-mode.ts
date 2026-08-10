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

/** The mode-selection arguments both start mutations accept. */
export interface ResolutionModeArgs {
  resolutionMode?: string | null;
  snapshotId?: string | null;
  sessionId?: string | null;
}

function reject(message: string): never {
  throw new TemporalContextError(message, 'INVALID_RESOLUTION_INPUT');
}

/**
 * Turn the flat GraphQL arguments into the discriminated `ResolutionInput`.
 *
 * GraphQL cannot express a discriminated input union, so exactly-one is
 * enforced here: each mode requires its own payload id and forbids the others'.
 *
 * An absent mode defaults to SYNTHETIC and is NOT authorization-checked. Every
 * caller that exists today omits the mode, and the simulator runs as PROVIDER
 * — demanding ADMIN for the default would break all of them. The check applies
 * only when a caller explicitly names SYNTHETIC, which is the honest boundary
 * given that `userRole` is an unverified header (see assertSyntheticAuthorized):
 * this is defence in depth, not access control.
 */
export function parseResolutionInput(
  args: ResolutionModeArgs,
  syntheticContext: SyntheticPatientContext,
  userRole: string | undefined,
): ResolutionInput {
  const { resolutionMode, snapshotId, sessionId } = args;

  if (resolutionMode === undefined || resolutionMode === null) {
    if (snapshotId) reject('snapshotId requires resolutionMode: LIVE');
    if (sessionId) reject('sessionId requires resolutionMode: REPLAY');
    return { mode: 'SYNTHETIC', patientContext: syntheticContext };
  }

  switch (resolutionMode) {
    case 'SYNTHETIC':
      assertSyntheticAuthorized(userRole);
      if (snapshotId) reject('snapshotId is not valid on a SYNTHETIC resolution');
      if (sessionId) reject('sessionId is not valid on a SYNTHETIC resolution');
      return { mode: 'SYNTHETIC', patientContext: syntheticContext };

    case 'LIVE':
      if (!snapshotId) reject('resolutionMode: LIVE requires a snapshotId');
      if (sessionId) reject('sessionId is not valid on a LIVE resolution');
      return { mode: 'LIVE', snapshotId };

    case 'REPLAY':
      if (!sessionId) reject('resolutionMode: REPLAY requires a sessionId');
      if (snapshotId) reject('snapshotId is not valid on a REPLAY resolution');
      return { mode: 'REPLAY', sessionId };

    default:
      return reject(
        `unknown resolutionMode "${resolutionMode}" — expected LIVE | SYNTHETIC | REPLAY`,
      );
  }
}
