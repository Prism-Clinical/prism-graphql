import { PatientSession } from '@shared/data-layer/src/types';
export declare class PatientSessionQueries {
    static createSession(patientId: string, epicPatientId: string, expiresAt: Date): Promise<PatientSession>;
    static getSessionById(sessionId: string): Promise<PatientSession | null>;
    static getActiveSessionByPatientId(patientId: string): Promise<PatientSession | null>;
    static updateSessionAccess(sessionId: string): Promise<void>;
    static updateDataFreshness(sessionId: string, dataType: string, timestamp: Date): Promise<void>;
    static expireSession(sessionId: string): Promise<void>;
    static terminateSession(sessionId: string): Promise<void>;
    static cleanupExpiredSessions(): Promise<number>;
    static getSessionsByPatientId(patientId: string, limit?: number): Promise<PatientSession[]>;
    static deleteSession(sessionId: string): Promise<boolean>;
}
//# sourceMappingURL=patient-sessions.d.ts.map