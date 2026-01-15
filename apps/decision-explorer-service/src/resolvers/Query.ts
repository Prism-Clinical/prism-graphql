import {
  clinicalPathwayService,
  pathwayNodeService,
  patientPathwayInstanceService,
  ClinicalPathway,
  PathwayNode,
  PatientPathwayInstance
} from '../services/database';

// ML Service endpoint for scoring
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

interface PatientContext {
  patientId?: string;
  age?: number;
  gender?: string;
  conditions?: string[];
  allergies?: string[];
  currentMedications?: string[];
  labResults?: Record<string, any>;
  vitalSigns?: Record<string, any>;
  medicalHistory?: string[];
}

// Helper to build tree structure for decision tree UI
async function buildDecisionTree(
  node: PathwayNode,
  patientContext?: PatientContext,
  mlScores?: Record<string, { confidence: number; isRecommended: boolean }>
): Promise<any> {
  const children = await pathwayNodeService.getChildren(node.id);

  const childTrees = await Promise.all(
    children.map(child => buildDecisionTree(child, patientContext, mlScores))
  );

  const mlScore = mlScores?.[node.id];

  return {
    id: node.id,
    type: node.nodeType.toUpperCase(),
    title: node.title,
    description: node.description || '',
    confidence: mlScore?.confidence ?? node.baseConfidence,
    factors: node.decisionFactors || [],
    children: childTrees,
    alternativeCount: childTrees.length > 1 ? childTrees.length - 1 : 0,
    isRecommendedPath: mlScore?.isRecommended ?? false,
    recommendation: node.nodeType === 'recommendation' ? {
      templateId: node.suggestedTemplateId,
      title: node.title,
      description: node.description,
      actionType: node.actionType,
      medications: [],
      procedures: [],
      confidence: mlScore?.confidence ?? node.baseConfidence
    } : null
  };
}

// Call ML service to get pathway recommendations
async function getMLPathwayRecommendations(
  patientContext: PatientContext,
  first: number = 5
): Promise<any[]> {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/pathways/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_context: patientContext, max_results: first })
    });

    if (!response.ok) {
      console.warn('ML service recommendation failed, using fallback');
      return [];
    }

    return await response.json();
  } catch (error) {
    console.warn('ML service unavailable, using fallback:', error);
    return [];
  }
}

// Call ML service to score a decision tree
async function getMLTreeScores(
  pathwayId: string,
  nodes: PathwayNode[],
  patientContext: PatientContext
): Promise<Record<string, { confidence: number; isRecommended: boolean }>> {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/pathways/${pathwayId}/score-tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: nodes.map(n => ({
          id: n.id,
          node_type: n.nodeType,
          title: n.title,
          action_type: n.actionType,
          decision_factors: n.decisionFactors,
          base_confidence: n.baseConfidence
        })),
        patient_context: patientContext
      })
    });

    if (!response.ok) {
      console.warn('ML tree scoring failed');
      return {};
    }

    return await response.json();
  } catch (error) {
    console.warn('ML service unavailable for tree scoring:', error);
    return {};
  }
}

export const Query = {
  // Pathway management
  clinicalPathway: async (_: any, { id }: { id: string }) => {
    return await clinicalPathwayService.getById(id);
  },

  clinicalPathwayBySlug: async (_: any, { slug }: { slug: string }) => {
    return await clinicalPathwayService.getBySlug(slug);
  },

  clinicalPathways: async (_: any, { filter, pagination }: { filter?: any; pagination?: any }) => {
    const result = await clinicalPathwayService.list(filter || {}, pagination || {});

    return {
      edges: result.pathways.map((pathway, index) => ({
        node: pathway,
        cursor: Buffer.from(`pathway:${index}`).toString('base64')
      })),
      pageInfo: {
        hasNextPage: result.hasNextPage,
        hasPreviousPage: false,
        startCursor: result.pathways.length > 0 ? Buffer.from('pathway:0').toString('base64') : null,
        endCursor: result.pathways.length > 0 ? Buffer.from(`pathway:${result.pathways.length - 1}`).toString('base64') : null
      },
      totalCount: result.totalCount
    };
  },

  // Node management
  pathwayNode: async (_: any, { id }: { id: string }) => {
    return await pathwayNodeService.getById(id);
  },

  pathwayNodes: async (_: any, { pathwayId }: { pathwayId: string }) => {
    return await pathwayNodeService.listByPathway(pathwayId);
  },

  pathwayTree: async (_: any, { pathwayId }: { pathwayId: string }) => {
    return await pathwayNodeService.getRootNode(pathwayId);
  },

  // ML-powered queries
  recommendPathwaysForPatient: async (_: any, { context, first }: { context: PatientContext; first?: number }) => {
    // First try ML recommendations
    const mlRecommendations = await getMLPathwayRecommendations(context, first || 5);

    if (mlRecommendations.length > 0) {
      // ML returned recommendations, enrich with full pathway data
      const results = await Promise.all(
        mlRecommendations.map(async (rec: any) => {
          const pathway = await clinicalPathwayService.getById(rec.pathway_id);
          return {
            pathway,
            matchScore: rec.match_score || 0.8,
            matchReasons: rec.match_reasons || ['Condition match'],
            mlConfidence: rec.ml_confidence || 0.75
          };
        })
      );
      return results.filter((r: any) => r.pathway !== null);
    }

    // Fallback: find pathways matching patient conditions
    if (context.conditions && context.conditions.length > 0) {
      const allPathways = await clinicalPathwayService.list({
        isActive: true,
        isPublished: true
      }, { first: 50 });

      // Simple condition matching
      const matchingPathways = allPathways.pathways.filter(pathway => {
        return context.conditions!.some(condition =>
          pathway.primaryConditionCodes.some(code =>
            condition.startsWith(code) || code.startsWith(condition)
          )
        );
      });

      return matchingPathways.slice(0, first || 5).map(pathway => ({
        pathway,
        matchScore: 0.7,
        matchReasons: ['Condition code match'],
        mlConfidence: 0.7
      }));
    }

    return [];
  },

  getDecisionTree: async (_: any, { pathwayId, patientContext }: { pathwayId: string; patientContext?: PatientContext }) => {
    const startTime = Date.now();

    const pathway = await clinicalPathwayService.getById(pathwayId);
    if (!pathway) {
      throw new Error(`Pathway not found: ${pathwayId}`);
    }

    const rootNode = await pathwayNodeService.getRootNode(pathwayId);
    if (!rootNode) {
      throw new Error(`No root node found for pathway: ${pathwayId}`);
    }

    // Get all nodes for ML scoring
    const allNodes = await pathwayNodeService.listByPathway(pathwayId);

    // Get ML scores if patient context is provided
    let mlScores: Record<string, { confidence: number; isRecommended: boolean }> = {};
    let modelVersion = 'no-context';

    if (patientContext) {
      mlScores = await getMLTreeScores(pathwayId, allNodes, patientContext);
      modelVersion = 'v1.0'; // TODO: Get from ML service
    }

    const tree = await buildDecisionTree(rootNode, patientContext, mlScores);
    const processingTimeMs = Date.now() - startTime;

    return {
      pathway,
      tree,
      modelVersion,
      processingTimeMs
    };
  },

  // Patient history
  patientPathwayInstance: async (_: any, { id }: { id: string }) => {
    return await patientPathwayInstanceService.getById(id);
  },

  patientPathwayInstances: async (_: any, { filter, pagination }: { filter?: any; pagination?: any }) => {
    const result = await patientPathwayInstanceService.list(filter || {}, pagination || {});

    return {
      edges: result.instances.map((instance, index) => ({
        node: instance,
        cursor: Buffer.from(`instance:${index}`).toString('base64')
      })),
      pageInfo: {
        hasNextPage: result.hasNextPage,
        hasPreviousPage: false,
        startCursor: result.instances.length > 0 ? Buffer.from('instance:0').toString('base64') : null,
        endCursor: result.instances.length > 0 ? Buffer.from(`instance:${result.instances.length - 1}`).toString('base64') : null
      },
      totalCount: result.totalCount
    };
  },

  patientPathwayHistory: async (_: any, { patientId }: { patientId: string }) => {
    return await patientPathwayInstanceService.listByPatient(patientId);
  },

  // Statistics
  pathwayUsageStats: async (_: any, { pathwayId }: { pathwayId: string }) => {
    return await clinicalPathwayService.getUsageStats(pathwayId);
  },

  nodeSelectionStats: async (_: any, { nodeId }: { nodeId: string }) => {
    return await pathwayNodeService.getSelectionStats(nodeId);
  }
};
