'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  useVariantGroups,
  useSelectionRules,
  useAnalyticsSummary,
} from '@/lib/hooks/useRecommendationEngine';

export default function RecommendationEnginePage() {
  const { groups, loading: groupsLoading } = useVariantGroups();
  const { rules, loading: rulesLoading } = useSelectionRules();
  const { summary, loading: analyticsLoading } = useAnalyticsSummary(7);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Recommendation Engine</h1>
        <p className="mt-1 text-sm text-gray-600">
          Three-layer recommendation system: Primary Matching → Variant Selection → Personalization
        </p>
      </div>

      {/* Architecture Overview */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Architecture</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-sm font-bold">1</span>
              <h3 className="font-semibold text-blue-900">Primary Matching</h3>
            </div>
            <p className="text-sm text-blue-700">
              Finds care plans through condition code matching and embedding similarity search.
            </p>
          </div>
          <div className="border rounded-lg p-4 bg-green-50 border-green-200">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-sm font-bold">2</span>
              <h3 className="font-semibold text-green-900">Variant Selection</h3>
            </div>
            <p className="text-sm text-green-700">
              Selects best variant using targeting criteria and configurable rules.
            </p>
          </div>
          <div className="border rounded-lg p-4 bg-purple-50 border-purple-200">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-sm font-bold">3</span>
              <h3 className="font-semibold text-purple-900">Personalization</h3>
            </div>
            <p className="text-sm text-purple-700">
              Enhances with Decision Explorer pathways, RAG synthesis, and outcome learning.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500">Variant Groups</div>
          <div className="mt-1 text-3xl font-bold text-gray-900">
            {groupsLoading ? '...' : groups.length}
          </div>
          <Link
            href="/recommendation-engine/variant-groups"
            className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-800"
          >
            Manage groups →
          </Link>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500">Selection Rules</div>
          <div className="mt-1 text-3xl font-bold text-gray-900">
            {rulesLoading ? '...' : rules.length}
          </div>
          <Link
            href="/recommendation-engine/selection-rules"
            className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-800"
          >
            Manage rules →
          </Link>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500">Sessions (7d)</div>
          <div className="mt-1 text-3xl font-bold text-gray-900">
            {analyticsLoading ? '...' : summary?.totalSessions || 0}
          </div>
          <Link
            href="/recommendation-engine/analytics"
            className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-800"
          >
            View analytics →
          </Link>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500">Avg Processing Time</div>
          <div className="mt-1 text-3xl font-bold text-gray-900">
            {analyticsLoading
              ? '...'
              : summary?.averageProcessingTimeMs
              ? `${summary.averageProcessingTimeMs.toFixed(0)}ms`
              : 'N/A'}
          </div>
          <span className="mt-2 inline-block text-sm text-gray-400">
            All layers combined
          </span>
        </div>
      </div>

      {/* Management Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Variant Groups */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Variant Groups</h2>
            <Link
              href="/recommendation-engine/variant-groups/new"
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              + New Group
            </Link>
          </div>
          <div className="divide-y divide-gray-200">
            {groupsLoading ? (
              <div className="p-6 text-center text-gray-500">Loading...</div>
            ) : groups.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No variant groups defined yet.
                <br />
                <Link
                  href="/recommendation-engine/variant-groups/new"
                  className="text-blue-600 hover:text-blue-800"
                >
                  Create your first group
                </Link>
              </div>
            ) : (
              groups.slice(0, 5).map((group) => (
                <Link
                  key={group.id}
                  href={`/recommendation-engine/variant-groups/${group.id}`}
                  className="block px-6 py-4 hover:bg-gray-50"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium text-gray-900">{group.name}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {group.conditionCodes.slice(0, 3).join(', ')}
                        {group.conditionCodes.length > 3 && ` +${group.conditionCodes.length - 3} more`}
                      </div>
                    </div>
                    <div className="text-sm text-gray-500">
                      {group.variants.length} variant{group.variants.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
          {groups.length > 5 && (
            <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
              <Link
                href="/recommendation-engine/variant-groups"
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                View all {groups.length} groups →
              </Link>
            </div>
          )}
        </div>

        {/* Selection Rules */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Selection Rules</h2>
            <Link
              href="/recommendation-engine/selection-rules/new"
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              + New Rule
            </Link>
          </div>
          <div className="divide-y divide-gray-200">
            {rulesLoading ? (
              <div className="p-6 text-center text-gray-500">Loading...</div>
            ) : rules.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No selection rules defined yet.
                <br />
                <Link
                  href="/recommendation-engine/selection-rules/new"
                  className="text-blue-600 hover:text-blue-800"
                >
                  Create your first rule
                </Link>
              </div>
            ) : (
              rules.slice(0, 5).map((rule) => (
                <div
                  key={rule.id}
                  className="px-6 py-4 hover:bg-gray-50"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium text-gray-900">{rule.name}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {rule.variantGroupId ? 'Group-specific' : 'Global rule'} • Priority: {rule.priority}
                      </div>
                    </div>
                    <div className={`text-sm px-2 py-1 rounded ${
                      rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {rules.length > 5 && (
            <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
              <Link
                href="/recommendation-engine/selection-rules"
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                View all {rules.length} rules →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Test Section */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Test Recommendations</h2>
        <p className="text-sm text-gray-600 mb-4">
          Test the recommendation engine with sample patient data to see how the three layers work together.
        </p>
        <Link
          href="/recommendation-engine/test"
          className="inline-flex items-center px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800"
        >
          Open Test Console
        </Link>
      </div>
    </div>
  );
}
