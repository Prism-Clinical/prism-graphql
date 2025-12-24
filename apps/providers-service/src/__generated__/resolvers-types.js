"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisitType = exports.VisitStatus = void 0;
var VisitStatus;
(function (VisitStatus) {
    VisitStatus["Cancelled"] = "CANCELLED";
    VisitStatus["CheckedIn"] = "CHECKED_IN";
    VisitStatus["Completed"] = "COMPLETED";
    VisitStatus["InProgress"] = "IN_PROGRESS";
    VisitStatus["NoShow"] = "NO_SHOW";
    VisitStatus["Scheduled"] = "SCHEDULED";
})(VisitStatus || (exports.VisitStatus = VisitStatus = {}));
var VisitType;
(function (VisitType) {
    VisitType["Consultation"] = "CONSULTATION";
    VisitType["Diagnostic"] = "DIAGNOSTIC";
    VisitType["Emergency"] = "EMERGENCY";
    VisitType["FollowUp"] = "FOLLOW_UP";
    VisitType["Procedure"] = "PROCEDURE";
    VisitType["RoutineCheck"] = "ROUTINE_CHECK";
    VisitType["Surgery"] = "SURGERY";
    VisitType["Therapy"] = "THERAPY";
})(VisitType || (exports.VisitType = VisitType = {}));
//# sourceMappingURL=resolvers-types.js.map