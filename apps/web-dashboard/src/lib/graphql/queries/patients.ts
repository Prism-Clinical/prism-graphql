import { gql } from '@apollo/client';

export const PATIENT_FRAGMENT = gql`
  fragment PatientFields on Patient {
    id
    firstName
    lastName
    dateOfBirth
    gender
    mrn
    email
    phone
    address {
      street
      city
      state
      zipCode
    }
  }
`;

export const GET_PATIENT = gql`
  ${PATIENT_FRAGMENT}
  query GetPatient($id: ID!) {
    patient(id: $id) {
      ...PatientFields
    }
  }
`;

export const GET_PATIENTS = gql`
  ${PATIENT_FRAGMENT}
  query GetPatients($limit: Int, $offset: Int) {
    patients(limit: $limit, offset: $offset) {
      ...PatientFields
    }
  }
`;

export const GET_PATIENT_SAFETY_SUMMARY = gql`
  query GetPatientSafetySummary($patientId: ID!) {
    patient(id: $patientId) {
      id
      firstName
      lastName
      mrn
      activeSafetyAlerts {
        id
        checkType
        status
        severity
        title
        description
        createdAt
      }
    }
    safetyChecksForPatient(patientId: $patientId, pagination: { first: 20 }) {
      edges {
        node {
          id
          checkType
          status
          severity
          title
          description
          createdAt
          updatedAt
        }
      }
      totalCount
    }
    carePlansForPatient(patientId: $patientId, pagination: { first: 5 }) {
      edges {
        node {
          id
          title
          status
          startDate
          targetEndDate
        }
      }
      totalCount
    }
  }
`;

export const SEARCH_PATIENTS = gql`
  query SearchPatients($limit: Int) {
    patients(limit: $limit) {
      id
      firstName
      lastName
      mrn
      dateOfBirth
    }
  }
`;
