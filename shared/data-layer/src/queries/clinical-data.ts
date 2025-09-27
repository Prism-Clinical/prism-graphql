import { db } from '@shared/data-layer/src/db/connection';
import { ClinicalData, ClinicalDataType } from '@shared/data-layer/src/types';

export class ClinicalDataQueries {

  static async upsertClinicalData(
    patientId: string,
    dataType: ClinicalDataType,
    data: any,
    sourceSystem: string = 'epic',
    ttl: number = 3600
  ): Promise<ClinicalData> {
    const result = await db.query<ClinicalData>(`
      INSERT INTO clinical_data (patient_id, data_type, data, source_system, ttl)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (patient_id, data_type, source_system)
      DO UPDATE SET 
        data = EXCLUDED.data,
        last_updated = CURRENT_TIMESTAMP,
        ttl = EXCLUDED.ttl
      RETURNING 
        id,
        patient_id as "patientId",
        data_type as "type",
        data,
        source_system as "sourceSystem",
        last_updated as "lastUpdated",
        ttl
    `, [patientId, dataType, JSON.stringify(data), sourceSystem, ttl]);

    return result.rows[0];
  }

  static async getClinicalData(
    patientId: string,
    dataType: ClinicalDataType,
    sourceSystem: string = 'epic'
  ): Promise<ClinicalData | null> {
    const result = await db.query<ClinicalData>(`
      SELECT 
        id,
        patient_id as "patientId",
        data_type as "type",
        data,
        source_system as "sourceSystem",
        last_updated as "lastUpdated",
        ttl
      FROM clinical_data
      WHERE patient_id = $1 
        AND data_type = $2 
        AND source_system = $3
        AND expires_at > CURRENT_TIMESTAMP
    `, [patientId, dataType, sourceSystem]);

    return result.rows[0] || null;
  }

  static async getAllClinicalDataForPatient(
    patientId: string,
    includeExpired: boolean = false
  ): Promise<ClinicalData[]> {
    const whereClause = includeExpired 
      ? 'WHERE patient_id = $1'
      : 'WHERE patient_id = $1 AND expires_at > CURRENT_TIMESTAMP';

    const result = await db.query<ClinicalData>(`
      SELECT 
        id,
        patient_id as "patientId",
        data_type as "type",
        data,
        source_system as "sourceSystem",
        last_updated as "lastUpdated",
        ttl
      FROM clinical_data
      ${whereClause}
      ORDER BY data_type, last_updated DESC
    `, [patientId]);

    return result.rows;
  }

  static async getDataFreshness(
    patientId: string,
    dataTypes?: ClinicalDataType[]
  ): Promise<Record<string, Date | null>> {
    let whereClause = 'WHERE patient_id = $1';
    const params: any[] = [patientId];

    if (dataTypes && dataTypes.length > 0) {
      whereClause += ' AND data_type = ANY($2)';
      params.push(dataTypes);
    }

    const result = await db.query<{dataType: string, lastUpdated: Date}>(`
      SELECT 
        data_type as "dataType",
        MAX(last_updated) as "lastUpdated"
      FROM clinical_data
      ${whereClause}
      GROUP BY data_type
    `, params);

    const freshness: Record<string, Date | null> = {};
    
    // Initialize all requested data types
    if (dataTypes) {
      dataTypes.forEach(type => {
        freshness[type] = null;
      });
    }

    // Fill in actual values
    result.rows.forEach(row => {
      freshness[row.dataType] = row.lastUpdated;
    });

    return freshness;
  }

  static async isDataFresh(
    patientId: string,
    dataType: ClinicalDataType,
    maxAgeSeconds: number
  ): Promise<boolean> {
    const result = await db.query<{count: string}>(`
      SELECT COUNT(*) as count
      FROM clinical_data
      WHERE patient_id = $1 
        AND data_type = $2
        AND last_updated > (CURRENT_TIMESTAMP - INTERVAL '1 second' * $3)
        AND expires_at > CURRENT_TIMESTAMP
    `, [patientId, dataType, maxAgeSeconds]);

    return parseInt(result.rows[0].count) > 0;
  }

  static async getExpiredData(limit: number = 100): Promise<ClinicalData[]> {
    const result = await db.query<ClinicalData>(`
      SELECT 
        id,
        patient_id as "patientId",
        data_type as "type",
        data,
        source_system as "sourceSystem",
        last_updated as "lastUpdated",
        ttl
      FROM clinical_data
      WHERE expires_at <= CURRENT_TIMESTAMP
      ORDER BY expires_at ASC
      LIMIT $1
    `, [limit]);

    return result.rows;
  }

  static async cleanupExpiredData(): Promise<number> {
    const result = await db.query(`
      DELETE FROM clinical_data
      WHERE expires_at <= CURRENT_TIMESTAMP
    `);

    return result.rowCount || 0;
  }

  static async deleteClinicalData(
    patientId: string,
    dataType: ClinicalDataType,
    sourceSystem: string = 'epic'
  ): Promise<boolean> {
    const result = await db.query(`
      DELETE FROM clinical_data
      WHERE patient_id = $1 
        AND data_type = $2 
        AND source_system = $3
    `, [patientId, dataType, sourceSystem]);

    return (result.rowCount || 0) > 0;
  }

  static async deleteAllPatientData(patientId: string): Promise<number> {
    const result = await db.query(`
      DELETE FROM clinical_data
      WHERE patient_id = $1
    `, [patientId]);

    return result.rowCount || 0;
  }

  static async updateTTL(
    patientId: string,
    dataType: ClinicalDataType,
    newTTL: number
  ): Promise<boolean> {
    const result = await db.query(`
      UPDATE clinical_data
      SET ttl = $3
      WHERE patient_id = $1 AND data_type = $2
    `, [patientId, dataType, newTTL]);

    return (result.rowCount || 0) > 0;
  }

  static async getDataStats(): Promise<{
    totalRecords: number;
    recordsByType: Record<string, number>;
    expiredRecords: number;
  }> {
    const [totalResult, typeResult, expiredResult] = await Promise.all([
      db.query<{count: string}>('SELECT COUNT(*) as count FROM clinical_data'),
      db.query<{dataType: string, count: string}>(`
        SELECT data_type as "dataType", COUNT(*) as count 
        FROM clinical_data 
        GROUP BY data_type
      `),
      db.query<{count: string}>(`
        SELECT COUNT(*) as count 
        FROM clinical_data 
        WHERE expires_at <= CURRENT_TIMESTAMP
      `)
    ]);

    const recordsByType: Record<string, number> = {};
    typeResult.rows.forEach(row => {
      recordsByType[row.dataType] = parseInt(row.count);
    });

    return {
      totalRecords: parseInt(totalResult.rows[0].count),
      recordsByType,
      expiredRecords: parseInt(expiredResult.rows[0].count)
    };
  }
}