export * from './types';
export { evaluateGate } from './gate-evaluator';
export { TraversalEngine } from './traversal-engine';
export type { TraversalConfidenceAdapter } from './types';
export {
  serializeResolutionState,
  deserializeResolutionState,
  getSession,
  logEvent,
  logNodeOverride,
  logGateAnswer,
  getMatchedPathways,
  getPatientSessions,
} from './session-store';
export { generateCarePlan } from './care-plan-generator';
export type { CarePlanData, CarePlanGoalData, CarePlanInterventionData } from './care-plan-generator';
