'use client';

import Link from 'next/link';
import { ArrowLeftIcon, PencilIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useTrainingCarePlan, CarePlanStatus, GoalStatus, InterventionStatus } from '@/lib/hooks/useTrainingCarePlans';

const statusColors: Record<CarePlanStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  ACTIVE: 'bg-green-100 text-green-800',
  ON_HOLD: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-blue-100 text-blue-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

const goalStatusColors: Record<GoalStatus, string> = {
  NOT_STARTED: 'bg-gray-100 text-gray-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  ACHIEVED: 'bg-green-100 text-green-800',
  NOT_ACHIEVED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-600',
};

const interventionStatusColors: Record<InterventionStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  SCHEDULED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-gray-100 text-gray-600',
};

const priorityColors: Record<string, string> = {
  HIGH: 'bg-red-100 text-red-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  LOW: 'bg-blue-100 text-blue-800',
};

export default function ViewTrainingDataPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { carePlan, loading, error } = useTrainingCarePlan(id);

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (error || !carePlan) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load training data.</p>
        <Link href="/training-data">
          <Button variant="secondary" className="mt-4">Back to List</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/training-data">
            <Button variant="ghost" size="sm">
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{carePlan.title}</h1>
            <p className="mt-1 text-sm text-gray-500">Training data details</p>
          </div>
        </div>
        <Link href={`/training-data/${id}/edit`}>
          <Button>
            <PencilIcon className="h-4 w-4 mr-2" />
            Edit
          </Button>
        </Link>
      </div>

      <div className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">Status</dt>
                <dd className="mt-1">
                  <span className={`px-2 py-1 text-xs rounded ${statusColors[carePlan.status]}`}>
                    {carePlan.status}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Start Date</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatDate(carePlan.startDate)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Target End Date</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatDate(carePlan.targetEndDate)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Created</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatDate(carePlan.createdAt)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-sm font-medium text-gray-500">Condition Codes</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {carePlan.conditionCodes?.map((code) => (
                    <span key={code} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                      {code}
                    </span>
                  ))}
                </dd>
              </div>
              {carePlan.trainingDescription && (
                <div className="md:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">Training Description</dt>
                  <dd className="mt-1 text-sm text-gray-900">{carePlan.trainingDescription}</dd>
                </div>
              )}
              {carePlan.trainingTags?.length > 0 && (
                <div className="md:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">Training Tags</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {carePlan.trainingTags.map((tag) => (
                      <span key={tag} className="px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded">
                        {tag}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        {/* Goals */}
        <Card>
          <CardHeader>
            <CardTitle>Goals ({carePlan.goals?.length || 0})</CardTitle>
          </CardHeader>
          <CardBody>
            {!carePlan.goals?.length ? (
              <p className="text-sm text-gray-500 text-center py-4">No goals defined.</p>
            ) : (
              <div className="space-y-4">
                {carePlan.goals.map((goal) => (
                  <div key={goal.id} className="border border-gray-200 rounded-md p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{goal.description}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-sm">
                          <span className={`px-2 py-0.5 text-xs rounded ${goalStatusColors[goal.status]}`}>
                            {goal.status.replace(/_/g, ' ')}
                          </span>
                          <span className={`px-2 py-0.5 text-xs rounded ${priorityColors[goal.priority]}`}>
                            {goal.priority}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      {goal.targetValue && (
                        <div>
                          <span className="text-gray-500">Target:</span>{' '}
                          <span className="text-gray-900">{goal.targetValue}</span>
                        </div>
                      )}
                      {goal.currentValue && (
                        <div>
                          <span className="text-gray-500">Current:</span>{' '}
                          <span className="text-gray-900">{goal.currentValue}</span>
                        </div>
                      )}
                      {goal.targetDate && (
                        <div>
                          <span className="text-gray-500">Target Date:</span>{' '}
                          <span className="text-gray-900">{formatDate(goal.targetDate)}</span>
                        </div>
                      )}
                      {goal.percentComplete !== undefined && goal.percentComplete !== null && (
                        <div>
                          <span className="text-gray-500">Progress:</span>{' '}
                          <span className="text-gray-900">{goal.percentComplete}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Interventions */}
        <Card>
          <CardHeader>
            <CardTitle>Interventions ({carePlan.interventions?.length || 0})</CardTitle>
          </CardHeader>
          <CardBody>
            {!carePlan.interventions?.length ? (
              <p className="text-sm text-gray-500 text-center py-4">No interventions defined.</p>
            ) : (
              <div className="space-y-4">
                {carePlan.interventions.map((intervention) => (
                  <div key={intervention.id} className="border border-gray-200 rounded-md p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded font-medium">
                            {intervention.type.replace(/_/g, ' ')}
                          </span>
                          <span className={`px-2 py-0.5 text-xs rounded ${interventionStatusColors[intervention.status]}`}>
                            {intervention.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="mt-2 font-medium text-gray-900">{intervention.description}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                      {intervention.medicationCode && (
                        <div>
                          <span className="text-gray-500">Medication:</span>{' '}
                          <span className="text-gray-900">{intervention.medicationCode}</span>
                        </div>
                      )}
                      {intervention.dosage && (
                        <div>
                          <span className="text-gray-500">Dosage:</span>{' '}
                          <span className="text-gray-900">{intervention.dosage}</span>
                        </div>
                      )}
                      {intervention.frequency && (
                        <div>
                          <span className="text-gray-500">Frequency:</span>{' '}
                          <span className="text-gray-900">{intervention.frequency}</span>
                        </div>
                      )}
                      {intervention.procedureCode && (
                        <div>
                          <span className="text-gray-500">Procedure:</span>{' '}
                          <span className="text-gray-900">{intervention.procedureCode}</span>
                        </div>
                      )}
                      {intervention.scheduledDate && (
                        <div>
                          <span className="text-gray-500">Scheduled:</span>{' '}
                          <span className="text-gray-900">{formatDate(intervention.scheduledDate)}</span>
                        </div>
                      )}
                      {intervention.completedDate && (
                        <div>
                          <span className="text-gray-500">Completed:</span>{' '}
                          <span className="text-gray-900">{formatDate(intervention.completedDate)}</span>
                        </div>
                      )}
                    </div>
                    {intervention.patientInstructions && (
                      <div className="mt-3 text-sm">
                        <span className="text-gray-500">Instructions:</span>{' '}
                        <span className="text-gray-900">{intervention.patientInstructions}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
