import { Pool } from 'pg';
import { Redis } from 'ioredis';
export interface Address {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
}
export interface Provider {
    id: string;
    npi: string;
    firstName: string;
    lastName: string;
    specialty: string;
    credentials: string;
    email: string;
    phone: string;
    facilityId?: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface Facility {
    id: string;
    name: string;
    address: Address;
    phone: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare enum VisitType {
    CONSULTATION = "CONSULTATION",
    FOLLOW_UP = "FOLLOW_UP",
    PROCEDURE = "PROCEDURE",
    SURGERY = "SURGERY",
    EMERGENCY = "EMERGENCY",
    ROUTINE_CHECK = "ROUTINE_CHECK",
    DIAGNOSTIC = "DIAGNOSTIC",
    THERAPY = "THERAPY"
}
export declare enum VisitStatus {
    SCHEDULED = "SCHEDULED",
    CHECKED_IN = "CHECKED_IN",
    IN_PROGRESS = "IN_PROGRESS",
    COMPLETED = "COMPLETED",
    CANCELLED = "CANCELLED",
    NO_SHOW = "NO_SHOW"
}
export interface Visit {
    id: string;
    patientId: string;
    hospitalId: string;
    providerId: string;
    caseIds: string[];
    type: VisitType;
    status: VisitStatus;
    scheduledAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    duration?: number;
    notes?: string;
    chiefComplaint?: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare function initializeDatabase(dbPool: Pool, redisClient: Redis): void;
declare class ProviderService {
    createProvider(data: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>): Promise<Provider>;
    getProviderById(id: string): Promise<Provider | null>;
    getProviderByNpi(npi: string): Promise<Provider | null>;
    getProviders(options?: {
        specialty?: string;
        limit?: number;
        offset?: number;
    }): Promise<Provider[]>;
    updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Provider | null>;
    deleteProvider(id: string): Promise<boolean>;
}
declare class FacilityService {
    createFacility(data: Omit<Facility, 'id' | 'createdAt' | 'updatedAt'>): Promise<Facility>;
    getFacilityById(id: string): Promise<Facility | null>;
}
declare class VisitService {
    createVisit(data: Omit<Visit, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Visit>;
    getVisitById(id: string): Promise<Visit | null>;
    getVisitsForProvider(providerId: string): Promise<Visit[]>;
    updateVisit(id: string, updates: Partial<Omit<Visit, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Visit | null>;
}
export declare const providerService: ProviderService;
export declare const facilityService: FacilityService;
export declare const visitService: VisitService;
export {};
//# sourceMappingURL=database.d.ts.map