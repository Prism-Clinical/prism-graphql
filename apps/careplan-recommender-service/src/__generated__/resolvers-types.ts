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
  DateTime: { input: any; output: any; }
  JSON: { input: any; output: any; }
  _FieldSet: { input: any; output: any; }
};

export type AssignTrainingDataInput = {
  carePlanIds: Array<Scalars['ID']['input']>;
  modelId: Scalars['ID']['input'];
  notes?: InputMaybe<Scalars['String']['input']>;
};

export type CreateMlModelInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  filterCriteria?: InputMaybe<MlModelFilterCriteriaInput>;
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  slug: Scalars['String']['input'];
  targetConditions?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type CreateSelectionRuleInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  priority?: InputMaybe<Scalars['Int']['input']>;
  ruleDefinition: Scalars['JSON']['input'];
  variantGroupId?: InputMaybe<Scalars['ID']['input']>;
};

export type CreateVariantGroupInput = {
  conditionCodes: Array<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
};

export type CreateVariantInput = {
  carePlanId: Scalars['ID']['input'];
  exclusionConditions?: InputMaybe<Array<Scalars['String']['input']>>;
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  priorityScore?: InputMaybe<Scalars['Int']['input']>;
  targetAgeMax?: InputMaybe<Scalars['Int']['input']>;
  targetAgeMin?: InputMaybe<Scalars['Int']['input']>;
  targetConditions?: InputMaybe<Array<Scalars['String']['input']>>;
  targetRiskFactors?: InputMaybe<Array<Scalars['String']['input']>>;
  targetSex?: InputMaybe<Scalars['String']['input']>;
  variantGroupId: Scalars['ID']['input'];
  variantName: Scalars['String']['input'];
};

export type DraftCarePlan = {
  __typename?: 'DraftCarePlan';
  conditionCodes: Array<Scalars['String']['output']>;
  confidenceScore: Scalars['Float']['output'];
  generationMethod: DraftGenerationMethod;
  goals: Array<DraftGoal>;
  interventions: Array<DraftIntervention>;
  similarTrainingPlanIds: Array<Scalars['ID']['output']>;
  sourceTemplateId?: Maybe<Scalars['ID']['output']>;
  title: Scalars['String']['output'];
};

export enum DraftGenerationMethod {
  Hybrid = 'HYBRID',
  RagSynthesis = 'RAG_SYNTHESIS',
  TemplateBased = 'TEMPLATE_BASED'
}

export type DraftGoal = {
  __typename?: 'DraftGoal';
  confidence: Scalars['Float']['output'];
  description: Scalars['String']['output'];
  guidelineReference?: Maybe<Scalars['String']['output']>;
  priority: GoalPriority;
  targetDays?: Maybe<Scalars['Int']['output']>;
  targetValue?: Maybe<Scalars['String']['output']>;
};

export type DraftIntervention = {
  __typename?: 'DraftIntervention';
  confidence: Scalars['Float']['output'];
  description: Scalars['String']['output'];
  dosage?: Maybe<Scalars['String']['output']>;
  frequency?: Maybe<Scalars['String']['output']>;
  guidelineReference?: Maybe<Scalars['String']['output']>;
  medicationCode?: Maybe<Scalars['String']['output']>;
  procedureCode?: Maybe<Scalars['String']['output']>;
  type: Scalars['String']['output'];
};

export type EmbeddingGenerationResult = {
  __typename?: 'EmbeddingGenerationResult';
  failedCount: Scalars['Int']['output'];
  generatedCount: Scalars['Int']['output'];
  processingTimeMs: Scalars['Float']['output'];
};

export type EngineAnalyticsSummary = {
  __typename?: 'EngineAnalyticsSummary';
  acceptanceRate: Scalars['Float']['output'];
  averageProcessingTimeMs: Scalars['Float']['output'];
  period: Scalars['String']['output'];
  topConditionCodes: Scalars['JSON']['output'];
  topMatchTypes: Scalars['JSON']['output'];
  totalSessions: Scalars['Int']['output'];
};

export type EngineConfiguration = {
  __typename?: 'EngineConfiguration';
  matching: MatchingConfig;
  personalization: PersonalizationConfig;
};

export type EnginePatientContextInput = {
  age?: InputMaybe<Scalars['Int']['input']>;
  clinicalNotes?: InputMaybe<Scalars['String']['input']>;
  comorbidities?: InputMaybe<Array<Scalars['String']['input']>>;
  conditionCodes: Array<Scalars['String']['input']>;
  labCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  labValues?: InputMaybe<Scalars['JSON']['input']>;
  medicationCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  patientId?: InputMaybe<Scalars['ID']['input']>;
  providerId?: InputMaybe<Scalars['ID']['input']>;
  riskFactors?: InputMaybe<Array<Scalars['String']['input']>>;
  sex?: InputMaybe<Scalars['String']['input']>;
};

export type EngineRecommendInput = {
  enableDecisionExplorer?: InputMaybe<Scalars['Boolean']['input']>;
  enablePersonalization?: InputMaybe<Scalars['Boolean']['input']>;
  enableRag?: InputMaybe<Scalars['Boolean']['input']>;
  maxResults?: InputMaybe<Scalars['Int']['input']>;
  patientContext: EnginePatientContextInput;
};

export type EngineRecommendation = {
  __typename?: 'EngineRecommendation';
  carePlanId: Scalars['ID']['output'];
  conditionCodes: Array<Scalars['String']['output']>;
  embeddingSimilarity?: Maybe<Scalars['Float']['output']>;
  matchType?: Maybe<MatchType>;
  matchedCodes: Array<Scalars['String']['output']>;
  personalizationScore?: Maybe<Scalars['Float']['output']>;
  rank: Scalars['Int']['output'];
  reasons: Array<MatchReason>;
  score: Scalars['Float']['output'];
  selectionScore?: Maybe<Scalars['Float']['output']>;
  title: Scalars['String']['output'];
  variantGroupId?: Maybe<Scalars['ID']['output']>;
  variantGroupName?: Maybe<Scalars['String']['output']>;
  variantId?: Maybe<Scalars['ID']['output']>;
  variantName?: Maybe<Scalars['String']['output']>;
};

export type EngineRecommendationResult = {
  __typename?: 'EngineRecommendationResult';
  engineVersion: Scalars['String']['output'];
  layerSummaries: Array<LayerSummary>;
  recommendations: Array<EngineRecommendation>;
  sessionId: Scalars['ID']['output'];
  totalProcessingTimeMs: Scalars['Float']['output'];
};

export type FilterPreviewResult = {
  __typename?: 'FilterPreviewResult';
  carePlanId: Scalars['ID']['output'];
  conditionCodes: Array<Scalars['String']['output']>;
  title: Scalars['String']['output'];
  trainingTags?: Maybe<Array<Scalars['String']['output']>>;
};

export type FullRecommendationInput = {
  complications?: InputMaybe<Array<Scalars['String']['input']>>;
  conditionCodes: Array<Scalars['String']['input']>;
  conditionNames?: InputMaybe<Array<Scalars['String']['input']>>;
  demographics?: InputMaybe<PatientDemographicsInput>;
  includeDrafts?: InputMaybe<Scalars['Boolean']['input']>;
  labCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  labValues?: InputMaybe<Scalars['JSON']['input']>;
  maxResults?: InputMaybe<Scalars['Int']['input']>;
  medicationCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  medicationNames?: InputMaybe<Array<Scalars['String']['input']>>;
  riskFactors?: InputMaybe<Array<Scalars['String']['input']>>;
};

export enum GoalPriority {
  High = 'HIGH',
  Low = 'LOW',
  Medium = 'MEDIUM'
}

export type LayerDetail = {
  __typename?: 'LayerDetail';
  candidateDetails: Array<Scalars['JSON']['output']>;
  inputCount: Scalars['Int']['output'];
  layer: Scalars['Int']['output'];
  layerName: Scalars['String']['output'];
  outputCount: Scalars['Int']['output'];
  processingTimeMs: Scalars['Float']['output'];
};

export type LayerSummary = {
  __typename?: 'LayerSummary';
  candidateCount: Scalars['Int']['output'];
  layer: Scalars['Int']['output'];
  layerName: Scalars['String']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  processingTimeMs: Scalars['Float']['output'];
};

export type LoadModelInput = {
  modelId: Scalars['ID']['input'];
  versionId?: InputMaybe<Scalars['ID']['input']>;
};

export type MlModel = {
  __typename?: 'MLModel';
  activeVersion?: Maybe<MlModelVersion>;
  createdAt: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  filterCriteria?: Maybe<MlModelFilterCriteria>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  isDefault: Scalars['Boolean']['output'];
  modelType: Scalars['String']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  targetConditions?: Maybe<Array<Scalars['String']['output']>>;
  trainingDataCount: Scalars['Int']['output'];
  updatedAt: Scalars['DateTime']['output'];
  versions: Array<MlModelVersion>;
};

export type MlModelFilterCriteria = {
  __typename?: 'MLModelFilterCriteria';
  categories?: Maybe<Array<Scalars['String']['output']>>;
  conditionCodePrefixes?: Maybe<Array<Scalars['String']['output']>>;
  conditionCodes?: Maybe<Array<Scalars['String']['output']>>;
  trainingTags?: Maybe<Array<Scalars['String']['output']>>;
};

export type MlModelFilterCriteriaInput = {
  categories?: InputMaybe<Array<Scalars['String']['input']>>;
  conditionCodePrefixes?: InputMaybe<Array<Scalars['String']['input']>>;
  conditionCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  trainingTags?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type MlModelTrainingData = {
  __typename?: 'MLModelTrainingData';
  assignedAt: Scalars['DateTime']['output'];
  assignedBy?: Maybe<Scalars['ID']['output']>;
  assignmentType: Scalars['String']['output'];
  carePlanId: Scalars['ID']['output'];
  carePlanTitle?: Maybe<Scalars['String']['output']>;
  conditionCodes?: Maybe<Array<Scalars['String']['output']>>;
  id: Scalars['ID']['output'];
  modelId: Scalars['ID']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  trainingTags?: Maybe<Array<Scalars['String']['output']>>;
};

export type MlModelVersion = {
  __typename?: 'MLModelVersion';
  createdAt: Scalars['DateTime']['output'];
  deployedAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  isDefault: Scalars['Boolean']['output'];
  metrics?: Maybe<Scalars['JSON']['output']>;
  modelId: Scalars['ID']['output'];
  modelPath: Scalars['String']['output'];
  trainingDataSnapshot?: Maybe<Scalars['JSON']['output']>;
  trainingJobId?: Maybe<Scalars['ID']['output']>;
  version: Scalars['String']['output'];
};

export type MatchReason = {
  __typename?: 'MatchReason';
  description: Scalars['String']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  reasonType: Scalars['String']['output'];
  scoreImpact: Scalars['Float']['output'];
};

export enum MatchType {
  EmbeddingSimilarity = 'EMBEDDING_SIMILARITY',
  ExactCode = 'EXACT_CODE',
  PrefixCode = 'PREFIX_CODE',
  VariantGroup = 'VARIANT_GROUP'
}

export type MatchingConfig = {
  __typename?: 'MatchingConfig';
  codeMatchPriority: Scalars['String']['output'];
  enableEmbeddings: Scalars['Boolean']['output'];
  maxCandidates: Scalars['Int']['output'];
  scoreWeights: ScoreWeights;
  similarityThreshold: Scalars['Float']['output'];
  strategy: Scalars['String']['output'];
};

export type MatchingConfigInput = {
  codeMatchPriority: Scalars['String']['input'];
  enableEmbeddings: Scalars['Boolean']['input'];
  maxCandidates: Scalars['Int']['input'];
  scoreWeights: ScoreWeightsInput;
  similarityThreshold: Scalars['Float']['input'];
  strategy: Scalars['String']['input'];
};

export type ModelInfo = {
  __typename?: 'ModelInfo';
  featureDimension: Scalars['Int']['output'];
  isLoaded: Scalars['Boolean']['output'];
  lastTrainedAt?: Maybe<Scalars['DateTime']['output']>;
  modelType: Scalars['String']['output'];
  trainingMetrics?: Maybe<Scalars['JSON']['output']>;
  version: Scalars['String']['output'];
};

export type ModelLoadStatus = {
  __typename?: 'ModelLoadStatus';
  isDefault: Scalars['Boolean']['output'];
  isFitted: Scalars['Boolean']['output'];
  isLoaded: Scalars['Boolean']['output'];
  loadedAt?: Maybe<Scalars['DateTime']['output']>;
  metrics?: Maybe<Scalars['JSON']['output']>;
  modelId: Scalars['ID']['output'];
  modelSlug: Scalars['String']['output'];
  version: Scalars['String']['output'];
  versionId: Scalars['ID']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  assignTrainingData: Array<MlModelTrainingData>;
  cancelTrainingJob: TrainingJob;
  createMLModel: MlModel;
  createSelectionRule: SelectionRule;
  createVariant: Variant;
  createVariantGroup: VariantGroup;
  deleteMLModel: Scalars['Boolean']['output'];
  deleteSelectionRule: Scalars['Boolean']['output'];
  deleteVariant: Scalars['Boolean']['output'];
  deleteVariantGroup: Scalars['Boolean']['output'];
  generateMissingEmbeddings: EmbeddingGenerationResult;
  loadModel: ModelLoadStatus;
  recordRecommendationOutcome: Scalars['Boolean']['output'];
  reloadRecommenderModel: ModelInfo;
  saveMatchingConfig: MatchingConfig;
  savePersonalizationConfig: PersonalizationConfig;
  setActiveVersion: MlModelVersion;
  trainModel: TrainingJob;
  triggerRecommenderTraining: TrainingJob;
  unassignTrainingData: Scalars['Boolean']['output'];
  unloadModel: Scalars['Boolean']['output'];
  updateMLModel: MlModel;
  updateSelectionRule: SelectionRule;
  updateVariant: Variant;
  updateVariantGroup: VariantGroup;
};


export type MutationAssignTrainingDataArgs = {
  input: AssignTrainingDataInput;
};


export type MutationCancelTrainingJobArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCreateMlModelArgs = {
  input: CreateMlModelInput;
};


export type MutationCreateSelectionRuleArgs = {
  input: CreateSelectionRuleInput;
};


export type MutationCreateVariantArgs = {
  input: CreateVariantInput;
};


export type MutationCreateVariantGroupArgs = {
  input: CreateVariantGroupInput;
};


export type MutationDeleteMlModelArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteSelectionRuleArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteVariantArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteVariantGroupArgs = {
  id: Scalars['ID']['input'];
};


export type MutationLoadModelArgs = {
  input: LoadModelInput;
};


export type MutationRecordRecommendationOutcomeArgs = {
  input: RecordOutcomeInput;
};


export type MutationSaveMatchingConfigArgs = {
  input: MatchingConfigInput;
};


export type MutationSavePersonalizationConfigArgs = {
  input: PersonalizationConfigInput;
};


export type MutationSetActiveVersionArgs = {
  input: SetActiveVersionInput;
};


export type MutationTrainModelArgs = {
  input: TrainModelInput;
};


export type MutationTriggerRecommenderTrainingArgs = {
  input?: InputMaybe<TriggerTrainingInput>;
};


export type MutationUnassignTrainingDataArgs = {
  input: UnassignTrainingDataInput;
};


export type MutationUnloadModelArgs = {
  modelId: Scalars['ID']['input'];
};


export type MutationUpdateMlModelArgs = {
  id: Scalars['ID']['input'];
  input: UpdateMlModelInput;
};


export type MutationUpdateSelectionRuleArgs = {
  id: Scalars['ID']['input'];
  input: UpdateSelectionRuleInput;
};


export type MutationUpdateVariantArgs = {
  id: Scalars['ID']['input'];
  input: UpdateVariantInput;
};


export type MutationUpdateVariantGroupArgs = {
  id: Scalars['ID']['input'];
  input: UpdateVariantGroupInput;
};

export type Patient = {
  __typename?: 'Patient';
  engineRecommendations: EngineRecommendationResult;
  id: Scalars['ID']['output'];
  recommendedCarePlans: RecommendationResult;
};


export type PatientEngineRecommendationsArgs = {
  enablePersonalization?: InputMaybe<Scalars['Boolean']['input']>;
  maxResults?: InputMaybe<Scalars['Int']['input']>;
};


export type PatientRecommendedCarePlansArgs = {
  includeDrafts?: InputMaybe<Scalars['Boolean']['input']>;
  maxResults?: InputMaybe<Scalars['Int']['input']>;
};

export type PatientDemographicsInput = {
  age?: InputMaybe<Scalars['Int']['input']>;
  ethnicity?: InputMaybe<Scalars['String']['input']>;
  race?: InputMaybe<Scalars['String']['input']>;
  sex?: InputMaybe<Scalars['String']['input']>;
};

export type PersonalizationConfig = {
  __typename?: 'PersonalizationConfig';
  enableDecisionPaths: Scalars['Boolean']['output'];
  enableOutcomeLearning: Scalars['Boolean']['output'];
  enableRag: Scalars['Boolean']['output'];
  knowledgeSources: Array<Scalars['String']['output']>;
  learningRate: Scalars['String']['output'];
};

export type PersonalizationConfigInput = {
  enableDecisionPaths: Scalars['Boolean']['input'];
  enableOutcomeLearning: Scalars['Boolean']['input'];
  enableRag: Scalars['Boolean']['input'];
  knowledgeSources: Array<Scalars['String']['input']>;
  learningRate: Scalars['String']['input'];
};

export enum PersonalizationMethod {
  DecisionExplorer = 'DECISION_EXPLORER',
  OutcomeLearning = 'OUTCOME_LEARNING',
  RagSynthesis = 'RAG_SYNTHESIS'
}

export type Query = {
  __typename?: 'Query';
  engineAnalytics: EngineAnalyticsSummary;
  engineConfiguration: EngineConfiguration;
  engineExplainSession?: Maybe<SessionExplanation>;
  engineRecommend: EngineRecommendationResult;
  loadedModels: Array<ModelLoadStatus>;
  mlModel?: Maybe<MlModel>;
  mlModelBySlug?: Maybe<MlModel>;
  mlModelTrainingData: Array<MlModelTrainingData>;
  mlModelTrainingPreview: TrainingPreview;
  mlModelVersions: Array<MlModelVersion>;
  mlModels: Array<MlModel>;
  previewFilterCriteria: Array<FilterPreviewResult>;
  recommendCarePlansFull: RecommendationResult;
  recommendCarePlansSimple: RecommendationResult;
  recommenderModelInfo: ModelInfo;
  recommenderStats: RecommenderStats;
  selectionRules: Array<SelectionRule>;
  trainingJob?: Maybe<TrainingJob>;
  trainingJobs: Array<TrainingJob>;
  variantGroup?: Maybe<VariantGroup>;
  variantGroups: Array<VariantGroup>;
};


export type QueryEngineAnalyticsArgs = {
  days?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryEngineExplainSessionArgs = {
  sessionId: Scalars['ID']['input'];
};


export type QueryEngineRecommendArgs = {
  input: EngineRecommendInput;
};


export type QueryMlModelArgs = {
  id: Scalars['ID']['input'];
};


export type QueryMlModelBySlugArgs = {
  slug: Scalars['String']['input'];
};


export type QueryMlModelTrainingDataArgs = {
  assignmentType?: InputMaybe<Scalars['String']['input']>;
  modelId: Scalars['ID']['input'];
};


export type QueryMlModelTrainingPreviewArgs = {
  modelId: Scalars['ID']['input'];
};


export type QueryMlModelVersionsArgs = {
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  modelId: Scalars['ID']['input'];
};


export type QueryMlModelsArgs = {
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryPreviewFilterCriteriaArgs = {
  filterCriteria: MlModelFilterCriteriaInput;
};


export type QueryRecommendCarePlansFullArgs = {
  input: FullRecommendationInput;
};


export type QueryRecommendCarePlansSimpleArgs = {
  input: SimpleRecommendationInput;
};


export type QuerySelectionRulesArgs = {
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  variantGroupId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryTrainingJobArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTrainingJobsArgs = {
  first?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<TrainingJobStatus>;
};


export type QueryVariantGroupArgs = {
  id: Scalars['ID']['input'];
};


export type QueryVariantGroupsArgs = {
  conditionCode?: InputMaybe<Scalars['String']['input']>;
};

export enum RecommendationMode {
  Full = 'FULL',
  Simple = 'SIMPLE'
}

export type RecommendationResult = {
  __typename?: 'RecommendationResult';
  drafts: Array<DraftCarePlan>;
  modelVersion: Scalars['String']['output'];
  processingTimeMs: Scalars['Float']['output'];
  queryMode: RecommendationMode;
  templates: Array<TemplateRecommendation>;
};

export type RecommenderStats = {
  __typename?: 'RecommenderStats';
  averageConfidence?: Maybe<Scalars['Float']['output']>;
  embeddingsGenerated: Scalars['Int']['output'];
  lastTrainedAt?: Maybe<Scalars['DateTime']['output']>;
  modelVersion?: Maybe<Scalars['String']['output']>;
  pendingEmbeddings: Scalars['Int']['output'];
  totalTemplates: Scalars['Int']['output'];
  totalTrainingExamples: Scalars['Int']['output'];
};

export type RecordOutcomeInput = {
  accepted: Scalars['Boolean']['input'];
  carePlanId: Scalars['ID']['input'];
  feedback?: InputMaybe<Scalars['String']['input']>;
  selectedRank?: InputMaybe<Scalars['Int']['input']>;
  sessionId: Scalars['ID']['input'];
};

export type ScoreWeights = {
  __typename?: 'ScoreWeights';
  categoryMatch: Scalars['Int']['output'];
  embeddingMatch: Scalars['Int']['output'];
  exactMatch: Scalars['Int']['output'];
  prefixMatch: Scalars['Int']['output'];
};

export type ScoreWeightsInput = {
  categoryMatch: Scalars['Int']['input'];
  embeddingMatch: Scalars['Int']['input'];
  exactMatch: Scalars['Int']['input'];
  prefixMatch: Scalars['Int']['input'];
};

export enum SelectionMethod {
  DefaultVariant = 'DEFAULT_VARIANT',
  RuleBased = 'RULE_BASED',
  TargetingCriteria = 'TARGETING_CRITERIA'
}

export type SelectionRule = {
  __typename?: 'SelectionRule';
  createdAt: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  priority: Scalars['Int']['output'];
  ruleDefinition: Scalars['JSON']['output'];
  variantGroupId?: Maybe<Scalars['ID']['output']>;
};

export type SessionExplanation = {
  __typename?: 'SessionExplanation';
  createdAt: Scalars['DateTime']['output'];
  finalRecommendations: Array<EngineRecommendation>;
  layers: Array<LayerDetail>;
  patientContext: Scalars['JSON']['output'];
  sessionId: Scalars['ID']['output'];
};

export type SetActiveVersionInput = {
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  versionId: Scalars['ID']['input'];
};

export type SimpleRecommendationInput = {
  conditionCodes: Array<Scalars['String']['input']>;
  includeDrafts?: InputMaybe<Scalars['Boolean']['input']>;
  maxResults?: InputMaybe<Scalars['Int']['input']>;
};

export type TemplateRecommendation = {
  __typename?: 'TemplateRecommendation';
  category: Scalars['String']['output'];
  conditionCodes: Array<Scalars['String']['output']>;
  confidence: Scalars['Float']['output'];
  description?: Maybe<Scalars['String']['output']>;
  matchFactors: Array<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  rankingScore: Scalars['Float']['output'];
  similarityScore: Scalars['Float']['output'];
  templateId: Scalars['ID']['output'];
};

export type TrainModelInput = {
  includeValidationOutcomes?: InputMaybe<Scalars['Boolean']['input']>;
  jobName?: InputMaybe<Scalars['String']['input']>;
  modelId: Scalars['ID']['input'];
};

export type TrainingJob = {
  __typename?: 'TrainingJob';
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  jobName?: Maybe<Scalars['String']['output']>;
  metrics?: Maybe<Scalars['JSON']['output']>;
  modelPath?: Maybe<Scalars['String']['output']>;
  modelType: Scalars['String']['output'];
  modelVersion?: Maybe<Scalars['String']['output']>;
  progressPercent: Scalars['Int']['output'];
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  status: TrainingJobStatus;
  statusMessage?: Maybe<Scalars['String']['output']>;
  trainingExamplesCount?: Maybe<Scalars['Int']['output']>;
};

export enum TrainingJobStatus {
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Pending = 'PENDING',
  Running = 'RUNNING'
}

export type TrainingPreview = {
  __typename?: 'TrainingPreview';
  byAssignmentType: Scalars['JSON']['output'];
  conditionCodes: Array<Scalars['String']['output']>;
  modelId: Scalars['ID']['output'];
  modelName?: Maybe<Scalars['String']['output']>;
  totalExamples: Scalars['Int']['output'];
  withEmbeddings: Scalars['Int']['output'];
};

export type TriggerTrainingInput = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  includeValidationOutcomes?: InputMaybe<Scalars['Boolean']['input']>;
  jobName?: InputMaybe<Scalars['String']['input']>;
};

export type UnassignTrainingDataInput = {
  carePlanIds: Array<Scalars['ID']['input']>;
  modelId: Scalars['ID']['input'];
};

export type UpdateMlModelInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  filterCriteria?: InputMaybe<MlModelFilterCriteriaInput>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  targetConditions?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type UpdateSelectionRuleInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  ruleDefinition?: InputMaybe<Scalars['JSON']['input']>;
};

export type UpdateVariantGroupInput = {
  conditionCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateVariantInput = {
  exclusionConditions?: InputMaybe<Array<Scalars['String']['input']>>;
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  priorityScore?: InputMaybe<Scalars['Int']['input']>;
  targetAgeMax?: InputMaybe<Scalars['Int']['input']>;
  targetAgeMin?: InputMaybe<Scalars['Int']['input']>;
  targetConditions?: InputMaybe<Array<Scalars['String']['input']>>;
  targetRiskFactors?: InputMaybe<Array<Scalars['String']['input']>>;
  targetSex?: InputMaybe<Scalars['String']['input']>;
  variantName?: InputMaybe<Scalars['String']['input']>;
};

export type Variant = {
  __typename?: 'Variant';
  carePlanId: Scalars['ID']['output'];
  exclusionConditions?: Maybe<Array<Scalars['String']['output']>>;
  id: Scalars['ID']['output'];
  isDefault: Scalars['Boolean']['output'];
  priorityScore: Scalars['Int']['output'];
  targetAgeMax?: Maybe<Scalars['Int']['output']>;
  targetAgeMin?: Maybe<Scalars['Int']['output']>;
  targetConditions?: Maybe<Array<Scalars['String']['output']>>;
  targetRiskFactors?: Maybe<Array<Scalars['String']['output']>>;
  targetSex?: Maybe<Scalars['String']['output']>;
  variantGroupId: Scalars['ID']['output'];
  variantName: Scalars['String']['output'];
};

export type VariantGroup = {
  __typename?: 'VariantGroup';
  conditionCodes: Array<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  variants: Array<Variant>;
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
  AssignTrainingDataInput: AssignTrainingDataInput;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  CreateMLModelInput: CreateMlModelInput;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CreateSelectionRuleInput: CreateSelectionRuleInput;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  CreateVariantGroupInput: CreateVariantGroupInput;
  CreateVariantInput: CreateVariantInput;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  DraftCarePlan: ResolverTypeWrapper<DraftCarePlan>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  DraftGenerationMethod: DraftGenerationMethod;
  DraftGoal: ResolverTypeWrapper<DraftGoal>;
  DraftIntervention: ResolverTypeWrapper<DraftIntervention>;
  EmbeddingGenerationResult: ResolverTypeWrapper<EmbeddingGenerationResult>;
  EngineAnalyticsSummary: ResolverTypeWrapper<EngineAnalyticsSummary>;
  EngineConfiguration: ResolverTypeWrapper<EngineConfiguration>;
  EnginePatientContextInput: EnginePatientContextInput;
  EngineRecommendInput: EngineRecommendInput;
  EngineRecommendation: ResolverTypeWrapper<EngineRecommendation>;
  EngineRecommendationResult: ResolverTypeWrapper<EngineRecommendationResult>;
  FilterPreviewResult: ResolverTypeWrapper<FilterPreviewResult>;
  FullRecommendationInput: FullRecommendationInput;
  GoalPriority: GoalPriority;
  JSON: ResolverTypeWrapper<Scalars['JSON']['output']>;
  LayerDetail: ResolverTypeWrapper<LayerDetail>;
  LayerSummary: ResolverTypeWrapper<LayerSummary>;
  LoadModelInput: LoadModelInput;
  MLModel: ResolverTypeWrapper<MlModel>;
  MLModelFilterCriteria: ResolverTypeWrapper<MlModelFilterCriteria>;
  MLModelFilterCriteriaInput: MlModelFilterCriteriaInput;
  MLModelTrainingData: ResolverTypeWrapper<MlModelTrainingData>;
  MLModelVersion: ResolverTypeWrapper<MlModelVersion>;
  MatchReason: ResolverTypeWrapper<MatchReason>;
  MatchType: MatchType;
  MatchingConfig: ResolverTypeWrapper<MatchingConfig>;
  MatchingConfigInput: MatchingConfigInput;
  ModelInfo: ResolverTypeWrapper<ModelInfo>;
  ModelLoadStatus: ResolverTypeWrapper<ModelLoadStatus>;
  Mutation: ResolverTypeWrapper<{}>;
  Patient: ResolverTypeWrapper<Patient>;
  PatientDemographicsInput: PatientDemographicsInput;
  PersonalizationConfig: ResolverTypeWrapper<PersonalizationConfig>;
  PersonalizationConfigInput: PersonalizationConfigInput;
  PersonalizationMethod: PersonalizationMethod;
  Query: ResolverTypeWrapper<{}>;
  RecommendationMode: RecommendationMode;
  RecommendationResult: ResolverTypeWrapper<RecommendationResult>;
  RecommenderStats: ResolverTypeWrapper<RecommenderStats>;
  RecordOutcomeInput: RecordOutcomeInput;
  ScoreWeights: ResolverTypeWrapper<ScoreWeights>;
  ScoreWeightsInput: ScoreWeightsInput;
  SelectionMethod: SelectionMethod;
  SelectionRule: ResolverTypeWrapper<SelectionRule>;
  SessionExplanation: ResolverTypeWrapper<SessionExplanation>;
  SetActiveVersionInput: SetActiveVersionInput;
  SimpleRecommendationInput: SimpleRecommendationInput;
  TemplateRecommendation: ResolverTypeWrapper<TemplateRecommendation>;
  TrainModelInput: TrainModelInput;
  TrainingJob: ResolverTypeWrapper<TrainingJob>;
  TrainingJobStatus: TrainingJobStatus;
  TrainingPreview: ResolverTypeWrapper<TrainingPreview>;
  TriggerTrainingInput: TriggerTrainingInput;
  UnassignTrainingDataInput: UnassignTrainingDataInput;
  UpdateMLModelInput: UpdateMlModelInput;
  UpdateSelectionRuleInput: UpdateSelectionRuleInput;
  UpdateVariantGroupInput: UpdateVariantGroupInput;
  UpdateVariantInput: UpdateVariantInput;
  Variant: ResolverTypeWrapper<Variant>;
  VariantGroup: ResolverTypeWrapper<VariantGroup>;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  AssignTrainingDataInput: AssignTrainingDataInput;
  ID: Scalars['ID']['output'];
  String: Scalars['String']['output'];
  CreateMLModelInput: CreateMlModelInput;
  Boolean: Scalars['Boolean']['output'];
  CreateSelectionRuleInput: CreateSelectionRuleInput;
  Int: Scalars['Int']['output'];
  CreateVariantGroupInput: CreateVariantGroupInput;
  CreateVariantInput: CreateVariantInput;
  DateTime: Scalars['DateTime']['output'];
  DraftCarePlan: DraftCarePlan;
  Float: Scalars['Float']['output'];
  DraftGoal: DraftGoal;
  DraftIntervention: DraftIntervention;
  EmbeddingGenerationResult: EmbeddingGenerationResult;
  EngineAnalyticsSummary: EngineAnalyticsSummary;
  EngineConfiguration: EngineConfiguration;
  EnginePatientContextInput: EnginePatientContextInput;
  EngineRecommendInput: EngineRecommendInput;
  EngineRecommendation: EngineRecommendation;
  EngineRecommendationResult: EngineRecommendationResult;
  FilterPreviewResult: FilterPreviewResult;
  FullRecommendationInput: FullRecommendationInput;
  JSON: Scalars['JSON']['output'];
  LayerDetail: LayerDetail;
  LayerSummary: LayerSummary;
  LoadModelInput: LoadModelInput;
  MLModel: MlModel;
  MLModelFilterCriteria: MlModelFilterCriteria;
  MLModelFilterCriteriaInput: MlModelFilterCriteriaInput;
  MLModelTrainingData: MlModelTrainingData;
  MLModelVersion: MlModelVersion;
  MatchReason: MatchReason;
  MatchingConfig: MatchingConfig;
  MatchingConfigInput: MatchingConfigInput;
  ModelInfo: ModelInfo;
  ModelLoadStatus: ModelLoadStatus;
  Mutation: {};
  Patient: Patient;
  PatientDemographicsInput: PatientDemographicsInput;
  PersonalizationConfig: PersonalizationConfig;
  PersonalizationConfigInput: PersonalizationConfigInput;
  Query: {};
  RecommendationResult: RecommendationResult;
  RecommenderStats: RecommenderStats;
  RecordOutcomeInput: RecordOutcomeInput;
  ScoreWeights: ScoreWeights;
  ScoreWeightsInput: ScoreWeightsInput;
  SelectionRule: SelectionRule;
  SessionExplanation: SessionExplanation;
  SetActiveVersionInput: SetActiveVersionInput;
  SimpleRecommendationInput: SimpleRecommendationInput;
  TemplateRecommendation: TemplateRecommendation;
  TrainModelInput: TrainModelInput;
  TrainingJob: TrainingJob;
  TrainingPreview: TrainingPreview;
  TriggerTrainingInput: TriggerTrainingInput;
  UnassignTrainingDataInput: UnassignTrainingDataInput;
  UpdateMLModelInput: UpdateMlModelInput;
  UpdateSelectionRuleInput: UpdateSelectionRuleInput;
  UpdateVariantGroupInput: UpdateVariantGroupInput;
  UpdateVariantInput: UpdateVariantInput;
  Variant: Variant;
  VariantGroup: VariantGroup;
}>;

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type DraftCarePlanResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DraftCarePlan'] = ResolversParentTypes['DraftCarePlan']> = ResolversObject<{
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  confidenceScore?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  generationMethod?: Resolver<ResolversTypes['DraftGenerationMethod'], ParentType, ContextType>;
  goals?: Resolver<Array<ResolversTypes['DraftGoal']>, ParentType, ContextType>;
  interventions?: Resolver<Array<ResolversTypes['DraftIntervention']>, ParentType, ContextType>;
  similarTrainingPlanIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  sourceTemplateId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DraftGoalResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DraftGoal'] = ResolversParentTypes['DraftGoal']> = ResolversObject<{
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  guidelineReference?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  priority?: Resolver<ResolversTypes['GoalPriority'], ParentType, ContextType>;
  targetDays?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  targetValue?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DraftInterventionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DraftIntervention'] = ResolversParentTypes['DraftIntervention']> = ResolversObject<{
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  dosage?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  frequency?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  guidelineReference?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  medicationCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  procedureCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type EmbeddingGenerationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['EmbeddingGenerationResult'] = ResolversParentTypes['EmbeddingGenerationResult']> = ResolversObject<{
  failedCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  generatedCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  processingTimeMs?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type EngineAnalyticsSummaryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['EngineAnalyticsSummary'] = ResolversParentTypes['EngineAnalyticsSummary']> = ResolversObject<{
  acceptanceRate?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  averageProcessingTimeMs?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  period?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  topConditionCodes?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  topMatchTypes?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  totalSessions?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type EngineConfigurationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['EngineConfiguration'] = ResolversParentTypes['EngineConfiguration']> = ResolversObject<{
  matching?: Resolver<ResolversTypes['MatchingConfig'], ParentType, ContextType>;
  personalization?: Resolver<ResolversTypes['PersonalizationConfig'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type EngineRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['EngineRecommendation'] = ResolversParentTypes['EngineRecommendation']> = ResolversObject<{
  carePlanId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  embeddingSimilarity?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  matchType?: Resolver<Maybe<ResolversTypes['MatchType']>, ParentType, ContextType>;
  matchedCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  personalizationScore?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  rank?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  reasons?: Resolver<Array<ResolversTypes['MatchReason']>, ParentType, ContextType>;
  score?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  selectionScore?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  variantGroupId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  variantGroupName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  variantId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  variantName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type EngineRecommendationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['EngineRecommendationResult'] = ResolversParentTypes['EngineRecommendationResult']> = ResolversObject<{
  engineVersion?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  layerSummaries?: Resolver<Array<ResolversTypes['LayerSummary']>, ParentType, ContextType>;
  recommendations?: Resolver<Array<ResolversTypes['EngineRecommendation']>, ParentType, ContextType>;
  sessionId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  totalProcessingTimeMs?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type FilterPreviewResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['FilterPreviewResult'] = ResolversParentTypes['FilterPreviewResult']> = ResolversObject<{
  carePlanId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  trainingTags?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export interface JsonScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['JSON'], any> {
  name: 'JSON';
}

export type LayerDetailResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['LayerDetail'] = ResolversParentTypes['LayerDetail']> = ResolversObject<{
  candidateDetails?: Resolver<Array<ResolversTypes['JSON']>, ParentType, ContextType>;
  inputCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  layer?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  layerName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  outputCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  processingTimeMs?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type LayerSummaryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['LayerSummary'] = ResolversParentTypes['LayerSummary']> = ResolversObject<{
  candidateCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  layer?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  layerName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  metadata?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  processingTimeMs?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MlModelResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MLModel'] = ResolversParentTypes['MLModel']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['MLModel']>, { __typename: 'MLModel' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  activeVersion?: Resolver<Maybe<ResolversTypes['MLModelVersion']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  filterCriteria?: Resolver<Maybe<ResolversTypes['MLModelFilterCriteria']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isDefault?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  modelType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  targetConditions?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  trainingDataCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  versions?: Resolver<Array<ResolversTypes['MLModelVersion']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MlModelFilterCriteriaResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MLModelFilterCriteria'] = ResolversParentTypes['MLModelFilterCriteria']> = ResolversObject<{
  categories?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  conditionCodePrefixes?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  conditionCodes?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  trainingTags?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MlModelTrainingDataResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MLModelTrainingData'] = ResolversParentTypes['MLModelTrainingData']> = ResolversObject<{
  assignedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  assignedBy?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  assignmentType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  carePlanId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  carePlanTitle?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  conditionCodes?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  modelId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  notes?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  trainingTags?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MlModelVersionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MLModelVersion'] = ResolversParentTypes['MLModelVersion']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  deployedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isDefault?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  metrics?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  modelId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  modelPath?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  trainingDataSnapshot?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  trainingJobId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  version?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MatchReasonResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MatchReason'] = ResolversParentTypes['MatchReason']> = ResolversObject<{
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  metadata?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  reasonType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  scoreImpact?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MatchingConfigResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MatchingConfig'] = ResolversParentTypes['MatchingConfig']> = ResolversObject<{
  codeMatchPriority?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  enableEmbeddings?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  maxCandidates?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  scoreWeights?: Resolver<ResolversTypes['ScoreWeights'], ParentType, ContextType>;
  similarityThreshold?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  strategy?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ModelInfoResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ModelInfo'] = ResolversParentTypes['ModelInfo']> = ResolversObject<{
  featureDimension?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  isLoaded?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  lastTrainedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  modelType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  trainingMetrics?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  version?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ModelLoadStatusResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ModelLoadStatus'] = ResolversParentTypes['ModelLoadStatus']> = ResolversObject<{
  isDefault?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isFitted?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isLoaded?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  loadedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  metrics?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  modelId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  modelSlug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  version?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  versionId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  assignTrainingData?: Resolver<Array<ResolversTypes['MLModelTrainingData']>, ParentType, ContextType, RequireFields<MutationAssignTrainingDataArgs, 'input'>>;
  cancelTrainingJob?: Resolver<ResolversTypes['TrainingJob'], ParentType, ContextType, RequireFields<MutationCancelTrainingJobArgs, 'id'>>;
  createMLModel?: Resolver<ResolversTypes['MLModel'], ParentType, ContextType, RequireFields<MutationCreateMlModelArgs, 'input'>>;
  createSelectionRule?: Resolver<ResolversTypes['SelectionRule'], ParentType, ContextType, RequireFields<MutationCreateSelectionRuleArgs, 'input'>>;
  createVariant?: Resolver<ResolversTypes['Variant'], ParentType, ContextType, RequireFields<MutationCreateVariantArgs, 'input'>>;
  createVariantGroup?: Resolver<ResolversTypes['VariantGroup'], ParentType, ContextType, RequireFields<MutationCreateVariantGroupArgs, 'input'>>;
  deleteMLModel?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteMlModelArgs, 'id'>>;
  deleteSelectionRule?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteSelectionRuleArgs, 'id'>>;
  deleteVariant?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteVariantArgs, 'id'>>;
  deleteVariantGroup?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteVariantGroupArgs, 'id'>>;
  generateMissingEmbeddings?: Resolver<ResolversTypes['EmbeddingGenerationResult'], ParentType, ContextType>;
  loadModel?: Resolver<ResolversTypes['ModelLoadStatus'], ParentType, ContextType, RequireFields<MutationLoadModelArgs, 'input'>>;
  recordRecommendationOutcome?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRecordRecommendationOutcomeArgs, 'input'>>;
  reloadRecommenderModel?: Resolver<ResolversTypes['ModelInfo'], ParentType, ContextType>;
  saveMatchingConfig?: Resolver<ResolversTypes['MatchingConfig'], ParentType, ContextType, RequireFields<MutationSaveMatchingConfigArgs, 'input'>>;
  savePersonalizationConfig?: Resolver<ResolversTypes['PersonalizationConfig'], ParentType, ContextType, RequireFields<MutationSavePersonalizationConfigArgs, 'input'>>;
  setActiveVersion?: Resolver<ResolversTypes['MLModelVersion'], ParentType, ContextType, RequireFields<MutationSetActiveVersionArgs, 'input'>>;
  trainModel?: Resolver<ResolversTypes['TrainingJob'], ParentType, ContextType, RequireFields<MutationTrainModelArgs, 'input'>>;
  triggerRecommenderTraining?: Resolver<ResolversTypes['TrainingJob'], ParentType, ContextType, Partial<MutationTriggerRecommenderTrainingArgs>>;
  unassignTrainingData?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationUnassignTrainingDataArgs, 'input'>>;
  unloadModel?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationUnloadModelArgs, 'modelId'>>;
  updateMLModel?: Resolver<ResolversTypes['MLModel'], ParentType, ContextType, RequireFields<MutationUpdateMlModelArgs, 'id' | 'input'>>;
  updateSelectionRule?: Resolver<ResolversTypes['SelectionRule'], ParentType, ContextType, RequireFields<MutationUpdateSelectionRuleArgs, 'id' | 'input'>>;
  updateVariant?: Resolver<ResolversTypes['Variant'], ParentType, ContextType, RequireFields<MutationUpdateVariantArgs, 'id' | 'input'>>;
  updateVariantGroup?: Resolver<ResolversTypes['VariantGroup'], ParentType, ContextType, RequireFields<MutationUpdateVariantGroupArgs, 'id' | 'input'>>;
}>;

export type PatientResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Patient'] = ResolversParentTypes['Patient']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Patient']>, { __typename: 'Patient' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  engineRecommendations?: Resolver<ResolversTypes['EngineRecommendationResult'], { __typename: 'Patient' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType, Partial<PatientEngineRecommendationsArgs>>;

  recommendedCarePlans?: Resolver<ResolversTypes['RecommendationResult'], { __typename: 'Patient' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType, Partial<PatientRecommendedCarePlansArgs>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PersonalizationConfigResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PersonalizationConfig'] = ResolversParentTypes['PersonalizationConfig']> = ResolversObject<{
  enableDecisionPaths?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  enableOutcomeLearning?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  enableRag?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  knowledgeSources?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  learningRate?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  engineAnalytics?: Resolver<ResolversTypes['EngineAnalyticsSummary'], ParentType, ContextType, Partial<QueryEngineAnalyticsArgs>>;
  engineConfiguration?: Resolver<ResolversTypes['EngineConfiguration'], ParentType, ContextType>;
  engineExplainSession?: Resolver<Maybe<ResolversTypes['SessionExplanation']>, ParentType, ContextType, RequireFields<QueryEngineExplainSessionArgs, 'sessionId'>>;
  engineRecommend?: Resolver<ResolversTypes['EngineRecommendationResult'], ParentType, ContextType, RequireFields<QueryEngineRecommendArgs, 'input'>>;
  loadedModels?: Resolver<Array<ResolversTypes['ModelLoadStatus']>, ParentType, ContextType>;
  mlModel?: Resolver<Maybe<ResolversTypes['MLModel']>, ParentType, ContextType, RequireFields<QueryMlModelArgs, 'id'>>;
  mlModelBySlug?: Resolver<Maybe<ResolversTypes['MLModel']>, ParentType, ContextType, RequireFields<QueryMlModelBySlugArgs, 'slug'>>;
  mlModelTrainingData?: Resolver<Array<ResolversTypes['MLModelTrainingData']>, ParentType, ContextType, RequireFields<QueryMlModelTrainingDataArgs, 'modelId'>>;
  mlModelTrainingPreview?: Resolver<ResolversTypes['TrainingPreview'], ParentType, ContextType, RequireFields<QueryMlModelTrainingPreviewArgs, 'modelId'>>;
  mlModelVersions?: Resolver<Array<ResolversTypes['MLModelVersion']>, ParentType, ContextType, RequireFields<QueryMlModelVersionsArgs, 'modelId'>>;
  mlModels?: Resolver<Array<ResolversTypes['MLModel']>, ParentType, ContextType, Partial<QueryMlModelsArgs>>;
  previewFilterCriteria?: Resolver<Array<ResolversTypes['FilterPreviewResult']>, ParentType, ContextType, RequireFields<QueryPreviewFilterCriteriaArgs, 'filterCriteria'>>;
  recommendCarePlansFull?: Resolver<ResolversTypes['RecommendationResult'], ParentType, ContextType, RequireFields<QueryRecommendCarePlansFullArgs, 'input'>>;
  recommendCarePlansSimple?: Resolver<ResolversTypes['RecommendationResult'], ParentType, ContextType, RequireFields<QueryRecommendCarePlansSimpleArgs, 'input'>>;
  recommenderModelInfo?: Resolver<ResolversTypes['ModelInfo'], ParentType, ContextType>;
  recommenderStats?: Resolver<ResolversTypes['RecommenderStats'], ParentType, ContextType>;
  selectionRules?: Resolver<Array<ResolversTypes['SelectionRule']>, ParentType, ContextType, Partial<QuerySelectionRulesArgs>>;
  trainingJob?: Resolver<Maybe<ResolversTypes['TrainingJob']>, ParentType, ContextType, RequireFields<QueryTrainingJobArgs, 'id'>>;
  trainingJobs?: Resolver<Array<ResolversTypes['TrainingJob']>, ParentType, ContextType, Partial<QueryTrainingJobsArgs>>;
  variantGroup?: Resolver<Maybe<ResolversTypes['VariantGroup']>, ParentType, ContextType, RequireFields<QueryVariantGroupArgs, 'id'>>;
  variantGroups?: Resolver<Array<ResolversTypes['VariantGroup']>, ParentType, ContextType, Partial<QueryVariantGroupsArgs>>;
}>;

export type RecommendationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['RecommendationResult'] = ResolversParentTypes['RecommendationResult']> = ResolversObject<{
  drafts?: Resolver<Array<ResolversTypes['DraftCarePlan']>, ParentType, ContextType>;
  modelVersion?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  processingTimeMs?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  queryMode?: Resolver<ResolversTypes['RecommendationMode'], ParentType, ContextType>;
  templates?: Resolver<Array<ResolversTypes['TemplateRecommendation']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type RecommenderStatsResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['RecommenderStats'] = ResolversParentTypes['RecommenderStats']> = ResolversObject<{
  averageConfidence?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  embeddingsGenerated?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  lastTrainedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  modelVersion?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pendingEmbeddings?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  totalTemplates?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  totalTrainingExamples?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ScoreWeightsResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ScoreWeights'] = ResolversParentTypes['ScoreWeights']> = ResolversObject<{
  categoryMatch?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  embeddingMatch?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  exactMatch?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  prefixMatch?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SelectionRuleResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SelectionRule'] = ResolversParentTypes['SelectionRule']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  priority?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  ruleDefinition?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  variantGroupId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SessionExplanationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SessionExplanation'] = ResolversParentTypes['SessionExplanation']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  finalRecommendations?: Resolver<Array<ResolversTypes['EngineRecommendation']>, ParentType, ContextType>;
  layers?: Resolver<Array<ResolversTypes['LayerDetail']>, ParentType, ContextType>;
  patientContext?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  sessionId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type TemplateRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['TemplateRecommendation'] = ResolversParentTypes['TemplateRecommendation']> = ResolversObject<{
  category?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  matchFactors?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  rankingScore?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  similarityScore?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  templateId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type TrainingJobResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['TrainingJob'] = ResolversParentTypes['TrainingJob']> = ResolversObject<{
  completedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  jobName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  metrics?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  modelPath?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  modelType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  modelVersion?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  progressPercent?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  startedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['TrainingJobStatus'], ParentType, ContextType>;
  statusMessage?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  trainingExamplesCount?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type TrainingPreviewResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['TrainingPreview'] = ResolversParentTypes['TrainingPreview']> = ResolversObject<{
  byAssignmentType?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  modelId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  modelName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  totalExamples?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  withEmbeddings?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type VariantResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Variant'] = ResolversParentTypes['Variant']> = ResolversObject<{
  carePlanId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  exclusionConditions?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isDefault?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  priorityScore?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  targetAgeMax?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  targetAgeMin?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  targetConditions?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  targetRiskFactors?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  targetSex?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  variantGroupId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  variantName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type VariantGroupResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['VariantGroup'] = ResolversParentTypes['VariantGroup']> = ResolversObject<{
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  variants?: Resolver<Array<ResolversTypes['Variant']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type Resolvers<ContextType = DataSourceContext> = ResolversObject<{
  DateTime?: GraphQLScalarType;
  DraftCarePlan?: DraftCarePlanResolvers<ContextType>;
  DraftGoal?: DraftGoalResolvers<ContextType>;
  DraftIntervention?: DraftInterventionResolvers<ContextType>;
  EmbeddingGenerationResult?: EmbeddingGenerationResultResolvers<ContextType>;
  EngineAnalyticsSummary?: EngineAnalyticsSummaryResolvers<ContextType>;
  EngineConfiguration?: EngineConfigurationResolvers<ContextType>;
  EngineRecommendation?: EngineRecommendationResolvers<ContextType>;
  EngineRecommendationResult?: EngineRecommendationResultResolvers<ContextType>;
  FilterPreviewResult?: FilterPreviewResultResolvers<ContextType>;
  JSON?: GraphQLScalarType;
  LayerDetail?: LayerDetailResolvers<ContextType>;
  LayerSummary?: LayerSummaryResolvers<ContextType>;
  MLModel?: MlModelResolvers<ContextType>;
  MLModelFilterCriteria?: MlModelFilterCriteriaResolvers<ContextType>;
  MLModelTrainingData?: MlModelTrainingDataResolvers<ContextType>;
  MLModelVersion?: MlModelVersionResolvers<ContextType>;
  MatchReason?: MatchReasonResolvers<ContextType>;
  MatchingConfig?: MatchingConfigResolvers<ContextType>;
  ModelInfo?: ModelInfoResolvers<ContextType>;
  ModelLoadStatus?: ModelLoadStatusResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Patient?: PatientResolvers<ContextType>;
  PersonalizationConfig?: PersonalizationConfigResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  RecommendationResult?: RecommendationResultResolvers<ContextType>;
  RecommenderStats?: RecommenderStatsResolvers<ContextType>;
  ScoreWeights?: ScoreWeightsResolvers<ContextType>;
  SelectionRule?: SelectionRuleResolvers<ContextType>;
  SessionExplanation?: SessionExplanationResolvers<ContextType>;
  TemplateRecommendation?: TemplateRecommendationResolvers<ContextType>;
  TrainingJob?: TrainingJobResolvers<ContextType>;
  TrainingPreview?: TrainingPreviewResolvers<ContextType>;
  Variant?: VariantResolvers<ContextType>;
  VariantGroup?: VariantGroupResolvers<ContextType>;
}>;

