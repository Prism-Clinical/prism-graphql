'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  PlusIcon,
  CheckCircleIcon,
  ClockIcon,
  UserIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  StopIcon,
} from '@heroicons/react/24/outline';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { LoadingState } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/layout/Header';
import { formatDateTime, formatDate, formatRelativeTime } from '@/lib/utils/formatters';
import {
  useCarePlan,
  useUpdateCarePlanStatus,
  useAddCarePlanGoal,
  useAddCarePlanIntervention,
} from '@/lib/hooks/useCarePlans';
import clsx from 'clsx';

export default function CarePlanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params.planId as string;

  const { carePlan, loading, error, refetch } = useCarePlan(planId);
  const { update: updateStatus, loading: statusLoading } = useUpdateCarePlanStatus();
  const { add: addGoal, loading: goalLoading } = useAddCarePlanGoal();
  const { add: addIntervention, loading: interventionLoading } = useAddCarePlanIntervention();

  const [showAddGoalModal, setShowAddGoalModal] = useState(false);
  const [showAddInterventionModal, setShowAddInterventionModal] = useState(false);
  const [newGoalDescription, setNewGoalDescription] = useState('');
  const [newGoalTargetDate, setNewGoalTargetDate] = useState('');
  const [newInterventionType, setNewInterventionType] = useState('');
  const [newInterventionDescription, setNewInterventionDescription] = useState('');
  const [newInterventionFrequency, setNewInterventionFrequency] = useState('');

  const handleStatusChange = async (newStatus: 'ACTIVE' | 'COMPLETED' | 'CANCELLED') => {
    try {
      await updateStatus(planId, newStatus);
      refetch();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleAddGoal = async () => {
    if (!newGoalDescription.trim()) return;
    try {
      await addGoal(planId, {
        description: newGoalDescription,
        targetDate: newGoalTargetDate || undefined,
      });
      setShowAddGoalModal(false);
      setNewGoalDescription('');
      setNewGoalTargetDate('');
      refetch();
    } catch (err) {
      console.error('Failed to add goal:', err);
    }
  };

  const handleAddIntervention = async () => {
    if (!newInterventionType || !newInterventionDescription.trim()) return;
    try {
      await addIntervention(planId, {
        type: newInterventionType,
        description: newInterventionDescription,
        frequency: newInterventionFrequency || undefined,
      });
      setShowAddInterventionModal(false);
      setNewInterventionType('');
      setNewInterventionDescription('');
      setNewInterventionFrequency('');
      refetch();
    } catch (err) {
      console.error('Failed to add intervention:', err);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Care Plan Details"
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Care Plans', href: '/careplans' },
            { label: 'Loading...' },
          ]}
        />
        <LoadingState message="Loading care plan..." />
      </div>
    );
  }

  if (error || !carePlan) {
    return (
      <div>
        <PageHeader
          title="Care Plan Details"
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Care Plans', href: '/careplans' },
            { label: 'Error' },
          ]}
        />
        <Card>
          <CardBody>
            <div className="text-center py-8">
              <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <p className="text-red-600 font-medium">
                {error?.message || 'Care plan not found'}
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

  const isDraft = carePlan.status === 'DRAFT';
  const isActive = carePlan.status === 'ACTIVE';
  const canEdit = isDraft || isActive;

  return (
    <div>
      <PageHeader
        title={carePlan.title}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Care Plans', href: '/careplans' },
          { label: carePlan.title },
        ]}
        actions={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Back
            </Button>
            {isDraft && (
              <Button
                variant="primary"
                onClick={() => handleStatusChange('ACTIVE')}
                disabled={statusLoading}
              >
                <PlayIcon className="h-4 w-4 mr-2" />
                Activate Plan
              </Button>
            )}
            {isActive && (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleStatusChange('COMPLETED')}
                  disabled={statusLoading}
                >
                  <CheckCircleIcon className="h-4 w-4 mr-2" />
                  Mark Complete
                </Button>
                <Button
                  variant="danger"
                  onClick={() => handleStatusChange('CANCELLED')}
                  disabled={statusLoading}
                >
                  <StopIcon className="h-4 w-4 mr-2" />
                  Cancel Plan
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Status Banner */}
      <div
        className={clsx(
          'rounded-lg p-4 mb-6 border',
          carePlan.status === 'ACTIVE'
            ? 'bg-green-50 border-green-200'
            : carePlan.status === 'DRAFT'
            ? 'bg-gray-50 border-gray-200'
            : carePlan.status === 'COMPLETED'
            ? 'bg-blue-50 border-blue-200'
            : 'bg-red-50 border-red-200'
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CarePlanStatusIcon status={carePlan.status} />
            <div>
              <p className="font-medium">{carePlan.status} Care Plan</p>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            {carePlan.startDate && (
              <span>Start: {formatDate(carePlan.startDate)}</span>
            )}
            {carePlan.targetEndDate && (
              <span className="ml-4">End: {formatDate(carePlan.targetEndDate)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Goals */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Goals ({carePlan.goals?.length || 0})</CardTitle>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddGoalModal(true)}
                >
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Add Goal
                </Button>
              )}
            </CardHeader>
            <CardBody>
              {carePlan.goals?.length > 0 ? (
                <div className="space-y-4">
                  {carePlan.goals.map((goal: any) => (
                    <div
                      key={goal.id}
                      className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg"
                    >
                      <div
                        className={clsx(
                          'h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0',
                          goal.status === 'COMPLETED'
                            ? 'bg-green-100 text-green-600'
                            : goal.status === 'IN_PROGRESS'
                            ? 'bg-yellow-100 text-yellow-600'
                            : 'bg-gray-200 text-gray-500'
                        )}
                      >
                        {goal.status === 'COMPLETED' ? (
                          <CheckCircleIcon className="h-5 w-5" />
                        ) : (
                          <ClockIcon className="h-5 w-5" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{goal.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                          <span
                            className={clsx(
                              'px-2 py-0.5 rounded-full text-xs font-medium',
                              goal.status === 'COMPLETED'
                                ? 'bg-green-100 text-green-700'
                                : goal.status === 'IN_PROGRESS'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-gray-100 text-gray-700'
                            )}
                          >
                            {goal.status || 'PENDING'}
                          </span>
                          {goal.targetDate && (
                            <span>Target: {formatDate(goal.targetDate)}</span>
                          )}
                          {goal.percentComplete !== undefined && (
                            <span>Progress: {goal.percentComplete}%</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">No goals defined yet</p>
              )}
            </CardBody>
          </Card>

          {/* Interventions */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Interventions ({carePlan.interventions?.length || 0})</CardTitle>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddInterventionModal(true)}
                >
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Add Intervention
                </Button>
              )}
            </CardHeader>
            <CardBody>
              {carePlan.interventions?.length > 0 ? (
                <div className="space-y-4">
                  {carePlan.interventions.map((intervention: any) => (
                    <div
                      key={intervention.id}
                      className="p-4 border border-gray-200 rounded-lg"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                              {intervention.type}
                            </span>
                            {intervention.validationStatus && (
                              <ValidationBadge
                                status={intervention.validationStatus}
                                confidence={intervention.validationConfidence}
                              />
                            )}
                          </div>
                          <p className="font-medium text-gray-900">
                            {intervention.description}
                          </p>
                          {intervention.frequency && (
                            <p className="text-sm text-gray-500 mt-1">
                              Frequency: {intervention.frequency}
                            </p>
                          )}
                        </div>
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded-full text-xs font-medium',
                            intervention.status === 'COMPLETED'
                              ? 'bg-green-100 text-green-700'
                              : intervention.status === 'ACTIVE'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-700'
                          )}
                        >
                          {intervention.status || 'PENDING'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">
                  No interventions defined yet
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Patient Info */}
          <Card>
            <CardHeader>
              <CardTitle>Patient</CardTitle>
            </CardHeader>
            <CardBody>
              {carePlan.patient ? (
                <Link
                  href={`/patients/${carePlan.patient.id}`}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <UserIcon className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{carePlan.patient.firstName} {carePlan.patient.lastName}</p>
                    <p className="text-sm text-blue-600">View Patient Profile</p>
                  </div>
                </Link>
              ) : (
                <p className="text-gray-500">Patient information unavailable</p>
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
                    <p className="font-medium">{formatRelativeTime(carePlan.createdAt)}</p>
                  </div>
                </div>
                {carePlan.updatedAt !== carePlan.createdAt && (
                  <div className="flex items-center gap-3">
                    <ClockIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-500">Last Updated</p>
                      <p className="font-medium">{formatRelativeTime(carePlan.updatedAt)}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Quick Links */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Links</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <Link href={`/patients/${carePlan.patient?.id}/safety`} className="block">
                <Button variant="outline" className="w-full">
                  Patient Safety Summary
                </Button>
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Add Goal Modal */}
      <Modal
        isOpen={showAddGoalModal}
        onClose={() => setShowAddGoalModal(false)}
        title="Add Goal"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Goal Description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={newGoalDescription}
              onChange={(e) => setNewGoalDescription(e.target.value)}
              placeholder="Describe the goal..."
              rows={3}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Target Date
            </label>
            <input
              type="date"
              value={newGoalTargetDate}
              onChange={(e) => setNewGoalTargetDate(e.target.value)}
              className="input w-full"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowAddGoalModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleAddGoal}
              disabled={goalLoading || !newGoalDescription.trim()}
            >
              {goalLoading ? 'Adding...' : 'Add Goal'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Intervention Modal */}
      <Modal
        isOpen={showAddInterventionModal}
        onClose={() => setShowAddInterventionModal(false)}
        title="Add Intervention"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type <span className="text-red-500">*</span>
            </label>
            <select
              value={newInterventionType}
              onChange={(e) => setNewInterventionType(e.target.value)}
              className="input w-full"
            >
              <option value="">Select type...</option>
              <option value="MEDICATION">Medication</option>
              <option value="PROCEDURE">Procedure</option>
              <option value="MONITORING">Monitoring</option>
              <option value="EDUCATION">Education</option>
              <option value="REFERRAL">Referral</option>
              <option value="LIFESTYLE">Lifestyle Modification</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={newInterventionDescription}
              onChange={(e) => setNewInterventionDescription(e.target.value)}
              placeholder="Describe the intervention..."
              rows={3}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Frequency
            </label>
            <input
              type="text"
              value={newInterventionFrequency}
              onChange={(e) => setNewInterventionFrequency(e.target.value)}
              placeholder="e.g., Daily, Weekly, As needed"
              className="input w-full"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowAddInterventionModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleAddIntervention}
              disabled={
                interventionLoading ||
                !newInterventionType ||
                !newInterventionDescription.trim()
              }
            >
              {interventionLoading ? 'Adding...' : 'Add Intervention'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CarePlanStatusIcon({ status }: { status: string }) {
  const iconClass = clsx(
    'h-8 w-8',
    status === 'ACTIVE'
      ? 'text-green-600'
      : status === 'COMPLETED'
      ? 'text-blue-600'
      : status === 'CANCELLED'
      ? 'text-red-600'
      : 'text-gray-500'
  );

  if (status === 'ACTIVE') return <PlayIcon className={iconClass} />;
  if (status === 'COMPLETED') return <CheckCircleIcon className={iconClass} />;
  if (status === 'CANCELLED') return <StopIcon className={iconClass} />;
  return <ClockIcon className={iconClass} />;
}

function ValidationBadge({
  status,
  confidence,
}: {
  status: string;
  confidence?: number;
}) {
  const colors =
    status === 'HIGH_CONFIDENCE'
      ? 'bg-green-100 text-green-700'
      : status === 'NEEDS_REVIEW'
      ? 'bg-yellow-100 text-yellow-700'
      : status === 'BLOCKED'
      ? 'bg-red-100 text-red-700'
      : 'bg-gray-100 text-gray-700';

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors}`}>
      {status}
      {confidence !== undefined && ` (${Math.round(confidence * 100)}%)`}
    </span>
  );
}
