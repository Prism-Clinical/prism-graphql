'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { useState, useMemo } from 'react';
import { StatusBadge } from './StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import type { Pathway, PathwayStatus } from '@/types';

interface PathwayTableProps {
  pathways: Pathway[];
  isLoading: boolean;
}

type SortField = 'title' | 'status' | 'category' | 'version' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

const categoryLabels: Record<string, string> = {
  CHRONIC_DISEASE: 'Chronic Disease',
  ACUTE_CARE: 'Acute Care',
  PREVENTIVE_CARE: 'Preventive Care',
  POST_PROCEDURE: 'Post-Procedure',
  MEDICATION_MANAGEMENT: 'Medication Mgmt',
  LIFESTYLE_MODIFICATION: 'Lifestyle',
  MENTAL_HEALTH: 'Mental Health',
  PEDIATRIC: 'Pediatric',
  GERIATRIC: 'Geriatric',
  OBSTETRIC: 'Obstetric',
};

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PathwayTable({ pathways, isLoading }: PathwayTableProps) {
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [statusFilter, setStatusFilter] = useState<PathwayStatus | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    let result = pathways;
    if (statusFilter !== 'ALL') {
      result = result.filter(p => p.status === statusFilter);
    }
    return result;
  }, [pathways, statusFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'category': cmp = a.category.localeCompare(b.category); break;
        case 'version': cmp = a.version.localeCompare(b.version); break;
        case 'updatedAt': cmp = a.updatedAt.localeCompare(b.updatedAt); break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDirection]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }

  function SortHeader({ field, children }: { field: SortField; children: React.ReactNode }) {
    const isActive = sortField === field;
    return (
      <th
        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none"
        onClick={() => toggleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {isActive && (
            sortDirection === 'asc'
              ? <ChevronUpIcon className="h-3 w-3" />
              : <ChevronDownIcon className="h-3 w-3" />
          )}
        </span>
      </th>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-12">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Spinner />
          <span className="text-sm">Loading pathways...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Filter bar */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <span className="text-sm text-gray-500">Status:</span>
        {(['ALL', 'DRAFT', 'ACTIVE', 'ARCHIVED', 'SUPERSEDED'] as const).map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={clsx(
              'px-3 py-1 rounded-lg text-sm font-medium transition-colors',
              statusFilter === status
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:bg-gray-100'
            )}
          >
            {status === 'ALL' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase()}
          </button>
        ))}
        <span className="ml-auto text-sm text-gray-400">
          {sorted.length} pathway{sorted.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <SortHeader field="title">Title</SortHeader>
              <SortHeader field="status">Status</SortHeader>
              <SortHeader field="category">Category</SortHeader>
              <SortHeader field="version">Version</SortHeader>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Conditions
              </th>
              <SortHeader field="updatedAt">Updated</SortHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-400 text-sm">
                  No pathways found. Upload a pathway JSON to get started.
                </td>
              </tr>
            ) : (
              sorted.map(pathway => (
                <tr key={pathway.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <Link
                      href={`/pathways/${pathway.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors"
                    >
                      {pathway.title}
                    </Link>
                    <div className="text-xs text-gray-400 mt-0.5">{pathway.logicalId}</div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={pathway.status} />
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {categoryLabels[pathway.category] || pathway.category}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-mono">
                    v{pathway.version}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {pathway.conditionCodes.slice(0, 3).map(code => (
                        <span
                          key={code}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-gray-100 text-gray-600"
                        >
                          {code}
                        </span>
                      ))}
                      {pathway.conditionCodes.length > 3 && (
                        <span className="text-xs text-gray-400">
                          +{pathway.conditionCodes.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatDate(pathway.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
