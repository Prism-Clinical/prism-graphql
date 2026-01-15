'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  ShieldExclamationIcon,
  HeartIcon,
  BeakerIcon,
  UserIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import {
  useCreateSafetyRule,
  SafetyRuleType,
  SafetyRuleSeverity,
} from '@/lib/hooks/useSafetyRules';

const ruleTypeOptions: SafetyRuleType[] = [
  'DRUG_INTERACTION',
  'ALLERGY_ALERT',
  'CONTRAINDICATION',
  'DOSAGE_CHECK',
  'AGE_RESTRICTION',
  'LAB_VALUE_CHECK',
];

const ruleTypeConfig: Record<SafetyRuleType, {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
}> = {
  DRUG_INTERACTION: {
    label: 'Medication Conflicts',
    description: 'Warns about dangerous drug interactions',
    icon: ExclamationTriangleIcon,
    color: 'text-red-600',
    bgColor: 'bg-red-50 border-red-200',
  },
  ALLERGY_ALERT: {
    label: 'Allergy Warnings',
    description: 'Alerts for known patient allergies',
    icon: ShieldExclamationIcon,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 border-orange-200',
  },
  CONTRAINDICATION: {
    label: 'Medical Contraindications',
    description: 'Flags harmful treatments for conditions',
    icon: HeartIcon,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 border-purple-200',
  },
  DOSAGE_CHECK: {
    label: 'Dosage Validation',
    description: 'Verifies safe medication doses',
    icon: BeakerIcon,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 border-blue-200',
  },
  AGE_RESTRICTION: {
    label: 'Age Appropriateness',
    description: 'Ensures age-appropriate treatments',
    icon: UserIcon,
    color: 'text-green-600',
    bgColor: 'bg-green-50 border-green-200',
  },
  LAB_VALUE_CHECK: {
    label: 'Lab Value Monitoring',
    description: 'Validates lab results before treatment',
    icon: ClockIcon,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50 border-teal-200',
  },
};

const severityOptions: SafetyRuleSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const severityLabels: Record<SafetyRuleSeverity, { label: string; description: string; color: string }> = {
  CRITICAL: { label: 'Critical', description: 'Blocks action until resolved', color: 'bg-red-100 text-red-800' },
  HIGH: { label: 'High', description: 'Requires acknowledgment', color: 'bg-orange-100 text-orange-800' },
  MEDIUM: { label: 'Medium', description: 'Shows prominent warning', color: 'bg-yellow-100 text-yellow-800' },
  LOW: { label: 'Low', description: 'Shows informational notice', color: 'bg-blue-100 text-blue-800' },
  INFO: { label: 'Info', description: 'Logs for reference only', color: 'bg-gray-100 text-gray-800' },
};

export default function NewClinicalAlertPage() {
  const router = useRouter();
  const { createSafetyRule, loading: creating } = useCreateSafetyRule();

  const [ruleType, setRuleType] = useState<SafetyRuleType>('DRUG_INTERACTION');
  const [name, setName] = useState('');
  const [severity, setSeverity] = useState<SafetyRuleSeverity>('MEDIUM');
  const [description, setDescription] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [triggerConditions, setTriggerConditions] = useState('');

  const handleCreate = async () => {
    try {
      await createSafetyRule({
        name,
        ruleType,
        severity,
        description,
        alertMessage,
        triggerConditions: triggerConditions || '{}',
      });
      router.push('/safety-rules');
    } catch (err) {
      console.error('Failed to create alert:', err);
    }
  };

  const isValid = name && description && alertMessage;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/safety-rules">
          <Button variant="ghost" size="sm">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create Clinical Alert</h1>
          <p className="mt-1 text-sm text-gray-500">
            Define a new safety check to protect patients
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Category Selection */}
        <Card>
          <CardHeader>
            <CardTitle>1. Select Alert Category</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {ruleTypeOptions.map((type) => {
                const config = ruleTypeConfig[type];
                const Icon = config.icon;
                const isSelected = ruleType === type;

                return (
                  <button
                    key={type}
                    onClick={() => setRuleType(type)}
                    className={`text-left p-4 rounded-lg border-2 transition-all ${
                      isSelected
                        ? `${config.bgColor} border-current`
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`h-5 w-5 ${config.color}`} />
                      <div>
                        <p className="font-medium text-gray-900">{config.label}</p>
                        <p className="text-xs text-gray-500">{config.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>2. Alert Details</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Alert Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="e.g., Warfarin-Aspirin Interaction Warning"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Severity <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {severityOptions.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSeverity(s)}
                      className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                        severity === s
                          ? `${severityLabels[s].color} border-current`
                          : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {severityLabels[s].label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {severityLabels[severity].description}
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Describe when and why this alert is triggered..."
                />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Alert Message */}
        <Card>
          <CardHeader>
            <CardTitle>3. Alert Message</CardTitle>
          </CardHeader>
          <CardBody>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Message shown to providers <span className="text-red-500">*</span>
              </label>
              <textarea
                value={alertMessage}
                onChange={(e) => setAlertMessage(e.target.value)}
                rows={4}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="The message providers will see when this alert is triggered..."
              />
              <p className="text-xs text-gray-500 mt-1">
                Be clear, actionable, and include any recommended alternatives
              </p>
            </div>

            {/* Preview */}
            {alertMessage && (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Preview:</p>
                <div className={`p-4 rounded-lg border-l-4 ${
                  severity === 'CRITICAL' ? 'bg-red-50 border-red-500' :
                  severity === 'HIGH' ? 'bg-orange-50 border-orange-500' :
                  severity === 'MEDIUM' ? 'bg-yellow-50 border-yellow-500' :
                  'bg-blue-50 border-blue-500'
                }`}>
                  <p className="text-gray-900">{alertMessage}</p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Trigger Conditions (Optional) */}
        <Card>
          <CardHeader>
            <CardTitle>4. Trigger Conditions (Optional)</CardTitle>
          </CardHeader>
          <CardBody>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Conditions (JSON format)
              </label>
              <textarea
                value={triggerConditions}
                onChange={(e) => setTriggerConditions(e.target.value)}
                rows={6}
                className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder='{"medications": ["warfarin", "aspirin"], "action": "concurrent_prescription"}'
              />
              <p className="text-xs text-gray-500 mt-1">
                Define the conditions that trigger this alert (used for automated rule matching)
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Link href="/safety-rules">
            <Button variant="secondary">Cancel</Button>
          </Link>
          <Button onClick={handleCreate} disabled={creating || !isValid}>
            {creating ? <Spinner className="h-4 w-4" /> : 'Create Alert'}
          </Button>
        </div>
      </div>
    </div>
  );
}
