import { useQuery } from '@apollo/client';
import { GET_ADMIN_STATS } from '../graphql/queries/admin';

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalTemplates: number;
  activeTemplates: number;
  totalSafetyRules: number;
  activeSafetyRules: number;
  totalMedications: number;
  recentImportJobs: number;
  recentAuditLogs: number;
}

interface UseAdminStatsResult {
  stats: AdminStats | null;
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

export function useAdminStats(): UseAdminStatsResult {
  const { data, loading, error, refetch } = useQuery(GET_ADMIN_STATS, {
    fetchPolicy: 'cache-and-network',
  });

  return {
    stats: data?.adminStats || null,
    loading,
    error,
    refetch,
  };
}
