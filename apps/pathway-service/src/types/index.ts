import { Pool } from 'pg';
import { Redis } from 'ioredis';

// Apollo context passed to every resolver
export interface DataSourceContext {
  pool: Pool;
  redis: Redis;
  userId: string;
  userRole: string;
}

// Pathway status lifecycle
export enum PathwayStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  SUPERSEDED = 'SUPERSEDED',
}

// Pathway categories
export enum PathwayCategory {
  CHRONIC_DISEASE = 'CHRONIC_DISEASE',
  ACUTE_CARE = 'ACUTE_CARE',
  PREVENTIVE_CARE = 'PREVENTIVE_CARE',
  POST_PROCEDURE = 'POST_PROCEDURE',
  MEDICATION_MANAGEMENT = 'MEDICATION_MANAGEMENT',
  LIFESTYLE_MODIFICATION = 'LIFESTYLE_MODIFICATION',
  MENTAL_HEALTH = 'MENTAL_HEALTH',
  PEDIATRIC = 'PEDIATRIC',
  GERIATRIC = 'GERIATRIC',
  OBSTETRIC = 'OBSTETRIC',
}

// Relational index row
export interface PathwayGraphIndex {
  id: string;
  ageNodeId: string | null;
  logicalId: string;
  title: string;
  version: string;
  category: PathwayCategory;
  status: PathwayStatus;
  conditionCodes: string[];
  scope: string | null;
  targetPopulation: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Resolution session status
export enum ResolutionSessionStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED',
}

// Resolution decision types
export enum ResolutionType {
  AUTO_RESOLVED = 'AUTO_RESOLVED',
  SYSTEM_SUGGESTED = 'SYSTEM_SUGGESTED',
  PROVIDER_DECIDED = 'PROVIDER_DECIDED',
  FORCED_MANUAL = 'FORCED_MANUAL',
}

// Scoring type — determines which scorer class handles the signal
export enum ScoringType {
  DATA_PRESENCE = 'DATA_PRESENCE',
  MAPPING_LOOKUP = 'MAPPING_LOOKUP',
  CRITERIA_MATCH = 'CRITERIA_MATCH',
  RISK_INVERSE = 'RISK_INVERSE',
  CUSTOM_RULES = 'CUSTOM_RULES',
}

export enum SignalScope {
  SYSTEM = 'SYSTEM',
  ORGANIZATION = 'ORGANIZATION',
  INSTITUTION = 'INSTITUTION',
}

export enum WeightScope {
  NODE = 'NODE',
  PATHWAY = 'PATHWAY',
  INSTITUTION_GLOBAL = 'INSTITUTION_GLOBAL',
  ORGANIZATION_GLOBAL = 'ORGANIZATION_GLOBAL',
}

export enum ThresholdScope {
  SYSTEM_DEFAULT = 'SYSTEM_DEFAULT',
  ORGANIZATION = 'ORGANIZATION',
  INSTITUTION = 'INSTITUTION',
  PATHWAY = 'PATHWAY',
  NODE = 'NODE',
}

export enum PropagationMode {
  NONE = 'NONE',
  DIRECT = 'DIRECT',
  TRANSITIVE_WITH_DECAY = 'TRANSITIVE_WITH_DECAY',
}

export enum WeightSource {
  NODE_OVERRIDE = 'NODE_OVERRIDE',
  PATHWAY_OVERRIDE = 'PATHWAY_OVERRIDE',
  INSTITUTION_GLOBAL = 'INSTITUTION_GLOBAL',
  ORGANIZATION_GLOBAL = 'ORGANIZATION_GLOBAL',
  SYSTEM_DEFAULT = 'SYSTEM_DEFAULT',
}
