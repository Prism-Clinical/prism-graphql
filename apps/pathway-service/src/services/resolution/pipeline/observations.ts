import type { PatientContext } from '../../confidence/types';
import type { LLMGateInput, LLMGateOutput } from '../../llm/llm-gate-client';
import type { LlmGateEvaluator, LlmGateVerdict } from '../gate-evaluator';
import type { GateProperties } from '../types';
import { resolveDottedPath } from '../dotted-path';
import { hashOf } from './canonical';
import { isMedicationObservation } from './types';
import type { LlmObservation, MedicationObservation, ObservationKey, SessionObservation } from './types';
import { normalizedKey } from '../../medications/safety-reference';
import type { MedicationInput, NormalizedMedication } from '../../medications/types';
import type { MedicationIdentity, MedicationIdentityLookup } from '../medication-classes';

/** The gate rides along so the auditing client can record it (spec §4, Audit). */
export type LlmClient = (
  input: LLMGateInput,
  call: { gateId: string; gate: GateProperties },
) => Promise<LLMGateOutput>;

export interface ObservationProvider {
  evaluator: LlmGateEvaluator;
  /** Keys whose observation this evaluation consumed; the commit persists exactly these. */
  used: Set<ObservationKey>;
  /**
   * What a chart medication IS — its ingredients and product classes — or
   * `null` when it could not be identified. Read through the provider, like an
   * LLM verdict, so the identification a session used is one of its recorded
   * inputs and not a fresh read of a cache that can change under it.
   */
  medication: MedicationIdentityLookup;
}

/** The observation key of a chart medication's identification. */
export const medicationObservationKey = (input: MedicationInput): ObservationKey => `med:${normalizedKey(input)}`;

const identityOf = (o: MedicationObservation): MedicationIdentity => ({
  ingredientRxcuis: o.ingredientRxcuis,
  ingredientNames: o.ingredientNames,
  productAtcClasses: o.productAtcClasses,
});

/**
 * The medication half of a provider: the session's pinned identification
 * first, else whatever `source` (the evaluation environment's normalisation)
 * knows NOW — which is then recorded for the commit to pin. A medication the
 * environment cannot classify is `null` and is NOT recorded, so a later
 * evaluation looks again.
 */
function medicationLookup(
  session: Map<ObservationKey, SessionObservation>,
  request: Map<ObservationKey, SessionObservation> | null,
  used: Set<ObservationKey>,
  source: ((input: MedicationInput) => NormalizedMedication | null) | undefined,
): MedicationIdentityLookup {
  return (input) => {
    const key = medicationObservationKey(input);
    const known = session.get(key) ?? request?.get(key);
    if (isMedicationObservation(known)) {
      used.add(key);
      return identityOf(known);
    }
    const classification = source?.(input)?.classification;
    if (!classification || !request) return null;
    const obs: MedicationObservation = {
      key, kind: 'medication',
      ingredientRxcuis: [...classification.ingredientRxcuis],
      ingredientNames: [...classification.ingredientNames],
      productAtcClasses: [...classification.productAtcClasses],
    };
    request.set(key, obs);
    used.add(key);
    return identityOf(obs);
  };
}

/** The narrative an LLM gate reads, exactly as the resolver's evaluator reads it. */
export function narrativeFor(gate: GateProperties, patient: PatientContext): string {
  const raw = resolveDottedPath(patient, gate.input_attribute ?? '');
  return typeof raw === 'string' ? raw : '';
}

/**
 * The semantic request (C1, D10). `confidence_threshold` is deliberately
 * absent: it is applied to the verdict after acquisition.
 */
export function observationKey(gate: GateProperties, gateId: string, narrative: string, model: string): ObservationKey {
  return hashOf({
    gateId,
    prompt: gate.prompt ?? gate.title,
    branches: (gate.branches ?? []).map((b) => ({ name: b.name, description: b.description })),
    inputAttribute: gate.input_attribute ?? '',
    narrative,
    model,
  });
}

/** Never a clinical false: the gate takes its safe default, tentatively (D3). */
const unavailable = (reason: string): LlmGateVerdict => ({
  chosenBranch: '', confidence: 0, reasoning: reason, failed: true, errorMessage: reason,
});

const verdictOf = (o: LlmObservation): LlmGateVerdict => ({
  chosenBranch: o.chosenBranch, confidence: o.confidence, reasoning: o.reasoning,
});

export function replayObservations(frozen: Map<ObservationKey, SessionObservation>, model: string): ObservationProvider {
  const used = new Set<ObservationKey>();
  return {
    used,
    // Replay reads ONLY what the session recorded: a medication it never
    // identified is unidentified, whatever the cache says today.
    medication: medicationLookup(frozen, null, used, undefined),
    evaluator: async (gate, gateId, patient) => {
      const key = observationKey(gate, gateId, narrativeFor(gate, patient), model);
      const obs = frozen.get(key);
      if (!obs || isMedicationObservation(obs)) return unavailable('UNAVAILABLE: no recorded observation');
      used.add(key);
      return verdictOf(obs);
    },
  };
}

export function liveObservations(
  session: Map<ObservationKey, SessionObservation>,
  request: Map<ObservationKey, SessionObservation>,
  client: LlmClient | null,
  model: string,
  now: () => string = () => new Date().toISOString(),
  /** The evaluation environment's normalisation of a chart medication (`normalizedFor(env.safety, …)`). */
  medicationSource?: (input: MedicationInput) => NormalizedMedication | null,
): ObservationProvider {
  const used = new Set<ObservationKey>();
  const failedThisAttempt = new Set<ObservationKey>();
  return {
    used,
    medication: medicationLookup(session, request, used, medicationSource),
    evaluator: async (gate, gateId, patient) => {
      const narrative = narrativeFor(gate, patient);
      const key = observationKey(gate, gateId, narrative, model);
      const known = session.get(key) ?? request.get(key);
      if (known && !isMedicationObservation(known)) {
        used.add(key);
        return verdictOf(known);
      }
      if (!client || failedThisAttempt.has(key)) return unavailable('UNAVAILABLE: no LLM client or call failed');
      try {
        const out = await client(
          {
            prompt: gate.prompt ?? gate.title,
            narrative,
            branches: (gate.branches ?? []).map((b) => ({ name: b.name, description: b.description })),
          },
          { gateId, gate },
        );
        const obs: LlmObservation = {
          key, gateId, chosenBranch: out.chosenBranch, confidence: out.confidence,
          reasoning: out.reasoning, model: out.model, acquiredAt: now(),
        };
        request.set(key, obs);
        used.add(key);
        return verdictOf(obs);
      } catch (err) {
        failedThisAttempt.add(key);
        return unavailable(`UNAVAILABLE: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
