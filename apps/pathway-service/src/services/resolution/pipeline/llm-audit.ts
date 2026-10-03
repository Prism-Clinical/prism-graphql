import { evaluateGateWithLLM } from '../../llm/llm-gate-client';
import type { LLMGateClientConfig } from '../../llm/llm-gate-client';
import type { LlmAuditRow } from '../session-store';
import type { LlmClient } from './observations';

/**
 * An LLM client that records one audit row per REAL call, success or failure
 * (spec §4, Audit). A reused observation makes no call and records nothing.
 * Failures are recorded and rethrown; `liveObservations` turns them into
 * UNAVAILABLE.
 */
export function auditingLlmClient(
  config: LLMGateClientConfig | null,
  pathwayId: string,
  sink: LlmAuditRow[],
): LlmClient | null {
  if (!config) return null;
  return async (input, { gateId, gate }) => {
    const base = {
      gateId,
      pathwayId,
      inputAttribute: gate.input_attribute || null,
      inputText: input.narrative,
      prompt: input.prompt,
      branches: gate.branches ?? [],
    };
    try {
      const out = await evaluateGateWithLLM(input, config);
      sink.push({
        ...base,
        model: out.model,
        chosenBranch: out.chosenBranch,
        confidence: out.confidence,
        reasoning: out.reasoning,
        fullResponse: out.rawResponse,
        tentative: out.confidence < (gate.confidence_threshold ?? 0.75),
        errorMessage: null,
        latencyMs: out.latencyMs,
      });
      return out;
    } catch (err) {
      sink.push({
        ...base,
        model: config.model,
        chosenBranch: null,
        confidence: null,
        reasoning: null,
        fullResponse: null,
        tentative: true,
        errorMessage: err instanceof Error ? err.message : String(err),
        latencyMs: null,
      });
      throw err;
    }
  };
}
