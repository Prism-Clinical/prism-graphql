import { gql } from '@apollo/client';

export const SAFETY_CHECK_FRAGMENT = gql`
  fragment SafetyCheckFields on SafetyCheck {
    id
    checkType
    status
    severity
    title
    description
    clinicalRationale
    relatedMedications
    relatedConditions
    relatedAllergies
    guidelineReferences
    createdAt
    updatedAt
    patient {
      id
      firstName
      lastName
    }
    overrideInfo {
      overriddenBy
      overriddenAt
      reason
      justification
      expiresAt
    }
  }
`;

export const GET_SAFETY_CHECKS = gql`
  ${SAFETY_CHECK_FRAGMENT}
  query GetSafetyChecks(
    $filter: SafetyCheckFilterInput
    $pagination: PaginationInput
  ) {
    safetyChecks(filter: $filter, pagination: $pagination) {
      edges {
        node {
          ...SafetyCheckFields
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_SAFETY_CHECK = gql`
  ${SAFETY_CHECK_FRAGMENT}
  query GetSafetyCheck($id: ID!) {
    safetyCheck(id: $id) {
      ...SafetyCheckFields
    }
  }
`;

export const GET_SAFETY_CHECKS_FOR_PATIENT = gql`
  ${SAFETY_CHECK_FRAGMENT}
  query GetSafetyChecksForPatient($patientId: ID!, $pagination: PaginationInput) {
    safetyChecksForPatient(patientId: $patientId, pagination: $pagination) {
      edges {
        node {
          ...SafetyCheckFields
        }
      }
      totalCount
    }
  }
`;

export const GET_ACTIVE_SAFETY_ALERTS = gql`
  query GetActiveSafetyAlerts($patientId: ID!) {
    patient(id: $patientId) {
      id
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
  }
`;

export const GET_SAFETY_STATS = gql`
  query GetSafetyStats {
    criticalAlerts: safetyChecks(
      filter: { severity: CRITICAL, status: FLAGGED }
    ) {
      totalCount
    }
    contraindicatedAlerts: safetyChecks(
      filter: { severity: CONTRAINDICATED, status: FLAGGED }
    ) {
      totalCount
    }
    warningAlerts: safetyChecks(
      filter: { severity: WARNING, status: FLAGGED }
    ) {
      totalCount
    }
    recentAlerts: safetyChecks(
      filter: { status: FLAGGED }
      pagination: { first: 5 }
    ) {
      edges {
        node {
          id
          checkType
          severity
          title
          createdAt
          patient {
            id
            firstName
            lastName
          }
        }
      }
    }
  }
`;
