import { Pool } from 'pg';
import { Redis } from 'ioredis';
export declare enum Priority {
    LOW = "LOW",
    MEDIUM = "MEDIUM",
    HIGH = "HIGH",
    URGENT = "URGENT"
}
export declare enum RecommendationStatus {
    DRAFT = "DRAFT",
    ACTIVE = "ACTIVE",
    COMPLETED = "COMPLETED",
    CANCELLED = "CANCELLED"
}
export interface Recommendation {
    id: string;
    patientId: string;
    providerId: string;
    title: string;
    description: string;
    priority: Priority;
    status: RecommendationStatus;
    createdAt: Date;
    updatedAt: Date;
}
export declare function initializeDatabase(dbPool: Pool, redisClient: Redis): void;
declare class RecommendationService {
    createRecommendation(data: Omit<Recommendation, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Recommendation>;
    getRecommendationById(id: string): Promise<Recommendation | null>;
    getRecommendationsForPatient(patientId: string, options?: {
        status?: RecommendationStatus;
        limit?: number;
        offset?: number;
    }): Promise<Recommendation[]>;
    getRecommendationsByProvider(providerId: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<Recommendation[]>;
    updateRecommendationStatus(id: string, status: RecommendationStatus): Promise<Recommendation | null>;
    updateRecommendation(id: string, updates: Partial<Omit<Recommendation, 'id' | 'caseId' | 'providerId' | 'createdAt' | 'updatedAt'>>): Promise<Recommendation | null>;
    deleteRecommendation(id: string): Promise<boolean>;
    private invalidateRelatedCaches;
}
export declare const recommendationService: RecommendationService;
export {};
//# sourceMappingURL=database.d.ts.map