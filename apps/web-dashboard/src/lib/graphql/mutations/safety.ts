import { gql } from '@apollo/client';
import { SAFETY_CHECK_FRAGMENT } from '../queries/safety';

export const VALIDATE_SAFETY = gql`
  mutation ValidateSafety($input: ValidateSafetyInput!) {
    validateSafety(input: $input) {
      isValid
      checks {
        id
        checkType
        status
        severity
        title
        description
      }
      blockers {
        id
        checkType
        status
        severity
        title
        description
      }
      warnings {
        id
        checkType
        status
        severity
        title
        description
      }
      requiresReview
      reviewQueueItem {
        id
        priority
        slaDeadline
      }
    }
  }
`;

export const OVERRIDE_SAFETY_CHECK = gql`
  ${SAFETY_CHECK_FRAGMENT}
  mutation OverrideSafetyCheck($input: OverrideSafetyCheckInput!) {
    overrideSafetyCheck(input: $input) {
      ...SafetyCheckFields
    }
  }
`;
