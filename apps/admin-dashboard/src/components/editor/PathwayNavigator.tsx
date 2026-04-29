'use client';

import { useState, useMemo } from 'react';
import clsx from 'clsx';
import type { Node, Edge } from '@xyflow/react';
import { NODE_CONFIG } from '@/components/graph/nodeConfig';
import { useEvidenceStatus, EVIDENCE_ELIGIBLE_TYPES } from '@/components/graph/EvidenceStatusContext';
import type { PathwayNodeData, PathwayNodeType } from '@/types';
import { ChevronRightIcon, ChevronLeftIcon, ChevronDownIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface PathwayNavigatorProps {
  nodes: Node[];
  edges: Edge[];
  activeScopeId: string | null;
  onScopeChange: (nodeId: string | null) => void;
  readOnly?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface StageEntry {
  node: Node;
  label: string;
  childCount: number;
  steps: StepEntry[];
}

interface StepEntry {
  node: Node;
  label: string;
  childCount: number;
}

/**
 * Count all descendants reachable from a node via outgoing edges (BFS).
 */
function countDescendants(nodeId: string, edges: Edge[]): number {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const targets = adjacency.get(e.source);
    if (targets) targets.push(e.target);
    else adjacency.set(e.source, [e.target]);
  }

  const visited = new Set<string>();
  const queue = [nodeId];
  visited.add(nodeId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = adjacency.get(current);
    if (children) {
      for (const child of children) {
        if (!visited.has(child)) {
          visited.add(child);
          queue.push(child);
        }
      }
    }
  }

  // Don't count the node itself
  return visited.size - 1;
}

export function PathwayNavigator({
  nodes,
  edges,
  activeScopeId,
  onScopeChange,
  isCollapsed = false,
  onToggleCollapse,
}: PathwayNavigatorProps) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [evidenceIssuesExpanded, setEvidenceIssuesExpanded] = useState(true);
  const [seeAllGroup, setSeeAllGroup] = useState<{ label: string; icon: string; nodes: { id: string; label: string }[] } | null>(null);
  const { nodesWithEvidence, isEligible, openQuickAddEvidence } = useEvidenceStatus();

  // Build Stage -> Step hierarchy from nodes/edges
  const { stages, unconnectedNodes } = useMemo(() => {
    const stageNodes = nodes.filter(
      (n) => (n.data as PathwayNodeData).pathwayNodeType === 'Stage',
    );

    // Find Step children for each Stage via HAS_STEP edges
    const stageStepEdges = edges.filter(
      (e) => (e.data as { pathwayEdgeType?: string } | undefined)?.pathwayEdgeType === 'HAS_STEP',
    );

    // Build a set of all node IDs reachable from any Stage
    const connectedNodeIds = new Set<string>();

    // All stages are connected by definition
    for (const s of stageNodes) {
      connectedNodeIds.add(s.id);
    }

    // Build adjacency for descendant counting
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      const targets = adjacency.get(e.source);
      if (targets) targets.push(e.target);
      else adjacency.set(e.source, [e.target]);
    }

    // Mark all descendants of stages as connected
    for (const stage of stageNodes) {
      const queue = [stage.id];
      const visited = new Set<string>([stage.id]);
      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = adjacency.get(current);
        if (children) {
          for (const child of children) {
            if (!visited.has(child)) {
              visited.add(child);
              connectedNodeIds.add(child);
              queue.push(child);
            }
          }
        }
      }
    }

    const stages: StageEntry[] = stageNodes.map((stageNode) => {
      const stageData = stageNode.data as PathwayNodeData;
      const stepNodeIds = stageStepEdges
        .filter((e) => e.source === stageNode.id)
        .map((e) => e.target);

      const steps: StepEntry[] = stepNodeIds
        .map((stepId) => {
          const stepNode = nodes.find((n) => n.id === stepId);
          if (!stepNode) return null;
          const stepData = stepNode.data as PathwayNodeData;
          return {
            node: stepNode,
            label: stepData.label || 'Unnamed Step',
            childCount: countDescendants(stepNode.id, edges),
          };
        })
        .filter(Boolean) as StepEntry[];

      return {
        node: stageNode,
        label: stageData.label || 'Unnamed Stage',
        childCount: countDescendants(stageNode.id, edges),
        steps,
      };
    });

    // Sort stages by stage_number if available
    stages.sort((a, b) => {
      const aNum = (a.node.data as PathwayNodeData).properties?.stage_number;
      const bNum = (b.node.data as PathwayNodeData).properties?.stage_number;
      if (typeof aNum === 'number' && typeof bNum === 'number') return aNum - bNum;
      return 0;
    });

    // Unconnected nodes: not reachable from any Stage
    const unconnectedNodes = nodes.filter((n) => !connectedNodeIds.has(n.id));

    return { stages, unconnectedNodes };
  }, [nodes, edges]);

  // Compute missing-evidence data for the Evidence Issues section
  const EVIDENCE_GROUP_ORDER: PathwayNodeType[] = [
    'Stage', 'Step', 'DecisionPoint', 'Criterion', 'Medication', 'LabTest', 'Procedure',
  ];

  const { missingCount, evidenceIssueGroups } = useMemo(() => {
    const nodesMissingEvidence = nodes.filter((n) => {
      const data = n.data as PathwayNodeData;
      return EVIDENCE_ELIGIBLE_TYPES.has(data.pathwayNodeType) && !nodesWithEvidence.has(n.id);
    });

    const missingCount = nodesMissingEvidence.length;

    // Group by pathwayNodeType
    const grouped = new Map<PathwayNodeType, { id: string; label: string }[]>();
    for (const n of nodesMissingEvidence) {
      const data = n.data as PathwayNodeData;
      const key = data.pathwayNodeType;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push({ id: n.id, label: data.label || n.id });
    }

    const evidenceIssueGroups = EVIDENCE_GROUP_ORDER
      .filter((type) => grouped.has(type))
      .map((type) => {
        const config = NODE_CONFIG[type];
        return {
          nodeType: type,
          label: config.label,
          icon: config.icon,
          nodes: grouped.get(type)!,
        };
      });

    return { missingCount, evidenceIssueGroups };
  }, [nodes, nodesWithEvidence]);

  const toggleExpand = (stageId: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  };

  const hasContent = stages.length > 0 || unconnectedNodes.length > 0;

  if (isCollapsed) {
    return (
      <div className="w-10 bg-white border-r border-gray-200 flex flex-col items-center flex-shrink-0 transition-all duration-200">
        <button
          onClick={onToggleCollapse}
          className="p-2 mt-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          title="Expand navigator"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3" style={{ writingMode: 'vertical-rl' }}>
          Navigator
        </span>
      </div>
    );
  }

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col overflow-hidden flex-shrink-0 transition-all duration-200">
      <div className="p-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Navigator
          </h3>
          <div className="flex items-center gap-2">
            {missingCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                {missingCount} missing
              </span>
            )}
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                title="Collapse navigator"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {/* Show All button */}
        <button
          onClick={() => onScopeChange(null)}
          className={clsx(
            'w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1',
            activeScopeId === null
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'text-gray-600 hover:bg-gray-50',
          )}
        >
          Show All
          <span className="ml-2 text-xs text-gray-400">({nodes.length})</span>
        </button>

        {!hasContent && (
          <p className="text-xs text-gray-400 px-3 py-4 text-center">
            No stages yet. Add Stage nodes to build your pathway.
          </p>
        )}

        {/* Stages */}
        {stages.map((stage) => {
          const isExpanded = expandedStages.has(stage.node.id);
          const isActive = activeScopeId === stage.node.id;
          const stageConfig = NODE_CONFIG.Stage;

          return (
            <div key={stage.node.id} className="mb-0.5">
              <div
                className={clsx(
                  'flex items-center rounded-lg transition-colors',
                  isActive
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-gray-50',
                )}
              >
                {/* Chevron toggle */}
                <button
                  onClick={() => toggleExpand(stage.node.id)}
                  className="p-1.5 flex-shrink-0 text-gray-400 hover:text-gray-600"
                >
                  {isExpanded ? (
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRightIcon className="h-3.5 w-3.5" />
                  )}
                </button>

                {/* Stage label — click to scope */}
                <button
                  onClick={() => onScopeChange(stage.node.id)}
                  className="flex-1 flex items-center gap-2 py-2 pr-3 text-left min-w-0"
                >
                  <span className="flex-shrink-0">{stageConfig.icon}</span>
                  <span className="text-sm font-medium text-gray-700 truncate">
                    {stage.label}
                  </span>
                  <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
                    {stage.childCount + 1}
                  </span>
                </button>
                {isEligible('Stage') && !nodesWithEvidence.has(stage.node.id) && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0 mr-2"
                    title="Missing evidence"
                  />
                )}
              </div>

              {/* Steps under this Stage */}
              {isExpanded && stage.steps.length > 0 && (
                <div className="ml-4 pl-2 border-l border-gray-100">
                  {stage.steps.map((step) => {
                    const isStepActive = activeScopeId === step.node.id;
                    const stepConfig = NODE_CONFIG.Step;

                    return (
                      <div
                        key={step.node.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onScopeChange(step.node.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onScopeChange(step.node.id); } }}
                        className={clsx(
                          'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-colors cursor-pointer',
                          isStepActive
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'text-gray-600 hover:bg-gray-50',
                        )}
                      >
                        <span className="flex-shrink-0 text-xs">{stepConfig.icon}</span>
                        <span className="text-xs truncate">{step.label}</span>
                        {isEligible('Step') && !nodesWithEvidence.has(step.node.id) && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0"
                            title="Missing evidence"
                          />
                        )}
                        <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
                          {step.childCount + 1}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Evidence Issues */}
        {missingCount > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <button
              onClick={() => setEvidenceIssuesExpanded(!evidenceIssuesExpanded)}
              className="w-full flex items-center gap-1.5 px-3 py-1 text-amber-700 hover:text-amber-800"
            >
              {evidenceIssuesExpanded ? (
                <ChevronDownIcon className="h-3.5 w-3.5 flex-shrink-0" />
              ) : (
                <ChevronRightIcon className="h-3.5 w-3.5 flex-shrink-0" />
              )}
              <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
              <span className="text-xs font-medium uppercase tracking-wider">
                Evidence Issues
              </span>
              <span className="ml-auto text-xs font-medium">{missingCount}</span>
            </button>

            {evidenceIssuesExpanded && (
              <div className="mt-1">
                {evidenceIssueGroups.map((group) => {
                  const preview = group.nodes.slice(0, 2);
                  const remaining = group.nodes.length - preview.length;

                  return (
                    <div key={group.nodeType} className="mb-2">
                      {/* Group subheader */}
                      <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gray-500">
                        <span>{group.icon}</span>
                        <span>{group.label}</span>
                        <span className="text-gray-400">({group.nodes.length})</span>
                      </div>
                      {/* First 2 nodes */}
                      {preview.map((node) => (
                        <button
                          key={node.id}
                          onClick={() => openQuickAddEvidence(node.id, node.label)}
                          className="group w-full flex items-center gap-2 px-3 py-1 ml-4 text-xs text-gray-600 hover:bg-amber-50 rounded-md transition-colors cursor-pointer"
                        >
                          <span className="truncate">{node.label}</span>
                          <span className="ml-auto text-xs text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            + Add
                          </span>
                        </button>
                      ))}
                      {/* See all link */}
                      {remaining > 0 && (
                        <button
                          onClick={() => setSeeAllGroup(group)}
                          className="w-full text-left px-3 py-1 ml-4 text-xs text-amber-600 hover:text-amber-700 hover:underline cursor-pointer"
                        >
                          See all {group.nodes.length} {group.label.toLowerCase()}s&hellip;
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Unconnected Nodes */}
        {unconnectedNodes.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-400 px-3 mb-1 uppercase tracking-wider">
              Unconnected
            </p>
            {unconnectedNodes.map((node) => {
              const data = node.data as PathwayNodeData;
              const config = NODE_CONFIG[data.pathwayNodeType];
              return (
                <div
                  key={node.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500"
                >
                  <span>{config?.icon ?? '?'}</span>
                  <span className="truncate">{data.label || node.id}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>


      {/* See All modal for a single evidence-issue group */}
      {seeAllGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSeeAllGroup(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-base">{seeAllGroup.icon}</span>
                <h3 className="text-sm font-semibold text-gray-900">
                  {seeAllGroup.label}s Missing Evidence
                </h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  {seeAllGroup.nodes.length}
                </span>
              </div>
              <button
                onClick={() => setSeeAllGroup(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            {/* Body */}
            <div className="max-h-80 overflow-y-auto px-2 py-2">
              {seeAllGroup.nodes.map((node) => (
                <button
                  key={node.id}
                  onClick={() => {
                    openQuickAddEvidence(node.id, node.label);
                    setSeeAllGroup(null);
                  }}
                  className="group w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                >
                  <span className="truncate">{node.label}</span>
                  <span className="ml-auto text-xs text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    + Add evidence
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
