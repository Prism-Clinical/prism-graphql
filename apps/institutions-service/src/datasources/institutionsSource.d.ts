import { InstitutionType } from '@institutions/__generated__/resolvers-types';
export interface Address {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
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
}
export declare const institutionsSource: Institution[];
export declare const hospitalsSource: Hospital[];
//# sourceMappingURL=institutionsSource.d.ts.map