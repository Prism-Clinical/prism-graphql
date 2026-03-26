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

// Import modes
export enum ImportMode {
  NEW_PATHWAY = 'NEW_PATHWAY',
  DRAFT_UPDATE = 'DRAFT_UPDATE',
  NEW_VERSION = 'NEW_VERSION',
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

// ─── Resolution Engine Enums (Plan 4) ────────────────────────────────

export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED',
  DEGRADED = 'DEGRADED',
}

export enum NodeStatus {
  INCLUDED = 'INCLUDED',
  EXCLUDED = 'EXCLUDED',
  GATED_OUT = 'GATED_OUT',
  PENDING_QUESTION = 'PENDING_QUESTION',
  TIMEOUT = 'TIMEOUT',
  CASCADE_LIMIT = 'CASCADE_LIMIT',
  UNKNOWN = 'UNKNOWN',
}

export enum OverrideAction {
  INCLUDE = 'INCLUDE',
  EXCLUDE = 'EXCLUDE',
}

export enum AnswerType {
  BOOLEAN = 'BOOLEAN',
  NUMERIC = 'NUMERIC',
  SELECT = 'SELECT',
}

export enum BlockerType {
  EMPTY_PLAN = 'EMPTY_PLAN',
  UNRESOLVED_RED_FLAG = 'UNRESOLVED_RED_FLAG',
  CONTRADICTION = 'CONTRADICTION',
  PENDING_GATE = 'PENDING_GATE',
}

export enum GateType {
  PATIENT_ATTRIBUTE = 'patient_attribute',
  QUESTION = 'question',
  PRIOR_NODE_RESULT = 'prior_node_result',
  COMPOUND = 'compound',
}

export enum DefaultBehavior {
  SKIP = 'skip',
  TRAVERSE = 'traverse',
}
