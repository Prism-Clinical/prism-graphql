import { InstitutionType } from '../__generated__/resolvers-types';

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

export const institutionsSource: Institution[] = [
  {
    id: "institution-1",
    name: "Metropolitan Health System",
    type: InstitutionType.HospitalSystem,
    address: {
      street: "1000 Medical Center Blvd",
      city: "Metro City",
      state: "CA",
      zipCode: "90210",
      country: "USA"
    },
    phone: "(555) 123-4567",
    email: "info@metro-health.com",
    website: "https://metro-health.com",
    accreditation: ["Joint Commission", "MAGNET"],
    isActive: true
  },
  {
    id: "institution-2",
    name: "Community Medical Center",
    type: InstitutionType.MedicalCenter,
    address: {
      street: "500 Healthcare Way",
      city: "Community Town",
      state: "NY",
      zipCode: "10001",
      country: "USA"
    },
    phone: "(555) 987-6543",
    email: "contact@community-med.com",
    website: "https://community-med.com",
    accreditation: ["Joint Commission"],
    isActive: true
  },
  {
    id: "institution-3",
    name: "Regional University Medical School",
    type: InstitutionType.University,
    address: {
      street: "200 Campus Drive",
      city: "University Heights",
      state: "TX",
      zipCode: "75001",
      country: "USA"
    },
    phone: "(555) 456-7890",
    email: "info@regional-uni.edu",
    website: "https://regional-uni.edu/medical",
    accreditation: ["LCME", "AAMC"],
    isActive: true
  }
];

export const hospitalsSource: Hospital[] = [
  {
    id: "hospital-1",
    name: "Metropolitan General Hospital",
    institutionId: "institution-1",
    address: {
      street: "1000 Medical Center Blvd",
      city: "Metro City",
      state: "CA",
      zipCode: "90210",
      country: "USA"
    },
    phone: "(555) 123-4567",
    email: "info@metro-general.com",
    website: "https://metro-general.com",
    beds: 450,
    departments: ["Emergency", "Cardiology", "Oncology", "Pediatrics", "Surgery"],
    emergencyServices: true,
    isActive: true
  },
  {
    id: "hospital-2",
    name: "Community Regional Medical Center",
    institutionId: "institution-2",
    address: {
      street: "501 Healthcare Way",
      city: "Community Town",
      state: "NY",
      zipCode: "10001",
      country: "USA"
    },
    phone: "(555) 987-6543",
    email: "info@community-regional.com",
    website: "https://community-regional.com",
    beds: 275,
    departments: ["Emergency", "Internal Medicine", "Family Practice", "Radiology"],
    emergencyServices: true,
    isActive: true
  },
  {
    id: "hospital-3",
    name: "University Teaching Hospital",
    institutionId: "institution-3",
    address: {
      street: "250 Campus Drive",
      city: "University Heights",
      state: "TX",
      zipCode: "75001",
      country: "USA"
    },
    phone: "(555) 456-7890",
    email: "info@uni-teaching.edu",
    website: "https://uni-teaching.edu",
    beds: 350,
    departments: ["Emergency", "Research", "Education", "Internal Medicine", "Surgery", "Psychiatry"],
    emergencyServices: true,
    isActive: true
  }
];