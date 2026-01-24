'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Cog6ToothIcon,
  BeakerIcon,
  ChartBarIcon,
  AdjustmentsHorizontalIcon,
  Square3Stack3DIcon,
  SparklesIcon,
  PlayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  useVariantGroups,
  useSelectionRules,
  useAnalyticsSummary,
  useRecommend,
  useExplainRecommendation,
  useEngineConfiguration,
  useSaveMatchingConfig,
  useSavePersonalizationConfig,
  PatientContext,
  LayerSummary,
  Recommendation,
  MatchReason,
  MatchingConfig,
  PersonalizationConfig,
} from '@/lib/hooks/useRecommendationEngine';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

// Tab definitions
const TABS = [
  { id: 'overview', name: 'Overview', icon: ChartBarIcon },
  { id: 'matching', name: 'Matching', icon: AdjustmentsHorizontalIcon },
  { id: 'variants', name: 'Variants & Rules', icon: Square3Stack3DIcon },
  { id: 'personalization', name: 'Personalization', icon: SparklesIcon },
  { id: 'test', name: 'Test Console', icon: BeakerIcon },
];

// Sample test contexts
const SAMPLE_CONTEXTS: { name: string; context: PatientContext }[] = [
  {
    name: 'Strep Throat - Pediatric',
    context: { condition_codes: ['J02.0', 'J02.9'], age: 8, sex: 'male' },
  },
  {
    name: 'Strep Throat - Adult',
    context: { condition_codes: ['J02.0'], age: 35, sex: 'female' },
  },
  {
    name: 'Type 2 Diabetes',
    context: {
      condition_codes: ['E11.9'],
      age: 55,
      sex: 'male',
      comorbidities: ['I10'],
      risk_factors: ['obesity', 'smoking'],
    },
  },
  {
    name: 'GERD',
    context: { condition_codes: ['K21.0'], age: 45, sex: 'male' },
  },
];

export default function RecommendationEnginePage() {
  const [activeTab, setActiveTab] = useState('overview');

  // Data hooks
  const { groups, loading: groupsLoading } = useVariantGroups();
  const { rules, loading: rulesLoading } = useSelectionRules();
  const { summary, loading: analyticsLoading } = useAnalyticsSummary(7);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Recommendation Engine</h1>
        <p className="mt-1 text-sm text-gray-600">
          Configure and test the three-layer recommendation system
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  isActive
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon className="h-5 w-5" />
                {tab.name}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          <OverviewTab
            groups={groups}
            rules={rules}
            summary={summary}
            groupsLoading={groupsLoading}
            rulesLoading={rulesLoading}
            analyticsLoading={analyticsLoading}
            onNavigateToTab={setActiveTab}
          />
        )}
        {activeTab === 'matching' && <MatchingConfigTab />}
        {activeTab === 'variants' && (
          <VariantsTab groups={groups} rules={rules} loading={groupsLoading || rulesLoading} />
        )}
        {activeTab === 'personalization' && <PersonalizationTab />}
        {activeTab === 'test' && <TestConsoleTab />}
      </div>
    </div>
  );
}

// =============================================================================
// Overview Tab
// =============================================================================

function OverviewTab({
  groups,
  rules,
  summary,
  groupsLoading,
  rulesLoading,
  analyticsLoading,
  onNavigateToTab,
}: {
  groups: any[];
  rules: any[];
  summary: any;
  groupsLoading: boolean;
  rulesLoading: boolean;
  analyticsLoading: boolean;
  onNavigateToTab: (tab: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Architecture Diagram */}
      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex items-center justify-between gap-4">
            {/* Layer 1 */}
            <div className="flex-1 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-600 mb-3">
                <span className="text-lg font-bold">1</span>
              </div>
              <h3 className="font-semibold text-gray-900">Primary Matching</h3>
              <p className="text-sm text-gray-500 mt-1">
                Condition codes + embedding similarity
              </p>
            </div>

            <div className="text-gray-300 text-2xl">→</div>

            {/* Layer 2 */}
            <div className="flex-1 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600 mb-3">
                <span className="text-lg font-bold">2</span>
              </div>
              <h3 className="font-semibold text-gray-900">Variant Selection</h3>
              <p className="text-sm text-gray-500 mt-1">
                Patient targeting + selection rules
              </p>
            </div>

            <div className="text-gray-300 text-2xl">→</div>

            {/* Layer 3 */}
            <div className="flex-1 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-100 text-purple-600 mb-3">
                <span className="text-lg font-bold">3</span>
              </div>
              <h3 className="font-semibold text-gray-900">Personalization</h3>
              <p className="text-sm text-gray-500 mt-1">
                RAG synthesis + outcome learning
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Variant Groups</div>
            <div className="mt-1 text-3xl font-bold text-gray-900">
              {groupsLoading ? '...' : groups.length}
            </div>
            <div className="mt-2 text-sm text-gray-400">
              {groups.filter((g) => g.isActive).length} active
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Selection Rules</div>
            <div className="mt-1 text-3xl font-bold text-gray-900">
              {rulesLoading ? '...' : rules.length}
            </div>
            <div className="mt-2 text-sm text-gray-400">
              {rules.filter((r) => r.isActive).length} active
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Sessions (7d)</div>
            <div className="mt-1 text-3xl font-bold text-gray-900">
              {analyticsLoading ? '...' : summary?.totalSessions || 0}
            </div>
            <div className="mt-2 text-sm text-gray-400">
              {summary?.acceptanceRate ? `${(summary.acceptanceRate * 100).toFixed(0)}% accepted` : '-'}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-sm text-gray-500">Avg Response Time</div>
            <div className="mt-1 text-3xl font-bold text-gray-900">
              {analyticsLoading
                ? '...'
                : summary?.averageProcessingTimeMs
                ? `${summary.averageProcessingTimeMs.toFixed(0)}ms`
                : 'N/A'}
            </div>
            <div className="mt-2 text-sm text-gray-400">All layers combined</div>
          </CardBody>
        </Card>
      </div>

      {/* Configuration Status */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration Status</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <ConfigStatusItem
              title="Layer 1: Matching Configuration"
              description="Similarity thresholds and condition code matching rules"
              status="configured"
              action={{ label: 'Configure', tab: 'matching' }}
              onAction={onNavigateToTab}
            />
            <ConfigStatusItem
              title="Layer 2: Variant Groups"
              description={`${groups.length} groups with ${groups.reduce((acc, g) => acc + g.variants.length, 0)} total variants`}
              status={groups.length > 0 ? 'configured' : 'needs-setup'}
              action={{ label: 'Manage', tab: 'variants' }}
              onAction={onNavigateToTab}
            />
            <ConfigStatusItem
              title="Layer 2: Selection Rules"
              description={`${rules.filter((r) => r.isActive).length} active rules`}
              status={rules.length > 0 ? 'configured' : 'optional'}
              action={{ label: 'Manage', tab: 'variants' }}
              onAction={onNavigateToTab}
            />
            <ConfigStatusItem
              title="Layer 3: Personalization"
              description="RAG synthesis and outcome learning"
              status="optional"
              action={{ label: 'Configure', tab: 'personalization' }}
              onAction={onNavigateToTab}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function ConfigStatusItem({
  title,
  description,
  status,
  action,
  onAction,
}: {
  title: string;
  description: string;
  status: 'configured' | 'needs-setup' | 'optional';
  action: { label: string; tab: string };
  onAction: (tab: string) => void;
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center gap-3">
        {status === 'configured' && (
          <CheckCircleIcon className="h-5 w-5 text-green-500" />
        )}
        {status === 'needs-setup' && (
          <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />
        )}
        {status === 'optional' && (
          <Cog6ToothIcon className="h-5 w-5 text-gray-400" />
        )}
        <div>
          <div className="font-medium text-gray-900">{title}</div>
          <div className="text-sm text-gray-500">{description}</div>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => onAction(action.tab)}>
        {action.label}
      </Button>
    </div>
  );
}

// =============================================================================
// Matching Configuration Tab
// =============================================================================

function MatchingConfigTab() {
  const { config, loading: configLoading } = useEngineConfiguration();
  const { saveConfig, loading: saving, error: saveError } = useSaveMatchingConfig();
  const [saved, setSaved] = useState(false);

  // Local state for form values
  const [similarityThreshold, setSimilarityThreshold] = useState(0.75);
  const [maxCandidates, setMaxCandidates] = useState(50);
  const [enableEmbeddings, setEnableEmbeddings] = useState(true);
  const [matchingStrategy, setMatchingStrategy] = useState('hybrid');
  const [codeMatchPriority, setCodeMatchPriority] = useState('exact_first');
  const [exactMatchScore, setExactMatchScore] = useState(100);
  const [prefixMatchScore, setPrefixMatchScore] = useState(75);
  const [categoryMatchScore, setCategoryMatchScore] = useState(50);
  const [embeddingMatchScore, setEmbeddingMatchScore] = useState(60);

  // Load config when available
  useEffect(() => {
    if (config?.matching) {
      setSimilarityThreshold(config.matching.similarityThreshold);
      setMaxCandidates(config.matching.maxCandidates);
      setEnableEmbeddings(config.matching.enableEmbeddings);
      setMatchingStrategy(config.matching.strategy);
      setCodeMatchPriority(config.matching.codeMatchPriority);
      setExactMatchScore(config.matching.scoreWeights.exactMatch);
      setPrefixMatchScore(config.matching.scoreWeights.prefixMatch);
      setCategoryMatchScore(config.matching.scoreWeights.categoryMatch);
      setEmbeddingMatchScore(config.matching.scoreWeights.embeddingMatch);
    }
  }, [config]);

  const handleSave = async () => {
    setSaved(false);
    try {
      await saveConfig({
        strategy: matchingStrategy,
        codeMatchPriority: codeMatchPriority,
        enableEmbeddings: enableEmbeddings,
        similarityThreshold: similarityThreshold,
        maxCandidates: maxCandidates,
        scoreWeights: {
          exactMatch: exactMatchScore,
          prefixMatch: prefixMatchScore,
          categoryMatch: categoryMatchScore,
          embeddingMatch: embeddingMatchScore,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  };

  if (configLoading) {
    return <div className="text-center py-12 text-gray-500">Loading configuration...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Matching Strategy */}
      <Card>
        <CardHeader>
          <CardTitle>Matching Strategy</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Primary Strategy
              </label>
              <div className="grid grid-cols-3 gap-4">
                {[
                  {
                    id: 'code_only',
                    name: 'Condition Codes Only',
                    desc: 'Match only on ICD-10 codes',
                  },
                  {
                    id: 'embedding_only',
                    name: 'Embeddings Only',
                    desc: 'Semantic similarity search',
                  },
                  {
                    id: 'hybrid',
                    name: 'Hybrid (Recommended)',
                    desc: 'Codes first, then embeddings',
                  },
                ].map((strategy) => (
                  <label
                    key={strategy.id}
                    className={`relative flex flex-col p-4 border rounded-lg cursor-pointer transition-colors ${
                      matchingStrategy === strategy.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="strategy"
                      value={strategy.id}
                      checked={matchingStrategy === strategy.id}
                      onChange={(e) => setMatchingStrategy(e.target.value)}
                      className="sr-only"
                    />
                    <span className="font-medium text-gray-900">{strategy.name}</span>
                    <span className="text-sm text-gray-500 mt-1">{strategy.desc}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Condition Code Matching */}
      <Card>
        <CardHeader>
          <CardTitle>Condition Code Matching</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Match Priority
              </label>
              <select
                value={codeMatchPriority}
                onChange={(e) => setCodeMatchPriority(e.target.value)}
                className="w-full max-w-md border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="exact_first">Exact codes first, then prefix matching</option>
                <option value="exact_only">Exact codes only</option>
                <option value="category">Category-level matching (first 3 chars)</option>
                <option value="hierarchical">Full ICD-10 hierarchy</option>
              </select>
              <p className="text-sm text-gray-500 mt-1">
                How condition codes from patient context are matched to care plan codes
              </p>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium text-gray-900 mb-3">Score Weights</h4>
              <div className="grid grid-cols-2 gap-4 max-w-lg">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Exact Match</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={exactMatchScore}
                      onChange={(e) => setExactMatchScore(parseInt(e.target.value) || 0)}
                      className="w-20 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                    />
                    <span className="text-sm text-gray-500">points</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Prefix Match</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={prefixMatchScore}
                      onChange={(e) => setPrefixMatchScore(parseInt(e.target.value) || 0)}
                      className="w-20 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                    />
                    <span className="text-sm text-gray-500">points</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Category Match</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={categoryMatchScore}
                      onChange={(e) => setCategoryMatchScore(parseInt(e.target.value) || 0)}
                      className="w-20 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                    />
                    <span className="text-sm text-gray-500">points</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Embedding Match</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={embeddingMatchScore}
                      onChange={(e) => setEmbeddingMatchScore(parseInt(e.target.value) || 0)}
                      className="w-20 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                    />
                    <span className="text-sm text-gray-500">points</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Embedding Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Embedding Similarity</CardTitle>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableEmbeddings}
                onChange={(e) => setEnableEmbeddings(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-600">Enabled</span>
            </label>
          </div>
        </CardHeader>
        <CardBody>
          <div className={`space-y-4 ${!enableEmbeddings ? 'opacity-50 pointer-events-none' : ''}`}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Minimum Similarity Threshold: {(similarityThreshold * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.05"
                value={similarityThreshold}
                onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
                className="w-full max-w-md"
              />
              <p className="text-sm text-gray-500 mt-1">
                Care plans below this similarity score will not be included in results
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Maximum Candidates from Embedding Search
              </label>
              <input
                type="number"
                value={maxCandidates}
                onChange={(e) => setMaxCandidates(parseInt(e.target.value))}
                className="w-32 border border-gray-300 rounded-md px-3 py-2"
                min={10}
                max={200}
              />
              <p className="text-sm text-gray-500 mt-1">
                Limit the number of candidates retrieved from vector search
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end items-center gap-4">
        {saveError && (
          <span className="text-red-600 text-sm">Failed to save configuration</span>
        )}
        {saved && (
          <span className="text-green-600 text-sm">Configuration saved!</span>
        )}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Variants & Rules Tab
// =============================================================================

function VariantsTab({
  groups,
  rules,
  loading,
}: {
  groups: any[];
  rules: any[];
  loading: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <strong>Variant Groups</strong> let you define multiple versions of care plans for different patient populations.{' '}
          <strong>Selection Rules</strong> determine which variant is chosen based on patient characteristics.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Variant Groups */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Variant Groups</CardTitle>
              <Link href="/recommendation-engine/variant-groups/new">
                <Button size="sm">+ New Group</Button>
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : groups.length === 0 ? (
              <div className="text-center py-8">
                <Square3Stack3DIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 mb-4">No variant groups yet</p>
                <Link href="/recommendation-engine/variant-groups/new">
                  <Button variant="outline" size="sm">Create First Group</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map((group) => (
                  <Link
                    key={group.id}
                    href={`/recommendation-engine/variant-groups/${group.id}`}
                    className="block p-3 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-gray-900">{group.name}</div>
                        <div className="text-sm text-gray-500 mt-1">
                          {group.conditionCodes.slice(0, 3).join(', ')}
                          {group.conditionCodes.length > 3 && ` +${group.conditionCodes.length - 3}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">
                          {group.variants.length} variant{group.variants.length !== 1 ? 's' : ''}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded ${
                            group.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {group.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Selection Rules */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Selection Rules</CardTitle>
              <Link href="/recommendation-engine/selection-rules/new">
                <Button size="sm">+ New Rule</Button>
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : rules.length === 0 ? (
              <div className="text-center py-8">
                <AdjustmentsHorizontalIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 mb-4">No selection rules yet</p>
                <p className="text-sm text-gray-400 mb-4">
                  Rules adjust scores based on patient characteristics
                </p>
                <Link href="/recommendation-engine/selection-rules/new">
                  <Button variant="outline" size="sm">Create First Rule</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="p-3 border border-gray-200 rounded-lg"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-gray-900">{rule.name}</div>
                        <div className="text-sm text-gray-500 mt-1">
                          Priority: {rule.priority} • {rule.variantGroupId ? 'Group-specific' : 'Global'}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 text-xs rounded ${
                          rule.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// =============================================================================
// Personalization Tab
// =============================================================================

function PersonalizationTab() {
  const { config, loading: configLoading } = useEngineConfiguration();
  const { saveConfig, loading: saving, error: saveError } = useSavePersonalizationConfig();
  const [saved, setSaved] = useState(false);

  const [enableRag, setEnableRag] = useState(true);
  const [enableOutcomeLearning, setEnableOutcomeLearning] = useState(false);
  const [enableDecisionPaths, setEnableDecisionPaths] = useState(true);
  const [knowledgeSources, setKnowledgeSources] = useState<string[]>(['training_data', 'clinical_guidelines', 'care_plans']);
  const [learningRate, setLearningRate] = useState('moderate');

  // Load config when available
  useEffect(() => {
    if (config?.personalization) {
      setEnableRag(config.personalization.enableRag);
      setEnableOutcomeLearning(config.personalization.enableOutcomeLearning);
      setEnableDecisionPaths(config.personalization.enableDecisionPaths);
      setKnowledgeSources(config.personalization.knowledgeSources);
      setLearningRate(config.personalization.learningRate);
    }
  }, [config]);

  const handleSave = async () => {
    setSaved(false);
    try {
      await saveConfig({
        enableRag,
        enableOutcomeLearning,
        enableDecisionPaths,
        knowledgeSources,
        learningRate,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  };

  const toggleKnowledgeSource = (source: string) => {
    setKnowledgeSources((prev) =>
      prev.includes(source)
        ? prev.filter((s) => s !== source)
        : [...prev, source]
    );
  };

  if (configLoading) {
    return <div className="text-center py-12 text-gray-500">Loading configuration...</div>;
  }

  return (
    <div className="space-y-6">
      {/* RAG Synthesis */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>RAG Synthesis</CardTitle>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableRag}
                onChange={(e) => setEnableRag(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-600">Enabled</span>
            </label>
          </div>
        </CardHeader>
        <CardBody>
          <div className={`space-y-4 ${!enableRag ? 'opacity-50 pointer-events-none' : ''}`}>
            <p className="text-sm text-gray-600">
              RAG (Retrieval Augmented Generation) enhances recommendations by synthesizing
              information from clinical guidelines, research, and training data.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Knowledge Sources
              </label>
              <div className="space-y-2">
                {[
                  { id: 'training_data', name: 'Training Data', desc: 'Your curated training examples' },
                  { id: 'clinical_guidelines', name: 'Clinical Guidelines', desc: 'Published clinical guidelines' },
                  { id: 'care_plans', name: 'Care Plan Descriptions', desc: 'Content from care plan records' },
                ].map((source) => (
                  <label key={source.id} className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={knowledgeSources.includes(source.id)}
                      onChange={() => toggleKnowledgeSource(source.id)}
                      className="mt-1 rounded border-gray-300"
                    />
                    <div>
                      <div className="font-medium text-gray-900">{source.name}</div>
                      <div className="text-sm text-gray-500">{source.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Decision Explorer Integration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Decision Explorer Integration</CardTitle>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableDecisionPaths}
                onChange={(e) => setEnableDecisionPaths(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-600">Enabled</span>
            </label>
          </div>
        </CardHeader>
        <CardBody>
          <div className={`space-y-4 ${!enableDecisionPaths ? 'opacity-50 pointer-events-none' : ''}`}>
            <p className="text-sm text-gray-600">
              Connect to Decision Explorer pathways to provide guided clinical decision support
              alongside recommendations.
            </p>

            <div className="bg-gray-50 rounded-lg p-4">
              <Link
                href="/decision-explorer"
                className="text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Manage Decision Pathways →
              </Link>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Outcome Learning */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Outcome Learning</CardTitle>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableOutcomeLearning}
                onChange={(e) => setEnableOutcomeLearning(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-600">Enabled</span>
            </label>
          </div>
        </CardHeader>
        <CardBody>
          <div className={`space-y-4 ${!enableOutcomeLearning ? 'opacity-50 pointer-events-none' : ''}`}>
            <p className="text-sm text-gray-600">
              Learn from recommendation acceptance/rejection patterns to improve future suggestions.
            </p>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                <strong>Note:</strong> Outcome learning requires integration with your EHR to track
                which recommendations are accepted by providers.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Learning Rate
              </label>
              <select
                value={learningRate}
                onChange={(e) => setLearningRate(e.target.value)}
                className="w-full max-w-md border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="conservative">Conservative (small adjustments)</option>
                <option value="moderate">Moderate (recommended)</option>
                <option value="aggressive">Aggressive (fast adaptation)</option>
              </select>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end items-center gap-4">
        {saveError && (
          <span className="text-red-600 text-sm">Failed to save configuration</span>
        )}
        {saved && (
          <span className="text-green-600 text-sm">Configuration saved!</span>
        )}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Test Console Tab
// =============================================================================

function TestConsoleTab() {
  const [conditionCodes, setConditionCodes] = useState('');
  const [age, setAge] = useState<string>('');
  const [sex, setSex] = useState<string>('');
  const [comorbidities, setComorbidities] = useState('');
  const [riskFactors, setRiskFactors] = useState('');
  const [maxResults, setMaxResults] = useState(5);
  const [enablePersonalization, setEnablePersonalization] = useState(true);

  const { recommend, result, loading, error } = useRecommend();
  const { explain, explanation, loading: explainLoading } = useExplainRecommendation();

  const handleTest = async () => {
    const context: PatientContext = {
      condition_codes: conditionCodes.split(',').map((c) => c.trim()).filter(Boolean),
      age: age ? parseInt(age) : undefined,
      sex: sex || undefined,
      comorbidities: comorbidities ? comorbidities.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
      risk_factors: riskFactors ? riskFactors.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
    };

    await recommend(context, { maxResults, enablePersonalization });
  };

  const loadSample = (sample: typeof SAMPLE_CONTEXTS[0]) => {
    setConditionCodes(sample.context.condition_codes.join(', '));
    setAge(sample.context.age?.toString() || '');
    setSex(sample.context.sex || '');
    setComorbidities(sample.context.comorbidities?.join(', ') || '');
    setRiskFactors(sample.context.risk_factors?.join(', ') || '');
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="space-y-4">
          {/* Quick Load */}
          <Card>
            <CardBody>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-500">Quick load:</span>
                {SAMPLE_CONTEXTS.map((sample) => (
                  <button
                    key={sample.name}
                    onClick={() => loadSample(sample)}
                    className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                  >
                    {sample.name}
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Patient Context Form */}
          <Card>
            <CardHeader>
              <CardTitle>Patient Context</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Condition Codes *
                  </label>
                  <input
                    type="text"
                    value={conditionCodes}
                    onChange={(e) => setConditionCodes(e.target.value)}
                    placeholder="J02.0, J02.9"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">Comma-separated ICD-10 codes</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
                    <input
                      type="number"
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      placeholder="35"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sex</label>
                    <select
                      value={sex}
                      onChange={(e) => setSex(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="">Not specified</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Comorbidities
                  </label>
                  <input
                    type="text"
                    value={comorbidities}
                    onChange={(e) => setComorbidities(e.target.value)}
                    placeholder="I10, E78.0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Risk Factors
                  </label>
                  <input
                    type="text"
                    value={riskFactors}
                    onChange={(e) => setRiskFactors(e.target.value)}
                    placeholder="smoking, obesity"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max Results
                    </label>
                    <input
                      type="number"
                      value={maxResults}
                      onChange={(e) => setMaxResults(parseInt(e.target.value))}
                      min={1}
                      max={20}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={enablePersonalization}
                        onChange={(e) => setEnablePersonalization(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">Enable Layer 3</span>
                    </label>
                  </div>
                </div>

                <Button
                  onClick={handleTest}
                  disabled={loading || !conditionCodes.trim()}
                  className="w-full"
                >
                  {loading ? (
                    'Running...'
                  ) : (
                    <>
                      <PlayIcon className="h-4 w-4 mr-2" />
                      Run Recommendation
                    </>
                  )}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Results Panel */}
        <div className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error.message}
            </div>
          )}

          {result && (
            <>
              {/* Layer Pipeline */}
              <Card>
                <CardBody>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-gray-900">Processing Pipeline</span>
                    <span className="text-sm text-gray-500">
                      Total: {result.totalProcessingTimeMs.toFixed(1)}ms
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.layerSummaries.map((layer: LayerSummary, i: number) => (
                      <div key={layer.layer} className="flex items-center">
                        {i > 0 && <span className="mx-2 text-gray-300">→</span>}
                        <div
                          className={`px-3 py-2 rounded-lg text-sm ${
                            layer.layer === 1
                              ? 'bg-blue-100 text-blue-800'
                              : layer.layer === 2
                              ? 'bg-green-100 text-green-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}
                        >
                          <div className="font-medium">L{layer.layer}</div>
                          <div className="text-xs opacity-75">
                            {layer.candidateCount} • {layer.processingTimeMs.toFixed(0)}ms
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>

              {/* Recommendations */}
              <Card>
                <CardHeader>
                  <CardTitle>Results ({result.recommendations.length})</CardTitle>
                </CardHeader>
                <CardBody>
                  {result.recommendations.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      No recommendations found for this patient context.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {result.recommendations.map((rec: Recommendation) => (
                        <div key={rec.carePlanId} className="p-3 border border-gray-200 rounded-lg">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-xs font-medium text-gray-500 mr-2">
                                #{rec.rank}
                              </span>
                              <span className="font-medium text-gray-900">{rec.title}</span>
                              {rec.variantName && (
                                <span className="ml-2 text-sm text-gray-500">
                                  ({rec.variantName})
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-sm font-medium">
                                {rec.score.toFixed(1)}
                              </div>
                              {rec.embeddingSimilarity && (
                                <div className="text-xs text-gray-500">
                                  {(rec.embeddingSimilarity * 100).toFixed(0)}% similar
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1">
                            {rec.matchType && (
                              <span
                                className={`px-2 py-0.5 text-xs rounded ${
                                  rec.matchType === 'exact_code'
                                    ? 'bg-green-100 text-green-700'
                                    : rec.matchType === 'prefix_code'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-purple-100 text-purple-700'
                                }`}
                              >
                                {rec.matchType.replace('_', ' ')}
                              </span>
                            )}
                            {rec.conditionCodes.slice(0, 3).map((code: string) => (
                              <span key={code} className="px-2 py-0.5 text-xs bg-gray-100 rounded">
                                {code}
                              </span>
                            ))}
                          </div>

                          {rec.reasons.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-100">
                              {rec.reasons.slice(0, 2).map((reason: MatchReason, i: number) => (
                                <div key={i} className="flex justify-between text-xs">
                                  <span className="text-gray-500">{reason.description}</span>
                                  {reason.scoreImpact !== 0 && (
                                    <span
                                      className={
                                        reason.scoreImpact > 0 ? 'text-green-600' : 'text-red-600'
                                      }
                                    >
                                      {reason.scoreImpact > 0 ? '+' : ''}
                                      {reason.scoreImpact.toFixed(1)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            </>
          )}

          {!result && !error && (
            <Card>
              <CardBody>
                <div className="text-center py-12 text-gray-500">
                  <BeakerIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>Enter patient context and run a recommendation to see results</p>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
