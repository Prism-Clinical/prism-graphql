'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import {
  useCarePlanTemplate,
  useUpdateCarePlanTemplate,
  TemplateCategory,
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

export default function EditTemplatePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { template, loading: loadingTemplate } = useCarePlanTemplate(id);
  const { updateTemplate, loading: updating } = useUpdateCarePlanTemplate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('CHRONIC_DISEASE');
  const [conditionCodes, setConditionCodes] = useState('');
  const [guidelineSource, setGuidelineSource] = useState('');
  const [evidenceGrade, setEvidenceGrade] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description || '');
      setCategory(template.category);
      setConditionCodes(template.conditionCodes?.join(', ') || '');
      setGuidelineSource(template.guidelineSource || '');
      setEvidenceGrade(template.evidenceGrade || '');
      setIsActive(template.isActive);
    }
  }, [template]);

  const handleSave = async () => {
    try {
      await updateTemplate(id, {
        name,
        description: description || undefined,
        category,
        conditionCodes: conditionCodes.split(',').map((c) => c.trim()).filter(Boolean),
        guidelineSource: guidelineSource || undefined,
        evidenceGrade: evidenceGrade || undefined,
        isActive,
      });
      router.push(`/templates/${id}`);
    } catch (err) {
      console.error('Failed to update template:', err);
    }
  };

  if (loadingTemplate) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Template not found.</p>
        <Link href="/templates">
          <Button variant="secondary" className="mt-4">Back to List</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/templates/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Template</h1>
          <p className="mt-1 text-sm text-gray-500">{template.name}</p>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
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
                  Status
                </label>
                <select
                  value={isActive.toString()}
                  onChange={(e) => setIsActive(e.target.value === 'true')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Condition Codes
                </label>
                <input
                  type="text"
                  value={conditionCodes}
                  onChange={(e) => setConditionCodes(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Comma-separated"
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
                />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Goals and Interventions - Read Only */}
        <Card>
          <CardHeader>
            <CardTitle>Default Goals ({template.defaultGoals?.length || 0})</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-gray-500 mb-4">
              Goals are defined when creating the template. To modify goals, create a new template version.
            </p>
            {template.defaultGoals?.map((goal, index) => (
              <div key={index} className="border border-gray-200 rounded-md p-3 mb-2">
                <p className="font-medium text-gray-900">{goal.description}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Priority: {goal.priority}
                  {goal.defaultTargetValue && ` | Target: ${goal.defaultTargetValue}`}
                  {goal.defaultTargetDays && ` | Days: ${goal.defaultTargetDays}`}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Default Interventions ({template.defaultInterventions?.length || 0})</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-gray-500 mb-4">
              Interventions are defined when creating the template. To modify interventions, create a new template version.
            </p>
            {template.defaultInterventions?.map((intervention, index) => (
              <div key={index} className="border border-gray-200 rounded-md p-3 mb-2">
                <div className="flex gap-2 text-xs mb-1">
                  <span className="px-1.5 py-0.5 bg-gray-200 rounded font-medium">{intervention.type}</span>
                </div>
                <p className="font-medium text-gray-900">{intervention.description}</p>
                {(intervention.medicationCode || intervention.procedureCode) && (
                  <p className="text-xs text-gray-500 mt-1">
                    {intervention.medicationCode && `Medication: ${intervention.medicationCode}`}
                    {intervention.procedureCode && `Procedure: ${intervention.procedureCode}`}
                    {intervention.defaultScheduleDays && ` | Schedule: ${intervention.defaultScheduleDays} days`}
                  </p>
                )}
              </div>
            ))}
          </CardBody>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Link href={`/templates/${id}`}>
            <Button variant="secondary">Cancel</Button>
          </Link>
          <Button onClick={handleSave} disabled={updating}>
            {updating ? <Spinner className="h-4 w-4" /> : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
