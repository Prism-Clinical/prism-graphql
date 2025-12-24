"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hospitalService = exports.institutionService = exports.InstitutionType = void 0;
exports.initializeDatabase = initializeDatabase;
var InstitutionType;
(function (InstitutionType) {
    InstitutionType["HOSPITAL_SYSTEM"] = "HOSPITAL_SYSTEM";
    InstitutionType["MEDICAL_CENTER"] = "MEDICAL_CENTER";
    InstitutionType["UNIVERSITY"] = "UNIVERSITY";
    InstitutionType["RESEARCH_INSTITUTE"] = "RESEARCH_INSTITUTE";
    InstitutionType["CLINIC_NETWORK"] = "CLINIC_NETWORK";
    InstitutionType["GOVERNMENT_AGENCY"] = "GOVERNMENT_AGENCY";
})(InstitutionType || (exports.InstitutionType = InstitutionType = {}));
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
class InstitutionService {
    async createInstitution(data) {
        ensureInitialized();
        const query = `
      INSERT INTO institutions (name, type, address, phone, email, website, accreditation, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, name, type, address, phone, email, website, accreditation, 
                active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
    `;
        try {
            const result = await pool.query(query, [
                data.name,
                data.type,
                JSON.stringify(data.address),
                data.phone,
                data.email || null,
                data.website || null,
                JSON.stringify(data.accreditation),
                true
            ]);
            const institution = result.rows[0];
            return {
                ...institution,
                address: typeof institution.address === 'string' ? JSON.parse(institution.address) : institution.address,
                accreditation: typeof institution.accreditation === 'string' ? JSON.parse(institution.accreditation) : institution.accreditation
            };
        }
        catch (error) {
            if (error.code === '23505' && error.constraint?.includes('name')) {
                throw new Error('Duplicate name: Institution with this name already exists');
            }
            throw error;
        }
    }
    async getInstitutionById(id) {
        ensureInitialized();
        const cacheKey = `institution:${id}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
        const query = `
      SELECT id, name, type, address, phone, email, website, accreditation,
             active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
      FROM institutions
      WHERE id = $1 AND active = true
    `;
        try {
            const result = await pool.query(query, [id]);
            const institution = result.rows[0] || null;
            if (institution) {
                institution.address = typeof institution.address === 'string' ? JSON.parse(institution.address) : institution.address;
                institution.accreditation = typeof institution.accreditation === 'string' ? JSON.parse(institution.accreditation) : institution.accreditation;
                await redis.setex(cacheKey, 600, JSON.stringify(institution));
            }
            return institution;
        }
        catch (error) {
            return null;
        }
    }
    async getInstitutions(options = {}) {
        ensureInitialized();
        const { type, limit = 50, offset = 0 } = options;
        const cacheKey = `institutions:all:${limit}:${offset}:${type || ''}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
        let query = `
      SELECT id, name, type, address, phone, email, website, accreditation,
             active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
      FROM institutions
      WHERE active = true
    `;
        const params = [];
        if (type) {
            query += ` AND type = $1`;
            params.push(type);
        }
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        try {
            const result = await pool.query(query, params);
            const institutions = result.rows.map(institution => ({
                ...institution,
                address: typeof institution.address === 'string' ? JSON.parse(institution.address) : institution.address,
                accreditation: typeof institution.accreditation === 'string' ? JSON.parse(institution.accreditation) : institution.accreditation
            }));
            await redis.setex(cacheKey, 300, JSON.stringify(institutions));
            return institutions;
        }
        catch (error) {
            return [];
        }
    }
    async updateInstitution(id, updates) {
        ensureInitialized();
        const allowedFields = ['name', 'type', 'address', 'phone', 'email', 'website', 'accreditation', 'isActive'];
        const updateFields = [];
        const values = [];
        Object.entries(updates).forEach(([key, value]) => {
            const dbKey = key === 'isActive' ? 'active' : key;
            if (allowedFields.includes(key) && value !== undefined) {
                if (key === 'address' || key === 'accreditation') {
                    updateFields.push(`${dbKey} = $${values.length + 1}`);
                    values.push(JSON.stringify(value));
                }
                else {
                    updateFields.push(`${dbKey} = $${values.length + 1}`);
                    values.push(value);
                }
            }
        });
        if (updateFields.length === 0) {
            return this.getInstitutionById(id);
        }
        const query = `
      UPDATE institutions 
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length + 1} AND active = true
      RETURNING id, name, type, address, phone, email, website, accreditation,
                active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
    `;
        values.push(id);
        try {
            const result = await pool.query(query, values);
            const institution = result.rows[0] || null;
            if (institution) {
                institution.address = typeof institution.address === 'string' ? JSON.parse(institution.address) : institution.address;
                institution.accreditation = typeof institution.accreditation === 'string' ? JSON.parse(institution.accreditation) : institution.accreditation;
                await redis.del(`institution:${id}`);
                await this.invalidateListCaches();
            }
            return institution;
        }
        catch (error) {
            return null;
        }
    }
    async deleteInstitution(id) {
        ensureInitialized();
        const query = `
      UPDATE institutions 
      SET active = false, updated_at = NOW()
      WHERE id = $1 AND active = true
    `;
        try {
            const result = await pool.query(query, [id]);
            const deleted = result.rowCount > 0;
            if (deleted) {
                await redis.del(`institution:${id}`);
                await this.invalidateListCaches();
            }
            return deleted;
        }
        catch (error) {
            return false;
        }
    }
    async invalidateListCaches() {
        try {
            const pattern = 'institutions:all:*';
            const keys = await redis.keys(pattern);
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        }
        catch (error) {
            console.warn('Cache invalidation failed:', error);
        }
    }
}
class HospitalService {
    async createHospital(data) {
        ensureInitialized();
        const institutionQuery = `SELECT id FROM institutions WHERE id = $1 AND active = true`;
        const institutionResult = await pool.query(institutionQuery, [data.institutionId]);
        if (institutionResult.rows.length === 0) {
            throw new Error('Foreign key constraint: Invalid institution reference');
        }
        const query = `
      INSERT INTO institutions (name, type, address, phone, email, website, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, address, phone, email, website, active as "isActive", 
                created_at as "createdAt", updated_at as "updatedAt"
    `;
        try {
            const result = await pool.query(query, [
                data.name,
                'hospital',
                JSON.stringify(data.address),
                data.phone,
                data.email || null,
                data.website || null,
                true
            ]);
            const hospital = result.rows[0];
            const metadataQuery = `
        UPDATE institutions 
        SET services = $1
        WHERE id = $2
      `;
            const hospitalMetadata = {
                institutionId: data.institutionId,
                beds: data.beds,
                departments: data.departments,
                emergencyServices: data.emergencyServices
            };
            await pool.query(metadataQuery, [JSON.stringify(hospitalMetadata), hospital.id]);
            return {
                id: hospital.id,
                name: hospital.name,
                institutionId: data.institutionId,
                address: typeof hospital.address === 'string' ? JSON.parse(hospital.address) : hospital.address,
                phone: hospital.phone,
                email: hospital.email,
                website: hospital.website,
                beds: data.beds,
                departments: data.departments,
                emergencyServices: data.emergencyServices,
                isActive: hospital.isActive,
                createdAt: hospital.createdAt,
                updatedAt: hospital.updatedAt
            };
        }
        catch (error) {
            if (error.message.includes('Invalid institution reference')) {
                throw error;
            }
            throw new Error('Failed to create hospital');
        }
    }
    async getHospitalById(id) {
        ensureInitialized();
        const cacheKey = `hospital:${id}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
        const query = `
      SELECT id, name, address, phone, email, website, services,
             active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
      FROM institutions
      WHERE id = $1 AND type = 'hospital' AND active = true
    `;
        try {
            const result = await pool.query(query, [id]);
            const row = result.rows[0];
            if (!row)
                return null;
            const services = row.services ? (typeof row.services === 'string' ? JSON.parse(row.services) : row.services) : {};
            const hospital = {
                id: row.id,
                name: row.name,
                institutionId: services.institutionId || '',
                address: typeof row.address === 'string' ? JSON.parse(row.address) : row.address,
                phone: row.phone,
                email: row.email,
                website: row.website,
                beds: services.beds,
                departments: services.departments || [],
                emergencyServices: services.emergencyServices || false,
                isActive: row.isActive,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt
            };
            await redis.setex(cacheKey, 600, JSON.stringify(hospital));
            return hospital;
        }
        catch (error) {
            return null;
        }
    }
    async getHospitalsByInstitution(institutionId) {
        ensureInitialized();
        const cacheKey = `hospitals:institution:${institutionId}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
        const query = `
      SELECT id, name, address, phone, email, website, services,
             active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
      FROM institutions
      WHERE type = 'hospital' AND active = true
      AND services->>'institutionId' = $1
      ORDER BY created_at DESC
    `;
        try {
            const result = await pool.query(query, [institutionId]);
            const hospitals = result.rows.map(row => {
                const services = row.services ? (typeof row.services === 'string' ? JSON.parse(row.services) : row.services) : {};
                return {
                    id: row.id,
                    name: row.name,
                    institutionId: services.institutionId || '',
                    address: typeof row.address === 'string' ? JSON.parse(row.address) : row.address,
                    phone: row.phone,
                    email: row.email,
                    website: row.website,
                    beds: services.beds,
                    departments: services.departments || [],
                    emergencyServices: services.emergencyServices || false,
                    isActive: row.isActive,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt
                };
            });
            await redis.setex(cacheKey, 300, JSON.stringify(hospitals));
            return hospitals;
        }
        catch (error) {
            return [];
        }
    }
    async updateHospital(id, updates) {
        ensureInitialized();
        const currentHospital = await this.getHospitalById(id);
        if (!currentHospital)
            return null;
        const institutionUpdates = {};
        const metadataUpdates = {};
        if (updates.name !== undefined)
            institutionUpdates.name = updates.name;
        if (updates.address !== undefined)
            institutionUpdates.address = JSON.stringify(updates.address);
        if (updates.phone !== undefined)
            institutionUpdates.phone = updates.phone;
        if (updates.email !== undefined)
            institutionUpdates.email = updates.email;
        if (updates.website !== undefined)
            institutionUpdates.website = updates.website;
        if (updates.isActive !== undefined)
            institutionUpdates.active = updates.isActive;
        if (updates.beds !== undefined)
            metadataUpdates.beds = updates.beds;
        if (updates.departments !== undefined)
            metadataUpdates.departments = updates.departments;
        if (updates.emergencyServices !== undefined)
            metadataUpdates.emergencyServices = updates.emergencyServices;
        try {
            if (Object.keys(institutionUpdates).length > 0) {
                const updateFields = Object.keys(institutionUpdates).map((key, i) => `${key} = $${i + 1}`);
                const values = Object.values(institutionUpdates);
                const query = `
          UPDATE institutions 
          SET ${updateFields.join(', ')}, updated_at = NOW()
          WHERE id = $${values.length + 1} AND type = 'hospital' AND active = true
        `;
                await pool.query(query, [...values, id]);
            }
            if (Object.keys(metadataUpdates).length > 0) {
                const currentServices = await pool.query('SELECT services FROM institutions WHERE id = $1', [id]);
                const services = currentServices.rows[0]?.services ?
                    (typeof currentServices.rows[0].services === 'string' ?
                        JSON.parse(currentServices.rows[0].services) :
                        currentServices.rows[0].services) : {};
                const updatedServices = { ...services, ...metadataUpdates };
                await pool.query('UPDATE institutions SET services = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(updatedServices), id]);
            }
            await redis.del(`hospital:${id}`);
            if (currentHospital.institutionId) {
                await redis.del(`hospitals:institution:${currentHospital.institutionId}`);
            }
            return await this.getHospitalById(id);
        }
        catch (error) {
            return null;
        }
    }
    async deleteHospital(id) {
        ensureInitialized();
        const hospital = await this.getHospitalById(id);
        const query = `
      UPDATE institutions 
      SET active = false, updated_at = NOW()
      WHERE id = $1 AND type = 'hospital' AND active = true
    `;
        try {
            const result = await pool.query(query, [id]);
            const deleted = result.rowCount > 0;
            if (deleted && hospital) {
                await redis.del(`hospital:${id}`);
                if (hospital.institutionId) {
                    await redis.del(`hospitals:institution:${hospital.institutionId}`);
                }
            }
            return deleted;
        }
        catch (error) {
            return false;
        }
    }
}
exports.institutionService = new InstitutionService();
exports.hospitalService = new HospitalService();
//# sourceMappingURL=database.js.map