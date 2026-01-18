/**
 * PRISM CISS Types
 *
 * Shared TypeScript types for Clinical Information and Support System services.
 *
 * @example
 * ```typescript
 * import {
 *   TranscriptionStatus,
 *   SafetySeverity,
 *   CarePlanStatus,
 *   GuidelineCategory,
 *   Connection,
 *   createConnection,
 * } from '@prism/ciss-types';
 *
 * // Use enums
 * const status: TranscriptionStatus = TranscriptionStatus.PENDING;
 *
 * // Create connections
 * const connection = createConnection(
 *   nodes,
 *   totalCount,
 *   (node) => node.id,
 * );
 * ```
 */

// Common types
export {
  // Types
  PaginationInput,
  PageInfo,
  Edge,
  Connection,
  DateTime,
  DateOnly,
  UUID,
  MedicalCode,
  AuditFields,
  PatientEntity,
  EncounterEntity,
  BaseEntity,
  // Helper functions
  createConnection,
  encodeCursor,
  decodeCursor,
} from './common';

// Transcription types
export {
  // Enums
  TranscriptionStatus,
  EntityType,
  SpeakerRole,
  // Types
  Transcription,
  TranscriptResult,
  TranscriptSegment,
  ExtractedEntity,
  TranscribeAudioInput,
  TranscriptionFilterInput,
  TranscriptionConnection,
  // Database row types
  TranscriptionRow,
  TranscriptSegmentRow,
  ExtractedEntityRow,
} from './transcription';

// RAG/Guideline types
export {
  // Enums
  GuidelineSource,
  GuidelineCategory,
  EvidenceGrade,
  RecommendationStrength,
  RAGQueryType,
  SynthesisStatus,
  // Types
  Guideline,
  Citation,
  RAGSynthesis,
  SynthesizedRecommendation,
  ApplicabilityFactor,
  GuidelineFilterInput,
  RAGQueryInput,
  GuidelineConnection,
  // Database row types
  GuidelineRow,
  RAGSynthesisRow,
} from './rag';

// Safety types
export {
  // Enums
  SafetyCheckType,
  SafetySeverity,
  SafetyCheckStatus,
  ReviewQueueStatus,
  ReviewPriority,
  OverrideReason,
  // Types
  SafetyCheck,
  SafetyOverride,
  ReviewQueueItem,
  ReviewResolution,
  SafetyValidationResult,
  SafetyValidationInput,
  SafetyCheckFilterInput,
  ReviewQueueFilterInput,
  OverrideSafetyCheckInput,
  ResolveReviewInput,
  SafetyCheckConnection,
  ReviewQueueConnection,
  // Database row types
  SafetyCheckRow,
  ReviewQueueRow,
} from './safety';

// Care Plan types
export {
  // Enums
  CarePlanStatus,
  GoalStatus,
  GoalPriority,
  InterventionType,
  InterventionStatus,
  TemplateCategory,
  // Types
  CarePlan,
  CarePlanGoal,
  GoalProgressNote,
  CarePlanIntervention,
  CarePlanTemplate,
  TemplateGoal,
  TemplateIntervention,
  CreateCarePlanInput,
  AddGoalInput,
  AddInterventionInput,
  UpdateGoalStatusInput,
  UpdateInterventionStatusInput,
  CarePlanFilterInput,
  TemplateFilterInput,
  CarePlanConnection,
  CarePlanTemplateConnection,
  // Database row types
  CarePlanRow,
  CarePlanGoalRow,
  CarePlanInterventionRow,
  CarePlanTemplateRow,
} from './careplan';
