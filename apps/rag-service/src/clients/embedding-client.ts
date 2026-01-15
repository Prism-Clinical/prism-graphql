/**
 * RAG Embeddings Client
 *
 * HTTP client for the RAG Embeddings ML service.
 * Generates vector embeddings for semantic search and matching.
 */

export interface PatientContextInput {
  conditionCodes: string[];
  conditionNames?: string[];
  medicationCodes?: string[];
  medicationNames?: string[];
  labCodes?: string[];
  labNames?: string[];
  symptoms?: string[];
  age?: number;
  sex?: string;
  complications?: string[];
  riskFactors?: string[];
}

export interface GuidelineInput {
  id: string;
  title: string;
  category: string;
  summaryText: string;
  applicableConditions: string[];
  applicableMedications: string[];
  evidenceGrade?: string;
  source?: string;
  fullText?: string;
}

export interface TemplateInput {
  id: string;
  name: string;
  category: string;
  description?: string;
  conditionCodes?: string[];
  goals?: Array<{ description: string }>;
  interventions?: Array<{ description: string; type?: string }>;
}

export interface EmbeddingResponse {
  embedding: number[];
  dimension: number;
  model: string;
  processingTimeMs: number;
}

export interface BatchEmbeddingResponse {
  embeddings: number[][];
  count: number;
  dimension: number;
  model: string;
  processingTimeMs: number;
}

export class EmbeddingClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options?: { baseUrl?: string; timeout?: number }) {
    this.baseUrl =
      options?.baseUrl ||
      process.env.ML_EMBEDDINGS_URL ||
      "http://rag-embeddings:8080";
    this.timeout = options?.timeout || 10000;
  }

  /**
   * Generate embedding for patient context.
   */
  async embedPatientContext(
    context: PatientContextInput
  ): Promise<EmbeddingResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(
        `${this.baseUrl}/embeddings/patient-context`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            condition_codes: context.conditionCodes,
            condition_names: context.conditionNames,
            medication_codes: context.medicationCodes,
            medication_names: context.medicationNames,
            lab_codes: context.labCodes,
            lab_names: context.labNames,
            symptoms: context.symptoms,
            age: context.age,
            sex: context.sex,
            complications: context.complications,
            risk_factors: context.riskFactors,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Patient context embedding failed: ${response.status} - ${error}`
        );
      }

      const data = await response.json();

      return {
        embedding: data.embedding,
        dimension: data.dimension,
        model: data.model,
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Embedding request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generate embedding for a guideline.
   */
  async embedGuideline(guideline: GuidelineInput): Promise<EmbeddingResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/embeddings/guideline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: guideline.id,
          title: guideline.title,
          category: guideline.category,
          summary_text: guideline.summaryText,
          applicable_conditions: guideline.applicableConditions,
          applicable_medications: guideline.applicableMedications,
          evidence_grade: guideline.evidenceGrade,
          source: guideline.source,
          full_text: guideline.fullText,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Guideline embedding failed: ${response.status} - ${error}`
        );
      }

      const data = await response.json();

      return {
        embedding: data.embedding,
        dimension: data.dimension,
        model: data.model,
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Embedding request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generate embeddings for multiple guidelines in batch.
   */
  async embedGuidelinesBatch(
    guidelines: GuidelineInput[]
  ): Promise<BatchEmbeddingResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.timeout * Math.ceil(guidelines.length / 10)
    );

    try {
      const response = await fetch(
        `${this.baseUrl}/embeddings/guidelines/batch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guidelines: guidelines.map((g) => ({
              id: g.id,
              title: g.title,
              category: g.category,
              summary_text: g.summaryText,
              applicable_conditions: g.applicableConditions,
              applicable_medications: g.applicableMedications,
              evidence_grade: g.evidenceGrade,
              source: g.source,
              full_text: g.fullText,
            })),
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Batch guideline embedding failed: ${response.status} - ${error}`
        );
      }

      const data = await response.json();

      return {
        embeddings: data.results.map((r: any) => r.embedding),
        count: data.results.length,
        dimension: data.results[0]?.embedding?.length || 0,
        model: "sentence-transformers/all-mpnet-base-v2",
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Batch embedding request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generate embedding for a care plan template.
   */
  async embedTemplate(template: TemplateInput): Promise<EmbeddingResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/embeddings/template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: template.id,
          name: template.name,
          category: template.category,
          description: template.description,
          condition_codes: template.conditionCodes,
          goals: template.goals,
          interventions: template.interventions,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Template embedding failed: ${response.status} - ${error}`
        );
      }

      const data = await response.json();

      return {
        embedding: data.embedding,
        dimension: data.dimension,
        model: data.model,
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Embedding request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if the embedding service is healthy.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get embedding service info.
   */
  async getInfo(): Promise<{
    model: string;
    dimension: number;
    modelLoaded: boolean;
  }> {
    const response = await fetch(`${this.baseUrl}/embeddings/info`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      throw new Error("Failed to get embedding service info");
    }

    const data = await response.json();
    return {
      model: data.model,
      dimension: data.dimension,
      modelLoaded: data.model_loaded,
    };
  }
}

// Singleton instance
let embeddingClient: EmbeddingClient | null = null;

export function getEmbeddingClient(): EmbeddingClient {
  if (!embeddingClient) {
    embeddingClient = new EmbeddingClient();
  }
  return embeddingClient;
}
