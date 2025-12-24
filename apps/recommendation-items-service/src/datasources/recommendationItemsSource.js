"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recommendationItemsSource = void 0;
const resolvers_types_1 = require("@recommendation-items/__generated__/resolvers-types");
exports.recommendationItemsSource = [
    {
        id: "item-1",
        type: resolvers_types_1.RecommendationItemType.LabTest,
        title: "Complete Blood Count (CBC)",
        description: "Routine blood work to check overall health status including red and white blood cell counts",
        instructions: "Fast for 8 hours before test. No water restriction.",
        evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
        studyReferences: ["PMID: 12345678", "PMID: 87654321"],
        guidelines: ["ACP Guidelines for Routine Screening", "USPSTF Recommendations"],
        contraindications: ["None for standard CBC"],
        sideEffects: ["Minimal - minor bruising at venipuncture site"],
        category: "Laboratory",
        isActive: true
    },
    {
        id: "item-2",
        type: resolvers_types_1.RecommendationItemType.Procedure,
        title: "Blood Pressure Monitoring",
        description: "Regular monitoring of systolic and diastolic blood pressure",
        instructions: "Sit quietly for 5 minutes before measurement. Use appropriate cuff size.",
        evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
        studyReferences: ["PMID: 11223344", "PMID: 55667788"],
        guidelines: ["AHA Blood Pressure Guidelines", "ESC/ESH Guidelines"],
        contraindications: ["Avoid arm with fistula or lymphedema"],
        sideEffects: ["None"],
        category: "Monitoring",
        isActive: true
    },
    {
        id: "item-3",
        type: resolvers_types_1.RecommendationItemType.Medication,
        title: "Metformin 500mg",
        description: "First-line medication for type 2 diabetes mellitus management",
        instructions: "Take twice daily with meals. Monitor blood glucose levels regularly.",
        evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
        studyReferences: ["PMID: 99887766", "PMID: 44556677"],
        guidelines: ["ADA Standards of Care", "EASD/ADA Consensus"],
        contraindications: ["eGFR <30 mL/min/1.73m²", "Severe liver disease", "Alcohol abuse"],
        sideEffects: ["GI upset", "Diarrhea", "Vitamin B12 deficiency (rare)"],
        category: "Antidiabetic",
        isActive: true
    },
    {
        id: "item-4",
        type: resolvers_types_1.RecommendationItemType.LabTest,
        title: "Hemoglobin A1C",
        description: "Glycemic control assessment over previous 2-3 months",
        instructions: "No fasting required. Can be performed at any time of day.",
        evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
        studyReferences: ["PMID: 13579246", "PMID: 97531486"],
        guidelines: ["ADA Glycemic Targets", "AACE Diabetes Guidelines"],
        contraindications: ["Hemoglobinopathies may affect accuracy"],
        sideEffects: ["None"],
        category: "Laboratory",
        isActive: true
    },
    {
        id: "item-5",
        type: resolvers_types_1.RecommendationItemType.Imaging,
        title: "Chest X-Ray",
        description: "Diagnostic imaging to evaluate pulmonary and cardiac structures",
        instructions: "Remove all metal objects. Wear hospital gown if needed.",
        evidenceLevel: resolvers_types_1.EvidenceLevel.LevelIi,
        studyReferences: ["PMID: 24681357", "PMID: 86420975"],
        guidelines: ["ACR Appropriateness Criteria", "CHEST Guidelines"],
        contraindications: ["Pregnancy (relative contraindication)"],
        sideEffects: ["Minimal radiation exposure"],
        category: "Diagnostic Imaging",
        isActive: true
    },
    {
        id: "item-6",
        type: resolvers_types_1.RecommendationItemType.Education,
        title: "Diabetes Self-Management Education",
        description: "Structured education program for diabetes management skills",
        instructions: "Attend scheduled sessions. Bring current medications and glucose log.",
        evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
        studyReferences: ["PMID: 75319864", "PMID: 15975328"],
        guidelines: ["ADA Standards of Care", "AADE Practice Guidelines"],
        contraindications: ["None"],
        sideEffects: ["None"],
        category: "Patient Education",
        isActive: true
    }
];
//# sourceMappingURL=recommendationItemsSource.js.map