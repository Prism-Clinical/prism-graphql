import { Gender } from '@patients/__generated__/resolvers-types';
export interface Address {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
}
export interface Patient {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: Gender;
    email?: string;
    phone?: string;
    address?: Address;
}
export declare const patientsSource: Patient[];
//# sourceMappingURL=patientsSource.d.ts.map