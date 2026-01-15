'use client';

import { useState, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  EyeIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import {
  usePathway,
  usePathwayNodes,
  useUpdatePathway,
  usePublishPathway,
  useCreatePathwayNode,
  useUpdatePathwayNode,
  useDeletePathwayNode,
  PathwayNode,
} from '@/lib/hooks/usePathways';

interface PathwayNodeForm {
  id: string;
  isNew?: boolean;
  title: string;
  description: string;
  nodeType: 'ROOT' | 'DECISION' | 'BRANCH' | 'RECOMMENDATION';
  actionType?: string;
  baseConfidence: number;
  parentNodeId?: string;
  sortOrder: number;
  children: PathwayNodeForm[];
  isExpanded: boolean;
  isDirty?: boolean;
}

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

const generateTempId = () => `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Build a tree structure from flat nodes list
function buildNodeTree(nodes: PathwayNode[]): PathwayNodeForm | null {
  if (nodes.length === 0) return null;

  const nodeMap = new Map<string, PathwayNodeForm>();
  const childrenMap = new Map<string, PathwayNodeForm[]>();

  // First pass: create node forms and group by parent
  nodes.forEach((node) => {
    const form: PathwayNodeForm = {
      id: node.id,
      isNew: false,
      title: node.title,
      description: node.description || '',
      nodeType: node.nodeType as PathwayNodeForm['nodeType'],
      actionType: node.actionType || undefined,
      baseConfidence: node.baseConfidence,
      parentNodeId: node.parentNodeId || undefined,
      sortOrder: node.sortOrder,
      children: [],
      isExpanded: true,
      isDirty: false,
    };
    nodeMap.set(node.id, form);

    const parentId = node.parentNodeId || 'root';
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(form);
  });

  // Second pass: build tree
  nodeMap.forEach((form) => {
    const children = childrenMap.get(form.id) || [];
    form.children = children.sort((a, b) => a.sortOrder - b.sortOrder);
  });

  // Find root node
  const rootNodes = childrenMap.get('root') || [];
  if (rootNodes.length === 0) {
    // If no explicit root, find node with no parent
    const orphans = Array.from(nodeMap.values()).filter((n) => !n.parentNodeId);
    return orphans[0] || null;
  }

  return rootNodes.sort((a, b) => a.sortOrder - b.sortOrder)[0] || null;
}

export default function EditPathwayPage() {
  const params = useParams();
  const router = useRouter();
  const pathwayId = params.id as string;

  // Data fetching hooks
  const { pathway, loading: pathwayLoading, error: pathwayError, refetch: refetchPathway } = usePathway(pathwayId);
  const { nodes, loading: nodesLoading, refetch: refetchNodes } = usePathwayNodes(pathwayId);

  // Mutation hooks
  const { update: updatePathway, loading: updateLoading } = useUpdatePathway();
  const { publish, unpublish, loading: publishLoading } = usePublishPathway();
  const { create: createPathwayNode, loading: createNodeLoading } = useCreatePathwayNode();
  const { update: updatePathwayNode, loading: updateNodeLoading } = useUpdatePathwayNode();
  const { deleteNode: deletePathwayNode, loading: deleteNodeLoading } = useDeletePathwayNode();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [conditionCodes, setConditionCodes] = useState<string[]>(['']);
  const [version, setVersion] = useState('');
  const [evidenceSource, setEvidenceSource] = useState('');
  const [evidenceGrade, setEvidenceGrade] = useState('');
  const [rootNode, setRootNode] = useState<PathwayNodeForm | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize form when data loads
  useEffect(() => {
    if (pathway) {
      setName(pathway.name);
      setDescription(pathway.description || '');
      setConditionCodes(pathway.primaryConditionCodes.length > 0 ? pathway.primaryConditionCodes : ['']);
      setVersion(pathway.version);
      setEvidenceSource(pathway.evidenceSource || '');
      setEvidenceGrade(pathway.evidenceGrade || '');
    }
  }, [pathway]);

  useEffect(() => {
    if (nodes && nodes.length > 0) {
      const tree = buildNodeTree(nodes);
      setRootNode(tree);
    } else if (nodes && nodes.length === 0 && pathway) {
      // No nodes yet, create default root
      setRootNode({
        id: generateTempId(),
        isNew: true,
        title: pathway.name,
        description: pathway.description || '',
        nodeType: 'ROOT',
        baseConfidence: 0.9,
        sortOrder: 0,
        children: [],
        isExpanded: true,
        isDirty: true,
      });
    }
  }, [nodes, pathway]);

  // Condition codes handlers
  const handleAddConditionCode = () => {
    setConditionCodes([...conditionCodes, '']);
    setHasChanges(true);
  };

  const handleRemoveConditionCode = (index: number) => {
    setConditionCodes(conditionCodes.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleConditionCodeChange = (index: number, value: string) => {
    const updated = [...conditionCodes];
    updated[index] = value;
    setConditionCodes(updated);
    setHasChanges(true);
  };

  // Node tree manipulation
  const updateNode = useCallback((nodeId: string, updates: Partial<PathwayNodeForm>) => {
    const updateRecursive = (node: PathwayNodeForm): PathwayNodeForm => {
      if (node.id === nodeId) {
        return { ...node, ...updates, isDirty: true };
      }
      return {
        ...node,
        children: node.children.map(updateRecursive),
      };
    };
    setRootNode((prev) => (prev ? updateRecursive(prev) : prev));
    setHasChanges(true);
  }, []);

  const addChildNode = useCallback((parentId: string) => {
    const newNode: PathwayNodeForm = {
      id: generateTempId(),
      isNew: true,
      title: '',
      description: '',
      nodeType: 'BRANCH',
      baseConfidence: 0.7,
      parentNodeId: parentId,
      sortOrder: 0,
      children: [],
      isExpanded: true,
      isDirty: true,
    };

    const addRecursive = (node: PathwayNodeForm): PathwayNodeForm => {
      if (node.id === parentId) {
        return {
          ...node,
          children: [...node.children, { ...newNode, sortOrder: node.children.length }],
          isExpanded: true,
        };
      }
      return {
        ...node,
        children: node.children.map(addRecursive),
      };
    };
    setRootNode((prev) => (prev ? addRecursive(prev) : prev));
    setHasChanges(true);
  }, []);

  const removeNode = useCallback((nodeId: string, isNew: boolean) => {
    const removeRecursive = (node: PathwayNodeForm): PathwayNodeForm => {
      return {
        ...node,
        children: node.children.filter((child) => child.id !== nodeId).map(removeRecursive),
      };
    };
    setRootNode((prev) => (prev ? removeRecursive(prev) : prev));
    setHasChanges(true);

    // If not a new node, delete from backend
    if (!isNew) {
      deletePathwayNode(nodeId).catch(console.error);
    }
  }, [deletePathwayNode]);

  const toggleNodeExpand = useCallback((nodeId: string) => {
    setRootNode((prev) => {
      if (!prev) return prev;
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
  }, []);

  // Save all changes
  const handleSave = async () => {
    setError(null);
    setSaveSuccess(false);

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

    try {
      // Update pathway metadata
      await updatePathway(pathwayId, {
        name: name.trim(),
        description: description.trim() || undefined,
        primaryConditionCodes: validCodes,
        version: version.trim() || '1.0',
        evidenceSource: evidenceSource.trim() || undefined,
        evidenceGrade: evidenceGrade.trim() || undefined,
      });

      // Save nodes recursively
      if (rootNode) {
        const savedNodeIds = new Map<string, string>(); // temp id -> real id

        const saveNodesRecursive = async (
          node: PathwayNodeForm,
          parentRealId: string | null,
          sortOrder: number
        ): Promise<string> => {
          let realId: string;

          if (node.isNew) {
            // Create new node
            const created = await createPathwayNode({
              pathwayId,
              parentNodeId: parentRealId || undefined,
              nodeType: node.nodeType,
              title: node.title.trim(),
              description: node.description.trim() || undefined,
              actionType: node.actionType || undefined,
              baseConfidence: node.baseConfidence,
              sortOrder,
            });
            if (!created) throw new Error(`Failed to create node: ${node.title}`);
            realId = created.id;
            savedNodeIds.set(node.id, realId);
          } else if (node.isDirty) {
            // Update existing node
            await updatePathwayNode(node.id, {
              nodeType: node.nodeType,
              title: node.title.trim(),
              description: node.description.trim() || undefined,
              actionType: node.actionType || undefined,
              baseConfidence: node.baseConfidence,
              sortOrder,
            });
            realId = node.id;
          } else {
            realId = node.id;
          }

          // Save children
          for (let i = 0; i < node.children.length; i++) {
            await saveNodesRecursive(node.children[i], realId, i);
          }

          return realId;
        };

        await saveNodesRecursive(rootNode, null, 0);
      }

      // Refresh data
      await refetchPathway();
      await refetchNodes();

      setHasChanges(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save pathway:', err);
      setError(err instanceof Error ? err.message : 'Failed to save pathway');
    }
  };

  // Publish/unpublish
  const handlePublishToggle = async () => {
    if (!pathway) return;
    try {
      if (pathway.isPublished) {
        await unpublish(pathwayId);
      } else {
        await publish(pathwayId);
      }
      await refetchPathway();
    } catch (err) {
      console.error('Failed to update publish status:', err);
      setError('Failed to update publish status');
    }
  };

  // Loading state
  if (pathwayLoading || nodesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  // Error state
  if (pathwayError || !pathway) {
    return (
      <div className="p-6">
        <Card>
          <CardBody>
            <div className="text-center py-8">
              <p className="text-red-500 mb-4">
                {pathwayError?.message || 'Pathway not found'}
              </p>
              <Link href="/decision-explorer/pathways">
                <Button>Back to Pathways</Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

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
          } ${node.isDirty ? 'ring-2 ring-primary-300 dark:ring-primary-600' : ''}`}
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

              {node.isNew && (
                <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  New
                </span>
              )}

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
                  onClick={() => removeNode(node.id, !!node.isNew)}
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
                  onChange={(e) => updateNode(node.id, { actionType: e.target.value || undefined })}
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

  const isSaving = updateLoading || createNodeLoading || updateNodeLoading || deleteNodeLoading;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/decision-explorer/pathways">
            <Button variant="ghost" size="sm">
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Edit Pathway
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-gray-500 dark:text-gray-400">{pathway.name}</span>
              {pathway.isPublished ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                  <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />
                  Published
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                  <ClockIcon className="h-3.5 w-3.5 mr-1" />
                  Draft
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href={`/decision-explorer?pathway=${pathwayId}`}>
            <Button variant="outline">
              <EyeIcon className="h-4 w-4 mr-2" />
              Preview
            </Button>
          </Link>
          <Button
            variant="outline"
            onClick={handlePublishToggle}
            disabled={publishLoading}
          >
            {publishLoading && <Spinner size="sm" className="mr-2" />}
            {pathway.isPublished ? 'Unpublish' : 'Publish'}
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
            {isSaving && <Spinner size="sm" className="mr-2" />}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {saveSuccess && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <p className="text-green-600 dark:text-green-400">Pathway saved successfully!</p>
        </div>
      )}

      {hasChanges && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-yellow-600 dark:text-yellow-400">You have unsaved changes</p>
        </div>
      )}

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
                onChange={(e) => {
                  setName(e.target.value);
                  setHasChanges(true);
                }}
                placeholder="e.g., Type 2 Diabetes Management"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Version
              </label>
              <Input
                value={version}
                onChange={(e) => {
                  setVersion(e.target.value);
                  setHasChanges(true);
                }}
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
              onChange={(e) => {
                setDescription(e.target.value);
                setHasChanges(true);
              }}
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
                onChange={(e) => {
                  setEvidenceSource(e.target.value);
                  setHasChanges(true);
                }}
                placeholder="e.g., ADA Standards of Care 2024"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Evidence Grade
              </label>
              <select
                value={evidenceGrade}
                onChange={(e) => {
                  setEvidenceGrade(e.target.value);
                  setHasChanges(true);
                }}
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
            Edit your clinical pathway decision tree. Nodes with a blue ring have unsaved changes.
          </p>
          {rootNode ? (
            renderNodeEditor(rootNode)
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400 mb-4">No nodes defined yet</p>
              <Button
                onClick={() => {
                  setRootNode({
                    id: generateTempId(),
                    isNew: true,
                    title: name || 'Root',
                    description: description || '',
                    nodeType: 'ROOT',
                    baseConfidence: 0.9,
                    sortOrder: 0,
                    children: [],
                    isExpanded: true,
                    isDirty: true,
                  });
                  setHasChanges(true);
                }}
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                Create Root Node
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
