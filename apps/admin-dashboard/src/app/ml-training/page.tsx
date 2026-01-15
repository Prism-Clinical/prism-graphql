'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Square3Stack3DIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

export default function MLTrainingPage() {
  const router = useRouter();

  // Auto-redirect after a brief delay
  useEffect(() => {
    const timeout = setTimeout(() => {
      router.push('/ml-models');
    }, 3000);

    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <div className="max-w-2xl mx-auto py-12">
      <Card>
        <CardBody className="text-center py-12">
          <div className="p-4 bg-indigo-100 rounded-full w-20 h-20 mx-auto mb-6 flex items-center justify-center">
            <Square3Stack3DIcon className="h-10 w-10 text-indigo-600" />
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            ML Training has moved!
          </h1>

          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            ML Training is now integrated into the ML Models page. You can create named models,
            train them, view progress, and test recommendations all in one place.
          </p>

          <div className="flex items-center justify-center gap-4">
            <Link href="/ml-models">
              <Button size="lg">
                Go to ML Models
                <ArrowRightIcon className="h-5 w-5 ml-2" />
              </Button>
            </Link>
          </div>

          <div className="mt-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Spinner size="sm" />
            <span>Redirecting automatically in 3 seconds...</span>
          </div>
        </CardBody>
      </Card>

      <div className="mt-6 text-center">
        <h2 className="text-lg font-medium text-gray-900 mb-3">What's new?</h2>
        <ul className="text-sm text-gray-600 space-y-2">
          <li>Create multiple named models (e.g., "Strep Throat Model", "Diabetes Model")</li>
          <li>Configure filter criteria for automatic training data selection</li>
          <li>Train and manage model versions</li>
          <li>View real-time training progress</li>
          <li>Test models with condition codes directly</li>
          <li>Load/unload models for A/B testing</li>
        </ul>
      </div>
    </div>
  );
}
