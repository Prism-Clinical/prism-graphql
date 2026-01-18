'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import {
  useTrainingCarePlan,
  useUpdateTrainingCarePlan,
  useAddTrainingGoal,
  useRemoveTrainingGoal,
  useAddTrainingIntervention,
  useRemoveTrainingIntervention,
  CarePlanStatus,
  InterventionType,
  GoalPriority,
  GoalStatus,
  InterventionStatus,
} from '@/lib/hooks/useTrainingCarePlans';

const statusOptions: CarePlanStatus[] = ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
const goalPriorityOptions: GoalPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const goalStatusOptions: GoalStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'ACHIEVED', 'NOT_ACHIEVED', 'CANCELLED'];
const interventionTypeOptions: InterventionType[] = ['MEDICATION', 'PROCEDURE', 'LIFESTYLE', 'MONITORING', 'REFERRAL', 'EDUCATION', 'FOLLOW_UP'];
const interventionStatusOptions: InterventionStatus[] = ['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

interface NewGoalInput {
  description: string;
  targetValue: string;
  targetDate: string;
  priority: GoalPriority;
  status: GoalStatus;
}

interface NewInterventionInput {
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

export default function EditTrainingExamplePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { carePlan, loading: loadingCarePlan, refetch } = useTrainingCarePlan(id);
  const { updateCarePlan, loading: updating } = useUpdateTrainingCarePlan();
  const { addGoal, loading: addingGoal } = useAddTrainingGoal();
  const { removeGoal, loading: removingGoal } = useRemoveTrainingGoal();
  const { addIntervention, loading: addingIntervention } = useAddTrainingIntervention();
  const { removeIntervention, loading: removingIntervention } = useRemoveTrainingIntervention();

  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<CarePlanStatus>('DRAFT');
  const [conditionCodes, setConditionCodes] = useState('');
  const [trainingDescription, setTrainingDescription] = useState('');
  const [trainingTags, setTrainingTags] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');

  const [newGoal, setNewGoal] = useState<NewGoalInput | null>(null);
  const [newIntervention, setNewIntervention] = useState<NewInterventionInput | null>(null);

  useEffect(() => {
    if (carePlan) {
      setTitle(carePlan.title);
      setStatus(carePlan.status);
      setConditionCodes(carePlan.conditionCodes?.join(', ') || '');
      setTrainingDescription(carePlan.trainingDescription || '');
      setTrainingTags(carePlan.trainingTags?.join(', ') || '');
      setTargetEndDate(carePlan.targetEndDate?.split('T')[0] || '');
    }
  }, [carePlan]);

  const handleSave = async () => {
    try {
      await updateCarePlan(id, {
        title,
        status,
        conditionCodes: conditionCodes.split(',').map((c) => c.trim()).filter(Boolean),
        trainingDescription: trainingDescription || undefined,
        trainingTags: trainingTags.split(',').map((t) => t.trim()).filter(Boolean),
        targetEndDate: targetEndDate || undefined,
      });
      router.push(`/training-examples/${id}`);
    } catch (err) {
      console.error('Failed to update training example:', err);
    }
  };

  const handleAddGoal = async () => {
    if (!newGoal || !newGoal.description) return;
    try {
      await addGoal(id, {
        description: newGoal.description,
        targetValue: newGoal.targetValue || undefined,
        targetDate: newGoal.targetDate || undefined,
        priority: newGoal.priority,
        status: newGoal.status,
      });
      setNewGoal(null);
      refetch();
    } catch (err) {
      console.error('Failed to add goal:', err);
    }
  };

  const handleRemoveGoal = async (goalId: string) => {
    if (!confirm('Remove this goal?')) return;
    try {
      await removeGoal(goalId);
      refetch();
    } catch (err) {
      console.error('Failed to remove goal:', err);
    }
  };

  const handleAddIntervention = async () => {
    if (!newIntervention || !newIntervention.description) return;
    try {
      await addIntervention(id, {
        type: newIntervention.type,
        description: newIntervention.description,
        medicationCode: newIntervention.medicationCode || undefined,
        dosage: newIntervention.dosage || undefined,
        frequency: newIntervention.frequency || undefined,
        procedureCode: newIntervention.procedureCode || undefined,
        status: newIntervention.status,
        scheduledDate: newIntervention.scheduledDate || undefined,
        patientInstructions: newIntervention.patientInstructions || undefined,
      });
      setNewIntervention(null);
      refetch();
    } catch (err) {
      console.error('Failed to add intervention:', err);
    }
  };

  const handleRemoveIntervention = async (interventionId: string) => {
    if (!confirm('Remove this intervention?')) return;
    try {
      await removeIntervention(interventionId);
      refetch();
    } catch (err) {
      console.error('Failed to remove intervention:', err);
    }
  };

  if (loadingCarePlan) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!carePlan) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Training example not found.</p>
        <Link href="/training-examples">
          <Button variant="secondary" className="mt-4">Back to List</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/training-examples/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Training Example</h1>
          <p className="mt-1 text-sm text-gray-500">{carePlan.title}</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as CarePlanStatus)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target End Date</label>
                <input
                  type="date"
                  value={targetEndDate}
                  onChange={(e) => setTargetEndDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Training Description</label>
                <textarea
                  value={trainingDescription}
                  onChange={(e) => setTrainingDescription(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Condition Codes</label>
                <input
                  type="text"
                  value={conditionCodes}
                  onChange={(e) => setConditionCodes(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Comma-separated"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Training Tags</label>
                <input
                  type="text"
                  value={trainingTags}
                  onChange={(e) => setTrainingTags(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Comma-separated"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSave} disabled={updating}>
                {updating ? <Spinner className="h-4 w-4" /> : 'Save Changes'}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Goals */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Goals ({carePlan.goals?.length || 0})</CardTitle>
              {!newGoal && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setNewGoal({
                    description: '',
                    targetValue: '',
                    targetDate: '',
                    priority: 'MEDIUM',
                    status: 'NOT_STARTED',
                  })}
                >
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Add Goal
                </Button>
              )}
            </div>
          </CardHeader>
          <CardBody>
            {newGoal && (
              <div className="border border-indigo-200 bg-indigo-50 rounded-md p-4 mb-4">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-sm font-medium text-indigo-700">New Goal</span>
                  <button onClick={() => setNewGoal(null)} className="text-gray-400 hover:text-gray-600">
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <input
                      type="text"
                      placeholder="Goal description *"
                      value={newGoal.description}
                      onChange={(e) => setNewGoal({ ...newGoal, description: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Target value"
                    value={newGoal.targetValue}
                    onChange={(e) => setNewGoal({ ...newGoal, targetValue: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                  <input
                    type="date"
                    value={newGoal.targetDate}
                    onChange={(e) => setNewGoal({ ...newGoal, targetDate: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                  <select
                    value={newGoal.priority}
                    onChange={(e) => setNewGoal({ ...newGoal, priority: e.target.value as GoalPriority })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    {goalPriorityOptions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <select
                    value={newGoal.status}
                    onChange={(e) => setNewGoal({ ...newGoal, status: e.target.value as GoalStatus })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    {goalStatusOptions.map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button size="sm" onClick={handleAddGoal} disabled={addingGoal || !newGoal.description}>
                    {addingGoal ? <Spinner className="h-4 w-4" /> : 'Add Goal'}
                  </Button>
                </div>
              </div>
            )}
            {!carePlan.goals?.length && !newGoal ? (
              <p className="text-sm text-gray-500 text-center py-4">No goals. Click "Add Goal" to add one.</p>
            ) : (
              <div className="space-y-3">
                {carePlan.goals?.map((goal) => (
                  <div key={goal.id} className="border border-gray-200 rounded-md p-3 flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{goal.description}</p>
                      <div className="mt-1 flex gap-2 text-xs">
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded">{goal.priority}</span>
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded">{goal.status.replace(/_/g, ' ')}</span>
                        {goal.targetValue && <span className="text-gray-500">Target: {goal.targetValue}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveGoal(goal.id)}
                      disabled={removingGoal}
                      className="text-red-600 hover:text-red-700"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
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
              <CardTitle>Interventions ({carePlan.interventions?.length || 0})</CardTitle>
              {!newIntervention && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setNewIntervention({
                    type: 'MEDICATION',
                    description: '',
                    medicationCode: '',
                    dosage: '',
                    frequency: '',
                    procedureCode: '',
                    status: 'PENDING',
                    scheduledDate: '',
                    patientInstructions: '',
                  })}
                >
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Add Intervention
                </Button>
              )}
            </div>
          </CardHeader>
          <CardBody>
            {newIntervention && (
              <div className="border border-indigo-200 bg-indigo-50 rounded-md p-4 mb-4">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-sm font-medium text-indigo-700">New Intervention</span>
                  <button onClick={() => setNewIntervention(null)} className="text-gray-400 hover:text-gray-600">
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    value={newIntervention.type}
                    onChange={(e) => setNewIntervention({ ...newIntervention, type: e.target.value as InterventionType })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    {interventionTypeOptions.map((t) => (
                      <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                  <select
                    value={newIntervention.status}
                    onChange={(e) => setNewIntervention({ ...newIntervention, status: e.target.value as InterventionStatus })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    {interventionStatusOptions.map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                  <div className="md:col-span-2">
                    <input
                      type="text"
                      placeholder="Description *"
                      value={newIntervention.description}
                      onChange={(e) => setNewIntervention({ ...newIntervention, description: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  {newIntervention.type === 'MEDICATION' && (
                    <>
                      <input
                        type="text"
                        placeholder="Medication code"
                        value={newIntervention.medicationCode}
                        onChange={(e) => setNewIntervention({ ...newIntervention, medicationCode: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Dosage"
                        value={newIntervention.dosage}
                        onChange={(e) => setNewIntervention({ ...newIntervention, dosage: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Frequency"
                        value={newIntervention.frequency}
                        onChange={(e) => setNewIntervention({ ...newIntervention, frequency: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      />
                    </>
                  )}
                  {newIntervention.type === 'PROCEDURE' && (
                    <input
                      type="text"
                      placeholder="Procedure code"
                      value={newIntervention.procedureCode}
                      onChange={(e) => setNewIntervention({ ...newIntervention, procedureCode: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  )}
                  <input
                    type="date"
                    value={newIntervention.scheduledDate}
                    onChange={(e) => setNewIntervention({ ...newIntervention, scheduledDate: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                  <div className="md:col-span-2">
                    <textarea
                      placeholder="Patient instructions"
                      value={newIntervention.patientInstructions}
                      onChange={(e) => setNewIntervention({ ...newIntervention, patientInstructions: e.target.value })}
                      rows={2}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button size="sm" onClick={handleAddIntervention} disabled={addingIntervention || !newIntervention.description}>
                    {addingIntervention ? <Spinner className="h-4 w-4" /> : 'Add Intervention'}
                  </Button>
                </div>
              </div>
            )}
            {!carePlan.interventions?.length && !newIntervention ? (
              <p className="text-sm text-gray-500 text-center py-4">No interventions. Click "Add Intervention" to add one.</p>
            ) : (
              <div className="space-y-3">
                {carePlan.interventions?.map((intervention) => (
                  <div key={intervention.id} className="border border-gray-200 rounded-md p-3 flex items-start justify-between">
                    <div>
                      <div className="flex gap-2 text-xs mb-1">
                        <span className="px-1.5 py-0.5 bg-gray-200 rounded font-medium">{intervention.type}</span>
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded">{intervention.status}</span>
                      </div>
                      <p className="font-medium text-gray-900">{intervention.description}</p>
                      {intervention.medicationCode && (
                        <p className="text-xs text-gray-500 mt-1">
                          {intervention.medicationCode} - {intervention.dosage} {intervention.frequency}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveIntervention(intervention.id)}
                      disabled={removingIntervention}
                      className="text-red-600 hover:text-red-700"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="flex justify-end gap-4">
          <Link href={`/training-examples/${id}`}>
            <Button variant="secondary">Done</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
