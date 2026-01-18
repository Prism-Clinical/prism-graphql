'use client';

import Link from 'next/link';
import {
  ShieldExclamationIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card';
import { SeverityBadge, PriorityBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingState, EmptyState } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/layout/Header';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useSafetyStats } from '@/lib/hooks/useSafetyChecks';
import { useReviewStats } from '@/lib/hooks/useReviewQueue';
import type { SafetySeverity, ReviewPriority } from '@/lib/utils/colors';

export default function DashboardPage() {
  const {
    criticalCount,
    contraindicatedCount,
    warningCount,
    recentAlerts,
    loading: safetyLoading,
    error: safetyError,
  } = useSafetyStats();

  const {
    pendingCount,
    overdueCount,
    recentReviews,
    loading: reviewLoading,
    error: reviewError,
  } = useReviewStats();

  const loading = safetyLoading || reviewLoading;
  const error = safetyError || reviewError;

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Safety Dashboard"
          subtitle="Monitor safety alerts, review queue, and clinical intelligence"
        />
        <LoadingState message="Loading dashboard data..." />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader
          title="Safety Dashboard"
          subtitle="Monitor safety alerts, review queue, and clinical intelligence"
        />
        <Card>
          <CardBody>
            <div className="text-center text-red-600">
              <ExclamationTriangleIcon className="h-12 w-12 mx-auto mb-4" />
              <p className="font-medium">Error loading dashboard</p>
              <p className="text-sm text-gray-500 mt-1">{error.message}</p>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Safety Dashboard"
        subtitle="Monitor safety alerts, review queue, and clinical intelligence"
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Critical Alerts"
          value={criticalCount + contraindicatedCount}
          icon={<ExclamationTriangleIcon className="h-6 w-6" />}
          color="red"
          href="/safety?severity=CRITICAL"
        />
        <StatCard
          title="Warning Alerts"
          value={warningCount}
          icon={<ShieldExclamationIcon className="h-6 w-6" />}
          color="yellow"
          href="/safety?severity=WARNING"
        />
        <StatCard
          title="Pending Reviews"
          value={pendingCount}
          icon={<ClipboardDocumentCheckIcon className="h-6 w-6" />}
          color="blue"
          href="/reviews"
        />
        <StatCard
          title="Overdue Reviews"
          value={overdueCount}
          icon={<ExclamationTriangleIcon className="h-6 w-6" />}
          color="orange"
          href="/reviews?overdue=true"
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Safety Alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Safety Alerts</CardTitle>
            <Link href="/safety">
              <Button variant="ghost" size="sm">
                View All
              </Button>
            </Link>
          </CardHeader>
          <CardBody className="p-0">
            {recentAlerts.length === 0 ? (
              <div className="px-6 py-8">
                <EmptyState
                  title="No recent safety alerts"
                  description="Safety alerts will appear here when flagged"
                />
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {recentAlerts.map((alert: any) => (
                  <Link
                    key={alert.id}
                    href={`/safety/${alert.id}`}
                    className="block px-6 py-4 hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <SeverityBadge severity={alert.severity as SafetySeverity} />
                          <span className="text-xs text-gray-500">
                            {alert.checkType?.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {alert.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {alert.patient?.name || 'Unknown Patient'} • {formatRelativeTime(alert.createdAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Pending Reviews */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Pending Reviews</CardTitle>
            <Link href="/reviews">
              <Button variant="ghost" size="sm">
                View All
              </Button>
            </Link>
          </CardHeader>
          <CardBody className="p-0">
            {recentReviews.length === 0 ? (
              <div className="px-6 py-8">
                <EmptyState
                  title="No pending reviews"
                  description="Reviews will appear here when items need attention"
                />
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {recentReviews.map((review: any) => (
                  <Link
                    key={review.id}
                    href={`/reviews/${review.id}`}
                    className="block px-6 py-4 hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <PriorityBadge priority={review.priority as ReviewPriority} />
                          {review.safetyCheck?.severity && (
                            <SeverityBadge
                              severity={review.safetyCheck.severity as SafetySeverity}
                              size="sm"
                            />
                          )}
                          {review.isOverdue && (
                            <span className="text-xs font-medium text-red-600">OVERDUE</span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {review.safetyCheck?.title || 'Review Item'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {review.patient?.name || 'Unknown Patient'} • Due {formatRelativeTime(review.slaDeadline)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: 'red' | 'yellow' | 'blue' | 'orange' | 'green';
  href: string;
}

function StatCard({ title, value, icon, color, href }: StatCardProps) {
  const colorClasses = {
    red: 'bg-red-50 text-red-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    blue: 'bg-blue-50 text-blue-600',
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
  };

  return (
    <Link href={href}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardBody>
          <div className="flex items-center">
            <div className={`p-3 rounded-lg ${colorClasses[color]}`}>{icon}</div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">{title}</p>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
            </div>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
