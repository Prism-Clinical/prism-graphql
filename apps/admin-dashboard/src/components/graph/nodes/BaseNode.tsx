import { Handle, Position } from '@xyflow/react';
import clsx from 'clsx';
import { ExclamationTriangleIcon } from '@heroicons/react/20/solid';
import { NODE_CONFIG } from '../nodeConfig';
import { useEvidenceStatus } from '../EvidenceStatusContext';
import type { PathwayNodeType } from '@/types';

interface BaseNodeProps {
  pathwayNodeType: PathwayNodeType;
  pathwayNodeId?: string;
  label: string;
  selected: boolean;
  children?: React.ReactNode;
}

export function BaseNode({ pathwayNodeType, pathwayNodeId, label, selected, children }: BaseNodeProps) {
  const config = NODE_CONFIG[pathwayNodeType];
  const { nodesWithEvidence, isEligible, openQuickAddEvidence } = useEvidenceStatus();

  const showNoEvidence =
    pathwayNodeId != null &&
    isEligible(pathwayNodeType) &&
    !nodesWithEvidence.has(pathwayNodeId);

  return (
    <div
      className={clsx(
        'relative rounded-xl border-2 shadow-sm min-w-[140px] max-w-[280px] transition-shadow',
        config.borderColor,
        config.bgColor,
        selected && 'ring-2 ring-blue-500 ring-offset-2 shadow-md'
      )}
    >
      {/* No-evidence indicator */}
      {showNoEvidence && (
        <button
          className="absolute top-1.5 right-1.5 text-amber-500 hover:text-amber-400 drop-shadow-sm transition-colors cursor-pointer"
          title="Missing evidence — click to add"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            openQuickAddEvidence(pathwayNodeId!, label);
          }}
        >
          <ExclamationTriangleIcon className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Header */}
      <div className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-t-[10px] text-xs font-semibold',
        config.color,
        config.textColor
      )}>
        <span>{config.icon}</span>
        <span>{config.label}</span>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <div className="text-sm font-medium text-gray-900 truncate">{label}</div>
        {children}
      </div>

      {/* Handles */}
      {config.canBeTarget && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
        />
      )}
      {config.canBeSource && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
        />
      )}
    </div>
  );
}
