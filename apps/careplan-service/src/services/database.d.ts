import { Pool } from 'pg';
import { Redis } from 'ioredis';
export declare enum CarePlanStatus {
    DRAFT = "DRAFT",
    PENDING_REVIEW = "PENDING_REVIEW",
    ACTIVE = "ACTIVE",
    ON_HOLD = "ON_HOLD",
    COMPLETED = "COMPLETED",
    CANCELLED = "CANCELLED"
}
export declare enum GoalStatus {
    NOT_STARTED = "NOT_STARTED",
    IN_PROGRESS = "IN_PROGRESS",
    ACHIEVED = "ACHIEVED",
    NOT_ACHIEVED = "NOT_ACHIEVED",
    CANCELLED = "CANCELLED"
}
export declare enum GoalPriority {
    HIGH = "HIGH",
    MEDIUM = "MEDIUM",
    LOW = "LOW"
}
export declare enum InterventionType {
    MEDICATION = "MEDICATION",
    PROCEDURE = "PROCEDURE",
    LIFESTYLE = "LIFESTYLE",
    MONITORING = "MONITORING",
    REFERRAL = "REFERRAL",
    EDUCATION = "EDUCATION",
    FOLLOW_UP = "FOLLOW_UP"
}
export declare enum InterventionStatus {
    SCHEDULED = "SCHEDULED",
    IN_PROGRESS = "IN_PROGRESS",
    COMPLETED = "COMPLETED",
    CANCELLED = "CANCELLED",
    DEFERRED = "DEFERRED"
}
export declare enum TemplateCategory {
    CHRONIC_DISEASE = "CHRONIC_DISEASE",
    PREVENTIVE_CARE = "PREVENTIVE_CARE",
    POST_PROCEDURE = "POST_PROCEDURE",
    MEDICATION_MANAGEMENT = "MEDICATION_MANAGEMENT",
    LIFESTYLE_MODIFICATION = "LIFESTYLE_MODIFICATION"
}
export interface CarePlan {
    id: string;
    patientId: string;
    title: string;
    status: CarePlanStatus;
    conditionCodes: string[];
    startDate: Date;
    targetEndDate?: Date;
    actualEndDate?: Date;
    nextReviewDate?: Date;
    lastReviewedAt?: Date;
    lastReviewedBy?: string;
    sourceTranscriptionId?: string;
    sourceRAGSynthesisId?: string;
    templateId?: string;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
}
export interface CarePlanGoal {
    id: string;
    carePlanId: string;
    description: string;
    targetValue?: string;
    targetDate?: Date;
    status: GoalStatus;
    priority: GoalPriority;
    currentValue?: string;
    percentComplete?: number;
    linkedInterventionIds: string[];
    guidelineReference?: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface CarePlanIntervention {
    id: string;
    carePlanId: string;
    type: InterventionType;
    description: string;
    medicationCode?: string;
    dosage?: string;
    frequency?: string;
    procedureCode?: string;
    referralSpecialty?: string;
    status: InterventionStatus;
    scheduledDate?: Date;
    completedDate?: Date;
    patientInstructions?: string;
    providerNotes?: string;
    guidelineReference?: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface CarePlanTemplate {
    id: string;
    name: string;
    category: TemplateCategory;
    conditionCodes: string[];
    guidelineSource?: string;
    evidenceGrade?: string;
    isActive: boolean;
    version: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare function initializeDatabase(dbPool: Pool, redisClient: Redis): void;
declare class CarePlanService {
    getCarePlanById(id: string): Promise<CarePlan | null>;
    getCarePlans(filter: {
        patientId?: string;
        status?: CarePlanStatus;
        conditionCode?: string;
        createdAfter?: Date;
        createdBefore?: Date;
    }, pagination?: {
        first?: number;
        after?: string;
    }): Promise<{
        carePlans: CarePlan[];
        hasNextPage: boolean;
        totalCount: number;
    }>;
    getActiveCarePlanForPatient(patientId: string): Promise<CarePlan | null>;
    createCarePlan(input: {
        patientId: string;
        title: string;
        conditionCodes: string[];
        startDate: Date;
        targetEndDate?: Date;
        templateId?: string;
        sourceTranscriptionId?: string;
        sourceRAGSynthesisId?: string;
        createdBy: string;
    }): Promise<CarePlan>;
    updateCarePlanStatus(id: string, status: CarePlanStatus): Promise<CarePlan | null>;
    getGoalsForCarePlan(carePlanId: string): Promise<CarePlanGoal[]>;
    getInterventionsForCarePlan(carePlanId: string): Promise<CarePlanIntervention[]>;
    addGoal(input: {
        carePlanId: string;
        description: string;
        targetValue?: string;
        targetDate?: Date;
        priority: GoalPriority;
        guidelineReference?: string;
    }): Promise<CarePlanGoal>;
    addIntervention(input: {
        carePlanId: string;
        type: InterventionType;
        description: string;
        medicationCode?: string;
        dosage?: string;
        frequency?: string;
        procedureCode?: string;
        referralSpecialty?: string;
        scheduledDate?: Date;
        patientInstructions?: string;
        guidelineReference?: string;
    }): Promise<CarePlanIntervention>;
}
declare class CarePlanTemplateService {
    getTemplateById(id: string): Promise<CarePlanTemplate | null>;
    getTemplates(filter: {
        category?: TemplateCategory;
        conditionCode?: string;
        isActive?: boolean;
    }, pagination?: {
        first?: number;
        after?: string;
    }): Promise<{
        templates: CarePlanTemplate[];
        hasNextPage: boolean;
        totalCount: number;
    }>;
    getTemplatesForConditions(conditionCodes: string[]): Promise<CarePlanTemplate[]>;
}
export declare const carePlanService: CarePlanService;
export declare const carePlanTemplateService: CarePlanTemplateService;
export {};
//# sourceMappingURL=database.d.ts.map