"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrator = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const crypto_1 = require("crypto");
const connection_1 = require("@shared/data-layer/src/db/connection");
class Migrator {
    migrationsPath;
    constructor(migrationsPath = (0, path_1.join)(__dirname, '../../migrations')) {
        this.migrationsPath = migrationsPath;
    }
    async initializeMigrationTable() {
        const createTableSQL = `
      CREATE TABLE IF NOT EXISTS migration_history (
        migration_id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64) NOT NULL
      );
    `;
        await connection_1.db.query(createTableSQL);
    }
    async getAppliedMigrations() {
        const result = await connection_1.db.query(`
      SELECT migration_id as "migrationId", applied_at as "appliedAt", checksum
      FROM migration_history
      ORDER BY applied_at ASC
    `);
        return result.rows;
    }
    async getAllMigrations() {
        try {
            const files = (0, fs_1.readdirSync)(this.migrationsPath)
                .filter(file => file.endsWith('.sql'))
                .sort();
            const migrations = [];
            for (const file of files) {
                const filePath = (0, path_1.join)(this.migrationsPath, file);
                const content = (0, fs_1.readFileSync)(filePath, 'utf-8');
                const sections = this.parseMigrationFile(content);
                const migrationId = file.replace('.sql', '');
                const name = this.extractMigrationName(file);
                migrations.push({
                    id: migrationId,
                    name,
                    timestamp: this.extractTimestamp(migrationId),
                    up: sections.up,
                    down: sections.down
                });
            }
            return migrations;
        }
        catch (error) {
            console.error('Error reading migrations:', error);
            return [];
        }
    }
    async getPendingMigrations() {
        const allMigrations = await this.getAllMigrations();
        const appliedMigrations = await this.getAppliedMigrations();
        const appliedIds = new Set(appliedMigrations.map(m => m.migrationId));
        return allMigrations.filter(m => !appliedIds.has(m.id));
    }
    async migrate(direction = 'up', target) {
        await this.initializeMigrationTable();
        if (direction === 'up') {
            await this.migrateUp(target);
        }
        else {
            await this.migrateDown(target);
        }
    }
    async migrateUp(target) {
        const pendingMigrations = await this.getPendingMigrations();
        let migrationsToRun = pendingMigrations;
        if (target) {
            const targetIndex = pendingMigrations.findIndex(m => m.id === target);
            if (targetIndex === -1) {
                throw new Error(`Migration ${target} not found`);
            }
            migrationsToRun = pendingMigrations.slice(0, targetIndex + 1);
        }
        console.log(`Running ${migrationsToRun.length} migrations...`);
        for (const migration of migrationsToRun) {
            console.log(`Applying migration: ${migration.id} - ${migration.name}`);
            await connection_1.db.transaction(async (client) => {
                await client.query(migration.up);
                const checksum = this.calculateChecksum(migration.up);
                await client.query('INSERT INTO migration_history (migration_id, name, checksum) VALUES ($1, $2, $3)', [migration.id, migration.name, checksum]);
            });
            console.log(`✓ Applied migration: ${migration.id}`);
        }
        console.log('All migrations completed successfully!');
    }
    async migrateDown(target) {
        const appliedMigrations = await this.getAppliedMigrations();
        const allMigrations = await this.getAllMigrations();
        const migrationsMap = new Map(allMigrations.map(m => [m.id, m]));
        const migrationsToRollback = appliedMigrations
            .reverse()
            .map(applied => migrationsMap.get(applied.migrationId))
            .filter(Boolean);
        let migrationsToRun = migrationsToRollback;
        if (target) {
            const targetIndex = migrationsToRollback.findIndex(m => m.id === target);
            if (targetIndex === -1) {
                throw new Error(`Migration ${target} not found in applied migrations`);
            }
            migrationsToRun = migrationsToRollback.slice(0, targetIndex + 1);
        }
        console.log(`Rolling back ${migrationsToRun.length} migrations...`);
        for (const migration of migrationsToRun) {
            console.log(`Rolling back migration: ${migration.id} - ${migration.name}`);
            await connection_1.db.transaction(async (client) => {
                await client.query(migration.down);
                await client.query('DELETE FROM migration_history WHERE migration_id = $1', [migration.id]);
            });
            console.log(`✓ Rolled back migration: ${migration.id}`);
        }
        console.log('All rollbacks completed successfully!');
    }
    parseMigrationFile(content) {
        const upMatch = content.match(/-- UP\s*\n([\s\S]*?)(?=-- DOWN|$)/i);
        const downMatch = content.match(/-- DOWN\s*\n([\s\S]*?)$/i);
        return {
            up: upMatch ? upMatch[1].trim() : content.trim(),
            down: downMatch ? downMatch[1].trim() : ''
        };
    }
    extractMigrationName(filename) {
        const parts = filename.replace('.sql', '').split('_');
        return parts.slice(1).join(' ').replace(/[_-]/g, ' ');
    }
    extractTimestamp(migrationId) {
        const timestampMatch = migrationId.match(/^(\d{14})/);
        if (timestampMatch) {
            const timestamp = timestampMatch[1];
            const year = parseInt(timestamp.substring(0, 4));
            const month = parseInt(timestamp.substring(4, 6)) - 1;
            const day = parseInt(timestamp.substring(6, 8));
            const hour = parseInt(timestamp.substring(8, 10));
            const minute = parseInt(timestamp.substring(10, 12));
            const second = parseInt(timestamp.substring(12, 14));
            return new Date(year, month, day, hour, minute, second);
        }
        return new Date();
    }
    calculateChecksum(content) {
        return (0, crypto_1.createHash)('sha256').update(content).digest('hex');
    }
    async getStatus() {
        const allMigrations = await this.getAllMigrations();
        const appliedMigrations = await this.getAppliedMigrations();
        const pendingMigrations = await this.getPendingMigrations();
        return {
            applied: appliedMigrations.length,
            pending: pendingMigrations.length,
            total: allMigrations.length
        };
    }
}
exports.Migrator = Migrator;
//# sourceMappingURL=migrator.js.map