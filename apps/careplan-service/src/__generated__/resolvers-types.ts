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

export type Mutation = {
  __typename?: 'Mutation';
  addGoal: CarePlanGoal;
  addIntervention: CarePlanIntervention;
  addTrainingGoal: CarePlan;
  addTrainingIntervention: CarePlan;
  approveCarePlan: CarePlan;
  createCarePlan: CarePlan;
  createCarePlanFromTemplate: CarePlan;
  createCarePlanTemplate: CarePlanTemplate;
  createTrainingCarePlan: CarePlan;
  deleteCarePlanTemplate: Scalars['Boolean']['output'];
  deleteTrainingCarePlan: Scalars['Boolean']['output'];
  linkGoalToInterventions: CarePlanGoal;
  removeTrainingGoal: Scalars['Boolean']['output'];
  removeTrainingIntervention: Scalars['Boolean']['output'];
  submitCarePlanForReview: CarePlan;
  updateCarePlanStatus: CarePlan;
  updateCarePlanTemplate: CarePlanTemplate;
  updateGoalStatus: CarePlanGoal;
  updateInterventionStatus: CarePlanIntervention;
  updateTrainingCarePlan: CarePlan;
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


export type MutationLinkGoalToInterventionsArgs = {
  goalId: Scalars['ID']['input'];
  interventionIds: Array<Scalars['ID']['input']>;
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

export type Query = {
  __typename?: 'Query';
  activeCarePlanForPatient?: Maybe<CarePlan>;
  carePlan?: Maybe<CarePlan>;
  carePlanTemplate?: Maybe<CarePlanTemplate>;
  carePlanTemplates: CarePlanTemplateConnection;
  carePlans: CarePlanConnection;
  carePlansForPatient: CarePlanConnection;
  templatesForConditions: Array<CarePlanTemplate>;
  trainingCarePlan?: Maybe<CarePlan>;
  trainingCarePlans: CarePlanConnection;
};


export type QueryActiveCarePlanForPatientArgs = {
  patientId: Scalars['ID']['input'];
};


export type QueryCarePlanArgs = {
  id: Scalars['ID']['input'];
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

export enum TemplateCategory {
  ChronicDisease = 'CHRONIC_DISEASE',
  LifestyleModification = 'LIFESTYLE_MODIFICATION',
  MedicationManagement = 'MEDICATION_MANAGEMENT',
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
  CarePlanConnection: ResolverTypeWrapper<CarePlanConnection>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  CarePlanEdge: ResolverTypeWrapper<CarePlanEdge>;
  CarePlanFilterInput: CarePlanFilterInput;
  CarePlanGoal: ResolverTypeWrapper<CarePlanGoal>;
  CarePlanIntervention: ResolverTypeWrapper<CarePlanIntervention>;
  CarePlanQueryFilter: CarePlanQueryFilter;
  CarePlanStatus: CarePlanStatus;
  CarePlanTemplate: ResolverTypeWrapper<CarePlanTemplate>;
  CarePlanTemplateConnection: ResolverTypeWrapper<CarePlanTemplateConnection>;
  CarePlanTemplateEdge: ResolverTypeWrapper<CarePlanTemplateEdge>;
  CreateCarePlanInput: CreateCarePlanInput;
  CreateCarePlanTemplateInput: CreateCarePlanTemplateInput;
  CreateTemplateGoalInput: CreateTemplateGoalInput;
  CreateTemplateInterventionInput: CreateTemplateInterventionInput;
  CreateTrainingCarePlanInput: CreateTrainingCarePlanInput;
  CreateTrainingGoalInput: CreateTrainingGoalInput;
  CreateTrainingInterventionInput: CreateTrainingInterventionInput;
  Date: ResolverTypeWrapper<Scalars['Date']['output']>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  GoalPriority: GoalPriority;
  GoalProgressNote: ResolverTypeWrapper<GoalProgressNote>;
  GoalStatus: GoalStatus;
  InterventionStatus: InterventionStatus;
  InterventionType: InterventionType;
  Mutation: ResolverTypeWrapper<{}>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  PaginationInput: PaginationInput;
  Patient: ResolverTypeWrapper<Patient>;
  Query: ResolverTypeWrapper<{}>;
  TemplateCategory: TemplateCategory;
  TemplateFilterInput: TemplateFilterInput;
  TemplateGoal: ResolverTypeWrapper<TemplateGoal>;
  TemplateIntervention: ResolverTypeWrapper<TemplateIntervention>;
  TrainingCarePlanFilterInput: TrainingCarePlanFilterInput;
  UpdateCarePlanTemplateInput: UpdateCarePlanTemplateInput;
  UpdateGoalStatusInput: UpdateGoalStatusInput;
  UpdateInterventionStatusInput: UpdateInterventionStatusInput;
  UpdateTrainingCarePlanInput: UpdateTrainingCarePlanInput;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  AddGoalInput: AddGoalInput;
  ID: Scalars['ID']['output'];
  String: Scalars['String']['output'];
  AddInterventionInput: AddInterventionInput;
  CarePlan: CarePlan;
  Boolean: Scalars['Boolean']['output'];
  CarePlanConnection: CarePlanConnection;
  Int: Scalars['Int']['output'];
  CarePlanEdge: CarePlanEdge;
  CarePlanFilterInput: CarePlanFilterInput;
  CarePlanGoal: CarePlanGoal;
  CarePlanIntervention: CarePlanIntervention;
  CarePlanTemplate: CarePlanTemplate;
  CarePlanTemplateConnection: CarePlanTemplateConnection;
  CarePlanTemplateEdge: CarePlanTemplateEdge;
  CreateCarePlanInput: CreateCarePlanInput;
  CreateCarePlanTemplateInput: CreateCarePlanTemplateInput;
  CreateTemplateGoalInput: CreateTemplateGoalInput;
  CreateTemplateInterventionInput: CreateTemplateInterventionInput;
  CreateTrainingCarePlanInput: CreateTrainingCarePlanInput;
  CreateTrainingGoalInput: CreateTrainingGoalInput;
  CreateTrainingInterventionInput: CreateTrainingInterventionInput;
  Date: Scalars['Date']['output'];
  DateTime: Scalars['DateTime']['output'];
  GoalProgressNote: GoalProgressNote;
  Mutation: {};
  PageInfo: PageInfo;
  PaginationInput: PaginationInput;
  Patient: Patient;
  Query: {};
  TemplateFilterInput: TemplateFilterInput;
  TemplateGoal: TemplateGoal;
  TemplateIntervention: TemplateIntervention;
  TrainingCarePlanFilterInput: TrainingCarePlanFilterInput;
  UpdateCarePlanTemplateInput: UpdateCarePlanTemplateInput;
  UpdateGoalStatusInput: UpdateGoalStatusInput;
  UpdateInterventionStatusInput: UpdateInterventionStatusInput;
  UpdateTrainingCarePlanInput: UpdateTrainingCarePlanInput;
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

export interface DateScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Date'], any> {
  name: 'Date';
}

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type GoalProgressNoteResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['GoalProgressNote'] = ResolversParentTypes['GoalProgressNote']> = ResolversObject<{
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  note?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  recordedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  recordedBy?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  value?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  addGoal?: Resolver<ResolversTypes['CarePlanGoal'], ParentType, ContextType, RequireFields<MutationAddGoalArgs, 'input'>>;
  addIntervention?: Resolver<ResolversTypes['CarePlanIntervention'], ParentType, ContextType, RequireFields<MutationAddInterventionArgs, 'input'>>;
  addTrainingGoal?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationAddTrainingGoalArgs, 'carePlanId' | 'input'>>;
  addTrainingIntervention?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationAddTrainingInterventionArgs, 'carePlanId' | 'input'>>;
  approveCarePlan?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationApproveCarePlanArgs, 'id'>>;
  createCarePlan?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationCreateCarePlanArgs, 'input'>>;
  createCarePlanFromTemplate?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationCreateCarePlanFromTemplateArgs, 'patientId' | 'startDate' | 'templateId'>>;
  createCarePlanTemplate?: Resolver<ResolversTypes['CarePlanTemplate'], ParentType, ContextType, RequireFields<MutationCreateCarePlanTemplateArgs, 'input'>>;
  createTrainingCarePlan?: Resolver<ResolversTypes['CarePlan'], ParentType, ContextType, RequireFields<MutationCreateTrainingCarePlanArgs, 'input'>>;
  deleteCarePlanTemplate?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteCarePlanTemplateArgs, 'id'>>;
  deleteTrainingCarePlan?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteTrainingCarePlanArgs, 'id'>>;
  linkGoalToInterventions?: Resolver<ResolversTypes['CarePlanGoal'], ParentType, ContextType, RequireFields<MutationLinkGoalToInterventionsArgs, 'goalId' | 'interventionIds'>>;
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

export type QueryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  activeCarePlanForPatient?: Resolver<Maybe<ResolversTypes['CarePlan']>, ParentType, ContextType, RequireFields<QueryActiveCarePlanForPatientArgs, 'patientId'>>;
  carePlan?: Resolver<Maybe<ResolversTypes['CarePlan']>, ParentType, ContextType, RequireFields<QueryCarePlanArgs, 'id'>>;
  carePlanTemplate?: Resolver<Maybe<ResolversTypes['CarePlanTemplate']>, ParentType, ContextType, RequireFields<QueryCarePlanTemplateArgs, 'id'>>;
  carePlanTemplates?: Resolver<ResolversTypes['CarePlanTemplateConnection'], ParentType, ContextType, Partial<QueryCarePlanTemplatesArgs>>;
  carePlans?: Resolver<ResolversTypes['CarePlanConnection'], ParentType, ContextType, Partial<QueryCarePlansArgs>>;
  carePlansForPatient?: Resolver<ResolversTypes['CarePlanConnection'], ParentType, ContextType, RequireFields<QueryCarePlansForPatientArgs, 'patientId'>>;
  templatesForConditions?: Resolver<Array<ResolversTypes['CarePlanTemplate']>, ParentType, ContextType, RequireFields<QueryTemplatesForConditionsArgs, 'conditionCodes'>>;
  trainingCarePlan?: Resolver<Maybe<ResolversTypes['CarePlan']>, ParentType, ContextType, RequireFields<QueryTrainingCarePlanArgs, 'id'>>;
  trainingCarePlans?: Resolver<ResolversTypes['CarePlanConnection'], ParentType, ContextType, Partial<QueryTrainingCarePlansArgs>>;
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

export type Resolvers<ContextType = DataSourceContext> = ResolversObject<{
  CarePlan?: CarePlanResolvers<ContextType>;
  CarePlanConnection?: CarePlanConnectionResolvers<ContextType>;
  CarePlanEdge?: CarePlanEdgeResolvers<ContextType>;
  CarePlanGoal?: CarePlanGoalResolvers<ContextType>;
  CarePlanIntervention?: CarePlanInterventionResolvers<ContextType>;
  CarePlanTemplate?: CarePlanTemplateResolvers<ContextType>;
  CarePlanTemplateConnection?: CarePlanTemplateConnectionResolvers<ContextType>;
  CarePlanTemplateEdge?: CarePlanTemplateEdgeResolvers<ContextType>;
  Date?: GraphQLScalarType;
  DateTime?: GraphQLScalarType;
  GoalProgressNote?: GoalProgressNoteResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  Patient?: PatientResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  TemplateGoal?: TemplateGoalResolvers<ContextType>;
  TemplateIntervention?: TemplateInterventionResolvers<ContextType>;
}>;

