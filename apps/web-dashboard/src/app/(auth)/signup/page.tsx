'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLazyQuery } from '@apollo/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { VALIDATE_NPI, IS_APPROVED_DOMAIN } from '@/lib/graphql/queries/auth';

const PROVIDER_ROLES = [
  { value: 'PHYSICIAN', label: 'Physician' },
  { value: 'NURSE', label: 'Nurse' },
  { value: 'PHARMACIST', label: 'Pharmacist' },
  { value: 'CARE_COORDINATOR', label: 'Care Coordinator' },
];

export default function SignupPage() {
  const { signup, isLoading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    npi: '',
    institutionCode: '',
    role: 'PHYSICIAN',
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [validateNpi] = useLazyQuery(VALIDATE_NPI);
  const [checkDomain] = useLazyQuery(IS_APPROVED_DOMAIN);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const validateEmail = async () => {
    const parts = formData.email.split('@');
    const domain = parts[1]?.toLowerCase();
    if (!domain) return false;

    const { data } = await checkDomain({ variables: { domain } });
    return data?.isApprovedDomain === true;
  };

  const validateNpiNumber = async () => {
    if (formData.npi.length !== 10) return false;
    const { data } = await validateNpi({ variables: { npi: formData.npi } });
    return data?.validateNPI?.isValid === true;
  };

  const handleNextStep = async () => {
    setError('');

    if (step === 1) {
      if (!formData.email || !formData.firstName || !formData.lastName) {
        setError('Please fill in all fields');
        return;
      }
      const domainValid = await validateEmail();
      if (!domainValid) {
        setError('Your email domain is not authorized. Please use an approved hospital or academic email.');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!formData.npi || !formData.institutionCode || !formData.role) {
        setError('Please fill in all fields');
        return;
      }
      const npiIsValid = await validateNpiNumber();
      if (!npiIsValid) {
        setError('Invalid NPI number. Please enter a valid 10-digit NPI.');
        return;
      }
      setStep(3);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signup(formData);
      if (result.success) {
        router.push('/verify-email?email=' + encodeURIComponent(formData.email));
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create account. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepLabels = ['Basic Info', 'Provider Details', 'Set Password'];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-3xl font-bold text-blue-600">Prism</h1>
          <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">
            Create Provider Account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Step {step} of 3: {stepLabels[step - 1]}
          </p>
        </div>

        <div className="flex items-center">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex-1 flex items-center">
              <div className={'h-2 flex-1 rounded-full mx-1 ' + (s <= step ? 'bg-blue-600' : 'bg-gray-200')} />
            </div>
          ))}
        </div>

        <form className="mt-8 space-y-6" onSubmit={step === 3 ? handleSubmit : (e) => { e.preventDefault(); handleNextStep(); }}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">First name</label>
                  <input id="firstName" name="firstName" type="text" required value={formData.firstName} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">Last name</label>
                  <input id="lastName" name="lastName" type="text" required value={formData.lastName} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
                </div>
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">Work email address</label>
                <input id="email" name="email" type="email" required value={formData.email} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" placeholder="you@hospital.edu" />
                <p className="mt-1 text-xs text-gray-500">Must be from an approved hospital or academic institution</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="npi" className="block text-sm font-medium text-gray-700">NPI Number</label>
                <input id="npi" name="npi" type="text" required maxLength={10} value={formData.npi} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" placeholder="10-digit NPI" />
                <p className="mt-1 text-xs text-gray-500">Your National Provider Identifier</p>
              </div>
              <div>
                <label htmlFor="institutionCode" className="block text-sm font-medium text-gray-700">Institution Code</label>
                <input id="institutionCode" name="institutionCode" type="text" required value={formData.institutionCode} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" placeholder="e.g., STANFORD, MAYO" />
                <p className="mt-1 text-xs text-gray-500">Ask your administrator for your institution code</p>
              </div>
              <div>
                <label htmlFor="role" className="block text-sm font-medium text-gray-700">Role</label>
                <select id="role" name="role" value={formData.role} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm">
                  {PROVIDER_ROLES.map((role) => (<option key={role.value} value={role.value}>{role.label}</option>))}
                </select>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
                <input id="password" name="password" type="password" required value={formData.password} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
                <p className="mt-1 text-xs text-gray-500">Must be 8+ characters with uppercase, lowercase, number, and special character</p>
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">Confirm password</label>
                <input id="confirmPassword" name="confirmPassword" type="password" required value={formData.confirmPassword} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
              </div>
            </div>
          )}

          <div className="flex space-x-4">
            {step > 1 && (
              <button type="button" onClick={() => setStep(step - 1)} className="flex-1 py-2 px-4 border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                Back
              </button>
            )}
            <button type="submit" disabled={isSubmitting || isLoading} className="flex-1 py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {isSubmitting ? 'Creating...' : step === 3 ? 'Create Account' : 'Continue'}
            </button>
          </div>

          <div className="text-center text-sm">
            <span className="text-gray-600">Already have an account? </span>
            <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500">Sign in</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
