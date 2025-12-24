import { Priority, RecommendationStatus } from '@recommendations/__generated__/resolvers-types';
export interface Recommendation {
    id: string;
    caseId: string;
    providerId: string;
    title: string;
    description: string;
    priority: Priority;
    status: RecommendationStatus;
    createdAt: string;
    updatedAt: string;
}
export declare const recommendationsSource: Recommendation[];
//# sourceMappingURL=recommendationsSource.d.ts.map