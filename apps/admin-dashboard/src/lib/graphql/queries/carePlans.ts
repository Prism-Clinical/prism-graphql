import { gql } from '@apollo/client';

// =============================================================================
// FRAGMENTS
// =============================================================================

export const TEMPLATE_GOAL_FRAGMENT = gql`
  fragment TemplateGoalFields on TemplateGoal {
    description
    defaultTargetValue
    defaultTargetDays
    priority
  }
`;

export const TEMPLATE_INTERVENTION_FRAGMENT = gql`
  fragment TemplateInterventionFields on TemplateIntervention {
    type
    description
    medicationCode
    procedureCode
    defaultScheduleDays
  }
`;

export const CARE_PLAN_TEMPLATE_FRAGMENT = gql`
  fragment CarePlanTemplateFields on CarePlanTemplate {
    id
    name
    description
    category
    conditionCodes
    guidelineSource
    evidenceGrade
    isActive
    version
    createdAt
    updatedAt
    defaultGoals {
      ...TemplateGoalFields
    }
    defaultInterventions {
      ...TemplateInterventionFields
    }
  }
  ${TEMPLATE_GOAL_FRAGMENT}
  ${TEMPLATE_INTERVENTION_FRAGMENT}
`;

export const CARE_PLAN_GOAL_FRAGMENT = gql`
  fragment CarePlanGoalFields on CarePlanGoal {
    id
    description
    targetValue
    targetDate
    status
    priority
    currentValue
    percentComplete
    guidelineReference
    createdAt
    updatedAt
  }
`;

export const CARE_PLAN_INTERVENTION_FRAGMENT = gql`
  fragment CarePlanInterventionFields on CarePlanIntervention {
    id
    type
    description
    medicationCode
    dosage
    frequency
    procedureCode
    referralSpecialty
    status
    scheduledDate
    completedDate
    patientInstructions
    providerNotes
    guidelineReference
    createdAt
    updatedAt
  }
`;

export const TRAINING_CARE_PLAN_FRAGMENT = gql`
  fragment TrainingCarePlanFields on CarePlan {
    id
    title
    status
    conditionCodes
    startDate
    targetEndDate
    isTrainingExample
    trainingDescription
    trainingTags
    createdAt
    updatedAt
    goals {
      ...CarePlanGoalFields
    }
    interventions {
      ...CarePlanInterventionFields
    }
  }
  ${CARE_PLAN_GOAL_FRAGMENT}
  ${CARE_PLAN_INTERVENTION_FRAGMENT}
`;

// =============================================================================
// TEMPLATE QUERIES
// =============================================================================

export const GET_CARE_PLAN_TEMPLATES = gql`
  query GetCarePlanTemplates($filter: TemplateFilterInput, $pagination: PaginationInput) {
    carePlanTemplates(filter: $filter, pagination: $pagination) {
      edges {
        node {
          ...CarePlanTemplateFields
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
  ${CARE_PLAN_TEMPLATE_FRAGMENT}
`;

export const GET_CARE_PLAN_TEMPLATE = gql`
  query GetCarePlanTemplate($id: ID!) {
    carePlanTemplate(id: $id) {
      ...CarePlanTemplateFields
    }
  }
  ${CARE_PLAN_TEMPLATE_FRAGMENT}
`;

// =============================================================================
// TRAINING CARE PLAN QUERIES
// =============================================================================

export const GET_TRAINING_CARE_PLANS = gql`
  query GetTrainingCarePlans($filter: TrainingCarePlanFilterInput, $pagination: PaginationInput) {
    trainingCarePlans(filter: $filter, pagination: $pagination) {
      edges {
        node {
          ...TrainingCarePlanFields
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
  ${TRAINING_CARE_PLAN_FRAGMENT}
`;

export const GET_TRAINING_CARE_PLAN = gql`
  query GetTrainingCarePlan($id: ID!) {
    trainingCarePlan(id: $id) {
      ...TrainingCarePlanFields
    }
  }
  ${TRAINING_CARE_PLAN_FRAGMENT}
`;
