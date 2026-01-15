'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import {
  useSafetyRule,
  useUpdateSafetyRule,
  SafetyRuleSeverity,
} from '@/lib/hooks/useSafetyRules';

const severityOptions: SafetyRuleSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const severityLabels: Record<SafetyRuleSeverity, { label: string; description: string }> = {
  CRITICAL: { label: 'Critical', description: 'Blocks action until resolved' },
  HIGH: { label: 'High', description: 'Requires acknowledgment' },
  MEDIUM: { label: 'Medium', description: 'Shows prominent warning' },
  LOW: { label: 'Low', description: 'Shows informational notice' },
  INFO: { label: 'Info', description: 'Logs for reference only' },
};

export default function EditClinicalAlertPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { rule, loading: loadingRule } = useSafetyRule(id);
  const { updateSafetyRule, loading: updating } = useUpdateSafetyRule();

  const [name, setName] = useState('');
  const [severity, setSeverity] = useState<SafetyRuleSeverity>('MEDIUM');
  const [description, setDescription] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [triggerConditions, setTriggerConditions] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setSeverity(rule.severity);
      setDescription(rule.description);
      setAlertMessage(rule.alertMessage);
      setTriggerConditions(rule.triggerConditions || '');
      setIsActive(rule.isActive);
    }
  }, [rule]);

  const handleSave = async () => {
    try {
      await updateSafetyRule(id, {
        name,
        severity,
        description,
        alertMessage,
        triggerConditions: triggerConditions || undefined,
        isActive,
      });
      router.push(`/safety-rules/${id}`);
    } catch (err) {
      console.error('Failed to update alert:', err);
    }
  };

  if (loadingRule) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Clinical alert not found.</p>
        <Link href="/safety-rules">
          <Button variant="secondary" className="mt-4">Back to Alerts</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/safety-rules/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Clinical Alert</h1>
          <p className="mt-1 text-sm text-gray-500">{rule.name}</p>
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <input
                  type="text"
                  value={rule.ruleType.replace(/_/g, ' ')}
                  disabled
                  className="w-full border border-gray-200 rounded-md px-3 py-2 bg-gray-50 text-gray-500"
                />
                <p className="text-xs text-gray-500 mt-1">Category cannot be changed after creation</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Severity <span className="text-red-500">*</span>
                </label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as SafetyRuleSeverity)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  {severityOptions.map((s) => (
                    <option key={s} value={s}>
                      {severityLabels[s].label} - {severityLabels[s].description}
                    </option>
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
                  Version
                </label>
                <input
                  type="text"
                  value={rule.version}
                  disabled
                  className="w-full border border-gray-200 rounded-md px-3 py-2 bg-gray-50 text-gray-500"
                />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Description */}
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardBody>
            <div>
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
              <p className="text-xs text-gray-500 mt-1">
                Explain the clinical rationale for this alert
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Alert Message */}
        <Card>
          <CardHeader>
            <CardTitle>Alert Message</CardTitle>
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

        {/* Trigger Conditions */}
        <Card>
          <CardHeader>
            <CardTitle>Trigger Conditions</CardTitle>
          </CardHeader>
          <CardBody>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Conditions (JSON or structured format)
              </label>
              <textarea
                value={triggerConditions}
                onChange={(e) => setTriggerConditions(e.target.value)}
                rows={6}
                className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder='{"medications": ["warfarin", "aspirin"], "action": "concurrent_prescription"}'
              />
              <p className="text-xs text-gray-500 mt-1">
                Define the conditions that trigger this alert (optional - used for automated rule matching)
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Link href={`/safety-rules/${id}`}>
            <Button variant="secondary">Cancel</Button>
          </Link>
          <Button onClick={handleSave} disabled={updating || !name || !description || !alertMessage}>
            {updating ? <Spinner className="h-4 w-4" /> : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
