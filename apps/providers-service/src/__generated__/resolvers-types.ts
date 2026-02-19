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
  _FieldSet: { input: any; output: any; }
};

export type Address = {
  __typename?: 'Address';
  city: Scalars['String']['output'];
  country: Scalars['String']['output'];
  state: Scalars['String']['output'];
  street: Scalars['String']['output'];
  zipCode: Scalars['String']['output'];
};

export type AddressInput = {
  city: Scalars['String']['input'];
  country: Scalars['String']['input'];
  state: Scalars['String']['input'];
  street: Scalars['String']['input'];
  zipCode: Scalars['String']['input'];
};

export type AudioUploadUrl = {
  __typename?: 'AudioUploadUrl';
  expiresAt: Scalars['DateTime']['output'];
  storageUri: Scalars['String']['output'];
  uploadUrl: Scalars['String']['output'];
};

export type Case = {
  __typename?: 'Case';
  id: Scalars['ID']['output'];
};

export type CreateFacilityInput = {
  address: AddressInput;
  name: Scalars['String']['input'];
  phone: Scalars['String']['input'];
};

export type CreateProviderInput = {
  credentials: Scalars['String']['input'];
  email: Scalars['String']['input'];
  facilityId?: InputMaybe<Scalars['ID']['input']>;
  firstName: Scalars['String']['input'];
  lastName: Scalars['String']['input'];
  npi: Scalars['String']['input'];
  phone: Scalars['String']['input'];
  specialty: Scalars['String']['input'];
};

export type CreateVisitInput = {
  caseIds: Array<Scalars['ID']['input']>;
  chiefComplaint?: InputMaybe<Scalars['String']['input']>;
  hospitalId: Scalars['ID']['input'];
  patientId: Scalars['ID']['input'];
  providerId: Scalars['ID']['input'];
  scheduledAt: Scalars['DateTime']['input'];
  type: VisitType;
};

export type Facility = {
  __typename?: 'Facility';
  address: Address;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  phone: Scalars['String']['output'];
};

export type Hospital = {
  __typename?: 'Hospital';
  id: Scalars['ID']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  addCaseToVisit?: Maybe<Visit>;
  cancelVisit?: Maybe<Visit>;
  checkInVisit?: Maybe<Visit>;
  completeVisit?: Maybe<Visit>;
  createFacility?: Maybe<Facility>;
  createProvider?: Maybe<Provider>;
  createVisit?: Maybe<Visit>;
  removeCaseFromVisit?: Maybe<Visit>;
  /**
   * Generate a signed GCS upload URL for visit audio.
   * contentType defaults to "audio/webm" if not provided.
   */
  requestAudioUploadUrl: AudioUploadUrl;
  startVisit?: Maybe<Visit>;
  updateProvider?: Maybe<Provider>;
  updateVisit?: Maybe<Visit>;
  updateVisitAudio?: Maybe<Visit>;
};


export type MutationAddCaseToVisitArgs = {
  caseId: Scalars['ID']['input'];
  visitId: Scalars['ID']['input'];
};


export type MutationCancelVisitArgs = {
  id: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCheckInVisitArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCompleteVisitArgs = {
  id: Scalars['ID']['input'];
  notes?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateFacilityArgs = {
  input: CreateFacilityInput;
};


export type MutationCreateProviderArgs = {
  input: CreateProviderInput;
};


export type MutationCreateVisitArgs = {
  input: CreateVisitInput;
};


export type MutationRemoveCaseFromVisitArgs = {
  caseId: Scalars['ID']['input'];
  visitId: Scalars['ID']['input'];
};


export type MutationRequestAudioUploadUrlArgs = {
  contentType?: InputMaybe<Scalars['String']['input']>;
  visitId: Scalars['ID']['input'];
};


export type MutationStartVisitArgs = {
  id: Scalars['ID']['input'];
};


export type MutationUpdateProviderArgs = {
  id: Scalars['ID']['input'];
  input: UpdateProviderInput;
};


export type MutationUpdateVisitArgs = {
  id: Scalars['ID']['input'];
  input: UpdateVisitInput;
};


export type MutationUpdateVisitAudioArgs = {
  audioUri: Scalars['String']['input'];
  visitId: Scalars['ID']['input'];
};

export type Patient = {
  __typename?: 'Patient';
  id: Scalars['ID']['output'];
};

export type PatientVisitsConnection = {
  __typename?: 'PatientVisitsConnection';
  nodes: Array<Visit>;
  totalCount: Scalars['Int']['output'];
};

export type Provider = {
  __typename?: 'Provider';
  credentials: Scalars['String']['output'];
  email: Scalars['String']['output'];
  facility?: Maybe<Facility>;
  firstName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastName: Scalars['String']['output'];
  npi: Scalars['String']['output'];
  phone: Scalars['String']['output'];
  specialty: Scalars['String']['output'];
  visits: Array<Visit>;
};

export type Query = {
  __typename?: 'Query';
  facility?: Maybe<Facility>;
  patientVisits: PatientVisitsConnection;
  provider?: Maybe<Provider>;
  providerByNpi?: Maybe<Provider>;
  providers: Array<Provider>;
  todaySchedule: Array<Visit>;
  visit?: Maybe<Visit>;
  visitsByDateRange: Array<Visit>;
  visitsForCase: Array<Visit>;
  visitsForHospital: Array<Visit>;
  visitsForPatient: Array<Visit>;
  visitsForProvider: Array<Visit>;
};


export type QueryFacilityArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPatientVisitsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  patientId: Scalars['ID']['input'];
};


export type QueryProviderArgs = {
  id: Scalars['ID']['input'];
};


export type QueryProviderByNpiArgs = {
  npi: Scalars['String']['input'];
};


export type QueryProvidersArgs = {
  specialty?: InputMaybe<Scalars['String']['input']>;
};


export type QueryTodayScheduleArgs = {
  providerId: Scalars['ID']['input'];
};


export type QueryVisitArgs = {
  id: Scalars['ID']['input'];
};


export type QueryVisitsByDateRangeArgs = {
  endDate: Scalars['DateTime']['input'];
  startDate: Scalars['DateTime']['input'];
};


export type QueryVisitsForCaseArgs = {
  caseId: Scalars['ID']['input'];
};


export type QueryVisitsForHospitalArgs = {
  hospitalId: Scalars['ID']['input'];
};


export type QueryVisitsForPatientArgs = {
  patientId: Scalars['ID']['input'];
};


export type QueryVisitsForProviderArgs = {
  providerId: Scalars['ID']['input'];
};

export type Recommendation = {
  __typename?: 'Recommendation';
  id: Scalars['ID']['output'];
};

export type UpdateProviderInput = {
  credentials?: InputMaybe<Scalars['String']['input']>;
  email?: InputMaybe<Scalars['String']['input']>;
  facilityId?: InputMaybe<Scalars['ID']['input']>;
  firstName?: InputMaybe<Scalars['String']['input']>;
  lastName?: InputMaybe<Scalars['String']['input']>;
  phone?: InputMaybe<Scalars['String']['input']>;
  specialty?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateVisitInput = {
  chiefComplaint?: InputMaybe<Scalars['String']['input']>;
  duration?: InputMaybe<Scalars['Int']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  scheduledAt?: InputMaybe<Scalars['DateTime']['input']>;
  status?: InputMaybe<VisitStatus>;
  type?: InputMaybe<VisitType>;
};

export type Visit = {
  __typename?: 'Visit';
  audioUploadedAt?: Maybe<Scalars['DateTime']['output']>;
  audioUri?: Maybe<Scalars['String']['output']>;
  caseIds: Array<Scalars['ID']['output']>;
  chiefComplaint?: Maybe<Scalars['String']['output']>;
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  duration?: Maybe<Scalars['Int']['output']>;
  hospitalId: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  patientId: Scalars['ID']['output'];
  providerId: Scalars['ID']['output'];
  scheduledAt: Scalars['DateTime']['output'];
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  status: VisitStatus;
  type: VisitType;
};

export enum VisitStatus {
  Cancelled = 'CANCELLED',
  CheckedIn = 'CHECKED_IN',
  Completed = 'COMPLETED',
  InProgress = 'IN_PROGRESS',
  NoShow = 'NO_SHOW',
  Scheduled = 'SCHEDULED'
}

export enum VisitType {
  Consultation = 'CONSULTATION',
  Diagnostic = 'DIAGNOSTIC',
  Emergency = 'EMERGENCY',
  FollowUp = 'FOLLOW_UP',
  Procedure = 'PROCEDURE',
  RoutineCheck = 'ROUTINE_CHECK',
  Surgery = 'SURGERY',
  Therapy = 'THERAPY'
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
  Address: ResolverTypeWrapper<Address>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  AddressInput: AddressInput;
  AudioUploadUrl: ResolverTypeWrapper<AudioUploadUrl>;
  Case: ResolverTypeWrapper<Case>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  CreateFacilityInput: CreateFacilityInput;
  CreateProviderInput: CreateProviderInput;
  CreateVisitInput: CreateVisitInput;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  Facility: ResolverTypeWrapper<Facility>;
  Hospital: ResolverTypeWrapper<Hospital>;
  Mutation: ResolverTypeWrapper<{}>;
  Patient: ResolverTypeWrapper<Patient>;
  PatientVisitsConnection: ResolverTypeWrapper<PatientVisitsConnection>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Provider: ResolverTypeWrapper<Provider>;
  Query: ResolverTypeWrapper<{}>;
  Recommendation: ResolverTypeWrapper<Recommendation>;
  UpdateProviderInput: UpdateProviderInput;
  UpdateVisitInput: UpdateVisitInput;
  Visit: ResolverTypeWrapper<Visit>;
  VisitStatus: VisitStatus;
  VisitType: VisitType;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  Address: Address;
  String: Scalars['String']['output'];
  AddressInput: AddressInput;
  AudioUploadUrl: AudioUploadUrl;
  Case: Case;
  ID: Scalars['ID']['output'];
  CreateFacilityInput: CreateFacilityInput;
  CreateProviderInput: CreateProviderInput;
  CreateVisitInput: CreateVisitInput;
  DateTime: Scalars['DateTime']['output'];
  Facility: Facility;
  Hospital: Hospital;
  Mutation: {};
  Patient: Patient;
  PatientVisitsConnection: PatientVisitsConnection;
  Int: Scalars['Int']['output'];
  Provider: Provider;
  Query: {};
  Recommendation: Recommendation;
  UpdateProviderInput: UpdateProviderInput;
  UpdateVisitInput: UpdateVisitInput;
  Visit: Visit;
  Boolean: Scalars['Boolean']['output'];
}>;

export type AddressResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Address'] = ResolversParentTypes['Address']> = ResolversObject<{
  city?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  country?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  street?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  zipCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type AudioUploadUrlResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['AudioUploadUrl'] = ResolversParentTypes['AudioUploadUrl']> = ResolversObject<{
  expiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  storageUri?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  uploadUrl?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CaseResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Case'] = ResolversParentTypes['Case']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Case']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type FacilityResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Facility'] = ResolversParentTypes['Facility']> = ResolversObject<{
  address?: Resolver<ResolversTypes['Address'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  phone?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type HospitalResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Hospital'] = ResolversParentTypes['Hospital']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Hospital']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  addCaseToVisit?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<MutationAddCaseToVisitArgs, 'caseId' | 'visitId'>>;
  cancelVisit?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<MutationCancelVisitArgs, 'id'>>;
  checkInVisit?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<MutationCheckInVisitArgs, 'id'>>;
  completeVisit?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<MutationCompleteVisitArgs, 'id'>>;
  createFacility?: Resolver<Maybe<ResolversTypes['Facility']>, ParentType, ContextType, RequireFields<MutationCreateFacilityArgs, 'input'>>;
  createProvider?: Resolver<Maybe<ResolversTypes['Provider']>, ParentType, ContextType, RequireFields<MutationCreateProviderArgs, 'input'>>;
  createVisit?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<MutationCreateVisitArgs, 'input'>>;
  removeCaseFromVisit?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<MutationRemoveCaseFromVisitArgs, 'caseId' | 'visitId'>>;
  requestAudioUploadUrl?: Resolver<ResolversTypes['AudioUploadUrl'], ParentType, ContextType, RequireFields<MutationRequestAudioUploadUrlArgs, 'visitId'>>;
  startVisit?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<MutationStartVisitArgs, 'id'>>;
  updateProvider?: Resolver<Maybe<ResolversTypes['Provider']>, ParentType, ContextType, RequireFields<MutationUpdateProviderArgs, 'id' | 'input'>>;
  updateVisit?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<MutationUpdateVisitArgs, 'id' | 'input'>>;
  updateVisitAudio?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<MutationUpdateVisitAudioArgs, 'audioUri' | 'visitId'>>;
}>;

export type PatientResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Patient'] = ResolversParentTypes['Patient']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Patient']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PatientVisitsConnectionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PatientVisitsConnection'] = ResolversParentTypes['PatientVisitsConnection']> = ResolversObject<{
  nodes?: Resolver<Array<ResolversTypes['Visit']>, ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ProviderResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Provider'] = ResolversParentTypes['Provider']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Provider']>, { __typename: 'Provider' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  credentials?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  facility?: Resolver<Maybe<ResolversTypes['Facility']>, ParentType, ContextType>;
  firstName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lastName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  npi?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  phone?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  specialty?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  visits?: Resolver<Array<ResolversTypes['Visit']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  facility?: Resolver<Maybe<ResolversTypes['Facility']>, ParentType, ContextType, RequireFields<QueryFacilityArgs, 'id'>>;
  patientVisits?: Resolver<ResolversTypes['PatientVisitsConnection'], ParentType, ContextType, RequireFields<QueryPatientVisitsArgs, 'patientId'>>;
  provider?: Resolver<Maybe<ResolversTypes['Provider']>, ParentType, ContextType, RequireFields<QueryProviderArgs, 'id'>>;
  providerByNpi?: Resolver<Maybe<ResolversTypes['Provider']>, ParentType, ContextType, RequireFields<QueryProviderByNpiArgs, 'npi'>>;
  providers?: Resolver<Array<ResolversTypes['Provider']>, ParentType, ContextType, Partial<QueryProvidersArgs>>;
  todaySchedule?: Resolver<Array<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<QueryTodayScheduleArgs, 'providerId'>>;
  visit?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<QueryVisitArgs, 'id'>>;
  visitsByDateRange?: Resolver<Array<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<QueryVisitsByDateRangeArgs, 'endDate' | 'startDate'>>;
  visitsForCase?: Resolver<Array<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<QueryVisitsForCaseArgs, 'caseId'>>;
  visitsForHospital?: Resolver<Array<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<QueryVisitsForHospitalArgs, 'hospitalId'>>;
  visitsForPatient?: Resolver<Array<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<QueryVisitsForPatientArgs, 'patientId'>>;
  visitsForProvider?: Resolver<Array<ResolversTypes['Visit']>, ParentType, ContextType, RequireFields<QueryVisitsForProviderArgs, 'providerId'>>;
}>;

export type RecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Recommendation'] = ResolversParentTypes['Recommendation']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Recommendation']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type VisitResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Visit'] = ResolversParentTypes['Visit']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Visit']>, { __typename: 'Visit' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  audioUploadedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  audioUri?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  caseIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  chiefComplaint?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  completedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  duration?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  hospitalId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  notes?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  patientId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  providerId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  scheduledAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  startedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['VisitStatus'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['VisitType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type Resolvers<ContextType = DataSourceContext> = ResolversObject<{
  Address?: AddressResolvers<ContextType>;
  AudioUploadUrl?: AudioUploadUrlResolvers<ContextType>;
  Case?: CaseResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  Facility?: FacilityResolvers<ContextType>;
  Hospital?: HospitalResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Patient?: PatientResolvers<ContextType>;
  PatientVisitsConnection?: PatientVisitsConnectionResolvers<ContextType>;
  Provider?: ProviderResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  Recommendation?: RecommendationResolvers<ContextType>;
  Visit?: VisitResolvers<ContextType>;
}>;

