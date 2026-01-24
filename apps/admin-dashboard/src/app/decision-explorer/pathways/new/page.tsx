'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useCreatePathway, useCreatePathwayNode, PathwayNodeType, PathwayActionType } from '@/lib/hooks/usePathways';

interface PathwayNodeForm {
  id: string;
  title: string;
  description: string;
  nodeType: PathwayNodeType;
  actionType?: PathwayActionType;
  baseConfidence: number;
  children: PathwayNodeForm[];
  isExpanded: boolean;
}

const generateId = () => `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const nodeTypeOptions = [
  { value: 'DECISION', label: 'Decision Point' },
  { value: 'BRANCH', label: 'Action/Branch' },
  { value: 'RECOMMENDATION', label: 'Care Plan Recommendation' },
];

const actionTypeOptions = [
  { value: 'MEDICATION', label: 'Medication' },
  { value: 'LAB', label: 'Lab Order' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'PROCEDURE', label: 'Procedure' },
  { value: 'EDUCATION', label: 'Patient Education' },
  { value: 'MONITORING', label: 'Monitoring' },
];

export default function NewPathwayPage() {
  const router = useRouter();
  const { create: createPathway, loading: createLoading } = useCreatePathway();
  const { create: createPathwayNode, loading: nodeLoading } = useCreatePathwayNode();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [conditionCodes, setConditionCodes] = useState<string[]>(['']);
  const [version, setVersion] = useState('1.0');
  const [evidenceSource, setEvidenceSource] = useState('');
  const [evidenceGrade, setEvidenceGrade] = useState('');

  // Root node for tree building
  const [rootNode, setRootNode] = useState<PathwayNodeForm>({
    id: generateId(),
    title: '',
    description: '',
    nodeType: PathwayNodeType.ROOT,
    baseConfidence: 0.7,
    children: [],
    isExpanded: true,
  });

  const [error, setError] = useState<string | null>(null);

  // Add condition code input
  const handleAddConditionCode = () => {
    setConditionCodes([...conditionCodes, '']);
  };

  const handleRemoveConditionCode = (index: number) => {
    setConditionCodes(conditionCodes.filter((_, i) => i !== index));
  };

  const handleConditionCodeChange = (index: number, value: string) => {
    const updated = [...conditionCodes];
    updated[index] = value;
    setConditionCodes(updated);
  };

  // Node tree manipulation
  const updateNode = useCallback((nodeId: string, updates: Partial<PathwayNodeForm>) => {
    const updateRecursive = (node: PathwayNodeForm): PathwayNodeForm => {
      if (node.id === nodeId) {
        return { ...node, ...updates };
      }
      return {
        ...node,
        children: node.children.map(updateRecursive),
      };
    };
    setRootNode((prev) => updateRecursive(prev));
  }, []);

  const addChildNode = useCallback((parentId: string) => {
    const newNode: PathwayNodeForm = {
      id: generateId(),
      title: '',
      description: '',
      nodeType: PathwayNodeType.BRANCH,
      baseConfidence: 0.7,
      children: [],
      isExpanded: true,
    };

    const addRecursive = (node: PathwayNodeForm): PathwayNodeForm => {
      if (node.id === parentId) {
        return {
          ...node,
          children: [...node.children, newNode],
          isExpanded: true,
        };
      }
      return {
        ...node,
        children: node.children.map(addRecursive),
      };
    };
    setRootNode((prev) => addRecursive(prev));
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    const removeRecursive = (node: PathwayNodeForm): PathwayNodeForm => {
      return {
        ...node,
        children: node.children
          .filter((child) => child.id !== nodeId)
          .map(removeRecursive),
      };
    };
    setRootNode((prev) => removeRecursive(prev));
  }, []);

  const toggleNodeExpand = useCallback((nodeId: string) => {
    updateNode(nodeId, {});
    setRootNode((prev) => {
      const toggleRecursive = (node: PathwayNodeForm): PathwayNodeForm => {
        if (node.id === nodeId) {
          return { ...node, isExpanded: !node.isExpanded };
        }
        return {
          ...node,
          children: node.children.map(toggleRecursive),
        };
      };
      return toggleRecursive(prev);
    });
  }, [updateNode]);

  // Submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate
    if (!name.trim()) {
      setError('Pathway name is required');
      return;
    }

    const validCodes = conditionCodes.filter((c) => c.trim());
    if (validCodes.length === 0) {
      setError('At least one condition code is required');
      return;
    }

    if (!rootNode.title.trim()) {
      setError('Root node title is required');
      return;
    }

    try {
      // Create pathway
      const pathway = await createPathway({
        name: name.trim(),
        description: description.trim() || undefined,
        primaryConditionCodes: validCodes,
        version: version.trim() || '1.0',
        evidenceSource: evidenceSource.trim() || undefined,
        evidenceGrade: evidenceGrade.trim() || undefined,
      });

      if (!pathway) {
        throw new Error('Failed to create pathway');
      }

      // Create nodes recursively
      const createNodesRecursive = async (
        node: PathwayNodeForm,
        parentNodeId: string | null,
        sortOrder: number
      ) => {
        const createdNode = await createPathwayNode({
          pathwayId: pathway.id,
          parentNodeId: parentNodeId || undefined,
          nodeType: node.nodeType,
          title: node.title.trim(),
          description: node.description.trim() || undefined,
          actionType: node.actionType || undefined,
          baseConfidence: node.baseConfidence,
          sortOrder,
        });

        if (!createdNode) {
          throw new Error(`Failed to create node: ${node.title}`);
        }

        // Create children
        for (let i = 0; i < node.children.length; i++) {
          await createNodesRecursive(node.children[i], createdNode.id, i);
        }
      };

      // Create root node and its children
      await createNodesRecursive(rootNode, null, 0);

      // Redirect to pathway edit page
      router.push(`/decision-explorer/pathways/${pathway.id}`);
    } catch (err) {
      console.error('Failed to create pathway:', err);
      setError(err instanceof Error ? err.message : 'Failed to create pathway');
    }
  };

  // Render a single node in the tree editor
  const renderNodeEditor = (node: PathwayNodeForm, depth: number = 0) => {
    const isRoot = node.nodeType === 'ROOT';

    return (
      <div key={node.id} className="space-y-2">
        <div
          className={`rounded-lg border ${
            isRoot
              ? 'border-yellow-300 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-900/20'
              : node.nodeType === 'RECOMMENDATION'
              ? 'border-green-300 dark:border-green-600 bg-green-50 dark:bg-green-900/20'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
          }`}
          style={{ marginLeft: `${depth * 24}px` }}
        >
          <div className="p-4">
            {/* Node header */}
            <div className="flex items-center gap-3 mb-3">
              {node.children.length > 0 && (
                <button
                  type="button"
                  onClick={() => toggleNodeExpand(node.id)}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {node.isExpanded ? (
                    <ChevronDownIcon className="h-4 w-4 text-gray-500" />
                  ) : (
                    <ChevronRightIcon className="h-4 w-4 text-gray-500" />
                  )}
                </button>
              )}

              <span
                className={`px-2 py-0.5 text-xs font-medium rounded ${
                  isRoot
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    : node.nodeType === 'RECOMMENDATION'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : node.nodeType === 'DECISION'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                }`}
              >
                {isRoot ? 'Root' : node.nodeType}
              </span>

              {!isRoot && (
                <select
                  value={node.nodeType}
                  onChange={(e) =>
                    updateNode(node.id, { nodeType: e.target.value as PathwayNodeForm['nodeType'] })
                  }
                  className="text-sm border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700"
                >
                  {nodeTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              <div className="flex-1" />

              {!isRoot && (
                <button
                  type="button"
                  onClick={() => removeNode(node.id)}
                  className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  title="Remove node"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Node fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title *
                </label>
                <Input
                  value={node.title}
                  onChange={(e) => updateNode(node.id, { title: e.target.value })}
                  placeholder={isRoot ? 'Diagnosis name' : 'Node title'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Confidence
                </label>
                <Input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={node.baseConfidence}
                  onChange={(e) =>
                    updateNode(node.id, { baseConfidence: parseFloat(e.target.value) || 0.7 })
                  }
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={node.description}
                onChange={(e) => updateNode(node.id, { description: e.target.value })}
                placeholder="Describe this node..."
                rows={2}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              />
            </div>

            {(node.nodeType === 'BRANCH' || node.nodeType === 'RECOMMENDATION') && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Action Type
                </label>
                <select
                  value={node.actionType || ''}
                  onChange={(e) => updateNode(node.id, { actionType: (e.target.value || undefined) as PathwayActionType | undefined })}
                  className="w-full text-sm border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700"
                >
                  <option value="">Select action type...</option>
                  {actionTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Add child button */}
            {node.nodeType !== 'RECOMMENDATION' && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => addChildNode(node.id)}
                  className="inline-flex items-center text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400"
                >
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Add child node
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Children */}
        {node.isExpanded && node.children.length > 0 && (
          <div className="space-y-2">
            {node.children.map((child) => renderNodeEditor(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/decision-explorer/pathways">
          <Button variant="ghost" size="sm">
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Create Clinical Pathway
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Define a new decision tree pathway for clinical guidance
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Pathway Name *
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Type 2 Diabetes Management"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Version
                </label>
                <Input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the clinical pathway..."
                rows={3}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Condition Codes (ICD-10/SNOMED) *
              </label>
              <div className="space-y-2">
                {conditionCodes.map((code, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={code}
                      onChange={(e) => handleConditionCodeChange(index, e.target.value)}
                      placeholder="e.g., E11.9"
                      className="flex-1"
                    />
                    {conditionCodes.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveConditionCode(index)}
                      >
                        <TrashIcon className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={handleAddConditionCode}>
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Add Code
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Evidence Source
                </label>
                <Input
                  value={evidenceSource}
                  onChange={(e) => setEvidenceSource(e.target.value)}
                  placeholder="e.g., ADA Standards of Care 2024"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Evidence Grade
                </label>
                <select
                  value={evidenceGrade}
                  onChange={(e) => setEvidenceGrade(e.target.value)}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                >
                  <option value="">Select grade...</option>
                  <option value="A">Grade A - Strong recommendation</option>
                  <option value="B">Grade B - Moderate recommendation</option>
                  <option value="C">Grade C - Weak recommendation</option>
                  <option value="E">Grade E - Expert consensus</option>
                </select>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Decision Tree */}
        <Card>
          <CardHeader>
            <CardTitle>Decision Tree</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Build your clinical pathway decision tree. Start with the root diagnosis, then add
              decision points, branches, and recommendations.
            </p>
            {renderNodeEditor(rootNode)}
          </CardBody>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Link href="/decision-explorer/pathways">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={createLoading || nodeLoading}>
            {(createLoading || nodeLoading) && <Spinner size="sm" className="mr-2" />}
            Create Pathway
          </Button>
        </div>
      </form>
    </div>
  );
}
