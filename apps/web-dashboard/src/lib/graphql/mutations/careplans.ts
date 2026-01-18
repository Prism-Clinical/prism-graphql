import { gql } from '@apollo/client';
import { CARE_PLAN_FRAGMENT } from '../queries/careplans';

export const CREATE_CARE_PLAN = gql`
  ${CARE_PLAN_FRAGMENT}
  mutation CreateCarePlan($input: CreateCarePlanInput!) {
    createCarePlan(input: $input) {
      success
      carePlan {
        ...CarePlanFields
      }
      validationResults {
        interventionIndex
        isValid
        confidenceScore
        validationTier
        deviationFactors
        alternativeRecommendation
      }
      blockedInterventions {
        index
        reason
        alternative
      }
    }
  }
`;

export const UPDATE_CARE_PLAN = gql`
  ${CARE_PLAN_FRAGMENT}
  mutation UpdateCarePlan($id: ID!, $input: UpdateCarePlanInput!) {
    updateCarePlan(id: $id, input: $input) {
      success
      carePlan {
        ...CarePlanFields
      }
    }
  }
`;

export const UPDATE_CARE_PLAN_STATUS = gql`
  mutation UpdateCarePlanStatus($id: ID!, $status: CarePlanStatus!) {
    updateCarePlanStatus(id: $id, status: $status) {
      id
      status
      updatedAt
    }
  }
`;

export const ADD_CARE_PLAN_GOAL = gql`
  mutation AddCarePlanGoal($carePlanId: ID!, $input: CarePlanGoalInput!) {
    addCarePlanGoal(carePlanId: $carePlanId, input: $input) {
      id
      description
      targetDate
      status
      progress
    }
  }
`;

export const UPDATE_CARE_PLAN_GOAL = gql`
  mutation UpdateCarePlanGoal($goalId: ID!, $input: UpdateCarePlanGoalInput!) {
    updateCarePlanGoal(goalId: $goalId, input: $input) {
      id
      description
      targetDate
      status
      progress
    }
  }
`;

export const ADD_CARE_PLAN_INTERVENTION = gql`
  mutation AddCarePlanIntervention($carePlanId: ID!, $input: CarePlanInterventionInput!) {
    addCarePlanIntervention(carePlanId: $carePlanId, input: $input) {
      intervention {
        id
        type
        description
        frequency
        status
        validationStatus
        validationConfidence
      }
      validationResult {
        isValid
        confidenceScore
        validationTier
        deviationFactors
        alternativeRecommendation
      }
    }
  }
`;

export const DELETE_CARE_PLAN = gql`
  mutation DeleteCarePlan($id: ID!) {
    deleteCarePlan(id: $id) {
      success
    }
  }
`;

export const CREATE_CARE_PLAN_FROM_TEMPLATE = gql`
  ${CARE_PLAN_FRAGMENT}
  mutation CreateCarePlanFromTemplate($templateId: ID!, $patientId: ID!) {
    createCarePlanFromTemplate(templateId: $templateId, patientId: $patientId) {
      success
      carePlan {
        ...CarePlanFields
      }
    }
  }
`;
