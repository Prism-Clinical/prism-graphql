import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// Types
export enum GuidelineSource {
  USPSTF = 'USPSTF',
  AHA = 'AHA',
  ADA = 'ADA',
  ACOG = 'ACOG',
  AAP = 'AAP',
  CDC = 'CDC',
  WHO = 'WHO',
  CUSTOM = 'CUSTOM'
}

export enum GuidelineCategory {
  SCREENING = 'SCREENING',
  PREVENTION = 'PREVENTION',
  TREATMENT = 'TREATMENT',
  MONITORING = 'MONITORING',
  LIFESTYLE = 'LIFESTYLE',
  IMMUNIZATION = 'IMMUNIZATION'
}

export enum EvidenceGrade {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
  I = 'I'
}

export enum SynthesisStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export enum RAGQueryType {
  BY_CONDITION = 'BY_CONDITION',
  BY_MEDICATION = 'BY_MEDICATION',
  BY_DEMOGRAPHICS = 'BY_DEMOGRAPHICS',
  BY_GUIDELINE_ID = 'BY_GUIDELINE_ID'
}

export interface Guideline {
  id: string;
  source: GuidelineSource;
  sourceId: string;
  title: string;
  category: GuidelineCategory;
  evidenceGrade?: EvidenceGrade;
  recommendationStrength?: string;
  applicableConditions: string[];
  applicableMedications: string[];
  ageRangeMin?: number;
  ageRangeMax?: number;
  applicableSex?: string;
  summaryText: string;
  fullText?: string;
  publishedDate?: Date;
  lastReviewedDate?: Date;
  expirationDate?: Date;
  version?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RAGSynthesis {
  id: string;
  patientId: string;
  queryType: RAGQueryType;
  queryConditionCodes?: string[];
  queryMedicationCodes?: string[];
  status: SynthesisStatus;
  processingTimeMs?: number;
  guidelinesConsulted?: number;
  createdAt: Date;
  createdBy: string;
}

// Database connection - these will be injected
let pool: Pool;
let redis: Redis;

export function initializeDatabase(dbPool: Pool, redisClient: Redis) {
  pool = dbPool;
  redis = redisClient;
}

function ensureInitialized() {
  if (!pool || !redis) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
}

// Guideline Service
class GuidelineService {
  async getGuidelineById(id: string): Promise<Guideline | null> {
    ensureInitialized();
    const cacheKey = `guideline:${id}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      SELECT id, source, source_id as "sourceId", title, category,
             evidence_grade as "evidenceGrade", recommendation_strength as "recommendationStrength",
             applicable_conditions as "applicableConditions",
             applicable_medications as "applicableMedications",
             age_range_min as "ageRangeMin", age_range_max as "ageRangeMax",
             applicable_sex as "applicableSex", summary_text as "summaryText",
             full_text as "fullText", published_date as "publishedDate",
             last_reviewed_date as "lastReviewedDate", expiration_date as "expirationDate",
             version, created_at as "createdAt", updated_at as "updatedAt"
      FROM guidelines
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      const guideline = result.rows[0] || null;

      if (guideline) {
        await redis.setex(cacheKey, 3600, JSON.stringify(guideline)); // Cache for 1 hour
      }

      return guideline;
    } catch (error) {
      console.error('Error getting guideline:', error);
      return null;
    }
  }

  async getGuidelines(
    filter: {
      source?: GuidelineSource;
      category?: GuidelineCategory;
      evidenceGrade?: EvidenceGrade;
      conditionCode?: string;
      medicationCode?: string;
    },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ guidelines: Guideline[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50, after } = pagination;

    let query = `
      SELECT id, source, source_id as "sourceId", title, category,
             evidence_grade as "evidenceGrade", recommendation_strength as "recommendationStrength",
             applicable_conditions as "applicableConditions",
             applicable_medications as "applicableMedications",
             age_range_min as "ageRangeMin", age_range_max as "ageRangeMax",
             applicable_sex as "applicableSex", summary_text as "summaryText",
             published_date as "publishedDate",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM guidelines
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.source) {
      query += ` AND source = $${paramIndex}`;
      params.push(filter.source);
      paramIndex++;
    }

    if (filter.category) {
      query += ` AND category = $${paramIndex}`;
      params.push(filter.category);
      paramIndex++;
    }

    if (filter.evidenceGrade) {
      query += ` AND evidence_grade = $${paramIndex}`;
      params.push(filter.evidenceGrade);
      paramIndex++;
    }

    if (filter.conditionCode) {
      query += ` AND $${paramIndex} = ANY(applicable_conditions)`;
      params.push(filter.conditionCode);
      paramIndex++;
    }

    if (filter.medicationCode) {
      query += ` AND $${paramIndex} = ANY(applicable_medications)`;
      params.push(filter.medicationCode);
      paramIndex++;
    }

    if (after) {
      const decoded = Buffer.from(after, 'base64').toString('utf8');
      const [cursorDate, cursorId] = decoded.split('|');
      query += ` AND (created_at, id) < ($${paramIndex}, $${paramIndex + 1})`;
      params.push(cursorDate, cursorId);
      paramIndex += 2;
    }

    const countQuery = query.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];

    query += ` ORDER BY created_at DESC, id DESC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const guidelines = result.rows.slice(0, first);
      const totalCount = parseInt(countResult.rows[0].count);

      return { guidelines, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error getting guidelines:', error);
      return { guidelines: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async getGuidelinesForPatient(
    patientId: string,
    options: { category?: GuidelineCategory; first?: number; after?: string } = {}
  ): Promise<{ guidelines: Guideline[]; hasNextPage: boolean; totalCount: number }> {
    // In a real implementation, this would look up the patient's conditions
    // and find applicable guidelines. For now, return empty result.
    return { guidelines: [], hasNextPage: false, totalCount: 0 };
  }
}

// RAG Synthesis Service
class RAGSynthesisService {
  async getSynthesisById(id: string): Promise<RAGSynthesis | null> {
    ensureInitialized();

    const query = `
      SELECT id, patient_id as "patientId", query_type as "queryType",
             query_condition_codes as "queryConditionCodes",
             query_medication_codes as "queryMedicationCodes",
             status, processing_time_ms as "processingTimeMs",
             guidelines_consulted as "guidelinesConsulted",
             created_at as "createdAt", created_by as "createdBy"
      FROM rag_syntheses
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting RAG synthesis:', error);
      return null;
    }
  }

  async requestSynthesis(input: {
    patientId: string;
    queryType: RAGQueryType;
    conditionCodes?: string[];
    medicationCodes?: string[];
    createdBy: string;
  }): Promise<RAGSynthesis> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO rag_syntheses (id, patient_id, query_type, query_condition_codes, query_medication_codes, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, patient_id as "patientId", query_type as "queryType",
                query_condition_codes as "queryConditionCodes",
                query_medication_codes as "queryMedicationCodes",
                status, created_at as "createdAt", created_by as "createdBy"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.patientId,
        input.queryType,
        input.conditionCodes || [],
        input.medicationCodes || [],
        SynthesisStatus.PENDING,
        input.createdBy
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error creating RAG synthesis:', error);
      throw error;
    }
  }

  async getSynthesesForPatient(
    patientId: string,
    pagination: { first?: number; after?: string } = {}
  ): Promise<RAGSynthesis[]> {
    ensureInitialized();
    const { first = 50 } = pagination;

    const query = `
      SELECT id, patient_id as "patientId", query_type as "queryType",
             query_condition_codes as "queryConditionCodes",
             query_medication_codes as "queryMedicationCodes",
             status, processing_time_ms as "processingTimeMs",
             guidelines_consulted as "guidelinesConsulted",
             created_at as "createdAt", created_by as "createdBy"
      FROM rag_syntheses
      WHERE patient_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    try {
      const result = await pool.query(query, [patientId, first]);
      return result.rows;
    } catch (error) {
      console.error('Error getting syntheses for patient:', error);
      return [];
    }
  }
}

// Export service instances
export const guidelineService = new GuidelineService();
export const ragSynthesisService = new RAGSynthesisService();
