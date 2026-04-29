import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function QualityMetricNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="QualityMetric" label={nodeData.label} selected={!!selected}>
      {Boolean(props.measure) && (
        <div className="text-xs text-gray-500 mt-1 line-clamp-2">{String(props.measure)}</div>
      )}
    </BaseNode>
  );
}
