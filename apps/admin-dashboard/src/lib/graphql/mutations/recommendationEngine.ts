import { gql } from '@apollo/client';

export const RECORD_RECOMMENDATION_OUTCOME = gql`
  mutation RecordRecommendationOutcome($input: RecordOutcomeInput!) {
    recordRecommendationOutcome(input: $input)
  }
`;

export const CREATE_VARIANT_GROUP = gql`
  mutation CreateVariantGroup($input: CreateVariantGroupInput!) {
    createVariantGroup(input: $input) {
      id
      name
      description
      conditionCodes
      isActive
      createdAt
      variants {
        id
        variantGroupId
        carePlanId
        variantName
        targetAgeMin
        targetAgeMax
        targetSex
        priorityScore
        isDefault
      }
    }
  }
`;

export const CREATE_VARIANT = gql`
  mutation CreateVariant($input: CreateVariantInput!) {
    createVariant(input: $input) {
      id
      variantGroupId
      carePlanId
      variantName
      targetAgeMin
      targetAgeMax
      targetSex
      targetConditions
      targetRiskFactors
      exclusionConditions
      priorityScore
      isDefault
    }
  }
`;

export const CREATE_SELECTION_RULE = gql`
  mutation CreateSelectionRule($input: CreateSelectionRuleInput!) {
    createSelectionRule(input: $input) {
      id
      name
      description
      variantGroupId
      ruleDefinition
      priority
      isActive
      createdAt
    }
  }
`;

export const DELETE_SELECTION_RULE = gql`
  mutation DeleteSelectionRule($id: ID!) {
    deleteSelectionRule(id: $id)
  }
`;
