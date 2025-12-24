"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ragSynthesisService = exports.guidelineService = exports.RAGQueryType = exports.SynthesisStatus = exports.EvidenceGrade = exports.GuidelineCategory = exports.GuidelineSource = void 0;
exports.initializeDatabase = initializeDatabase;
const uuid_1 = require("uuid");
var GuidelineSource;
(function (GuidelineSource) {
    GuidelineSource["USPSTF"] = "USPSTF";
    GuidelineSource["AHA"] = "AHA";
    GuidelineSource["ADA"] = "ADA";
    GuidelineSource["ACOG"] = "ACOG";
    GuidelineSource["AAP"] = "AAP";
    GuidelineSource["CDC"] = "CDC";
    GuidelineSource["WHO"] = "WHO";
    GuidelineSource["CUSTOM"] = "CUSTOM";
})(GuidelineSource || (exports.GuidelineSource = GuidelineSource = {}));
var GuidelineCategory;
(function (GuidelineCategory) {
    GuidelineCategory["SCREENING"] = "SCREENING";
    GuidelineCategory["PREVENTION"] = "PREVENTION";
    GuidelineCategory["TREATMENT"] = "TREATMENT";
    GuidelineCategory["MONITORING"] = "MONITORING";
    GuidelineCategory["LIFESTYLE"] = "LIFESTYLE";
    GuidelineCategory["IMMUNIZATION"] = "IMMUNIZATION";
})(GuidelineCategory || (exports.GuidelineCategory = GuidelineCategory = {}));
var EvidenceGrade;
(function (EvidenceGrade) {
    EvidenceGrade["A"] = "A";
    EvidenceGrade["B"] = "B";
    EvidenceGrade["C"] = "C";
    EvidenceGrade["D"] = "D";
    EvidenceGrade["I"] = "I";
})(EvidenceGrade || (exports.EvidenceGrade = EvidenceGrade = {}));
var SynthesisStatus;
(function (SynthesisStatus) {
    SynthesisStatus["PENDING"] = "PENDING";
    SynthesisStatus["PROCESSING"] = "PROCESSING";
    SynthesisStatus["COMPLETED"] = "COMPLETED";
    SynthesisStatus["FAILED"] = "FAILED";
})(SynthesisStatus || (exports.SynthesisStatus = SynthesisStatus = {}));
var RAGQueryType;
(function (RAGQueryType) {
    RAGQueryType["BY_CONDITION"] = "BY_CONDITION";
    RAGQueryType["BY_MEDICATION"] = "BY_MEDICATION";
    RAGQueryType["BY_DEMOGRAPHICS"] = "BY_DEMOGRAPHICS";
    RAGQueryType["BY_GUIDELINE_ID"] = "BY_GUIDELINE_ID";
})(RAGQueryType || (exports.RAGQueryType = RAGQueryType = {}));
let pool;
let redis;
function initializeDatabase(dbPool, redisClient) {
    pool = dbPool;
    redis = redisClient;
}
function ensureInitialized() {
    if (!pool || !redis) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
}
class GuidelineService {
    async getGuidelineById(id) {
        ensureInitialized();
        const cacheKey = `guideline:${id}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
        const query = `
      SELECT id, source, source_id as "sourceId", title, category,
             evidence_grade as "evidenceGrade", recommendation_strength as "recommendationStrength",
             applicable_conditions as "applicableConditions",
             applicable_medications as "applicableMedications",
             age_range_min as "ageRangeMin", age_range_max as "ageRangeMax",
             applicable_sex as "applicableSex", summary_text as "summaryText",
             full_text as "fullText", published_date as "publishedDate",
             last_reviewed_date as "lastReviewedDate", expiration_date as "expirationDate",
             version, created_at as "createdAt", updated_at as "updatedAt"
      FROM guidelines
      WHERE id = $1
    `;
        try {
            const result = await pool.query(query, [id]);
            const guideline = result.rows[0] || null;
            if (guideline) {
                await redis.setex(cacheKey, 3600, JSON.stringify(guideline));
            }
            return guideline;
        }
        catch (error) {
            console.error('Error getting guideline:', error);
            return null;
        }
    }
    async getGuidelines(filter, pagination = {}) {
        ensureInitialized();
        const { first = 50, after } = pagination;
        let query = `
      SELECT id, source, source_id as "sourceId", title, category,
             evidence_grade as "evidenceGrade", recommendation_strength as "recommendationStrength",
             applicable_conditions as "applicableConditions",
             applicable_medications as "applicableMedications",
             age_range_min as "ageRangeMin", age_range_max as "ageRangeMax",
             applicable_sex as "applicableSex", summary_text as "summaryText",
             published_date as "publishedDate",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM guidelines
      WHERE 1=1
    `;
        const params = [];
        let paramIndex = 1;
        if (filter.source) {
            query += ` AND source = $${paramIndex}`;
            params.push(filter.source);
            paramIndex++;
        }
        if (filter.category) {
            query += ` AND category = $${paramIndex}`;
            params.push(filter.category);
            paramIndex++;
        }
        if (filter.evidenceGrade) {
            query += ` AND evidence_grade = $${paramIndex}`;
            params.push(filter.evidenceGrade);
            paramIndex++;
        }
        if (filter.conditionCode) {
            query += ` AND $${paramIndex} = ANY(applicable_conditions)`;
            params.push(filter.conditionCode);
            paramIndex++;
        }
        if (filter.medicationCode) {
            query += ` AND $${paramIndex} = ANY(applicable_medications)`;
            params.push(filter.medicationCode);
            paramIndex++;
        }
        if (after) {
            const decoded = Buffer.from(after, 'base64').toString('utf8');
            const [cursorDate, cursorId] = decoded.split('|');
            query += ` AND (created_at, id) < ($${paramIndex}, $${paramIndex + 1})`;
            params.push(cursorDate, cursorId);
            paramIndex += 2;
        }
        const countQuery = query.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];
        query += ` ORDER BY created_at DESC, id DESC LIMIT $${paramIndex}`;
        params.push(first + 1);
        try {
            const result = await pool.query(query, params);
            const countResult = await pool.query(countQuery, params.slice(0, -1));
            const hasNextPage = result.rows.length > first;
            const guidelines = result.rows.slice(0, first);
            const totalCount = parseInt(countResult.rows[0].count);
            return { guidelines, hasNextPage, totalCount };
        }
        catch (error) {
            console.error('Error getting guidelines:', error);
            return { guidelines: [], hasNextPage: false, totalCount: 0 };
        }
    }
    async getGuidelinesForPatient(patientId, options = {}) {
        return { guidelines: [], hasNextPage: false, totalCount: 0 };
    }
}
class RAGSynthesisService {
    async getSynthesisById(id) {
        ensureInitialized();
        const query = `
      SELECT id, patient_id as "patientId", query_type as "queryType",
             query_condition_codes as "queryConditionCodes",
             query_medication_codes as "queryMedicationCodes",
             status, processing_time_ms as "processingTimeMs",
             guidelines_consulted as "guidelinesConsulted",
             created_at as "createdAt", created_by as "createdBy"
      FROM rag_syntheses
      WHERE id = $1
    `;
        try {
            const result = await pool.query(query, [id]);
            return result.rows[0] || null;
        }
        catch (error) {
            console.error('Error getting RAG synthesis:', error);
            return null;
        }
    }
    async requestSynthesis(input) {
        ensureInitialized();
        const id = (0, uuid_1.v4)();
        const query = `
      INSERT INTO rag_syntheses (id, patient_id, query_type, query_condition_codes, query_medication_codes, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, patient_id as "patientId", query_type as "queryType",
                query_condition_codes as "queryConditionCodes",
                query_medication_codes as "queryMedicationCodes",
                status, created_at as "createdAt", created_by as "createdBy"
    `;
        try {
            const result = await pool.query(query, [
                id,
                input.patientId,
                input.queryType,
                input.conditionCodes || [],
                input.medicationCodes || [],
                SynthesisStatus.PENDING,
                input.createdBy
            ]);
            return result.rows[0];
        }
        catch (error) {
            console.error('Error creating RAG synthesis:', error);
            throw error;
        }
    }
    async getSynthesesForPatient(patientId, pagination = {}) {
        ensureInitialized();
        const { first = 50 } = pagination;
        const query = `
      SELECT id, patient_id as "patientId", query_type as "queryType",
             query_condition_codes as "queryConditionCodes",
             query_medication_codes as "queryMedicationCodes",
             status, processing_time_ms as "processingTimeMs",
             guidelines_consulted as "guidelinesConsulted",
             created_at as "createdAt", created_by as "createdBy"
      FROM rag_syntheses
      WHERE patient_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
        try {
            const result = await pool.query(query, [patientId, first]);
            return result.rows;
        }
        catch (error) {
            console.error('Error getting syntheses for patient:', error);
            return [];
        }
    }
}
exports.guidelineService = new GuidelineService();
exports.ragSynthesisService = new RAGSynthesisService();
//# sourceMappingURL=database.js.map