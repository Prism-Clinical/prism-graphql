'use client';

import Link from 'next/link';
import { ArrowUpTrayIcon, ArrowDownTrayIcon, DocumentTextIcon, DocumentArrowUpIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const exportTypes = [
  { name: 'Templates', description: 'Export care plan templates' },
  { name: 'Training Examples', description: 'Export ML training examples' },
  { name: 'Clinical Alerts', description: 'Export clinical alert configurations' },
  { name: 'Audit Logs', description: 'Export audit trail' },
];

export default function ImportExportPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Import / Export</h1>
        <p className="mt-1 text-sm text-gray-500">
          Import standardized care plan documents or export system data
        </p>
      </div>

      {/* Care Plan Import - Featured */}
      <Card className="mb-6 border-2 border-indigo-200 bg-indigo-50">
        <CardBody>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <DocumentArrowUpIcon className="h-10 w-10 text-indigo-600 mr-4" />
              <div>
                <h3 className="text-lg font-medium text-gray-900">Import Care Plan</h3>
                <p className="text-sm text-gray-600">
                  Upload standardized care plan documents (.txt), review extracted data, and import as templates or training examples
                </p>
              </div>
            </div>
            <Link href="/import-export/pdf">
              <Button>
                <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
                Import Care Plan
              </Button>
            </Link>
          </div>
        </CardBody>
      </Card>

      {/* Export Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center">
            <ArrowDownTrayIcon className="h-5 w-5 text-green-600 mr-2" />
            <CardTitle>Export Data</CardTitle>
          </div>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            {exportTypes.map((type) => (
              <div key={type.name} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{type.name}</p>
                  <p className="text-sm text-gray-500">{type.description}</p>
                </div>
                <Button variant="outline" size="sm">
                  <ArrowDownTrayIcon className="h-4 w-4 mr-1" />
                  Export
                </Button>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Recent Import Jobs */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent Import Jobs</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="text-center py-8 text-gray-500">
            <DocumentTextIcon className="h-12 w-12 mx-auto text-gray-300 mb-3" />
            <p>No recent import jobs. Start by importing a care plan above.</p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
