import clsx from 'clsx';
import type { PathwayStatus } from '@/types';

interface StatusBadgeProps {
  status: PathwayStatus;
}

const statusConfig: Record<PathwayStatus, { label: string; classes: string }> = {
  DRAFT: {
    label: 'Draft',
    classes: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  ACTIVE: {
    label: 'Active',
    classes: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  ARCHIVED: {
    label: 'Archived',
    classes: 'bg-gray-50 text-gray-600 border-gray-200',
  },
  SUPERSEDED: {
    label: 'Superseded',
    classes: 'bg-purple-50 text-purple-700 border-purple-200',
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
        config.classes
      )}
    >
      {config.label}
    </span>
  );
}
