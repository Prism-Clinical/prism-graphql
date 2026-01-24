import { RecommenderClient } from "../clients/recommender-client";
import { DataSourceContext } from "../types/DataSourceContext";

export interface SimpleRecommendationInput {
  conditionCodes: string[];
  maxResults?: number;
  includeDrafts?: boolean;
}

export interface PatientDemographicsInput {
  age?: number;
  sex?: string;
  race?: string;
  ethnicity?: string;
}

export interface FullRecommendationInput {
  conditionCodes: string[];
  conditionNames?: string[];
  medicationCodes?: string[];
  medicationNames?: string[];
  labCodes?: string[];
  labValues?: Record<string, number>;
  demographics?: PatientDemographicsInput;
  riskFactors?: string[];
  complications?: string[];
  maxResults?: number;
  includeDrafts?: boolean;
}

const Query: Record<string, any> = {
  async recommendCarePlansSimple(
    _: unknown,
    { input }: { input: SimpleRecommendationInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.recommendSimple({
      condition_codes: input.conditionCodes,
      max_results: input.maxResults || 5,
      include_drafts: input.includeDrafts ?? true,
    });

    return RecommenderClient.toGraphQL(response);
  },

  async recommendCarePlansFull(
    _: unknown,
    { input }: { input: FullRecommendationInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.recommendFull({
      condition_codes: input.conditionCodes,
      condition_names: input.conditionNames,
      medication_codes: input.medicationCodes,
      medication_names: input.medicationNames,
      lab_codes: input.labCodes,
      lab_values: input.labValues,
      demographics: input.demographics
        ? {
            age: input.demographics.age,
            sex: input.demographics.sex,
            race: input.demographics.race,
            ethnicity: input.demographics.ethnicity,
          }
        : undefined,
      risk_factors: input.riskFactors,
      complications: input.complications,
      max_results: input.maxResults || 5,
      include_drafts: input.includeDrafts ?? true,
    });

    return RecommenderClient.toGraphQL(response);
  },

  async trainingJob(
    _: unknown,
    { id }: { id: string },
    context: DataSourceContext
  ) {
    const { pool } = context;

    const result = await pool.query(
      `SELECT * FROM ml_training_jobs WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
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

  async trainingJobs(
    _: unknown,
    { status, first }: { status?: string; first?: number },
    context: DataSourceContext
  ) {
    const { pool } = context;

    let query = `SELECT * FROM ml_training_jobs WHERE model_type = 'careplan_recommender'`;
    const params: unknown[] = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    if (first) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(first);
    }

    const result = await pool.query(query, params);

    return result.rows.map((job) => ({
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
    }));
  },

  async recommenderModelInfo(
    _: unknown,
    __: unknown,
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const info = await recommenderClient.getModelInfo();
    return RecommenderClient.modelInfoToGraphQL(info);
  },

  async recommenderStats(
    _: unknown,
    __: unknown,
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const stats = await recommenderClient.getStats();
    return RecommenderClient.statsToGraphQL(stats);
  },

  // --- ML Model Registry ---

  async mlModels(
    _: unknown,
    { isActive }: { isActive?: boolean },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.listModels(isActive);
    return response.models.map((m) => RecommenderClient.mlModelToGraphQL(m));
  },

  async mlModel(
    _: unknown,
    { id }: { id: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    try {
      const model = await recommenderClient.getModel(id);
      return RecommenderClient.mlModelToGraphQL(model);
    } catch {
      return null;
    }
  },

  async mlModelBySlug(
    _: unknown,
    { slug }: { slug: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    // Get all models and find by slug
    const response = await recommenderClient.listModels();
    const model = response.models.find((m) => m.slug === slug);
    return model ? RecommenderClient.mlModelToGraphQL(model) : null;
  },

  async mlModelVersions(
    _: unknown,
    { modelId, isActive }: { modelId: string; isActive?: boolean },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const versions = await recommenderClient.getModelVersions(modelId, isActive);
    return versions.map((v) => RecommenderClient.mlModelVersionToGraphQL(v));
  },

  async mlModelTrainingData(
    _: unknown,
    { modelId, assignmentType }: { modelId: string; assignmentType?: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const data = await recommenderClient.getTrainingData(modelId, assignmentType);
    return data.map((d) => RecommenderClient.trainingDataToGraphQL(d));
  },

  async mlModelTrainingPreview(
    _: unknown,
    { modelId }: { modelId: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const preview = await recommenderClient.getTrainingPreview(modelId);
    return RecommenderClient.trainingPreviewToGraphQL(preview);
  },

  async previewFilterCriteria(
    _: unknown,
    { filterCriteria }: { filterCriteria: MLModelFilterCriteriaInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const results = await recommenderClient.previewFilter({
      condition_code_prefixes: filterCriteria.conditionCodePrefixes,
      condition_codes: filterCriteria.conditionCodes,
      training_tags: filterCriteria.trainingTags,
      categories: filterCriteria.categories,
    });
    return results.map((r) => RecommenderClient.filterPreviewToGraphQL(r));
  },

  async loadedModels(
    _: unknown,
    __: unknown,
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const loaded = await recommenderClient.getLoadedModels();
    return loaded.map((m) => RecommenderClient.modelLoadStatusToGraphQL(m));
  },

  // --- Three-Layer Recommendation Engine ---

  async engineRecommend(
    _: unknown,
    { input }: { input: EngineRecommendInput },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const response = await recommenderClient.engineRecommend({
      patient_context: {
        condition_codes: input.patientContext.conditionCodes,
        age: input.patientContext.age,
        sex: input.patientContext.sex,
        medication_codes: input.patientContext.medicationCodes,
        lab_codes: input.patientContext.labCodes,
        lab_values: input.patientContext.labValues,
        comorbidities: input.patientContext.comorbidities,
        risk_factors: input.patientContext.riskFactors,
        patient_id: input.patientContext.patientId,
        provider_id: input.patientContext.providerId,
        clinical_notes: input.patientContext.clinicalNotes,
      },
      max_results: input.maxResults,
      enable_personalization: input.enablePersonalization,
      enable_decision_explorer: input.enableDecisionExplorer,
      enable_rag: input.enableRag,
    });

    return RecommenderClient.engineRecommendToGraphQL(response);
  },

  async engineExplainSession(
    _: unknown,
    { sessionId }: { sessionId: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const explanation = await recommenderClient.engineExplainSession(sessionId);
    return RecommenderClient.sessionExplanationToGraphQL(explanation);
  },

  async variantGroups(
    _: unknown,
    { conditionCode }: { conditionCode?: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const groups = await recommenderClient.getVariantGroups(conditionCode);
    return groups.map((g) => RecommenderClient.variantGroupToGraphQL(g));
  },

  async variantGroup(
    _: unknown,
    { id }: { id: string },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const group = await recommenderClient.getVariantGroup(id);
    return group ? RecommenderClient.variantGroupToGraphQL(group) : null;
  },

  async selectionRules(
    _: unknown,
    { variantGroupId, isActive }: { variantGroupId?: string; isActive?: boolean },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const rules = await recommenderClient.getSelectionRules(variantGroupId, isActive);
    return rules.map((r) => RecommenderClient.selectionRuleToGraphQL(r));
  },

  async engineAnalytics(
    _: unknown,
    { days }: { days?: number },
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const analytics = await recommenderClient.getEngineAnalytics(days);
    return RecommenderClient.analyticsToGraphQL(analytics);
  },

  async engineConfiguration(
    _: unknown,
    __: unknown,
    context: DataSourceContext
  ) {
    const { recommenderClient } = context;

    const config = await recommenderClient.getEngineConfiguration();
    return RecommenderClient.configurationToGraphQL(config);
  },
};

export interface MLModelFilterCriteriaInput {
  conditionCodePrefixes?: string[];
  conditionCodes?: string[];
  trainingTags?: string[];
  categories?: string[];
}

export interface EnginePatientContextInput {
  conditionCodes: string[];
  age?: number;
  sex?: string;
  medicationCodes?: string[];
  labCodes?: string[];
  labValues?: Record<string, number>;
  comorbidities?: string[];
  riskFactors?: string[];
  patientId?: string;
  providerId?: string;
  clinicalNotes?: string;
}

export interface EngineRecommendInput {
  patientContext: EnginePatientContextInput;
  maxResults?: number;
  enablePersonalization?: boolean;
  enableDecisionExplorer?: boolean;
  enableRag?: boolean;
}

export default Query;
