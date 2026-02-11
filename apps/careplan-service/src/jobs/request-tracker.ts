/**
 * Request Tracker
 *
 * Tracks pipeline request status and results.
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { PipelineInput, PipelineOutput } from '../orchestration';

/**
 * Request status
 */
export type RequestStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

/**
 * Pipeline request record
 */
export interface PipelineRequest {
  id: string;
  visitId?: string;
  patientId: string;
  userId: string;
  idempotencyKey?: string;
  status: RequestStatus;
  inputEncrypted: Buffer;
  resultEncrypted?: Buffer;
  error?: {
    message: string;
    code: string;
  };
  stagesCompleted: string[];
  degradedServices: string[];
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

/**
 * Request tracker configuration
 */
export interface RequestTrackerConfig {
  pool: Pool;
  tableName?: string;
  encryptionKey: Buffer;
}

/**
 * Encrypt data for storage
 */
function encryptData(data: any, key: Buffer): Buffer {
  const crypto = require('crypto');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const json = JSON.stringify(data);
  let encrypted = cipher.update(json, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return Buffer.from(iv.toString('hex') + ':' + encrypted);
}

/**
 * Decrypt data from storage
 */
function decryptData<T>(encrypted: Buffer, key: Buffer): T {
  const crypto = require('crypto');
  const data = encrypted.toString('utf8');
  const parts = data.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedData = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

/**
 * Request tracker class
 */
export class RequestTracker {
  private pool: Pool;
  private tableName: string;
  private encryptionKey: Buffer;

  constructor(config: RequestTrackerConfig) {
    this.pool = config.pool;
    this.tableName = config.tableName ?? 'pipeline_requests';
    this.encryptionKey = config.encryptionKey;
  }

  /**
   * Create a new request
   */
  async createRequest(input: {
    visitId?: string;
    patientId: string;
    userId: string;
    idempotencyKey?: string;
    pipelineInput: PipelineInput;
  }): Promise<string> {
    const id = uuidv4();

    // Encrypt input (contains PHI)
    const inputEncrypted = encryptData(input.pipelineInput, this.encryptionKey);

    const query = `
      INSERT INTO ${this.tableName} (
        id, visit_id, patient_id, user_id, idempotency_key,
        status, input_encrypted, stages_completed, degraded_services,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, '{}', '{}', NOW())
      RETURNING id
    `;

    await this.pool.query(query, [
      id,
      input.visitId || null,
      input.patientId,
      input.userId,
      input.idempotencyKey || null,
      inputEncrypted,
    ]);

    return id;
  }

  /**
   * Update request status
   */
  async updateStatus(
    requestId: string,
    status: RequestStatus,
    stagesCompleted?: string[]
  ): Promise<void> {
    let query = `
      UPDATE ${this.tableName}
      SET status = $2
    `;

    const params: any[] = [requestId, status];

    if (status === 'IN_PROGRESS') {
      query += `, started_at = NOW()`;
    }

    if (stagesCompleted) {
      query += `, stages_completed = $${params.length + 1}`;
      params.push(stagesCompleted);
    }

    query += ` WHERE id = $1`;

    await this.pool.query(query, params);
  }

  /**
   * Complete request with result
   */
  async complete(requestId: string, result: PipelineOutput): Promise<void> {
    // Encrypt result (contains PHI)
    const resultEncrypted = encryptData(result, this.encryptionKey);

    const query = `
      UPDATE ${this.tableName}
      SET status = 'COMPLETED',
          result_encrypted = $2,
          stages_completed = $3,
          degraded_services = $4,
          completed_at = NOW()
      WHERE id = $1
    `;

    await this.pool.query(query, [
      requestId,
      resultEncrypted,
      result.processingMetadata.stageResults.map((s) => s.stage),
      result.degradedServices,
    ]);
  }

  /**
   * Mark request as failed
   */
  async fail(
    requestId: string,
    error: { message: string; code: string }
  ): Promise<void> {
    const query = `
      UPDATE ${this.tableName}
      SET status = 'FAILED',
          error = $2,
          completed_at = NOW()
      WHERE id = $1
    `;

    await this.pool.query(query, [requestId, JSON.stringify(error)]);
  }

  /**
   * Get request by ID
   */
  async getById(requestId: string): Promise<PipelineRequest | null> {
    const query = `
      SELECT id, visit_id, patient_id, user_id, idempotency_key,
             status, input_encrypted, result_encrypted, error,
             stages_completed, degraded_services,
             started_at, completed_at, created_at
      FROM ${this.tableName}
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [requestId]);
    const row = result.rows[0];

    if (!row) return null;

    return this.mapRow(row);
  }

  /**
   * Get requests by visit ID
   */
  async getByVisitId(visitId: string): Promise<PipelineRequest[]> {
    const query = `
      SELECT id, visit_id, patient_id, user_id, idempotency_key,
             status, input_encrypted, result_encrypted, error,
             stages_completed, degraded_services,
             started_at, completed_at, created_at
      FROM ${this.tableName}
      WHERE visit_id = $1
      ORDER BY created_at DESC
    `;

    const result = await this.pool.query(query, [visitId]);
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Get active request by visit ID
   */
  async getActiveByVisitId(visitId: string): Promise<PipelineRequest | null> {
    const query = `
      SELECT id, visit_id, patient_id, user_id, idempotency_key,
             status, input_encrypted, result_encrypted, error,
             stages_completed, degraded_services,
             started_at, completed_at, created_at
      FROM ${this.tableName}
      WHERE visit_id = $1
        AND status IN ('PENDING', 'IN_PROGRESS')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.pool.query(query, [visitId]);
    const row = result.rows[0];

    if (!row) return null;

    return this.mapRow(row);
  }

  /**
   * Get requests for user
   */
  async getByUserId(
    userId: string,
    limit: number = 50
  ): Promise<PipelineRequest[]> {
    const query = `
      SELECT id, visit_id, patient_id, user_id, idempotency_key,
             status, input_encrypted, result_encrypted, error,
             stages_completed, degraded_services,
             started_at, completed_at, created_at
      FROM ${this.tableName}
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [userId, limit]);
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Get decrypted input for a request
   */
  async getDecryptedInput(requestId: string): Promise<PipelineInput | null> {
    const request = await this.getById(requestId);
    if (!request) return null;

    try {
      return decryptData<PipelineInput>(request.inputEncrypted, this.encryptionKey);
    } catch (error) {
      console.error('Failed to decrypt input:', error);
      return null;
    }
  }

  /**
   * Get decrypted result for a request
   */
  async getDecryptedResult(requestId: string): Promise<PipelineOutput | null> {
    const request = await this.getById(requestId);
    if (!request || !request.resultEncrypted) return null;

    try {
      return decryptData<PipelineOutput>(request.resultEncrypted, this.encryptionKey);
    } catch (error) {
      console.error('Failed to decrypt result:', error);
      return null;
    }
  }

  /**
   * Expire stale requests
   */
  async expireStaleRequests(olderThanMinutes: number = 60): Promise<number> {
    const query = `
      UPDATE ${this.tableName}
      SET status = 'EXPIRED',
          completed_at = NOW()
      WHERE status IN ('PENDING', 'IN_PROGRESS')
        AND created_at < NOW() - INTERVAL '${olderThanMinutes} minutes'
    `;

    const result = await this.pool.query(query);
    return result.rowCount ?? 0;
  }

  /**
   * Clean old completed requests
   */
  async cleanOldRequests(olderThanDays: number = 90): Promise<number> {
    const query = `
      DELETE FROM ${this.tableName}
      WHERE status IN ('COMPLETED', 'FAILED', 'EXPIRED')
        AND created_at < NOW() - INTERVAL '${olderThanDays} days'
    `;

    const result = await this.pool.query(query);
    return result.rowCount ?? 0;
  }

  /**
   * Get request statistics
   */
  async getStats(): Promise<RequestStats> {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as in_progress,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
        COUNT(*) FILTER (WHERE status = 'EXPIRED') as expired,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)
          FILTER (WHERE status = 'COMPLETED') as avg_duration_ms
      FROM ${this.tableName}
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;

    const result = await this.pool.query(query);
    const row = result.rows[0];

    return {
      pending: parseInt(row.pending) || 0,
      inProgress: parseInt(row.in_progress) || 0,
      completed: parseInt(row.completed) || 0,
      failed: parseInt(row.failed) || 0,
      expired: parseInt(row.expired) || 0,
      avgDurationMs: parseFloat(row.avg_duration_ms) || 0,
    };
  }

  /**
   * Map database row to PipelineRequest
   */
  private mapRow(row: any): PipelineRequest {
    return {
      id: row.id,
      visitId: row.visit_id,
      patientId: row.patient_id,
      userId: row.user_id,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      inputEncrypted: row.input_encrypted,
      resultEncrypted: row.result_encrypted,
      error: row.error ? JSON.parse(row.error) : undefined,
      stagesCompleted: row.stages_completed || [],
      degradedServices: row.degraded_services || [],
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }
}

/**
 * Request statistics
 */
export interface RequestStats {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  expired: number;
  avgDurationMs: number;
}
