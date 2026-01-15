'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  DocumentDuplicateIcon,
  ChevronDownIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/Table';
import {
  usePathways,
  useDeletePathway,
  usePublishPathway,
  ClinicalPathway,
} from '@/lib/hooks/usePathways';

export default function PathwaysListPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPublished, setFilterPublished] = useState<boolean | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);

  const { pathways, loading, error, refetch } = usePathways({
    isActive: true,
    isPublished: filterPublished ?? undefined,
  });

  const { deletePathway, loading: deleteLoading } = useDeletePathway();
  const { publish, unpublish, loading: publishLoading } = usePublishPathway();

  const filteredPathways = pathways.filter((pathway) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      pathway.name.toLowerCase().includes(term) ||
      pathway.slug.toLowerCase().includes(term) ||
      pathway.description?.toLowerCase().includes(term) ||
      pathway.primaryConditionCodes.some((code) => code.toLowerCase().includes(term))
    );
  });

  const handleDelete = async (id: string) => {
    try {
      await deletePathway(id);
      setShowDeleteModal(null);
      refetch();
    } catch (err) {
      console.error('Failed to delete pathway:', err);
    }
  };

  const handlePublishToggle = async (pathway: ClinicalPathway) => {
    try {
      if (pathway.isPublished) {
        await unpublish(pathway.id);
      } else {
        await publish(pathway.id);
      }
      refetch();
    } catch (err) {
      console.error('Failed to update pathway:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-8">
            <p className="text-red-500 mb-4">Failed to load pathways: {error.message}</p>
            <Button onClick={() => refetch()}>Retry</Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Clinical Pathways
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage decision tree pathways for clinical guidance
          </p>
        </div>
        <Link href="/decision-explorer/pathways/new">
          <Button>
            <PlusIcon className="h-5 w-5 mr-2" />
            New Pathway
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="py-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px] max-w-md">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  placeholder="Search pathways..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">Status:</span>
              <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button
                  onClick={() => setFilterPublished(null)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    filterPublished === null
                      ? 'bg-primary-500 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilterPublished(true)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-200 dark:border-gray-700 ${
                    filterPublished === true
                      ? 'bg-primary-500 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  Published
                </button>
                <button
                  onClick={() => setFilterPublished(false)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-200 dark:border-gray-700 ${
                    filterPublished === false
                      ? 'bg-primary-500 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  Drafts
                </button>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Pathways Table */}
      <Card>
        <CardBody className="p-0">
          {filteredPathways.length === 0 ? (
            <div className="text-center py-12">
              <DocumentDuplicateIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                {searchTerm || filterPublished !== null
                  ? 'No pathways match your filters'
                  : 'No pathways yet'}
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                {searchTerm || filterPublished !== null
                  ? 'Try adjusting your search or filters'
                  : 'Create your first clinical pathway to get started'}
              </p>
              {!searchTerm && filterPublished === null && (
                <Link href="/decision-explorer/pathways/new">
                  <Button>
                    <PlusIcon className="h-5 w-5 mr-2" />
                    Create Pathway
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Conditions</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPathways.map((pathway) => (
                  <TableRow key={pathway.id}>
                    <TableCell>
                      <div>
                        <Link
                          href={`/decision-explorer/pathways/${pathway.id}`}
                          className="font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
                        >
                          {pathway.name}
                        </Link>
                        {pathway.description && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-md">
                            {pathway.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {pathway.primaryConditionCodes.slice(0, 3).map((code) => (
                          <span
                            key={code}
                            className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                          >
                            {code}
                          </span>
                        ))}
                        {pathway.primaryConditionCodes.length > 3 && (
                          <span className="px-2 py-0.5 text-xs text-gray-500">
                            +{pathway.primaryConditionCodes.length - 3}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600 dark:text-gray-300">
                        v{pathway.version}
                      </span>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => handlePublishToggle(pathway)}
                        disabled={publishLoading}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                          pathway.isPublished
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-200'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-200'
                        }`}
                      >
                        {pathway.isPublished ? (
                          <>
                            <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />
                            Published
                          </>
                        ) : (
                          <>
                            <XCircleIcon className="h-3.5 w-3.5 mr-1" />
                            Draft
                          </>
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      {pathway.evidenceGrade ? (
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${
                            pathway.evidenceGrade === 'A'
                              ? 'bg-green-100 text-green-800'
                              : pathway.evidenceGrade === 'B'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          Grade {pathway.evidenceGrade}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/decision-explorer?pathway=${pathway.id}`}>
                          <Button variant="ghost" size="sm" title="View in Explorer">
                            <EyeIcon className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Link href={`/decision-explorer/pathways/${pathway.id}`}>
                          <Button variant="ghost" size="sm" title="Edit">
                            <PencilSquareIcon className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete"
                          onClick={() => setShowDeleteModal(pathway.id)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <TrashIcon className="h-4 w-4" />
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

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowDeleteModal(null)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Delete Pathway
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Are you sure you want to delete this pathway? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowDeleteModal(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDelete(showDeleteModal)}
                disabled={deleteLoading}
              >
                {deleteLoading ? <Spinner size="sm" className="mr-2" /> : null}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
