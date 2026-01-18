import { useState, useCallback, useEffect, useRef } from 'react';
import { gql } from 'graphql-tag';

const GRAPHQL_ENDPOINT = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:4000/graphql';

// ============================================================================
// Types
// ============================================================================

export enum PathwayNodeType {
  ROOT = 'ROOT',
  DECISION = 'DECISION',
  BRANCH = 'BRANCH',
  RECOMMENDATION = 'RECOMMENDATION',
}

export enum PathwayActionType {
  MEDICATION = 'MEDICATION',
  LAB = 'LAB',
  REFERRAL = 'REFERRAL',
  PROCEDURE = 'PROCEDURE',
  EDUCATION = 'EDUCATION',
  MONITORING = 'MONITORING',
  LIFESTYLE = 'LIFESTYLE',
  FOLLOW_UP = 'FOLLOW_UP',
  URGENT_CARE = 'URGENT_CARE',
}

export enum PathwayInstanceStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED',
  OVERRIDDEN = 'OVERRIDDEN',
}

export enum SelectionType {
  ML_RECOMMENDED = 'ML_RECOMMENDED',
  PROVIDER_SELECTED = 'PROVIDER_SELECTED',
  AUTO_APPLIED = 'AUTO_APPLIED',
}

export interface DecisionFactor {
  type: string;
  label: string;
  value?: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ClinicalPathway {
  id: string;
  name: string;
  slug: string;
  description?: string;
  primaryConditionCodes: string[];
  applicableContexts?: Record<string, unknown>;
  version: string;
  evidenceSource?: string;
  evidenceGrade?: string;
  isActive: boolean;
  isPublished: boolean;
  publishedAt?: string;
  createdAt: string;
  createdBy?: string;
  updatedAt: string;
  nodeCount?: number;
}

export interface PathwayNode {
  id: string;
  pathwayId: string;
  parentNodeId?: string;
  nodeType: PathwayNodeType;
  title: string;
  description?: string;
  actionType?: PathwayActionType;
  decisionFactors: DecisionFactor[];
  suggestedTemplateId?: string;
  sortOrder: number;
  baseConfidence: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  children?: PathwayNode[];
  mlConfidence?: number;
  isRecommendedPath?: boolean;
}

export interface PathwayUsageStats {
  totalInstances: number;
  completedInstances: number;
  abandonedInstances: number;
  overrideRate: number;
  avgCompletionTimeMinutes: number;
}

export interface PatientContext {
  patientId?: string;
  age?: number;
  gender?: string;
  conditions?: string[];
  allergies?: string[];
  currentMedications?: string[];
  labResults?: Record<string, number>;
  vitalSigns?: Record<string, number>;
  medicalHistory?: string[];
}

export interface DecisionTreeResult {
  pathway: ClinicalPathway;
  tree: DecisionNodeTree;
  modelVersion?: string;
  processingTimeMs: number;
}

export interface DecisionNodeTree {
  id: string;
  type: PathwayNodeType;
  title: string;
  description: string;
  confidence: number;
  factors: DecisionFactor[];
  children: DecisionNodeTree[];
  alternativeCount: number;
  isRecommendedPath: boolean;
  recommendation?: {
    templateId?: string;
    title: string;
    description?: string;
    actionType?: PathwayActionType;
    medications?: string[];
    procedures?: string[];
    confidence: number;
  };
}

export interface PathwayRecommendation {
  pathway: ClinicalPathway;
  matchScore: number;
  matchReasons: string[];
  mlConfidence: number;
}

export interface PatientPathwayInstance {
  id: string;
  patientId: string;
  providerId?: string;
  pathwayId: string;
  patientContext: Record<string, unknown>;
  mlModelId?: string;
  mlModelVersion?: string;
  mlRecommendedPath?: string[];
  mlConfidenceScores?: Record<string, number>;
  status: PathwayInstanceStatus;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PatientPathwaySelection {
  id: string;
  instanceId: string;
  nodeId: string;
  selectionType: SelectionType;
  mlConfidence?: number;
  mlRank?: number;
  overrideReason?: string;
  resultingCarePlanId?: string;
  selectedAt: string;
  selectedBy?: string;
}

// ============================================================================
// GraphQL Queries
// ============================================================================

const CLINICAL_PATHWAYS_QUERY = gql`
  query ClinicalPathways($filter: PathwayFilterInput, $first: Int) {
    clinicalPathways(filter: $filter, pagination: { first: $first }) {
      edges {
        node {
          id
          name
          slug
          description
          primaryConditionCodes
          version
          evidenceGrade
          isActive
          isPublished
          nodeCount
          createdAt
          updatedAt
        }
      }
      totalCount
    }
  }
`;

const CLINICAL_PATHWAY_QUERY = gql`
  query ClinicalPathway($id: ID!) {
    clinicalPathway(id: $id) {
      id
      name
      slug
      description
      primaryConditionCodes
      applicableContexts
      version
      evidenceSource
      evidenceGrade
      isActive
      isPublished
      publishedAt
      createdAt
      createdBy
      updatedAt
      nodeCount
      usageStats {
        totalInstances
        completedInstances
        abandonedInstances
        overrideRate
        avgCompletionTimeMinutes
      }
    }
  }
`;

const PATHWAY_NODES_QUERY = gql`
  query PathwayNodes($pathwayId: ID!) {
    pathwayNodes(pathwayId: $pathwayId) {
      id
      pathwayId
      parentNodeId
      nodeType
      title
      description
      actionType
      decisionFactors
      sortOrder
      baseConfidence
      isActive
    }
  }
`;

const DECISION_TREE_QUERY = gql`
  query GetDecisionTree($pathwayId: ID!, $patientContext: PatientContextInput) {
    getDecisionTree(pathwayId: $pathwayId, patientContext: $patientContext) {
      pathway {
        id
        name
        slug
        description
        primaryConditionCodes
        version
      }
      tree {
        id
        type
        title
        description
        confidence
        factors
        alternativeCount
        isRecommendedPath
        recommendation {
          templateId
          title
          description
          actionType
          medications
          procedures
          confidence
        }
        children {
          id
          type
          title
          description
          confidence
          factors
          alternativeCount
          isRecommendedPath
          recommendation {
            templateId
            title
            description
            actionType
            medications
            procedures
            confidence
          }
          children {
            id
            type
            title
            description
            confidence
            factors
            alternativeCount
            isRecommendedPath
            recommendation {
              templateId
              title
              description
              actionType
              medications
              procedures
              confidence
            }
            children {
              id
              type
              title
              description
              confidence
              isRecommendedPath
            }
          }
        }
      }
      modelVersion
      processingTimeMs
    }
  }
`;

const RECOMMEND_PATHWAYS_QUERY = gql`
  query RecommendPathwaysForPatient($context: PatientContextInput!, $first: Int) {
    recommendPathwaysForPatient(context: $context, first: $first) {
      pathway {
        id
        name
        slug
        description
        primaryConditionCodes
        version
      }
      matchScore
      matchReasons
      mlConfidence
    }
  }
`;

const PATIENT_PATHWAY_HISTORY_QUERY = gql`
  query PatientPathwayHistory($patientId: ID!) {
    patientPathwayHistory(patientId: $patientId) {
      id
      patientId
      pathwayId
      patientContext
      mlRecommendedPath
      status
      startedAt
      completedAt
    }
  }
`;

// ============================================================================
// GraphQL Mutations
// ============================================================================

const CREATE_PATHWAY_MUTATION = gql`
  mutation CreateClinicalPathway($input: CreateClinicalPathwayInput!) {
    createClinicalPathway(input: $input) {
      id
      name
      slug
      description
      primaryConditionCodes
      version
      isActive
      createdAt
    }
  }
`;

const UPDATE_PATHWAY_MUTATION = gql`
  mutation UpdateClinicalPathway($id: ID!, $input: UpdateClinicalPathwayInput!) {
    updateClinicalPathway(id: $id, input: $input) {
      id
      name
      description
      primaryConditionCodes
      version
      isActive
      updatedAt
    }
  }
`;

const PUBLISH_PATHWAY_MUTATION = gql`
  mutation PublishClinicalPathway($id: ID!) {
    publishClinicalPathway(id: $id) {
      id
      isPublished
      publishedAt
    }
  }
`;

const UNPUBLISH_PATHWAY_MUTATION = gql`
  mutation UnpublishClinicalPathway($id: ID!) {
    unpublishClinicalPathway(id: $id) {
      id
      isPublished
      publishedAt
    }
  }
`;

const DELETE_PATHWAY_MUTATION = gql`
  mutation DeleteClinicalPathway($id: ID!) {
    deleteClinicalPathway(id: $id)
  }
`;

const CREATE_PATHWAY_NODE_MUTATION = gql`
  mutation CreatePathwayNode($input: CreatePathwayNodeInput!) {
    createPathwayNode(input: $input) {
      id
      pathwayId
      parentNodeId
      nodeType
      title
      description
      actionType
      decisionFactors
      sortOrder
      baseConfidence
    }
  }
`;

const UPDATE_PATHWAY_NODE_MUTATION = gql`
  mutation UpdatePathwayNode($id: ID!, $input: UpdatePathwayNodeInput!) {
    updatePathwayNode(id: $id, input: $input) {
      id
      title
      description
      actionType
      decisionFactors
      sortOrder
      baseConfidence
      isActive
    }
  }
`;

const DELETE_PATHWAY_NODE_MUTATION = gql`
  mutation DeletePathwayNode($id: ID!) {
    deletePathwayNode(id: $id)
  }
`;

const START_PATHWAY_INSTANCE_MUTATION = gql`
  mutation StartPathwayInstance($input: StartPathwayInstanceInput!) {
    startPathwayInstance(input: $input) {
      id
      patientId
      pathwayId
      patientContext
      status
      startedAt
    }
  }
`;

const RECORD_PATHWAY_SELECTION_MUTATION = gql`
  mutation RecordPathwaySelection($input: RecordPathwaySelectionInput!) {
    recordPathwaySelection(input: $input) {
      id
      instanceId
      nodeId
      selectionType
      mlConfidence
      overrideReason
      selectedAt
    }
  }
`;

const COMPLETE_PATHWAY_INSTANCE_MUTATION = gql`
  mutation CompletePathwayInstance($instanceId: ID!) {
    completePathwayInstance(instanceId: $instanceId) {
      id
      status
      completedAt
    }
  }
`;

const LINK_SELECTION_TO_CAREPLAN_MUTATION = gql`
  mutation LinkSelectionToCarePlan($selectionId: ID!, $carePlanId: ID!) {
    linkSelectionToCarePlan(selectionId: $selectionId, carePlanId: $carePlanId) {
      id
      resultingCarePlanId
    }
  }
`;

// ============================================================================
// GraphQL Helper
// ============================================================================

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

// ============================================================================
// Hooks
// ============================================================================

export function usePathways(options?: { isActive?: boolean; isPublished?: boolean; first?: number }) {
  const [pathways, setPathways] = useState<ClinicalPathway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPathways = useCallback(async () => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ clinicalPathways: { edges: { node: ClinicalPathway }[]; totalCount: number } }>(
        CLINICAL_PATHWAYS_QUERY.loc?.source.body || '',
        { filter: { isActive: options?.isActive, isPublished: options?.isPublished }, first: options?.first || 50 }
      );
      setPathways(data.clinicalPathways.edges.map(e => e.node));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [options?.isActive, options?.isPublished, options?.first]);

  useEffect(() => {
    fetchPathways();
  }, [fetchPathways]);

  return { pathways, loading, error, refetch: fetchPathways };
}

export function usePathway(id: string) {
  const [pathway, setPathway] = useState<ClinicalPathway | null>(null);
  const [usageStats, setUsageStats] = useState<PathwayUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPathway = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await graphqlFetch<{ clinicalPathway: ClinicalPathway & { usageStats?: PathwayUsageStats } }>(
        CLINICAL_PATHWAY_QUERY.loc?.source.body || '',
        { id }
      );
      setPathway(data.clinicalPathway);
      setUsageStats(data.clinicalPathway?.usageStats || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchPathway();
  }, [fetchPathway]);

  return { pathway, usageStats, loading, error, refetch: fetchPathway };
}

export function usePathwayNodes(pathwayId: string) {
  const [nodes, setNodes] = useState<PathwayNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchNodes = useCallback(async () => {
    if (!pathwayId) return;
    try {
      setLoading(true);
      const data = await graphqlFetch<{ pathwayNodes: PathwayNode[] }>(
        PATHWAY_NODES_QUERY.loc?.source.body || '',
        { pathwayId }
      );
      setNodes(data.pathwayNodes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [pathwayId]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  return { nodes, loading, error, refetch: fetchNodes };
}

export function useDecisionTree(pathwayId: string, patientContext?: PatientContext) {
  const [result, setResult] = useState<DecisionTreeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTree = useCallback(async () => {
    if (!pathwayId) return;
    try {
      setLoading(true);
      const data = await graphqlFetch<{ getDecisionTree: DecisionTreeResult }>(
        DECISION_TREE_QUERY.loc?.source.body || '',
        { pathwayId, patientContext }
      );
      setResult(data.getDecisionTree);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [pathwayId, patientContext]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  return { result, loading, error, refetch: fetchTree };
}

export function useRecommendPathways() {
  const [recommendations, setRecommendations] = useState<PathwayRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const recommend = useCallback(async (context: PatientContext, first?: number) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ recommendPathwaysForPatient: PathwayRecommendation[] }>(
        RECOMMEND_PATHWAYS_QUERY.loc?.source.body || '',
        { context, first: first || 5 }
      );
      setRecommendations(data.recommendPathwaysForPatient);
      setError(null);
      return data.recommendPathwaysForPatient;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { recommendations, recommend, loading, error };
}

export function usePatientPathwayHistory(patientId: string) {
  const [instances, setInstances] = useState<PatientPathwayInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!patientId) return;
    try {
      setLoading(true);
      const data = await graphqlFetch<{ patientPathwayHistory: PatientPathwayInstance[] }>(
        PATIENT_PATHWAY_HISTORY_QUERY.loc?.source.body || '',
        { patientId }
      );
      setInstances(data.patientPathwayHistory);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { instances, loading, error, refetch: fetchHistory };
}

// ============================================================================
// Mutation Hooks
// ============================================================================

export function useCreatePathway() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const create = useCallback(async (input: {
    name: string;
    slug?: string;
    description?: string;
    primaryConditionCodes: string[];
    applicableContexts?: Record<string, unknown>;
    version?: string;
    evidenceSource?: string;
    evidenceGrade?: string;
  }) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ createClinicalPathway: ClinicalPathway }>(
        CREATE_PATHWAY_MUTATION.loc?.source.body || '',
        { input }
      );
      setError(null);
      return data.createClinicalPathway;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { create, loading, error };
}

export function useUpdatePathway() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const update = useCallback(async (id: string, input: {
    name?: string;
    description?: string;
    primaryConditionCodes?: string[];
    applicableContexts?: Record<string, unknown>;
    version?: string;
    evidenceSource?: string;
    evidenceGrade?: string;
    isActive?: boolean;
  }) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ updateClinicalPathway: ClinicalPathway }>(
        UPDATE_PATHWAY_MUTATION.loc?.source.body || '',
        { id, input }
      );
      setError(null);
      return data.updateClinicalPathway;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { update, loading, error };
}

export function usePublishPathway() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const publish = useCallback(async (id: string) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ publishClinicalPathway: ClinicalPathway }>(
        PUBLISH_PATHWAY_MUTATION.loc?.source.body || '',
        { id }
      );
      setError(null);
      return data.publishClinicalPathway;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const unpublish = useCallback(async (id: string) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ unpublishClinicalPathway: ClinicalPathway }>(
        UNPUBLISH_PATHWAY_MUTATION.loc?.source.body || '',
        { id }
      );
      setError(null);
      return data.unpublishClinicalPathway;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { publish, unpublish, loading, error };
}

export function useDeletePathway() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const deletePathway = useCallback(async (id: string) => {
    try {
      setLoading(true);
      await graphqlFetch<{ deleteClinicalPathway: boolean }>(
        DELETE_PATHWAY_MUTATION.loc?.source.body || '',
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

  return { deletePathway, loading, error };
}

export function useCreatePathwayNode() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const create = useCallback(async (input: {
    pathwayId: string;
    parentNodeId?: string;
    nodeType: PathwayNodeType;
    title: string;
    description?: string;
    actionType?: PathwayActionType;
    decisionFactors?: DecisionFactor[];
    suggestedTemplateId?: string;
    sortOrder?: number;
    baseConfidence?: number;
  }) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ createPathwayNode: PathwayNode }>(
        CREATE_PATHWAY_NODE_MUTATION.loc?.source.body || '',
        { input }
      );
      setError(null);
      return data.createPathwayNode;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { create, loading, error };
}

export function useUpdatePathwayNode() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const update = useCallback(async (id: string, input: {
    title?: string;
    description?: string;
    actionType?: PathwayActionType;
    decisionFactors?: DecisionFactor[];
    suggestedTemplateId?: string;
    sortOrder?: number;
    baseConfidence?: number;
    isActive?: boolean;
  }) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ updatePathwayNode: PathwayNode }>(
        UPDATE_PATHWAY_NODE_MUTATION.loc?.source.body || '',
        { id, input }
      );
      setError(null);
      return data.updatePathwayNode;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { update, loading, error };
}

export function useDeletePathwayNode() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const deleteNode = useCallback(async (id: string) => {
    try {
      setLoading(true);
      await graphqlFetch<{ deletePathwayNode: boolean }>(
        DELETE_PATHWAY_NODE_MUTATION.loc?.source.body || '',
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

  return { deleteNode, loading, error };
}

export function useRecordPathwaySelection() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const recordSelection = useCallback(async (input: {
    instanceId: string;
    nodeId: string;
    selectionType?: SelectionType;
    overrideReason?: string;
    resultingCarePlanId?: string;
  }) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ recordPathwaySelection: PatientPathwaySelection }>(
        RECORD_PATHWAY_SELECTION_MUTATION.loc?.source.body || '',
        { input }
      );
      setError(null);
      return data.recordPathwaySelection;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { recordSelection, loading, error };
}

export function useStartPathwayInstance() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const start = useCallback(async (input: {
    patientId: string;
    pathwayId: string;
    providerId?: string;
    patientContext: Record<string, unknown>;
    mlModelId?: string;
  }) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ startPathwayInstance: PatientPathwayInstance }>(
        START_PATHWAY_INSTANCE_MUTATION.loc?.source.body || '',
        { input }
      );
      setError(null);
      return data.startPathwayInstance;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { start, loading, error };
}

export function useCompletePathwayInstance() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const complete = useCallback(async (instanceId: string) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ completePathwayInstance: PatientPathwayInstance }>(
        COMPLETE_PATHWAY_INSTANCE_MUTATION.loc?.source.body || '',
        { instanceId }
      );
      setError(null);
      return data.completePathwayInstance;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { complete, loading, error };
}

export function useLinkSelectionToCarePlan() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const link = useCallback(async (selectionId: string, carePlanId: string) => {
    try {
      setLoading(true);
      const data = await graphqlFetch<{ linkSelectionToCarePlan: PatientPathwaySelection }>(
        LINK_SELECTION_TO_CAREPLAN_MUTATION.loc?.source.body || '',
        { selectionId, carePlanId }
      );
      setError(null);
      return data.linkSelectionToCarePlan;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { link, loading, error };
}
