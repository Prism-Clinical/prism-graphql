import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function DecisionPointNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="DecisionPoint" pathwayNodeId={nodeData.pathwayNodeId} label={nodeData.label} selected={!!selected}>
      {Boolean(props.auto_resolve_eligible) && (
        <div className="text-xs text-amber-600 mt-1">Auto-resolvable</div>
      )}
    </BaseNode>
  );
}
