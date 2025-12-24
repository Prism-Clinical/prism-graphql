import { Pool } from 'pg';
import { Redis } from 'ioredis';
export declare enum GuidelineSource {
    USPSTF = "USPSTF",
    AHA = "AHA",
    ADA = "ADA",
    ACOG = "ACOG",
    AAP = "AAP",
    CDC = "CDC",
    WHO = "WHO",
    CUSTOM = "CUSTOM"
}
export declare enum GuidelineCategory {
    SCREENING = "SCREENING",
    PREVENTION = "PREVENTION",
    TREATMENT = "TREATMENT",
    MONITORING = "MONITORING",
    LIFESTYLE = "LIFESTYLE",
    IMMUNIZATION = "IMMUNIZATION"
}
export declare enum EvidenceGrade {
    A = "A",
    B = "B",
    C = "C",
    D = "D",
    I = "I"
}
export declare enum SynthesisStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED"
}
export declare enum RAGQueryType {
    BY_CONDITION = "BY_CONDITION",
    BY_MEDICATION = "BY_MEDICATION",
    BY_DEMOGRAPHICS = "BY_DEMOGRAPHICS",
    BY_GUIDELINE_ID = "BY_GUIDELINE_ID"
}
export interface Guideline {
    id: string;
    source: GuidelineSource;
    sourceId: string;
    title: string;
    category: GuidelineCategory;
    evidenceGrade?: EvidenceGrade;
    recommendationStrength?: string;
    applicableConditions: string[];
    applicableMedications: string[];
    ageRangeMin?: number;
    ageRangeMax?: number;
    applicableSex?: string;
    summaryText: string;
    fullText?: string;
    publishedDate?: Date;
    lastReviewedDate?: Date;
    expirationDate?: Date;
    version?: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface RAGSynthesis {
    id: string;
    patientId: string;
    queryType: RAGQueryType;
    queryConditionCodes?: string[];
    queryMedicationCodes?: string[];
    status: SynthesisStatus;
    processingTimeMs?: number;
    guidelinesConsulted?: number;
    createdAt: Date;
    createdBy: string;
}
export declare function initializeDatabase(dbPool: Pool, redisClient: Redis): void;
declare class GuidelineService {
    getGuidelineById(id: string): Promise<Guideline | null>;
    getGuidelines(filter: {
        source?: GuidelineSource;
        category?: GuidelineCategory;
        evidenceGrade?: EvidenceGrade;
        conditionCode?: string;
        medicationCode?: string;
    }, pagination?: {
        first?: number;
        after?: string;
    }): Promise<{
        guidelines: Guideline[];
        hasNextPage: boolean;
        totalCount: number;
    }>;
    getGuidelinesForPatient(patientId: string, options?: {
        category?: GuidelineCategory;
        first?: number;
        after?: string;
    }): Promise<{
        guidelines: Guideline[];
        hasNextPage: boolean;
        totalCount: number;
    }>;
}
declare class RAGSynthesisService {
    getSynthesisById(id: string): Promise<RAGSynthesis | null>;
    requestSynthesis(input: {
        patientId: string;
        queryType: RAGQueryType;
        conditionCodes?: string[];
        medicationCodes?: string[];
        createdBy: string;
    }): Promise<RAGSynthesis>;
    getSynthesesForPatient(patientId: string, pagination?: {
        first?: number;
        after?: string;
    }): Promise<RAGSynthesis[]>;
}
export declare const guidelineService: GuidelineService;
export declare const ragSynthesisService: RAGSynthesisService;
export {};
//# sourceMappingURL=database.d.ts.map