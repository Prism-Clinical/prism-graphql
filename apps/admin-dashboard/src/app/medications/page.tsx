'use client';

import { BeakerIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Card, CardBody } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useState } from 'react';

// Placeholder data
const medications = [
  { code: 'RX001', name: 'Metformin', genericName: 'Metformin HCl', drugClass: 'Biguanides', interactions: 3 },
  { code: 'RX002', name: 'Lisinopril', genericName: 'Lisinopril', drugClass: 'ACE Inhibitors', interactions: 5 },
  { code: 'RX003', name: 'Warfarin', genericName: 'Warfarin Sodium', drugClass: 'Anticoagulants', interactions: 12 },
];

export default function MedicationsPage() {
  const [search, setSearch] = useState('');

  const filteredMeds = medications.filter(med =>
    med.name.toLowerCase().includes(search.toLowerCase()) ||
    med.genericName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Medication Database</h1>
        <p className="mt-1 text-sm text-gray-500">
          Browse and manage medication information and interactions
        </p>
      </div>

      <Card>
        <CardBody>
          <div className="mb-4">
            <div className="relative max-w-md">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search medications..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Generic Name</TableHead>
                <TableHead>Drug Class</TableHead>
                <TableHead>Interactions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMeds.map((med) => (
                <TableRow key={med.code}>
                  <TableCell className="font-mono text-sm">{med.code}</TableCell>
                  <TableCell className="font-medium">{med.name}</TableCell>
                  <TableCell>{med.genericName}</TableCell>
                  <TableCell>
                    <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">
                      {med.drugClass}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 text-xs rounded ${med.interactions > 5 ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'}`}>
                      {med.interactions} interactions
                    </span>
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
