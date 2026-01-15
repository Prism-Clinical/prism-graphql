'use client';

import { useState } from 'react';
import {
  PlusIcon,
  ShieldExclamationIcon,
  ExclamationTriangleIcon,
  BeakerIcon,
  HeartIcon,
  UserIcon,
  ClockIcon,
  InformationCircleIcon,
  XMarkIcon,
  Squares2X2Icon,
  ListBulletIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Spinner, EmptyState } from '@/components/ui/Spinner';
import {
  useSafetyRules,
  useSafetyRule,
  useCreateSafetyRule,
  useUpdateSafetyRule,
  useDeleteSafetyRule,
  useActivateSafetyRule,
  useDeactivateSafetyRule,
  SafetyRuleType,
  SafetyRuleSeverity,
  SafetyRule,
} from '@/lib/hooks/useSafetyRules';

// Configuration for alert types
const alertTypeConfig: Record<SafetyRuleType, {
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  selectedBg: string;
}> = {
  DRUG_INTERACTION: {
    label: 'Medication Conflicts',
    shortLabel: 'Medications',
    description: 'Dangerous drug interactions',
    icon: ExclamationTriangleIcon,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    selectedBg: 'bg-red-100 border-red-300 text-red-800',
  },
  ALLERGY_ALERT: {
    label: 'Allergy Warnings',
    shortLabel: 'Allergies',
    description: 'Patient allergy alerts',
    icon: ShieldExclamationIcon,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    selectedBg: 'bg-orange-100 border-orange-300 text-orange-800',
  },
  CONTRAINDICATION: {
    label: 'Medical Contraindications',
    shortLabel: 'Contraindications',
    description: 'Harmful treatment flags',
    icon: HeartIcon,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    selectedBg: 'bg-purple-100 border-purple-300 text-purple-800',
  },
  DOSAGE_CHECK: {
    label: 'Dosage Validation',
    shortLabel: 'Dosages',
    description: 'Safe dose verification',
    icon: BeakerIcon,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    selectedBg: 'bg-blue-100 border-blue-300 text-blue-800',
  },
  AGE_RESTRICTION: {
    label: 'Age Appropriateness',
    shortLabel: 'Age',
    description: 'Age-based restrictions',
    icon: UserIcon,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    selectedBg: 'bg-green-100 border-green-300 text-green-800',
  },
  LAB_VALUE_CHECK: {
    label: 'Lab Value Monitoring',
    shortLabel: 'Lab Values',
    description: 'Lab result validation',
    icon: ClockIcon,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    selectedBg: 'bg-teal-100 border-teal-300 text-teal-800',
  },
};

const severityConfig: Record<SafetyRuleSeverity, {
  label: string;
  description: string;
  color: string;
  bgColor: string;
}> = {
  CRITICAL: { label: 'Critical', description: 'Blocks action until resolved', color: 'text-red-800', bgColor: 'bg-red-100' },
  HIGH: { label: 'High', description: 'Requires acknowledgment', color: 'text-orange-800', bgColor: 'bg-orange-100' },
  MEDIUM: { label: 'Medium', description: 'Shows prominent warning', color: 'text-yellow-800', bgColor: 'bg-yellow-100' },
  LOW: { label: 'Low', description: 'Shows informational notice', color: 'text-blue-800', bgColor: 'bg-blue-100' },
  INFO: { label: 'Info', description: 'Logs for reference only', color: 'text-gray-700', bgColor: 'bg-gray-100' },
};

const ruleTypeOptions: SafetyRuleType[] = ['DRUG_INTERACTION', 'ALLERGY_ALERT', 'CONTRAINDICATION', 'DOSAGE_CHECK', 'AGE_RESTRICTION', 'LAB_VALUE_CHECK'];
const severityOptions: SafetyRuleSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

// Modal Component
function AlertModal({
  rule,
  isNew,
  onClose,
  onSave,
  onDelete,
  onToggleActive,
}: {
  rule: SafetyRule | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
  onDelete?: () => Promise<void>;
  onToggleActive?: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [name, setName] = useState(rule?.name || '');
  const [ruleType, setRuleType] = useState<SafetyRuleType>(rule?.ruleType || 'DRUG_INTERACTION');
  const [severity, setSeverity] = useState<SafetyRuleSeverity>(rule?.severity || 'MEDIUM');
  const [description, setDescription] = useState(rule?.description || '');
  const [alertMessage, setAlertMessage] = useState(rule?.alertMessage || '');
  const [triggerConditions, setTriggerConditions] = useState(rule?.triggerConditions || '');

  const typeConfig = alertTypeConfig[ruleType];
  const Icon = typeConfig?.icon || ShieldExclamationIcon;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        name,
        ruleType,
        severity,
        description,
        alertMessage,
        triggerConditions: triggerConditions || '{}',
      });
      if (!isNew) setIsEditing(false);
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this alert? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await onDelete?.();
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  };

  const isValid = name && description && alertMessage;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />

        {/* Modal */}
        <div className="relative bg-white rounded-xl shadow-2xl w-[95vw] max-w-[1400px] h-[90vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${typeConfig?.bgColor || 'bg-gray-50'}`}>
                <Icon className={`h-5 w-5 ${typeConfig?.color || 'text-gray-600'}`} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {isNew ? 'Create Clinical Alert' : (isEditing ? 'Edit Alert' : name)}
                </h2>
                {!isNew && !isEditing && (
                  <p className="text-sm text-gray-500">{typeConfig?.label}</p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <XMarkIcon className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 flex-1 flex flex-col min-h-0">
            {isEditing ? (
              /* Edit Mode */
              <div className="flex flex-col h-full gap-3">
                {/* Top row - Name, Category (if new), Severity */}
                <div className="flex-shrink-0 grid grid-cols-3 gap-4">
                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Alert Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="e.g., Warfarin-Aspirin Interaction"
                    />
                  </div>

                  {/* Category (only for new) */}
                  {isNew ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                      <select
                        value={ruleType}
                        onChange={(e) => setRuleType(e.target.value as SafetyRuleType)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        {ruleTypeOptions.map((type) => (
                          <option key={type} value={type}>{alertTypeConfig[type].label}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                      <input
                        type="text"
                        value={alertTypeConfig[ruleType]?.label || ruleType}
                        disabled
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-500"
                      />
                    </div>
                  )}

                  {/* Severity */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
                    <select
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value as SafetyRuleSeverity)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      {severityOptions.map((s) => (
                        <option key={s} value={s}>{severityConfig[s].label} - {severityConfig[s].description}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Main content area - fills remaining space */}
                <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
                  {/* Left column */}
                  <div className="flex flex-col gap-3 min-h-0">
                    {/* Description */}
                    <div className="flex-1 flex flex-col min-h-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex-shrink-0">Description</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="flex-1 w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                        placeholder="Describe when this alert triggers..."
                      />
                    </div>
                  </div>

                  {/* Right column */}
                  <div className="flex flex-col gap-3 min-h-0">
                    {/* Alert Message */}
                    <div className="flex-1 flex flex-col min-h-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex-shrink-0">Alert Message</label>
                      <textarea
                        value={alertMessage}
                        onChange={(e) => setAlertMessage(e.target.value)}
                        className="flex-1 w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                        placeholder="The warning message providers will see..."
                      />
                    </div>
                  </div>
                </div>

                {/* Trigger Conditions - at bottom */}
                <div className="flex-shrink-0">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Trigger Conditions <span className="text-gray-400 font-normal">(optional JSON)</span>
                  </label>
                  <textarea
                    value={triggerConditions}
                    onChange={(e) => setTriggerConditions(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                    placeholder='{"medications": ["warfarin", "aspirin"]}'
                  />
                </div>
              </div>
            ) : (
              /* View Mode */
              <div className="flex flex-col h-full gap-4">
                {/* Status and Metadata Row */}
                <div className="flex-shrink-0 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 text-sm rounded-full font-medium ${
                      rule?.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {rule?.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <span className={`px-3 py-1 text-sm rounded font-medium ${severityConfig[rule?.severity || 'MEDIUM'].bgColor} ${severityConfig[rule?.severity || 'MEDIUM'].color}`}>
                      {severityConfig[rule?.severity || 'MEDIUM'].label} Severity
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span>Version {rule?.version}</span>
                    <span>Created {formatDate(rule?.createdAt)}</span>
                    {rule?.updatedAt && <span>Updated {formatDate(rule.updatedAt)}</span>}
                  </div>
                </div>

                {/* Main content - fills remaining space */}
                <div className="flex-1 grid grid-cols-2 gap-6 min-h-0">
                  {/* Left Column */}
                  <div className="flex flex-col gap-4 min-h-0">
                    {/* Description */}
                    <div className="flex-1 flex flex-col min-h-0">
                      <p className="text-sm font-medium text-gray-700 mb-2 flex-shrink-0">Description</p>
                      <div className="flex-1 bg-gray-50 rounded-lg p-4 overflow-auto">
                        <p className="text-gray-600 leading-relaxed">{rule?.description}</p>
                      </div>
                    </div>

                    {/* Trigger Conditions */}
                    {rule?.triggerConditions && (
                      <div className="flex-shrink-0">
                        <p className="text-sm font-medium text-gray-700 mb-2">Trigger Conditions</p>
                        <pre className="bg-gray-50 p-4 rounded-lg text-sm font-mono overflow-x-auto whitespace-pre-wrap max-h-32">
                          {rule.triggerConditions}
                        </pre>
                      </div>
                    )}
                  </div>

                  {/* Right Column - Alert Preview */}
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Alert Message Preview</p>
                    <div className={`p-4 rounded-lg border-l-4 ${
                      rule?.severity === 'CRITICAL' ? 'bg-red-50 border-red-500' :
                      rule?.severity === 'HIGH' ? 'bg-orange-50 border-orange-500' :
                      rule?.severity === 'MEDIUM' ? 'bg-yellow-50 border-yellow-500' :
                      'bg-blue-50 border-blue-500'
                    }`}>
                      <p className="text-gray-900">{rule?.alertMessage}</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">This is how the alert will appear to providers</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
            {isEditing ? (
              <>
                <div>
                  {!isNew && (
                    <Button variant="danger" onClick={handleDelete} disabled={deleting}>
                      <TrashIcon className="h-4 w-4 mr-1" />
                      {deleting ? 'Deleting...' : 'Delete'}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => isNew ? onClose() : setIsEditing(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={saving || !isValid}>
                    {saving ? <Spinner className="h-4 w-4" /> : (isNew ? 'Create Alert' : 'Save Changes')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={onToggleActive}
                  >
                    {rule?.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={onClose}>Close</Button>
                  <Button onClick={() => setIsEditing(true)}>
                    <PencilIcon className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClinicalAlertsPage() {
  const [typeFilter, setTypeFilter] = useState<SafetyRuleType | undefined>();
  const [severityFilter, setSeverityFilter] = useState<SafetyRuleSeverity | undefined>();
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>();
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // Modal state
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const { rules, loading, error, refetch } = useSafetyRules({
    filter: { ruleType: typeFilter, severity: severityFilter, isActive: activeFilter },
    first: 50,
  });

  const { rule: selectedRule, loading: loadingRule } = useSafetyRule(selectedRuleId || '');
  const { createSafetyRule } = useCreateSafetyRule();
  const { updateSafetyRule } = useUpdateSafetyRule();
  const { deleteSafetyRule } = useDeleteSafetyRule();
  const { activateSafetyRule } = useActivateSafetyRule();
  const { deactivateSafetyRule } = useDeactivateSafetyRule();

  const activeCount = rules.filter(r => r.isActive).length;
  const hasFilters = typeFilter || severityFilter || activeFilter !== undefined;

  const clearFilters = () => {
    setTypeFilter(undefined);
    setSeverityFilter(undefined);
    setActiveFilter(undefined);
  };

  const handleCreate = async (data: any) => {
    await createSafetyRule(data);
    setShowNewModal(false);
    refetch();
  };

  const handleUpdate = async (data: any) => {
    if (!selectedRuleId) return;
    await updateSafetyRule(selectedRuleId, data);
    refetch();
  };

  const handleDelete = async () => {
    if (!selectedRuleId) return;
    await deleteSafetyRule(selectedRuleId);
    setSelectedRuleId(null);
    refetch();
  };

  const handleToggleActive = async () => {
    if (!selectedRuleId || !selectedRule) return;
    if (selectedRule.isActive) {
      await deactivateSafetyRule(selectedRuleId);
    } else {
      await activateSafetyRule(selectedRuleId);
    }
    refetch();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clinical Alerts</h1>
          <p className="text-sm text-gray-500">
            Automated safety checks that protect patients during care planning
          </p>
        </div>
        <Button onClick={() => setShowNewModal(true)}>
          <PlusIcon className="h-4 w-4 mr-2" />
          New Alert
        </Button>
      </div>

      {/* Filter Bar - Compact */}
      <Card className="mb-3 flex-shrink-0">
        <CardBody className="p-3">
          <div className="flex items-center justify-between gap-4">
            {/* Category Filter Pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-gray-500 uppercase">Category:</span>
              {Object.entries(alertTypeConfig).map(([type, config]) => {
                const Icon = config.icon;
                const isSelected = typeFilter === type;
                return (
                  <button
                    key={type}
                    onClick={() => setTypeFilter(isSelected ? undefined : type as SafetyRuleType)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-medium transition-all ${
                      isSelected ? config.selectedBg : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isSelected ? '' : config.color}`} />
                    <span>{config.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            {/* Secondary Filters */}
            <div className="flex items-center gap-3">
              <select
                value={severityFilter || ''}
                onChange={(e) => setSeverityFilter(e.target.value as SafetyRuleSeverity || undefined)}
                className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
              >
                <option value="">All Severity</option>
                {severityOptions.map((s) => <option key={s} value={s}>{severityConfig[s].label}</option>)}
              </select>
              <select
                value={activeFilter === undefined ? '' : activeFilter.toString()}
                onChange={(e) => setActiveFilter(e.target.value === '' ? undefined : e.target.value === 'true')}
                className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
              >
                <option value="">All Status</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
              {hasFilters && (
                <button onClick={clearFilters} className="text-xs text-indigo-600 hover:text-indigo-800">
                  Clear
                </button>
              )}
              <span className="text-xs text-gray-500 border-l pl-3">
                <span className="font-medium text-gray-900">{rules.length}</span> alerts
              </span>
              <div className="flex items-center border border-gray-200 rounded overflow-hidden">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`p-1.5 ${viewMode === 'cards' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-50'}`}
                >
                  <Squares2X2Icon className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 ${viewMode === 'table' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-50'}`}
                >
                  <ListBulletIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Alert List - Scrollable */}
      <div className="flex-1 min-h-0 overflow-auto mb-3">
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : error ? (
          <Card><CardBody><div className="text-center py-8 text-red-600">Error loading clinical alerts.</div></CardBody></Card>
        ) : rules.length === 0 ? (
          <Card>
            <CardBody className="py-8">
              <EmptyState title={hasFilters ? "No alerts match your filters" : "No clinical alerts found"} icon={<ShieldExclamationIcon className="h-10 w-10" />} />
              <div className="text-center mt-3">
                {hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>Clear Filters</Button>
                ) : (
                  <Button size="sm" onClick={() => setShowNewModal(true)}>Create Your First Alert</Button>
                )}
              </div>
            </CardBody>
          </Card>
        ) : viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {rules.map((rule) => {
              const typeConfig = alertTypeConfig[rule.ruleType];
              const severity = severityConfig[rule.severity];
              const Icon = typeConfig?.icon || ShieldExclamationIcon;

              return (
                <Card
                  key={rule.id}
                  className={`hover:shadow-md transition-shadow cursor-pointer ${!rule.isActive ? 'opacity-60' : ''}`}
                  onClick={() => setSelectedRuleId(rule.id)}
                >
                  <CardBody className="p-3">
                    <div className="flex items-start gap-2">
                      <div className={`p-1.5 rounded ${typeConfig?.bgColor || 'bg-gray-50'}`}>
                        <Icon className={`h-4 w-4 ${typeConfig?.color || 'text-gray-600'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium text-gray-900 truncate">{rule.name}</h3>
                          {!rule.isActive && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Off</span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{rule.description}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${severity?.bgColor} ${severity?.color}`}>
                            {severity?.label}
                          </span>
                          <span className="text-xs text-gray-400">{typeConfig?.shortLabel}</span>
                        </div>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardBody className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Alert</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => {
                    const typeConfig = alertTypeConfig[rule.ruleType];
                    const severity = severityConfig[rule.severity];
                    const Icon = typeConfig?.icon || ShieldExclamationIcon;

                    return (
                      <TableRow
                        key={rule.id}
                        className={`cursor-pointer hover:bg-gray-50 ${!rule.isActive ? 'opacity-60' : ''}`}
                        onClick={() => setSelectedRuleId(rule.id)}
                      >
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            <div className={`p-1 rounded ${typeConfig?.bgColor || 'bg-gray-50'}`}>
                              <Icon className={`h-3.5 w-3.5 ${typeConfig?.color || 'text-gray-600'}`} />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{rule.name}</p>
                              <p className="text-xs text-gray-500 truncate max-w-xs">{rule.description}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-2"><span className="text-xs text-gray-600">{typeConfig?.shortLabel}</span></TableCell>
                        <TableCell className="py-2">
                          <span className={`px-1.5 py-0.5 text-xs rounded ${severity?.bgColor} ${severity?.color}`}>
                            {severity?.label}
                          </span>
                        </TableCell>
                        <TableCell className="py-2">
                          <span className={`px-1.5 py-0.5 text-xs rounded ${rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                            {rule.isActive ? 'Active' : 'Off'}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Severity Legend - Fixed at bottom */}
      <div className="flex-shrink-0 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-6">
          <span className="text-xs font-medium text-gray-600">Severity:</span>
          {Object.entries(severityConfig).map(([level, config]) => (
            <div key={level} className="flex items-center gap-1.5">
              <span className={`px-1.5 py-0.5 text-xs rounded ${config.bgColor} ${config.color} font-medium`}>{config.label}</span>
              <span className="text-xs text-gray-500">{config.description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* View/Edit Modal */}
      {selectedRuleId && !loadingRule && selectedRule && (
        <AlertModal
          rule={selectedRule}
          isNew={false}
          onClose={() => setSelectedRuleId(null)}
          onSave={handleUpdate}
          onDelete={handleDelete}
          onToggleActive={handleToggleActive}
        />
      )}

      {/* New Alert Modal */}
      {showNewModal && (
        <AlertModal
          rule={null}
          isNew={true}
          onClose={() => setShowNewModal(false)}
          onSave={handleCreate}
        />
      )}
    </div>
  );
}
