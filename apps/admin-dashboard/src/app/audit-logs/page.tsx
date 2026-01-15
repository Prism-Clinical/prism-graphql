'use client';

import { ClipboardDocumentListIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useState } from 'react';

// Placeholder data
const auditLogs = [
  { id: '1', action: 'CREATE', entityType: 'CARE_PLAN_TEMPLATE', user: 'John Smith', timestamp: '2024-12-31 10:30:00' },
  { id: '2', action: 'UPDATE', entityType: 'SAFETY_RULE', user: 'Sarah Johnson', timestamp: '2024-12-31 09:15:00' },
  { id: '3', action: 'DELETE', entityType: 'USER', user: 'Admin', timestamp: '2024-12-30 16:45:00' },
  { id: '4', action: 'IMPORT', entityType: 'MEDICATION', user: 'Michael Brown', timestamp: '2024-12-30 14:20:00' },
];

const actionColors: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  DELETE: 'bg-red-100 text-red-800',
  IMPORT: 'bg-purple-100 text-purple-800',
  EXPORT: 'bg-orange-100 text-orange-800',
};

export default function AuditLogsPage() {
  const [filter, setFilter] = useState('ALL');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track all system changes for compliance and security
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Activity Log</CardTitle>
            <div className="flex items-center space-x-2">
              <FunnelIcon className="h-5 w-5 text-gray-400" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1 text-sm"
              >
                <option value="ALL">All Actions</option>
                <option value="CREATE">Create</option>
                <option value="UPDATE">Update</option>
                <option value="DELETE">Delete</option>
                <option value="IMPORT">Import</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm text-gray-500">{log.timestamp}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 text-xs rounded ${actionColors[log.action]}`}>
                      {log.action}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{log.entityType.replace('_', ' ')}</span>
                  </TableCell>
                  <TableCell className="font-medium">{log.user}</TableCell>
                  <TableCell>
                    <button className="text-indigo-600 hover:text-indigo-800 text-sm">
                      View Details
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
