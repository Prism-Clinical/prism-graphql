import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import clsx from 'clsx';
import type { PathwayNodeData } from '@/types';

const roleBadge: Record<string, string> = {
  first_line: 'bg-green-100 text-green-700',
  second_line: 'bg-teal-100 text-teal-700',
  alternative: 'bg-blue-100 text-blue-700',
  preferred: 'bg-green-100 text-green-700',
  acceptable: 'bg-blue-100 text-blue-700',
  avoid: 'bg-yellow-100 text-yellow-700',
  contraindicated: 'bg-red-100 text-red-700',
};

export function MedicationNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as PathwayNodeData;
  const props = nodeData.properties;
  const role = String(props.role ?? 'acceptable');

  return (
    <BaseNode pathwayNodeType="Medication" pathwayNodeId={nodeData.pathwayNodeId} label={nodeData.label} selected={!!selected}>
      <div className="flex items-center gap-2 mt-1">
        <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium', roleBadge[role] ?? 'bg-gray-100 text-gray-600')}>
          {role}
        </span>
      </div>
      {Boolean(props.dose) && (
        <div className="text-xs text-gray-500 mt-1">{String(props.dose)}</div>
      )}
    </BaseNode>
  );
}
