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

export const UPDATE_VARIANT = gql`
  mutation UpdateVariant($id: ID!, $input: UpdateVariantInput!) {
    updateVariant(id: $id, input: $input) {
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

export const DELETE_VARIANT = gql`
  mutation DeleteVariant($id: ID!) {
    deleteVariant(id: $id)
  }
`;

export const UPDATE_SELECTION_RULE = gql`
  mutation UpdateSelectionRule($id: ID!, $input: UpdateSelectionRuleInput!) {
    updateSelectionRule(id: $id, input: $input) {
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

export const UPDATE_VARIANT_GROUP = gql`
  mutation UpdateVariantGroup($id: ID!, $input: UpdateVariantGroupInput!) {
    updateVariantGroup(id: $id, input: $input) {
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

export const DELETE_VARIANT_GROUP = gql`
  mutation DeleteVariantGroup($id: ID!) {
    deleteVariantGroup(id: $id)
  }
`;

export const SAVE_MATCHING_CONFIG = gql`
  mutation SaveMatchingConfig($input: MatchingConfigInput!) {
    saveMatchingConfig(input: $input) {
      strategy
      codeMatchPriority
      enableEmbeddings
      similarityThreshold
      maxCandidates
      scoreWeights {
        exactMatch
        prefixMatch
        categoryMatch
        embeddingMatch
      }
    }
  }
`;

export const SAVE_PERSONALIZATION_CONFIG = gql`
  mutation SavePersonalizationConfig($input: PersonalizationConfigInput!) {
    savePersonalizationConfig(input: $input) {
      enableRag
      enableOutcomeLearning
      enableDecisionPaths
      knowledgeSources
      learningRate
    }
  }
`;
