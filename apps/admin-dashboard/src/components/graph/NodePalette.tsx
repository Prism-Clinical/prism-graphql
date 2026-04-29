'use client';

import clsx from 'clsx';
import { NODE_CONFIG, NODE_CATEGORIES } from './nodeConfig';
import type { PathwayNodeType } from '@/types';

const categoryLabels: Record<string, string> = {
  structural: 'Structural',
  clinical: 'Clinical',
  supporting: 'Supporting',
};

function PaletteItem({ nodeType }: { nodeType: PathwayNodeType }) {
  const config = NODE_CONFIG[nodeType];

  function onDragStart(event: React.DragEvent) {
    event.dataTransfer.setData('application/reactflow-nodetype', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={clsx(
        'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing',
        'hover:shadow-sm transition-all text-sm',
        config.borderColor,
        config.bgColor
      )}
    >
      <span>{config.icon}</span>
      <span className="font-medium text-gray-700">{config.label}</span>
    </div>
  );
}

export function NodePalette() {
  return (
    <div className="w-56 bg-white border-r border-gray-200 p-4 overflow-y-auto flex-shrink-0">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Node Palette
      </h3>
      <p className="text-xs text-gray-400 mb-4">Drag nodes onto the canvas</p>

      {Object.entries(NODE_CATEGORIES).map(([category, types]) => (
        <div key={category} className="mb-4">
          <h4 className="text-xs font-medium text-gray-500 mb-2">
            {categoryLabels[category]}
          </h4>
          <div className="space-y-1.5">
            {types.map(nodeType => (
              <PaletteItem key={nodeType} nodeType={nodeType} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
