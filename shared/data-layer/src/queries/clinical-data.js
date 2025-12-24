"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClinicalDataQueries = void 0;
const connection_1 = require("@shared/data-layer/src/db/connection");
class ClinicalDataQueries {
    static async upsertClinicalData(patientId, dataType, data, sourceSystem = 'epic', ttl = 3600) {
        const result = await connection_1.db.query(`
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
    static async getClinicalData(patientId, dataType, sourceSystem = 'epic') {
        const result = await connection_1.db.query(`
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
    static async getAllClinicalDataForPatient(patientId, includeExpired = false) {
        const whereClause = includeExpired
            ? 'WHERE patient_id = $1'
            : 'WHERE patient_id = $1 AND expires_at > CURRENT_TIMESTAMP';
        const result = await connection_1.db.query(`
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
    static async getDataFreshness(patientId, dataTypes) {
        let whereClause = 'WHERE patient_id = $1';
        const params = [patientId];
        if (dataTypes && dataTypes.length > 0) {
            whereClause += ' AND data_type = ANY($2)';
            params.push(dataTypes);
        }
        const result = await connection_1.db.query(`
      SELECT 
        data_type as "dataType",
        MAX(last_updated) as "lastUpdated"
      FROM clinical_data
      ${whereClause}
      GROUP BY data_type
    `, params);
        const freshness = {};
        if (dataTypes) {
            dataTypes.forEach(type => {
                freshness[type] = null;
            });
        }
        result.rows.forEach(row => {
            freshness[row.dataType] = row.lastUpdated;
        });
        return freshness;
    }
    static async isDataFresh(patientId, dataType, maxAgeSeconds) {
        const result = await connection_1.db.query(`
      SELECT COUNT(*) as count
      FROM clinical_data
      WHERE patient_id = $1 
        AND data_type = $2
        AND last_updated > (CURRENT_TIMESTAMP - INTERVAL '1 second' * $3)
        AND expires_at > CURRENT_TIMESTAMP
    `, [patientId, dataType, maxAgeSeconds]);
        return parseInt(result.rows[0].count) > 0;
    }
    static async getExpiredData(limit = 100) {
        const result = await connection_1.db.query(`
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
    static async cleanupExpiredData() {
        const result = await connection_1.db.query(`
      DELETE FROM clinical_data
      WHERE expires_at <= CURRENT_TIMESTAMP
    `);
        return result.rowCount || 0;
    }
    static async deleteClinicalData(patientId, dataType, sourceSystem = 'epic') {
        const result = await connection_1.db.query(`
      DELETE FROM clinical_data
      WHERE patient_id = $1 
        AND data_type = $2 
        AND source_system = $3
    `, [patientId, dataType, sourceSystem]);
        return (result.rowCount || 0) > 0;
    }
    static async deleteAllPatientData(patientId) {
        const result = await connection_1.db.query(`
      DELETE FROM clinical_data
      WHERE patient_id = $1
    `, [patientId]);
        return result.rowCount || 0;
    }
    static async updateTTL(patientId, dataType, newTTL) {
        const result = await connection_1.db.query(`
      UPDATE clinical_data
      SET ttl = $3
      WHERE patient_id = $1 AND data_type = $2
    `, [patientId, dataType, newTTL]);
        return (result.rowCount || 0) > 0;
    }
    static async getDataStats() {
        const [totalResult, typeResult, expiredResult] = await Promise.all([
            connection_1.db.query('SELECT COUNT(*) as count FROM clinical_data'),
            connection_1.db.query(`
        SELECT data_type as "dataType", COUNT(*) as count 
        FROM clinical_data 
        GROUP BY data_type
      `),
            connection_1.db.query(`
        SELECT COUNT(*) as count 
        FROM clinical_data 
        WHERE expires_at <= CURRENT_TIMESTAMP
      `)
        ]);
        const recordsByType = {};
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
exports.ClinicalDataQueries = ClinicalDataQueries;
//# sourceMappingURL=clinical-data.js.map