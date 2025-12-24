"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Gender = exports.CaseStatus = exports.CasePriority = void 0;
var CasePriority;
(function (CasePriority) {
    CasePriority["High"] = "HIGH";
    CasePriority["Low"] = "LOW";
    CasePriority["Medium"] = "MEDIUM";
    CasePriority["Urgent"] = "URGENT";
})(CasePriority || (exports.CasePriority = CasePriority = {}));
var CaseStatus;
(function (CaseStatus) {
    CaseStatus["Cancelled"] = "CANCELLED";
    CaseStatus["Closed"] = "CLOSED";
    CaseStatus["InProgress"] = "IN_PROGRESS";
    CaseStatus["Open"] = "OPEN";
})(CaseStatus || (exports.CaseStatus = CaseStatus = {}));
var Gender;
(function (Gender) {
    Gender["Female"] = "FEMALE";
    Gender["Male"] = "MALE";
    Gender["Other"] = "OTHER";
    Gender["Unknown"] = "UNKNOWN";
})(Gender || (exports.Gender = Gender = {}));
//# sourceMappingURL=resolvers-types.js.map