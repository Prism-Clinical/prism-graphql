'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  FunnelIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SeverityBadge, StatusBadge } from '@/components/ui/Badge';
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
import { formatRelativeTime, formatCheckType } from '@/lib/utils/formatters';
import { useSafetyChecks, SafetyCheckFilter } from '@/lib/hooks/useSafetyChecks';
import type { SafetySeverity, SafetyStatus } from '@/lib/utils/colors';

const severityOptions = ['ALL', 'CRITICAL', 'CONTRAINDICATED', 'WARNING', 'INFO'];
const statusOptions = ['ALL', 'PENDING', 'PASSED', 'FLAGGED', 'OVERRIDDEN', 'BLOCKED'];

export default function SafetyPage() {
  const searchParams = useSearchParams();
  const initialSeverity = searchParams.get('severity') || 'ALL';

  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState(initialSeverity);
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Build filter for GraphQL query
  const filter: SafetyCheckFilter = {};
  if (severityFilter !== 'ALL') {
    filter.severity = severityFilter as SafetyCheckFilter['severity'];
  }
  if (statusFilter !== 'ALL') {
    filter.status = statusFilter as SafetyCheckFilter['status'];
  }

  const {
    safetyChecks,
    totalCount,
    hasNextPage,
    loading,
    error,
    loadMore,
    refetch,
  } = useSafetyChecks(Object.keys(filter).length > 0 ? filter : undefined, 20);

  // Client-side search filtering (for search within loaded results)
  const filteredChecks = safetyChecks.filter((check: any) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        check.title?.toLowerCase().includes(query) ||
        check.patient?.name?.toLowerCase().includes(query) ||
        check.checkType?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Update filter when URL params change
  useEffect(() => {
    const severity = searchParams.get('severity');
    if (severity && severityOptions.includes(severity)) {
      setSeverityFilter(severity);
    }
  }, [searchParams]);

  return (
    <div>
      <PageHeader
        title="Safety Alerts"
        subtitle={`${totalCount} total safety checks`}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Safety Alerts' },
        ]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={loading}
          >
            <ArrowPathIcon className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {/* Filters */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by title, patient, or type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-10"
              />
            </div>

            {/* Severity Filter */}
            <div className="flex items-center gap-2">
              <FunnelIcon className="h-5 w-5 text-gray-400" />
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="input w-40"
              >
                {severityOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === 'ALL' ? 'All Severities' : option}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
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
        </CardBody>
      </Card>

      {/* Loading State */}
      {loading && safetyChecks.length === 0 && (
        <LoadingState message="Loading safety checks..." />
      )}

      {/* Error State */}
      {error && (
        <Card>
          <CardBody>
            <div className="text-center text-red-600 py-8">
              <p className="font-medium">Error loading safety checks</p>
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

      {/* Safety Checks Table */}
      {!error && (safetyChecks.length > 0 || !loading) && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredChecks.map((check: any) => (
                <TableRow key={check.id} clickable>
                  <TableCell>
                    <SeverityBadge severity={check.severity as SafetySeverity} />
                  </TableCell>
                  <TableCell className="text-gray-500 text-xs">
                    {formatCheckType(check.checkType)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/safety/${check.id}`}
                      className="font-medium text-gray-900 hover:text-blue-600"
                    >
                      {check.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {check.patient ? (
                      <Link
                        href={`/patients/${check.patient.id}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {check.patient.firstName} {check.patient.lastName}
                      </Link>
                    ) : (
                      <span className="text-gray-400">Unknown</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={check.status as SafetyStatus} />
                  </TableCell>
                  <TableCell className="text-gray-500 text-sm">
                    {formatRelativeTime(check.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Link href={`/safety/${check.id}`}>
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
          {filteredChecks.length === 0 && !loading && (
            <div className="py-12">
              <EmptyState
                title="No safety checks found"
                description="Try adjusting your filters or search query"
              />
            </div>
          )}

          {/* Load More */}
          {hasNextPage && (
            <div className="p-4 border-t border-gray-200 text-center">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load More'}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
