import { gql } from '@apollo/client';
import {
  CARE_PLAN_TEMPLATE_FRAGMENT,
  TRAINING_CARE_PLAN_FRAGMENT,
} from '../queries/carePlans';

// =============================================================================
// TEMPLATE MUTATIONS
// =============================================================================

export const CREATE_CARE_PLAN_TEMPLATE = gql`
  mutation CreateCarePlanTemplate($input: CreateCarePlanTemplateInput!) {
    createCarePlanTemplate(input: $input) {
      ...CarePlanTemplateFields
    }
  }
  ${CARE_PLAN_TEMPLATE_FRAGMENT}
`;

export const UPDATE_CARE_PLAN_TEMPLATE = gql`
  mutation UpdateCarePlanTemplate($id: ID!, $input: UpdateCarePlanTemplateInput!) {
    updateCarePlanTemplate(id: $id, input: $input) {
      ...CarePlanTemplateFields
    }
  }
  ${CARE_PLAN_TEMPLATE_FRAGMENT}
`;

export const DELETE_CARE_PLAN_TEMPLATE = gql`
  mutation DeleteCarePlanTemplate($id: ID!) {
    deleteCarePlanTemplate(id: $id)
  }
`;

// =============================================================================
// TRAINING CARE PLAN MUTATIONS
// =============================================================================

export const CREATE_TRAINING_CARE_PLAN = gql`
  mutation CreateTrainingCarePlan($input: CreateTrainingCarePlanInput!) {
    createTrainingCarePlan(input: $input) {
      ...TrainingCarePlanFields
    }
  }
  ${TRAINING_CARE_PLAN_FRAGMENT}
`;

export const UPDATE_TRAINING_CARE_PLAN = gql`
  mutation UpdateTrainingCarePlan($id: ID!, $input: UpdateTrainingCarePlanInput!) {
    updateTrainingCarePlan(id: $id, input: $input) {
      ...TrainingCarePlanFields
    }
  }
  ${TRAINING_CARE_PLAN_FRAGMENT}
`;

export const DELETE_TRAINING_CARE_PLAN = gql`
  mutation DeleteTrainingCarePlan($id: ID!) {
    deleteTrainingCarePlan(id: $id)
  }
`;

// =============================================================================
// TRAINING GOAL/INTERVENTION MUTATIONS
// =============================================================================

export const ADD_TRAINING_GOAL = gql`
  mutation AddTrainingGoal($carePlanId: ID!, $input: CreateTrainingGoalInput!) {
    addTrainingGoal(carePlanId: $carePlanId, input: $input) {
      ...TrainingCarePlanFields
    }
  }
  ${TRAINING_CARE_PLAN_FRAGMENT}
`;

export const REMOVE_TRAINING_GOAL = gql`
  mutation RemoveTrainingGoal($goalId: ID!) {
    removeTrainingGoal(goalId: $goalId)
  }
`;

export const ADD_TRAINING_INTERVENTION = gql`
  mutation AddTrainingIntervention($carePlanId: ID!, $input: CreateTrainingInterventionInput!) {
    addTrainingIntervention(carePlanId: $carePlanId, input: $input) {
      ...TrainingCarePlanFields
    }
  }
  ${TRAINING_CARE_PLAN_FRAGMENT}
`;

export const REMOVE_TRAINING_INTERVENTION = gql`
  mutation RemoveTrainingIntervention($interventionId: ID!) {
    removeTrainingIntervention(interventionId: $interventionId)
  }
`;

// =============================================================================
// PDF IMPORT MUTATIONS
// =============================================================================

export const IMPORT_CARE_PLAN_FROM_PDF = gql`
  mutation ImportCarePlanFromPdf($input: ImportCarePlanFromPdfInput!) {
    importCarePlanFromPdf(input: $input) {
      template {
        id
        name
        category
        conditionCodes
        isActive
      }
      trainingExample {
        id
        title
        conditionCodes
        isTrainingExample
        trainingDescription
        trainingTags
      }
      embeddingGenerated
    }
  }
`;
