'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_ADMIN_EVIDENCE } from '@/lib/graphql/queries/pathways';
import { ADD_ADMIN_EVIDENCE, REMOVE_ADMIN_EVIDENCE } from '@/lib/graphql/mutations/pathways';
import type { AdminEvidenceEntry, PathwayGraphNode, PathwayGraphEdge } from '@/types';

const EVIDENCE_LEVELS = ['Level A', 'Level B', 'Level C', 'Expert Consensus'] as const;

const EVIDENCE_LEVEL_COLORS: Record<string, string> = {
  'Level A': 'bg-green-100 text-green-800 border-green-200',
  'Level B': 'bg-blue-100 text-blue-800 border-blue-200',
  'Level C': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Expert Consensus': 'bg-purple-100 text-purple-800 border-purple-200',
};

const EVIDENCE_LEVEL_SCORES: Record<string, number> = {
  'Level A': 0.95,
  'Level B': 0.80,
  'Level C': 0.65,
  'Expert Consensus': 0.60,
};

interface EvidencePanelProps {
  pathwayId: string;
  nodes: PathwayGraphNode[];
  edges: PathwayGraphEdge[];
}

export function EvidencePanel({ pathwayId, nodes, edges }: EvidencePanelProps) {
  const [selectedNode, setSelectedNode] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    source: '',
    year: '',
    evidenceLevel: 'Level A',
    url: '',
    notes: '',
    populationDescription: '',
  });
  const [selectedCriteria, setSelectedCriteria] = useState<Set<string>>(new Set());

  const { data, loading, refetch } = useQuery<{
    adminEvidenceEntries: AdminEvidenceEntry[];
  }>(GET_ADMIN_EVIDENCE, {
    variables: {
      pathwayId,
      nodeIdentifier: selectedNode || undefined,
    },
    fetchPolicy: 'network-only',
  });

  const [addEvidence, { loading: adding }] = useMutation(ADD_ADMIN_EVIDENCE, {
    onCompleted: () => {
      setFormData({ title: '', source: '', year: '', evidenceLevel: 'Level A', url: '', notes: '', populationDescription: '' });
      setSelectedCriteria(new Set());
      setShowForm(false);
      refetch();
    },
  });

  const [removeEvidence] = useMutation(REMOVE_ADMIN_EVIDENCE, {
    onCompleted: () => refetch(),
  });

  const entries = data?.adminEvidenceEntries ?? [];

  // Group nodes by type for the selector
  const grouped = new Map<string, PathwayGraphNode[]>();
  for (const node of nodes) {
    const list = grouped.get(node.type) || [];
    list.push(node);
    grouped.set(node.type, list);
  }
  const typeOrder = ['Stage', 'Step', 'DecisionPoint', 'Criterion', 'Medication', 'LabTest', 'Procedure', 'EvidenceCitation', 'QualityMetric', 'Schedule'];
  const sortedTypes = [...grouped.keys()].sort((a, b) => {
    const ai = typeOrder.indexOf(a);
    const bi = typeOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // Build a node lookup for resolving criterion IDs to descriptions
  const nodeMap = useMemo(() => {
    const map = new Map<string, PathwayGraphNode>();
    for (const node of nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [nodes]);

  // Find upstream Criterion nodes for the selected node via reverse BFS
  const upstreamCriteria = useMemo(() => {
    if (!selectedNode) return [];

    const reverseAdj = new Map<string, string[]>();
    for (const edge of edges) {
      const sources = reverseAdj.get(edge.to) || [];
      sources.push(edge.from);
      reverseAdj.set(edge.to, sources);
    }

    const visited = new Set<string>();
    const queue = [selectedNode];
    const criteria: { id: string; description: string }[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const node = nodeMap.get(current);
      if (node && node.type === 'Criterion') {
        const props = node.properties as Record<string, unknown>;
        const description = String(props?.description || node.id);
        criteria.push({ id: current, description });
      }

      const parents = reverseAdj.get(current) || [];
      for (const parent of parents) {
        if (!visited.has(parent)) {
          queue.push(parent);
        }
      }
    }

    return criteria;
  }, [selectedNode, edges, nodeMap]);

  const handleToggleCriterion = useCallback((id: string) => {
    setSelectedCriteria((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (!selectedNode || !formData.title.trim()) return;

    addEvidence({
      variables: {
        input: {
          pathwayId,
          nodeIdentifier: selectedNode,
          title: formData.title.trim(),
          source: formData.source.trim() || undefined,
          year: formData.year ? parseInt(formData.year, 10) : undefined,
          evidenceLevel: formData.evidenceLevel,
          url: formData.url.trim() || undefined,
          notes: formData.notes.trim() || undefined,
          applicableCriteria: selectedCriteria.size > 0 ? [...selectedCriteria] : undefined,
          populationDescription: formData.populationDescription.trim() || undefined,
        },
      },
    });
  }, [selectedNode, formData, selectedCriteria, pathwayId, addEvidence]);

  const handleDelete = useCallback((id: string) => {
    removeEvidence({ variables: { id } });
  }, [removeEvidence]);

  // Estimate impact: find best existing evidence level for this node
  const estimateScore = (level: string): number => {
    return EVIDENCE_LEVEL_SCORES[level] ?? 0.30;
  };

  const currentBestScore = entries.length > 0
    ? Math.max(...entries.map(e => estimateScore(e.evidenceLevel)))
    : 0.30;

  /** Resolve a criterion ID to its description using the nodes prop */
  const getCriterionLabel = (criterionId: string): string => {
    const node = nodeMap.get(criterionId);
    if (!node) return criterionId;
    const props = node.properties as Record<string, unknown>;
    return String(props?.description || node.id);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Node selector */}
      <div className="px-4 py-3 border-b border-gray-200">
        <label className="block text-xs font-medium text-gray-700 mb-1">Select Node</label>
        <select
          value={selectedNode}
          onChange={e => setSelectedNode(e.target.value)}
          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All nodes</option>
          {sortedTypes.map(type => (
            <optgroup key={type} label={type}>
              {grouped.get(type)!.map(node => {
                const props = node.properties as Record<string, unknown>;
                const label = String(props?.title || props?.name || props?.description || node.id);
                return (
                  <option key={node.id} value={node.id}>
                    {label}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Impact preview */}
      {selectedNode && (
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Evidence Strength:</span>
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
              currentBestScore >= 0.80 ? 'bg-green-100 text-green-700' :
              currentBestScore >= 0.60 ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}>
              {Math.round(currentBestScore * 100)}%
            </span>
            <span className="text-xs text-gray-400">
              ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})
            </span>
          </div>
        </div>
      )}

      {/* Evidence list */}
      <div className="px-4 py-3">
        {loading ? (
          <p className="text-xs text-gray-400 text-center py-4">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">
            {selectedNode ? 'No evidence entries for this node.' : 'No evidence entries for this pathway.'}
          </p>
        ) : (
          <div className="space-y-2">
            {entries.map(entry => (
              <div key={entry.id} className="bg-white border border-gray-200 rounded-lg p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900 truncate">{entry.title}</span>
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap ${
                        EVIDENCE_LEVEL_COLORS[entry.evidenceLevel] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                      }`}>
                        {entry.evidenceLevel}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-500">
                      {entry.source && <span>{entry.source}</span>}
                      {entry.year && <span>({entry.year})</span>}
                    </div>
                    {entry.url && (
                      <a href={entry.url} target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline mt-0.5 block truncate">
                        {entry.url}
                      </a>
                    )}
                    {entry.notes && (
                      <p className="text-gray-500 mt-1 line-clamp-2">{entry.notes}</p>
                    )}
                    {entry.populationDescription && (
                      <p className="text-gray-400 italic mt-1 text-[10px]">{entry.populationDescription}</p>
                    )}
                    {entry.applicableCriteria && entry.applicableCriteria.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {entry.applicableCriteria.map((criterionId) => (
                          <span
                            key={criterionId}
                            className="inline-block px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-medium truncate max-w-[200px]"
                            title={getCriterionLabel(criterionId)}
                          >
                            {getCriterionLabel(criterionId)}
                          </span>
                        ))}
                      </div>
                    )}
                    {!selectedNode && (
                      <span className="text-gray-400 mt-1 block">Node: {entry.nodeIdentifier}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 p-0.5"
                    title="Remove evidence"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add form */}
      {selectedNode && (
        <div className="px-4 pb-4">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full py-2 px-3 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
            >
              + Add Evidence Entry
            </button>
          ) : (
            <div className="border border-gray-200 rounded-lg p-3 space-y-2.5 bg-gray-50">
              <div>
                <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g. Labetalol vs Nifedipine RCT"
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Source</label>
                  <input
                    type="text"
                    value={formData.source}
                    onChange={e => setFormData(prev => ({ ...prev, source: e.target.value }))}
                    placeholder="e.g. JAMA 2024"
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="w-20">
                  <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Year</label>
                  <input
                    type="number"
                    value={formData.year}
                    onChange={e => setFormData(prev => ({ ...prev, year: e.target.value }))}
                    placeholder="2024"
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Evidence Level *</label>
                <select
                  value={formData.evidenceLevel}
                  onChange={e => setFormData(prev => ({ ...prev, evidenceLevel: e.target.value }))}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {EVIDENCE_LEVELS.map(level => (
                    <option key={level} value={level}>
                      {level} ({Math.round(EVIDENCE_LEVEL_SCORES[level] * 100)}%)
                    </option>
                  ))}
                </select>
              </div>

              {/* Applicable Clinical Scenarios — only shown when upstream criteria exist */}
              {upstreamCriteria.length > 0 && (
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Applicable Clinical Scenarios</label>
                  <p className="text-[9px] text-gray-400 mb-1">Which clinical situations does this evidence apply to?</p>
                  <div className="space-y-1 max-h-24 overflow-y-auto border border-gray-200 rounded p-1.5 bg-white">
                    {upstreamCriteria.map((criterion) => (
                      <label key={criterion.id} className="flex items-start gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedCriteria.has(criterion.id)}
                          onChange={() => handleToggleCriterion(criterion.id)}
                          className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-[10px] text-gray-700 leading-tight">{criterion.description}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Target Population */}
              <div>
                <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Target Population</label>
                <textarea
                  value={formData.populationDescription}
                  onChange={e => setFormData(prev => ({ ...prev, populationDescription: e.target.value }))}
                  placeholder="e.g. Adults >65 with eGFR > 30 mL/min"
                  rows={2}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-medium text-gray-600 mb-0.5">URL</label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="https://doi.org/..."
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Additional context..."
                  rows={2}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={adding || !formData.title.trim()}
                  className="flex-1 py-1.5 px-3 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {adding ? 'Adding...' : 'Add Evidence'}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="py-1.5 px-3 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
