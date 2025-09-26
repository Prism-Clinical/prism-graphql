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

export const facilitiesSource: Facility[] = [
  {
    id: "facility-1",
    name: "City General Hospital",
    address: {
      street: "100 Hospital Drive",
      city: "Healthcare City",
      state: "CA",
      zipCode: "90210",
      country: "USA"
    },
    phone: "(555) 100-1000"
  },
  {
    id: "facility-2", 
    name: "Downtown Medical Center",
    address: {
      street: "200 Medical Plaza",
      city: "Anytown",
      state: "NY",
      zipCode: "10001",
      country: "USA"
    },
    phone: "(555) 200-2000"
  }
];

export const providersSource: Provider[] = [
  {
    id: "provider-1",
    npi: "1234567890",
    firstName: "Dr. Sarah",
    lastName: "Johnson",
    specialty: "Internal Medicine",
    credentials: "MD",
    email: "sarah.johnson@hospital.com",
    phone: "(555) 111-1111",
    facilityId: "facility-1"
  },
  {
    id: "provider-2",
    npi: "0987654321",
    firstName: "Dr. Michael",
    lastName: "Chen",
    specialty: "Cardiology",
    credentials: "MD, FACC",
    email: "michael.chen@medical.com",
    phone: "(555) 222-2222",
    facilityId: "facility-2"
  },
  {
    id: "provider-3",
    npi: "5555666677",
    firstName: "Dr. Emily",
    lastName: "Rodriguez",
    specialty: "Family Medicine",
    credentials: "MD",
    email: "emily.rodriguez@clinic.com",
    phone: "(555) 333-3333",
    facilityId: "facility-1"
  }
];

// Provider-Facility mapping for federation
export const providerFacilityMapping: Record<string, string> = {
  "provider-1": "facility-1",
  "provider-2": "facility-2", 
  "provider-3": "facility-1"
};