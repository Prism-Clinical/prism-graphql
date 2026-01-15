import { useState, useCallback, useEffect, useRef } from 'react';
import { gql } from 'graphql-tag';

const GRAPHQL_ENDPOINT = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:4000/graphql';

// Types
export interface RecommenderStats {
  totalTrainingExamples: number;
  totalTemplates: number;
  embeddingsGenerated: number;
  pendingEmbeddings: number;
  modelVersion: string | null;
  lastTrainedAt: string | null;
  averageConfidence: number | null;
}

export interface ModelInfo {
  modelType: string;
  version: string;
  isLoaded: boolean;
  lastTrainedAt: string | null;
  trainingMetrics: Record<string, any> | null;
  featureDimension: number;
}

export interface TrainingJob {
  id: string;
  modelType: string;
  jobName: string | null;
  status: string;
  progressPercent: number;
  statusMessage: string | null;
  metrics: Record<string, any> | null;
  modelPath: string | null;
  modelVersion: string | null;
  trainingExamplesCount: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// Queries
const RECOMMENDER_STATS_QUERY = gql`
  query RecommenderStats {
    recommenderStats {
      totalTrainingExamples
      totalTemplates
      embeddingsGenerated
      pendingEmbeddings
      modelVersion
      lastTrainedAt
      averageConfidence
    }
  }
`;

const RECOMMENDER_MODEL_INFO_QUERY = gql`
  query RecommenderModelInfo {
    recommenderModelInfo {
      modelType
      version
      isLoaded
      lastTrainedAt
      trainingMetrics
      featureDimension
    }
  }
`;

const TRAINING_JOBS_QUERY = gql`
  query TrainingJobs($status: TrainingJobStatus, $first: Int) {
    trainingJobs(status: $status, first: $first) {
      id
      modelType
      jobName
      status
      progressPercent
      statusMessage
      metrics
      modelPath
      modelVersion
      trainingExamplesCount
      startedAt
      completedAt
      createdAt
    }
  }
`;

const TRIGGER_TRAINING_MUTATION = gql`
  mutation TriggerRecommenderTraining($input: TriggerTrainingInput) {
    triggerRecommenderTraining(input: $input) {
      id
      status
      progressPercent
      createdAt
    }
  }
`;

const GENERATE_EMBEDDINGS_MUTATION = gql`
  mutation GenerateMissingEmbeddings {
    generateMissingEmbeddings {
      generatedCount
      failedCount
      processingTimeMs
    }
  }
`;

// GraphQL client helper
async function graphqlFetch<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const result = await response.json();

  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'GraphQL Error');
  }

  return result.data;
}

// Hooks
export function useRecommenderStats() {
  const [stats, setStats] = useState<RecommenderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ recommenderStats: RecommenderStats }>(
        RECOMMENDER_STATS_QUERY.loc?.source.body || ''
      );
      setStats(data.recommenderStats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
}

export function useRecommenderModelInfo() {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchModelInfo = useCallback(async () => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ recommenderModelInfo: ModelInfo }>(
        RECOMMENDER_MODEL_INFO_QUERY.loc?.source.body || ''
      );
      setModelInfo(data.recommenderModelInfo);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModelInfo();
  }, [fetchModelInfo]);

  return { modelInfo, loading, error, refetch: fetchModelInfo };
}

export function useTrainingJobs(options?: { status?: string; first?: number }) {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const isInitialLoad = useRef(true);

  const fetchJobs = useCallback(async (silent = false) => {
    try {
      // Only show loading on initial load, not on background refreshes
      if (!silent && isInitialLoad.current) {
        setLoading(true);
      }
      const data = await graphqlFetch<{ trainingJobs: TrainingJob[] }>(
        TRAINING_JOBS_QUERY.loc?.source.body || '',
        { status: options?.status, first: options?.first || 20 }
      );
      setJobs(data.trainingJobs);
      setError(null);
      isInitialLoad.current = false;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      if (!silent || isInitialLoad.current) {
        setLoading(false);
      }
    }
  }, [options?.status, options?.first]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Return a silent refetch for background polling
  const silentRefetch = useCallback(() => fetchJobs(true), [fetchJobs]);

  return { jobs, loading, error, refetch: silentRefetch };
}

export function useTriggerTraining() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const trigger = useCallback(
    async (input?: { jobName?: string; includeValidationOutcomes?: boolean }) => {
      try {
        setLoading(true);
        const data = await graphqlFetch<{ triggerRecommenderTraining: TrainingJob }>(
          TRIGGER_TRAINING_MUTATION.loc?.source.body || '',
          { input }
        );
        setError(null);
        return data.triggerRecommenderTraining;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { trigger, loading, error };
}

export function useGenerateEmbeddings() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const generate = useCallback(async () => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{
        generateMissingEmbeddings: {
          generatedCount: number;
          failedCount: number;
          processingTimeMs: number;
        };
      }>(GENERATE_EMBEDDINGS_MUTATION.loc?.source.body || '');
      setError(null);
      return data.generateMissingEmbeddings;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { generate, loading, error };
}
