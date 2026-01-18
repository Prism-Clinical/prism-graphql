'use client';

import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

export default function PendingApprovalPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <h1 className="text-center text-3xl font-bold text-blue-600">Prism</h1>
          
          <div className="mt-8 text-yellow-500">
            <svg className="mx-auto h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          
          <h2 className="mt-6 text-2xl font-bold text-gray-900">
            Account Pending Approval
          </h2>
          
          <div className="mt-4 text-gray-600 space-y-3">
            <p>
              Thank you for registering, {user?.firstName || 'Provider'}!
            </p>
            <p>
              Your account is currently being reviewed by our admin team.
              You will receive an email once your account has been approved.
            </p>
          </div>

          <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-800">What happens next?</h3>
            <ul className="mt-2 text-sm text-blue-700 text-left list-disc list-inside space-y-1">
              <li>Our admin team will verify your credentials</li>
              <li>You will receive an email notification</li>
              <li>Once approved, you can log in and access Prism</li>
            </ul>
          </div>

          <div className="mt-8 space-y-4">
            <p className="text-sm text-gray-500">
              Have questions? Contact your institution administrator or our support team.
            </p>
            
            <button
              onClick={() => logout()}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
