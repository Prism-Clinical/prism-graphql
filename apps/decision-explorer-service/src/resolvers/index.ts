import { Query } from './Query';
import { Mutation } from './Mutation';
import {
  clinicalPathwayService,
  pathwayNodeService,
  pathwayNodeOutcomeService,
  patientPathwayInstanceService,
  patientPathwaySelectionService
} from '../services/database';

// Type resolvers for nested relationships
const ClinicalPathway = {
  __resolveReference: async (ref: { id: string }) => {
    return await clinicalPathwayService.getById(ref.id);
  },
  rootNode: async (parent: any) => {
    return await pathwayNodeService.getRootNode(parent.id);
  },
  nodes: async (parent: any) => {
    return await pathwayNodeService.listByPathway(parent.id);
  },
  nodeCount: async (parent: any) => {
    return await clinicalPathwayService.getNodeCount(parent.id);
  },
  usageStats: async (parent: any) => {
    return await clinicalPathwayService.getUsageStats(parent.id);
  }
};

const PathwayNode = {
  __resolveReference: async (ref: { id: string }) => {
    return await pathwayNodeService.getById(ref.id);
  },
  pathway: async (parent: any) => {
    return await clinicalPathwayService.getById(parent.pathwayId);
  },
  parentNode: async (parent: any) => {
    if (!parent.parentNodeId) return null;
    return await pathwayNodeService.getById(parent.parentNodeId);
  },
  children: async (parent: any) => {
    return await pathwayNodeService.getChildren(parent.id);
  },
  outcomes: async (parent: any) => {
    return await pathwayNodeOutcomeService.listByNode(parent.id);
  },
  selectionStats: async (parent: any) => {
    return await pathwayNodeService.getSelectionStats(parent.id);
  },
  // Convert database enum to GraphQL enum
  nodeType: (parent: any) => {
    return parent.nodeType?.toUpperCase() || 'BRANCH';
  },
  actionType: (parent: any) => {
    return parent.actionType?.toUpperCase() || null;
  }
};

const PatientPathwayInstance = {
  __resolveReference: async (ref: { id: string }) => {
    return await patientPathwayInstanceService.getById(ref.id);
  },
  pathway: async (parent: any) => {
    return await clinicalPathwayService.getById(parent.pathwayId);
  },
  selections: async (parent: any) => {
    return await patientPathwaySelectionService.listByInstance(parent.id);
  }
};

const PatientPathwaySelection = {
  __resolveReference: async (ref: { id: string }) => {
    return await patientPathwaySelectionService.getById(ref.id);
  },
  instance: async (parent: any) => {
    return await patientPathwayInstanceService.getById(parent.instanceId);
  },
  node: async (parent: any) => {
    return await pathwayNodeService.getById(parent.nodeId);
  },
  // Convert database enum to GraphQL enum
  selectionType: (parent: any) => {
    const mapping: Record<string, string> = {
      'ml_recommended': 'ML_RECOMMENDED',
      'provider_selected': 'PROVIDER_SELECTED',
      'auto_applied': 'AUTO_APPLIED'
    };
    return mapping[parent.selectionType] || 'ML_RECOMMENDED';
  }
};

// Scalar resolvers
const DateTime = {
  __serialize: (value: Date | string) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  },
  __parseValue: (value: string) => {
    return new Date(value);
  },
  __parseLiteral: (ast: any) => {
    if (ast.kind === 'StringValue') {
      return new Date(ast.value);
    }
    return null;
  }
};

const JSON = {
  __serialize: (value: any) => {
    return value;
  },
  __parseValue: (value: any) => {
    return value;
  },
  __parseLiteral: (ast: any) => {
    switch (ast.kind) {
      case 'StringValue':
        return ast.value;
      case 'IntValue':
        return parseInt(ast.value, 10);
      case 'FloatValue':
        return parseFloat(ast.value);
      case 'BooleanValue':
        return ast.value;
      case 'ObjectValue':
        const obj: Record<string, any> = {};
        ast.fields.forEach((field: any) => {
          obj[field.name.value] = JSON.__parseLiteral(field.value);
        });
        return obj;
      case 'ListValue':
        return ast.values.map(JSON.__parseLiteral);
      default:
        return null;
    }
  }
};

const resolvers = {
  Query,
  Mutation,
  ClinicalPathway,
  PathwayNode,
  PatientPathwayInstance,
  PatientPathwaySelection,
  DateTime,
  JSON
};

export default resolvers;
