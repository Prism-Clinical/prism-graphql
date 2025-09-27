"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testHelpers = exports.testDataGenerators = exports.testConfig = void 0;
exports.setupTestDatabase = setupTestDatabase;
exports.setupTestRedis = setupTestRedis;
exports.cleanupTestDatabase = cleanupTestDatabase;
exports.closeTestConnections = closeTestConnections;
const pg_1 = require("pg");
const ioredis_1 = require("ioredis");
const uuid_1 = require("uuid");
exports.testConfig = {
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
        db: parseInt(process.env.TEST_REDIS_DB || '1'),
    }
};
let testPool;
let testRedis;
async function setupTestDatabase() {
    if (!testPool) {
        testPool = new pg_1.Pool(exports.testConfig.database);
        const adminPool = new pg_1.Pool({
            ...exports.testConfig.database,
            database: 'postgres'
        });
        try {
            await adminPool.query(`CREATE DATABASE ${exports.testConfig.database.database}`);
        }
        catch (error) {
        }
        await adminPool.end();
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
async function setupTestRedis() {
    if (!testRedis) {
        testRedis = new ioredis_1.Redis(exports.testConfig.redis);
    }
    return testRedis;
}
async function cleanupTestDatabase() {
    if (testPool) {
        await testPool.query('TRUNCATE patients, providers, institutions, recommendations, recommendation_items CASCADE');
    }
    if (testRedis) {
        await testRedis.flushdb();
    }
}
async function closeTestConnections() {
    if (testPool) {
        await testPool.end();
    }
    if (testRedis) {
        await testRedis.quit();
    }
}
exports.testDataGenerators = {
    patient: (overrides = {}) => ({
        id: (0, uuid_1.v4)(),
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
    provider: (overrides = {}) => ({
        id: (0, uuid_1.v4)(),
        firstName: 'Dr. Sarah',
        lastName: 'Smith',
        title: 'MD',
        specialty: 'Cardiology',
        email: 'dr.smith@hospital.com',
        phone: '555-9876',
        institutionId: (0, uuid_1.v4)(),
        licenseNumber: 'MD123456',
        ...overrides
    }),
    institution: (overrides = {}) => ({
        id: (0, uuid_1.v4)(),
        name: 'General Hospital',
        type: 'hospital',
        address: { street: '456 Health Ave', city: 'Medtown', state: 'CA', zip: '67890' },
        phone: '555-4321',
        email: 'info@generalhospital.com',
        ...overrides
    }),
    recommendation: (overrides = {}) => ({
        id: (0, uuid_1.v4)(),
        patientId: (0, uuid_1.v4)(),
        providerId: (0, uuid_1.v4)(),
        title: 'Follow-up Appointment',
        description: 'Schedule follow-up in 3 months',
        status: 'active',
        priority: 'medium',
        ...overrides
    }),
    recommendationItem: (overrides = {}) => ({
        id: (0, uuid_1.v4)(),
        recommendationId: (0, uuid_1.v4)(),
        title: 'Blood Pressure Check',
        description: 'Monitor blood pressure weekly',
        evidenceLevel: 'A',
        completed: false,
        ...overrides
    })
};
exports.testHelpers = {
    async insertPatient(pool, patientData) {
        const data = exports.testDataGenerators.patient(patientData);
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
    async insertProvider(pool, providerData) {
        const data = exports.testDataGenerators.provider(providerData);
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
    async insertInstitution(pool, institutionData) {
        const data = exports.testDataGenerators.institution(institutionData);
        const result = await pool.query(`
      INSERT INTO institutions (id, name, type, address, phone, email)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
            data.id, data.name, data.type, JSON.stringify(data.address), data.phone, data.email
        ]);
        return result.rows[0];
    },
    async insertRecommendation(pool, recommendationData) {
        const data = exports.testDataGenerators.recommendation(recommendationData);
        const result = await pool.query(`
      INSERT INTO recommendations (id, patient_id, provider_id, title, description, status, priority)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
            data.id, data.patientId, data.providerId, data.title, data.description, data.status, data.priority
        ]);
        return result.rows[0];
    },
    async insertRecommendationItem(pool, itemData) {
        const data = exports.testDataGenerators.recommendationItem(itemData);
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
//# sourceMappingURL=setup.js.map