import { useQuery, useMutation } from '@apollo/client';
import {
  GET_REVIEW_QUEUE,
  GET_REVIEW_QUEUE_ITEM,
  GET_MY_REVIEW_QUEUE,
  GET_OVERDUE_REVIEWS,
  GET_REVIEW_STATS,
} from '../graphql/queries/reviews';
import {
  ASSIGN_REVIEW,
  RESOLVE_REVIEW,
  ESCALATE_REVIEW,
  BULK_ASSIGN_REVIEWS,
} from '../graphql/mutations/reviews';

export interface ReviewQueueFilter {
  status?: 'PENDING_REVIEW' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'ESCALATED';
  priority?: 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW';
  assignedTo?: string;
  isOverdue?: boolean;
}

export function useReviewQueue(filter?: ReviewQueueFilter, first = 20) {
  const { data, loading, error, fetchMore, refetch } = useQuery(GET_REVIEW_QUEUE, {
    variables: { filter, pagination: { first } },
    notifyOnNetworkStatusChange: true,
  });

  const loadMore = () => {
    if (data?.reviewQueue?.pageInfo?.hasNextPage) {
      fetchMore({
        variables: {
          pagination: {
            first,
            after: data.reviewQueue.pageInfo.endCursor,
          },
        },
      });
    }
  };

  return {
    reviews: data?.reviewQueue?.edges?.map((e: any) => e.node) || [],
    totalCount: data?.reviewQueue?.totalCount || 0,
    hasNextPage: data?.reviewQueue?.pageInfo?.hasNextPage || false,
    loading,
    error,
    loadMore,
    refetch,
  };
}

export function useReviewQueueItem(id: string) {
  const { data, loading, error, refetch } = useQuery(GET_REVIEW_QUEUE_ITEM, {
    variables: { id },
    skip: !id,
  });

  return {
    review: data?.reviewQueueItem || null,
    loading,
    error,
    refetch,
  };
}

export function useMyReviewQueue(status?: string, first = 20) {
  const { data, loading, error, refetch } = useQuery(GET_MY_REVIEW_QUEUE, {
    variables: { status, pagination: { first } },
  });

  return {
    reviews: data?.myReviewQueue?.edges?.map((e: any) => e.node) || [],
    totalCount: data?.myReviewQueue?.totalCount || 0,
    loading,
    error,
    refetch,
  };
}

export function useOverdueReviews(first = 20) {
  const { data, loading, error, refetch } = useQuery(GET_OVERDUE_REVIEWS, {
    variables: { pagination: { first } },
    pollInterval: 60000, // Refresh every minute
  });

  return {
    reviews: data?.overdueReviews?.edges?.map((e: any) => e.node) || [],
    totalCount: data?.overdueReviews?.totalCount || 0,
    loading,
    error,
    refetch,
  };
}

export function useReviewStats() {
  const { data, loading, error, refetch } = useQuery(GET_REVIEW_STATS, {
    pollInterval: 30000, // Refresh every 30 seconds
  });

  return {
    pendingCount: data?.pendingReviews?.totalCount || 0,
    overdueCount: data?.overdueReviews?.totalCount || 0,
    recentReviews: data?.recentReviews?.edges?.map((e: any) => e.node) || [],
    loading,
    error,
    refetch,
  };
}

export function useAssignReview() {
  const [assignReview, { loading, error }] = useMutation(ASSIGN_REVIEW, {
    refetchQueries: [GET_REVIEW_QUEUE, GET_REVIEW_STATS],
  });

  const assign = async (input: { reviewId: string; assignedTo: string }) => {
    const result = await assignReview({ variables: { input } });
    return result.data?.assignReview;
  };

  return {
    assign,
    loading,
    error,
  };
}

export function useResolveReview() {
  const [resolveReview, { loading, error }] = useMutation(RESOLVE_REVIEW, {
    refetchQueries: [GET_REVIEW_QUEUE, GET_REVIEW_STATS],
  });

  const resolve = async (input: {
    reviewId: string;
    decision: 'APPROVED' | 'REJECTED' | 'MODIFIED';
    resolvedBy: string;
    notes?: string;
  }) => {
    const result = await resolveReview({ variables: { input } });
    return result.data?.resolveReview;
  };

  return {
    resolve,
    loading,
    error,
  };
}

export function useEscalateReview() {
  const [escalateReview, { loading, error }] = useMutation(ESCALATE_REVIEW, {
    refetchQueries: [GET_REVIEW_QUEUE, GET_REVIEW_STATS],
  });

  const escalate = async (input: {
    reviewId: string;
    escalatedBy: string;
    escalationReason: string;
  }) => {
    const result = await escalateReview({ variables: { input } });
    return result.data?.escalateReview;
  };

  return {
    escalate,
    loading,
    error,
  };
}

export function useBulkAssignReviews() {
  const [bulkAssign, { loading, error }] = useMutation(BULK_ASSIGN_REVIEWS, {
    refetchQueries: [GET_REVIEW_QUEUE],
  });

  const assign = async (input: { reviewIds: string[]; assignedTo: string }) => {
    const result = await bulkAssign({ variables: { input } });
    return result.data?.bulkAssignReviews;
  };

  return {
    assign,
    loading,
    error,
  };
}
