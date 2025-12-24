"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatientSessionQueries = void 0;
const connection_1 = require("@shared/data-layer/src/db/connection");
class PatientSessionQueries {
    static async createSession(patientId, epicPatientId, expiresAt) {
        const result = await connection_1.db.query(`
      INSERT INTO patient_sessions (patient_id, epic_patient_id, expires_at)
      VALUES ($1, $2, $3)
      RETURNING 
        session_id as "sessionId",
        patient_id as "patientId", 
        epic_patient_id as "epicPatientId",
        status,
        created_at as "createdAt",
        expires_at as "expiresAt",
        last_accessed_at as "lastAccessedAt",
        data_freshness as "dataFreshness"
    `, [patientId, epicPatientId, expiresAt]);
        return result.rows[0];
    }
    static async getSessionById(sessionId) {
        const result = await connection_1.db.query(`
      SELECT 
        session_id as "sessionId",
        patient_id as "patientId", 
        epic_patient_id as "epicPatientId",
        status,
        created_at as "createdAt",
        expires_at as "expiresAt",
        last_accessed_at as "lastAccessedAt",
        data_freshness as "dataFreshness"
      FROM patient_sessions 
      WHERE session_id = $1
    `, [sessionId]);
        return result.rows[0] || null;
    }
    static async getActiveSessionByPatientId(patientId) {
        const result = await connection_1.db.query(`
      SELECT 
        session_id as "sessionId",
        patient_id as "patientId", 
        epic_patient_id as "epicPatientId",
        status,
        created_at as "createdAt",
        expires_at as "expiresAt",
        last_accessed_at as "lastAccessedAt",
        data_freshness as "dataFreshness"
      FROM patient_sessions 
      WHERE patient_id = $1 
        AND status = 'active' 
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
      LIMIT 1
    `, [patientId]);
        return result.rows[0] || null;
    }
    static async updateSessionAccess(sessionId) {
        await connection_1.db.query(`
      UPDATE patient_sessions 
      SET last_accessed_at = CURRENT_TIMESTAMP 
      WHERE session_id = $1
    `, [sessionId]);
    }
    static async updateDataFreshness(sessionId, dataType, timestamp) {
        await connection_1.db.query(`
      UPDATE patient_sessions 
      SET data_freshness = jsonb_set(
        COALESCE(data_freshness, '{}'), 
        $2::text[], 
        to_jsonb($3::timestamp)
      )
      WHERE session_id = $1
    `, [sessionId, `{${dataType}}`, timestamp.toISOString()]);
    }
    static async expireSession(sessionId) {
        await connection_1.db.query(`
      UPDATE patient_sessions 
      SET status = 'expired' 
      WHERE session_id = $1
    `, [sessionId]);
    }
    static async terminateSession(sessionId) {
        await connection_1.db.query(`
      UPDATE patient_sessions 
      SET status = 'terminated' 
      WHERE session_id = $1
    `, [sessionId]);
    }
    static async cleanupExpiredSessions() {
        const result = await connection_1.db.query(`
      UPDATE patient_sessions 
      SET status = 'expired' 
      WHERE status = 'active' 
        AND expires_at <= CURRENT_TIMESTAMP
    `);
        return result.rowCount || 0;
    }
    static async getSessionsByPatientId(patientId, limit = 10) {
        const result = await connection_1.db.query(`
      SELECT 
        session_id as "sessionId",
        patient_id as "patientId", 
        epic_patient_id as "epicPatientId",
        status,
        created_at as "createdAt",
        expires_at as "expiresAt",
        last_accessed_at as "lastAccessedAt",
        data_freshness as "dataFreshness"
      FROM patient_sessions 
      WHERE patient_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [patientId, limit]);
        return result.rows;
    }
    static async deleteSession(sessionId) {
        const result = await connection_1.db.query(`
      DELETE FROM patient_sessions 
      WHERE session_id = $1
    `, [sessionId]);
        return (result.rowCount || 0) > 0;
    }
}
exports.PatientSessionQueries = PatientSessionQueries;
//# sourceMappingURL=patient-sessions.js.map