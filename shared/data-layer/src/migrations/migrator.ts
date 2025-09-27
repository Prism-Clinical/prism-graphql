import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { db } from '../db/connection';
import { Migration, MigrationStatus } from '../types';

export class Migrator {
  private migrationsPath: string;

  constructor(migrationsPath: string = join(__dirname, '../../migrations')) {
    this.migrationsPath = migrationsPath;
  }

  async initializeMigrationTable(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS migration_history (
        migration_id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64) NOT NULL
      );
    `;
    
    await db.query(createTableSQL);
  }

  async getAppliedMigrations(): Promise<MigrationStatus[]> {
    const result = await db.query<MigrationStatus>(`
      SELECT migration_id as "migrationId", applied_at as "appliedAt", checksum
      FROM migration_history
      ORDER BY applied_at ASC
    `);
    
    return result.rows;
  }

  async getAllMigrations(): Promise<Migration[]> {
    try {
      const files = readdirSync(this.migrationsPath)
        .filter(file => file.endsWith('.sql'))
        .sort();

      const migrations: Migration[] = [];

      for (const file of files) {
        const filePath = join(this.migrationsPath, file);
        const content = readFileSync(filePath, 'utf-8');
        
        // Parse migration file
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
    } catch (error) {
      console.error('Error reading migrations:', error);
      return [];
    }
  }

  async getPendingMigrations(): Promise<Migration[]> {
    const allMigrations = await this.getAllMigrations();
    const appliedMigrations = await this.getAppliedMigrations();
    const appliedIds = new Set(appliedMigrations.map(m => m.migrationId));

    return allMigrations.filter(m => !appliedIds.has(m.id));
  }

  async migrate(direction: 'up' | 'down' = 'up', target?: string): Promise<void> {
    await this.initializeMigrationTable();

    if (direction === 'up') {
      await this.migrateUp(target);
    } else {
      await this.migrateDown(target);
    }
  }

  private async migrateUp(target?: string): Promise<void> {
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
      
      await db.transaction(async (client) => {
        // Execute the migration
        await client.query(migration.up);
        
        // Record the migration
        const checksum = this.calculateChecksum(migration.up);
        await client.query(
          'INSERT INTO migration_history (migration_id, name, checksum) VALUES ($1, $2, $3)',
          [migration.id, migration.name, checksum]
        );
      });

      console.log(`✓ Applied migration: ${migration.id}`);
    }

    console.log('All migrations completed successfully!');
  }

  private async migrateDown(target?: string): Promise<void> {
    const appliedMigrations = await this.getAppliedMigrations();
    const allMigrations = await this.getAllMigrations();
    
    // Get migrations in reverse order
    const migrationsMap = new Map(allMigrations.map(m => [m.id, m]));
    const migrationsToRollback = appliedMigrations
      .reverse()
      .map(applied => migrationsMap.get(applied.migrationId))
      .filter(Boolean) as Migration[];

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
      
      await db.transaction(async (client) => {
        // Execute the rollback
        await client.query(migration.down);
        
        // Remove from migration history
        await client.query(
          'DELETE FROM migration_history WHERE migration_id = $1',
          [migration.id]
        );
      });

      console.log(`✓ Rolled back migration: ${migration.id}`);
    }

    console.log('All rollbacks completed successfully!');
  }

  private parseMigrationFile(content: string): { up: string; down: string } {
    const upMatch = content.match(/-- UP\s*\n([\s\S]*?)(?=-- DOWN|$)/i);
    const downMatch = content.match(/-- DOWN\s*\n([\s\S]*?)$/i);

    return {
      up: upMatch ? upMatch[1].trim() : content.trim(),
      down: downMatch ? downMatch[1].trim() : ''
    };
  }

  private extractMigrationName(filename: string): string {
    // Extract name from filename like: 001_create_patients_table.sql
    const parts = filename.replace('.sql', '').split('_');
    return parts.slice(1).join(' ').replace(/[_-]/g, ' ');
  }

  private extractTimestamp(migrationId: string): Date {
    // Extract timestamp from migration ID
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

  private calculateChecksum(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  async getStatus(): Promise<{ applied: number; pending: number; total: number }> {
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