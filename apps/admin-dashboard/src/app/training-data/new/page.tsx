'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import {
  useCreateTrainingCarePlan,
  InterventionType,
  GoalPriority,
  GoalStatus,
  InterventionStatus,
} from '@/lib/hooks/useTrainingCarePlans';

const goalPriorityOptions: GoalPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const goalStatusOptions: GoalStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'ACHIEVED', 'NOT_ACHIEVED', 'CANCELLED'];
const interventionTypeOptions: InterventionType[] = ['MEDICATION', 'PROCEDURE', 'LIFESTYLE', 'MONITORING', 'REFERRAL', 'EDUCATION', 'FOLLOW_UP'];
const interventionStatusOptions: InterventionStatus[] = ['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

interface GoalInput {
  description: string;
  targetValue: string;
  targetDate: string;
  priority: GoalPriority;
  status: GoalStatus;
}

interface InterventionInput {
  type: InterventionType;
  description: string;
  medicationCode: string;
  dosage: string;
  frequency: string;
  procedureCode: string;
  status: InterventionStatus;
  scheduledDate: string;
  patientInstructions: string;
}

export default function NewTrainingDataPage() {
  const router = useRouter();
  const { createCarePlan, loading } = useCreateTrainingCarePlan();

  const [title, setTitle] = useState('');
  const [conditionCodes, setConditionCodes] = useState('');
  const [trainingDescription, setTrainingDescription] = useState('');
  const [trainingTags, setTrainingTags] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [targetEndDate, setTargetEndDate] = useState('');

  const [goals, setGoals] = useState<GoalInput[]>([]);
  const [interventions, setInterventions] = useState<InterventionInput[]>([]);

  const addGoal = () => {
    setGoals([
      ...goals,
      {
        description: '',
        targetValue: '',
        targetDate: '',
        priority: 'MEDIUM',
        status: 'NOT_STARTED',
      },
    ]);
  };

  const updateGoal = (index: number, field: keyof GoalInput, value: string) => {
    const updated = [...goals];
    updated[index] = { ...updated[index], [field]: value };
    setGoals(updated);
  };

  const removeGoal = (index: number) => {
    setGoals(goals.filter((_, i) => i !== index));
  };

  const addIntervention = () => {
    setInterventions([
      ...interventions,
      {
        type: 'MEDICATION',
        description: '',
        medicationCode: '',
        dosage: '',
        frequency: '',
        procedureCode: '',
        status: 'PENDING',
        scheduledDate: '',
        patientInstructions: '',
      },
    ]);
  };

  const updateIntervention = (index: number, field: keyof InterventionInput, value: string) => {
    const updated = [...interventions];
    updated[index] = { ...updated[index], [field]: value };
    setInterventions(updated);
  };

  const removeIntervention = (index: number) => {
    setInterventions(interventions.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await createCarePlan({
        title,
        conditionCodes: conditionCodes.split(',').map((c) => c.trim()).filter(Boolean),
        trainingDescription: trainingDescription || undefined,
        trainingTags: trainingTags.split(',').map((t) => t.trim()).filter(Boolean),
        startDate,
        targetEndDate: targetEndDate || undefined,
        goals: goals.filter((g) => g.description).map((g) => ({
          description: g.description,
          targetValue: g.targetValue || undefined,
          targetDate: g.targetDate || undefined,
          priority: g.priority,
          status: g.status,
        })),
        interventions: interventions.filter((i) => i.description).map((i) => ({
          type: i.type,
          description: i.description,
          medicationCode: i.medicationCode || undefined,
          dosage: i.dosage || undefined,
          frequency: i.frequency || undefined,
          procedureCode: i.procedureCode || undefined,
          status: i.status,
          scheduledDate: i.scheduledDate || undefined,
          patientInstructions: i.patientInstructions || undefined,
        })),
      });
      router.push('/training-data');
    } catch (err) {
      console.error('Failed to create training data:', err);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/training-data">
          <Button variant="ghost" size="sm">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Training Data</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create data for ML model training and RAG context
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g., Type 2 Diabetes Management Example"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Training Description
                  </label>
                  <textarea
                    value={trainingDescription}
                    onChange={(e) => setTrainingDescription(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Describe what this example demonstrates..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Condition Codes * (comma-separated)
                  </label>
                  <input
                    type="text"
                    required
                    value={conditionCodes}
                    onChange={(e) => setConditionCodes(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g., E11.9, I10"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Training Tags (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={trainingTags}
                    onChange={(e) => setTrainingTags(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g., diabetes, chronic, complex"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Target End Date
                  </label>
                  <input
                    type="date"
                    value={targetEndDate}
                    onChange={(e) => setTargetEndDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Goals */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Goals</CardTitle>
                <Button type="button" variant="secondary" size="sm" onClick={addGoal}>
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Add Goal
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              {goals.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  No goals added. Click "Add Goal" to add one.
                </p>
              ) : (
                <div className="space-y-4">
                  {goals.map((goal, index) => (
                    <div key={index} className="border border-gray-200 rounded-md p-4">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium text-gray-700">Goal {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeGoal(index)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="md:col-span-2">
                          <input
                            type="text"
                            placeholder="Goal description *"
                            value={goal.description}
                            onChange={(e) => updateGoal(index, 'description', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <input
                            type="text"
                            placeholder="Target value"
                            value={goal.targetValue}
                            onChange={(e) => updateGoal(index, 'targetValue', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <input
                            type="date"
                            placeholder="Target date"
                            value={goal.targetDate}
                            onChange={(e) => updateGoal(index, 'targetDate', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <select
                            value={goal.priority}
                            onChange={(e) => updateGoal(index, 'priority', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            {goalPriorityOptions.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <select
                            value={goal.status}
                            onChange={(e) => updateGoal(index, 'status', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            {goalStatusOptions.map((s) => (
                              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                        </div>
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
              <div className="flex items-center justify-between">
                <CardTitle>Interventions</CardTitle>
                <Button type="button" variant="secondary" size="sm" onClick={addIntervention}>
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Add Intervention
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              {interventions.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  No interventions added. Click "Add Intervention" to add one.
                </p>
              ) : (
                <div className="space-y-4">
                  {interventions.map((intervention, index) => (
                    <div key={index} className="border border-gray-200 rounded-md p-4">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium text-gray-700">Intervention {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeIntervention(index)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <select
                            value={intervention.type}
                            onChange={(e) => updateIntervention(index, 'type', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            {interventionTypeOptions.map((t) => (
                              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <select
                            value={intervention.status}
                            onChange={(e) => updateIntervention(index, 'status', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            {interventionStatusOptions.map((s) => (
                              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-2">
                          <input
                            type="text"
                            placeholder="Description *"
                            value={intervention.description}
                            onChange={(e) => updateIntervention(index, 'description', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        {intervention.type === 'MEDICATION' && (
                          <>
                            <div>
                              <input
                                type="text"
                                placeholder="Medication code (RxNorm)"
                                value={intervention.medicationCode}
                                onChange={(e) => updateIntervention(index, 'medicationCode', e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              />
                            </div>
                            <div>
                              <input
                                type="text"
                                placeholder="Dosage"
                                value={intervention.dosage}
                                onChange={(e) => updateIntervention(index, 'dosage', e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              />
                            </div>
                            <div>
                              <input
                                type="text"
                                placeholder="Frequency"
                                value={intervention.frequency}
                                onChange={(e) => updateIntervention(index, 'frequency', e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              />
                            </div>
                          </>
                        )}
                        {intervention.type === 'PROCEDURE' && (
                          <div>
                            <input
                              type="text"
                              placeholder="Procedure code (CPT)"
                              value={intervention.procedureCode}
                              onChange={(e) => updateIntervention(index, 'procedureCode', e.target.value)}
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                          </div>
                        )}
                        <div>
                          <input
                            type="date"
                            placeholder="Scheduled date"
                            value={intervention.scheduledDate}
                            onChange={(e) => updateIntervention(index, 'scheduledDate', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <textarea
                            placeholder="Patient instructions"
                            value={intervention.patientInstructions}
                            onChange={(e) => updateIntervention(index, 'patientInstructions', e.target.value)}
                            rows={2}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <Link href="/training-data">
              <Button variant="secondary" type="button">Cancel</Button>
            </Link>
            <Button type="submit" disabled={loading}>
              {loading ? <Spinner className="h-4 w-4" /> : 'Create Training Data'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
