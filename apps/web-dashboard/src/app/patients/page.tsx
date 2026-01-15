'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  MagnifyingGlassIcon,
  ArrowPathIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { LoadingState, EmptyState } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/layout/Header';
import { usePatients } from '@/lib/hooks/usePatients';

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString();
}

function calculateAge(dateOfBirth: string | null | undefined): string {
  if (!dateOfBirth) return 'N/A';
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return `${age} years`;
}

export default function PatientsPage() {
  const [searchQuery, setSearchQuery] = useState('');

  const { patients, loading, error, refetch } = usePatients(50);

  const filteredPatients = patients.filter((patient: any) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const fullName = `${patient.firstName} ${patient.lastName}`.toLowerCase();
      return (
        fullName.includes(query) ||
        patient.mrn?.toLowerCase().includes(query) ||
        patient.email?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle={`${patients.length} total patients`}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Patients' },
        ]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={loading}
          >
            <ArrowPathIcon className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      <Card>
        <CardBody>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search patients by name, MRN, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {loading && patients.length === 0 ? (
            <LoadingState message="Loading patients..." />
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-600">Error loading patients: {error.message}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4">
                Try Again
              </Button>
            </div>
          ) : filteredPatients.length === 0 ? (
            <EmptyState
              title={searchQuery ? 'No patients match your search' : 'No patients found'}
              icon={<UserIcon className="h-12 w-12" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>MRN</TableHead>
                    <TableHead>Date of Birth</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Gender</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPatients.map((patient: any) => (
                    <TableRow key={patient.id}>
                      <TableCell>
                        <Link
                          href={`/patients/${patient.id}/safety`}
                          className="font-medium text-blue-600 hover:text-blue-800"
                        >
                          {patient.firstName} {patient.lastName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-gray-600">
                        {patient.mrn || 'N/A'}
                      </TableCell>
                      <TableCell className="text-gray-600">
                        {formatDate(patient.dateOfBirth)}
                      </TableCell>
                      <TableCell className="text-gray-600">
                        {calculateAge(patient.dateOfBirth)}
                      </TableCell>
                      <TableCell className="text-gray-600">
                        {patient.gender || 'N/A'}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {patient.email && <div>{patient.email}</div>}
                        {patient.phone && <div>{patient.phone}</div>}
                        {!patient.email && !patient.phone && 'N/A'}
                      </TableCell>
                      <TableCell>
                        <Link href={`/patients/${patient.id}/safety`}>
                          <Button variant="ghost" size="sm">
                            View Details
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
