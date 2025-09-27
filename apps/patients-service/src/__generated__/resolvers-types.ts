import { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import { DataSourceContext } from '@patients/types/DataSourceContext';
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

export type Case = {
  __typename?: 'Case';
  closedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  patientId: Scalars['ID']['output'];
  priority: CasePriority;
  status: CaseStatus;
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export enum CasePriority {
  High = 'HIGH',
  Low = 'LOW',
  Medium = 'MEDIUM',
  Urgent = 'URGENT'
}

export enum CaseStatus {
  Cancelled = 'CANCELLED',
  Closed = 'CLOSED',
  InProgress = 'IN_PROGRESS',
  Open = 'OPEN'
}

export type CreateCaseInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  patientId: Scalars['ID']['input'];
  priority: CasePriority;
  title: Scalars['String']['input'];
};

export type CreatePatientInput = {
  address?: InputMaybe<AddressInput>;
  dateOfBirth: Scalars['Date']['input'];
  email?: InputMaybe<Scalars['String']['input']>;
  firstName: Scalars['String']['input'];
  gender: Gender;
  lastName: Scalars['String']['input'];
  mrn: Scalars['String']['input'];
  phone?: InputMaybe<Scalars['String']['input']>;
};

export enum Gender {
  Female = 'FEMALE',
  Male = 'MALE',
  Other = 'OTHER',
  Unknown = 'UNKNOWN'
}

export type Mutation = {
  __typename?: 'Mutation';
  closeCase?: Maybe<Case>;
  createCase?: Maybe<Case>;
  createPatient?: Maybe<Patient>;
  updateCase?: Maybe<Case>;
  updatePatient?: Maybe<Patient>;
};


export type MutationCloseCaseArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCreateCaseArgs = {
  input: CreateCaseInput;
};


export type MutationCreatePatientArgs = {
  input: CreatePatientInput;
};


export type MutationUpdateCaseArgs = {
  id: Scalars['ID']['input'];
  input: UpdateCaseInput;
};


export type MutationUpdatePatientArgs = {
  id: Scalars['ID']['input'];
  input: UpdatePatientInput;
};

export type Patient = {
  __typename?: 'Patient';
  address?: Maybe<Address>;
  cases: Array<Case>;
  dateOfBirth: Scalars['Date']['output'];
  email?: Maybe<Scalars['String']['output']>;
  firstName: Scalars['String']['output'];
  gender: Gender;
  id: Scalars['ID']['output'];
  lastName: Scalars['String']['output'];
  mrn: Scalars['String']['output'];
  phone?: Maybe<Scalars['String']['output']>;
};

export type Query = {
  __typename?: 'Query';
  case?: Maybe<Case>;
  casesByStatus: Array<Case>;
  casesForPatient: Array<Case>;
  patient?: Maybe<Patient>;
  patientByMrn?: Maybe<Patient>;
  patients: Array<Patient>;
};


export type QueryCaseArgs = {
  id: Scalars['ID']['input'];
};


export type QueryCasesByStatusArgs = {
  status: CaseStatus;
};


export type QueryCasesForPatientArgs = {
  patientId: Scalars['ID']['input'];
};


export type QueryPatientArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPatientByMrnArgs = {
  mrn: Scalars['String']['input'];
};


export type QueryPatientsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};

export type UpdateCaseInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<CasePriority>;
  status?: InputMaybe<CaseStatus>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdatePatientInput = {
  address?: InputMaybe<AddressInput>;
  email?: InputMaybe<Scalars['String']['input']>;
  firstName?: InputMaybe<Scalars['String']['input']>;
  lastName?: InputMaybe<Scalars['String']['input']>;
  phone?: InputMaybe<Scalars['String']['input']>;
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
  Address: ResolverTypeWrapper<Address>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  AddressInput: AddressInput;
  Case: ResolverTypeWrapper<Case>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  CasePriority: CasePriority;
  CaseStatus: CaseStatus;
  CreateCaseInput: CreateCaseInput;
  CreatePatientInput: CreatePatientInput;
  Date: ResolverTypeWrapper<Scalars['Date']['output']>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  Gender: Gender;
  Mutation: ResolverTypeWrapper<{}>;
  Patient: ResolverTypeWrapper<Patient>;
  Query: ResolverTypeWrapper<{}>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  UpdateCaseInput: UpdateCaseInput;
  UpdatePatientInput: UpdatePatientInput;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  Address: Address;
  String: Scalars['String']['output'];
  AddressInput: AddressInput;
  Case: Case;
  ID: Scalars['ID']['output'];
  CreateCaseInput: CreateCaseInput;
  CreatePatientInput: CreatePatientInput;
  Date: Scalars['Date']['output'];
  DateTime: Scalars['DateTime']['output'];
  Mutation: {};
  Patient: Patient;
  Query: {};
  Int: Scalars['Int']['output'];
  UpdateCaseInput: UpdateCaseInput;
  UpdatePatientInput: UpdatePatientInput;
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

export type CaseResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Case'] = ResolversParentTypes['Case']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Case']>, { __typename: 'Case' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  closedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  patientId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  priority?: Resolver<ResolversTypes['CasePriority'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['CaseStatus'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export interface DateScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Date'], any> {
  name: 'Date';
}

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type MutationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  closeCase?: Resolver<Maybe<ResolversTypes['Case']>, ParentType, ContextType, RequireFields<MutationCloseCaseArgs, 'id'>>;
  createCase?: Resolver<Maybe<ResolversTypes['Case']>, ParentType, ContextType, RequireFields<MutationCreateCaseArgs, 'input'>>;
  createPatient?: Resolver<Maybe<ResolversTypes['Patient']>, ParentType, ContextType, RequireFields<MutationCreatePatientArgs, 'input'>>;
  updateCase?: Resolver<Maybe<ResolversTypes['Case']>, ParentType, ContextType, RequireFields<MutationUpdateCaseArgs, 'id' | 'input'>>;
  updatePatient?: Resolver<Maybe<ResolversTypes['Patient']>, ParentType, ContextType, RequireFields<MutationUpdatePatientArgs, 'id' | 'input'>>;
}>;

export type PatientResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Patient'] = ResolversParentTypes['Patient']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Patient']>, { __typename: 'Patient' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  address?: Resolver<Maybe<ResolversTypes['Address']>, ParentType, ContextType>;
  cases?: Resolver<Array<ResolversTypes['Case']>, ParentType, ContextType>;
  dateOfBirth?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  email?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  firstName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  gender?: Resolver<ResolversTypes['Gender'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lastName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  mrn?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  phone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  case?: Resolver<Maybe<ResolversTypes['Case']>, ParentType, ContextType, RequireFields<QueryCaseArgs, 'id'>>;
  casesByStatus?: Resolver<Array<ResolversTypes['Case']>, ParentType, ContextType, RequireFields<QueryCasesByStatusArgs, 'status'>>;
  casesForPatient?: Resolver<Array<ResolversTypes['Case']>, ParentType, ContextType, RequireFields<QueryCasesForPatientArgs, 'patientId'>>;
  patient?: Resolver<Maybe<ResolversTypes['Patient']>, ParentType, ContextType, RequireFields<QueryPatientArgs, 'id'>>;
  patientByMrn?: Resolver<Maybe<ResolversTypes['Patient']>, ParentType, ContextType, RequireFields<QueryPatientByMrnArgs, 'mrn'>>;
  patients?: Resolver<Array<ResolversTypes['Patient']>, ParentType, ContextType, Partial<QueryPatientsArgs>>;
}>;

export type Resolvers<ContextType = DataSourceContext> = ResolversObject<{
  Address?: AddressResolvers<ContextType>;
  Case?: CaseResolvers<ContextType>;
  Date?: GraphQLScalarType;
  DateTime?: GraphQLScalarType;
  Mutation?: MutationResolvers<ContextType>;
  Patient?: PatientResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
}>;

