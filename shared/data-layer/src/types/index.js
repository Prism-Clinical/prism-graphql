"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobPriority = exports.RecommendationJobType = exports.JobStatus = exports.ClinicalDataType = exports.SessionStatus = void 0;
var SessionStatus;
(function (SessionStatus) {
    SessionStatus["ACTIVE"] = "active";
    SessionStatus["EXPIRED"] = "expired";
    SessionStatus["TERMINATED"] = "terminated";
})(SessionStatus || (exports.SessionStatus = SessionStatus = {}));
var ClinicalDataType;
(function (ClinicalDataType) {
    ClinicalDataType["DEMOGRAPHICS"] = "demographics";
    ClinicalDataType["VITALS"] = "vitals";
    ClinicalDataType["MEDICATIONS"] = "medications";
    ClinicalDataType["DIAGNOSES"] = "diagnoses";
    ClinicalDataType["LAB_RESULTS"] = "lab_results";
    ClinicalDataType["PROCEDURES"] = "procedures";
    ClinicalDataType["ENCOUNTERS"] = "encounters";
})(ClinicalDataType || (exports.ClinicalDataType = ClinicalDataType = {}));
var JobStatus;
(function (JobStatus) {
    JobStatus["PENDING"] = "pending";
    JobStatus["RUNNING"] = "running";
    JobStatus["COMPLETED"] = "completed";
    JobStatus["FAILED"] = "failed";
    JobStatus["CANCELLED"] = "cancelled";
})(JobStatus || (exports.JobStatus = JobStatus = {}));
var RecommendationJobType;
(function (RecommendationJobType) {
    RecommendationJobType["INITIAL_ASSESSMENT"] = "initial_assessment";
    RecommendationJobType["DATA_UPDATE_TRIGGER"] = "data_update_trigger";
    RecommendationJobType["PERIODIC_REVIEW"] = "periodic_review";
    RecommendationJobType["EMERGENCY_ALERT"] = "emergency_alert";
})(RecommendationJobType || (exports.RecommendationJobType = RecommendationJobType = {}));
var JobPriority;
(function (JobPriority) {
    JobPriority[JobPriority["LOW"] = 1] = "LOW";
    JobPriority[JobPriority["NORMAL"] = 2] = "NORMAL";
    JobPriority[JobPriority["HIGH"] = 3] = "HIGH";
    JobPriority[JobPriority["URGENT"] = 4] = "URGENT";
    JobPriority[JobPriority["EMERGENCY"] = 5] = "EMERGENCY";
})(JobPriority || (exports.JobPriority = JobPriority = {}));
//# sourceMappingURL=index.js.map