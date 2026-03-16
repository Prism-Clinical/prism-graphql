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
