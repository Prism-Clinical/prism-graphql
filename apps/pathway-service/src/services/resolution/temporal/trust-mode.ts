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
  extends Omit<
    PatientContext,
    'conditionCodes' | 'medications' | 'allergies' | 'labResults' | 'patientAttributes'
  > {
  conditionCodes: SyntheticCodeEntry[];
  medications: SyntheticCodeEntry[];
  allergies: SyntheticCodeEntry[];
  labResults: SyntheticLabResult[];
  /** Normalized by the resolver, so the raw caller shape is carried here. */
  patientAttributes?: Record<string, unknown>;
}

/**
 * The caller's `PatientContextInput` exactly as GraphQL delivers it — every
 * array optional, nothing normalized. `parseResolutionInput` takes THIS rather
 * than an already-built context, so it can tell "no patientContext supplied"
 * from "an empty one", and reject one supplied alongside LIVE or REPLAY.
 */
export interface RawPatientContextInput {
  patientId?: string;
  conditionCodes?: SyntheticCodeEntry[];
  medications?: SyntheticCodeEntry[];
  allergies?: SyntheticCodeEntry[];
  labResults?: SyntheticLabResult[];
  vitalSigns?: Record<string, unknown>;
  freeformData?: Record<string, unknown>;
  patientAttributes?: Record<string, unknown>;
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

/** The complete raw request, so the parser can police every field at once. */
export interface RawResolutionRequest extends ResolutionModeArgs {
  patientContext?: RawPatientContextInput | null;
  evaluationAsOf?: string | null;
  encounterStart?: string | null;
}

function reject(message: string): never {
  throw new TemporalContextError(message, 'INVALID_RESOLUTION_INPUT');
}

/**
 * The fields that are *assertions about clinical truth* rather than clinical
 * data. Supplying one says "trust me that this diagnosis is active and this
 * record is valid" — which is exactly what an unauthorized caller must not be
 * able to do implicitly.
 *
 * `date` is deliberately NOT here. It is observational data, no more
 * privileged than the code beside it, and `LabResultInput.date` was already
 * accepted before this feature existed.
 */
const CODE_ASSERTION_FIELDS = ['endDate', 'clinicalState', 'recordValidity', 'sourceId'] as const;
const LAB_ASSERTION_FIELDS = ['recordValidity', 'sourceId'] as const;

function firstAssertion(pc: RawPatientContextInput | null | undefined): string | undefined {
  if (!pc) return undefined;
  const coded: Array<[string, SyntheticCodeEntry[] | undefined]> = [
    ['conditionCodes', pc.conditionCodes],
    ['medications', pc.medications],
    ['allergies', pc.allergies],
  ];
  for (const [bucket, entries] of coded) {
    for (const [i, e] of (entries ?? []).entries()) {
      for (const f of CODE_ASSERTION_FIELDS) {
        // `!= null`, not `!== undefined`: GraphQL delivers an explicitly-null
        // optional field as null, and null MUST behave exactly like omission.
        if (e[f] != null) return `${bucket}[${i}].${f}`;
      }
    }
  }
  for (const [i, e] of (pc.labResults ?? []).entries()) {
    for (const f of LAB_ASSERTION_FIELDS) {
      if (e[f] != null) return `labResults[${i}].${f}`;
    }
  }
  return undefined;
}

/**
 * Drop explicitly-null optional fields so downstream code sees omission.
 *
 * The generated resolver types model every optional input as `InputMaybe<T>`
 * (`T | null | undefined`), but the hand-written types stop at `undefined`. So
 * `clinicalState: null` — which a client sends simply by binding an unset form
 * field — was read as "a value was supplied": it counted as a privileged
 * assertion in implicit mode, and in explicit SYNTHETIC mode it reached
 * `parseClinicalState` and was rejected as an invalid enum member. Normalizing
 * here means null and omitted are the same request everywhere after this point.
 */
function stripNulls<T extends object>(entry: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (v !== null) out[k] = v;
  }
  return out as T;
}

function normalizeSynthetic(
  raw: RawPatientContextInput | null | undefined,
  patientId: string,
): SyntheticPatientContext {
  const pc = raw ?? {};

  // A context labelled for another patient must not be silently relabelled.
  // `PatientContextInput.patientId` is required by the SDL, and normalization
  // used to ignore it and stamp the top-level id — so a context built for
  // patient B could be stored and evaluated as patient A.
  if (pc.patientId != null && pc.patientId !== patientId) {
    reject(
      `patientContext.patientId (${pc.patientId}) does not match the patientId argument (${patientId})`,
    );
  }

  const out: SyntheticPatientContext = {
    patientId,
    conditionCodes: (pc.conditionCodes ?? []).map(stripNulls),
    medications: (pc.medications ?? []).map(stripNulls),
    allergies: (pc.allergies ?? []).map(stripNulls),
    labResults: (pc.labResults ?? []).map(stripNulls),
  };
  if (pc.vitalSigns != null) out.vitalSigns = pc.vitalSigns;
  if (pc.freeformData != null) out.freeformData = pc.freeformData;
  if (pc.patientAttributes != null) out.patientAttributes = pc.patientAttributes;
  return out;
}

/**
 * Turn the complete raw GraphQL request into the discriminated `ResolutionInput`.
 *
 * GraphQL cannot express a discriminated input union, so exactly-one is
 * enforced here — and it must see the WHOLE request to do it. An earlier
 * version took only the mode ids plus an already-built context, so it could
 * not reject a `patientContext` sent alongside LIVE, nor a caller-pinned
 * clock: the union's guarantee held in the type but not at the boundary, and
 * would have reopened the moment LIVE stopped throwing. Callers must dispatch
 * from the returned variant, never from the raw args.
 *
 * Both temporal anchors belong to the SYNTHETIC variant only. Design §1 is
 * explicit: "LIVE mode derives `encounterStart` from the encounter; SYNTHETIC
 * mode supplies it." An earlier revision allowed a caller-supplied anchor on
 * LIVE, reasoning that a provider needs to send one — but the mode a provider
 * actually uses today IS SYNTHETIC (implicit), so that reasoning never applied
 * to LIVE, and permitting it there would become a clock-spoofing path the
 * moment Plan 07 stops throwing. `evaluationAsOf` is narrower still: confined
 * to EXPLICIT SYNTHETIC, since pinning the clock is a privileged assertion.
 */
export function parseResolutionInput(
  req: RawResolutionRequest,
  patientId: string,
  userRole: string | undefined,
): ResolutionInput {
  const { resolutionMode, snapshotId, sessionId, patientContext, evaluationAsOf } = req;

  if (resolutionMode === undefined || resolutionMode === null) {
    if (snapshotId) reject('snapshotId requires resolutionMode: LIVE');
    if (sessionId) reject('sessionId requires resolutionMode: REPLAY');

    // The implicit mode exists ONLY to keep pre-existing callers working, so
    // it admits only what they could already send. Anything this feature added
    // — a trust assertion about a fact, or a caller-pinned clock — requires an
    // explicitly authorized SYNTHETIC. Without this, omitting the mode was a
    // one-word bypass of the authorization check below, and no amount of real
    // authentication later would have closed it.
    const assertion = firstAssertion(patientContext);
    if (assertion) {
      reject(
        `${assertion} is a SYNTHETIC assertion and requires resolutionMode: SYNTHETIC`,
      );
    }
    if (evaluationAsOf != null) {
      reject('evaluationAsOf requires resolutionMode: SYNTHETIC — the clock is server-stamped');
    }
    return { mode: 'SYNTHETIC', patientContext: normalizeSynthetic(patientContext, patientId) };
  }

  switch (resolutionMode) {
    case 'SYNTHETIC':
      assertSyntheticAuthorized(userRole);
      if (snapshotId) reject('snapshotId is not valid on a SYNTHETIC resolution');
      if (sessionId) reject('sessionId is not valid on a SYNTHETIC resolution');
      if (!patientContext) reject('resolutionMode: SYNTHETIC requires a patientContext');
      return { mode: 'SYNTHETIC', patientContext: normalizeSynthetic(patientContext, patientId) };

    case 'LIVE':
      if (!snapshotId) reject('resolutionMode: LIVE requires a snapshotId');
      if (sessionId) reject('sessionId is not valid on a LIVE resolution');
      // The whole point of the union: a LIVE resolution cannot carry facts.
      if (patientContext) reject('patientContext is not valid on a LIVE resolution');
      if (evaluationAsOf != null) reject('evaluationAsOf is not valid on a LIVE resolution');
      // Design §1: LIVE derives its anchor from the encounter (plan 07). A
      // caller-supplied one would be a clock-spoofing path once LIVE works.
      if (req.encounterStart != null) {
        reject('encounterStart is derived from the encounter on a LIVE resolution');
      }
      return { mode: 'LIVE', snapshotId };

    case 'REPLAY':
      if (!sessionId) reject('resolutionMode: REPLAY requires a sessionId');
      if (snapshotId) reject('snapshotId is not valid on a REPLAY resolution');
      if (patientContext) reject('patientContext is not valid on a REPLAY resolution');
      // A replay reuses the clock recorded on the session it replays; accepting
      // either anchor here would let a caller replay against a different one.
      if (evaluationAsOf != null) reject('evaluationAsOf is not valid on a REPLAY resolution');
      if (req.encounterStart != null) {
        reject('encounterStart is not valid on a REPLAY resolution');
      }
      return { mode: 'REPLAY', sessionId };

    default:
      return reject(
        `unknown resolutionMode "${resolutionMode}" — expected LIVE | SYNTHETIC | REPLAY`,
      );
  }
}
