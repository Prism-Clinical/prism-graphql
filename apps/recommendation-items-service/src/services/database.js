"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recommendationItemService = exports.RecommendationItemService = void 0;
exports.initializeDatabase = initializeDatabase;
let pool;
let redis;
function initializeDatabase(dbPool, redisClient) {
    pool = dbPool;
    redis = redisClient;
}
function mapDbRowToRecommendationItem(row) {
    return {
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        instructions: row.instructions,
        evidenceLevel: row.evidence_level,
        studyReferences: row.study_references || [],
        guidelines: row.guidelines || [],
        contraindications: row.contraindications || [],
        sideEffects: row.side_effects || [],
        category: row.category,
        isActive: row.is_active
    };
}
function mapRecommendationItemToDbRow(item) {
    return {
        type: item.type,
        title: item.title,
        description: item.description,
        instructions: item.instructions,
        evidence_level: item.evidenceLevel,
        study_references: item.studyReferences,
        guidelines: item.guidelines,
        contraindications: item.contraindications,
        side_effects: item.sideEffects,
        category: item.category,
        is_active: item.isActive
    };
}
class RecommendationItemService {
    async getRecommendationItem(id) {
        const cacheKey = `recommendation_item:${id}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        }
        catch (error) {
            console.warn('Redis error in getRecommendationItem:', error);
        }
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT * FROM recommendation_items WHERE id = $1 AND is_active = true', [id]);
            if (result.rows.length === 0) {
                return null;
            }
            const item = mapDbRowToRecommendationItem(result.rows[0]);
            try {
                await redis.setex(cacheKey, 3600, JSON.stringify(item));
            }
            catch (error) {
                console.warn('Redis error in getRecommendationItem cache set:', error);
            }
            return item;
        }
        finally {
            client.release();
        }
    }
    async getAllRecommendationItems() {
        const cacheKey = 'recommendation_items:all';
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        }
        catch (error) {
            console.warn('Redis error in getAllRecommendationItems:', error);
        }
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT * FROM recommendation_items WHERE is_active = true ORDER BY category, title');
            const items = result.rows.map(mapDbRowToRecommendationItem);
            try {
                await redis.setex(cacheKey, 3600, JSON.stringify(items));
            }
            catch (error) {
                console.warn('Redis error in getAllRecommendationItems cache set:', error);
            }
            return items;
        }
        finally {
            client.release();
        }
    }
    async getRecommendationItemsByType(type) {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT * FROM recommendation_items WHERE type = $1 AND is_active = true ORDER BY title', [type]);
            return result.rows.map(mapDbRowToRecommendationItem);
        }
        finally {
            client.release();
        }
    }
    async getRecommendationItemsByCategory(category) {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT * FROM recommendation_items WHERE category = $1 AND is_active = true ORDER BY title', [category]);
            return result.rows.map(mapDbRowToRecommendationItem);
        }
        finally {
            client.release();
        }
    }
    async getRecommendationItemsByEvidenceLevel(evidenceLevel) {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT * FROM recommendation_items WHERE evidence_level = $1 AND is_active = true ORDER BY title', [evidenceLevel]);
            return result.rows.map(mapDbRowToRecommendationItem);
        }
        finally {
            client.release();
        }
    }
    async searchRecommendationItems(searchTerm) {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT * FROM recommendation_items WHERE (title ILIKE $1 OR description ILIKE $1) AND is_active = true ORDER BY title', [`%${searchTerm}%`]);
            return result.rows.map(mapDbRowToRecommendationItem);
        }
        finally {
            client.release();
        }
    }
    async createRecommendationItem(data) {
        const client = await pool.connect();
        try {
            const result = await client.query(`INSERT INTO recommendation_items 
         (type, title, description, instructions, evidence_level, study_references, guidelines, contraindications, side_effects, category, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
         RETURNING *`, [
                data.type,
                data.title,
                data.description,
                data.instructions,
                data.evidenceLevel,
                data.studyReferences,
                data.guidelines,
                data.contraindications,
                data.sideEffects,
                data.category
            ]);
            const item = mapDbRowToRecommendationItem(result.rows[0]);
            try {
                await redis.del('recommendation_items:all');
            }
            catch (error) {
                console.warn('Redis error in createRecommendationItem cache invalidation:', error);
            }
            return item;
        }
        finally {
            client.release();
        }
    }
    async updateRecommendationItem(id, data) {
        const client = await pool.connect();
        try {
            const updateFields = [];
            const values = [];
            let paramCount = 1;
            if (data.type !== undefined) {
                updateFields.push(`type = $${paramCount++}`);
                values.push(data.type);
            }
            if (data.title !== undefined) {
                updateFields.push(`title = $${paramCount++}`);
                values.push(data.title);
            }
            if (data.description !== undefined) {
                updateFields.push(`description = $${paramCount++}`);
                values.push(data.description);
            }
            if (data.instructions !== undefined) {
                updateFields.push(`instructions = $${paramCount++}`);
                values.push(data.instructions);
            }
            if (data.evidenceLevel !== undefined) {
                updateFields.push(`evidence_level = $${paramCount++}`);
                values.push(data.evidenceLevel);
            }
            if (data.studyReferences !== undefined) {
                updateFields.push(`study_references = $${paramCount++}`);
                values.push(data.studyReferences);
            }
            if (data.guidelines !== undefined) {
                updateFields.push(`guidelines = $${paramCount++}`);
                values.push(data.guidelines);
            }
            if (data.contraindications !== undefined) {
                updateFields.push(`contraindications = $${paramCount++}`);
                values.push(data.contraindications);
            }
            if (data.sideEffects !== undefined) {
                updateFields.push(`side_effects = $${paramCount++}`);
                values.push(data.sideEffects);
            }
            if (data.category !== undefined) {
                updateFields.push(`category = $${paramCount++}`);
                values.push(data.category);
            }
            if (data.isActive !== undefined) {
                updateFields.push(`is_active = $${paramCount++}`);
                values.push(data.isActive);
            }
            if (updateFields.length === 0) {
                return this.getRecommendationItem(id);
            }
            values.push(id);
            const query = `
        UPDATE recommendation_items 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramCount} AND is_active = true
        RETURNING *
      `;
            const result = await client.query(query, values);
            if (result.rows.length === 0) {
                return null;
            }
            const item = mapDbRowToRecommendationItem(result.rows[0]);
            try {
                await redis.del(`recommendation_item:${id}`);
                await redis.del('recommendation_items:all');
            }
            catch (error) {
                console.warn('Redis error in updateRecommendationItem cache invalidation:', error);
            }
            return item;
        }
        finally {
            client.release();
        }
    }
    async deleteRecommendationItem(id) {
        const client = await pool.connect();
        try {
            const result = await client.query('UPDATE recommendation_items SET is_active = false WHERE id = $1', [id]);
            try {
                await redis.del(`recommendation_item:${id}`);
                await redis.del('recommendation_items:all');
            }
            catch (error) {
                console.warn('Redis error in deleteRecommendationItem cache invalidation:', error);
            }
            return result.rowCount > 0;
        }
        finally {
            client.release();
        }
    }
}
exports.RecommendationItemService = RecommendationItemService;
exports.recommendationItemService = new RecommendationItemService();
//# sourceMappingURL=database.js.map