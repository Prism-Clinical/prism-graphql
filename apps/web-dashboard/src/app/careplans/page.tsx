'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  PlusIcon,
  FunnelIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { LoadingState, EmptyState } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/layout/Header';
import { formatRelativeTime, formatDate } from '@/lib/utils/formatters';
import { useCarePlans, useCarePlanStats, CarePlanFilter } from '@/lib/hooks/useCarePlans';

const statusOptions = ['ALL', 'DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

export default function CarePlansPage() {
  const [statusFilter, setStatusFilter] = useState('ALL');

  const filter: CarePlanFilter = {};
  if (statusFilter !== 'ALL') {
    filter.status = statusFilter as CarePlanFilter['status'];
  }

  const {
    carePlans,
    totalCount,
    hasNextPage,
    loading,
    error,
    loadMore,
    refetch,
  } = useCarePlans(Object.keys(filter).length > 0 ? filter : undefined, 20);

  const { activeCount, draftCount, completedCount } = useCarePlanStats();

  const getProgressSummary = (carePlan: any) => {
    const goals = carePlan.goals || [];
    const completedGoals = goals.filter((g: any) => g.status === 'COMPLETED').length;
    return `${completedGoals}/${goals.length} goals`;
  };

  const getInterventionCount = (carePlan: any) => {
    return carePlan.interventions?.length || 0;
  };

  return (
    <div>
      <PageHeader
        title="Care Plans"
        subtitle={`${totalCount} total care plans`}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Care Plans' },
        ]}
        actions={
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={loading}
            >
              <ArrowPathIcon className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Link href="/careplans/new">
              <Button variant="primary">
                <PlusIcon className="h-4 w-4 mr-2" />
                New Care Plan
              </Button>
            </Link>
          </div>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="hover:shadow-md transition-shadow">
          <CardBody>
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-green-50 text-green-600">
                <CheckCircleIcon className="h-6 w-6" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Active Plans</p>
                <p className="text-2xl font-bold text-gray-900">{activeCount}</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardBody>
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
                <DocumentTextIcon className="h-6 w-6" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Draft Plans</p>
                <p className="text-2xl font-bold text-gray-900">{draftCount}</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardBody>
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
                <ClockIcon className="h-6 w-6" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Completed</p>
                <p className="text-2xl font-bold text-gray-900">{completedCount}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <FunnelIcon className="h-5 w-5 text-gray-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="input w-40"
              >
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === 'ALL' ? 'All Statuses' : option}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Loading State */}
      {loading && carePlans.length === 0 && (
        <LoadingState message="Loading care plans..." />
      )}

      {/* Error State */}
      {error && (
        <Card>
          <CardBody>
            <div className="text-center text-red-600 py-8">
              <p className="font-medium">Error loading care plans</p>
              <p className="text-sm text-gray-500 mt-1">{error.message}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                className="mt-4"
              >
                Try Again
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Care Plans Table */}
      {!error && (carePlans.length > 0 || !loading) && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Interventions</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {carePlans.map((plan: any) => (
                <TableRow key={plan.id} clickable>
                  <TableCell>
                    <Link
                      href={`/careplans/${plan.id}`}
                      className="font-medium text-gray-900 hover:text-blue-600"
                    >
                      {plan.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {plan.patient ? (
                      <Link
                        href={`/patients/${plan.patient.id}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {plan.patient.firstName} {plan.patient.lastName}
                      </Link>
                    ) : (
                      <span className="text-gray-400">Unknown</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <CarePlanStatusBadge status={plan.status} />
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {getProgressSummary(plan)}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {getInterventionCount(plan)} interventions
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {plan.startDate && (
                      <div>
                        <span className="text-gray-400">Start:</span>{' '}
                        {formatDate(plan.startDate)}
                      </div>
                    )}
                    {plan.targetEndDate && (
                      <div>
                        <span className="text-gray-400">End:</span>{' '}
                        {formatDate(plan.targetEndDate)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/careplans/${plan.id}`}>
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Empty State */}
          {carePlans.length === 0 && !loading && (
            <div className="py-12">
              <EmptyState
                title="No care plans found"
                description="Create a new care plan to get started"
              />
              <div className="text-center mt-4">
                <Link href="/careplans/new">
                  <Button variant="primary">
                    <PlusIcon className="h-4 w-4 mr-2" />
                    Create Care Plan
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* Load More */}
          {hasNextPage && (
            <div className="p-4 border-t border-gray-200 text-center">
              <Button variant="outline" onClick={loadMore} disabled={loading}>
                {loading ? 'Loading...' : 'Load More'}
              </Button>
            </div>
          )}
        </Card>
      )}
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
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        statusColors[status] || statusColors.DRAFT
      }`}
    >
      {status}
    </span>
  );
}
