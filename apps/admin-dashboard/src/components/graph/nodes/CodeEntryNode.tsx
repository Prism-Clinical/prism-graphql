import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function CodeEntryNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="CodeEntry" label={String(props.code ?? nodeData.label)} selected={!!selected}>
      <div className="text-xs text-slate-600 font-mono">
        {String(props.system ?? '')}
      </div>
      {Boolean(props.description) && (
        <div className="text-xs text-gray-500 mt-0.5 truncate">{String(props.description)}</div>
      )}
    </BaseNode>
  );
}
