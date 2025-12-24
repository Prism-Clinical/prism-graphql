import { Migration, MigrationStatus } from '@shared/data-layer/src/types';
export declare class Migrator {
    private migrationsPath;
    constructor(migrationsPath?: string);
    initializeMigrationTable(): Promise<void>;
    getAppliedMigrations(): Promise<MigrationStatus[]>;
    getAllMigrations(): Promise<Migration[]>;
    getPendingMigrations(): Promise<Migration[]>;
    migrate(direction?: 'up' | 'down', target?: string): Promise<void>;
    private migrateUp;
    private migrateDown;
    private parseMigrationFile;
    private extractMigrationName;
    private extractTimestamp;
    private calculateChecksum;
    getStatus(): Promise<{
        applied: number;
        pending: number;
        total: number;
    }>;
}
//# sourceMappingURL=migrator.d.ts.map