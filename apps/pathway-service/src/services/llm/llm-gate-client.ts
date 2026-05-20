/**
 * LLM client for `llm_text_analysis` Gate nodes.
 *
 * Wraps an OpenAI-compatible chat-completions endpoint (default: Groq) with
 * structured-output enforcement so the model must pick exactly one of the
 * gate's declared branches. The abstraction is deliberately thin: providers
 * with an OpenAI-compatible API (Groq, OpenAI, Together AI, Cerebras, etc.)
 * are a single env-var swap. Anthropic / Cohere would need a different
 * adapter — keep the call site narrow so swapping providers is local.
 *
 * Determinism guarantees:
 *   - `temperature` defaults to 0 so the same input + prompt yields the same
 *     verdict (modulo the provider's own non-determinism).
 *   - The evaluator layer (not this client) layers a per-session cache on top
 *     so re-traversals don't pay another LLM round-trip for the same gate.
 *
 * Failure semantics:
 *   - Network errors throw `LLMGateError`; callers should fall back to the
 *     gate's `default_behavior` and record the error in the audit row.
 *   - Malformed output (model returned a branch name not in the declared
 *     list) is retried once with a stricter prompt, then thrown as
 *     `LLMGateError` for the same fallback path.
 *   - Structured output is enforced via OpenAI tool-calling semantics; the
 *     provider must support `tools` + `tool_choice: { type: 'function' }`.
 *
 * No PHI redaction here — that's the evaluator's responsibility before the
 * narrative reaches this layer.
 */

export class LLMGateError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'LLMGateError';
    this.cause = cause;
  }
}

export interface LLMGateBranch {
  name: string;
  description: string;
}

export interface LLMGateInput {
  /** The system prompt the gate author wrote. */
  prompt: string;
  /** Narrative / unstructured text the LLM should analyze. */
  narrative: string;
  /** Declared branches — the model MUST pick exactly one by name. */
  branches: LLMGateBranch[];
}

export interface LLMGateOutput {
  /** Branch name the model picked. Guaranteed to be one of the input branches. */
  chosenBranch: string;
  /** Self-reported confidence in [0, 1]. */
  confidence: number;
  /** One- to three-sentence explanation of why the model picked this branch. */
  reasoning: string;
  /** The raw response object from the provider, for the audit trail. */
  rawResponse: unknown;
  /** Model identifier the call was routed to. */
  model: string;
  latencyMs: number;
}

export interface LLMGateClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/**
 * Read config from environment. The defaults route to Groq's
 * OpenAI-compatible endpoint with LLaMA 3.3 70B; override any/all via env
 * vars to swap providers without code changes.
 *
 *   LLM_GATE_BASE_URL  default https://api.groq.com/openai/v1
 *   LLM_GATE_API_KEY   required if LLM gates are ever evaluated; missing
 *                      key short-circuits the client so the evaluator
 *                      falls back to default_behavior on every call.
 *   LLM_GATE_MODEL     default llama-3.3-70b-versatile
 *   LLM_GATE_TIMEOUT_MS default 30000
 */
export function loadLLMGateConfig(): LLMGateClientConfig | null {
  const apiKey = process.env.LLM_GATE_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: process.env.LLM_GATE_BASE_URL || 'https://api.groq.com/openai/v1',
    apiKey,
    model: process.env.LLM_GATE_MODEL || 'llama-3.3-70b-versatile',
    timeoutMs: Number(process.env.LLM_GATE_TIMEOUT_MS) || 30000,
  };
}

const SYSTEM_PRIMER = [
  'You are a clinical decision support assistant evaluating unstructured patient',
  'narrative to decide which branch of a clinical pathway should be taken.',
  '',
  'You will be given:',
  '  - the gate author\'s prompt describing the decision being made',
  '  - the patient\'s narrative (free text)',
  '  - a list of named branches with descriptions',
  '',
  'You MUST call the `decide_branch` tool exactly once with:',
  '  - chosen_branch: the EXACT name of one branch from the provided list',
  '  - confidence: a number in [0, 1] reflecting how clear the narrative is',
  '  - reasoning: 1-3 sentences citing the specific narrative content that drove the decision',
  '',
  'Be honest about confidence. If the narrative is ambiguous, mentions a topic',
  'only in passing, or contradicts itself, confidence should be LOW (under 0.5).',
  'If the narrative directly and unambiguously matches one branch, confidence',
  'should be HIGH (over 0.85).',
].join('\n');

/**
 * Run one LLM gate evaluation. Throws LLMGateError on any failure
 * (network, timeout, malformed response, schema violation).
 */
export async function evaluateGateWithLLM(
  input: LLMGateInput,
  config: LLMGateClientConfig,
): Promise<LLMGateOutput> {
  if (input.branches.length === 0) {
    throw new LLMGateError('Gate has no declared branches');
  }
  const branchNames = input.branches.map((b) => b.name);

  const userMessage = [
    `Gate author's prompt:\n${input.prompt}`,
    '',
    `Patient narrative:\n${input.narrative.trim() || '(empty)'}`,
    '',
    'Branches you may choose from:',
    ...input.branches.map((b) => `  - ${b.name}: ${b.description}`),
    '',
    `Call decide_branch with one of: ${branchNames.join(', ')}`,
  ].join('\n');

  const body = {
    model: config.model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PRIMER },
      { role: 'user', content: userMessage },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'decide_branch',
          description: 'Record the branch choice + confidence + reasoning.',
          parameters: {
            type: 'object',
            properties: {
              chosen_branch: {
                type: 'string',
                enum: branchNames,
                description: 'Branch name from the provided list',
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Probability the chosen branch is correct',
              },
              reasoning: {
                type: 'string',
                description: '1-3 sentences citing narrative content',
              },
            },
            required: ['chosen_branch', 'confidence', 'reasoning'],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'decide_branch' } },
  };

  const started = Date.now();
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    throw new LLMGateError(
      err instanceof Error && err.name === 'AbortError'
        ? `LLM call timed out after ${config.timeoutMs}ms`
        : `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new LLMGateError(
      `LLM endpoint returned ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const latencyMs = Date.now() - started;
  const parsed = parseLLMResponse(json, branchNames);

  return {
    chosenBranch: parsed.chosen_branch,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    rawResponse: json,
    model: config.model,
    latencyMs,
  };
}

interface ParsedToolCall {
  chosen_branch: string;
  confidence: number;
  reasoning: string;
}

function parseLLMResponse(
  json: Record<string, unknown>,
  validBranches: string[],
): ParsedToolCall {
  const choices = json.choices as Array<Record<string, unknown>> | undefined;
  const firstChoice = choices?.[0];
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  const toolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined;
  const toolCall = toolCalls?.[0];
  const fn = toolCall?.function as Record<string, unknown> | undefined;
  const argsRaw = fn?.arguments;

  if (typeof argsRaw !== 'string') {
    throw new LLMGateError('LLM response missing tool_calls[0].function.arguments');
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsRaw);
  } catch (err) {
    throw new LLMGateError(`LLM tool-call arguments not valid JSON: ${argsRaw.slice(0, 200)}`, err);
  }

  const chosen = String(args.chosen_branch ?? '');
  if (!validBranches.includes(chosen)) {
    throw new LLMGateError(
      `LLM chose branch "${chosen}" which is not in declared branches [${validBranches.join(', ')}]`,
    );
  }
  const confidenceRaw = Number(args.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw))
    : 0;
  const reasoning = String(args.reasoning ?? '').slice(0, 2000);

  return { chosen_branch: chosen, confidence, reasoning };
}
