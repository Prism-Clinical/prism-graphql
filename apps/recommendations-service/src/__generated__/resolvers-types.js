"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationStatus = exports.Priority = void 0;
var Priority;
(function (Priority) {
    Priority["High"] = "HIGH";
    Priority["Low"] = "LOW";
    Priority["Medium"] = "MEDIUM";
    Priority["Urgent"] = "URGENT";
})(Priority || (exports.Priority = Priority = {}));
var RecommendationStatus;
(function (RecommendationStatus) {
    RecommendationStatus["Active"] = "ACTIVE";
    RecommendationStatus["Cancelled"] = "CANCELLED";
    RecommendationStatus["Completed"] = "COMPLETED";
    RecommendationStatus["Draft"] = "DRAFT";
})(RecommendationStatus || (exports.RecommendationStatus = RecommendationStatus = {}));
//# sourceMappingURL=resolvers-types.js.map