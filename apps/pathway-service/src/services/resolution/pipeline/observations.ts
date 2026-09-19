import type { PatientContext } from '../../confidence/types';
import type { LLMGateInput, LLMGateOutput } from '../../llm/llm-gate-client';
import type { LlmGateEvaluator, LlmGateVerdict } from '../gate-evaluator';
import type { GateProperties } from '../types';
import { resolveDottedPath } from '../dotted-path';
import { hashOf } from './canonical';
import type { LlmObservation, ObservationKey } from './types';

/** The gate rides along so the auditing client can record it (spec §4, Audit). */
export type LlmClient = (
  input: LLMGateInput,
  call: { gateId: string; gate: GateProperties },
) => Promise<LLMGateOutput>;

export interface ObservationProvider {
  evaluator: LlmGateEvaluator;
  /** Keys whose observation this evaluation consumed; the commit persists exactly these. */
  used: Set<ObservationKey>;
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

export function replayObservations(frozen: Map<ObservationKey, LlmObservation>, model: string): ObservationProvider {
  const used = new Set<ObservationKey>();
  return {
    used,
    evaluator: async (gate, gateId, patient) => {
      const key = observationKey(gate, gateId, narrativeFor(gate, patient), model);
      const obs = frozen.get(key);
      if (!obs) return unavailable('UNAVAILABLE: no recorded observation');
      used.add(key);
      return verdictOf(obs);
    },
  };
}

export function liveObservations(
  session: Map<ObservationKey, LlmObservation>,
  request: Map<ObservationKey, LlmObservation>,
  client: LlmClient | null,
  model: string,
  now: () => string = () => new Date().toISOString(),
): ObservationProvider {
  const used = new Set<ObservationKey>();
  const failedThisAttempt = new Set<ObservationKey>();
  return {
    used,
    evaluator: async (gate, gateId, patient) => {
      const narrative = narrativeFor(gate, patient);
      const key = observationKey(gate, gateId, narrative, model);
      const known = session.get(key) ?? request.get(key);
      if (known) {
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
