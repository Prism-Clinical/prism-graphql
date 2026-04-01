import { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import { DataSourceContext } from '../types/index';
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
  JSON: { input: any; output: any; }
  _FieldSet: { input: any; output: any; }
};

export type AdditionalContextInput = {
  allergies?: InputMaybe<Array<CodeInput>>;
  conditionCodes?: InputMaybe<Array<CodeInput>>;
  freeformData?: InputMaybe<Scalars['JSON']['input']>;
  labResults?: InputMaybe<Array<LabResultInput>>;
  medications?: InputMaybe<Array<CodeInput>>;
  vitalSigns?: InputMaybe<Scalars['JSON']['input']>;
};

export enum AnswerType {
  Boolean = 'BOOLEAN',
  Numeric = 'NUMERIC',
  Select = 'SELECT'
}

export enum BlockerType {
  Contradiction = 'CONTRADICTION',
  EmptyPlan = 'EMPTY_PLAN',
  PendingGate = 'PENDING_GATE',
  UnresolvedRedFlag = 'UNRESOLVED_RED_FLAG'
}

export type CarePlanGenerationResult = {
  __typename?: 'CarePlanGenerationResult';
  blockers: Array<ValidationBlockerType>;
  carePlanId?: Maybe<Scalars['ID']['output']>;
  success: Scalars['Boolean']['output'];
  warnings: Array<Scalars['String']['output']>;
};

export type CodeInput = {
  code: Scalars['String']['input'];
  display?: InputMaybe<Scalars['String']['input']>;
  system: Scalars['String']['input'];
};

export type CreateSignalDefinitionInput = {
  defaultWeight: Scalars['Float']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  displayName: Scalars['String']['input'];
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  propagationConfig?: InputMaybe<PropagationConfigInput>;
  scope: SignalScope;
  scoringRules: Scalars['JSON']['input'];
  scoringType: ScoringType;
};

export type DiffDetail = {
  __typename?: 'DiffDetail';
  action: Scalars['String']['output'];
  entityId: Scalars['String']['output'];
  entityLabel: Scalars['String']['output'];
  entityType: Scalars['String']['output'];
};

export type GateAnswerInput = {
  booleanValue?: InputMaybe<Scalars['Boolean']['input']>;
  numericValue?: InputMaybe<Scalars['Float']['input']>;
  selectedOption?: InputMaybe<Scalars['String']['input']>;
};

export type ImportDiff = {
  __typename?: 'ImportDiff';
  details: Array<DiffDetail>;
  summary: ImportDiffSummary;
  /** True when the diff is a placeholder (creation summary or graph reconstruction unavailable). */
  synthetic: Scalars['Boolean']['output'];
};

export type ImportDiffSummary = {
  __typename?: 'ImportDiffSummary';
  edgesAdded: Scalars['Int']['output'];
  edgesModified: Scalars['Int']['output'];
  edgesRemoved: Scalars['Int']['output'];
  nodesAdded: Scalars['Int']['output'];
  nodesModified: Scalars['Int']['output'];
  nodesRemoved: Scalars['Int']['output'];
};

export enum ImportMode {
  DraftUpdate = 'DRAFT_UPDATE',
  NewPathway = 'NEW_PATHWAY',
  NewVersion = 'NEW_VERSION'
}

export type ImportPathwayResult = {
  __typename?: 'ImportPathwayResult';
  diff?: Maybe<ImportDiff>;
  importType: ImportMode;
  pathway?: Maybe<Pathway>;
  validation: ValidationResult;
};

export type LabResultInput = {
  code: Scalars['String']['input'];
  date?: InputMaybe<Scalars['String']['input']>;
  display?: InputMaybe<Scalars['String']['input']>;
  system: Scalars['String']['input'];
  unit?: InputMaybe<Scalars['String']['input']>;
  value?: InputMaybe<Scalars['Float']['input']>;
};

export type MatchedPathway = {
  __typename?: 'MatchedPathway';
  matchScore: Scalars['Float']['output'];
  matchedConditionCodes: Array<Scalars['String']['output']>;
  pathway: Pathway;
};

export type Mutation = {
  __typename?: 'Mutation';
  abandonSession: ResolutionSession;
  /** Activate a DRAFT pathway, making it available for patient matching. */
  activatePathway: PathwayStatusResult;
  addPatientContext: ResolutionSession;
  answerGateQuestion: ResolutionSession;
  /** Archive an ACTIVE pathway, removing it from patient matching. */
  archivePathway: PathwayStatusResult;
  createSignalDefinition: SignalDefinitionType;
  deleteSignalDefinition: Scalars['Boolean']['output'];
  generateCarePlanFromResolution: CarePlanGenerationResult;
  /**
   * Import a clinical pathway from JSON. Supports three modes:
   * - NEW_PATHWAY: First import of a new pathway
   * - DRAFT_UPDATE: Re-import of an existing DRAFT pathway (applies diff)
   * - NEW_VERSION: Create a new version of an existing pathway
   *
   * pathwayJson is a JSON string conforming to the PathwayJson schema (see
   * apps/pathway-service/src/services/import/types.ts). It includes schema_version,
   * pathway metadata, nodes array, and edges array. The pipeline validates the
   * full structure and returns all errors at once.
   */
  importPathway: ImportPathwayResult;
  overrideNode: ResolutionSession;
  /** Reactivate a SUPERSEDED or ARCHIVED pathway. */
  reactivatePathway: PathwayStatusResult;
  removeNodeWeight: Scalars['Boolean']['output'];
  removeResolutionThresholds: Scalars['Boolean']['output'];
  removeSignalWeight: Scalars['Boolean']['output'];
  setNodeWeight: NodeWeight;
  setResolutionThresholds: ResolutionThresholds;
  setSignalWeight: SignalWeight;
  startResolution: ResolutionSession;
  updateSignalDefinition: SignalDefinitionType;
};


export type MutationAbandonSessionArgs = {
  reason?: InputMaybe<Scalars['String']['input']>;
  sessionId: Scalars['ID']['input'];
};


export type MutationActivatePathwayArgs = {
  id: Scalars['ID']['input'];
};


export type MutationAddPatientContextArgs = {
  additionalContext: AdditionalContextInput;
  sessionId: Scalars['ID']['input'];
};


export type MutationAnswerGateQuestionArgs = {
  answer: GateAnswerInput;
  gateId: Scalars['ID']['input'];
  sessionId: Scalars['ID']['input'];
};


export type MutationArchivePathwayArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCreateSignalDefinitionArgs = {
  input: CreateSignalDefinitionInput;
};


export type MutationDeleteSignalDefinitionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationGenerateCarePlanFromResolutionArgs = {
  sessionId: Scalars['ID']['input'];
};


export type MutationImportPathwayArgs = {
  importMode: ImportMode;
  pathwayJson: Scalars['String']['input'];
};


export type MutationOverrideNodeArgs = {
  action: OverrideAction;
  nodeId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
  sessionId: Scalars['ID']['input'];
};


export type MutationReactivatePathwayArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveNodeWeightArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveResolutionThresholdsArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveSignalWeightArgs = {
  id: Scalars['ID']['input'];
};


export type MutationSetNodeWeightArgs = {
  input: SetNodeWeightInput;
};


export type MutationSetResolutionThresholdsArgs = {
  input: SetResolutionThresholdsInput;
};


export type MutationSetSignalWeightArgs = {
  input: SetSignalWeightInput;
};


export type MutationStartResolutionArgs = {
  pathwayId: Scalars['ID']['input'];
  patientContext?: InputMaybe<PatientContextInput>;
  patientId: Scalars['ID']['input'];
};


export type MutationUpdateSignalDefinitionArgs = {
  id: Scalars['ID']['input'];
  input: UpdateSignalDefinitionInput;
};

export type NodeConfidenceResult = {
  __typename?: 'NodeConfidenceResult';
  breakdown: Array<SignalBreakdown>;
  confidence: Scalars['Float']['output'];
  nodeIdentifier: Scalars['String']['output'];
  nodeType: Scalars['String']['output'];
  propagationInfluences: Array<PropagationInfluence>;
  resolutionType?: Maybe<ResolutionType>;
};

export enum NodeStatus {
  CascadeLimit = 'CASCADE_LIMIT',
  Excluded = 'EXCLUDED',
  GatedOut = 'GATED_OUT',
  Included = 'INCLUDED',
  PendingQuestion = 'PENDING_QUESTION',
  Timeout = 'TIMEOUT',
  Unknown = 'UNKNOWN'
}

export type NodeWeight = {
  __typename?: 'NodeWeight';
  defaultWeight: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  institutionId?: Maybe<Scalars['ID']['output']>;
  nodeIdentifier: Scalars['String']['output'];
  nodeType: Scalars['String']['output'];
  pathwayId: Scalars['ID']['output'];
  propagationOverrides?: Maybe<Scalars['JSON']['output']>;
  weightOverride?: Maybe<Scalars['Float']['output']>;
};

export enum OverrideAction {
  Exclude = 'EXCLUDE',
  Include = 'INCLUDE'
}

export type Pathway = {
  __typename?: 'Pathway';
  category: PathwayCategory;
  conditionCodes: Array<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  logicalId: Scalars['String']['output'];
  scope?: Maybe<Scalars['String']['output']>;
  status: PathwayStatus;
  targetPopulation?: Maybe<Scalars['String']['output']>;
  title: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  version: Scalars['String']['output'];
};

export enum PathwayCategory {
  AcuteCare = 'ACUTE_CARE',
  ChronicDisease = 'CHRONIC_DISEASE',
  Geriatric = 'GERIATRIC',
  LifestyleModification = 'LIFESTYLE_MODIFICATION',
  MedicationManagement = 'MEDICATION_MANAGEMENT',
  MentalHealth = 'MENTAL_HEALTH',
  Obstetric = 'OBSTETRIC',
  Pediatric = 'PEDIATRIC',
  PostProcedure = 'POST_PROCEDURE',
  PreventiveCare = 'PREVENTIVE_CARE'
}

export type PathwayConditionCode = {
  __typename?: 'PathwayConditionCode';
  code: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  grouping?: Maybe<Scalars['String']['output']>;
  system: Scalars['String']['output'];
  usage?: Maybe<Scalars['String']['output']>;
};

export type PathwayConfidenceResult = {
  __typename?: 'PathwayConfidenceResult';
  nodes: Array<NodeConfidenceResult>;
  overallConfidence: Scalars['Float']['output'];
  pathwayId: Scalars['ID']['output'];
};

export type PathwayGraph = {
  __typename?: 'PathwayGraph';
  conditionCodeDetails: Array<PathwayConditionCode>;
  edges: Array<PathwayGraphEdge>;
  nodes: Array<PathwayGraphNode>;
  pathway: Pathway;
};

export type PathwayGraphEdge = {
  __typename?: 'PathwayGraphEdge';
  from: Scalars['String']['output'];
  properties?: Maybe<Scalars['JSON']['output']>;
  to: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type PathwayGraphNode = {
  __typename?: 'PathwayGraphNode';
  id: Scalars['String']['output'];
  properties: Scalars['JSON']['output'];
  type: Scalars['String']['output'];
};

export enum PathwayStatus {
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
  Draft = 'DRAFT',
  Superseded = 'SUPERSEDED'
}

export type PathwayStatusResult = {
  __typename?: 'PathwayStatusResult';
  pathway: Pathway;
  previousStatus: PathwayStatus;
};

export type PatientContextInput = {
  allergies?: InputMaybe<Array<CodeInput>>;
  conditionCodes?: InputMaybe<Array<CodeInput>>;
  labResults?: InputMaybe<Array<LabResultInput>>;
  medications?: InputMaybe<Array<CodeInput>>;
  patientId: Scalars['ID']['input'];
  vitalSigns?: InputMaybe<Scalars['JSON']['input']>;
};

export type PendingQuestionType = {
  __typename?: 'PendingQuestionType';
  affectedSubtreeSize: Scalars['Int']['output'];
  answerType: AnswerType;
  estimatedImpact: Scalars['String']['output'];
  gateId: Scalars['ID']['output'];
  options?: Maybe<Array<Scalars['String']['output']>>;
  prompt: Scalars['String']['output'];
};

export type PropagationConfigInput = {
  decayFactor?: InputMaybe<Scalars['Float']['input']>;
  edgeTypes?: InputMaybe<Array<Scalars['String']['input']>>;
  immuneToSignals?: InputMaybe<Array<Scalars['String']['input']>>;
  maxHops?: InputMaybe<Scalars['Int']['input']>;
  mode: PropagationMode;
  sourceNodeTypes?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type PropagationConfigType = {
  __typename?: 'PropagationConfigType';
  decayFactor?: Maybe<Scalars['Float']['output']>;
  edgeTypes?: Maybe<Array<Scalars['String']['output']>>;
  immuneToSignals?: Maybe<Array<Scalars['String']['output']>>;
  maxHops?: Maybe<Scalars['Int']['output']>;
  mode: PropagationMode;
  sourceNodeTypes?: Maybe<Array<Scalars['String']['output']>>;
};

export type PropagationInfluence = {
  __typename?: 'PropagationInfluence';
  hopDistance: Scalars['Int']['output'];
  originalScore: Scalars['Float']['output'];
  propagatedScore: Scalars['Float']['output'];
  signalName: Scalars['String']['output'];
  sourceNodeIdentifier: Scalars['String']['output'];
};

export enum PropagationMode {
  Direct = 'DIRECT',
  None = 'NONE',
  TransitiveWithDecay = 'TRANSITIVE_WITH_DECAY'
}

export type ProviderOverrideType = {
  __typename?: 'ProviderOverrideType';
  action: OverrideAction;
  originalConfidence: Scalars['Float']['output'];
  originalStatus: NodeStatus;
  reason?: Maybe<Scalars['String']['output']>;
};

export type Query = {
  __typename?: 'Query';
  effectiveThresholds: ResolvedThresholds;
  effectiveWeights: WeightMatrix;
  matchedPathways: Array<MatchedPathway>;
  pathway?: Maybe<Pathway>;
  pathwayConfidence: PathwayConfidenceResult;
  pathwayGraph?: Maybe<PathwayGraph>;
  pathwayServiceHealth: Scalars['Boolean']['output'];
  pathways: Array<Pathway>;
  patientResolutionSessions: Array<ResolutionSessionSummary>;
  pendingQuestions: Array<PendingQuestionType>;
  redFlags: Array<RedFlagType>;
  resolutionSession?: Maybe<ResolutionSession>;
  signalDefinitions: Array<SignalDefinitionType>;
};


export type QueryEffectiveThresholdsArgs = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  nodeIdentifier?: InputMaybe<Scalars['String']['input']>;
  organizationId?: InputMaybe<Scalars['ID']['input']>;
  pathwayId: Scalars['ID']['input'];
};


export type QueryEffectiveWeightsArgs = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  organizationId?: InputMaybe<Scalars['ID']['input']>;
  pathwayId: Scalars['ID']['input'];
};


export type QueryMatchedPathwaysArgs = {
  patientId: Scalars['ID']['input'];
};


export type QueryPathwayArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPathwayConfidenceArgs = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  organizationId?: InputMaybe<Scalars['ID']['input']>;
  pathwayId: Scalars['ID']['input'];
  patientContext: PatientContextInput;
};


export type QueryPathwayGraphArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPathwaysArgs = {
  category?: InputMaybe<PathwayCategory>;
  first?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<PathwayStatus>;
};


export type QueryPatientResolutionSessionsArgs = {
  patientId: Scalars['ID']['input'];
  status?: InputMaybe<SessionStatus>;
};


export type QueryPendingQuestionsArgs = {
  sessionId: Scalars['ID']['input'];
};


export type QueryRedFlagsArgs = {
  sessionId: Scalars['ID']['input'];
};


export type QueryResolutionSessionArgs = {
  sessionId: Scalars['ID']['input'];
};


export type QuerySignalDefinitionsArgs = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  scope?: InputMaybe<SignalScope>;
};

export type RedFlagBranchType = {
  __typename?: 'RedFlagBranchType';
  confidence: Scalars['Float']['output'];
  nodeId: Scalars['ID']['output'];
  title: Scalars['String']['output'];
  topExcludeReason?: Maybe<Scalars['String']['output']>;
};

export type RedFlagType = {
  __typename?: 'RedFlagType';
  branches?: Maybe<Array<RedFlagBranchType>>;
  description: Scalars['String']['output'];
  nodeId: Scalars['ID']['output'];
  nodeTitle: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type ResolutionEventType = {
  __typename?: 'ResolutionEventType';
  createdAt: Scalars['String']['output'];
  eventType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  nodesRecomputed: Scalars['Int']['output'];
  statusChanges?: Maybe<Scalars['JSON']['output']>;
  triggerData?: Maybe<Scalars['JSON']['output']>;
};

export type ResolutionSession = {
  __typename?: 'ResolutionSession';
  createdAt: Scalars['String']['output'];
  excludedNodes: Array<ResolvedNode>;
  gatedOutNodes: Array<ResolvedNode>;
  id: Scalars['ID']['output'];
  includedNodes: Array<ResolvedNode>;
  pathwayId: Scalars['ID']['output'];
  pathwayVersion: Scalars['String']['output'];
  patientId: Scalars['ID']['output'];
  pendingQuestions: Array<PendingQuestionType>;
  providerId: Scalars['ID']['output'];
  redFlags: Array<RedFlagType>;
  resolutionEvents: Array<ResolutionEventType>;
  status: SessionStatus;
  totalNodesEvaluated: Scalars['Int']['output'];
  traversalDurationMs: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
};

export type ResolutionSessionSummary = {
  __typename?: 'ResolutionSessionSummary';
  carePlanId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  includedCount: Scalars['Int']['output'];
  pathwayId: Scalars['ID']['output'];
  pathwayTitle: Scalars['String']['output'];
  redFlagCount: Scalars['Int']['output'];
  status: SessionStatus;
  totalNodesEvaluated: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
};

export type ResolutionThresholds = {
  __typename?: 'ResolutionThresholds';
  autoResolveThreshold: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  institutionId?: Maybe<Scalars['ID']['output']>;
  nodeIdentifier?: Maybe<Scalars['String']['output']>;
  pathwayId?: Maybe<Scalars['ID']['output']>;
  scope: ThresholdScope;
  suggestThreshold: Scalars['Float']['output'];
};

export enum ResolutionType {
  AutoResolved = 'AUTO_RESOLVED',
  ForcedManual = 'FORCED_MANUAL',
  ProviderDecided = 'PROVIDER_DECIDED',
  SystemSuggested = 'SYSTEM_SUGGESTED'
}

export type ResolvedNode = {
  __typename?: 'ResolvedNode';
  confidence: Scalars['Float']['output'];
  confidenceBreakdown: Array<SignalBreakdown>;
  depth: Scalars['Int']['output'];
  excludeReason?: Maybe<Scalars['String']['output']>;
  nodeId: Scalars['ID']['output'];
  nodeType: Scalars['String']['output'];
  parentNodeId?: Maybe<Scalars['ID']['output']>;
  providerOverride?: Maybe<ProviderOverrideType>;
  status: NodeStatus;
  title: Scalars['String']['output'];
};

export type ResolvedThresholds = {
  __typename?: 'ResolvedThresholds';
  autoResolveThreshold: Scalars['Float']['output'];
  scope: ThresholdScope;
  suggestThreshold: Scalars['Float']['output'];
};

export enum ScoringType {
  CriteriaMatch = 'CRITERIA_MATCH',
  CustomRules = 'CUSTOM_RULES',
  DataPresence = 'DATA_PRESENCE',
  MappingLookup = 'MAPPING_LOOKUP',
  RiskInverse = 'RISK_INVERSE'
}

export enum SessionStatus {
  Abandoned = 'ABANDONED',
  Active = 'ACTIVE',
  Completed = 'COMPLETED',
  Degraded = 'DEGRADED'
}

export type SetNodeWeightInput = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  nodeIdentifier: Scalars['String']['input'];
  nodeType: Scalars['String']['input'];
  pathwayId: Scalars['ID']['input'];
  propagationOverrides?: InputMaybe<Scalars['JSON']['input']>;
  weightOverride?: InputMaybe<Scalars['Float']['input']>;
};

export type SetResolutionThresholdsInput = {
  autoResolveThreshold: Scalars['Float']['input'];
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  nodeIdentifier?: InputMaybe<Scalars['String']['input']>;
  pathwayId?: InputMaybe<Scalars['ID']['input']>;
  scope: ThresholdScope;
  suggestThreshold: Scalars['Float']['input'];
};

export type SetSignalWeightInput = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  nodeIdentifier?: InputMaybe<Scalars['String']['input']>;
  nodeType?: InputMaybe<Scalars['String']['input']>;
  pathwayId?: InputMaybe<Scalars['ID']['input']>;
  scope: WeightScope;
  signalDefinitionId: Scalars['ID']['input'];
  weight: Scalars['Float']['input'];
};

export type SignalBreakdown = {
  __typename?: 'SignalBreakdown';
  missingInputs: Array<Scalars['String']['output']>;
  score: Scalars['Float']['output'];
  signalName: Scalars['String']['output'];
  weight: Scalars['Float']['output'];
  weightSource: WeightSource;
};

export type SignalDefinitionType = {
  __typename?: 'SignalDefinitionType';
  defaultWeight: Scalars['Float']['output'];
  description?: Maybe<Scalars['String']['output']>;
  displayName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  institutionId?: Maybe<Scalars['ID']['output']>;
  isActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  propagationConfig?: Maybe<PropagationConfigType>;
  scope: SignalScope;
  scoringRules: Scalars['JSON']['output'];
  scoringType: ScoringType;
};

export enum SignalScope {
  Institution = 'INSTITUTION',
  Organization = 'ORGANIZATION',
  System = 'SYSTEM'
}

export type SignalWeight = {
  __typename?: 'SignalWeight';
  id: Scalars['ID']['output'];
  institutionId?: Maybe<Scalars['ID']['output']>;
  nodeIdentifier?: Maybe<Scalars['String']['output']>;
  nodeType?: Maybe<Scalars['String']['output']>;
  pathwayId?: Maybe<Scalars['ID']['output']>;
  scope: WeightScope;
  signalDefinitionId: Scalars['ID']['output'];
  weight: Scalars['Float']['output'];
};

export enum ThresholdScope {
  Institution = 'INSTITUTION',
  Node = 'NODE',
  Organization = 'ORGANIZATION',
  Pathway = 'PATHWAY',
  SystemDefault = 'SYSTEM_DEFAULT'
}

export type UpdateSignalDefinitionInput = {
  defaultWeight?: InputMaybe<Scalars['Float']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  displayName?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  propagationConfig?: InputMaybe<PropagationConfigInput>;
  scoringRules?: InputMaybe<Scalars['JSON']['input']>;
};

export type ValidationBlockerType = {
  __typename?: 'ValidationBlockerType';
  description: Scalars['String']['output'];
  relatedNodeIds: Array<Scalars['ID']['output']>;
  type: BlockerType;
};

export type ValidationResult = {
  __typename?: 'ValidationResult';
  errors: Array<Scalars['String']['output']>;
  valid: Scalars['Boolean']['output'];
  warnings: Array<Scalars['String']['output']>;
};

export type WeightMatrix = {
  __typename?: 'WeightMatrix';
  entries: Array<WeightMatrixEntry>;
};

export type WeightMatrixEntry = {
  __typename?: 'WeightMatrixEntry';
  nodeIdentifier: Scalars['String']['output'];
  signalName: Scalars['String']['output'];
  source: WeightSource;
  weight: Scalars['Float']['output'];
};

export enum WeightScope {
  InstitutionGlobal = 'INSTITUTION_GLOBAL',
  Node = 'NODE',
  OrganizationGlobal = 'ORGANIZATION_GLOBAL',
  Pathway = 'PATHWAY'
}

export enum WeightSource {
  InstitutionGlobal = 'INSTITUTION_GLOBAL',
  NodeOverride = 'NODE_OVERRIDE',
  OrganizationGlobal = 'ORGANIZATION_GLOBAL',
  PathwayOverride = 'PATHWAY_OVERRIDE',
  SystemDefault = 'SYSTEM_DEFAULT'
}

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
  AdditionalContextInput: AdditionalContextInput;
  AnswerType: AnswerType;
  BlockerType: BlockerType;
  CarePlanGenerationResult: ResolverTypeWrapper<CarePlanGenerationResult>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  CodeInput: CodeInput;
  CreateSignalDefinitionInput: CreateSignalDefinitionInput;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  DiffDetail: ResolverTypeWrapper<DiffDetail>;
  GateAnswerInput: GateAnswerInput;
  ImportDiff: ResolverTypeWrapper<ImportDiff>;
  ImportDiffSummary: ResolverTypeWrapper<ImportDiffSummary>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  ImportMode: ImportMode;
  ImportPathwayResult: ResolverTypeWrapper<ImportPathwayResult>;
  JSON: ResolverTypeWrapper<Scalars['JSON']['output']>;
  LabResultInput: LabResultInput;
  MatchedPathway: ResolverTypeWrapper<MatchedPathway>;
  Mutation: ResolverTypeWrapper<{}>;
  NodeConfidenceResult: ResolverTypeWrapper<NodeConfidenceResult>;
  NodeStatus: NodeStatus;
  NodeWeight: ResolverTypeWrapper<NodeWeight>;
  OverrideAction: OverrideAction;
  Pathway: ResolverTypeWrapper<Pathway>;
  PathwayCategory: PathwayCategory;
  PathwayConditionCode: ResolverTypeWrapper<PathwayConditionCode>;
  PathwayConfidenceResult: ResolverTypeWrapper<PathwayConfidenceResult>;
  PathwayGraph: ResolverTypeWrapper<PathwayGraph>;
  PathwayGraphEdge: ResolverTypeWrapper<PathwayGraphEdge>;
  PathwayGraphNode: ResolverTypeWrapper<PathwayGraphNode>;
  PathwayStatus: PathwayStatus;
  PathwayStatusResult: ResolverTypeWrapper<PathwayStatusResult>;
  PatientContextInput: PatientContextInput;
  PendingQuestionType: ResolverTypeWrapper<PendingQuestionType>;
  PropagationConfigInput: PropagationConfigInput;
  PropagationConfigType: ResolverTypeWrapper<PropagationConfigType>;
  PropagationInfluence: ResolverTypeWrapper<PropagationInfluence>;
  PropagationMode: PropagationMode;
  ProviderOverrideType: ResolverTypeWrapper<ProviderOverrideType>;
  Query: ResolverTypeWrapper<{}>;
  RedFlagBranchType: ResolverTypeWrapper<RedFlagBranchType>;
  RedFlagType: ResolverTypeWrapper<RedFlagType>;
  ResolutionEventType: ResolverTypeWrapper<ResolutionEventType>;
  ResolutionSession: ResolverTypeWrapper<ResolutionSession>;
  ResolutionSessionSummary: ResolverTypeWrapper<ResolutionSessionSummary>;
  ResolutionThresholds: ResolverTypeWrapper<ResolutionThresholds>;
  ResolutionType: ResolutionType;
  ResolvedNode: ResolverTypeWrapper<ResolvedNode>;
  ResolvedThresholds: ResolverTypeWrapper<ResolvedThresholds>;
  ScoringType: ScoringType;
  SessionStatus: SessionStatus;
  SetNodeWeightInput: SetNodeWeightInput;
  SetResolutionThresholdsInput: SetResolutionThresholdsInput;
  SetSignalWeightInput: SetSignalWeightInput;
  SignalBreakdown: ResolverTypeWrapper<SignalBreakdown>;
  SignalDefinitionType: ResolverTypeWrapper<SignalDefinitionType>;
  SignalScope: SignalScope;
  SignalWeight: ResolverTypeWrapper<SignalWeight>;
  ThresholdScope: ThresholdScope;
  UpdateSignalDefinitionInput: UpdateSignalDefinitionInput;
  ValidationBlockerType: ResolverTypeWrapper<ValidationBlockerType>;
  ValidationResult: ResolverTypeWrapper<ValidationResult>;
  WeightMatrix: ResolverTypeWrapper<WeightMatrix>;
  WeightMatrixEntry: ResolverTypeWrapper<WeightMatrixEntry>;
  WeightScope: WeightScope;
  WeightSource: WeightSource;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  AdditionalContextInput: AdditionalContextInput;
  CarePlanGenerationResult: CarePlanGenerationResult;
  ID: Scalars['ID']['output'];
  Boolean: Scalars['Boolean']['output'];
  String: Scalars['String']['output'];
  CodeInput: CodeInput;
  CreateSignalDefinitionInput: CreateSignalDefinitionInput;
  Float: Scalars['Float']['output'];
  DiffDetail: DiffDetail;
  GateAnswerInput: GateAnswerInput;
  ImportDiff: ImportDiff;
  ImportDiffSummary: ImportDiffSummary;
  Int: Scalars['Int']['output'];
  ImportPathwayResult: ImportPathwayResult;
  JSON: Scalars['JSON']['output'];
  LabResultInput: LabResultInput;
  MatchedPathway: MatchedPathway;
  Mutation: {};
  NodeConfidenceResult: NodeConfidenceResult;
  NodeWeight: NodeWeight;
  Pathway: Pathway;
  PathwayConditionCode: PathwayConditionCode;
  PathwayConfidenceResult: PathwayConfidenceResult;
  PathwayGraph: PathwayGraph;
  PathwayGraphEdge: PathwayGraphEdge;
  PathwayGraphNode: PathwayGraphNode;
  PathwayStatusResult: PathwayStatusResult;
  PatientContextInput: PatientContextInput;
  PendingQuestionType: PendingQuestionType;
  PropagationConfigInput: PropagationConfigInput;
  PropagationConfigType: PropagationConfigType;
  PropagationInfluence: PropagationInfluence;
  ProviderOverrideType: ProviderOverrideType;
  Query: {};
  RedFlagBranchType: RedFlagBranchType;
  RedFlagType: RedFlagType;
  ResolutionEventType: ResolutionEventType;
  ResolutionSession: ResolutionSession;
  ResolutionSessionSummary: ResolutionSessionSummary;
  ResolutionThresholds: ResolutionThresholds;
  ResolvedNode: ResolvedNode;
  ResolvedThresholds: ResolvedThresholds;
  SetNodeWeightInput: SetNodeWeightInput;
  SetResolutionThresholdsInput: SetResolutionThresholdsInput;
  SetSignalWeightInput: SetSignalWeightInput;
  SignalBreakdown: SignalBreakdown;
  SignalDefinitionType: SignalDefinitionType;
  SignalWeight: SignalWeight;
  UpdateSignalDefinitionInput: UpdateSignalDefinitionInput;
  ValidationBlockerType: ValidationBlockerType;
  ValidationResult: ValidationResult;
  WeightMatrix: WeightMatrix;
  WeightMatrixEntry: WeightMatrixEntry;
}>;

export type CarePlanGenerationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanGenerationResult'] = ResolversParentTypes['CarePlanGenerationResult']> = ResolversObject<{
  blockers?: Resolver<Array<ResolversTypes['ValidationBlockerType']>, ParentType, ContextType>;
  carePlanId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  warnings?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DiffDetailResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DiffDetail'] = ResolversParentTypes['DiffDetail']> = ResolversObject<{
  action?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  entityId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  entityLabel?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  entityType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ImportDiffResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ImportDiff'] = ResolversParentTypes['ImportDiff']> = ResolversObject<{
  details?: Resolver<Array<ResolversTypes['DiffDetail']>, ParentType, ContextType>;
  summary?: Resolver<ResolversTypes['ImportDiffSummary'], ParentType, ContextType>;
  synthetic?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ImportDiffSummaryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ImportDiffSummary'] = ResolversParentTypes['ImportDiffSummary']> = ResolversObject<{
  edgesAdded?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  edgesModified?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  edgesRemoved?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  nodesAdded?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  nodesModified?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  nodesRemoved?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ImportPathwayResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ImportPathwayResult'] = ResolversParentTypes['ImportPathwayResult']> = ResolversObject<{
  diff?: Resolver<Maybe<ResolversTypes['ImportDiff']>, ParentType, ContextType>;
  importType?: Resolver<ResolversTypes['ImportMode'], ParentType, ContextType>;
  pathway?: Resolver<Maybe<ResolversTypes['Pathway']>, ParentType, ContextType>;
  validation?: Resolver<ResolversTypes['ValidationResult'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export interface JsonScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['JSON'], any> {
  name: 'JSON';
}

export type MatchedPathwayResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MatchedPathway'] = ResolversParentTypes['MatchedPathway']> = ResolversObject<{
  matchScore?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  matchedConditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  pathway?: Resolver<ResolversTypes['Pathway'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  abandonSession?: Resolver<ResolversTypes['ResolutionSession'], ParentType, ContextType, RequireFields<MutationAbandonSessionArgs, 'sessionId'>>;
  activatePathway?: Resolver<ResolversTypes['PathwayStatusResult'], ParentType, ContextType, RequireFields<MutationActivatePathwayArgs, 'id'>>;
  addPatientContext?: Resolver<ResolversTypes['ResolutionSession'], ParentType, ContextType, RequireFields<MutationAddPatientContextArgs, 'additionalContext' | 'sessionId'>>;
  answerGateQuestion?: Resolver<ResolversTypes['ResolutionSession'], ParentType, ContextType, RequireFields<MutationAnswerGateQuestionArgs, 'answer' | 'gateId' | 'sessionId'>>;
  archivePathway?: Resolver<ResolversTypes['PathwayStatusResult'], ParentType, ContextType, RequireFields<MutationArchivePathwayArgs, 'id'>>;
  createSignalDefinition?: Resolver<ResolversTypes['SignalDefinitionType'], ParentType, ContextType, RequireFields<MutationCreateSignalDefinitionArgs, 'input'>>;
  deleteSignalDefinition?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteSignalDefinitionArgs, 'id'>>;
  generateCarePlanFromResolution?: Resolver<ResolversTypes['CarePlanGenerationResult'], ParentType, ContextType, RequireFields<MutationGenerateCarePlanFromResolutionArgs, 'sessionId'>>;
  importPathway?: Resolver<ResolversTypes['ImportPathwayResult'], ParentType, ContextType, RequireFields<MutationImportPathwayArgs, 'importMode' | 'pathwayJson'>>;
  overrideNode?: Resolver<ResolversTypes['ResolutionSession'], ParentType, ContextType, RequireFields<MutationOverrideNodeArgs, 'action' | 'nodeId' | 'sessionId'>>;
  reactivatePathway?: Resolver<ResolversTypes['PathwayStatusResult'], ParentType, ContextType, RequireFields<MutationReactivatePathwayArgs, 'id'>>;
  removeNodeWeight?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRemoveNodeWeightArgs, 'id'>>;
  removeResolutionThresholds?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRemoveResolutionThresholdsArgs, 'id'>>;
  removeSignalWeight?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRemoveSignalWeightArgs, 'id'>>;
  setNodeWeight?: Resolver<ResolversTypes['NodeWeight'], ParentType, ContextType, RequireFields<MutationSetNodeWeightArgs, 'input'>>;
  setResolutionThresholds?: Resolver<ResolversTypes['ResolutionThresholds'], ParentType, ContextType, RequireFields<MutationSetResolutionThresholdsArgs, 'input'>>;
  setSignalWeight?: Resolver<ResolversTypes['SignalWeight'], ParentType, ContextType, RequireFields<MutationSetSignalWeightArgs, 'input'>>;
  startResolution?: Resolver<ResolversTypes['ResolutionSession'], ParentType, ContextType, RequireFields<MutationStartResolutionArgs, 'pathwayId' | 'patientId'>>;
  updateSignalDefinition?: Resolver<ResolversTypes['SignalDefinitionType'], ParentType, ContextType, RequireFields<MutationUpdateSignalDefinitionArgs, 'id' | 'input'>>;
}>;

export type NodeConfidenceResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['NodeConfidenceResult'] = ResolversParentTypes['NodeConfidenceResult']> = ResolversObject<{
  breakdown?: Resolver<Array<ResolversTypes['SignalBreakdown']>, ParentType, ContextType>;
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  nodeIdentifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nodeType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  propagationInfluences?: Resolver<Array<ResolversTypes['PropagationInfluence']>, ParentType, ContextType>;
  resolutionType?: Resolver<Maybe<ResolversTypes['ResolutionType']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type NodeWeightResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['NodeWeight'] = ResolversParentTypes['NodeWeight']> = ResolversObject<{
  defaultWeight?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institutionId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  nodeIdentifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nodeType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  propagationOverrides?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  weightOverride?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Pathway'] = ResolversParentTypes['Pathway']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Pathway']>, { __typename: 'Pathway' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  category?: Resolver<ResolversTypes['PathwayCategory'], ParentType, ContextType>;
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  logicalId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  scope?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['PathwayStatus'], ParentType, ContextType>;
  targetPopulation?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  version?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayConditionCodeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayConditionCode'] = ResolversParentTypes['PathwayConditionCode']> = ResolversObject<{
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  grouping?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  system?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  usage?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayConfidenceResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayConfidenceResult'] = ResolversParentTypes['PathwayConfidenceResult']> = ResolversObject<{
  nodes?: Resolver<Array<ResolversTypes['NodeConfidenceResult']>, ParentType, ContextType>;
  overallConfidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayGraphResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayGraph'] = ResolversParentTypes['PathwayGraph']> = ResolversObject<{
  conditionCodeDetails?: Resolver<Array<ResolversTypes['PathwayConditionCode']>, ParentType, ContextType>;
  edges?: Resolver<Array<ResolversTypes['PathwayGraphEdge']>, ParentType, ContextType>;
  nodes?: Resolver<Array<ResolversTypes['PathwayGraphNode']>, ParentType, ContextType>;
  pathway?: Resolver<ResolversTypes['Pathway'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayGraphEdgeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayGraphEdge'] = ResolversParentTypes['PathwayGraphEdge']> = ResolversObject<{
  from?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  properties?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  to?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayGraphNodeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayGraphNode'] = ResolversParentTypes['PathwayGraphNode']> = ResolversObject<{
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  properties?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayStatusResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayStatusResult'] = ResolversParentTypes['PathwayStatusResult']> = ResolversObject<{
  pathway?: Resolver<ResolversTypes['Pathway'], ParentType, ContextType>;
  previousStatus?: Resolver<ResolversTypes['PathwayStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PendingQuestionTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PendingQuestionType'] = ResolversParentTypes['PendingQuestionType']> = ResolversObject<{
  affectedSubtreeSize?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  answerType?: Resolver<ResolversTypes['AnswerType'], ParentType, ContextType>;
  estimatedImpact?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  gateId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  options?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  prompt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PropagationConfigTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PropagationConfigType'] = ResolversParentTypes['PropagationConfigType']> = ResolversObject<{
  decayFactor?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  edgeTypes?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  immuneToSignals?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  maxHops?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  mode?: Resolver<ResolversTypes['PropagationMode'], ParentType, ContextType>;
  sourceNodeTypes?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PropagationInfluenceResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PropagationInfluence'] = ResolversParentTypes['PropagationInfluence']> = ResolversObject<{
  hopDistance?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  originalScore?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  propagatedScore?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  signalName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sourceNodeIdentifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ProviderOverrideTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ProviderOverrideType'] = ResolversParentTypes['ProviderOverrideType']> = ResolversObject<{
  action?: Resolver<ResolversTypes['OverrideAction'], ParentType, ContextType>;
  originalConfidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  originalStatus?: Resolver<ResolversTypes['NodeStatus'], ParentType, ContextType>;
  reason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  effectiveThresholds?: Resolver<ResolversTypes['ResolvedThresholds'], ParentType, ContextType, RequireFields<QueryEffectiveThresholdsArgs, 'pathwayId'>>;
  effectiveWeights?: Resolver<ResolversTypes['WeightMatrix'], ParentType, ContextType, RequireFields<QueryEffectiveWeightsArgs, 'pathwayId'>>;
  matchedPathways?: Resolver<Array<ResolversTypes['MatchedPathway']>, ParentType, ContextType, RequireFields<QueryMatchedPathwaysArgs, 'patientId'>>;
  pathway?: Resolver<Maybe<ResolversTypes['Pathway']>, ParentType, ContextType, RequireFields<QueryPathwayArgs, 'id'>>;
  pathwayConfidence?: Resolver<ResolversTypes['PathwayConfidenceResult'], ParentType, ContextType, RequireFields<QueryPathwayConfidenceArgs, 'pathwayId' | 'patientContext'>>;
  pathwayGraph?: Resolver<Maybe<ResolversTypes['PathwayGraph']>, ParentType, ContextType, RequireFields<QueryPathwayGraphArgs, 'id'>>;
  pathwayServiceHealth?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  pathways?: Resolver<Array<ResolversTypes['Pathway']>, ParentType, ContextType, Partial<QueryPathwaysArgs>>;
  patientResolutionSessions?: Resolver<Array<ResolversTypes['ResolutionSessionSummary']>, ParentType, ContextType, RequireFields<QueryPatientResolutionSessionsArgs, 'patientId'>>;
  pendingQuestions?: Resolver<Array<ResolversTypes['PendingQuestionType']>, ParentType, ContextType, RequireFields<QueryPendingQuestionsArgs, 'sessionId'>>;
  redFlags?: Resolver<Array<ResolversTypes['RedFlagType']>, ParentType, ContextType, RequireFields<QueryRedFlagsArgs, 'sessionId'>>;
  resolutionSession?: Resolver<Maybe<ResolversTypes['ResolutionSession']>, ParentType, ContextType, RequireFields<QueryResolutionSessionArgs, 'sessionId'>>;
  signalDefinitions?: Resolver<Array<ResolversTypes['SignalDefinitionType']>, ParentType, ContextType, Partial<QuerySignalDefinitionsArgs>>;
}>;

export type RedFlagBranchTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['RedFlagBranchType'] = ResolversParentTypes['RedFlagBranchType']> = ResolversObject<{
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  nodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  topExcludeReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type RedFlagTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['RedFlagType'] = ResolversParentTypes['RedFlagType']> = ResolversObject<{
  branches?: Resolver<Maybe<Array<ResolversTypes['RedFlagBranchType']>>, ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nodeTitle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolutionEventTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolutionEventType'] = ResolversParentTypes['ResolutionEventType']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  eventType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nodesRecomputed?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  statusChanges?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  triggerData?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolutionSessionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolutionSession'] = ResolversParentTypes['ResolutionSession']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  excludedNodes?: Resolver<Array<ResolversTypes['ResolvedNode']>, ParentType, ContextType>;
  gatedOutNodes?: Resolver<Array<ResolversTypes['ResolvedNode']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  includedNodes?: Resolver<Array<ResolversTypes['ResolvedNode']>, ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  pathwayVersion?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  patientId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  pendingQuestions?: Resolver<Array<ResolversTypes['PendingQuestionType']>, ParentType, ContextType>;
  providerId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  redFlags?: Resolver<Array<ResolversTypes['RedFlagType']>, ParentType, ContextType>;
  resolutionEvents?: Resolver<Array<ResolversTypes['ResolutionEventType']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['SessionStatus'], ParentType, ContextType>;
  totalNodesEvaluated?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  traversalDurationMs?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolutionSessionSummaryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolutionSessionSummary'] = ResolversParentTypes['ResolutionSessionSummary']> = ResolversObject<{
  carePlanId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  includedCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  pathwayTitle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  redFlagCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['SessionStatus'], ParentType, ContextType>;
  totalNodesEvaluated?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolutionThresholdsResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolutionThresholds'] = ResolversParentTypes['ResolutionThresholds']> = ResolversObject<{
  autoResolveThreshold?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institutionId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  nodeIdentifier?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pathwayId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  scope?: Resolver<ResolversTypes['ThresholdScope'], ParentType, ContextType>;
  suggestThreshold?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedNodeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedNode'] = ResolversParentTypes['ResolvedNode']> = ResolversObject<{
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  confidenceBreakdown?: Resolver<Array<ResolversTypes['SignalBreakdown']>, ParentType, ContextType>;
  depth?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  excludeReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  nodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nodeType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  parentNodeId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  providerOverride?: Resolver<Maybe<ResolversTypes['ProviderOverrideType']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['NodeStatus'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedThresholdsResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedThresholds'] = ResolversParentTypes['ResolvedThresholds']> = ResolversObject<{
  autoResolveThreshold?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  scope?: Resolver<ResolversTypes['ThresholdScope'], ParentType, ContextType>;
  suggestThreshold?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SignalBreakdownResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SignalBreakdown'] = ResolversParentTypes['SignalBreakdown']> = ResolversObject<{
  missingInputs?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  score?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  signalName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  weight?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  weightSource?: Resolver<ResolversTypes['WeightSource'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SignalDefinitionTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SignalDefinitionType'] = ResolversParentTypes['SignalDefinitionType']> = ResolversObject<{
  defaultWeight?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  displayName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institutionId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  propagationConfig?: Resolver<Maybe<ResolversTypes['PropagationConfigType']>, ParentType, ContextType>;
  scope?: Resolver<ResolversTypes['SignalScope'], ParentType, ContextType>;
  scoringRules?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  scoringType?: Resolver<ResolversTypes['ScoringType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SignalWeightResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SignalWeight'] = ResolversParentTypes['SignalWeight']> = ResolversObject<{
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institutionId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  nodeIdentifier?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  nodeType?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pathwayId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  scope?: Resolver<ResolversTypes['WeightScope'], ParentType, ContextType>;
  signalDefinitionId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  weight?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ValidationBlockerTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ValidationBlockerType'] = ResolversParentTypes['ValidationBlockerType']> = ResolversObject<{
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  relatedNodeIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['BlockerType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ValidationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ValidationResult'] = ResolversParentTypes['ValidationResult']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  valid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  warnings?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type WeightMatrixResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['WeightMatrix'] = ResolversParentTypes['WeightMatrix']> = ResolversObject<{
  entries?: Resolver<Array<ResolversTypes['WeightMatrixEntry']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type WeightMatrixEntryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['WeightMatrixEntry'] = ResolversParentTypes['WeightMatrixEntry']> = ResolversObject<{
  nodeIdentifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  signalName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  source?: Resolver<ResolversTypes['WeightSource'], ParentType, ContextType>;
  weight?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type Resolvers<ContextType = DataSourceContext> = ResolversObject<{
  CarePlanGenerationResult?: CarePlanGenerationResultResolvers<ContextType>;
  DiffDetail?: DiffDetailResolvers<ContextType>;
  ImportDiff?: ImportDiffResolvers<ContextType>;
  ImportDiffSummary?: ImportDiffSummaryResolvers<ContextType>;
  ImportPathwayResult?: ImportPathwayResultResolvers<ContextType>;
  JSON?: GraphQLScalarType;
  MatchedPathway?: MatchedPathwayResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  NodeConfidenceResult?: NodeConfidenceResultResolvers<ContextType>;
  NodeWeight?: NodeWeightResolvers<ContextType>;
  Pathway?: PathwayResolvers<ContextType>;
  PathwayConditionCode?: PathwayConditionCodeResolvers<ContextType>;
  PathwayConfidenceResult?: PathwayConfidenceResultResolvers<ContextType>;
  PathwayGraph?: PathwayGraphResolvers<ContextType>;
  PathwayGraphEdge?: PathwayGraphEdgeResolvers<ContextType>;
  PathwayGraphNode?: PathwayGraphNodeResolvers<ContextType>;
  PathwayStatusResult?: PathwayStatusResultResolvers<ContextType>;
  PendingQuestionType?: PendingQuestionTypeResolvers<ContextType>;
  PropagationConfigType?: PropagationConfigTypeResolvers<ContextType>;
  PropagationInfluence?: PropagationInfluenceResolvers<ContextType>;
  ProviderOverrideType?: ProviderOverrideTypeResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  RedFlagBranchType?: RedFlagBranchTypeResolvers<ContextType>;
  RedFlagType?: RedFlagTypeResolvers<ContextType>;
  ResolutionEventType?: ResolutionEventTypeResolvers<ContextType>;
  ResolutionSession?: ResolutionSessionResolvers<ContextType>;
  ResolutionSessionSummary?: ResolutionSessionSummaryResolvers<ContextType>;
  ResolutionThresholds?: ResolutionThresholdsResolvers<ContextType>;
  ResolvedNode?: ResolvedNodeResolvers<ContextType>;
  ResolvedThresholds?: ResolvedThresholdsResolvers<ContextType>;
  SignalBreakdown?: SignalBreakdownResolvers<ContextType>;
  SignalDefinitionType?: SignalDefinitionTypeResolvers<ContextType>;
  SignalWeight?: SignalWeightResolvers<ContextType>;
  ValidationBlockerType?: ValidationBlockerTypeResolvers<ContextType>;
  ValidationResult?: ValidationResultResolvers<ContextType>;
  WeightMatrix?: WeightMatrixResolvers<ContextType>;
  WeightMatrixEntry?: WeightMatrixEntryResolvers<ContextType>;
}>;

