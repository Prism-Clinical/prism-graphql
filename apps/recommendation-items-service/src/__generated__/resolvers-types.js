"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationItemType = exports.EvidenceLevel = void 0;
var EvidenceLevel;
(function (EvidenceLevel) {
    EvidenceLevel["Consensus"] = "CONSENSUS";
    EvidenceLevel["ExpertOpinion"] = "EXPERT_OPINION";
    EvidenceLevel["LevelI"] = "LEVEL_I";
    EvidenceLevel["LevelIi"] = "LEVEL_II";
    EvidenceLevel["LevelIii"] = "LEVEL_III";
    EvidenceLevel["LevelIv"] = "LEVEL_IV";
    EvidenceLevel["LevelV"] = "LEVEL_V";
})(EvidenceLevel || (exports.EvidenceLevel = EvidenceLevel = {}));
var RecommendationItemType;
(function (RecommendationItemType) {
    RecommendationItemType["Education"] = "EDUCATION";
    RecommendationItemType["FollowUp"] = "FOLLOW_UP";
    RecommendationItemType["Imaging"] = "IMAGING";
    RecommendationItemType["LabTest"] = "LAB_TEST";
    RecommendationItemType["Lifestyle"] = "LIFESTYLE";
    RecommendationItemType["Medication"] = "MEDICATION";
    RecommendationItemType["Procedure"] = "PROCEDURE";
    RecommendationItemType["Screening"] = "SCREENING";
    RecommendationItemType["Therapy"] = "THERAPY";
    RecommendationItemType["Vaccination"] = "VACCINATION";
})(RecommendationItemType || (exports.RecommendationItemType = RecommendationItemType = {}));
//# sourceMappingURL=resolvers-types.js.map