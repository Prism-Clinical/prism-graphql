import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function EvidenceCitationNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="EvidenceCitation" label={nodeData.label} selected={!!selected}>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs font-mono text-indigo-600">[{String(props.reference_number ?? '?')}]</span>
        <span className="text-xs text-gray-500">{String(props.evidence_level ?? '')}</span>
      </div>
    </BaseNode>
  );
}
