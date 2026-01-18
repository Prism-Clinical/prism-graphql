'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSelectionRules, useDeleteSelectionRule, useVariantGroups } from '@/lib/hooks/useRecommendationEngine';

export default function SelectionRulesPage() {
  const [includeGlobal, setIncludeGlobal] = useState(true);
  // Note: includeGlobal filter not currently implemented in GraphQL - showing all rules
  const { rules, loading, error, refetch } = useSelectionRules();
  const { groups } = useVariantGroups();
  const { deleteRule, loading: deleting } = useDeleteSelectionRule();

  const handleDelete = async (ruleId: string, ruleName: string) => {
    if (!confirm(`Delete rule "${ruleName}"?`)) return;
    try {
      await deleteRule(ruleId);
      refetch();
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const getGroupName = (groupId: string | undefined) => {
    if (!groupId) return 'Global';
    const group = groups.find(g => g.id === groupId);
    return group?.name || 'Unknown Group';
  };

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
            <span>Selection Rules</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Selection Rules</h1>
          <p className="mt-1 text-sm text-gray-600">
            Define rules that influence how variants are selected for patients.
          </p>
        </div>
        <Link
          href="/recommendation-engine/selection-rules/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Create Rule
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Error loading rules: {error.message}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-gray-500">Loading selection rules...</div>
      )}

      {/* Empty State */}
      {!loading && rules.length === 0 && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-gray-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Selection Rules</h3>
          <p className="text-gray-500 mb-4">
            Create rules to customize how the recommendation engine selects variants based on patient characteristics.
          </p>
          <Link
            href="/recommendation-engine/selection-rules/new"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create First Rule
          </Link>
        </div>
      )}

      {/* Rules List */}
      {!loading && rules.length > 0 && (
        <div className="space-y-4">
          {/* Global Rules */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b">
              <h2 className="font-semibold text-gray-900">Global Rules</h2>
              <p className="text-sm text-gray-500">Applied to all variant selections</p>
            </div>
            <div className="divide-y divide-gray-200">
              {rules.filter(r => !r.variantGroupId).length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500">
                  No global rules defined
                </div>
              ) : (
                rules.filter(r => !r.variantGroupId).map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    groupName="Global"
                    onDelete={() => handleDelete(rule.id, rule.name)}
                    deleting={deleting}
                  />
                ))
              )}
            </div>
          </div>

          {/* Group-specific Rules */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b">
              <h2 className="font-semibold text-gray-900">Group-Specific Rules</h2>
              <p className="text-sm text-gray-500">Applied only to specific variant groups</p>
            </div>
            <div className="divide-y divide-gray-200">
              {rules.filter(r => r.variantGroupId).length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500">
                  No group-specific rules defined
                </div>
              ) : (
                rules.filter(r => r.variantGroupId).map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    groupName={getGroupName(rule.variantGroupId)}
                    onDelete={() => handleDelete(rule.id, rule.name)}
                    deleting={deleting}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Help Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">How Selection Rules Work</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• <strong>Global rules</strong> apply to all variant selections across all groups</li>
          <li>• <strong>Group-specific rules</strong> only apply when selecting from a particular variant group</li>
          <li>• Rules are evaluated in <strong>priority order</strong> (lower number = higher priority)</li>
          <li>• When conditions match, the rule&apos;s <strong>score adjustment</strong> is applied to the variant</li>
          <li>• Positive adjustments boost a variant, negative adjustments penalize it</li>
        </ul>
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  groupName,
  onDelete,
  deleting,
}: {
  rule: any;
  groupName: string;
  onDelete: () => void;
  deleting: boolean;
}) {
  const conditions = rule.ruleDefinition?.conditions || [];
  const action = rule.ruleDefinition?.action || {};

  return (
    <div className="px-6 py-4 hover:bg-gray-50">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="font-medium text-gray-900">{rule.name}</span>
            <span className={`px-2 py-0.5 text-xs rounded ${
              rule.isActive
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {rule.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          {rule.description && (
            <p className="text-sm text-gray-500 mt-1">{rule.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-600">
              Priority: {rule.priority}
            </span>
            <span className="text-xs bg-blue-100 px-2 py-1 rounded text-blue-700">
              {groupName}
            </span>
            {conditions.length > 0 && (
              <span className="text-xs bg-purple-100 px-2 py-1 rounded text-purple-700">
                {conditions.length} condition{conditions.length !== 1 ? 's' : ''}
              </span>
            )}
            {action.score_adjustment !== undefined && (
              <span className={`text-xs px-2 py-1 rounded ${
                action.score_adjustment > 0
                  ? 'bg-green-100 text-green-700'
                  : action.score_adjustment < 0
                  ? 'bg-red-100 text-red-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                Score: {action.score_adjustment > 0 ? '+' : ''}{action.score_adjustment}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <button
            onClick={onDelete}
            disabled={deleting}
            className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
