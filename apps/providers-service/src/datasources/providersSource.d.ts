export interface Address {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
}
export interface Facility {
    id: string;
    name: string;
    address: Address;
    phone: string;
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
}
export declare const facilitiesSource: Facility[];
export declare const providersSource: Provider[];
export declare const providerFacilityMapping: Record<string, string>;
//# sourceMappingURL=providersSource.d.ts.map