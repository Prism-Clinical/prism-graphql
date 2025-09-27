#!/usr/bin/env node

import { config } from 'dotenv';
import { Migrator } from '@shared/data-layer/src/migrations/migrator';
import { db, getDatabaseConfig } from '@shared/data-layer/src/db/connection';

// Load environment variables
config();

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    // Initialize database connection
    db.initialize(getDatabaseConfig());

    const migrator = new Migrator();

    switch (command) {
      case 'up':
        await migrator.migrate('up', args[1]);
        break;
      
      case 'down':
        await migrator.migrate('down', args[1]);
        break;
      
      case 'status':
        const status = await migrator.getStatus();
        console.log('Migration Status:');
        console.log(`Applied: ${status.applied}`);
        console.log(`Pending: ${status.pending}`);
        console.log(`Total: ${status.total}`);
        break;
      
      case 'list':
        const pending = await migrator.getPendingMigrations();
        const applied = await migrator.getAppliedMigrations();
        
        console.log('Applied Migrations:');
        applied.forEach(m => console.log(`  ✓ ${m.migrationId} (${m.appliedAt})`));
        
        console.log('\nPending Migrations:');
        pending.forEach(m => console.log(`  ○ ${m.id} - ${m.name}`));
        break;
      
      case 'create':
        const migrationName = args[1];
        if (!migrationName) {
          console.error('Migration name required: npm run migrate:create <name>');
          process.exit(1);
        }
        await createMigration(migrationName);
        break;
      
      default:
        console.log('Usage:');
        console.log('  npm run migrate up [target]     - Run pending migrations');
        console.log('  npm run migrate down [target]   - Rollback migrations');
        console.log('  npm run migrate status          - Show migration status');
        console.log('  npm run migrate list            - List all migrations');
        console.log('  npm run migrate create <name>   - Create new migration');
        process.exit(1);
    }

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await db.close();
    process.exit(0);
  }
}

async function createMigration(name: string): Promise<void> {
  const fs = require('fs');
  const path = require('path');
  
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').substring(0, 14);
  const filename = `${timestamp}_${name.toLowerCase().replace(/\s+/g, '_')}.sql`;
  const migrationsDir = path.join(__dirname, '../../migrations');
  const filepath = path.join(migrationsDir, filename);

  const template = `-- Migration: ${name}
-- Created at: ${new Date().toISOString()}

-- UP
-- Add your migration SQL here



-- DOWN
-- Add your rollback SQL here


`;

  // Ensure migrations directory exists
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  fs.writeFileSync(filepath, template);
  console.log(`Created migration: ${filename}`);
}

if (require.main === module) {
  main();
}