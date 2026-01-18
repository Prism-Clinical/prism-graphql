import { gql } from '@apollo/client';

export const REVIEW_QUEUE_ITEM_FRAGMENT = gql`
  fragment ReviewQueueItemFields on ReviewQueueItem {
    id
    status
    priority
    assignedTo
    assignedAt
    slaDeadline
    isOverdue
    createdAt
    updatedAt
    patient {
      id
      firstName
      lastName
    }
    safetyCheck {
      id
      checkType
      status
      severity
      title
      description
      clinicalRationale
    }
    resolution {
      resolvedBy
      resolvedAt
      decision
      notes
      escalationReason
    }
  }
`;

export const GET_REVIEW_QUEUE = gql`
  ${REVIEW_QUEUE_ITEM_FRAGMENT}
  query GetReviewQueue(
    $filter: ReviewQueueFilterInput
    $pagination: PaginationInput
  ) {
    reviewQueue(filter: $filter, pagination: $pagination) {
      edges {
        node {
          ...ReviewQueueItemFields
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_REVIEW_QUEUE_ITEM = gql`
  ${REVIEW_QUEUE_ITEM_FRAGMENT}
  query GetReviewQueueItem($id: ID!) {
    reviewQueueItem(id: $id) {
      ...ReviewQueueItemFields
    }
  }
`;

export const GET_MY_REVIEW_QUEUE = gql`
  ${REVIEW_QUEUE_ITEM_FRAGMENT}
  query GetMyReviewQueue($status: ReviewQueueStatus, $pagination: PaginationInput) {
    myReviewQueue(status: $status, pagination: $pagination) {
      edges {
        node {
          ...ReviewQueueItemFields
        }
      }
      totalCount
    }
  }
`;

export const GET_OVERDUE_REVIEWS = gql`
  ${REVIEW_QUEUE_ITEM_FRAGMENT}
  query GetOverdueReviews($pagination: PaginationInput) {
    overdueReviews(pagination: $pagination) {
      edges {
        node {
          ...ReviewQueueItemFields
        }
      }
      totalCount
    }
  }
`;

export const GET_REVIEW_STATS = gql`
  query GetReviewStats {
    pendingReviews: reviewQueue(
      filter: { status: PENDING_REVIEW }
    ) {
      totalCount
    }
    overdueReviews: overdueReviews {
      totalCount
    }
    recentReviews: reviewQueue(
      filter: { status: PENDING_REVIEW }
      pagination: { first: 5 }
    ) {
      edges {
        node {
          id
          priority
          slaDeadline
          isOverdue
          patient {
            id
            firstName
            lastName
          }
          safetyCheck {
            id
            title
            severity
          }
        }
      }
    }
  }
`;
