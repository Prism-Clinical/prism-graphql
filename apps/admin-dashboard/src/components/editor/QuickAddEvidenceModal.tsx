'use client';

import { useState, useCallback, useMemo } from 'react';
import { useMutation } from '@apollo/client/react';
import type { Node, Edge } from '@xyflow/react';
import { ADD_ADMIN_EVIDENCE } from '@/lib/graphql/mutations/pathways';
import { Button } from '@/components/ui/Button';
import type { PathwayNodeData } from '@/types';

const EVIDENCE_LEVELS = ['Level A', 'Level B', 'Level C', 'Expert Consensus'] as const;

interface QuickAddEvidenceModalProps {
  pathwayId: string;
  nodeIdentifier: string;
  nodeLabel: string;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  onSuccess: () => void;
}

export function QuickAddEvidenceModal({
  pathwayId,
  nodeIdentifier,
  nodeLabel,
  nodes,
  edges,
  onClose,
  onSuccess,
}: QuickAddEvidenceModalProps) {
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

  // Find upstream Criterion nodes via reverse BFS from nodeIdentifier
  const upstreamCriteria = useMemo(() => {
    // Build reverse adjacency: target -> sources
    const reverseAdj = new Map<string, string[]>();
    for (const edge of edges) {
      const sources = reverseAdj.get(edge.target) || [];
      sources.push(edge.source);
      reverseAdj.set(edge.target, sources);
    }

    // BFS backwards from nodeIdentifier
    const visited = new Set<string>();
    const queue = [nodeIdentifier];
    const criteria: { id: string; description: string }[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const node = nodes.find((n) => n.id === current);
      if (node) {
        const data = node.data as PathwayNodeData;
        if (data.pathwayNodeType === 'Criterion') {
          const description = String(data.properties?.description || data.label || current);
          criteria.push({ id: current, description });
        }
      }

      const parents = reverseAdj.get(current) || [];
      for (const parent of parents) {
        if (!visited.has(parent)) {
          queue.push(parent);
        }
      }
    }

    return criteria;
  }, [nodeIdentifier, nodes, edges]);

  const [addEvidence, { loading }] = useMutation(ADD_ADMIN_EVIDENCE, {
    onCompleted: () => {
      onSuccess();
      onClose();
    },
  });

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
    if (!formData.title.trim()) return;

    addEvidence({
      variables: {
        input: {
          pathwayId,
          nodeIdentifier,
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
  }, [formData, selectedCriteria, pathwayId, nodeIdentifier, addEvidence]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — click to dismiss */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Add Evidence</h2>
          <p className="text-sm text-gray-500 mt-0.5 truncate">{nodeLabel}</p>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. Labetalol vs Nifedipine RCT"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
              <input
                type="text"
                value={formData.source}
                onChange={(e) => setFormData((prev) => ({ ...prev, source: e.target.value }))}
                placeholder="e.g. JAMA 2024"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
              <input
                type="number"
                value={formData.year}
                onChange={(e) => setFormData((prev) => ({ ...prev, year: e.target.value }))}
                placeholder="2024"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Evidence Level *</label>
            <select
              value={formData.evidenceLevel}
              onChange={(e) => setFormData((prev) => ({ ...prev, evidenceLevel: e.target.value }))}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {EVIDENCE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          {/* Applicable Clinical Scenarios — only shown when upstream criteria exist */}
          {upstreamCriteria.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Applicable Clinical Scenarios</label>
              <p className="text-[10px] text-gray-400 mb-1.5">Which clinical situations does this evidence apply to?</p>
              <div className="space-y-1.5 max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
                {upstreamCriteria.map((criterion) => (
                  <label key={criterion.id} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedCriteria.has(criterion.id)}
                      onChange={() => handleToggleCriterion(criterion.id)}
                      className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-700 leading-tight">{criterion.description}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Target Population */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Target Population</label>
            <textarea
              value={formData.populationDescription}
              onChange={(e) => setFormData((prev) => ({ ...prev, populationDescription: e.target.value }))}
              placeholder="e.g. Adults >65 with eGFR > 30 mL/min"
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">URL</label>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData((prev) => ({ ...prev, url: e.target.value }))}
              placeholder="https://doi.org/..."
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional context..."
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3 flex-shrink-0">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={loading}
            disabled={!formData.title.trim()}
          >
            Add Evidence
          </Button>
        </div>
      </div>
    </div>
  );
}
