import { GraphQLError } from 'graphql';
import type { Pool, PoolClient } from 'pg';
import { loadLLMGateConfig } from '../../llm/llm-gate-client';
import { prewarmMedications } from '../../medications/normalizer';
import type { MedicationInput } from '../../medications/types';
import type { LlmAuditRow } from '../session-store';
import { buildEffectivePatientContext } from '../effective-context';
import { EvaluationError, evaluate } from './evaluate';
import { loadEvaluationEnv } from './load-env';
import type { EvaluationEnv } from './load-env';
import { auditingLlmClient } from './llm-audit';
import { liveObservations } from './observations';
import type { ObservationProvider } from './observations';
import type { EvaluationResult, EvaluationScope, LlmObservation, ObservationKey, SessionInputs } from './types';

/** What survives a request's retries (D9, C1): acquired observations, and every LLM call made. */
export interface EvaluationRequest {
  requestObservations: Map<ObservationKey, LlmObservation>;
  /** Written once, in the transaction that commits — or after the last failed attempt. */
  audits: LlmAuditRow[];
}

export const newRequest = (): EvaluationRequest => ({ requestObservations: new Map(), audits: [] });

export interface SessionEvaluation {
  env: EvaluationEnv;
  /** The inputs evaluated — with the graph fingerprint pinned when starting. */
  inputs: SessionInputs;
  result: EvaluationResult;
  durationMs: number;
}

/**
 * One evaluation attempt: snapshot (C4), non-blocking pre-warm of what the
 * snapshot could not normalise (D14), and `evaluate` with live observations
 * (C1). `pinGraph` is for a session being created: it adopts the snapshot's
 * graph fingerprint instead of checking against one.
 */
export async function evaluateSession(
  pool: Pool,
  request: EvaluationRequest,
  inputs: SessionInputs,
  scope: EvaluationScope,
  opts: { pinGraph?: boolean } = {},
): Promise<SessionEvaluation> {
  const patient = buildEffectivePatientContext(inputs.initialPatientContext, inputs.additionalContext);
  const env = await loadEvaluationEnv(pool, inputs.pathwayId, { patient });
  prewarmInBackground(pool, env.unnormalized);

  const pinned = opts.pinGraph ? { ...inputs, graphFingerprint: env.graphFingerprint } : inputs;
  const client = auditingLlmClient(loadLLMGateConfig(), inputs.pathwayId, request.audits);
  const provider = liveObservations(pinned.observations, request.requestObservations, client, env.llmModel ?? '');

  const started = Date.now();
  const result = await evaluateAs(pinned, env, provider, scope);
  return { env, inputs: pinned, result, durationMs: Date.now() - started };
}

/** The session's observations plus the request observations this result used — nothing else (spec §4). */
export function persistedObservations(
  inputs: SessionInputs,
  request: EvaluationRequest,
  result: EvaluationResult,
): Map<ObservationKey, LlmObservation> {
  const out = new Map(inputs.observations);
  for (const key of result.observationsUsed) {
    const obs = request.requestObservations.get(key);
    if (obs && !out.has(key)) out.set(key, obs);
  }
  return out;
}

/** `evaluate`, with an EvaluationError surfaced under its GraphQL code. */
export async function evaluateAs(
  inputs: SessionInputs,
  env: EvaluationEnv,
  provider: ObservationProvider,
  scope: EvaluationScope,
): Promise<EvaluationResult> {
  try {
    return await evaluate(inputs, env, provider, scope);
  } catch (err) {
    if (err instanceof EvaluationError) {
      throw new GraphQLError(err.message, { extensions: { code: err.code } });
    }
    throw err;
  }
}

/**
 * Pre-warm after the snapshot, never awaited (C4, D14). RxNav can take seconds
 * per drug; a later mutation sees the rows this writes. Failures are logged:
 * `prewarmMedications` already caches no-match as a NULL row for the admin
 * queue and leaves network errors for the next attempt.
 *
 * The inputs pass through WHOLE. The cache key is text + system + code, so a
 * coded patient medication pre-warmed by its text alone would land in a row
 * evaluation never reads, and its SAFETY_DATA_UNAVAILABLE would never clear.
 */
export function prewarmInBackground(pool: Pool, inputs: MedicationInput[]): void {
  if (inputs.length === 0) return;
  void prewarmMedications(pool, inputs)
    .then(({ succeeded, failed }) => console.info(`[prewarm] ${succeeded} normalised, ${failed} not`))
    .catch((err) => console.warn('[prewarm] failed:', err instanceof Error ? err.message : err));
}

/** Thrown inside a transaction when the revision check matched no row; the caller reloads and retries. */
export class RevisionConflict extends Error {
  constructor() {
    super('revision conflict');
    this.name = 'RevisionConflict';
  }
}

/** One transaction on one client. Any throw — RevisionConflict included — rolls back. */
export async function inTransaction<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch((): void => undefined);
    throw err;
  } finally {
    client.release();
  }
}
