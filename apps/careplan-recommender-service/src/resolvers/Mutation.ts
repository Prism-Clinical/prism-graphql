import { RecommenderClient } from "../clients/recommender-client";
import { DataSourceContext } from "../types/DataSourceContext";

export interface TriggerTrainingInput {
  jobName?: string;
  includeValidationOutcomes?: boolean;
  config?: Record<string, unknown>;
}

export interface MLModelFilterCriteriaInput {
  conditionCodePrefixes?: string[];
  conditionCodes?: string[];
  trainingTags?: string[];
  categories?: string[];
}

export interface CreateMLModelInput {
  name: string;
  slug: string;
  description?: string;
  filterCriteria?: MLModelFilterCriteriaInput;
  targetConditions?: string[];
  isDefault?: boolean;
}

export interface UpdateMLModelInput {
  name?: string;
  description?: string;
  filterCriteria?: MLModelFilterCriteriaInput;
  targetConditions?: string[];
  isActive?: boolean;
  isDefault?: boolean;
}

export interface TrainModelInput {
  modelId: string;
  jobName?: string;
  includeValidationOutcomes?: boolean;
}

export interface SetActiveVersionInput {
  versionId: string;
  isDefault?: boolean;
}

export interface AssignTrainingDataInput {
  modelId: string;
  carePlanIds: string[];
  notes?: string;
}

export interface UnassignTrainingDataInput {
  modelId: string;
  carePlanIds: string[];
}

export interface LoadModelInput {
  modelId: string;
  versionId?: string;
}

const Mutation: Record<string, any> = {
  async triggerRecommenderTraining(
    _: unknown,
    { input }: { input?: TriggerTrainingInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.triggerTraining({
      job_name: input?.jobName,
      include_validation_outcomes: input?.includeValidationOutcomes ?? true,
      config: input?.config,
    });

    return RecommenderClient.trainingJobToGraphQL(response);
  },

  async cancelTrainingJob(
    _: unknown,
    { id }: { id: string },
    context: DataSourceContext
  ) {
    const { pool } = context;

    // Update job status to CANCELLED
    const result = await pool.query(
      `UPDATE ml_training_jobs
       SET status = 'CANCELLED', completed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status IN ('PENDING', 'RUNNING')
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new Error("Training job not found or cannot be cancelled");
    }

    const job = result.rows[0];
    return {
      id: job.id,
      modelType: job.model_type,
      jobName: job.job_name,
      status: job.status,
      progressPercent: job.progress_percent,
      statusMessage: job.status_message,
      metrics: job.metrics,
      modelPath: job.model_path,
      modelVersion: job.model_version,
      trainingExamplesCount: job.training_examples_count,
      startedAt: job.started_at?.toISOString(),
      completedAt: job.completed_at?.toISOString(),
      createdAt: job.created_at.toISOString(),
    };
  },

  async generateMissingEmbeddings(
    _: unknown,
    __: unknown,
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.generateEmbeddings();

    return {
      generatedCount: response.generated_count,
      failedCount: response.failed_count,
      processingTimeMs: response.processing_time_ms,
    };
  },

  async reloadRecommenderModel(
    _: unknown,
    __: unknown,
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const info = await recommenderClient.reloadModel();
    return RecommenderClient.modelInfoToGraphQL(info);
  },

  // --- ML Model Registry Mutations ---

  async createMLModel(
    _: unknown,
    { input }: { input: CreateMLModelInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.createModel({
      name: input.name,
      slug: input.slug,
      description: input.description,
      filter_criteria: input.filterCriteria
        ? {
            condition_code_prefixes: input.filterCriteria.conditionCodePrefixes,
            condition_codes: input.filterCriteria.conditionCodes,
            training_tags: input.filterCriteria.trainingTags,
            categories: input.filterCriteria.categories,
          }
        : undefined,
      target_conditions: input.targetConditions,
      is_default: input.isDefault,
    });

    return RecommenderClient.mlModelToGraphQL(response);
  },

  async updateMLModel(
    _: unknown,
    { id, input }: { id: string; input: UpdateMLModelInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.updateModel(id, {
      name: input.name,
      description: input.description,
      filter_criteria: input.filterCriteria
        ? {
            condition_code_prefixes: input.filterCriteria.conditionCodePrefixes,
            condition_codes: input.filterCriteria.conditionCodes,
            training_tags: input.filterCriteria.trainingTags,
            categories: input.filterCriteria.categories,
          }
        : undefined,
      target_conditions: input.targetConditions,
      is_active: input.isActive,
      is_default: input.isDefault,
    });

    return RecommenderClient.mlModelToGraphQL(response);
  },

  async deleteMLModel(
    _: unknown,
    { id }: { id: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    await recommenderClient.deleteModel(id);
    return true;
  },

  async trainModel(
    _: unknown,
    { input }: { input: TrainModelInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.trainModel(input.modelId, {
      job_name: input.jobName,
      include_validation_outcomes: input.includeValidationOutcomes ?? true,
    });

    return RecommenderClient.trainingJobToGraphQL(response);
  },

  async setActiveVersion(
    _: unknown,
    { input }: { input: SetActiveVersionInput },
    context: DataSourceContext
  ) {
    const { recommenderClient, pool } = context;

    // First get the version to find the model ID
    const versionResult = await pool.query(
      `SELECT model_id FROM ml_model_versions WHERE id = $1`,
      [input.versionId]
    );

    if (versionResult.rows.length === 0) {
      throw new Error("Version not found");
    }

    const modelId = versionResult.rows[0].model_id;

    const response = await recommenderClient.setActiveVersion(modelId, {
      version_id: input.versionId,
      is_default: input.isDefault,
    });

    return RecommenderClient.mlModelVersionToGraphQL(response);
  },

  async assignTrainingData(
    _: unknown,
    { input }: { input: AssignTrainingDataInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.assignTrainingData(input.modelId, {
      care_plan_ids: input.carePlanIds,
      notes: input.notes,
    });

    return response.map((d) => RecommenderClient.trainingDataToGraphQL(d));
  },

  async unassignTrainingData(
    _: unknown,
    { input }: { input: UnassignTrainingDataInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    await recommenderClient.unassignTrainingData(input.modelId, input.carePlanIds);
    return true;
  },

  async loadModel(
    _: unknown,
    { input }: { input: LoadModelInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.loadModel(
      input.modelId,
      input.versionId
    );

    return RecommenderClient.modelLoadStatusToGraphQL(response);
  },

  async unloadModel(
    _: unknown,
    { modelId }: { modelId: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    await recommenderClient.unloadModel(modelId);
    return true;
  },

  // --- Three-Layer Recommendation Engine Mutations ---

  async recordRecommendationOutcome(
    _: unknown,
    { input }: { input: RecordOutcomeInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    await recommenderClient.recordOutcome(input.sessionId, {
      care_plan_id: input.carePlanId,
      accepted: input.accepted,
      feedback: input.feedback,
      selected_rank: input.selectedRank,
    });

    return true;
  },

  async createVariantGroup(
    _: unknown,
    { input }: { input: CreateVariantGroupInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.createVariantGroup({
      name: input.name,
      description: input.description,
      condition_codes: input.conditionCodes,
    });

    return RecommenderClient.variantGroupToGraphQL(response);
  },

  async createVariant(
    _: unknown,
    { input }: { input: CreateVariantInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.createVariant({
      variant_group_id: input.variantGroupId,
      care_plan_id: input.carePlanId,
      variant_name: input.variantName,
      target_age_min: input.targetAgeMin,
      target_age_max: input.targetAgeMax,
      target_sex: input.targetSex,
      target_conditions: input.targetConditions,
      target_risk_factors: input.targetRiskFactors,
      exclusion_conditions: input.exclusionConditions,
      priority_score: input.priorityScore,
      is_default: input.isDefault,
    });

    return RecommenderClient.variantToGraphQL(response);
  },

  async createSelectionRule(
    _: unknown,
    { input }: { input: CreateSelectionRuleInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.createSelectionRule({
      name: input.name,
      description: input.description,
      variant_group_id: input.variantGroupId,
      rule_definition: input.ruleDefinition,
      priority: input.priority,
    });

    return RecommenderClient.selectionRuleToGraphQL(response);
  },

  async deleteSelectionRule(
    _: unknown,
    { id }: { id: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    await recommenderClient.deleteSelectionRule(id);
    return true;
  },

  async updateVariant(
    _: unknown,
    { id, input }: { id: string; input: UpdateVariantInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.updateVariant(id, {
      variant_name: input.variantName,
      target_age_min: input.targetAgeMin,
      target_age_max: input.targetAgeMax,
      target_sex: input.targetSex,
      target_conditions: input.targetConditions,
      target_risk_factors: input.targetRiskFactors,
      exclusion_conditions: input.exclusionConditions,
      priority_score: input.priorityScore,
      is_default: input.isDefault,
    });

    return RecommenderClient.variantToGraphQL(response);
  },

  async deleteVariant(
    _: unknown,
    { id }: { id: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    await recommenderClient.deleteVariant(id);
    return true;
  },

  async updateSelectionRule(
    _: unknown,
    { id, input }: { id: string; input: UpdateSelectionRuleInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.updateSelectionRule(id, {
      name: input.name,
      description: input.description,
      rule_definition: input.ruleDefinition,
      priority: input.priority,
      is_active: input.isActive,
    });

    return RecommenderClient.selectionRuleToGraphQL(response);
  },

  async updateVariantGroup(
    _: unknown,
    { id, input }: { id: string; input: UpdateVariantGroupInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.updateVariantGroup(id, {
      name: input.name,
      description: input.description,
      condition_codes: input.conditionCodes,
      is_active: input.isActive,
    });

    return RecommenderClient.variantGroupToGraphQL(response);
  },

  async deleteVariantGroup(
    _: unknown,
    { id }: { id: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    await recommenderClient.deleteVariantGroup(id);
    return true;
  },

  async saveMatchingConfig(
    _: unknown,
    { input }: { input: MatchingConfigInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const config = await recommenderClient.saveMatchingConfig({
      strategy: input.strategy,
      code_match_priority: input.codeMatchPriority,
      enable_embeddings: input.enableEmbeddings,
      similarity_threshold: input.similarityThreshold,
      max_candidates: input.maxCandidates,
      score_weights: {
        exact_match: input.scoreWeights.exactMatch,
        prefix_match: input.scoreWeights.prefixMatch,
        category_match: input.scoreWeights.categoryMatch,
        embedding_match: input.scoreWeights.embeddingMatch,
      },
    });

    return RecommenderClient.matchingConfigToGraphQL(config);
  },

  async savePersonalizationConfig(
    _: unknown,
    { input }: { input: PersonalizationConfigInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const config = await recommenderClient.savePersonalizationConfig({
      enable_rag: input.enableRag,
      enable_outcome_learning: input.enableOutcomeLearning,
      enable_decision_paths: input.enableDecisionPaths,
      knowledge_sources: input.knowledgeSources,
      learning_rate: input.learningRate,
    });

    return RecommenderClient.personalizationConfigToGraphQL(config);
  },
};

export interface RecordOutcomeInput {
  sessionId: string;
  carePlanId: string;
  accepted: boolean;
  feedback?: string;
  selectedRank?: number;
}

export interface CreateVariantGroupInput {
  name: string;
  description?: string;
  conditionCodes: string[];
}

export interface CreateVariantInput {
  variantGroupId: string;
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

export interface CreateSelectionRuleInput {
  name: string;
  description?: string;
  variantGroupId?: string;
  ruleDefinition: Record<string, unknown>;
  priority?: number;
}

export interface UpdateVariantInput {
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

export interface UpdateSelectionRuleInput {
  name?: string;
  description?: string;
  ruleDefinition?: Record<string, unknown>;
  priority?: number;
  isActive?: boolean;
}

export interface UpdateVariantGroupInput {
  name?: string;
  description?: string;
  conditionCodes?: string[];
  isActive?: boolean;
}

export interface ScoreWeightsInput {
  exactMatch: number;
  prefixMatch: number;
  categoryMatch: number;
  embeddingMatch: number;
}

export interface MatchingConfigInput {
  strategy: string;
  codeMatchPriority: string;
  enableEmbeddings: boolean;
  similarityThreshold: number;
  maxCandidates: number;
  scoreWeights: ScoreWeightsInput;
}

export interface PersonalizationConfigInput {
  enableRag: boolean;
  enableOutcomeLearning: boolean;
  enableDecisionPaths: boolean;
  knowledgeSources: string[];
  learningRate: string;
}

export default Mutation;
