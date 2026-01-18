'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  FunnelIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SeverityBadge, PriorityBadge, ReviewStatusBadge } from '@/components/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { LoadingState, EmptyState } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/layout/Header';
import { formatRelativeTime, calculateSLAStatus } from '@/lib/utils/formatters';
import { useReviewQueue, useOverdueReviews, ReviewQueueFilter } from '@/lib/hooks/useReviewQueue';
import clsx from 'clsx';
import type { SafetySeverity, ReviewPriority, ReviewStatus } from '@/lib/utils/colors';

const priorityOptions = ['ALL', 'P0_CRITICAL', 'P1_HIGH', 'P2_MEDIUM', 'P3_LOW'];
const statusOptions = ['ALL', 'PENDING_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED'];

export default function ReviewsPage() {
  const searchParams = useSearchParams();
  const showOverdue = searchParams.get('overdue') === 'true';

  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState(showOverdue ? 'PENDING_REVIEW' : 'ALL');
  const [showOverdueOnly, setShowOverdueOnly] = useState(showOverdue);

  // Build filter for GraphQL query
  const filter: ReviewQueueFilter = {};
  if (priorityFilter !== 'ALL') {
    filter.priority = priorityFilter as ReviewQueueFilter['priority'];
  }
  if (statusFilter !== 'ALL') {
    filter.status = statusFilter as ReviewQueueFilter['status'];
  }
  if (showOverdueOnly) {
    filter.isOverdue = true;
  }

  const {
    reviews,
    totalCount,
    hasNextPage,
    loading,
    error,
    loadMore,
    refetch,
  } = useReviewQueue(Object.keys(filter).length > 0 ? filter : undefined, 20);

  const {
    reviews: overdueReviews,
    totalCount: overdueCount,
  } = useOverdueReviews(5);

  // Update filter when URL params change
  useEffect(() => {
    const overdue = searchParams.get('overdue');
    if (overdue === 'true') {
      setShowOverdueOnly(true);
      setStatusFilter('PENDING_REVIEW');
    }
  }, [searchParams]);

  return (
    <div>
      <PageHeader
        title="Review Queue"
        subtitle={`${totalCount} total reviews`}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Review Queue' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            {overdueCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                <span className="text-sm font-medium text-red-700">
                  {overdueCount} overdue {overdueCount === 1 ? 'review' : 'reviews'}
                </span>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={loading}
            >
              <ArrowPathIcon className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
            {/* Priority Filter */}
            <div className="flex items-center gap-2">
              <FunnelIcon className="h-5 w-5 text-gray-400" />
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="input w-40"
              >
                {priorityOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === 'ALL' ? 'All Priorities' : option.replace('_', ' - ')}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input w-44"
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option === 'ALL' ? 'All Statuses' : option.replace(/_/g, ' ')}
                </option>
              ))}
            </select>

            {/* Overdue Toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOverdueOnly}
                onChange={(e) => setShowOverdueOnly(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Show overdue only</span>
            </label>
          </div>
        </CardBody>
      </Card>

      {/* Loading State */}
      {loading && reviews.length === 0 && (
        <LoadingState message="Loading review queue..." />
      )}

      {/* Error State */}
      {error && (
        <Card>
          <CardBody>
            <div className="text-center text-red-600 py-8">
              <p className="font-medium">Error loading review queue</p>
              <p className="text-sm text-gray-500 mt-1">{error.message}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                className="mt-4"
              >
                Try Again
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Review Queue Table */}
      {!error && (reviews.length > 0 || !loading) && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead sortable>Priority</TableHead>
                <TableHead>Safety Check</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead sortable>SLA Deadline</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review: any) => {
                const slaStatus = calculateSLAStatus(review.slaDeadline);
                return (
                  <TableRow key={review.id} clickable>
                    <TableCell>
                      <PriorityBadge priority={review.priority as ReviewPriority} />
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          {review.safetyCheck?.severity && (
                            <SeverityBadge
                              severity={review.safetyCheck.severity as SafetySeverity}
                              size="sm"
                            />
                          )}
                          <span className="text-xs text-gray-500">
                            {review.safetyCheck?.checkType?.replace(/_/g, ' ') || 'Safety Check'}
                          </span>
                        </div>
                        <Link
                          href={`/reviews/${review.id}`}
                          className="font-medium text-gray-900 hover:text-blue-600"
                        >
                          {review.safetyCheck?.title || 'Review Item'}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell>
                      {review.patient ? (
                        <Link
                          href={`/patients/${review.patient.id}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {review.patient.firstName} {review.patient.lastName}
                        </Link>
                      ) : (
                        <span className="text-gray-400">Unknown</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ReviewStatusBadge status={review.status as ReviewStatus} />
                    </TableCell>
                    <TableCell className="text-gray-500 text-sm">
                      {review.assignedTo || <span className="text-gray-400">Unassigned</span>}
                    </TableCell>
                    <TableCell>
                      <SLAIndicator
                        isOverdue={review.isOverdue || slaStatus.isOverdue}
                        remainingText={slaStatus.remainingText}
                        urgencyLevel={slaStatus.urgencyLevel}
                      />
                    </TableCell>
                    <TableCell>
                      <Link href={`/reviews/${review.id}`}>
                        <Button variant="primary" size="sm">
                          Review
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Empty State */}
          {reviews.length === 0 && !loading && (
            <div className="py-12">
              <EmptyState
                title="No reviews found"
                description="Try adjusting your filters"
              />
            </div>
          )}

          {/* Load More */}
          {hasNextPage && (
            <div className="p-4 border-t border-gray-200 text-center">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load More'}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

interface SLAIndicatorProps {
  isOverdue: boolean;
  remainingText: string;
  urgencyLevel: 'critical' | 'warning' | 'normal';
}

function SLAIndicator({ isOverdue, remainingText, urgencyLevel }: SLAIndicatorProps) {
  const urgencyClasses = {
    critical: 'bg-red-100 text-red-700 border-red-200',
    warning: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    normal: 'bg-green-100 text-green-700 border-green-200',
  };

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
        urgencyClasses[urgencyLevel],
        isOverdue && 'animate-pulse'
      )}
    >
      <ClockIcon className="h-3.5 w-3.5" />
      {remainingText}
    </div>
  );
}
