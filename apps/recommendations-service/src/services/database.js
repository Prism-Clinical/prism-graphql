"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recommendationService = exports.RecommendationStatus = exports.Priority = void 0;
exports.initializeDatabase = initializeDatabase;
var Priority;
(function (Priority) {
    Priority["LOW"] = "LOW";
    Priority["MEDIUM"] = "MEDIUM";
    Priority["HIGH"] = "HIGH";
    Priority["URGENT"] = "URGENT";
})(Priority || (exports.Priority = Priority = {}));
var RecommendationStatus;
(function (RecommendationStatus) {
    RecommendationStatus["DRAFT"] = "DRAFT";
    RecommendationStatus["ACTIVE"] = "ACTIVE";
    RecommendationStatus["COMPLETED"] = "COMPLETED";
    RecommendationStatus["CANCELLED"] = "CANCELLED";
})(RecommendationStatus || (exports.RecommendationStatus = RecommendationStatus = {}));
let pool;
let redis;
function initializeDatabase(dbPool, redisClient) {
    pool = dbPool;
    redis = redisClient;
}
function ensureInitialized() {
    if (!pool || !redis) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
}
class RecommendationService {
    async createRecommendation(data) {
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
        }
        catch (error) {
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
    async getRecommendationById(id) {
        ensureInitialized();
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
                await redis.setex(cacheKey, 300, JSON.stringify(recommendation));
            }
            return recommendation;
        }
        catch (error) {
            return null;
        }
    }
    async getRecommendationsForPatient(patientId, options = {}) {
        ensureInitialized();
        const { status, limit = 50, offset = 0 } = options;
        const cacheKey = `recommendations:case:${caseId}:${status || 'all'}`;
        const cached = await redis.get(cacheKey);
        if (cached && limit === 50 && offset === 0) {
            return JSON.parse(cached);
        }
        let query = `
      SELECT id, case_id as "caseId", provider_id as "providerId", title, description,
             priority, status, created_at as "createdAt", updated_at as "updatedAt"
      FROM recommendations
      WHERE case_id = $1
    `;
        const params = [caseId];
        if (status) {
            query += ` AND status = $2`;
            params.push(status);
        }
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        try {
            const result = await pool.query(query, params);
            const recommendations = result.rows;
            if (limit === 50 && offset === 0) {
                await redis.setex(cacheKey, 120, JSON.stringify(recommendations));
            }
            return recommendations;
        }
        catch (error) {
            return [];
        }
    }
    async getRecommendationsByProvider(providerId, options = {}) {
        ensureInitialized();
        const { limit = 50, offset = 0 } = options;
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
            await redis.setex(cacheKey, 120, JSON.stringify(recommendations));
            return recommendations;
        }
        catch (error) {
            return [];
        }
    }
    async updateRecommendationStatus(id, status) {
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
                await redis.del(`recommendation:${id}`);
                await this.invalidateRelatedCaches(recommendation.patientId, recommendation.providerId);
            }
            return recommendation;
        }
        catch (error) {
            return null;
        }
    }
    async updateRecommendation(id, updates) {
        ensureInitialized();
        const allowedFields = ['title', 'description', 'priority', 'status'];
        const updateFields = [];
        const values = [];
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
                await redis.del(`recommendation:${id}`);
                await this.invalidateRelatedCaches(recommendation.patientId, recommendation.providerId);
            }
            return recommendation;
        }
        catch (error) {
            return null;
        }
    }
    async deleteRecommendation(id) {
        ensureInitialized();
        const recommendation = await this.getRecommendationById(id);
        const query = `DELETE FROM recommendations WHERE id = $1`;
        try {
            const result = await pool.query(query, [id]);
            const deleted = result.rowCount > 0;
            if (deleted && recommendation) {
                await redis.del(`recommendation:${id}`);
                await this.invalidateRelatedCaches(recommendation.patientId, recommendation.providerId);
            }
            return deleted;
        }
        catch (error) {
            return false;
        }
    }
    async invalidateRelatedCaches(caseId, providerId) {
        const casePattern = `recommendations:case:${caseId}:*`;
        const providerPattern = `recommendations:provider:${providerId}:*`;
        try {
            const caseKeys = await redis.keys(casePattern);
            const providerKeys = await redis.keys(providerPattern);
            if (caseKeys.length > 0) {
                await redis.del(...caseKeys);
            }
            if (providerKeys.length > 0) {
                await redis.del(...providerKeys);
            }
        }
        catch (error) {
            console.warn('Cache invalidation failed:', error);
        }
    }
}
exports.recommendationService = new RecommendationService();
//# sourceMappingURL=database.js.map