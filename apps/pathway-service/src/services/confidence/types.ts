import {
  ScoringType,
  SignalScope,
  WeightScope,
  ThresholdScope,
  PropagationMode,
  WeightSource,
  ResolutionType,
} from '../../types';

export {
  ScoringType,
  SignalScope,
  WeightScope,
  ThresholdScope,
  PropagationMode,
  WeightSource,
  ResolutionType,
};

export const BUILTIN_SIGNAL_IDS = {
  DATA_COMPLETENESS: '00000000-0000-4000-a000-000000000001',
  EVIDENCE_STRENGTH: '00000000-0000-4000-a000-000000000002',
  MATCH_QUALITY: '00000000-0000-4000-a000-000000000003',
  RISK_MAGNITUDE: '00000000-0000-4000-a000-000000000004',
} as const;

// ─── Graph Types ─────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  nodeIdentifier: string;
  nodeType: string;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  edgeType: string;
  sourceId: string;
  targetId: string;
  properties: Record<string, unknown>;
}

export interface GraphContext {
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  incomingEdges(nodeId: string): GraphEdge[];
  outgoingEdges(nodeId: string): GraphEdge[];
  getNode(nodeId: string): GraphNode | undefined;
  linkedNodes(nodeId: string, edgeType: string): GraphNode[];
}

// ─── Signal Definition (DB-hydrated) ─────────────────────────────────

export interface PropagationConfig {
  mode: 'none' | 'direct' | 'transitive_with_decay';
  decayFactor?: number;
  maxHops?: number;
  edgeTypes?: string[];
  sourceNodeTypes?: string[];
  immuneToSignals?: string[];
}

export function normalizePropagationMode(mode: string): PropagationConfig['mode'] {
  const map: Record<string, PropagationConfig['mode']> = {
    NONE: 'none',
    DIRECT: 'direct',
    TRANSITIVE_WITH_DECAY: 'transitive_with_decay',
    none: 'none',
    direct: 'direct',
    transitive_with_decay: 'transitive_with_decay',
  };
  return map[mode] ?? 'none';
}

export interface ScoringRules {
  propagation?: PropagationConfig;
  [key: string]: unknown;
}

export interface SignalDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  scoringType: ScoringType;
  scoringRules: ScoringRules;
  propagationConfig: PropagationConfig;
  scope: 'SYSTEM' | 'ORGANIZATION' | 'INSTITUTION';
  institutionId?: string;
  defaultWeight: number;
  isActive: boolean;
}

// ─── Scorer Interface ────────────────────────────────────────────────

export interface RequiredInput {
  name: string;
  source: 'patient_context' | 'graph_node' | 'linked_node';
  required: boolean;
}

export interface SignalScore {
  score: number;
  missingInputs: string[];
  metadata?: Record<string, unknown>;
}

export interface ScorerParams {
  node: GraphNode;
  signalDefinition: SignalDefinition;
  patientContext: PatientContext;
  graphContext: GraphContext;
}

export interface SignalScorer {
  readonly scoringType: ScoringType;
  declareRequiredInputs(node: GraphNode, signalConfig: SignalDefinition): RequiredInput[];
  score(params: ScorerParams): SignalScore;
  propagate?(params: PropagationParams): PropagationResult;
}

// ─── Propagation ─────────────────────────────────────────────────────

export interface PropagationParams {
  sourceNode: GraphNode;
  sourceScore: number;
  targetNode: GraphNode;
  edge: GraphEdge;
  propagationConfig: PropagationConfig;
  hopDistance: number;
}

export interface PropagationResult {
  propagatedScore: number;
  shouldPropagate: boolean;
}

// Shared propagation implementations — used by scorers with identical logic
export function defaultDirectPropagate(params: PropagationParams): PropagationResult {
  const { sourceScore, propagationConfig } = params;
  if (propagationConfig.mode === 'none') {
    return { propagatedScore: 0, shouldPropagate: false };
  }
  return { propagatedScore: sourceScore, shouldPropagate: false };
}

export function defaultTransitivePropagate(params: PropagationParams): PropagationResult {
  const { sourceScore, propagationConfig, hopDistance } = params;
  if (propagationConfig.mode === 'none') {
    return { propagatedScore: 0, shouldPropagate: false };
  }
  if (propagationConfig.mode === 'direct') {
    return { propagatedScore: sourceScore, shouldPropagate: false };
  }
  const maxHops = propagationConfig.maxHops ?? 3;
  if (hopDistance > maxHops) {
    return { propagatedScore: 0, shouldPropagate: false };
  }
  const decay = propagationConfig.decayFactor ?? 0.8;
  return {
    propagatedScore: sourceScore * Math.pow(decay, hopDistance),
    shouldPropagate: hopDistance < maxHops,
  };
}

// ─── Patient Context ─────────────────────────────────────────────────

export interface CodeEntry {
  code: string;
  system: string;
  display?: string;
}

export interface LabResult {
  code: string;
  system: string;
  value?: number;
  unit?: string;
  date?: string;
  display?: string;
}

export interface PatientContext {
  patientId: string;
  conditionCodes: CodeEntry[];
  medications: CodeEntry[];
  labResults: LabResult[];
  allergies: CodeEntry[];
  vitalSigns?: Record<string, unknown>;
}

// ─── Weight Cascade ──────────────────────────────────────────────────

export interface ResolvedWeight {
  weight: number;
  source: WeightSource;
}

export interface NodeIdentifier {
  nodeIdentifier: string;
  nodeType: string;
}

export type WeightMatrix = Record<string, Record<string, ResolvedWeight>>;

// ─── Confidence Engine Results ───────────────────────────────────────

export interface PathwayConfidenceResult {
  pathwayId: string;
  overallConfidence: number;
  nodes: NodeConfidenceResult[];
}

export interface NodeConfidenceResult {
  nodeIdentifier: string;
  nodeType: string;
  confidence: number;
  resolutionType?: ResolutionType;
  breakdown: SignalBreakdown[];
  propagationInfluences: PropagationInfluence[];
}

export interface SignalBreakdown {
  signalName: string;
  score: number;
  weight: number;
  weightSource: WeightSource;
  missingInputs: string[];
}

export interface PropagationInfluence {
  sourceNodeIdentifier: string;
  signalName: string;
  originalScore: number;
  propagatedScore: number;
  hopDistance: number;
}

// ─── Resolved Thresholds ─────────────────────────────────────────────

export interface ResolvedThresholds {
  autoResolveThreshold: number;
  suggestThreshold: number;
  scope: ThresholdScope;
}
