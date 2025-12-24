import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// Types
export enum CarePlanStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export enum GoalStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  ACHIEVED = 'ACHIEVED',
  NOT_ACHIEVED = 'NOT_ACHIEVED',
  CANCELLED = 'CANCELLED'
}

export enum GoalPriority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export enum InterventionType {
  MEDICATION = 'MEDICATION',
  PROCEDURE = 'PROCEDURE',
  LIFESTYLE = 'LIFESTYLE',
  MONITORING = 'MONITORING',
  REFERRAL = 'REFERRAL',
  EDUCATION = 'EDUCATION',
  FOLLOW_UP = 'FOLLOW_UP'
}

export enum InterventionStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DEFERRED = 'DEFERRED'
}

export enum TemplateCategory {
  CHRONIC_DISEASE = 'CHRONIC_DISEASE',
  PREVENTIVE_CARE = 'PREVENTIVE_CARE',
  POST_PROCEDURE = 'POST_PROCEDURE',
  MEDICATION_MANAGEMENT = 'MEDICATION_MANAGEMENT',
  LIFESTYLE_MODIFICATION = 'LIFESTYLE_MODIFICATION'
}

export interface CarePlan {
  id: string;
  patientId: string;
  title: string;
  status: CarePlanStatus;
  conditionCodes: string[];
  startDate: Date;
  targetEndDate?: Date;
  actualEndDate?: Date;
  nextReviewDate?: Date;
  lastReviewedAt?: Date;
  lastReviewedBy?: string;
  sourceTranscriptionId?: string;
  sourceRAGSynthesisId?: string;
  templateId?: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
}

export interface CarePlanGoal {
  id: string;
  carePlanId: string;
  description: string;
  targetValue?: string;
  targetDate?: Date;
  status: GoalStatus;
  priority: GoalPriority;
  currentValue?: string;
  percentComplete?: number;
  linkedInterventionIds: string[];
  guidelineReference?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CarePlanIntervention {
  id: string;
  carePlanId: string;
  type: InterventionType;
  description: string;
  medicationCode?: string;
  dosage?: string;
  frequency?: string;
  procedureCode?: string;
  referralSpecialty?: string;
  status: InterventionStatus;
  scheduledDate?: Date;
  completedDate?: Date;
  patientInstructions?: string;
  providerNotes?: string;
  guidelineReference?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CarePlanTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  conditionCodes: string[];
  guidelineSource?: string;
  evidenceGrade?: string;
  isActive: boolean;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

// Database connection
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

// Care Plan Service
class CarePlanService {
  async getCarePlanById(id: string): Promise<CarePlan | null> {
    ensureInitialized();
    const cacheKey = `careplan:${id}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      SELECT id, patient_id as "patientId", title, status,
             condition_codes as "conditionCodes",
             start_date as "startDate", target_end_date as "targetEndDate",
             actual_end_date as "actualEndDate",
             next_review_date as "nextReviewDate",
             last_reviewed_at as "lastReviewedAt",
             last_reviewed_by as "lastReviewedBy",
             source_transcription_id as "sourceTranscriptionId",
             source_rag_synthesis_id as "sourceRAGSynthesisId",
             template_id as "templateId",
             created_at as "createdAt", created_by as "createdBy",
             updated_at as "updatedAt"
      FROM care_plans
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      const carePlan = result.rows[0] || null;

      if (carePlan) {
        await redis.setex(cacheKey, 300, JSON.stringify(carePlan));
      }

      return carePlan;
    } catch (error) {
      console.error('Error getting care plan:', error);
      return null;
    }
  }

  async getCarePlans(
    filter: {
      patientId?: string;
      status?: CarePlanStatus;
      conditionCode?: string;
      createdAfter?: Date;
      createdBefore?: Date;
    },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ carePlans: CarePlan[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50, after } = pagination;

    let query = `
      SELECT id, patient_id as "patientId", title, status,
             condition_codes as "conditionCodes",
             start_date as "startDate", target_end_date as "targetEndDate",
             next_review_date as "nextReviewDate",
             created_at as "createdAt", created_by as "createdBy",
             updated_at as "updatedAt"
      FROM care_plans
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.patientId) {
      query += ` AND patient_id = $${paramIndex}`;
      params.push(filter.patientId);
      paramIndex++;
    }

    if (filter.status) {
      query += ` AND status = $${paramIndex}`;
      params.push(filter.status);
      paramIndex++;
    }

    if (filter.conditionCode) {
      query += ` AND $${paramIndex} = ANY(condition_codes)`;
      params.push(filter.conditionCode);
      paramIndex++;
    }

    if (filter.createdAfter) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(filter.createdAfter);
      paramIndex++;
    }

    if (filter.createdBefore) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(filter.createdBefore);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const carePlans = result.rows.slice(0, first);
      const totalCount = parseInt(countResult.rows[0].count);

      return { carePlans, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error getting care plans:', error);
      return { carePlans: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async getActiveCarePlanForPatient(patientId: string): Promise<CarePlan | null> {
    ensureInitialized();

    const query = `
      SELECT id, patient_id as "patientId", title, status,
             condition_codes as "conditionCodes",
             start_date as "startDate", target_end_date as "targetEndDate",
             next_review_date as "nextReviewDate",
             created_at as "createdAt", created_by as "createdBy",
             updated_at as "updatedAt"
      FROM care_plans
      WHERE patient_id = $1 AND status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    try {
      const result = await pool.query(query, [patientId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting active care plan:', error);
      return null;
    }
  }

  async createCarePlan(input: {
    patientId: string;
    title: string;
    conditionCodes: string[];
    startDate: Date;
    targetEndDate?: Date;
    templateId?: string;
    sourceTranscriptionId?: string;
    sourceRAGSynthesisId?: string;
    createdBy: string;
  }): Promise<CarePlan> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO care_plans (id, patient_id, title, status, condition_codes, start_date,
                              target_end_date, template_id, source_transcription_id,
                              source_rag_synthesis_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, patient_id as "patientId", title, status,
                condition_codes as "conditionCodes",
                start_date as "startDate", target_end_date as "targetEndDate",
                created_at as "createdAt", created_by as "createdBy",
                updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.patientId,
        input.title,
        CarePlanStatus.DRAFT,
        input.conditionCodes,
        input.startDate,
        input.targetEndDate || null,
        input.templateId || null,
        input.sourceTranscriptionId || null,
        input.sourceRAGSynthesisId || null,
        input.createdBy
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error creating care plan:', error);
      throw error;
    }
  }

  async updateCarePlanStatus(id: string, status: CarePlanStatus): Promise<CarePlan | null> {
    ensureInitialized();

    const query = `
      UPDATE care_plans
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, patient_id as "patientId", title, status,
                condition_codes as "conditionCodes",
                start_date as "startDate", target_end_date as "targetEndDate",
                created_at as "createdAt", created_by as "createdBy",
                updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [status, id]);
      if (result.rows[0]) {
        await redis.del(`careplan:${id}`);
      }
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error updating care plan status:', error);
      return null;
    }
  }

  async getGoalsForCarePlan(carePlanId: string): Promise<CarePlanGoal[]> {
    ensureInitialized();

    const query = `
      SELECT id, care_plan_id as "carePlanId", description,
             target_value as "targetValue", target_date as "targetDate",
             status, priority, current_value as "currentValue",
             percent_complete as "percentComplete",
             linked_intervention_ids as "linkedInterventionIds",
             guideline_reference as "guidelineReference",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM care_plan_goals
      WHERE care_plan_id = $1
      ORDER BY priority ASC, created_at ASC
    `;

    try {
      const result = await pool.query(query, [carePlanId]);
      return result.rows;
    } catch (error) {
      console.error('Error getting goals:', error);
      return [];
    }
  }

  async getInterventionsForCarePlan(carePlanId: string): Promise<CarePlanIntervention[]> {
    ensureInitialized();

    const query = `
      SELECT id, care_plan_id as "carePlanId", type, description,
             medication_code as "medicationCode", dosage, frequency,
             procedure_code as "procedureCode",
             referral_specialty as "referralSpecialty",
             status, scheduled_date as "scheduledDate",
             completed_date as "completedDate",
             patient_instructions as "patientInstructions",
             provider_notes as "providerNotes",
             guideline_reference as "guidelineReference",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM care_plan_interventions
      WHERE care_plan_id = $1
      ORDER BY scheduled_date ASC NULLS LAST, created_at ASC
    `;

    try {
      const result = await pool.query(query, [carePlanId]);
      return result.rows;
    } catch (error) {
      console.error('Error getting interventions:', error);
      return [];
    }
  }

  async addGoal(input: {
    carePlanId: string;
    description: string;
    targetValue?: string;
    targetDate?: Date;
    priority: GoalPriority;
    guidelineReference?: string;
  }): Promise<CarePlanGoal> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO care_plan_goals (id, care_plan_id, description, target_value,
                                   target_date, status, priority, guideline_reference)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, care_plan_id as "carePlanId", description,
                target_value as "targetValue", target_date as "targetDate",
                status, priority, guideline_reference as "guidelineReference",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.carePlanId,
        input.description,
        input.targetValue || null,
        input.targetDate || null,
        GoalStatus.NOT_STARTED,
        input.priority,
        input.guidelineReference || null
      ]);

      return { ...result.rows[0], linkedInterventionIds: [] };
    } catch (error: any) {
      console.error('Error adding goal:', error);
      throw error;
    }
  }

  async addIntervention(input: {
    carePlanId: string;
    type: InterventionType;
    description: string;
    medicationCode?: string;
    dosage?: string;
    frequency?: string;
    procedureCode?: string;
    referralSpecialty?: string;
    scheduledDate?: Date;
    patientInstructions?: string;
    guidelineReference?: string;
  }): Promise<CarePlanIntervention> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO care_plan_interventions (id, care_plan_id, type, description,
                                           medication_code, dosage, frequency,
                                           procedure_code, referral_specialty,
                                           status, scheduled_date, patient_instructions,
                                           guideline_reference)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, care_plan_id as "carePlanId", type, description,
                medication_code as "medicationCode", dosage, frequency,
                procedure_code as "procedureCode",
                referral_specialty as "referralSpecialty",
                status, scheduled_date as "scheduledDate",
                patient_instructions as "patientInstructions",
                guideline_reference as "guidelineReference",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.carePlanId,
        input.type,
        input.description,
        input.medicationCode || null,
        input.dosage || null,
        input.frequency || null,
        input.procedureCode || null,
        input.referralSpecialty || null,
        InterventionStatus.SCHEDULED,
        input.scheduledDate || null,
        input.patientInstructions || null,
        input.guidelineReference || null
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error adding intervention:', error);
      throw error;
    }
  }
}

// Template Service
class CarePlanTemplateService {
  async getTemplateById(id: string): Promise<CarePlanTemplate | null> {
    ensureInitialized();

    const query = `
      SELECT id, name, category, condition_codes as "conditionCodes",
             guideline_source as "guidelineSource",
             evidence_grade as "evidenceGrade",
             is_active as "isActive", version,
             created_at as "createdAt", updated_at as "updatedAt"
      FROM care_plan_templates
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting template:', error);
      return null;
    }
  }

  async getTemplates(
    filter: {
      category?: TemplateCategory;
      conditionCode?: string;
      isActive?: boolean;
    },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ templates: CarePlanTemplate[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50 } = pagination;

    let query = `
      SELECT id, name, category, condition_codes as "conditionCodes",
             guideline_source as "guidelineSource",
             evidence_grade as "evidenceGrade",
             is_active as "isActive", version,
             created_at as "createdAt", updated_at as "updatedAt"
      FROM care_plan_templates
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.category) {
      query += ` AND category = $${paramIndex}`;
      params.push(filter.category);
      paramIndex++;
    }

    if (filter.conditionCode) {
      query += ` AND $${paramIndex} = ANY(condition_codes)`;
      params.push(filter.conditionCode);
      paramIndex++;
    }

    if (filter.isActive !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(filter.isActive);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM');

    query += ` ORDER BY name ASC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const templates = result.rows.slice(0, first);
      const totalCount = parseInt(countResult.rows[0].count);

      return { templates, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error getting templates:', error);
      return { templates: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async getTemplatesForConditions(conditionCodes: string[]): Promise<CarePlanTemplate[]> {
    ensureInitialized();

    const query = `
      SELECT id, name, category, condition_codes as "conditionCodes",
             guideline_source as "guidelineSource",
             evidence_grade as "evidenceGrade",
             is_active as "isActive", version,
             created_at as "createdAt", updated_at as "updatedAt"
      FROM care_plan_templates
      WHERE is_active = true
        AND condition_codes && $1
      ORDER BY name ASC
    `;

    try {
      const result = await pool.query(query, [conditionCodes]);
      return result.rows;
    } catch (error) {
      console.error('Error getting templates for conditions:', error);
      return [];
    }
  }
}

// Export service instances
export const carePlanService = new CarePlanService();
export const carePlanTemplateService = new CarePlanTemplateService();
