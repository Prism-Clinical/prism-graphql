'use client';

import { useState } from 'react';
import {
  Recommendation,
  LayerSummary,
  PatientContext,
  MatchReason,
} from '@/lib/hooks/useRecommendationEngine';

interface RecommendationTreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendation: Recommendation;
  patientContext: PatientContext;
  layerSummaries: LayerSummary[];
}

interface TreeNode {
  id: string;
  type: 'patient' | 'layer' | 'factor' | 'result';
  title: string;
  description?: string;
  confidence?: number;
  impact?: 'positive' | 'negative' | 'neutral';
  children: TreeNode[];
  isExpanded?: boolean;
}

function buildDecisionTree(
  recommendation: Recommendation,
  patientContext: PatientContext,
  layerSummaries: LayerSummary[]
): TreeNode {
  // Build patient context node
  const patientFactors: TreeNode[] = [];

  if (patientContext.condition_codes?.length) {
    patientFactors.push({
      id: 'factor-conditions',
      type: 'factor',
      title: 'Condition Codes',
      description: patientContext.condition_codes.join(', '),
      impact: 'neutral',
      children: [],
    });
  }

  if (patientContext.age) {
    patientFactors.push({
      id: 'factor-age',
      type: 'factor',
      title: 'Age',
      description: `${patientContext.age} years`,
      impact: 'neutral',
      children: [],
    });
  }

  if (patientContext.sex) {
    patientFactors.push({
      id: 'factor-sex',
      type: 'factor',
      title: 'Sex',
      description: patientContext.sex,
      impact: 'neutral',
      children: [],
    });
  }

  if (patientContext.comorbidities?.length) {
    patientFactors.push({
      id: 'factor-comorbidities',
      type: 'factor',
      title: 'Comorbidities',
      description: patientContext.comorbidities.join(', '),
      impact: 'neutral',
      children: [],
    });
  }

  if (patientContext.risk_factors?.length) {
    patientFactors.push({
      id: 'factor-risks',
      type: 'factor',
      title: 'Risk Factors',
      description: patientContext.risk_factors.join(', '),
      impact: 'neutral',
      children: [],
    });
  }

  // Build layer nodes
  const layerNodes: TreeNode[] = layerSummaries.map((layer, idx) => {
    const layerReasons = recommendation.reasons.filter((r) => {
      // Map reasons to layers based on type
      if (layer.layer === 1) {
        return ['exact_match', 'prefix_match', 'embedding_match', 'code_match'].some(
          (t) => r.reasonType.toLowerCase().includes(t.replace('_', ''))
        );
      }
      if (layer.layer === 2) {
        return ['variant', 'selection', 'targeting', 'age', 'sex'].some(
          (t) => r.reasonType.toLowerCase().includes(t)
        );
      }
      if (layer.layer === 3) {
        return ['personalization', 'outcome', 'rag', 'history'].some(
          (t) => r.reasonType.toLowerCase().includes(t)
        );
      }
      return false;
    });

    const reasonNodes: TreeNode[] = layerReasons.map((reason, ridx) => ({
      id: `layer-${layer.layer}-reason-${ridx}`,
      type: 'factor' as const,
      title: formatReasonType(reason.reasonType),
      description: reason.description,
      confidence: reason.scoreImpact > 0 ? Math.min(reason.scoreImpact / 50, 1) : 0,
      impact: reason.scoreImpact > 0 ? 'positive' : reason.scoreImpact < 0 ? 'negative' : 'neutral',
      children: [],
    }));

    // Add generic info if no specific reasons found
    if (reasonNodes.length === 0 && layer.candidateCount > 0) {
      reasonNodes.push({
        id: `layer-${layer.layer}-info`,
        type: 'factor',
        title: 'Processing',
        description: `${layer.candidateCount} candidates evaluated in ${layer.processingTimeMs.toFixed(0)}ms`,
        impact: 'neutral',
        children: [],
      });
    }

    return {
      id: `layer-${layer.layer}`,
      type: 'layer' as const,
      title: layer.layerName,
      description: `${layer.candidateCount} candidates • ${layer.processingTimeMs.toFixed(0)}ms`,
      confidence: layer.candidateCount > 0 ? 0.8 : 0.3,
      children: reasonNodes,
      isExpanded: true,
    };
  });

  // Build result node
  const resultNode: TreeNode = {
    id: 'result',
    type: 'result',
    title: recommendation.title,
    description: `Score: ${recommendation.score.toFixed(1)} • Rank #${recommendation.rank}`,
    confidence: recommendation.score / 100,
    children: recommendation.reasons.map((reason, idx) => ({
      id: `result-reason-${idx}`,
      type: 'factor' as const,
      title: formatReasonType(reason.reasonType),
      description: reason.description,
      impact: reason.scoreImpact > 0 ? 'positive' : reason.scoreImpact < 0 ? 'negative' : 'neutral',
      confidence: Math.abs(reason.scoreImpact) / 50,
      children: [],
    })),
    isExpanded: true,
  };

  // Root node
  return {
    id: 'root',
    type: 'patient',
    title: 'Patient Context',
    description: `${patientContext.condition_codes?.length || 0} conditions`,
    children: [
      ...patientFactors.length > 0
        ? [{
            id: 'patient-factors',
            type: 'layer' as const,
            title: 'Patient Factors',
            description: `${patientFactors.length} factors considered`,
            children: patientFactors,
            isExpanded: true,
          }]
        : [],
      ...layerNodes,
      resultNode,
    ],
    isExpanded: true,
  };
}

function formatReasonType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function TreeNodeComponent({
  node,
  depth = 0,
  onToggle,
}: {
  node: TreeNode;
  depth?: number;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;

  const getNodeStyle = () => {
    switch (node.type) {
      case 'patient':
        return 'bg-blue-50 border-blue-200 text-blue-900';
      case 'layer':
        return 'bg-purple-50 border-purple-200 text-purple-900';
      case 'factor':
        return node.impact === 'positive'
          ? 'bg-green-50 border-green-200 text-green-900'
          : node.impact === 'negative'
          ? 'bg-red-50 border-red-200 text-red-900'
          : 'bg-gray-50 border-gray-200 text-gray-900';
      case 'result':
        return 'bg-amber-50 border-amber-300 text-amber-900';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getIcon = () => {
    switch (node.type) {
      case 'patient':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        );
      case 'layer':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        );
      case 'factor':
        return node.impact === 'positive' ? (
          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : node.impact === 'negative' ? (
          <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'result':
        return (
          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  return (
    <div className="relative">
      {/* Connector line */}
      {depth > 0 && (
        <div
          className="absolute left-0 top-0 w-4 h-full border-l-2 border-b-2 border-gray-300 rounded-bl"
          style={{ left: -16, top: -8, height: 24 }}
        />
      )}

      <div
        className={`rounded-lg border p-3 mb-2 ${getNodeStyle()} ${
          hasChildren ? 'cursor-pointer' : ''
        }`}
        onClick={() => hasChildren && onToggle(node.id)}
      >
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{node.title}</span>
              {node.confidence !== undefined && node.type === 'result' && (
                <span className="px-1.5 py-0.5 text-xs bg-amber-200 text-amber-800 rounded">
                  {(node.confidence * 100).toFixed(0)}%
                </span>
              )}
              {hasChildren && (
                <svg
                  className={`w-4 h-4 transition-transform ${
                    node.isExpanded ? 'rotate-90' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
            {node.description && (
              <p className="text-xs opacity-75 mt-0.5 truncate">{node.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Children */}
      {hasChildren && node.isExpanded && (
        <div className="ml-6 pl-4 border-l-2 border-gray-200">
          {node.children.map((child) => (
            <TreeNodeComponent
              key={child.id}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function RecommendationTreeModal({
  isOpen,
  onClose,
  recommendation,
  patientContext,
  layerSummaries,
}: RecommendationTreeModalProps) {
  const [tree, setTree] = useState<TreeNode>(() =>
    buildDecisionTree(recommendation, patientContext, layerSummaries)
  );

  const toggleNode = (id: string) => {
    setTree((prev) => {
      const toggle = (node: TreeNode): TreeNode => {
        if (node.id === id) {
          return { ...node, isExpanded: !node.isExpanded };
        }
        return { ...node, children: node.children.map(toggle) };
      };
      return toggle(prev);
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Decision Path</h2>
              <p className="text-sm text-gray-500">
                How this recommendation was selected for the patient
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
            {/* Summary Card */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-4 mb-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{recommendation.title}</h3>
                  <p className="text-sm opacity-90">
                    {recommendation.matchType?.replace('_', ' ')} match •{' '}
                    {recommendation.conditionCodes.slice(0, 3).join(', ')}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">{recommendation.score.toFixed(1)}</div>
                  <div className="text-sm opacity-90">Score</div>
                </div>
              </div>
              {recommendation.variantName && (
                <div className="mt-2 pt-2 border-t border-white/20">
                  <span className="text-sm">
                    Variant: {recommendation.variantName}
                    {recommendation.variantGroupName && ` (${recommendation.variantGroupName})`}
                  </span>
                </div>
              )}
            </div>

            {/* Decision Tree */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Decision Flow</h4>
              <TreeNodeComponent node={tree} onToggle={toggleNode} />
            </div>

            {/* Legend */}
            <div className="mt-6 pt-4 border-t">
              <h4 className="text-xs font-medium text-gray-500 mb-2">Legend</h4>
              <div className="flex flex-wrap gap-3 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-blue-100 border border-blue-200" />
                  <span>Patient Context</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-purple-100 border border-purple-200" />
                  <span>Processing Layer</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-green-100 border border-green-200" />
                  <span>Positive Factor</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-red-100 border border-red-200" />
                  <span>Negative Factor</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-amber-100 border border-amber-200" />
                  <span>Final Recommendation</span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-gray-50 border-t px-6 py-3 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
