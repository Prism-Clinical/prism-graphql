import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// Enums
export enum PathwayNodeType {
  ROOT = 'root',
  DECISION = 'decision',
  BRANCH = 'branch',
  RECOMMENDATION = 'recommendation'
}

export enum PathwayActionType {
  MEDICATION = 'medication',
  LAB = 'lab',
  REFERRAL = 'referral',
  PROCEDURE = 'procedure',
  EDUCATION = 'education',
  MONITORING = 'monitoring',
  LIFESTYLE = 'lifestyle',
  FOLLOW_UP = 'follow_up',
  URGENT_CARE = 'urgent_care'
}

export enum PathwayInstanceStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED',
  OVERRIDDEN = 'OVERRIDDEN'
}

export enum SelectionType {
  ML_RECOMMENDED = 'ml_recommended',
  PROVIDER_SELECTED = 'provider_selected',
  AUTO_APPLIED = 'auto_applied'
}

// Interfaces
export interface ClinicalPathway {
  id: string;
  name: string;
  slug: string;
  description?: string;
  primaryConditionCodes: string[];
  applicableContexts?: Record<string, any>;
  version: string;
  evidenceSource?: string;
  evidenceGrade?: string;
  isActive: boolean;
  isPublished: boolean;
  publishedAt?: Date;
  createdAt: Date;
  createdBy?: string;
  updatedAt: Date;
}

export interface PathwayNode {
  id: string;
  pathwayId: string;
  parentNodeId?: string;
  nodeType: PathwayNodeType;
  title: string;
  description?: string;
  actionType?: PathwayActionType;
  decisionFactors: DecisionFactor[];
  suggestedTemplateId?: string;
  sortOrder: number;
  baseConfidence: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionFactor {
  type: string;
  label: string;
  value?: string;
  impact: string;
}

export interface PathwayNodeOutcome {
  id: string;
  nodeId: string;
  label: string;
  description?: string;
  medicationCode?: string;
  procedureCode?: string;
  labCode?: string;
  diagnosisCode?: string;
  outcomeFactors?: Record<string, any>;
  sortOrder: number;
  createdAt: Date;
}

export interface PatientPathwayInstance {
  id: string;
  patientId: string;
  providerId?: string;
  pathwayId: string;
  patientContext: Record<string, any>;
  mlModelId?: string;
  mlModelVersion?: string;
  mlRecommendedPath?: string[];
  mlConfidenceScores?: Record<string, number>;
  status: PathwayInstanceStatus;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientPathwaySelection {
  id: string;
  instanceId: string;
  nodeId: string;
  selectionType: SelectionType;
  mlConfidence?: number;
  mlRank?: number;
  overrideReason?: string;
  resultingCarePlanId?: string;
  selectedAt: Date;
  selectedBy?: string;
}

export interface PathwayUsageStats {
  totalInstances: number;
  completedInstances: number;
  abandonedInstances: number;
  overrideRate: number;
  avgCompletionTimeMinutes: number;
}

export interface NodeSelectionStats {
  totalSelections: number;
  mlRecommendedCount: number;
  providerSelectedCount: number;
  avgMlConfidence: number;
  linkedCarePlans: number;
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// Clinical Pathway Service
class ClinicalPathwayService {
  async getById(id: string): Promise<ClinicalPathway | null> {
    ensureInitialized();
    const cacheKey = `pathway:${id}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      SELECT id, name, slug, description,
             primary_condition_codes as "primaryConditionCodes",
             applicable_contexts as "applicableContexts",
             version, evidence_source as "evidenceSource",
             evidence_grade as "evidenceGrade",
             is_active as "isActive", is_published as "isPublished",
             published_at as "publishedAt",
             created_at as "createdAt", created_by as "createdBy",
             updated_at as "updatedAt"
      FROM clinical_pathways
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      const pathway = result.rows[0] || null;

      if (pathway) {
        await redis.setex(cacheKey, 300, JSON.stringify(pathway));
      }

      return pathway;
    } catch (error) {
      console.error('Error getting pathway:', error);
      return null;
    }
  }

  async getBySlug(slug: string): Promise<ClinicalPathway | null> {
    ensureInitialized();

    const query = `
      SELECT id, name, slug, description,
             primary_condition_codes as "primaryConditionCodes",
             applicable_contexts as "applicableContexts",
             version, evidence_source as "evidenceSource",
             evidence_grade as "evidenceGrade",
             is_active as "isActive", is_published as "isPublished",
             published_at as "publishedAt",
             created_at as "createdAt", created_by as "createdBy",
             updated_at as "updatedAt"
      FROM clinical_pathways
      WHERE slug = $1
    `;

    try {
      const result = await pool.query(query, [slug]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting pathway by slug:', error);
      return null;
    }
  }

  async list(
    filter: { isActive?: boolean; isPublished?: boolean; conditionCode?: string; searchTerm?: string },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ pathways: ClinicalPathway[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50 } = pagination;

    let query = `
      SELECT id, name, slug, description,
             primary_condition_codes as "primaryConditionCodes",
             applicable_contexts as "applicableContexts",
             version, evidence_source as "evidenceSource",
             evidence_grade as "evidenceGrade",
             is_active as "isActive", is_published as "isPublished",
             published_at as "publishedAt",
             created_at as "createdAt", created_by as "createdBy",
             updated_at as "updatedAt"
      FROM clinical_pathways
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.isActive !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(filter.isActive);
      paramIndex++;
    }

    if (filter.isPublished !== undefined) {
      query += ` AND is_published = $${paramIndex}`;
      params.push(filter.isPublished);
      paramIndex++;
    }

    if (filter.conditionCode) {
      query += ` AND $${paramIndex} = ANY(primary_condition_codes)`;
      params.push(filter.conditionCode);
      paramIndex++;
    }

    if (filter.searchTerm) {
      query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${filter.searchTerm}%`);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT[\s\S]*?FROM/i, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];

    query += ` ORDER BY name ASC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const pathways = result.rows.slice(0, first);
      const totalCount = parseInt(countResult.rows[0].count);

      return { pathways, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error listing pathways:', error);
      return { pathways: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async create(input: {
    name: string;
    slug?: string;
    description?: string;
    primaryConditionCodes: string[];
    applicableContexts?: Record<string, any>;
    evidenceSource?: string;
    evidenceGrade?: string;
  }, createdBy?: string): Promise<ClinicalPathway> {
    ensureInitialized();
    const id = uuidv4();
    const slug = input.slug || slugify(input.name);

    const query = `
      INSERT INTO clinical_pathways (
        id, name, slug, description, primary_condition_codes,
        applicable_contexts, evidence_source, evidence_grade, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, slug, description,
                primary_condition_codes as "primaryConditionCodes",
                applicable_contexts as "applicableContexts",
                version, evidence_source as "evidenceSource",
                evidence_grade as "evidenceGrade",
                is_active as "isActive", is_published as "isPublished",
                published_at as "publishedAt",
                created_at as "createdAt", created_by as "createdBy",
                updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.name,
        slug,
        input.description || null,
        input.primaryConditionCodes,
        JSON.stringify(input.applicableContexts || {}),
        input.evidenceSource || null,
        input.evidenceGrade || null,
        createdBy || null
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error creating pathway:', error);
      throw error;
    }
  }

  async update(id: string, input: {
    name?: string;
    description?: string;
    primaryConditionCodes?: string[];
    applicableContexts?: Record<string, any>;
    evidenceSource?: string;
    evidenceGrade?: string;
    isActive?: boolean;
  }): Promise<ClinicalPathway | null> {
    ensureInitialized();

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (input.name) {
      updates.push(`name = $${paramIndex}`);
      params.push(input.name);
      paramIndex++;
    }

    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(input.description);
      paramIndex++;
    }

    if (input.primaryConditionCodes) {
      updates.push(`primary_condition_codes = $${paramIndex}`);
      params.push(input.primaryConditionCodes);
      paramIndex++;
    }

    if (input.applicableContexts !== undefined) {
      updates.push(`applicable_contexts = $${paramIndex}`);
      params.push(JSON.stringify(input.applicableContexts));
      paramIndex++;
    }

    if (input.evidenceSource !== undefined) {
      updates.push(`evidence_source = $${paramIndex}`);
      params.push(input.evidenceSource);
      paramIndex++;
    }

    if (input.evidenceGrade !== undefined) {
      updates.push(`evidence_grade = $${paramIndex}`);
      params.push(input.evidenceGrade);
      paramIndex++;
    }

    if (input.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      params.push(input.isActive);
      paramIndex++;
    }

    if (updates.length === 0) {
      return await this.getById(id);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    const query = `
      UPDATE clinical_pathways
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, name, slug, description,
                primary_condition_codes as "primaryConditionCodes",
                applicable_contexts as "applicableContexts",
                version, evidence_source as "evidenceSource",
                evidence_grade as "evidenceGrade",
                is_active as "isActive", is_published as "isPublished",
                published_at as "publishedAt",
                created_at as "createdAt", created_by as "createdBy",
                updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, params);
      if (result.rows[0]) {
        await redis.del(`pathway:${id}`);
      }
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error updating pathway:', error);
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    ensureInitialized();

    const query = `DELETE FROM clinical_pathways WHERE id = $1`;

    try {
      const result = await pool.query(query, [id]);
      if (result.rowCount && result.rowCount > 0) {
        await redis.del(`pathway:${id}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error deleting pathway:', error);
      return false;
    }
  }

  async publish(id: string): Promise<ClinicalPathway | null> {
    ensureInitialized();

    const query = `
      UPDATE clinical_pathways
      SET is_published = true, published_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, slug, description,
                primary_condition_codes as "primaryConditionCodes",
                applicable_contexts as "applicableContexts",
                version, evidence_source as "evidenceSource",
                evidence_grade as "evidenceGrade",
                is_active as "isActive", is_published as "isPublished",
                published_at as "publishedAt",
                created_at as "createdAt", created_by as "createdBy",
                updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [id]);
      if (result.rows[0]) {
        await redis.del(`pathway:${id}`);
      }
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error publishing pathway:', error);
      return null;
    }
  }

  async unpublish(id: string): Promise<ClinicalPathway | null> {
    ensureInitialized();

    const query = `
      UPDATE clinical_pathways
      SET is_published = false, published_at = NULL, updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, slug, description,
                primary_condition_codes as "primaryConditionCodes",
                applicable_contexts as "applicableContexts",
                version, evidence_source as "evidenceSource",
                evidence_grade as "evidenceGrade",
                is_active as "isActive", is_published as "isPublished",
                published_at as "publishedAt",
                created_at as "createdAt", created_by as "createdBy",
                updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [id]);
      if (result.rows[0]) {
        await redis.del(`pathway:${id}`);
      }
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error unpublishing pathway:', error);
      return null;
    }
  }

  async duplicate(id: string, newName: string): Promise<ClinicalPathway | null> {
    ensureInitialized();

    // Get original pathway
    const original = await this.getById(id);
    if (!original) return null;

    // Create new pathway
    const newPathway = await this.create({
      name: newName,
      description: original.description,
      primaryConditionCodes: original.primaryConditionCodes,
      applicableContexts: original.applicableContexts,
      evidenceSource: original.evidenceSource,
      evidenceGrade: original.evidenceGrade
    });

    // Copy all nodes
    const nodes = await pathwayNodeService.listByPathway(id);
    const nodeIdMap = new Map<string, string>();

    // First pass: create all nodes without parent references
    for (const node of nodes) {
      const newNode = await pathwayNodeService.create({
        pathwayId: newPathway.id,
        parentNodeId: undefined, // Set in second pass
        nodeType: node.nodeType,
        title: node.title,
        description: node.description,
        actionType: node.actionType,
        decisionFactors: node.decisionFactors,
        suggestedTemplateId: node.suggestedTemplateId,
        sortOrder: node.sortOrder,
        baseConfidence: node.baseConfidence
      });
      nodeIdMap.set(node.id, newNode.id);
    }

    // Second pass: update parent references
    for (const node of nodes) {
      if (node.parentNodeId) {
        const newNodeId = nodeIdMap.get(node.id);
        const newParentId = nodeIdMap.get(node.parentNodeId);
        if (newNodeId && newParentId) {
          await pathwayNodeService.update(newNodeId, { parentNodeId: newParentId });
        }
      }
    }

    return newPathway;
  }

  async getNodeCount(pathwayId: string): Promise<number> {
    ensureInitialized();

    const query = `SELECT COUNT(*) FROM pathway_nodes WHERE pathway_id = $1 AND is_active = true`;

    try {
      const result = await pool.query(query, [pathwayId]);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('Error getting node count:', error);
      return 0;
    }
  }

  async getUsageStats(pathwayId: string): Promise<PathwayUsageStats> {
    ensureInitialized();

    const query = `SELECT * FROM get_pathway_usage_stats($1)`;

    try {
      const result = await pool.query(query, [pathwayId]);
      return result.rows[0] || {
        totalInstances: 0,
        completedInstances: 0,
        abandonedInstances: 0,
        overrideRate: 0,
        avgCompletionTimeMinutes: 0
      };
    } catch (error) {
      console.error('Error getting pathway usage stats:', error);
      return {
        totalInstances: 0,
        completedInstances: 0,
        abandonedInstances: 0,
        overrideRate: 0,
        avgCompletionTimeMinutes: 0
      };
    }
  }
}

// Pathway Node Service
class PathwayNodeService {
  async getById(id: string): Promise<PathwayNode | null> {
    ensureInitialized();

    const query = `
      SELECT id, pathway_id as "pathwayId", parent_node_id as "parentNodeId",
             node_type as "nodeType", title, description,
             action_type as "actionType", decision_factors as "decisionFactors",
             suggested_template_id as "suggestedTemplateId",
             sort_order as "sortOrder", base_confidence as "baseConfidence",
             is_active as "isActive",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM pathway_nodes
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting pathway node:', error);
      return null;
    }
  }

  async listByPathway(pathwayId: string): Promise<PathwayNode[]> {
    ensureInitialized();

    const query = `
      SELECT id, pathway_id as "pathwayId", parent_node_id as "parentNodeId",
             node_type as "nodeType", title, description,
             action_type as "actionType", decision_factors as "decisionFactors",
             suggested_template_id as "suggestedTemplateId",
             sort_order as "sortOrder", base_confidence as "baseConfidence",
             is_active as "isActive",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM pathway_nodes
      WHERE pathway_id = $1 AND is_active = true
      ORDER BY sort_order ASC
    `;

    try {
      const result = await pool.query(query, [pathwayId]);
      return result.rows;
    } catch (error) {
      console.error('Error listing pathway nodes:', error);
      return [];
    }
  }

  async getRootNode(pathwayId: string): Promise<PathwayNode | null> {
    ensureInitialized();

    const query = `
      SELECT id, pathway_id as "pathwayId", parent_node_id as "parentNodeId",
             node_type as "nodeType", title, description,
             action_type as "actionType", decision_factors as "decisionFactors",
             suggested_template_id as "suggestedTemplateId",
             sort_order as "sortOrder", base_confidence as "baseConfidence",
             is_active as "isActive",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM pathway_nodes
      WHERE pathway_id = $1 AND parent_node_id IS NULL AND is_active = true
      LIMIT 1
    `;

    try {
      const result = await pool.query(query, [pathwayId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting root node:', error);
      return null;
    }
  }

  async getChildren(nodeId: string): Promise<PathwayNode[]> {
    ensureInitialized();

    const query = `
      SELECT id, pathway_id as "pathwayId", parent_node_id as "parentNodeId",
             node_type as "nodeType", title, description,
             action_type as "actionType", decision_factors as "decisionFactors",
             suggested_template_id as "suggestedTemplateId",
             sort_order as "sortOrder", base_confidence as "baseConfidence",
             is_active as "isActive",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM pathway_nodes
      WHERE parent_node_id = $1 AND is_active = true
      ORDER BY sort_order ASC
    `;

    try {
      const result = await pool.query(query, [nodeId]);
      return result.rows;
    } catch (error) {
      console.error('Error getting children nodes:', error);
      return [];
    }
  }

  async create(input: {
    pathwayId: string;
    parentNodeId?: string;
    nodeType: PathwayNodeType;
    title: string;
    description?: string;
    actionType?: PathwayActionType;
    decisionFactors?: DecisionFactor[];
    suggestedTemplateId?: string;
    sortOrder?: number;
    baseConfidence?: number;
  }): Promise<PathwayNode> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO pathway_nodes (
        id, pathway_id, parent_node_id, node_type, title, description,
        action_type, decision_factors, suggested_template_id,
        sort_order, base_confidence
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, pathway_id as "pathwayId", parent_node_id as "parentNodeId",
                node_type as "nodeType", title, description,
                action_type as "actionType", decision_factors as "decisionFactors",
                suggested_template_id as "suggestedTemplateId",
                sort_order as "sortOrder", base_confidence as "baseConfidence",
                is_active as "isActive",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.pathwayId,
        input.parentNodeId || null,
        input.nodeType,
        input.title,
        input.description || null,
        input.actionType || null,
        JSON.stringify(input.decisionFactors || []),
        input.suggestedTemplateId || null,
        input.sortOrder ?? 0,
        input.baseConfidence ?? 0.7
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error creating pathway node:', error);
      throw error;
    }
  }

  async update(id: string, input: {
    parentNodeId?: string;
    title?: string;
    description?: string;
    actionType?: PathwayActionType;
    decisionFactors?: DecisionFactor[];
    suggestedTemplateId?: string;
    sortOrder?: number;
    baseConfidence?: number;
    isActive?: boolean;
  }): Promise<PathwayNode | null> {
    ensureInitialized();

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (input.parentNodeId !== undefined) {
      updates.push(`parent_node_id = $${paramIndex}`);
      params.push(input.parentNodeId || null);
      paramIndex++;
    }

    if (input.title) {
      updates.push(`title = $${paramIndex}`);
      params.push(input.title);
      paramIndex++;
    }

    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(input.description);
      paramIndex++;
    }

    if (input.actionType !== undefined) {
      updates.push(`action_type = $${paramIndex}`);
      params.push(input.actionType);
      paramIndex++;
    }

    if (input.decisionFactors) {
      updates.push(`decision_factors = $${paramIndex}`);
      params.push(JSON.stringify(input.decisionFactors));
      paramIndex++;
    }

    if (input.suggestedTemplateId !== undefined) {
      updates.push(`suggested_template_id = $${paramIndex}`);
      params.push(input.suggestedTemplateId);
      paramIndex++;
    }

    if (input.sortOrder !== undefined) {
      updates.push(`sort_order = $${paramIndex}`);
      params.push(input.sortOrder);
      paramIndex++;
    }

    if (input.baseConfidence !== undefined) {
      updates.push(`base_confidence = $${paramIndex}`);
      params.push(input.baseConfidence);
      paramIndex++;
    }

    if (input.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      params.push(input.isActive);
      paramIndex++;
    }

    if (updates.length === 0) {
      return await this.getById(id);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    const query = `
      UPDATE pathway_nodes
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, pathway_id as "pathwayId", parent_node_id as "parentNodeId",
                node_type as "nodeType", title, description,
                action_type as "actionType", decision_factors as "decisionFactors",
                suggested_template_id as "suggestedTemplateId",
                sort_order as "sortOrder", base_confidence as "baseConfidence",
                is_active as "isActive",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, params);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error updating pathway node:', error);
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    ensureInitialized();

    // Soft delete by setting is_active = false
    const query = `UPDATE pathway_nodes SET is_active = false, updated_at = NOW() WHERE id = $1`;

    try {
      const result = await pool.query(query, [id]);
      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting pathway node:', error);
      return false;
    }
  }

  async move(id: string, newParentId?: string, newSortOrder?: number): Promise<PathwayNode | null> {
    ensureInitialized();

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (newParentId !== undefined) {
      updates.push(`parent_node_id = $${paramIndex}`);
      params.push(newParentId || null);
      paramIndex++;
    }

    if (newSortOrder !== undefined) {
      updates.push(`sort_order = $${paramIndex}`);
      params.push(newSortOrder);
      paramIndex++;
    }

    if (updates.length === 0) {
      return await this.getById(id);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    const query = `
      UPDATE pathway_nodes
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, pathway_id as "pathwayId", parent_node_id as "parentNodeId",
                node_type as "nodeType", title, description,
                action_type as "actionType", decision_factors as "decisionFactors",
                suggested_template_id as "suggestedTemplateId",
                sort_order as "sortOrder", base_confidence as "baseConfidence",
                is_active as "isActive",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, params);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error moving pathway node:', error);
      return null;
    }
  }

  async getSelectionStats(nodeId: string): Promise<NodeSelectionStats> {
    ensureInitialized();

    const query = `SELECT * FROM get_node_selection_stats($1)`;

    try {
      const result = await pool.query(query, [nodeId]);
      const row = result.rows[0];
      return {
        totalSelections: row?.total_selections || 0,
        mlRecommendedCount: row?.ml_recommended_count || 0,
        providerSelectedCount: row?.provider_selected_count || 0,
        avgMlConfidence: row?.avg_ml_confidence || 0,
        linkedCarePlans: row?.linked_care_plans || 0
      };
    } catch (error) {
      console.error('Error getting node selection stats:', error);
      return {
        totalSelections: 0,
        mlRecommendedCount: 0,
        providerSelectedCount: 0,
        avgMlConfidence: 0,
        linkedCarePlans: 0
      };
    }
  }
}

// Pathway Node Outcome Service
class PathwayNodeOutcomeService {
  async getById(id: string): Promise<PathwayNodeOutcome | null> {
    ensureInitialized();

    const query = `
      SELECT id, node_id as "nodeId", label, description,
             medication_code as "medicationCode",
             procedure_code as "procedureCode",
             lab_code as "labCode",
             diagnosis_code as "diagnosisCode",
             outcome_factors as "outcomeFactors",
             sort_order as "sortOrder",
             created_at as "createdAt"
      FROM pathway_node_outcomes
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting pathway node outcome:', error);
      return null;
    }
  }

  async listByNode(nodeId: string): Promise<PathwayNodeOutcome[]> {
    ensureInitialized();

    const query = `
      SELECT id, node_id as "nodeId", label, description,
             medication_code as "medicationCode",
             procedure_code as "procedureCode",
             lab_code as "labCode",
             diagnosis_code as "diagnosisCode",
             outcome_factors as "outcomeFactors",
             sort_order as "sortOrder",
             created_at as "createdAt"
      FROM pathway_node_outcomes
      WHERE node_id = $1
      ORDER BY sort_order ASC
    `;

    try {
      const result = await pool.query(query, [nodeId]);
      return result.rows;
    } catch (error) {
      console.error('Error listing node outcomes:', error);
      return [];
    }
  }

  async create(input: {
    nodeId: string;
    label: string;
    description?: string;
    medicationCode?: string;
    procedureCode?: string;
    labCode?: string;
    diagnosisCode?: string;
    outcomeFactors?: Record<string, any>;
    sortOrder?: number;
  }): Promise<PathwayNodeOutcome> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO pathway_node_outcomes (
        id, node_id, label, description,
        medication_code, procedure_code, lab_code, diagnosis_code,
        outcome_factors, sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, node_id as "nodeId", label, description,
                medication_code as "medicationCode",
                procedure_code as "procedureCode",
                lab_code as "labCode",
                diagnosis_code as "diagnosisCode",
                outcome_factors as "outcomeFactors",
                sort_order as "sortOrder",
                created_at as "createdAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.nodeId,
        input.label,
        input.description || null,
        input.medicationCode || null,
        input.procedureCode || null,
        input.labCode || null,
        input.diagnosisCode || null,
        JSON.stringify(input.outcomeFactors || {}),
        input.sortOrder ?? 0
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error creating pathway node outcome:', error);
      throw error;
    }
  }

  async update(id: string, input: {
    label?: string;
    description?: string;
    medicationCode?: string;
    procedureCode?: string;
    labCode?: string;
    diagnosisCode?: string;
    outcomeFactors?: Record<string, any>;
    sortOrder?: number;
  }): Promise<PathwayNodeOutcome | null> {
    ensureInitialized();

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (input.label) {
      updates.push(`label = $${paramIndex}`);
      params.push(input.label);
      paramIndex++;
    }

    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(input.description);
      paramIndex++;
    }

    if (input.medicationCode !== undefined) {
      updates.push(`medication_code = $${paramIndex}`);
      params.push(input.medicationCode);
      paramIndex++;
    }

    if (input.procedureCode !== undefined) {
      updates.push(`procedure_code = $${paramIndex}`);
      params.push(input.procedureCode);
      paramIndex++;
    }

    if (input.labCode !== undefined) {
      updates.push(`lab_code = $${paramIndex}`);
      params.push(input.labCode);
      paramIndex++;
    }

    if (input.diagnosisCode !== undefined) {
      updates.push(`diagnosis_code = $${paramIndex}`);
      params.push(input.diagnosisCode);
      paramIndex++;
    }

    if (input.outcomeFactors !== undefined) {
      updates.push(`outcome_factors = $${paramIndex}`);
      params.push(JSON.stringify(input.outcomeFactors));
      paramIndex++;
    }

    if (input.sortOrder !== undefined) {
      updates.push(`sort_order = $${paramIndex}`);
      params.push(input.sortOrder);
      paramIndex++;
    }

    if (updates.length === 0) {
      return await this.getById(id);
    }

    params.push(id);

    const query = `
      UPDATE pathway_node_outcomes
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, node_id as "nodeId", label, description,
                medication_code as "medicationCode",
                procedure_code as "procedureCode",
                lab_code as "labCode",
                diagnosis_code as "diagnosisCode",
                outcome_factors as "outcomeFactors",
                sort_order as "sortOrder",
                created_at as "createdAt"
    `;

    try {
      const result = await pool.query(query, params);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error updating pathway node outcome:', error);
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    ensureInitialized();

    const query = `DELETE FROM pathway_node_outcomes WHERE id = $1`;

    try {
      const result = await pool.query(query, [id]);
      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting pathway node outcome:', error);
      return false;
    }
  }
}

// Patient Pathway Instance Service
class PatientPathwayInstanceService {
  async getById(id: string): Promise<PatientPathwayInstance | null> {
    ensureInitialized();

    const query = `
      SELECT id, patient_id as "patientId", provider_id as "providerId",
             pathway_id as "pathwayId", patient_context as "patientContext",
             ml_model_id as "mlModelId", ml_model_version as "mlModelVersion",
             ml_recommended_path as "mlRecommendedPath",
             ml_confidence_scores as "mlConfidenceScores",
             status, started_at as "startedAt", completed_at as "completedAt",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM patient_pathway_instances
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting patient pathway instance:', error);
      return null;
    }
  }

  async listByPatient(patientId: string): Promise<PatientPathwayInstance[]> {
    ensureInitialized();

    const query = `
      SELECT id, patient_id as "patientId", provider_id as "providerId",
             pathway_id as "pathwayId", patient_context as "patientContext",
             ml_model_id as "mlModelId", ml_model_version as "mlModelVersion",
             ml_recommended_path as "mlRecommendedPath",
             ml_confidence_scores as "mlConfidenceScores",
             status, started_at as "startedAt", completed_at as "completedAt",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM patient_pathway_instances
      WHERE patient_id = $1
      ORDER BY started_at DESC
    `;

    try {
      const result = await pool.query(query, [patientId]);
      return result.rows;
    } catch (error) {
      console.error('Error listing patient pathway instances:', error);
      return [];
    }
  }

  async list(
    filter: {
      patientId?: string;
      pathwayId?: string;
      status?: PathwayInstanceStatus;
      providerId?: string;
      startDateAfter?: Date;
      startDateBefore?: Date;
    },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ instances: PatientPathwayInstance[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50 } = pagination;

    let query = `
      SELECT id, patient_id as "patientId", provider_id as "providerId",
             pathway_id as "pathwayId", patient_context as "patientContext",
             ml_model_id as "mlModelId", ml_model_version as "mlModelVersion",
             ml_recommended_path as "mlRecommendedPath",
             ml_confidence_scores as "mlConfidenceScores",
             status, started_at as "startedAt", completed_at as "completedAt",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM patient_pathway_instances
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.patientId) {
      query += ` AND patient_id = $${paramIndex}`;
      params.push(filter.patientId);
      paramIndex++;
    }

    if (filter.pathwayId) {
      query += ` AND pathway_id = $${paramIndex}`;
      params.push(filter.pathwayId);
      paramIndex++;
    }

    if (filter.status) {
      query += ` AND status = $${paramIndex}`;
      params.push(filter.status);
      paramIndex++;
    }

    if (filter.providerId) {
      query += ` AND provider_id = $${paramIndex}`;
      params.push(filter.providerId);
      paramIndex++;
    }

    if (filter.startDateAfter) {
      query += ` AND started_at >= $${paramIndex}`;
      params.push(filter.startDateAfter);
      paramIndex++;
    }

    if (filter.startDateBefore) {
      query += ` AND started_at <= $${paramIndex}`;
      params.push(filter.startDateBefore);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT[\s\S]*?FROM/i, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];

    query += ` ORDER BY started_at DESC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const instances = result.rows.slice(0, first);
      const totalCount = parseInt(countResult.rows[0].count);

      return { instances, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error listing pathway instances:', error);
      return { instances: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async start(input: {
    patientId: string;
    pathwayId: string;
    providerId?: string;
    patientContext: Record<string, any>;
    mlModelId?: string;
  }): Promise<PatientPathwayInstance> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO patient_pathway_instances (
        id, patient_id, provider_id, pathway_id, patient_context, ml_model_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, patient_id as "patientId", provider_id as "providerId",
                pathway_id as "pathwayId", patient_context as "patientContext",
                ml_model_id as "mlModelId", ml_model_version as "mlModelVersion",
                ml_recommended_path as "mlRecommendedPath",
                ml_confidence_scores as "mlConfidenceScores",
                status, started_at as "startedAt", completed_at as "completedAt",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.patientId,
        input.providerId || null,
        input.pathwayId,
        JSON.stringify(input.patientContext),
        input.mlModelId || null
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error starting pathway instance:', error);
      throw error;
    }
  }

  async complete(id: string): Promise<PatientPathwayInstance | null> {
    ensureInitialized();

    const query = `
      UPDATE patient_pathway_instances
      SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING id, patient_id as "patientId", provider_id as "providerId",
                pathway_id as "pathwayId", patient_context as "patientContext",
                ml_model_id as "mlModelId", ml_model_version as "mlModelVersion",
                ml_recommended_path as "mlRecommendedPath",
                ml_confidence_scores as "mlConfidenceScores",
                status, started_at as "startedAt", completed_at as "completedAt",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error completing pathway instance:', error);
      return null;
    }
  }

  async abandon(id: string): Promise<PatientPathwayInstance | null> {
    ensureInitialized();

    const query = `
      UPDATE patient_pathway_instances
      SET status = 'ABANDONED', completed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING id, patient_id as "patientId", provider_id as "providerId",
                pathway_id as "pathwayId", patient_context as "patientContext",
                ml_model_id as "mlModelId", ml_model_version as "mlModelVersion",
                ml_recommended_path as "mlRecommendedPath",
                ml_confidence_scores as "mlConfidenceScores",
                status, started_at as "startedAt", completed_at as "completedAt",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error abandoning pathway instance:', error);
      return null;
    }
  }

  async setMlRecommendations(
    id: string,
    mlModelVersion: string,
    mlRecommendedPath: string[],
    mlConfidenceScores: Record<string, number>
  ): Promise<PatientPathwayInstance | null> {
    ensureInitialized();

    const query = `
      UPDATE patient_pathway_instances
      SET ml_model_version = $2,
          ml_recommended_path = $3,
          ml_confidence_scores = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, patient_id as "patientId", provider_id as "providerId",
                pathway_id as "pathwayId", patient_context as "patientContext",
                ml_model_id as "mlModelId", ml_model_version as "mlModelVersion",
                ml_recommended_path as "mlRecommendedPath",
                ml_confidence_scores as "mlConfidenceScores",
                status, started_at as "startedAt", completed_at as "completedAt",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        mlModelVersion,
        JSON.stringify(mlRecommendedPath),
        JSON.stringify(mlConfidenceScores)
      ]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error setting ML recommendations:', error);
      return null;
    }
  }
}

// Patient Pathway Selection Service
class PatientPathwaySelectionService {
  async getById(id: string): Promise<PatientPathwaySelection | null> {
    ensureInitialized();

    const query = `
      SELECT id, instance_id as "instanceId", node_id as "nodeId",
             selection_type as "selectionType", ml_confidence as "mlConfidence",
             ml_rank as "mlRank", override_reason as "overrideReason",
             resulting_care_plan_id as "resultingCarePlanId",
             selected_at as "selectedAt", selected_by as "selectedBy"
      FROM patient_pathway_selections
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting patient pathway selection:', error);
      return null;
    }
  }

  async listByInstance(instanceId: string): Promise<PatientPathwaySelection[]> {
    ensureInitialized();

    const query = `
      SELECT id, instance_id as "instanceId", node_id as "nodeId",
             selection_type as "selectionType", ml_confidence as "mlConfidence",
             ml_rank as "mlRank", override_reason as "overrideReason",
             resulting_care_plan_id as "resultingCarePlanId",
             selected_at as "selectedAt", selected_by as "selectedBy"
      FROM patient_pathway_selections
      WHERE instance_id = $1
      ORDER BY selected_at ASC
    `;

    try {
      const result = await pool.query(query, [instanceId]);
      return result.rows;
    } catch (error) {
      console.error('Error listing pathway selections:', error);
      return [];
    }
  }

  async record(input: {
    instanceId: string;
    nodeId: string;
    selectionType?: SelectionType;
    overrideReason?: string;
    resultingCarePlanId?: string;
  }, selectedBy?: string): Promise<PatientPathwaySelection> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO patient_pathway_selections (
        id, instance_id, node_id, selection_type, override_reason,
        resulting_care_plan_id, selected_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (instance_id, node_id) DO UPDATE SET
        selection_type = EXCLUDED.selection_type,
        override_reason = EXCLUDED.override_reason,
        resulting_care_plan_id = EXCLUDED.resulting_care_plan_id,
        selected_at = NOW()
      RETURNING id, instance_id as "instanceId", node_id as "nodeId",
                selection_type as "selectionType", ml_confidence as "mlConfidence",
                ml_rank as "mlRank", override_reason as "overrideReason",
                resulting_care_plan_id as "resultingCarePlanId",
                selected_at as "selectedAt", selected_by as "selectedBy"
    `;

    try {
      const result = await pool.query(query, [
        id,
        input.instanceId,
        input.nodeId,
        input.selectionType || SelectionType.ML_RECOMMENDED,
        input.overrideReason || null,
        input.resultingCarePlanId || null,
        selectedBy || null
      ]);

      return result.rows[0];
    } catch (error: any) {
      console.error('Error recording pathway selection:', error);
      throw error;
    }
  }

  async linkToCarePlan(id: string, carePlanId: string): Promise<PatientPathwaySelection | null> {
    ensureInitialized();

    const query = `
      UPDATE patient_pathway_selections
      SET resulting_care_plan_id = $2
      WHERE id = $1
      RETURNING id, instance_id as "instanceId", node_id as "nodeId",
                selection_type as "selectionType", ml_confidence as "mlConfidence",
                ml_rank as "mlRank", override_reason as "overrideReason",
                resulting_care_plan_id as "resultingCarePlanId",
                selected_at as "selectedAt", selected_by as "selectedBy"
    `;

    try {
      const result = await pool.query(query, [id, carePlanId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error linking selection to care plan:', error);
      return null;
    }
  }
}

// Export service instances
export const clinicalPathwayService = new ClinicalPathwayService();
export const pathwayNodeService = new PathwayNodeService();
export const pathwayNodeOutcomeService = new PathwayNodeOutcomeService();
export const patientPathwayInstanceService = new PatientPathwayInstanceService();
export const patientPathwaySelectionService = new PatientPathwaySelectionService();
