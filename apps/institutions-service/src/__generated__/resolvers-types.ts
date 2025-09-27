import { GraphQLResolveInfo } from 'graphql';
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

export type CreateHospitalInput = {
  address: AddressInput;
  beds?: InputMaybe<Scalars['Int']['input']>;
  departments: Array<Scalars['String']['input']>;
  email?: InputMaybe<Scalars['String']['input']>;
  emergencyServices: Scalars['Boolean']['input'];
  institutionId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  phone: Scalars['String']['input'];
  website?: InputMaybe<Scalars['String']['input']>;
};

export type CreateInstitutionInput = {
  accreditation: Array<Scalars['String']['input']>;
  address: AddressInput;
  email?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  phone: Scalars['String']['input'];
  type: InstitutionType;
  website?: InputMaybe<Scalars['String']['input']>;
};

export type Hospital = {
  __typename?: 'Hospital';
  address: Address;
  beds?: Maybe<Scalars['Int']['output']>;
  departments: Array<Scalars['String']['output']>;
  email?: Maybe<Scalars['String']['output']>;
  emergencyServices: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  institutionId: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  phone: Scalars['String']['output'];
  visits: Array<Visit>;
  website?: Maybe<Scalars['String']['output']>;
};

export type Institution = {
  __typename?: 'Institution';
  accreditation: Array<Scalars['String']['output']>;
  address: Address;
  email?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  phone: Scalars['String']['output'];
  type: InstitutionType;
  website?: Maybe<Scalars['String']['output']>;
};

export enum InstitutionType {
  ClinicNetwork = 'CLINIC_NETWORK',
  GovernmentAgency = 'GOVERNMENT_AGENCY',
  HospitalSystem = 'HOSPITAL_SYSTEM',
  MedicalCenter = 'MEDICAL_CENTER',
  ResearchInstitute = 'RESEARCH_INSTITUTE',
  University = 'UNIVERSITY'
}

export type Mutation = {
  __typename?: 'Mutation';
  createHospital?: Maybe<Hospital>;
  createInstitution?: Maybe<Institution>;
  updateHospital?: Maybe<Hospital>;
  updateInstitution?: Maybe<Institution>;
};


export type MutationCreateHospitalArgs = {
  input: CreateHospitalInput;
};


export type MutationCreateInstitutionArgs = {
  input: CreateInstitutionInput;
};


export type MutationUpdateHospitalArgs = {
  id: Scalars['ID']['input'];
  input: UpdateHospitalInput;
};


export type MutationUpdateInstitutionArgs = {
  id: Scalars['ID']['input'];
  input: UpdateInstitutionInput;
};

export type Query = {
  __typename?: 'Query';
  hospital?: Maybe<Hospital>;
  hospitals: Array<Hospital>;
  hospitalsByInstitution: Array<Hospital>;
  institution?: Maybe<Institution>;
  institutions: Array<Institution>;
};


export type QueryHospitalArgs = {
  id: Scalars['ID']['input'];
};


export type QueryHospitalsArgs = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryHospitalsByInstitutionArgs = {
  institutionId: Scalars['ID']['input'];
};


export type QueryInstitutionArgs = {
  id: Scalars['ID']['input'];
};


export type QueryInstitutionsArgs = {
  type?: InputMaybe<InstitutionType>;
};

export type UpdateHospitalInput = {
  address?: InputMaybe<AddressInput>;
  beds?: InputMaybe<Scalars['Int']['input']>;
  departments?: InputMaybe<Array<Scalars['String']['input']>>;
  email?: InputMaybe<Scalars['String']['input']>;
  emergencyServices?: InputMaybe<Scalars['Boolean']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  phone?: InputMaybe<Scalars['String']['input']>;
  website?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateInstitutionInput = {
  accreditation?: InputMaybe<Array<Scalars['String']['input']>>;
  address?: InputMaybe<AddressInput>;
  email?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  phone?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<InstitutionType>;
  website?: InputMaybe<Scalars['String']['input']>;
};

export type Visit = {
  __typename?: 'Visit';
  id: Scalars['ID']['output'];
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
  CreateHospitalInput: CreateHospitalInput;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  CreateInstitutionInput: CreateInstitutionInput;
  Hospital: ResolverTypeWrapper<Hospital>;
  Institution: ResolverTypeWrapper<Institution>;
  InstitutionType: InstitutionType;
  Mutation: ResolverTypeWrapper<{}>;
  Query: ResolverTypeWrapper<{}>;
  UpdateHospitalInput: UpdateHospitalInput;
  UpdateInstitutionInput: UpdateInstitutionInput;
  Visit: ResolverTypeWrapper<Visit>;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  Address: Address;
  String: Scalars['String']['output'];
  AddressInput: AddressInput;
  CreateHospitalInput: CreateHospitalInput;
  Int: Scalars['Int']['output'];
  Boolean: Scalars['Boolean']['output'];
  ID: Scalars['ID']['output'];
  CreateInstitutionInput: CreateInstitutionInput;
  Hospital: Hospital;
  Institution: Institution;
  Mutation: {};
  Query: {};
  UpdateHospitalInput: UpdateHospitalInput;
  UpdateInstitutionInput: UpdateInstitutionInput;
  Visit: Visit;
}>;

export type AddressResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Address'] = ResolversParentTypes['Address']> = ResolversObject<{
  city?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  country?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  street?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  zipCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type HospitalResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Hospital'] = ResolversParentTypes['Hospital']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Hospital']>, { __typename: 'Hospital' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  address?: Resolver<ResolversTypes['Address'], ParentType, ContextType>;
  beds?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  departments?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  email?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  emergencyServices?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institutionId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  phone?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  visits?: Resolver<Array<ResolversTypes['Visit']>, ParentType, ContextType>;
  website?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type InstitutionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Institution'] = ResolversParentTypes['Institution']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Institution']>, { __typename: 'Institution' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  accreditation?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  address?: Resolver<ResolversTypes['Address'], ParentType, ContextType>;
  email?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  phone?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['InstitutionType'], ParentType, ContextType>;
  website?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  createHospital?: Resolver<Maybe<ResolversTypes['Hospital']>, ParentType, ContextType, RequireFields<MutationCreateHospitalArgs, 'input'>>;
  createInstitution?: Resolver<Maybe<ResolversTypes['Institution']>, ParentType, ContextType, RequireFields<MutationCreateInstitutionArgs, 'input'>>;
  updateHospital?: Resolver<Maybe<ResolversTypes['Hospital']>, ParentType, ContextType, RequireFields<MutationUpdateHospitalArgs, 'id' | 'input'>>;
  updateInstitution?: Resolver<Maybe<ResolversTypes['Institution']>, ParentType, ContextType, RequireFields<MutationUpdateInstitutionArgs, 'id' | 'input'>>;
}>;

export type QueryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  hospital?: Resolver<Maybe<ResolversTypes['Hospital']>, ParentType, ContextType, RequireFields<QueryHospitalArgs, 'id'>>;
  hospitals?: Resolver<Array<ResolversTypes['Hospital']>, ParentType, ContextType, Partial<QueryHospitalsArgs>>;
  hospitalsByInstitution?: Resolver<Array<ResolversTypes['Hospital']>, ParentType, ContextType, RequireFields<QueryHospitalsByInstitutionArgs, 'institutionId'>>;
  institution?: Resolver<Maybe<ResolversTypes['Institution']>, ParentType, ContextType, RequireFields<QueryInstitutionArgs, 'id'>>;
  institutions?: Resolver<Array<ResolversTypes['Institution']>, ParentType, ContextType, Partial<QueryInstitutionsArgs>>;
}>;

export type VisitResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Visit'] = ResolversParentTypes['Visit']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type Resolvers<ContextType = DataSourceContext> = ResolversObject<{
  Address?: AddressResolvers<ContextType>;
  Hospital?: HospitalResolvers<ContextType>;
  Institution?: InstitutionResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  Visit?: VisitResolvers<ContextType>;
}>;

