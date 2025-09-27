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

export const recommendationsSource: Recommendation[] = [
  {
    id: "1",
    caseId: "case-1",
    providerId: "provider-1",
    title: "Annual Physical Examination",
    description: "Complete annual physical exam with blood work and vital signs assessment",
    priority: Priority.Medium,
    status: RecommendationStatus.Active,
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2024-01-15T10:00:00Z"
  },
  {
    id: "2",
    caseId: "case-2", 
    providerId: "provider-1",
    title: "Diabetes Management Review",
    description: "Quarterly diabetes management review including A1C testing and medication adjustment",
    priority: Priority.High,
    status: RecommendationStatus.Active,
    createdAt: "2024-01-20T14:30:00Z",
    updatedAt: "2024-01-20T14:30:00Z"
  },
  {
    id: "3",
    caseId: "case-1",
    providerId: "provider-2", 
    title: "Cardiology Consultation",
    description: "Follow-up cardiology consultation for chest pain evaluation",
    priority: Priority.Urgent,
    status: RecommendationStatus.Draft,
    createdAt: "2024-01-25T09:15:00Z",
    updatedAt: "2024-01-25T09:15:00Z"
  }
];