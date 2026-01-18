'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useCreateMLModel, usePreviewFilterCriteria, type MLModelFilterCriteria } from '@/lib/hooks/useMLModels';

export default function NewMLModelPage() {
  const router = useRouter();
  const { create, loading } = useCreateMLModel();
  const { preview, loading: previewLoading, results: previewResults } = usePreviewFilterCriteria();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  // Filter criteria
  const [conditionCodePrefixes, setConditionCodePrefixes] = useState<string[]>([]);
  const [conditionCodes, setConditionCodes] = useState<string[]>([]);
  const [trainingTags, setTrainingTags] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [targetConditions, setTargetConditions] = useState<string[]>([]);

  // Input states for adding new items
  const [newPrefix, setNewPrefix] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newTargetCondition, setNewTargetCondition] = useState('');

  const generateSlug = (value: string) => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slug || slug === generateSlug(name)) {
      setSlug(generateSlug(value));
    }
  };

  const addItem = (list: string[], setList: (items: string[]) => void, value: string, setValue: (v: string) => void) => {
    const trimmed = value.trim();
    if (trimmed && !list.includes(trimmed)) {
      setList([...list, trimmed]);
      setValue('');
    }
  };

  const removeItem = (list: string[], setList: (items: string[]) => void, value: string) => {
    setList(list.filter(item => item !== value));
  };

  const handlePreview = async () => {
    const filterCriteria: MLModelFilterCriteria = {};
    if (conditionCodePrefixes.length > 0) filterCriteria.conditionCodePrefixes = conditionCodePrefixes;
    if (conditionCodes.length > 0) filterCriteria.conditionCodes = conditionCodes;
    if (trainingTags.length > 0) filterCriteria.trainingTags = trainingTags;
    if (categories.length > 0) filterCriteria.categories = categories;

    try {
      await preview(filterCriteria);
    } catch (err) {
      console.error('Preview failed:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !slug.trim()) {
      alert('Name and slug are required');
      return;
    }

    const filterCriteria: MLModelFilterCriteria = {};
    if (conditionCodePrefixes.length > 0) filterCriteria.conditionCodePrefixes = conditionCodePrefixes;
    if (conditionCodes.length > 0) filterCriteria.conditionCodes = conditionCodes;
    if (trainingTags.length > 0) filterCriteria.trainingTags = trainingTags;
    if (categories.length > 0) filterCriteria.categories = categories;

    try {
      const model = await create({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        filterCriteria: Object.keys(filterCriteria).length > 0 ? filterCriteria : undefined,
        targetConditions: targetConditions.length > 0 ? targetConditions : undefined,
        isDefault,
      });
      router.push(`/ml-models/${model.id}`);
    } catch (err) {
      alert(`Failed to create model: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/ml-models">
          <Button variant="ghost" size="sm">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New ML Model</h1>
          <p className="text-sm text-gray-500">Create a new machine learning model for care plan recommendations</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Model Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="e.g., Strep Throat Model"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Slug *
                  </label>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="e.g., strep-throat"
                    pattern="^[a-z0-9_-]+$"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">URL-friendly identifier (lowercase, hyphens, numbers only)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what this model is for..."
                    rows={3}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="isDefault" className="text-sm text-gray-700">
                    Set as default model
                  </label>
                </div>
              </CardBody>
            </Card>

            {/* Filter Criteria */}
            <Card>
              <CardHeader>
                <CardTitle>Filter Criteria (Automatic Training Data Selection)</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <p className="text-sm text-gray-500 mb-4">
                  Define criteria to automatically select care plans for training. Leave empty to use manual assignment only.
                </p>

                {/* Condition Code Prefixes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Condition Code Prefixes
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={newPrefix}
                      onChange={(e) => setNewPrefix(e.target.value.toUpperCase())}
                      placeholder="e.g., J02"
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addItem(conditionCodePrefixes, setConditionCodePrefixes, newPrefix, setNewPrefix);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => addItem(conditionCodePrefixes, setConditionCodePrefixes, newPrefix, setNewPrefix)}
                    >
                      <PlusIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {conditionCodePrefixes.map((prefix) => (
                      <span key={prefix} className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-blue-50 text-blue-700 rounded">
                        {prefix}*
                        <button type="button" onClick={() => removeItem(conditionCodePrefixes, setConditionCodePrefixes, prefix)}>
                          <XMarkIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Exact Condition Codes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Exact Condition Codes
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value)}
                      placeholder="e.g., E11.9"
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addItem(conditionCodes, setConditionCodes, newCode, setNewCode);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => addItem(conditionCodes, setConditionCodes, newCode, setNewCode)}
                    >
                      <PlusIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {conditionCodes.map((code) => (
                      <span key={code} className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-blue-50 text-blue-700 rounded">
                        {code}
                        <button type="button" onClick={() => removeItem(conditionCodes, setConditionCodes, code)}>
                          <XMarkIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Training Tags */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Training Tags
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value.toLowerCase())}
                      placeholder="e.g., strep"
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addItem(trainingTags, setTrainingTags, newTag, setNewTag);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => addItem(trainingTags, setTrainingTags, newTag, setNewTag)}
                    >
                      <PlusIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {trainingTags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-purple-50 text-purple-700 rounded">
                        #{tag}
                        <button type="button" onClick={() => removeItem(trainingTags, setTrainingTags, tag)}>
                          <XMarkIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Categories */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Categories
                  </label>
                  <div className="flex gap-2 mb-2">
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="">Select a category</option>
                      <option value="CHRONIC_DISEASE">Chronic Disease</option>
                      <option value="PREVENTIVE_CARE">Preventive Care</option>
                      <option value="POST_PROCEDURE">Post Procedure</option>
                      <option value="MEDICATION_MANAGEMENT">Medication Management</option>
                      <option value="LIFESTYLE_MODIFICATION">Lifestyle Modification</option>
                      <option value="ACUTE_CARE">Acute Care</option>
                    </select>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        if (newCategory && !categories.includes(newCategory)) {
                          setCategories([...categories, newCategory]);
                          setNewCategory('');
                        }
                      }}
                    >
                      <PlusIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {categories.map((cat) => (
                      <span key={cat} className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-green-50 text-green-700 rounded">
                        {cat}
                        <button type="button" onClick={() => removeItem(categories, setCategories, cat)}>
                          <XMarkIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="pt-4">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handlePreview}
                    disabled={previewLoading}
                  >
                    {previewLoading ? 'Loading...' : 'Preview Matching Care Plans'}
                  </Button>
                </div>
              </CardBody>
            </Card>

            {/* Target Conditions */}
            <Card>
              <CardHeader>
                <CardTitle>Target Conditions (Optional)</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-sm text-gray-500 mb-4">
                  Specify condition codes this model is designed to recommend for. Used for intelligent model selection.
                </p>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newTargetCondition}
                    onChange={(e) => setNewTargetCondition(e.target.value)}
                    placeholder="e.g., J02.9"
                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addItem(targetConditions, setTargetConditions, newTargetCondition, setNewTargetCondition);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => addItem(targetConditions, setTargetConditions, newTargetCondition, setNewTargetCondition)}
                  >
                    <PlusIcon className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {targetConditions.map((code) => (
                    <span key={code} className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-gray-100 text-gray-700 rounded">
                      {code}
                      <button type="button" onClick={() => removeItem(targetConditions, setTargetConditions, code)}>
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Preview Panel */}
          <div className="lg:col-span-1">
            <Card className="sticky top-4">
              <CardHeader>
                <CardTitle>Filter Preview</CardTitle>
              </CardHeader>
              <CardBody>
                {previewResults.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    Click "Preview Matching Care Plans" to see which care plans match your filter criteria.
                  </p>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      {previewResults.length} matching care plan(s)
                    </p>
                    <div className="max-h-96 overflow-y-auto space-y-2">
                      {previewResults.map((result) => (
                        <div key={result.carePlanId} className="p-2 bg-gray-50 rounded text-sm">
                          <div className="font-medium truncate">{result.title}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {result.conditionCodes.slice(0, 2).map((code) => (
                              <span key={code} className="px-1 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                                {code}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        {/* Submit */}
        <div className="mt-6 flex justify-end gap-3">
          <Link href="/ml-models">
            <Button variant="secondary" type="button">Cancel</Button>
          </Link>
          <Button type="submit" disabled={loading}>
            {loading ? 'Creating...' : 'Create Model'}
          </Button>
        </div>
      </form>
    </div>
  );
}
