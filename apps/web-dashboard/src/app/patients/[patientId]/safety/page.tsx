'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ShieldExclamationIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentCheckIcon,
  UserIcon,
  ClockIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SeverityBadge, StatusBadge } from '@/components/ui/Badge';
import { LoadingState, EmptyState } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/layout/Header';
import {
  formatRelativeTime,
  formatDate,
  formatCheckType,
} from '@/lib/utils/formatters';
import { usePatientSafetySummary } from '@/lib/hooks/usePatient';
import { severityColors } from '@/lib/utils/colors';
import type { SafetySeverity, SafetyStatus } from '@/lib/utils/colors';
import clsx from 'clsx';

export default function PatientSafetyPage() {
  const params = useParams();
  const router = useRouter();
  const patientId = params.patientId as string;

  const {
    patient,
    activeAlerts,
    safetyChecks,
    safetyCheckCount,
    carePlans,
    carePlanCount,
    loading,
    error,
    refetch,
  } = usePatientSafetySummary(patientId);

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Patient Safety Summary"
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Patients', href: '/patients' },
            { label: 'Loading...' },
          ]}
        />
        <LoadingState message="Loading patient safety data..." />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader
          title="Patient Safety Summary"
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Patients', href: '/patients' },
            { label: 'Error' },
          ]}
        />
        <Card>
          <CardBody>
            <div className="text-center py-8">
              <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <p className="text-red-600 font-medium">{error.message}</p>
              <Button variant="outline" onClick={() => router.back()} className="mt-4">
                Go Back
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const criticalAlerts = activeAlerts.filter(
    (a: any) => a.severity === 'CRITICAL' || a.severity === 'CONTRAINDICATED'
  );
  const warningAlerts = activeAlerts.filter((a: any) => a.severity === 'WARNING');

  return (
    <div>
      <PageHeader
        title="Patient Safety Summary"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Patients', href: '/patients' },
          { label: patient?.name || 'Patient' },
          { label: 'Safety' },
        ]}
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back
          </Button>
        }
      />

      {/* Patient Header */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center">
              <UserIcon className="h-8 w-8 text-blue-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-gray-900">
                {patient?.name || 'Unknown Patient'}
              </h2>
              {patient?.mrn && (
                <p className="text-sm text-gray-500">MRN: {patient.mrn}</p>
              )}
            </div>
            <div className="flex gap-4">
              <Link href={`/patients/${patientId}`}>
                <Button variant="outline" size="sm">
                  View Full Profile
                </Button>
              </Link>
              <Link href={`/careplans?patientId=${patientId}`}>
                <Button variant="outline" size="sm">
                  View Care Plans ({carePlanCount})
                </Button>
              </Link>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Active Alerts Banner */}
      {activeAlerts.length > 0 && (
        <div
          className={clsx(
            'rounded-lg p-4 mb-6 border',
            criticalAlerts.length > 0
              ? 'bg-red-50 border-red-200'
              : 'bg-yellow-50 border-yellow-200'
          )}
        >
          <div className="flex items-start gap-4">
            <ShieldExclamationIcon
              className={clsx(
                'h-8 w-8 flex-shrink-0',
                criticalAlerts.length > 0 ? 'text-red-600' : 'text-yellow-600'
              )}
            />
            <div className="flex-1">
              <h3
                className={clsx(
                  'font-semibold',
                  criticalAlerts.length > 0 ? 'text-red-700' : 'text-yellow-700'
                )}
              >
                {activeAlerts.length} Active Safety Alert
                {activeAlerts.length !== 1 ? 's' : ''}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {criticalAlerts.length > 0 && (
                  <span className="text-red-600 font-medium">
                    {criticalAlerts.length} critical/contraindicated
                  </span>
                )}
                {criticalAlerts.length > 0 && warningAlerts.length > 0 && ' • '}
                {warningAlerts.length > 0 && (
                  <span className="text-yellow-600 font-medium">
                    {warningAlerts.length} warnings
                  </span>
                )}
              </p>
            </div>
            <Link href="/safety">
              <Button
                variant={criticalAlerts.length > 0 ? 'danger' : 'outline'}
                size="sm"
              >
                Review Alerts
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardBody>
            <div className="flex items-center">
              <div
                className={clsx(
                  'p-3 rounded-lg',
                  criticalAlerts.length > 0
                    ? 'bg-red-50 text-red-600'
                    : 'bg-green-50 text-green-600'
                )}
              >
                <ShieldExclamationIcon className="h-6 w-6" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Active Alerts</p>
                <p className="text-2xl font-bold text-gray-900">
                  {activeAlerts.length}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
                <ClipboardDocumentCheckIcon className="h-6 w-6" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Total Checks</p>
                <p className="text-2xl font-bold text-gray-900">
                  {safetyCheckCount}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
                <ClockIcon className="h-6 w-6" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Care Plans</p>
                <p className="text-2xl font-bold text-gray-900">{carePlanCount}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Alerts Detail */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Active Alerts</CardTitle>
            <Link href={`/safety?patientId=${patientId}`}>
              <Button variant="ghost" size="sm">
                View All
              </Button>
            </Link>
          </CardHeader>
          <CardBody className="p-0">
            {activeAlerts.length > 0 ? (
              <div className="divide-y divide-gray-200">
                {activeAlerts.map((alert: any) => {
                  const severity = alert.severity as SafetySeverity;
                  const colors = severityColors[severity] || severityColors.INFO;
                  return (
                    <Link
                      key={alert.id}
                      href={`/safety/${alert.id}`}
                      className={`block px-6 py-4 hover:bg-gray-50 ${colors.bg}`}
                    >
                      <div className="flex items-start gap-3">
                        <ExclamationTriangleIcon
                          className={`h-5 w-5 ${colors.text} flex-shrink-0 mt-0.5`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <SeverityBadge severity={severity} size="sm" />
                            <span className="text-xs text-gray-500">
                              {formatCheckType(alert.checkType)}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {alert.title}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {formatRelativeTime(alert.createdAt)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="px-6 py-8 text-center">
                <CheckCircleIcon className="h-12 w-12 text-green-500 mx-auto mb-3" />
                <p className="text-gray-600 font-medium">No Active Alerts</p>
                <p className="text-sm text-gray-500">
                  This patient has no active safety alerts
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Safety Check History */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Safety Check History</CardTitle>
            <Link href={`/safety?patientId=${patientId}`}>
              <Button variant="ghost" size="sm">
                View All ({safetyCheckCount})
              </Button>
            </Link>
          </CardHeader>
          <CardBody className="p-0">
            {safetyChecks.length > 0 ? (
              <div className="divide-y divide-gray-200">
                {safetyChecks.slice(0, 10).map((check: any) => (
                  <Link
                    key={check.id}
                    href={`/safety/${check.id}`}
                    className="block px-6 py-4 hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <SeverityBadge
                            severity={check.severity as SafetySeverity}
                            size="sm"
                          />
                          <StatusBadge status={check.status as SafetyStatus} />
                        </div>
                        <p className="text-sm text-gray-900 truncate">{check.title}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatCheckType(check.checkType)} •{' '}
                          {formatRelativeTime(check.createdAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="px-6 py-8">
                <EmptyState
                  title="No safety checks"
                  description="No safety checks have been recorded for this patient"
                />
              </div>
            )}
          </CardBody>
        </Card>

        {/* Active Care Plans */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Active Care Plans</CardTitle>
            <Link href={`/careplans?patientId=${patientId}`}>
              <Button variant="ghost" size="sm">
                View All ({carePlanCount})
              </Button>
            </Link>
          </CardHeader>
          <CardBody>
            {carePlans.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {carePlans.map((plan: any) => (
                  <Link
                    key={plan.id}
                    href={`/careplans/${plan.id}`}
                    className="block p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{plan.title}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <CarePlanStatusBadge status={plan.status} />
                          {plan.startDate && (
                            <span className="text-xs text-gray-500">
                              Started {formatDate(plan.startDate)}
                            </span>
                          )}
                        </div>
                      </div>
                      <ClipboardDocumentCheckIcon className="h-5 w-5 text-gray-400" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No care plans"
                description="No care plans have been created for this patient"
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function CarePlanStatusBadge({ status }: { status: string }) {
  const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    ACTIVE: 'bg-green-100 text-green-700',
    COMPLETED: 'bg-blue-100 text-blue-700',
    CANCELLED: 'bg-red-100 text-red-700',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        statusColors[status] || statusColors.DRAFT
      }`}
    >
      {status}
    </span>
  );
}
