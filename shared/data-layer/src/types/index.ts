// Shared types for the healthcare federation data layer

export interface PatientDemographics {
  id: string;
  epicPatientId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  email?: string;
  phone?: string;
  address?: Address;
  createdAt: Date;
  updatedAt: Date;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface PatientSession {
  sessionId: string;
  patientId: string;
  epicPatientId: string;
  status: SessionStatus;
  createdAt: Date;
  expiresAt: Date;
  lastAccessedAt: Date;
  dataFreshness: Record<string, Date>;
}

export enum SessionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  TERMINATED = 'terminated'
}

export interface ClinicalData {
  patientId: string;
  type: ClinicalDataType;
  data: any;
  sourceSystem: string;
  lastUpdated: Date;
  ttl: number; // Time to live in seconds
}

export enum ClinicalDataType {
  DEMOGRAPHICS = 'demographics',
  VITALS = 'vitals',
  MEDICATIONS = 'medications',
  DIAGNOSES = 'diagnoses',
  LAB_RESULTS = 'lab_results',
  PROCEDURES = 'procedures',
  ENCOUNTERS = 'encounters'
}

export interface EpicFHIRData {
  resourceType: string;
  id: string;
  data: any;
  lastModified: Date;
}

export interface RecommendationJob {
  jobId: string;
  sessionId: string;
  patientId: string;
  status: JobStatus;
  jobType: RecommendationJobType;
  priority: JobPriority;
  inputData: any;
  results?: any;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
}

export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export enum RecommendationJobType {
  INITIAL_ASSESSMENT = 'initial_assessment',
  DATA_UPDATE_TRIGGER = 'data_update_trigger',
  PERIODIC_REVIEW = 'periodic_review',
  EMERGENCY_ALERT = 'emergency_alert'
}

export enum JobPriority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  URGENT = 4,
  EMERGENCY = 5
}

// Cache-related types
export interface CacheEntry<T = any> {
  key: string;
  value: T;
  ttl: number;
  createdAt: Date;
  tags?: string[];
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalKeys: number;
  memoryUsage: number;
}

// Database connection types
export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  maxConnections?: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
}

// Migration types
export interface Migration {
  id: string;
  name: string;
  timestamp: Date;
  up: string;
  down: string;
}

export interface MigrationStatus {
  migrationId: string;
  appliedAt: Date;
  checksum: string;
}