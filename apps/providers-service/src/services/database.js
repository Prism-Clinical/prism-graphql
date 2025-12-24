"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visitService = exports.facilityService = exports.providerService = exports.VisitStatus = exports.VisitType = void 0;
exports.initializeDatabase = initializeDatabase;
var VisitType;
(function (VisitType) {
    VisitType["CONSULTATION"] = "CONSULTATION";
    VisitType["FOLLOW_UP"] = "FOLLOW_UP";
    VisitType["PROCEDURE"] = "PROCEDURE";
    VisitType["SURGERY"] = "SURGERY";
    VisitType["EMERGENCY"] = "EMERGENCY";
    VisitType["ROUTINE_CHECK"] = "ROUTINE_CHECK";
    VisitType["DIAGNOSTIC"] = "DIAGNOSTIC";
    VisitType["THERAPY"] = "THERAPY";
})(VisitType || (exports.VisitType = VisitType = {}));
var VisitStatus;
(function (VisitStatus) {
    VisitStatus["SCHEDULED"] = "SCHEDULED";
    VisitStatus["CHECKED_IN"] = "CHECKED_IN";
    VisitStatus["IN_PROGRESS"] = "IN_PROGRESS";
    VisitStatus["COMPLETED"] = "COMPLETED";
    VisitStatus["CANCELLED"] = "CANCELLED";
    VisitStatus["NO_SHOW"] = "NO_SHOW";
})(VisitStatus || (exports.VisitStatus = VisitStatus = {}));
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
class ProviderService {
    async createProvider(data) {
        ensureInitialized();
        const query = `
      INSERT INTO providers (npi, first_name, last_name, specialty, credentials, email, phone, facility_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, npi, first_name as "firstName", last_name as "lastName", 
                specialty, credentials, email, phone, facility_id as "facilityId",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
        try {
            const result = await pool.query(query, [
                data.npi,
                data.firstName,
                data.lastName,
                data.specialty,
                data.credentials,
                data.email,
                data.phone,
                data.facilityId || null
            ]);
            return result.rows[0];
        }
        catch (error) {
            if (error.code === '23505' && error.constraint?.includes('npi')) {
                throw new Error('Duplicate NPI: Provider with this NPI already exists');
            }
            throw error;
        }
    }
    async getProviderById(id) {
        ensureInitialized();
        const cacheKey = `provider:${id}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
        const query = `
      SELECT id, npi, first_name as "firstName", last_name as "lastName",
             specialty, credentials, email, phone, facility_id as "facilityId",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM providers
      WHERE id = $1
    `;
        try {
            const result = await pool.query(query, [id]);
            const provider = result.rows[0] || null;
            if (provider) {
                await redis.setex(cacheKey, 300, JSON.stringify(provider));
            }
            return provider;
        }
        catch (error) {
            return null;
        }
    }
    async getProviderByNpi(npi) {
        ensureInitialized();
        const cacheKey = `provider:npi:${npi}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
        const query = `
      SELECT id, npi, first_name as "firstName", last_name as "lastName",
             specialty, credentials, email, phone, facility_id as "facilityId",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM providers
      WHERE npi = $1
    `;
        try {
            const result = await pool.query(query, [npi]);
            const provider = result.rows[0] || null;
            if (provider) {
                await redis.setex(cacheKey, 300, JSON.stringify(provider));
            }
            return provider;
        }
        catch (error) {
            return null;
        }
    }
    async getProviders(options = {}) {
        ensureInitialized();
        const { specialty, limit = 50, offset = 0 } = options;
        const cacheKey = `providers:all:${limit}:${offset}:${specialty || ''}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
        let query = `
      SELECT id, npi, first_name as "firstName", last_name as "lastName",
             specialty, credentials, email, phone, facility_id as "facilityId",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM providers
    `;
        const params = [];
        if (specialty) {
            query += ` WHERE specialty ILIKE $1`;
            params.push(`%${specialty}%`);
        }
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        try {
            const result = await pool.query(query, params);
            const providers = result.rows;
            await redis.setex(cacheKey, 120, JSON.stringify(providers));
            return providers;
        }
        catch (error) {
            return [];
        }
    }
    async updateProvider(id, updates) {
        ensureInitialized();
        const allowedFields = ['firstName', 'lastName', 'specialty', 'credentials', 'email', 'phone', 'facilityId'];
        const updateFields = [];
        const values = [];
        Object.entries(updates).forEach(([key, value]) => {
            const dbKey = key === 'firstName' ? 'first_name' :
                key === 'lastName' ? 'last_name' :
                    key === 'facilityId' ? 'facility_id' : key;
            if (allowedFields.includes(key) && value !== undefined) {
                updateFields.push(`${dbKey} = $${values.length + 1}`);
                values.push(value);
            }
        });
        if (updateFields.length === 0) {
            return this.getProviderById(id);
        }
        const query = `
      UPDATE providers 
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length + 1}
      RETURNING id, npi, first_name as "firstName", last_name as "lastName",
                specialty, credentials, email, phone, facility_id as "facilityId",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
        values.push(id);
        try {
            const result = await pool.query(query, values);
            const provider = result.rows[0] || null;
            if (provider) {
                await redis.del(`provider:${id}`);
                if (provider.npi) {
                    await redis.del(`provider:npi:${provider.npi}`);
                }
            }
            return provider;
        }
        catch (error) {
            return null;
        }
    }
    async deleteProvider(id) {
        ensureInitialized();
        const query = `DELETE FROM providers WHERE id = $1`;
        try {
            const result = await pool.query(query, [id]);
            const deleted = result.rowCount > 0;
            if (deleted) {
                await redis.del(`provider:${id}`);
            }
            return deleted;
        }
        catch (error) {
            return false;
        }
    }
}
class FacilityService {
    async createFacility(data) {
        ensureInitialized();
        const query = `
      INSERT INTO institutions (name, address, phone, type)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, address, phone, created_at as "createdAt", updated_at as "updatedAt"
    `;
        const result = await pool.query(query, [
            data.name,
            JSON.stringify(data.address),
            data.phone,
            'facility'
        ]);
        const facility = result.rows[0];
        return {
            ...facility,
            address: typeof facility.address === 'string' ? JSON.parse(facility.address) : facility.address
        };
    }
    async getFacilityById(id) {
        ensureInitialized();
        const cacheKey = `facility:${id}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
        const query = `
      SELECT id, name, address, phone, created_at as "createdAt", updated_at as "updatedAt"
      FROM institutions
      WHERE id = $1 AND type = 'facility'
    `;
        try {
            const result = await pool.query(query, [id]);
            const facility = result.rows[0] || null;
            if (facility) {
                facility.address = typeof facility.address === 'string' ? JSON.parse(facility.address) : facility.address;
                await redis.setex(cacheKey, 600, JSON.stringify(facility));
            }
            return facility;
        }
        catch (error) {
            return null;
        }
    }
}
class VisitService {
    async createVisit(data) {
        ensureInitialized();
        const query = `
      INSERT INTO visits (patient_id, hospital_id, provider_id, case_ids, type, status, scheduled_at, chief_complaint)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, patient_id as "patientId", hospital_id as "hospitalId", provider_id as "providerId",
                case_ids as "caseIds", type, status, scheduled_at as "scheduledAt",
                started_at as "startedAt", completed_at as "completedAt", duration, notes,
                chief_complaint as "chiefComplaint", created_at as "createdAt", updated_at as "updatedAt"
    `;
        const result = await pool.query(query, [
            data.patientId,
            data.hospitalId,
            data.providerId,
            JSON.stringify(data.caseIds),
            data.type,
            VisitStatus.SCHEDULED,
            data.scheduledAt,
            data.chiefComplaint || null
        ]);
        const visit = result.rows[0];
        return {
            ...visit,
            caseIds: typeof visit.caseIds === 'string' ? JSON.parse(visit.caseIds) : visit.caseIds
        };
    }
    async getVisitById(id) {
        ensureInitialized();
        const query = `
      SELECT id, patient_id as "patientId", hospital_id as "hospitalId", provider_id as "providerId",
             case_ids as "caseIds", type, status, scheduled_at as "scheduledAt",
             started_at as "startedAt", completed_at as "completedAt", duration, notes,
             chief_complaint as "chiefComplaint", created_at as "createdAt", updated_at as "updatedAt"
      FROM visits
      WHERE id = $1
    `;
        try {
            const result = await pool.query(query, [id]);
            const visit = result.rows[0] || null;
            if (visit) {
                visit.caseIds = typeof visit.caseIds === 'string' ? JSON.parse(visit.caseIds) : visit.caseIds;
            }
            return visit;
        }
        catch (error) {
            return null;
        }
    }
    async getVisitsForProvider(providerId) {
        ensureInitialized();
        const query = `
      SELECT id, patient_id as "patientId", hospital_id as "hospitalId", provider_id as "providerId",
             case_ids as "caseIds", type, status, scheduled_at as "scheduledAt",
             started_at as "startedAt", completed_at as "completedAt", duration, notes,
             chief_complaint as "chiefComplaint", created_at as "createdAt", updated_at as "updatedAt"
      FROM visits
      WHERE provider_id = $1
      ORDER BY scheduled_at DESC
    `;
        try {
            const result = await pool.query(query, [providerId]);
            return result.rows.map(visit => ({
                ...visit,
                caseIds: typeof visit.caseIds === 'string' ? JSON.parse(visit.caseIds) : visit.caseIds
            }));
        }
        catch (error) {
            return [];
        }
    }
    async updateVisit(id, updates) {
        ensureInitialized();
        const allowedFields = ['type', 'status', 'scheduledAt', 'startedAt', 'completedAt', 'duration', 'notes', 'chiefComplaint'];
        const updateFields = [];
        const values = [];
        Object.entries(updates).forEach(([key, value]) => {
            const dbKey = key === 'scheduledAt' ? 'scheduled_at' :
                key === 'startedAt' ? 'started_at' :
                    key === 'completedAt' ? 'completed_at' :
                        key === 'chiefComplaint' ? 'chief_complaint' : key;
            if (allowedFields.includes(key) && value !== undefined) {
                updateFields.push(`${dbKey} = $${values.length + 1}`);
                values.push(value);
            }
        });
        if (updateFields.length === 0) {
            return this.getVisitById(id);
        }
        const query = `
      UPDATE visits 
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length + 1}
      RETURNING id, patient_id as "patientId", hospital_id as "hospitalId", provider_id as "providerId",
                case_ids as "caseIds", type, status, scheduled_at as "scheduledAt",
                started_at as "startedAt", completed_at as "completedAt", duration, notes,
                chief_complaint as "chiefComplaint", created_at as "createdAt", updated_at as "updatedAt"
    `;
        values.push(id);
        try {
            const result = await pool.query(query, values);
            const visit = result.rows[0] || null;
            if (visit) {
                visit.caseIds = typeof visit.caseIds === 'string' ? JSON.parse(visit.caseIds) : visit.caseIds;
            }
            return visit;
        }
        catch (error) {
            return null;
        }
    }
}
exports.providerService = new ProviderService();
exports.facilityService = new FacilityService();
exports.visitService = new VisitService();
//# sourceMappingURL=database.js.map