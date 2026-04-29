'use client';

import { useQuery } from '@apollo/client/react';
import { GET_PATHWAYS } from '@/lib/graphql/queries/pathways';
import { PathwayTable } from '@/components/dashboard/PathwayTable';
import { Button } from '@/components/ui/Button';
import { PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import type { Pathway } from '@/types';

export default function DashboardPage() {
  const { data, loading, error } = useQuery<{ pathways: Pathway[] }>(GET_PATHWAYS, {
    variables: { first: 100 },
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clinical Pathways</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage pathway recommendation trees for clinical decision support
          </p>
        </div>
        <Link href="/pathways/new">
          <Button leftIcon={<PlusIcon className="h-4 w-4" />}>
            New Pathway
          </Button>
        </Link>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-sm text-red-700">
            Failed to load pathways. Make sure the gateway is running on port 4000.
          </p>
          <p className="text-xs text-red-500 mt-1">{error.message}</p>
        </div>
      )}

      {/* Pathway table */}
      <PathwayTable pathways={data?.pathways ?? []} isLoading={loading} />
    </div>
  );
}
