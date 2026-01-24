'use client';

import Link from 'next/link';
import {
  DocumentDuplicateIcon,
  ShieldExclamationIcon,
  BeakerIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentListIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useAdminStats } from '@/lib/hooks/useAdminStats';
import { useAuditLogs } from '@/lib/hooks/useAuditLogs';

const quickActions = [
  { name: 'Create Care Plan', description: 'Add a new care plan', href: '/care-plans/new', icon: DocumentDuplicateIcon },
  { name: 'Add Clinical Alert', description: 'Create a patient safety alert', href: '/safety-rules/new', icon: ShieldExclamationIcon },
  { name: 'Recommendation Engine', description: 'Configure ML recommendations', href: '/recommendation-engine', icon: CpuChipIcon },
  { name: 'Import Data', description: 'Import care plan documents', href: '/import-export', icon: ArrowDownTrayIcon },
  { name: 'View Audit Logs', description: 'Review system activity', href: '/audit-logs', icon: ClipboardDocumentListIcon },
];

const actionColors: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  DELETE: 'bg-red-100 text-red-800',
  IMPORT: 'bg-purple-100 text-purple-800',
  EXPORT: 'bg-orange-100 text-orange-800',
  LOGIN: 'bg-gray-100 text-gray-800',
  LOGOUT: 'bg-gray-100 text-gray-800',
  VIEW: 'bg-gray-100 text-gray-800',
};

export default function AdminDashboardPage() {
  const { stats, loading: statsLoading } = useAdminStats();
  const { logs, loading: logsLoading } = useAuditLogs({ first: 5 });

  const statsData = [
    { name: 'Care Plans', value: stats?.totalTemplates ?? '-', active: stats?.activeTemplates, icon: DocumentDuplicateIcon, href: '/care-plans', color: 'bg-blue-500' },
    { name: 'Clinical Alerts', value: stats?.totalSafetyRules ?? '-', active: stats?.activeSafetyRules, icon: ShieldExclamationIcon, href: '/safety-rules', color: 'bg-orange-500' },
    { name: 'ML Models', value: '-', icon: CpuChipIcon, href: '/ml-models', color: 'bg-green-500' },
    { name: 'Medications', value: stats?.totalMedications ?? '-', icon: BeakerIcon, href: '/medications', color: 'bg-purple-500' },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage Prism system configuration, care plans, and users
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statsData.map((stat) => (
          <Link key={stat.name} href={stat.href}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardBody>
                <div className="flex items-center">
                  <div className={`p-3 rounded-lg ${stat.color}`}>
                    <stat.icon className="h-6 w-6 text-white" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">{stat.name}</p>
                    {statsLoading ? (
                      <Spinner size="sm" />
                    ) : (
                      <div>
                        <p className="text-2xl font-semibold text-gray-900">
                          {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                        </p>
                        {stat.active !== undefined && (
                          <p className="text-xs text-gray-500">{stat.active} active</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickActions.map((action) => (
              <Link
                key={action.name}
                href={action.href}
                className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-indigo-300 transition-colors"
              >
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <action.icon className="h-5 w-5 text-indigo-600" />
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">{action.name}</p>
                  <p className="text-xs text-gray-500">{action.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Recent Activity */}
      <div className="mt-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Activity</CardTitle>
              <Link href="/audit-logs" className="text-sm text-indigo-600 hover:text-indigo-800">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {logsLoading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : logs.length > 0 ? (
              <div className="space-y-3">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div className="flex items-center">
                      <span className={`px-2 py-1 text-xs rounded ${actionColors[log.action] || 'bg-gray-100 text-gray-800'}`}>
                        {log.action}
                      </span>
                      <span className="ml-3 text-sm text-gray-900">
                        {log.entityType.replace(/_/g, ' ')}
                      </span>
                      {log.userName && (
                        <span className="ml-2 text-sm text-gray-500">
                          by {log.userName}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <ClipboardDocumentListIcon className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                <p>No recent activity. Activity logs will appear here once actions are performed.</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
