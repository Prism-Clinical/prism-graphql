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

export type CreateRecommendationItemInput = {
  category: Scalars['String']['input'];
  contraindications: Array<Scalars['String']['input']>;
  description: Scalars['String']['input'];
  evidenceLevel: EvidenceLevel;
  guidelines: Array<Scalars['String']['input']>;
  instructions?: InputMaybe<Scalars['String']['input']>;
  sideEffects: Array<Scalars['String']['input']>;
  studyReferences: Array<Scalars['String']['input']>;
  title: Scalars['String']['input'];
  type: RecommendationItemType;
};

export enum EvidenceLevel {
  Consensus = 'CONSENSUS',
  ExpertOpinion = 'EXPERT_OPINION',
  LevelI = 'LEVEL_I',
  LevelIi = 'LEVEL_II',
  LevelIii = 'LEVEL_III',
  LevelIv = 'LEVEL_IV',
  LevelV = 'LEVEL_V'
}

export type Mutation = {
  __typename?: 'Mutation';
  createRecommendationItem?: Maybe<RecommendationItem>;
  deleteRecommendationItem?: Maybe<Scalars['Boolean']['output']>;
  updateRecommendationItem?: Maybe<RecommendationItem>;
};


export type MutationCreateRecommendationItemArgs = {
  input: CreateRecommendationItemInput;
};


export type MutationDeleteRecommendationItemArgs = {
  id: Scalars['ID']['input'];
};


export type MutationUpdateRecommendationItemArgs = {
  id: Scalars['ID']['input'];
  input: UpdateRecommendationItemInput;
};

export type Query = {
  __typename?: 'Query';
  itemsByCategory: Array<RecommendationItem>;
  itemsByEvidenceLevel: Array<RecommendationItem>;
  itemsByType: Array<RecommendationItem>;
  recommendationItem?: Maybe<RecommendationItem>;
  recommendationItems: Array<RecommendationItem>;
  searchRecommendationItems: Array<RecommendationItem>;
};


export type QueryItemsByCategoryArgs = {
  category: Scalars['String']['input'];
};


export type QueryItemsByEvidenceLevelArgs = {
  evidenceLevel: EvidenceLevel;
};


export type QueryItemsByTypeArgs = {
  type: RecommendationItemType;
};


export type QueryRecommendationItemArgs = {
  id: Scalars['ID']['input'];
};


export type QuerySearchRecommendationItemsArgs = {
  searchTerm: Scalars['String']['input'];
};

export type Recommendation = {
  __typename?: 'Recommendation';
  id: Scalars['ID']['output'];
  items: Array<RecommendationItem>;
};

export type RecommendationItem = {
  __typename?: 'RecommendationItem';
  category: Scalars['String']['output'];
  contraindications: Array<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  evidenceLevel: EvidenceLevel;
  guidelines: Array<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  instructions?: Maybe<Scalars['String']['output']>;
  isActive: Scalars['Boolean']['output'];
  sideEffects: Array<Scalars['String']['output']>;
  studyReferences: Array<Scalars['String']['output']>;
  title: Scalars['String']['output'];
  type: RecommendationItemType;
};

export enum RecommendationItemType {
  Education = 'EDUCATION',
  FollowUp = 'FOLLOW_UP',
  Imaging = 'IMAGING',
  LabTest = 'LAB_TEST',
  Lifestyle = 'LIFESTYLE',
  Medication = 'MEDICATION',
  Procedure = 'PROCEDURE',
  Screening = 'SCREENING',
  Therapy = 'THERAPY',
  Vaccination = 'VACCINATION'
}

export type UpdateRecommendationItemInput = {
  category?: InputMaybe<Scalars['String']['input']>;
  contraindications?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  evidenceLevel?: InputMaybe<EvidenceLevel>;
  guidelines?: InputMaybe<Array<Scalars['String']['input']>>;
  instructions?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  sideEffects?: InputMaybe<Array<Scalars['String']['input']>>;
  studyReferences?: InputMaybe<Array<Scalars['String']['input']>>;
  title?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<RecommendationItemType>;
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
  CreateRecommendationItemInput: CreateRecommendationItemInput;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  EvidenceLevel: EvidenceLevel;
  Mutation: ResolverTypeWrapper<{}>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Query: ResolverTypeWrapper<{}>;
  Recommendation: ResolverTypeWrapper<Recommendation>;
  RecommendationItem: ResolverTypeWrapper<RecommendationItem>;
  RecommendationItemType: RecommendationItemType;
  UpdateRecommendationItemInput: UpdateRecommendationItemInput;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  CreateRecommendationItemInput: CreateRecommendationItemInput;
  String: Scalars['String']['output'];
  DateTime: Scalars['DateTime']['output'];
  Mutation: {};
  Boolean: Scalars['Boolean']['output'];
  ID: Scalars['ID']['output'];
  Query: {};
  Recommendation: Recommendation;
  RecommendationItem: RecommendationItem;
  UpdateRecommendationItemInput: UpdateRecommendationItemInput;
}>;

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type MutationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  createRecommendationItem?: Resolver<Maybe<ResolversTypes['RecommendationItem']>, ParentType, ContextType, RequireFields<MutationCreateRecommendationItemArgs, 'input'>>;
  deleteRecommendationItem?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType, RequireFields<MutationDeleteRecommendationItemArgs, 'id'>>;
  updateRecommendationItem?: Resolver<Maybe<ResolversTypes['RecommendationItem']>, ParentType, ContextType, RequireFields<MutationUpdateRecommendationItemArgs, 'id' | 'input'>>;
}>;

export type QueryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  itemsByCategory?: Resolver<Array<ResolversTypes['RecommendationItem']>, ParentType, ContextType, RequireFields<QueryItemsByCategoryArgs, 'category'>>;
  itemsByEvidenceLevel?: Resolver<Array<ResolversTypes['RecommendationItem']>, ParentType, ContextType, RequireFields<QueryItemsByEvidenceLevelArgs, 'evidenceLevel'>>;
  itemsByType?: Resolver<Array<ResolversTypes['RecommendationItem']>, ParentType, ContextType, RequireFields<QueryItemsByTypeArgs, 'type'>>;
  recommendationItem?: Resolver<Maybe<ResolversTypes['RecommendationItem']>, ParentType, ContextType, RequireFields<QueryRecommendationItemArgs, 'id'>>;
  recommendationItems?: Resolver<Array<ResolversTypes['RecommendationItem']>, ParentType, ContextType>;
  searchRecommendationItems?: Resolver<Array<ResolversTypes['RecommendationItem']>, ParentType, ContextType, RequireFields<QuerySearchRecommendationItemsArgs, 'searchTerm'>>;
}>;

export type RecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Recommendation'] = ResolversParentTypes['Recommendation']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Recommendation']>, { __typename: 'Recommendation' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['RecommendationItem']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type RecommendationItemResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['RecommendationItem'] = ResolversParentTypes['RecommendationItem']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['RecommendationItem']>, { __typename: 'RecommendationItem' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  category?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  contraindications?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  evidenceLevel?: Resolver<ResolversTypes['EvidenceLevel'], ParentType, ContextType>;
  guidelines?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  instructions?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  sideEffects?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  studyReferences?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['RecommendationItemType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type Resolvers<ContextType = DataSourceContext> = ResolversObject<{
  DateTime?: GraphQLScalarType;
  Mutation?: MutationResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  Recommendation?: RecommendationResolvers<ContextType>;
  RecommendationItem?: RecommendationItemResolvers<ContextType>;
}>;

