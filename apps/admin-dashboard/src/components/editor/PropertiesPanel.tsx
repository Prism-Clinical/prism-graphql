'use client';

import { useCallback } from 'react';
import type { Node } from '@xyflow/react';
import clsx from 'clsx';
import { NODE_CONFIG } from '@/components/graph/nodeConfig';
import { PROPERTY_FIELDS, type PropertyField } from './propertyFields';
import { CodeSearchCombobox } from './CodeSearchCombobox';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { PathwayNodeData, PathwayNodeType } from '@/types';

interface PropertiesPanelProps {
  selectedNode: Node | null;
  onUpdateNode: (nodeId: string, properties: Record<string, unknown>, label: string) => void;
  onClose?: () => void;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: PropertyField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const baseInputClass = 'w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          value={String(value ?? '')}
          onChange={e => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className={clsx(baseInputClass, 'resize-y')}
        />
      );
    case 'select':
      return (
        <select
          value={String(value ?? '')}
          onChange={e => onChange(field.key, e.target.value)}
          className={baseInputClass}
        >
          <option value="">Select...</option>
          {field.options?.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={e => onChange(field.key, e.target.checked)}
            className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
          />
          <span className="text-gray-700">{field.label}</span>
        </label>
      );
    case 'number':
      return (
        <input
          type="number"
          value={value != null ? String(value) : ''}
          onChange={e => onChange(field.key, e.target.value === '' ? null : Number(e.target.value))}
          placeholder={field.placeholder}
          className={baseInputClass}
        />
      );
    default:
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={e => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          className={baseInputClass}
        />
      );
  }
}

export function PropertiesPanel({ selectedNode, onUpdateNode, onClose }: PropertiesPanelProps) {
  const handleFieldChange = useCallback((key: string, value: unknown) => {
    if (!selectedNode) return;
    const nodeData = selectedNode.data as unknown as PathwayNodeData;
    const newProperties = { ...nodeData.properties, [key]: value };

    // Determine the label from the first available title-like field
    const label = String(
      newProperties.title ?? newProperties.name ?? newProperties.description ?? newProperties.code ?? nodeData.label
    );

    onUpdateNode(selectedNode.id, newProperties, label);
  }, [selectedNode, onUpdateNode]);

  if (!selectedNode) {
    return null;
  }

  const nodeData = selectedNode.data as unknown as PathwayNodeData;
  const nodeType = nodeData.pathwayNodeType as PathwayNodeType;
  const config = NODE_CONFIG[nodeType];
  const fields = PROPERTY_FIELDS[nodeType];

  return (
    <div className="w-72 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0">
      {/* Header */}
      <div className={clsx('px-4 py-3 border-b border-gray-200', config.color)}>
        <div className={clsx('flex items-center gap-2', config.textColor)}>
          <span>{config.icon}</span>
          <span className="text-sm font-semibold flex-1">{config.label}</span>
          {onClose && (
            <button
              onClick={onClose}
              className={clsx('p-0.5 rounded hover:bg-black/10 transition-colors', config.textColor)}
              title="Close properties"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className={clsx('text-xs mt-0.5 opacity-80', config.textColor)}>
          ID: {nodeData.pathwayNodeId}
        </div>
      </div>

      {/* Fields */}
      <div className="p-4 space-y-3">
        {fields.map(field => {
          // Use CodeSearchCombobox for code value fields on CodeEntry, Criterion, LabTest, Procedure
          const isCodeField =
            (field.key === 'code' && nodeType === 'CodeEntry') ||
            (field.key === 'code_value' && ['Criterion', 'LabTest', 'Procedure'].includes(nodeType));

          if (isCodeField) {
            const systemKey = nodeType === 'CodeEntry' ? 'system' : 'code_system';
            const codeSystem = String(nodeData.properties[systemKey] ?? '');

            return (
              <div key={field.key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <CodeSearchCombobox
                  system={codeSystem || undefined}
                  value={
                    nodeData.properties[field.key]
                      ? { code: String(nodeData.properties[field.key]), system: codeSystem }
                      : undefined
                  }
                  onChange={(selected) => {
                    // Update both code and description from the selection
                    const descKey = nodeType === 'CodeEntry' ? 'description' : undefined;
                    handleFieldChange(field.key, selected.code);
                    if (descKey) {
                      handleFieldChange(descKey, selected.display);
                    }
                  }}
                  placeholder={field.placeholder}
                />
              </div>
            );
          }

          return (
            <div key={field.key}>
              {field.type !== 'checkbox' && (
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
              )}
              <FieldInput
                field={field}
                value={nodeData.properties[field.key]}
                onChange={handleFieldChange}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
