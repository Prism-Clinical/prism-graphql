import type { PatientContext } from '../../confidence/types';
import type { ResolutionSession } from '../types';
import type { AdditionalContextInput } from '../../../resolvers/mutations/resolution';
import { buildEffectivePatientContext } from '../effective-context';
import { assembleContext } from './context-assembler';
import {
  DEFAULT_TEMPORAL_POLICY_VERSION,
  EvaluationTemporalContext,
  TemporalContextError,
} from './evaluation-context';
import { FactStore } from './fact-model';
import {
  ResolutionInput,
  SyntheticCodeEntry,
  SyntheticLabResult,
  SyntheticPatientContext,
} from './trust-mode';

/**
 * Build the `FactStore` an engine selects from — under `v1` only.
 *
 * TWO HELPERS, NOT ONE (P1-9). `factStoreForSession` cannot serve the start
 * mutations: at `startResolution` there is no session yet, only the parsed
 * resolution input and a freshly stamped clock. They share the one-line core
 * below, which takes a normalized context plus a clock and nothing else —
 * assembly is pathway-independent, so a multi-pathway run assembles once and
 * every child pathway selects from the same store.
 *
 * ─── Why the version gate lives HERE and not inside the assembler (P1-9) ───
 *
 * `assembleContext` VALIDATES: `parseClinicalState`, `parseRecordValidity`,
 * `parseSyntheticDate` and `assertOrdered` all throw. Calling it unconditionally
 * would turn a `legacy-v0` request carrying a malformed date or an inverted
 * interval — which today's evaluator tolerates or ignores outright — into a
 * **session-creation rejection**, for a store the legacy path never reads. That
 * is a behavior change reachable under `legacy-v0`, which locked decision #2
 * makes a bug in the seam. So `legacy-v0` returns `[]` without ever entering the
 * assembler, and the proof is a spy on `assembleContext`, not on the store's
 * emptiness: an empty array cannot distinguish "never called" from "called and
 * found nothing".
 */
function assembleUnderClock(
  patientContext: SyntheticPatientContext,
  temporalCtx: EvaluationTemporalContext,
): FactStore {
  return assembleContext({ mode: 'SYNTHETIC', patientContext }, temporalCtx);
}

function isLegacy(temporalCtx: EvaluationTemporalContext): boolean {
  return temporalCtx.temporalPolicyVersion === DEFAULT_TEMPORAL_POLICY_VERSION;
}

/**
 * The store for a NEW session, from the parsed resolution input.
 *
 * LIVE and REPLAY still reach `assembleContext`, which refuses them by name.
 * Both start mutations also call `assertAssemblableMode` at the boundary,
 * version-independently, so those two modes are refused identically under
 * `legacy-v0` — the early return below opens no hole for them.
 */
export function factStoreForInput(
  input: ResolutionInput,
  temporalCtx: EvaluationTemporalContext,
): FactStore {
  if (isLegacy(temporalCtx)) return [];
  if (input.mode !== 'SYNTHETIC') {
    // Narrowing, not policy: `assembleContext` owns the refusal message for
    // LIVE (plan 07) and REPLAY (plan 05b), so route through it rather than
    // spelling a second one here.
    return assembleContext(input, temporalCtx);
  }
  return assembleUnderClock(input.patientContext, temporalCtx);
}

/**
 * Coerce a persisted `PatientContext` back to the SYNTHETIC shape it was
 * assembled from.
 *
 * Not a widening cast for convenience: `toPatientContext` copies the entry
 * ARRAYS by reference, so `endDate` / `clinicalState` / `recordValidity` /
 * `sourceId` ride along into `initial_patient_context` and come back out of the
 * JSONB column intact. Re-reading them is what makes a retraversal reproduce the
 * facts its creating traversal selected from.
 */
function toSyntheticContext(pc: PatientContext): SyntheticPatientContext {
  const out: SyntheticPatientContext = {
    patientId: pc.patientId,
    conditionCodes: (pc.conditionCodes ?? []) as SyntheticCodeEntry[],
    medications: (pc.medications ?? []) as SyntheticCodeEntry[],
    allergies: (pc.allergies ?? []) as SyntheticCodeEntry[],
    labResults: (pc.labResults ?? []) as SyntheticLabResult[],
  };
  if (pc.vitalSigns !== undefined) out.vitalSigns = pc.vitalSigns;
  if (pc.freeformData !== undefined) out.freeformData = pc.freeformData;
  return out;
}

/**
 * The store for an EXISTING session, at every retraversal entry point.
 *
 * Facts are not persisted (plan 05b), so this re-assembles from
 * `buildEffectivePatientContext(initialPatientContext, additions)` under the
 * session's **stored** clock — never a fresh one. Plan 05 decision 5 is what
 * makes that sound: identical input yields identical `factId`s, so a gate
 * re-decided on override sees the same facts it saw at creation, plus whatever
 * `addPatientContext` has added since.
 *
 * `additions` is a parameter rather than read off the session because
 * `addPatientContext` must assemble from the bag it is about to persist, not
 * from the one already stored — otherwise the newly supplied fact is missing
 * from the very retraversal it triggered, which is P1-2.
 *
 * A clock-less pre-migration session yields `[]`; the three retraversal
 * resolvers reject it up front through `requireSessionTemporalContext`, so this
 * is a backstop rather than the guard.
 */
export function factStoreForSession(
  session: ResolutionSession,
  additions: Partial<AdditionalContextInput> | undefined,
): FactStore {
  const temporalCtx = session.temporalContext;
  if (!temporalCtx || isLegacy(temporalCtx)) return [];

  if (!session.initialPatientContext) {
    throw new TemporalContextError(
      'session has no initial patient context to assemble facts from',
      'INVALID_RESOLUTION_INPUT',
    );
  }
  const effective = buildEffectivePatientContext(
    session.initialPatientContext as PatientContext,
    additions,
  );
  return assembleUnderClock(toSyntheticContext(effective), temporalCtx);
}
