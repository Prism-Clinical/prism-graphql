import { Pool } from 'pg';
import { Redis } from 'ioredis';
export interface Address {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
}
export declare enum InstitutionType {
    HOSPITAL_SYSTEM = "HOSPITAL_SYSTEM",
    MEDICAL_CENTER = "MEDICAL_CENTER",
    UNIVERSITY = "UNIVERSITY",
    RESEARCH_INSTITUTE = "RESEARCH_INSTITUTE",
    CLINIC_NETWORK = "CLINIC_NETWORK",
    GOVERNMENT_AGENCY = "GOVERNMENT_AGENCY"
}
export interface Institution {
    id: string;
    name: string;
    type: InstitutionType;
    address: Address;
    phone: string;
    email?: string;
    website?: string;
    accreditation: string[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export interface Hospital {
    id: string;
    name: string;
    institutionId: string;
    address: Address;
    phone: string;
    email?: string;
    website?: string;
    beds?: number;
    departments: string[];
    emergencyServices: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export declare function initializeDatabase(dbPool: Pool, redisClient: Redis): void;
declare class InstitutionService {
    createInstitution(data: Omit<Institution, 'id' | 'isActive' | 'createdAt' | 'updatedAt'>): Promise<Institution>;
    getInstitutionById(id: string): Promise<Institution | null>;
    getInstitutions(options?: {
        type?: InstitutionType;
        limit?: number;
        offset?: number;
    }): Promise<Institution[]>;
    updateInstitution(id: string, updates: Partial<Omit<Institution, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Institution | null>;
    deleteInstitution(id: string): Promise<boolean>;
    private invalidateListCaches;
}
declare class HospitalService {
    createHospital(data: Omit<Hospital, 'id' | 'isActive' | 'createdAt' | 'updatedAt'>): Promise<Hospital>;
    getHospitalById(id: string): Promise<Hospital | null>;
    getHospitalsByInstitution(institutionId: string): Promise<Hospital[]>;
    updateHospital(id: string, updates: Partial<Omit<Hospital, 'id' | 'institutionId' | 'createdAt' | 'updatedAt'>>): Promise<Hospital | null>;
    deleteHospital(id: string): Promise<boolean>;
}
export declare const institutionService: InstitutionService;
export declare const hospitalService: HospitalService;
export {};
//# sourceMappingURL=database.d.ts.map