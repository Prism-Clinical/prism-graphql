import { db } from '@shared/data-layer/src/db/connection';
import { RecommendationJob, JobStatus, RecommendationJobType, JobPriority } from '@shared/data-layer/src/types';

export class RecommendationJobQueries {

  static async createJob(
    sessionId: string,
    patientId: string,
    jobType: RecommendationJobType,
    priority: JobPriority = JobPriority.NORMAL,
    inputData?: any
  ): Promise<RecommendationJob> {
    const result = await db.query<RecommendationJob>(`
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

  static async getJobById(jobId: string): Promise<RecommendationJob | null> {
    const result = await db.query<RecommendationJob>(`
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

  static async getNextPendingJob(): Promise<RecommendationJob | null> {
    const result = await db.query<RecommendationJob>(`
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

  static async getJobsBySession(sessionId: string): Promise<RecommendationJob[]> {
    const result = await db.query<RecommendationJob>(`
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

  static async getJobsByPatient(
    patientId: string, 
    status?: JobStatus,
    limit: number = 50
  ): Promise<RecommendationJob[]> {
    let whereClause = 'WHERE patient_id = $1';
    const params: any[] = [patientId];

    if (status) {
      whereClause += ' AND status = $2';
      params.push(status);
    }

    params.push(limit);
    const limitParam = `$${params.length}`;

    const result = await db.query<RecommendationJob>(`
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

  static async updateJobStatus(
    jobId: string,
    status: JobStatus,
    errorMessage?: string
  ): Promise<boolean> {
    const now = new Date();
    let setClause = 'status = $2';
    const params: any[] = [jobId, status];

    if (status === JobStatus.RUNNING) {
      setClause += ', started_at = $3';
      params.push(now);
    } else if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
      setClause += ', completed_at = $3';
      params.push(now);
    }

    if (errorMessage) {
      setClause += `, error_message = $${params.length + 1}`;
      params.push(errorMessage);
    }

    const result = await db.query(`
      UPDATE recommendation_jobs
      SET ${setClause}
      WHERE job_id = $1
    `, params);

    return (result.rowCount || 0) > 0;
  }

  static async updateJobResults(jobId: string, results: any): Promise<boolean> {
    const result = await db.query(`
      UPDATE recommendation_jobs
      SET results = $2, completed_at = CURRENT_TIMESTAMP, status = 'completed'
      WHERE job_id = $1
    `, [jobId, JSON.stringify(results)]);

    return (result.rowCount || 0) > 0;
  }

  static async cancelJob(jobId: string): Promise<boolean> {
    const result = await db.query(`
      UPDATE recommendation_jobs
      SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
      WHERE job_id = $1 AND status = 'pending'
    `, [jobId]);

    return (result.rowCount || 0) > 0;
  }

  static async cancelJobsBySession(sessionId: string): Promise<number> {
    const result = await db.query(`
      UPDATE recommendation_jobs
      SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
      WHERE session_id = $1 AND status IN ('pending', 'running')
    `, [sessionId]);

    return result.rowCount || 0;
  }

  static async getJobQueue(limit: number = 10): Promise<RecommendationJob[]> {
    const result = await db.query<RecommendationJob>(`
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

  static async getJobStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    avgProcessingTime: number | null;
  }> {
    const [totalResult, statusResult, typeResult, avgTimeResult] = await Promise.all([
      db.query<{count: string}>('SELECT COUNT(*) as count FROM recommendation_jobs'),
      db.query<{status: string, count: string}>(`
        SELECT status, COUNT(*) as count 
        FROM recommendation_jobs 
        GROUP BY status
      `),
      db.query<{jobType: string, count: string}>(`
        SELECT job_type as "jobType", COUNT(*) as count 
        FROM recommendation_jobs 
        GROUP BY job_type
      `),
      db.query<{avgSeconds: number}>(`
        SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as "avgSeconds"
        FROM recommendation_jobs 
        WHERE started_at IS NOT NULL AND completed_at IS NOT NULL
      `)
    ]);

    const byStatus: Record<string, number> = {};
    statusResult.rows.forEach(row => {
      byStatus[row.status] = parseInt(row.count);
    });

    const byType: Record<string, number> = {};
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

  static async cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
    const result = await db.query(`
      DELETE FROM recommendation_jobs
      WHERE created_at < (CURRENT_TIMESTAMP - INTERVAL '1 day' * $1)
        AND status IN ('completed', 'failed', 'cancelled')
    `, [olderThanDays]);

    return result.rowCount || 0;
  }

  static async retryFailedJob(jobId: string): Promise<boolean> {
    const result = await db.query(`
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