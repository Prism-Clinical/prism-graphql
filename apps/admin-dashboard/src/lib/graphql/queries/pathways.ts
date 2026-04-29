import { gql } from '@apollo/client/core';

export const GET_PATHWAYS = gql`
  query GetPathways($status: PathwayStatus, $category: PathwayCategory, $first: Int) {
    pathways(status: $status, category: $category, first: $first) {
      id
      logicalId
      title
      version
      category
      status
      conditionCodes
      scope
      targetPopulation
      isActive
      createdAt
      updatedAt
    }
  }
`;

export const GET_PATHWAY = gql`
  query GetPathway($id: ID!) {
    pathway(id: $id) {
      id
      logicalId
      title
      version
      category
      status
      conditionCodes
      scope
      targetPopulation
      isActive
      createdAt
      updatedAt
    }
  }
`;

export const GET_PATHWAY_CONFIDENCE = gql`
  query GetPathwayConfidence(
    $pathwayId: ID!
    $patientContext: PatientContextInput!
  ) {
    pathwayConfidence(
      pathwayId: $pathwayId
      patientContext: $patientContext
    ) {
      pathwayId
      overallConfidence
      nodes {
        nodeIdentifier
        nodeType
        confidence
        resolutionType
        breakdown {
          signalName
          score
          weight
          weightSource
          missingInputs
        }
        propagationInfluences {
          sourceNodeIdentifier
          signalName
          originalScore
          propagatedScore
          hopDistance
        }
      }
    }
  }
`;

export const GET_SIGNAL_DEFINITIONS = gql`
  query GetSignalDefinitions($scope: SignalScope, $institutionId: ID) {
    signalDefinitions(scope: $scope, institutionId: $institutionId) {
      id
      name
      displayName
      description
      scoringType
      defaultWeight
      isActive
    }
  }
`;

export const GET_EFFECTIVE_WEIGHTS = gql`
  query GetEffectiveWeights($pathwayId: ID!, $institutionId: ID, $organizationId: ID) {
    effectiveWeights(pathwayId: $pathwayId, institutionId: $institutionId, organizationId: $organizationId) {
      entries {
        nodeIdentifier
        signalName
        weight
        source
      }
    }
  }
`;

export const GET_EFFECTIVE_THRESHOLDS = gql`
  query GetEffectiveThresholds($pathwayId: ID!, $institutionId: ID, $organizationId: ID) {
    effectiveThresholds(pathwayId: $pathwayId, institutionId: $institutionId, organizationId: $organizationId) {
      autoResolveThreshold
      suggestThreshold
      scope
    }
  }
`;

export const GET_ADMIN_EVIDENCE = gql`
  query GetAdminEvidence($pathwayId: ID!, $nodeIdentifier: String) {
    adminEvidenceEntries(pathwayId: $pathwayId, nodeIdentifier: $nodeIdentifier) {
      id
      pathwayId
      nodeIdentifier
      title
      source
      year
      evidenceLevel
      url
      notes
      applicableCriteria
      populationDescription
      createdBy
      createdAt
    }
  }
`;

export const SEARCH_CODES = gql`
  query SearchCodes($query: String!, $system: String, $limit: Int) {
    searchCodes(query: $query, system: $system, limit: $limit) {
      code
      system
      description
      category
      isCommon
    }
  }
`;

export const GET_PATHWAY_GRAPH = gql`
  query GetPathwayGraph($id: ID!) {
    pathwayGraph(id: $id) {
      pathway {
        id
        logicalId
        title
        version
        category
        status
        conditionCodes
        scope
        targetPopulation
        isActive
        createdAt
        updatedAt
      }
      nodes {
        id
        type
        properties
      }
      edges {
        from
        to
        type
        properties
      }
      conditionCodeDetails {
        code
        system
        description
        usage
        grouping
      }
    }
  }
`;
