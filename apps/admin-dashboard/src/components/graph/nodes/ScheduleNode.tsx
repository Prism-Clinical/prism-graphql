import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function ScheduleNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="Schedule" label={nodeData.label} selected={!!selected}>
      <div className="text-xs text-cyan-600 mt-1">{String(props.interval ?? '')}</div>
    </BaseNode>
  );
}
