import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function StepNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="Step" pathwayNodeId={nodeData.pathwayNodeId} label={nodeData.label} selected={!!selected}>
      {Boolean(props.description) && (
        <div className="text-xs text-gray-500 mt-1 line-clamp-2">{String(props.description)}</div>
      )}
      <div className="text-xs text-emerald-600 font-mono mt-1">{String(props.display_number ?? '?')}</div>
    </BaseNode>
  );
}
