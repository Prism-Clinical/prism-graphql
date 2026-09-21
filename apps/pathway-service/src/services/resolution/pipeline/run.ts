import type { Pool } from 'pg';
import type { AdditionalContextInput } from '../../../resolvers/mutations/resolution';
import type { PatientContext } from '../../confidence/types';
import { loadLLMGateConfig } from '../../llm/llm-gate-client';
import type { ConflictResolution } from '../care-plan-merge';
import { buildEffectivePatientContext } from '../effective-context';
import type { MultiPathwayResolutionSession } from '../multi-pathway-session-store';
import type { EvaluationTemporalContext } from '../temporal/evaluation-context';
import type { ResolutionSession } from '../types';
import { composeRun } from './compose';
import type { Contribution } from './compose';
import { auditingLlmClient } from './llm-audit';
import { loadRunEnv } from './load-env';
import type { RunEnv } from './load-env';
import { liveObservations } from './observations';
import { evaluateAs, newRequest, prewarmInBackground } from './request';
import type { EvaluationRequest } from './request';
import type { RunResult, SessionInputs } from './types';

/** A child's node-local inputs. The parent owns every patient fact and the clock (D5). */
export type ChildInputs = Omit<SessionInputs, 'initialPatientContext' | 'additionalContext' | 'temporalContext'>;

/** What a run stores: the parent's inputs and each child's node-local ones (spec §3, Data). */
export interface RunInputs {
  initialPatientContext: PatientContext;
  additionalContext: Partial<AdditionalContextInput>;
  temporalContext: EvaluationTemporalContext;
  conflictResolutions: Record<string, ConflictResolution>;
  /** In contributing order. `sessionId` is '' until the child row exists (start). */
  children: Array<{ sessionId: string; pathwayId: string; inputs: ChildInputs }>;
}

/** A run as loaded: the parent and its children, in contributing order. */
export interface Run {
  parent: MultiPathwayResolutionSession;
  children: ResolutionSession[];
}

/** A child's full inputs: its own, with the parent's facts and clock spliced in (D5). */
export const sessionInputsOf = (run: Omit<RunInputs, 'children'>, child: ChildInputs): SessionInputs => ({
  ...child,
  initialPatientContext: run.initialPatientContext,
  additionalContext: run.additionalContext,
  temporalContext: run.temporalContext,
});

/** The inputs a run mutation starts from: fresh copies, so changing them cannot edit the loaded run. */
export function runInputsOf(run: Run): RunInputs {
  return {
    initialPatientContext: run.parent.initialPatientContext as PatientContext,
    additionalContext: { ...run.parent.additionalContext },
    temporalContext: run.parent.temporalContext,
    conflictResolutions: { ...run.parent.conflictResolutions },
    children: run.children.map((c) => ({
      sessionId: c.id,
      pathwayId: c.pathwayId,
      inputs: {
        pathwayId: c.pathwayId,
        graphFingerprint: c.graphFingerprint,
        gateAnswers: new Map(c.gateAnswers),
        providerOverrides: new Map(c.providerOverrides),
        observations: new Map(c.observations),
        revision: c.revision,
      },
    })),
  };
}

/** The drug names a run's write-ins add to the candidate universe (C1). */
export const writeInsOf = (decisions: Record<string, ConflictResolution>): string[] =>
  Object.values(decisions).flatMap((d) => (d.kind === 'CUSTOM_OVERRIDE' ? [d.customMedication.name] : [])).sort();

/**
 * What survives a run request's retries, per child (D9, C1): its acquired
 * observations and its LLM audit rows. Audit rows are filed under the child's
 * session id, so they are kept apart by pathway.
 */
export type RunRequest = Map<string, EvaluationRequest>;

export const newRunRequest = (): RunRequest => new Map();

export function requestFor(request: RunRequest, pathwayId: string): EvaluationRequest {
  let r = request.get(pathwayId);
  if (!r) {
    r = newRequest();
    request.set(pathwayId, r);
  }
  return r;
}

/** After a transaction that wrote them commits, the audit rows must not be written again. */
export const clearAudits = (request: RunRequest): void => {
  for (const r of request.values()) r.audits.length = 0;
};

export interface RunEvaluation {
  env: RunEnv;
  /** The inputs evaluated — graph fingerprints pinned and empty graphs dropped when starting. */
  inputs: RunInputs;
  result: RunResult;
  durationMs: number;
}

/**
 * One attempt at a whole run: one snapshot for every child (C4, D13), the
 * non-blocking pre-warm (D14), every child evaluated at CONTRIBUTION scope
 * with the parent's facts (D5), then `composeRun`. `pinGraphs` is for a run
 * being started: each child adopts its snapshot graph's fingerprint, and a
 * pathway whose graph is empty contributes no child.
 */
export async function evaluateRun(
  pool: Pool,
  request: RunRequest,
  inputs: RunInputs,
  opts: { pinGraphs?: boolean } = {},
): Promise<RunEvaluation> {
  const patient = buildEffectivePatientContext(inputs.initialPatientContext, inputs.additionalContext);
  const env = await loadRunEnv(pool, inputs.children.map((c) => c.pathwayId), {
    patient,
    writeIns: writeInsOf(inputs.conflictResolutions),
  });
  prewarmInBackground(pool, env.unnormalized);

  const started = Date.now();
  const config = loadLLMGateConfig();
  const children: RunInputs['children'] = [];
  const contributions: Contribution[] = [];
  for (const child of inputs.children) {
    const childEnv = env.children.get(child.pathwayId)!;
    if (opts.pinGraphs && childEnv.resolution.graphContext.allNodes.length === 0) continue;
    const own = opts.pinGraphs ? { ...child.inputs, graphFingerprint: childEnv.graphFingerprint } : child.inputs;
    const req = requestFor(request, child.pathwayId);
    const provider = liveObservations(
      own.observations,
      req.requestObservations,
      auditingLlmClient(config, child.pathwayId, req.audits),
      childEnv.llmModel ?? '',
    );
    const result = await evaluateAs(sessionInputsOf(inputs, own), childEnv, provider, 'CONTRIBUTION');
    children.push({ ...child, inputs: own });
    contributions.push({ pathwayId: child.pathwayId, sessionId: child.sessionId, result });
  }

  const result = composeRun(contributions, {
    patient,
    conflictResolutions: inputs.conflictResolutions,
    safety: env.safety,
    meta: env.meta,
    envFingerprint: env.envFingerprint,
  });
  return { env, inputs: { ...inputs, children }, result, durationMs: Date.now() - started };
}
