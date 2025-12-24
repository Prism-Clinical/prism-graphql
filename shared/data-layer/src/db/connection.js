"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.getDatabaseConfig = getDatabaseConfig;
const pg_1 = require("pg");
class DatabaseConnection {
    pool = null;
    config = null;
    initialize(config) {
        this.config = config;
        this.pool = new pg_1.Pool({
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.username,
            password: config.password,
            ssl: config.ssl,
            max: config.maxConnections || 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
        this.pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
        });
    }
    async getClient() {
        if (!this.pool) {
            throw new Error('Database connection not initialized');
        }
        return this.pool.connect();
    }
    async query(text, params) {
        if (!this.pool) {
            throw new Error('Database connection not initialized');
        }
        const start = Date.now();
        try {
            const result = await this.pool.query(text, params);
            const duration = Date.now() - start;
            console.log('Query executed', { text: text.substring(0, 100), duration, rows: result.rowCount });
            return result;
        }
        catch (error) {
            const duration = Date.now() - start;
            console.error('Query error', { text: text.substring(0, 100), duration, error });
            throw error;
        }
    }
    async transaction(callback) {
        const client = await this.getClient();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async healthCheck() {
        try {
            const result = await this.query('SELECT 1 as health');
            return result.rows.length > 0;
        }
        catch {
            return false;
        }
    }
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }
    getStats() {
        if (!this.pool) {
            return null;
        }
        return {
            totalCount: this.pool.totalCount,
            idleCount: this.pool.idleCount,
            waitingCount: this.pool.waitingCount,
        };
    }
}
exports.db = new DatabaseConnection();
function getDatabaseConfig() {
    return {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'healthcare_federation',
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        ssl: process.env.DB_SSL === 'true',
        maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20'),
    };
}
//# sourceMappingURL=connection.js.map