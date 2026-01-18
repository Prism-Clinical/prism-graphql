import { Pool } from 'pg';
import { Redis } from 'ioredis';

// Types
export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT'
}

export enum RecommendationStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export interface Recommendation {
  id: string;
  patientId: string;
  providerId: string;
  title: string;
  description: string;
  priority: Priority;
  status: RecommendationStatus;
  createdAt: Date;
  updatedAt: Date;
}

// Database connection - these will be injected
let pool: Pool;
let redis: Redis;

export function initializeDatabase(dbPool: Pool, redisClient: Redis) {
  pool = dbPool;
  redis = redisClient;
}

// Helper function to ensure database is initialized
function ensureInitialized() {
  if (!pool || !redis) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
}

// Recommendation Service
class RecommendationService {
  async createRecommendation(data: Omit<Recommendation, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Recommendation> {
    ensureInitialized();
    const query = `
      INSERT INTO recommendations (patient_id, provider_id, title, description, priority, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, patient_id as "patientId", provider_id as "providerId", title, description, 
                priority, status, created_at as "createdAt", updated_at as "updatedAt"
    `;
    
    try {
      const result = await pool.query(query, [
        data.patientId,
        data.providerId,
        data.title,
        data.description,
        data.priority,
        RecommendationStatus.DRAFT
      ]);
      
      return result.rows[0];
    } catch (error: any) {
      if (error.code === '23503') {
        if (error.constraint?.includes('case')) {
          throw new Error('Foreign key constraint: Invalid case reference');
        }
        if (error.constraint?.includes('provider')) {
          throw new Error('Foreign key constraint: Invalid provider reference');
        }
      }
      throw error;
    }
  }

  async getRecommendationById(id: string): Promise<Recommendation | null> {
    ensureInitialized();
    // Check cache first
    const cacheKey = `recommendation:${id}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      SELECT id, case_id as "caseId", provider_id as "providerId", title, description,
             priority, status, created_at as "createdAt", updated_at as "updatedAt"
      FROM recommendations
      WHERE id = $1
    `;
    
    try {
      const result = await pool.query(query, [id]);
      const recommendation = result.rows[0] || null;
      
      if (recommendation) {
        // Cache for 5 minutes
        await redis.setex(cacheKey, 300, JSON.stringify(recommendation));
      }
      
      return recommendation;
    } catch (error) {
      return null;
    }
  }

  async getRecommendationsForPatient(
    patientId: string, 
    options: { status?: RecommendationStatus; limit?: number; offset?: number } = {}
  ): Promise<Recommendation[]> {
    ensureInitialized();
    const { status, limit = 50, offset = 0 } = options;
    
    // Check cache for simple queries
    const cacheKey = `recommendations:patient:${patientId}:${status || 'all'}`;
    const cached = await redis.get(cacheKey);
    if (cached && limit === 50 && offset === 0) {
      return JSON.parse(cached);
    }

    let query = `
      SELECT id, patient_id as "patientId", provider_id as "providerId", title, description,
             priority, status, created_at as "createdAt", updated_at as "updatedAt"
      FROM recommendations
      WHERE patient_id = $1
    `;

    const params: any[] = [patientId];
    
    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    try {
      const result = await pool.query(query, params);
      const recommendations = result.rows;
      
      // Cache for 2 minutes if simple query
      if (limit === 50 && offset === 0) {
        await redis.setex(cacheKey, 120, JSON.stringify(recommendations));
      }
      
      return recommendations;
    } catch (error) {
      return [];
    }
  }

  async getRecommendationsByProvider(
    providerId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<Recommendation[]> {
    ensureInitialized();
    const { limit = 50, offset = 0 } = options;
    
    // Check cache for simple queries
    const cacheKey = `recommendations:provider:${providerId}:${limit}:${offset}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      SELECT id, case_id as "caseId", provider_id as "providerId", title, description,
             priority, status, created_at as "createdAt", updated_at as "updatedAt"
      FROM recommendations
      WHERE provider_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    try {
      const result = await pool.query(query, [providerId, limit, offset]);
      const recommendations = result.rows;
      
      // Cache for 2 minutes
      await redis.setex(cacheKey, 120, JSON.stringify(recommendations));
      
      return recommendations;
    } catch (error) {
      return [];
    }
  }

  async updateRecommendationStatus(id: string, status: RecommendationStatus): Promise<Recommendation | null> {
    ensureInitialized();
    const query = `
      UPDATE recommendations 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, case_id as "caseId", provider_id as "providerId", title, description,
                priority, status, created_at as "createdAt", updated_at as "updatedAt"
    `;
    
    try {
      const result = await pool.query(query, [status, id]);
      const recommendation = result.rows[0] || null;
      
      if (recommendation) {
        // Invalidate cache
        await redis.del(`recommendation:${id}`);
        // Also invalidate patient and provider caches
        await this.invalidateRelatedCaches(recommendation.patientId, recommendation.providerId);
      }
      
      return recommendation;
    } catch (error) {
      return null;
    }
  }

  async updateRecommendation(id: string, updates: Partial<Omit<Recommendation, 'id' | 'caseId' | 'providerId' | 'createdAt' | 'updatedAt'>>): Promise<Recommendation | null> {
    ensureInitialized();
    const allowedFields = ['title', 'description', 'priority', 'status'];
    const updateFields: string[] = [];
    const values: any[] = [];
    
    Object.entries(updates).forEach(([key, value]) => {
      if (allowedFields.includes(key) && value !== undefined) {
        updateFields.push(`${key} = $${values.length + 1}`);
        values.push(value);
      }
    });
    
    if (updateFields.length === 0) {
      return this.getRecommendationById(id);
    }
    
    const query = `
      UPDATE recommendations 
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length + 1}
      RETURNING id, case_id as "caseId", provider_id as "providerId", title, description,
                priority, status, created_at as "createdAt", updated_at as "updatedAt"
    `;
    
    values.push(id);
    
    try {
      const result = await pool.query(query, values);
      const recommendation = result.rows[0] || null;
      
      if (recommendation) {
        // Invalidate cache
        await redis.del(`recommendation:${id}`);
        await this.invalidateRelatedCaches(recommendation.patientId, recommendation.providerId);
      }
      
      return recommendation;
    } catch (error) {
      return null;
    }
  }

  async deleteRecommendation(id: string): Promise<boolean> {
    ensureInitialized();
    // Get recommendation first to know which caches to invalidate
    const recommendation = await this.getRecommendationById(id);
    
    const query = `DELETE FROM recommendations WHERE id = $1`;
    
    try {
      const result = await pool.query(query, [id]);
      const deleted = result.rowCount > 0;
      
      if (deleted && recommendation) {
        // Invalidate cache
        await redis.del(`recommendation:${id}`);
        await this.invalidateRelatedCaches(recommendation.patientId, recommendation.providerId);
      }
      
      return deleted;
    } catch (error) {
      return false;
    }
  }

  private async invalidateRelatedCaches(caseId: string, providerId: string): Promise<void> {
    // Use pattern matching to delete related caches
    const casePattern = `recommendations:case:${caseId}:*`;
    const providerPattern = `recommendations:provider:${providerId}:*`;
    
    try {
      // Get all keys matching the patterns
      const caseKeys = await redis.keys(casePattern);
      const providerKeys = await redis.keys(providerPattern);
      
      // Delete all matching keys
      if (caseKeys.length > 0) {
        await redis.del(...caseKeys);
      }
      if (providerKeys.length > 0) {
        await redis.del(...providerKeys);
      }
    } catch (error) {
      // Cache invalidation failure shouldn't break the operation
      console.warn('Cache invalidation failed:', error);
    }
  }
}

// Export service instance
export const recommendationService = new RecommendationService();