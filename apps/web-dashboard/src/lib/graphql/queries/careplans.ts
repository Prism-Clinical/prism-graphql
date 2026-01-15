import { gql } from '@apollo/client';

export const CARE_PLAN_FRAGMENT = gql`
  fragment CarePlanFields on CarePlan {
    id
    status
    title
    startDate
    targetEndDate
    createdAt
    updatedAt
    patient {
      id
      firstName
      lastName
    }
    goals {
      id
      description
      targetDate
      status
      percentComplete
    }
    interventions {
      id
      type
      description
      frequency
      status
    }
  }
`;

export const CARE_PLAN_SUMMARY_FRAGMENT = gql`
  fragment CarePlanSummaryFields on CarePlan {
    id
    status
    title
    startDate
    targetEndDate
    createdAt
    patient {
      id
      firstName
      lastName
    }
    goals {
      id
      status
    }
    interventions {
      id
      status
    }
  }
`;

export const GET_CARE_PLANS = gql`
  ${CARE_PLAN_SUMMARY_FRAGMENT}
  query GetCarePlans($filter: CarePlanFilterInput, $pagination: PaginationInput) {
    carePlans(filter: $filter, pagination: $pagination) {
      edges {
        node {
          ...CarePlanSummaryFields
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

export const GET_CARE_PLAN = gql`
  ${CARE_PLAN_FRAGMENT}
  query GetCarePlan($id: ID!) {
    carePlan(id: $id) {
      ...CarePlanFields
    }
  }
`;

export const GET_CARE_PLANS_FOR_PATIENT = gql`
  ${CARE_PLAN_SUMMARY_FRAGMENT}
  query GetCarePlansForPatient($patientId: ID!, $status: CarePlanStatus, $pagination: PaginationInput) {
    carePlansForPatient(patientId: $patientId, status: $status, pagination: $pagination) {
      edges {
        node {
          ...CarePlanSummaryFields
        }
      }
      totalCount
    }
  }
`;

export const GET_CARE_PLAN_TEMPLATES = gql`
  query GetCarePlanTemplates($filter: TemplateFilterInput, $pagination: PaginationInput) {
    carePlanTemplates(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          name
          category
          description
          goals {
            description
            targetDays
          }
          interventions {
            type
            description
            frequency
          }
        }
      }
      totalCount
    }
  }
`;

export const GET_CARE_PLAN_STATS = gql`
  query GetCarePlanStats {
    activeCarePlans: carePlans(filter: { status: ACTIVE }) {
      totalCount
    }
    draftCarePlans: carePlans(filter: { status: DRAFT }) {
      totalCount
    }
    completedCarePlans: carePlans(filter: { status: COMPLETED }) {
      totalCount
    }
  }
`;
