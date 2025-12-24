"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationJobQueries = exports.ClinicalDataQueries = exports.PatientSessionQueries = exports.Migrator = exports.getRedisConfig = exports.redis = exports.getDatabaseConfig = exports.db = void 0;
exports.initializeDataLayer = initializeDataLayer;
exports.healthCheckDataLayer = healthCheckDataLayer;
exports.closeDataLayer = closeDataLayer;
const connection_1 = require("@shared/data-layer/src/db/connection");
Object.defineProperty(exports, "db", { enumerable: true, get: function () { return connection_1.db; } });
Object.defineProperty(exports, "getDatabaseConfig", { enumerable: true, get: function () { return connection_1.getDatabaseConfig; } });
const connection_2 = require("@shared/data-layer/src/redis/connection");
Object.defineProperty(exports, "redis", { enumerable: true, get: function () { return connection_2.redis; } });
Object.defineProperty(exports, "getRedisConfig", { enumerable: true, get: function () { return connection_2.getRedisConfig; } });
const migrator_1 = require("@shared/data-layer/src/migrations/migrator");
Object.defineProperty(exports, "Migrator", { enumerable: true, get: function () { return migrator_1.Migrator; } });
var patient_sessions_1 = require("@shared/data-layer/src/queries/patient-sessions");
Object.defineProperty(exports, "PatientSessionQueries", { enumerable: true, get: function () { return patient_sessions_1.PatientSessionQueries; } });
var clinical_data_1 = require("@shared/data-layer/src/queries/clinical-data");
Object.defineProperty(exports, "ClinicalDataQueries", { enumerable: true, get: function () { return clinical_data_1.ClinicalDataQueries; } });
var recommendation_jobs_1 = require("@shared/data-layer/src/queries/recommendation-jobs");
Object.defineProperty(exports, "RecommendationJobQueries", { enumerable: true, get: function () { return recommendation_jobs_1.RecommendationJobQueries; } });
__exportStar(require("@shared/data-layer/src/types"), exports);
async function initializeDataLayer() {
    const dbConfig = (0, connection_1.getDatabaseConfig)();
    const redisConfig = (0, connection_2.getRedisConfig)();
    connection_1.db.initialize(dbConfig);
    await connection_2.redis.initialize(redisConfig);
    const migrator = new migrator_1.Migrator();
    await migrator.initializeMigrationTable();
    console.log('Data layer initialized successfully');
}
async function healthCheckDataLayer() {
    const [dbHealth, redisHealth] = await Promise.all([
        connection_1.db.healthCheck(),
        connection_2.redis.healthCheck()
    ]);
    return {
        database: dbHealth,
        redis: redisHealth,
        overall: dbHealth && redisHealth
    };
}
async function closeDataLayer() {
    await Promise.all([
        connection_1.db.close(),
        connection_2.redis.close()
    ]);
    console.log('Data layer connections closed');
}
//# sourceMappingURL=index.js.map