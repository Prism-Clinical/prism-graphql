import { assertEncounterAnchor } from '../../../resolvers/helpers/resolution-context';
import type { GraphNode, NodeConfidenceResult } from '../../confidence/types';
import { buildEffectivePatientContext } from '../effective-context';
import { factStoreFor } from '../temporal/fact-store';
import { TraversalEngine } from '../traversal-engine';
import { hashOf } from './canonical';
import { applyDisposition, medicationCandidates } from './disposition';
import { catchUpItemsFor, gateContextFieldsOf } from './findings';
import type { EvaluationEnv } from './load-env';
import type { ObservationProvider } from './observations';
import { readinessOf } from './readiness';
import { pairSafety, patientSafety } from './safety';
import type { EvaluationResult, EvaluationScope, SessionInputs } from './types';

export class EvaluationError extends Error {
  constructor(message: string, readonly code: 'SESSION_GRAPH_CHANGED') {
    super(message);
    this.name = 'EvaluationError';
  }
}

const unscored = (n: GraphNode): NodeConfidenceResult =>
  ({ nodeIdentifier: n.nodeIdentifier, nodeType: n.nodeType, confidence: 0, breakdown: [], propagationInfluences: [] });

/**
 * The deterministic core (spec C1, §2). Frozen inputs, env and observations
 * (`replay`) give an identical result, `resultHash` included. No I/O except
 * through `observations`.
 */
export async function evaluate(
  inputs: SessionInputs,
  env: EvaluationEnv,
  observations: ObservationProvider,
  scope: EvaluationScope,
): Promise<EvaluationResult> {
  if (env.graphFingerprint !== inputs.graphFingerprint) {
    throw new EvaluationError(`pathway ${inputs.pathwayId} graph changed since the session started`, 'SESSION_GRAPH_CHANGED');
  }
  const rctx = env.resolution;

  // 1. Context
  const patient = buildEffectivePatientContext(inputs.initialPatientContext, inputs.additionalContext);
  assertEncounterAnchor(rctx, inputs.temporalContext);
  const factStore = factStoreFor(patient, inputs.temporalContext);

  // 2. Scores — once, whole graph
  const scored = rctx.confidenceEngine.scorePathway(env.scoring, {
    pathwayId: inputs.pathwayId,
    nodes: rctx.graphContext.allNodes,
    edges: rctx.edges,
    signalDefinitions: rctx.signals,
    patientContext: patient,
  });
  const scores = new Map(scored.nodes.map((n) => [n.nodeIdentifier, n]));

  // 3. Traverse → eligibility
  const engine = new TraversalEngine(
    { computeNodeConfidence: async (n: GraphNode) => scores.get(n.nodeIdentifier) ?? unscored(n) },
    rctx.thresholds,
    inputs.temporalContext,
    rctx.temporalDefaults,
    factStore,
    rctx.codeMap,
    observations.evaluator,
  );
  const t = await engine.traverse(rctx.graphContext, patient, inputs.gateAnswers, inputs.providerOverrides);

  // 4. Findings
  const catchUpItems = catchUpItemsFor(t.resolutionState, patient, rctx.graphContext, inputs.pathwayId);
  const gateContextFields = gateContextFieldsOf(t.dependencyMap);

  // 5–6. Safety → disposition
  const candidates = medicationCandidates(t.resolutionState);
  const patientOutcome = patientSafety(env.safety, candidates, patient);
  const setOutcome = scope === 'ROOT'
    ? pairSafety(env.safety, candidates.filter((c) => !patientOutcome.suppressed.has(c.recommendationId)))
    : { findings: [], suppressed: new Set<string>() };
  const safetyFindings = [...patientOutcome.findings, ...setOutcome.findings];
  const resolutionState = applyDisposition(t.resolutionState, safetyFindings);

  // 7. Readiness
  const { ready, blockers, status } = readinessOf({
    state: resolutionState,
    pendingQuestions: t.pendingQuestions,
    redFlags: t.redFlags,
    unavailable: patientOutcome.unavailable,
    scope,
    isDegraded: t.isDegraded,
  });

  const result: Omit<EvaluationResult, 'resultHash'> = {
    scope,
    resolutionState,
    pendingQuestions: t.pendingQuestions,
    redFlags: t.redFlags,
    safetyFindings,
    safetyUnavailable: patientOutcome.unavailable,
    catchUpItems,
    gateContextFields,
    readiness: { ready, blockers },
    status,
    observationsUsed: [...observations.used].sort(),
    envFingerprint: env.envFingerprint,
  };
  return { ...result, resultHash: resultHashOf(result) };
}

const by = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

const omit = (o: object, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** Spec §1 rule 8: what a provider reviews — no confidences, durations, reasoning text or fingerprints. */
export function resultHashOf(r: Omit<EvaluationResult, 'resultHash'>): string {
  return hashOf({
    nodes: [...r.resolutionState.values()]
      .map((n) => ({
        nodeId: n.nodeId,
        eligibility: n.eligibility?.status ?? null,
        disposition: n.disposition?.status ?? null,
        withheldBy: n.disposition?.withheldBy ?? null,
        excludeReason: n.excludeReason ?? null,
        override: n.providerOverride?.action ?? null,
      }))
      .sort(by((n) => n.nodeId)),
    pendingQuestions: [...r.pendingQuestions]
      .sort(by((q) => q.gateId))
      .map((q) => omit(q, ['tentativeReasoning', 'tentativeConfidence'])),
    redFlags: [...r.redFlags].sort(by((f) => `${f.nodeId}|${f.type}`)),
    safetyFindings: [...r.safetyFindings]
      .sort(by((f) => `${f.recommendationId}|${f.category}|${JSON.stringify(f.source)}|${f.scope}`))
      .map((f) => omit(f, ['meta'])),
    catchUpItems: [...r.catchUpItems].sort(by((c) => c.nodeId)),
    blockers: [...r.readiness.blockers].sort(by((b) => `${b.scope}|${b.type}|${b.relatedNodeIds.join(',')}`)),
  });
}
