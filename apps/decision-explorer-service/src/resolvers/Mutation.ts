import {
  clinicalPathwayService,
  pathwayNodeService,
  pathwayNodeOutcomeService,
  patientPathwayInstanceService,
  patientPathwaySelectionService,
  PathwayNodeType,
  PathwayActionType,
  SelectionType
} from '../services/database';

// ML Service endpoint
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Helper to convert GraphQL enum to database value
function toDbNodeType(type: string): PathwayNodeType {
  const mapping: Record<string, PathwayNodeType> = {
    'ROOT': PathwayNodeType.ROOT,
    'DECISION': PathwayNodeType.DECISION,
    'BRANCH': PathwayNodeType.BRANCH,
    'RECOMMENDATION': PathwayNodeType.RECOMMENDATION
  };
  return mapping[type] || PathwayNodeType.BRANCH;
}

function toDbActionType(type: string | undefined): PathwayActionType | undefined {
  if (!type) return undefined;
  const mapping: Record<string, PathwayActionType> = {
    'MEDICATION': PathwayActionType.MEDICATION,
    'LAB': PathwayActionType.LAB,
    'REFERRAL': PathwayActionType.REFERRAL,
    'PROCEDURE': PathwayActionType.PROCEDURE,
    'EDUCATION': PathwayActionType.EDUCATION,
    'MONITORING': PathwayActionType.MONITORING,
    'LIFESTYLE': PathwayActionType.LIFESTYLE,
    'FOLLOW_UP': PathwayActionType.FOLLOW_UP,
    'URGENT_CARE': PathwayActionType.URGENT_CARE
  };
  return mapping[type];
}

function toDbSelectionType(type: string | undefined): SelectionType | undefined {
  if (!type) return undefined;
  const mapping: Record<string, SelectionType> = {
    'ML_RECOMMENDED': SelectionType.ML_RECOMMENDED,
    'PROVIDER_SELECTED': SelectionType.PROVIDER_SELECTED,
    'AUTO_APPLIED': SelectionType.AUTO_APPLIED
  };
  return mapping[type];
}

export const Mutation = {
  // Pathway CRUD
  createClinicalPathway: async (_: any, { input }: { input: any }, context: any) => {
    return await clinicalPathwayService.create(input, context.userId);
  },

  updateClinicalPathway: async (_: any, { id, input }: { id: string; input: any }) => {
    const result = await clinicalPathwayService.update(id, input);
    if (!result) {
      throw new Error(`Pathway not found: ${id}`);
    }
    return result;
  },

  deleteClinicalPathway: async (_: any, { id }: { id: string }) => {
    return await clinicalPathwayService.delete(id);
  },

  publishClinicalPathway: async (_: any, { id }: { id: string }) => {
    const result = await clinicalPathwayService.publish(id);
    if (!result) {
      throw new Error(`Pathway not found: ${id}`);
    }
    return result;
  },

  unpublishClinicalPathway: async (_: any, { id }: { id: string }) => {
    const result = await clinicalPathwayService.unpublish(id);
    if (!result) {
      throw new Error(`Pathway not found: ${id}`);
    }
    return result;
  },

  duplicateClinicalPathway: async (_: any, { id, newName }: { id: string; newName: string }) => {
    const result = await clinicalPathwayService.duplicate(id, newName);
    if (!result) {
      throw new Error(`Pathway not found: ${id}`);
    }
    return result;
  },

  // Node CRUD
  createPathwayNode: async (_: any, { input }: { input: any }) => {
    return await pathwayNodeService.create({
      pathwayId: input.pathwayId,
      parentNodeId: input.parentNodeId,
      nodeType: toDbNodeType(input.nodeType),
      title: input.title,
      description: input.description,
      actionType: toDbActionType(input.actionType),
      decisionFactors: input.decisionFactors,
      suggestedTemplateId: input.suggestedTemplateId,
      sortOrder: input.sortOrder,
      baseConfidence: input.baseConfidence
    });
  },

  updatePathwayNode: async (_: any, { id, input }: { id: string; input: any }) => {
    const result = await pathwayNodeService.update(id, {
      title: input.title,
      description: input.description,
      actionType: toDbActionType(input.actionType),
      decisionFactors: input.decisionFactors,
      suggestedTemplateId: input.suggestedTemplateId,
      sortOrder: input.sortOrder,
      baseConfidence: input.baseConfidence,
      isActive: input.isActive
    });
    if (!result) {
      throw new Error(`Node not found: ${id}`);
    }
    return result;
  },

  deletePathwayNode: async (_: any, { id }: { id: string }) => {
    return await pathwayNodeService.delete(id);
  },

  movePathwayNode: async (_: any, { id, newParentId, newSortOrder }: { id: string; newParentId?: string; newSortOrder?: number }) => {
    const result = await pathwayNodeService.move(id, newParentId, newSortOrder);
    if (!result) {
      throw new Error(`Node not found: ${id}`);
    }
    return result;
  },

  // Outcome CRUD
  createPathwayNodeOutcome: async (_: any, { input }: { input: any }) => {
    return await pathwayNodeOutcomeService.create(input);
  },

  updatePathwayNodeOutcome: async (_: any, { id, input }: { id: string; input: any }) => {
    const result = await pathwayNodeOutcomeService.update(id, input);
    if (!result) {
      throw new Error(`Outcome not found: ${id}`);
    }
    return result;
  },

  deletePathwayNodeOutcome: async (_: any, { id }: { id: string }) => {
    return await pathwayNodeOutcomeService.delete(id);
  },

  // Patient tracking
  startPathwayInstance: async (_: any, { input }: { input: any }) => {
    return await patientPathwayInstanceService.start({
      patientId: input.patientId,
      pathwayId: input.pathwayId,
      providerId: input.providerId,
      patientContext: input.patientContext,
      mlModelId: input.mlModelId
    });
  },

  recordPathwaySelection: async (_: any, { input }: { input: any }, context: any) => {
    return await patientPathwaySelectionService.record({
      instanceId: input.instanceId,
      nodeId: input.nodeId,
      selectionType: toDbSelectionType(input.selectionType),
      overrideReason: input.overrideReason,
      resultingCarePlanId: input.resultingCarePlanId
    }, context.userId);
  },

  completePathwayInstance: async (_: any, { instanceId }: { instanceId: string }) => {
    const result = await patientPathwayInstanceService.complete(instanceId);
    if (!result) {
      throw new Error(`Instance not found: ${instanceId}`);
    }
    return result;
  },

  abandonPathwayInstance: async (_: any, { instanceId, reason }: { instanceId: string; reason?: string }) => {
    const result = await patientPathwayInstanceService.abandon(instanceId);
    if (!result) {
      throw new Error(`Instance not found: ${instanceId}`);
    }
    // TODO: Log abandonment reason
    return result;
  },

  linkSelectionToCarePlan: async (_: any, { selectionId, carePlanId }: { selectionId: string; carePlanId: string }) => {
    const result = await patientPathwaySelectionService.linkToCarePlan(selectionId, carePlanId);
    if (!result) {
      throw new Error(`Selection not found: ${selectionId}`);
    }
    return result;
  },

  // ML operations
  generatePathwayEmbeddings: async (_: any, { pathwayId }: { pathwayId: string }) => {
    try {
      const response = await fetch(`${ML_SERVICE_URL}/pathways/${pathwayId}/generate-embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        console.error('Failed to generate pathway embeddings');
        return false;
      }

      return true;
    } catch (error) {
      console.error('ML service unavailable for embeddings:', error);
      return false;
    }
  },

  generateNodeEmbeddings: async (_: any, { pathwayId }: { pathwayId: string }) => {
    try {
      const response = await fetch(`${ML_SERVICE_URL}/pathways/${pathwayId}/generate-node-embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        console.error('Failed to generate node embeddings');
        return 0;
      }

      const result = await response.json();
      return result.count || 0;
    } catch (error) {
      console.error('ML service unavailable for node embeddings:', error);
      return 0;
    }
  }
};
