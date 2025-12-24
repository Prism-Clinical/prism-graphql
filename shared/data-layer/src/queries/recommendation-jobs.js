"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationJobQueries = void 0;
const connection_1 = require("@shared/data-layer/src/db/connection");
const types_1 = require("@shared/data-layer/src/types");
class RecommendationJobQueries {
    static async createJob(sessionId, patientId, jobType, priority = types_1.JobPriority.NORMAL, inputData) {
        const result = await connection_1.db.query(`
      INSERT INTO recommendation_jobs (session_id, patient_id, job_type, priority, input_data)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING 
        job_id as "jobId",
        session_id as "sessionId",
        patient_id as "patientId",
        status,
        job_type as "jobType",
        priority,
        input_data as "inputData",
        results,
        created_at as "createdAt",
        started_at as "startedAt",
        completed_at as "completedAt",
        error_message as "errorMessage"
    `, [sessionId, patientId, jobType, priority, inputData ? JSON.stringify(inputData) : null]);
        return result.rows[0];
    }
    static async getJobById(jobId) {
        const result = await connection_1.db.query(`
      SELECT 
        job_id as "jobId",
        session_id as "sessionId",
        patient_id as "patientId",
        status,
        job_type as "jobType",
        priority,
        input_data as "inputData",
        results,
        created_at as "createdAt",
        started_at as "startedAt",
        completed_at as "completedAt",
        error_message as "errorMessage"
      FROM recommendation_jobs
      WHERE job_id = $1
    `, [jobId]);
        return result.rows[0] || null;
    }
    static async getNextPendingJob() {
        const result = await connection_1.db.query(`
      SELECT 
        job_id as "jobId",
        session_id as "sessionId",
        patient_id as "patientId",
        status,
        job_type as "jobType",
        priority,
        input_data as "inputData",
        results,
        created_at as "createdAt",
        started_at as "startedAt",
        completed_at as "completedAt",
        error_message as "errorMessage"
      FROM recommendation_jobs
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `, []);
        return result.rows[0] || null;
    }
    static async getJobsBySession(sessionId) {
        const result = await connection_1.db.query(`
      SELECT 
        job_id as "jobId",
        session_id as "sessionId",
        patient_id as "patientId",
        status,
        job_type as "jobType",
        priority,
        input_data as "inputData",
        results,
        created_at as "createdAt",
        started_at as "startedAt",
        completed_at as "completedAt",
        error_message as "errorMessage"
      FROM recommendation_jobs
      WHERE session_id = $1
      ORDER BY created_at DESC
    `, [sessionId]);
        return result.rows;
    }
    static async getJobsByPatient(patientId, status, limit = 50) {
        let whereClause = 'WHERE patient_id = $1';
        const params = [patientId];
        if (status) {
            whereClause += ' AND status = $2';
            params.push(status);
        }
        params.push(limit);
        const limitParam = `$${params.length}`;
        const result = await connection_1.db.query(`
      SELECT 
        job_id as "jobId",
        session_id as "sessionId",
        patient_id as "patientId",
        status,
        job_type as "jobType",
        priority,
        input_data as "inputData",
        results,
        created_at as "createdAt",
        started_at as "startedAt",
        completed_at as "completedAt",
        error_message as "errorMessage"
      FROM recommendation_jobs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limitParam}
    `, params);
        return result.rows;
    }
    static async updateJobStatus(jobId, status, errorMessage) {
        const now = new Date();
        let setClause = 'status = $2';
        const params = [jobId, status];
        if (status === types_1.JobStatus.RUNNING) {
            setClause += ', started_at = $3';
            params.push(now);
        }
        else if (status === types_1.JobStatus.COMPLETED || status === types_1.JobStatus.FAILED) {
            setClause += ', completed_at = $3';
            params.push(now);
        }
        if (errorMessage) {
            setClause += `, error_message = $${params.length + 1}`;
            params.push(errorMessage);
        }
        const result = await connection_1.db.query(`
      UPDATE recommendation_jobs
      SET ${setClause}
      WHERE job_id = $1
    `, params);
        return (result.rowCount || 0) > 0;
    }
    static async updateJobResults(jobId, results) {
        const result = await connection_1.db.query(`
      UPDATE recommendation_jobs
      SET results = $2, completed_at = CURRENT_TIMESTAMP, status = 'completed'
      WHERE job_id = $1
    `, [jobId, JSON.stringify(results)]);
        return (result.rowCount || 0) > 0;
    }
    static async cancelJob(jobId) {
        const result = await connection_1.db.query(`
      UPDATE recommendation_jobs
      SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
      WHERE job_id = $1 AND status = 'pending'
    `, [jobId]);
        return (result.rowCount || 0) > 0;
    }
    static async cancelJobsBySession(sessionId) {
        const result = await connection_1.db.query(`
      UPDATE recommendation_jobs
      SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
      WHERE session_id = $1 AND status IN ('pending', 'running')
    `, [sessionId]);
        return result.rowCount || 0;
    }
    static async getJobQueue(limit = 10) {
        const result = await connection_1.db.query(`
      SELECT 
        job_id as "jobId",
        session_id as "sessionId",
        patient_id as "patientId",
        status,
        job_type as "jobType",
        priority,
        input_data as "inputData",
        results,
        created_at as "createdAt",
        started_at as "startedAt",
        completed_at as "completedAt",
        error_message as "errorMessage"
      FROM recommendation_jobs
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT $1
    `, [limit]);
        return result.rows;
    }
    static async getJobStats() {
        const [totalResult, statusResult, typeResult, avgTimeResult] = await Promise.all([
            connection_1.db.query('SELECT COUNT(*) as count FROM recommendation_jobs'),
            connection_1.db.query(`
        SELECT status, COUNT(*) as count 
        FROM recommendation_jobs 
        GROUP BY status
      `),
            connection_1.db.query(`
        SELECT job_type as "jobType", COUNT(*) as count 
        FROM recommendation_jobs 
        GROUP BY job_type
      `),
            connection_1.db.query(`
        SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as "avgSeconds"
        FROM recommendation_jobs 
        WHERE started_at IS NOT NULL AND completed_at IS NOT NULL
      `)
        ]);
        const byStatus = {};
        statusResult.rows.forEach(row => {
            byStatus[row.status] = parseInt(row.count);
        });
        const byType = {};
        typeResult.rows.forEach(row => {
            byType[row.jobType] = parseInt(row.count);
        });
        return {
            total: parseInt(totalResult.rows[0].count),
            byStatus,
            byType,
            avgProcessingTime: avgTimeResult.rows[0].avgSeconds || null
        };
    }
    static async cleanupOldJobs(olderThanDays = 30) {
        const result = await connection_1.db.query(`
      DELETE FROM recommendation_jobs
      WHERE created_at < (CURRENT_TIMESTAMP - INTERVAL '1 day' * $1)
        AND status IN ('completed', 'failed', 'cancelled')
    `, [olderThanDays]);
        return result.rowCount || 0;
    }
    static async retryFailedJob(jobId) {
        const result = await connection_1.db.query(`
      UPDATE recommendation_jobs
      SET 
        status = 'pending',
        started_at = NULL,
        completed_at = NULL,
        error_message = NULL
      WHERE job_id = $1 AND status = 'failed'
    `, [jobId]);
        return (result.rowCount || 0) > 0;
    }
}
exports.RecommendationJobQueries = RecommendationJobQueries;
//# sourceMappingURL=recommendation-jobs.js.map