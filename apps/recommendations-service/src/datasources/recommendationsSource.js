"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recommendationsSource = void 0;
const resolvers_types_1 = require("@recommendations/__generated__/resolvers-types");
exports.recommendationsSource = [
    {
        id: "1",
        caseId: "case-1",
        providerId: "provider-1",
        title: "Annual Physical Examination",
        description: "Complete annual physical exam with blood work and vital signs assessment",
        priority: resolvers_types_1.Priority.Medium,
        status: resolvers_types_1.RecommendationStatus.Active,
        createdAt: "2024-01-15T10:00:00Z",
        updatedAt: "2024-01-15T10:00:00Z"
    },
    {
        id: "2",
        caseId: "case-2",
        providerId: "provider-1",
        title: "Diabetes Management Review",
        description: "Quarterly diabetes management review including A1C testing and medication adjustment",
        priority: resolvers_types_1.Priority.High,
        status: resolvers_types_1.RecommendationStatus.Active,
        createdAt: "2024-01-20T14:30:00Z",
        updatedAt: "2024-01-20T14:30:00Z"
    },
    {
        id: "3",
        caseId: "case-1",
        providerId: "provider-2",
        title: "Cardiology Consultation",
        description: "Follow-up cardiology consultation for chest pain evaluation",
        priority: resolvers_types_1.Priority.Urgent,
        status: resolvers_types_1.RecommendationStatus.Draft,
        createdAt: "2024-01-25T09:15:00Z",
        updatedAt: "2024-01-25T09:15:00Z"
    }
];
//# sourceMappingURL=recommendationsSource.js.map