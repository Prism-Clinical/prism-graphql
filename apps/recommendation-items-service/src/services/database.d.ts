import { Pool } from 'pg';
import Redis from 'ioredis';
import { RecommendationItemType, EvidenceLevel, CreateRecommendationItemInput, UpdateRecommendationItemInput } from '@recommendation-items/__generated__/resolvers-types';
export interface RecommendationItem {
    id: string;
    type: RecommendationItemType;
    title: string;
    description: string;
    instructions?: string;
    evidenceLevel: EvidenceLevel;
    studyReferences: string[];
    guidelines: string[];
    contraindications: string[];
    sideEffects: string[];
    category: string;
    isActive: boolean;
}
export declare function initializeDatabase(dbPool: Pool, redisClient: Redis): void;
export declare class RecommendationItemService {
    getRecommendationItem(id: string): Promise<RecommendationItem | null>;
    getAllRecommendationItems(): Promise<RecommendationItem[]>;
    getRecommendationItemsByType(type: RecommendationItemType): Promise<RecommendationItem[]>;
    getRecommendationItemsByCategory(category: string): Promise<RecommendationItem[]>;
    getRecommendationItemsByEvidenceLevel(evidenceLevel: EvidenceLevel): Promise<RecommendationItem[]>;
    searchRecommendationItems(searchTerm: string): Promise<RecommendationItem[]>;
    createRecommendationItem(data: CreateRecommendationItemInput): Promise<RecommendationItem>;
    updateRecommendationItem(id: string, data: UpdateRecommendationItemInput): Promise<RecommendationItem | null>;
    deleteRecommendationItem(id: string): Promise<boolean>;
}
export declare const recommendationItemService: RecommendationItemService;
//# sourceMappingURL=database.d.ts.map