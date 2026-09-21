import type { PatientContext } from '../../confidence/types';
import type { AdditionalContextInput } from '../../../resolvers/mutations/resolution';
import type { EvaluationTemporalContext } from '../temporal/evaluation-context';
import type { BlockerType } from '../../../types';
import type { CatchUpItem, MergedCarePlan } from '../care-plan-merge';
import type { DdiFinding } from '../../medications/ddi-pass';
import type { GateAnswer, PendingQuestion, ProviderOverride, RedFlag, ResolutionState } from '../types';

export type ObservationKey = string;

/** A successful LLM verdict recorded as a session input (spec C1). */
export interface LlmObservation {
  key: ObservationKey;
  gateId: string;
  chosenBranch: string;
  confidence: number;
  reasoning: string;
  model: string;
  acquiredAt: string;
}

/** What a session stores: inputs only (spec §1). */
export interface SessionInputs {
  pathwayId: string;
  graphFingerprint: string;
  temporalContext: EvaluationTemporalContext;
  initialPatientContext: PatientContext;
  additionalContext: Partial<AdditionalContextInput>;
  gateAnswers: Map<string, GateAnswer>;
  providerOverrides: Map<string, ProviderOverride>;
  observations: Map<ObservationKey, LlmObservation>;
  revision: number;
}

export type EvaluationScope = 'ROOT' | 'CONTRIBUTION';
export type BlockerScope = 'COMPLETENESS' | 'OUTPUT';
/** The enum's string values (a string enum rejects bare literals), plus the pipeline-only type. */
export type PipelineBlockerType = `${BlockerType}` | 'SAFETY_DATA_UNAVAILABLE';

export interface ScopedBlocker {
  scope: BlockerScope;
  type: PipelineBlockerType;
  description: string;
  relatedNodeIds: string[];
}

export interface ScopedFinding extends DdiFinding {
  scope: 'PATIENT' | 'SET';
}

/** A medication the snapshot could not normalise (D14). */
export interface SafetyUnavailable {
  drugName: string;
  source: 'CANDIDATE' | 'PATIENT_MEDICATION';
  nodeId?: string;
}

export interface EvaluationResult {
  scope: EvaluationScope;
  resolutionState: ResolutionState;
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  safetyFindings: ScopedFinding[];
  safetyUnavailable: SafetyUnavailable[];
  catchUpItems: CatchUpItem[];
  gateContextFields: Map<string, string[]>;
  readiness: { ready: boolean; blockers: ScopedBlocker[] };
  status: 'ACTIVE' | 'DEGRADED';
  observationsUsed: ObservationKey[];
  envFingerprint: string;
  resultHash: string;
}

/** A blocker at the root of a run. A completeness blocker propagated from a child names its pathway (C3). */
export interface RunBlocker extends ScopedBlocker {
  pathwayId?: string;
}

/** One child of a run after composition. */
export interface RunChildResult {
  pathwayId: string;
  /** '' before the child row exists (start). */
  sessionId: string;
  /**
   * The contribution, with the root's dispositions — conflict losers and pair
   * suppressions — applied to its nodes (P4-2). `resultHash` stays the
   * contribution's own.
   */
  result: EvaluationResult;
}

/** A composed run (spec §3). */
export interface RunResult {
  mergedPlan: MergedCarePlan;
  /** Findings the root raised: write-ins against the patient, and every pair (C3). */
  safetyFindings: ScopedFinding[];
  /** Every WARN finding in the run: the contributions' and the root's. */
  ddiWarnings: ScopedFinding[];
  readiness: { ready: boolean; blockers: RunBlocker[] };
  /** In contributing order. */
  children: RunChildResult[];
  envFingerprint: string;
  resultHash: string;
}
