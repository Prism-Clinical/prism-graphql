'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useVariantGroups } from '@/lib/hooks/useRecommendationEngine';

export default function VariantGroupsPage() {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [conditionFilter, setConditionFilter] = useState('');
  const { groups, loading, error, refetch } = useVariantGroups();

  // Client-side filtering for inactive status and condition code search
  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      // Filter by active status
      if (!includeInactive && !group.isActive) {
        return false;
      }
      // Filter by condition code search
      if (conditionFilter) {
        const searchLower = conditionFilter.toLowerCase();
        const matchesCode = group.conditionCodes.some((code: string) =>
          code.toLowerCase().includes(searchLower)
        );
        const matchesName = group.name.toLowerCase().includes(searchLower);
        if (!matchesCode && !matchesName) {
          return false;
        }
      }
      return true;
    });
  }, [groups, includeInactive, conditionFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <Link href="/recommendation-engine" className="hover:text-gray-700">
              Recommendation Engine
            </Link>
            <span>/</span>
            <span>Variant Groups</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Variant Groups</h1>
          <p className="mt-1 text-sm text-gray-600">
            Group care plans that address the same condition with different patient-specific variants.
          </p>
        </div>
        <Link
          href="/recommendation-engine/variant-groups/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Create Group
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search by name or condition code..."
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show inactive groups
          </label>
          <span className="text-sm text-gray-500">
            {filteredGroups.length} of {groups.length} groups
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Error loading variant groups: {error.message}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-gray-500">Loading variant groups...</div>
      )}

      {/* Empty State */}
      {!loading && filteredGroups.length === 0 && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-gray-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Variant Groups</h3>
          <p className="text-gray-500 mb-4">
            Create variant groups to organize care plans that treat the same condition but target different patient populations.
          </p>
          <Link
            href="/recommendation-engine/variant-groups/new"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create First Group
          </Link>
        </div>
      )}

      {/* Groups List */}
      {!loading && filteredGroups.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Group
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Condition Codes
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Variants
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredGroups.map((group) => (
                <tr key={group.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{group.name}</div>
                    <div className="text-sm text-gray-500">{group.id.slice(0, 8)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {group.conditionCodes.slice(0, 4).map((code: string) => (
                        <span
                          key={code}
                          className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded"
                        >
                          {code}
                        </span>
                      ))}
                      {group.conditionCodes.length > 4 && (
                        <span className="px-2 py-1 text-xs text-gray-500">
                          +{group.conditionCodes.length - 4} more
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">
                      {group.variants.length} variant{group.variants.length !== 1 ? 's' : ''}
                    </div>
                    {group.variants.length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        {group.variants.slice(0, 2).map((v: { variantName: string }) => v.variantName).join(', ')}
                        {group.variants.length > 2 && '...'}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded ${
                      group.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {group.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/recommendation-engine/variant-groups/${group.id}`}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Help Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">How Variant Groups Work</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• <strong>Variant groups</strong> contain care plans that treat the same condition</li>
          <li>• Each <strong>variant</strong> targets a specific patient population (e.g., pediatric, elderly)</li>
          <li>• <strong>Targeting criteria</strong> define which patients each variant is best for</li>
          <li>• The recommendation engine automatically selects the best variant based on patient context</li>
        </ul>
      </div>
    </div>
  );
}
