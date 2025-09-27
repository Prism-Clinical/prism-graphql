import { db } from '../db/connection';
import { PatientSession, SessionStatus } from '../types';

export class PatientSessionQueries {
  
  static async createSession(
    patientId: string, 
    epicPatientId: string, 
    expiresAt: Date
  ): Promise<PatientSession> {
    const result = await db.query<PatientSession>(`
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

  static async getSessionById(sessionId: string): Promise<PatientSession | null> {
    const result = await db.query<PatientSession>(`
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

  static async getActiveSessionByPatientId(patientId: string): Promise<PatientSession | null> {
    const result = await db.query<PatientSession>(`
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

  static async updateSessionAccess(sessionId: string): Promise<void> {
    await db.query(`
      UPDATE patient_sessions 
      SET last_accessed_at = CURRENT_TIMESTAMP 
      WHERE session_id = $1
    `, [sessionId]);
  }

  static async updateDataFreshness(
    sessionId: string, 
    dataType: string, 
    timestamp: Date
  ): Promise<void> {
    await db.query(`
      UPDATE patient_sessions 
      SET data_freshness = jsonb_set(
        COALESCE(data_freshness, '{}'), 
        $2::text[], 
        to_jsonb($3::timestamp)
      )
      WHERE session_id = $1
    `, [sessionId, `{${dataType}}`, timestamp.toISOString()]);
  }

  static async expireSession(sessionId: string): Promise<void> {
    await db.query(`
      UPDATE patient_sessions 
      SET status = 'expired' 
      WHERE session_id = $1
    `, [sessionId]);
  }

  static async terminateSession(sessionId: string): Promise<void> {
    await db.query(`
      UPDATE patient_sessions 
      SET status = 'terminated' 
      WHERE session_id = $1
    `, [sessionId]);
  }

  static async cleanupExpiredSessions(): Promise<number> {
    const result = await db.query(`
      UPDATE patient_sessions 
      SET status = 'expired' 
      WHERE status = 'active' 
        AND expires_at <= CURRENT_TIMESTAMP
    `);

    return result.rowCount || 0;
  }

  static async getSessionsByPatientId(patientId: string, limit: number = 10): Promise<PatientSession[]> {
    const result = await db.query<PatientSession>(`
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

  static async deleteSession(sessionId: string): Promise<boolean> {
    const result = await db.query(`
      DELETE FROM patient_sessions 
      WHERE session_id = $1
    `, [sessionId]);

    return (result.rowCount || 0) > 0;
  }
}