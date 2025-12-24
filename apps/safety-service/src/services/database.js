"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewQueueService = exports.safetyCheckService = exports.OverrideReason = exports.ReviewPriority = exports.ReviewQueueStatus = exports.SafetyCheckStatus = exports.SafetySeverity = exports.SafetyCheckType = void 0;
exports.initializeDatabase = initializeDatabase;
var SafetyCheckType;
(function (SafetyCheckType) {
    SafetyCheckType["DRUG_INTERACTION"] = "DRUG_INTERACTION";
    SafetyCheckType["ALLERGY_CONFLICT"] = "ALLERGY_CONFLICT";
    SafetyCheckType["CONTRAINDICATION"] = "CONTRAINDICATION";
    SafetyCheckType["DOSAGE_VALIDATION"] = "DOSAGE_VALIDATION";
    SafetyCheckType["DUPLICATE_THERAPY"] = "DUPLICATE_THERAPY";
    SafetyCheckType["AGE_APPROPRIATENESS"] = "AGE_APPROPRIATENESS";
    SafetyCheckType["PREGNANCY_SAFETY"] = "PREGNANCY_SAFETY";
    SafetyCheckType["RENAL_ADJUSTMENT"] = "RENAL_ADJUSTMENT";
    SafetyCheckType["HEPATIC_ADJUSTMENT"] = "HEPATIC_ADJUSTMENT";
})(SafetyCheckType || (exports.SafetyCheckType = SafetyCheckType = {}));
var SafetySeverity;
(function (SafetySeverity) {
    SafetySeverity["INFO"] = "INFO";
    SafetySeverity["WARNING"] = "WARNING";
    SafetySeverity["CRITICAL"] = "CRITICAL";
    SafetySeverity["CONTRAINDICATED"] = "CONTRAINDICATED";
})(SafetySeverity || (exports.SafetySeverity = SafetySeverity = {}));
var SafetyCheckStatus;
(function (SafetyCheckStatus) {
    SafetyCheckStatus["PENDING"] = "PENDING";
    SafetyCheckStatus["PASSED"] = "PASSED";
    SafetyCheckStatus["FLAGGED"] = "FLAGGED";
    SafetyCheckStatus["OVERRIDDEN"] = "OVERRIDDEN";
    SafetyCheckStatus["BLOCKED"] = "BLOCKED";
})(SafetyCheckStatus || (exports.SafetyCheckStatus = SafetyCheckStatus = {}));
var ReviewQueueStatus;
(function (ReviewQueueStatus) {
    ReviewQueueStatus["PENDING_REVIEW"] = "PENDING_REVIEW";
    ReviewQueueStatus["IN_REVIEW"] = "IN_REVIEW";
    ReviewQueueStatus["APPROVED"] = "APPROVED";
    ReviewQueueStatus["REJECTED"] = "REJECTED";
    ReviewQueueStatus["ESCALATED"] = "ESCALATED";
})(ReviewQueueStatus || (exports.ReviewQueueStatus = ReviewQueueStatus = {}));
var ReviewPriority;
(function (ReviewPriority) {
    ReviewPriority["P0_CRITICAL"] = "P0_CRITICAL";
    ReviewPriority["P1_HIGH"] = "P1_HIGH";
    ReviewPriority["P2_MEDIUM"] = "P2_MEDIUM";
    ReviewPriority["P3_LOW"] = "P3_LOW";
})(ReviewPriority || (exports.ReviewPriority = ReviewPriority = {}));
var OverrideReason;
(function (OverrideReason) {
    OverrideReason["CLINICAL_JUDGMENT"] = "CLINICAL_JUDGMENT";
    OverrideReason["PATIENT_INFORMED_CONSENT"] = "PATIENT_INFORMED_CONSENT";
    OverrideReason["NO_ALTERNATIVE_AVAILABLE"] = "NO_ALTERNATIVE_AVAILABLE";
    OverrideReason["MONITORING_IN_PLACE"] = "MONITORING_IN_PLACE";
    OverrideReason["DOSAGE_ADJUSTED"] = "DOSAGE_ADJUSTED";
    OverrideReason["SPECIALIST_APPROVED"] = "SPECIALIST_APPROVED";
})(OverrideReason || (exports.OverrideReason = OverrideReason = {}));
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
const SLA_HOURS = {
    [ReviewPriority.P0_CRITICAL]: 1,
    [ReviewPriority.P1_HIGH]: 4,
    [ReviewPriority.P2_MEDIUM]: 24,
    [ReviewPriority.P3_LOW]: 72
};
class SafetyCheckService {
    async getSafetyCheckById(id) {
        ensureInitialized();
        const query = `
      SELECT id, patient_id as "patientId", encounter_id as "encounterId",
             check_type as "checkType", trigger_medication_code as "triggerMedicationCode",
             trigger_condition_code as "triggerConditionCode",
             status, severity, title, description, clinical_rationale as "clinicalRationale",
             related_medications as "relatedMedications",
             related_conditions as "relatedConditions",
             related_allergies as "relatedAllergies",
             guideline_references as "guidelineReferences",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM safety_checks
      WHERE id = $1
    `;
        try {
            const result = await pool.query(query, [id]);
            return result.rows[0] || null;
        }
        catch (error) {
            console.error('Error getting safety check:', error);
            return null;
        }
    }
    async getSafetyChecks(filter, pagination = {}) {
        ensureInitialized();
        const { first = 50, after } = pagination;
        let query = `
      SELECT id, patient_id as "patientId", encounter_id as "encounterId",
             check_type as "checkType", trigger_medication_code as "triggerMedicationCode",
             trigger_condition_code as "triggerConditionCode",
             status, severity, title, description, clinical_rationale as "clinicalRationale",
             related_medications as "relatedMedications",
             related_conditions as "relatedConditions",
             related_allergies as "relatedAllergies",
             guideline_references as "guidelineReferences",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM safety_checks
      WHERE 1=1
    `;
        const params = [];
        let paramIndex = 1;
        if (filter.patientId) {
            query += ` AND patient_id = $${paramIndex}`;
            params.push(filter.patientId);
            paramIndex++;
        }
        if (filter.encounterId) {
            query += ` AND encounter_id = $${paramIndex}`;
            params.push(filter.encounterId);
            paramIndex++;
        }
        if (filter.checkType) {
            query += ` AND check_type = $${paramIndex}`;
            params.push(filter.checkType);
            paramIndex++;
        }
        if (filter.status) {
            query += ` AND status = $${paramIndex}`;
            params.push(filter.status);
            paramIndex++;
        }
        if (filter.severity) {
            query += ` AND severity = $${paramIndex}`;
            params.push(filter.severity);
            paramIndex++;
        }
        const countQuery = query.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];
        query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
        params.push(first + 1);
        try {
            const result = await pool.query(query, params);
            const countResult = await pool.query(countQuery, params.slice(0, -1));
            const hasNextPage = result.rows.length > first;
            const checks = result.rows.slice(0, first);
            const totalCount = parseInt(countResult.rows[0].count);
            return { checks, hasNextPage, totalCount };
        }
        catch (error) {
            console.error('Error getting safety checks:', error);
            return { checks: [], hasNextPage: false, totalCount: 0 };
        }
    }
    async getActiveSafetyAlerts(patientId) {
        ensureInitialized();
        const query = `
      SELECT id, patient_id as "patientId", encounter_id as "encounterId",
             check_type as "checkType", status, severity, title, description,
             clinical_rationale as "clinicalRationale",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM safety_checks
      WHERE patient_id = $1
        AND status IN ('FLAGGED', 'BLOCKED')
        AND severity IN ('CRITICAL', 'CONTRAINDICATED')
      ORDER BY severity DESC, created_at DESC
    `;
        try {
            const result = await pool.query(query, [patientId]);
            return result.rows;
        }
        catch (error) {
            console.error('Error getting active safety alerts:', error);
            return [];
        }
    }
    async validateSafety(input) {
        return { checks: [], blockers: [], warnings: [] };
    }
    async overrideSafetyCheck(id, override) {
        ensureInitialized();
        const expiresAt = override.expiresInHours
            ? new Date(Date.now() + override.expiresInHours * 60 * 60 * 1000)
            : null;
        const query = `
      UPDATE safety_checks
      SET status = 'OVERRIDDEN',
          override_reason = $1,
          override_justification = $2,
          overridden_by = $3,
          overridden_at = NOW(),
          override_expires_at = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING id, patient_id as "patientId", encounter_id as "encounterId",
                check_type as "checkType", status, severity, title, description,
                clinical_rationale as "clinicalRationale",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
        try {
            const result = await pool.query(query, [
                override.reason,
                override.justification,
                override.overriddenBy,
                expiresAt,
                id
            ]);
            return result.rows[0] || null;
        }
        catch (error) {
            console.error('Error overriding safety check:', error);
            return null;
        }
    }
}
class ReviewQueueService {
    async getReviewQueueItemById(id) {
        ensureInitialized();
        const query = `
      SELECT id, patient_id as "patientId", safety_check_id as "safetyCheckId",
             recommendation_id as "recommendationId", status, priority,
             assigned_to as "assignedTo", assigned_at as "assignedAt",
             sla_deadline as "slaDeadline",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM review_queue
      WHERE id = $1
    `;
        try {
            const result = await pool.query(query, [id]);
            return result.rows[0] || null;
        }
        catch (error) {
            console.error('Error getting review queue item:', error);
            return null;
        }
    }
    async getReviewQueue(filter, pagination = {}) {
        ensureInitialized();
        const { first = 50 } = pagination;
        let query = `
      SELECT id, patient_id as "patientId", safety_check_id as "safetyCheckId",
             recommendation_id as "recommendationId", status, priority,
             assigned_to as "assignedTo", assigned_at as "assignedAt",
             sla_deadline as "slaDeadline",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM review_queue
      WHERE 1=1
    `;
        const params = [];
        let paramIndex = 1;
        if (filter.patientId) {
            query += ` AND patient_id = $${paramIndex}`;
            params.push(filter.patientId);
            paramIndex++;
        }
        if (filter.assignedTo) {
            query += ` AND assigned_to = $${paramIndex}`;
            params.push(filter.assignedTo);
            paramIndex++;
        }
        if (filter.status) {
            query += ` AND status = $${paramIndex}`;
            params.push(filter.status);
            paramIndex++;
        }
        if (filter.priority) {
            query += ` AND priority = $${paramIndex}`;
            params.push(filter.priority);
            paramIndex++;
        }
        if (filter.isOverdue === true) {
            query += ` AND sla_deadline < NOW() AND status IN ('PENDING_REVIEW', 'IN_REVIEW')`;
        }
        const countQuery = query.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];
        query += ` ORDER BY priority ASC, sla_deadline ASC LIMIT $${paramIndex}`;
        params.push(first + 1);
        try {
            const result = await pool.query(query, params);
            const countResult = await pool.query(countQuery, params.slice(0, -1));
            const hasNextPage = result.rows.length > first;
            const items = result.rows.slice(0, first);
            const totalCount = parseInt(countResult.rows[0].count);
            return { items, hasNextPage, totalCount };
        }
        catch (error) {
            console.error('Error getting review queue:', error);
            return { items: [], hasNextPage: false, totalCount: 0 };
        }
    }
    async assignReview(id, assignTo) {
        ensureInitialized();
        const query = `
      UPDATE review_queue
      SET assigned_to = $1, assigned_at = NOW(), status = 'IN_REVIEW', updated_at = NOW()
      WHERE id = $2
      RETURNING id, patient_id as "patientId", safety_check_id as "safetyCheckId",
                recommendation_id as "recommendationId", status, priority,
                assigned_to as "assignedTo", assigned_at as "assignedAt",
                sla_deadline as "slaDeadline",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
        try {
            const result = await pool.query(query, [assignTo, id]);
            return result.rows[0] || null;
        }
        catch (error) {
            console.error('Error assigning review:', error);
            return null;
        }
    }
    async resolveReview(id, resolution) {
        ensureInitialized();
        const query = `
      UPDATE review_queue
      SET status = $1, resolution_notes = $2, escalation_reason = $3,
          resolved_by = $4, resolved_at = NOW(), updated_at = NOW()
      WHERE id = $5
      RETURNING id, patient_id as "patientId", safety_check_id as "safetyCheckId",
                recommendation_id as "recommendationId", status, priority,
                assigned_to as "assignedTo", assigned_at as "assignedAt",
                sla_deadline as "slaDeadline",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
        try {
            const result = await pool.query(query, [
                resolution.decision,
                resolution.notes || null,
                resolution.escalationReason || null,
                resolution.resolvedBy,
                id
            ]);
            return result.rows[0] || null;
        }
        catch (error) {
            console.error('Error resolving review:', error);
            return null;
        }
    }
}
exports.safetyCheckService = new SafetyCheckService();
exports.reviewQueueService = new ReviewQueueService();
//# sourceMappingURL=database.js.map