'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowUpCircleIcon,
  ClockIcon,
  UserIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SeverityBadge, PriorityBadge, ReviewStatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { LoadingState } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/layout/Header';
import {
  formatDateTime,
  formatRelativeTime,
  formatCheckType,
  calculateSLAStatus,
} from '@/lib/utils/formatters';
import {
  useReviewQueueItem,
  useAssignReview,
  useResolveReview,
  useEscalateReview,
} from '@/lib/hooks/useReviewQueue';
import { severityColors } from '@/lib/utils/colors';
import type { SafetySeverity, ReviewPriority, ReviewStatus } from '@/lib/utils/colors';
import clsx from 'clsx';

type ActionType = 'approve' | 'reject' | 'escalate' | null;

export default function ReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const reviewId = params.reviewId as string;

  const { review, loading, error, refetch } = useReviewQueueItem(reviewId);
  const { assign, loading: assignLoading } = useAssignReview();
  const { resolve, loading: resolveLoading } = useResolveReview();
  const { escalate, loading: escalateLoading } = useEscalateReview();

  const [actionType, setActionType] = useState<ActionType>(null);
  const [notes, setNotes] = useState('');
  const [escalationReason, setEscalationReason] = useState('');
  const [actionError, setActionError] = useState('');

  const handleAssignToMe = async () => {
    try {
      await assign({
        reviewId,
        assignedTo: 'current-user', // In production, get from auth context
      });
      refetch();
    } catch (err) {
      console.error('Failed to assign review:', err);
    }
  };

  const handleAction = async () => {
    setActionError('');

    if (actionType === 'reject' && !notes.trim()) {
      setActionError('Notes are required when rejecting');
      return;
    }

    if (actionType === 'escalate' && !escalationReason.trim()) {
      setActionError('Escalation reason is required');
      return;
    }

    try {
      if (actionType === 'approve') {
        await resolve({
          reviewId,
          decision: 'APPROVED',
          resolvedBy: 'current-user',
          notes: notes || undefined,
        });
      } else if (actionType === 'reject') {
        await resolve({
          reviewId,
          decision: 'REJECTED',
          resolvedBy: 'current-user',
          notes,
        });
      } else if (actionType === 'escalate') {
        await escalate({
          reviewId,
          escalatedBy: 'current-user',
          escalationReason,
        });
      }

      setActionType(null);
      setNotes('');
      setEscalationReason('');
      router.push('/reviews');
    } catch (err) {
      setActionError('Failed to process action. Please try again.');
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Review Details"
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Review Queue', href: '/reviews' },
            { label: 'Loading...' },
          ]}
        />
        <LoadingState message="Loading review details..." />
      </div>
    );
  }

  if (error || !review) {
    return (
      <div>
        <PageHeader
          title="Review Details"
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Review Queue', href: '/reviews' },
            { label: 'Error' },
          ]}
        />
        <Card>
          <CardBody>
            <div className="text-center py-8">
              <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <p className="text-red-600 font-medium">
                {error?.message || 'Review not found'}
              </p>
              <Button variant="outline" onClick={() => router.back()} className="mt-4">
                Go Back
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const slaStatus = calculateSLAStatus(review.slaDeadline);
  const severity = review.safetyCheck?.severity as SafetySeverity;
  const priority = review.priority as ReviewPriority;
  const status = review.status as ReviewStatus;
  const colors = severity ? severityColors[severity] : severityColors.INFO;
  const canTakeAction = status === 'PENDING_REVIEW' || status === 'IN_REVIEW';
  const isResolved = status === 'APPROVED' || status === 'REJECTED' || status === 'ESCALATED';

  return (
    <div>
      <PageHeader
        title="Review Details"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Review Queue', href: '/reviews' },
          { label: `Review #${reviewId.substring(0, 8)}` },
        ]}
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back to Queue
          </Button>
        }
      />

      {/* SLA Banner */}
      {!isResolved && (
        <div
          className={clsx(
            'rounded-lg p-4 mb-6 border',
            slaStatus.isOverdue
              ? 'bg-red-50 border-red-200'
              : slaStatus.urgencyLevel === 'warning'
              ? 'bg-yellow-50 border-yellow-200'
              : 'bg-green-50 border-green-200'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ClockIcon
                className={clsx(
                  'h-6 w-6',
                  slaStatus.isOverdue
                    ? 'text-red-600'
                    : slaStatus.urgencyLevel === 'warning'
                    ? 'text-yellow-600'
                    : 'text-green-600'
                )}
              />
              <div>
                <p
                  className={clsx(
                    'font-medium',
                    slaStatus.isOverdue
                      ? 'text-red-700'
                      : slaStatus.urgencyLevel === 'warning'
                      ? 'text-yellow-700'
                      : 'text-green-700'
                  )}
                >
                  {slaStatus.isOverdue ? 'OVERDUE' : 'SLA Deadline'}
                </p>
                <p className="text-sm text-gray-600">
                  {slaStatus.remainingText} • {formatDateTime(review.slaDeadline)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <PriorityBadge priority={priority} />
              <ReviewStatusBadge status={status} />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Safety Check Details */}
          <Card>
            <CardHeader>
              <CardTitle>Safety Check</CardTitle>
            </CardHeader>
            <CardBody>
              <div className={`${colors.bg} ${colors.border} border rounded-lg p-4`}>
                <div className="flex items-start gap-3">
                  <ExclamationTriangleIcon className={`h-6 w-6 ${colors.text} flex-shrink-0`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {severity && <SeverityBadge severity={severity} />}
                      <span className="text-sm text-gray-500">
                        {formatCheckType(review.safetyCheck?.checkType)}
                      </span>
                    </div>
                    <h3 className={`font-semibold ${colors.text}`}>
                      {review.safetyCheck?.title}
                    </h3>
                    {review.safetyCheck?.description && (
                      <p className="text-gray-600 mt-2">{review.safetyCheck.description}</p>
                    )}
                    {review.safetyCheck?.clinicalRationale && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <p className="text-sm font-medium text-gray-500 mb-1">
                          Clinical Rationale
                        </p>
                        <p className="text-gray-700">{review.safetyCheck.clinicalRationale}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <Link href={`/safety/${review.safetyCheck?.id}`}>
                  <Button variant="outline" size="sm">
                    View Full Safety Check Details
                  </Button>
                </Link>
              </div>
            </CardBody>
          </Card>

          {/* Resolution Info (if resolved) */}
          {review.resolution && (
            <Card>
              <CardHeader>
                <CardTitle>Resolution</CardTitle>
              </CardHeader>
              <CardBody>
                <div
                  className={clsx(
                    'rounded-lg p-4 border',
                    review.resolution.decision === 'APPROVED'
                      ? 'bg-green-50 border-green-200'
                      : review.resolution.decision === 'REJECTED'
                      ? 'bg-red-50 border-red-200'
                      : 'bg-gray-50 border-gray-200'
                  )}
                >
                  <div className="flex items-center gap-2 mb-3">
                    {review.resolution.decision === 'APPROVED' ? (
                      <CheckCircleIcon className="h-5 w-5 text-green-600" />
                    ) : review.resolution.decision === 'REJECTED' ? (
                      <XCircleIcon className="h-5 w-5 text-red-600" />
                    ) : (
                      <ArrowUpCircleIcon className="h-5 w-5 text-gray-600" />
                    )}
                    <span className="font-medium">
                      {review.resolution.decision} by {review.resolution.resolvedBy}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {formatDateTime(review.resolution.resolvedAt)}
                  </p>
                  {review.resolution.notes && (
                    <p className="mt-3 text-gray-700">{review.resolution.notes}</p>
                  )}
                  {review.resolution.escalationReason && (
                    <p className="mt-3 text-gray-700">
                      <span className="font-medium">Escalation Reason:</span>{' '}
                      {review.resolution.escalationReason}
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Action Buttons */}
          {canTakeAction && (
            <Card>
              <CardHeader>
                <CardTitle>Take Action</CardTitle>
              </CardHeader>
              <CardBody>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="primary"
                    onClick={() => setActionType('approve')}
                    className="flex items-center gap-2"
                  >
                    <CheckCircleIcon className="h-5 w-5" />
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setActionType('reject')}
                    className="flex items-center gap-2"
                  >
                    <XCircleIcon className="h-5 w-5" />
                    Reject
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setActionType('escalate')}
                    className="flex items-center gap-2"
                  >
                    <ArrowUpCircleIcon className="h-5 w-5" />
                    Escalate
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Patient Info */}
          <Card>
            <CardHeader>
              <CardTitle>Patient</CardTitle>
            </CardHeader>
            <CardBody>
              {review.patient ? (
                <Link
                  href={`/patients/${review.patient.id}`}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <UserIcon className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{review.patient.firstName} {review.patient.lastName}</p>
                    <p className="text-sm text-blue-600">View Patient Profile</p>
                  </div>
                </Link>
              ) : (
                <p className="text-gray-500">Patient information unavailable</p>
              )}
            </CardBody>
          </Card>

          {/* Assignment */}
          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardBody>
              {review.assignedTo ? (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-green-100 rounded-full flex items-center justify-center">
                    <UserIcon className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{review.assignedTo}</p>
                    <p className="text-sm text-gray-500">
                      Assigned {formatRelativeTime(review.assignedAt)}
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-gray-500 mb-3">Not assigned</p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleAssignToMe}
                    disabled={assignLoading}
                  >
                    {assignLoading ? 'Assigning...' : 'Assign to Me'}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <ClockIcon className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Created</p>
                    <p className="font-medium">{formatRelativeTime(review.createdAt)}</p>
                  </div>
                </div>
                {review.assignedAt && (
                  <div className="flex items-center gap-3">
                    <UserIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-500">Assigned</p>
                      <p className="font-medium">{formatRelativeTime(review.assignedAt)}</p>
                    </div>
                  </div>
                )}
                {review.resolution?.resolvedAt && (
                  <div className="flex items-center gap-3">
                    <CheckCircleIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-500">Resolved</p>
                      <p className="font-medium">
                        {formatRelativeTime(review.resolution.resolvedAt)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Action Modal */}
      <Modal
        isOpen={actionType !== null}
        onClose={() => {
          setActionType(null);
          setNotes('');
          setEscalationReason('');
          setActionError('');
        }}
        title={
          actionType === 'approve'
            ? 'Approve Review'
            : actionType === 'reject'
            ? 'Reject Review'
            : 'Escalate Review'
        }
      >
        <div className="space-y-4">
          {actionType === 'approve' && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircleIcon className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-green-700">
                  <p className="font-medium">Approve this safety review</p>
                  <p>
                    The associated action will be allowed to proceed. You can optionally add notes.
                  </p>
                </div>
              </div>
            </div>
          )}

          {actionType === 'reject' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <XCircleIcon className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-700">
                  <p className="font-medium">Reject this safety review</p>
                  <p>
                    The associated action will be blocked. Please provide notes explaining the
                    rejection.
                  </p>
                </div>
              </div>
            </div>
          )}

          {actionType === 'escalate' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <ArrowUpCircleIcon className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-yellow-700">
                  <p className="font-medium">Escalate this review</p>
                  <p>
                    This will escalate the review to a higher authority for decision. Please
                    provide the reason for escalation.
                  </p>
                </div>
              </div>
            </div>
          )}

          {(actionType === 'approve' || actionType === 'reject') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes {actionType === 'reject' && <span className="text-red-500">*</span>}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  actionType === 'approve'
                    ? 'Optional notes about this approval...'
                    : 'Explain why this review is being rejected...'
                }
                rows={4}
                className="input w-full"
              />
            </div>
          )}

          {actionType === 'escalate' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Escalation Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={escalationReason}
                onChange={(e) => setEscalationReason(e.target.value)}
                placeholder="Explain why this review needs to be escalated..."
                rows={4}
                className="input w-full"
              />
            </div>
          )}

          {actionError && <p className="text-red-600 text-sm">{actionError}</p>}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setActionType(null);
                setNotes('');
                setEscalationReason('');
                setActionError('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant={actionType === 'approve' ? 'primary' : actionType === 'reject' ? 'danger' : 'outline'}
              onClick={handleAction}
              disabled={resolveLoading || escalateLoading}
            >
              {resolveLoading || escalateLoading
                ? 'Processing...'
                : actionType === 'approve'
                ? 'Confirm Approval'
                : actionType === 'reject'
                ? 'Confirm Rejection'
                : 'Confirm Escalation'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
