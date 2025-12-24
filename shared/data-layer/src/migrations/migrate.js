#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = require("@shared/data-layer/src/db/connection");
const migrator_1 = require("@shared/data-layer/src/migrations/migrator");
async function runMigrations() {
    try {
        const dbConfig = (0, connection_1.getDatabaseConfig)();
        connection_1.db.initialize(dbConfig);
        const migrator = new migrator_1.Migrator();
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
        await connection_1.db.close();
        process.exit(0);
    }
    catch (error) {
        console.error('Migration failed:', error);
        await connection_1.db.close();
        process.exit(1);
    }
}
runMigrations();
//# sourceMappingURL=migrate.js.map