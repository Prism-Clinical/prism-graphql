'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ShieldExclamationIcon,
  ClockIcon,
  UserIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SeverityBadge, StatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { LoadingState } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/layout/Header';
import { formatDateTime, formatRelativeTime, formatCheckType } from '@/lib/utils/formatters';
import { useSafetyCheck, useOverrideSafetyCheck } from '@/lib/hooks/useSafetyChecks';
import { severityColors } from '@/lib/utils/colors';
import type { SafetySeverity, SafetyStatus } from '@/lib/utils/colors';

export default function SafetyCheckDetailPage() {
  const params = useParams();
  const router = useRouter();
  const checkId = params.checkId as string;

  const { safetyCheck, loading, error, refetch } = useSafetyCheck(checkId);
  const { override, loading: overrideLoading } = useOverrideSafetyCheck();

  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideJustification, setOverrideJustification] = useState('');
  const [overrideError, setOverrideError] = useState('');

  const handleOverride = async () => {
    if (!overrideReason.trim() || !overrideJustification.trim()) {
      setOverrideError('Both reason and clinical justification are required');
      return;
    }

    try {
      await override({
        checkId,
        reason: overrideReason,
        justification: overrideJustification,
        overriddenBy: 'current-user', // In production, get from auth context
      });
      setShowOverrideModal(false);
      setOverrideReason('');
      setOverrideJustification('');
      refetch();
    } catch (err) {
      setOverrideError('Failed to override safety check. Please try again.');
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Safety Check Details"
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Safety Alerts', href: '/safety' },
            { label: 'Loading...' },
          ]}
        />
        <LoadingState message="Loading safety check details..." />
      </div>
    );
  }

  if (error || !safetyCheck) {
    return (
      <div>
        <PageHeader
          title="Safety Check Details"
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Safety Alerts', href: '/safety' },
            { label: 'Error' },
          ]}
        />
        <Card>
          <CardBody>
            <div className="text-center py-8">
              <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <p className="text-red-600 font-medium">
                {error?.message || 'Safety check not found'}
              </p>
              <Button variant="outline" onClick={() => router.back()} className="mt-4">
                Go Back
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const severity = safetyCheck.severity as SafetySeverity;
  const status = safetyCheck.status as SafetyStatus;
  const colors = severityColors[severity] || severityColors.INFO;
  const canOverride = status === 'FLAGGED' || status === 'BLOCKED';

  return (
    <div>
      <PageHeader
        title="Safety Check Details"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Safety Alerts', href: '/safety' },
          { label: safetyCheck.title?.substring(0, 30) + '...' || 'Details' },
        ]}
        actions={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Back
            </Button>
            {canOverride && (
              <Button variant="danger" onClick={() => setShowOverrideModal(true)}>
                Override Check
              </Button>
            )}
          </div>
        }
      />

      {/* Alert Banner */}
      <div className={`${colors.bg} ${colors.border} border rounded-lg p-4 mb-6`}>
        <div className="flex items-start gap-4">
          <ShieldExclamationIcon className={`h-8 w-8 ${colors.text} flex-shrink-0`} />
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <SeverityBadge severity={severity} />
              <StatusBadge status={status} />
              <span className="text-sm text-gray-500">
                {formatCheckType(safetyCheck.checkType)}
              </span>
            </div>
            <h2 className={`text-lg font-semibold ${colors.text}`}>
              {safetyCheck.title}
            </h2>
            <p className="text-gray-600 mt-1">{safetyCheck.description}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Clinical Rationale */}
          {safetyCheck.clinicalRationale && (
            <Card>
              <CardHeader>
                <CardTitle>Clinical Rationale</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-gray-700 whitespace-pre-wrap">
                  {safetyCheck.clinicalRationale}
                </p>
              </CardBody>
            </Card>
          )}

          {/* Related Items */}
          <Card>
            <CardHeader>
              <CardTitle>Related Items</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {safetyCheck.relatedMedications?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-2">Medications</h4>
                  <div className="flex flex-wrap gap-2">
                    {safetyCheck.relatedMedications.map((med: string, i: number) => (
                      <span
                        key={i}
                        className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm"
                      >
                        {med}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {safetyCheck.relatedConditions?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-2">Conditions</h4>
                  <div className="flex flex-wrap gap-2">
                    {safetyCheck.relatedConditions.map((condition: string, i: number) => (
                      <span
                        key={i}
                        className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm"
                      >
                        {condition}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {safetyCheck.relatedAllergies?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-2">Allergies</h4>
                  <div className="flex flex-wrap gap-2">
                    {safetyCheck.relatedAllergies.map((allergy: string, i: number) => (
                      <span
                        key={i}
                        className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm"
                      >
                        {allergy}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!safetyCheck.relatedMedications?.length &&
                !safetyCheck.relatedConditions?.length &&
                !safetyCheck.relatedAllergies?.length && (
                  <p className="text-gray-500 text-sm">No related items recorded</p>
                )}
            </CardBody>
          </Card>

          {/* Guideline References */}
          {safetyCheck.guidelineReferences?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Guideline References</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-2">
                  {safetyCheck.guidelineReferences.map((ref: string, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <DocumentTextIcon className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{ref}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {/* Override History */}
          {safetyCheck.overrideInfo && (
            <Card>
              <CardHeader>
                <CardTitle>Override Information</CardTitle>
              </CardHeader>
              <CardBody>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircleIcon className="h-5 w-5 text-purple-600" />
                    <span className="font-medium text-purple-700">
                      Overridden by {safetyCheck.overrideInfo.overriddenBy}
                    </span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="text-gray-500">Date:</span>{' '}
                      {formatDateTime(safetyCheck.overrideInfo.overriddenAt)}
                    </p>
                    <p>
                      <span className="text-gray-500">Reason:</span>{' '}
                      {safetyCheck.overrideInfo.reason}
                    </p>
                    <p>
                      <span className="text-gray-500">Justification:</span>{' '}
                      {safetyCheck.overrideInfo.justification}
                    </p>
                    {safetyCheck.overrideInfo.expiresAt && (
                      <p>
                        <span className="text-gray-500">Expires:</span>{' '}
                        {formatDateTime(safetyCheck.overrideInfo.expiresAt)}
                      </p>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Patient Info */}
          <Card>
            <CardHeader>
              <CardTitle>Patient</CardTitle>
            </CardHeader>
            <CardBody>
              {safetyCheck.patient ? (
                <Link
                  href={`/patients/${safetyCheck.patient.id}`}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <UserIcon className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{safetyCheck.patient.firstName} {safetyCheck.patient.lastName}</p>
                    <p className="text-sm text-blue-600">View Patient Profile</p>
                  </div>
                </Link>
              ) : (
                <p className="text-gray-500">Patient information unavailable</p>
              )}
            </CardBody>
          </Card>

          {/* Timestamps */}
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <ClockIcon className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Created</p>
                    <p className="font-medium">
                      {formatRelativeTime(safetyCheck.createdAt)}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatDateTime(safetyCheck.createdAt)}
                    </p>
                  </div>
                </div>
                {safetyCheck.updatedAt !== safetyCheck.createdAt && (
                  <div className="flex items-center gap-3">
                    <ClockIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-500">Last Updated</p>
                      <p className="font-medium">
                        {formatRelativeTime(safetyCheck.updatedAt)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatDateTime(safetyCheck.updatedAt)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {canOverride && (
                <Button
                  variant="danger"
                  className="w-full"
                  onClick={() => setShowOverrideModal(true)}
                >
                  Override Safety Check
                </Button>
              )}
              <Link href={`/patients/${safetyCheck.patient?.id}/safety`} className="block">
                <Button variant="outline" className="w-full">
                  View Patient Safety History
                </Button>
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Override Modal */}
      <Modal
        isOpen={showOverrideModal}
        onClose={() => {
          setShowOverrideModal(false);
          setOverrideError('');
        }}
        title="Override Safety Check"
      >
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-700">
                <p className="font-medium">Important</p>
                <p>
                  Overriding this safety check will allow the associated action to proceed.
                  Please provide a clinical justification for this override.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Override Reason <span className="text-red-500">*</span>
            </label>
            <select
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              className="input w-full"
            >
              <option value="">Select a reason...</option>
              <option value="CLINICAL_JUDGMENT">Clinical Judgment</option>
              <option value="PATIENT_SPECIFIC">Patient-Specific Circumstances</option>
              <option value="DOCUMENTED_TOLERANCE">Documented Tolerance</option>
              <option value="BENEFIT_OUTWEIGHS_RISK">Benefit Outweighs Risk</option>
              <option value="MONITORING_IN_PLACE">Monitoring in Place</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Clinical Justification <span className="text-red-500">*</span>
            </label>
            <textarea
              value={overrideJustification}
              onChange={(e) => setOverrideJustification(e.target.value)}
              placeholder="Provide detailed clinical justification for this override..."
              rows={4}
              className="input w-full"
            />
          </div>

          {overrideError && (
            <p className="text-red-600 text-sm">{overrideError}</p>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setShowOverrideModal(false);
                setOverrideError('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleOverride}
              disabled={overrideLoading}
            >
              {overrideLoading ? 'Processing...' : 'Confirm Override'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
