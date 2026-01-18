'use client';

import Link from 'next/link';
import { ArrowLeftIcon, PencilIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useCarePlanTemplate, TemplateCategory, GoalPriority, InterventionType } from '@/lib/hooks/useCarePlanTemplates';

const categoryLabels: Record<TemplateCategory, string> = {
  CHRONIC_DISEASE: 'Chronic Disease',
  PREVENTIVE_CARE: 'Preventive Care',
  POST_PROCEDURE: 'Post Procedure',
  MEDICATION_MANAGEMENT: 'Medication Management',
  LIFESTYLE_MODIFICATION: 'Lifestyle Modification',
};

const categoryColors: Record<TemplateCategory, string> = {
  CHRONIC_DISEASE: 'bg-blue-100 text-blue-800',
  PREVENTIVE_CARE: 'bg-green-100 text-green-800',
  POST_PROCEDURE: 'bg-purple-100 text-purple-800',
  MEDICATION_MANAGEMENT: 'bg-orange-100 text-orange-800',
  LIFESTYLE_MODIFICATION: 'bg-teal-100 text-teal-800',
};

const priorityColors: Record<GoalPriority, string> = {
  HIGH: 'bg-red-100 text-red-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  LOW: 'bg-blue-100 text-blue-800',
};

export default function ViewCarePlanPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { template, loading, error } = useCarePlanTemplate(id);

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

  if (error || !template) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load care plan.</p>
        <Link href="/care-plans">
          <Button variant="secondary" className="mt-4">Back to List</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/care-plans">
            <Button variant="ghost" size="sm">
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
            <p className="mt-1 text-sm text-gray-500">Care plan details</p>
          </div>
        </div>
        <Link href={`/care-plans/${id}/edit`}>
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
                <dt className="text-sm font-medium text-gray-500">Category</dt>
                <dd className="mt-1">
                  <span className={`px-2 py-1 text-xs rounded ${categoryColors[template.category]}`}>
                    {categoryLabels[template.category]}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Status</dt>
                <dd className="mt-1">
                  <span className={`px-2 py-1 text-xs rounded ${template.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {template.isActive ? 'Active' : 'Inactive'}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Version</dt>
                <dd className="mt-1 text-sm text-gray-900">{template.version}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Created</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatDate(template.createdAt)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-sm font-medium text-gray-500">Condition Codes</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {template.conditionCodes?.map((code) => (
                    <span key={code} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                      {code}
                    </span>
                  ))}
                </dd>
              </div>
              {template.description && (
                <div className="md:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">Description</dt>
                  <dd className="mt-1 text-sm text-gray-900">{template.description}</dd>
                </div>
              )}
              {template.guidelineSource && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Guideline Source</dt>
                  <dd className="mt-1 text-sm text-gray-900">{template.guidelineSource}</dd>
                </div>
              )}
              {template.evidenceGrade && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Evidence Grade</dt>
                  <dd className="mt-1 text-sm text-gray-900">{template.evidenceGrade}</dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        {/* Default Goals */}
        <Card>
          <CardHeader>
            <CardTitle>Default Goals ({template.defaultGoals?.length || 0})</CardTitle>
          </CardHeader>
          <CardBody>
            {!template.defaultGoals?.length ? (
              <p className="text-sm text-gray-500 text-center py-4">No default goals defined.</p>
            ) : (
              <div className="space-y-4">
                {template.defaultGoals.map((goal, index) => (
                  <div key={index} className="border border-gray-200 rounded-md p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{goal.description}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-sm">
                          <span className={`px-2 py-0.5 text-xs rounded ${priorityColors[goal.priority]}`}>
                            {goal.priority}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                      {goal.defaultTargetValue && (
                        <div>
                          <span className="text-gray-500">Default Target:</span>{' '}
                          <span className="text-gray-900">{goal.defaultTargetValue}</span>
                        </div>
                      )}
                      {goal.defaultTargetDays && (
                        <div>
                          <span className="text-gray-500">Target Days:</span>{' '}
                          <span className="text-gray-900">{goal.defaultTargetDays} days</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Default Interventions */}
        <Card>
          <CardHeader>
            <CardTitle>Default Interventions ({template.defaultInterventions?.length || 0})</CardTitle>
          </CardHeader>
          <CardBody>
            {!template.defaultInterventions?.length ? (
              <p className="text-sm text-gray-500 text-center py-4">No default interventions defined.</p>
            ) : (
              <div className="space-y-4">
                {template.defaultInterventions.map((intervention, index) => (
                  <div key={index} className="border border-gray-200 rounded-md p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded font-medium">
                            {intervention.type.replace(/_/g, ' ')}
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
                      {intervention.procedureCode && (
                        <div>
                          <span className="text-gray-500">Procedure:</span>{' '}
                          <span className="text-gray-900">{intervention.procedureCode}</span>
                        </div>
                      )}
                      {intervention.defaultScheduleDays && (
                        <div>
                          <span className="text-gray-500">Schedule:</span>{' '}
                          <span className="text-gray-900">{intervention.defaultScheduleDays} days</span>
                        </div>
                      )}
                    </div>
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
