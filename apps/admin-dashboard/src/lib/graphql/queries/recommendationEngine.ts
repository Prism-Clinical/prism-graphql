import { gql } from '@apollo/client';

export const ENGINE_RECOMMEND = gql`
  query EngineRecommend($input: EngineRecommendInput!) {
    engineRecommend(input: $input) {
      sessionId
      recommendations {
        carePlanId
        title
        conditionCodes
        score
        rank
        matchType
        matchedCodes
        variantGroupId
        variantGroupName
        variantId
        variantName
        embeddingSimilarity
        selectionScore
        personalizationScore
        reasons {
          reasonType
          description
          metadata
          scoreImpact
        }
      }
      layerSummaries {
        layer
        layerName
        candidateCount
        processingTimeMs
        metadata
      }
      totalProcessingTimeMs
      engineVersion
    }
  }
`;

export const ENGINE_EXPLAIN_SESSION = gql`
  query EngineExplainSession($sessionId: ID!) {
    engineExplainSession(sessionId: $sessionId) {
      sessionId
      patientContext
      layers {
        layer
        layerName
        inputCount
        outputCount
        candidateDetails
        processingTimeMs
      }
      finalRecommendations {
        carePlanId
        title
        score
        rank
        matchType
        reasons {
          reasonType
          description
          scoreImpact
        }
      }
      createdAt
    }
  }
`;

export const GET_VARIANT_GROUPS = gql`
  query GetVariantGroups($conditionCode: String) {
    variantGroups(conditionCode: $conditionCode) {
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
        targetConditions
        targetRiskFactors
        exclusionConditions
        priorityScore
        isDefault
      }
    }
  }
`;

export const GET_VARIANT_GROUP = gql`
  query GetVariantGroup($id: ID!) {
    variantGroup(id: $id) {
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
        targetConditions
        targetRiskFactors
        exclusionConditions
        priorityScore
        isDefault
      }
    }
  }
`;

export const GET_SELECTION_RULES = gql`
  query GetSelectionRules($variantGroupId: ID, $isActive: Boolean) {
    selectionRules(variantGroupId: $variantGroupId, isActive: $isActive) {
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

export const GET_ENGINE_ANALYTICS = gql`
  query GetEngineAnalytics($days: Int) {
    engineAnalytics(days: $days) {
      totalSessions
      averageProcessingTimeMs
      topMatchTypes
      topConditionCodes
      acceptanceRate
      period
    }
  }
`;

export const GET_ENGINE_CONFIGURATION = gql`
  query GetEngineConfiguration {
    engineConfiguration {
      matching {
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
      personalization {
        enableRag
        enableOutcomeLearning
        enableDecisionPaths
        knowledgeSources
        learningRate
      }
    }
  }
`;
