import { ConfidenceEngine } from '../../services/confidence/confidence-engine';
import { ScorerRegistry } from '../../services/confidence/scorer-registry';
import { WeightCascadeResolver } from '../../services/confidence/weight-cascade-resolver';
import { GraphEdge, GraphNode, ScoringType, SignalDefinition, ThresholdScope, WeightSource } from '../../services/confidence/types';
import { buildGraphContext } from '../../resolvers/helpers/resolution-context';
import type { ResolutionContext } from '../../resolvers/helpers/resolution-context';
import { EvaluationEnv, graphFingerprintOf } from '../../services/resolution/pipeline/load-env';
import type { SafetyReference } from '../../services/medications/safety-reference';
import type { SessionInputs } from '../../services/resolution/pipeline/types';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import type { PathwayTemporalDefaults } from '../../services/resolution/temporal/cascade';

export const node = (id: string, type: string, props: Record<string, unknown> = {}): GraphNode =>
  ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } });
export const edge = (s: string, t: string, type = 'HAS_CHILD', properties: Record<string, unknown> = {}): GraphEdge =>
  ({ id: `${s}->${t}`, edgeType: type, sourceId: s, targetId: t, properties });

const SIGNAL: SignalDefinition = {
  id: '00000000-0000-4000-a000-0000000000a1', name: 'data_completeness', displayName: 'Data', description: '',
  scoringType: ScoringType.DATA_PRESENCE, scoringRules: {}, propagationConfig: { mode: 'none' },
  scope: 'SYSTEM', defaultWeight: 1, isActive: true,
};

/** Each node scores its `score` property (default 0.9). */
function registry(): ScorerRegistry {
  const r = new ScorerRegistry();
  r.register({
    scoringType: ScoringType.DATA_PRESENCE,
    declareRequiredInputs: () => [],
    score: ({ node: n }: { node: GraphNode }) => ({ score: (n.properties.score as number) ?? 0.9, missingInputs: [] }),
  } as never);
  return r;
}

export interface EnvOptions {
  signals?: SignalDefinition[];
  registry?: ScorerRegistry;
  temporalDefaults?: PathwayTemporalDefaults;
}

export function makeEnv(nodes: GraphNode[], edges: GraphEdge[], safety: Partial<SafetyReference> = {}, opts: EnvOptions = {}): EvaluationEnv {
  const signals = opts.signals ?? [SIGNAL];
  const resolution: ResolutionContext = {
    graphContext: buildGraphContext(nodes, edges),
    edges,
    signals,
    thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    confidenceEngine: new ConfidenceEngine(opts.registry ?? registry(), new WeightCascadeResolver()),
    codeMap: new Map(),
    temporalDefaults: opts.temporalDefaults ?? {},
  };
  return {
    resolution,
    scoring: {
      adminEvidenceEntries: [],
      weightMatrix: Object.fromEntries(nodes.map((n) => [
        n.nodeIdentifier,
        Object.fromEntries(signals.map((s) => [s.name, { weight: 1, source: WeightSource.SYSTEM_DEFAULT }])),
      ])),
      nodeWeightMap: new Map(),
      propagationOverrides: new Map(),
      thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6, scope: ThresholdScope.SYSTEM_DEFAULT },
    },
    safety: { normalized: new Map(), pairs: new Map(), classRules: [], allergyMappings: [], ...safety },
    graphFingerprint: graphFingerprintOf(resolution),
    envFingerprint: 'env-test',
    llmModel: 'test-model',
    unnormalized: [],
  };
}

export function makeInputs(env: EvaluationEnv, patch: Partial<SessionInputs> = {}): SessionInputs {
  return {
    pathwayId: 'pw-test',
    graphFingerprint: env.graphFingerprint,
    temporalContext: makeEvaluationTemporalContext({ evaluationAsOf: '2026-09-15T12:00:00.000Z', temporalPolicyVersion: 'v1' }),
    initialPatientContext: { patientId: 'patient-1', conditionCodes: [], medications: [], labResults: [], allergies: [] },
    additionalContext: {},
    gateAnswers: new Map(),
    providerOverrides: new Map(),
    observations: new Map(),
    revision: 0,
    ...patch,
  };
}
