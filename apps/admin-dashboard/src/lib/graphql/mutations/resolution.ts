import { gql } from '@apollo/client/core';

/**
 * MergedCarePlan fragment used by the pathway preview page.
 *
 * Includes evidence lineage fields — per-rec `evidenceGateIds`,
 * plan-level `evidenceTrail` and `dataGapHints` — so the preview UI can
 * render "decided from" chips (slice C) and "data-gap" hints (slice D)
 * without a second round trip.
 */
export const PREVIEW_MERGED_CARE_PLAN_FRAGMENT = gql`
  fragment PreviewMergedCarePlanFields on MergedCarePlan {
    sourcePathwayIds
    medications {
      recommendation {
        name
        role
        dose
        frequency
        duration
        route
        clinicalRole
        sourcePathwayId
        sourceNodeId
        evidenceGateIds
      }
      sourcePathwayIds
      state
    }
    labs {
      recommendation {
        name
        code
        system
        specimen
        sourcePathwayId
        sourceNodeId
        evidenceGateIds
      }
      sourcePathwayIds
      state
    }
    imaging {
      recommendation {
        name
        modality
        bodyRegion
        contrast
        code
        system
        sourcePathwayId
        sourceNodeId
        evidenceGateIds
      }
      sourcePathwayIds
      state
    }
    procedures {
      recommendation {
        name
        code
        system
        sourcePathwayId
        sourceNodeId
        evidenceGateIds
      }
      sourcePathwayIds
      state
    }
    guidance {
      recommendation {
        topic
        instructions
        category
        sourcePathwayId
        sourceNodeId
        evidenceGateIds
      }
      sourcePathwayIds
      state
    }
    schedules {
      recommendation {
        interval
        description
        sourcePathwayId
        sourceNodeId
        evidenceGateIds
      }
      sourcePathwayIds
      state
    }
    qualityMetrics {
      recommendation {
        name
        measure
        sourcePathwayId
        sourceNodeId
        evidenceGateIds
      }
      sourcePathwayIds
      state
    }
    evidenceTrail {
      nodeId
      title
      kind
      status
      reason
      fieldsRead
    }
    dataGapHints {
      gateNodeId
      gateTitle
      kind
      status
      reason
      fieldsRead
      unlockedRecommendations {
        nodeId
        nodeType
        title
      }
    }
    suppressed {
      type
      name
      reason
      suppressedByPathwayId
      suppressedByPathwayTitle
      suppressedByPatientMedRxcui
      suppressedByPatientMedName
      suppressedByAllergyCode
      suppressedByAllergyDisplay
    }
    conflicts {
      conflictId
      type
      clinicalRole
      candidates {
        recommendation {
          name
          role
          dose
          frequency
          clinicalRole
          sourcePathwayId
          sourceNodeId
        }
        sourcePathwayId
        sourcePathwayTitle
      }
      resolution {
        kind
        resolvedBy
        resolvedAt
        reason
        chosenPathwayId
      }
    }
    catchUpItems {
      nodeId
      nodeType
      title
      dependentNodeId
      reason
      sourcePathwayId
    }
  }
`;

/**
 * Start a multi-pathway resolution as a *preview* run. The caller sets
 * `syntheticPatient: true`, which does two things on the backend:
 *   1. The matcher uses `patientContext.conditionCodes` directly instead
 *      of reading from the EMR snapshot tables (no patients row required).
 *   2. The resulting session row is tagged `is_preview = true`, so it can
 *      later be hard-deleted via `deletePreviewSession` without touching
 *      real provider sessions.
 *
 * `patientId` should be a fresh UUID per preview run so preview sessions
 * don't cross-contaminate each other's contributing per-pathway sessions.
 */
export const START_PREVIEW_MULTI_PATHWAY_RESOLUTION = gql`
  ${PREVIEW_MERGED_CARE_PLAN_FRAGMENT}
  mutation StartPreviewMultiPathwayResolution(
    $patientId: ID!
    $patientContext: PatientContextInput!
    $includeDraftPathways: Boolean
  ) {
    startMultiPathwayResolution(
      patientId: $patientId
      patientContext: $patientContext
      includeDraftPathways: $includeDraftPathways
      syntheticPatient: true
    ) {
      id
      patientId
      providerId
      status
      isPreview
      contributingPathwayIds
      contributingSessionIds
      mergedPlan {
        ...PreviewMergedCarePlanFields
      }
    }
  }
`;

/**
 * Hard-delete a preview session. Called on preview page unmount and when
 * the user starts a new preview run (to reap the prior one). Server-side
 * `deletePreviewSession` refuses to touch non-preview sessions, so this
 * is safe against misconfigured session IDs.
 */
export const DELETE_PREVIEW_SESSION = gql`
  mutation DeletePreviewSession($sessionId: ID!) {
    deletePreviewSession(sessionId: $sessionId) {
      sessionId
      contributingSessionsDeleted
    }
  }
`;
