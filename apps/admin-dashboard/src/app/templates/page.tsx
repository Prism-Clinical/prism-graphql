'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PlusIcon, DocumentDuplicateIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Spinner, EmptyState } from '@/components/ui/Spinner';
import { useTemplates, TemplateCategory } from '@/lib/hooks/useTemplates';

const categoryLabels: Record<TemplateCategory, string> = {
  CHRONIC_DISEASE: 'Chronic Disease',
  PREVENTIVE_CARE: 'Preventive Care',
  POST_PROCEDURE: 'Post Procedure',
  MEDICATION_MANAGEMENT: 'Medication Management',
  LIFESTYLE_MODIFICATION: 'Lifestyle Modification',
};

const categoryColors: Record<TemplateCategory, string> = {
  CHRONIC_DISEASE: 'bg-blue-100 text-blue-800',
  PREVENTIVE_CARE: 'bg-green-100 text-green-800',
  POST_PROCEDURE: 'bg-purple-100 text-purple-800',
  MEDICATION_MANAGEMENT: 'bg-orange-100 text-orange-800',
  LIFESTYLE_MODIFICATION: 'bg-teal-100 text-teal-800',
};

export default function TemplatesPage() {
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategory | undefined>();
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>();

  const { templates, loading, error, totalCount } = useTemplates({
    filter: {
      category: categoryFilter,
      isActive: activeFilter,
    },
    first: 50,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Care Plan Templates</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage reusable care plan templates with predefined goals and interventions
            {totalCount > 0 && ` (${totalCount} templates)`}
          </p>
        </div>
        <Link href="/templates/new">
          <Button>
            <PlusIcon className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex items-center gap-4">
            <FunnelIcon className="h-5 w-5 text-gray-400" />
            <select
              value={categoryFilter || ''}
              onChange={(e) => setCategoryFilter(e.target.value as TemplateCategory || undefined)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All Categories</option>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select
              value={activeFilter === undefined ? '' : activeFilter.toString()}
              onChange={(e) => setActiveFilter(e.target.value === '' ? undefined : e.target.value === 'true')}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">
              <p>Error loading templates. Please try again.</p>
            </div>
          ) : templates.length === 0 ? (
            <EmptyState
              title="No templates found"
              icon={<DocumentDuplicateIcon className="h-12 w-12" />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Conditions</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 text-xs rounded ${categoryColors[template.category] || 'bg-gray-100 text-gray-800'}`}>
                        {categoryLabels[template.category] || template.category}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {template.conditionCodes?.slice(0, 2).map((code) => (
                          <span key={code} className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                            {code}
                          </span>
                        ))}
                        {template.conditionCodes?.length > 2 && (
                          <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                            +{template.conditionCodes.length - 2}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">{template.version}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 text-xs rounded ${template.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                        {template.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Link href={`/templates/${template.id}`}>
                          <Button variant="ghost" size="sm">View</Button>
                        </Link>
                        <Link href={`/templates/${template.id}/edit`}>
                          <Button variant="ghost" size="sm">Edit</Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
