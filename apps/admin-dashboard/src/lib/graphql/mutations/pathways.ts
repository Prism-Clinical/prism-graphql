import { gql } from '@apollo/client/core';

export const IMPORT_PATHWAY = gql`
  mutation ImportPathway($pathwayJson: String!, $importMode: ImportMode!) {
    importPathway(pathwayJson: $pathwayJson, importMode: $importMode) {
      pathway {
        id
        logicalId
        title
        version
        category
        status
        conditionCodes
        isActive
        createdAt
        updatedAt
      }
      validation {
        valid
        errors
        warnings
      }
      diff {
        summary {
          nodesAdded
          nodesRemoved
          nodesModified
          edgesAdded
          edgesRemoved
          edgesModified
        }
        details {
          entityType
          action
          entityId
          entityLabel
        }
        synthetic
      }
      importType
    }
  }
`;

export const ACTIVATE_PATHWAY = gql`
  mutation ActivatePathway($id: ID!) {
    activatePathway(id: $id) {
      pathway {
        id
        logicalId
        title
        version
        status
        isActive
      }
      previousStatus
    }
  }
`;

export const ARCHIVE_PATHWAY = gql`
  mutation ArchivePathway($id: ID!) {
    archivePathway(id: $id) {
      pathway {
        id
        status
        isActive
      }
      success
    }
  }
`;

export const REACTIVATE_PATHWAY = gql`
  mutation ReactivatePathway($id: ID!) {
    reactivatePathway(id: $id) {
      pathway {
        id
        status
        isActive
      }
      success
    }
  }
`;

export const ADD_ADMIN_EVIDENCE = gql`
  mutation AddAdminEvidence($input: AddAdminEvidenceInput!) {
    addAdminEvidence(input: $input) {
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
      createdAt
    }
  }
`;

export const REMOVE_ADMIN_EVIDENCE = gql`
  mutation RemoveAdminEvidence($id: ID!) {
    removeAdminEvidence(id: $id)
  }
`;

export const SET_SIGNAL_WEIGHT = gql`
  mutation SetSignalWeight($input: SetSignalWeightInput!) {
    setSignalWeight(input: $input) {
      id
      signalDefinitionId
      weight
      scope
      pathwayId
      nodeIdentifier
      nodeType
      institutionId
    }
  }
`;

export const SET_RESOLUTION_THRESHOLDS = gql`
  mutation SetResolutionThresholds($input: SetResolutionThresholdsInput!) {
    setResolutionThresholds(input: $input) {
      id
      autoResolveThreshold
      suggestThreshold
      scope
      pathwayId
      nodeIdentifier
      institutionId
    }
  }
`;
