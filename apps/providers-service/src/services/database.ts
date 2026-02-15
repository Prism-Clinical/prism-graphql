import { Pool } from 'pg';
import { Redis } from 'ioredis';

// Types
export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface Provider {
  id: string;
  npi: string;
  firstName: string;
  lastName: string;
  specialty: string;
  credentials: string;
  email: string;
  phone: string;
  facilityId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Facility {
  id: string;
  name: string;
  address: Address;
  phone: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum VisitType {
  CONSULTATION = 'CONSULTATION',
  FOLLOW_UP = 'FOLLOW_UP',
  PROCEDURE = 'PROCEDURE',
  SURGERY = 'SURGERY',
  EMERGENCY = 'EMERGENCY',
  ROUTINE_CHECK = 'ROUTINE_CHECK',
  DIAGNOSTIC = 'DIAGNOSTIC',
  THERAPY = 'THERAPY'
}

export enum VisitStatus {
  SCHEDULED = 'SCHEDULED',
  CHECKED_IN = 'CHECKED_IN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW'
}

export interface Visit {
  id: string;
  patientId: string;
  hospitalId: string;
  providerId: string;
  caseIds: string[];
  type: VisitType;
  status: VisitStatus;
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  notes?: string;
  chiefComplaint?: string;
  recordingKey?: string;
  recordingEndedAt?: Date;
  conditionCodes?: string[];
  carePlanRequestId?: string;
  carePlanRequestedAt?: Date;
  audioUri?: string;
  audioUploadedAt?: Date;
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

// Provider Service
class ProviderService {
  async createProvider(data: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>): Promise<Provider> {
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
    } catch (error: any) {
      if (error.code === '23505' && error.constraint?.includes('npi')) {
        throw new Error('Duplicate NPI: Provider with this NPI already exists');
      }
      throw error;
    }
  }

  async getProviderById(id: string): Promise<Provider | null> {
    ensureInitialized();
    // Check cache first
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
        // Cache for 5 minutes
        await redis.setex(cacheKey, 300, JSON.stringify(provider));
      }
      
      return provider;
    } catch (error) {
      return null;
    }
  }

  async getProviderByNpi(npi: string): Promise<Provider | null> {
    ensureInitialized();
    // Check cache first
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
        // Cache for 5 minutes
        await redis.setex(cacheKey, 300, JSON.stringify(provider));
      }
      
      return provider;
    } catch (error) {
      return null;
    }
  }

  async getProviders(options: {
    specialty?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Provider[]> {
    ensureInitialized();
    const { specialty, limit = 50, offset = 0 } = options;
    
    // Check cache for simple queries
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
    
    const params: any[] = [];
    
    if (specialty) {
      query += ` WHERE specialty ILIKE $1`;
      params.push(`%${specialty}%`);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    try {
      const result = await pool.query(query, params);
      const providers = result.rows;
      
      // Cache for 2 minutes
      await redis.setex(cacheKey, 120, JSON.stringify(providers));
      
      return providers;
    } catch (error) {
      return [];
    }
  }

  async updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Provider | null> {
    ensureInitialized();
    const allowedFields = ['firstName', 'lastName', 'specialty', 'credentials', 'email', 'phone', 'facilityId'];
    const updateFields: string[] = [];
    const values: any[] = [];
    
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
        // Invalidate cache
        await redis.del(`provider:${id}`);
        if (provider.npi) {
          await redis.del(`provider:npi:${provider.npi}`);
        }
      }
      
      return provider;
    } catch (error) {
      return null;
    }
  }

  async deleteProvider(id: string): Promise<boolean> {
    ensureInitialized();
    const query = `DELETE FROM providers WHERE id = $1`;
    
    try {
      const result = await pool.query(query, [id]);
      const deleted = result.rowCount > 0;
      
      if (deleted) {
        // Invalidate cache
        await redis.del(`provider:${id}`);
      }
      
      return deleted;
    } catch (error) {
      return false;
    }
  }
}

// Facility Service
class FacilityService {
  async createFacility(data: Omit<Facility, 'id' | 'createdAt' | 'updatedAt'>): Promise<Facility> {
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

  async getFacilityById(id: string): Promise<Facility | null> {
    ensureInitialized();
    // Check cache first
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
        // Cache for 10 minutes
        await redis.setex(cacheKey, 600, JSON.stringify(facility));
      }
      
      return facility;
    } catch (error) {
      return null;
    }
  }
}

// Visit Service
class VisitService {
  async createVisit(data: Omit<Visit, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Visit> {
    ensureInitialized();
    const query = `
      INSERT INTO visits (patient_id, hospital_id, provider_id, case_ids, type, status, scheduled_at, chief_complaint)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, patient_id as "patientId", hospital_id as "hospitalId", provider_id as "providerId",
                case_ids as "caseIds", type, status, scheduled_at as "scheduledAt",
                started_at as "startedAt", completed_at as "completedAt", duration, notes,
                chief_complaint as "chiefComplaint", audio_uri as "audioUri",
                audio_uploaded_at as "audioUploadedAt",
                created_at as "createdAt", updated_at as "updatedAt"
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

  async getVisitById(id: string): Promise<Visit | null> {
    ensureInitialized();
    const query = `
      SELECT id, patient_id as "patientId", hospital_id as "hospitalId", provider_id as "providerId",
             case_ids as "caseIds", type, status, scheduled_at as "scheduledAt",
             started_at as "startedAt", completed_at as "completedAt", duration, notes,
             chief_complaint as "chiefComplaint", audio_uri as "audioUri",
             audio_uploaded_at as "audioUploadedAt",
             created_at as "createdAt", updated_at as "updatedAt"
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
    } catch (error) {
      return null;
    }
  }

  async getVisitsForProvider(providerId: string): Promise<Visit[]> {
    ensureInitialized();
    const query = `
      SELECT id, patient_id as "patientId", hospital_id as "hospitalId", provider_id as "providerId",
             case_ids as "caseIds", type, status, scheduled_at as "scheduledAt",
             started_at as "startedAt", completed_at as "completedAt", duration, notes,
             chief_complaint as "chiefComplaint", audio_uri as "audioUri",
             audio_uploaded_at as "audioUploadedAt",
             created_at as "createdAt", updated_at as "updatedAt"
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
    } catch (error) {
      return [];
    }
  }

  async updateVisit(id: string, updates: Partial<Omit<Visit, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Visit | null> {
    ensureInitialized();
    const allowedFields = ['type', 'status', 'scheduledAt', 'startedAt', 'completedAt', 'duration', 'notes', 'chiefComplaint', 'recordingKey', 'recordingEndedAt', 'conditionCodes', 'carePlanRequestId', 'carePlanRequestedAt', 'audioUri', 'audioUploadedAt'];
    const updateFields: string[] = [];
    const values: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      const dbKey = key === 'scheduledAt' ? 'scheduled_at' :
                   key === 'startedAt' ? 'started_at' :
                   key === 'completedAt' ? 'completed_at' :
                   key === 'chiefComplaint' ? 'chief_complaint' :
                   key === 'recordingKey' ? 'recording_key' :
                   key === 'recordingEndedAt' ? 'recording_ended_at' :
                   key === 'conditionCodes' ? 'condition_codes' :
                   key === 'carePlanRequestId' ? 'care_plan_request_id' :
                   key === 'carePlanRequestedAt' ? 'care_plan_requested_at' :
                   key === 'audioUri' ? 'audio_uri' :
                   key === 'audioUploadedAt' ? 'audio_uploaded_at' : key;
      
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
                chief_complaint as "chiefComplaint", audio_uri as "audioUri",
                audio_uploaded_at as "audioUploadedAt",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    
    values.push(id);

    try {
      const result = await pool.query(query, values);
      const visit = result.rows[0] || null;

      if (visit) {
        visit.caseIds = typeof visit.caseIds === 'string' ? JSON.parse(visit.caseIds) : visit.caseIds;
      }

      return visit;
    } catch (error) {
      return null;
    }
  }

  async updateVisitAudioUri(id: string, audioUri: string): Promise<Visit | null> {
    if (!audioUri.startsWith('gs://')) {
      throw new Error('Invalid audio URI: must be a GCS path starting with gs://');
    }
    return this.updateVisit(id, {
      audioUri,
      audioUploadedAt: new Date(),
    });
  }

  async updateVisitStatus(id: string, status: VisitStatus | string): Promise<Visit | null> {
    return this.updateVisit(id, { status: status as VisitStatus });
  }

  async completeVisit(id: string, data: { notes?: string; completedAt: Date; completedBy: string }): Promise<Visit | null> {
    return this.updateVisit(id, {
      status: VisitStatus.COMPLETED,
      completedAt: data.completedAt,
      notes: data.notes,
    });
  }

  async getVisitsForProviderOnDate(providerId: string, date: Date): Promise<Visit[]> {
    ensureInitialized();
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const query = `
      SELECT id, patient_id as "patientId", hospital_id as "hospitalId", provider_id as "providerId",
             case_ids as "caseIds", type, status, scheduled_at as "scheduledAt",
             started_at as "startedAt", completed_at as "completedAt", duration, notes,
             chief_complaint as "chiefComplaint", recording_key as "recordingKey",
             recording_ended_at as "recordingEndedAt", condition_codes as "conditionCodes",
             care_plan_request_id as "carePlanRequestId", care_plan_requested_at as "carePlanRequestedAt",
             audio_uri as "audioUri", audio_uploaded_at as "audioUploadedAt",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM visits
      WHERE provider_id = $1 AND scheduled_at >= $2 AND scheduled_at <= $3
      ORDER BY scheduled_at ASC
    `;

    try {
      const result = await pool.query(query, [providerId, startOfDay, endOfDay]);
      return result.rows.map(visit => ({
        ...visit,
        caseIds: typeof visit.caseIds === 'string' ? JSON.parse(visit.caseIds) : visit.caseIds,
        conditionCodes: typeof visit.conditionCodes === 'string' ? JSON.parse(visit.conditionCodes) : visit.conditionCodes,
      }));
    } catch (error) {
      return [];
    }
  }

  async getVisitsForProviderInRange(providerId: string, startDate: Date, endDate: Date, status?: string): Promise<Visit[]> {
    ensureInitialized();
    let query = `
      SELECT id, patient_id as "patientId", hospital_id as "hospitalId", provider_id as "providerId",
             case_ids as "caseIds", type, status, scheduled_at as "scheduledAt",
             started_at as "startedAt", completed_at as "completedAt", duration, notes,
             chief_complaint as "chiefComplaint", recording_key as "recordingKey",
             recording_ended_at as "recordingEndedAt", condition_codes as "conditionCodes",
             care_plan_request_id as "carePlanRequestId", care_plan_requested_at as "carePlanRequestedAt",
             audio_uri as "audioUri", audio_uploaded_at as "audioUploadedAt",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM visits
      WHERE provider_id = $1 AND scheduled_at >= $2 AND scheduled_at <= $3
    `;

    const params: any[] = [providerId, startDate, endDate];

    if (status) {
      query += ` AND status = $4`;
      params.push(status);
    }

    query += ` ORDER BY scheduled_at ASC`;

    try {
      const result = await pool.query(query, params);
      return result.rows.map(visit => ({
        ...visit,
        caseIds: typeof visit.caseIds === 'string' ? JSON.parse(visit.caseIds) : visit.caseIds,
        conditionCodes: typeof visit.conditionCodes === 'string' ? JSON.parse(visit.conditionCodes) : visit.conditionCodes,
      }));
    } catch (error) {
      return [];
    }
  }
}

// Export service instances
export const providerService = new ProviderService();
export const facilityService = new FacilityService();
export const visitService = new VisitService();