import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function ProcedureNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="Procedure" pathwayNodeId={nodeData.pathwayNodeId} label={nodeData.label} selected={!!selected}>
      {Boolean(props.code_value) && (
        <div className="text-xs text-orange-600 font-mono mt-1">
          {String(props.code_system ?? '')}: {String(props.code_value)}
        </div>
      )}
    </BaseNode>
  );
}
