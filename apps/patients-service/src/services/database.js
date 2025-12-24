"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patientService = exports.PatientService = void 0;
const pg_1 = require("pg");
const redis_1 = require("redis");
const uuid_1 = require("uuid");
const pool = new pg_1.Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'healthcare_federation',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
const redis = (0, redis_1.createClient)({
    url: `redis://:${process.env.REDIS_PASSWORD || 'redis_password'}@${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`
});
redis.on('error', (err) => console.error('Redis Client Error', err));
(async () => {
    if (!redis.isOpen) {
        await redis.connect();
    }
})();
class PatientService {
    async getAllPatients(limit = 50, offset = 0) {
        const cacheKey = `patients:all:${limit}:${offset}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
            const query = `
        SELECT 
          id,
          first_name as "firstName",
          last_name as "lastName", 
          date_of_birth as "dateOfBirth",
          gender,
          phone,
          email,
          address,
          medical_record_number as "medicalRecordNumber",
          epic_patient_id as "epicPatientId",
          emergency_contact as "emergencyContact",
          insurance_info as "insuranceInfo",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM patients 
        ORDER BY last_name, first_name
        LIMIT $1 OFFSET $2
      `;
            const result = await pool.query(query, [limit, offset]);
            const patients = result.rows;
            await redis.setEx(cacheKey, 300, JSON.stringify(patients));
            return patients;
        }
        catch (error) {
            console.error('Error fetching patients:', error);
            throw error;
        }
    }
    async getPatientById(id) {
        const cacheKey = `patient:${id}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
            const query = `
        SELECT 
          id,
          first_name as "firstName",
          last_name as "lastName", 
          date_of_birth as "dateOfBirth",
          gender,
          phone,
          email,
          address,
          medical_record_number as "medicalRecordNumber",
          epic_patient_id as "epicPatientId",
          emergency_contact as "emergencyContact",
          insurance_info as "insuranceInfo",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM patients 
        WHERE id = $1
      `;
            const result = await pool.query(query, [id]);
            const patient = result.rows[0] || null;
            if (patient) {
                await redis.setEx(cacheKey, 3600, JSON.stringify(patient));
            }
            return patient;
        }
        catch (error) {
            console.error('Error fetching patient by ID:', error);
            throw error;
        }
    }
    async createPatient(patientData) {
        const id = (0, uuid_1.v4)();
        try {
            const query = `
        INSERT INTO patients (
          id, first_name, last_name, date_of_birth, gender, phone, email, 
          address, medical_record_number, epic_patient_id, emergency_contact, insurance_info
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING 
          id,
          first_name as "firstName",
          last_name as "lastName", 
          date_of_birth as "dateOfBirth",
          gender,
          phone,
          email,
          address,
          medical_record_number as "medicalRecordNumber",
          epic_patient_id as "epicPatientId",
          emergency_contact as "emergencyContact",
          insurance_info as "insuranceInfo",
          created_at as "createdAt",
          updated_at as "updatedAt"
      `;
            const values = [
                id,
                patientData.firstName,
                patientData.lastName,
                patientData.dateOfBirth,
                patientData.gender,
                patientData.phone,
                patientData.email,
                patientData.address,
                patientData.medicalRecordNumber,
                patientData.epicPatientId,
                patientData.emergencyContact,
                patientData.insuranceInfo
            ];
            const result = await pool.query(query, values);
            const patient = result.rows[0];
            await redis.setEx(`patient:${id}`, 3600, JSON.stringify(patient));
            const keys = await redis.keys('patients:all:*');
            if (keys.length > 0) {
                await redis.del(keys);
            }
            return patient;
        }
        catch (error) {
            console.error('Error creating patient:', error);
            throw error;
        }
    }
    async updatePatient(id, updates) {
        try {
            const setClauses = [];
            const values = [];
            let paramCount = 1;
            if (updates.firstName !== undefined) {
                setClauses.push(`first_name = $${paramCount++}`);
                values.push(updates.firstName);
            }
            if (updates.lastName !== undefined) {
                setClauses.push(`last_name = $${paramCount++}`);
                values.push(updates.lastName);
            }
            if (updates.dateOfBirth !== undefined) {
                setClauses.push(`date_of_birth = $${paramCount++}`);
                values.push(updates.dateOfBirth);
            }
            if (updates.gender !== undefined) {
                setClauses.push(`gender = $${paramCount++}`);
                values.push(updates.gender);
            }
            if (updates.phone !== undefined) {
                setClauses.push(`phone = $${paramCount++}`);
                values.push(updates.phone);
            }
            if (updates.email !== undefined) {
                setClauses.push(`email = $${paramCount++}`);
                values.push(updates.email);
            }
            if (updates.address !== undefined) {
                setClauses.push(`address = $${paramCount++}`);
                values.push(JSON.stringify(updates.address));
            }
            if (updates.emergencyContact !== undefined) {
                setClauses.push(`emergency_contact = $${paramCount++}`);
                values.push(JSON.stringify(updates.emergencyContact));
            }
            if (updates.insuranceInfo !== undefined) {
                setClauses.push(`insurance_info = $${paramCount++}`);
                values.push(JSON.stringify(updates.insuranceInfo));
            }
            if (setClauses.length === 0) {
                return this.getPatientById(id);
            }
            setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
            values.push(id);
            const query = `
        UPDATE patients 
        SET ${setClauses.join(', ')}
        WHERE id = $${paramCount}
        RETURNING 
          id,
          first_name as "firstName",
          last_name as "lastName", 
          date_of_birth as "dateOfBirth",
          gender,
          phone,
          email,
          address,
          medical_record_number as "medicalRecordNumber",
          epic_patient_id as "epicPatientId",
          emergency_contact as "emergencyContact",
          insurance_info as "insuranceInfo",
          created_at as "createdAt",
          updated_at as "updatedAt"
      `;
            const result = await pool.query(query, values);
            const patient = result.rows[0] || null;
            if (patient) {
                await redis.setEx(`patient:${id}`, 3600, JSON.stringify(patient));
                const keys = await redis.keys('patients:all:*');
                if (keys.length > 0) {
                    await redis.del(keys);
                }
            }
            return patient;
        }
        catch (error) {
            console.error('Error updating patient:', error);
            throw error;
        }
    }
    async deletePatient(id) {
        try {
            const query = 'DELETE FROM patients WHERE id = $1';
            const result = await pool.query(query, [id]);
            if (result.rowCount && result.rowCount > 0) {
                await redis.del(`patient:${id}`);
                const keys = await redis.keys('patients:all:*');
                if (keys.length > 0) {
                    await redis.del(keys);
                }
                return true;
            }
            return false;
        }
        catch (error) {
            console.error('Error deleting patient:', error);
            throw error;
        }
    }
}
exports.PatientService = PatientService;
exports.patientService = new PatientService();
//# sourceMappingURL=database.js.map