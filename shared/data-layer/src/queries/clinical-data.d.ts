import { ClinicalData, ClinicalDataType } from '@shared/data-layer/src/types';
export declare class ClinicalDataQueries {
    static upsertClinicalData(patientId: string, dataType: ClinicalDataType, data: any, sourceSystem?: string, ttl?: number): Promise<ClinicalData>;
    static getClinicalData(patientId: string, dataType: ClinicalDataType, sourceSystem?: string): Promise<ClinicalData | null>;
    static getAllClinicalDataForPatient(patientId: string, includeExpired?: boolean): Promise<ClinicalData[]>;
    static getDataFreshness(patientId: string, dataTypes?: ClinicalDataType[]): Promise<Record<string, Date | null>>;
    static isDataFresh(patientId: string, dataType: ClinicalDataType, maxAgeSeconds: number): Promise<boolean>;
    static getExpiredData(limit?: number): Promise<ClinicalData[]>;
    static cleanupExpiredData(): Promise<number>;
    static deleteClinicalData(patientId: string, dataType: ClinicalDataType, sourceSystem?: string): Promise<boolean>;
    static deleteAllPatientData(patientId: string): Promise<number>;
    static updateTTL(patientId: string, dataType: ClinicalDataType, newTTL: number): Promise<boolean>;
    static getDataStats(): Promise<{
        totalRecords: number;
        recordsByType: Record<string, number>;
        expiredRecords: number;
    }>;
}
//# sourceMappingURL=clinical-data.d.ts.map