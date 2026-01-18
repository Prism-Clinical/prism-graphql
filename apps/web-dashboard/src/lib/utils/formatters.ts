/**
 * Formatting utilities for dates, text, and medical codes
 */

import { formatDistanceToNow, format, differenceInHours, differenceInMinutes, isPast } from 'date-fns';

/**
 * Format a date as relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Format a date as absolute time (e.g., "Dec 29, 2024 at 2:30 PM")
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'MMM d, yyyy \'at\' h:mm a');
}

/**
 * Format a date as short date (e.g., "Dec 29, 2024")
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'MMM d, yyyy');
}

/**
 * Calculate SLA status and remaining time
 */
export function calculateSLAStatus(deadline: Date | string): {
  isOverdue: boolean;
  remainingText: string;
  urgencyLevel: 'critical' | 'warning' | 'normal';
} {
  const d = typeof deadline === 'string' ? new Date(deadline) : deadline;
  const now = new Date();
  const isOverdue = isPast(d);

  if (isOverdue) {
    const hoursOverdue = differenceInHours(now, d);
    return {
      isOverdue: true,
      remainingText: `${hoursOverdue}h overdue`,
      urgencyLevel: 'critical',
    };
  }

  const hoursRemaining = differenceInHours(d, now);
  const minutesRemaining = differenceInMinutes(d, now);

  if (hoursRemaining < 1) {
    return {
      isOverdue: false,
      remainingText: `${minutesRemaining}m remaining`,
      urgencyLevel: 'critical',
    };
  }

  if (hoursRemaining < 4) {
    return {
      isOverdue: false,
      remainingText: `${hoursRemaining}h remaining`,
      urgencyLevel: 'warning',
    };
  }

  return {
    isOverdue: false,
    remainingText: `${hoursRemaining}h remaining`,
    urgencyLevel: 'normal',
  };
}

/**
 * Format confidence score as percentage
 */
export function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Format anomaly score
 */
export function formatAnomalyScore(score: number): string {
  return score.toFixed(2);
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format safety check type for display
 */
export function formatCheckType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format severity for display
 */
export function formatSeverity(severity: string): string {
  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

/**
 * Format priority for display (P0_CRITICAL -> P0 - Critical)
 */
export function formatPriority(priority: string): string {
  const [level, ...rest] = priority.split('_');
  const label = rest.join(' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return `${level} - ${label}`;
}

/**
 * Format medical code with type prefix
 */
export function formatMedicalCode(code: string, type?: string): string {
  if (type) {
    return `${type}: ${code}`;
  }
  return code;
}

/**
 * Pluralize a word based on count
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  return plural || `${singular}s`;
}

/**
 * Format count with label (e.g., "5 alerts", "1 alert")
 */
export function formatCountWithLabel(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}
