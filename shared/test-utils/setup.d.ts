import { Pool } from 'pg';
import { Redis } from 'ioredis';
export declare const testConfig: {
    database: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
    };
    redis: {
        host: string;
        port: number;
        db: number;
    };
};
export declare function setupTestDatabase(): Promise<Pool>;
export declare function setupTestRedis(): Promise<Redis>;
export declare function cleanupTestDatabase(): Promise<void>;
export declare function closeTestConnections(): Promise<void>;
export declare const testDataGenerators: {
    patient: (overrides?: any) => any;
    provider: (overrides?: any) => any;
    institution: (overrides?: any) => any;
    recommendation: (overrides?: any) => any;
    recommendationItem: (overrides?: any) => any;
};
export declare const testHelpers: {
    insertPatient(pool: Pool, patientData: any): Promise<any>;
    insertProvider(pool: Pool, providerData: any): Promise<any>;
    insertInstitution(pool: Pool, institutionData: any): Promise<any>;
    insertRecommendation(pool: Pool, recommendationData: any): Promise<any>;
    insertRecommendationItem(pool: Pool, itemData: any): Promise<any>;
};
//# sourceMappingURL=setup.d.ts.map