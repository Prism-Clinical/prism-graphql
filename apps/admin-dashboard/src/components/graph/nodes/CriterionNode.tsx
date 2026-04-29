import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function CriterionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="Criterion" pathwayNodeId={nodeData.pathwayNodeId} label={nodeData.label} selected={!!selected}>
      {Boolean(props.is_critical) && (
        <div className="text-xs text-red-500 font-medium mt-1">Critical</div>
      )}
    </BaseNode>
  );
}
