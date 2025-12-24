import { db, getDatabaseConfig } from '@shared/data-layer/src/db/connection';
import { redis, getRedisConfig } from '@shared/data-layer/src/redis/connection';
import { Migrator } from '@shared/data-layer/src/migrations/migrator';
export { db, getDatabaseConfig, redis, getRedisConfig, Migrator };
export { PatientSessionQueries } from '@shared/data-layer/src/queries/patient-sessions';
export { ClinicalDataQueries } from '@shared/data-layer/src/queries/clinical-data';
export { RecommendationJobQueries } from '@shared/data-layer/src/queries/recommendation-jobs';
export * from '@shared/data-layer/src/types';
export declare function initializeDataLayer(): Promise<void>;
export declare function healthCheckDataLayer(): Promise<{
    database: boolean;
    redis: boolean;
    overall: boolean;
}>;
export declare function closeDataLayer(): Promise<void>;
//# sourceMappingURL=index.d.ts.map