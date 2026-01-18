/**
 * Color utilities for severity, priority, and status badges
 */

export type SafetySeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'CONTRAINDICATED';
export type ReviewPriority = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW';
export type SafetyStatus = 'PENDING' | 'PASSED' | 'FLAGGED' | 'OVERRIDDEN' | 'BLOCKED';
export type ValidationTier = 'HIGH_CONFIDENCE' | 'NEEDS_REVIEW' | 'BLOCKED';
export type ReviewStatus = 'PENDING_REVIEW' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'ESCALATED';

export const severityColors: Record<SafetySeverity, {
  bg: string;
  border: string;
  text: string;
  badge: string;
  icon: string;
}> = {
  INFO: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    badge: 'bg-blue-100 text-blue-800',
    icon: 'text-blue-500',
  },
  WARNING: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-700',
    badge: 'bg-yellow-100 text-yellow-800',
    icon: 'text-yellow-500',
  },
  CRITICAL: {
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-700',
    badge: 'bg-orange-100 text-orange-800',
    icon: 'text-orange-500',
  },
  CONTRAINDICATED: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-800',
    icon: 'text-red-500',
  },
};

export const priorityColors: Record<ReviewPriority, {
  bg: string;
  text: string;
  badge: string;
  label: string;
}> = {
  P0_CRITICAL: {
    bg: 'bg-red-600',
    text: 'text-white',
    badge: 'bg-red-600 text-white',
    label: 'P0 - Critical',
  },
  P1_HIGH: {
    bg: 'bg-orange-500',
    text: 'text-white',
    badge: 'bg-orange-500 text-white',
    label: 'P1 - High',
  },
  P2_MEDIUM: {
    bg: 'bg-yellow-500',
    text: 'text-black',
    badge: 'bg-yellow-500 text-black',
    label: 'P2 - Medium',
  },
  P3_LOW: {
    bg: 'bg-gray-400',
    text: 'text-white',
    badge: 'bg-gray-400 text-white',
    label: 'P3 - Low',
  },
};

export const statusColors: Record<SafetyStatus, {
  bg: string;
  text: string;
  badge: string;
}> = {
  PENDING: {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    badge: 'bg-gray-100 text-gray-700',
  },
  PASSED: {
    bg: 'bg-green-100',
    text: 'text-green-700',
    badge: 'bg-green-100 text-green-700',
  },
  FLAGGED: {
    bg: 'bg-yellow-100',
    text: 'text-yellow-700',
    badge: 'bg-yellow-100 text-yellow-700',
  },
  OVERRIDDEN: {
    bg: 'bg-purple-100',
    text: 'text-purple-700',
    badge: 'bg-purple-100 text-purple-700',
  },
  BLOCKED: {
    bg: 'bg-red-100',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-700',
  },
};

export const reviewStatusColors: Record<ReviewStatus, {
  bg: string;
  text: string;
  badge: string;
}> = {
  PENDING_REVIEW: {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    badge: 'bg-gray-100 text-gray-700',
  },
  IN_REVIEW: {
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    badge: 'bg-blue-100 text-blue-700',
  },
  APPROVED: {
    bg: 'bg-green-100',
    text: 'text-green-700',
    badge: 'bg-green-100 text-green-700',
  },
  REJECTED: {
    bg: 'bg-red-100',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-700',
  },
  ESCALATED: {
    bg: 'bg-purple-100',
    text: 'text-purple-700',
    badge: 'bg-purple-100 text-purple-700',
  },
};

export const validationTierColors: Record<ValidationTier, {
  text: string;
  bg: string;
  icon: string;
}> = {
  HIGH_CONFIDENCE: {
    text: 'text-green-600',
    bg: 'bg-green-100',
    icon: 'text-green-500',
  },
  NEEDS_REVIEW: {
    text: 'text-yellow-600',
    bg: 'bg-yellow-100',
    icon: 'text-yellow-500',
  },
  BLOCKED: {
    text: 'text-red-600',
    bg: 'bg-red-100',
    icon: 'text-red-500',
  },
};

export function getSeverityColor(severity: SafetySeverity) {
  return severityColors[severity] || severityColors.INFO;
}

export function getPriorityColor(priority: ReviewPriority) {
  return priorityColors[priority] || priorityColors.P3_LOW;
}

export function getStatusColor(status: SafetyStatus) {
  return statusColors[status] || statusColors.PENDING;
}

export function getValidationTierColor(tier: ValidationTier) {
  return validationTierColors[tier] || validationTierColors.NEEDS_REVIEW;
}
