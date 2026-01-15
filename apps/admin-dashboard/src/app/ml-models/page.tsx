'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import {
  PlusIcon,
  CpuChipIcon,
  FunnelIcon,
  ArrowPathIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Spinner, EmptyState } from '@/components/ui/Spinner';
import { useMLModels, useLoadedModels } from '@/lib/hooks/useMLModels';
import { useTrainingJobs } from '@/lib/hooks/useMLTraining';

const statusIcons: Record<string, React.ReactNode> = {
  PENDING: <ClockIcon className="h-4 w-4 text-gray-500" />,
  RUNNING: <ArrowPathIcon className="h-4 w-4 text-blue-500 animate-spin" />,
  COMPLETED: <CheckCircleIcon className="h-4 w-4 text-green-500" />,
  FAILED: <XCircleIcon className="h-4 w-4 text-red-500" />,
  CANCELLED: <ExclamationTriangleIcon className="h-4 w-4 text-yellow-500" />,
};

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  RUNNING: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-yellow-100 text-yellow-800',
};

export default function MLModelsPage() {
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>();
  const { models, loading, error, refetch } = useMLModels({ isActive: activeFilter });
  const { loadedModels } = useLoadedModels();
  const { jobs, refetch: refetchJobs } = useTrainingJobs({ first: 10 });

  const loadedModelIds = new Set(loadedModels.map(m => m.modelId));

  // Check for active training jobs
  const hasActiveJobs = jobs.some(job => job.status === 'RUNNING' || job.status === 'PENDING');
  const recentJobs = jobs.slice(0, 5);

  // Store refetch functions in a ref to avoid re-creating the interval
  const refetchFnsRef = useRef({ refetchJobs, refetch });
  refetchFnsRef.current = { refetchJobs, refetch };

  // Auto-refresh when training is in progress
  useEffect(() => {
    if (!hasActiveJobs) return;

    const interval = setInterval(async () => {
      const { refetchJobs, refetch } = refetchFnsRef.current;
      await Promise.all([refetchJobs(), refetch()]);
    }, 2000);

    return () => clearInterval(interval);
  }, [hasActiveJobs]);

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ML Models</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage machine learning models for care plan recommendations
            {models.length > 0 && ` (${models.length} models)`}
          </p>
        </div>
        <Link href="/ml-models/new">
          <Button>
            <PlusIcon className="h-4 w-4 mr-2" />
            New Model
          </Button>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Total Models</div>
            <div className="text-2xl font-bold">{models.length}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Active Models</div>
            <div className="text-2xl font-bold text-green-600">
              {models.filter(m => m.isActive).length}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Loaded in Memory</div>
            <div className="text-2xl font-bold text-blue-600">
              {loadedModels.length}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Training Jobs</div>
            <div className="flex items-center gap-2">
              {hasActiveJobs ? (
                <>
                  <ArrowPathIcon className="h-5 w-5 text-blue-500 animate-spin" />
                  <span className="text-lg font-medium text-blue-600">
                    {jobs.filter(j => j.status === 'RUNNING' || j.status === 'PENDING').length} active
                  </span>
                </>
              ) : (
                <span className="text-lg font-medium text-gray-600">Idle</span>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Active/Recent Training Jobs */}
      {recentJobs.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <PlayIcon className="h-5 w-5" />
                Recent Training Jobs
              </CardTitle>
              {hasActiveJobs && (
                <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                  <ArrowPathIcon className="h-3 w-3 animate-spin" />
                  Auto-refreshing
                </span>
              )}
            </div>
          </CardHeader>
          <CardBody>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentJobs.map((job) => {
                  // Try to find the model this job is for
                  const modelForJob = models.find(m =>
                    job.jobName?.includes(m.slug) || job.id === m.id
                  );

                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {statusIcons[job.status]}
                          <span className={`px-2 py-0.5 text-xs rounded ${statusColors[job.status]}`}>
                            {job.status}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {modelForJob ? (
                          <Link href={`/ml-models/${modelForJob.id}`} className="text-indigo-600 hover:text-indigo-800">
                            {modelForJob.name}
                          </Link>
                        ) : (
                          <span className="text-gray-500">{job.jobName || 'Unknown'}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="w-24">
                          <div className="bg-gray-200 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-300 ${
                                job.status === 'FAILED' ? 'bg-red-500' :
                                job.status === 'COMPLETED' ? 'bg-green-500' : 'bg-indigo-600'
                              }`}
                              style={{ width: `${job.progressPercent}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">{job.progressPercent}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500 max-w-xs truncate">
                        {job.statusMessage || '-'}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {formatDate(job.startedAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {job.modelVersion || '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex items-center gap-4">
            <FunnelIcon className="h-5 w-5 text-gray-400" />
            <select
              value={activeFilter === undefined ? '' : activeFilter.toString()}
              onChange={(e) => setActiveFilter(e.target.value === '' ? undefined : e.target.value === 'true')}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
            <Button variant="ghost" size="sm" onClick={() => { refetch(); refetchJobs(); }}>
              Refresh
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Models</CardTitle>
        </CardHeader>
        <CardBody>
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">
              <p>Error loading models: {error.message}</p>
              <Button variant="ghost" size="sm" onClick={() => refetch()} className="mt-2">
                Retry
              </Button>
            </div>
          ) : models.length === 0 ? (
            <EmptyState
              title="No models found"
              icon={<CpuChipIcon className="h-12 w-12" />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Filter Criteria</TableHead>
                  <TableHead>Training Data</TableHead>
                  <TableHead>Active Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {model.name}
                        {model.isDefault && (
                          <span className="px-1.5 py-0.5 text-xs bg-indigo-100 text-indigo-800 rounded">
                            Default
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500 font-mono">
                      {model.slug}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {model.filterCriteria?.conditionCodePrefixes?.slice(0, 2).map((prefix) => (
                          <span key={prefix} className="px-1.5 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                            {prefix}*
                          </span>
                        ))}
                        {model.filterCriteria?.trainingTags?.slice(0, 2).map((tag) => (
                          <span key={tag} className="px-1.5 py-0.5 text-xs bg-purple-50 text-purple-700 rounded">
                            #{tag}
                          </span>
                        ))}
                        {!model.filterCriteria?.conditionCodePrefixes?.length &&
                         !model.filterCriteria?.trainingTags?.length && (
                          <span className="text-xs text-gray-400">Manual only</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {model.trainingDataCount} examples
                      </span>
                    </TableCell>
                    <TableCell>
                      {model.activeVersion ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono">{model.activeVersion.version}</span>
                          {loadedModelIds.has(model.id) && (
                            <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-800 rounded">
                              Loaded
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">No version</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 text-xs rounded ${model.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                        {model.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Link href={`/ml-models/${model.id}`}>
                          <Button variant="ghost" size="sm">View</Button>
                        </Link>
                        <Link href={`/ml-models/${model.id}/edit`}>
                          <Button variant="ghost" size="sm">Edit</Button>
                        </Link>
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
