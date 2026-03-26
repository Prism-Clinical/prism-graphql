export * from './types';
export { evaluateGate } from './gate-evaluator';
export { TraversalEngine } from './traversal-engine';
export { detectCycle, enforceTimeout, checkMissingCriticalData, isCascadeLimitReached, TraversalTimeoutError } from './safety';
export { RetraversalEngine } from './retraversal-engine';
export type { RetraversalConfidenceAdapter } from './retraversal-engine';
export type { TraversalConfidenceAdapter } from './types';
export {
  serializeResolutionState,
  deserializeResolutionState,
  serializeDependencyMap,
  deserializeDependencyMap,
  createSession,
  getSession,
  updateSession,
  logEvent,
  logNodeOverride,
  logGateAnswer,
  getMatchedPathways,
  getPatientSessions,
} from './session-store';
export { validateForGeneration, generateCarePlan } from './care-plan-generator';
export type { CarePlanData, CarePlanGoalData, CarePlanInterventionData } from './care-plan-generator';
