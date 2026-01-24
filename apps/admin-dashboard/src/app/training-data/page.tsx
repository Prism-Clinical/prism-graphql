'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PlusIcon, AcademicCapIcon, FunnelIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Spinner, EmptyState } from '@/components/ui/Spinner';
import {
  useTrainingCarePlans,
  useDeleteTrainingCarePlan,
  CarePlanStatus,
} from '@/lib/hooks/useTrainingCarePlans';

const statusColors: Record<CarePlanStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  ACTIVE: 'bg-green-100 text-green-800',
  ON_HOLD: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-blue-100 text-blue-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

const statusLabels: Record<CarePlanStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export default function TrainingDataPage() {
  const [statusFilter, setStatusFilter] = useState<CarePlanStatus | undefined>();
  const [tagFilter, setTagFilter] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { carePlans, loading, error, totalCount, refetch } = useTrainingCarePlans({
    filter: {
      status: statusFilter,
      trainingTag: tagFilter || undefined,
    },
    first: 50,
  });

  const { deleteCarePlan } = useDeleteTrainingCarePlan();

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this training data?')) return;
    setDeletingId(id);
    try {
      await deleteCarePlan(id);
      refetch();
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Training Data</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage data used for ML model training and RAG context
            {totalCount > 0 && ` (${totalCount} entries)`}
          </p>
        </div>
        <Link href="/training-data/new">
          <Button>
            <PlusIcon className="h-4 w-4 mr-2" />
            Add Training Data
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex items-center gap-4 flex-wrap">
            <FunnelIcon className="h-5 w-5 text-gray-400" />
            <select
              value={statusFilter || ''}
              onChange={(e) => setStatusFilter(e.target.value as CarePlanStatus || undefined)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All Status</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Filter by tag..."
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">
              <p>Error loading training data. Please try again.</p>
            </div>
          ) : carePlans.length === 0 ? (
            <EmptyState
              title="No training data found"
              icon={<AcademicCapIcon className="h-12 w-12" />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Conditions</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Goals</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carePlans.map((carePlan) => (
                  <TableRow key={carePlan.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{carePlan.title}</p>
                        {carePlan.trainingDescription && (
                          <p className="text-xs text-gray-500 truncate max-w-xs">
                            {carePlan.trainingDescription}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 text-xs rounded ${statusColors[carePlan.status]}`}>
                        {statusLabels[carePlan.status]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {carePlan.conditionCodes?.slice(0, 2).map((code) => (
                          <span key={code} className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                            {code}
                          </span>
                        ))}
                        {carePlan.conditionCodes?.length > 2 && (
                          <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                            +{carePlan.conditionCodes.length - 2}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {carePlan.trainingTags?.slice(0, 2).map((tag) => (
                          <span key={tag} className="px-1.5 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded">
                            {tag}
                          </span>
                        ))}
                        {carePlan.trainingTags?.length > 2 && (
                          <span className="px-1.5 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded">
                            +{carePlan.trainingTags.length - 2}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {carePlan.goals?.length || 0}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {formatDate(carePlan.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Link href={`/training-data/${carePlan.id}`}>
                          <Button variant="ghost" size="sm">View</Button>
                        </Link>
                        <Link href={`/training-data/${carePlan.id}/edit`}>
                          <Button variant="ghost" size="sm">Edit</Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(carePlan.id)}
                          disabled={deletingId === carePlan.id}
                          className="text-red-600 hover:text-red-700"
                        >
                          {deletingId === carePlan.id ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <TrashIcon className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
