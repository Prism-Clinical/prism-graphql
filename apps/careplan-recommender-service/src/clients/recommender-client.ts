/**
 * HTTP Client for the Care Plan Recommender ML Service
 */

interface SimpleRecommendationRequest {
  condition_codes: string[];
  max_results?: number;
  include_drafts?: boolean;
}

interface FullContextRequest {
  condition_codes: string[];
  condition_names?: string[];
  medication_codes?: string[];
  medication_names?: string[];
  lab_codes?: string[];
  lab_values?: Record<string, number>;
  demographics?: {
    age?: number;
    sex?: string;
    race?: string;
    ethnicity?: string;
  };
  risk_factors?: string[];
  complications?: string[];
  max_results?: number;
  include_drafts?: boolean;
}

interface TriggerTrainingRequest {
  job_name?: string;
  include_validation_outcomes?: boolean;
  config?: Record<string, unknown>;
}

interface TemplateRecommendation {
  template_id: string;
  name: string;
  category: string;
  description?: string;
  condition_codes: string[];
  similarity_score: number;
  ranking_score: number;
  confidence: number;
  match_factors: string[];
}

interface DraftGoal {
  description: string;
  target_value?: string;
  target_days?: number;
  priority: string;
  guideline_reference?: string;
  confidence: number;
}

interface DraftIntervention {
  type: string;
  description: string;
  medication_code?: string;
  dosage?: string;
  frequency?: string;
  procedure_code?: string;
  guideline_reference?: string;
  confidence: number;
}

interface DraftCarePlan {
  title: string;
  condition_codes: string[];
  goals: DraftGoal[];
  interventions: DraftIntervention[];
  confidence_score: number;
  source_template_id?: string;
  similar_training_plan_ids: string[];
  generation_method: string;
}

interface RecommendationResponse {
  templates: TemplateRecommendation[];
  drafts: DraftCarePlan[];
  processing_time_ms: number;
  model_version: string;
  query_mode: string;
}

interface TrainingJobResponse {
  id: string;
  model_type: string;
  job_name?: string;
  status: string;
  progress_percent: number;
  status_message?: string;
  metrics?: Record<string, unknown>;
  model_path?: string;
  model_version?: string;
  training_examples_count?: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

interface ModelInfoResponse {
  model_type: string;
  version: string;
  is_loaded: boolean;
  last_trained_at?: string;
  training_metrics?: Record<string, unknown>;
  feature_dimension: number;
}

interface RecommenderStatsResponse {
  total_training_examples: number;
  total_templates: number;
  embeddings_generated: number;
  pending_embeddings: number;
  model_version?: string;
  last_trained_at?: string;
  average_confidence?: number;
}

interface EmbeddingGenerationResponse {
  generated_count: number;
  failed_count: number;
  processing_time_ms: number;
}

// --- ML Model Registry Interfaces ---

interface MLModelFilterCriteria {
  condition_code_prefixes?: string[];
  condition_codes?: string[];
  training_tags?: string[];
  categories?: string[];
}

interface CreateMLModelRequest {
  name: string;
  slug: string;
  description?: string;
  filter_criteria?: MLModelFilterCriteria;
  target_conditions?: string[];
  is_default?: boolean;
}

interface UpdateMLModelRequest {
  name?: string;
  description?: string;
  filter_criteria?: MLModelFilterCriteria;
  target_conditions?: string[];
  is_active?: boolean;
  is_default?: boolean;
}

interface MLModelVersionResponse {
  id: string;
  model_id: string;
  version: string;
  model_path: string;
  is_active: boolean;
  is_default: boolean;
  metrics?: Record<string, unknown>;
  training_job_id?: string;
  training_data_snapshot?: Record<string, unknown>;
  created_at: string;
  deployed_at?: string;
}

interface MLModelResponse {
  id: string;
  name: string;
  slug: string;
  description?: string;
  model_type: string;
  filter_criteria?: Record<string, unknown>;
  target_conditions?: string[];
  is_active: boolean;
  is_default: boolean;
  version_count?: number;
  versions?: MLModelVersionResponse[];
  active_version?: MLModelVersionResponse;
  training_data_count?: number;
  created_at: string;
  updated_at: string;
}

interface MLModelListResponse {
  models: MLModelResponse[];
  total_count: number;
}

interface TrainModelRequest {
  job_name?: string;
  include_validation_outcomes?: boolean;
}

interface SetActiveVersionRequest {
  version_id: string;
  is_default?: boolean;
}

interface AssignTrainingDataRequest {
  care_plan_ids: string[];
  notes?: string;
}

interface TrainingDataAssignmentResponse {
  id: string;
  model_id: string;
  care_plan_id: string;
  assignment_type: string;
  care_plan_title?: string;
  condition_codes?: string[];
  training_tags?: string[];
  assigned_at: string;
  assigned_by?: string;
  notes?: string;
}

interface ModelLoadStatusResponse {
  model_id: string;
  model_slug: string;
  version_id: string;
  version: string;
  is_loaded: boolean;
  is_default: boolean;
  is_fitted: boolean;
  loaded_at?: string;
  metrics?: Record<string, unknown>;
}

interface FilterPreviewResponse {
  care_plan_id: string;
  title: string;
  condition_codes: string[];
  training_tags?: string[];
}

interface TrainingPreviewResponse {
  model_id: string;
  model_name?: string;
  total_examples: number;
  with_embeddings: number;
  by_assignment_type: Record<string, number>;
  condition_codes: string[];
}

// --- Three-Layer Engine Interfaces ---

interface EnginePatientContext {
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

interface EngineRecommendRequest {
  patient_context: EnginePatientContext;
  max_results?: number;
  enable_personalization?: boolean;
  enable_decision_explorer?: boolean;
  enable_rag?: boolean;
}

interface EngineMatchReason {
  reason_type: string;
  description: string;
  metadata?: Record<string, unknown>;
  score_impact: number;
}

interface EngineRecommendation {
  care_plan_id: string;
  title: string;
  condition_codes: string[];
  score: number;
  rank: number;
  match_type?: string;
  matched_codes: string[];
  variant_group_id?: string;
  variant_group_name?: string;
  variant_id?: string;
  variant_name?: string;
  embedding_similarity?: number;
  selection_score?: number;
  personalization_score?: number;
  reasons: EngineMatchReason[];
}

interface EngineLayerSummary {
  layer: number;
  layer_name: string;
  candidate_count: number;
  processing_time_ms: number;
  metadata?: Record<string, unknown>;
}

interface EngineRecommendResponse {
  session_id: string;
  recommendations: EngineRecommendation[];
  layer_summaries: EngineLayerSummary[];
  total_processing_time_ms: number;
  engine_version: string;
}

interface EngineVariant {
  id: string;
  variant_group_id: string;
  care_plan_id: string;
  variant_name: string;
  target_age_min?: number;
  target_age_max?: number;
  target_sex?: string;
  target_conditions?: string[];
  target_risk_factors?: string[];
  exclusion_conditions?: string[];
  priority_score: number;
  is_default: boolean;
}

interface EngineVariantGroup {
  id: string;
  name: string;
  description?: string;
  condition_codes: string[];
  variants: EngineVariant[];
  is_active: boolean;
  created_at: string;
}

interface EngineSelectionRule {
  id: string;
  name: string;
  description?: string;
  variant_group_id?: string;
  rule_definition: Record<string, unknown>;
  priority: number;
  is_active: boolean;
  created_at: string;
}

interface EngineAnalyticsSummary {
  total_sessions: number;
  average_processing_time_ms: number;
  top_match_types: Record<string, number>;
  top_condition_codes: Record<string, number>;
  acceptance_rate: number;
  period: string;
}

interface EngineLayerDetail {
  layer: number;
  layer_name: string;
  input_count: number;
  output_count: number;
  candidate_details: unknown[];
  processing_time_ms: number;
}

interface EngineSessionExplanation {
  session_id: string;
  patient_context: Record<string, unknown>;
  layers: EngineLayerDetail[];
  final_recommendations: EngineRecommendation[];
  created_at: string;
}

interface RecordOutcomeRequest {
  care_plan_id: string;
  accepted: boolean;
  feedback?: string;
  selected_rank?: number;
}

interface CreateVariantGroupRequest {
  name: string;
  description?: string;
  condition_codes: string[];
}

interface CreateVariantRequest {
  variant_group_id: string;
  care_plan_id: string;
  variant_name: string;
  target_age_min?: number;
  target_age_max?: number;
  target_sex?: string;
  target_conditions?: string[];
  target_risk_factors?: string[];
  exclusion_conditions?: string[];
  priority_score?: number;
  is_default?: boolean;
}

interface CreateSelectionRuleRequest {
  name: string;
  description?: string;
  variant_group_id?: string;
  rule_definition: Record<string, unknown>;
  priority?: number;
}

interface UpdateVariantRequest {
  variant_name?: string;
  target_age_min?: number;
  target_age_max?: number;
  target_sex?: string;
  target_conditions?: string[];
  target_risk_factors?: string[];
  exclusion_conditions?: string[];
  priority_score?: number;
  is_default?: boolean;
}

interface UpdateSelectionRuleRequest {
  name?: string;
  description?: string;
  rule_definition?: Record<string, unknown>;
  priority?: number;
  is_active?: boolean;
}

interface UpdateVariantGroupRequest {
  name?: string;
  description?: string;
  condition_codes?: string[];
  is_active?: boolean;
}

// --- Engine Configuration Types ---

interface ScoreWeightsConfig {
  exact_match: number;
  prefix_match: number;
  category_match: number;
  embedding_match: number;
}

interface MatchingConfigResponse {
  strategy: string;
  code_match_priority: string;
  enable_embeddings: boolean;
  similarity_threshold: number;
  max_candidates: number;
  score_weights: ScoreWeightsConfig;
}

interface PersonalizationConfigResponse {
  enable_rag: boolean;
  enable_outcome_learning: boolean;
  enable_decision_paths: boolean;
  knowledge_sources: string[];
  learning_rate: string;
}

interface EngineConfigurationResponse {
  matching: MatchingConfigResponse;
  personalization: PersonalizationConfigResponse;
}

interface MatchingConfigRequest {
  strategy: string;
  code_match_priority: string;
  enable_embeddings: boolean;
  similarity_threshold: number;
  max_candidates: number;
  score_weights: ScoreWeightsConfig;
}

interface PersonalizationConfigRequest {
  enable_rag: boolean;
  enable_outcome_learning: boolean;
  enable_decision_paths: boolean;
  knowledge_sources: string[];
  learning_rate: string;
}

export class RecommenderClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string, timeout: number = 30000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeout = timeout;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async recommendSimple(
    request: SimpleRecommendationRequest
  ): Promise<RecommendationResponse> {
    const response = await fetch(`${this.baseUrl}/recommend/simple`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<RecommendationResponse>;
  }

  async recommendFull(
    request: FullContextRequest
  ): Promise<RecommendationResponse> {
    const response = await fetch(`${this.baseUrl}/recommend/full`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<RecommendationResponse>;
  }

  async triggerTraining(
    request?: TriggerTrainingRequest
  ): Promise<TrainingJobResponse> {
    const response = await fetch(`${this.baseUrl}/training/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request || {}),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<TrainingJobResponse>;
  }

  async getTrainingStatus(jobId: string): Promise<TrainingJobResponse> {
    const response = await fetch(
      `${this.baseUrl}/training/status/${jobId}`,
      {
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<TrainingJobResponse>;
  }

  async generateEmbeddings(): Promise<EmbeddingGenerationResponse> {
    const response = await fetch(
      `${this.baseUrl}/training/embeddings/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(this.timeout * 10), // Longer timeout for embeddings
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EmbeddingGenerationResponse>;
  }

  async getModelInfo(): Promise<ModelInfoResponse> {
    const response = await fetch(`${this.baseUrl}/model/info`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<ModelInfoResponse>;
  }

  async reloadModel(): Promise<ModelInfoResponse> {
    const response = await fetch(`${this.baseUrl}/model/reload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<ModelInfoResponse>;
  }

  async getStats(): Promise<RecommenderStatsResponse> {
    const response = await fetch(`${this.baseUrl}/stats`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<RecommenderStatsResponse>;
  }

  // --- ML Model Registry Methods ---

  async listModels(isActive?: boolean): Promise<MLModelListResponse> {
    const url = new URL(`${this.baseUrl}/models`);
    if (isActive !== undefined) {
      url.searchParams.set("is_active", String(isActive));
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<MLModelListResponse>;
  }

  async getModel(modelId: string): Promise<MLModelResponse> {
    const response = await fetch(`${this.baseUrl}/models/${modelId}`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<MLModelResponse>;
  }

  async createModel(request: CreateMLModelRequest): Promise<MLModelResponse> {
    const response = await fetch(`${this.baseUrl}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<MLModelResponse>;
  }

  async updateModel(
    modelId: string,
    request: UpdateMLModelRequest
  ): Promise<MLModelResponse> {
    const response = await fetch(`${this.baseUrl}/models/${modelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<MLModelResponse>;
  }

  async deleteModel(modelId: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/models/${modelId}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return true;
  }

  async trainModel(
    modelId: string,
    request: TrainModelRequest
  ): Promise<TrainingJobResponse> {
    const response = await fetch(`${this.baseUrl}/models/${modelId}/train`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<TrainingJobResponse>;
  }

  async getModelVersions(
    modelId: string,
    isActive?: boolean
  ): Promise<MLModelVersionResponse[]> {
    const url = new URL(`${this.baseUrl}/models/${modelId}/versions`);
    if (isActive !== undefined) {
      url.searchParams.set("is_active", String(isActive));
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<MLModelVersionResponse[]>;
  }

  async setActiveVersion(
    modelId: string,
    request: SetActiveVersionRequest
  ): Promise<MLModelVersionResponse> {
    const response = await fetch(
      `${this.baseUrl}/models/${modelId}/versions/activate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<MLModelVersionResponse>;
  }

  async getTrainingData(
    modelId: string,
    assignmentType?: string
  ): Promise<TrainingDataAssignmentResponse[]> {
    const url = new URL(`${this.baseUrl}/models/${modelId}/training-data`);
    if (assignmentType) {
      url.searchParams.set("assignment_type", assignmentType);
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<TrainingDataAssignmentResponse[]>;
  }

  async assignTrainingData(
    modelId: string,
    request: AssignTrainingDataRequest
  ): Promise<TrainingDataAssignmentResponse[]> {
    const response = await fetch(
      `${this.baseUrl}/models/${modelId}/training-data/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<TrainingDataAssignmentResponse[]>;
  }

  async unassignTrainingData(
    modelId: string,
    carePlanIds: string[]
  ): Promise<boolean> {
    const response = await fetch(
      `${this.baseUrl}/models/${modelId}/training-data/unassign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ care_plan_ids: carePlanIds }),
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return true;
  }

  async getTrainingPreview(modelId: string): Promise<TrainingPreviewResponse> {
    const response = await fetch(
      `${this.baseUrl}/models/${modelId}/training-preview`,
      {
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<TrainingPreviewResponse>;
  }

  async previewFilter(
    filterCriteria: MLModelFilterCriteria
  ): Promise<FilterPreviewResponse[]> {
    const response = await fetch(`${this.baseUrl}/models/preview-filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filterCriteria),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    const data = (await response.json()) as { results: FilterPreviewResponse[] };
    return data.results;
  }

  async getLoadedModels(): Promise<ModelLoadStatusResponse[]> {
    const response = await fetch(`${this.baseUrl}/models/loaded`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    const data = (await response.json()) as { models: ModelLoadStatusResponse[] };
    return data.models;
  }

  async loadModel(
    modelId: string,
    versionId?: string
  ): Promise<ModelLoadStatusResponse> {
    const url = new URL(`${this.baseUrl}/models/${modelId}/load`);
    if (versionId) {
      url.searchParams.set("version_id", versionId);
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<ModelLoadStatusResponse>;
  }

  async unloadModel(modelId: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/models/${modelId}/unload`, {
      method: "POST",
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return true;
  }

  // --- Three-Layer Recommendation Engine Methods ---

  async engineRecommend(
    request: EngineRecommendRequest
  ): Promise<EngineRecommendResponse> {
    const response = await fetch(`${this.baseUrl}/engine/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EngineRecommendResponse>;
  }

  async engineExplainSession(
    sessionId: string
  ): Promise<EngineSessionExplanation | null> {
    const response = await fetch(
      `${this.baseUrl}/engine/explain/${sessionId}`,
      {
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EngineSessionExplanation>;
  }

  async getVariantGroups(
    conditionCode?: string
  ): Promise<EngineVariantGroup[]> {
    const url = new URL(`${this.baseUrl}/engine/variant-groups`);
    if (conditionCode) {
      url.searchParams.set("condition_code", conditionCode);
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    // API returns array directly
    return response.json() as Promise<EngineVariantGroup[]>;
  }

  async getVariantGroup(id: string): Promise<EngineVariantGroup | null> {
    const response = await fetch(
      `${this.baseUrl}/engine/variant-groups/${id}`,
      {
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EngineVariantGroup>;
  }

  async createVariantGroup(
    request: CreateVariantGroupRequest
  ): Promise<EngineVariantGroup> {
    const response = await fetch(`${this.baseUrl}/engine/variant-groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EngineVariantGroup>;
  }

  async createVariant(request: CreateVariantRequest): Promise<EngineVariant> {
    const response = await fetch(`${this.baseUrl}/engine/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EngineVariant>;
  }

  async updateVariant(
    id: string,
    request: UpdateVariantRequest
  ): Promise<EngineVariant> {
    const response = await fetch(`${this.baseUrl}/engine/variants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EngineVariant>;
  }

  async deleteVariant(id: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/engine/variants/${id}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return true;
  }

  async updateVariantGroup(
    id: string,
    request: UpdateVariantGroupRequest
  ): Promise<EngineVariantGroup> {
    const response = await fetch(
      `${this.baseUrl}/engine/variant-groups/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EngineVariantGroup>;
  }

  async deleteVariantGroup(id: string): Promise<boolean> {
    const response = await fetch(
      `${this.baseUrl}/engine/variant-groups/${id}`,
      {
        method: "DELETE",
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return true;
  }

  async getSelectionRules(
    variantGroupId?: string,
    isActive?: boolean
  ): Promise<EngineSelectionRule[]> {
    const url = new URL(`${this.baseUrl}/engine/selection-rules`);
    if (variantGroupId) {
      url.searchParams.set("variant_group_id", variantGroupId);
    }
    if (isActive !== undefined) {
      url.searchParams.set("is_active", String(isActive));
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    // API returns array directly
    return response.json() as Promise<EngineSelectionRule[]>;
  }

  async createSelectionRule(
    request: CreateSelectionRuleRequest
  ): Promise<EngineSelectionRule> {
    const response = await fetch(`${this.baseUrl}/engine/selection-rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EngineSelectionRule>;
  }

  async deleteSelectionRule(id: string): Promise<boolean> {
    const response = await fetch(
      `${this.baseUrl}/engine/selection-rules/${id}`,
      {
        method: "DELETE",
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return true;
  }

  async updateSelectionRule(
    id: string,
    request: UpdateSelectionRuleRequest
  ): Promise<EngineSelectionRule> {
    const response = await fetch(
      `${this.baseUrl}/engine/selection-rules/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EngineSelectionRule>;
  }

  async recordOutcome(
    sessionId: string,
    request: RecordOutcomeRequest
  ): Promise<boolean> {
    const response = await fetch(
      `${this.baseUrl}/engine/outcome/${sessionId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return true;
  }

  async getEngineAnalytics(days?: number): Promise<EngineAnalyticsSummary> {
    const url = new URL(`${this.baseUrl}/engine/analytics/summary`);
    if (days) {
      url.searchParams.set("days", String(days));
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    // Transform the response to expected format
    const data = (await response.json()) as {
      period_days: number;
      sessions: {
        total: number;
        avg_processing_time_ms: number;
      };
      outcomes: Record<string, { count: number }>;
    };

    // Calculate acceptance rate
    const acceptedCount = data.outcomes?.accepted?.count || 0;
    const totalOutcomes = Object.values(data.outcomes || {}).reduce(
      (sum, o) => sum + (o.count || 0),
      0
    );
    const acceptanceRate = totalOutcomes > 0 ? acceptedCount / totalOutcomes : 0;

    return {
      total_sessions: data.sessions.total,
      average_processing_time_ms: data.sessions.avg_processing_time_ms,
      top_match_types: {},
      top_condition_codes: {},
      acceptance_rate: acceptanceRate,
      period: `${data.period_days} days`,
    };
  }

  // --- Engine Configuration Methods ---

  async getEngineConfiguration(): Promise<EngineConfigurationResponse> {
    const response = await fetch(`${this.baseUrl}/engine/configuration`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      // Return defaults if config endpoint doesn't exist
      if (response.status === 404) {
        return {
          matching: {
            strategy: "hybrid",
            code_match_priority: "exact_first",
            enable_embeddings: true,
            similarity_threshold: 0.75,
            max_candidates: 50,
            score_weights: {
              exact_match: 100,
              prefix_match: 75,
              category_match: 50,
              embedding_match: 60,
            },
          },
          personalization: {
            enable_rag: true,
            enable_outcome_learning: false,
            enable_decision_paths: true,
            knowledge_sources: ["training_data", "clinical_guidelines", "care_plans"],
            learning_rate: "moderate",
          },
        };
      }
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<EngineConfigurationResponse>;
  }

  async saveMatchingConfig(config: MatchingConfigRequest): Promise<MatchingConfigResponse> {
    const response = await fetch(`${this.baseUrl}/engine/configuration/matching`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<MatchingConfigResponse>;
  }

  async savePersonalizationConfig(config: PersonalizationConfigRequest): Promise<PersonalizationConfigResponse> {
    const response = await fetch(`${this.baseUrl}/engine/configuration/personalization`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Recommender API error: ${response.status}`);
    }

    return response.json() as Promise<PersonalizationConfigResponse>;
  }

  static configurationToGraphQL(config: EngineConfigurationResponse) {
    return {
      matching: {
        strategy: config.matching.strategy,
        codeMatchPriority: config.matching.code_match_priority,
        enableEmbeddings: config.matching.enable_embeddings,
        similarityThreshold: config.matching.similarity_threshold,
        maxCandidates: config.matching.max_candidates,
        scoreWeights: {
          exactMatch: config.matching.score_weights.exact_match,
          prefixMatch: config.matching.score_weights.prefix_match,
          categoryMatch: config.matching.score_weights.category_match,
          embeddingMatch: config.matching.score_weights.embedding_match,
        },
      },
      personalization: {
        enableRag: config.personalization.enable_rag,
        enableOutcomeLearning: config.personalization.enable_outcome_learning,
        enableDecisionPaths: config.personalization.enable_decision_paths,
        knowledgeSources: config.personalization.knowledge_sources,
        learningRate: config.personalization.learning_rate,
      },
    };
  }

  static matchingConfigToGraphQL(config: MatchingConfigResponse) {
    return {
      strategy: config.strategy,
      codeMatchPriority: config.code_match_priority,
      enableEmbeddings: config.enable_embeddings,
      similarityThreshold: config.similarity_threshold,
      maxCandidates: config.max_candidates,
      scoreWeights: {
        exactMatch: config.score_weights.exact_match,
        prefixMatch: config.score_weights.prefix_match,
        categoryMatch: config.score_weights.category_match,
        embeddingMatch: config.score_weights.embedding_match,
      },
    };
  }

  static personalizationConfigToGraphQL(config: PersonalizationConfigResponse) {
    return {
      enableRag: config.enable_rag,
      enableOutcomeLearning: config.enable_outcome_learning,
      enableDecisionPaths: config.enable_decision_paths,
      knowledgeSources: config.knowledge_sources,
      learningRate: config.learning_rate,
    };
  }

  // Transform response to GraphQL format
  static toGraphQL(response: RecommendationResponse) {
    return {
      templates: response.templates.map((t) => ({
        templateId: t.template_id,
        name: t.name,
        category: t.category,
        description: t.description,
        conditionCodes: t.condition_codes,
        similarityScore: t.similarity_score,
        rankingScore: t.ranking_score,
        confidence: t.confidence,
        matchFactors: t.match_factors,
      })),
      drafts: response.drafts.map((d) => ({
        title: d.title,
        conditionCodes: d.condition_codes,
        goals: d.goals.map((g) => ({
          description: g.description,
          targetValue: g.target_value,
          targetDays: g.target_days,
          priority: g.priority,
          guidelineReference: g.guideline_reference,
          confidence: g.confidence,
        })),
        interventions: d.interventions.map((i) => ({
          type: i.type,
          description: i.description,
          medicationCode: i.medication_code,
          dosage: i.dosage,
          frequency: i.frequency,
          procedureCode: i.procedure_code,
          guidelineReference: i.guideline_reference,
          confidence: i.confidence,
        })),
        confidenceScore: d.confidence_score,
        sourceTemplateId: d.source_template_id,
        similarTrainingPlanIds: d.similar_training_plan_ids,
        generationMethod: d.generation_method.toUpperCase(),
      })),
      processingTimeMs: response.processing_time_ms,
      modelVersion: response.model_version,
      queryMode: response.query_mode.toUpperCase(),
    };
  }

  static trainingJobToGraphQL(job: TrainingJobResponse) {
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
      startedAt: job.started_at,
      completedAt: job.completed_at,
      createdAt: job.created_at,
    };
  }

  static modelInfoToGraphQL(info: ModelInfoResponse) {
    return {
      modelType: info.model_type,
      version: info.version,
      isLoaded: info.is_loaded,
      lastTrainedAt: info.last_trained_at,
      trainingMetrics: info.training_metrics,
      featureDimension: info.feature_dimension,
    };
  }

  static statsToGraphQL(stats: RecommenderStatsResponse) {
    return {
      totalTrainingExamples: stats.total_training_examples,
      totalTemplates: stats.total_templates,
      embeddingsGenerated: stats.embeddings_generated,
      pendingEmbeddings: stats.pending_embeddings,
      modelVersion: stats.model_version,
      lastTrainedAt: stats.last_trained_at,
      averageConfidence: stats.average_confidence,
    };
  }

  // --- ML Model Registry Transformations ---

  static mlModelToGraphQL(model: MLModelResponse) {
    return {
      id: model.id,
      name: model.name,
      slug: model.slug,
      description: model.description,
      modelType: model.model_type,
      filterCriteria: model.filter_criteria
        ? {
            conditionCodePrefixes:
              (model.filter_criteria as MLModelFilterCriteria)
                .condition_code_prefixes,
            conditionCodes: (model.filter_criteria as MLModelFilterCriteria)
              .condition_codes,
            trainingTags: (model.filter_criteria as MLModelFilterCriteria)
              .training_tags,
            categories: (model.filter_criteria as MLModelFilterCriteria)
              .categories,
          }
        : null,
      targetConditions: model.target_conditions,
      isActive: model.is_active,
      isDefault: model.is_default,
      versionCount: model.version_count,
      versions: model.versions
        ? model.versions.map((v) => this.mlModelVersionToGraphQL(v))
        : [],
      activeVersion: model.active_version
        ? this.mlModelVersionToGraphQL(model.active_version)
        : null,
      trainingDataCount: model.training_data_count || 0,
      createdAt: model.created_at,
      updatedAt: model.updated_at,
    };
  }

  static mlModelVersionToGraphQL(version: MLModelVersionResponse) {
    return {
      id: version.id,
      modelId: version.model_id,
      version: version.version,
      modelPath: version.model_path,
      isActive: version.is_active,
      isDefault: version.is_default,
      metrics: version.metrics,
      trainingJobId: version.training_job_id,
      trainingDataSnapshot: version.training_data_snapshot,
      createdAt: version.created_at,
      deployedAt: version.deployed_at,
    };
  }

  static trainingDataToGraphQL(data: TrainingDataAssignmentResponse) {
    return {
      id: data.id,
      modelId: data.model_id,
      carePlanId: data.care_plan_id,
      assignmentType: data.assignment_type,
      carePlanTitle: data.care_plan_title,
      conditionCodes: data.condition_codes,
      trainingTags: data.training_tags,
      assignedAt: data.assigned_at,
      assignedBy: data.assigned_by,
      notes: data.notes,
    };
  }

  static modelLoadStatusToGraphQL(status: ModelLoadStatusResponse) {
    return {
      modelId: status.model_id,
      modelSlug: status.model_slug,
      versionId: status.version_id,
      version: status.version,
      isLoaded: status.is_loaded,
      isDefault: status.is_default,
      isFitted: status.is_fitted,
      loadedAt: status.loaded_at,
      metrics: status.metrics,
    };
  }

  static filterPreviewToGraphQL(result: FilterPreviewResponse) {
    return {
      carePlanId: result.care_plan_id,
      title: result.title,
      conditionCodes: result.condition_codes,
      trainingTags: result.training_tags,
    };
  }

  static trainingPreviewToGraphQL(preview: TrainingPreviewResponse) {
    return {
      modelId: preview.model_id,
      modelName: preview.model_name,
      totalExamples: preview.total_examples,
      withEmbeddings: preview.with_embeddings,
      byAssignmentType: preview.by_assignment_type,
      conditionCodes: preview.condition_codes,
    };
  }

  // --- Three-Layer Engine Transformations ---

  static engineRecommendToGraphQL(response: EngineRecommendResponse) {
    return {
      sessionId: response.session_id,
      recommendations: response.recommendations.map((r) => ({
        carePlanId: r.care_plan_id,
        title: r.title,
        conditionCodes: r.condition_codes,
        score: r.score,
        rank: r.rank,
        matchType: r.match_type?.toUpperCase(),
        matchedCodes: r.matched_codes || [],
        variantGroupId: r.variant_group_id,
        variantGroupName: r.variant_group_name,
        variantId: r.variant_id,
        variantName: r.variant_name,
        embeddingSimilarity: r.embedding_similarity,
        selectionScore: r.selection_score,
        personalizationScore: r.personalization_score,
        reasons: (r.reasons || []).map((reason) => ({
          reasonType: reason.reason_type,
          description: reason.description,
          metadata: reason.metadata,
          scoreImpact: reason.score_impact,
        })),
      })),
      layerSummaries: response.layer_summaries.map((l) => ({
        layer: l.layer,
        layerName: l.layer_name,
        candidateCount: l.candidate_count,
        processingTimeMs: l.processing_time_ms,
        metadata: l.metadata,
      })),
      totalProcessingTimeMs: response.total_processing_time_ms,
      engineVersion: response.engine_version,
    };
  }

  static sessionExplanationToGraphQL(
    explanation: EngineSessionExplanation | null
  ) {
    if (!explanation) return null;
    return {
      sessionId: explanation.session_id,
      patientContext: explanation.patient_context,
      layers: explanation.layers.map((l) => ({
        layer: l.layer,
        layerName: l.layer_name,
        inputCount: l.input_count,
        outputCount: l.output_count,
        candidateDetails: l.candidate_details,
        processingTimeMs: l.processing_time_ms,
      })),
      finalRecommendations: explanation.final_recommendations.map((r) => ({
        carePlanId: r.care_plan_id,
        title: r.title,
        conditionCodes: r.condition_codes,
        score: r.score,
        rank: r.rank,
        matchType: r.match_type?.toUpperCase(),
        matchedCodes: r.matched_codes || [],
        variantGroupId: r.variant_group_id,
        variantGroupName: r.variant_group_name,
        variantId: r.variant_id,
        variantName: r.variant_name,
        embeddingSimilarity: r.embedding_similarity,
        selectionScore: r.selection_score,
        personalizationScore: r.personalization_score,
        reasons: (r.reasons || []).map((reason) => ({
          reasonType: reason.reason_type,
          description: reason.description,
          metadata: reason.metadata,
          scoreImpact: reason.score_impact,
        })),
      })),
      createdAt: explanation.created_at,
    };
  }

  static variantGroupToGraphQL(group: EngineVariantGroup) {
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      conditionCodes: group.condition_codes,
      variants: group.variants.map((v) => ({
        id: v.id,
        variantGroupId: v.variant_group_id,
        carePlanId: v.care_plan_id,
        variantName: v.variant_name,
        targetAgeMin: v.target_age_min,
        targetAgeMax: v.target_age_max,
        targetSex: v.target_sex,
        targetConditions: v.target_conditions,
        targetRiskFactors: v.target_risk_factors,
        exclusionConditions: v.exclusion_conditions,
        priorityScore: v.priority_score,
        isDefault: v.is_default,
      })),
      isActive: group.is_active,
      createdAt: group.created_at,
    };
  }

  static variantToGraphQL(variant: EngineVariant) {
    return {
      id: variant.id,
      variantGroupId: variant.variant_group_id,
      carePlanId: variant.care_plan_id,
      variantName: variant.variant_name,
      targetAgeMin: variant.target_age_min,
      targetAgeMax: variant.target_age_max,
      targetSex: variant.target_sex,
      targetConditions: variant.target_conditions,
      targetRiskFactors: variant.target_risk_factors,
      exclusionConditions: variant.exclusion_conditions,
      priorityScore: variant.priority_score,
      isDefault: variant.is_default,
    };
  }

  static selectionRuleToGraphQL(rule: EngineSelectionRule) {
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      variantGroupId: rule.variant_group_id,
      ruleDefinition: rule.rule_definition,
      priority: rule.priority,
      isActive: rule.is_active,
      createdAt: rule.created_at,
    };
  }

  static analyticsToGraphQL(analytics: EngineAnalyticsSummary) {
    return {
      totalSessions: analytics.total_sessions,
      averageProcessingTimeMs: analytics.average_processing_time_ms,
      topMatchTypes: analytics.top_match_types,
      topConditionCodes: analytics.top_condition_codes,
      acceptanceRate: analytics.acceptance_rate,
      period: analytics.period,
    };
  }
}
