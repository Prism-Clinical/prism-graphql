'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
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
  useSafetyRule,
  useDeleteSafetyRule,
  useActivateSafetyRule,
  useDeactivateSafetyRule,
  SafetyRuleType,
  SafetyRuleSeverity,
} from '@/lib/hooks/useSafetyRules';

const alertTypeConfig: Record<SafetyRuleType, {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
}> = {
  DRUG_INTERACTION: {
    label: 'Medication Conflicts',
    description: 'Warns when two or more medications may have dangerous interactions',
    icon: ExclamationTriangleIcon,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
  },
  ALLERGY_ALERT: {
    label: 'Allergy Warnings',
    description: 'Alerts when a prescribed medication matches a known patient allergy',
    icon: ShieldExclamationIcon,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
  },
  CONTRAINDICATION: {
    label: 'Medical Contraindications',
    description: 'Flags treatments that may be harmful given patient conditions',
    icon: HeartIcon,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  DOSAGE_CHECK: {
    label: 'Dosage Validation',
    description: 'Verifies medication doses are within safe therapeutic ranges',
    icon: BeakerIcon,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  AGE_RESTRICTION: {
    label: 'Age Appropriateness',
    description: 'Ensures treatments are appropriate for patient age group',
    icon: UserIcon,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
  },
  LAB_VALUE_CHECK: {
    label: 'Lab Value Monitoring',
    description: 'Validates that lab results are within safe ranges before treatment',
    icon: ClockIcon,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
  },
};

const severityConfig: Record<SafetyRuleSeverity, {
  label: string;
  description: string;
  color: string;
  bgColor: string;
}> = {
  CRITICAL: {
    label: 'Critical',
    description: 'Blocks action until resolved',
    color: 'text-red-800',
    bgColor: 'bg-red-100',
  },
  HIGH: {
    label: 'High',
    description: 'Requires acknowledgment',
    color: 'text-orange-800',
    bgColor: 'bg-orange-100',
  },
  MEDIUM: {
    label: 'Medium',
    description: 'Shows prominent warning',
    color: 'text-yellow-800',
    bgColor: 'bg-yellow-100',
  },
  LOW: {
    label: 'Low',
    description: 'Shows informational notice',
    color: 'text-blue-800',
    bgColor: 'bg-blue-100',
  },
  INFO: {
    label: 'Info',
    description: 'Logs for reference only',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  },
};

export default function ViewClinicalAlertPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { rule, loading, error, refetch } = useSafetyRule(id);
  const { deleteSafetyRule, loading: deleting } = useDeleteSafetyRule();
  const { activateSafetyRule } = useActivateSafetyRule();
  const { deactivateSafetyRule } = useDeactivateSafetyRule();

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this clinical alert? This action cannot be undone.')) {
      return;
    }
    try {
      await deleteSafetyRule(id);
      router.push('/safety-rules');
    } catch (err) {
      console.error('Failed to delete alert:', err);
    }
  };

  const handleToggleActive = async () => {
    if (!rule) return;
    try {
      if (rule.isActive) {
        await deactivateSafetyRule(id);
      } else {
        await activateSafetyRule(id);
      }
      refetch();
    } catch (err) {
      console.error('Failed to toggle alert status:', err);
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (error || !rule) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load clinical alert.</p>
        <Link href="/safety-rules">
          <Button variant="secondary" className="mt-4">Back to Alerts</Button>
        </Link>
      </div>
    );
  }

  const typeConfig = alertTypeConfig[rule.ruleType];
  const severity = severityConfig[rule.severity];
  const Icon = typeConfig?.icon || ShieldExclamationIcon;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/safety-rules">
            <Button variant="ghost" size="sm">
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-lg ${typeConfig?.bgColor || 'bg-gray-50'}`}>
              <Icon className={`h-6 w-6 ${typeConfig?.color || 'text-gray-600'}`} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{rule.name}</h1>
              <p className="mt-1 text-sm text-gray-500">{typeConfig?.label || rule.ruleType}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleToggleActive}>
            {rule.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Link href={`/safety-rules/${id}/edit`}>
            <Button>
              <PencilIcon className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </Link>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            <TrashIcon className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Alert Message */}
          <Card>
            <CardHeader>
              <CardTitle>Alert Message</CardTitle>
            </CardHeader>
            <CardBody>
              <div className={`p-4 rounded-lg border-l-4 ${
                rule.severity === 'CRITICAL' ? 'bg-red-50 border-red-500' :
                rule.severity === 'HIGH' ? 'bg-orange-50 border-orange-500' :
                rule.severity === 'MEDIUM' ? 'bg-yellow-50 border-yellow-500' :
                'bg-blue-50 border-blue-500'
              }`}>
                <p className="text-gray-900">{rule.alertMessage}</p>
              </div>
            </CardBody>
          </Card>

          {/* Description */}
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-gray-700">{rule.description}</p>
            </CardBody>
          </Card>

          {/* Trigger Conditions */}
          {rule.triggerConditions && (
            <Card>
              <CardHeader>
                <CardTitle>Trigger Conditions</CardTitle>
              </CardHeader>
              <CardBody>
                <pre className="bg-gray-50 p-4 rounded-lg text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                  {rule.triggerConditions}
                </pre>
              </CardBody>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status */}
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Active</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }`}>
                  {rule.isActive ? 'Yes' : 'No'}
                </span>
              </div>
            </CardBody>
          </Card>

          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="space-y-4">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Category</dt>
                  <dd className="mt-1 flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${typeConfig?.color || 'text-gray-600'}`} />
                    <span className="text-gray-900">{typeConfig?.label || rule.ruleType}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Severity</dt>
                  <dd className="mt-1">
                    <span className={`px-2 py-1 text-xs rounded ${severity?.bgColor} ${severity?.color}`}>
                      {severity?.label || rule.severity}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">{severity?.description}</p>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Version</dt>
                  <dd className="mt-1 text-gray-900">{rule.version}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Created</dt>
                  <dd className="mt-1 text-gray-900 text-sm">{formatDate(rule.createdAt)}</dd>
                </div>
                {rule.updatedAt && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Last Updated</dt>
                    <dd className="mt-1 text-gray-900 text-sm">{formatDate(rule.updatedAt)}</dd>
                  </div>
                )}
                {rule.createdBy && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Created By</dt>
                    <dd className="mt-1 text-gray-900">{rule.createdBy}</dd>
                  </div>
                )}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
