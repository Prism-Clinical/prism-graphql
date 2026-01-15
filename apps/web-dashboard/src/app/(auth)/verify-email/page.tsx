'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@apollo/client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { VERIFY_EMAIL } from '@/lib/graphql/mutations/auth';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const email = searchParams.get('email');
  
  const [status, setStatus] = useState<'waiting' | 'loading' | 'success' | 'error'>( token ? 'loading' : 'waiting');
  const [message, setMessage] = useState('');
  
  const [verifyEmail] = useMutation(VERIFY_EMAIL);

  useEffect(() => {
    if (!token) return;

    verifyEmail({ variables: { token } })
      .then(({ data }) => {
        if (data?.verifyEmail?.success) {
          setStatus('success');
          setMessage(data.verifyEmail.message);
        } else {
          setStatus('error');
          setMessage(data?.verifyEmail?.message || 'Verification failed');
        }
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.message || 'Verification failed');
      });
  }, [token, verifyEmail]);

  if (status === 'waiting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <div>
            <h1 className="text-center text-3xl font-bold text-blue-600">Prism</h1>
            <div className="mt-8 text-blue-500">
              <svg className="mx-auto h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="mt-4 text-2xl font-bold text-gray-900">Check your email</h2>
            <p className="mt-2 text-gray-600">
              We sent a verification link to {email ? <strong>{email}</strong> : 'your email'}.
            </p>
            <p className="mt-4 text-sm text-gray-500">
              Click the link in the email to verify your account and continue with registration.
            </p>
            <Link href="/login" className="mt-8 inline-block text-blue-600 hover:text-blue-500 font-medium">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <h1 className="text-center text-3xl font-bold text-blue-600">Prism</h1>
          
          {status === 'loading' && (
            <>
              <div className="mt-8 flex justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              </div>
              <p className="mt-4 text-gray-600">Verifying your email...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="mt-8 text-green-500">
                <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="mt-4 text-2xl font-bold text-gray-900">Email Verified!</h2>
              <p className="mt-2 text-gray-600">{message}</p>
              <p className="mt-4 text-sm text-gray-500">
                Your account is now pending admin approval. You will receive an email once approved.
              </p>
              <Link href="/login" className="mt-6 inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Go to Login
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="mt-8 text-red-500">
                <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="mt-4 text-2xl font-bold text-gray-900">Verification Failed</h2>
              <p className="mt-2 text-gray-600">{message}</p>
              <Link href="/login" className="mt-6 inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Back to Login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
