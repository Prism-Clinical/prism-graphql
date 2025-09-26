export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type RecommendationStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type RecommendationItemType = 
  | 'MEDICATION' 
  | 'LAB_TEST' 
  | 'IMAGING' 
  | 'PROCEDURE' 
  | 'FOLLOW_UP' 
  | 'LIFESTYLE' 
  | 'EDUCATION';

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

export interface Facility {
  id: string;
  name: string;
  address: Address;
  phone: string;
}

export interface Recommendation {
  id: string;
  patientId: string;
  providerId: string;
  title: string;
  description: string;
  priority: Priority;
  status: RecommendationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationItem {
  id: string;
  recommendationId: string;
  type: RecommendationItemType;
  title: string;
  description: string;
  instructions?: string;
  dueDate?: string;
  completed: boolean;
  completedAt?: string;
  notes?: string;
}