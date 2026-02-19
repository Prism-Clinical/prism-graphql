import { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import { DataSourceContext } from '../types/DataSourceContext';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  Date: { input: any; output: any; }
  DateTime: { input: any; output: any; }
  _FieldSet: { input: any; output: any; }
};

export type AddGoalInput = {
  carePlanId: Scalars['ID']['input'];
  description: Scalars['String']['input'];
  guidelineReference?: InputMaybe<Scalars['String']['input']>;
  priority: GoalPriority;
  targetDate?: InputMaybe<Scalars['Date']['input']>;
  targetValue?: InputMaybe<Scalars['String']['input']>;
};

export type AddInterventionInput = {
  carePlanId: Scalars['ID']['input'];
  description: Scalars['String']['input'];
  dosage?: InputMaybe<Scalars['String']['input']>;
  frequency?: InputMaybe<Scalars['String']['input']>;
  guidelineReference?: InputMaybe<Scalars['String']['input']>;
  medicationCode?: InputMaybe<Scalars['String']['input']>;
  patientInstructions?: InputMaybe<Scalars['String']['input']>;
  procedureCode?: InputMaybe<Scalars['String']['input']>;
  referralSpecialty?: InputMaybe<Scalars['String']['input']>;
  scheduledDate?: InputMaybe<Scalars['Date']['input']>;
  type: InterventionType;
};

export type CarePlan = {
  __typename?: 'CarePlan';
  actualEndDate?: Maybe<Scalars['Date']['output']>;
  conditionCodes: Array<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  createdBy?: Maybe<Scalars['ID']['output']>;
  goals: Array<CarePlanGoal>;
  id: Scalars['ID']['output'];
  interventions: Array<CarePlanIntervention>;
  isTrainingExample: Scalars['Boolean']['output'];
  lastReviewedAt?: Maybe<Scalars['DateTime']['output']>;
  lastReviewedBy?: Maybe<Scalars['ID']['output']>;
  nextReviewDate?: Maybe<Scalars['Date']['output']>;
  patient?: Maybe<Patient>;
  progress?: Maybe<Scalars['Int']['output']>;
  sourceRAGSynthesisId?: Maybe<Scalars['ID']['output']>;
  sourceTranscriptionId?: Maybe<Scalars['ID']['output']>;
  startDate: Scalars['Date']['output'];
  status: CarePlanStatus;
  targetEndDate?: Maybe<Scalars['Date']['output']>;
  templateId?: Maybe<Scalars['ID']['output']>;
  title: Scalars['String']['output'];
  trainingDescription?: Maybe<Scalars['String']['output']>;
  trainingTags?: Maybe<Array<Scalars['String']['output']>>;
  updatedAt: Scalars['DateTime']['output'];
};

export type CarePlanConnection = {
  __typename?: 'CarePlanConnection';
  edges: Array<CarePlanEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CarePlanEdge = {
  __typename?: 'CarePlanEdge';
  cursor: Scalars['String']['output'];
  node: CarePlan;
};

export type CarePlanEditInput = {
  field: Scalars['String']['input'];
  value: Scalars['String']['input'];
};

export type CarePlanFilterInput = {
  conditionCode?: InputMaybe<Scalars['String']['input']>;
  createdAfter?: InputMaybe<Scalars['DateTime']['input']>;
  createdBefore?: InputMaybe<Scalars['DateTime']['input']>;
  patientId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<CarePlanStatus>;
};

export type CarePlanGoal = {
  __typename?: 'CarePlanGoal';
  createdAt: Scalars['DateTime']['output'];
  currentValue?: Maybe<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  guidelineReference?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  linkedInterventionIds: Array<Scalars['ID']['output']>;
  percentComplete?: Maybe<Scalars['Int']['output']>;
  priority: GoalPriority;
  progressNotes: Array<GoalProgressNote>;
  status: GoalStatus;
  targetDate?: Maybe<Scalars['Date']['output']>;
  targetValue?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type CarePlanIntervention = {
  __typename?: 'CarePlanIntervention';
  completedDate?: Maybe<Scalars['Date']['output']>;
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  dosage?: Maybe<Scalars['String']['output']>;
  frequency?: Maybe<Scalars['String']['output']>;
  guidelineReference?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  medicationCode?: Maybe<Scalars['String']['output']>;
  patientInstructions?: Maybe<Scalars['String']['output']>;
  procedureCode?: Maybe<Scalars['String']['output']>;
  providerNotes?: Maybe<Scalars['String']['output']>;
  referralSpecialty?: Maybe<Scalars['String']['output']>;
  scheduledDate?: Maybe<Scalars['Date']['output']>;
  status: InterventionStatus;
  type: InterventionType;
  updatedAt: Scalars['DateTime']['output'];
};

export enum CarePlanQueryFilter {
  ByCondition = 'BY_CONDITION',
  ByPatient = 'BY_PATIENT',
  ByProvider = 'BY_PROVIDER',
  ByStatus = 'BY_STATUS'
}

export type CarePlanRecommendation = {
  __typename?: 'CarePlanRecommendation';
  confidence: Scalars['Float']['output'];
  evidenceGrade?: Maybe<Scalars['String']['output']>;
  guidelineSource?: Maybe<Scalars['String']['output']>;
  matchedConditions: Array<Scalars['String']['output']>;
  reasoning?: Maybe<Scalars['String']['output']>;
  templateId: Scalars['ID']['output'];
  title: Scalars['String']['output'];
};

export type CarePlanReview = {
  __typename?: 'CarePlanReview';
  degradedServices: Array<Scalars['String']['output']>;
  draftCarePlan?: Maybe<DraftCarePlan>;
  extractedEntities?: Maybe<ExtractedEntities>;
  recommendations: Array<CarePlanRecommendation>;
  redFlags: Array<RedFlag>;
  request: GenerationRequest;
  suggestedEdits: Array<SuggestedEdit>;
};

export enum CarePlanStatus {
  Active = 'ACTIVE',
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Draft = 'DRAFT',
  OnHold = 'ON_HOLD',
  PendingReview = 'PENDING_REVIEW'
}

export type CarePlanTemplate = {
  __typename?: 'CarePlanTemplate';
  category: TemplateCategory;
  conditionCodes: Array<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  createdBy?: Maybe<Scalars['ID']['output']>;
  defaultGoals: Array<TemplateGoal>;
  defaultInterventions: Array<TemplateIntervention>;
  description?: Maybe<Scalars['String']['output']>;
  evidenceGrade?: Maybe<Scalars['String']['output']>;
  guidelineSource?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  version: Scalars['String']['output'];
};

export type CarePlanTemplateConnection = {
  __typename?: 'CarePlanTemplateConnection';
  edges: Array<CarePlanTemplateEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CarePlanTemplateEdge = {
  __typename?: 'CarePlanTemplateEdge';
  cursor: Scalars['String']['output'];
  node: CarePlanTemplate;
};

export enum CircuitBreakerState {
  Closed = 'CLOSED',
  HalfOpen = 'HALF_OPEN',
  Open = 'OPEN'
}

export type ClinicalEntity = {
  __typename?: 'ClinicalEntity';
  code?: Maybe<Scalars['String']['output']>;
  codeSystem?: Maybe<Scalars['String']['output']>;
  confidence: Scalars['Float']['output'];
  length?: Maybe<Scalars['Int']['output']>;
  offset?: Maybe<Scalars['Int']['output']>;
  text: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type CreateCarePlanInput = {
  conditionCodes: Array<Scalars['String']['input']>;
  patientId: Scalars['ID']['input'];
  sourceRAGSynthesisId?: InputMaybe<Scalars['ID']['input']>;
  sourceTranscriptionId?: InputMaybe<Scalars['ID']['input']>;
  startDate: Scalars['Date']['input'];
  targetEndDate?: InputMaybe<Scalars['Date']['input']>;
  templateId?: InputMaybe<Scalars['ID']['input']>;
  title: Scalars['String']['input'];
};

export type CreateCarePlanTemplateInput = {
  category: TemplateCategory;
  conditionCodes: Array<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  evidenceGrade?: InputMaybe<Scalars['String']['input']>;
  goals?: InputMaybe<Array<CreateTemplateGoalInput>>;
  guidelineSource?: InputMaybe<Scalars['String']['input']>;
  interventions?: InputMaybe<Array<CreateTemplateInterventionInput>>;
  name: Scalars['String']['input'];
};

export type CreateTemplateGoalInput = {
  defaultTargetDays?: InputMaybe<Scalars['Int']['input']>;
  defaultTargetValue?: InputMaybe<Scalars['String']['input']>;
  description: Scalars['String']['input'];
  priority: GoalPriority;
};

export type CreateTemplateInterventionInput = {
  defaultScheduleDays?: InputMaybe<Scalars['Int']['input']>;
  description: Scalars['String']['input'];
  medicationCode?: InputMaybe<Scalars['String']['input']>;
  procedureCode?: InputMaybe<Scalars['String']['input']>;
  type: InterventionType;
};

export type CreateTrainingCarePlanInput = {
  conditionCodes: Array<Scalars['String']['input']>;
  goals?: InputMaybe<Array<CreateTrainingGoalInput>>;
  interventions?: InputMaybe<Array<CreateTrainingInterventionInput>>;
  startDate: Scalars['Date']['input'];
  targetEndDate?: InputMaybe<Scalars['Date']['input']>;
  title: Scalars['String']['input'];
  trainingDescription?: InputMaybe<Scalars['String']['input']>;
  trainingTags?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type CreateTrainingGoalInput = {
  description: Scalars['String']['input'];
  guidelineReference?: InputMaybe<Scalars['String']['input']>;
  priority: GoalPriority;
  targetDate?: InputMaybe<Scalars['Date']['input']>;
  targetValue?: InputMaybe<Scalars['String']['input']>;
};

export type CreateTrainingInterventionInput = {
  description: Scalars['String']['input'];
  dosage?: InputMaybe<Scalars['String']['input']>;
  frequency?: InputMaybe<Scalars['String']['input']>;
  guidelineReference?: InputMaybe<Scalars['String']['input']>;
  medicationCode?: InputMaybe<Scalars['String']['input']>;
  patientInstructions?: InputMaybe<Scalars['String']['input']>;
  procedureCode?: InputMaybe<Scalars['String']['input']>;
  referralSpecialty?: InputMaybe<Scalars['String']['input']>;
  scheduledDate?: InputMaybe<Scalars['Date']['input']>;
  type: InterventionType;
};

export type CrossReferenceIssue = {
  __typename?: 'CrossReferenceIssue';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
  severity: Scalars['String']['output'];
};

export type DocumentValidationReport = {
  __typename?: 'DocumentValidationReport';
  crossReferenceIssues: Array<CrossReferenceIssue>;
  isValid: Scalars['Boolean']['output'];
  violations: Array<DocumentValidationViolation>;
};

export type DocumentValidationViolation = {
  __typename?: 'DocumentValidationViolation';
  line?: Maybe<Scalars['Int']['output']>;
  message: Scalars['String']['output'];
  rule: Scalars['String']['output'];
  severity: Scalars['String']['output'];
};

export type DraftCarePlan = {
  __typename?: 'DraftCarePlan';
  conditionCodes: Array<Scalars['String']['output']>;
  confidence: Scalars['Float']['output'];
  generatedAt: Scalars['DateTime']['output'];
  goals: Array<DraftGoal>;
  id: Scalars['ID']['output'];
  interventions: Array<DraftIntervention>;
  requiresReview: Scalars['Boolean']['output'];
  templateId?: Maybe<Scalars['ID']['output']>;
  title: Scalars['String']['output'];
};

export type DraftGoal = {
  __typename?: 'DraftGoal';
  description: Scalars['String']['output'];
  guidelineReference?: Maybe<Scalars['String']['output']>;
  priority: GoalPriority;
  targetDate?: Maybe<Scalars['Date']['output']>;
  targetValue?: Maybe<Scalars['String']['output']>;
};

export type DraftIntervention = {
  __typename?: 'DraftIntervention';
  description: Scalars['String']['output'];
  dosage?: Maybe<Scalars['String']['output']>;
  frequency?: Maybe<Scalars['String']['output']>;
  guidelineReference?: Maybe<Scalars['String']['output']>;
  medicationCode?: Maybe<Scalars['String']['output']>;
  patientInstructions?: Maybe<Scalars['String']['output']>;
  procedureCode?: Maybe<Scalars['String']['output']>;
  scheduledDate?: Maybe<Scalars['Date']['output']>;
  type: InterventionType;
};

export type ExportDocumentResult = {
  __typename?: 'ExportDocumentResult';
  documentText: Scalars['String']['output'];
  filename: Scalars['String']['output'];
};

export type ExtractedCode = {
  __typename?: 'ExtractedCode';
  code: Scalars['String']['output'];
  codeSystem: Scalars['String']['output'];
  confidence: Scalars['Float']['output'];
  display?: Maybe<Scalars['String']['output']>;
};

export type ExtractedEntities = {
  __typename?: 'ExtractedEntities';
  allergies: Array<ClinicalEntity>;
  diagnoses: Array<ClinicalEntity>;
  extractedAt: Scalars['DateTime']['output'];
  medications: Array<ClinicalEntity>;
  modelVersion: Scalars['String']['output'];
  procedures: Array<ClinicalEntity>;
  symptoms: Array<ClinicalEntity>;
  vitals: Array<ClinicalEntity>;
};

export type FileValidationResult = {
  __typename?: 'FileValidationResult';
  errors: Array<Scalars['String']['output']>;
  fileSize: Scalars['Int']['output'];
  mimeType: Scalars['String']['output'];
  valid: Scalars['Boolean']['output'];
  warnings: Array<Scalars['String']['output']>;
};

export type GenerateCarePlanInput = {
  audioUrl?: InputMaybe<Scalars['String']['input']>;
  conditionCodes: Array<Scalars['String']['input']>;
  generateDraft?: InputMaybe<Scalars['Boolean']['input']>;
  idempotencyKey: Scalars['String']['input'];
  patientId: Scalars['ID']['input'];
  preferredTemplateIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  transcriptText?: InputMaybe<Scalars['String']['input']>;
  visitId: Scalars['ID']['input'];
};

export type GenerateCarePlanResult = {
  __typename?: 'GenerateCarePlanResult';
  cacheHit: Scalars['Boolean']['output'];
  degradedServices: Array<Scalars['String']['output']>;
  draftCarePlan?: Maybe<DraftCarePlan>;
  extractedEntities?: Maybe<ExtractedEntities>;
  processingTime: Scalars['Float']['output'];
  recommendations: Array<CarePlanRecommendation>;
  redFlags: Array<RedFlag>;
  requestId: Scalars['ID']['output'];
  requiresManualReview: Scalars['Boolean']['output'];
};

export type GenerationProgress = {
  __typename?: 'GenerationProgress';
  message?: Maybe<Scalars['String']['output']>;
  partialResult?: Maybe<GenerateCarePlanResult>;
  requestId: Scalars['ID']['output'];
  stage: PipelineStage;
  status: StageStatus;
};

export type GenerationRequest = {
  __typename?: 'GenerationRequest';
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  requestId: Scalars['ID']['output'];
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  status: PipelineRequestStatus;
};

export enum GoalPriority {
  High = 'HIGH',
  Low = 'LOW',
  Medium = 'MEDIUM'
}

export type GoalProgressNote = {
  __typename?: 'GoalProgressNote';
  id: Scalars['ID']['output'];
  note: Scalars['String']['output'];
  recordedAt: Scalars['DateTime']['output'];
  recordedBy: Scalars['ID']['output'];
  value?: Maybe<Scalars['String']['output']>;
};

export enum GoalStatus {
  Achieved = 'ACHIEVED',
  Cancelled = 'CANCELLED',
  InProgress = 'IN_PROGRESS',
  NotAchieved = 'NOT_ACHIEVED',
  NotStarted = 'NOT_STARTED'
}

export type ImportCarePlanFromPdfInput = {
  category: TemplateCategory;
  conditionCodes: Array<Scalars['String']['input']>;
  createTemplate: Scalars['Boolean']['input'];
  createTrainingExample: Scalars['Boolean']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  goals?: InputMaybe<Array<CreateTemplateGoalInput>>;
  interventions?: InputMaybe<Array<CreateTemplateInterventionInput>>;
  labCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  medicationCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  rawText: Scalars['String']['input'];
  title: Scalars['String']['input'];
  trainingDescription?: InputMaybe<Scalars['String']['input']>;
  trainingTags?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type ImportCarePlanFromPdfResult = {
  __typename?: 'ImportCarePlanFromPdfResult';
  embeddingGenerated: Scalars['Boolean']['output'];
  template?: Maybe<CarePlanTemplate>;
  trainingExample?: Maybe<CarePlan>;
};

export type ImportDocumentInput = {
  createTemplate?: InputMaybe<Scalars['Boolean']['input']>;
  documentText: Scalars['String']['input'];
  patientId: Scalars['ID']['input'];
};

export type ImportDocumentResult = {
  __typename?: 'ImportDocumentResult';
  carePlan: CarePlan;
  validationReport: DocumentValidationReport;
};

export enum InterventionStatus {
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Deferred = 'DEFERRED',
  InProgress = 'IN_PROGRESS',
  Scheduled = 'SCHEDULED'
}

export enum InterventionType {
  Education = 'EDUCATION',
  FollowUp = 'FOLLOW_UP',
  Lifestyle = 'LIFESTYLE',
  Medication = 'MEDICATION',
  Monitoring = 'MONITORING',
  Procedure = 'PROCEDURE',
  Referral = 'REFERRAL'
}

export type MlServiceHealth = {
  __typename?: 'MLServiceHealth';
  circuitState: CircuitBreakerState;
  lastError?: Maybe<Scalars['String']['output']>;
  lastSuccess?: Maybe<Scalars['DateTime']['output']>;
  latencyMs: Scalars['Float']['output'];
  service: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type ModelVersion = {
  __typename?: 'ModelVersion';
  service: Scalars['String']['output'];
  version: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  acceptCarePlanDraft: CarePlan;
  addGoal: CarePlanGoal;
  addIntervention: CarePlanIntervention;
  addTrainingGoal: CarePlan;
  addTrainingIntervention: CarePlan;
  approveCarePlan: CarePlan;
  cancelPipelineRequest: GenerationRequest;
  createCarePlan: CarePlan;
  createCarePlanFromTemplate: CarePlan;
  createCarePlanTemplate: CarePlanTemplate;
  createTrainingCarePlan: CarePlan;
  deleteCarePlanTemplate: Scalars['Boolean']['output'];
  deleteTrainingCarePlan: Scalars['Boolean']['output'];
  generateCarePlanFromVisit: GenerateCarePlanResult;
  importCarePlanDocument: ImportDocumentResult;
  importCarePlanFromPdf: ImportCarePlanFromPdfResult;
  importCarePlanFromPdfFile: PdfImportResult;
  linkGoalToInterventions: CarePlanGoal;
  regenerateCarePlan: GenerationRequest;
  rejectCarePlanDraft: GenerationRequest;
  removeTrainingGoal: Scalars['Boolean']['output'];
  removeTrainingIntervention: Scalars['Boolean']['output'];
  submitCarePlanForReview: CarePlan;
  updateCarePlanStatus: CarePlan;
  updateCarePlanTemplate: CarePlanTemplate;
  updateGoalStatus: CarePlanGoal;
  updateInterventionStatus: CarePlanIntervention;
  updateTrainingCarePlan: CarePlan;
};


export type MutationAcceptCarePlanDraftArgs = {
  edits?: InputMaybe<Array<CarePlanEditInput>>;
  requestId: Scalars['ID']['input'];
};


export type MutationAddGoalArgs = {
  input: AddGoalInput;
};


export type MutationAddInterventionArgs = {
  input: AddInterventionInput;
};


export type MutationAddTrainingGoalArgs = {
  carePlanId: Scalars['ID']['input'];
  input: CreateTrainingGoalInput;
};


export type MutationAddTrainingInterventionArgs = {
  carePlanId: Scalars['ID']['input'];
  input: CreateTrainingInterventionInput;
};


export type MutationApproveCarePlanArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCancelPipelineRequestArgs = {
  requestId: Scalars['ID']['input'];
};


export type MutationCreateCarePlanArgs = {
  input: CreateCarePlanInput;
};


export type MutationCreateCarePlanFromTemplateArgs = {
  patientId: Scalars['ID']['input'];
  startDate: Scalars['Date']['input'];
  templateId: Scalars['ID']['input'];
};


export type MutationCreateCarePlanTemplateArgs = {
  input: CreateCarePlanTemplateInput;
};


export type MutationCreateTrainingCarePlanArgs = {
  input: CreateTrainingCarePlanInput;
};


export type MutationDeleteCarePlanTemplateArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteTrainingCarePlanArgs = {
  id: Scalars['ID']['input'];
};


export type MutationGenerateCarePlanFromVisitArgs = {
  input: GenerateCarePlanInput;
};


export type MutationImportCarePlanDocumentArgs = {
  input: ImportDocumentInput;
};


export type MutationImportCarePlanFromPdfArgs = {
  input: ImportCarePlanFromPdfInput;
};


export type MutationImportCarePlanFromPdfFileArgs = {
  fileKey: Scalars['String']['input'];
  patientId: Scalars['ID']['input'];
};


export type MutationLinkGoalToInterventionsArgs = {
  goalId: Scalars['ID']['input'];
  interventionIds: Array<Scalars['ID']['input']>;
};


export type MutationRegenerateCarePlanArgs = {
  preferences: RegenerationPreferences;
  requestId: Scalars['ID']['input'];
};


export type MutationRejectCarePlanDraftArgs = {
  reason: Scalars['String']['input'];
  requestId: Scalars['ID']['input'];
};


export type MutationRemoveTrainingGoalArgs = {
  goalId: Scalars['ID']['input'];
};


export type MutationRemoveTrainingInterventionArgs = {
  interventionId: Scalars['ID']['input'];
};


export type MutationSubmitCarePlanForReviewArgs = {
  id: Scalars['ID']['input'];
};


export type MutationUpdateCarePlanStatusArgs = {
  id: Scalars['ID']['input'];
  status: CarePlanStatus;
};


export type MutationUpdateCarePlanTemplateArgs = {
  id: Scalars['ID']['input'];
  input: UpdateCarePlanTemplateInput;
};


export type MutationUpdateGoalStatusArgs = {
  input: UpdateGoalStatusInput;
};


export type MutationUpdateInterventionStatusArgs = {
  input: UpdateInterventionStatusInput;
};


export type MutationUpdateTrainingCarePlanArgs = {
  id: Scalars['ID']['input'];
  input: UpdateTrainingCarePlanInput;
};

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor?: Maybe<Scalars['String']['output']>;
};

export type PaginationInput = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type Patient = {
  __typename?: 'Patient';
  activeCarePlan?: Maybe<CarePlan>;
  carePlans: CarePlanConnection;
  id: Scalars['ID']['output'];
};


export type PatientCarePlansArgs = {
  pagination?: InputMaybe<PaginationInput>;
  status?: InputMaybe<CarePlanStatus>;
};

export type PatientCarePlansConnection = {
  __typename?: 'PatientCarePlansConnection';
  nodes: Array<CarePlan>;
  totalCount: Scalars['Int']['output'];
};

export type PdfImportResult = {
  __typename?: 'PdfImportResult';
  extractedCodes: Array<ExtractedCode>;
  parsedCarePlan?: Maybe<DraftCarePlan>;
  requestId: Scalars['ID']['output'];
  validationResult: FileValidationResult;
};

export type PipelineHealth = {
  __typename?: 'PipelineHealth';
  checkDurationMs: Scalars['Float']['output'];
  degradedServices: Array<Scalars['String']['output']>;
  overall: Scalars['String']['output'];
  services: Array<MlServiceHealth>;
};

export enum PipelineRequestStatus {
  Accepted = 'ACCEPTED',
  Completed = 'COMPLETED',
  Expired = 'EXPIRED',
  Failed = 'FAILED',
  InProgress = 'IN_PROGRESS',
  Pending = 'PENDING',
  Rejected = 'REJECTED'
}

export enum PipelineStage {
  DraftGeneration = 'DRAFT_GENERATION',
  EmbeddingGeneration = 'EMBEDDING_GENERATION',
  EntityExtraction = 'ENTITY_EXTRACTION',
  SafetyValidation = 'SAFETY_VALIDATION',
  TemplateRecommendation = 'TEMPLATE_RECOMMENDATION',
  Validation = 'VALIDATION'
}

export type ProcessingMetadata = {
  __typename?: 'ProcessingMetadata';
  cacheHit: Scalars['Boolean']['output'];
  correlationId: Scalars['ID']['output'];
  modelVersions: Array<ModelVersion>;
  processedAt: Scalars['DateTime']['output'];
  requestId: Scalars['ID']['output'];
  stageResults: Array<StageResult>;
  totalDurationMs: Scalars['Float']['output'];
};

export type Query = {
  __typename?: 'Query';
  activeCarePlanForPatient?: Maybe<CarePlan>;
  carePlan?: Maybe<CarePlan>;
  carePlanReview?: Maybe<CarePlanReview>;
  carePlanTemplate?: Maybe<CarePlanTemplate>;
  carePlanTemplates: CarePlanTemplateConnection;
  carePlans: CarePlanConnection;
  carePlansForPatient: CarePlanConnection;
  exportCarePlanDocument: ExportDocumentResult;
  patientCarePlans: PatientCarePlansConnection;
  pendingRecommendationsForVisit: Array<CarePlanRecommendation>;
  pipelineHealth: PipelineHealth;
  pipelineRequest?: Maybe<GenerationRequest>;
  templatesForConditions: Array<CarePlanTemplate>;
  trainingCarePlan?: Maybe<CarePlan>;
  trainingCarePlans: CarePlanConnection;
  validateCarePlanDocument: DocumentValidationReport;
};


export type QueryActiveCarePlanForPatientArgs = {
  patientId: Scalars['ID']['input'];
};


export type QueryCarePlanArgs = {
  id: Scalars['ID']['input'];
};


export type QueryCarePlanReviewArgs = {
  requestId: Scalars['ID']['input'];
};


export type QueryCarePlanTemplateArgs = {
  id: Scalars['ID']['input'];
};


export type QueryCarePlanTemplatesArgs = {
  filter?: InputMaybe<TemplateFilterInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryCarePlansArgs = {
  filter?: InputMaybe<CarePlanFilterInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryCarePlansForPatientArgs = {
  pagination?: InputMaybe<PaginationInput>;
  patientId: Scalars['ID']['input'];
  status?: InputMaybe<CarePlanStatus>;
};


export type QueryExportCarePlanDocumentArgs = {
  carePlanId: Scalars['ID']['input'];
};


export type QueryPatientCarePlansArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  patientId: Scalars['ID']['input'];
};


export type QueryPendingRecommendationsForVisitArgs = {
  visitId: Scalars['ID']['input'];
};


export type QueryPipelineRequestArgs = {
  requestId: Scalars['ID']['input'];
};


export type QueryTemplatesForConditionsArgs = {
  conditionCodes: Array<Scalars['String']['input']>;
};


export type QueryTrainingCarePlanArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTrainingCarePlansArgs = {
  filter?: InputMaybe<TrainingCarePlanFilterInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryValidateCarePlanDocumentArgs = {
  documentText: Scalars['String']['input'];
};

export type RedFlag = {
  __typename?: 'RedFlag';
  category: Scalars['String']['output'];
  confidence: Scalars['Float']['output'];
  description: Scalars['String']['output'];
  recommendedAction?: Maybe<Scalars['String']['output']>;
  severity: RedFlagSeverity;
  sourceText?: Maybe<Scalars['String']['output']>;
};

export enum RedFlagSeverity {
  Critical = 'CRITICAL',
  High = 'HIGH',
  Low = 'LOW',
  Medium = 'MEDIUM'
}

export type RegenerationPreferences = {
  excludeTemplateIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  focusConditions?: InputMaybe<Array<Scalars['String']['input']>>;
  preferredTemplateIds?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type StageResult = {
  __typename?: 'StageResult';
  cacheHit?: Maybe<Scalars['Boolean']['output']>;
  durationMs: Scalars['Float']['output'];
  error?: Maybe<Scalars['String']['output']>;
  stage: PipelineStage;
  status: StageStatus;
};

export enum StageStatus {
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  InProgress = 'IN_PROGRESS',
  Pending = 'PENDING',
  Skipped = 'SKIPPED'
}

export type Subscription = {
  __typename?: 'Subscription';
  carePlanGenerationProgress: GenerationProgress;
};


export type SubscriptionCarePlanGenerationProgressArgs = {
  requestId: Scalars['ID']['input'];
};

export type SuggestedEdit = {
  __typename?: 'SuggestedEdit';
  confidence: Scalars['Float']['output'];
  currentValue?: Maybe<Scalars['String']['output']>;
  field: Scalars['String']['output'];
  reason: Scalars['String']['output'];
  suggestedValue: Scalars['String']['output'];
};

export enum TemplateCategory {
  AcuteCare = 'ACUTE_CARE',
  ChronicDisease = 'CHRONIC_DISEASE',
  General = 'GENERAL',
  Geriatric = 'GERIATRIC',
  LifestyleModification = 'LIFESTYLE_MODIFICATION',
  MedicationManagement = 'MEDICATION_MANAGEMENT',
  MentalHealth = 'MENTAL_HEALTH',
  Pediatric = 'PEDIATRIC',
  PostProcedure = 'POST_PROCEDURE',
  PreventiveCare = 'PREVENTIVE_CARE'
}

export type TemplateFilterInput = {
  category?: InputMaybe<TemplateCategory>;
  conditionCode?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
};

export type TemplateGoal = {
  __typename?: 'TemplateGoal';
  defaultTargetDays?: Maybe<Scalars['Int']['output']>;
  defaultTargetValue?: Maybe<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  priority: GoalPriority;
};

export type TemplateIntervention = {
  __typename?: 'TemplateIntervention';
  defaultScheduleDays?: Maybe<Scalars['Int']['output']>;
  description: Scalars['String']['output'];
  medicationCode?: Maybe<Scalars['String']['output']>;
  procedureCode?: Maybe<Scalars['String']['output']>;
  type: InterventionType;
};

export type TrainingCarePlanFilterInput = {
  conditionCode?: InputMaybe<Scalars['String']['input']>;
  createdAfter?: InputMaybe<Scalars['DateTime']['input']>;
  createdBefore?: InputMaybe<Scalars['DateTime']['input']>;
  status?: InputMaybe<CarePlanStatus>;
  trainingTag?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateCarePlanTemplateInput = {
  category?: InputMaybe<TemplateCategory>;
  conditionCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  evidenceGrade?: InputMaybe<Scalars['String']['input']>;
  guidelineSource?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateGoalStatusInput = {
  currentValue?: InputMaybe<Scalars['String']['input']>;
  goalId: Scalars['ID']['input'];
  progressNote?: InputMaybe<Scalars['String']['input']>;
  status: GoalStatus;
};

export type UpdateInterventionStatusInput = {
  completedDate?: InputMaybe<Scalars['Date']['input']>;
  interventionId: Scalars['ID']['input'];
  providerNotes?: InputMaybe<Scalars['String']['input']>;
  status: InterventionStatus;
};

export type UpdateTrainingCarePlanInput = {
  conditionCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  startDate?: InputMaybe<Scalars['Date']['input']>;
  status?: InputMaybe<CarePlanStatus>;
  targetEndDate?: InputMaybe<Scalars['Date']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  trainingDescription?: InputMaybe<Scalars['String']['input']>;
  trainingTags?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type Visit = {
  __typename?: 'Visit';
  hasActiveGenerationRequest: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  lastExtraction?: Maybe<ExtractedEntities>;
  pendingCarePlanRecommendations: Array<CarePlanRecommendation>;
};

export type WithIndex<TObject> = TObject & Record<string, any>;
export type ResolversObject<TObject> = WithIndex<TObject>;

export type ResolverTypeWrapper<T> = Promise<T> | T;

export type ReferenceResolver<TResult, TReference, TContext> = (
      reference: TReference,
      context: TContext,
      info: GraphQLResolveInfo
    ) => Promise<TResult> | TResult;

      type ScalarCheck<T, S> = S extends true ? T : NullableCheck<T, S>;
      type NullableCheck<T, S> = Maybe<T> extends T ? Maybe<ListCheck<NonNullable<T>, S>> : ListCheck<T, S>;
      type ListCheck<T, S> = T extends (infer U)[] ? NullableCheck<U, S>[] : GraphQLRecursivePick<T, S>;
      export type GraphQLRecursivePick<T, S> = { [K in keyof T & keyof S]: ScalarCheck<T[K], S[K]> };
    

export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = {}, TContext = {}, TArgs = {}> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = {}, TContext = {}, TArgs = {}> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = {}, TContext = {}> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = {}, TContext = {}> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = {}, TParent = {}, TContext = {}, TArgs = {}> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;



/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = ResolversObject<{
  AddGoalInput: AddGoalInput;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  AddInterventionInput: AddInterventionInput;
  CarePlan: ResolverTypeWrapper<CarePlan>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  CarePlanConnection: ResolverTypeWrapper<CarePlanConnection>;
  CarePlanEdge: ResolverTypeWrapper<CarePlanEdge>;
  CarePlanEditInput: CarePlanEditInput;
  CarePlanFilterInput: CarePlanFilterInput;
  CarePlanGoal: ResolverTypeWrapper<CarePlanGoal>;
  CarePlanIntervention: ResolverTypeWrapper<CarePlanIntervention>;
  CarePlanQueryFilter: CarePlanQueryFilter;
  CarePlanRecommendation: ResolverTypeWrapper<CarePlanRecommendation>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  CarePlanReview: ResolverTypeWrapper<CarePlanReview>;
  CarePlanStatus: CarePlanStatus;
  CarePlanTemplate: ResolverTypeWrapper<CarePlanTemplate>;
  CarePlanTemplateConnection: ResolverTypeWrapper<CarePlanTemplateConnection>;
  CarePlanTemplateEdge: ResolverTypeWrapper<CarePlanTemplateEdge>;
  CircuitBreakerState: CircuitBreakerState;
  ClinicalEntity: ResolverTypeWrapper<ClinicalEntity>;
  CreateCarePlanInput: CreateCarePlanInput;
  CreateCarePlanTemplateInput: CreateCarePlanTemplateInput;
  CreateTemplateGoalInput: CreateTemplateGoalInput;
  CreateTemplateInterventionInput: CreateTemplateInterventionInput;
  CreateTrainingCarePlanInput: CreateTrainingCarePlanInput;
  CreateTrainingGoalInput: CreateTrainingGoalInput;
  CreateTrainingInterventionInput: CreateTrainingInterventionInput;
  CrossReferenceIssue: ResolverTypeWrapper<CrossReferenceIssue>;
  Date: ResolverTypeWrapper<Scalars['Date']['output']>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  DocumentValidationReport: ResolverTypeWrapper<DocumentValidationReport>;
  DocumentValidationViolation: ResolverTypeWrapper<DocumentValidationViolation>;
  DraftCarePlan: ResolverTypeWrapper<DraftCarePlan>;
  DraftGoal: ResolverTypeWrapper<DraftGoal>;
  DraftIntervention: ResolverTypeWrapper<DraftIntervention>;
  ExportDocumentResult: ResolverTypeWrapper<ExportDocumentResult>;
  ExtractedCode: ResolverTypeWrapper<ExtractedCode>;
  ExtractedEntities: ResolverTypeWrapper<ExtractedEntities>;
  FileValidationResult: ResolverTypeWrapper<FileValidationResult>;
  GenerateCarePlanInput: GenerateCarePlanInput;
  GenerateCarePlanResult: ResolverTypeWrapper<GenerateCarePlanResult>;
  GenerationProgress: ResolverTypeWrapper<GenerationProgress>;
  GenerationRequest: ResolverTypeWrapper<GenerationRequest>;
  GoalPriority: GoalPriority;
  GoalProgressNote: ResolverTypeWrapper<GoalProgressNote>;
  GoalStatus: GoalStatus;
  ImportCarePlanFromPdfInput: ImportCarePlanFromPdfInput;
  ImportCarePlanFromPdfResult: ResolverTypeWrapper<ImportCarePlanFromPdfResult>;
  ImportDocumentInput: ImportDocumentInput;
  ImportDocumentResult: ResolverTypeWrapper<ImportDocumentResult>;
  InterventionStatus: InterventionStatus;
  InterventionType: InterventionType;
  MLServiceHealth: ResolverTypeWrapper<MlServiceHealth>;
  ModelVersion: ResolverTypeWrapper<ModelVersion>;
  Mutation: ResolverTypeWrapper<{}>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  PaginationInput: PaginationInput;
  Patient: ResolverTypeWrapper<Patient>;
  PatientCarePlansConnection: ResolverTypeWrapper<PatientCarePlansConnection>;
  PdfImportResult: ResolverTypeWrapper<PdfImportResult>;
  PipelineHealth: ResolverTypeWrapper<PipelineHealth>;
  PipelineRequestStatus: PipelineRequestStatus;
  PipelineStage: PipelineStage;
  ProcessingMetadata: ResolverTypeWrapper<ProcessingMetadata>;
  Query: ResolverTypeWrapper<{}>;
  RedFlag: ResolverTypeWrapper<RedFlag>;
  RedFlagSeverity: RedFlagSeverity;
  RegenerationPreferences: RegenerationPreferences;
  StageResult: ResolverTypeWrapper<StageResult>;
  StageStatus: StageStatus;
  Subscription: ResolverTypeWrapper<{}>;
  SuggestedEdit: ResolverTypeWrapper<SuggestedEdit>;
  TemplateCategory: TemplateCategory;
  TemplateFilterInput: TemplateFilterInput;
  TemplateGoal: ResolverTypeWrapper<TemplateGoal>;
  TemplateIntervention: ResolverTypeWrapper<TemplateIntervention>;
  TrainingCarePlanFilterInput: TrainingCarePlanFilterInput;
  UpdateCarePlanTemplateInput: UpdateCarePlanTemplateInput;
  UpdateGoalStatusInput: UpdateGoalStatusInput;
  UpdateInterventionStatusInput: UpdateInterventionStatusInput;
  UpdateTrainingCarePlanInput: UpdateTrainingCarePlanInput;
  Visit: ResolverTypeWrapper<Visit>;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  AddGoalInput: AddGoalInput;
  ID: Scalars['ID']['output'];
  String: Scalars['String']['output'];
  AddInterventionInput: AddInterventionInput;
  CarePlan: CarePlan;
  Boolean: Scalars['Boolean']['output'];
  Int: Scalars['Int']['output'];
  CarePlanConnection: CarePlanConnection;
  CarePlanEdge: CarePlanEdge;
  CarePlanEditInput: CarePlanEditInput;
  CarePlanFilterInput: CarePlanFilterInput;
  CarePlanGoal: CarePlanGoal;
  CarePlanIntervention: CarePlanIntervention;
  CarePlanRecommendation: CarePlanRecommendation;
  Float: Scalars['Float']['output'];
  CarePlanReview: CarePlanReview;
  CarePlanTemplate: CarePlanTemplate;
  CarePlanTemplateConnection: CarePlanTemplateConnection;
  CarePlanTemplateEdge: CarePlanTemplateEdge;
  ClinicalEntity: ClinicalEntity;
  CreateCarePlanInput: CreateCarePlanInput;
  CreateCarePlanTemplateInput: CreateCarePlanTemplateInput;
  CreateTemplateGoalInput: CreateTemplateGoalInput;
  CreateTemplateInterventionInput: CreateTemplateInterventionInput;
  CreateTrainingCarePlanInput: CreateTrainingCarePlanInput;
  CreateTrainingGoalInput: CreateTrainingGoalInput;
  CreateTrainingInterventionInput: CreateTrainingInterventionInput;
  CrossReferenceIssue: CrossReferenceIssue;
  Date: Scalars['Date']['output'];
  DateTime: Scalars['DateTime']['output'];
  DocumentValidationReport: DocumentValidationReport;
  DocumentValidationViolation: DocumentValidationViolation;
  DraftCarePlan: DraftCarePlan;
  DraftGoal: DraftGoal;
  DraftIntervention: DraftIntervention;
  ExportDocumentResult: ExportDocumentResult;
  ExtractedCode: ExtractedCode;
  ExtractedEntities: ExtractedEntities;
  FileValidationResult: FileValidationResult;
  GenerateCarePlanInput: GenerateCarePlanInput;
  GenerateCarePlanResult: GenerateCarePlanResult;
  GenerationProgress: GenerationProgress;
  GenerationRequest: GenerationRequest;
  GoalProgressNote: GoalProgressNote;
  ImportCarePlanFromPdfInput: ImportCarePlanFromPdfInput;
  ImportCarePlanFromPdfResult: ImportCarePlanFromPdfResult;
  ImportDocumentInput: ImportDocumentInput;
  ImportDocumentResult: ImportDocumentResult;
  MLServiceHealth: MlServiceHealth;
  ModelVersion: ModelVersion;
  Mutation: {};
  PageInfo: PageInfo;
  PaginationInput: PaginationInput;
  Patient: Patient;
  PatientCarePlansConnection: PatientCarePlansConnection;
  PdfImportResult: PdfImportResult;
  PipelineHealth: PipelineHealth;
  ProcessingMetadata: ProcessingMetadata;
  Query: {};
  RedFlag: RedFlag;
  RegenerationPreferences: RegenerationPreferences;
  StageResult: StageResult;
  Subscription: {};
  SuggestedEdit: SuggestedEdit;
  TemplateFilterInput: TemplateFilterInput;
  TemplateGoal: TemplateGoal;
  TemplateIntervention: TemplateIntervention;
  TrainingCarePlanFilterInput: TrainingCarePlanFilterInput;
  UpdateCarePlanTemplateInput: UpdateCarePlanTemplateInput;
  UpdateGoalStatusInput: UpdateGoalStatusInput;
  UpdateInterventionStatusInput: UpdateInterventionStatusInput;
  UpdateTrainingCarePlanInput: UpdateTrainingCarePlanInput;
  Visit: Visit;
}>;

export type CarePlanResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlan'] = ResolversParentTypes['CarePlan']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['CarePlan']>, { __typename: 'CarePlan' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  actualEndDate?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  createdBy?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  goals?: Resolver<Array<ResolversTypes['CarePlanGoal']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  interventions?: Resolver<Array<ResolversTypes['CarePlanIntervention']>, ParentType, ContextType>;
  isTrainingExample?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  lastReviewedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  lastReviewedBy?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  nextReviewDate?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  patient?: Resolver<Maybe<ResolversTypes['Patient']>, ParentType, ContextType>;
  progress?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  sourceRAGSynthesisId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  sourceTranscriptionId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  startDate?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['CarePlanStatus'], ParentType, ContextType>;
  targetEndDate?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  templateId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  trainingDescription?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  trainingTags?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CarePlanConnectionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanConnection'] = ResolversParentTypes['CarePlanConnection']> = ResolversObject<{
  edges?: Resolver<Array<ResolversTypes['CarePlanEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CarePlanEdgeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanEdge'] = ResolversParentTypes['CarePlanEdge']> = ResolversObject<{
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CarePlanGoalResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanGoal'] = ResolversParentTypes['CarePlanGoal']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  currentValue?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  guidelineReference?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  linkedInterventionIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  percentComplete?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  priority?: Resolver<ResolversTypes['GoalPriority'], ParentType, ContextType>;
  progressNotes?: Resolver<Array<ResolversTypes['GoalProgressNote']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['GoalStatus'], ParentType, ContextType>;
  targetDate?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  targetValue?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CarePlanInterventionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanIntervention'] = ResolversParentTypes['CarePlanIntervention']> = ResolversObject<{
  completedDate?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  dosage?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  frequency?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  guidelineReference?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  medicationCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  patientInstructions?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  procedureCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  providerNotes?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  referralSpecialty?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  scheduledDate?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['InterventionStatus'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['InterventionType'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CarePlanRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanRecommendation'] = ResolversParentTypes['CarePlanRecommendation']> = ResolversObject<{
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  evidenceGrade?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  guidelineSource?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  matchedConditions?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  reasoning?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  templateId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CarePlanReviewResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanReview'] = ResolversParentTypes['CarePlanReview']> = ResolversObject<{
  degradedServices?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  draftCarePlan?: Resolver<Maybe<ResolversTypes['DraftCarePlan']>, ParentType, ContextType>;
  extractedEntities?: Resolver<Maybe<ResolversTypes['ExtractedEntities']>, ParentType, ContextType>;
  recommendations?: Resolver<Array<ResolversTypes['CarePlanRecommendation']>, ParentType, ContextType>;
  redFlags?: Resolver<Array<ResolversTypes['RedFlag']>, ParentType, ContextType>;
  request?: Resolver<ResolversTypes['GenerationRequest'], ParentType, ContextType>;
  suggestedEdits?: Resolver<Array<ResolversTypes['SuggestedEdit']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CarePlanTemplateResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanTemplate'] = ResolversParentTypes['CarePlanTemplate']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['CarePlanTemplate']>, { __typename: 'CarePlanTemplate' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  category?: Resolver<ResolversTypes['TemplateCategory'], ParentType, ContextType>;
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  createdBy?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  defaultGoals?: Resolver<Array<ResolversTypes['TemplateGoal']>, ParentType, ContextType>;
  defaultInterventions?: Resolver<Array<ResolversTypes['TemplateIntervention']>, ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  evidenceGrade?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  guidelineSource?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  version?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CarePlanTemplateConnectionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanTemplateConnection'] = ResolversParentTypes['CarePlanTemplateConnection']> = ResolversObject<{
  edges?: Resolver<Array<ResolversTypes['CarePlanTemplateEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CarePlanTemplateEdgeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanTemplateEdge'] = ResolversParentTypes['CarePlanTemplateEdge']> = ResolversObject<{
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['CarePlanTemplate'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ClinicalEntityResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ClinicalEntity'] = ResolversParentTypes['ClinicalEntity']> = ResolversObject<{
  code?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  codeSystem?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  length?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  offset?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  text?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CrossReferenceIssueResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CrossReferenceIssue'] = ResolversParentTypes['CrossReferenceIssue']> = ResolversObject<{
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  severity?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export interface DateScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Date'], any> {
  name: 'Date';
}

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type DocumentValidationReportResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DocumentValidationReport'] = ResolversParentTypes['DocumentValidationReport']> = ResolversObject<{
  crossReferenceIssues?: Resolver<Array<ResolversTypes['CrossReferenceIssue']>, ParentType, ContextType>;
  isValid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  violations?: Resolver<Array<ResolversTypes['DocumentValidationViolation']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DocumentValidationViolationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DocumentValidationViolation'] = ResolversParentTypes['DocumentValidationViolation']> = ResolversObject<{
  line?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  rule?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  severity?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DraftCarePlanResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DraftCarePlan'] = ResolversParentTypes['DraftCarePlan']> = ResolversObject<{
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  generatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  goals?: Resolver<Array<ResolversTypes['DraftGoal']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  interventions?: Resolver<Array<ResolversTypes['DraftIntervention']>, ParentType, ContextType>;
  requiresReview?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  templateId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DraftGoalResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DraftGoal'] = ResolversParentTypes['DraftGoal']> = ResolversObject<{
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  guidelineReference?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  priority?: Resolver<ResolversTypes['GoalPriority'], ParentType, ContextType>;
  targetDate?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  targetValue?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DraftInterventionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DraftIntervention'] = ResolversParentTypes['DraftIntervention']> = ResolversObject<{
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  dosage?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  frequency?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  guidelineReference?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  medicationCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  patientInstructions?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  procedureCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  scheduledDate?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['InterventionType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ExportDocumentResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ExportDocumentResult'] = ResolversParentTypes['ExportDocumentResult']> = ResolversObject<{
  documentText?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  filename?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ExtractedCodeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ExtractedCode'] = ResolversParentTypes['ExtractedCode']> = ResolversObject<{
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  codeSystem?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  display?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ExtractedEntitiesResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ExtractedEntities'] = ResolversParentTypes['ExtractedEntities']> = ResolversObject<{
  allergies?: Resolver<Array<ResolversTypes['ClinicalEntity']>, ParentType, ContextType>;
  diagnoses?: Resolver<Array<ResolversTypes['ClinicalEntity']>, ParentType, ContextType>;
  extractedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  medications?: Resolver<Array<ResolversTypes['ClinicalEntity']>, ParentType, ContextType>;
  modelVersion?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  procedures?: Resolver<Array<ResolversTypes['ClinicalEntity']>, ParentType, ContextType>;
  symptoms?: Resolver<Array<ResolversTypes['ClinicalEntity']>, ParentType, ContextType>;
  vitals?: Resolver<Array<ResolversTypes['ClinicalEntity']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type FileValidationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['FileValidationResult'] = ResolversParentTypes['FileValidationResult']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  fileSize?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  mimeType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  valid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  warnings?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type GenerateCarePlanResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['GenerateCarePlanResult'] = ResolversParentTypes['GenerateCarePlanResult']> = ResolversObject<{
  cacheHit?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  degradedServices?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  draftCarePlan?: Resolver<Maybe<ResolversTypes['DraftCarePlan']>, ParentType, ContextType>;
  extractedEntities?: Resolver<Maybe<ResolversTypes['ExtractedEntities']>, ParentType, ContextType>;
  processingTime?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  recommendations?: Resolver<Array<ResolversTypes['CarePlanRecommendation']>, ParentType, ContextType>;
  redFlags?: Resolver<Array<ResolversTypes['RedFlag']>, ParentType, ContextType>;
  requestId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  requiresManualReview?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type GenerationProgressResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['GenerationProgress'] = ResolversParentTypes['GenerationProgress']> = ResolversObject<{
  message?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  partialResult?: Resolver<Maybe<ResolversTypes['GenerateCarePlanResult']>, ParentType, ContextType>;
  requestId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  stage?: Resolver<ResolversTypes['PipelineStage'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['StageStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type GenerationRequestResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['GenerationRequest'] = ResolversParentTypes['GenerationRequest']> = ResolversObject<{
  completedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  requestId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  startedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['PipelineRequestStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type GoalProgressNoteResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['GoalProgressNote'] = ResolversParentTypes['GoalProgressNote']> = ResolversObject<{
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  note?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  recordedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  recordedBy?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  value?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ImportCarePlanFromPdfResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ImportCarePlanFromPdfResult'] = ResolversParentTypes['ImportCarePlanFromPdfResult']> = ResolversObject<{
  embeddingGenerated?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  template?: Resolver<Maybe<ResolversTypes['CarePlanTemplate']>, ParentType, ContextType>;
  trainingExample?: Resolver<Maybe<ResolversTypes['CarePlan']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ImportDocumentResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ImportDocumentResult'] = ResolversParentTypes['ImportDocumentResult']> = ResolversObject<{
  carePlan?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType>;
  validationReport?: Resolver<ResolversTypes['DocumentValidationReport'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MlServiceHealthResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MLServiceHealth'] = ResolversParentTypes['MLServiceHealth']> = ResolversObject<{
  circuitState?: Resolver<ResolversTypes['CircuitBreakerState'], ParentType, ContextType>;
  lastError?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  lastSuccess?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  latencyMs?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  service?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ModelVersionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ModelVersion'] = ResolversParentTypes['ModelVersion']> = ResolversObject<{
  service?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  version?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  acceptCarePlanDraft?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationAcceptCarePlanDraftArgs, 'requestId'>>;
  addGoal?: Resolver<ResolversTypes['CarePlanGoal'], ParentType, ContextType, RequireFields<MutationAddGoalArgs, 'input'>>;
  addIntervention?: Resolver<ResolversTypes['CarePlanIntervention'], ParentType, ContextType, RequireFields<MutationAddInterventionArgs, 'input'>>;
  addTrainingGoal?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationAddTrainingGoalArgs, 'carePlanId' | 'input'>>;
  addTrainingIntervention?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationAddTrainingInterventionArgs, 'carePlanId' | 'input'>>;
  approveCarePlan?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationApproveCarePlanArgs, 'id'>>;
  cancelPipelineRequest?: Resolver<ResolversTypes['GenerationRequest'], ParentType, ContextType, RequireFields<MutationCancelPipelineRequestArgs, 'requestId'>>;
  createCarePlan?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationCreateCarePlanArgs, 'input'>>;
  createCarePlanFromTemplate?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationCreateCarePlanFromTemplateArgs, 'patientId' | 'startDate' | 'templateId'>>;
  createCarePlanTemplate?: Resolver<ResolversTypes['CarePlanTemplate'], ParentType, ContextType, RequireFields<MutationCreateCarePlanTemplateArgs, 'input'>>;
  createTrainingCarePlan?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationCreateTrainingCarePlanArgs, 'input'>>;
  deleteCarePlanTemplate?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteCarePlanTemplateArgs, 'id'>>;
  deleteTrainingCarePlan?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteTrainingCarePlanArgs, 'id'>>;
  generateCarePlanFromVisit?: Resolver<ResolversTypes['GenerateCarePlanResult'], ParentType, ContextType, RequireFields<MutationGenerateCarePlanFromVisitArgs, 'input'>>;
  importCarePlanDocument?: Resolver<ResolversTypes['ImportDocumentResult'], ParentType, ContextType, RequireFields<MutationImportCarePlanDocumentArgs, 'input'>>;
  importCarePlanFromPdf?: Resolver<ResolversTypes['ImportCarePlanFromPdfResult'], ParentType, ContextType, RequireFields<MutationImportCarePlanFromPdfArgs, 'input'>>;
  importCarePlanFromPdfFile?: Resolver<ResolversTypes['PdfImportResult'], ParentType, ContextType, RequireFields<MutationImportCarePlanFromPdfFileArgs, 'fileKey' | 'patientId'>>;
  linkGoalToInterventions?: Resolver<ResolversTypes['CarePlanGoal'], ParentType, ContextType, RequireFields<MutationLinkGoalToInterventionsArgs, 'goalId' | 'interventionIds'>>;
  regenerateCarePlan?: Resolver<ResolversTypes['GenerationRequest'], ParentType, ContextType, RequireFields<MutationRegenerateCarePlanArgs, 'preferences' | 'requestId'>>;
  rejectCarePlanDraft?: Resolver<ResolversTypes['GenerationRequest'], ParentType, ContextType, RequireFields<MutationRejectCarePlanDraftArgs, 'reason' | 'requestId'>>;
  removeTrainingGoal?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRemoveTrainingGoalArgs, 'goalId'>>;
  removeTrainingIntervention?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRemoveTrainingInterventionArgs, 'interventionId'>>;
  submitCarePlanForReview?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationSubmitCarePlanForReviewArgs, 'id'>>;
  updateCarePlanStatus?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationUpdateCarePlanStatusArgs, 'id' | 'status'>>;
  updateCarePlanTemplate?: Resolver<ResolversTypes['CarePlanTemplate'], ParentType, ContextType, RequireFields<MutationUpdateCarePlanTemplateArgs, 'id' | 'input'>>;
  updateGoalStatus?: Resolver<ResolversTypes['CarePlanGoal'], ParentType, ContextType, RequireFields<MutationUpdateGoalStatusArgs, 'input'>>;
  updateInterventionStatus?: Resolver<ResolversTypes['CarePlanIntervention'], ParentType, ContextType, RequireFields<MutationUpdateInterventionStatusArgs, 'input'>>;
  updateTrainingCarePlan?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationUpdateTrainingCarePlanArgs, 'id' | 'input'>>;
}>;

export type PageInfoResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = ResolversObject<{
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  hasPreviousPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  startCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PatientResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Patient'] = ResolversParentTypes['Patient']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Patient']>, { __typename: 'Patient' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  activeCarePlan?: Resolver<Maybe<ResolversTypes['CarePlan']>, { __typename: 'Patient' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  carePlans?: Resolver<ResolversTypes['CarePlanConnection'], { __typename: 'Patient' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType, Partial<PatientCarePlansArgs>>;

  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PatientCarePlansConnectionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PatientCarePlansConnection'] = ResolversParentTypes['PatientCarePlansConnection']> = ResolversObject<{
  nodes?: Resolver<Array<ResolversTypes['CarePlan']>, ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PdfImportResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PdfImportResult'] = ResolversParentTypes['PdfImportResult']> = ResolversObject<{
  extractedCodes?: Resolver<Array<ResolversTypes['ExtractedCode']>, ParentType, ContextType>;
  parsedCarePlan?: Resolver<Maybe<ResolversTypes['DraftCarePlan']>, ParentType, ContextType>;
  requestId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  validationResult?: Resolver<ResolversTypes['FileValidationResult'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PipelineHealthResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PipelineHealth'] = ResolversParentTypes['PipelineHealth']> = ResolversObject<{
  checkDurationMs?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  degradedServices?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  overall?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  services?: Resolver<Array<ResolversTypes['MLServiceHealth']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ProcessingMetadataResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ProcessingMetadata'] = ResolversParentTypes['ProcessingMetadata']> = ResolversObject<{
  cacheHit?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  correlationId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  modelVersions?: Resolver<Array<ResolversTypes['ModelVersion']>, ParentType, ContextType>;
  processedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  requestId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  stageResults?: Resolver<Array<ResolversTypes['StageResult']>, ParentType, ContextType>;
  totalDurationMs?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  activeCarePlanForPatient?: Resolver<Maybe<ResolversTypes['CarePlan']>, ParentType, ContextType, RequireFields<QueryActiveCarePlanForPatientArgs, 'patientId'>>;
  carePlan?: Resolver<Maybe<ResolversTypes['CarePlan']>, ParentType, ContextType, RequireFields<QueryCarePlanArgs, 'id'>>;
  carePlanReview?: Resolver<Maybe<ResolversTypes['CarePlanReview']>, ParentType, ContextType, RequireFields<QueryCarePlanReviewArgs, 'requestId'>>;
  carePlanTemplate?: Resolver<Maybe<ResolversTypes['CarePlanTemplate']>, ParentType, ContextType, RequireFields<QueryCarePlanTemplateArgs, 'id'>>;
  carePlanTemplates?: Resolver<ResolversTypes['CarePlanTemplateConnection'], ParentType, ContextType, Partial<QueryCarePlanTemplatesArgs>>;
  carePlans?: Resolver<ResolversTypes['CarePlanConnection'], ParentType, ContextType, Partial<QueryCarePlansArgs>>;
  carePlansForPatient?: Resolver<ResolversTypes['CarePlanConnection'], ParentType, ContextType, RequireFields<QueryCarePlansForPatientArgs, 'patientId'>>;
  exportCarePlanDocument?: Resolver<ResolversTypes['ExportDocumentResult'], ParentType, ContextType, RequireFields<QueryExportCarePlanDocumentArgs, 'carePlanId'>>;
  patientCarePlans?: Resolver<ResolversTypes['PatientCarePlansConnection'], ParentType, ContextType, RequireFields<QueryPatientCarePlansArgs, 'patientId'>>;
  pendingRecommendationsForVisit?: Resolver<Array<ResolversTypes['CarePlanRecommendation']>, ParentType, ContextType, RequireFields<QueryPendingRecommendationsForVisitArgs, 'visitId'>>;
  pipelineHealth?: Resolver<ResolversTypes['PipelineHealth'], ParentType, ContextType>;
  pipelineRequest?: Resolver<Maybe<ResolversTypes['GenerationRequest']>, ParentType, ContextType, RequireFields<QueryPipelineRequestArgs, 'requestId'>>;
  templatesForConditions?: Resolver<Array<ResolversTypes['CarePlanTemplate']>, ParentType, ContextType, RequireFields<QueryTemplatesForConditionsArgs, 'conditionCodes'>>;
  trainingCarePlan?: Resolver<Maybe<ResolversTypes['CarePlan']>, ParentType, ContextType, RequireFields<QueryTrainingCarePlanArgs, 'id'>>;
  trainingCarePlans?: Resolver<ResolversTypes['CarePlanConnection'], ParentType, ContextType, Partial<QueryTrainingCarePlansArgs>>;
  validateCarePlanDocument?: Resolver<ResolversTypes['DocumentValidationReport'], ParentType, ContextType, RequireFields<QueryValidateCarePlanDocumentArgs, 'documentText'>>;
}>;

export type RedFlagResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['RedFlag'] = ResolversParentTypes['RedFlag']> = ResolversObject<{
  category?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  recommendedAction?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  severity?: Resolver<ResolversTypes['RedFlagSeverity'], ParentType, ContextType>;
  sourceText?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type StageResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['StageResult'] = ResolversParentTypes['StageResult']> = ResolversObject<{
  cacheHit?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>;
  durationMs?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  error?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  stage?: Resolver<ResolversTypes['PipelineStage'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['StageStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SubscriptionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Subscription'] = ResolversParentTypes['Subscription']> = ResolversObject<{
  carePlanGenerationProgress?: SubscriptionResolver<ResolversTypes['GenerationProgress'], "carePlanGenerationProgress", ParentType, ContextType, RequireFields<SubscriptionCarePlanGenerationProgressArgs, 'requestId'>>;
}>;

export type SuggestedEditResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SuggestedEdit'] = ResolversParentTypes['SuggestedEdit']> = ResolversObject<{
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  currentValue?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  field?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  reason?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  suggestedValue?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type TemplateGoalResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['TemplateGoal'] = ResolversParentTypes['TemplateGoal']> = ResolversObject<{
  defaultTargetDays?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  defaultTargetValue?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  priority?: Resolver<ResolversTypes['GoalPriority'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type TemplateInterventionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['TemplateIntervention'] = ResolversParentTypes['TemplateIntervention']> = ResolversObject<{
  defaultScheduleDays?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  medicationCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  procedureCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['InterventionType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type VisitResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Visit'] = ResolversParentTypes['Visit']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Visit']>, { __typename: 'Visit' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  hasActiveGenerationRequest?: Resolver<ResolversTypes['Boolean'], { __typename: 'Visit' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;

  lastExtraction?: Resolver<Maybe<ResolversTypes['ExtractedEntities']>, { __typename: 'Visit' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  pendingCarePlanRecommendations?: Resolver<Array<ResolversTypes['CarePlanRecommendation']>, { __typename: 'Visit' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type Resolvers<ContextType = DataSourceContext> = ResolversObject<{
  CarePlan?: CarePlanResolvers<ContextType>;
  CarePlanConnection?: CarePlanConnectionResolvers<ContextType>;
  CarePlanEdge?: CarePlanEdgeResolvers<ContextType>;
  CarePlanGoal?: CarePlanGoalResolvers<ContextType>;
  CarePlanIntervention?: CarePlanInterventionResolvers<ContextType>;
  CarePlanRecommendation?: CarePlanRecommendationResolvers<ContextType>;
  CarePlanReview?: CarePlanReviewResolvers<ContextType>;
  CarePlanTemplate?: CarePlanTemplateResolvers<ContextType>;
  CarePlanTemplateConnection?: CarePlanTemplateConnectionResolvers<ContextType>;
  CarePlanTemplateEdge?: CarePlanTemplateEdgeResolvers<ContextType>;
  ClinicalEntity?: ClinicalEntityResolvers<ContextType>;
  CrossReferenceIssue?: CrossReferenceIssueResolvers<ContextType>;
  Date?: GraphQLScalarType;
  DateTime?: GraphQLScalarType;
  DocumentValidationReport?: DocumentValidationReportResolvers<ContextType>;
  DocumentValidationViolation?: DocumentValidationViolationResolvers<ContextType>;
  DraftCarePlan?: DraftCarePlanResolvers<ContextType>;
  DraftGoal?: DraftGoalResolvers<ContextType>;
  DraftIntervention?: DraftInterventionResolvers<ContextType>;
  ExportDocumentResult?: ExportDocumentResultResolvers<ContextType>;
  ExtractedCode?: ExtractedCodeResolvers<ContextType>;
  ExtractedEntities?: ExtractedEntitiesResolvers<ContextType>;
  FileValidationResult?: FileValidationResultResolvers<ContextType>;
  GenerateCarePlanResult?: GenerateCarePlanResultResolvers<ContextType>;
  GenerationProgress?: GenerationProgressResolvers<ContextType>;
  GenerationRequest?: GenerationRequestResolvers<ContextType>;
  GoalProgressNote?: GoalProgressNoteResolvers<ContextType>;
  ImportCarePlanFromPdfResult?: ImportCarePlanFromPdfResultResolvers<ContextType>;
  ImportDocumentResult?: ImportDocumentResultResolvers<ContextType>;
  MLServiceHealth?: MlServiceHealthResolvers<ContextType>;
  ModelVersion?: ModelVersionResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  Patient?: PatientResolvers<ContextType>;
  PatientCarePlansConnection?: PatientCarePlansConnectionResolvers<ContextType>;
  PdfImportResult?: PdfImportResultResolvers<ContextType>;
  PipelineHealth?: PipelineHealthResolvers<ContextType>;
  ProcessingMetadata?: ProcessingMetadataResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  RedFlag?: RedFlagResolvers<ContextType>;
  StageResult?: StageResultResolvers<ContextType>;
  Subscription?: SubscriptionResolvers<ContextType>;
  SuggestedEdit?: SuggestedEditResolvers<ContextType>;
  TemplateGoal?: TemplateGoalResolvers<ContextType>;
  TemplateIntervention?: TemplateInterventionResolvers<ContextType>;
  Visit?: VisitResolvers<ContextType>;
}>;

