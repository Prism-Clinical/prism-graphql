import { useQuery } from '@apollo/client';
import { GET_AUDIT_LOGS } from '../graphql/queries/admin';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT' | 'EXPORT' | 'LOGIN' | 'LOGOUT' | 'VIEW';
export type AuditEntityType = 'USER' | 'CARE_PLAN_TEMPLATE' | 'SAFETY_RULE' | 'MEDICATION' | 'PATIENT' | 'CARE_PLAN' | 'IMPORT_JOB';

export interface AuditLog {
  id: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  userId?: string;
  userName?: string;
  changes?: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}

interface AuditLogFilterInput {
  action?: AuditAction;
  entityType?: AuditEntityType;
  entityId?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

interface UseAuditLogsOptions {
  filter?: AuditLogFilterInput;
  first?: number;
  after?: string;
}

export function useAuditLogs(options: UseAuditLogsOptions = {}) {
  const { data, loading, error, refetch, fetchMore } = useQuery(GET_AUDIT_LOGS, {
    variables: {
      filter: options.filter,
      pagination: {
        first: options.first || 50,
        after: options.after,
      },
    },
    fetchPolicy: 'cache-and-network',
  });

  const logs: AuditLog[] = data?.auditLogs?.edges?.map((edge: any) => edge.node) || [];
  const pageInfo = data?.auditLogs?.pageInfo;
  const totalCount = data?.auditLogs?.totalCount || 0;

  return {
    logs,
    pageInfo,
    totalCount,
    loading,
    error,
    refetch,
    fetchMore,
  };
}
