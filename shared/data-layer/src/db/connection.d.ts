import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseConfig } from '@shared/data-layer/src/types';
declare class DatabaseConnection {
    private pool;
    private config;
    initialize(config: DatabaseConfig): void;
    getClient(): Promise<PoolClient>;
    query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
    getStats(): {
        totalCount: number;
        idleCount: number;
        waitingCount: number;
    };
}
export declare const db: DatabaseConnection;
export declare function getDatabaseConfig(): DatabaseConfig;
export {};
//# sourceMappingURL=connection.d.ts.map