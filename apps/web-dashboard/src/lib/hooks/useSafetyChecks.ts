import { useQuery, useMutation } from '@apollo/client';
import {
  GET_SAFETY_CHECKS,
  GET_SAFETY_CHECK,
  GET_SAFETY_CHECKS_FOR_PATIENT,
  GET_ACTIVE_SAFETY_ALERTS,
  GET_SAFETY_STATS,
} from '../graphql/queries/safety';
import {
  VALIDATE_SAFETY,
  OVERRIDE_SAFETY_CHECK,
} from '../graphql/mutations/safety';

export interface SafetyCheckFilter {
  severity?: 'INFO' | 'WARNING' | 'CRITICAL' | 'CONTRAINDICATED';
  status?: 'PENDING' | 'PASSED' | 'FLAGGED' | 'OVERRIDDEN' | 'BLOCKED';
  checkType?: string;
  patientId?: string;
}

export function useSafetyChecks(filter?: SafetyCheckFilter, first = 20) {
  const { data, loading, error, fetchMore, refetch } = useQuery(GET_SAFETY_CHECKS, {
    variables: { filter, pagination: { first } },
    notifyOnNetworkStatusChange: true,
  });

  const loadMore = () => {
    if (data?.safetyChecks?.pageInfo?.hasNextPage) {
      fetchMore({
        variables: {
          pagination: {
            first,
            after: data.safetyChecks.pageInfo.endCursor,
          },
        },
      });
    }
  };

  return {
    safetyChecks: data?.safetyChecks?.edges?.map((e: any) => e.node) || [],
    totalCount: data?.safetyChecks?.totalCount || 0,
    hasNextPage: data?.safetyChecks?.pageInfo?.hasNextPage || false,
    loading,
    error,
    loadMore,
    refetch,
  };
}

export function useSafetyCheck(id: string) {
  const { data, loading, error, refetch } = useQuery(GET_SAFETY_CHECK, {
    variables: { id },
    skip: !id,
  });

  return {
    safetyCheck: data?.safetyCheck || null,
    loading,
    error,
    refetch,
  };
}

export function useSafetyChecksForPatient(patientId: string, first = 10) {
  const { data, loading, error, refetch } = useQuery(GET_SAFETY_CHECKS_FOR_PATIENT, {
    variables: { patientId, pagination: { first } },
    skip: !patientId,
  });

  return {
    safetyChecks: data?.safetyChecksForPatient?.edges?.map((e: any) => e.node) || [],
    totalCount: data?.safetyChecksForPatient?.totalCount || 0,
    loading,
    error,
    refetch,
  };
}

export function useActiveSafetyAlerts(patientId: string) {
  const { data, loading, error, refetch } = useQuery(GET_ACTIVE_SAFETY_ALERTS, {
    variables: { patientId },
    skip: !patientId,
  });

  return {
    alerts: data?.patient?.activeSafetyAlerts || [],
    loading,
    error,
    refetch,
  };
}

export function useSafetyStats() {
  const { data, loading, error, refetch } = useQuery(GET_SAFETY_STATS, {
    pollInterval: 30000, // Refresh every 30 seconds
  });

  return {
    criticalCount: data?.criticalAlerts?.totalCount || 0,
    contraindicatedCount: data?.contraindicatedAlerts?.totalCount || 0,
    warningCount: data?.warningAlerts?.totalCount || 0,
    recentAlerts: data?.recentAlerts?.edges?.map((e: any) => e.node) || [],
    loading,
    error,
    refetch,
  };
}

export function useValidateSafety() {
  const [validateSafety, { data, loading, error }] = useMutation(VALIDATE_SAFETY);

  const validate = async (input: {
    patientId: string;
    medicationCodes?: string[];
    conditionCodes?: string[];
    procedureCodes?: string[];
  }) => {
    const result = await validateSafety({ variables: { input } });
    return result.data?.validateSafety;
  };

  return {
    validate,
    result: data?.validateSafety,
    loading,
    error,
  };
}

export function useOverrideSafetyCheck() {
  const [overrideSafetyCheck, { loading, error }] = useMutation(OVERRIDE_SAFETY_CHECK, {
    refetchQueries: [GET_SAFETY_CHECKS, GET_SAFETY_STATS],
  });

  const override = async (input: {
    checkId: string;
    reason: string;
    justification: string;
    overriddenBy: string;
    expiresAt?: string;
  }) => {
    const result = await overrideSafetyCheck({ variables: { input } });
    return result.data?.overrideSafetyCheck;
  };

  return {
    override,
    loading,
    error,
  };
}
