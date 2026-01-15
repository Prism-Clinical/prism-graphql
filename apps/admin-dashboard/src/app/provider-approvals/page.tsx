'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { PENDING_APPROVALS } from '@/lib/graphql/queries/auth';
import { APPROVE_PROVIDER } from '@/lib/graphql/mutations/auth';

interface ProviderApproval {
  id: string;
  status: string;
  createdAt: string;
  providerUser: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    npi: string;
    role: string;
    institution: {
      id: string;
      name: string;
      code: string;
    } | null;
  };
}

export default function ProviderApprovalsPage() {
  const [selectedRequest, setSelectedRequest] = useState<ProviderApproval | null>(null);
  const [notes, setNotes] = useState('');
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);

  const { data, loading, error, refetch } = useQuery(PENDING_APPROVALS, {
    variables: { first: 20 },
  });

  const [approveProvider, { loading: approving }] = useMutation(APPROVE_PROVIDER, {
    onCompleted: () => {
      setSelectedRequest(null);
      setNotes('');
      setActionType(null);
      refetch();
    },
  });

  const handleAction = async (approved: boolean) => {
    if (!selectedRequest) return;
    
    await approveProvider({
      variables: {
        input: {
          requestId: selectedRequest.id,
          approved,
          notes: notes || undefined,
        },
      },
    });
  };

  const approvals: ProviderApproval[] = data?.pendingApprovals?.edges?.map((e: any) => e.node) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Provider Approvals</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review and approve provider registration requests
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          Error loading approvals: {error.message}
        </div>
      ) : approvals.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-gray-400 text-lg">No pending approvals</div>
          <p className="text-sm text-gray-500 mt-2">
            All provider registrations have been reviewed
          </p>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  NPI
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Institution
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Submitted
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {approvals.map((approval) => (
                <tr key={approval.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                        <span className="text-indigo-600 font-medium">
                          {approval.providerUser.firstName.charAt(0)}
                          {approval.providerUser.lastName.charAt(0)}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {approval.providerUser.firstName} {approval.providerUser.lastName}
                        </div>
                        <div className="text-sm text-gray-500">{approval.providerUser.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {approval.providerUser.npi}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                      {approval.providerUser.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {approval.providerUser.institution?.name || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(approval.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => {
                        setSelectedRequest(approval);
                        setActionType('approve');
                      }}
                      className="text-green-600 hover:text-green-900 mr-4"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        setSelectedRequest(approval);
                        setActionType('reject');
                      }}
                      className="text-red-600 hover:text-red-900"
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedRequest && actionType && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {actionType === 'approve' ? 'Approve Provider' : 'Reject Provider'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Are you sure you want to {actionType} {selectedRequest.providerUser.firstName} {selectedRequest.providerUser.lastName}?
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes {actionType === 'reject' && '(required for rejection)'}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                rows={3}
                placeholder={actionType === 'reject' ? 'Please provide a reason for rejection...' : 'Optional notes...'}
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setSelectedRequest(null);
                  setNotes('');
                  setActionType(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction(actionType === 'approve')}
                disabled={approving || (actionType === 'reject' && !notes.trim())}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 bg-indigo-600 hover:bg-indigo-700"
              >
                {approving ? 'Processing...' : actionType === 'approve' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
