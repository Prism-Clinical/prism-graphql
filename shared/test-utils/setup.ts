import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// Test database configuration
export const testConfig = {
  database: {
    host: process.env.TEST_DB_HOST || 'localhost',
    port: parseInt(process.env.TEST_DB_PORT || '5432'),
    database: process.env.TEST_DB_NAME || 'healthcare_federation_test',
    user: process.env.TEST_DB_USER || 'postgres',
    password: process.env.TEST_DB_PASSWORD || 'postgres',
  },
  redis: {
    host: process.env.TEST_REDIS_HOST || 'localhost',
    port: parseInt(process.env.TEST_REDIS_PORT || '6379'),
    db: parseInt(process.env.TEST_REDIS_DB || '1'), // Use separate Redis DB for tests
  }
};

// Test database pool
let testPool: Pool;
let testRedis: Redis;

export async function setupTestDatabase(): Promise<Pool> {
  if (!testPool) {
    testPool = new Pool(testConfig.database);
    
    // Create test database if it doesn't exist
    const adminPool = new Pool({
      ...testConfig.database,
      database: 'postgres' // Connect to default database first
    });
    
    try {
      await adminPool.query(`CREATE DATABASE ${testConfig.database.database}`);
    } catch (error) {
      // Database might already exist, ignore error
    }
    
    await adminPool.end();
    
    // Run minimal test schema setup
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        date_of_birth DATE NOT NULL,
        gender VARCHAR(20),
        phone VARCHAR(20),
        email VARCHAR(255),
        address JSONB,
        medical_record_number VARCHAR(50) UNIQUE,
        epic_patient_id VARCHAR(100),
        emergency_contact JSONB,
        insurance_info JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await testPool.query(`
      CREATE TABLE IF NOT EXISTS providers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        title VARCHAR(100),
        specialty VARCHAR(100),
        email VARCHAR(255),
        phone VARCHAR(20),
        institution_id UUID,
        license_number VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await testPool.query(`
      CREATE TABLE IF NOT EXISTS institutions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        type VARCHAR(100),
        address JSONB,
        phone VARCHAR(20),
        email VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await testPool.query(`
      CREATE TABLE IF NOT EXISTS recommendations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id UUID NOT NULL,
        provider_id UUID,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'active',
        priority VARCHAR(50) DEFAULT 'medium',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await testPool.query(`
      CREATE TABLE IF NOT EXISTS recommendation_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recommendation_id UUID NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        evidence_level VARCHAR(50),
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  
  return testPool;
}

export async function setupTestRedis(): Promise<Redis> {
  if (!testRedis) {
    testRedis = new Redis(testConfig.redis);
  }
  return testRedis;
}

export async function cleanupTestDatabase(): Promise<void> {
  if (testPool) {
    // Clean all test data
    await testPool.query('TRUNCATE patients, providers, institutions, recommendations, recommendation_items CASCADE');
  }
  
  if (testRedis) {
    await testRedis.flushdb(); // Clear test Redis database
  }
}

export async function closeTestConnections(): Promise<void> {
  if (testPool) {
    await testPool.end();
  }
  
  if (testRedis) {
    await testRedis.quit();
  }
}

// Test data generators
export const testDataGenerators = {
  patient: (overrides: any = {}) => ({
    id: uuidv4(),
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '1985-05-15',
    gender: 'male',
    phone: '555-1234',
    email: 'john.doe@email.com',
    medicalRecordNumber: `MRN-${Date.now()}`,
    epicPatientId: `EPIC-${Date.now()}`,
    address: { street: '123 Main St', city: 'Anytown', state: 'CA', zip: '12345' },
    emergencyContact: { name: 'Jane Doe', phone: '555-5678' },
    insuranceInfo: { provider: 'Blue Cross', policyNumber: 'BC123456' },
    ...overrides
  }),

  provider: (overrides: any = {}) => ({
    id: uuidv4(),
    firstName: 'Dr. Sarah',
    lastName: 'Smith',
    title: 'MD',
    specialty: 'Cardiology',
    email: 'dr.smith@hospital.com',
    phone: '555-9876',
    institutionId: uuidv4(),
    licenseNumber: 'MD123456',
    ...overrides
  }),

  institution: (overrides: any = {}) => ({
    id: uuidv4(),
    name: 'General Hospital',
    type: 'hospital',
    address: { street: '456 Health Ave', city: 'Medtown', state: 'CA', zip: '67890' },
    phone: '555-4321',
    email: 'info@generalhospital.com',
    ...overrides
  }),

  recommendation: (overrides: any = {}) => ({
    id: uuidv4(),
    patientId: uuidv4(),
    providerId: uuidv4(),
    title: 'Follow-up Appointment',
    description: 'Schedule follow-up in 3 months',
    status: 'active',
    priority: 'medium',
    ...overrides
  }),

  recommendationItem: (overrides: any = {}) => ({
    id: uuidv4(),
    recommendationId: uuidv4(),
    title: 'Blood Pressure Check',
    description: 'Monitor blood pressure weekly',
    evidenceLevel: 'A',
    completed: false,
    ...overrides
  })
};

// Database insertion helpers for tests
export const testHelpers = {
  async insertPatient(pool: Pool, patientData: any) {
    const data = testDataGenerators.patient(patientData);
    const result = await pool.query(`
      INSERT INTO patients (id, first_name, last_name, date_of_birth, gender, phone, email, 
                           medical_record_number, epic_patient_id, address, emergency_contact, insurance_info)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      data.id, data.firstName, data.lastName, data.dateOfBirth, data.gender,
      data.phone, data.email, data.medicalRecordNumber, data.epicPatientId,
      JSON.stringify(data.address), JSON.stringify(data.emergencyContact), JSON.stringify(data.insuranceInfo)
    ]);
    return result.rows[0];
  },

  async insertProvider(pool: Pool, providerData: any) {
    const data = testDataGenerators.provider(providerData);
    const result = await pool.query(`
      INSERT INTO providers (id, first_name, last_name, title, specialty, email, phone, 
                           institution_id, license_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      data.id, data.firstName, data.lastName, data.title, data.specialty,
      data.email, data.phone, data.institutionId, data.licenseNumber
    ]);
    return result.rows[0];
  },

  async insertInstitution(pool: Pool, institutionData: any) {
    const data = testDataGenerators.institution(institutionData);
    const result = await pool.query(`
      INSERT INTO institutions (id, name, type, address, phone, email)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      data.id, data.name, data.type, JSON.stringify(data.address), data.phone, data.email
    ]);
    return result.rows[0];
  },

  async insertRecommendation(pool: Pool, recommendationData: any) {
    const data = testDataGenerators.recommendation(recommendationData);
    const result = await pool.query(`
      INSERT INTO recommendations (id, patient_id, provider_id, title, description, status, priority)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      data.id, data.patientId, data.providerId, data.title, data.description, data.status, data.priority
    ]);
    return result.rows[0];
  },

  async insertRecommendationItem(pool: Pool, itemData: any) {
    const data = testDataGenerators.recommendationItem(itemData);
    const result = await pool.query(`
      INSERT INTO recommendation_items (id, recommendation_id, title, description, evidence_level, completed)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      data.id, data.recommendationId, data.title, data.description, data.evidenceLevel, data.completed
    ]);
    return result.rows[0];
  }
};