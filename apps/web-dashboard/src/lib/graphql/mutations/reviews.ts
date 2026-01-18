import { gql } from '@apollo/client';
import { REVIEW_QUEUE_ITEM_FRAGMENT } from '../queries/reviews';

export const ASSIGN_REVIEW = gql`
  ${REVIEW_QUEUE_ITEM_FRAGMENT}
  mutation AssignReview($input: AssignReviewInput!) {
    assignReview(input: $input) {
      ...ReviewQueueItemFields
    }
  }
`;

export const RESOLVE_REVIEW = gql`
  ${REVIEW_QUEUE_ITEM_FRAGMENT}
  mutation ResolveReview($input: ResolveReviewInput!) {
    resolveReview(input: $input) {
      ...ReviewQueueItemFields
    }
  }
`;

export const ESCALATE_REVIEW = gql`
  ${REVIEW_QUEUE_ITEM_FRAGMENT}
  mutation EscalateReview($input: EscalateReviewInput!) {
    escalateReview(input: $input) {
      ...ReviewQueueItemFields
    }
  }
`;

export const BULK_ASSIGN_REVIEWS = gql`
  mutation BulkAssignReviews($input: BulkAssignReviewsInput!) {
    bulkAssignReviews(input: $input) {
      successCount
      failedIds
    }
  }
`;
