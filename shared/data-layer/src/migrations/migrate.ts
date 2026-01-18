#!/usr/bin/env node

import { db, getDatabaseConfig } from '@shared/data-layer/src/db/connection';
import { Migrator } from '@shared/data-layer/src/migrations/migrator';

async function runMigrations() {
  try {
    // Initialize database connection
    const dbConfig = getDatabaseConfig();
    db.initialize(dbConfig);

    // Create migrator instance
    const migrator = new Migrator();
    
    // Initialize migration table
    await migrator.initializeMigrationTable();

    const command = process.argv[2] || 'up';

    switch (command) {
      case 'up':
        console.log('Running migrations...');
        await migrator.migrate('up');
        console.log('Migrations completed successfully!');
        break;
      case 'down':
        console.log('Rolling back last migration...');
        await migrator.migrate('down');
        console.log('Migration rolled back successfully!');
        break;
      case 'status':
        console.log('Migration status:');
        const status = await migrator.getStatus();
        console.log(`Applied: ${status.applied}, Pending: ${status.pending}, Total: ${status.total}`);
        break;
      default:
        console.log('Usage: npm run migrate [up|down|status]');
        process.exit(1);
    }

    await db.close();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    await db.close();
    process.exit(1);
  }
}

runMigrations();