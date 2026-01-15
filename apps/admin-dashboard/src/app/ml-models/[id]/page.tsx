'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  PencilIcon,
  PlayIcon,
  TrashIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  ClockIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  DocumentDuplicateIcon,
  FunnelIcon,
  SparklesIcon,
  CircleStackIcon,
  AcademicCapIcon,
  BeakerIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Spinner } from '@/components/ui/Spinner';
import {
  useMLModel,
  useMLModelVersions,
  useMLModelTrainingData,
  useMLModelTrainingPreview,
  useTrainModel,
  useSetActiveVersion,
  useLoadModel,
  useUnloadModel,
  useDeleteMLModel,
  useLoadedModels,
} from '@/lib/hooks/useMLModels';
import { useTrainingJobs, TrainingJob } from '@/lib/hooks/useMLTraining';

const ML_SERVICE_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL || 'http://localhost:8084';

// Training data source types
type TrainingDataSource = 'all_care_plans' | 'filter_criteria' | 'manual' | 'studies' | 'ehr_data';

const trainingDataSources: { value: TrainingDataSource; label: string; description: string; icon: React.ReactNode; available: boolean }[] = [
  {
    value: 'all_care_plans',
    label: 'All Care Plans',
    description: 'Use all care plan templates with embeddings in the database',
    icon: <DocumentDuplicateIcon className="h-5 w-5" />,
    available: true,
  },
  {
    value: 'filter_criteria',
    label: 'Filter by Criteria',
    description: 'Filter care plans by condition codes, tags, or categories',
    icon: <FunnelIcon className="h-5 w-5" />,
    available: true,
  },
  {
    value: 'manual',
    label: 'Manual Selection',
    description: 'Manually assign specific care plans for training',
    icon: <SparklesIcon className="h-5 w-5" />,
    available: true,
  },
  {
    value: 'studies',
    label: 'Clinical Studies',
    description: 'Train from published clinical study data',
    icon: <AcademicCapIcon className="h-5 w-5" />,
    available: false,
  },
  {
    value: 'ehr_data',
    label: 'EHR Data',
    description: 'Train from anonymized EHR outcome data',
    icon: <CircleStackIcon className="h-5 w-5" />,
    available: false,
  },
];

const statusIcons: Record<string, React.ReactNode> = {
  PENDING: <ClockIcon className="h-5 w-5 text-gray-500" />,
  RUNNING: <ArrowPathIcon className="h-5 w-5 text-blue-500 animate-spin" />,
  COMPLETED: <CheckCircleIcon className="h-5 w-5 text-green-500" />,
  FAILED: <XCircleIcon className="h-5 w-5 text-red-500" />,
  CANCELLED: <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />,
};

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  RUNNING: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-yellow-100 text-yellow-800',
};

export default function MLModelDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'training' | 'versions' | 'test'>('training');
  const [isPolling, setIsPolling] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);

  // Training configuration state
  const [selectedDataSource, setSelectedDataSource] = useState<TrainingDataSource>('all_care_plans');
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [trainingStats, setTrainingStats] = useState<{
    totalCarePlans: number;
    withEmbeddings: number;
    loading: boolean;
  }>({ totalCarePlans: 0, withEmbeddings: 0, loading: true });

  // Model testing state
  const [testConditionCodes, setTestConditionCodes] = useState('');
  const [testResults, setTestResults] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const { model, loading, error, refetch } = useMLModel(id);
  const { versions, refetch: refetchVersions } = useMLModelVersions(id);
  const { trainingData, refetch: refetchTrainingData } = useMLModelTrainingData(id);
  const { preview, refetch: refetchPreview } = useMLModelTrainingPreview(id);
  const { loadedModels, refetch: refetchLoaded } = useLoadedModels();
  const { jobs, refetch: refetchJobs } = useTrainingJobs({ first: 10 });

  const { train, loading: trainingLoading, error: trainError } = useTrainModel();
  const { setActive, loading: setActiveLoading } = useSetActiveVersion();
  const { load, loading: loadingModel } = useLoadModel();
  const { unload, loading: unloadingModel } = useUnloadModel();
  const { deleteModel, loading: deletingModel } = useDeleteMLModel();

  const isLoaded = loadedModels.some(m => m.modelId === id);
  const loadedModelInfo = loadedModels.find(m => m.modelId === id);

  // Filter jobs for this model
  const modelJobs = jobs.filter(job =>
    job.jobName?.includes(model?.slug || '') ||
    job.id === id
  ).slice(0, 5);

  // Check for active jobs
  const hasActiveJobs = modelJobs.some(job => job.status === 'RUNNING' || job.status === 'PENDING');
  const shouldPoll = hasActiveJobs || isPolling;

  // Fetch training statistics
  const fetchTrainingStats = useCallback(async () => {
    try {
      setTrainingStats(prev => ({ ...prev, loading: true }));
      const response = await fetch(`${ML_SERVICE_URL}/stats`);
      if (response.ok) {
        const data = await response.json();
        setTrainingStats({
          totalCarePlans: data.total_templates || 0,
          withEmbeddings: data.embeddings_generated || 0,
          loading: false,
        });
      }
    } catch (err) {
      console.error('Failed to fetch training stats:', err);
      setTrainingStats(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchTrainingStats();
  }, [fetchTrainingStats]);

  // Determine data source from model config
  useEffect(() => {
    if (model) {
      if (trainingData.length > 0) {
        setSelectedDataSource('manual');
      } else if (model.filterCriteria && (
        model.filterCriteria.conditionCodePrefixes?.length ||
        model.filterCriteria.conditionCodes?.length ||
        model.filterCriteria.trainingTags?.length ||
        model.filterCriteria.categories?.length
      )) {
        setSelectedDataSource('filter_criteria');
      } else {
        setSelectedDataSource('all_care_plans');
      }
    }
  }, [model, trainingData]);

  // Polling for training progress
  const refetchFnsRef = useRef({ refetchJobs, refetchVersions, refetch, refetchPreview });
  refetchFnsRef.current = { refetchJobs, refetchVersions, refetch, refetchPreview };

  useEffect(() => {
    if (!shouldPoll) return;

    const interval = setInterval(async () => {
      const { refetchJobs, refetchVersions, refetch, refetchPreview } = refetchFnsRef.current;
      await Promise.all([refetchJobs(), refetchVersions(), refetch(), refetchPreview()]);
    }, 2000);

    return () => clearInterval(interval);
  }, [shouldPoll]);

  // Stop polling when jobs complete
  useEffect(() => {
    if (isPolling && !hasActiveJobs && modelJobs.length > 0) {
      const timeout = setTimeout(() => setIsPolling(false), 1000);
      return () => clearTimeout(timeout);
    }
  }, [isPolling, hasActiveJobs, modelJobs.length]);

  const handleTrain = async () => {
    if (!model) return;
    setTrainingError(null);

    try {
      setIsPolling(true);
      setShowTrainingModal(false);

      // Call the ML service directly for better error handling
      const response = await fetch(`${ML_SERVICE_URL}/models/${id}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_name: `${model.slug}-${new Date().toISOString().split('T')[0]}`,
          include_validation_outcomes: true,
          use_all_care_plans: selectedDataSource === 'all_care_plans',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Training failed: ${response.status}`);
      }

      await refetchJobs();
      await refetchPreview();
    } catch (err) {
      setIsPolling(false);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTrainingError(message);
      console.error('Training error:', err);
    }
  };

  const handleSetActive = async (versionId: string) => {
    try {
      await setActive({ versionId });
      refetch();
      refetchVersions();
    } catch (err) {
      alert(`Failed to set active version: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleLoadModel = async () => {
    try {
      await load({ modelId: id });
      refetchLoaded();
    } catch (err) {
      alert(`Failed to load model: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleUnloadModel = async () => {
    try {
      await unload(id);
      refetchLoaded();
    } catch (err) {
      alert(`Failed to unload model: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this model? This cannot be undone.')) return;
    try {
      await deleteModel(id);
      router.push('/ml-models');
    } catch (err) {
      alert(`Failed to delete model: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleTestModel = async () => {
    if (!testConditionCodes.trim()) {
      setTestError('Please enter at least one condition code');
      return;
    }

    setIsTesting(true);
    setTestError(null);
    setTestResults(null);

    try {
      const codes = testConditionCodes.split(',').map(c => c.trim()).filter(Boolean);
      const endpoint = model?.slug
        ? `${ML_SERVICE_URL}/recommend/model/${model.slug}`
        : `${ML_SERVICE_URL}/recommend/simple`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condition_codes: codes,
          max_results: 5,
          include_drafts: false,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to get recommendations');
      }

      const data = await response.json();
      setTestResults(data);
    } catch (error) {
      setTestError(error instanceof Error ? error.message : 'Failed to test model');
    } finally {
      setIsTesting(false);
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  // Get effective training data count
  const getEffectiveTrainingCount = () => {
    if (selectedDataSource === 'all_care_plans') {
      return trainingStats.withEmbeddings;
    } else if (selectedDataSource === 'filter_criteria') {
      return preview?.totalExamples || 0;
    } else if (selectedDataSource === 'manual') {
      return trainingData.length;
    }
    return 0;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Error loading model: {error?.message || 'Not found'}</p>
        <Link href="/ml-models">
          <Button variant="ghost" className="mt-4">
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back to Models
          </Button>
        </Link>
      </div>
    );
  }

  const activeJob = modelJobs.find(j => j.status === 'RUNNING' || j.status === 'PENDING');
  const effectiveTrainingCount = getEffectiveTrainingCount();

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/ml-models">
            <Button variant="ghost" size="sm">
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{model.name}</h1>
              {model.isDefault && (
                <span className="px-2 py-1 text-xs bg-indigo-100 text-indigo-800 rounded">
                  Default
                </span>
              )}
              <span className={`px-2 py-1 text-xs rounded ${model.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                {model.isActive ? 'Active' : 'Inactive'}
              </span>
              {isLoaded && (
                <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                  Loaded
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 font-mono">{model.slug}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/ml-models/${id}/edit`}>
            <Button variant="secondary">
              <PencilIcon className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </Link>
          {isLoaded ? (
            <Button variant="secondary" onClick={handleUnloadModel} disabled={unloadingModel}>
              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
              Unload
            </Button>
          ) : (
            <Button variant="secondary" onClick={handleLoadModel} disabled={loadingModel || !model.activeVersion}>
              <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
              Load
            </Button>
          )}
        </div>
      </div>

      {/* Training Progress Banner */}
      {activeJob && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ArrowPathIcon className="h-5 w-5 text-blue-500 animate-spin" />
              <span className="font-medium text-blue-900">Training in Progress</span>
              <span className="text-sm text-blue-600">{activeJob.statusMessage || 'Processing...'}</span>
            </div>
            <span className="text-sm font-medium text-blue-700">{activeJob.progressPercent}%</span>
          </div>
          <div className="bg-blue-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${activeJob.progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Training Error Banner */}
      {trainingError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <XCircleIcon className="h-5 w-5 text-red-500" />
            <span className="font-medium text-red-900">Training Failed</span>
          </div>
          <p className="mt-1 text-sm text-red-700">{trainingError}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-red-600"
            onClick={() => setTrainingError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Description */}
      {model.description && (
        <Card className="mb-6">
          <CardBody>
            <p className="text-gray-600">{model.description}</p>
          </CardBody>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Versions</div>
            <div className="text-2xl font-bold">{versions.length}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Training Data</div>
            <div className="text-2xl font-bold">{effectiveTrainingCount}</div>
            <div className="text-xs text-gray-400">
              {selectedDataSource === 'all_care_plans' ? 'All care plans' :
               selectedDataSource === 'filter_criteria' ? 'Filtered' : 'Manual'}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">With Embeddings</div>
            <div className="text-2xl font-bold text-green-600">
              {selectedDataSource === 'all_care_plans'
                ? trainingStats.withEmbeddings
                : preview?.withEmbeddings || 0}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Active Version</div>
            <div className="text-lg font-medium font-mono">
              {model.activeVersion?.version || 'None'}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-6">
          <button
            onClick={() => setActiveTab('training')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'training'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Training
          </button>
          <button
            onClick={() => setActiveTab('versions')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'versions'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Versions ({versions.length})
          </button>
          <button
            onClick={() => setActiveTab('test')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'test'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Test Model
          </button>
        </nav>
      </div>

      {/* Training Tab */}
      {activeTab === 'training' && (
        <div className="space-y-6">
          {/* Training Data Source Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Training Data Source</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-gray-500 mb-4">
                Select where training data should come from. By default, all care plan templates with embeddings will be used.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {trainingDataSources.map((source) => (
                  <button
                    key={source.value}
                    onClick={() => source.available && setSelectedDataSource(source.value)}
                    disabled={!source.available}
                    className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                      selectedDataSource === source.value
                        ? 'border-indigo-500 bg-indigo-50'
                        : source.available
                        ? 'border-gray-200 hover:border-gray-300 bg-white'
                        : 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    {!source.available && (
                      <span className="absolute top-2 right-2 text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                        Coming Soon
                      </span>
                    )}
                    <div className={`mb-2 ${selectedDataSource === source.value ? 'text-indigo-600' : 'text-gray-400'}`}>
                      {source.icon}
                    </div>
                    <div className="font-medium text-sm text-gray-900">{source.label}</div>
                    <div className="text-xs text-gray-500 mt-1">{source.description}</div>
                  </button>
                ))}
              </div>

              {/* Data source details */}
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                {selectedDataSource === 'all_care_plans' && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <InformationCircleIcon className="h-5 w-5 text-blue-500" />
                      <span className="font-medium text-gray-900">Using All Care Plans</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">
                      Training will use all {trainingStats.withEmbeddings} care plan templates that have embeddings generated.
                      This is the recommended approach for comprehensive model training.
                    </p>
                    <div className="flex gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Total templates:</span>{' '}
                        <span className="font-medium">{trainingStats.totalCarePlans}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">With embeddings:</span>{' '}
                        <span className="font-medium text-green-600">{trainingStats.withEmbeddings}</span>
                      </div>
                    </div>
                  </div>
                )}

                {selectedDataSource === 'filter_criteria' && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <FunnelIcon className="h-5 w-5 text-purple-500" />
                      <span className="font-medium text-gray-900">Filtered Training Data</span>
                    </div>
                    {model.filterCriteria && (
                      <>
                        <p className="text-sm text-gray-600 mb-3">
                          Training will use care plans matching the configured filter criteria.
                        </p>
                        <div className="space-y-2">
                          {model.filterCriteria.conditionCodePrefixes?.length > 0 && (
                            <div className="text-sm">
                              <span className="text-gray-500">Condition prefixes:</span>{' '}
                              {model.filterCriteria.conditionCodePrefixes.map(p => (
                                <span key={p} className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 rounded mr-1">{p}*</span>
                              ))}
                            </div>
                          )}
                          {model.filterCriteria.trainingTags?.length > 0 && (
                            <div className="text-sm">
                              <span className="text-gray-500">Tags:</span>{' '}
                              {model.filterCriteria.trainingTags.map(t => (
                                <span key={t} className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 rounded mr-1">#{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="mt-3 text-sm">
                          <span className="text-gray-500">Matching care plans:</span>{' '}
                          <span className="font-medium">{preview?.totalExamples || 0}</span>
                        </div>
                      </>
                    )}
                    {!model.filterCriteria && (
                      <p className="text-sm text-yellow-600">
                        No filter criteria configured. <Link href={`/ml-models/${id}/edit`} className="underline">Edit model</Link> to add filters.
                      </p>
                    )}
                  </div>
                )}

                {selectedDataSource === 'manual' && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <SparklesIcon className="h-5 w-5 text-amber-500" />
                      <span className="font-medium text-gray-900">Manually Selected Training Data</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">
                      Training will use {trainingData.length} manually assigned care plans.
                    </p>
                    {trainingData.length === 0 && (
                      <p className="text-sm text-yellow-600">
                        No care plans manually assigned. Use the Training Examples page to assign specific care plans.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Train Model Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Start Training</CardTitle>
                {shouldPoll && (
                  <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                    <ArrowPathIcon className="h-3 w-3 animate-spin" />
                    Auto-refreshing
                  </span>
                )}
              </div>
            </CardHeader>
            <CardBody>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-2">
                    Train the model using {effectiveTrainingCount} care plan{effectiveTrainingCount !== 1 ? 's' : ''} with embeddings.
                  </p>
                  {effectiveTrainingCount === 0 && (
                    <p className="text-sm text-yellow-600">
                      <ExclamationTriangleIcon className="h-4 w-4 inline mr-1" />
                      No training data available. Generate embeddings first or select a different data source.
                    </p>
                  )}
                </div>
                <Button
                  onClick={handleTrain}
                  disabled={trainingLoading || hasActiveJobs || effectiveTrainingCount === 0}
                  className="min-w-[140px]"
                >
                  {trainingLoading || hasActiveJobs ? (
                    <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <PlayIcon className="h-4 w-4 mr-2" />
                  )}
                  {trainingLoading ? 'Starting...' : hasActiveJobs ? 'Training...' : 'Train Model'}
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Recent Training Jobs */}
          {modelJobs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Training Jobs</CardTitle>
              </CardHeader>
              <CardBody>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead>Version</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modelJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {statusIcons[job.status]}
                            <span className={`px-2 py-1 text-xs rounded ${statusColors[job.status]}`}>
                              {job.status}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="w-24">
                            <div className="bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all duration-300 ${
                                  job.status === 'FAILED' ? 'bg-red-500' :
                                  job.status === 'COMPLETED' ? 'bg-green-500' : 'bg-indigo-600'
                                }`}
                                style={{ width: `${job.progressPercent}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{job.progressPercent}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {formatDate(job.startedAt)}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {formatDate(job.completedAt)}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {job.modelVersion || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* Versions Tab */}
      {activeTab === 'versions' && (
        <Card>
          <CardHeader>
            <CardTitle>Model Versions</CardTitle>
          </CardHeader>
          <CardBody>
            {versions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No versions yet. Train the model to create the first version.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Metrics</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map((version) => (
                    <TableRow key={version.id}>
                      <TableCell className="font-mono font-medium">
                        {version.version}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {new Date(version.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {version.metrics ? (
                          <div className="text-sm">
                            {version.metrics.accuracy && (
                              <span className="mr-3">Accuracy: {(version.metrics.accuracy * 100).toFixed(1)}%</span>
                            )}
                            {version.metrics.mean_similarity && (
                              <span>Similarity: {(version.metrics.mean_similarity * 100).toFixed(1)}%</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">No metrics</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {version.isActive && (
                            <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
                              Active
                            </span>
                          )}
                          {version.isDefault && (
                            <span className="px-2 py-1 text-xs bg-indigo-100 text-indigo-800 rounded">
                              Default
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {!version.isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSetActive(version.id)}
                            disabled={setActiveLoading}
                          >
                            <CheckCircleIcon className="h-4 w-4 mr-1" />
                            Set Active
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* Test Tab */}
      {activeTab === 'test' && (
        <Card>
          <CardHeader>
            <CardTitle>Test Model Recommendations</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Condition Codes (comma-separated)
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={testConditionCodes}
                    onChange={(e) => setTestConditionCodes(e.target.value)}
                    placeholder="e.g., J02.0, 43878008"
                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <Button onClick={handleTestModel} disabled={isTesting || !isLoaded}>
                    {isTesting ? (
                      <>
                        <Spinner size="sm" className="mr-2" />
                        Testing...
                      </>
                    ) : (
                      'Get Recommendations'
                    )}
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Enter ICD-10 or SNOMED codes to test the recommendation model
                </p>
              </div>

              {!isLoaded && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
                  <ExclamationTriangleIcon className="h-4 w-4 inline mr-1" />
                  Model is not loaded. Load the model to test recommendations.
                </div>
              )}

              {testError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <XCircleIcon className="h-4 w-4 inline mr-1" />
                  {testError}
                </div>
              )}

              {testResults && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">
                        Results ({testResults.templates?.length || 0} templates found)
                      </span>
                      <span className="text-xs text-gray-500">
                        {testResults.processing_time_ms?.toFixed(0)}ms | Model: {testResults.model_version}
                      </span>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {testResults.templates?.length === 0 ? (
                      <div className="px-4 py-8 text-center text-gray-500">
                        No matching templates found
                      </div>
                    ) : (
                      testResults.templates?.map((template: any, index: number) => (
                        <div key={template.id || index} className="px-4 py-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium text-gray-900">{template.name}</p>
                              <p className="text-sm text-gray-500">{template.category}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium text-indigo-600">
                                {(template.similarity_score * 100).toFixed(1)}% match
                              </p>
                              {template.ranking_score && (
                                <p className="text-xs text-gray-500">
                                  Rank score: {template.ranking_score.toFixed(3)}
                                </p>
                              )}
                            </div>
                          </div>
                          {template.condition_codes && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {template.condition_codes.map((code: string) => (
                                <span
                                  key={code}
                                  className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded"
                                >
                                  {code}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Delete Button */}
      <div className="mt-8 pt-6 border-t border-gray-200">
        <Button
          variant="danger"
          onClick={handleDelete}
          disabled={deletingModel}
        >
          <TrashIcon className="h-4 w-4 mr-2" />
          {deletingModel ? 'Deleting...' : 'Delete Model'}
        </Button>
      </div>
    </div>
  );
}
