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

export enum InstitutionType {
  HOSPITAL_SYSTEM = 'HOSPITAL_SYSTEM',
  MEDICAL_CENTER = 'MEDICAL_CENTER',
  UNIVERSITY = 'UNIVERSITY',
  RESEARCH_INSTITUTE = 'RESEARCH_INSTITUTE',
  CLINIC_NETWORK = 'CLINIC_NETWORK',
  GOVERNMENT_AGENCY = 'GOVERNMENT_AGENCY'
}

export interface Institution {
  id: string;
  name: string;
  type: InstitutionType;
  address: Address;
  phone: string;
  email?: string;
  website?: string;
  accreditation: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Hospital {
  id: string;
  name: string;
  institutionId: string;
  address: Address;
  phone: string;
  email?: string;
  website?: string;
  beds?: number;
  departments: string[];
  emergencyServices: boolean;
  isActive: boolean;
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

// Institution Service
class InstitutionService {
  async createInstitution(data: Omit<Institution, 'id' | 'isActive' | 'createdAt' | 'updatedAt'>): Promise<Institution> {
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
    } catch (error: any) {
      if (error.code === '23505' && error.constraint?.includes('name')) {
        throw new Error('Duplicate name: Institution with this name already exists');
      }
      throw error;
    }
  }

  async getInstitutionById(id: string): Promise<Institution | null> {
    ensureInitialized();
    // Check cache first
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
        
        // Cache for 10 minutes
        await redis.setex(cacheKey, 600, JSON.stringify(institution));
      }
      
      return institution;
    } catch (error) {
      return null;
    }
  }

  async getInstitutions(options: {
    type?: InstitutionType;
    limit?: number;
    offset?: number;
  } = {}): Promise<Institution[]> {
    ensureInitialized();
    const { type, limit = 50, offset = 0 } = options;
    
    // Check cache for simple queries
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
    
    const params: any[] = [];
    
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
      
      // Cache for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(institutions));
      
      return institutions;
    } catch (error) {
      return [];
    }
  }

  async updateInstitution(id: string, updates: Partial<Omit<Institution, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Institution | null> {
    ensureInitialized();
    const allowedFields = ['name', 'type', 'address', 'phone', 'email', 'website', 'accreditation', 'isActive'];
    const updateFields: string[] = [];
    const values: any[] = [];
    
    Object.entries(updates).forEach(([key, value]) => {
      const dbKey = key === 'isActive' ? 'active' : key;
      
      if (allowedFields.includes(key) && value !== undefined) {
        if (key === 'address' || key === 'accreditation') {
          updateFields.push(`${dbKey} = $${values.length + 1}`);
          values.push(JSON.stringify(value));
        } else {
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
        
        // Invalidate cache
        await redis.del(`institution:${id}`);
        // Invalidate list caches
        await this.invalidateListCaches();
      }
      
      return institution;
    } catch (error) {
      return null;
    }
  }

  async deleteInstitution(id: string): Promise<boolean> {
    ensureInitialized();
    // Soft delete by setting active = false
    const query = `
      UPDATE institutions 
      SET active = false, updated_at = NOW()
      WHERE id = $1 AND active = true
    `;
    
    try {
      const result = await pool.query(query, [id]);
      const deleted = result.rowCount > 0;
      
      if (deleted) {
        // Invalidate cache
        await redis.del(`institution:${id}`);
        await this.invalidateListCaches();
      }
      
      return deleted;
    } catch (error) {
      return false;
    }
  }

  private async invalidateListCaches(): Promise<void> {
    try {
      const pattern = 'institutions:all:*';
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.warn('Cache invalidation failed:', error);
    }
  }
}

// Hospital Service (using institutions table with additional metadata)
class HospitalService {
  async createHospital(data: Omit<Hospital, 'id' | 'isActive' | 'createdAt' | 'updatedAt'>): Promise<Hospital> {
    ensureInitialized();
    
    // First verify the institution exists
    const institutionQuery = `SELECT id FROM institutions WHERE id = $1 AND active = true`;
    const institutionResult = await pool.query(institutionQuery, [data.institutionId]);
    
    if (institutionResult.rows.length === 0) {
      throw new Error('Foreign key constraint: Invalid institution reference');
    }

    // Store hospital-specific data in a separate table or in JSONB metadata
    // For now, we'll create a separate hospitals table entry
    const query = `
      INSERT INTO institutions (name, type, address, phone, email, website, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, address, phone, email, website, active as "isActive", 
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    
    try {
      const result = await pool.query(query, [
        data.name,
        'hospital', // Store as hospital type in institutions table
        JSON.stringify(data.address),
        data.phone,
        data.email || null,
        data.website || null,
        true
      ]);
      
      const hospital = result.rows[0];
      
      // Store hospital-specific metadata separately
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
    } catch (error: any) {
      if (error.message.includes('Invalid institution reference')) {
        throw error;
      }
      throw new Error('Failed to create hospital');
    }
  }

  async getHospitalById(id: string): Promise<Hospital | null> {
    ensureInitialized();
    // Check cache first
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
      
      if (!row) return null;
      
      const services = row.services ? (typeof row.services === 'string' ? JSON.parse(row.services) : row.services) : {};
      
      const hospital: Hospital = {
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
      
      // Cache for 10 minutes
      await redis.setex(cacheKey, 600, JSON.stringify(hospital));
      
      return hospital;
    } catch (error) {
      return null;
    }
  }

  async getHospitalsByInstitution(institutionId: string): Promise<Hospital[]> {
    ensureInitialized();
    // Check cache first
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
      
      // Cache for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(hospitals));
      
      return hospitals;
    } catch (error) {
      return [];
    }
  }

  async updateHospital(id: string, updates: Partial<Omit<Hospital, 'id' | 'institutionId' | 'createdAt' | 'updatedAt'>>): Promise<Hospital | null> {
    ensureInitialized();
    
    // Get current hospital to preserve metadata
    const currentHospital = await this.getHospitalById(id);
    if (!currentHospital) return null;
    
    const institutionUpdates: any = {};
    const metadataUpdates: any = {};
    
    // Separate institution fields from hospital-specific fields
    if (updates.name !== undefined) institutionUpdates.name = updates.name;
    if (updates.address !== undefined) institutionUpdates.address = JSON.stringify(updates.address);
    if (updates.phone !== undefined) institutionUpdates.phone = updates.phone;
    if (updates.email !== undefined) institutionUpdates.email = updates.email;
    if (updates.website !== undefined) institutionUpdates.website = updates.website;
    if (updates.isActive !== undefined) institutionUpdates.active = updates.isActive;
    
    if (updates.beds !== undefined) metadataUpdates.beds = updates.beds;
    if (updates.departments !== undefined) metadataUpdates.departments = updates.departments;
    if (updates.emergencyServices !== undefined) metadataUpdates.emergencyServices = updates.emergencyServices;
    
    try {
      // Update institution fields
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
      
      // Update hospital metadata
      if (Object.keys(metadataUpdates).length > 0) {
        const currentServices = await pool.query('SELECT services FROM institutions WHERE id = $1', [id]);
        const services = currentServices.rows[0]?.services ? 
          (typeof currentServices.rows[0].services === 'string' ? 
            JSON.parse(currentServices.rows[0].services) : 
            currentServices.rows[0].services) : {};
        
        const updatedServices = { ...services, ...metadataUpdates };
        
        await pool.query(
          'UPDATE institutions SET services = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(updatedServices), id]
        );
      }
      
      // Invalidate cache and return updated hospital
      await redis.del(`hospital:${id}`);
      if (currentHospital.institutionId) {
        await redis.del(`hospitals:institution:${currentHospital.institutionId}`);
      }
      
      return await this.getHospitalById(id);
    } catch (error) {
      return null;
    }
  }

  async deleteHospital(id: string): Promise<boolean> {
    ensureInitialized();
    // Get current hospital to know which caches to invalidate
    const hospital = await this.getHospitalById(id);
    
    // Soft delete
    const query = `
      UPDATE institutions 
      SET active = false, updated_at = NOW()
      WHERE id = $1 AND type = 'hospital' AND active = true
    `;
    
    try {
      const result = await pool.query(query, [id]);
      const deleted = result.rowCount > 0;
      
      if (deleted && hospital) {
        // Invalidate cache
        await redis.del(`hospital:${id}`);
        if (hospital.institutionId) {
          await redis.del(`hospitals:institution:${hospital.institutionId}`);
        }
      }
      
      return deleted;
    } catch (error) {
      return false;
    }
  }
}

// Export service instances
export const institutionService = new InstitutionService();
export const hospitalService = new HospitalService();