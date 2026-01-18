'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/layout/Header';
import { useCreateCarePlan, useCarePlanTemplates } from '@/lib/hooks/useCarePlans';
import clsx from 'clsx';

interface Goal {
  id: string;
  description: string;
  targetDate: string;
}

interface Intervention {
  id: string;
  type: string;
  description: string;
  frequency: string;
}

export default function NewCarePlanPage() {
  const router = useRouter();
  const { create, loading: createLoading } = useCreateCarePlan();
  const { templates, loading: templatesLoading } = useCarePlanTemplates();

  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [validationResults, setValidationResults] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);

  const addGoal = () => {
    setGoals([
      ...goals,
      { id: crypto.randomUUID(), description: '', targetDate: '' },
    ]);
  };

  const updateGoal = (id: string, field: keyof Goal, value: string) => {
    setGoals(goals.map((g) => (g.id === id ? { ...g, [field]: value } : g)));
  };

  const removeGoal = (id: string) => {
    setGoals(goals.filter((g) => g.id !== id));
  };

  const addIntervention = () => {
    setInterventions([
      ...interventions,
      { id: crypto.randomUUID(), type: '', description: '', frequency: '' },
    ]);
  };

  const updateIntervention = (
    id: string,
    field: keyof Intervention,
    value: string
  ) => {
    setInterventions(
      interventions.map((i) => (i.id === id ? { ...i, [field]: value } : i))
    );
  };

  const removeIntervention = (id: string) => {
    setInterventions(interventions.filter((i) => i.id !== id));
  };

  const applyTemplate = (template: any) => {
    setTitle(template.name);
    setDescription(template.description || '');
    setGoals(
      template.goals?.map((g: any) => ({
        id: crypto.randomUUID(),
        description: g.description,
        targetDate: g.targetDays
          ? new Date(Date.now() + g.targetDays * 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0]
          : '',
      })) || []
    );
    setInterventions(
      template.interventions?.map((i: any) => ({
        id: crypto.randomUUID(),
        type: i.type,
        description: i.description,
        frequency: i.frequency || '',
      })) || []
    );
    setShowTemplates(false);
  };

  const handleSubmit = async () => {
    setError('');
    setValidationResults([]);

    if (!patientId || !title) {
      setError('Patient and title are required');
      return;
    }

    try {
      const result = await create({
        patientId,
        title,
        description: description || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        goals: goals
          .filter((g) => g.description.trim())
          .map((g) => ({
            description: g.description,
            targetDate: g.targetDate || undefined,
          })),
        interventions: interventions
          .filter((i) => i.type && i.description.trim())
          .map((i) => ({
            type: i.type,
            description: i.description,
            frequency: i.frequency || undefined,
          })),
      });

      if (result?.success && result?.carePlan) {
        router.push(`/careplans/${result.carePlan.id}`);
      } else if (result?.validationResults) {
        setValidationResults(result.validationResults);
        if (result?.blockedInterventions?.length > 0) {
          setError(
            `${result.blockedInterventions.length} intervention(s) were blocked by validation`
          );
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create care plan');
    }
  };

  return (
    <div>
      <PageHeader
        title="Create Care Plan"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Care Plans', href: '/careplans' },
          { label: 'New' },
        ]}
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Patient <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={patientId}
                    onChange={(e) => setPatientId(e.target.value)}
                    placeholder="Enter patient ID"
                    className="input flex-1"
                  />
                  {patientName && (
                    <span className="flex items-center px-3 bg-gray-100 rounded text-sm">
                      {patientName}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Enter patient ID or search by name
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Care plan title"
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of the care plan"
                  rows={3}
                  className="input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="input w-full"
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Goals */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Goals</CardTitle>
              <Button variant="outline" size="sm" onClick={addGoal}>
                <PlusIcon className="h-4 w-4 mr-1" />
                Add Goal
              </Button>
            </CardHeader>
            <CardBody>
              {goals.length > 0 ? (
                <div className="space-y-4">
                  {goals.map((goal, index) => (
                    <div
                      key={goal.id}
                      className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg"
                    >
                      <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-medium">
                        {index + 1}
                      </span>
                      <div className="flex-1 space-y-3">
                        <input
                          type="text"
                          value={goal.description}
                          onChange={(e) =>
                            updateGoal(goal.id, 'description', e.target.value)
                          }
                          placeholder="Goal description"
                          className="input w-full"
                        />
                        <input
                          type="date"
                          value={goal.targetDate}
                          onChange={(e) =>
                            updateGoal(goal.id, 'targetDate', e.target.value)
                          }
                          className="input w-48"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeGoal(goal.id)}
                      >
                        <TrashIcon className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">
                  No goals added yet. Click "Add Goal" to add one.
                </p>
              )}
            </CardBody>
          </Card>

          {/* Interventions */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Interventions</CardTitle>
              <Button variant="outline" size="sm" onClick={addIntervention}>
                <PlusIcon className="h-4 w-4 mr-1" />
                Add Intervention
              </Button>
            </CardHeader>
            <CardBody>
              {interventions.length > 0 ? (
                <div className="space-y-4">
                  {interventions.map((intervention, index) => {
                    const validation = validationResults.find(
                      (v) => v.interventionIndex === index
                    );
                    return (
                      <div
                        key={intervention.id}
                        className={clsx(
                          'p-4 rounded-lg border',
                          validation?.validationTier === 'HIGH_CONFIDENCE'
                            ? 'bg-green-50 border-green-200'
                            : validation?.validationTier === 'NEEDS_REVIEW'
                            ? 'bg-yellow-50 border-yellow-200'
                            : validation?.validationTier === 'BLOCKED'
                            ? 'bg-red-50 border-red-200'
                            : 'bg-gray-50 border-gray-200'
                        )}
                      >
                        <div className="flex items-start gap-4">
                          <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center text-sm font-medium">
                            {index + 1}
                          </span>
                          <div className="flex-1 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <select
                                value={intervention.type}
                                onChange={(e) =>
                                  updateIntervention(
                                    intervention.id,
                                    'type',
                                    e.target.value
                                  )
                                }
                                className="input"
                              >
                                <option value="">Select type...</option>
                                <option value="MEDICATION">Medication</option>
                                <option value="PROCEDURE">Procedure</option>
                                <option value="MONITORING">Monitoring</option>
                                <option value="EDUCATION">Education</option>
                                <option value="REFERRAL">Referral</option>
                                <option value="LIFESTYLE">
                                  Lifestyle Modification
                                </option>
                                <option value="OTHER">Other</option>
                              </select>
                              <input
                                type="text"
                                value={intervention.frequency}
                                onChange={(e) =>
                                  updateIntervention(
                                    intervention.id,
                                    'frequency',
                                    e.target.value
                                  )
                                }
                                placeholder="Frequency (e.g., Daily)"
                                className="input"
                              />
                            </div>
                            <input
                              type="text"
                              value={intervention.description}
                              onChange={(e) =>
                                updateIntervention(
                                  intervention.id,
                                  'description',
                                  e.target.value
                                )
                              }
                              placeholder="Intervention description"
                              className="input w-full"
                            />
                            {validation && (
                              <ValidationFeedback validation={validation} />
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeIntervention(intervention.id)}
                          >
                            <TrashIcon className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">
                  No interventions added yet. Click "Add Intervention" to add one.
                </p>
              )}
            </CardBody>
          </Card>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-700">
                <XCircleIcon className="h-5 w-5" />
                <span className="font-medium">{error}</span>
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={createLoading || !patientId || !title}
            >
              {createLoading ? 'Creating...' : 'Create Care Plan'}
            </Button>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Templates */}
          <Card>
            <CardHeader>
              <CardTitle>Templates</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-gray-500 mb-3">
                Start from a template to save time
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowTemplates(!showTemplates)}
              >
                {showTemplates ? 'Hide Templates' : 'Browse Templates'}
              </Button>

              {showTemplates && (
                <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
                  {templatesLoading ? (
                    <p className="text-sm text-gray-500">Loading templates...</p>
                  ) : templates.length > 0 ? (
                    templates.map((template: any) => (
                      <button
                        key={template.id}
                        onClick={() => applyTemplate(template)}
                        className="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        <p className="font-medium text-gray-900">{template.name}</p>
                        <p className="text-xs text-gray-500">{template.category}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {template.goals?.length || 0} goals,{' '}
                          {template.interventions?.length || 0} interventions
                        </p>
                      </button>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">No templates available</p>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Tips */}
          <Card>
            <CardHeader>
              <CardTitle>Tips</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="text-sm text-gray-600 space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircleIcon className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <span>Add specific, measurable goals</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircleIcon className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <span>Interventions are validated by ML for safety</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircleIcon className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <span>Set realistic target dates</span>
                </li>
                <li className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                  <span>Blocked interventions will show alternatives</span>
                </li>
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ValidationFeedback({ validation }: { validation: any }) {
  if (validation.validationTier === 'HIGH_CONFIDENCE') {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700">
        <CheckCircleIcon className="h-4 w-4" />
        <span>
          Validated ({Math.round(validation.confidenceScore * 100)}% confidence)
        </span>
      </div>
    );
  }

  if (validation.validationTier === 'NEEDS_REVIEW') {
    return (
      <div className="text-sm text-yellow-700">
        <div className="flex items-center gap-2">
          <ExclamationTriangleIcon className="h-4 w-4" />
          <span>Needs review ({Math.round(validation.confidenceScore * 100)}%)</span>
        </div>
        {validation.deviationFactors?.length > 0 && (
          <ul className="ml-6 mt-1 list-disc text-xs">
            {validation.deviationFactors.map((factor: string, i: number) => (
              <li key={i}>{factor}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (validation.validationTier === 'BLOCKED') {
    return (
      <div className="text-sm text-red-700">
        <div className="flex items-center gap-2">
          <XCircleIcon className="h-4 w-4" />
          <span>Blocked - validation failed</span>
        </div>
        {validation.deviationFactors?.length > 0 && (
          <ul className="ml-6 mt-1 list-disc text-xs">
            {validation.deviationFactors.map((factor: string, i: number) => (
              <li key={i}>{factor}</li>
            ))}
          </ul>
        )}
        {validation.alternativeRecommendation && (
          <p className="mt-2 p-2 bg-white rounded border border-red-200">
            <span className="font-medium">Suggested alternative:</span>{' '}
            {validation.alternativeRecommendation}
          </p>
        )}
      </div>
    );
  }

  return null;
}
