import { Pool } from 'pg';
import { Redis } from 'ioredis';
export declare enum SafetyCheckType {
    DRUG_INTERACTION = "DRUG_INTERACTION",
    ALLERGY_CONFLICT = "ALLERGY_CONFLICT",
    CONTRAINDICATION = "CONTRAINDICATION",
    DOSAGE_VALIDATION = "DOSAGE_VALIDATION",
    DUPLICATE_THERAPY = "DUPLICATE_THERAPY",
    AGE_APPROPRIATENESS = "AGE_APPROPRIATENESS",
    PREGNANCY_SAFETY = "PREGNANCY_SAFETY",
    RENAL_ADJUSTMENT = "RENAL_ADJUSTMENT",
    HEPATIC_ADJUSTMENT = "HEPATIC_ADJUSTMENT"
}
export declare enum SafetySeverity {
    INFO = "INFO",
    WARNING = "WARNING",
    CRITICAL = "CRITICAL",
    CONTRAINDICATED = "CONTRAINDICATED"
}
export declare enum SafetyCheckStatus {
    PENDING = "PENDING",
    PASSED = "PASSED",
    FLAGGED = "FLAGGED",
    OVERRIDDEN = "OVERRIDDEN",
    BLOCKED = "BLOCKED"
}
export declare enum ReviewQueueStatus {
    PENDING_REVIEW = "PENDING_REVIEW",
    IN_REVIEW = "IN_REVIEW",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED",
    ESCALATED = "ESCALATED"
}
export declare enum ReviewPriority {
    P0_CRITICAL = "P0_CRITICAL",
    P1_HIGH = "P1_HIGH",
    P2_MEDIUM = "P2_MEDIUM",
    P3_LOW = "P3_LOW"
}
export declare enum OverrideReason {
    CLINICAL_JUDGMENT = "CLINICAL_JUDGMENT",
    PATIENT_INFORMED_CONSENT = "PATIENT_INFORMED_CONSENT",
    NO_ALTERNATIVE_AVAILABLE = "NO_ALTERNATIVE_AVAILABLE",
    MONITORING_IN_PLACE = "MONITORING_IN_PLACE",
    DOSAGE_ADJUSTED = "DOSAGE_ADJUSTED",
    SPECIALIST_APPROVED = "SPECIALIST_APPROVED"
}
export interface SafetyCheck {
    id: string;
    patientId: string;
    encounterId?: string;
    checkType: SafetyCheckType;
    triggerMedicationCode?: string;
    triggerConditionCode?: string;
    status: SafetyCheckStatus;
    severity: SafetySeverity;
    title: string;
    description: string;
    clinicalRationale: string;
    relatedMedications: string[];
    relatedConditions: string[];
    relatedAllergies: string[];
    guidelineReferences: string[];
    createdAt: Date;
    updatedAt: Date;
}
export interface ReviewQueueItem {
    id: string;
    patientId: string;
    safetyCheckId: string;
    recommendationId?: string;
    status: ReviewQueueStatus;
    priority: ReviewPriority;
    assignedTo?: string;
    assignedAt?: Date;
    slaDeadline: Date;
    createdAt: Date;
    updatedAt: Date;
}
export declare function initializeDatabase(dbPool: Pool, redisClient: Redis): void;
declare class SafetyCheckService {
    getSafetyCheckById(id: string): Promise<SafetyCheck | null>;
    getSafetyChecks(filter: {
        patientId?: string;
        encounterId?: string;
        checkType?: SafetyCheckType;
        status?: SafetyCheckStatus;
        severity?: SafetySeverity;
    }, pagination?: {
        first?: number;
        after?: string;
    }): Promise<{
        checks: SafetyCheck[];
        hasNextPage: boolean;
        totalCount: number;
    }>;
    getActiveSafetyAlerts(patientId: string): Promise<SafetyCheck[]>;
    validateSafety(input: {
        patientId: string;
        encounterId?: string;
        medicationCodes?: string[];
        conditionCodes?: string[];
        checkTypes?: SafetyCheckType[];
    }): Promise<{
        checks: SafetyCheck[];
        blockers: SafetyCheck[];
        warnings: SafetyCheck[];
    }>;
    overrideSafetyCheck(id: string, override: {
        reason: OverrideReason;
        justification: string;
        expiresInHours?: number;
        overriddenBy: string;
    }): Promise<SafetyCheck | null>;
}
declare class ReviewQueueService {
    getReviewQueueItemById(id: string): Promise<ReviewQueueItem | null>;
    getReviewQueue(filter: {
        patientId?: string;
        assignedTo?: string;
        status?: ReviewQueueStatus;
        priority?: ReviewPriority;
        isOverdue?: boolean;
    }, pagination?: {
        first?: number;
        after?: string;
    }): Promise<{
        items: ReviewQueueItem[];
        hasNextPage: boolean;
        totalCount: number;
    }>;
    assignReview(id: string, assignTo: string): Promise<ReviewQueueItem | null>;
    resolveReview(id: string, resolution: {
        decision: ReviewQueueStatus;
        notes?: string;
        escalationReason?: string;
        resolvedBy: string;
    }): Promise<ReviewQueueItem | null>;
}
export declare const safetyCheckService: SafetyCheckService;
export declare const reviewQueueService: ReviewQueueService;
export {};
//# sourceMappingURL=database.d.ts.map