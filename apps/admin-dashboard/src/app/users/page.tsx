'use client';

import Link from 'next/link';
import { PlusIcon, UsersIcon } from '@heroicons/react/24/outline';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/Spinner';

// Placeholder data
const users = [
  { id: '1', firstName: 'John', lastName: 'Smith', email: 'john.smith@hospital.org', role: 'ADMIN', status: 'ACTIVE' },
  { id: '2', firstName: 'Sarah', lastName: 'Johnson', email: 'sarah.johnson@hospital.org', role: 'CLINICIAN', status: 'ACTIVE' },
  { id: '3', firstName: 'Michael', lastName: 'Brown', email: 'michael.brown@hospital.org', role: 'REVIEWER', status: 'ACTIVE' },
];

const roleColors: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-800',
  CLINICIAN: 'bg-blue-100 text-blue-800',
  REVIEWER: 'bg-green-100 text-green-800',
  AUDITOR: 'bg-orange-100 text-orange-800',
  READ_ONLY: 'bg-gray-100 text-gray-800',
};

export default function UsersPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage user accounts, roles, and permissions
          </p>
        </div>
        <Link href="/users/new">
          <Button>
            <PlusIcon className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </Link>
      </div>

      <Card>
        <CardBody>
          {users.length === 0 ? (
            <EmptyState
              title="No users found"
              icon={<UsersIcon className="h-12 w-12" />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.firstName} {user.lastName}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 text-xs rounded ${roleColors[user.role]}`}>
                        {user.role}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 text-xs rounded ${user.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                        {user.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link href={`/users/${user.id}`}>
                        <Button variant="ghost" size="sm">Edit</Button>
                      </Link>
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
