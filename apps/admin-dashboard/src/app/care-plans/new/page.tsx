'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import {
  useCreateCarePlanTemplate,
  TemplateCategory,
  GoalPriority,
  InterventionType,
} from '@/lib/hooks/useCarePlanTemplates';

const categoryOptions: TemplateCategory[] = [
  'CHRONIC_DISEASE',
  'PREVENTIVE_CARE',
  'POST_PROCEDURE',
  'MEDICATION_MANAGEMENT',
  'LIFESTYLE_MODIFICATION',
];

const categoryLabels: Record<TemplateCategory, string> = {
  CHRONIC_DISEASE: 'Chronic Disease',
  PREVENTIVE_CARE: 'Preventive Care',
  POST_PROCEDURE: 'Post Procedure',
  MEDICATION_MANAGEMENT: 'Medication Management',
  LIFESTYLE_MODIFICATION: 'Lifestyle Modification',
};

const goalPriorityOptions: GoalPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const interventionTypeOptions: InterventionType[] = ['MEDICATION', 'PROCEDURE', 'LIFESTYLE', 'MONITORING', 'REFERRAL', 'EDUCATION', 'FOLLOW_UP'];

interface GoalInput {
  description: string;
  defaultTargetValue: string;
  defaultTargetDays: string;
  priority: GoalPriority;
}

interface InterventionInput {
  type: InterventionType;
  description: string;
  medicationCode: string;
  procedureCode: string;
  defaultScheduleDays: string;
}

export default function NewCarePlanPage() {
  const router = useRouter();
  const { createTemplate, loading } = useCreateCarePlanTemplate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('CHRONIC_DISEASE');
  const [conditionCodes, setConditionCodes] = useState('');
  const [guidelineSource, setGuidelineSource] = useState('');
  const [evidenceGrade, setEvidenceGrade] = useState('');

  const [goals, setGoals] = useState<GoalInput[]>([]);
  const [interventions, setInterventions] = useState<InterventionInput[]>([]);

  const addGoal = () => {
    setGoals([
      ...goals,
      {
        description: '',
        defaultTargetValue: '',
        defaultTargetDays: '',
        priority: 'MEDIUM',
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
        procedureCode: '',
        defaultScheduleDays: '',
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
      await createTemplate({
        name,
        description: description || undefined,
        category,
        conditionCodes: conditionCodes.split(',').map((c) => c.trim()).filter(Boolean),
        guidelineSource: guidelineSource || undefined,
        evidenceGrade: evidenceGrade || undefined,
        goals: goals.filter((g) => g.description).map((g) => ({
          description: g.description,
          defaultTargetValue: g.defaultTargetValue || undefined,
          defaultTargetDays: g.defaultTargetDays ? parseInt(g.defaultTargetDays) : undefined,
          priority: g.priority,
        })),
        interventions: interventions.filter((i) => i.description).map((i) => ({
          type: i.type,
          description: i.description,
          medicationCode: i.medicationCode || undefined,
          procedureCode: i.procedureCode || undefined,
          defaultScheduleDays: i.defaultScheduleDays ? parseInt(i.defaultScheduleDays) : undefined,
        })),
      });
      router.push('/care-plans');
    } catch (err) {
      console.error('Failed to create care plan:', err);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/care-plans">
          <Button variant="ghost" size="sm">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Care Plan</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create a reusable care plan with predefined goals and interventions
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
                    Care Plan Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g., Type 2 Diabetes Management"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Describe the template purpose and use cases..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as TemplateCategory)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>{categoryLabels[c]}</option>
                    ))}
                  </select>
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
                    Guideline Source
                  </label>
                  <input
                    type="text"
                    value={guidelineSource}
                    onChange={(e) => setGuidelineSource(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g., ADA 2024 Guidelines"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Evidence Grade
                  </label>
                  <input
                    type="text"
                    value={evidenceGrade}
                    onChange={(e) => setEvidenceGrade(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g., A, B, C"
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Goals */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Default Goals</CardTitle>
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
                            placeholder="Default target value"
                            value={goal.defaultTargetValue}
                            onChange={(e) => updateGoal(index, 'defaultTargetValue', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <input
                            type="number"
                            placeholder="Default target days"
                            value={goal.defaultTargetDays}
                            onChange={(e) => updateGoal(index, 'defaultTargetDays', e.target.value)}
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
                <CardTitle>Default Interventions</CardTitle>
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
                          <input
                            type="number"
                            placeholder="Default schedule days"
                            value={intervention.defaultScheduleDays}
                            onChange={(e) => updateIntervention(index, 'defaultScheduleDays', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
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
                          <div>
                            <input
                              type="text"
                              placeholder="Medication code (RxNorm)"
                              value={intervention.medicationCode}
                              onChange={(e) => updateIntervention(index, 'medicationCode', e.target.value)}
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                          </div>
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <Link href="/care-plans">
              <Button variant="secondary" type="button">Cancel</Button>
            </Link>
            <Button type="submit" disabled={loading}>
              {loading ? <Spinner className="h-4 w-4" /> : 'Create Care Plan'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
