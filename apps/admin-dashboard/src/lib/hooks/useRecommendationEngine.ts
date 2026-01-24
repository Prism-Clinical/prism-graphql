import { useState, useCallback } from 'react';
import { useQuery, useLazyQuery, useMutation } from '@apollo/client';
import {
  ENGINE_RECOMMEND,
  ENGINE_EXPLAIN_SESSION,
  GET_VARIANT_GROUPS,
  GET_VARIANT_GROUP,
  GET_SELECTION_RULES,
  GET_ENGINE_ANALYTICS,
  GET_ENGINE_CONFIGURATION,
} from '../graphql/queries/recommendationEngine';
import {
  RECORD_RECOMMENDATION_OUTCOME,
  CREATE_VARIANT_GROUP,
  CREATE_VARIANT,
  CREATE_SELECTION_RULE,
  DELETE_SELECTION_RULE,
  UPDATE_VARIANT,
  DELETE_VARIANT,
  UPDATE_SELECTION_RULE,
  UPDATE_VARIANT_GROUP,
  DELETE_VARIANT_GROUP,
  SAVE_MATCHING_CONFIG,
  SAVE_PERSONALIZATION_CONFIG,
} from '../graphql/mutations/recommendationEngine';

// Types

export interface MatchReason {
  reasonType: string;
  description: string;
  scoreImpact: number;
  metadata?: Record<string, any>;
}

export interface Recommendation {
  carePlanId: string;
  title: string;
  conditionCodes: string[];
  score: number;
  rank: number;
  matchType?: string;
  matchedCodes?: string[];
  variantGroupId?: string;
  variantGroupName?: string;
  variantId?: string;
  variantName?: string;
  embeddingSimilarity?: number;
  selectionScore?: number;
  personalizationScore?: number;
  reasons: MatchReason[];
}

export interface LayerSummary {
  layer: number;
  layerName: string;
  candidateCount: number;
  processingTimeMs: number;
  metadata?: Record<string, any>;
}

export interface RecommendationResult {
  sessionId: string;
  recommendations: Recommendation[];
  layerSummaries: LayerSummary[];
  totalProcessingTimeMs: number;
  engineVersion: string;
}

export interface Variant {
  id: string;
  variantGroupId: string;
  carePlanId: string;
  variantName: string;
  targetAgeMin?: number;
  targetAgeMax?: number;
  targetSex?: string;
  targetConditions?: string[];
  targetRiskFactors?: string[];
  exclusionConditions?: string[];
  priorityScore: number;
  isDefault: boolean;
}

export interface VariantGroup {
  id: string;
  name: string;
  description?: string;
  conditionCodes: string[];
  isActive: boolean;
  createdAt: string;
  variants: Variant[];
}

export interface SelectionRule {
  id: string;
  variantGroupId?: string;
  name: string;
  description?: string;
  ruleDefinition: Record<string, any>;
  priority: number;
  isActive: boolean;
  createdAt: string;
}

export interface RuleCondition {
  field: string;
  operator: string;
  value: any;
}

export interface RuleAction {
  score_adjustment: number;
  description?: string;
}

export interface PatientContext {
  condition_codes: string[];
  age?: number;
  sex?: string;
  medication_codes?: string[];
  lab_codes?: string[];
  lab_values?: Record<string, number>;
  comorbidities?: string[];
  risk_factors?: string[];
  patient_id?: string;
  provider_id?: string;
  clinical_notes?: string;
}

export interface AnalyticsSummary {
  totalSessions: number;
  averageProcessingTimeMs: number;
  topMatchTypes: Record<string, number>;
  topConditionCodes: Record<string, number>;
  acceptanceRate: number;
  period: string;
}

// Helper to transform PatientContext to GraphQL input format
function toGraphQLPatientContext(context: PatientContext) {
  return {
    conditionCodes: context.condition_codes,
    age: context.age,
    sex: context.sex,
    medicationCodes: context.medication_codes,
    labCodes: context.lab_codes,
    labValues: context.lab_values,
    comorbidities: context.comorbidities,
    riskFactors: context.risk_factors,
    patientId: context.patient_id,
    providerId: context.provider_id,
    clinicalNotes: context.clinical_notes,
  };
}

// Helper to transform GraphQL response to snake_case format (for backwards compatibility)
function toSnakeCaseResult(data: any): RecommendationResult | null {
  if (!data?.engineRecommend) return null;

  const result = data.engineRecommend;
  return {
    sessionId: result.sessionId,
    recommendations: result.recommendations.map((r: any) => ({
      carePlanId: r.carePlanId,
      title: r.title,
      conditionCodes: r.conditionCodes,
      score: r.score,
      rank: r.rank,
      matchType: r.matchType,
      matchedCodes: r.matchedCodes,
      variantGroupId: r.variantGroupId,
      variantGroupName: r.variantGroupName,
      variantId: r.variantId,
      variantName: r.variantName,
      embeddingSimilarity: r.embeddingSimilarity,
      selectionScore: r.selectionScore,
      personalizationScore: r.personalizationScore,
      reasons: r.reasons.map((reason: any) => ({
        reasonType: reason.reasonType,
        description: reason.description,
        scoreImpact: reason.scoreImpact,
        metadata: reason.metadata,
      })),
    })),
    layerSummaries: result.layerSummaries.map((l: any) => ({
      layer: l.layer,
      layerName: l.layerName,
      candidateCount: l.candidateCount,
      processingTimeMs: l.processingTimeMs,
      metadata: l.metadata,
    })),
    totalProcessingTimeMs: result.totalProcessingTimeMs,
    engineVersion: result.engineVersion,
  };
}

// ============================================================================
// Recommendation Hooks
// ============================================================================

/**
 * Generate recommendations using the three-layer engine
 */
export function useRecommend() {
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [executeQuery, { loading, error }] = useLazyQuery(ENGINE_RECOMMEND, {
    fetchPolicy: 'network-only',
  });

  const recommend = useCallback(
    async (
      patientContext: PatientContext,
      options?: { maxResults?: number; enablePersonalization?: boolean }
    ) => {
      const { data } = await executeQuery({
        variables: {
          input: {
            patientContext: toGraphQLPatientContext(patientContext),
            maxResults: options?.maxResults ?? 5,
            enablePersonalization: options?.enablePersonalization ?? true,
          },
        },
      });

      const transformedResult = toSnakeCaseResult(data);
      setResult(transformedResult);
      return transformedResult;
    },
    [executeQuery]
  );

  return { recommend, result, loading, error: error || null };
}

/**
 * Get detailed explanation for a recommendation session
 */
export function useExplainRecommendation() {
  const [explanation, setExplanation] = useState<any | null>(null);
  const [executeQuery, { loading, error }] = useLazyQuery(ENGINE_EXPLAIN_SESSION, {
    fetchPolicy: 'network-only',
  });

  const explain = useCallback(
    async (sessionId: string) => {
      const { data } = await executeQuery({
        variables: { sessionId },
      });

      const result = data?.engineExplainSession || null;
      setExplanation(result);
      return result;
    },
    [executeQuery]
  );

  return { explain, explanation, loading, error: error || null };
}

// ============================================================================
// Variant Group Hooks
// ============================================================================

/**
 * Fetch all variant groups
 */
export function useVariantGroups(options?: { conditionCode?: string }) {
  const { data, loading, error, refetch } = useQuery(GET_VARIANT_GROUPS, {
    variables: { conditionCode: options?.conditionCode },
    fetchPolicy: 'cache-and-network',
  });

  return {
    groups: (data?.variantGroups || []) as VariantGroup[],
    loading,
    error: error || null,
    refetch,
  };
}

/**
 * Fetch a single variant group
 */
export function useVariantGroup(groupId: string | null) {
  const { data, loading, error, refetch } = useQuery(GET_VARIANT_GROUP, {
    variables: { id: groupId },
    skip: !groupId,
    fetchPolicy: 'cache-and-network',
  });

  return {
    group: (data?.variantGroup || null) as VariantGroup | null,
    loading,
    error: error || null,
    refetch,
  };
}

/**
 * Create a variant group
 */
export function useCreateVariantGroup() {
  const [executeMutation, { loading, error }] = useMutation(CREATE_VARIANT_GROUP, {
    refetchQueries: [{ query: GET_VARIANT_GROUPS }],
  });

  const create = useCallback(
    async (input: {
      name: string;
      description?: string;
      conditionCodes: string[];
    }) => {
      const { data } = await executeMutation({
        variables: { input },
      });

      return data?.createVariantGroup as VariantGroup;
    },
    [executeMutation]
  );

  return { create, loading, error: error || null };
}

/**
 * Add a variant to a group
 */
export function useAddVariant() {
  const [executeMutation, { loading, error }] = useMutation(CREATE_VARIANT, {
    refetchQueries: [{ query: GET_VARIANT_GROUPS }],
  });

  const addVariant = useCallback(
    async (
      groupId: string,
      input: {
        carePlanId: string;
        variantName: string;
        targetAgeMin?: number;
        targetAgeMax?: number;
        targetSex?: string;
        targetConditions?: string[];
        targetRiskFactors?: string[];
        exclusionConditions?: string[];
        priorityScore?: number;
        isDefault?: boolean;
      }
    ) => {
      const { data } = await executeMutation({
        variables: {
          input: {
            variantGroupId: groupId,
            carePlanId: input.carePlanId,
            variantName: input.variantName,
            targetAgeMin: input.targetAgeMin,
            targetAgeMax: input.targetAgeMax,
            targetSex: input.targetSex,
            targetConditions: input.targetConditions,
            targetRiskFactors: input.targetRiskFactors,
            exclusionConditions: input.exclusionConditions,
            priorityScore: input.priorityScore,
            isDefault: input.isDefault,
          },
        },
      });

      return data?.createVariant as Variant;
    },
    [executeMutation]
  );

  return { addVariant, loading, error: error || null };
}

/**
 * Remove a variant from a group
 */
export function useRemoveVariant() {
  const [executeMutation, { loading, error }] = useMutation(DELETE_VARIANT, {
    refetchQueries: [{ query: GET_VARIANT_GROUPS }],
  });

  const removeVariant = useCallback(
    async (_groupId: string, variantId: string) => {
      await executeMutation({
        variables: { id: variantId },
      });
      return true;
    },
    [executeMutation]
  );

  return { removeVariant, loading, error: error || null };
}

/**
 * Update a variant
 */
export function useUpdateVariant() {
  const [executeMutation, { loading, error }] = useMutation(UPDATE_VARIANT, {
    refetchQueries: [{ query: GET_VARIANT_GROUPS }],
  });

  const updateVariant = useCallback(
    async (
      variantId: string,
      input: {
        variantName?: string;
        targetAgeMin?: number;
        targetAgeMax?: number;
        targetSex?: string;
        targetConditions?: string[];
        targetRiskFactors?: string[];
        exclusionConditions?: string[];
        priorityScore?: number;
        isDefault?: boolean;
      }
    ) => {
      const { data } = await executeMutation({
        variables: { id: variantId, input },
      });

      return data?.updateVariant as Variant;
    },
    [executeMutation]
  );

  return { updateVariant, loading, error: error || null };
}

// ============================================================================
// Selection Rules Hooks
// ============================================================================

/**
 * Fetch selection rules
 */
export function useSelectionRules(options?: { variantGroupId?: string; isActive?: boolean }) {
  const { data, loading, error, refetch } = useQuery(GET_SELECTION_RULES, {
    variables: {
      variantGroupId: options?.variantGroupId,
      isActive: options?.isActive,
    },
    fetchPolicy: 'cache-and-network',
  });

  return {
    rules: (data?.selectionRules || []) as SelectionRule[],
    loading,
    error: error || null,
    refetch,
  };
}

/**
 * Create a selection rule
 */
export function useCreateSelectionRule() {
  const [executeMutation, { loading, error }] = useMutation(CREATE_SELECTION_RULE, {
    refetchQueries: [{ query: GET_SELECTION_RULES }],
  });

  const create = useCallback(
    async (input: {
      variantGroupId?: string;
      name: string;
      description?: string;
      ruleDefinition: Record<string, any>;
      priority?: number;
    }) => {
      const { data } = await executeMutation({
        variables: { input },
      });

      return data?.createSelectionRule as SelectionRule;
    },
    [executeMutation]
  );

  return { create, loading, error: error || null };
}

/**
 * Delete a selection rule
 */
export function useDeleteSelectionRule() {
  const [executeMutation, { loading, error }] = useMutation(DELETE_SELECTION_RULE, {
    refetchQueries: [{ query: GET_SELECTION_RULES }],
  });

  const deleteRule = useCallback(
    async (ruleId: string) => {
      await executeMutation({
        variables: { id: ruleId },
      });
      return true;
    },
    [executeMutation]
  );

  return { deleteRule, loading, error: error || null };
}

/**
 * Update a selection rule
 */
export function useUpdateSelectionRule() {
  const [executeMutation, { loading, error }] = useMutation(UPDATE_SELECTION_RULE, {
    refetchQueries: [{ query: GET_SELECTION_RULES }],
  });

  const updateRule = useCallback(
    async (
      ruleId: string,
      input: {
        name?: string;
        description?: string;
        ruleDefinition?: Record<string, any>;
        priority?: number;
        isActive?: boolean;
      }
    ) => {
      const { data } = await executeMutation({
        variables: { id: ruleId, input },
      });

      return data?.updateSelectionRule as SelectionRule;
    },
    [executeMutation]
  );

  return { updateRule, loading, error: error || null };
}

/**
 * Update a variant group
 */
export function useUpdateVariantGroup() {
  const [executeMutation, { loading, error }] = useMutation(UPDATE_VARIANT_GROUP, {
    refetchQueries: [{ query: GET_VARIANT_GROUPS }],
  });

  const updateGroup = useCallback(
    async (
      groupId: string,
      input: {
        name?: string;
        description?: string;
        conditionCodes?: string[];
        isActive?: boolean;
      }
    ) => {
      const { data } = await executeMutation({
        variables: { id: groupId, input },
      });

      return data?.updateVariantGroup as VariantGroup;
    },
    [executeMutation]
  );

  return { updateGroup, loading, error: error || null };
}

/**
 * Delete a variant group
 */
export function useDeleteVariantGroup() {
  const [executeMutation, { loading, error }] = useMutation(DELETE_VARIANT_GROUP, {
    refetchQueries: [{ query: GET_VARIANT_GROUPS }],
  });

  const deleteGroup = useCallback(
    async (groupId: string) => {
      await executeMutation({
        variables: { id: groupId },
      });
      return true;
    },
    [executeMutation]
  );

  return { deleteGroup, loading, error: error || null };
}

// ============================================================================
// Analytics Hooks
// ============================================================================

/**
 * Fetch analytics summary
 */
export function useAnalyticsSummary(days: number = 7) {
  const { data, loading, error, refetch } = useQuery(GET_ENGINE_ANALYTICS, {
    variables: { days },
    fetchPolicy: 'cache-and-network',
  });

  return {
    summary: (data?.engineAnalytics || null) as AnalyticsSummary | null,
    loading,
    error: error || null,
    refetch,
  };
}

/**
 * Record recommendation outcome
 */
export function useRecordOutcome() {
  const [executeMutation, { loading, error }] = useMutation(RECORD_RECOMMENDATION_OUTCOME);

  const record = useCallback(
    async (input: {
      sessionId: string;
      carePlanId: string;
      accepted: boolean;
      feedback?: string;
      selectedRank?: number;
    }) => {
      const { data } = await executeMutation({
        variables: { input },
      });
      return { status: data?.recordRecommendationOutcome ? 'recorded' : 'failed' };
    },
    [executeMutation]
  );

  return { record, loading, error: error || null };
}

// ============================================================================
// Configuration Hooks
// ============================================================================

export interface ScoreWeights {
  exactMatch: number;
  prefixMatch: number;
  categoryMatch: number;
  embeddingMatch: number;
}

export interface MatchingConfig {
  strategy: string;
  codeMatchPriority: string;
  enableEmbeddings: boolean;
  similarityThreshold: number;
  maxCandidates: number;
  scoreWeights: ScoreWeights;
}

export interface PersonalizationConfig {
  enableRag: boolean;
  enableOutcomeLearning: boolean;
  enableDecisionPaths: boolean;
  knowledgeSources: string[];
  learningRate: string;
}

export interface EngineConfiguration {
  matching: MatchingConfig;
  personalization: PersonalizationConfig;
}

/**
 * Fetch engine configuration
 */
export function useEngineConfiguration() {
  const { data, loading, error, refetch } = useQuery(GET_ENGINE_CONFIGURATION, {
    fetchPolicy: 'cache-and-network',
  });

  return {
    config: (data?.engineConfiguration || null) as EngineConfiguration | null,
    loading,
    error: error || null,
    refetch,
  };
}

/**
 * Save matching configuration
 */
export function useSaveMatchingConfig() {
  const [executeMutation, { loading, error }] = useMutation(SAVE_MATCHING_CONFIG, {
    refetchQueries: [{ query: GET_ENGINE_CONFIGURATION }],
  });

  const saveConfig = useCallback(
    async (input: MatchingConfig) => {
      const { data } = await executeMutation({
        variables: { input },
      });
      return data?.saveMatchingConfig as MatchingConfig;
    },
    [executeMutation]
  );

  return { saveConfig, loading, error: error || null };
}

/**
 * Save personalization configuration
 */
export function useSavePersonalizationConfig() {
  const [executeMutation, { loading, error }] = useMutation(SAVE_PERSONALIZATION_CONFIG, {
    refetchQueries: [{ query: GET_ENGINE_CONFIGURATION }],
  });

  const saveConfig = useCallback(
    async (input: PersonalizationConfig) => {
      const { data } = await executeMutation({
        variables: { input },
      });
      return data?.savePersonalizationConfig as PersonalizationConfig;
    },
    [executeMutation]
  );

  return { saveConfig, loading, error: error || null };
}
