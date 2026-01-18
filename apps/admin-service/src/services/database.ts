import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// Enums
export enum UserRole {
  ADMIN = 'ADMIN',
  CLINICIAN = 'CLINICIAN',
  REVIEWER = 'REVIEWER',
  AUDITOR = 'AUDITOR',
  READ_ONLY = 'READ_ONLY'
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING = 'PENDING'
}

export enum SafetyRuleType {
  DRUG_INTERACTION = 'DRUG_INTERACTION',
  ALLERGY_ALERT = 'ALLERGY_ALERT',
  CONTRAINDICATION = 'CONTRAINDICATION',
  DOSAGE_CHECK = 'DOSAGE_CHECK',
  AGE_RESTRICTION = 'AGE_RESTRICTION',
  LAB_VALUE_CHECK = 'LAB_VALUE_CHECK'
}

export enum SafetyRuleSeverity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INFO = 'INFO'
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  IMPORT = 'IMPORT',
  EXPORT = 'EXPORT',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  VIEW = 'VIEW'
}

export enum AuditEntityType {
  USER = 'USER',
  CARE_PLAN_TEMPLATE = 'CARE_PLAN_TEMPLATE',
  SAFETY_RULE = 'SAFETY_RULE',
  MEDICATION = 'MEDICATION',
  PATIENT = 'PATIENT',
  CARE_PLAN = 'CARE_PLAN',
  IMPORT_JOB = 'IMPORT_JOB'
}

export enum ImportJobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum ImportJobType {
  PATIENTS = 'PATIENTS',
  CARE_PLAN_TEMPLATES = 'CARE_PLAN_TEMPLATES',
  SAFETY_RULES = 'SAFETY_RULES',
  MEDICATIONS = 'MEDICATIONS'
}

// Interfaces
export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Medication {
  code: string;
  name: string;
  genericName?: string;
  drugClass?: string;
  description?: string;
  contraindications: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DrugInteraction {
  id: string;
  medicationCode: string;
  interactingDrugCode: string;
  interactingDrugName: string;
  severity: SafetyRuleSeverity;
  description: string;
  clinicalEffect?: string;
  managementRecommendation?: string;
}

export interface SafetyRule {
  id: string;
  name: string;
  ruleType: SafetyRuleType;
  severity: SafetyRuleSeverity;
  description: string;
  alertMessage: string;
  triggerConditions: string;
  isActive: boolean;
  version: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  userId?: string;
  userName?: string;
  changes?: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

export interface ImportJob {
  id: string;
  type: ImportJobType;
  status: ImportJobStatus;
  fileName: string;
  totalRows: number;
  processedRows: number;
  successRows: number;
  errorRows: number;
  errors: ImportError[];
  startedAt?: Date;
  completedAt?: Date;
  createdBy: string;
  createdAt: Date;
}

export interface ImportError {
  rowNumber: number;
  field?: string;
  message: string;
  value?: string;
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

// User Service
class UserService {
  async getUserById(id: string): Promise<AdminUser | null> {
    ensureInitialized();
    const cacheKey = `admin_user:${id}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      SELECT id, email, first_name as "firstName", last_name as "lastName",
             role, status, last_login_at as "lastLoginAt",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM admin_users
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      const user = result.rows[0] || null;

      if (user) {
        await redis.setex(cacheKey, 300, JSON.stringify(user));
      }

      return user;
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  async getUsers(
    filter: { role?: UserRole; status?: UserStatus; searchTerm?: string },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ users: AdminUser[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50 } = pagination;

    let query = `
      SELECT id, email, first_name as "firstName", last_name as "lastName",
             role, status, last_login_at as "lastLoginAt",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM admin_users
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.role) {
      query += ` AND role = $${paramIndex}`;
      params.push(filter.role);
      paramIndex++;
    }

    if (filter.status) {
      query += ` AND status = $${paramIndex}`;
      params.push(filter.status);
      paramIndex++;
    }

    if (filter.searchTerm) {
      query += ` AND (email ILIKE $${paramIndex} OR first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex})`;
      params.push(`%${filter.searchTerm}%`);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT[\s\S]*?FROM/i, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const users = result.rows.slice(0, first);
      const totalCount = parseInt(countResult.rows[0].count);

      return { users, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error getting users:', error);
      return { users: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async createUser(input: {
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
  }): Promise<AdminUser> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO admin_users (id, email, first_name, last_name, role, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, first_name as "firstName", last_name as "lastName",
                role, status, created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.email,
        input.firstName,
        input.lastName,
        input.role,
        UserStatus.PENDING
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async updateUser(id: string, input: {
    firstName?: string;
    lastName?: string;
    role?: UserRole;
    status?: UserStatus;
  }): Promise<AdminUser | null> {
    ensureInitialized();

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (input.firstName) {
      updates.push(`first_name = $${paramIndex}`);
      params.push(input.firstName);
      paramIndex++;
    }

    if (input.lastName) {
      updates.push(`last_name = $${paramIndex}`);
      params.push(input.lastName);
      paramIndex++;
    }

    if (input.role) {
      updates.push(`role = $${paramIndex}`);
      params.push(input.role);
      paramIndex++;
    }

    if (input.status) {
      updates.push(`status = $${paramIndex}`);
      params.push(input.status);
      paramIndex++;
    }

    if (updates.length === 0) {
      return await this.getUserById(id);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    const query = `
      UPDATE admin_users
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, email, first_name as "firstName", last_name as "lastName",
                role, status, last_login_at as "lastLoginAt",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, params);
      if (result.rows[0]) {
        await redis.del(`admin_user:${id}`);
      }
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error updating user:', error);
      return null;
    }
  }

  async deleteUser(id: string): Promise<boolean> {
    ensureInitialized();

    const query = `DELETE FROM admin_users WHERE id = $1`;

    try {
      const result = await pool.query(query, [id]);
      if (result.rowCount && result.rowCount > 0) {
        await redis.del(`admin_user:${id}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error deleting user:', error);
      return false;
    }
  }
}

// Medication Service
class MedicationService {
  async getMedicationByCode(code: string): Promise<Medication | null> {
    ensureInitialized();
    const cacheKey = `medication:${code}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      SELECT code, name, generic_name as "genericName", drug_class as "drugClass",
             description, contraindications, is_active as "isActive",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM medications
      WHERE code = $1
    `;

    try {
      const result = await pool.query(query, [code]);
      const medication = result.rows[0] || null;

      if (medication) {
        await redis.setex(cacheKey, 300, JSON.stringify(medication));
      }

      return medication;
    } catch (error) {
      console.error('Error getting medication:', error);
      return null;
    }
  }

  async getMedications(
    filter: { drugClass?: string; searchTerm?: string; isActive?: boolean },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ medications: Medication[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50 } = pagination;

    let query = `
      SELECT code, name, generic_name as "genericName", drug_class as "drugClass",
             description, contraindications, is_active as "isActive",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM medications
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.drugClass) {
      query += ` AND drug_class = $${paramIndex}`;
      params.push(filter.drugClass);
      paramIndex++;
    }

    if (filter.searchTerm) {
      query += ` AND (name ILIKE $${paramIndex} OR generic_name ILIKE $${paramIndex} OR code ILIKE $${paramIndex})`;
      params.push(`%${filter.searchTerm}%`);
      paramIndex++;
    }

    if (filter.isActive !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(filter.isActive);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT[\s\S]*?FROM/i, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];

    query += ` ORDER BY name ASC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const medications = result.rows.slice(0, first);
      const totalCount = parseInt(countResult.rows[0].count);

      return { medications, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error getting medications:', error);
      return { medications: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async createMedication(input: {
    code: string;
    name: string;
    genericName?: string;
    drugClass?: string;
    description?: string;
    contraindications?: string[];
  }): Promise<Medication> {
    ensureInitialized();

    const query = `
      INSERT INTO medications (code, name, generic_name, drug_class, description, contraindications, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING code, name, generic_name as "genericName", drug_class as "drugClass",
                description, contraindications, is_active as "isActive",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        input.code,
        input.name,
        input.genericName || null,
        input.drugClass || null,
        input.description || null,
        input.contraindications || []
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error creating medication:', error);
      throw error;
    }
  }

  async getInteractionsForMedication(medicationCode: string): Promise<DrugInteraction[]> {
    ensureInitialized();

    const query = `
      SELECT id, medication_code as "medicationCode",
             interacting_drug_code as "interactingDrugCode",
             interacting_drug_name as "interactingDrugName",
             severity, description, clinical_effect as "clinicalEffect",
             management_recommendation as "managementRecommendation"
      FROM drug_interactions
      WHERE medication_code = $1
    `;

    try {
      const result = await pool.query(query, [medicationCode]);
      return result.rows;
    } catch (error) {
      console.error('Error getting drug interactions:', error);
      return [];
    }
  }
}

// Safety Rule Service
class SafetyRuleService {
  async getSafetyRuleById(id: string): Promise<SafetyRule | null> {
    ensureInitialized();

    const query = `
      SELECT id, name, rule_type as "ruleType", severity, description,
             alert_message as "alertMessage", trigger_conditions as "triggerConditions",
             is_active as "isActive", version, created_by as "createdBy",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM safety_rules
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting safety rule:', error);
      return null;
    }
  }

  async getSafetyRules(
    filter: {
      ruleType?: SafetyRuleType;
      severity?: SafetyRuleSeverity;
      isActive?: boolean;
      searchTerm?: string;
    },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ rules: SafetyRule[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50 } = pagination;

    let query = `
      SELECT id, name, rule_type as "ruleType", severity, description,
             alert_message as "alertMessage", trigger_conditions as "triggerConditions",
             is_active as "isActive", version, created_by as "createdBy",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM safety_rules
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.ruleType) {
      query += ` AND rule_type = $${paramIndex}`;
      params.push(filter.ruleType);
      paramIndex++;
    }

    if (filter.severity) {
      query += ` AND severity = $${paramIndex}`;
      params.push(filter.severity);
      paramIndex++;
    }

    if (filter.isActive !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(filter.isActive);
      paramIndex++;
    }

    if (filter.searchTerm) {
      query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${filter.searchTerm}%`);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT[\s\S]*?FROM/i, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];

    query += ` ORDER BY severity ASC, name ASC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const rules = result.rows.slice(0, first);
      const totalCount = parseInt(countResult.rows[0].count);

      return { rules, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error getting safety rules:', error);
      return { rules: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async createSafetyRule(input: {
    name: string;
    ruleType: SafetyRuleType;
    severity: SafetyRuleSeverity;
    description: string;
    alertMessage: string;
    triggerConditions: string;
    createdBy: string;
  }): Promise<SafetyRule> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO safety_rules (id, name, rule_type, severity, description,
                                alert_message, trigger_conditions, is_active, version, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, '1.0', $8)
      RETURNING id, name, rule_type as "ruleType", severity, description,
                alert_message as "alertMessage", trigger_conditions as "triggerConditions",
                is_active as "isActive", version, created_by as "createdBy",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.name,
        input.ruleType,
        input.severity,
        input.description,
        input.alertMessage,
        input.triggerConditions,
        input.createdBy
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error creating safety rule:', error);
      throw error;
    }
  }

  async updateSafetyRule(id: string, input: {
    name?: string;
    severity?: SafetyRuleSeverity;
    description?: string;
    alertMessage?: string;
    triggerConditions?: string;
    isActive?: boolean;
  }): Promise<SafetyRule | null> {
    ensureInitialized();

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (input.name) {
      updates.push(`name = $${paramIndex}`);
      params.push(input.name);
      paramIndex++;
    }

    if (input.severity) {
      updates.push(`severity = $${paramIndex}`);
      params.push(input.severity);
      paramIndex++;
    }

    if (input.description) {
      updates.push(`description = $${paramIndex}`);
      params.push(input.description);
      paramIndex++;
    }

    if (input.alertMessage) {
      updates.push(`alert_message = $${paramIndex}`);
      params.push(input.alertMessage);
      paramIndex++;
    }

    if (input.triggerConditions) {
      updates.push(`trigger_conditions = $${paramIndex}`);
      params.push(input.triggerConditions);
      paramIndex++;
    }

    if (input.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      params.push(input.isActive);
      paramIndex++;
    }

    if (updates.length === 0) {
      return await this.getSafetyRuleById(id);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    const query = `
      UPDATE safety_rules
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, name, rule_type as "ruleType", severity, description,
                alert_message as "alertMessage", trigger_conditions as "triggerConditions",
                is_active as "isActive", version, created_by as "createdBy",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, params);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error updating safety rule:', error);
      return null;
    }
  }

  async deleteSafetyRule(id: string): Promise<boolean> {
    ensureInitialized();

    const query = `DELETE FROM safety_rules WHERE id = $1`;

    try {
      const result = await pool.query(query, [id]);
      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting safety rule:', error);
      return false;
    }
  }

  // ==================== Version History Methods ====================

  async getSafetyRuleHistory(id: string): Promise<SafetyRuleVersion[]> {
    ensureInitialized();

    const query = `
      SELECT
        history_id as "historyId",
        id, name, rule_type as "ruleType", severity, description,
        alert_message as "alertMessage", trigger_conditions as "triggerConditions",
        is_active as "isActive", version, created_by as "createdBy",
        created_at as "createdAt", updated_at as "updatedAt",
        valid_from as "validFrom", valid_to as "validTo",
        change_type as "changeType"
      FROM safety_rules_history
      WHERE id = $1
      ORDER BY valid_to DESC
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows;
    } catch (error) {
      console.error('Error getting safety rule history:', error);
      return [];
    }
  }

  async getSafetyRuleAtTime(id: string, timestamp: Date): Promise<SafetyRule | null> {
    ensureInitialized();

    // First check if current version was valid at that time
    const currentQuery = `
      SELECT id, name, rule_type as "ruleType", severity, description,
             alert_message as "alertMessage", trigger_conditions as "triggerConditions",
             is_active as "isActive", version, created_by as "createdBy",
             created_at as "createdAt", updated_at as "updatedAt",
             valid_from as "validFrom"
      FROM safety_rules
      WHERE id = $1 AND valid_from <= $2
    `;

    try {
      let result = await pool.query(currentQuery, [id, timestamp]);
      if (result.rows.length > 0) {
        return result.rows[0];
      }

      // Check history
      const historyQuery = `
        SELECT id, name, rule_type as "ruleType", severity, description,
               alert_message as "alertMessage", trigger_conditions as "triggerConditions",
               is_active as "isActive", version, created_by as "createdBy",
               created_at as "createdAt", updated_at as "updatedAt",
               valid_from as "validFrom", valid_to as "validTo"
        FROM safety_rules_history
        WHERE id = $1 AND valid_from <= $2 AND valid_to > $2
      `;

      result = await pool.query(historyQuery, [id, timestamp]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting safety rule at time:', error);
      return null;
    }
  }

  async getSafetyRuleVersionCount(id: string): Promise<number> {
    ensureInitialized();

    const query = `
      SELECT COUNT(*) + 1 as count
      FROM safety_rules_history
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('Error getting safety rule version count:', error);
      return 1;
    }
  }

  async restoreSafetyRuleVersion(id: string, historyId: string): Promise<SafetyRule | null> {
    ensureInitialized();

    // Get the historical version
    const historyQuery = `
      SELECT name, rule_type, severity, description, alert_message,
             trigger_conditions, is_active, version
      FROM safety_rules_history
      WHERE history_id = $1 AND id = $2
    `;

    try {
      const historyResult = await pool.query(historyQuery, [historyId, id]);
      if (historyResult.rows.length === 0) {
        return null;
      }

      const historical = historyResult.rows[0];

      // Update the current record with historical values
      const updateQuery = `
        UPDATE safety_rules
        SET name = $1, severity = $2, description = $3, alert_message = $4,
            trigger_conditions = $5, is_active = $6, updated_at = NOW()
        WHERE id = $7
        RETURNING id, name, rule_type as "ruleType", severity, description,
                  alert_message as "alertMessage", trigger_conditions as "triggerConditions",
                  is_active as "isActive", version, created_by as "createdBy",
                  created_at as "createdAt", updated_at as "updatedAt"
      `;

      const result = await pool.query(updateQuery, [
        historical.name,
        historical.severity,
        historical.description,
        historical.alert_message,
        historical.trigger_conditions,
        historical.is_active,
        id
      ]);

      return result.rows[0] || null;
    } catch (error) {
      console.error('Error restoring safety rule version:', error);
      return null;
    }
  }
}

// Safety Rule Version type
export interface SafetyRuleVersion extends SafetyRule {
  historyId: string;
  validFrom: string;
  validTo: string;
  changeType: 'UPDATE' | 'DELETE';
}

// Audit Log Service
class AuditLogService {
  async getAuditLogById(id: string): Promise<AuditLog | null> {
    ensureInitialized();

    const query = `
      SELECT id, action, entity_type as "entityType", entity_id as "entityId",
             user_id as "userId", user_name as "userName", changes,
             ip_address as "ipAddress", user_agent as "userAgent",
             timestamp
      FROM audit_logs
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting audit log:', error);
      return null;
    }
  }

  async getAuditLogs(
    filter: {
      action?: AuditAction;
      entityType?: AuditEntityType;
      entityId?: string;
      userId?: string;
      startDate?: Date;
      endDate?: Date;
    },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ logs: AuditLog[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50 } = pagination;

    let query = `
      SELECT id, action, entity_type as "entityType", entity_id as "entityId",
             user_id as "userId", user_name as "userName", changes,
             ip_address as "ipAddress", user_agent as "userAgent",
             timestamp
      FROM audit_logs
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.action) {
      query += ` AND action = $${paramIndex}`;
      params.push(filter.action);
      paramIndex++;
    }

    if (filter.entityType) {
      query += ` AND entity_type = $${paramIndex}`;
      params.push(filter.entityType);
      paramIndex++;
    }

    if (filter.entityId) {
      query += ` AND entity_id = $${paramIndex}`;
      params.push(filter.entityId);
      paramIndex++;
    }

    if (filter.userId) {
      query += ` AND user_id = $${paramIndex}`;
      params.push(filter.userId);
      paramIndex++;
    }

    if (filter.startDate) {
      query += ` AND timestamp >= $${paramIndex}`;
      params.push(filter.startDate);
      paramIndex++;
    }

    if (filter.endDate) {
      query += ` AND timestamp <= $${paramIndex}`;
      params.push(filter.endDate);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT[\s\S]*?FROM/i, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];

    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const logs = result.rows.slice(0, first);
      const totalCount = parseInt(countResult.rows[0].count);

      return { logs, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error getting audit logs:', error);
      return { logs: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async createAuditLog(input: {
    action: AuditAction;
    entityType: AuditEntityType;
    entityId: string;
    userId?: string;
    userName?: string;
    changes?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuditLog> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO audit_logs (id, action, entity_type, entity_id, user_id, user_name, changes, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, action, entity_type as "entityType", entity_id as "entityId",
                user_id as "userId", user_name as "userName", changes,
                ip_address as "ipAddress", user_agent as "userAgent",
                timestamp
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.action,
        input.entityType,
        input.entityId,
        input.userId || null,
        input.userName || null,
        input.changes || null,
        input.ipAddress || null,
        input.userAgent || null
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error creating audit log:', error);
      throw error;
    }
  }
}

// Import Job Service
class ImportJobService {
  async getImportJobById(id: string): Promise<ImportJob | null> {
    ensureInitialized();

    const query = `
      SELECT id, type, status, file_name as "fileName",
             total_rows as "totalRows", processed_rows as "processedRows",
             success_rows as "successRows", error_rows as "errorRows",
             errors, started_at as "startedAt", completed_at as "completedAt",
             created_by as "createdBy", created_at as "createdAt"
      FROM import_jobs
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting import job:', error);
      return null;
    }
  }

  async getImportJobs(
    filter: { type?: ImportJobType; status?: ImportJobStatus },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ jobs: ImportJob[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50 } = pagination;

    let query = `
      SELECT id, type, status, file_name as "fileName",
             total_rows as "totalRows", processed_rows as "processedRows",
             success_rows as "successRows", error_rows as "errorRows",
             errors, started_at as "startedAt", completed_at as "completedAt",
             created_by as "createdBy", created_at as "createdAt"
      FROM import_jobs
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.type) {
      query += ` AND type = $${paramIndex}`;
      params.push(filter.type);
      paramIndex++;
    }

    if (filter.status) {
      query += ` AND status = $${paramIndex}`;
      params.push(filter.status);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT[\s\S]*?FROM/i, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const jobs = result.rows.slice(0, first);
      const totalCount = parseInt(countResult.rows[0].count);

      return { jobs, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error getting import jobs:', error);
      return { jobs: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async createImportJob(input: {
    type: ImportJobType;
    fileName: string;
    createdBy: string;
  }): Promise<ImportJob> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO import_jobs (id, type, status, file_name, total_rows, processed_rows,
                               success_rows, error_rows, errors, created_by)
      VALUES ($1, $2, $3, $4, 0, 0, 0, 0, '[]'::jsonb, $5)
      RETURNING id, type, status, file_name as "fileName",
                total_rows as "totalRows", processed_rows as "processedRows",
                success_rows as "successRows", error_rows as "errorRows",
                errors, started_at as "startedAt", completed_at as "completedAt",
                created_by as "createdBy", created_at as "createdAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.type,
        ImportJobStatus.PENDING,
        input.fileName,
        input.createdBy
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error creating import job:', error);
      throw error;
    }
  }
}

// Stats Service
class StatsService {
  async getAdminStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    totalTemplates: number;
    activeTemplates: number;
    totalSafetyRules: number;
    activeSafetyRules: number;
    totalMedications: number;
    recentImportJobs: number;
    recentAuditLogs: number;
  }> {
    ensureInitialized();

    const queries = [
      pool.query('SELECT COUNT(*) as count FROM admin_users'),
      pool.query("SELECT COUNT(*) as count FROM admin_users WHERE status = 'ACTIVE'"),
      pool.query('SELECT COUNT(*) as count FROM care_plans'),
      pool.query("SELECT COUNT(*) as count FROM care_plans WHERE is_active = true"),
      pool.query('SELECT COUNT(*) as count FROM safety_rules'),
      pool.query("SELECT COUNT(*) as count FROM safety_rules WHERE is_active = true"),
      pool.query('SELECT COUNT(*) as count FROM medications'),
      pool.query("SELECT COUNT(*) as count FROM import_jobs WHERE created_at > NOW() - INTERVAL '7 days'"),
      pool.query("SELECT COUNT(*) as count FROM audit_logs WHERE timestamp > NOW() - INTERVAL '24 hours'"),
    ];

    try {
      const results = await Promise.all(queries);
      return {
        totalUsers: parseInt(results[0].rows[0].count),
        activeUsers: parseInt(results[1].rows[0].count),
        totalTemplates: parseInt(results[2].rows[0].count),
        activeTemplates: parseInt(results[3].rows[0].count),
        totalSafetyRules: parseInt(results[4].rows[0].count),
        activeSafetyRules: parseInt(results[5].rows[0].count),
        totalMedications: parseInt(results[6].rows[0].count),
        recentImportJobs: parseInt(results[7].rows[0].count),
        recentAuditLogs: parseInt(results[8].rows[0].count),
      };
    } catch (error) {
      console.error('Error getting admin stats:', error);
      return {
        totalUsers: 0,
        activeUsers: 0,
        totalTemplates: 0,
        activeTemplates: 0,
        totalSafetyRules: 0,
        activeSafetyRules: 0,
        totalMedications: 0,
        recentImportJobs: 0,
        recentAuditLogs: 0,
      };
    }
  }
}

// Export service instances
export const userService = new UserService();
export const medicationService = new MedicationService();
export const safetyRuleService = new SafetyRuleService();
export const auditLogService = new AuditLogService();
export const importJobService = new ImportJobService();
export const statsService = new StatsService();
