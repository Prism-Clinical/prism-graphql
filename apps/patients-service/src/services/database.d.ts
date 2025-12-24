export interface Patient {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender?: string;
    phone?: string;
    email?: string;
    address?: any;
    medicalRecordNumber?: string;
    epicPatientId?: string;
    emergencyContact?: any;
    insuranceInfo?: any;
    createdAt: string;
    updatedAt: string;
}
export declare class PatientService {
    getAllPatients(limit?: number, offset?: number): Promise<Patient[]>;
    getPatientById(id: string): Promise<Patient | null>;
    createPatient(patientData: Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>): Promise<Patient>;
    updatePatient(id: string, updates: Partial<Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Patient | null>;
    deletePatient(id: string): Promise<boolean>;
}
export declare const patientService: PatientService;
//# sourceMappingURL=database.d.ts.map