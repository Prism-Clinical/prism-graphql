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

export type AdminRole =
  | 'ADMIN'
  | 'AUDITOR'
  | 'CLINICIAN'
  | 'READ_ONLY'
  | 'REVIEWER';

export type AdminSignupInput = {
  email: Scalars['String']['input'];
  firstName: Scalars['String']['input'];
  lastName: Scalars['String']['input'];
  password: Scalars['String']['input'];
};

export type AdminStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'PENDING'
  | 'SUSPENDED';

export type AdminUser = {
  __typename?: 'AdminUser';
  createdAt: Scalars['DateTime']['output'];
  email: Scalars['String']['output'];
  emailVerified: Scalars['Boolean']['output'];
  firstName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastLoginAt?: Maybe<Scalars['DateTime']['output']>;
  lastName: Scalars['String']['output'];
  role: AdminRole;
  status: AdminStatus;
  updatedAt: Scalars['DateTime']['output'];
};

export type ApprovalDecisionInput = {
  approved: Scalars['Boolean']['input'];
  notes?: InputMaybe<Scalars['String']['input']>;
  requestId: Scalars['ID']['input'];
};

export type ApprovalResult = {
  __typename?: 'ApprovalResult';
  message: Scalars['String']['output'];
  providerUser?: Maybe<ProviderUser>;
  success: Scalars['Boolean']['output'];
};

export type ApprovalStatus =
  | 'APPROVED'
  | 'PENDING'
  | 'REJECTED';

export type ApprovedDomain = {
  __typename?: 'ApprovedDomain';
  domain: Scalars['String']['output'];
  domainType: DomainType;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  organizationName: Scalars['String']['output'];
};

export type AuthPayload = {
  __typename?: 'AuthPayload';
  accessToken: Scalars['String']['output'];
  expiresIn: Scalars['Int']['output'];
  refreshToken: Scalars['String']['output'];
  user: AuthUser;
};

export type AuthUser = {
  __typename?: 'AuthUser';
  email: Scalars['String']['output'];
  emailVerified: Scalars['Boolean']['output'];
  firstName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  institutionId?: Maybe<Scalars['ID']['output']>;
  lastName: Scalars['String']['output'];
  providerId?: Maybe<Scalars['ID']['output']>;
  roles: Array<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  userType: UserType;
};

export type ChangePasswordInput = {
  currentPassword: Scalars['String']['input'];
  newPassword: Scalars['String']['input'];
};

export type CreateApprovedDomainInput = {
  domain: Scalars['String']['input'];
  domainType: DomainType;
  organizationName: Scalars['String']['input'];
};

export type CreateInstitutionInput = {
  addressCity?: InputMaybe<Scalars['String']['input']>;
  addressState?: InputMaybe<Scalars['String']['input']>;
  addressStreet?: InputMaybe<Scalars['String']['input']>;
  addressZip?: InputMaybe<Scalars['String']['input']>;
  code: Scalars['String']['input'];
  domain?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
};

export type DomainType =
  | 'ACADEMIC'
  | 'CLINIC'
  | 'HOSPITAL'
  | 'INTERNAL'
  | 'RESEARCH';

export type EmailVerificationResult = {
  __typename?: 'EmailVerificationResult';
  message: Scalars['String']['output'];
  success: Scalars['Boolean']['output'];
};

export type Institution = {
  __typename?: 'Institution';
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  domain?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
};

export type LoginInput = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
  userType: UserType;
};

export type Mutation = {
  __typename?: 'Mutation';
  adminSignup: AuthPayload;
  approveProvider: ApprovalResult;
  changePassword: PasswordResetResult;
  createApprovedDomain: ApprovedDomain;
  createInstitution: Institution;
  deactivateDomain: ApprovedDomain;
  deactivateInstitution: Institution;
  login: AuthPayload;
  logout: Scalars['Boolean']['output'];
  providerSignup: EmailVerificationResult;
  refreshToken: AuthPayload;
  requestPasswordReset: PasswordResetResult;
  resendVerificationEmail: EmailVerificationResult;
  resetPassword: PasswordResetResult;
  verifyEmail: EmailVerificationResult;
};


export type MutationAdminSignupArgs = {
  input: AdminSignupInput;
};


export type MutationApproveProviderArgs = {
  input: ApprovalDecisionInput;
};


export type MutationChangePasswordArgs = {
  input: ChangePasswordInput;
};


export type MutationCreateApprovedDomainArgs = {
  input: CreateApprovedDomainInput;
};


export type MutationCreateInstitutionArgs = {
  input: CreateInstitutionInput;
};


export type MutationDeactivateDomainArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeactivateInstitutionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationProviderSignupArgs = {
  input: ProviderSignupInput;
};


export type MutationRefreshTokenArgs = {
  input: RefreshTokenInput;
};


export type MutationRequestPasswordResetArgs = {
  input: PasswordResetRequestInput;
};


export type MutationResendVerificationEmailArgs = {
  email: Scalars['String']['input'];
  userType: UserType;
};


export type MutationResetPasswordArgs = {
  input: PasswordResetInput;
};


export type MutationVerifyEmailArgs = {
  token: Scalars['String']['input'];
};

export type NpiValidationResult = {
  __typename?: 'NPIValidationResult';
  error?: Maybe<Scalars['String']['output']>;
  isValid: Scalars['Boolean']['output'];
  providerName?: Maybe<Scalars['String']['output']>;
  specialty?: Maybe<Scalars['String']['output']>;
};

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor?: Maybe<Scalars['String']['output']>;
};

export type PasswordResetInput = {
  newPassword: Scalars['String']['input'];
  token: Scalars['String']['input'];
};

export type PasswordResetRequestInput = {
  email: Scalars['String']['input'];
  userType: UserType;
};

export type PasswordResetResult = {
  __typename?: 'PasswordResetResult';
  message: Scalars['String']['output'];
  success: Scalars['Boolean']['output'];
};

export type ProviderApprovalConnection = {
  __typename?: 'ProviderApprovalConnection';
  edges: Array<ProviderApprovalEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ProviderApprovalEdge = {
  __typename?: 'ProviderApprovalEdge';
  cursor: Scalars['String']['output'];
  node: ProviderApprovalRequest;
};

export type ProviderApprovalRequest = {
  __typename?: 'ProviderApprovalRequest';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  providerUser: ProviderUser;
  reviewNotes?: Maybe<Scalars['String']['output']>;
  reviewedAt?: Maybe<Scalars['DateTime']['output']>;
  reviewedBy?: Maybe<AdminUser>;
  status: ApprovalStatus;
};

export type ProviderRole =
  | 'CARE_COORDINATOR'
  | 'NURSE'
  | 'PHARMACIST'
  | 'PHYSICIAN';

export type ProviderSignupInput = {
  email: Scalars['String']['input'];
  firstName: Scalars['String']['input'];
  institutionCode: Scalars['String']['input'];
  lastName: Scalars['String']['input'];
  npi: Scalars['String']['input'];
  password: Scalars['String']['input'];
  role: ProviderRole;
};

export type ProviderStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'PENDING_APPROVAL'
  | 'PENDING_VERIFICATION'
  | 'SUSPENDED';

export type ProviderUser = {
  __typename?: 'ProviderUser';
  adminApproved: Scalars['Boolean']['output'];
  createdAt: Scalars['DateTime']['output'];
  email: Scalars['String']['output'];
  emailVerified: Scalars['Boolean']['output'];
  firstName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  institution?: Maybe<Institution>;
  lastLoginAt?: Maybe<Scalars['DateTime']['output']>;
  lastName: Scalars['String']['output'];
  npi: Scalars['String']['output'];
  npiVerified: Scalars['Boolean']['output'];
  role: ProviderRole;
  status: ProviderStatus;
  updatedAt: Scalars['DateTime']['output'];
};

export type Query = {
  __typename?: 'Query';
  approvedDomains: Array<ApprovedDomain>;
  institution?: Maybe<Institution>;
  institutionByCode?: Maybe<Institution>;
  institutions: Array<Institution>;
  isApprovedDomain: Scalars['Boolean']['output'];
  me?: Maybe<AuthUser>;
  pendingApprovals: ProviderApprovalConnection;
  validateNPI: NpiValidationResult;
  validateToken: TokenValidationResult;
};


export type QueryInstitutionArgs = {
  id: Scalars['ID']['input'];
};


export type QueryInstitutionByCodeArgs = {
  code: Scalars['String']['input'];
};


export type QueryIsApprovedDomainArgs = {
  domain: Scalars['String']['input'];
};


export type QueryPendingApprovalsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryValidateNpiArgs = {
  npi: Scalars['String']['input'];
};


export type QueryValidateTokenArgs = {
  token: Scalars['String']['input'];
};

export type RefreshTokenInput = {
  refreshToken: Scalars['String']['input'];
};

export type TokenValidationResult = {
  __typename?: 'TokenValidationResult';
  error?: Maybe<Scalars['String']['output']>;
  isValid: Scalars['Boolean']['output'];
  user?: Maybe<AuthUser>;
};

export type UserType =
  | 'ADMIN'
  | 'PROVIDER';

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
  AdminRole: AdminRole;
  AdminSignupInput: AdminSignupInput;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  AdminStatus: AdminStatus;
  AdminUser: ResolverTypeWrapper<AdminUser>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  ApprovalDecisionInput: ApprovalDecisionInput;
  ApprovalResult: ResolverTypeWrapper<ApprovalResult>;
  ApprovalStatus: ApprovalStatus;
  ApprovedDomain: ResolverTypeWrapper<ApprovedDomain>;
  AuthPayload: ResolverTypeWrapper<AuthPayload>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  AuthUser: ResolverTypeWrapper<AuthUser>;
  ChangePasswordInput: ChangePasswordInput;
  CreateApprovedDomainInput: CreateApprovedDomainInput;
  CreateInstitutionInput: CreateInstitutionInput;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  DomainType: DomainType;
  EmailVerificationResult: ResolverTypeWrapper<EmailVerificationResult>;
  Institution: ResolverTypeWrapper<Institution>;
  LoginInput: LoginInput;
  Mutation: ResolverTypeWrapper<{}>;
  NPIValidationResult: ResolverTypeWrapper<NpiValidationResult>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  PasswordResetInput: PasswordResetInput;
  PasswordResetRequestInput: PasswordResetRequestInput;
  PasswordResetResult: ResolverTypeWrapper<PasswordResetResult>;
  ProviderApprovalConnection: ResolverTypeWrapper<ProviderApprovalConnection>;
  ProviderApprovalEdge: ResolverTypeWrapper<ProviderApprovalEdge>;
  ProviderApprovalRequest: ResolverTypeWrapper<ProviderApprovalRequest>;
  ProviderRole: ProviderRole;
  ProviderSignupInput: ProviderSignupInput;
  ProviderStatus: ProviderStatus;
  ProviderUser: ResolverTypeWrapper<ProviderUser>;
  Query: ResolverTypeWrapper<{}>;
  RefreshTokenInput: RefreshTokenInput;
  TokenValidationResult: ResolverTypeWrapper<TokenValidationResult>;
  UserType: UserType;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  AdminSignupInput: AdminSignupInput;
  String: Scalars['String']['output'];
  AdminUser: AdminUser;
  Boolean: Scalars['Boolean']['output'];
  ID: Scalars['ID']['output'];
  ApprovalDecisionInput: ApprovalDecisionInput;
  ApprovalResult: ApprovalResult;
  ApprovedDomain: ApprovedDomain;
  AuthPayload: AuthPayload;
  Int: Scalars['Int']['output'];
  AuthUser: AuthUser;
  ChangePasswordInput: ChangePasswordInput;
  CreateApprovedDomainInput: CreateApprovedDomainInput;
  CreateInstitutionInput: CreateInstitutionInput;
  DateTime: Scalars['DateTime']['output'];
  EmailVerificationResult: EmailVerificationResult;
  Institution: Institution;
  LoginInput: LoginInput;
  Mutation: {};
  NPIValidationResult: NpiValidationResult;
  PageInfo: PageInfo;
  PasswordResetInput: PasswordResetInput;
  PasswordResetRequestInput: PasswordResetRequestInput;
  PasswordResetResult: PasswordResetResult;
  ProviderApprovalConnection: ProviderApprovalConnection;
  ProviderApprovalEdge: ProviderApprovalEdge;
  ProviderApprovalRequest: ProviderApprovalRequest;
  ProviderSignupInput: ProviderSignupInput;
  ProviderUser: ProviderUser;
  Query: {};
  RefreshTokenInput: RefreshTokenInput;
  TokenValidationResult: TokenValidationResult;
}>;

export type AdminUserResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['AdminUser'] = ResolversParentTypes['AdminUser']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['AdminUser']>, { __typename: 'AdminUser' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  emailVerified?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  firstName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lastLoginAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  lastName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['AdminRole'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['AdminStatus'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ApprovalResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ApprovalResult'] = ResolversParentTypes['ApprovalResult']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  providerUser?: Resolver<Maybe<ResolversTypes['ProviderUser']>, ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ApprovedDomainResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ApprovedDomain'] = ResolversParentTypes['ApprovedDomain']> = ResolversObject<{
  domain?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  domainType?: Resolver<ResolversTypes['DomainType'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  organizationName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type AuthPayloadResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['AuthPayload'] = ResolversParentTypes['AuthPayload']> = ResolversObject<{
  accessToken?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  expiresIn?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  refreshToken?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  user?: Resolver<ResolversTypes['AuthUser'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type AuthUserResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['AuthUser'] = ResolversParentTypes['AuthUser']> = ResolversObject<{
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  emailVerified?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  firstName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institutionId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  lastName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  providerId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  roles?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  userType?: Resolver<ResolversTypes['UserType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type EmailVerificationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['EmailVerificationResult'] = ResolversParentTypes['EmailVerificationResult']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type InstitutionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Institution'] = ResolversParentTypes['Institution']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Institution']>, { __typename: 'Institution' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  domain?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  adminSignup?: Resolver<ResolversTypes['AuthPayload'], ParentType, ContextType, RequireFields<MutationAdminSignupArgs, 'input'>>;
  approveProvider?: Resolver<ResolversTypes['ApprovalResult'], ParentType, ContextType, RequireFields<MutationApproveProviderArgs, 'input'>>;
  changePassword?: Resolver<ResolversTypes['PasswordResetResult'], ParentType, ContextType, RequireFields<MutationChangePasswordArgs, 'input'>>;
  createApprovedDomain?: Resolver<ResolversTypes['ApprovedDomain'], ParentType, ContextType, RequireFields<MutationCreateApprovedDomainArgs, 'input'>>;
  createInstitution?: Resolver<ResolversTypes['Institution'], ParentType, ContextType, RequireFields<MutationCreateInstitutionArgs, 'input'>>;
  deactivateDomain?: Resolver<ResolversTypes['ApprovedDomain'], ParentType, ContextType, RequireFields<MutationDeactivateDomainArgs, 'id'>>;
  deactivateInstitution?: Resolver<ResolversTypes['Institution'], ParentType, ContextType, RequireFields<MutationDeactivateInstitutionArgs, 'id'>>;
  login?: Resolver<ResolversTypes['AuthPayload'], ParentType, ContextType, RequireFields<MutationLoginArgs, 'input'>>;
  logout?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  providerSignup?: Resolver<ResolversTypes['EmailVerificationResult'], ParentType, ContextType, RequireFields<MutationProviderSignupArgs, 'input'>>;
  refreshToken?: Resolver<ResolversTypes['AuthPayload'], ParentType, ContextType, RequireFields<MutationRefreshTokenArgs, 'input'>>;
  requestPasswordReset?: Resolver<ResolversTypes['PasswordResetResult'], ParentType, ContextType, RequireFields<MutationRequestPasswordResetArgs, 'input'>>;
  resendVerificationEmail?: Resolver<ResolversTypes['EmailVerificationResult'], ParentType, ContextType, RequireFields<MutationResendVerificationEmailArgs, 'email' | 'userType'>>;
  resetPassword?: Resolver<ResolversTypes['PasswordResetResult'], ParentType, ContextType, RequireFields<MutationResetPasswordArgs, 'input'>>;
  verifyEmail?: Resolver<ResolversTypes['EmailVerificationResult'], ParentType, ContextType, RequireFields<MutationVerifyEmailArgs, 'token'>>;
}>;

export type NpiValidationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['NPIValidationResult'] = ResolversParentTypes['NPIValidationResult']> = ResolversObject<{
  error?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  isValid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  providerName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  specialty?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PageInfoResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = ResolversObject<{
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  hasPreviousPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  startCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PasswordResetResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PasswordResetResult'] = ResolversParentTypes['PasswordResetResult']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ProviderApprovalConnectionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ProviderApprovalConnection'] = ResolversParentTypes['ProviderApprovalConnection']> = ResolversObject<{
  edges?: Resolver<Array<ResolversTypes['ProviderApprovalEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ProviderApprovalEdgeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ProviderApprovalEdge'] = ResolversParentTypes['ProviderApprovalEdge']> = ResolversObject<{
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['ProviderApprovalRequest'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ProviderApprovalRequestResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ProviderApprovalRequest'] = ResolversParentTypes['ProviderApprovalRequest']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  providerUser?: Resolver<ResolversTypes['ProviderUser'], ParentType, ContextType>;
  reviewNotes?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  reviewedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  reviewedBy?: Resolver<Maybe<ResolversTypes['AdminUser']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['ApprovalStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ProviderUserResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ProviderUser'] = ResolversParentTypes['ProviderUser']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['ProviderUser']>, { __typename: 'ProviderUser' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  adminApproved?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  emailVerified?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  firstName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institution?: Resolver<Maybe<ResolversTypes['Institution']>, ParentType, ContextType>;
  lastLoginAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  lastName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  npi?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  npiVerified?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['ProviderRole'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['ProviderStatus'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  approvedDomains?: Resolver<Array<ResolversTypes['ApprovedDomain']>, ParentType, ContextType>;
  institution?: Resolver<Maybe<ResolversTypes['Institution']>, ParentType, ContextType, RequireFields<QueryInstitutionArgs, 'id'>>;
  institutionByCode?: Resolver<Maybe<ResolversTypes['Institution']>, ParentType, ContextType, RequireFields<QueryInstitutionByCodeArgs, 'code'>>;
  institutions?: Resolver<Array<ResolversTypes['Institution']>, ParentType, ContextType>;
  isApprovedDomain?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<QueryIsApprovedDomainArgs, 'domain'>>;
  me?: Resolver<Maybe<ResolversTypes['AuthUser']>, ParentType, ContextType>;
  pendingApprovals?: Resolver<ResolversTypes['ProviderApprovalConnection'], ParentType, ContextType, Partial<QueryPendingApprovalsArgs>>;
  validateNPI?: Resolver<ResolversTypes['NPIValidationResult'], ParentType, ContextType, RequireFields<QueryValidateNpiArgs, 'npi'>>;
  validateToken?: Resolver<ResolversTypes['TokenValidationResult'], ParentType, ContextType, RequireFields<QueryValidateTokenArgs, 'token'>>;
}>;

export type TokenValidationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['TokenValidationResult'] = ResolversParentTypes['TokenValidationResult']> = ResolversObject<{
  error?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  isValid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  user?: Resolver<Maybe<ResolversTypes['AuthUser']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type Resolvers<ContextType = DataSourceContext> = ResolversObject<{
  AdminUser?: AdminUserResolvers<ContextType>;
  ApprovalResult?: ApprovalResultResolvers<ContextType>;
  ApprovedDomain?: ApprovedDomainResolvers<ContextType>;
  AuthPayload?: AuthPayloadResolvers<ContextType>;
  AuthUser?: AuthUserResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  EmailVerificationResult?: EmailVerificationResultResolvers<ContextType>;
  Institution?: InstitutionResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  NPIValidationResult?: NpiValidationResultResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  PasswordResetResult?: PasswordResetResultResolvers<ContextType>;
  ProviderApprovalConnection?: ProviderApprovalConnectionResolvers<ContextType>;
  ProviderApprovalEdge?: ProviderApprovalEdgeResolvers<ContextType>;
  ProviderApprovalRequest?: ProviderApprovalRequestResolvers<ContextType>;
  ProviderUser?: ProviderUserResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  TokenValidationResult?: TokenValidationResultResolvers<ContextType>;
}>;

