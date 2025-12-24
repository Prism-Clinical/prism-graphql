import { RecommendationItemType, EvidenceLevel } from '@recommendation-items/__generated__/resolvers-types';
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
export declare const recommendationItemsSource: RecommendationItem[];
//# sourceMappingURL=recommendationItemsSource.d.ts.map