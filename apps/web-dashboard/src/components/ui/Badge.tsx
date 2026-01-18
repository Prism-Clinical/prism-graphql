import { HTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';
import {
  severityColors,
  priorityColors,
  statusColors,
  reviewStatusColors,
  validationTierColors,
  SafetySeverity,
  ReviewPriority,
  SafetyStatus,
  ReviewStatus,
  ValidationTier,
} from '@/lib/utils/colors';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'outline';
  size?: 'sm' | 'md';
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', size = 'md', children, ...props }, ref) => {
    const sizeStyles = {
      sm: 'px-2 py-0.5 text-xs',
      md: 'px-2.5 py-0.5 text-xs',
    };

    const variantStyles = {
      default: 'bg-gray-100 text-gray-800',
      outline: 'bg-transparent border border-current',
    };

    return (
      <span
        ref={ref}
        className={clsx(
          'inline-flex items-center rounded-full font-medium',
          sizeStyles[size],
          variantStyles[variant],
          className
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';

// Severity Badge
export interface SeverityBadgeProps extends Omit<BadgeProps, 'children'> {
  severity: SafetySeverity;
}

const SeverityBadge = forwardRef<HTMLSpanElement, SeverityBadgeProps>(
  ({ severity, className, ...props }, ref) => {
    const colors = severityColors[severity];
    return (
      <Badge ref={ref} className={clsx(colors.badge, className)} {...props}>
        {severity}
      </Badge>
    );
  }
);

SeverityBadge.displayName = 'SeverityBadge';

// Priority Badge
export interface PriorityBadgeProps extends Omit<BadgeProps, 'children'> {
  priority: ReviewPriority;
}

const PriorityBadge = forwardRef<HTMLSpanElement, PriorityBadgeProps>(
  ({ priority, className, ...props }, ref) => {
    const colors = priorityColors[priority];
    return (
      <Badge ref={ref} className={clsx(colors.badge, className)} {...props}>
        {colors.label}
      </Badge>
    );
  }
);

PriorityBadge.displayName = 'PriorityBadge';

// Status Badge
export interface StatusBadgeProps extends Omit<BadgeProps, 'children'> {
  status: SafetyStatus;
}

const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ status, className, ...props }, ref) => {
    const colors = statusColors[status];
    return (
      <Badge ref={ref} className={clsx(colors.badge, className)} {...props}>
        {status.replace(/_/g, ' ')}
      </Badge>
    );
  }
);

StatusBadge.displayName = 'StatusBadge';

// Review Status Badge
export interface ReviewStatusBadgeProps extends Omit<BadgeProps, 'children'> {
  status: ReviewStatus;
}

const ReviewStatusBadge = forwardRef<HTMLSpanElement, ReviewStatusBadgeProps>(
  ({ status, className, ...props }, ref) => {
    const colors = reviewStatusColors[status];
    return (
      <Badge ref={ref} className={clsx(colors.badge, className)} {...props}>
        {status.replace(/_/g, ' ')}
      </Badge>
    );
  }
);

ReviewStatusBadge.displayName = 'ReviewStatusBadge';

// Validation Tier Badge
export interface ValidationTierBadgeProps extends Omit<BadgeProps, 'children'> {
  tier: ValidationTier;
}

const ValidationTierBadge = forwardRef<HTMLSpanElement, ValidationTierBadgeProps>(
  ({ tier, className, ...props }, ref) => {
    const colors = validationTierColors[tier];
    return (
      <Badge ref={ref} className={clsx(colors.bg, colors.text, className)} {...props}>
        {tier.replace(/_/g, ' ')}
      </Badge>
    );
  }
);

ValidationTierBadge.displayName = 'ValidationTierBadge';

export {
  Badge,
  SeverityBadge,
  PriorityBadge,
  StatusBadge,
  ReviewStatusBadge,
  ValidationTierBadge,
};
