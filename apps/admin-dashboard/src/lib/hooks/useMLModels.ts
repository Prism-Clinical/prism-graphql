import { useState, useCallback, useEffect, useRef } from 'react';
import { gql } from 'graphql-tag';

const GRAPHQL_ENDPOINT = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:4000/graphql';

// Types
export interface MLModelFilterCriteria {
  conditionCodePrefixes?: string[];
  conditionCodes?: string[];
  trainingTags?: string[];
  categories?: string[];
}

export interface MLModelVersion {
  id: string;
  modelId: string;
  version: string;
  modelPath: string;
  isActive: boolean;
  isDefault: boolean;
  metrics: Record<string, any> | null;
  trainingJobId: string | null;
  trainingDataSnapshot: Record<string, any> | null;
  createdAt: string;
  deployedAt: string | null;
}

export interface MLModel {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  modelType: string;
  filterCriteria: MLModelFilterCriteria | null;
  targetConditions: string[] | null;
  isActive: boolean;
  isDefault: boolean;
  versions: MLModelVersion[];
  activeVersion: MLModelVersion | null;
  trainingDataCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MLModelTrainingData {
  id: string;
  modelId: string;
  carePlanId: string;
  assignmentType: string;
  carePlanTitle: string | null;
  conditionCodes: string[] | null;
  trainingTags: string[] | null;
  assignedAt: string;
  assignedBy: string | null;
  notes: string | null;
}

export interface ModelLoadStatus {
  modelId: string;
  modelSlug: string;
  versionId: string;
  version: string;
  isLoaded: boolean;
  isDefault: boolean;
  isFitted: boolean;
  loadedAt: string | null;
  metrics: Record<string, any> | null;
}

export interface FilterPreviewResult {
  carePlanId: string;
  title: string;
  conditionCodes: string[];
  trainingTags: string[] | null;
}

export interface TrainingPreview {
  modelId: string;
  modelName: string | null;
  totalExamples: number;
  withEmbeddings: number;
  byAssignmentType: Record<string, number>;
  conditionCodes: string[];
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

// GraphQL Queries
const ML_MODELS_QUERY = gql`
  query MLModels($isActive: Boolean) {
    mlModels(isActive: $isActive) {
      id
      name
      slug
      description
      modelType
      filterCriteria {
        conditionCodePrefixes
        conditionCodes
        trainingTags
        categories
      }
      targetConditions
      isActive
      isDefault
      activeVersion {
        id
        version
        isActive
        isDefault
        createdAt
        metrics
      }
      trainingDataCount
      createdAt
      updatedAt
    }
  }
`;

const ML_MODEL_QUERY = gql`
  query MLModel($id: ID!) {
    mlModel(id: $id) {
      id
      name
      slug
      description
      modelType
      filterCriteria {
        conditionCodePrefixes
        conditionCodes
        trainingTags
        categories
      }
      targetConditions
      isActive
      isDefault
      versions {
        id
        modelId
        version
        modelPath
        isActive
        isDefault
        metrics
        trainingJobId
        trainingDataSnapshot
        createdAt
        deployedAt
      }
      activeVersion {
        id
        version
        isActive
        isDefault
        createdAt
        metrics
      }
      trainingDataCount
      createdAt
      updatedAt
    }
  }
`;

const ML_MODEL_VERSIONS_QUERY = gql`
  query MLModelVersions($modelId: ID!, $isActive: Boolean) {
    mlModelVersions(modelId: $modelId, isActive: $isActive) {
      id
      modelId
      version
      modelPath
      isActive
      isDefault
      metrics
      trainingJobId
      trainingDataSnapshot
      createdAt
      deployedAt
    }
  }
`;

const ML_MODEL_TRAINING_DATA_QUERY = gql`
  query MLModelTrainingData($modelId: ID!, $assignmentType: String) {
    mlModelTrainingData(modelId: $modelId, assignmentType: $assignmentType) {
      id
      modelId
      carePlanId
      assignmentType
      carePlanTitle
      conditionCodes
      trainingTags
      assignedAt
      assignedBy
      notes
    }
  }
`;

const ML_MODEL_TRAINING_PREVIEW_QUERY = gql`
  query MLModelTrainingPreview($modelId: ID!) {
    mlModelTrainingPreview(modelId: $modelId) {
      modelId
      modelName
      totalExamples
      withEmbeddings
      byAssignmentType
      conditionCodes
    }
  }
`;

const PREVIEW_FILTER_CRITERIA_QUERY = gql`
  query PreviewFilterCriteria($filterCriteria: MLModelFilterCriteriaInput!) {
    previewFilterCriteria(filterCriteria: $filterCriteria) {
      carePlanId
      title
      conditionCodes
      trainingTags
    }
  }
`;

const LOADED_MODELS_QUERY = gql`
  query LoadedModels {
    loadedModels {
      modelId
      modelSlug
      versionId
      version
      isLoaded
      isDefault
      isFitted
      loadedAt
      metrics
    }
  }
`;

// GraphQL Mutations
const CREATE_ML_MODEL_MUTATION = gql`
  mutation CreateMLModel($input: CreateMLModelInput!) {
    createMLModel(input: $input) {
      id
      name
      slug
      description
      modelType
      filterCriteria {
        conditionCodePrefixes
        conditionCodes
        trainingTags
        categories
      }
      targetConditions
      isActive
      isDefault
      trainingDataCount
      createdAt
      updatedAt
    }
  }
`;

const UPDATE_ML_MODEL_MUTATION = gql`
  mutation UpdateMLModel($id: ID!, $input: UpdateMLModelInput!) {
    updateMLModel(id: $id, input: $input) {
      id
      name
      slug
      description
      modelType
      filterCriteria {
        conditionCodePrefixes
        conditionCodes
        trainingTags
        categories
      }
      targetConditions
      isActive
      isDefault
      trainingDataCount
      createdAt
      updatedAt
    }
  }
`;

const DELETE_ML_MODEL_MUTATION = gql`
  mutation DeleteMLModel($id: ID!) {
    deleteMLModel(id: $id)
  }
`;

const TRAIN_MODEL_MUTATION = gql`
  mutation TrainModel($input: TrainModelInput!) {
    trainModel(input: $input) {
      id
      modelType
      jobName
      status
      progressPercent
      statusMessage
      createdAt
    }
  }
`;

const SET_ACTIVE_VERSION_MUTATION = gql`
  mutation SetActiveVersion($input: SetActiveVersionInput!) {
    setActiveVersion(input: $input) {
      id
      modelId
      version
      isActive
      isDefault
      createdAt
      deployedAt
    }
  }
`;

const ASSIGN_TRAINING_DATA_MUTATION = gql`
  mutation AssignTrainingData($input: AssignTrainingDataInput!) {
    assignTrainingData(input: $input) {
      id
      modelId
      carePlanId
      assignmentType
      carePlanTitle
      conditionCodes
      trainingTags
      assignedAt
      notes
    }
  }
`;

const UNASSIGN_TRAINING_DATA_MUTATION = gql`
  mutation UnassignTrainingData($input: UnassignTrainingDataInput!) {
    unassignTrainingData(input: $input)
  }
`;

const LOAD_MODEL_MUTATION = gql`
  mutation LoadModel($input: LoadModelInput!) {
    loadModel(input: $input) {
      modelId
      modelSlug
      versionId
      version
      isLoaded
      isDefault
      isFitted
      loadedAt
      metrics
    }
  }
`;

const UNLOAD_MODEL_MUTATION = gql`
  mutation UnloadModel($modelId: ID!) {
    unloadModel(modelId: $modelId)
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

/**
 * Fetch all ML models
 */
export function useMLModels(options?: { isActive?: boolean }) {
  const [models, setModels] = useState<MLModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const isInitialLoad = useRef(true);

  const fetchModels = useCallback(async (silent = false) => {
    try {
      if (!silent && isInitialLoad.current) {
        setLoading(true);
      }
      const data = await graphqlFetch<{ mlModels: MLModel[] }>(
        ML_MODELS_QUERY.loc?.source.body || '',
        { isActive: options?.isActive }
      );
      setModels(data.mlModels);
      setError(null);
      isInitialLoad.current = false;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      if (!silent || isInitialLoad.current) {
        setLoading(false);
      }
    }
  }, [options?.isActive]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const silentRefetch = useCallback(() => fetchModels(true), [fetchModels]);

  return { models, loading, error, refetch: silentRefetch };
}

/**
 * Fetch a single ML model by ID
 */
export function useMLModel(id: string | null) {
  const [model, setModel] = useState<MLModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const isInitialLoad = useRef(true);

  const fetchModel = useCallback(async (silent = false) => {
    if (!id) {
      setModel(null);
      setLoading(false);
      return;
    }

    try {
      if (!silent && isInitialLoad.current) {
        setLoading(true);
      }
      const data = await graphqlFetch<{ mlModel: MLModel | null }>(
        ML_MODEL_QUERY.loc?.source.body || '',
        { id }
      );
      setModel(data.mlModel);
      setError(null);
      isInitialLoad.current = false;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      if (!silent || isInitialLoad.current) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    fetchModel();
  }, [fetchModel]);

  const silentRefetch = useCallback(() => fetchModel(true), [fetchModel]);

  return { model, loading, error, refetch: silentRefetch };
}

/**
 * Fetch versions for a model
 */
export function useMLModelVersions(modelId: string | null, options?: { isActive?: boolean }) {
  const [versions, setVersions] = useState<MLModelVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const isInitialLoad = useRef(true);

  const fetchVersions = useCallback(async (silent = false) => {
    if (!modelId) {
      setVersions([]);
      setLoading(false);
      return;
    }

    try {
      if (!silent && isInitialLoad.current) {
        setLoading(true);
      }
      const data = await graphqlFetch<{ mlModelVersions: MLModelVersion[] }>(
        ML_MODEL_VERSIONS_QUERY.loc?.source.body || '',
        { modelId, isActive: options?.isActive }
      );
      setVersions(data.mlModelVersions);
      setError(null);
      isInitialLoad.current = false;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      if (!silent || isInitialLoad.current) {
        setLoading(false);
      }
    }
  }, [modelId, options?.isActive]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const silentRefetch = useCallback(() => fetchVersions(true), [fetchVersions]);

  return { versions, loading, error, refetch: silentRefetch };
}

/**
 * Fetch training data for a model
 */
export function useMLModelTrainingData(modelId: string | null, assignmentType?: string) {
  const [trainingData, setTrainingData] = useState<MLModelTrainingData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTrainingData = useCallback(async () => {
    if (!modelId) {
      setTrainingData([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await graphqlFetch<{ mlModelTrainingData: MLModelTrainingData[] }>(
        ML_MODEL_TRAINING_DATA_QUERY.loc?.source.body || '',
        { modelId, assignmentType }
      );
      setTrainingData(data.mlModelTrainingData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [modelId, assignmentType]);

  useEffect(() => {
    fetchTrainingData();
  }, [fetchTrainingData]);

  return { trainingData, loading, error, refetch: fetchTrainingData };
}

/**
 * Fetch training preview for a model
 */
export function useMLModelTrainingPreview(modelId: string | null) {
  const [preview, setPreview] = useState<TrainingPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!modelId) {
      setPreview(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await graphqlFetch<{ mlModelTrainingPreview: TrainingPreview }>(
        ML_MODEL_TRAINING_PREVIEW_QUERY.loc?.source.body || '',
        { modelId }
      );
      setPreview(data.mlModelTrainingPreview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  return { preview, loading, error, refetch: fetchPreview };
}

/**
 * Preview filter criteria results
 */
export function usePreviewFilterCriteria() {
  const [results, setResults] = useState<FilterPreviewResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const preview = useCallback(async (filterCriteria: MLModelFilterCriteria) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ previewFilterCriteria: FilterPreviewResult[] }>(
        PREVIEW_FILTER_CRITERIA_QUERY.loc?.source.body || '',
        { filterCriteria }
      );
      setResults(data.previewFilterCriteria);
      setError(null);
      return data.previewFilterCriteria;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, preview, loading, error };
}

/**
 * Fetch loaded models
 */
export function useLoadedModels() {
  const [loadedModels, setLoadedModels] = useState<ModelLoadStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const isInitialLoad = useRef(true);

  const fetchLoadedModels = useCallback(async (silent = false) => {
    try {
      if (!silent && isInitialLoad.current) {
        setLoading(true);
      }
      const data = await graphqlFetch<{ loadedModels: ModelLoadStatus[] }>(
        LOADED_MODELS_QUERY.loc?.source.body || ''
      );
      setLoadedModels(data.loadedModels);
      setError(null);
      isInitialLoad.current = false;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      if (!silent || isInitialLoad.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchLoadedModels();
  }, [fetchLoadedModels]);

  const silentRefetch = useCallback(() => fetchLoadedModels(true), [fetchLoadedModels]);

  return { loadedModels, loading, error, refetch: silentRefetch };
}

// Mutation Hooks

/**
 * Create a new ML model
 */
export function useCreateMLModel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const create = useCallback(
    async (input: {
      name: string;
      slug: string;
      description?: string;
      filterCriteria?: MLModelFilterCriteria;
      targetConditions?: string[];
      isDefault?: boolean;
    }) => {
      try {
        setLoading(true);
        const data = await graphqlFetch<{ createMLModel: MLModel }>(
          CREATE_ML_MODEL_MUTATION.loc?.source.body || '',
          { input }
        );
        setError(null);
        return data.createMLModel;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { create, loading, error };
}

/**
 * Update an existing ML model
 */
export function useUpdateMLModel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const update = useCallback(
    async (
      id: string,
      input: {
        name?: string;
        description?: string;
        filterCriteria?: MLModelFilterCriteria;
        targetConditions?: string[];
        isActive?: boolean;
        isDefault?: boolean;
      }
    ) => {
      try {
        setLoading(true);
        const data = await graphqlFetch<{ updateMLModel: MLModel }>(
          UPDATE_ML_MODEL_MUTATION.loc?.source.body || '',
          { id, input }
        );
        setError(null);
        return data.updateMLModel;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { update, loading, error };
}

/**
 * Delete an ML model
 */
export function useDeleteMLModel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const deleteModel = useCallback(async (id: string) => {
    try {
      setLoading(true);
      await graphqlFetch<{ deleteMLModel: boolean }>(
        DELETE_ML_MODEL_MUTATION.loc?.source.body || '',
        { id }
      );
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { deleteModel, loading, error };
}

/**
 * Train a model
 */
export function useTrainModel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const train = useCallback(
    async (input: {
      modelId: string;
      jobName?: string;
      includeValidationOutcomes?: boolean;
    }) => {
      try {
        setLoading(true);
        const data = await graphqlFetch<{ trainModel: TrainingJob }>(
          TRAIN_MODEL_MUTATION.loc?.source.body || '',
          { input }
        );
        setError(null);
        return data.trainModel;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { train, loading, error };
}

/**
 * Set a version as active
 */
export function useSetActiveVersion() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const setActive = useCallback(
    async (input: { versionId: string; isDefault?: boolean }) => {
      try {
        setLoading(true);
        const data = await graphqlFetch<{ setActiveVersion: MLModelVersion }>(
          SET_ACTIVE_VERSION_MUTATION.loc?.source.body || '',
          { input }
        );
        setError(null);
        return data.setActiveVersion;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { setActive, loading, error };
}

/**
 * Assign training data to a model
 */
export function useAssignTrainingData() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const assign = useCallback(
    async (input: { modelId: string; carePlanIds: string[]; notes?: string }) => {
      try {
        setLoading(true);
        const data = await graphqlFetch<{ assignTrainingData: MLModelTrainingData[] }>(
          ASSIGN_TRAINING_DATA_MUTATION.loc?.source.body || '',
          { input }
        );
        setError(null);
        return data.assignTrainingData;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { assign, loading, error };
}

/**
 * Unassign training data from a model
 */
export function useUnassignTrainingData() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const unassign = useCallback(
    async (input: { modelId: string; carePlanIds: string[] }) => {
      try {
        setLoading(true);
        await graphqlFetch<{ unassignTrainingData: boolean }>(
          UNASSIGN_TRAINING_DATA_MUTATION.loc?.source.body || '',
          { input }
        );
        setError(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { unassign, loading, error };
}

/**
 * Load a model into memory
 */
export function useLoadModel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(
    async (input: { modelId: string; versionId?: string }) => {
      try {
        setLoading(true);
        const data = await graphqlFetch<{ loadModel: ModelLoadStatus }>(
          LOAD_MODEL_MUTATION.loc?.source.body || '',
          { input }
        );
        setError(null);
        return data.loadModel;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { load, loading, error };
}

/**
 * Unload a model from memory
 */
export function useUnloadModel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const unload = useCallback(async (modelId: string) => {
    try {
      setLoading(true);
      await graphqlFetch<{ unloadModel: boolean }>(
        UNLOAD_MODEL_MUTATION.loc?.source.body || '',
        { modelId }
      );
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { unload, loading, error };
}
